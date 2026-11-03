/* scraps.js — lightweight sticky-note walls. Novel scraps live in .scraps.json and can be
 * inserted into scenes from the Inspector. Scratch projects get a separate .idea-inbox.json
 * for undeveloped ideas; those notes deliberately have no manuscript-placement state. */

const Scraps = (() => {
  const COLORS = ['yellow', 'peach', 'coral', 'pink', 'lavender', 'blue', 'aqua', 'mint', 'green', 'sand']

  let _novel   = null   // novel root path the store belongs to
  let _store   = 'novel' // 'novel' scraps or the Scratch project's 'inbox'
  let _scraps  = []
  let _timer   = null
  let _open    = null   // id of the scrap in the expanded view
  let _unlock  = false  // pinned line temporarily editable in the expanded view
  const _views = new Set()   // { container, mode: 'wall' | 'drawer' }

  // ── Store ────────────────────────────────────────────────
  async function load(novelPath, store = 'novel') {
    await flushPending()
    // Always re-read: project replace can change scraps on disk behind this cache.
    const data = store === 'inbox'
      ? await window.quill.getScratchInbox(novelPath).catch(() => ({ notes: [] }))
      : await window.quill.getScraps(novelPath).catch(() => ({ scraps: [] }))
    _novel = novelPath
    _store = store
    _scraps = (store === 'inbox' ? data.notes : data.scraps) || []
  }

  function scheduleSave() {
    clearTimeout(_timer)
    _timer = setTimeout(() => { _timer = null; persist() }, 500)
  }

  let _failing = false   // report a save failure once, not on every debounced retry

  async function persist() {
    if (!_novel) return
    let error = null
    try {
      const result = _store === 'inbox'
        ? await window.quill.saveScratchInbox({ scratchRel: _novel, notes: _scraps })
        : await window.quill.saveScraps({ novelRel: _novel, scraps: _scraps })
      if (!result?.ok) error = result?.error || 'unknown error'
    } catch (e) {
      error = String(e?.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
    }
    if (!error) { _failing = false; return }
    if (_failing) return
    _failing = true
    alert(`Could not save ${_store === 'inbox' ? 'the Idea Inbox' : 'scraps'}: ${error}` + (/No handler registered/.test(error)
      ? '\n\nQuill was updated while it was running. Copy any new notes somewhere safe, then quit and reopen Quill.'
      : ''))
  }

  async function flushPending() {
    if (!_timer) return
    clearTimeout(_timer)
    _timer = null
    await persist()
  }

  function uid() { return Math.random().toString(36).slice(2, 10) }
  function byId(id) { return _scraps.find(s => s.id === id) }

  // A new note gets a random color, never the same as the note it lands next to.
  function randomColor() {
    const choices = COLORS.filter(c => c !== _scraps[0]?.color)
    return choices[Math.floor(Math.random() * choices.length)]
  }

  function add(text) {
    const value = text.trim()
    if (!value) return null
    const scrap = { id: uid(), text: value, note: '', color: randomColor(), kept: false, used: false,
                    used_in: null, created: new Date().toISOString() }
    _scraps.unshift(scrap)
    scheduleSave()
    return scrap
  }

  // The stored array order is the writer's arrangement; new scraps start at the front.
  function ordered() { return _scraps.slice() }

  let _dragId = null

  function moveScrap(id, targetId, after) {
    const from = _scraps.findIndex(s => s.id === id)
    if (from < 0 || id === targetId) return
    const [moved] = _scraps.splice(from, 1)
    let to = targetId ? _scraps.findIndex(s => s.id === targetId) : _scraps.length
    if (to < 0) to = _scraps.length
    else if (after) to++
    _scraps.splice(to, 0, moved)
    scheduleSave()
    renderAll()
  }

  function clearDropMarks() {
    document.querySelectorAll('.scrap.drop-before,.scrap.drop-after,.scraps-grid.drop-end')
      .forEach(el => el.classList.remove('drop-before', 'drop-after', 'drop-end'))
  }

  // ── Views ────────────────────────────────────────────────
  async function showWall(novelPath, container) {
    await load(novelPath, 'novel')
    mount(container, 'wall')
  }

  async function showInbox(scratchPath, container) {
    await load(scratchPath, 'inbox')
    mount(container, 'inbox')
  }

  // The drawer follows whichever scene is open; scenes outside a novel have no scraps.
  async function showDrawer(scenePath, container) {
    const novel = scenePath ? await novelRootFor(scenePath) : null
    if (!novel) {
      container.innerHTML = '<div class="scraps-empty">Scraps belong to a novel. Open a scene inside a novel to use them here.</div>'
      _views.forEach(v => { if (v.container === container) _views.delete(v) })
      return
    }
    await load(novel, 'novel')
    mount(container, 'drawer')
  }

  async function novelRootFor(filePath) {
    const parts = filePath.split('/')
    for (let i = 1; i < parts.length; i++) {
      const p = parts.slice(0, i).join('/')
      const meta = await window.quill.getFolderMeta(p).catch(() => ({}))
      if (meta.folder_type === 'novel') return p
    }
    return null
  }

  function mount(container, mode) {
    _views.forEach(v => { if (v.container === container || !document.body.contains(v.container)) _views.delete(v) })
    _views.add({ container, mode, novel: _novel })
    container.innerHTML = `
      <div class="scraps-${mode}">
        <div class="scraps-bar">
          <textarea class="scraps-new" rows="1" placeholder="${mode === 'wall' ? 'Jot a line you want to use someday… (Enter to stick it)' : mode === 'inbox' ? 'Catch an idea before it gets away… (Enter to stick it)' : 'Jot a line… (Enter)'}"></textarea>
          ${mode === 'inbox' ? '' : '<label class="scraps-toggle"><input type="checkbox" class="scraps-show-used"> Show used</label>'}
        </div>
        <div class="scraps-grid"></div>
      </div>`
    const input = container.querySelector('.scraps-new')
    const fit = () => { input.style.height = 'auto'; input.style.height = input.scrollHeight + 'px' }
    input.addEventListener('input', fit)
    input.addEventListener('keydown', e => {
      if (e.key !== 'Enter' || e.shiftKey) return
      e.preventDefault()
      if (add(input.value)) { input.value = ''; fit(); renderAll() }
    })
    const showUsed = container.querySelector('.scraps-show-used')
    if (showUsed) {
      showUsed.checked = readPref(mode)
      showUsed.onchange = () => { writePref(mode, showUsed.checked); renderGrid(container, mode) }
    }
    renderGrid(container, mode)
  }

  function readPref(mode) {
    try {
      const v = localStorage.getItem('quill_scraps_used_' + mode)
      return v === null ? mode === 'wall' : v === 'on'
    } catch { return mode === 'wall' }
  }
  function writePref(mode, on) {
    try { localStorage.setItem('quill_scraps_used_' + mode, on ? 'on' : 'off') } catch {}
  }

  function renderAll() {
    _views.forEach(v => {
      if (!document.body.contains(v.container)) { _views.delete(v); return }
      if (v.novel === _novel) renderGrid(v.container, v.mode)
    })
  }

  function renderGrid(container, mode) {
    const grid = container.querySelector('.scraps-grid')
    if (!grid) return
    const showUsed = mode === 'inbox' || container.querySelector('.scraps-show-used')?.checked
    const list = ordered().filter(s => showUsed || !s.used)
    const hidden = _scraps.filter(s => s.used).length
    grid.innerHTML = ''
    if (!list.length) {
      grid.innerHTML = `<div class="scraps-empty">${_scraps.length
        ? `All ${hidden} scrap${hidden === 1 ? ' is' : 's are'} placed. Tick “Show used” to see them.`
        : mode === 'inbox'
          ? 'No ideas waiting. Catch premises, images, titles, or questions here before developing them in Ideas.'
          : 'No scraps yet. Lines, images, and bits of dialogue you want to use at some point go here.'}</div>`
      return
    }
    list.forEach(scrap => grid.appendChild(buildNote(scrap, mode)))
    // Dropping on empty space past the last note sends the scrap to the end.
    grid.ondragover = e => {
      if (!_dragId || e.target !== grid) return
      e.preventDefault()
      clearDropMarks()
      grid.classList.add('drop-end')
    }
    grid.ondragleave = e => { if (e.target === grid) grid.classList.remove('drop-end') }
    grid.ondrop = e => {
      if (!_dragId || e.target !== grid) return
      e.preventDefault()
      const id = _dragId
      clearDropMarks()
      moveScrap(id, null, false)
    }
  }

  function buildNote(scrap, mode) {
    const note = document.createElement('div')
    note.className = `scrap scrap-${COLORS.includes(scrap.color) ? scrap.color : 'yellow'}${scrap.kept ? ' kept' : ''}${scrap.used ? ' used' : ''}`
    note.dataset.id = scrap.id
    note.tabIndex = 0
    note.innerHTML = `
      ${scrap.kept ? '<span class="scrap-pin" title="Pinned — this note is protected">📌</span>' : ''}
      <div class="scrap-text">${escapeHtml(scrap.text)}</div>
      <div class="scrap-meta">
        ${scrap.note ? '<span class="scrap-has-note" title="Has more notes">¶ more</span>' : ''}
        ${mode !== 'inbox' && scrap.used ? `<span class="scrap-used-in">Used${scrap.used_in?.title ? ' in ' + escapeHtml(scrap.used_in.title) : ''}</span>` : ''}
        ${mode === 'drawer' && !scrap.used ? '<button class="scrap-insert" title="Insert at the cursor and mark as used">Insert ↵</button>' : ''}
      </div>`
    note.onclick = e => {
      if (e.target.closest('.scrap-insert')) return
      openNote(scrap.id)
    }
    note.onkeydown = e => { if (e.key === 'Enter') openNote(scrap.id) }
    const insert = note.querySelector('.scrap-insert')
    if (insert) insert.onclick = () => insertIntoScene(scrap)

    // Drag to rearrange. The wall flows in rows, so left/right half decides the side;
    // the one-column drawer uses top/bottom.
    note.draggable = true
    const afterPointer = e => {
      const r = note.getBoundingClientRect()
      return mode !== 'drawer' ? e.clientX > r.left + r.width / 2 : e.clientY > r.top + r.height / 2
    }
    note.addEventListener('dragstart', e => {
      _dragId = scrap.id
      e.dataTransfer.effectAllowed = 'move'
      e.dataTransfer.setData('text/plain', scrap.text)
      e.dataTransfer.setData('application/x-quill-scrap', scrap.id)
      setTimeout(() => note.classList.add('dragging'), 0)
    })
    note.addEventListener('dragend', () => {
      _dragId = null
      note.classList.remove('dragging')
      clearDropMarks()
    })
    note.addEventListener('dragover', e => {
      if (!_dragId || _dragId === scrap.id) return
      e.preventDefault()
      const after = afterPointer(e)
      if (note.classList.contains(after ? 'drop-after' : 'drop-before')) return
      clearDropMarks()
      note.classList.add(after ? 'drop-after' : 'drop-before')
    })
    note.addEventListener('dragleave', e => {
      if (!note.contains(e.relatedTarget)) note.classList.remove('drop-before', 'drop-after')
    })
    note.addEventListener('drop', e => {
      if (!_dragId) return
      e.preventDefault()
      const id = _dragId
      const after = afterPointer(e)
      clearDropMarks()
      moveScrap(id, scrap.id, after)
    })
    return note
  }

  // ── Insert into the open scene ───────────────────────────
  function insertIntoScene(scrap) {
    const path = App.getCurrentFile?.()
    if (!path || !window.QuillEditor?.insertPlainText?.(scrap.text)) {
      alert('Open a scene and place the cursor where the line should go.')
      return
    }
    markUsed(scrap, path)
  }

  // A scrap dragged straight into the prose counts as used, same as the Insert button.
  window.addEventListener('quill-scrap-dropped', e => {
    const scrap = byId(e.detail?.id)
    const path = App.getCurrentFile?.()
    if (scrap && path) markUsed(scrap, path)
  })

  function markUsed(scrap, path) {
    scrap.used = true
    scrap.used_in = { path, title: document.getElementById('entry-title')?.value || path.split('/').pop().replace(/\.md$/, '') }
    scheduleSave()
    renderAll()
  }

  // ── Expanded note ────────────────────────────────────────
  function initModal() {
    const overlay = document.getElementById('scrap-overlay')
    if (overlay.dataset.ready) return
    overlay.dataset.ready = '1'
    overlay.addEventListener('click', e => { if (e.target === overlay) closeNote() })
    overlay.addEventListener('keydown', e => { if (e.key === 'Escape') closeNote() })
    document.getElementById('scrap-close').onclick = () => closeNote()
    const text = document.getElementById('scrap-edit-text')
    const note = document.getElementById('scrap-edit-note')
    text.addEventListener('input', () => { const s = byId(_open); if (s) { s.text = text.value; scheduleSave(); renderAll() } })
    note.addEventListener('input', () => { const s = byId(_open); if (s) { s.note = note.value; scheduleSave(); renderAll() } })
    document.getElementById('scrap-colors').innerHTML = COLORS.map(c =>
      `<button class="scrap-swatch scrap-${c}" data-color="${c}" title="${c}"></button>`).join('')
    document.querySelectorAll('#scrap-colors .scrap-swatch').forEach(btn => {
      btn.onclick = () => { const s = byId(_open); if (!s) return; s.color = btn.dataset.color; scheduleSave(); fillModal(); renderAll() }
    })
    document.getElementById('scrap-pin-btn').onclick = () => {
      const s = byId(_open); if (!s) return
      s.kept = !s.kept; _unlock = false; scheduleSave(); fillModal(); renderAll()
    }
    document.getElementById('scrap-unlock-btn').onclick = () => { _unlock = true; fillModal(); text.focus() }
    document.getElementById('scrap-used-btn').onclick = () => {
      const s = byId(_open); if (!s) return
      s.used = !s.used
      if (!s.used) s.used_in = null
      scheduleSave(); fillModal(); renderAll()
    }
    document.getElementById('scrap-promote-btn').onclick = async () => {
      const s = byId(_open)
      if (!s || _store !== 'inbox') return
      const button = document.getElementById('scrap-promote-btn')
      const remove = document.getElementById('scrap-promote-remove').checked
      button.disabled = true
      button.textContent = 'Creating…'
      try {
        await Ideas.createFromInbox(s)
        if (remove) {
          _scraps = _scraps.filter(item => item !== s)
          clearTimeout(_timer)
          _timer = null
          await persist()
        } else {
          await flushPending()
        }
        closeNote()
        renderAll()
      } catch (error) {
        alert(`Could not create the idea: ${error?.message || error}`)
      } finally {
        button.disabled = false
        button.textContent = 'Develop in Ideas →'
      }
    }
    document.getElementById('scrap-delete-btn').onclick = () => {
      const s = byId(_open); if (!s) return
      if (s.kept && !confirm('This scrap is pinned. Delete it anyway?')) return
      _scraps = _scraps.filter(x => x !== s)
      scheduleSave(); closeNote(); renderAll()
    }
  }

  function openNote(id) {
    if (!byId(id)) return
    initModal()
    _open = id
    _unlock = false
    document.getElementById('scrap-promote-remove').checked = false
    fillModal()
    document.getElementById('scrap-overlay').classList.add('show')
    setTimeout(() => {
      const s = byId(_open)
      document.getElementById(s?.kept ? 'scrap-edit-note' : 'scrap-edit-text')?.focus()
    }, 60)
  }

  function fillModal() {
    const s = byId(_open)
    if (!s) return
    const card = document.getElementById('scrap-card')
    card.className = `modal scrap-card scrap-${COLORS.includes(s.color) ? s.color : 'yellow'}${s.kept ? ' kept' : ''}`
    const text = document.getElementById('scrap-edit-text')
    const locked = s.kept && !_unlock
    if (text.value !== s.text) text.value = s.text
    text.readOnly = locked
    text.classList.toggle('locked', locked)
    document.getElementById('scrap-unlock-btn').style.display = locked ? '' : 'none'
    const note = document.getElementById('scrap-edit-note')
    if (note.value !== s.note) note.value = s.note
    document.getElementById('scrap-pin-btn').textContent = s.kept ? '📌 Pinned' : 'Pin & protect'
    document.getElementById('scrap-pin-btn').classList.toggle('active', s.kept)
    document.getElementById('scrap-used-btn').textContent = s.used ? '✓ Used' : 'Mark used'
    document.getElementById('scrap-used-btn').classList.toggle('active', s.used)
    document.getElementById('scrap-used-btn').style.display = _store === 'inbox' ? 'none' : ''
    document.getElementById('scrap-used-where').textContent = s.used && s.used_in?.title ? `in ${s.used_in.title}` : ''
    document.getElementById('scrap-used-where').style.display = _store === 'inbox' ? 'none' : ''
    document.getElementById('scrap-promote-actions').style.display = _store === 'inbox' ? '' : 'none'
    document.querySelectorAll('#scrap-colors .scrap-swatch').forEach(b => b.classList.toggle('active', b.dataset.color === s.color))
    requestAnimationFrame(() => { text.style.height = 'auto'; text.style.height = text.scrollHeight + 'px' })
  }

  function closeNote() {
    _open = null
    document.getElementById('scrap-overlay')?.classList.remove('show')
    flushPending()
  }

  function isOpen(id) { return _open === id }

  return { showWall, showInbox, showDrawer, openNote, isOpen, flushPending }
})()
