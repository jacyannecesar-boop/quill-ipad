/* casebuilder.js — the Case tab and the Case Builder.
 *
 * The tab is a read-only case workspace: an overview plus focused views for what happened, the
 * evidence, investigation, suspects and reveal. Writing happens in the Case Builder, a modal in
 * the Structure Builder's frame that walks one item per screen (or a whole
 * group on one page): name the case, write what really happened step by step from the culprit's
 * side, turn steps into clues (kind, job, how it's found, which scene), follow the investigation
 * stop by stop, name the suspects, list the world rules the solution depends on, then check the
 * reveal order for fair play. Clicking anything in the case file opens the builder there.
 *
 * Lists, fair play, the Markdown copy and the Structure digest live in case.js (QuillCase); cases
 * live in <novel>/.cases.json. No AI: the steps do the work. */

// The novel's cases as QuillCase.caseDigest lines, with scene titles. Used by the Structure
// Builder and Copy structure when Mystery is on.
async function caseDigestFor(novelPath) {
  const [cases, acts] = await Promise.all([
    window.quill.getCases(novelPath).catch(() => null),
    window.quill.getNovelStructure(novelPath).catch(() => []),
  ])
  const scenes = acts.flatMap(act => (act.chapters || []).flatMap(ch => (ch.scenes || [])
    .map(sc => ({ id: sc.scene_id || `path:${sc.path}`, title: sc.title }))))
  return QuillCase.caseDigest(cases?.ok ? cases.cases.map(QuillCase.normalize) : [], scenes)
}

