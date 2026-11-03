/* concept-art.js — Concept art gallery, scoped to a novel.
 *
 * Public API:
 *   ConceptArt.open(novelPath)   — open the gallery for the given novel
 *   ConceptArt.close()           — hide the view
 *   ConceptArt.isOpen()          — boolean
 */

const ConceptArt = (() => {
  let _novelPath   = null
  let _images      = []         // [{id, file, caption, tags, fullPath, ...}]
  let _activeTag   = null       // null = All
  let _open        = false

  function esc(s) { return escapeHtml(s) }

  // ── public entry points ────────────────────────────────────
  async function open(novelPath) {
    if (!novelPath) return
    _novelPath = novelPath
    _open      = true
    _activeTag = null
    if (typeof App !== 'undefined' && App.showView) App.showView('concept-art')
    // update subtitle with novel name
    const sub = document.getElementById('ca-subtitle')
    if (sub) sub.textContent = (novelPath.split('/').pop() || '').trim()
    // wire buttons once per open (idempotent — onclick reassignment is fine)
    wireButtons()
    await reload()
  }

  function close() {
    _open = false
  }

  function isOpen() { return _open }

  // ── data + rendering ───────────────────────────────────────
  async function reload() {
    try {
      const res = await window.quill.listConceptArt({ novelRel: _novelPath })
      _images = res?.images || []
    } catch (e) {
      console.error('[concept-art] list failed:', e)
      _images = []
    }
    renderAll()
  }

  function allTags() {
    const set = new Set()
    for (const img of _images) (img.tags || []).forEach(t => set.add(t))
    return Array.from(set).sort((a, b) => a.localeCompare(b))
  }

  function filteredImages() {
    if (!_activeTag) return _images
    return _images.filter(img => (img.tags || []).includes(_activeTag))
  }

  function renderAll() {
    renderEmptyState()
    renderTagbar()
    renderGrid()
  }

  function renderEmptyState() {
    const empty   = document.getElementById('ca-empty')
    const grid    = document.getElementById('ca-grid')
    const tagbar  = document.getElementById('ca-tagbar')
    const hasAny  = _images.length > 0
    if (empty)  empty.style.display  = hasAny ? 'none' : 'flex'
    if (grid)   grid.style.display   = hasAny ? 'grid' : 'none'
    if (tagbar) tagbar.style.display = hasAny ? 'flex' : 'none'
  }

  function renderTagbar() {
    const bar = document.getElementById('ca-tagbar')
    if (!bar) return
    const tags = allTags()
    const pills = [{ key: null, label: 'All' }]
      .concat(tags.map(t => ({ key: t, label: t })))
    bar.innerHTML = pills.map(p => {
      const active = (p.key === _activeTag) ? ' active' : ''
      return `<button class="ca-tag-pill${active}" data-tag="${esc(p.key ?? '')}">${esc(p.label)}</button>`
    }).join('')
    bar.querySelectorAll('.ca-tag-pill').forEach(btn => {
      btn.onclick = () => {
        const t = btn.dataset.tag || null
        _activeTag = (t === '' ? null : t)
        renderTagbar()
        renderGrid()
      }
    })
  }

  function renderGrid() {
    const grid = document.getElementById('ca-grid')
    if (!grid) return
    const imgs = filteredImages()
    grid.innerHTML = imgs.map(img => `
      <div class="ca-card" data-id="${esc(img.id)}">
        <div class="ca-card-img-wrap">
          <img class="ca-card-img" src="../__vfs${esc(img.fullPath)}?t=${Date.now()}" alt="${esc(img.caption || '')}">
        </div>
        ${img.caption ? `<div class="ca-card-caption">${esc(img.caption)}</div>` : ''}
        ${(img.tags && img.tags.length)
            ? `<div class="ca-card-tags">${img.tags.map(t => `<span class="ca-card-tag">${esc(t)}</span>`).join('')}</div>`
            : ''}
      </div>
    `).join('')
    grid.querySelectorAll('.ca-card').forEach(card => {
      const rec = imgs.find(x => x.id === card.dataset.id)
      if (rec?.focal) QuillPhoto.apply(card.querySelector('.ca-card-img'), rec.focal)
    })
    wireCards()
  }

  function wireCards() {
    const grid = document.getElementById('ca-grid')
    if (!grid) return
    grid.querySelectorAll('.ca-card').forEach(card => {
      const id = card.dataset.id
      card.onclick = (e) => {
        // ignore clicks during drag
        if (card.classList.contains('dnd-dragging')) return
        const img = _images.find(x => x.id === id)
        if (img) openLightbox(img)
      }
      card.onkeydown = e => { if (e.key === 'Enter') card.click() }
    })
    // Reorder only when no tag filter is on; a filtered order would be ambiguous.
    if (_activeTag === null) {
      Dnd.sortable(grid, { items: '.ca-card', type: 'image', axis: 'x', onMove: reorder })
    }
  }

  async function reorder(from, to) {
    const order = Dnd.move(_images.map(x => x.id), from, to)
    // optimistic update
    _images.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id))
    renderGrid()
    try {
      await window.quill.reorderConceptArt({ novelRel: _novelPath, order })
    } catch (e) {
      console.error('[concept-art] reorder failed:', e)
      await reload()
    }
  }

  // ── upload ────────────────────────────────────────────────
  async function pickAndAdd() {
    try {
      const res = await window.quill.openFilesDialog({
        filters: [{ name: 'Images', extensions: ['jpg','jpeg','png','webp','gif'] }]
      })
      if (!res?.filePaths?.length) return
      await window.quill.addConceptArt({ novelRel: _novelPath, srcPaths: res.filePaths })
      await reload()
    } catch (e) {
      console.error('[concept-art] add failed:', e)
    }
  }

  // ── lightbox ──────────────────────────────────────────────
  function openLightbox(img) {
    const prev = document.getElementById('ca-lightbox')
    if (prev) prev.remove()

    const overlay = document.createElement('div')
    overlay.id = 'ca-lightbox'
    overlay.className = 'ca-lightbox'
    overlay.innerHTML = `
      <button class="ca-lb-close" type="button" aria-label="Close">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
      <div class="ca-lb-stage">
        <div class="ca-lb-img-wrap">
          <img class="ca-lb-img" src="../__vfs${esc(img.fullPath)}?t=${Date.now()}" alt="${esc(img.caption || '')}">
        </div>
        <div class="ca-lb-meta">
          <label class="ca-lb-lbl">Caption</label>
          <textarea class="ca-lb-caption-input" rows="2" placeholder="Describe or name this image…">${esc(img.caption || '')}</textarea>
          <label class="ca-lb-lbl" style="margin-top:14px">Tags</label>
          <div class="ca-lb-tags" id="ca-lb-tags"></div>
          <form class="ca-lb-tag-form" id="ca-lb-tag-form">
            <input class="ca-lb-tag-input" type="text" placeholder="Add a tag and press Enter…" maxlength="40">
          </form>
          <div class="ca-lb-actions">
            <button class="btn sm ca-lb-adjust" type="button" title="Choose which part shows in the square grid tile">Adjust thumbnail</button>
            <button class="btn sm ca-lb-delete" type="button">Delete image</button>
          </div>
        </div>
      </div>
    `

    const close = () => {
      document.removeEventListener('keydown', onKey)
      overlay.remove()
    }
    const onKey = (e) => {
      // only handle Escape when no input/textarea inside the lightbox has focus
      if (e.key !== 'Escape') return
      const ae = document.activeElement
      const inField = ae && overlay.contains(ae) && (ae.tagName === 'TEXTAREA' || ae.tagName === 'INPUT')
      if (!inField) close()
    }

    overlay.onclick = (e) => { if (e.target === overlay) close() }
    document.addEventListener('keydown', onKey)
    document.body.appendChild(overlay)

    overlay.querySelector('.ca-lb-close').onclick = close
    overlay.querySelector('.ca-lb-adjust').onclick = async () => {
      const focal = await QuillPhoto.open({ src: '../__vfs' + img.fullPath, crop: img.focal, title: 'Adjust thumbnail', shapes: ['square'] })
      if (!focal) return
      await window.quill.updateConceptArt({ novelRel: _novelPath, id: img.id, focal }).catch(() => {})
      img.focal = focal
      const rec = _images.find(x => x.id === img.id)
      if (rec) rec.focal = focal
      renderGrid()
    }

    // tags UI
    let tags = Array.isArray(img.tags) ? img.tags.slice() : []
    const renderTags = () => {
      const box = overlay.querySelector('#ca-lb-tags')
      box.innerHTML = tags.map((t, i) => `
        <span class="ca-lb-tag">
          ${esc(t)}
          <button type="button" class="ca-lb-tag-x" data-i="${i}" aria-label="Remove tag">×</button>
        </span>
      `).join('') || '<span class="ca-lb-tags-empty">No tags yet.</span>'
      box.querySelectorAll('.ca-lb-tag-x').forEach(btn => {
        btn.onclick = async () => {
          const i = Number(btn.dataset.i)
          tags.splice(i, 1)
          renderTags()
          await persist()
        }
      })
    }
    renderTags()

    const tagForm  = overlay.querySelector('#ca-lb-tag-form')
    const tagInput = overlay.querySelector('.ca-lb-tag-input')
    tagForm.onsubmit = async (e) => {
      e.preventDefault()
      const v = (tagInput.value || '').trim().toLowerCase()
      if (!v) return
      if (!tags.includes(v)) tags.push(v)
      tagInput.value = ''
      renderTags()
      await persist()
    }

    // caption — save on blur + debounced while typing
    const capInput = overlay.querySelector('.ca-lb-caption-input')
    let capTimer = null
    const scheduleCapSave = () => {
      clearTimeout(capTimer)
      capTimer = setTimeout(persist, 400)
    }
    capInput.oninput = scheduleCapSave
    capInput.onblur  = () => { clearTimeout(capTimer); persist() }

    // delete
    overlay.querySelector('.ca-lb-delete').onclick = async () => {
      const ok = confirm('Delete this image? This can\'t be undone.')
      if (!ok) return
      try {
        await window.quill.deleteConceptArt({ novelRel: _novelPath, id: img.id })
        close()
        await reload()
      } catch (e) { console.error('[concept-art] delete failed:', e) }
    }

    async function persist() {
      try {
        await window.quill.updateConceptArt({
          novelRel: _novelPath,
          id:       img.id,
          caption:  capInput.value,
          tags:     tags,
        })
        // update local copy so tagbar refreshes correctly
        const rec = _images.find(x => x.id === img.id)
        if (rec) { rec.caption = capInput.value; rec.tags = tags.slice() }
        renderTagbar()
      } catch (e) { console.error('[concept-art] update failed:', e) }
    }
  }

  // ── wiring ─────────────────────────────────────────────────
  let _wired = false
  function wireButtons() {
    if (_wired) return
    _wired = true
    const addBtn = document.getElementById('ca-add-btn')
    if (addBtn) addBtn.onclick = pickAndAdd
    const emptyAddBtn = document.getElementById('ca-empty-add-btn')
    if (emptyAddBtn) emptyAddBtn.onclick = pickAndAdd
  }

  return { open, close, isOpen }
})()
