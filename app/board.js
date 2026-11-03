/* board.js — Storyboard with drag-to-reorder, expanded tones, file linking */

const Board = (() => {
  // ── Emotional tone palette (15 tones) ─────────────────────
  const TONES = [
    { id:'tense',        label:'Tense',        color:'#c0392b', bg:'#fdf2f1' },
    { id:'ominous',      label:'Ominous',       color:'#6c3483', bg:'#f5f0fb' },
    { id:'fearful',      label:'Fearful',       color:'#784212', bg:'#fdf3e7' },
    { id:'dark',         label:'Dark',          color:'#2c3e50', bg:'#eaf0f6' },
    { id:'sorrowful',    label:'Sorrowful',     color:'#5d6d7e', bg:'#f2f4f5' },
    { id:'desperate',    label:'Desperate',     color:'#cb4335', bg:'#fdf2f1' },
    { id:'action',       label:'Action',        color:'#d35400', bg:'#fef5ec' },
    { id:'triumphant',   label:'Triumphant',    color:'#b7950b', bg:'#fefced' },
    { id:'hopeful',      label:'Hopeful',       color:'#1a8a5a', bg:'#f0faf5' },
    { id:'quiet',        label:'Quiet',         color:'#5a9ea8', bg:'#f0f8fa' },
    { id:'romantic',     label:'Romantic',      color:'#c0507a', bg:'#fdf0f5' },
    { id:'revelation',   label:'Revelation',    color:'#2471a3', bg:'#eaf4fc' },
    { id:'mysterious',   label:'Mysterious',    color:'#7d6608', bg:'#fefaec' },
    { id:'conspiratorial',label:'Conspiratorial',color:'#1b6b4a', bg:'#f0faf5' },
    { id:'wonder',       label:'Wonder',        color:'#6c3483', bg:'#f9f0fc' },
    { id:'bittersweet',  label:'Bittersweet',   color:'#935116', bg:'#fdf3e7' },
    { id:'whimsical',    label:'Whimsical',     color:'#a569bd', bg:'#f9f0fc' },
    { id:'levity',       label:'Levity',        color:'#ca8a04', bg:'#fefce8' },
  ]

  function toneById(id) { return TONES.find(t => t.id === id) || TONES[9] }

  let _folder    = null
  let _cards     = []
  let _files     = []
  let _stimer    = null
  let _popCard   = null
  let _container = null

  // ── Init ──────────────────────────────────────────────────
  function init() {
    initPopout()
  }

  function initPopout() {
    document.getElementById('popout-close').onclick = closePopout
    document.getElementById('card-popout-overlay').addEventListener('click', e => {
      if (e.target.id === 'card-popout-overlay') closePopout()
    })
    document.getElementById('popout-body').addEventListener('input', () => {
      if (!_popCard) return
      _popCard.body = document.getElementById('popout-body').value
      const ta = document.querySelector(`.b-card[data-cid="${_popCard.id}"] .b-body,` +
                                        `.b-card-landing[data-cid="${_popCard.id}"] .b-body`)
      if (ta) ta.value = _popCard.body
      scheduleSave()
    })
  }

  // ── Embedded in chapter landing ────────────────────────────
  async function showInLanding(folderPath, container) {
    await flushPending()
    _folder    = folderPath
    _container = container
    await loadData()
    renderLanding(container)
  }

  // ── Load cards + files, auto-sync ─────────────────────────
  async function loadData() {
    const [boardData, files] = await Promise.all([
      window.quill.getBoard(_folder).catch(() => ({ cards:[] })),
      window.quill.getFilesInFolder(_folder).catch(() => []),
    ])
    _cards = (boardData.cards || []).map((c, i) => ({
      ...c,
      id:       c.id       || String(i),
      title:    c.title    || '',
      body:     c.body     || '',
      tone:     c.tone     || 'quiet',
      image:    c.image    || null,
      scene_id: c.scene_id || null,
    }))
    _files = files

    // Auto-sync: add a card for every file that doesn't have one
    let changed = false
    for (const file of files) {
      const hasCard = _cards.some(c =>
        (c.scene_id && c.scene_id === file.scene_id) ||
        c.title.toLowerCase().trim() === file.title.toLowerCase().trim()
      )
      if (!hasCard && file.title && file.title !== 'Untitled') {
        _cards.push({ id: uid(), title: file.title, body: '', tone: 'quiet', image: null, scene_id: file.scene_id || null })
        changed = true
      }
    }
    if (changed) {
      const toSave = cardsForSave()
      await window.quill.saveBoard({ folderRel: _folder, cards: toSave }).catch(() => {})
    }
  }

  // ── Render landing ─────────────────────────────────────────
  function renderLanding(container) {
    container.innerHTML = ''
    if (!_cards.length) {
      const empty = document.createElement('div')
      empty.className = 'board-empty'
      empty.innerHTML = `<span>No scenes yet.</span>
        <button class="btn sm board-add-inline">+ Add scene card</button>`
      empty.querySelector('.board-add-inline').onclick = () => addCard()
      container.appendChild(empty)
      return
    }
    _cards.forEach((card, idx) => container.appendChild(buildCard(card, idx, 'landing')))
    const addBtn = document.createElement('div')
    addBtn.className = 'b-add-inline'
    addBtn.innerHTML = `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Add scene`
    addBtn.onclick = () => addCard()
    container.appendChild(addBtn)
    makeSortable(container, '.b-card-landing', addBtn)
  }

  // ── Build card ─────────────────────────────────────────────
  function buildCard(card, idx, mode) {
    const tone   = toneById(card.tone)
    const linked = findLinkedFile(card)

    const div = document.createElement('div')
    div.className   = mode === 'landing' ? 'b-card-landing' : 'b-card'
    div.dataset.cid = card.id
    div.dataset.idx = idx
    div.style.setProperty('--tone-color', tone.color)
    div.style.setProperty('--tone-bg',    tone.bg)

    // tone picker: compact dots only, tooltip on hover
    const tonePicker = TONES.map(t =>
      `<button class="b-tone-btn ${card.tone===t.id?'active':''}" data-tone="${t.id}"
        style="--tc:${t.color}" data-label="${t.label}" aria-label="Tone: ${t.label}" aria-pressed="${card.tone===t.id}"></button>`
    ).join('')

    div.innerHTML = `
      <div class="b-card-top">
        <div class="b-drag-handle" title="Drag to reorder">⠿</div>
        <div class="b-tone-dot"></div>
        <div class="b-tone-label">${tone.label}</div>
        <div style="flex:1"></div>
        <button class="b-expand f-btn" title="Edit the synopsis in a larger box">
          <svg viewBox="0 0 24 24"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg>
        </button>
        <button class="b-del f-btn" title="Delete card">
          <svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <input class="b-title" type="text" placeholder="Scene title…" value="${esc(card.title)}">
      <textarea class="b-body" rows="3" placeholder="What happens in this scene…">${esc(card.body)}</textarea>
      <div class="b-tone-picker">${tonePicker}</div>
      <div class="b-footer">
        <button class="b-write-btn ${linked?'linked':''}" title="${linked?'Open scene file':'Create scene file'}">
          ${linked ? '✓ Write this scene →' : '+ Create scene file'}
        </button>
        <button class="b-copy-btn" data-copy-mode="full" title="Duplicate scene and beats">⧉</button>
        <button class="b-copy-btn" data-copy-mode="outline" title="New blank scene from these beats">↳</button>
      </div>`

    // title
    const titleIn = div.querySelector('.b-title')
    titleIn.addEventListener('input', () => {
      card.title = titleIn.value
      updateWriteBtn(div, card)
      scheduleSave()
    })

    // body
    const bodyIn = div.querySelector('.b-body')
    bodyIn.addEventListener('input', () => {
      card.body = bodyIn.value; scheduleSave()
      bodyIn.style.height = 'auto'; bodyIn.style.height = bodyIn.scrollHeight + 'px'
    })
    setTimeout(() => { bodyIn.style.height='auto'; bodyIn.style.height=bodyIn.scrollHeight+'px' }, 0)

    // tone
    div.querySelectorAll('.b-tone-btn').forEach(btn => {
      btn.onclick = () => {
        card.tone = btn.dataset.tone
        const t   = toneById(card.tone)
        div.querySelectorAll('.b-tone-btn').forEach(b => b.classList.remove('active'))
        btn.classList.add('active')
        div.style.setProperty('--tone-color', t.color)
        div.style.setProperty('--tone-bg',    t.bg)
        div.querySelector('.b-tone-label').textContent    = t.label
        scheduleSave()
      }
    })

    // expand
    div.querySelector('.b-expand').onclick = () => openPopout(card)

    // delete
    // A card with a scene file behind it would come straight back on the next load (loadData
    // makes a card for every file), so deleting it means sending the scene to Trash too.
    div.querySelector('.b-del').onclick = async () => {
      const linked = findLinkedFile(card)
      if (linked && !(await trashScene(linked.path, card.title || linked.title))) return
      if (linked) _files = _files.filter(f => f !== linked)
      const at = _cards.indexOf(card)
      if (at !== -1) _cards.splice(at, 1)
      scheduleSave()
      rerender()
    }

    // write button
    div.querySelector('.b-write-btn').onclick = async () => {
      const existing = findLinkedFile(card)
      if (existing) {
        App.openFile(existing.path)
      } else {
        const result = await window.quill.newFile({ folder: _folder, title: card.title || 'Untitled Scene' })
        card.scene_id = result.scene_id || null
        _files.push({ name: result.path.split('/').pop(), path: result.path, title: card.title, scene_id: card.scene_id })
        scheduleSave()
        await Tree.refresh()
        App.openFile(result.path)
      }
    }

    div.querySelectorAll('.b-copy-btn').forEach(btn => {
      btn.onclick = async () => {
        await duplicateFromCard(card, idx, btn.dataset.copyMode === 'outline')
      }
    })

    return div
  }

  function updateWriteBtn(div, card) {
    const linked = findLinkedFile(card)
    const btn    = div.querySelector('.b-write-btn')
    if (!btn) return
    if (linked) { btn.classList.add('linked');    btn.textContent = '✓ Write this scene →' }
    else        { btn.classList.remove('linked'); btn.textContent = '+ Create scene file' }
  }

  async function duplicateFromCard(card, idx, outlineOnly) {
    await flushPending()
    const linked = findLinkedFile(card)

    if (linked) {
      const result = await window.quill.duplicateScene({ rel: linked.path, outlineOnly })
      if (!result?.ok) {
        alert(result?.error || 'Could not duplicate this scene.')
        return
      }
      await Tree.refresh()
      await App.openFile(result.path)
      return
    }

    const suffix = outlineOnly ? ' — Next Scene' : ' copy'
    _cards.splice(idx + 1, 0, {
      ...card,
      id: uid(),
      title: `${card.title || 'Untitled Scene'}${suffix}`,
      image: card.image || null,
    })
    scheduleSave()
    rerender()
  }

  // ── Drag reorder ───────────────────────────────────────────
  function moveCard(from, to) {
    Dnd.move(_cards, from, to)
    scheduleSave()
    rerender()
  }

  // Cards drag by their ⠿ handle, so text in the title and body stays selectable.
  function makeSortable(container, cardSelector, endTarget) {
    Dnd.sortable(container, { items: cardSelector, type: 'card', handle: '.b-drag-handle', axis: 'x', endTarget, onMove: moveCard })
  }

  function rerender() {
    if (_container) renderLanding(_container)
  }

  // ── Add card ───────────────────────────────────────────────
  function addCard() {
    _cards.push({ id: uid(), title:'', body:'', tone:'quiet', image:null })
    scheduleSave(); rerender()
    setTimeout(() => {
      const titles = document.querySelectorAll('.b-title')
      if (titles.length) titles[titles.length-1].focus()
    }, 50)
  }

  // ── Popout ─────────────────────────────────────────────────
  function openPopout(card) {
    _popCard = card
    document.getElementById('popout-title').textContent = card.title || 'Scene notes'
    document.getElementById('popout-body').value = card.body || ''
    document.getElementById('card-popout-overlay').classList.add('show')
    setTimeout(() => document.getElementById('popout-body').focus(), 60)
  }
  function closePopout() {
    document.getElementById('card-popout-overlay').classList.remove('show')
    _popCard = null
  }

  // ── Save ───────────────────────────────────────────────────
  function scheduleSave() {
    clearTimeout(_stimer)
    _stimer = setTimeout(() => {
      _stimer = null
      persistCurrent()
    }, 700)
  }

  async function persistCurrent() {
    if (_folder === null) return
    const folder = _folder
    const files = [..._files]
    const toSave = cardsForSave()
    await window.quill.saveBoard({ folderRel: folder, cards: toSave })
    toSave.forEach(card => {
      const linked = files.find(file =>
        (card.scene_id && file.scene_id && card.scene_id === file.scene_id) ||
        file.title.toLowerCase().trim() === card.title.toLowerCase().trim()
      )
      if (linked) Editor.syncSynopsisFromBoard?.(linked.path, card.body || '')
    })
    const names = toSave
      .map(c => files.find(f =>
        (c.scene_id && f.scene_id && c.scene_id === f.scene_id) ||
        f.title.toLowerCase().trim() === c.title.toLowerCase().trim()
      ))
      .filter(Boolean)
      .map(f => f.name)
    if (names.length > 0) {
      await window.quill.reorder({ folder, order: names }).catch(() => {})
      Tree.refresh()
    }
  }

  async function flushPending() {
    if (_cork?.timer) await saveCork(_cork)
    if (!_stimer) return
    clearTimeout(_stimer)
    _stimer = null
    await persistCurrent()
  }

  function cardsForSave() {
    return _cards.map(({ id, title, body, tone, image, scene_id, synopsis_backups }) => ({
      id, title, body, tone, image, scene_id,
      ...(Array.isArray(synopsis_backups) && synopsis_backups.length ? { synopsis_backups } : {}),
    }))
  }

  // ── The Board: the whole novel (acts as swimlanes, chapters as columns), or one chapter's
  // cards, editable, chosen with the filter. Toolbar, sidebar and chapter page all open it.
  const _filter = {}   // novel path → chapter path ('' = all chapters)

  function setFilter(novelPath, chapterPath) { _filter[novelPath] = chapterPath || '' }

  async function showNovelOverview(novelPath, container, options = {}) {
    await flushPending()
    await closeCorkEditor()
    if (options.chapter !== undefined) setFilter(novelPath, options.chapter)
    container.innerHTML = '<div style="padding:12px;color:var(--muted);font-size:12px">Loading structure…</div>'
    const acts = await window.quill.getNovelStructure(novelPath).catch(() => [])
    container.innerHTML = ''

    if (!acts.length || acts.every(a => !a.chapters.length)) {
      container.innerHTML = '<div class="board-empty">The Board shows a card for every scene, one column per chapter. Add a chapter with <b>+ Chapter</b> in the sidebar to begin.</div>'
      return
    }

    const chapters = acts.flatMap(a => a.chapters.map(ch => ({ ...ch, act: a })))
    let chosen = _filter[novelPath] || ''
    if (chosen && !chapters.some(ch => ch.path === chosen)) chosen = ''

    const bar = document.createElement('div')
    bar.className = 'board-filter'
    bar.innerHTML = `
      <label>Show <select class="board-filter-select" aria-label="Show which chapter">
        <option value="">All chapters</option>
        ${acts.map(a => {
          const opts = a.chapters.map(ch => `<option value="${esc(ch.path)}"${ch.path === chosen ? ' selected' : ''}>${esc(ch.folderTitle || ch.name)}</option>`).join('')
          return a.folderTitle !== null ? `<optgroup label="${esc(a.folderTitle || a.name)}">${opts}</optgroup>` : opts
        }).join('')}
      </select></label>
      <span class="board-filter-hint">${chosen
        ? 'Edit cards here. Drag a card by ⠿ to reorder; the scene files follow.'
        : 'Drag a card to reorder it or move its scene to another chapter. Click a card to edit it.'}</span>`
    bar.querySelector('select').onchange = e => { setFilter(novelPath, e.target.value); showNovelOverview(novelPath, container) }
    container.appendChild(bar)

    if (chosen) {
      const grid = document.createElement('div')
      grid.className = 'chapter-board-canvas'
      grid.id = 'board-chapter-grid'
      container.appendChild(grid)
      await showInLanding(chosen, grid)
      return
    }

    acts.forEach(act => {
      // act swimlane
      const lane = document.createElement('div')
      lane.className = 'novel-board-lane'

      if (act.folderTitle !== null) {
        // real act folder — show act header
        const actHdr = document.createElement('div')
        actHdr.className = 'novel-board-act-header'
        actHdr.textContent = act.folderTitle || act.name
        actHdr.onclick = () => App.openFolder(act.path, 'act')
        lane.appendChild(actHdr)
      }

      const cols = document.createElement('div')
      cols.className = 'novel-board-cols'

      if (!act.chapters.length) {
        const empty = document.createElement('div')
        empty.className = 'novel-board-empty-col'
        empty.style.margin = '8px'
        empty.textContent  = 'No chapters yet'
        cols.appendChild(empty)
      } else {
        act.chapters.forEach(ch => {
          const col = document.createElement('div')
          col.className = 'novel-board-col'

          const hdr = document.createElement('div')
          hdr.className   = 'novel-board-col-header'
          hdr.textContent = ch.folderTitle || ch.name
          if (ch.status) {
            const badge = document.createElement('span')
            badge.className   = 'novel-board-ch-status'
            badge.textContent = ch.status
            hdr.appendChild(badge)
          }
          hdr.onclick = () => App.openFolder(ch.path, 'novel')
          col.appendChild(hdr)

          if (!ch.cards || !ch.cards.length) {
            const empty = document.createElement('div')
            empty.className   = 'novel-board-empty-col'
            empty.textContent = 'No scenes yet'
            col.appendChild(empty)
          } else {
            ch.cards.forEach((card, index) => {
              const mini = document.createElement('div')
              mini.className  = 'novel-board-mini-card dnd-item dnd-y'
              mini.tabIndex = 0
              refreshMiniCard(card, mini)
              mini.title = 'Click to edit · drag to move'
              mini.onclick = () => openCorkEditor(card, ch, mini)
              mini.onkeydown = e => { if (e.key === 'Enter') openCorkEditor(card, ch, mini) }
              wireMiniDrag(mini, card, ch, index, () => showNovelOverview(novelPath, container))
              col.appendChild(mini)
            })
          }
          wireColumnDrop(col, ch, () => showNovelOverview(novelPath, container))
          cols.appendChild(col)
        })
      }

      lane.appendChild(cols)
      container.appendChild(lane)
    })
  }

  // ── Dragging cards on the whole-novel Board ───────────────
  // Within a column a drag reorders that chapter; across columns the scene file moves with
  // its card, notes and history (move-scene-between-chapters), and the move can be undone.
  let _miniDrag = null   // { card, ch, index }

  function wireMiniDrag(mini, card, ch, index, rerender) {
    mini.draggable = true
    const below = e => { const r = mini.getBoundingClientRect(); return e.clientY > r.top + r.height / 2 }
    mini.addEventListener('dragstart', e => {
      _miniDrag = { card, ch, index }
      e.dataTransfer.effectAllowed = 'move'
      e.dataTransfer.setData(Dnd.mime('card'), card.id || String(index))
      setTimeout(() => mini.classList.add('dnd-dragging'), 0)
    })
    mini.addEventListener('dragend', () => {
      mini.classList.remove('dnd-dragging')
      document.querySelectorAll('.novel-board-col .dnd-before, .novel-board-col .dnd-after, .novel-board-col.dnd-end')
        .forEach(el => el.classList.remove('dnd-before', 'dnd-after', 'dnd-end'))
      _miniDrag = null
    })
    mini.addEventListener('dragover', e => {
      if (!_miniDrag || _miniDrag.card === card) return
      e.preventDefault(); e.stopPropagation()
      const after = below(e)
      if (mini.classList.contains(after ? 'dnd-after' : 'dnd-before')) return
      document.querySelectorAll('.novel-board-col .dnd-before, .novel-board-col .dnd-after').forEach(el => el.classList.remove('dnd-before', 'dnd-after'))
      mini.classList.add(after ? 'dnd-after' : 'dnd-before')
    })
    mini.addEventListener('dragleave', e => { if (!mini.contains(e.relatedTarget)) mini.classList.remove('dnd-before', 'dnd-after') })
    mini.addEventListener('drop', e => {
      if (!_miniDrag) return
      e.preventDefault(); e.stopPropagation()
      mini.classList.remove('dnd-before', 'dnd-after')
      dropCard(ch, index + (below(e) ? 1 : 0), rerender)
    })
  }

  function wireColumnDrop(col, ch, rerender) {
    col.addEventListener('dragover', e => {
      if (!_miniDrag) return
      e.preventDefault()
      col.classList.add('dnd-end')
    })
    col.addEventListener('dragleave', e => { if (!col.contains(e.relatedTarget)) col.classList.remove('dnd-end') })
    col.addEventListener('drop', e => {
      if (!_miniDrag) return
      e.preventDefault()
      col.classList.remove('dnd-end')
      dropCard(ch, (ch.cards || []).length, rerender)
    })
  }

  // insertAt counts positions in the target column before the move.
  async function dropCard(destCh, insertAt, rerender) {
    const { card, ch: srcCh, index: from } = _miniDrag
    _miniDrag = null
    if (srcCh.path === destCh.path) {
      const to = Dnd.finalIndex(from, insertAt, false)
      if (to === from) return
      const before = srcCh.cards.slice()
      Dnd.move(srcCh.cards, from, to)
      await saveChapterCards(srcCh.path, srcCh.cards)
      await rerender()
      Dnd.undoToast('Card moved.', async () => { await saveChapterCards(srcCh.path, before); rerender() })
      return
    }
    const files = await window.quill.getFilesInFolder(srcCh.path).catch(() => [])
    const linked = files.find(f => (card.scene_id && f.scene_id === card.scene_id)
      || (f.title || '').toLowerCase().trim() === (card.title || '').toLowerCase().trim())
    if (linked) {
      const result = await window.quill.moveSceneBetweenChapters({ rel: linked.path, destFolder: destCh.path, destIndex: insertAt })
      if (result?.ok === false) { alert(result.error); return }
      Tree.refresh()
      await rerender()
      const movedRel = `${destCh.path}/${linked.path.split('/').pop()}`
      Dnd.undoToast(`Moved “${card.title || linked.title}” to ${destCh.folderTitle || destCh.name}.`, async () => {
        const back = await window.quill.moveSceneBetweenChapters({ rel: movedRel, destFolder: srcCh.path, destIndex: from })
        if (back?.ok === false) { alert(back.error); return }
        Tree.refresh(); rerender()
      })
      return
    }
    // A card with no scene file yet only moves between the two boards.
    srcCh.cards.splice(from, 1)
    const dest = (destCh.cards || []).slice()
    dest.splice(Math.min(insertAt, dest.length), 0, card)
    await window.quill.saveBoard({ folderRel: srcCh.path, cards: srcCh.cards }).catch(() => {})
    await window.quill.saveBoard({ folderRel: destCh.path, cards: dest }).catch(() => {})
    await rerender()
  }

  // Saves one chapter's card order and lines its scene files up the same way.
  async function saveChapterCards(chapterPath, cards) {
    await window.quill.saveBoard({ folderRel: chapterPath, cards })
    const files = await window.quill.getFilesInFolder(chapterPath).catch(() => [])
    const names = cards.map(c => files.find(f => (c.scene_id && f.scene_id === c.scene_id)
      || (f.title || '').toLowerCase().trim() === (c.title || '').toLowerCase().trim())).filter(Boolean).map(f => f.name)
    if (names.length) { await window.quill.reorder({ folder: chapterPath, order: names }).catch(() => {}); Tree.refresh() }
  }

  // ── Corkboard card editor (novel overview) ─────────────────
  // Overview cards belong to many chapter boards, so each edit saves that chapter's
  // .board.json directly instead of going through the single-folder _cards state.
  let _cork = null   // { card, ch, mini, linked, timer }

  function initCorkEditor() {
    const overlay = document.getElementById('cork-edit-overlay')
    if (!overlay || overlay.dataset.ready) return
    overlay.dataset.ready = '1'
    overlay.addEventListener('click', e => { if (e.target === overlay) closeCorkEditor() })
    overlay.addEventListener('keydown', e => { if (e.key === 'Escape') closeCorkEditor() })
    document.getElementById('cork-edit-close').onclick = () => closeCorkEditor()
    document.getElementById('cork-edit-title').addEventListener('input', e => {
      if (!_cork) return
      _cork.card.title = e.target.value
      scheduleCorkSave()
    })
    document.getElementById('cork-edit-synopsis').addEventListener('input', e => {
      if (!_cork) return
      _cork.card.body = e.target.value
      scheduleCorkSave()
    })
    document.getElementById('cork-edit-tones').innerHTML = TONES.map(t =>
      `<button class="b-tone-btn" data-tone="${t.id}" style="--tc:${t.color}" data-label="${t.label}" title="${t.label}"></button>`
    ).join('')
    document.querySelectorAll('#cork-edit-tones .b-tone-btn').forEach(btn => {
      btn.onclick = () => {
        if (!_cork) return
        _cork.card.tone = btn.dataset.tone
        markActiveTone()
        scheduleCorkSave()
      }
    })
    document.getElementById('cork-edit-delete').onclick = async () => {
      if (!_cork) return
      const state = _cork
      await closeCorkEditor()
      if (state.linked && !(await trashScene(state.linked.path, state.card.title || state.linked.title))) return
      const at = state.ch.cards.indexOf(state.card)
      if (at !== -1) state.ch.cards.splice(at, 1)
      const result = await window.quill.saveBoard({ folderRel: state.ch.path, cards: state.ch.cards }).catch(() => null)
      if (!result?.ok) { alert('Could not remove that card.'); return }
      const col = state.mini.parentElement
      state.mini.remove()
      if (col && !col.querySelector('.novel-board-mini-card')) {
        const empty = document.createElement('div')
        empty.className   = 'novel-board-empty-col'
        empty.textContent = 'No scenes yet'
        col.appendChild(empty)
      }
    }
    document.getElementById('cork-edit-open').onclick = async () => {
      if (!_cork) return
      const { linked, ch } = _cork
      await closeCorkEditor()
      if (linked) App.openFile(linked.path)
      else App.openFolder(ch.path, 'novel')
    }
  }

  function markActiveTone() {
    document.querySelectorAll('#cork-edit-tones .b-tone-btn').forEach(btn =>
      btn.classList.toggle('active', btn.dataset.tone === (_cork?.card.tone || 'quiet')))
  }

  async function openCorkEditor(card, ch, mini) {
    initCorkEditor()
    await closeCorkEditor()
    const files = await window.quill.getFilesInFolder(ch.path).catch(() => [])
    const linked = files.find(f =>
      (card.scene_id && f.scene_id && card.scene_id === f.scene_id) ||
      (f.title && f.title.toLowerCase().trim() === (card.title || '').toLowerCase().trim())
    ) || null
    _cork = { card, ch, mini, linked, timer: null }
    document.getElementById('cork-edit-chapter').textContent = ch.folderTitle || ch.name
    document.getElementById('cork-edit-title').value = card.title || ''
    document.getElementById('cork-edit-synopsis').value = card.body || ''
    document.getElementById('cork-edit-saved').textContent = linked ? 'Synopsis is shared with the scene file' : 'Card only, no scene file yet'
    document.getElementById('cork-edit-open').textContent = linked ? 'Open scene →' : 'Open chapter →'
    markActiveTone()
    document.getElementById('cork-edit-overlay').classList.add('show')
    setTimeout(() => document.getElementById('cork-edit-synopsis').focus(), 60)
  }

  function scheduleCorkSave() {
    if (!_cork) return
    refreshMiniCard(_cork.card, _cork.mini)
    clearTimeout(_cork.timer)
    _cork.timer = setTimeout(() => saveCork(_cork), 600)
  }

  async function saveCork(state) {
    if (!state) return
    clearTimeout(state.timer)
    state.timer = null
    const result = await window.quill.saveBoard({ folderRel: state.ch.path, cards: state.ch.cards }).catch(() => null)
    if (!result?.ok) { alert('Could not save that card.'); return }
    if (state.linked) Editor.syncSynopsisFromBoard?.(state.linked.path, state.card.body || '')
    if (_cork === state) document.getElementById('cork-edit-saved').textContent = 'Saved'
  }

  async function closeCorkEditor() {
    const state = _cork
    _cork = null
    document.getElementById('cork-edit-overlay')?.classList.remove('show')
    if (state?.timer) await saveCork(state)
  }

  function refreshMiniCard(card, mini) {
    const tone = toneById(card.tone || 'quiet')
    mini.style.setProperty('--tone-color', tone.color)
    mini.style.setProperty('--tone-bg',    tone.bg)
    const body = card.body || ''
    mini.innerHTML = `
      <div class="mini-tone">${tone.label}</div>
      <div class="mini-title">${esc(card.title || 'Untitled')}</div>
      ${body ? `<div class="mini-body">${esc(body.slice(0,80))}${body.length>80?'…':''}</div>` : ''}`
  }

  // Asks before moving a card's scene file to Trash; the count warns when real prose goes with it.
  async function trashScene(filePath, title) {
    const file = await window.quill.getFile(filePath).catch(() => null)
    const words = file?.word_count || 0
    const prose = words ? ` It has ${words.toLocaleString()} word${words === 1 ? '' : 's'} of prose.` : ''
    return App.confirmTrash(filePath, {
      message: `Delete “${title || 'Untitled'}”?${prose} The scene file moves to Trash, and you can restore it from there.`,
    })
  }

  function findLinkedFile(card) {
    return _files.find(f =>
      (card.scene_id && f.scene_id && card.scene_id === f.scene_id) ||
      f.title.toLowerCase().trim() === card.title.toLowerCase().trim()
    )
  }

  function esc(s) { return escapeHtml(s) }
  function uid() { return Math.random().toString(36).slice(2,10) }

  return { init, showInLanding, showNovelOverview, setFilter, loadData, flushPending }
})()
