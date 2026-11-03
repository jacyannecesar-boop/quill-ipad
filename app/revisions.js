/* revisions.js — the renderer half of 💡 revision notes.
 *
 * The callout itself is an editor node (src/editor/revision-note.js). This module is its
 * host: it knows the novel (chapters, characters, every open note and the archive, all from
 * one `get-revision-notes` read), draws the "Applies to" scope row and its picker, places
 * ghost callouts for notes scoped to the open scene, and renders the overview and archive in
 * the novel's Audit tab, the Inspector list and the character sheet.
 *
 * Nothing here decides whether a note is open: that is the marker in the scene file. Closing
 * a callout deletes it from the document; main archives it on the next save.
 */
const RevisionNotes = (() => {
  const esc = s => escapeHtml(s)
  const Rev = () => window.QuillRevisions

  let _novel = null
  let _payload = null
  let _pending = null
  const _scopes = new Map()     // id -> scope, including edits not yet seen in a payload

  function novelOf(rel) { return rel ? String(rel).split('/')[0] : null }

  async function load(novelRel, { force = false } = {}) {
    if (!novelRel) return null
    if (!force && _novel === novelRel && _payload) return _payload
    if (!force && _novel === novelRel && _pending) return _pending
    _novel = novelRel
    const request = window.quill.getRevisionNotes(novelRel).then(result => {
      if (_novel !== novelRel) return _payload
      _payload = result?.ok ? result : null
      if (_payload) for (const note of [..._payload.open, ..._payload.archive]) _scopes.set(note.id, note.scope)
      redrawRows()
      return _payload
    }).catch(() => null).finally(() => { if (_pending === request) _pending = null })
    _pending = request
    return request
  }

  // ── where the writer is ─────────────────────────────────────────────────────
  function chapterView() { return typeof Chapter !== 'undefined' && Chapter.isOpen?.() }

  function currentScenePath(sceneRel) {
    if (sceneRel) return sceneRel
    return typeof Editor !== 'undefined' ? Editor.currentPath?.() : null
  }

  function sceneInfo(path) {
    return _payload?.scenes.find(scene => scene.path === path) || null
  }

  function scopeFor(id, scenePath) {
    if (_scopes.has(id)) return _scopes.get(id)
    const scene = sceneInfo(scenePath)
    return Rev().defaultScope({ chapterId: scene?.chapter_id, sceneId: scene?.scene_id })
  }

  // ── labels ──────────────────────────────────────────────────────────────────
  function chapterTitle(id) {
    return _payload?.chapters.find(chapter => chapter.id === id)?.title || 'a removed chapter'
  }

  function sceneTitle(id) {
    return _payload?.scenes.find(scene => scene.scene_id === id)?.title || 'a removed scene'
  }

  function scopeParts(scope, hereSceneId = null) {
    const parts = []
    if (scope?.book) parts.push({ kind: 'book', label: 'Whole book' })
    for (const id of scope?.chapters || []) parts.push({ kind: 'chapter', id, label: chapterTitle(id) })
    for (const id of scope?.scenes || []) parts.push({ kind: 'scene', id, label: id === hereSceneId ? 'This scene' : sceneTitle(id) })
    for (const name of scope?.characters || []) parts.push({ kind: 'character', id: name, label: name })
    return parts
  }

  function scopeText(scope) {
    const parts = scopeParts(scope)
    return parts.length ? 'Applies to ' + parts.map(part => part.label).join(', ') : 'Applies here only'
  }

  function homeLabel(note) {
    return [note.chapter_title, note.home_title].filter(Boolean).join(' · ')
  }

  // ── toast ───────────────────────────────────────────────────────────────────
  let _toastTimer = null
  function toast(message, action) {
    let node = document.getElementById('rv-toast')
    if (!node) {
      node = document.createElement('div')
      node.id = 'rv-toast'
      node.setAttribute('role', 'status')
      document.body.appendChild(node)
    }
    node.innerHTML = `<span>${esc(message)}</span>`
    if (action) {
      const button = document.createElement('button')
      button.type = 'button'
      button.textContent = action.label
      button.onclick = () => { node.classList.remove('show'); action.run() }
      node.appendChild(button)
    }
    node.classList.add('show')
    clearTimeout(_toastTimer)
    _toastTimer = setTimeout(() => node.classList.remove('show'), 6000)
  }

  // ── scope row + picker (inside the callout) ─────────────────────────────────
  // Callouts draw their scope row as soon as they mount, often from the previous scene's
  // payload; every fresh payload redraws the rows still on screen.
  const _rows = new Map()   // element -> { id, text, scenePath }
  function redrawRows() {
    if (!_payload) return
    for (const [element, row] of _rows) {
      if (!element.isConnected) { _rows.delete(element); continue }
      if (novelOf(row.scenePath) === _novel) drawScope(element, row.id, row.text, row.scenePath)
    }
  }

  async function renderScope({ id, text, element, sceneRel }) {
    const scenePath = currentScenePath(sceneRel)
    const novel = novelOf(scenePath)
    if (!novel) return
    _rows.set(element, { id, text, scenePath })
    await load(novel)
    if (!_payload || !element.isConnected) return
    drawScope(element, id, text, scenePath)
  }

  function drawScope(element, id, text, scenePath) {
    const scope = scopeFor(id, scenePath)
    element.replaceChildren()
    const lead = document.createElement('span')
    lead.className = 'rv-scope-lead'
    lead.textContent = 'Applies to'
    element.appendChild(lead)
    const parts = scopeParts(scope, sceneInfo(scenePath)?.scene_id)
    if (!parts.length) {
      const here = document.createElement('span')
      here.className = 'rv-chip rv-chip-muted'
      here.textContent = 'this spot'
      element.appendChild(here)
    }
    for (const part of parts) {
      const chip = document.createElement('span')
      chip.className = `rv-chip rv-chip-${part.kind}`
      chip.textContent = part.label
      element.appendChild(chip)
    }
    const add = document.createElement('button')
    add.type = 'button'
    add.className = 'rv-scope-add'
    add.textContent = '+'
    add.title = 'Choose the chapters, scenes or characters this note applies to'
    add.addEventListener('mousedown', event => event.preventDefault())
    add.addEventListener('click', () => openPicker({ id, text, anchor: add, scenePath, onChange: () => drawScope(element, id, text, scenePath) }))
    element.appendChild(add)
  }

  let _picker = null
  function closePicker() {
    _picker?.remove()
    _picker = null
    document.removeEventListener('mousedown', onOutside, true)
  }
  function onOutside(event) { if (_picker && !_picker.contains(event.target)) closePicker() }

  function openPicker({ id, text, anchor, scenePath, onChange }) {
    closePicker()
    if (!_payload) return
    const scene = sceneInfo(scenePath)
    const scope = { ...Rev().cleanScope(scopeFor(id, scenePath)) }
    const row = (kind, value, label, checked, hint = '', extra = '') => `<label class="rv-pick-row ${extra}">
        <input type="checkbox" data-kind="${kind}" value="${esc(value)}"${checked ? ' checked' : ''}>
        <span>${esc(label)}</span>${hint ? `<em>${esc(hint)}</em>` : ''}</label>`
    const sceneRows = scenes => scenes.map(s => row('scene', s.scene_id, s.title, scope.scenes.includes(s.scene_id),
      s.scene_id === scene?.scene_id ? 'this scene' : '', 'rv-pick-scene')).join('')
    // Every scene in the book, under its chapter. Ticking a chapter covers all its scenes,
    // including ones written later.
    const chapterBlocks = _payload.chapters.map(ch => {
      const scenes = _payload.scenes.filter(s => s.chapter_id === ch.id)
      return `<div class="rv-pick-chapter${scope.chapters.includes(ch.id) ? ' covered' : ''}" data-chapter="${esc(ch.id)}">
        ${row('chapter', ch.id, ch.title, scope.chapters.includes(ch.id), 'whole chapter', 'rv-pick-chapter-row')}
        ${sceneRows(scenes)}</div>`
    }).join('')
    const loose = _payload.scenes.filter(s => !s.chapter_id)
    _picker = document.createElement('div')
    _picker.className = 'rv-picker'
    _picker.innerHTML = `
      <div class="rv-pick-title">This note applies to…</div>
      ${row('book', '1', 'Whole book', scope.book, 'shown at the start')}
      <div class="rv-pick-group">Scenes</div>
      ${chapterBlocks}
      ${loose.length ? `<div class="rv-pick-chapter"><div class="rv-pick-sub">Outside chapters</div>${sceneRows(loose)}</div>` : ''}
      ${!chapterBlocks && !loose.length ? '<div class="rv-pick-empty">No scenes yet.</div>' : ''}
      ${_payload.characters.length ? `<div class="rv-pick-group">Characters</div>
        ${_payload.characters.map(name => row('character', name, name, scope.characters.includes(name))).join('')}` : ''}
      <div class="rv-pick-foot">The note shows up at the top of every scene you tick. Characters are for filtering.</div>`
    const tickedScene = _picker.querySelector('.rv-pick-scene input:checked')
    if (tickedScene) requestAnimationFrame(() => tickedScene.closest('.rv-pick-chapter')?.scrollIntoView({ block: 'nearest' }))
    document.body.appendChild(_picker)
    const rect = anchor.getBoundingClientRect()
    const top = Math.min(rect.bottom + 6, window.innerHeight - _picker.offsetHeight - 12)
    _picker.style.top = Math.max(12, top) + 'px'
    _picker.style.left = Math.max(12, Math.min(rect.left - 8, window.innerWidth - _picker.offsetWidth - 12)) + 'px'
    _picker.addEventListener('change', async event => {
      const input = event.target
      if (!(input instanceof HTMLInputElement)) return
      const kind = input.dataset.kind
      if (kind === 'book') scope.book = input.checked
      else {
        if (kind === 'chapter') input.closest('.rv-pick-chapter')?.classList.toggle('covered', input.checked)
        const key = { chapter: 'chapters', scene: 'scenes', character: 'characters' }[kind]
        scope[key] = input.checked ? [...new Set([...scope[key], input.value])] : scope[key].filter(v => v !== input.value)
      }
      _scopes.set(id, Rev().cleanScope(scope))
      onChange?.()
      const saved = await window.quill.saveRevisionScope({ novelRel: _novel, id, scope, sceneRel: scenePath, text })
        .catch(error => ({ ok: false, error: error.message }))
      if (!saved?.ok) toast(saved?.error || 'Could not save where this note applies.')
    })
    setTimeout(() => document.addEventListener('mousedown', onOutside, true), 0)
  }

  // ── closing ─────────────────────────────────────────────────────────────────
  // The inline ✕ already removed the node; offer to put it back where it was.
  function onClosed({ id, text, restore }) {
    _scopes.delete(id)
    refreshInspector()
    toast('Note closed. It moves to the Revision notes archive.', restore ? { label: 'Undo', run: restore } : null)
  }

  async function closeGhost(id) {
    const novel = _novel
    const result = await window.quill.closeRevisionNote({ novelRel: novel, id }).catch(error => ({ ok: false, error: error.message }))
    if (!result?.ok) { toast(result?.error || 'Could not close the note.'); return }
    await refreshScene()
    toast('Note closed and archived.', { label: 'Undo', run: async () => {
      await window.quill.reopenRevisionNote({ novelRel: novel, id }).catch(() => null)
      await refreshScene()
    } })
  }

  async function goTo(id) {
    const payload = _payload || await load(_novel, { force: true })
    const note = payload?.open.find(item => item.id === id)
    if (!note) { toast('That note is no longer open.'); return }
    if (chapterView() && window.QuillChapter.goToRevisionNote?.(id)) return
    if (Editor.currentPath?.() !== note.home_path || chapterView()) await App.openFile(note.home_path)
    requestAnimationFrame(() => window.QuillEditor.goToRevisionNote(id))
  }

  window.QuillRevisionHost = { renderScope, onClosed, closeGhost, goTo }

  // ── the open scene ──────────────────────────────────────────────────────────
  // Called by the scene editor once a scene has loaded, and after anything that may have
  // moved notes between scenes.
  let _ghosts = []
  async function sceneOpened(path) {
    _ghosts = []
    const novel = novelOf(path)
    const payload = novel ? await load(novel, { force: true }) : null
    if (Editor.currentPath?.() !== path) return
    const scene = payload?.scenes.find(s => s.path === path)
    if (scene) {
      const isFirstScene = payload.first_scene_id === scene.scene_id
      _ghosts = payload.open
        .filter(note => Rev().appliesTo(note, { sceneId: scene.scene_id, chapterId: scene.chapter_id, isFirstScene }))
        .map(note => ({ id: note.id, text: note.text, from: homeLabel(note), scopeLabel: scopeText(note.scope) }))
    }
    window.QuillEditor.setRevisionGhosts(_ghosts)
    refreshInspector()
  }

  async function refreshScene() {
    const path = Editor.currentPath?.()
    if (path && !chapterView()) await sceneOpened(path)
  }

  function insertHere() {
    if (chapterView()) return window.QuillChapter.insertRevisionNote?.()
    if (!Editor.currentPath?.()) { toast('Open a scene to add a revision note.'); return false }
    return window.QuillEditor.insertRevisionNote()
  }

  // ── Inspector list + toolbar dot ────────────────────────────────────────────
  function refreshInspector() {
    const list = document.getElementById('revisions-list')
    const empty = document.getElementById('revisions-empty')
    const count = document.getElementById('insp-revision-count')
    const own = chapterView() ? [] : (window.QuillEditor.listRevisionNotes?.() || [])
    const total = own.length + _ghosts.length
    document.getElementById('revision-note-btn')?.classList.toggle('has-notes', total > 0)
    if (count) count.textContent = total ? String(total) : ''
    if (!list) return
    list.innerHTML = ''
    if (empty) empty.style.display = total ? 'none' : 'block'
    const item = (note, ghost) => {
      const row = document.createElement('div')
      row.className = 'stub-item rv-insp-item' + (ghost ? ' rv-insp-ghost' : '')
      row.innerHTML = `<span class="stub-item-num">💡</span><span class="stub-item-text">${note.text ? esc(note.text) : '<em>empty note</em>'}`
        + `${ghost ? `<small>from ${esc(ghost)}</small>` : ''}</span>`
      row.onclick = () => {
        if (ghost) document.getElementById('editor-wrap')?.scrollTo({ top: 0, behavior: 'smooth' })
        else window.QuillEditor.goToRevisionNote(note.id)
      }
      list.appendChild(row)
    }
    own.forEach(note => item(note, ''))
    _ghosts.forEach(note => item(note, note.from || 'another scene'))
  }

  // ── words ───────────────────────────────────────────────────────────────────
  // The editor counts words from its rendered text; callouts and ghosts are not prose.
  function countProse(element) {
    if (!element) return 0
    let words = QuillWords.countPlain(element.innerText.trim())
    element.querySelectorAll('[data-rv-nocount]').forEach(node => {
      if (node.parentElement?.closest('[data-rv-nocount]')) return
      words -= QuillWords.countPlain(node.innerText.trim())
    })
    return Math.max(0, words)
  }

  // ── overview + archive (novel Audit tab) ────────────────────────────────────
  const _view = { tab: 'open', chapter: '', character: '' }

  async function renderOverview(container, novelRel) {
    if (!container) return
    container.innerHTML = '<div class="read-loading">Loading revision notes…</div>'
    const payload = await load(novelRel, { force: true })
    if (!container.isConnected) return
    if (!payload) { container.innerHTML = '<div class="outliner-empty">Revision notes could not be loaded.</div>'; return }
    drawOverview(container, novelRel)
  }

  function matchesFilters(note) {
    if (_view.character && !(note.scope?.characters || []).includes(_view.character)) return false
    return true
  }

  function drawOverview(container, novelRel) {
    const payload = _payload
    const open = payload.open.filter(matchesFilters)
    const closed = payload.archive.filter(matchesFilters)
    const noteRow = (note, closedNote) => {
      const where = closedNote
        ? `Closed ${note.closed ? new Date(note.closed).toLocaleDateString() : ''}${note.home_label ? ` · was in ${note.home_label}` : ''}`
        : `In ${homeLabel(note) || 'a scene'}`
      return `<article class="rv-ov-note${closedNote ? ' closed' : ''}" data-rv-note="${esc(note.id)}">
        <div class="rv-ov-copy">
          <p>${esc(note.text || '(empty note)').replace(/\n/g, '<br>')}</p>
          <div class="rv-ov-meta"><span>${esc(where)}</span><span>${esc(scopeText(note.scope))}</span></div>
        </div>
        <div class="rv-ov-actions">${closedNote
          ? '<button type="button" data-rv-act="reopen">Reopen</button><button type="button" data-rv-act="delete">Delete forever</button>'
          : '<button type="button" data-rv-act="open">Go to note</button><button type="button" data-rv-act="close">Close</button>'}</div>
      </article>`
    }
    let body = ''
    if (_view.tab === 'open') {
      const groups = []
      const bookWide = open.filter(note => note.scope?.book)
      if (bookWide.length) groups.push({ title: 'Whole book', notes: bookWide })
      for (const chapter of payload.chapters) {
        if (_view.chapter && _view.chapter !== chapter.id) continue
        const notes = open.filter(note => note.chapter_id === chapter.id || note.scope?.chapters?.includes(chapter.id)
          || note.scope?.scenes?.some(id => payload.scenes.find(s => s.scene_id === id)?.chapter_id === chapter.id))
        if (notes.length) groups.push({ title: chapter.title, notes })
      }
      const loose = open.filter(note => !note.chapter_id && !note.scope?.book && !note.scope?.chapters?.length)
      if (loose.length && !_view.chapter) groups.push({ title: 'Outside chapters', notes: loose })
      body = groups.map(group => `<section class="rv-ov-group"><h4>${esc(group.title)} <span>${group.notes.length}</span></h4>
        ${group.notes.map(note => noteRow(note, false)).join('')}</section>`).join('')
        || `<div class="rv-ov-empty">${open.length || payload.open.length
          ? 'No open notes match these filters.'
          : 'No open revision notes. Press ⌘⇧R in any scene to park one.'}</div>`
    } else {
      body = closed.map(note => noteRow(note, true)).join('')
        || '<div class="rv-ov-empty">Nothing in the archive yet. Notes you close land here.</div>'
    }
    container.innerHTML = `
      <div class="rv-ov-head">
        <strong>💡 Revision notes</strong>
        <div class="rv-ov-tabs" role="tablist">
          <button type="button" data-rv-tab="open" class="${_view.tab === 'open' ? 'active' : ''}">Open <b>${payload.open.length}</b></button>
          <button type="button" data-rv-tab="closed" class="${_view.tab === 'closed' ? 'active' : ''}">Closed <b>${payload.archive.length}</b></button>
        </div>
        <div class="rv-ov-filters">
          ${_view.tab === 'open' ? `<select data-rv-filter="chapter" aria-label="Chapter">
            <option value="">All chapters</option>
            ${payload.chapters.map(ch => `<option value="${esc(ch.id)}"${_view.chapter === ch.id ? ' selected' : ''}>${esc(ch.title)}</option>`).join('')}
          </select>` : ''}
          ${payload.characters.length ? `<select data-rv-filter="character" aria-label="Character">
            <option value="">All characters</option>
            ${payload.characters.map(name => `<option${_view.character === name ? ' selected' : ''}>${esc(name)}</option>`).join('')}
          </select>` : ''}
        </div>
      </div>
      <div class="rv-ov-body">${body}</div>`

    container.querySelectorAll('[data-rv-tab]').forEach(button => {
      button.onclick = () => { _view.tab = button.dataset.rvTab; drawOverview(container, novelRel) }
    })
    container.querySelectorAll('[data-rv-filter]').forEach(select => {
      select.onchange = () => { _view[select.dataset.rvFilter] = select.value; drawOverview(container, novelRel) }
    })
    container.querySelectorAll('[data-rv-note]').forEach(card => {
      const id = card.dataset.rvNote
      card.querySelectorAll('[data-rv-act]').forEach(button => {
        button.onclick = async () => {
          const act = button.dataset.rvAct
          if (act === 'open') { await goTo(id); return }
          if (act === 'delete' && !confirm('Delete this note forever? It cannot be reopened afterwards.')) return
          button.disabled = true
          // A scene open in the editor must be on disk before main edits its file.
          await App.flushPendingWork?.()
          const call = { close: 'closeRevisionNote', reopen: 'reopenRevisionNote', delete: 'deleteArchivedRevision' }[act]
          const result = await window.quill[call]({ novelRel, id }).catch(error => ({ ok: false, error: error.message }))
          if (!result?.ok) { button.disabled = false; toast(result?.error || 'That did not work.'); return }
          if (result.path && Editor.currentPath?.() === result.path) await Editor.reloadFromDisk?.()
          await renderOverview(container, novelRel)
        }
      })
    })
  }

  // ── character sheet ─────────────────────────────────────────────────────────
  async function renderForCharacter(container, novelRel, name) {
    if (!container || !name) return
    const payload = await load(novelRel, { force: true })
    if (!container.isConnected || !payload) return
    const key = String(name).toLocaleLowerCase()
    const notes = payload.open.filter(note => (note.scope?.characters || []).some(n => n.toLocaleLowerCase() === key))
    if (!notes.length) { container.innerHTML = ''; return }
    container.innerHTML = `<div class="rv-char-title">💡 Revision notes <span>${notes.length}</span></div>
      ${notes.map(note => `<button type="button" class="rv-char-note" data-rv-note="${esc(note.id)}">
        <span>${esc(note.text || '(empty note)')}</span><small>${esc(homeLabel(note))}</small></button>`).join('')}`
    container.querySelectorAll('[data-rv-note]').forEach(button => { button.onclick = () => goTo(button.dataset.rvNote) })
  }

  // A notice at the top of a chapter page: every open note homed in this chapter or scoped to
  // it (its scenes, the chapter itself, or the whole book). Each opens the note in its scene.
  async function renderForChapter(container, novelRel, chapterPath) {
    if (!container || !chapterPath) return
    const payload = await load(novelRel, { force: true })
    if (!container.isConnected || !payload) return
    const scenes = payload.scenes.filter(scene => scene.path.slice(0, scene.path.lastIndexOf('/')) === chapterPath)
    const sceneIds = new Set(scenes.map(scene => scene.scene_id))
    const chapterIds = new Set(scenes.map(scene => scene.chapter_id).filter(Boolean))
    const notes = payload.open.filter(note =>
      (note.home_path || '').startsWith(chapterPath + '/')
      || (note.scope?.scenes || []).some(id => sceneIds.has(id))
      || (note.scope?.chapters || []).some(id => chapterIds.has(id))
      || note.scope?.book)
    if (!notes.length) { container.innerHTML = ''; container.hidden = true; return }
    container.hidden = false
    container.innerHTML = `<div class="rv-chapter-title">💡 ${notes.length} revision note${notes.length === 1 ? '' : 's'} for this chapter</div>
      ${notes.map(note => `<button type="button" class="rv-char-note" data-rv-note="${esc(note.id)}" title="Open this note in its scene">
        <span>${esc(note.text || '(empty note)')}</span><small>${esc(note.scope?.book ? 'Whole book · ' + homeLabel(note) : homeLabel(note))}</small></button>`).join('')}`
    container.querySelectorAll('[data-rv-note]').forEach(button => { button.onclick = () => goTo(button.dataset.rvNote) })
  }

  function init() {
    document.getElementById('revision-note-btn')?.addEventListener('click', () => insertHere())
  }

  return { init, load, sceneOpened, refreshScene, refreshInspector, insertHere, countProse,
    renderOverview, renderForCharacter, renderForChapter, scopeText }
})()