const CaseBuilder = (() => {
  let _novel = null
  let _pane = null
  let _cases = []
  let _i = 0             // current case
  let _scenes = []       // [{ id, path, title, chapter }] in manuscript order; id is scene_id or 'path:<rel>'
  let _chapters = []     // includes empty chapters, so a planned item can become its first scene
  let _chars = []
  let _structureTruth = ''
  let _timer = null
  let _dirty = false
  let _saveError = ''
  let _saveStatus = ''
  let _saveStatusTimer = null
  let _caseView = 'overview'
  let _boardFit = null    // keeps the board fitted to the window as it resizes
  let _folder = null      // the board card whose case file is open: 'case', 'suspect:<id>' or 'clue:<id>'
  let _caseMode = 'board'  // 'board' (the corkboard and whiteboard) or 'file' (the tabbed case file)
  // Builder
  let _open = false
  let _steps = []
  let _s = 0
  let _onePage = false   // a group's items as one page of cards instead of one per screen
  let _returnFocus = null

  const K = () => QuillCase
  const esc = s => escapeHtml(s)
  const $ = id => document.getElementById(id)
  const uid = () => Math.random().toString(36).slice(2, 10)
  const cur = () => _cases[_i]
  const clip = (text, n = 40) => { const t = String(text || '').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t }
  const sceneTitle = id => _scenes.find(s => s.id === id)?.title || ''
  const sceneMissing = id => Boolean(id && !_scenes.some(scene => scene.id === id))
  // A step's name everywhere it's listed: its own name, else the start of what happened.
  const stepName = (t, n) => String(t.title || '').trim() || clip(t.what, 48) || t.when || `Step ${n + 1}`
  const leadName = (c, id) => { const l = c.leads.find(x => x.id === id); return l ? K().leadName(l, c.leads.indexOf(l)) : '' }
  const planSceneButton = sceneId => {
    const scene = _scenes.find(item => item.id === sceneId)
    return scene ? `<button type="button" class="btn sm case-plan-scene" data-plan-scene="${esc(scene.path)}">✦ Plan “${esc(scene.title || 'Untitled')}” →</button>` : ''
  }
  const createSceneControl = (target, title, replacement = false) => !_chapters.length ? '' : `<div class="case-create-scene">
    <select data-create-chapter="${esc(target)}" aria-label="Chapter for the new scene">${_chapters.map(ch =>
      `<option value="${esc(ch.path)}">${esc(ch.title)}</option>`).join('')}</select>
    <button type="button" class="btn sm" data-create-scene="${esc(target)}" data-scene-title="${esc(title || 'New scene')}">✦ ${replacement ? 'Build replacement scene' : 'Build as a new scene'} →</button></div>`
  // Where a clue (or anything placed) lands, in words: its scene, else its stop, marked planned.
  const placeText = (c, at) => !at ? '' : at.sceneId ? sceneTitle(at.sceneId) : `${leadName(c, at.leadId)} (planned)`

  // ── Loading and saving ──────────────────────────────────────
  async function loadScenes() {
    const acts = await window.quill.getNovelStructure(_novel).catch(() => [])
    _chapters = acts.flatMap(act => (act.chapters || []).map(ch => ({
      path: ch.path, title: ch.folderTitle || ch.name || 'Untitled chapter',
    })))
    _scenes = acts.flatMap(act => (act.chapters || []).flatMap(ch => (ch.scenes || []).map(sc => ({
      id: sc.scene_id || `path:${sc.path}`, path: sc.path, title: sc.title, chapter: ch.folderTitle || ch.name,
    }))))
  }

  async function load(novelPath, pane) {
    if (_novel && _novel !== novelPath) await flush()
    _novel = novelPath
    _pane = pane
    const [cases, meta, structure] = await Promise.all([
      window.quill.getCases(novelPath).catch(() => null),
      window.quill.getFolderMeta(novelPath).catch(() => ({})),
      window.quill.getStructure(novelPath).catch(() => null),
      loadScenes(),
    ])
    if (_novel !== novelPath) return
    _cases = (cases?.ok ? cases.cases : []).map(K().normalize)
    _chars = (meta.characters || []).filter(c => String(c.name || '').trim())
    _structureTruth = structure?.structure?.foundation?.case_truth || ''
    _i = Math.min(_i, Math.max(0, _cases.length - 1))
    renderView()
  }

  function refreshCharacterOptions() {
    const list = $('cb-characters')
    if (list) list.innerHTML = _chars.map(ch => `<option value="${esc(ch.name)}">`).join('')
  }

  async function syncSuspectCharacter(suspect) {
    const name = String(suspect?.name || '').trim()
    if (!name || !_novel) return
    const existing = _chars.find(ch => String(ch.name || '').trim().toLocaleLowerCase() === name.toLocaleLowerCase())
    if (existing && (!suspect.characterId || suspect.characterId === existing.id)) {
      suspect.characterId = existing.id
      changed()
      return
    }
    const result = await window.quill.syncCaseCharacter({
      novelRel: _novel, characterId: suspect.characterId || '', name,
    }).catch(error => ({ ok: false, error: error.message }))
    if (!result?.ok || !result.character) {
      showSaveError(`Case saved, but “${name}” couldn’t be added to Characters${result?.error ? ` (${result.error})` : ''}.`)
      return
    }
    const at = _chars.findIndex(ch => ch.id === result.character.id)
    if (at >= 0) _chars[at] = result.character
    else _chars.push(result.character)
    Landing.acceptCharacter?.(_novel, result.character)
    suspect.characterId = result.character.id
    refreshCharacterOptions()
    showCharacterAdded(result.character)
    changed()
    if (_open) refreshRail()
  }

  function showCharacterAdded(character) {
    const notice = $('case-character-notice')
    if (!notice) return
    notice.hidden = false
    notice.innerHTML = `<span>Added <b>${esc(character.name)}</b> to Characters.</span><button type="button">Open profile →</button>`
    notice.querySelector('button').onclick = async () => {
      await closeBuilder()
      await Landing.openCharacter?.(_novel, character.id)
    }
  }

  function changed() {
    _dirty = true
    showSaveStatus('Saving…', 'saving')
    clearTimeout(_timer)
    _timer = setTimeout(flush, 600)
  }

  async function flush() {
    clearTimeout(_timer)
    _timer = null
    if (!_novel || !_dirty) return true
    _dirty = false
    const novel = _novel
    const resolving = JSON.stringify(_cases).includes('"path:')
    const result = await window.quill.saveCases({ novelRel: novel, cases: _cases }).catch(error => ({ ok: false, error: error.message }))
    if (!result?.ok) {
      // Say so where the writer is looking, and keep trying; nothing typed is dropped meanwhile.
      _dirty = true
      showSaveError(`Couldn’t save the case${result?.error ? ` (${result.error})` : ''}. Trying again…`)
      if (!_timer) _timer = setTimeout(flush, 3000)
      return false
    }
    _saveError = ''
    showSaveStatus('Saved', 'saved')
    clearTimeout(_saveStatusTimer)
    _saveStatusTimer = setTimeout(() => { if (!_dirty && _saveStatus === 'Saved') showSaveStatus('') }, 1800)
    // Scenes picked before they had an id now have one. Swap the ids in place, so nothing typed
    // meanwhile is lost.
    if (resolving && novel === _novel) {
      await loadScenes()
      const idFor = ref => typeof ref === 'string' && ref.startsWith('path:')
        ? (_scenes.find(sc => sc.path === ref.slice(5))?.id || ref) : ref
      for (const c of _cases) {
        c.revealSceneId = idFor(c.revealSceneId)
        for (const cl of c.clues) {
          cl.foundSceneId = idFor(cl.foundSceneId)
          cl.alsoSceneIds = cl.alsoSceneIds.map(idFor)
        }
        for (const l of c.leads) l.sceneId = idFor(l.sceneId)
        for (const r of c.rules) r.sceneId = idFor(r.sceneId)
      }
    }
    return true
  }

  function showSaveError(text) {
    _saveError = text
    showSaveStatus(text, text ? 'error' : '')
  }

  function showSaveStatus(text, kind = '') {
    _saveStatus = text
    for (const el of [$('cb-save-status'), $('case-save-status')]) if (el) {
      el.textContent = text
      el.classList.toggle('saving', kind === 'saving')
      el.classList.toggle('saved', kind === 'saved')
      el.classList.toggle('error', kind === 'error')
    }
  }

  // ── The case file (read-only tab) ───────────────────────────
  function renderView() {
    if (!_pane) return
    if (!_cases.length) {
      _pane.innerHTML = `<div class="case-empty">
        <p>Plan an investigation one step at a time: what really happened, what it left behind, how the investigation finds it, who looks guilty, and when the truth comes out. Start with the crime, from the culprit’s side.</p>
        <button class="btn sm primary" id="case-start">Start a case →</button></div>`
      $('case-start').onclick = newCase
      return
    }
    const c = cur()
    const pos = K().positions(c, _scenes)
    const warnings = K().fairPlay(c, _scenes)
    const keyCount = c.clues.filter(cl => cl.key).length
    const reveal = placeText(c, pos.reveal())
    const next = nextUsefulAction()
    const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`
    const summary = [plural(c.truth.length, 'step'), plural(c.clues.length, 'clue') + (keyCount ? ` (${keyCount} key)` : ''),
      c.leads.length ? plural(c.leads.length, 'stop') : '', plural(c.suspects.length, 'suspect'),
      reveal ? `reveal in ${reveal}` : 'no reveal yet'].filter(Boolean).join(' · ')
    const addLabel = { 'add-truth': 'Write the first step', 'add-clue': 'Add the first clue', 'add-lead': 'Add the first stop', 'add-suspect': 'Add the first suspect' }
    const section = (label, count, body, add) => `<section class="case-section">
        <div class="spine-act-head"><span>${esc(label)}</span><em>${count}</em></div>
        ${body || `<button class="case-empty-card" data-open="${add}">+ ${esc(addLabel[add])}</button>`}
      </section>`
    const truth = c.truth.map((t, n) => `<button class="beat-card case-card-view" data-open="truth:${t.id}">
        <span class="beat-card-head"><span class="case-num">${n + 1}</span><span class="beat-card-label">${esc(stepName(t, n))}</span></span>
        ${t.when || t.who ? `<span class="case-meta">${esc([t.when, t.who].filter(Boolean).join(' · '))}</span>` : ''}
        ${t.title ? `<span class="beat-preview">${esc(t.what || '— not written yet —')}</span>` : ''}
        ${t.mistake ? `<span class="case-meta">Went wrong: ${esc(t.mistake)}</span>` : ''}
      </button>`).join('')
    const clues = c.clues.map(cl => {
      const suspect = c.suspects.find(s => s.id === cl.suspectId)?.name
      const found = [K().label(K().METHODS, cl.method), placeText(c, pos.clue(cl))].filter(Boolean).join(', in ')
      return `<button class="beat-card case-card-view" data-open="clue:${cl.id}" data-job="${esc(cl.job)}">
        <span class="beat-card-head"><span class="beat-card-label">${esc(cl.text || 'Untitled clue')}</span></span>
        <span class="case-tags">${[K().label(K().KINDS, cl.kind), K().label(K().JOBS, cl.job)].filter(Boolean).map(t => `<i>${esc(t)}</i>`).join('')}${cl.key ? '<i class="key">Key</i>' : ''}</span>
        ${suspect || cl.pointsTo ? `<span class="case-meta">Points to ${esc([suspect, cl.pointsTo].filter(Boolean).join(' — '))}</span>` : ''}
        <span class="case-meta${found ? '' : ' none'}">${esc(found ? `Found: ${found}` : 'Not placed in a scene yet')}</span>
        ${cl.leadsTo && leadName(c, cl.leadsTo) ? `<span class="case-meta">Leads to ${esc(leadName(c, cl.leadsTo))}</span>` : ''}
      </button>`
    }).join('')
    const suspects = c.suspects.map(s => `<button class="beat-card case-card-view" data-open="suspect:${s.id}">
        <span class="beat-card-head"><span class="beat-card-label">${esc(s.name || 'Unnamed suspect')}</span>${s.culprit ? '<span class="case-tags"><i class="key">Culprit</i></span>' : ''}</span>
        ${s.motive ? `<span class="case-meta">Motive: ${esc(s.motive)}</span>` : ''}
        ${s.hiding ? `<span class="case-meta">Hiding: ${esc(s.hiding)}</span>` : ''}
        ${s.clearedBy && !s.culprit ? `<span class="case-meta">Cleared by: ${esc(s.clearedBy)}</span>` : ''}
      </button>`).join('')
    const rules = c.rules.filter(r => String(r.text || '').trim()).map(r => {
      const at = placeText(c, pos.place(r.sceneId, r.leadId))
      return `<div class="case-order-row"><span>${esc(at || 'Not shown yet')}</span><b>${esc(r.text)}</b><em></em></div>`
    }).join('')
    // Cases down the left, like the builder's rail, so any number of them fits.
    const nav = `<nav class="case-nav" aria-label="Cases">
      ${_cases.map((x, i) => {
        const w = K().fairPlay(x, _scenes).length
        const meta = [`${x.clues.length} clue${x.clues.length === 1 ? '' : 's'}`, w ? `${w} warning${w === 1 ? '' : 's'}` : ''].filter(Boolean).join(' · ')
        return `<button type="button" class="case-nav-item${i === _i ? ' active' : ''}" data-case="${i}" title="${esc(x.title || 'Untitled case')}">
          <span>${esc(x.title || 'Untitled case')}</span><em${w ? ' class="warn"' : ''}>${esc(meta)}</em></button>`
      }).join('')}
      <button type="button" class="case-nav-new" id="case-new">+ New case</button></nav>`
    const views = ['overview', 'truth', 'evidence', 'investigation', 'suspects', 'reveal']
    if (!views.includes(_caseView)) _caseView = 'overview'
    const tab = (id, label, count = '') => `<button type="button" class="case-view-tab${_caseView === id ? ' active' : ''}" data-case-view="${id}"
      role="tab" aria-selected="${_caseView === id}" aria-controls="case-view-${id}">${esc(label)}${count !== '' ? `<em>${esc(String(count))}</em>` : ''}</button>`
    const overviewTruth = c.truth.length ? c.truth.map((t, n) => `<button type="button" class="case-overview-step" data-open="truth:${t.id}">
        <span class="case-num">${n + 1}</span><span><b>${esc(stepName(t, n))}</b><small>${esc(t.mistake || t.what || 'Add what happened')}</small></span></button>`).join('')
      : '<button type="button" class="case-empty-card" data-open="add-truth">+ Write what really happened</button>'
    const overviewEvidence = (c.clues.filter(cl => cl.key).length ? c.clues.filter(cl => cl.key) : c.clues).slice(0, 4).map(cl => {
      const at = placeText(c, pos.clue(cl))
      return `<button type="button" class="case-overview-row" data-open="clue:${cl.id}" data-job="${esc(cl.job)}">
        <span><b>${esc(cl.text || 'Untitled clue')}</b><small>${esc([K().label(K().JOBS, cl.job), at || 'not placed'].filter(Boolean).join(' · '))}</small></span>
        ${cl.key ? '<em>Key</em>' : ''}</button>`
    }).join('') || '<button type="button" class="case-empty-card" data-open="add-clue">+ Add the first clue</button>'
    const overviewSuspects = c.suspects.slice(0, 4).map(s => `<button type="button" class="case-overview-row" data-open="suspect:${s.id}">
      <span><b>${esc(s.name || 'Unnamed suspect')}</b><small>${esc(s.culprit ? 'Culprit' : s.clearedBy ? `Cleared: ${s.clearedBy}` : s.motive || 'Needs a motive')}</small></span>
      ${s.culprit ? '<em>Culprit</em>' : ''}</button>`).join('') || '<button type="button" class="case-empty-card" data-open="add-suspect">+ Add the first suspect</button>'
    const panel = (id, body) => `<div class="case-view-panel" id="case-view-${id}" role="tabpanel"${_caseView === id ? '' : ' hidden'}>${body}</div>`
    const revealBody = `${rules ? `<section class="case-section"><div class="spine-act-head"><span>Solution rules</span><em>${c.rules.length}</em></div>
        <button class="case-order-view" data-open="rules">${rules}</button></section>` : `<section class="case-section"><div class="spine-act-head"><span>Solution rules</span><em>0</em></div>
        <button class="case-empty-card" data-open="rules">+ Add a solution rule</button></section>`}
      <section class="case-section"><div class="spine-act-head"><span>Reveal order</span><em>${reveal ? esc(reveal) : 'not set'}</em></div>
        <button class="case-order-view" data-open="reveal">${pacingHTML(c)}${revealListHTML(c) || '<span class="case-meta none">Place clues in scenes or stops to see them in order.</span>'}</button></section>`
    const mode = id => `<button type="button" data-case-mode="${id}" aria-pressed="${_caseMode === id}">${id === 'board' ? 'Board' : 'File'}</button>`
    const heading = `<div class="case-heading-row">
          <div><button class="case-heading" data-open="name" title="Rename">${esc(c.title || 'Untitled case')}</button>
            <div class="case-summary">${esc(summary)}</div></div>
          <div class="seg case-mode" role="group" aria-label="Case view">${mode('board')}${mode('file')}</div>
        </div>`
    if (_caseMode === 'board') {
      _pane.innerHTML = `<div class="case-layout">${nav}
        <div class="case-workspace">${heading}${boardHTML(c, folderHTML(c))}
          <div class="case-save-status${_saveError ? ' error' : ''}" id="case-save-status" role="status">${esc(_saveStatus)}</div>
        </div></div>`
      bindView()
      bindBoard(c)
      return
    }
    _pane.innerHTML = `<div class="case-layout">${nav}
      <div class="case-workspace">
        ${heading}
        <div class="case-view-tabs" role="tablist" aria-label="Case views">
          ${tab('overview', 'Overview')}${tab('truth', 'Truth', c.truth.length)}${tab('evidence', 'Evidence', c.clues.length)}
          ${tab('investigation', 'Investigation', c.leads.length)}${tab('suspects', 'Suspects', c.suspects.length)}${tab('reveal', 'Reveal')}
        </div>
        <div class="case-workspace-body">
          <div class="case-file">
            ${panel('overview', `<section class="case-overview-path"><div class="case-overview-head"><div><h3>What really happened</h3><p>The culprit's path from plan to mistake.</p></div><button type="button" data-jump-view="truth">See all →</button></div>
                <div class="case-overview-flow">${overviewTruth}</div></section>
              <div class="case-overview-grid"><section><div class="case-overview-head"><div><h3>Key evidence</h3><p>What the solution depends on.</p></div><button type="button" data-jump-view="evidence">See all →</button></div>${overviewEvidence}</section>
              <section><div class="case-overview-head"><div><h3>Suspects</h3><p>Who the evidence points toward.</p></div><button type="button" data-jump-view="suspects">See all →</button></div>${overviewSuspects}</section></div>`)}
            ${panel('truth', section('What really happened', `${c.truth.length}`, truth ? `<div class="case-list">${truth}</div>` : '', 'add-truth'))}
            ${panel('evidence', section('Clues', keyCount ? `${c.clues.length} · ${keyCount} key` : `${c.clues.length}`, clues ? `<div class="case-grid-view">${clues}</div>` : '', 'add-clue'))}
            ${panel('investigation', section('The investigation', `${c.leads.length}`, c.leads.length ? chainHTML(c, pos) : '', 'add-lead'))}
            ${panel('suspects', section('Suspects', `${c.suspects.length}`, suspects ? `<div class="case-grid-view">${suspects}</div>` : '', 'add-suspect'))}
            ${panel('reveal', revealBody)}
          </div>
          <aside class="case-inspector" aria-label="Case guidance">
            <button type="button" class="case-next-action" id="case-next-action"><b>Next useful step</b><span>${esc(next.label)}</span><em>${esc(next.why)}</em></button>
            ${warnings.length ? `<button class="case-warnings-view" data-open="reveal"><b>⚠ ${warnings.length} fair-play warning${warnings.length === 1 ? '' : 's'}</b><span>${esc(warnings[0].text)}${warnings.length > 1 ? ' …' : ''}</span></button>`
              : '<div class="case-fair-ok"><b>Fair play</b><span>No current warnings</span></div>'}
            <div class="case-health"><div><span>Key clues placed</span><b>${c.clues.filter(cl => cl.key && pos.clue(cl)).length} / ${keyCount}</b></div>
              <div><span>Investigation stops</span><b>${c.leads.length}</b></div><div><span>Reveal</span><b>${esc(reveal || 'Not set')}</b></div></div>
            <button class="btn sm primary case-continue" id="case-build">Continue: ${esc(next.label)} →</button>
            <div class="case-inspector-actions"><button class="btn sm" id="case-copy">Copy case</button><button type="button" class="case-delete" id="case-delete">Delete case</button></div>
            <div class="case-save-status${_saveError ? ' error' : ''}" id="case-save-status" role="status">${esc(_saveStatus)}</div>
          </aside>
        </div>
      </div></div>`
    const showView = id => {
      if (!views.includes(id)) return
      _caseView = id
      _pane.querySelectorAll('[data-case-view]').forEach(b => {
        const active = b.dataset.caseView === id
        b.classList.toggle('active', active)
        b.setAttribute('aria-selected', String(active))
      })
      _pane.querySelectorAll('.case-view-panel').forEach(p => { p.hidden = p.id !== `case-view-${id}` })
    }
    _pane.querySelectorAll('[data-case-view]').forEach(b => { b.onclick = () => showView(b.dataset.caseView) })
    _pane.querySelectorAll('[data-jump-view]').forEach(b => { b.onclick = () => showView(b.dataset.jumpView) })
    $('case-copy').onclick = e => copyCase(e.currentTarget)
    $('case-delete').onclick = deleteCase
    $('case-build').onclick = () => openBuilder(next.at)
    $('case-next-action').onclick = () => openBuilder(next.at)
    bindView()
  }

  // What both views share: the case list, the Board/File switch, and anything that opens the builder.
  function bindView() {
    _pane.querySelectorAll('[data-case]').forEach(b => { b.onclick = () => { _i = Number(b.dataset.case); _caseView = 'overview'; _folder = null; renderView() } })
    _pane.querySelectorAll('[data-case-mode]').forEach(b => { b.onclick = () => { _caseMode = b.dataset.caseMode; renderView() } })
    $('case-new').onclick = newCase
    _pane.querySelectorAll('[data-open]').forEach(b => { b.onclick = () => openBuilder(b.dataset.open) })
  }

  // ── The case board ──────────────────────────────────────────
  // A corkboard (the case, suspects and clues, dragged anywhere, red string from each clue to the
  // suspect it points at, fair-play warnings as sticky notes) over a whiteboard (what really
  // happened above the investigation's stops, and a Reveal magnet to drop on the stop where the
  // truth comes out). Clicking a card opens its case file, a manila folder beside the board;
  // arrow keys move a focused card. Dragging from a card's pin to another card ties red string
  // between a clue and a suspect.
  const TILTS = [-2.5, 1.5, -1, 2.5, -2, 1, 2, -1.5]
  const tilt = n => TILTS[n % TILTS.length]
  const initials = name => String(name || '').trim().split(/\s+/).filter(w => /^[\p{L}\p{N}]/u.test(w)).slice(0, 2).map(w => w[0].toUpperCase()).join('') || '?'
  const warningTarget = w => w.clueId ? `clue:${w.clueId}` : w.leadId ? `lead:${w.leadId}` : w.suspectId ? `suspect:${w.suspectId}` : w.ruleId ? 'rules'
    : w.kind === 'no-key' ? 'intro:clues' : w.kind === 'no-culprit' ? 'intro:suspects' : 'reveal'

  function stringsSVG(c, layout) {
    const herring = new Set(c.clues.filter(cl => cl.job === 'herring').map(cl => `clue:${cl.id}`))
    const lines = K().boardStrings(c, layout).map(s => `<line x1="${s.from.x}" y1="${s.from.y}" x2="${s.to.x}" y2="${s.to.y}" class="${s.herring ? 'herring' : ''}"/>`).join('')
    const pins = layout.map(x => `<circle cx="${x.x + x.w / 2}" cy="${x.y + 10}" r="6" class="${x.kind === 'clue' ? (herring.has(x.key) ? 'herring' : 'brass') : ''}"/>`).join('')
    return `<svg class="cb-strings" aria-hidden="true">${lines}${pins}</svg>`
  }

  function boardHTML(c, folder = '') {
    const layout = K().boardLayout(c)
    const at = new Map(layout.map(x => [x.key, x]))
    // Loose sticky notes go in a column just right of the cards.
    const cards = Math.max(300, ...layout.map(x => x.x + x.w + 30))
    // Positions go on in bindBoard, as data-at "x,y,tilt".
    const style = (x, n) => `${x.x},${x.y},${tilt(n)}`
    const open = key => `aria-expanded="${key === _folder}"`
    const pin = key => `<span class="cb-pin-handle" data-pin="${esc(key)}" title="Drag to tie red string" aria-hidden="true"></span>`
    const stamp = s => s.culprit ? '<span class="cb-stamp culprit">Culprit</span>' : s.clearedBy ? '<span class="cb-stamp cleared">Cleared</span>' : ''
    const caseCard = at.get('case')
    const html = [`<button type="button" class="cb-card cb-polaroid cb-case" data-card="case" ${open('case')} data-at="${style(caseCard, 0)}">
        <span class="cb-photo">${esc(initials(c.title))}</span><span class="cb-cap">${esc(c.title || 'Untitled case')}</span>
        <span class="cb-role">${esc(`${c.clues.length} exhibit${c.clues.length === 1 ? '' : 's'} · ${c.suspects.length} suspect${c.suspects.length === 1 ? '' : 's'}`)}</span></button>`]
    c.suspects.forEach((s, n) => html.push(`<button type="button" class="cb-card cb-polaroid" data-card="suspect:${esc(s.id)}" ${open(`suspect:${s.id}`)} data-at="${style(at.get(`suspect:${s.id}`), n + 1)}">
        ${pin(`suspect:${s.id}`)}<span class="cb-photo">${esc(initials(s.name))}${stamp(s)}</span><span class="cb-cap">${esc(s.name || 'Unnamed suspect')}</span>
        ${s.motive || s.means ? `<span class="cb-role">${esc(clip(String(s.motive || s.means).replace(/^\s*author plan:\s*/i, ''), 54))}</span>` : ''}</button>`))
    c.clues.forEach((cl, n) => {
      const badge = cl.key ? '<span class="cb-key">Key</span>' : cl.job === 'herring' ? '<span class="cb-herring">Herring</span>' : cl.job === 'double' ? '<span class="cb-herring">Double</span>' : ''
      const kind = K().label(K().KINDS, cl.kind)
      html.push(`<button type="button" class="cb-card cb-tag${cl.kind === 'absence' ? ' absence' : ''}" data-card="clue:${esc(cl.id)}" ${open(`clue:${cl.id}`)} data-at="${style(at.get(`clue:${cl.id}`), n + 3)}">
        ${pin(`clue:${cl.id}`)}<span class="cb-tag-top"><span>EX-${String(n + 1).padStart(2, '0')}${kind ? ` · ${esc(kind)}` : ''}</span>${badge}</span>
        <span class="cb-tag-text">${esc(clip(cl.text || 'Untitled clue', 90))}</span></button>`)
    })
    // Fair-play warnings as the detective's sticky notes: by the card they're about, else in a column on the right.
    let loose = 0
    const near = new Map()
    for (const w of K().fairPlay(c, _scenes)) {
      const card = at.get(w.suspectId ? `suspect:${w.suspectId}` : w.clueId ? `clue:${w.clueId}` : '')
      const k = near.get(card?.key) || 0
      if (card) near.set(card.key, k + 1)
      const spot = card ? { x: card.x + 30 + k * 16, y: card.y + (card.kind === 'clue' ? 96 : 196) + k * 16 } : { x: cards + 10, y: 24 + loose++ * 132 }
      html.push(`<button type="button" class="cb-sticky" data-open="${esc(warningTarget(w))}" data-at="${spot.x},${spot.y},${tilt(loose + k + 2)}">${esc(w.text)}</button>`)
    }
    return `<div class="cb-wall">
      <div class="cb-toolbar"><button type="button" class="btn sm" data-open="add-clue">+ Exhibit</button><button type="button" class="btn sm" data-open="add-suspect">+ Suspect</button>
        <span class="cb-legend"><span><i class="cb-legend-string"></i>points at a suspect</span><span><i class="cb-legend-string herring"></i>red herring</span><span>Drag cards anywhere. Drag from a pin to tie string.</span></span></div>
      <div class="cb-desk"><div class="cb-board-wrap"><div class="cb-board">${html.join('')}${stringsSVG(c, layout)}</div></div>${folder}</div>
      ${whiteboardHTML(c)}</div>`
  }

  const exhibit = (c, cl) => `EX-${String(c.clues.indexOf(cl) + 1).padStart(2, '0')}`

  // The open card's case file: typed fields, its fair-play warnings as sticky notes, and buttons
  // to edit it in the builder or open its scene. A clue's suspect is picked here too, which is
  // red string for anyone not dragging.
  function folderHTML(c) {
    if (!_folder) return ''
    const [kind, id] = _folder.split(':')
    const pos = K().positions(c, _scenes)
    const row = (label, html) => html ? `<div class="cb-field"><dt>${esc(label)}</dt><dd>${html}</dd></div>` : ''
    const text = value => String(value || '').trim() ? esc(value) : ''
    const about = test => [...K().fairPlay(c, _scenes), ...K().notes(c, _scenes)].filter(test)
    let tab, kicker, title, stamp = '', fields = '', actions = '', warnings = []
    if (kind === 'clue') {
      const cl = c.clues.find(x => x.id === id)
      if (!cl) return ''
      const at = pos.clue(cl)
      const scene = _scenes.find(sc => sc.id === at?.sceneId)
      const truth = c.truth.find(t => t.id === cl.truthId)
      tab = exhibit(c, cl)
      kicker = [`Exhibit ${tab}`, K().label(K().KINDS, cl.kind), K().label(K().JOBS, cl.job)].filter(Boolean).join(' · ')
      title = cl.text || 'Untitled clue'
      stamp = cl.key ? 'Key' : cl.job === 'herring' ? 'Herring' : ''
      fields = row('Points at', `<select data-folder-suspect="${esc(cl.id)}" aria-label="Suspect this exhibit points at"><option value="">Nobody yet</option>${c.suspects.map(su =>
          `<option value="${esc(su.id)}"${su.id === cl.suspectId ? ' selected' : ''}>${esc(su.name || 'Unnamed suspect')}</option>`).join('')}</select>`)
        + row('Points to', text(cl.pointsTo))
        + row('Found', esc([K().label(K().METHODS, cl.method), placeText(c, at)].filter(Boolean).join(', in ') || 'Not placed yet'))
        + row('Also shown in', text(cl.alsoSceneIds.map(sceneTitle).filter(Boolean).join(', ')))
        + row('Leads to', text(leadName(c, cl.leadsTo)))
        + row('Truth step', truth ? esc(stepName(truth, c.truth.indexOf(truth))) : '')
        + (cl.job === 'double' ? row('Means later', text(cl.meansLater)) : '')
        + row('Note', text(cl.note))
      actions = `${scene ? `<button type="button" class="cb-folder-btn" data-open-scene="${esc(scene.path)}">Open scene</button>` : ''}
        <button type="button" class="cb-folder-btn primary" data-open="clue:${esc(cl.id)}">Edit exhibit</button>`
      warnings = about(w => w.clueId === id)
    } else if (kind === 'suspect') {
      const su = c.suspects.find(x => x.id === id)
      if (!su) return ''
      const pointing = c.clues.filter(cl => cl.suspectId === id)
      tab = 'Suspect'
      kicker = su.culprit ? 'Suspect · Culprit' : su.clearedBy ? 'Suspect · Cleared' : 'Suspect'
      title = su.name || 'Unnamed suspect'
      stamp = su.culprit ? 'Culprit' : su.clearedBy ? 'Cleared' : ''
      fields = row('Means', text(su.means)) + row('Motive', text(su.motive)) + row('Opportunity', text(su.opportunity))
        + row('Hiding', text(su.hiding)) + row('Cleared by', su.culprit ? '' : text(su.clearedBy))
        + row('Exhibits', pointing.length ? pointing.map(cl => `<button type="button" class="cb-folder-link" data-folder="clue:${esc(cl.id)}">${esc(exhibit(c, cl))} · ${esc(cl.text || 'Untitled clue')}</button>`).join('')
          : '<span class="cb-folder-none">Nothing points here yet.</span>')
      actions = `${su.characterId ? `<button type="button" class="cb-folder-btn" data-open-character="${esc(su.characterId)}">Open profile</button>` : ''}
        <button type="button" class="cb-folder-btn primary" data-open="suspect:${esc(su.id)}">Edit suspect</button>`
      warnings = about(w => w.suspectId === id)
    } else {
      const reveal = placeText(c, pos.reveal())
      const list = items => items.length ? `<ol>${items.map(x => `<li>${esc(x)}</li>`).join('')}</ol>` : ''
      tab = 'Case'
      kicker = 'Case file'
      title = c.title || 'Untitled case'
      fields = row('What really happened', list(c.truth.map((t, n) => stepName(t, n))))
        + row('Investigation', esc(`${c.leads.length} stop${c.leads.length === 1 ? '' : 's'}, ${c.leads.filter(l => sceneTitle(l.sceneId)).length} written`))
        + row('Solution rules', list(c.rules.map(r => r.text).filter(t => String(t || '').trim())))
        + row('Reveal', esc(reveal || 'Not set'))
      actions = '<button type="button" class="cb-folder-btn primary" data-open="name">Edit case</button>'
      warnings = about(w => !w.clueId && !w.suspectId)
    }
    return `<aside class="cb-folder" aria-label="Case file: ${esc(title)}">
      <div class="cb-folder-head"><span class="cb-folder-tab">${esc(tab)}</span><button type="button" class="cb-folder-close" aria-label="Close case file">×</button></div>
      <div class="cb-folder-sheet">
        ${stamp ? `<span class="cb-folder-stamp${stamp === 'Cleared' ? ' cleared' : stamp === 'Herring' ? ' herring' : ''}">${esc(stamp)}</span>` : ''}
        <p class="cb-folder-kicker">${esc(kicker)}</p>
        <h3 class="cb-folder-title">${esc(title)}</h3>
        <dl>${fields}</dl>
        ${warnings.map(w => `<button type="button" class="cb-sticky cb-folder-sticky" data-open="${esc(warningTarget(w))}">${esc(w.text)}</button>`).join('')}
        <div class="cb-folder-actions">${actions}</div>
      </div></aside>`
  }

  // Pointer capture keeps a drag going outside the element; synthetic events can't be captured.
  function capture(el, e) { try { el.setPointerCapture(e.pointerId) } catch {} }

  function bindFolder(c) {
    const folder = _pane.querySelector('.cb-folder')
    if (!folder) return
    const close = () => {
      const key = _folder
      _folder = null
      renderView()
      _pane.querySelector(`[data-card="${CSS.escape(key)}"]`)?.focus({ preventScroll: true })
    }
    folder.querySelector('.cb-folder-close').onclick = close
    folder.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); close() } })
    folder.querySelectorAll('[data-folder]').forEach(b => { b.onclick = () => { _folder = b.dataset.folder; renderView() } })
    folder.querySelectorAll('[data-folder-suspect]').forEach(sel => {
      sel.onchange = () => {
        const clue = c.clues.find(cl => cl.id === sel.dataset.folderSuspect)
        if (!clue) return
        clue.suspectId = sel.value
        changed()
        renderView()
        _pane.querySelector('[data-folder-suspect]')?.focus()
      }
    })
    folder.querySelectorAll('[data-open-scene]').forEach(b => {
      b.onclick = async () => { if (await flush()) App.openFile(b.dataset.openScene) }
    })
    folder.querySelectorAll('[data-open-character]').forEach(b => {
      b.onclick = async () => { if (await flush()) Landing.openCharacter?.(_novel, b.dataset.openCharacter) }
    })
  }

  function whiteboardHTML(c) {
    const pos = K().positions(c, _scenes)
    const reveal = pos.reveal()
    const revealStop = c.leads.find(l => (c.revealLeadId && l.id === c.revealLeadId) || (c.revealSceneId && l.sceneId === c.revealSceneId))
    const magnet = `<button type="button" class="cb-magnet" id="cb-reveal" title="Drag onto the stop where the truth comes out">Reveal</button>`
    const lane = (items, add, addLabel) => items.length
      ? `<div class="cb-lane">${items.join('')}</div>`
      : `<button type="button" class="cb-lane-empty" data-open="${add}">+ ${esc(addLabel)}</button>`
    const truth = c.truth.map((t, n) => `<button type="button" class="cb-node" data-open="truth:${esc(t.id)}"><i></i><b>${esc(stepName(t, n))}</b>${t.when ? `<small>${esc(clip(t.when, 34))}</small>` : ''}</button>`)
    const stops = c.leads.map((l, n) => {
      const written = Boolean(sceneTitle(l.sceneId))
      return `<div class="cb-stop" data-stop="${esc(l.id)}"><button type="button" class="cb-node${written ? '' : ' planned'}" data-open="lead:${esc(l.id)}"
        title="${esc(written ? sceneTitle(l.sceneId) : l.planned ? `Planned: ${l.planned}` : 'Not written yet')}"><i></i><b>${esc(K().leadName(l, n))}</b></button>${revealStop === l ? magnet : ''}</div>`
    })
    return `<section class="cb-whiteboard" aria-label="Whiteboard">
      <div class="cb-lane-label">What really happened</div>${lane(truth, 'add-truth', 'Write what really happened')}
      <div class="cb-lane-label">Investigation <small>hollow: no scene yet</small></div>${lane(stops, 'add-lead', 'Add the first stop')}
      <div class="cb-tray">${reveal && !revealStop ? `<span class="cb-tray-note">Reveal: ${esc(placeText(c, reveal))}</span>` : ''}
        <span class="cb-tray-note">${revealStop ? 'Drag the magnet back here to clear it' : 'Drag onto a stop →'}</span>${revealStop ? '' : magnet}</div></section>`
  }

  function bindBoard(c) {
    const board = _pane.querySelector('.cb-board')
    const wrap = _pane.querySelector('.cb-board-wrap')
    board.querySelectorAll('[data-at]').forEach(el => {
      const [x, y, t] = el.dataset.at.split(',')
      Object.assign(el.style, { left: `${x}px`, top: `${y}px` })
      el.style.setProperty('--tilt', `${t}deg`)
    })
    // The whole board fits the window: scaled down (never up) until every card and note is in
    // view, and the cork stretched to fill the frame.
    let scale = 1
    const fit = () => {
      const items = [...board.querySelectorAll('[data-at]')]
      const right = Math.max(...items.map(el => el.offsetLeft + el.offsetWidth)) + 40
      const bottom = Math.max(...items.map(el => el.offsetTop + el.offsetHeight)) + 40
      const width = wrap.clientWidth
      const height = Math.max(420, window.innerHeight - wrap.getBoundingClientRect().top - 32)
      scale = Math.min(1, width / right, height / bottom)
      Object.assign(board.style, { width: `${width / scale}px`, height: `${height / scale}px`, transform: `scale(${scale})` })
      wrap.style.height = `${height + 24}px`
    }
    fit()
    bindFolder(c)
    // Red string by hand: from a clue's pin to a suspect, or a suspect's pin to a clue.
    const ns = 'http://www.w3.org/2000/svg'
    board.querySelectorAll('[data-pin]').forEach(handle => {
      handle.addEventListener('click', e => e.stopPropagation())
      handle.addEventListener('pointerdown', e => {
        if (e.button !== 0) return
        e.stopPropagation()
        e.preventDefault()
        const from = handle.dataset.pin
        const card = handle.closest('[data-card]')
        const want = from.startsWith('clue:') ? 'suspect:' : 'clue:'
        const point = ev => { const r = board.getBoundingClientRect(); return [(ev.clientX - r.left) / scale, (ev.clientY - r.top) / scale] }
        const targetAt = ev => {
          const el = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('[data-card]')
          return el?.dataset.card.startsWith(want) ? el : null
        }
        capture(handle, e)
        const line = document.createElementNS(ns, 'line')
        line.setAttribute('class', 'drawing')
        line.setAttribute('x1', card.offsetLeft + card.offsetWidth / 2)
        line.setAttribute('y1', card.offsetTop + 10)
        const [x, y] = point(e)
        line.setAttribute('x2', x)
        line.setAttribute('y2', y)
        board.querySelector('.cb-strings').appendChild(line)
        let over = null
        const move = ev => {
          const [mx, my] = point(ev)
          line.setAttribute('x2', mx)
          line.setAttribute('y2', my)
          over?.classList.remove('string-target')
          over = targetAt(ev)
          over?.classList.add('string-target')
        }
        const up = ev => {
          handle.removeEventListener('pointermove', move)
          handle.removeEventListener('pointerup', up)
          handle.removeEventListener('pointercancel', up)
          line.remove()
          over?.classList.remove('string-target')
          const target = ev.type === 'pointerup' && targetAt(ev)
          if (!target) return
          const [clueKey, suspectKey] = from.startsWith('clue:') ? [from, target.dataset.card] : [target.dataset.card, from]
          const clue = c.clues.find(cl => cl.id === clueKey.slice(5))
          if (!clue) return
          clue.suspectId = suspectKey.slice(8)
          settle()
        }
        handle.addEventListener('pointermove', move)
        handle.addEventListener('pointerup', up)
        handle.addEventListener('pointercancel', up)
      })
    })
    _boardFit?.disconnect()
    _boardFit = new ResizeObserver(() => { if (board.isConnected) fit() })
    _boardFit.observe(wrap)
    const redraw = () => { board.querySelector('.cb-strings').outerHTML = stringsSVG(c, K().boardLayout(c)) }
    // Re-render after the click that ends a drag has been swallowed, so sticky notes follow their cards.
    const settle = () => { changed(); setTimeout(renderView, 0) }
    board.querySelectorAll('[data-card]').forEach(el => {
      const key = el.dataset.card
      let dragged = false
      el.addEventListener('pointerdown', e => {
        if (e.button !== 0) return
        const start = { x: e.clientX, y: e.clientY, left: el.offsetLeft, top: el.offsetTop }
        dragged = false
        capture(el, e)
        const move = ev => {
          const dx = (ev.clientX - start.x) / scale, dy = (ev.clientY - start.y) / scale
          if (!dragged && Math.hypot(dx, dy) * scale < 4) return
          dragged = true
          el.classList.add('dragging')
          const x = Math.max(0, Math.round(start.left + dx)), y = Math.max(0, Math.round(start.top + dy))
          el.style.left = `${x}px`
          el.style.top = `${y}px`
          c.board[key] = { x, y }
          redraw()
        }
        const up = () => {
          el.removeEventListener('pointermove', move)
          el.removeEventListener('pointerup', up)
          el.removeEventListener('pointercancel', up)
          el.classList.remove('dragging')
          if (dragged) settle()
        }
        el.addEventListener('pointermove', move)
        el.addEventListener('pointerup', up)
        el.addEventListener('pointercancel', up)
      })
      el.addEventListener('click', () => {
        if (dragged) { dragged = false; return }
        _folder = _folder === key ? null : key
        renderView()
        _pane.querySelector(`[data-card="${CSS.escape(key)}"]`)?.focus({ preventScroll: true })
      })
      el.addEventListener('keydown', e => {
        const step = e.shiftKey ? 40 : 10
        const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key]
        if (!d) return
        e.preventDefault()
        const x = Math.max(0, el.offsetLeft + d[0]), y = Math.max(0, el.offsetTop + d[1])
        el.style.left = `${x}px`
        el.style.top = `${y}px`
        c.board[key] = { x, y }
        redraw()
        changed()
      })
    })
    // The Reveal magnet: drop it on a stop to set the reveal there, or back in the tray to clear it.
    const wb = _pane.querySelector('.cb-whiteboard')
    const magnet = $('cb-reveal')
    let moved = false
    magnet.addEventListener('pointerdown', e => {
      if (e.button !== 0) return
      const start = { x: e.clientX, y: e.clientY }
      moved = false
      capture(magnet, e)
      const move = ev => {
        const dx = ev.clientX - start.x, dy = ev.clientY - start.y
        if (!moved && Math.hypot(dx, dy) < 4) return
        moved = true
        magnet.classList.add('dragging')
        magnet.style.transform = `translate(${dx}px,${dy}px)`
        wb.querySelectorAll('[data-stop]').forEach(n => n.classList.remove('drop'))
        document.elementFromPoint(ev.clientX, ev.clientY)?.closest('[data-stop]')?.classList.add('drop')
      }
      const up = ev => {
        magnet.removeEventListener('pointermove', move)
        magnet.removeEventListener('pointerup', up)
        magnet.removeEventListener('pointercancel', up)
        if (!moved) return
        const under = document.elementFromPoint(ev.clientX, ev.clientY)
        const stop = under?.closest('[data-stop]')
        if (stop) { c.revealLeadId = stop.dataset.stop; c.revealSceneId = '' }
        else if (under?.closest('.cb-tray')) { c.revealLeadId = ''; c.revealSceneId = '' }
        magnet.style.transform = ''
        settle()
      }
      magnet.addEventListener('pointermove', move)
      magnet.addEventListener('pointerup', up)
      magnet.addEventListener('pointercancel', up)
    })
    magnet.addEventListener('click', () => { if (moved) moved = false; else openBuilder('reveal') })
  }

  // The investigation as a chain: each stop, with the clues that sent the detective there.
  function chainHTML(c, pos) {
    return `<div class="case-chain">${c.leads.map((l, n) => {
      const into = c.clues.filter(cl => cl.leadsTo === l.id)
      const found = c.clues.filter(cl => cl.leadId === l.id)
      const at = pos.lead(l.id)
      const place = sceneTitle(l.sceneId) || (l.planned ? `Planned: ${l.planned}` : 'Not written yet')
      return `<div class="case-chain-stage">${into.length ? into.map(cl => `<div class="case-chain-link">↓ ${esc(cl.text || 'Untitled clue')}</div>`).join('')
          : n ? '<div class="case-chain-link quiet">↓</div>' : ''}
        <button class="beat-card case-card-view case-lead" data-open="lead:${l.id}">
          <span class="beat-card-head"><span class="case-num">${n + 1}</span><span class="beat-card-label">${esc(K().leadName(l, n))}</span>
            <span class="case-tags"><i${at?.planned ? ' class="planned"' : ''}>${esc(place)}</i></span></span>
          ${l.where || l.who ? `<span class="case-meta">${esc([l.where, l.who].filter(Boolean).join(' · '))}</span>` : ''}
          ${l.learned ? `<span class="beat-preview">${esc(l.learned)}</span>` : ''}
          ${l.theory ? `<span class="case-meta">Believes now: ${esc(l.theory)}</span>` : ''}
          ${found.length ? `<span class="case-meta">Turns up: ${esc(found.map(cl => cl.text || 'Untitled clue').join(' · '))}</span>` : ''}
        </button></div>`
    }).join('')}</div>`
  }

  // Clues placed in scenes or stops, in reading order, with the reveal marked.
  function revealListHTML(c) {
    const pos = K().positions(c, _scenes)
    const reveal = pos.reveal()
    const placed = c.clues.map(cl => [cl, pos.clue(cl)]).filter(([, at]) => at).sort((a, b) => a[1].at - b[1].at)
    let drawn = false
    const line = () => `<div class="case-reveal-line">Reveal · ${esc(placeText(c, reveal))}</div>`
    const rows = placed.map(([cl, at]) => {
      const before = !drawn && reveal && at.at > reveal.at ? (drawn = true, line()) : ''
      // A planned row is dashed and italic, so its place needs no "(planned)" to be cut short.
      return `${before}<div class="case-order-row${cl.key ? ' key' : ''}${at.planned ? ' planned' : ''}"><span title="${esc(placeText(c, at))}">${esc(at.sceneId ? sceneTitle(at.sceneId) : leadName(c, at.leadId))}</span><b>${esc(cl.text || 'Untitled clue')}</b>
        <em>${esc([K().label(K().JOBS, cl.job), cl.key ? 'key' : ''].filter(Boolean).join(' · '))}</em></div>`
    }).join('')
    return rows + (!drawn && reveal && placed.length ? line() : '')
  }

  // One cell per chapter, a dot per clue coloured by its job, the reveal marked: gaps show.
  function pacingHTML(c) {
    const cells = K().pacing(c, _scenes)
    if (!cells.some(cell => cell.clues.length)) return ''
    return `<div class="case-pacing" aria-label="Clues by chapter">${cells.map(cell => `<div class="case-pace${cell.reveal ? ' reveal' : ''}${cell.clues.length ? '' : ' empty'}"
        title="${esc(`${cell.label}: ${cell.clues.length} clue${cell.clues.length === 1 ? '' : 's'}${cell.reveal ? ', the reveal' : ''}`)}">
        <span class="case-pace-dots">${cell.clues.map(x => `<i data-job="${esc(x.job)}"${x.key ? ' class="key"' : ''}></i>`).join('')}</span>
        <span class="case-pace-label">${esc(cell.label)}</span></div>`).join('')}</div>`
  }

  function nextUsefulAction() {
    const c = cur()
    if (!c.title.trim()) return { at: 'name', label: 'Name the case', why: 'Give the investigation a stable name.' }
    if (!c.truth.length) return { at: 'add-truth', label: 'Write what happened', why: 'Start from the culprit’s side.' }
    if (!c.clues.length) return { at: 'add-clue', label: 'Add the first clue', why: 'Turn a mistake or loose end into evidence.' }
    if (!c.suspects.length) return { at: 'add-suspect', label: 'Add the first suspect', why: 'Give the evidence someone to point toward.' }
    if (!c.suspects.some(s => s.culprit)) return { at: `suspect:${c.suspects[0].id}`, label: 'Choose the culprit', why: 'Fair-play checks need to know who really did it.' }
    const key = c.clues.filter(cl => cl.key)
    if (!key.length) return { at: `clue:${c.clues[0].id}`, label: 'Mark a key clue', why: 'Which clue does the solution actually depend on?' }
    const positions = K().positions(c, _scenes)
    const unplaced = key.find(cl => !positions.clue(cl))
    if (unplaced) return { at: `clue:${unplaced.id}`, label: 'Place a key clue', why: `“${unplaced.text || 'Untitled clue'}” is not in the manuscript yet.` }
    if (!positions.reveal()) return { at: 'reveal', label: 'Place the reveal', why: 'Choose where the truth comes out.' }
    const warning = K().fairPlay(c, _scenes)[0]
    if (warning) {
      const at = warning.clueId ? `clue:${warning.clueId}` : warning.leadId ? `lead:${warning.leadId}`
        : warning.suspectId ? `suspect:${warning.suspectId}`
        : warning.ruleId ? 'rules' : warning.kind === 'no-key' ? 'intro:clues'
          : warning.kind === 'no-culprit' ? 'intro:suspects' : 'reveal'
      return { at, label: 'Resolve a fair-play warning', why: warning.text }
    }
    return { at: 'reveal', label: 'Review the reveal order', why: 'The case passes its current fair-play checks.' }
  }

  // ── The builder (modal) ─────────────────────────────────────
  // Steps: name · truth intro · each truth step · clue intro · each clue · investigation intro ·
  // each stop · suspect intro · each suspect · world rules · reveal. Intro screens teach the step
  // and hold its Add button; on one page, they hold the group's items too.
  function buildSteps() {
    const c = cur()
    const items = (kind, list, group) => _onePage ? [] : list.map(x => ({ kind, id: x.id, group }))
    return [
      { kind: 'name', group: 'The case' },
      { kind: 'intro', step: 'truth', group: 'What really happened' },
      ...items('truth', c.truth, 'What really happened'),
      { kind: 'intro', step: 'clues', group: 'Clues' },
      ...items('clue', c.clues, 'Clues'),
      { kind: 'intro', step: 'leads', group: 'The investigation' },
      ...items('lead', c.leads, 'The investigation'),
      { kind: 'intro', step: 'suspects', group: 'Suspects' },
      ...items('suspect', c.suspects, 'Suspects'),
      { kind: 'rules', group: 'Solution rules' },
      { kind: 'reveal', group: 'Reveal order' },
    ]
  }
  const keyOf = st => st.kind === 'intro' ? `intro:${st.step}` : st.id ? `${st.kind}:${st.id}` : st.kind
  const INTRO_FOR = { truth: 'truth', clue: 'clues', lead: 'leads', suspect: 'suspects' }

  // `at` is 'name', 'rules', 'reveal', 'truth:<id>', 'clue:<id>', 'lead:<id>', 'suspect:<id>', or 'add-truth' etc.
  function openBuilder(at = 'name') {
    _returnFocus = document.activeElement
    refreshCharacterOptions()
    _open = true
    $('case-builder-modal').classList.add('show')
    const notice = $('case-character-notice')
    if (notice) { notice.hidden = true; notice.innerHTML = '' }
    showSaveError(_saveError)
    if (at === 'add-truth') { go('intro:truth'); return addTruth() }
    if (at === 'add-clue') { go('intro:clues'); return addClue() }
    if (at === 'add-lead') { go('intro:leads'); return addLead() }
    if (at === 'add-suspect') { go('intro:suspects'); return addSuspect() }
    go(at)
  }

  async function closeBuilder() {
    if (!_open) return
    _open = false
    $('case-builder-modal').classList.remove('show')
    if (pruneBlank()) changed()
    const c = cur()
    if (c && !String(c.title || '').trim() && !c.revealSceneId && !c.revealLeadId
        && ['truth', 'clues', 'leads', 'suspects', 'rules'].every(key => !c[key].length)) {
      _cases.splice(_i, 1)
      _i = Math.max(0, _i - 1)
      changed()
    }
    renderView()          // show the edits right away; saving can finish behind it
    await flush()
    if (_returnFocus?.isConnected) _returnFocus.focus()
    else $('case-build')?.focus()
    _returnFocus = null
  }

  // On one page an item has no screen of its own: go to its group and scroll to its card.
  function go(key) {
    _steps = buildSteps()
    let card = null
    if (_onePage && typeof key === 'string') {
      const [kind, id] = key.split(':')
      if (INTRO_FOR[kind] && id) { card = `cb-card-${kind}-${id}`; key = `intro:${INTRO_FOR[kind]}` }
    }
    const i = typeof key === 'number' ? key : _steps.findIndex(st => keyOf(st) === key)
    _s = Math.max(0, Math.min(_steps.length - 1, i < 0 ? 0 : i))
    renderBuilder(card)
  }
  const here = () => keyOf(_steps[_s])

  function renderBuilder(card = null) {
    const c = cur()
    $('cb-heading').textContent = `Case: ${c.title || 'Untitled case'}`
    // Each group's own page (the case, what happened, clues, the investigation, suspects, rules,
    // reveal) is its heading in the rail; the steps, clues, stops and suspects nest under it.
    $('cb-rail').innerHTML = _steps.map((st, i) => {
      const heading = st.kind === 'name' || st.kind === 'intro' || st.kind === 'reveal' || st.kind === 'rules'
      return `<button type="button" class="sb-rail-step ${heading ? 'cb-rail-head' : 'cb-rail-item'}${i === _s ? ' active' : ''}" data-i="${i}">${railLabel(st)}</button>`
    }).join('')
    $('cb-rail').querySelectorAll('[data-i]').forEach(b => { b.onclick = () => go(Number(b.dataset.i)) })
    $('cb-rail').querySelector('.active')?.scrollIntoView({ block: 'nearest' })
    const st = _steps[_s]
    const body = $('cb-body')
    body.innerHTML = { name: nameScreen, intro: introScreen, truth: truthScreen, clue: clueScreen, lead: leadScreen, suspect: suspectScreen, rules: rulesScreen, reveal: revealScreen }[st.kind](st)
    body.scrollTop = 0
    bindBuilder(body)
    $('cb-back').disabled = _s === 0
    $('cb-next').style.display = _s === _steps.length - 1 ? 'none' : ''
    $('cb-mode').textContent = _onePage ? 'One at a time' : 'All on one page'
    const target = card && $(card)
    if (target) {
      target.scrollIntoView({ block: 'start' })
      target.querySelector('[data-autofocus]')?.focus({ preventScroll: true })
    } else if (!_onePage || st.kind !== 'intro') body.querySelector('[data-autofocus]')?.focus()
  }

  function railLabel(st) {
    const c = cur()
    const dot = on => `<i class="beat-dot" data-state="${on ? 'mine' : 'empty'}"></i>`
    // The case's own name heads the rail, and follows what's typed on the name screen.
    if (st.kind === 'name') return `<span class="stb-rail-label${c.title ? '' : ' cb-rail-unnamed'}">${esc(c.title || 'Name this case')}</span>`
    if (st.kind === 'intro') {
      const n = { truth: c.truth, clues: c.clues, leads: c.leads, suspects: c.suspects }[st.step].length
      return `<span class="stb-rail-label">${esc(st.group)}</span>${n ? `<span class="cb-rail-count">${n}</span>` : ''}`
    }
    if (st.kind === 'truth') {
      const t = c.truth.find(x => x.id === st.id), n = c.truth.indexOf(t) + 1
      return `${dot(t.title || t.what)}<span class="stb-rail-label">${n}. ${esc(clip(t.title || t.what || t.when ? stepName(t, n - 1) : 'New step', 28))}</span>`
    }
    if (st.kind === 'clue') {
      const cl = c.clues.find(x => x.id === st.id)
      return `${dot(cl.text && cl.job)}<span class="stb-rail-label">${esc(clip(cl.text || 'New clue', 28))}</span>${cl.key ? '<span class="stb-track" data-track="shared">key</span>' : ''}`
    }
    if (st.kind === 'lead') {
      const l = c.leads.find(x => x.id === st.id), n = c.leads.indexOf(l)
      const named = l.title || l.where
      return `${dot(named && (l.learned || l.theory))}<span class="stb-rail-label">${n + 1}. ${esc(clip(named ? K().leadName(l, n) : 'New stop', 28))}</span>`
    }
    if (st.kind === 'suspect') {
      const s = c.suspects.find(x => x.id === st.id)
      return `${dot(s.name)}<span class="stb-rail-label">${esc(clip(s.name || 'New suspect', 28))}</span>`
    }
    if (st.kind === 'rules') {
      const n = c.rules.filter(r => String(r.text || '').trim()).length
      return `<span class="stb-rail-label">Solution rules</span>${n ? `<span class="cb-rail-count">${n}</span>` : ''}`
    }
    return `<span class="stb-rail-label">Reveal order</span>${K().fairPlay(c, _scenes).length ? '<span class="case-warn-dot">!</span>' : ''}`
  }

  // Field helpers. data-f="coll:id:key" edits a truth step, clue, stop, suspect or rule;
  // "case::key" the case.
  const field = (label, f, value, { rows = 2, hint = '', placeholder = '', autofocus = false } = {}) =>
    `<label class="sb-field"><span class="stb-q">${esc(label)}</span>${hint ? `<span class="stb-hint">${esc(hint)}</span>` : ''}
      <textarea rows="${rows}" data-f="${f}" placeholder="${esc(placeholder)}"${autofocus ? ' data-autofocus' : ''}>${esc(value || '')}</textarea></label>`
  const line = (label, f, value, { hint = '', placeholder = '', list = '', autofocus = false } = {}) =>
    `<label class="sb-field"><span class="stb-q">${esc(label)}</span>${hint ? `<span class="stb-hint">${esc(hint)}</span>` : ''}
      <input data-f="${f}" value="${esc(value || '')}" placeholder="${esc(placeholder)}"${list ? ` list="${list}"` : ''}${autofocus ? ' data-autofocus' : ''}></label>`
  const chips = (label, f, value, options, extra = '') => {
    const chosen = options.find(o => o.id === value)
    return `<div class="sb-field"><span class="stb-q">${esc(label)}</span>
      <div class="sb-chips">${options.map(o => `<button type="button" class="sb-chip${o.id === value ? ' on' : ''}" data-chip="${f}" data-value="${esc(o.id)}"
        ${o.example ? ` title="${esc(o.example)}"` : ''}>${esc(o.label)}</button>`).join('')}${extra}</div>
      ${chosen?.example ? `<span class="case-example">${esc(chosen.example)}</span>` : ''}</div>`
  }
  const sceneOptions = value => [...new Set(_scenes.map(s => s.chapter))].map(ch => `<optgroup label="${esc(ch)}">${_scenes.filter(s => s.chapter === ch).map(s =>
    `<option value="${esc(s.id)}"${s.id === value ? ' selected' : ''}>${esc(s.title)}</option>`).join('')}</optgroup>`).join('')
  const sceneSelect = (label, f, value, { hint = '', blank = 'No scene yet' } = {}) =>
    `<label class="sb-field"><span class="stb-q">${esc(label)}</span>${hint ? `<span class="stb-hint">${esc(hint)}</span>` : ''}
      <select data-f="${f}"><option value="">${esc(blank)}</option>${sceneMissing(value) ? `<option value="${esc(value)}" selected disabled>⚠ Assigned scene is missing</option>` : ''}${sceneOptions(value)}</select></label>`
  // A scene or, for what isn't written yet, a stop. Stops are stored in the matching lead key.
  const placeSelect = (label, f, sceneId, leadId, { hint = '', blank = 'Not chosen yet' } = {}) => {
    const c = cur()
    const value = sceneId || (leadId ? `lead:${leadId}` : '')
    const missing = sceneMissing(sceneId) ? `<option value="${esc(sceneId)}" selected disabled>⚠ Assigned scene is missing</option>` : ''
    const stops = c.leads.length ? `<optgroup label="Investigation stops">${c.leads.map((l, n) =>
      `<option value="lead:${esc(l.id)}"${`lead:${l.id}` === value ? ' selected' : ''}>${esc(K().leadName(l, n))}${sceneTitle(l.sceneId) ? '' : ' (planned)'}</option>`).join('')}</optgroup>` : ''
    return `<label class="sb-field"><span class="stb-q">${esc(label)}</span>${hint ? `<span class="stb-hint">${esc(hint)}</span>` : ''}
      <select data-f="${f}" data-stops><option value="">${esc(blank)}</option>${missing}${sceneOptions(value)}${stops}</select></label>`
  }
  const moveBtns = (coll, id) => {
    const list = cur()[coll], n = list.findIndex(x => x.id === id)
    return `<span class="case-move"><button type="button" data-move="${coll}:${id}:-1" title="Move up" aria-label="Move up"${n === 0 ? ' disabled' : ''}>↑</button><button type="button"
      data-move="${coll}:${id}:1" title="Move down" aria-label="Move down"${n === list.length - 1 ? ' disabled' : ''}>↓</button></span>`
  }
  const pickRow = (card, coll, id) => `<div class="case-pick-row">${card}${moveBtns(coll, id)}</div>`
  // An item's screen, or its card on the one-page view.
  const itemCard = (kind, id, html) => _onePage ? `<section class="case-onepage-card" id="cb-card-${kind}-${id}">${html}</section>` : html

  function nameScreen() {
    const c = cur()
    return `<h4>The case</h4>
      <p class="stb-intro">Name it, then work down the list: what really happened, the clues it left, how the investigation finds them, who looks guilty, and when the truth comes out.</p>
      <span class="stb-q">What do you call this case?</span>
      <p class="stb-hint">Whatever you’d write on the folder: “Jessica Andersen”, “The silver thefts”, “The ambush”.</p>
      <input class="case-name-input" data-f="case::title" value="${esc(c.title)}" placeholder="Name this case" data-autofocus>
      ${_structureTruth ? `<div class="stb-recall case-recall-gap"><span class="sb-label">In your Structure, what really happened</span><div>${esc(_structureTruth)}</div></div>` : ''}
      <div class="stb-focus-foot"><button type="button" class="case-delete" id="cb-delete-case">Delete this case</button><span class="stb-keys">⌘↵ next · ⌘⇧↵ add another</span></div>`
  }

  // Intro screens lead with the step's action; reference material folds away. On one page the
  // group's items follow as cards.
  function introScreen({ step }) {
    const c = cur()
    const def = K().STEPS.find(s => s.id === step)
    const stepCard = (t, n, attrs, action) => `<button type="button" class="case-pick-card" ${attrs}>
        <span class="case-num">${n}</span>
        <span class="case-pick-text"><b>${esc(stepName(t, n - 1))}</b>
          ${t.when || t.who ? `<em>${esc([t.when, t.who].filter(Boolean).join(' · '))}</em>` : ''}
          ${t.title ? `<span>${esc(t.what || '— not written yet —')}</span>` : ''}
          ${t.mistake ? `<em>Went wrong: ${esc(t.mistake)}</em>` : ''}</span>
        ${action ? `<span class="case-pick-action">${esc(action)}</span>` : ''}</button>`
    const cards = (kind, list, screen) => list.map(x => itemCard(kind, x.id, screen({ id: x.id }))).join('')
    let body = ''
    if (step === 'truth') {
      body = _onePage ? cards('truth', c.truth, truthScreen)
        : c.truth.length ? `<div class="case-pick-list">${c.truth.map((t, i) => pickRow(stepCard(t, i + 1, `data-goto="truth:${t.id}"`, 'Edit'), 'truth', t.id)).join('')}</div>` : ''
      body += `<button type="button" class="btn sm primary" data-add="truth">${c.truth.length ? '+ Add what happened next' : 'Write the first step →'}</button>`
    } else if (step === 'clues') {
      body = `${c.truth.length ? `<span class="stb-q">Pick a step to make a clue from</span>
          <div class="case-pick-list">${c.truth.map((t, i) => stepCard(t, i + 1, `data-clue-from="${t.id}"`, '+ Clue')).join('')}</div>
          <button type="button" class="case-link" data-add="clue">+ Add a clue that isn’t from a step</button>`
        : `<button type="button" class="btn sm primary" data-add="clue">+ Add a clue</button>`}
        ${!c.clues.length ? '' : _onePage ? `<span class="stb-q case-gap">Your clues</span>${cards('clue', c.clues, clueScreen)}`
          : `<span class="stb-q case-gap">Your clues</span><div class="case-pick-list">${c.clues.map(cl => pickRow(
          `<button type="button" class="case-pick-card" data-goto="clue:${cl.id}"><span class="case-pick-text"><b>${esc(cl.text || 'Untitled clue')}</b>
            <em>${esc([K().label(K().KINDS, cl.kind), K().label(K().JOBS, cl.job), cl.key ? 'Key' : ''].filter(Boolean).join(' · ') || 'Not described yet')}</em></span>
            <span class="case-pick-action">Edit</span></button>`, 'clues', cl.id)).join('')}</div>`}`
    } else if (step === 'leads') {
      body = _onePage ? cards('lead', c.leads, leadScreen)
        : c.leads.length ? `<div class="case-pick-list">${c.leads.map((l, n) => pickRow(`<button type="button" class="case-pick-card" data-goto="lead:${l.id}">
            <span class="case-num">${n + 1}</span>
            <span class="case-pick-text"><b>${esc(K().leadName(l, n))}</b>
              ${l.learned ? `<span>${esc(l.learned)}</span>` : ''}
              ${l.theory ? `<em>Believes now: ${esc(l.theory)}</em>` : ''}
              <em>${esc(sceneTitle(l.sceneId) || (l.planned ? `Planned: ${l.planned}` : 'Not written yet'))}</em></span>
            <span class="case-pick-action">Edit</span></button>`, 'leads', l.id)).join('')}</div>` : ''
      body += `<button type="button" class="btn sm primary" data-add="lead">${c.leads.length ? '+ Add the next stop' : 'Add the first stop →'}</button>`
    } else {
      const named = new Set(c.suspects.map(x => x.name))
      const chars = _chars.filter(ch => !named.has(ch.name))
      body = chars.length ? `<span class="stb-q">Add from your characters</span>
          <div class="sb-chips">${chars.map(ch => `<button type="button" class="sb-chip" data-suspect-from="${esc(ch.name)}">+ ${esc(ch.name)}</button>`).join('')}
            <button type="button" class="sb-chip case-chip-new" data-add="suspect">+ Someone else</button></div>`
        : `<button type="button" class="btn sm primary" data-add="suspect">+ Add a suspect</button>`
      if (c.suspects.length) body += `<span class="stb-q case-gap">Your suspects</span>${_onePage ? cards('suspect', c.suspects, suspectScreen)
        : `<div class="case-pick-list">${c.suspects.map(su => pickRow(
        `<button type="button" class="case-pick-card" data-goto="suspect:${su.id}"><span class="case-pick-text"><b>${esc(su.name || 'Unnamed suspect')}</b>
          <em>${esc([su.culprit ? 'Culprit' : '', su.motive ? `Motive: ${su.motive}` : ''].filter(Boolean).join(' · ') || 'Not described yet')}</em></span>
          <span class="case-pick-action">Edit</span></button>`, 'suspects', su.id)).join('')}</div>`}`
    }
    return `<h4>${esc(def.label)}</h4><p class="stb-intro">${esc(def.hint)}</p>${body}`
  }

  function truthScreen({ id }) {
    const c = cur()
    const t = c.truth.find(x => x.id === id), n = c.truth.indexOf(t) + 1
    const fromThis = c.clues.filter(cl => cl.truthId === id)
    return `<div class="stb-kicker">What really happened · step ${n} of ${c.truth.length}</div>
      ${n > 1 && !_onePage ? `<div class="stb-recall"><span class="sb-label">Before this</span><div>${esc(stepName(c.truth[n - 2], n - 2))}</div></div>` : ''}
      ${line('Name this step', `truth:${id}:title`, t.title, { hint: 'A few words, like a chapter heading. It’s how this step shows up everywhere else.', placeholder: 'The feeding room', autofocus: true })}
      <div class="sb-two">${line('When', `truth:${id}:when`, t.when, { placeholder: 'Friday, 2 AM' })}${line('Who', `truth:${id}:who`, t.who, { placeholder: 'Who did it', list: 'cb-characters' })}</div>
      ${field('What did they do?', `truth:${id}:what`, t.what, { rows: 3 })}
      ${field('What went wrong, or what did they leave loose?', `truth:${id}:mistake`, t.mistake, { hint: 'This is usually where a clue comes from.' })}
      ${fromThis.length ? `<div class="stb-recall"><span class="sb-label">Clues from this step</span>${fromThis.map(cl => `<button type="button" class="case-recall-link" data-goto="clue:${cl.id}">${esc(cl.text || 'Untitled clue')}</button>`).join('')}</div>` : ''}
      <div class="case-actions">
        <button type="button" class="btn sm" data-clue-from="${id}">+ Make a clue from this</button>
        <button type="button" class="btn sm" data-add="truth" data-after="${id}">+ Add what happened next</button>
        ${moveBtns('truth', id)}
        <button type="button" class="case-delete" data-del="truth:${id}">Delete this step</button>
      </div>`
  }

  function clueScreen({ id }) {
    const c = cur()
    const cl = c.clues.find(x => x.id === id), n = c.clues.indexOf(cl) + 1
    const from = c.truth.find(t => t.id === cl.truthId)
    const suspects = c.suspects.filter(s => s.name).map(s => ({ id: s.id, label: s.name }))
    const leads = c.leads.map((l, i) => ({ id: l.id, label: clip(K().leadName(l, i), 32) }))
    const stop = c.leads.find(l => l.id === cl.leadId)
    const viaStop = !cl.foundSceneId && stop && sceneTitle(stop.sceneId)
    const newSuspect = `<span class="case-inline-new"><input data-new-suspect="${id}" placeholder="+ Someone new" list="cb-characters" aria-label="Add a suspect"></span>`
    // Back to where this clue came from, and on to the next step, so working through the steps
    // one clue at a time doesn't lose the place.
    const next = from && c.truth[c.truth.indexOf(from) + 1]
    const trail = [
      from ? `<button type="button" class="btn sm" data-goto="truth:${from.id}">← Back to step ${c.truth.indexOf(from) + 1}</button>` : '',
      next ? `<button type="button" class="btn sm" data-goto="truth:${next.id}">Next step: ${esc(clip(stepName(next, c.truth.indexOf(next)), 28))} →</button>` : '',
      stop ? `<button type="button" class="btn sm" data-goto="lead:${stop.id}">← Back to ${esc(clip(K().leadName(stop, c.leads.indexOf(stop)), 28))}</button>` : '',
    ].filter(Boolean).join('')
    return `<div class="stb-kicker">Clue ${n} of ${c.clues.length}</div>
      ${from ? `<div class="stb-recall"><span class="sb-label">From this step: ${esc(stepName(from, c.truth.indexOf(from)))}</span><div>${esc(from.what || '')}${from.mistake ? ` (went wrong: ${esc(from.mistake)})` : ''}</div></div>` : ''}
      ${field('What is the clue?', `clues:${id}:text`, cl.text, { autofocus: true, placeholder: 'The motel booking in a fake name' })}
      ${chips('What kind of clue is it?', `clues:${id}:kind`, cl.kind, K().KINDS)}
      ${chips('What’s its job?', `clues:${id}:job`, cl.job, K().JOBS)}
      ${cl.job === 'double' ? field('What does it turn out to mean?', `clues:${id}:meansLater`, cl.meansLater) : ''}
      ${chips('Who does it point to?', `clues:${id}:suspectId`, cl.suspectId, suspects, newSuspect)}
      ${line('Or what does it point to?', `clues:${id}:pointsTo`, cl.pointsTo, { placeholder: 'a place, a thing, a theory' })}
      <label class="case-toggle"><input type="checkbox" data-f="clues:${id}:key"${cl.key ? ' checked' : ''}> <span><b>Key clue.</b> The solution depends on it, so the reader has to see it before the reveal.</span></label>
      <div class="case-divider">How it’s found</div>
      ${chips('How does the investigation turn it up?', `clues:${id}:method`, cl.method, K().METHODS)}
      ${leads.length ? chips('During which stop?', `clues:${id}:leadId`, cl.leadId, leads) : ''}
      ${sceneSelect('In which scene?', `clues:${id}:foundSceneId`, cl.foundSceneId, { hint: viaStop ? `Left blank, it’s in ${viaStop}, where its stop is.` : '' })}
      ${planSceneButton(cl.foundSceneId || stop?.sceneId)
        || createSceneControl(stop ? `leads:${stop.id}:sceneId` : `clues:${id}:foundSceneId`, stop?.title || cl.text || 'Clue scene',
          sceneMissing(cl.foundSceneId || stop?.sceneId))}
      ${sceneSelect('Also shown in', `also:${id}`, '', { hint: 'Important clues usually show up about three times.', blank: '+ Add another scene' })}
      ${(cl.alsoSceneIds || []).length ? `<div class="sb-chips">${cl.alsoSceneIds.map(s => `<span class="sb-chip on">${esc(sceneTitle(s) || 'Missing scene')}
        <button type="button" class="sb-extra-del" data-unalso="${id}|${esc(s)}" title="Remove this scene" aria-label="Remove ${esc(sceneTitle(s) || 'scene')}">×</button></span>`).join('')}</div>` : ''}
      ${chips('Where does it send them next?', `clues:${id}:leadsTo`, cl.leadsTo, leads.filter(l => l.id !== cl.leadId),
        `<button type="button" class="sb-chip case-chip-new" data-new-lead-from="${id}">+ New stop</button>`)}
      ${field('Note', `clues:${id}:note`, cl.note, { placeholder: 'Who finds it, and what it looks like at first' })}
      ${trail ? `<div class="case-actions case-trail">${trail}</div>` : ''}
      <div class="case-actions">
        <button type="button" class="btn sm" data-add="clue">+ Add another clue</button>
        ${moveBtns('clues', id)}
        <button type="button" class="case-delete" data-del="clues:${id}">Delete this clue</button>
      </div>`
  }

  function leadScreen({ id }) {
    const c = cur()
    const l = c.leads.find(x => x.id === id), n = c.leads.indexOf(l)
    const prev = c.leads[n - 1]
    const into = c.clues.filter(cl => cl.leadsTo === id)
    const found = c.clues.filter(cl => cl.leadId === id)
    const clueLink = (cl, extra = '') => `<button type="button" class="case-recall-link" data-goto="clue:${cl.id}">${esc(cl.text || 'Untitled clue')}${extra}</button>`
    return `<div class="stb-kicker">The investigation · stop ${n + 1} of ${c.leads.length}</div>
      ${prev && !_onePage ? `<div class="stb-recall"><span class="sb-label">Before this: ${esc(K().leadName(prev, n - 1))}</span>${prev.theory ? `<div>They believed: ${esc(prev.theory)}</div>` : ''}</div>` : ''}
      ${into.length ? `<div class="stb-recall"><span class="sb-label">What sent them here</span>${into.map(cl => clueLink(cl)).join('')}</div>` : ''}
      ${line('Name this stop', `leads:${id}:title`, l.title, { hint: 'A place, a person, a lead: how this stop shows up everywhere else.', placeholder: 'Harbor Motel, room 22', autofocus: true })}
      <div class="sb-two">${line('Where do they go?', `leads:${id}:where`, l.where, { placeholder: 'The motel office' })}${line('Who do they talk to?', `leads:${id}:who`, l.who, { placeholder: 'The night clerk', list: 'cb-characters' })}</div>
      ${field('What do they find out?', `leads:${id}:learned`, l.learned, { rows: 3 })}
      ${field('What do they believe now?', `leads:${id}:theory`, l.theory, { hint: 'Their working theory after this stop. It’s fine if it’s wrong; that’s the middle of the book.' })}
      ${sceneSelect('Which scene is it?', `leads:${id}:sceneId`, l.sceneId, { blank: 'Not written yet' })}
      ${planSceneButton(l.sceneId) || createSceneControl(`leads:${id}:sceneId`, l.title || l.where || 'Investigation stop', sceneMissing(l.sceneId))}
      ${l.sceneId ? '' : line('Or where is it planned?', `leads:${id}:planned`, l.planned, { placeholder: 'Chapter 7, after the funeral' })}
      ${found.length ? `<div class="stb-recall"><span class="sb-label">Clues found here</span>${found.map(cl =>
        clueLink(cl, cl.leadsTo && leadName(c, cl.leadsTo) ? ` → ${esc(leadName(c, cl.leadsTo))}` : '')).join('')}</div>` : ''}
      <div class="case-actions">
        <button type="button" class="btn sm" data-clue-at="${id}">+ Clue found here</button>
        <button type="button" class="btn sm" data-add="lead" data-after="${id}">+ Add the next stop</button>
        ${moveBtns('leads', id)}
        <button type="button" class="case-delete" data-del="leads:${id}">Delete this stop</button>
      </div>`
  }

  function suspectScreen({ id }) {
    const c = cur()
    const s = c.suspects.find(x => x.id === id), n = c.suspects.indexOf(s) + 1
    const herrings = c.clues.filter(cl => cl.job === 'herring' && cl.suspectId === id && cl.text)
    return `<div class="stb-kicker">Suspects · ${n} of ${c.suspects.length}</div>
      ${line('Who is it?', `suspects:${id}:name`, s.name, { hint: 'Pick one of your characters or type a name.', list: 'cb-characters', autofocus: true })}
      <label class="case-toggle"><input type="checkbox" data-f="suspects:${id}:culprit"${s.culprit ? ' checked' : ''}> <span><b>Culprit.</b> They did it.</span></label>
      ${field('Means: could they have done it?', `suspects:${id}:means`, s.means)}
      ${field('Motive: why would they?', `suspects:${id}:motive`, s.motive)}
      ${field('Opportunity: were they there, or able to be?', `suspects:${id}:opportunity`, s.opportunity)}
      ${field('What are they hiding?', `suspects:${id}:hiding`, s.hiding, { hint: 'Innocent people hide things too. That’s where red herrings come from.' })}
      ${s.culprit ? '' : field('What clears them?', `suspects:${id}:clearedBy`, s.clearedBy)}
      ${herrings.length ? `<div class="stb-recall"><span class="sb-label">Red herrings pointing here</span>${herrings.map(h => `<div>${esc(h.text)}</div>`).join('')}</div>` : ''}
      <div class="case-actions">
        <button type="button" class="btn sm" data-add="suspect">+ Add another suspect</button>
        ${moveBtns('suspects', id)}
        <button type="button" class="case-delete" data-del="suspects:${id}">Delete this suspect</button>
      </div>`
  }

  function rulesScreen() {
    const c = cur()
    const def = K().STEPS.find(s => s.id === 'rules')
    return `<h4>${esc(def.label)}</h4><p class="stb-intro">${esc(def.hint)}</p>
      <div class="case-rules">${c.rules.map((r, n) => `<div class="case-rule">
        ${field(`Rule ${n + 1}`, `rules:${r.id}:text`, r.text, { rows: 1, placeholder: 'DNA results take three days; compulsion requires a voice', autofocus: n === c.rules.length - 1 && !r.text })}
        ${placeSelect('Where does the reader learn it?', `rules:${r.id}:sceneId`, r.sceneId, r.leadId, { blank: 'Not shown yet' })}
        ${planSceneButton(r.sceneId || c.leads.find(l => l.id === r.leadId)?.sceneId)}
        <button type="button" class="case-delete" data-del="rules:${r.id}">Delete</button></div>`).join('')}</div>
      <button type="button" class="btn sm${c.rules.length ? '' : ' primary'}" data-add="rule">+ Add a rule</button>`
  }

  function revealScreen() {
    const c = cur()
    const warnings = K().fairPlay(c, _scenes)
    const notes = K().notes(c, _scenes)
    const jump = w => { const at = warningTarget(w); return at === 'reveal' ? '' : at }
    return `<h4>Reveal order</h4>
      <p class="stb-intro">${esc(K().STEPS.find(s => s.id === 'reveal').hint)}</p>
      ${placeSelect('Where does the truth come out?', 'case::revealSceneId', c.revealSceneId, c.revealLeadId)}
      ${planSceneButton(c.revealSceneId || c.leads.find(l => l.id === c.revealLeadId)?.sceneId)
        || createSceneControl(c.revealLeadId ? `leads:${c.revealLeadId}:sceneId` : 'case::revealSceneId', `${c.title || 'Case'} reveal`,
          sceneMissing(c.revealSceneId || c.leads.find(l => l.id === c.revealLeadId)?.sceneId))}
      <div class="case-warnings">${warnings.length ? warnings.map(w => `<button type="button" class="case-warning" data-jump="${esc(jump(w))}">⚠ ${esc(w.text)}</button>`).join('')
        : c.clues.length ? '<div class="case-ok">Every key clue is on the page before the reveal.</div>' : ''}
        ${notes.map(w => `<button type="button" class="case-note" data-jump="${esc(jump(w))}">${esc(w.text)}</button>`).join('')}</div>
      ${pacingHTML(c)}
      <div class="case-order">${revealListHTML(c)}</div>`
  }

  function bindBuilder(body) {
    const c = cur()
    body.querySelectorAll('textarea').forEach(el => { requestAnimationFrame(() => autosize(el)); el.addEventListener('input', () => autosize(el)) })
    body.querySelectorAll('[data-f]').forEach(el => {
      const [coll, id, key] = el.dataset.f.split(':')
      const redraw = el.tagName === 'SELECT' || el.type === 'checkbox'
      el.addEventListener(redraw ? 'change' : 'input', () => {
        if (coll === 'also') {
          const clue = c.clues.find(x => x.id === id)
          if (el.value && !clue.alsoSceneIds.includes(el.value)) clue.alsoSceneIds.push(el.value)
        } else {
          const item = coll === 'case' ? c : c[coll].find(x => x.id === id)
          if (el.hasAttribute('data-stops')) {
            // One picker, two keys: a scene, or a stop that isn't written yet.
            const leadKey = key === 'revealSceneId' ? 'revealLeadId' : 'leadId'
            const stop = el.value.startsWith('lead:')
            item[key] = stop ? '' : el.value
            item[leadKey] = stop ? el.value.slice(5) : ''
          } else item[key] = el.type === 'checkbox' ? el.checked : el.value
          if (coll === 'suspects' && key === 'name') {
            const match = _chars.find(ch => String(ch.name || '').trim().toLocaleLowerCase() === el.value.trim().toLocaleLowerCase())
            if (match) item.characterId = match.id
          }
        }
        changed()
        if (redraw) keepScroll(() => go(here()))
        else refreshRail()
      })
      if (coll === 'suspects' && key === 'name') {
        el.addEventListener('blur', () => syncSuspectCharacter(c.suspects.find(x => x.id === id)))
      }
    })
    body.querySelectorAll('[data-chip]').forEach(b => {
      b.onclick = () => {
        const [coll, id, key] = b.dataset.chip.split(':')
        const item = c[coll].find(x => x.id === id)
        item[key] = item[key] === b.dataset.value ? '' : b.dataset.value
        changed(); keepScroll(() => go(here()))
      }
    })
    body.querySelectorAll('[data-unalso]').forEach(b => {
      b.onclick = () => {
        const [id, scene] = b.dataset.unalso.split('|')
        const clue = c.clues.find(x => x.id === id)
        clue.alsoSceneIds = clue.alsoSceneIds.filter(s => s !== scene)
        changed(); keepScroll(() => go(here()))
      }
    })
    body.querySelectorAll('[data-add]').forEach(b => {
      b.onclick = () => ({ truth: () => addTruth(b.dataset.after), clue: () => addClue(), lead: () => addLead(b.dataset.after),
        suspect: () => addSuspect(), rule: addRule })[b.dataset.add]()
    })
    body.querySelectorAll('[data-clue-from]').forEach(b => { b.onclick = () => addClue(b.dataset.clueFrom) })
    body.querySelectorAll('[data-clue-at]').forEach(b => { b.onclick = () => addClue('', b.dataset.clueAt) })
    body.querySelectorAll('[data-new-lead-from]').forEach(b => {
      b.onclick = () => {
        const clue = c.clues.find(x => x.id === b.dataset.newLeadFrom)
        const lead = addLead(clue.leadId, { open: false })
        clue.leadsTo = lead.id
        changed(); go(`lead:${lead.id}`)
      }
    })
    // A suspect added from the clue that points at them, without leaving the clue.
    body.querySelectorAll('[data-new-suspect]').forEach(el => {
      el.addEventListener('keydown', e => {
        if (e.key !== 'Enter' || e.metaKey || e.ctrlKey || !el.value.trim()) return
        e.preventDefault()
        const s = addSuspect(el.value.trim(), { open: false })
        c.clues.find(x => x.id === el.dataset.newSuspect).suspectId = s.id
        changed(); keepScroll(() => go(here()))
      })
    })
    body.querySelectorAll('[data-goto]').forEach(b => { b.onclick = () => go(b.dataset.goto) })
    body.querySelectorAll('[data-suspect-from]').forEach(b => { b.onclick = () => addSuspect(b.dataset.suspectFrom) })
    body.querySelectorAll('[data-move]').forEach(b => {
      b.onclick = () => {
        const [coll, id, dir] = b.dataset.move.split(':')
        const list = c[coll], n = list.findIndex(x => x.id === id), to = n + Number(dir)
        if (n < 0 || to < 0 || to >= list.length) return
        list.splice(to, 0, list.splice(n, 1)[0])
        changed(); keepScroll(() => go(here()))
      }
    })
    body.querySelectorAll('[data-del]').forEach(b => {
      b.onclick = () => {
        const [coll, id] = b.dataset.del.split(':')
        if (!confirm(`Delete ${{ truth: 'this step', clues: 'this clue', leads: 'this stop', suspects: 'this suspect', rules: 'this rule' }[coll]}?`)) return
        c[coll] = c[coll].filter(x => x.id !== id)
        dropRefs(c)
        changed()
        // An item's own screen is gone; a page that lists it (intro, rules, one page) stays.
        if (_steps[_s].id === id) go(Math.max(0, _s - 1))
        else keepScroll(() => go(here()))
      }
    })
    body.querySelectorAll('[data-jump]').forEach(b => { b.onclick = () => b.dataset.jump && go(b.dataset.jump) })
    body.querySelectorAll('[data-plan-scene]').forEach(b => {
      b.onclick = async () => {
        b.disabled = true
        if (!(await flush())) { b.disabled = false; return }
        const scenePath = b.dataset.planScene
        await closeBuilder()
        if (!(await Landing.openScenePlan?.(scenePath))) alert('That scene could not be opened in the Scene Builder.')
      }
    })
    body.querySelectorAll('[data-create-scene]').forEach(b => {
      b.onclick = async () => {
        const target = b.dataset.createScene
        const chapter = [...body.querySelectorAll('[data-create-chapter]')]
          .find(el => el.dataset.createChapter === target)?.value
        if (!chapter) return
        b.disabled = true
        const [coll, id, key] = target.split(':')
        const item = coll === 'case' ? c : c[coll].find(entry => entry.id === id)
        if (!item || !key) {
          alert('The case item could not be linked to a new scene.')
          b.disabled = false
          return
        }
        const liveTitle = coll === 'leads' ? item.title || item.where
          : coll === 'clues' ? item.text
            : coll === 'rules' ? item.text
              : `${c.title || 'Case'} reveal`
        const created = await window.quill.newFile({
          folder: chapter, title: liveTitle || b.dataset.sceneTitle || '', folder_type: 'novel',
        }).catch(error => ({ ok: false, error: error.message }))
        if (!created?.path || !created.scene_id) {
          alert(created?.error || 'Could not create that scene.')
          b.disabled = false
          return
        }
        await App.addBoardCard(chapter, created.title).catch(() => {})
        item[key] = created.scene_id
        if (coll === 'leads') item.planned = ''
        changed()
        if (!(await flush())) { b.disabled = false; return }
        await closeBuilder()
        await Tree.refresh()
        if (!(await Landing.openScenePlan?.(created.path))) alert('The scene was created, but its plan could not be opened.')
      }
    })
    const del = body.querySelector('#cb-delete-case')
    if (del) del.onclick = deleteCase
  }

  // Typing changes rail labels and dots without redrawing the screen being typed in.
  function refreshRail() {
    $('cb-rail').querySelectorAll('[data-i]').forEach(b => { b.innerHTML = railLabel(_steps[Number(b.dataset.i)]) })
    $('cb-heading').textContent = `Case: ${cur().title || 'Untitled case'}`
  }

  // New items go after `after` (an id in the same list) when given, else at the end.
  const insertAt = (list, after) => { const n = list.findIndex(x => x.id === after); return n < 0 ? list.length : n + 1 }
  function addTruth(after = '') {
    const c = cur()
    const t = { id: uid(), title: '', when: '', who: '', what: '', mistake: '' }
    c.truth.splice(insertAt(c.truth, after), 0, t)
    changed(); go(`truth:${t.id}`)
  }
  function addClue(truthId = '', leadId = '') {
    const cl = { id: uid(), text: '', kind: '', job: '', pointsTo: '', suspectId: '', meansLater: '', key: false,
      truthId, leadId, leadsTo: '', method: '', foundSceneId: '', alsoSceneIds: [], note: '' }
    cur().clues.push(cl)
    changed(); go(`clue:${cl.id}`)
  }
  function addLead(after = '', { open = true } = {}) {
    const c = cur()
    const l = { id: uid(), title: '', where: '', who: '', learned: '', theory: '', sceneId: '', planned: '' }
    c.leads.splice(insertAt(c.leads, after), 0, l)
    changed()
    if (open) go(`lead:${l.id}`)
    return l
  }
  function addSuspect(name = '', { open = true } = {}) {
    const s = { id: uid(), name, characterId: _chars.find(ch => ch.name === name)?.id || '', means: '', motive: '', opportunity: '', hiding: '', clearedBy: '', culprit: false }
    cur().suspects.push(s)
    changed()
    if (name) syncSuspectCharacter(s)
    if (open) go(`suspect:${s.id}`)
    return s
  }
  function addRule() {
    cur().rules.push({ id: uid(), text: '', sceneId: '', leadId: '' })
    changed(); go('rules')
  }
  // "Add another" of whatever's on screen.
  function addHere() {
    const st = _steps[_s]
    const kind = st.kind === 'intro' ? { truth: 'truth', clues: 'clue', leads: 'lead', suspects: 'suspect' }[st.step] : st.kind
    const fn = { truth: () => addTruth(st.id), clue: () => addClue(), lead: () => addLead(st.id), suspect: () => addSuspect(), rules: addRule }[kind]
    if (fn) fn()
  }

  function autosize(el) { el.style.height = 'auto'; el.style.height = el.scrollHeight + 2 + 'px' }
  function keepScroll(fn) {
    const body = $('cb-body')
    const top = body.scrollTop
    const active = document.activeElement
    const focus = active && body.contains(active) ? {
      id: active.id || '', f: active.dataset?.f || '', chip: active.dataset?.chip || '',
      value: active.dataset?.value || '', newSuspect: active.dataset?.newSuspect || '',
      start: typeof active.selectionStart === 'number' ? active.selectionStart : null,
      end: typeof active.selectionEnd === 'number' ? active.selectionEnd : null,
    } : null
    fn()
    body.scrollTop = top
    if (!focus) return
    const candidates = [...body.querySelectorAll('input,textarea,select,button')]
    const target = (focus.id && $(focus.id)) || candidates.find(el =>
      (focus.f && el.dataset.f === focus.f)
      || (focus.chip && el.dataset.chip === focus.chip && el.dataset.value === focus.value)
      || (focus.newSuspect && el.dataset.newSuspect === focus.newSuspect))
    target?.focus({ preventScroll: true })
    if (target && focus.start !== null && typeof target.setSelectionRange === 'function') {
      target.setSelectionRange(focus.start, focus.end)
    }
  }

  // Links to steps, stops and suspects that are gone.
  function dropRefs(c) {
    const has = list => { const ids = new Set(list.map(x => x.id)); return id => (ids.has(id) ? id : '') }
    const truth = has(c.truth), lead = has(c.leads), suspect = has(c.suspects)
    for (const cl of c.clues) {
      cl.truthId = truth(cl.truthId); cl.suspectId = suspect(cl.suspectId)
      cl.leadId = lead(cl.leadId); cl.leadsTo = lead(cl.leadsTo)
    }
    for (const r of c.rules) r.leadId = lead(r.leadId)
    c.revealLeadId = lead(c.revealLeadId)
    const clue = has(c.clues)
    for (const k of Object.keys(c.board)) {
      const [kind, id] = k.split(':')
      if ((kind === 'suspect' && !suspect(id)) || (kind === 'clue' && !clue(id))) delete c.board[k]
    }
  }

  // Steps, clues, stops, suspects and rules added but never filled in don't stay behind.
  function pruneBlank() {
    const c = cur()
    if (!c) return false
    const blank = (item, keys) => keys.every(k => !String(item[k] || '').trim())
    const count = () => c.truth.length + c.clues.length + c.leads.length + c.suspects.length + c.rules.length
    const before = count()
    c.truth = c.truth.filter(t => !blank(t, ['title', 'when', 'who', 'what', 'mistake']))
    c.clues = c.clues.filter(cl => !blank(cl, ['text', 'kind', 'job', 'pointsTo', 'meansLater', 'method', 'foundSceneId', 'note']) || cl.key)
    c.leads = c.leads.filter(l => !blank(l, ['title', 'where', 'who', 'learned', 'theory', 'sceneId', 'planned']))
    c.suspects = c.suspects.filter(su => !blank(su, ['name', 'means', 'motive', 'opportunity', 'hiding', 'clearedBy']) || su.culprit)
    c.rules = c.rules.filter(r => String(r.text || '').trim())
    if (count() === before) return false
    dropRefs(c)
    return true
  }

  // ── Cases ───────────────────────────────────────────────────
  function newCase() {
    _cases.push(K().blankCase(''))
    _i = _cases.length - 1
    changed()
    renderView()
    openBuilder('name')
  }
  async function deleteCase() {
    if (!confirm(`Delete the case “${cur().title || 'Untitled case'}”? Its steps, clues and suspects go with it.`)) return
    _cases.splice(_i, 1)
    _i = Math.max(0, _i - 1)
    changed()
    if (_open) return closeBuilder()
    renderView()
    await flush()
  }
  async function copyCase(btn) {
    try {
      await navigator.clipboard.writeText(K().toMarkdown(cur(), { scenes: _scenes }))
      btn.textContent = 'Copied'
    } catch { btn.textContent = 'Couldn’t copy' }
    setTimeout(() => { btn.textContent = 'Copy case' }, 1600)
  }

  // Keeps the item on screen when switching: on one page, its card; one at a time, its screen.
  function toggleOnePage() {
    const st = _steps[_s]
    _onePage = !_onePage
    go(st.kind === 'intro' || !INTRO_FOR[st.kind] ? keyOf(st) : `${st.kind}:${st.id}`)
  }

  function init() {
    $('cb-close').onclick = () => closeBuilder()
    $('cb-done').onclick = () => closeBuilder()
    $('cb-back').onclick = () => go(_s - 1)
    $('cb-next').onclick = () => go(_s + 1)
    $('cb-mode').onclick = () => toggleOnePage()
    $('case-builder-modal').addEventListener('keydown', e => {
      if (e.key === 'Escape') { e.stopPropagation(); closeBuilder() }
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); if (e.shiftKey) addHere(); else go(_s + 1) }
      if (e.key === 'Tab') trapFocus(e, $('case-builder-modal'))
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
  return { load, flush, open: at => openBuilder(at), close: closeBuilder, isOpen: () => _open }
})()
