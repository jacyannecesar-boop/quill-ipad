/* scenebuilder.js — a worksheet for the scene you haven't written yet. It opens on "Think it
 * through", a free-write page for working out what the scene is for, then five structured steps
 * (where the story stands, who's here, what each of them wants, what turns, the beats) end in a
 * scene file with a brief at the top of its notes and the beats in the beat strip.
 * Answers live in <scene>.brief.json (the free-write and its AI review thread too); beats live in
 * <scene>.outline.json like any other scene's, so the beat strip and the builder always show the
 * same list. The structured steps have no AI: the questions do the work. AI only appears on the
 * Think step, as a reviewer and, on request, to sort the free-write into the steps (scene-ai.js),
 * always through a preview the writer accepts. */

const SceneBuilder = (() => {
  const STEPS = ['Think it through', 'Where we are', 'Who’s here', 'Wants', 'The turn', 'Beats']
  const REVIEW_KEEP = 40
  const OUTCOMES = ['Yes', 'No', 'Yes, but…', 'No, and…']
  const BRIEF_RE = /<section data-scene-brief(?:="[^"]*")?>[\s\S]*?<\/section>/

  let _ctx   = null   // { novelPath, chapterPath, scenePath, before, prev, createScene, onClose }
  let _chars = []     // the novel's character sheets
  let _charImages = {} // character id → photo path, for chip avatars
  let _story = { templateKey: 'generic', beats: {}, foundation: {} }   // the novel's structure, for step 1
  let _serves = []    // structure beat ids this scene serves (scene_beats frontmatter)
  let _caseItems = [] // clues, stops, rules and reveals assigned to this scene
  let _brief = null
  let _beats = []
  let _title = ''
  let _synopsis = ''
  let _synopsisTouched = false
  let _step  = 0
  let _dirty = false
  let _timer = null
  let _saving = null
  let _saveError = ''
  let _renderSeq = 0
  let _returnFocus = null
  // Think it through: the AI request in flight ('review' | 'structure'), how to stop it, the
  // structure the AI proposed and is waiting on the writer, and the reply being typed.
  let _aiBusy = null
  let _aiAbort = null
  let _aiError = ''
  let _plan = null
  let _replyDraft = ''
  let _prevInfo = null

  const esc = s => escapeHtml(s)
  const $ = id => document.getElementById(id)
  const uid = () => Math.random().toString(36).slice(2, 10)

  const checked = (result, fallback) => {
    if (result?.ok === false) throw new Error(result.error || fallback)
    return result
  }

  function blankBrief() {
    return {
      version: 1,
      freewrite: '',
      review: [],   // [{ role: 'user' | 'assistant', text, at, auto? }]
      prev: { question: '', expectation: '' },
      progress: '',
      cast: [],
      pov: '',
      setting: '',
      turn: { from: '', to: '', cause: '', changed: '', whyNeeded: '', outcome: '', crisis: '', arc: '' },
    }
  }

  function seedBeats() {
    return [
      { id: uid(), title: 'Opening state', note: '', by: '', done: false },
      { id: uid(), title: 'Complication', note: '', by: '', done: false },
      { id: uid(), title: 'Turn', note: '', by: '', done: false },
      { id: uid(), title: 'New state', note: '', by: '', done: false },
    ]
  }

  function caseItemsFor(cases, sceneId) {
    if (!sceneId) return []
    const items = []
    for (const raw of cases || []) {
      const c = QuillCase.normalize(raw)
      const caseName = c.title || 'Untitled case'
      const leadsHere = new Set(c.leads.filter(l => l.sceneId === sceneId).map(l => l.id))
      for (const l of c.leads.filter(x => leadsHere.has(x.id))) items.push({
        ref: `${c.id}:lead:${l.id}`, type: 'Investigation stop', caseName,
        title: l.title || l.where || 'Investigation stop',
        note: [l.learned && `Finds: ${l.learned}`, l.theory && `Believes: ${l.theory}`].filter(Boolean).join(' · '),
      })
      for (const cl of c.clues) {
        if (cl.foundSceneId !== sceneId && !(cl.alsoSceneIds || []).includes(sceneId) && !leadsHere.has(cl.leadId)) continue
        items.push({ ref: `${c.id}:clue:${cl.id}`, type: cl.key ? 'Key clue' : 'Clue', caseName,
          title: cl.text || 'Untitled clue', note: cl.note || (cl.pointsTo ? `Points to ${cl.pointsTo}` : '') })
      }
      for (const r of c.rules) if (r.sceneId === sceneId || leadsHere.has(r.leadId)) items.push({
        ref: `${c.id}:rule:${r.id}`, type: 'Solution rule', caseName, title: r.text || 'Establish the rule', note: '',
      })
      if (c.revealSceneId === sceneId || (c.revealLeadId && leadsHere.has(c.revealLeadId))) items.push({
        ref: `${c.id}:reveal`, type: 'Reveal', caseName, title: `Reveal the truth of ${caseName}`, note: '',
      })
    }
    return items
  }

  // The beat strip shows only title and note, so "driven by" rides at the front of the note.
  const byPrefix = by => by ? `${by} — ` : ''
  const noteForStrip = beat => beat.by && !String(beat.note || '').startsWith(byPrefix(beat.by))
    ? byPrefix(beat.by) + (beat.note || '') : (beat.note || '')
  const noteForBuilder = beat => beat.by && String(beat.note || '').startsWith(byPrefix(beat.by))
    ? beat.note.slice(byPrefix(beat.by).length) : (beat.note || '')

  // ── Open / close ────────────────────────────────────────────
  async function open(ctx) {
    _returnFocus = document.activeElement
    _ctx = ctx
    _step = 0
    _dirty = false
    _aiAbort?.()
    _aiBusy = null
    _aiAbort = null
    _aiError = ''
    _plan = null
    _replyDraft = ''
    _prevInfo = null
    _synopsisTouched = false
    clearTimeout(_timer)
    _timer = null
    _saving = null
    _saveError = ''
    showSaveStatus('')
    const [meta, structure, cases] = await Promise.all([
      window.quill.getFolderMeta(ctx.novelPath).catch(() => ({})),
      window.quill.getStructure(ctx.novelPath).catch(() => null),
      window.quill.getCases(ctx.novelPath).catch(() => null),
    ])
    _chars = (meta.characters || []).filter(c => String(c.name || '').trim())
    const ids = _chars.map(c => c.id).filter(Boolean)
    _charImages = ids.length ? await window.quill.getCharImagePaths({ novelRel: ctx.novelPath, charIds: ids }).catch(() => ({})) : {}
    _story = {
      templateKey: meta.beat_template || 'generic',
      beats: QuillStructure.migrate(meta.beats || {}),
      foundation: structure?.structure?.foundation || {},
      triangle: structure?.structure?.triangle === true,
    }
    _serves = []
    _caseItems = []

    if (ctx.scenePath) {
      const [brief, outline, file] = await Promise.all([
        window.quill.getBrief(ctx.scenePath).catch(() => ({})),
        window.quill.getOutline(ctx.scenePath).catch(() => ({ beats: [] })),
        window.quill.getFile(ctx.scenePath).catch(() => ({ meta: {} })),
      ])
      _brief = { ...blankBrief(), ...brief }
      _brief.prev = { ...blankBrief().prev, ...brief.prev }
      _brief.turn = { ...blankBrief().turn, ...brief.turn }
      _brief.cast = Array.isArray(brief.cast) ? brief.cast : []
      if (!brief.pov && file.meta?.scene_pov) _brief.pov = file.meta.scene_pov
      if (!brief.setting && file.meta?.scene_setting) _brief.setting = file.meta.scene_setting
      _beats = (outline.beats || []).map(b => ({ ...b, note: noteForBuilder(b) }))
      if (!_beats.length) _beats = seedBeats()
      _title = file.meta?.title || ''
      _serves = String(file.meta?.scene_beats || '').split(',').map(id => id.trim()).filter(Boolean)
      _synopsis = file.meta?.scene_synopsis || ''
      _synopsisTouched = !!_synopsis
      _caseItems = caseItemsFor(cases?.ok ? cases.cases : [], file.meta?.scene_id)
    } else {
      const saved = await window.quill.getScenePlanDraft({ novelRel: ctx.novelPath, chapterRel: ctx.chapterPath }).catch(() => null)
      const draft = saved?.ok ? saved.plan : null
      _brief = { ...blankBrief(), ...(draft?.brief || {}) }
      _brief.prev = { ...blankBrief().prev, ...(draft?.brief?.prev || {}) }
      _brief.turn = { ...blankBrief().turn, ...(draft?.brief?.turn || {}) }
      _brief.cast = Array.isArray(draft?.brief?.cast) ? draft.brief.cast : []
      _beats = Array.isArray(draft?.beats) && draft.beats.length ? draft.beats : seedBeats()
      _title = draft?.title || ''
      _synopsis = draft?.synopsis || ''
      _synopsisTouched = !!draft?.synopsisTouched
      _serves = Array.isArray(draft?.serves) ? draft.serves : []
    }
    _brief.freewrite = String(_brief.freewrite || '')
    _brief.review = Array.isArray(_brief.review) ? _brief.review.filter(t => t && typeof t.text === 'string') : []
    // A scene with nothing planned yet starts by thinking it through; one with a plan starts
    // where the plan does.
    _step = ctx.startAt === 'think' || !hasPlan() ? 0 : 1

    $('sb-heading').textContent = ctx.scenePath ? `Build “${_title || 'Untitled'}”`
      : ctx.unsorted ? 'A new scene idea' : 'Build the next scene'
    $('sb-finish').textContent = ctx.scenePath ? 'Save & open scene' : 'Create & open scene'
    $('scene-builder-modal').classList.add('show')
    await render()
    $('sb-body').querySelector('input,textarea,select,button,summary')?.focus()
  }

  async function close({ force = false } = {}) {
    if (!_ctx) return
    if (!force && !(await flush())) return
    _aiAbort?.()
    $('scene-builder-modal').classList.remove('show')
    const ctx = _ctx
    _ctx = null
    ctx.onClose?.()
    if (_returnFocus?.isConnected) _returnFocus.focus()
    else document.querySelector('.outliner-build,.outliner-build-scene')?.focus()
    _returnFocus = null
  }

  // ── Saving ──────────────────────────────────────────────────
  // A scene that doesn't exist yet keeps its answers in memory until Create.
  function changed() {
    _dirty = true
    paintRailState()
    showSaveStatus('Saving…')
    clearTimeout(_timer)
    _timer = setTimeout(flush, 600)
  }

  async function flush() {
    clearTimeout(_timer)
    _timer = null
    if (!_ctx) return true
    if (_saving) {
      const ok = await _saving
      if (!ok) return false
      return _dirty ? flush() : true
    }
    if (!_dirty) return true
    _dirty = false
    const ctx = _ctx
    _saving = (ctx.scenePath ? persist(ctx.scenePath) : persistDraft()).then(() => {
      if (_ctx === ctx) showSaveStatus('Saved')
      return true
    }).catch(error => {
      if (_ctx === ctx) {
        _dirty = true
        showSaveStatus(`Couldn’t save (${error.message}). Try again.`)
      }
      return false
    }).finally(() => { _saving = null })
    const ok = await _saving
    if (_dirty && ok) {
      clearTimeout(_timer)
      _timer = setTimeout(flush, 600)
    }
    return ok
  }

  async function persist(rel, { finished = false } = {}) {
    _brief.updated = new Date().toISOString()
    checked(await window.quill.saveBrief({ rel, brief: _brief, finished }), 'Could not save the scene brief.')
    checked(await window.quill.saveOutline({ rel, beats: stripBeats() }), 'Could not save the scene beats.')
    checked(await window.quill.updateSceneMeta({ rel, beats: _serves, synopsis: _synopsis.trim(),
      pov: _brief.pov, setting: _brief.setting.trim() }), 'Could not save the scene details.')
    await writeBriefIntoNotes(rel)
  }

  async function persistDraft() {
    checked(await window.quill.saveScenePlanDraft({
      novelRel: _ctx.novelPath, chapterRel: _ctx.chapterPath,
      plan: { version: 1, brief: _brief, beats: stripBeats(), title: _title, synopsis: _synopsis,
        synopsisTouched: _synopsisTouched, serves: _serves, updated: new Date().toISOString() },
    }), 'Could not save the scene plan.')
  }

  function showSaveStatus(text) {
    _saveError = text.startsWith('Couldn’t') ? text : ''
    const el = $('sb-save-status')
    if (el) {
      el.textContent = text
      el.classList.toggle('error', !!_saveError)
    }
  }

  const stripBeats = () => _beats
    .filter(b => String(b.title || '').trim() || String(b.note || '').trim())
    .map(b => ({ id: b.id, title: b.title || '', note: noteForStrip(b), by: b.by || '', done: !!b.done,
      ...(b.caseRef ? { caseRef: b.caseRef } : {}) }))

  // ── Rendering ───────────────────────────────────────────────
  const has = value => !!String(value || '').trim()
  function stepState(i) {
    const tests = [
      [has(_brief.freewrite), has(_brief.freewrite)],
      [has(_brief.progress) || has(_brief.prev.question) || _serves.length || _caseItems.length,
        has(_brief.progress) && (has(_brief.prev.question) || _serves.length || _caseItems.length)],
      [_brief.cast.length || has(_brief.setting), _brief.cast.length > 0 && has(_brief.pov) && has(_brief.setting)],
      [_brief.cast.some(c => has(c.want) || has(c.obstacle)), _brief.cast.length > 0 && _brief.cast.every(c => has(c.want) && has(c.obstacle))],
      [has(_brief.turn.from) || has(_brief.turn.to) || has(_brief.turn.cause), has(_brief.turn.from) && has(_brief.turn.to) && has(_brief.turn.cause)],
      [_beats.some(b => has(b.title) || has(b.note)), _beats.some(b => has(b.title) && has(b.note)) && (_ctx?.scenePath || has(_title))],
    ][i]
    return tests[1] ? 'complete' : tests[0] ? 'partial' : 'empty'
  }
  // Anything planned past the free-write, the starter beats aside.
  const hasPlan = () => [1, 2, 3, 4].some(i => stepState(i) !== 'empty') || !SceneAI.beatsArePristine(_beats)

  function railHTML() {
    return STEPS.map((name, i) => {
      const state = stepState(i)
      return `<button type="button" class="sb-rail-step${i === _step ? ' active' : ''}" data-step="${i}" data-state="${state}">
        <span class="sb-rail-num">${state === 'complete' ? '✓' : i + 1}</span><span>${esc(name)}</span></button>`
    }).join('')
  }

  function paintRailState() {
    const rail = $('sb-rail')
    if (!rail || !_ctx) return
    rail.querySelectorAll('[data-step]').forEach(btn => {
      const i = Number(btn.dataset.step), state = stepState(i)
      btn.dataset.state = state
      const num = btn.querySelector('.sb-rail-num')
      if (num) num.textContent = state === 'complete' ? '✓' : String(i + 1)
    })
  }

  async function render() {
    const seq = ++_renderSeq
    $('sb-rail').innerHTML = railHTML()
    $('sb-rail').querySelectorAll('.sb-rail-step').forEach(btn => {
      btn.onclick = () => go(Number(btn.dataset.step))
    })
    $('sb-back').disabled = _step === 0
    $('sb-next').style.display = _step === STEPS.length - 1 ? 'none' : ''
    $('sb-finish').style.display = _step === STEPS.length - 1 ? '' : 'none'

    const body = $('sb-body')
    const step = _step
    const html = await [stepThink, stepPrev, stepCast, stepWants, stepTurn, stepBeats][step]()
    if (seq !== _renderSeq || step !== _step) return
    body.innerHTML = html
    body.scrollTop = 0
    bindFields(body)
    body.querySelectorAll('img[data-photo-for]').forEach(img =>
      QuillPhoto.apply(img, _chars.find(c => c.id === img.dataset.photoFor)?.photo))
    ;[bindThink, bindPrev, bindCast, bindWants, bindTurn, bindBeats][step](body)
    growTextareas(body)
  }

  // Every box grows with what's written in it. iPad Safari has no resize handle, so a fixed
  // height hides the writing. A box inside a closed <details> measures 0, so it fits on open.
  function autosize(el) {
    if (!el.offsetParent) return
    el.style.height = 'auto'
    el.style.height = el.scrollHeight + 2 + 'px'
  }
  function growTextareas(root) {
    root.querySelectorAll('textarea').forEach(el => {
      setTimeout(() => autosize(el), 0)
      el.addEventListener('input', () => autosize(el))
    })
    root.querySelectorAll('details').forEach(d =>
      d.addEventListener('toggle', () => d.querySelectorAll('textarea').forEach(autosize)))
  }

  function go(step) {
    if (step < 0 || step >= STEPS.length) return
    _step = step
    render()
  }

  // Any element with data-bind="a.b" reads and writes _brief.a.b.
  function bindFields(root) {
    root.querySelectorAll('[data-bind]').forEach(el => {
      const keys = el.dataset.bind.split('.')
      const owner = keys.slice(0, -1).reduce((o, k) => o[k], _brief)
      const key = keys[keys.length - 1]
      el.value = owner[key] || ''
      el.addEventListener('input', () => { owner[key] = el.value; changed(); onFieldInput?.(el) })
    })
  }
  let onFieldInput = null

  const field = (label, bind, { rows = 2, placeholder = '' } = {}) => `
    <label class="sb-field"><span class="sb-label">${esc(label)}</span>
      <textarea rows="${rows}" data-bind="${bind}" placeholder="${esc(placeholder)}"></textarea></label>`

  // The scene before this one: its prose and beats, read once per open.
  async function prevInfo() {
    const prev = _ctx.prev
    if (!prev) return null
    if (_prevInfo?.path === prev.path) return _prevInfo
    const [file, outline] = await Promise.all([
      window.quill.getFile(prev.path).catch(() => ({ body: '' })),
      window.quill.getOutline(prev.path).catch(() => ({ beats: [] })),
    ])
    // Scenes save one paragraph per line, so any line break starts a new paragraph.
    const paras = String(file.body || '').split(/\n+/).map(p => p.trim())
      .filter(p => p && !/^(\*\s*){3}$/.test(p))
    _prevInfo = { path: prev.path, title: prev.title || 'Untitled', synopsis: prev.synopsis || '',
      paras, beats: (outline.beats || []).filter(b => b.title) }
    return _prevInfo
  }

  // The collapsed "Previous scene" recap that the Think and Where we are steps share.
  async function prevContext() {
    if (_ctx.unsorted) return ''   // no place in the book yet, so no scene before it
    const prev = _ctx.prev
    let recap = '<div class="sb-prev sb-prev-none">Opening scene: there’s nothing before this one.</div>'
    const info = await prevInfo()
    if (prev && info) {
      const { paras, beats } = info
      const hidden = Math.max(0, paras.length - 3)
      recap = `<div class="sb-prev">
        <div class="sb-prev-title">Last scene: ${esc(prev.title || 'Untitled')}</div>
        ${prev.synopsis ? `<div class="sb-prev-synopsis">${esc(prev.synopsis)}</div>` : ''}
        ${paras.length
          ? `<div class="sb-prev-tail">${paras.map((p, i) =>
              `<p${i < hidden ? ' class="sb-prev-early"' : ''}>${proseHTML(p)}</p>`).join('')}</div>
            ${hidden ? `<button type="button" class="sb-prev-toggle" id="sb-prev-toggle">Show whole scene</button>` : ''}`
          : '<div class="sb-hint">No prose yet.</div>'}
        ${beats.length ? `<div class="sb-prev-beats"><span class="sb-label">Its beats</span>
          <ol>${beats.map(b => `<li>${esc(b.title)}</li>`).join('')}</ol></div>` : ''}
      </div>`
    }
    const prevLabel = prev ? `Previous scene: ${esc(prev.title || 'Untitled')}` : 'Opening scene context'
    return `<details class="sb-deepen sb-context"><summary>${prevLabel}</summary>${recap}</details>`
  }

  function bindRecap(root) {
    const toggle = $('sb-prev-toggle')
    if (!toggle) return
    toggle.onclick = () => {
      const tail = root.querySelector('.sb-prev-tail')
      const full = tail.classList.toggle('full')
      toggle.textContent = full ? 'Show last 3 paragraphs' : 'Show whole scene'
      if (!full) tail.scrollTop = 0
    }
  }

  // 0 — Think it through
  async function stepThink() {
    return `<h4>Think it through</h4>
      <p class="sb-hint">Write your way into the scene before you structure it: what you want it to do, who’s there,
        what has to change, what you’re not sure of yet. Messy is fine. Nobody reads this but you.</p>
      ${await prevContext()}
      <label class="sb-field sb-think-field"><span class="sb-label">Your thinking</span>
        <textarea class="sb-think" data-bind="freewrite" rows="10" placeholder="I want this to be the scene where… I keep picturing… The problem is… Maybe she…"></textarea></label>
      <div class="sb-think-actions" id="sb-think-actions">${thinkActionsHTML()}</div>
      <div id="sb-plan">${planHTML()}</div>
      <section class="sb-review" id="sb-review">${reviewHTML()}</section>`
  }

  function thinkActionsHTML() {
    const empty = !has(_brief.freewrite)
    const busy = !!_aiBusy
    return `<button type="button" class="btn" id="sb-ai-review"${empty && !_brief.review.length || busy ? ' disabled' : ''}
        title="An editor reads your notes, reflects them back and asks the questions that help you work it out">✦ ${_brief.review.length ? 'Review again' : 'Review my thinking'}</button>
      <button type="button" class="btn primary" id="sb-ai-structure"${empty || busy ? ' disabled' : ''}
        title="Sort your notes into the next five steps. You see a preview first, and nothing is changed until you choose.">✦ Structure this with AI</button>
      ${_aiBusy === 'structure' ? `<span class="sb-ai-status" id="sb-ai-status">${esc(structureStatus())}</span>` : ''}
      ${_aiError ? `<div class="sb-ai-error" role="alert">${esc(_aiError)}</div>` : ''}`
  }

  function reviewHTML() {
    const thread = _brief.review
    if (!thread.length && _aiBusy !== 'review') return ''
    const msgs = thread.map((t, i) => t.role === 'assistant'
      ? `<div class="sb-review-msg ai" data-msg="${i}"><div class="sb-review-text cmd-md">${QuillChatMd.render(t.text)}</div>
          <button type="button" class="sb-review-add" data-add="${i}" title="Copies this reply, or just the part you've selected, to the end of your notes">+ Add to my thinking</button></div>`
      : t.auto
        ? `<div class="sb-review-msg auto">${esc(t.text)}</div>`
        : `<div class="sb-review-msg me">${esc(t.text)}</div>`).join('')
    const live = _aiBusy === 'review'
      ? '<div class="sb-review-msg ai live"><div class="sb-review-text cmd-md" id="sb-review-live"><span class="sb-typing">Reading your notes…</span></div></div>' : ''
    return `<div class="sb-review-head"><span class="sb-label">✦ AI review</span>
        <button type="button" class="sb-review-clear" id="sb-review-clear"${_aiBusy ? ' disabled' : ''}>Clear</button></div>
      <div class="sb-review-thread">${msgs}${live}</div>
      <div class="sb-review-reply">
        <textarea id="sb-review-input" rows="1" placeholder="Answer, push back, or ask something…">${esc(_replyDraft)}</textarea>
        <button type="button" class="btn" id="sb-review-send"${_aiBusy ? ' disabled' : ''}>Send</button>
      </div>`
  }

  // Repaints the AI parts of the Think step without touching the free-write box (and its caret).
  function paintThink() {
    if (!_ctx || _step !== 0) return
    const actions = $('sb-think-actions'), plan = $('sb-plan'), review = $('sb-review')
    if (!actions || !plan || !review) return
    actions.innerHTML = thinkActionsHTML()
    plan.innerHTML = planHTML()
    const hadFocus = document.activeElement?.id === 'sb-review-input'
    review.innerHTML = reviewHTML()
    bindThinkAI($('sb-body'))
    growTextareas(review)
    if (hadFocus) $('sb-review-input')?.focus()
  }

  function bindThink(root) {
    bindRecap(root)
    onFieldInput = el => {
      if (el.dataset.bind !== 'freewrite') return
      const actions = $('sb-think-actions')
      if (!actions) return
      actions.innerHTML = thinkActionsHTML()
      bindThinkAI(root)
    }
    bindThinkAI(root)
  }

  function bindThinkAI(root) {
    const review = $('sb-ai-review'), structure = $('sb-ai-structure')
    if (review) review.onclick = () => runReview('')
    if (structure) structure.onclick = runStructure
    const input = $('sb-review-input'), send = $('sb-review-send')
    if (input) {
      input.oninput = () => { _replyDraft = input.value }
      input.onkeydown = e => {
        if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send?.click() }
      }
    }
    if (send) send.onclick = () => {
      const text = (input?.value || '').trim()
      if (!text || _aiBusy) return
      _replyDraft = ''
      runReview(text)
    }
    const clear = $('sb-review-clear')
    if (clear) clear.onclick = () => {
      if (!confirm('Clear the AI review conversation? Your own notes stay.')) return
      _brief.review = []
      changed()
      paintThink()
    }
    root.querySelectorAll('[data-add]').forEach(btn => {
      btn.onclick = () => addToThinking(Number(btn.dataset.add), btn.closest('.sb-review-msg'))
    })
    root.querySelectorAll('[data-plan]').forEach(btn => {
      btn.onclick = () => applyPlan(btn.dataset.plan)
    })
  }

  // The selected part of a reply, or all of it, lands at the end of the notes as a quote,
  // so it's clear which words came from the review.
  function addToThinking(i, msgEl) {
    const turn = _brief.review[i]
    if (!turn) return
    const sel = window.getSelection?.()
    const picked = sel && !sel.isCollapsed && msgEl?.contains(sel.anchorNode) ? sel.toString().trim() : ''
    const text = picked || turn.text.trim()
    const quoted = text.split('\n').map(line => `> ${line}`.trimEnd()).join('\n')
    const before = _brief.freewrite.replace(/\s+$/, '')
    _brief.freewrite = before ? `${before}\n\n${quoted}\n\n` : `${quoted}\n\n`
    const box = $('sb-body').querySelector('[data-bind="freewrite"]')
    if (box) { box.value = _brief.freewrite; autosize(box) }
    changed()
    paintThink()
    box?.focus()
    box?.setSelectionRange?.(box.value.length, box.value.length)
  }

  // The novel, its people and the scene before, as reference for both AI requests.
  async function aiReference() {
    const novel = await window.quill.getNovelContext(_ctx.novelPath).catch(() => ({}))
    const info = await prevInfo()
    return SceneAI.storyReference({
      novel, chars: _chars, foundation: _story.foundation, beatSummaries: novel.beats || [],
      prev: info ? { title: info.title, synopsis: info.synopsis, beats: info.beats.map(b => b.title) } : null,
      unplaced: !!_ctx.unsorted,
    })
  }

  // ChatGPT's own messages already say what happened; anything else is a connection problem.
  const aiFailure = error => {
    if (error?.name === 'AbortError') return ''
    const message = String(error?.message || error)
    return /^ChatGPT/.test(message) ? message : `Couldn’t reach the AI: ${message}`
  }
  // How far the plan has come, counted in the KEY: lines streamed so far.
  let _structureLines = 0
  const structureStatus = () => _structureLines
    ? `Sorting your notes into a scene plan… (${_structureLines} line${_structureLines === 1 ? '' : 's'} so far)`
    : 'Sorting your notes into a scene plan…'

  async function runReview(reply) {
    if (_aiBusy) return
    const ctx = _ctx, brief = _brief
    const at = new Date().toISOString()
    brief.review.push(reply
      ? { role: 'user', text: reply, at }
      : { role: 'user', auto: true, at,
          text: brief.review.length ? 'Take another look at my notes as they are now.' : 'Here’s my thinking so far. What do you see?' })
    _aiBusy = 'review'
    _aiError = ''
    changed()
    paintThink()
    const t = SceneAI.timed(120000)
    _aiAbort = t.abort
    try {
      const reference = await aiReference()
      const text = await SceneAI.stream(SceneAI.reviewMessages({ freewrite: brief.freewrite, thread: brief.review, reference }), {
        maxTokens: 900, signal: t.signal,
        onDelta: out => { const el = $('sb-review-live'); if (el && _ctx === ctx) el.innerHTML = QuillChatMd.render(out) },
      })
      if (!text) throw new Error('The AI sent back an empty reply.')
      brief.review.push({ role: 'assistant', text, at: new Date().toISOString() })
      if (brief.review.length > REVIEW_KEEP) brief.review.splice(0, brief.review.length - REVIEW_KEEP)
      if (_ctx === ctx) changed()
    } catch (error) {
      // A reply the writer typed stays, so Send isn't lost; an automatic ask is dropped.
      const last = brief.review[brief.review.length - 1]
      if (last?.auto) brief.review.pop()
      if (_ctx === ctx) _aiError = aiFailure(error)
    } finally {
      t.done()
      if (_ctx === ctx) { _aiBusy = null; _aiAbort = null; paintThink() }
    }
  }

  const beatOptions = () => QuillStructure.beatsOf(_story.templateKey, _story.triangle)
    .map(b => ({ id: b.id, label: b.label }))

  async function runStructure() {
    if (_aiBusy || !has(_brief.freewrite)) return
    const ctx = _ctx
    _aiBusy = 'structure'
    _aiError = ''
    _plan = null
    _structureLines = 0
    paintThink()
    // Long enough for main to ask again when the iPad relay closes before ChatGPT has started.
    const t = SceneAI.timed(300000)
    _aiAbort = t.abort
    try {
      const options = beatOptions()
      // Streamed: once text is arriving, a cut connection is picked up where it stopped.
      const raw = await SceneAI.stream(SceneAI.structureMessages({
        freewrite: _brief.freewrite, thread: _brief.review, reference: await aiReference(), beatOptions: options,
      }), {
        maxTokens: 1800, signal: t.signal, effort: 'low',
        onDelta: out => {
          _structureLines = (out.match(/^\s*[A-Z][A-Z0-9_]+\s*:/gm) || []).length
          const el = $('sb-ai-status')
          if (el && _ctx === ctx) el.textContent = structureStatus()
        },
      })
      const plan = SceneAI.toPlan(SceneAI.parseKV(raw), { chars: _chars, beatIds: options.map(b => b.id) })
      if (SceneAI.isEmptyPlan(plan)) throw new Error('the reply didn’t contain a plan I could read. Try again, or add a little more to your notes.')
      if (_ctx === ctx) _plan = plan
    } catch (error) {
      if (_ctx === ctx) _aiError = aiFailure(error)
    } finally {
      t.done()
      if (_ctx === ctx) {
        _aiBusy = null
        _aiAbort = null
        paintThink()
        if (_plan) $('sb-plan')?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' })
      }
    }
  }

  // The proposed plan, step by step. A line where you already wrote something says so: Fill
  // empty fields keeps yours, Replace all uses the AI's.
  function planHTML() {
    if (!_plan) return ''
    const p = _plan.brief
    const row = (label, value, mine) => has(value) ? `<div class="sb-plan-row"><b>${esc(label)}</b> <span>${esc(value)}</span>
      ${has(mine) && String(mine).trim() !== String(value).trim() ? '<em class="sb-plan-mine" title="Fill empty fields keeps what you wrote; Replace all uses this">you wrote your own</em>' : ''}</div>` : ''
    const group = (title, rows) => rows.trim() ? `<div class="sb-plan-group"><div class="sb-plan-title">${esc(title)}</div>${rows}</div>` : ''
    const labels = Object.fromEntries(beatOptions().map(b => [b.id, b.label]))
    const mineCast = name => _brief.cast.find(c => c.name.toLowerCase() === name.toLowerCase()) || {}
    const where = row('Moves', p.progress, _brief.progress) + row('Open question', p.prev.question, _brief.prev.question)
      + row('Reader expects', p.prev.expectation, _brief.prev.expectation)
      + row('Serves', _plan.serves.map(id => labels[id] || id).join(', '), _serves.map(id => labels[id] || id).join(', '))
    const who = row('Cast', p.cast.map(c => c.name + (c.name === p.pov ? ' (POV)' : '') + (c.id ? '' : ' (new)')).join(', '), '')
      + row('Setting', p.setting, _brief.setting)
    const wants = p.cast.map(c => {
      const m = mineCast(c.name)
      return row(`${c.name} wants`, c.want, m.want) + row('In the way', c.obstacle, m.obstacle)
        + row('Does', c.tactic, m.tactic) + row('Hiding / doesn’t know', c.hidden, m.hidden)
    }).join('')
    const t = p.turn, mt = _brief.turn
    const turn = row('Shift', t.from || t.to ? `${t.from || '?'} → ${t.to || '?'}` : '', mt.from || mt.to ? `${mt.from || '?'} → ${mt.to || '?'}` : '')
      + row('Because', t.cause, mt.cause) + row('Outcome', t.outcome, mt.outcome) + row('Crisis', t.crisis, mt.crisis)
      + row('Who changes', t.changed, mt.changed) + row('Why it’s needed', t.whyNeeded, mt.whyNeeded)
    const pristine = SceneAI.beatsArePristine(_beats)
    const beats = _plan.beats.length ? `<ol class="sb-plan-beats">${_plan.beats.map(b =>
      `<li><b>${esc(b.title)}</b>${b.note ? ` ${esc(b.note)}` : ''}${b.by ? ` <span class="sb-plan-by">${esc(b.by)}</span>` : ''}</li>`).join('')}</ol>
      ${pristine ? '' : '<div class="sb-hint">You already have beats: Fill empty fields adds these after yours; Replace all swaps them in.</div>'}` : ''
    const end = row('Title', _ctx.scenePath ? '' : _plan.title, _title) + row('Synopsis', _plan.synopsis, _synopsisTouched ? _synopsis : '')
    return `<div class="sb-plan" role="region" aria-label="Proposed scene plan">
      <div class="sb-plan-head"><span class="sb-label">✦ Proposed plan</span>
        <span class="sb-hint">Nothing is changed until you choose. You can edit everything afterwards.</span></div>
      ${group('Where we are', where)}${group('Who’s here', who)}${group('Wants', wants)}
      ${group('The turn', turn)}${group('Beats', beats)}${group('Title & synopsis', end)}
      <div class="sb-plan-actions">
        <button type="button" class="btn primary" data-plan="empty">Fill empty fields</button>
        <button type="button" class="btn" data-plan="replace">Replace all</button>
        <button type="button" class="btn" data-plan="discard">Discard</button>
      </div></div>`
  }

  function applyPlan(mode) {
    if (!_plan) return
    if (mode === 'discard') { _plan = null; paintThink(); return }
    if (mode === 'replace' && hasPlan()
      && !confirm('Replace what you’ve planned with the AI’s version? Anything it left blank stays as you had it.')) return
    const next = SceneAI.merge({
      brief: _brief, serves: _serves, beats: _beats, synopsis: _synopsis, synopsisTouched: _synopsisTouched,
      title: _title, canTitle: !_ctx.scenePath,
    }, _plan, mode === 'replace' ? 'replace' : 'empty', uid)
    _brief = next.brief
    _serves = next.serves
    _beats = next.beats
    _synopsis = next.synopsis
    _synopsisTouched = next.synopsisTouched
    _title = next.title
    _plan = null
    changed()
    go(1)
  }

  // 1 — Where we are
  async function stepPrev() {
    return `<h4>Where we are</h4>
      ${_ctx.scenePath ? '' : `<label class="sb-field"><span class="sb-label">Scene title</span>
        <input id="sb-title-first" value="${esc(_title)}" placeholder="Leave blank for the next number"></label>`}
      ${await prevContext()}
      ${whereItFits()}`
  }
  // Which structure beats this scene serves, and how it moves its thread (Sanderson: progress).
  function whereItFits() {
    const tmpl = QuillStructure.template(_story.templateKey, _story.triangle)
    const threads = String(_story.foundation.threads || '').trim()
    const obligations = _caseItems.length ? `<div class="sb-case-obligations">
      <span class="sb-label">From your cases: what this scene needs to deliver</span>
      ${_caseItems.map(item => {
        const added = _beats.some(b => b.caseRef === item.ref)
        return `<div class="sb-case-obligation"><div><b>${esc(item.type)} · ${esc(item.caseName)}</b><span>${esc(item.title)}</span>
          ${item.note ? `<em>${esc(item.note)}</em>` : ''}</div>
          <button type="button" class="btn" data-case-beat="${esc(item.ref)}"${added ? ' disabled' : ''}>${added ? 'Added' : 'Add as beat'}</button></div>`
      }).join('')}</div>` : ''
    return `${obligations}
      ${field('What must move in this scene?', 'progress',
        { placeholder: threads ? `You said: ${threads}` : 'A clue found, trust gained or lost, ground covered…' })}
      <details class="sb-deepen"${_serves.length || has(_brief.prev.question) || has(_brief.prev.expectation) ? ' open' : ''}>
      <summary>Reader expectation &amp; story structure</summary>
      ${field(_ctx.prev ? 'What question did the previous scene leave open?'
        : _ctx.unsorted ? 'What question does the reader carry into this scene?' : 'What question opens the book?',
        'prev.question', { placeholder: 'The thing the reader now needs to know…' })}
      ${field('What does the reader expect next, and do you give it to them, delay it, or subvert it?',
        'prev.expectation', { rows: 3 })}
      <div class="sb-fits"><span class="sb-label">Which structure beat does this scene serve?</span>
      ${tmpl.acts.map(act => `<div class="sb-fits-act"><span>${esc(act.label)}</span>
        <div class="sb-chips">${act.beats.map(b => `<button type="button" class="sb-chip${_serves.includes(b.id) ? ' on' : ''}"
          data-serve="${esc(b.id)}">${esc(b.label)}${b.track ? ` <span>${esc(b.track)}</span>` : ''}</button>`).join('')}</div></div>`).join('')}
      <div id="sb-fits-refs">${servedRefs()}</div>
      </div></details>`
  }

  // The chosen beats' summaries, so the scene is written toward them.
  const servedRefs = () => QuillStructure.beatsOf(_story.templateKey, _story.triangle)
    .filter(b => _serves.includes(b.id) && String(_story.beats[b.id] || '').trim())
    .map(b => `<div class="sb-ref"><b>${esc(b.label)}:</b> ${esc(_story.beats[b.id])}</div>`).join('')

  function bindPrev(root) {
    onFieldInput = null
    const title = $('sb-title-first')
    if (title) title.oninput = () => { _title = title.value; changed() }
    root.querySelectorAll('[data-case-beat]').forEach(btn => {
      btn.onclick = () => {
        const item = _caseItems.find(x => x.ref === btn.dataset.caseBeat)
        if (!item || _beats.some(b => b.caseRef === item.ref)) return
        _beats.push({ id: uid(), title: item.title, note: item.note, by: '', done: false, caseRef: item.ref })
        btn.disabled = true
        btn.textContent = 'Added'
        changed()
      }
    })
    root.querySelectorAll('[data-serve]').forEach(btn => {
      btn.onclick = () => {
        const id = btn.dataset.serve
        _serves = _serves.includes(id) ? _serves.filter(x => x !== id) : [..._serves, id]
        btn.classList.toggle('on', _serves.includes(id))
        $('sb-fits-refs').innerHTML = servedRefs()
        changed()
      }
    })
    bindRecap(root)
  }

  // Escaped prose with the editor's *italic* and **bold** marks rendered.
  const proseHTML = text => esc(text)
    .replace(/\*\*(\S(?:[^*]*\S)?)\*\*/g, '<b>$1</b>')
    .replace(/\*(\S(?:[^*]*\S)?)\*/g, '<em>$1</em>')

  // 2 — Who's here
  function stepCast() {
    const inCast = name => _brief.cast.some(c => c.name === name)
    const chips = _chars.length
      ? _chars.map(c => `<button type="button" class="sb-chip${inCast(c.name) ? ' on' : ''}" data-char="${esc(c.id || c.name)}">
          ${c.id && _charImages[c.id] ? `<span class="sb-avatar"><img src="../__vfs${esc(_charImages[c.id])}" alt="" data-photo-for="${esc(c.id)}"></span>` : ''}${esc(c.name)}${c.role ? `<span>${esc(c.role)}</span>` : ''}</button>`).join('')
      : '<div class="sb-hint">No characters on this novel yet. Add minor or unnamed people below, or fill in the Characters tab.</div>'
    const extras = _brief.cast.filter(c => !c.id).map(c =>
      `<span class="sb-chip on sb-extra">${esc(c.name)}<button type="button" class="sb-extra-del" data-name="${esc(c.name)}" title="Remove">×</button></span>`).join('')
    const povOptions = ['', ..._brief.cast.map(c => c.name)].map(n =>
      `<option value="${esc(n)}"${n === _brief.pov ? ' selected' : ''}>${n ? esc(n) : '—'}</option>`).join('')
    return `<h4>Who’s here</h4>
      <p class="sb-hint">Everyone who matters in this scene. Leave out anyone who doesn’t want something here.</p>
      <div class="sb-chips">${chips}</div>
      <div class="sb-chips">${extras}</div>
      <div class="sb-inline">
        <input id="sb-extra-name" placeholder="Someone else (the landlord, a guard…)">
        <button type="button" class="btn" id="sb-extra-add">Add</button>
      </div>
      <div class="sb-two">
        <label class="sb-field"><span class="sb-label">Point of view</span>
          <select id="sb-pov">${povOptions}</select></label>
        <label class="sb-field"><span class="sb-label">Setting</span>
          <input data-bind="setting" placeholder="Where and when"></label>
      </div>`
  }
  function bindCast(root) {
    onFieldInput = null
    root.querySelectorAll('.sb-chip[data-char]').forEach(chip => {
      chip.onclick = () => {
        const ch = _chars.find(c => (c.id || c.name) === chip.dataset.char)
        if (!ch) return
        const idx = _brief.cast.findIndex(c => c.name === ch.name)
        if (idx >= 0) {
          _brief.cast.splice(idx, 1)
          if (_brief.pov === ch.name) _brief.pov = ''
        } else {
          _brief.cast.push({ id: ch.id || ch.name, name: ch.name, want: '', obstacle: '', tactic: '', hidden: '' })
        }
        changed()
        render()
      }
    })
    root.querySelectorAll('.sb-extra-del').forEach(btn => {
      btn.onclick = () => {
        _brief.cast = _brief.cast.filter(c => c.id || c.name !== btn.dataset.name)  // named characters stay
        if (_brief.pov === btn.dataset.name) _brief.pov = ''
        changed()
        render()
      }
    })
    const addExtra = () => {
      const name = $('sb-extra-name').value.trim()
      if (!name || _brief.cast.some(c => c.name === name)) return
      _brief.cast.push({ id: null, name, want: '', obstacle: '', tactic: '', hidden: '' })
      changed()
      render()
    }
    $('sb-extra-add').onclick = addExtra
    $('sb-extra-name').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); addExtra() } }
    $('sb-pov').onchange = e => { _brief.pov = e.target.value; changed() }
  }

  // 3 — Wants
  function stepWants() {
    if (!_brief.cast.length) {
      return `<h4>Wants</h4><div class="sb-hint">Pick who’s in the scene first (step 2).</div>`
    }
    const sheet = name => _chars.find(c => c.name === name) || {}
    return `<h4>Wants</h4>
      <p class="sb-hint">What each person is after <em>in this scene</em>, not across the whole book.</p>
      ${_brief.cast.map((c, i) => {
        const s = sheet(c.name)
        const ref = [['Want', s.want], ['Need', s.need], ['Fear', s.fear]].filter(([, v]) => v)
        return `<div class="sb-card">
          <div class="sb-card-head">${esc(c.name)}${c.name === _brief.pov ? '<span class="sb-pov-tag">POV</span>' : ''}</div>
          ${ref.length ? `<div class="sb-ref">${ref.map(([k, v]) => `<div><b>${k}:</b> ${esc(v)}</div>`).join('')}</div>` : ''}
          ${field('Wants in this scene', `cast.${i}.want`, { rows: 1 })}
          ${field('What’s in the way', `cast.${i}.obstacle`, { rows: 1 })}
          <details class="sb-deepen sb-deepen-card"${has(c.tactic) || has(c.hidden) ? ' open' : ''}><summary>Deepen ${esc(c.name)}</summary>
            ${field('What they do to get it', `cast.${i}.tactic`, { rows: 1 })}
            ${field('What they’re hiding, or don’t know', `cast.${i}.hidden`, { rows: 1 })}</details>
        </div>`
      }).join('')}`
  }
  function bindWants() { onFieldInput = null }

  // 4 — The turn
  function turnWarnings() {
    const warn = []
    const from = _brief.turn.from.trim().toLowerCase()
    const to = _brief.turn.to.trim().toLowerCase()
    if (from && to && from === to) warn.push('The value starts and ends the same, so nothing turns yet.')
    if (_brief.cast.length && !_brief.cast.some(c => c.want.trim() && c.obstacle.trim())) {
      warn.push('Nobody’s want meets an obstacle yet (step 3). Without friction the scene just reports what happens.')
    }
    return warn
  }
  function stepTurn() {
    return `<h4>The turn</h4>
      <p class="sb-hint">A scene earns its place by changing something. Name the value that shifts.</p>
      <div class="sb-two sb-arrow">
        <label class="sb-field"><span class="sb-label">At the start</span>
          <input data-bind="turn.from" placeholder="safe, trusting, hopeful…"></label>
        <span class="sb-arrow-sign">→</span>
        <label class="sb-field"><span class="sb-label">At the end</span>
          <input data-bind="turn.to" placeholder="hunted, suspicious, resigned…"></label>
      </div>
      ${field('What causes the change?', 'turn.cause')}
      <div class="sb-field"><span class="sb-label">Does the POV character get what they wanted?</span>
        <div class="sb-chips">${OUTCOMES.map(o => `<button type="button" class="sb-chip${_brief.turn.outcome === o ? ' on' : ''}"
          data-outcome="${esc(o)}">${esc(o)}</button>`).join('')}</div>
        <span class="sb-hint">A “Yes” lets tension out; “No, and…” piles it on. Too many yeses in a row flatten a book. (Dwight Swain’s scene outcomes)</span></div>
      ${field('What choice does the POV character face, and what do they pick? The best of two bad options, or two good things they can’t both have?', 'turn.crisis')}
      <details class="sb-deepen"${has(_brief.turn.changed) || has(_brief.turn.whyNeeded) || has(_brief.turn.arc) ? ' open' : ''}><summary>Deepen the turn</summary>
      ${field('Who leaves the scene different, and how?', 'turn.changed')}
      ${field('If this scene were cut, what would the reader lose?', 'turn.whyNeeded')}
      ${String(_story.foundation.lie || '').trim() ? `
        <div class="sb-ref"><b>The lie you named:</b> ${esc(_story.foundation.lie)}</div>
        ${field('Does the POV character act on that lie here, or on what they need?', 'turn.arc')}` : ''}</details>
      <div id="sb-warn" class="sb-warn"></div>`
  }
  function bindTurn(root) {
    root.querySelectorAll('[data-outcome]').forEach(btn => {
      btn.onclick = () => {
        _brief.turn.outcome = _brief.turn.outcome === btn.dataset.outcome ? '' : btn.dataset.outcome
        changed()
        root.querySelectorAll('[data-outcome]').forEach(b => b.classList.toggle('on', b.dataset.outcome === _brief.turn.outcome))
      }
    })
    const paint = () => {
      const warn = turnWarnings()
      $('sb-warn').innerHTML = warn.map(w => `<div>⚠ ${esc(w)}</div>`).join('')
    }
    onFieldInput = paint
    paint()
  }

  // 5 — Beats + title
  function suggestedSynopsis() {
    const pov = _brief.cast.find(c => c.name === _brief.pov) || _brief.cast[0]
    const parts = []
    if (pov?.want) parts.push(`${pov.name} wants ${pov.want}${pov.obstacle ? `, but ${pov.obstacle}` : ''}.`)
    if (_brief.turn.to) parts.push(`Ends: ${_brief.turn.to}.`)
    return parts.join(' ')
  }
  function stepBeats() {
    // The Turn and New state beats pick up step 4 until you write something of your own there.
    const turn = _beats.find(b => b.title === 'Turn')
    if (turn && !turn.note && _brief.turn.cause) turn.note = _brief.turn.cause
    const after = _beats.find(b => b.title === 'New state')
    if (after && !after.note && _brief.turn.to) after.note = _brief.turn.to
    if (!_synopsisTouched) _synopsis = suggestedSynopsis()

    const who = ['', ..._brief.cast.map(c => c.name)]
    return `<h4>Beats</h4>
      <div class="sb-beats">${_beats.map((b, i) => `
        <div class="sb-beat" data-idx="${i}">
          <span class="sb-beat-num" title="Drag to reorder">${i + 1}</span>
          <div class="sb-beat-fields">
            <input class="sb-beat-title" data-idx="${i}" value="${esc(b.title)}" placeholder="What happens">
            <textarea class="sb-beat-note" data-idx="${i}" rows="1" placeholder="How it plays: action, reaction, what it costs">${esc(b.note)}</textarea>
          </div>
          <select class="sb-beat-by" data-idx="${i}" title="Driven by">
            ${who.map(n => `<option value="${esc(n)}"${n === b.by ? ' selected' : ''}>${n ? esc(n) : 'driven by…'}</option>`).join('')}
          </select>
          <div class="sb-beat-moves">
            <button type="button" data-move="-1" data-idx="${i}" title="Move up"${i === 0 ? ' disabled' : ''}>↑</button>
            <button type="button" data-move="1" data-idx="${i}" title="Move down"${i === _beats.length - 1 ? ' disabled' : ''}>↓</button>
            <button type="button" data-del="${i}" title="Remove beat">×</button>
          </div>
        </div>`).join('')}
      </div>
      <button type="button" class="outliner-add sb-add-beat" id="sb-add-beat">+ Beat</button>
      ${_ctx.scenePath ? '' : `<div class="sb-two sb-final">
        <label class="sb-field"><span class="sb-label">Scene title</span>
          <input id="sb-title" placeholder="Leave blank for the next number"></label>
      </div>`}
      <label class="sb-field"><span class="sb-label">Synopsis</span>
        <textarea id="sb-synopsis" rows="2"></textarea></label>`
  }
  function bindBeats(root) {
    onFieldInput = null
    // Same drag as the beats strip: grab the number to reorder; ↑/↓ stay for the keyboard.
    Dnd.sortable(root.querySelector('.sb-beats'), {
      items: '.sb-beat', type: 'sb-beat', handle: '.sb-beat-num',
      onMove: (from, to) => { Dnd.move(_beats, from, to); changed(); render() },
    })
    root.querySelectorAll('.sb-beat-title').forEach(el => {
      el.oninput = () => { _beats[Number(el.dataset.idx)].title = el.value; changed() }
    })
    root.querySelectorAll('.sb-beat-note').forEach(el => {
      el.oninput = () => { _beats[Number(el.dataset.idx)].note = el.value; changed() }
    })
    root.querySelectorAll('.sb-beat-by').forEach(el => {
      el.onchange = () => { _beats[Number(el.dataset.idx)].by = el.value; changed() }
    })
    root.querySelectorAll('[data-move]').forEach(btn => {
      btn.onclick = () => {
        const i = Number(btn.dataset.idx)
        const j = i + Number(btn.dataset.move)
        ;[_beats[i], _beats[j]] = [_beats[j], _beats[i]]
        changed()
        render()
      }
    })
    root.querySelectorAll('[data-del]').forEach(btn => {
      btn.onclick = () => { _beats.splice(Number(btn.dataset.del), 1); changed(); render() }
    })
    $('sb-add-beat').onclick = () => {
      _beats.push({ id: uid(), title: '', note: '', by: '', done: false })
      changed()
      render().then(() => $('sb-body').querySelector(`.sb-beat-title[data-idx="${_beats.length - 1}"]`)?.focus())
    }
    const title = $('sb-title')
    if (title) {
      title.value = _title
      title.oninput = () => { _title = title.value; changed() }
    }
    const synopsis = $('sb-synopsis')
    synopsis.value = _synopsis
    synopsis.oninput = () => { _synopsis = synopsis.value; _synopsisTouched = true; changed() }
  }

  // ── The brief block in the scene's notes ────────────────────
  function briefHTML() {
    const b = _brief
    const line = (label, value) => value ? `<div><b>${esc(label)}:</b> ${esc(value)}</div>` : ''
    const cast = b.cast.map(c => `<li><b>${esc(c.name)}</b>${c.name === b.pov ? ' (POV)' : ''}
      ${line('Wants', c.want)}${line('In the way', c.obstacle)}${line('Does', c.tactic)}${line('Hiding / doesn’t know', c.hidden)}</li>`).join('')
    const shift = b.turn.from || b.turn.to ? `${b.turn.from || '?'} → ${b.turn.to || '?'}` : ''
    const serves = QuillStructure.beatsOf(_story.templateKey, true).filter(beat => _serves.includes(beat.id)).map(beat => beat.label).join(', ')
    return `<section data-scene-brief><h3>Scene brief</h3>
      ${line('Serves', serves)}${line('Moves', b.progress)}
      ${line('Open question', b.prev.question)}${line('Reader expects', b.prev.expectation)}${line('Setting', b.setting)}
      ${cast ? `<ul>${cast}</ul>` : ''}
      ${line('Turn', shift)}${line('Because', b.turn.cause)}${line('Who changes', b.turn.changed)}${line('Why it’s needed', b.turn.whyNeeded)}
      ${line('Outcome', b.turn.outcome)}${line('Crisis', b.turn.crisis)}${line('Lie or need', b.turn.arc)}
      </section>`.replace(/\n\s*/g, '')
  }

  async function writeBriefIntoNotes(rel) {
    const notes = await window.quill.getNotes(rel)
    const rest = String(notes.content || '').replace(BRIEF_RE, '')
    checked(await window.quill.saveNotes({ rel, content: briefHTML() + rest }), 'Could not save the scene brief in Notes.')
  }

  // ── Finish ──────────────────────────────────────────────────
  async function finish() {
    const btn = $('sb-finish')
    btn.disabled = true
    try {
      clearTimeout(_timer)
      if (_saving && !(await _saving)) return
      let rel = _ctx.scenePath
      const createdFromDraft = !rel
      if (!rel) {
        const created = await _ctx.createScene(_title.trim())
        if (!created?.path) { alert('Could not create the scene.'); return }
        rel = created.path
        _ctx.scenePath = rel
      }
      await persist(rel, { finished: true })
      if (createdFromDraft) checked(await window.quill.deleteScenePlanDraft({
        novelRel: _ctx.novelPath, chapterRel: _ctx.chapterPath,
      }), 'Could not clear the saved scene plan.')
      _dirty = false
      await close({ force: true })
      await Tree.refresh()
      await App.openFile(rel)
      App.toggleOutline?.(true)
      Editor.toggleInspector?.(true)
    } catch (error) {
      showSaveStatus(`Couldn’t save (${error.message}). Try again.`)
    } finally {
      btn.disabled = false
    }
  }

  function init() {
    $('sb-close').onclick = () => close()
    $('sb-back').onclick = () => go(_step - 1)
    $('sb-next').onclick = () => go(_step + 1)
    $('sb-finish').onclick = finish
    // Rotating the iPad rewraps every line.
    window.addEventListener('resize', () => { if (_ctx) $('sb-body').querySelectorAll('textarea').forEach(autosize) })
    $('scene-builder-modal').addEventListener('keydown', e => {
      if (e.key === 'Escape') { e.stopPropagation(); close() }
      if (e.key === 'Tab') trapFocus(e, $('scene-builder-modal'))
    })
  }

  function trapFocus(e, root) {
    const focusable = [...root.querySelectorAll('button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),summary,[tabindex]:not([tabindex="-1"])')]
      .filter(el => el.offsetParent !== null)
    if (!focusable.length) return
    const first = focusable[0], last = focusable[focusable.length - 1]
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
  }

  document.addEventListener('DOMContentLoaded', init)
  return { open, close, isOpen: () => !!_ctx }
})()
