/* structurebuilder.js — a worksheet for the novel's structure. The foundation questions (the
 * ending, the arcs, the opposition, the promises) come one at a time by default, with that
 * group's earlier answers shown above; "All on one page" shows each group whole, for rereading.
 * Then one step per beat of the novel's template, each with a few questions and a line for the
 * beat in the writer's own words.
 * Answers live in <novel>/.structure.json; the beat line goes back to landing, which keeps
 * .quill_meta's `beats` map. Text written before the builder existed shows as an earlier
 * draft; the first time the writer types over it, the original is kept in `drafts` so it stays
 * beside the summary. No AI: the questions do the work. */

const StructureBuilder = (() => {
  let _ctx = null        // { novelPath, title, templateKey, beats, structure, scenesByBeat, onBeat, onClose }
  let _structure = null
  let _beats = {}
  let _steps = []        // { kind:'question', q, step } | { kind:'foundation', step } | { kind:'beat', beat, act }
  let _focus = true      // foundation one question at a time
  let _digest = null     // QuillCase.caseDigest of the novel's cases, when Mystery is on
  let _i = 0
  let _dirty = false
  let _timer = null

  const esc = s => escapeHtml(s)
  const $ = id => document.getElementById(id)
  const S = () => QuillStructure
  const tri = () => _structure?.triangle === true
  const FOCUS_KEY = 'quill_structure_focus'
  const readFocus = () => { try { return localStorage.getItem(FOCUS_KEY) !== 'off' } catch { return true } }
  const saveFocus = on => { try { localStorage.setItem(FOCUS_KEY, on ? 'on' : 'off') } catch {} }

  function buildSteps() {
    const foundation = _focus
      ? S().foundationSteps(_structure).flatMap(step => S().FOUNDATION.filter(f => f.step === step.id).map(q => ({ kind: 'question', q, step })))
      : S().foundationSteps(_structure).map(step => ({ kind: 'foundation', step }))
    const tmpl = S().template(_ctx.templateKey, tri())
    return [...foundation, ...tmpl.acts.flatMap(act => act.beats.map(beat => ({ kind: 'beat', beat, act })))]
  }

  function open(ctx) {
    _ctx = ctx
    const blank = S().blankStructure()
    const given = ctx.structure || {}
    _structure = {
      ...blank, ...given,
      foundation: { ...(given.foundation || {}) },
      answers: Object.fromEntries(Object.entries(given.answers || {}).map(([id, a]) => [id, { ...a }])),
      mine: { ...(given.mine || {}) },
      drafts: { ...(given.drafts || {}) },
    }
    _beats = { ...(ctx.beats || {}) }
    const tmpl = S().template(ctx.templateKey, tri())
    _focus = readFocus()
    _steps = buildSteps()
    const at = ctx.startAt ? _steps.findIndex(s => s.kind === 'beat' && s.beat.id === ctx.startAt) : 0
    _i = Math.max(0, at)
    _dirty = false
    $('stb-heading').textContent = `Structure: ${ctx.title || 'Untitled'} · ${tmpl.label}`
    $('structure-builder-modal').classList.add('show')
    render()
    loadDigest(ctx.novelPath)
  }

  // The Case Builder's cases, summarized for the case questions. Loaded after the first render.
  async function loadDigest(novelPath) {
    _digest = null
    if (!_structure.mystery) return
    _digest = await caseDigestFor(novelPath)
    if (_ctx?.novelPath === novelPath) render()
  }

  async function close() {
    if (!_ctx) return
    await flush()
    $('structure-builder-modal').classList.remove('show')
    const ctx = _ctx
    _ctx = null
    ctx.onClose?.(_structure)
  }

  // ── Saving ──────────────────────────────────────────────────
  function changed() {
    _dirty = true
    clearTimeout(_timer)
    _timer = setTimeout(flush, 600)
  }

  async function flush() {
    clearTimeout(_timer)
    _timer = null
    if (!_ctx || !_dirty) return
    _dirty = false
    const result = await window.quill.saveStructure({ novelRel: _ctx.novelPath, structure: _structure })
      .catch(error => ({ ok: false, error: error.message }))
    // Say so where the writer is looking, and keep trying; nothing typed is dropped meanwhile.
    const status = $('stb-save-status')
    if (!result?.ok) {
      _dirty = true
      if (status) status.textContent = `Couldn’t save the structure${result?.error ? ` (${result.error})` : ''}. Trying again…`
      if (!_timer) _timer = setTimeout(flush, 3000)
    } else if (status) status.textContent = ''
  }

  // ── Rendering ───────────────────────────────────────────────
  const state = id => S().beatState(id, _beats, _structure)

  function render() {
    renderRail()
    const step = _steps[_i]
    const body = $('stb-body')
    body.innerHTML = step.kind === 'question' ? questionStep(step)
      : step.kind === 'foundation' ? foundationStep(step.step) : beatStep(step)
    body.scrollTop = 0
    bind(body, step)
    if (step.kind === 'question') body.querySelector('textarea')?.focus()
    const toggle = $('stb-mode')
    toggle.style.display = step.kind === 'beat' ? 'none' : ''
    toggle.textContent = _focus ? 'All on one page' : 'One at a time'
    $('stb-back').disabled = _i === 0
    $('stb-next').style.display = _i === _steps.length - 1 ? 'none' : ''
    $('stb-done').textContent = _i === _steps.length - 1 ? 'Done' : 'Save & close'
  }

  function renderRail() {
    let lastGroup = ''
    const html = _steps.map((step, i) => {
      const group = step.kind === 'question' ? step.step.label : step.kind === 'foundation' ? 'Foundation' : step.act.label
      const head = group !== lastGroup ? `<div class="stb-rail-group">${esc(group)}</div>` : ''
      lastGroup = group
      const active = i === _i ? ' active' : ''
      if (step.kind === 'question') {
        const answered = String(_structure.foundation[step.q.id] || '').trim()
        return `${head}<button type="button" class="sb-rail-step${active}" data-i="${i}" data-q="${esc(step.q.id)}">
          <i class="beat-dot" data-state="${answered ? 'mine' : 'empty'}"></i><span class="stb-rail-label">${esc(step.q.short)}</span></button>`
      }
      if (step.kind === 'foundation') {
        const answered = S().FOUNDATION.filter(f => f.step === step.step.id && String(_structure.foundation[f.id] || '').trim()).length
        const total = S().FOUNDATION.filter(f => f.step === step.step.id).length
        return `${head}<button type="button" class="sb-rail-step${active}" data-i="${i}">
          <i class="beat-dot" data-state="${answered === total ? 'mine' : answered ? 'draft' : 'empty'}"></i>${esc(step.step.label)}</button>`
      }
      const track = step.beat.track ? `<span class="stb-track" data-track="${step.beat.track}">${step.beat.track}</span>` : ''
      return `${head}<button type="button" class="sb-rail-step${active}" data-i="${i}" data-beat="${esc(step.beat.id)}">
        <i class="beat-dot" data-state="${state(step.beat.id)}"></i><span class="stb-rail-label">${esc(step.beat.label)}</span>${track}</button>`
    }).join('')
    const rail = $('stb-rail')
    rail.innerHTML = html
    rail.querySelectorAll('.sb-rail-step').forEach(btn => { btn.onclick = () => go(Number(btn.dataset.i)) })
    rail.querySelector('.sb-rail-step.active')?.scrollIntoView({ block: 'nearest' })
  }

  const area = (attrs, value, rows = 2) =>
    `<textarea rows="${rows}" ${attrs}>${esc(value || '')}</textarea>`

  // The Case Builder's detail for a case question, read-only. Empty unless Mystery is on.
  function fromCases(id, label = 'From your cases') {
    const lines = _structure.mystery && _digest ? _digest[id] || [] : []
    return lines.length ? `<div class="stb-cases"><span class="sb-label">${esc(label)}</span>
      ${lines.map(line => `<div>${esc(line)}</div>`).join('')}</div>` : ''
  }
  const intro = step => `<p class="stb-intro">${esc(step.intro)}${step.source ? ` <span class="stb-source">${esc(step.source)}</span>` : ''}</p>
    ${step.id === 'case' ? '<button type="button" class="stb-open-case" id="stb-open-case">Open Case Builder →</button>' : ''}`

  function foundationStep(step) {
    const questions = S().FOUNDATION.filter(f => f.step === step.id)
    return `<h4>${esc(step.label)}</h4>
      ${intro(step)}
      ${questions.map(f => `<label class="sb-field"><span class="stb-q">${esc(f.q)}</span>
        ${f.hint ? `<span class="stb-hint">${esc(f.hint)}</span>` : ''}
        ${area(`data-foundation="${esc(f.id)}"`, _structure.foundation[f.id], 3)}</label>${fromCases(f.id)}`).join('')}`
  }

  // One foundation question, with what this group already has above it.
  function questionStep({ q, step }) {
    const group = S().FOUNDATION.filter(f => f.step === step.id)
    const n = group.indexOf(q)
    const earlier = group.slice(0, n).filter(f => String(_structure.foundation[f.id] || '').trim())
    return `<div class="stb-kicker">${esc(step.label)} · ${n + 1} of ${group.length}</div>
      ${n === 0 ? intro(step) : ''}
      ${earlier.length ? `<div class="stb-recall"><span class="sb-label">So far</span>
        ${earlier.map(f => `<div><b>${esc(f.short)}:</b> ${esc(_structure.foundation[f.id])}</div>`).join('')}</div>` : ''}
      <h4 class="stb-question">${esc(q.q)}</h4>
      ${q.hint ? `<p class="stb-hint">${esc(q.hint)}</p>` : ''}
      ${area(`data-foundation="${esc(q.id)}"`, _structure.foundation[q.id], 5)}
      ${fromCases(q.id)}
      <div class="stb-focus-foot">
        <button type="button" class="stb-skip" id="stb-skip">Skip for now</button>
        <span class="stb-keys">⌘↵ next</span>
      </div>`
  }

  function beatStep({ beat, act }) {
    const spec = S().questionsFor(beat.id, _structure)
    const answers = _structure.answers[beat.id] || {}
    const recall = (spec.recall || [])
      .map(id => S().FOUNDATION.find(f => f.id === id))
      .filter(f => f && String(_structure.foundation[f.id] || '').trim())
    const scenes = _ctx.scenesByBeat?.[beat.id] || []
    const draft = earlierDraft(beat.id)
    const track = beat.track ? ` <span class="stb-track" data-track="${beat.track}">${beat.track}</span>` : ''
    return `<div class="stb-kicker">${esc(act.label)}</div>
      <h4>${esc(beat.label)}${track}</h4>
      <p class="stb-intro">${esc(beat.hint)}</p>
      ${recall.length ? `<div class="stb-recall"><span class="sb-label">You said</span>
        ${recall.map(f => `<div><b>${esc(f.q)}</b> ${esc(_structure.foundation[f.id])}</div>`).join('')}</div>` : ''}
      ${spec.cases ? fromCases(spec.cases, `From your cases: ${S().FOUNDATION.find(f => f.id === spec.cases)?.short || ''}`) : ''}
      ${spec.questions.map(({ key, text }) => `<label class="sb-field"><span class="stb-q">${esc(text)}</span>
        ${area(`data-answer="${esc(key)}"`, answers[key])}</label>`).join('')}
      ${scenes.length ? `<div class="stb-scenes"><span class="sb-label">Scenes serving this beat</span>
        ${scenes.map(sc => `<button type="button" class="stb-scene" data-path="${esc(sc.path)}"><b>${esc(sc.title)}</b>${sc.synopsis ? ` — ${esc(sc.synopsis)}` : ''}</button>`).join('')}</div>` : ''}
      ${draft ? `<div class="stb-draft"><span class="sb-label">Earlier draft</span>
        <div class="stb-draft-text">${esc(draft)}</div>
        <button type="button" class="stb-draft-use" id="stb-draft-use">Use as starting point</button></div>` : ''}
      <label class="sb-field stb-summary"><span class="stb-q">Your beat, in a sentence or two</span>
        ${area('data-summary', state(beat.id) === 'mine' ? _beats[beat.id] : '', 3)}</label>`
  }

  // The text a beat had before the writer rewrote it in the builder, if it had any.
  // Falls back to the old template's text (still in .quill_meta under its old id) for beats
  // rewritten before drafts were kept.
  function earlierDraft(id) {
    if (state(id) === 'draft') return String(_beats[id])
    if (_structure.drafts[id]) return String(_structure.drafts[id])
    const old = Object.entries(S().MIGRATIONS).find(([from, to]) => to === id && String(_beats[from] || '').trim())
    return old && String(_beats[old[0]]).trim() !== String(_beats[id] || '').trim() ? String(_beats[old[0]]) : ''
  }

  function autosize(el) { el.style.height = 'auto'; el.style.height = el.scrollHeight + 2 + 'px' }

  function bind(root, step) {
    root.querySelectorAll('textarea').forEach(el => {
      requestAnimationFrame(() => autosize(el))
      el.addEventListener('input', () => autosize(el))
    })
    root.querySelectorAll('[data-foundation]').forEach(el => {
      el.addEventListener('input', () => { _structure.foundation[el.dataset.foundation] = el.value; changed(); renderRail() })
    })
    const openCase = root.querySelector('#stb-open-case')
    if (openCase) openCase.onclick = async () => { await close(); Landing.activateNovelTab('case') }
    const skip = root.querySelector('#stb-skip')
    if (skip) skip.onclick = () => go(_i + 1)
    if (step.kind !== 'beat') return
    const id = step.beat.id
    root.querySelectorAll('[data-answer]').forEach(el => {
      el.addEventListener('input', () => {
        _structure.answers[id] = { ...(_structure.answers[id] || {}), [el.dataset.answer]: el.value }
        changed()
      })
    })
    const summary = root.querySelector('[data-summary]')
    summary.addEventListener('input', () => {
      // Keep the pre-builder text before it's overwritten, so it can still be used later.
      if (state(id) === 'draft' && !_structure.drafts[id]) _structure.drafts[id] = _beats[id]
      _beats[id] = summary.value
      _structure.mine[id] = true
      _ctx.onBeat?.(id, summary.value)
      changed()
      renderRail()
    })
    const use = root.querySelector('#stb-draft-use')
    if (use) use.onclick = () => {
      const draft = earlierDraft(id)
      const typed = summary.value.trim()
      if (typed && typed !== draft.trim() && !confirm('Replace what you’ve written with the earlier draft?')) return
      summary.value = draft
      autosize(summary)
      summary.dispatchEvent(new Event('input'))
      summary.focus()
    }
    root.querySelectorAll('.stb-scene').forEach(btn => {
      btn.onclick = async () => {
        await close()
        App.openFile(btn.dataset.path)
      }
    })
  }

  // Switch between one question at a time and whole groups, staying on the same question.
  function toggleFocus() {
    const here = _steps[_i]
    _focus = !_focus
    saveFocus(_focus)
    _steps = buildSteps()
    const qid = here.kind === 'question' ? here.q.id
      : here.kind === 'foundation' ? S().FOUNDATION.find(f => f.step === here.step.id)?.id : null
    _i = here.kind === 'beat'
      ? _steps.findIndex(s => s.kind === 'beat' && s.beat.id === here.beat.id)
      : Math.max(0, _steps.findIndex(s => (s.kind === 'question' && s.q.id === qid) ||
          (s.kind === 'foundation' && S().FOUNDATION.some(f => f.id === qid && f.step === s.step.id))))
    render()
  }

  function go(i) {
    if (i < 0 || i >= _steps.length) return
    _i = i
    render()
  }

  function init() {
    $('stb-close').onclick = () => close()
    $('stb-back').onclick = () => go(_i - 1)
    $('stb-next').onclick = () => go(_i + 1)
    $('stb-done').onclick = () => close()
    $('stb-mode').onclick = () => toggleFocus()
    $('structure-builder-modal').addEventListener('keydown', e => {
      if (e.key === 'Escape') { e.stopPropagation(); close() }
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); go(_i + 1) }
    })
  }

  document.addEventListener('DOMContentLoaded', init)
  return { open, close, flush, isOpen: () => !!_ctx }
})()
