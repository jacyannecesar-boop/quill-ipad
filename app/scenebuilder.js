/* scenebuilder.js — a worksheet for the scene you haven't written yet. Five steps (where the
 * story stands, who's here, what each of them wants, what turns, the beats) end in a scene
 * file with a brief at the top of its notes and the beats in the beat strip.
 * Answers live in <scene>.brief.json; beats live in <scene>.outline.json like any other scene's,
 * so the beat strip and the builder always show the same list. No AI: the questions do the work. */

const SceneBuilder = (() => {
  const STEPS = ['Where we are', 'Who’s here', 'Wants', 'The turn', 'Beats']
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

    $('sb-heading').textContent = ctx.scenePath ? `Build “${_title || 'Untitled'}”` : 'Build the next scene'
    $('sb-finish').textContent = ctx.scenePath ? 'Save & open scene' : 'Create & open scene'
    $('scene-builder-modal').classList.add('show')
    await render()
    $('sb-body').querySelector('input,textarea,select,button,summary')?.focus()
  }

  async function close({ force = false } = {}) {
    if (!_ctx) return
    if (!force && !(await flush())) return
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
      [has(_brief.progress) || has(_brief.prev.question) || _serves.length || _caseItems.length,
        has(_brief.progress) && (has(_brief.prev.question) || _serves.length || _caseItems.length)],
      [_brief.cast.length || has(_brief.setting), _brief.cast.length > 0 && has(_brief.pov) && has(_brief.setting)],
      [_brief.cast.some(c => has(c.want) || has(c.obstacle)), _brief.cast.length > 0 && _brief.cast.every(c => has(c.want) && has(c.obstacle))],
      [has(_brief.turn.from) || has(_brief.turn.to) || has(_brief.turn.cause), has(_brief.turn.from) && has(_brief.turn.to) && has(_brief.turn.cause)],
      [_beats.some(b => has(b.title) || has(b.note)), _beats.some(b => has(b.title) && has(b.note)) && (_ctx?.scenePath || has(_title))],
    ][i]
    return tests[1] ? 'complete' : tests[0] ? 'partial' : 'empty'
  }

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
    const html = await [stepPrev, stepCast, stepWants, stepTurn, stepBeats][step]()
    if (seq !== _renderSeq || step !== _step) return
    body.innerHTML = html
    body.scrollTop = 0
    bindFields(body)
    body.querySelectorAll('img[data-photo-for]').forEach(img =>
      QuillPhoto.apply(img, _chars.find(c => c.id === img.dataset.photoFor)?.photo))
    ;[bindPrev, bindCast, bindWants, bindTurn, bindBeats][step](body)
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

  // 1 — Where we are
  async function stepPrev() {
    const prev = _ctx.prev
    let recap = '<div class="sb-prev sb-prev-none">Opening scene: there’s nothing before this one.</div>'
    if (prev) {
      const [file, outline] = await Promise.all([
        window.quill.getFile(prev.path).catch(() => ({ body: '' })),
        window.quill.getOutline(prev.path).catch(() => ({ beats: [] })),
      ])
      // Scenes save one paragraph per line, so any line break starts a new paragraph.
      const paras = String(file.body || '').split(/\n+/).map(p => p.trim())
        .filter(p => p && !/^(\*\s*){3}$/.test(p))
      const beats = (outline.beats || []).filter(b => b.title)
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
    return `<h4>Where we are</h4>
      ${_ctx.scenePath ? '' : `<label class="sb-field"><span class="sb-label">Scene title</span>
        <input id="sb-title-first" value="${esc(_title)}" placeholder="Leave blank for the next number"></label>`}
      <details class="sb-deepen sb-context"><summary>${prevLabel}</summary>${recap}</details>
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
      ${field(_ctx.prev ? 'What question did the previous scene leave open?' : 'What question opens the book?',
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
    const toggle = $('sb-prev-toggle')
    if (!toggle) return
    toggle.onclick = () => {
      const tail = root.querySelector('.sb-prev-tail')
      const full = tail.classList.toggle('full')
      toggle.textContent = full ? 'Show last 3 paragraphs' : 'Show whole scene'
      if (!full) tail.scrollTop = 0
    }
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
      const fit = () => { el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px' }
      setTimeout(fit, 0)
      el.oninput = () => { fit(); _beats[Number(el.dataset.idx)].note = el.value; changed() }
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
