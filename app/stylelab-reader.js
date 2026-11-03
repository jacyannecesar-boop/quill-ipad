/* stylelab-reader.js — the Style Study book reader.
 *
 * Pages (CSS columns) by default, continuous scroll as a setting; a Contents drawer, whole-book
 * search, highlights with notes, and a remembered position per book.
 *
 * Text pipeline (study.js): a book stores raw paragraphs; `chapterView` builds what is shown
 * (optionally with PDF-split paragraphs repaired) plus the raw ↔ display offset map. Every
 * stored location — highlights, study anchors, reading position — is in raw chapter offsets,
 * so turning repair on or off, or updating the book, never moves it. Matches are drawn with
 * the CSS Custom Highlight API; the book's DOM is only ever text.
 */
const StyleReader = (() => {
  const S = window.QuillStudy
  const PREFS_KEY = 'quill_reader_prefs'
  const POS_KEY = id => `quill_reader_pos_${id}`
  const FOCAL_WORD_CAP = 600
  const GAP = 48

  let _book = null
  let _repair = false
  let _chapter = 0
  let _cv = null              // chapterView of the open chapter
  let _views = {}             // chapter index → view (search)
  let _page = 0
  let _pages = 1
  let _pickFor = null         // study id when choosing a linked excerpt
  let _extendFrom = null      // display offset: start of a selection continued across pages
  let _marks = []             // [{ kind: 'highlight'|'studied', item, start, end }] for this chapter (display)
  let _search = { q: '', hits: [], at: -1 }
  let _down = null
  let _saveTimer = null

  function h(tag, props, ...kids) {
    const el = document.createElement(tag)
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue
      if (k === 'class') el.className = v
      else if (k === 'text') el.textContent = v
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v)
      else if (k === 'value') el.value = v
      else el.setAttribute(k, v === true ? '' : v)
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)))
    return el
  }
  function inner() { return document.getElementById('stylelab-inner') }
  function words(t) { return S.wordCount(t) }

  // ── Prefs + position ────────────────────────────────────────

  function prefs() {
    let p = {}
    try { p = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') || {} } catch {}
    return { mode: p.mode === 'scroll' ? 'scroll' : 'paged', size: Math.max(-2, Math.min(5, Number(p.size) || 0)), style: p.style === 'spaced' ? 'spaced' : 'indent' }
  }
  function setPrefs(patch) {
    const keep = currentPosition()
    try { localStorage.setItem(PREFS_KEY, JSON.stringify({ ...prefs(), ...patch })) } catch {}
    applyTextSize()
    renderChapter({ position: keep })
  }
  function applyTextSize() {
    inner()?.style.setProperty('--ss-read-size', `${17 + prefs().size * 1.5}px`)
  }
  function effectiveRepair(book) {
    if (book.repair === true || book.repair === false) return book.repair
    return !!(book.conversion && book.conversion.likely)
  }
  function savedPosition(bookId) { try { return JSON.parse(localStorage.getItem(POS_KEY(bookId)) || 'null') } catch { return null } }

  function rawStarts(paragraphs) {
    const out = []
    let r = 0
    for (const p of paragraphs) { out.push(r); r += p.t.length + 2 }
    return out
  }

  // Raw chapter offset ↔ { rawParagraph, offset }.
  function rawToPara(paragraphs, r) {
    const starts = rawStarts(paragraphs)
    let k = 0
    while (k + 1 < starts.length && starts[k + 1] <= r) k++
    return { rawParagraph: k, offset: Math.max(0, r - (starts[k] || 0)) }
  }

  function currentPosition() {
    if (!_book || !_cv) return null
    const d = firstVisibleOffset()
    if (d == null) return null
    const r = S.displayToRaw(_cv, d)
    const { rawParagraph, offset } = rawToPara(_book.chapters[_chapter].paragraphs, r)
    return { chapterIndex: _chapter, rawParagraph, offset, quote: _cv.raw.slice(r, r + 40) }
  }
  function savePositionSoon() {
    clearTimeout(_saveTimer)
    _saveTimer = setTimeout(savePositionNow, 250)
  }
  function savePositionNow() {
    clearTimeout(_saveTimer)
    const pos = currentPosition()
    if (pos && _book) try { localStorage.setItem(POS_KEY(_book.id), JSON.stringify(pos)) } catch {}
  }

  // A saved position → display offset in the open chapter. The quote is checked first at the
  // stored offset, then searched for nearby, so font, mode and repair changes keep the spot.
  function positionToDisplay(pos) {
    const paragraphs = _book.chapters[_chapter].paragraphs
    const starts = rawStarts(paragraphs)
    let r = (starts[pos.rawParagraph] ?? 0) + (pos.offset || 0)
    if (pos.quote && _cv.raw.slice(r, r + pos.quote.length) !== pos.quote) {
      const hits = S.findAll(_cv.raw, pos.quote)
      if (hits.length) r = hits.reduce((best, x) => (Math.abs(x.start - r) < Math.abs(best - r) ? x.start : best), hits[0].start)
    }
    return S.rawToDisplay(_cv, Math.max(0, Math.min(_cv.raw.length, r)))
  }

  // ── DOM ↔ display offsets ───────────────────────────────────

  function flowEl() { return document.getElementById('ss-flow') }
  function pagerEl() { return document.getElementById('ss-page') }

  function pointToDisplay(node, offset) {
    const el = (node.nodeType === 1 ? node : node.parentElement)?.closest('p[data-d]')
    if (!el) return null
    const r = document.createRange()
    r.selectNodeContents(el)
    try { r.setEnd(node, offset) } catch { return null }
    const k = Number(el.dataset.d)
    return _cv.paras[k].start + Math.min(r.toString().length, _cv.paras[k].t.length)
  }

  function domPoint(d) {
    const { para, offset } = S.displayPoint(_cv, d)
    const el = flowEl()?.querySelector(`p[data-d="${para}"]`)
    if (!el) return null
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
    let left = offset, n, last = null
    while ((n = walker.nextNode())) {
      last = n
      if (left <= n.textContent.length) return { node: n, offset: left }
      left -= n.textContent.length
    }
    return last ? { node: last, offset: last.textContent.length } : { node: el, offset: 0 }
  }

  function rangeFromDisplay(start, end) {
    const a = domPoint(start), b = domPoint(end)
    if (!a || !b) return null
    const r = document.createRange()
    r.setStart(a.node, a.offset)
    r.setEnd(b.node, b.offset)
    return r
  }

  function selectionDisplay() {
    const sel = window.getSelection()
    const flow = flowEl()
    if (!sel || sel.isCollapsed || !sel.rangeCount || !flow) return null
    const range = sel.getRangeAt(0)
    if (!flow.contains(range.startContainer) || !flow.contains(range.endContainer)) return null
    const s = pointToDisplay(range.startContainer, range.startOffset)
    const e = pointToDisplay(range.endContainer, range.endOffset)
    if (s == null || e == null || e <= s) return null
    return { start: s, end: e }
  }

  function firstVisibleOffset() {
    const pager = pagerEl()
    if (!pager || !_cv) return null
    const box = pager.getBoundingClientRect()
    for (let y = box.top + 4; y < box.top + Math.min(box.height, 240); y += 12) {
      for (const x of [box.left + 6, box.left + 40]) {
        const cr = document.caretRangeFromPoint?.(x, y)
        if (cr && flowEl()?.contains(cr.startContainer)) {
          const d = pointToDisplay(cr.startContainer, cr.startOffset)
          if (d != null) return d
        }
      }
    }
    return prefs().mode === 'paged' && _page === 0 ? 0 : null
  }

  // ── Open + render ───────────────────────────────────────────

  async function open(bookId, { chapterIndex = null, pickFor = null, displayHit = null } = {}) {
    const book = await window.quill.styleStudyGetBook({ id: bookId }).catch(() => null)
    if (!book) { alert('That book is no longer on your shelf.'); return StyleStudy.open() }
    _book = book
    _repair = effectiveRepair(book)
    _views = {}
    _pickFor = pickFor
    _extendFrom = null
    _search = { q: '', hits: [], at: -1 }
    const pos = savedPosition(book.id)
    _chapter = chapterIndex != null ? chapterIndex : (pos && book.chapters[pos.chapterIndex] ? pos.chapterIndex : 0)
    renderShell()
    await renderChapter({ position: chapterIndex == null && pos && pos.chapterIndex === _chapter ? pos : null })
    if (displayHit) goToDisplay(displayHit.start)
  }

  function viewFor(ci) {
    if (!_views[ci]) _views[ci] = S.chapterView(_book.chapters[ci].paragraphs, _repair)
    return _views[ci]
  }

  function renderShell() {
    const root = inner()
    root.innerHTML = ''
    applyTextSize()
    const chip = h('button', { class: 'chip ss-chip ss-repair-chip' + (_repair ? ' active' : ''), id: 'ss-repair-chip', title: 'Paragraph repair for PDF-converted books. Click for reader settings.', onclick: () => togglePanel('aa') },
      _repair ? 'Paragraphs: repaired' : 'Paragraphs: as published')
    root.append(
      h('div', { class: 'ss-reader-bar' },
        h('button', { class: 'btn ghost sm', id: 'ss-reader-back', onclick: () => { savePositionNow(); _pickFor ? StyleStudy.openStudy(_pickFor) : StyleStudy.open() } }, _pickFor ? '‹ Back to the study' : '‹ Bookshelf'),
        h('div', { class: 'ss-reader-book', text: [_book.title, _book.author].filter(Boolean).join(' · ') }),
        h('button', { class: 'btn ghost sm', id: 'ss-contents-btn', onclick: () => togglePanel('contents') }, 'Contents'),
        h('button', { class: 'btn ghost sm', id: 'ss-search-btn', title: 'Search the book (⌘F)', onclick: () => togglePanel('search') }, 'Search'),
        h('button', { class: 'btn ghost sm', id: 'ss-aa-btn', title: 'Reader settings', onclick: () => togglePanel('aa') }, 'Aa'),
        chip,
        h('div', { class: 'ss-position', id: 'ss-position' })),
      h('div', { class: 'hint ss-hint', hidden: !_pickFor }, 'Select the paragraphs to add as a linked excerpt.'),
      h('div', { class: 'ss-extend-note', id: 'ss-extend-note', hidden: true }),
      h('div', { class: 'ss-reader-body', id: 'ss-reader-body' },
        h('div', { class: 'ss-panel ss-contents', id: 'ss-contents', hidden: true }),
        h('div', { class: 'ss-panel ss-search', id: 'ss-search', hidden: true }),
        h('div', { class: 'ss-panel ss-aa', id: 'ss-aa', hidden: true }),
        h('div', { class: 'ss-page', id: 'ss-page', tabindex: '0' }, h('div', { class: 'ss-flow', id: 'ss-flow' }))),
    )
    const pager = pagerEl()
    pager.addEventListener('keydown', onPagerKey)
    pager.addEventListener('mousedown', e => { _down = { x: e.clientX, y: e.clientY } })
    pager.addEventListener('mouseup', e => setTimeout(() => onPagerMouseUp(e), 0))
    pager.addEventListener('scroll', () => { if (prefs().mode === 'scroll') { updatePosition(); savePositionSoon() } })
  }

  async function renderChapter({ position = null, page = null, atEnd = false } = {}) {
    const flow = flowEl(), pager = pagerEl()
    if (!flow) return
    _cv = viewFor(_chapter)
    const p = prefs()
    pager.classList.toggle('paged', p.mode === 'paged')
    pager.classList.toggle('scrolling', p.mode === 'scroll')
    flow.classList.toggle('spaced', p.style === 'spaced')
    flow.innerHTML = ''
    flow.append(h('div', { class: 'ss-page-title', text: _book.chapters[_chapter].title }))
    _cv.paras.forEach((para, k) => {
      const el = h(para.h ? 'p' : 'p', { 'data-d': k, class: para.h ? 'ss-p-heading' : null })
      renderText(el, para)
      flow.append(el)
    })
    flow.append(h('div', { class: 'ss-chapter-end' },
      _chapter < _book.chapters.length - 1 ? h('button', { class: 'btn sm', onclick: () => gotoChapter(_chapter + 1) }, `Next: ${_book.chapters[_chapter + 1].title} ›`) : h('span', { class: 'hint ss-hint' }, 'End of the book.')))
    layoutPager()
    await loadMarks()
    drawHighlights()
    if (position) goToDisplay(positionToDisplay(position))
    else if (atEnd) setPage(_pages - 1)
    else setPage(page || 0)
    if (prefs().mode === 'scroll' && !position && !atEnd) pager.scrollTop = 0
    renderContents()
    updatePosition()
    pager.focus({ preventScroll: true })
  }

  function renderText(el, p) {
    let at = 0
    for (const [s, e] of p.i || []) {
      if (s > at) el.append(document.createTextNode(p.t.slice(at, s)))
      el.append(h('em', { text: p.t.slice(s, e) }))
      at = e
    }
    if (at < p.t.length) el.append(document.createTextNode(p.t.slice(at)))
  }

  function layoutPager() {
    const pager = pagerEl(), flow = flowEl()
    if (!pager || !flow) return
    const top = pager.getBoundingClientRect().top
    pager.style.height = Math.max(320, window.innerHeight - top - 24) + 'px'
    if (prefs().mode === 'paged') {
      const w = pager.clientWidth
      flow.style.columnWidth = w + 'px'
      flow.style.columnGap = GAP + 'px'
      flow.style.height = pager.clientHeight + 'px'
      _pages = Math.max(1, Math.round((flow.scrollWidth + GAP) / (w + GAP)))
    } else {
      flow.style.columnWidth = ''
      flow.style.height = ''
      flow.style.transform = ''
      _pages = 1
    }
  }

  function setPage(n) {
    if (prefs().mode !== 'paged') return
    _page = Math.max(0, Math.min(_pages - 1, n))
    flowEl().style.transform = `translateX(${-_page * (pagerEl().clientWidth + GAP)}px)`
    updatePosition()
    savePositionSoon()
  }

  function goToDisplay(d) {
    const pt = domPoint(d)
    if (!pt) return
    const r = document.createRange()
    r.setStart(pt.node, pt.offset)
    r.setEnd(pt.node, Math.min(pt.node.textContent?.length ?? 0, pt.offset + 1))
    const rect = r.getClientRects()[0] || r.getBoundingClientRect()
    if (prefs().mode === 'paged') {
      const flowLeft = flowEl().getBoundingClientRect().left
      setPage(Math.floor((rect.left - flowLeft + 1) / (pagerEl().clientWidth + GAP)))
    } else {
      const pager = pagerEl()
      pager.scrollTop += rect.top - pager.getBoundingClientRect().top - 16
      updatePosition()
      savePositionSoon()
    }
  }

  function nextPage() {
    if (_page < _pages - 1) return setPage(_page + 1)
    if (_chapter < _book.chapters.length - 1) gotoChapter(_chapter + 1)
  }
  function prevPage() {
    if (_page > 0) return setPage(_page - 1)
    if (_chapter > 0) gotoChapter(_chapter - 1, { atEnd: true })
  }
  function gotoChapter(ci, opts = {}) {
    _chapter = ci
    _extendFrom = null
    showExtendNote()
    removeFloat()
    return renderChapter(opts)
  }

  function updatePosition() {
    const el = document.getElementById('ss-position')
    if (!el || !_book) return
    let before = 0, total = 0
    _book.chapters.forEach((c, n) => { const len = S.rawChapterText(c.paragraphs).length; if (n < _chapter) before += len; total += len })
    const d = firstVisibleOffset()
    const r = d == null ? 0 : S.displayToRaw(_cv, d)
    const pct = total ? Math.round(((before + r) / total) * 100) : 0
    const where = prefs().mode === 'paged' ? ` · page ${_page + 1} of ${_pages}` : ''
    el.textContent = `${_book.chapters[_chapter].title}${where} · ${pct}% of the book`
  }

  // ── Input: keys, edge clicks, selection ─────────────────────

  function onPagerKey(e) {
    if (e.target !== pagerEl()) return
    const sel = window.getSelection()
    if (sel && !sel.isCollapsed) return
    if (prefs().mode !== 'paged') return
    if (['ArrowRight', 'PageDown'].includes(e.key) || (e.key === ' ' && !e.shiftKey)) { e.preventDefault(); nextPage() }
    else if (['ArrowLeft', 'PageUp'].includes(e.key) || (e.key === ' ' && e.shiftKey)) { e.preventDefault(); prevPage() }
  }

  function onPagerMouseUp(e) {
    const moved = _down && (Math.abs(e.clientX - _down.x) > 4 || Math.abs(e.clientY - _down.y) > 4)
    _down = null
    if (e.target.closest('.ss-chapter-end, button, a')) return
    const sel = selectionDisplay()
    if (_extendFrom != null) {
      // Finishing a selection that began on an earlier page: the end comes from this page's
      // selection or click, the start from state — never from the browser's selection alone.
      let end = sel ? sel.end : null
      if (end == null) {
        const cr = document.caretRangeFromPoint?.(e.clientX, e.clientY)
        end = cr ? pointToDisplay(cr.startContainer, cr.startOffset) : null
      }
      if (end == null || end <= _extendFrom) return
      const range = rangeFromDisplay(_extendFrom, end)
      if (range) { const s = window.getSelection(); s.removeAllRanges(); s.addRange(range) }
      const start = _extendFrom
      _extendFrom = null
      showExtendNote()
      return showSelectionBar({ start, end })
    }
    if (sel) return showSelectionBar(sel)
    removeFloat()
    // A plain click: a mark opens its popover; otherwise the page edges turn pages.
    const cr = document.caretRangeFromPoint?.(e.clientX, e.clientY)
    const d = cr && flowEl().contains(cr.startContainer) ? pointToDisplay(cr.startContainer, cr.startOffset) : null
    const mark = d != null && _marks.find(m => d >= m.start && d < m.end)
    if (mark) return showMarkPopover(mark, e)
    if (moved || prefs().mode !== 'paged') return
    const box = pagerEl().getBoundingClientRect()
    const x = (e.clientX - box.left) / box.width
    if (x < 0.22) prevPage()
    else if (x > 0.78) nextPage()
    pagerEl().focus({ preventScroll: true })
  }

  function showExtendNote() {
    const el = document.getElementById('ss-extend-note')
    if (!el) return
    el.hidden = _extendFrom == null
    el.replaceChildren(_extendFrom == null ? '' : h('span', {}, 'Selecting across pages: select or click where the passage ends. '),
      _extendFrom == null ? '' : h('button', { class: 'btn sm', onclick: () => { _extendFrom = null; showExtendNote() } }, 'Cancel'))
  }

  function removeFloat() { document.getElementById('ss-float')?.remove(); document.getElementById('ss-mark-pop')?.remove() }

  // Enclosing displayed paragraphs of a display range.
  function enclosing(start, end) {
    const a = S.displayPoint(_cv, start).para
    const b = S.displayPoint(_cv, Math.max(start, end - 1)).para
    return { a, b, paras: _cv.paras.slice(a, b + 1) }
  }

  function rawAnchorFor(start, end) {
    const ch = _book.chapters[_chapter]
    return S.rawAnchor(ch.paragraphs, _chapter, ch.title, S.displayToRaw(_cv, start), S.displayToRaw(_cv, end))
  }

  function sourceFields() {
    const ch = _book.chapters[_chapter]
    return { kind: 'book', bookId: _book.id, bookTitle: _book.title, author: _book.author, chapterIndex: _chapter, chapterTitle: ch.title }
  }

  // Seed for a study: the enclosing paragraphs as the focal excerpt, the exact phrase anchored
  // inside it (an auto note, not yet an observation), and the excerpt's raw anchor.
  function studySeed(start, end, note = '') {
    const { a, b, paras } = enclosing(start, end)
    const focalStart = _cv.paras[a].start
    const focalEnd = _cv.paras[b].start + _cv.paras[b].t.length
    return {
      source: sourceFields(),
      paragraphs: paras.map(p => (p.i ? { t: p.t, i: p.i } : { t: p.t })),
      anchor: rawAnchorFor(focalStart, focalEnd),
      phrase: (start > focalStart || end < focalEnd) ? { start: start - focalStart, end: end - focalStart } : null,
      note,
    }
  }

  function showSelectionBar({ start, end }) {
    removeFloat()
    const range = rangeFromDisplay(start, end)
    const rects = range ? [...range.getClientRects()] : []
    const pagerBox = pagerEl().getBoundingClientRect()
    const visible = rects.filter(r => r.right > pagerBox.left && r.left < pagerBox.right)
    const rect = visible[visible.length - 1] || pagerBox
    const { paras } = enclosing(start, end)
    const count = paras.reduce((n, p) => n + words(p.t), 0)
    const note = h('input', { class: 'field ss-hl-note', id: 'ss-hl-note', placeholder: 'Note (optional)' })
    note.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') save() })
    const save = async () => {
      const anchor = rawAnchorFor(start, end)
      const phrase = _cv.text.slice(start, end)
      const seed = studySeed(start, end)
      await window.quill.styleStudySaveLater({ ...sourceFields(), anchor, phrase, note: note.value.trim(), paragraphs: seed.paragraphs, text: phrase })
      window.getSelection()?.removeAllRanges()
      bar.replaceChildren(h('span', { class: 'ss-float-note' }, 'Highlighted.'))
      await loadMarks(); drawHighlights()
      setTimeout(removeFloat, 900)
    }
    const bar = h('div', { class: 'ss-float', id: 'ss-float', style: `top:${window.scrollY + Math.min(window.innerHeight - 60, rect.bottom + 8)}px;left:${Math.max(12, Math.min(window.innerWidth - 460, rect.left))}px;` })
    if (_pickFor) {
      bar.append(h('button', { class: 'btn primary', id: 'ss-add-linked', onclick: () => {
        removeFloat()
        const seed = studySeed(start, end)
        StyleStudy.addLinkedExcerpt(_pickFor, seed)
      } }, `Add to study (${count} words)`))
    } else {
      bar.append(h('button', { class: 'btn', id: 'ss-highlight', onclick: save }, 'Highlight'), note)
      if (count <= FOCAL_WORD_CAP) {
        bar.append(h('button', { class: 'btn primary', id: 'ss-study-this', onclick: () => {
          removeFloat(); savePositionNow()
          StyleStudy.startStudy(studySeed(start, end, note.value.trim()))
        } }, 'Study this'))
      } else {
        bar.append(h('span', { class: 'ss-float-note' }, `${count} words — highlight it, or pick up to ~${FOCAL_WORD_CAP} to study.`))
      }
    }
    if (prefs().mode === 'paged' && (_page < _pages - 1)) {
      bar.append(h('button', { class: 'btn sm', id: 'ss-continue-sel', onclick: () => {
        _extendFrom = start
        removeFloat()
        nextPage()
        showExtendNote()
        pagerEl().focus({ preventScroll: true })
      } }, 'Continue on next page ›'))
    }
    document.body.append(bar)
  }

  // ── Marks: highlights + studied passages ────────────────────

  async function loadMarks() {
    _marks = []
    if (!_book) return
    const [later, studies] = await Promise.all([
      window.quill.styleStudyListLater().catch(() => []),
      window.quill.styleStudyList().catch(() => []),
    ])
    const ch = _book.chapters[_chapter]
    const place = (kind, item, anchor) => {
      const found = S.locatePassage(_book, anchor)
      if (found.status !== 'ok' || found.chapterIndex !== _chapter) return
      _marks.push({ kind, item, start: S.rawToDisplay(_cv, found.start), end: S.rawToDisplay(_cv, found.end) })
    }
    for (const l of later) {
      if (l.bookId !== _book.id) continue
      place('highlight', l, l.anchor || { chapterIndex: l.chapterIndex, chapterTitle: l.chapterTitle || ch.title, quote: l.text, prefix: '', suffix: '' })
    }
    for (const s of studies) if (s.mark && s.mark.bookId === _book.id) place('studied', s, s.mark.anchor)
  }

  function drawHighlights() {
    if (!window.CSS || !CSS.highlights || typeof Highlight === 'undefined') return
    const hl = new Highlight(), st = new Highlight()
    for (const m of _marks) { const r = rangeFromDisplay(m.start, m.end); if (r) (m.kind === 'highlight' ? hl : st).add(r) }
    CSS.highlights.set('ss-hl', hl)
    CSS.highlights.set('ss-studied', st)
    drawSearch()
  }

  function showMarkPopover(mark, e) {
    removeFloat()
    const pop = h('div', { class: 'ss-float', id: 'ss-mark-pop', style: `top:${window.scrollY + e.clientY + 12}px;left:${Math.max(12, e.clientX - 40)}px;` })
    if (mark.kind === 'highlight') {
      if (mark.item.note) pop.append(h('span', { class: 'ss-float-note', text: mark.item.note }))
      pop.append(
        h('button', { class: 'btn primary', onclick: () => { removeFloat(); savePositionNow(); StyleStudy.startStudy({ ...studySeed(mark.start, mark.end, mark.item.note || ''), highlightId: mark.item.id }) } }, 'Study this'),
        h('button', { class: 'btn sm', onclick: async () => { await window.quill.styleStudyDeleteLater({ id: mark.item.id }); removeFloat(); await loadMarks(); drawHighlights() } }, 'Remove highlight'))
    } else {
      pop.append(h('button', { class: 'btn primary', onclick: () => { removeFloat(); savePositionNow(); StyleStudy.openStudy(mark.item.id) } }, 'Open study'))
    }
    document.body.append(pop)
  }

  // ── Panels: contents, search, settings ─────────────────────

  function togglePanel(name) {
    for (const p of ['contents', 'search', 'aa']) {
      const el = document.getElementById('ss-' + p)
      if (!el) continue
      el.hidden = p === name ? !el.hidden : true
    }
    if (name === 'search' && !document.getElementById('ss-search').hidden) renderSearch()
    if (name === 'aa' && !document.getElementById('ss-aa').hidden) renderAa()
    if (name === 'contents') renderContents()
    if (document.getElementById('ss-' + name)?.hidden) pagerEl()?.focus({ preventScroll: true })
  }

  function renderContents() {
    const el = document.getElementById('ss-contents')
    if (!el) return
    el.replaceChildren(..._book.chapters.map((c, n) => h('button', {
      class: 'ss-toc-item' + (n === _chapter ? ' active' : ''), 'data-ch': n,
      onclick: () => { el.hidden = true; savePositionNow(); gotoChapter(n) },
    }, c.title)))
  }

  function renderSearch() {
    const el = document.getElementById('ss-search')
    const input = h('input', { class: 'field', id: 'ss-search-input', placeholder: 'Search this book', value: _search.q })
    const count = h('div', { class: 'hint ss-hint', id: 'ss-search-count' })
    const list = h('div', { class: 'ss-search-list', id: 'ss-search-list' })
    el.replaceChildren(input, count, list)
    let timer = null
    const run = () => {
      _search.q = input.value
      _search.hits = []
      _search.at = -1
      if (input.value.trim().length >= 2) {
        _book.chapters.forEach((_, ci) => {
          const v = viewFor(ci)
          for (const m of S.findAll(v.text, input.value, 2000)) _search.hits.push({ ci, ...m })
        })
      }
      count.textContent = input.value.trim().length < 2 ? '' : `${_search.hits.length} result${_search.hits.length === 1 ? '' : 's'}`
      list.replaceChildren(..._search.hits.slice(0, 300).map((hit, n) => {
        const v = viewFor(hit.ci)
        const from = Math.max(0, hit.start - 50), to = Math.min(v.text.length, hit.end + 50)
        return h('button', { class: 'ss-search-hit', 'data-hit': n, onclick: () => goToHit(n) },
          h('span', { class: 'ss-search-ch', text: _book.chapters[hit.ci].title }),
          h('span', { class: 'ss-search-snip' }, (from ? '…' : '') + v.text.slice(from, hit.start).replace(/\s+/g, ' '),
            h('mark', { text: v.text.slice(hit.start, hit.end) }), v.text.slice(hit.end, to).replace(/\s+/g, ' ') + (to < v.text.length ? '…' : '')))
      }))
      drawSearch()
    }
    input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(run, 180) })
    input.addEventListener('keydown', e => {
      e.stopPropagation()
      if (e.key === 'Enter' || e.key === 'ArrowDown') { e.preventDefault(); if (_search.hits.length) goToHit((_search.at + 1) % _search.hits.length) }
      if (e.key === 'ArrowUp') { e.preventDefault(); if (_search.hits.length) goToHit((_search.at - 1 + _search.hits.length) % _search.hits.length) }
      if (e.key === 'Escape') { el.hidden = true; pagerEl().focus({ preventScroll: true }) }
    })
    if (_search.q) run()
    setTimeout(() => input.focus(), 0)
  }

  async function goToHit(n) {
    const hit = _search.hits[n]
    if (!hit) return
    _search.at = n
    document.querySelectorAll('.ss-search-hit.active').forEach(b => b.classList.remove('active'))
    document.querySelector(`.ss-search-hit[data-hit="${n}"]`)?.classList.add('active')
    if (hit.ci !== _chapter) { savePositionNow(); _chapter = hit.ci; await renderChapter() }
    goToDisplay(hit.start)
    drawSearch()
  }

  function drawSearch() {
    if (!window.CSS || !CSS.highlights || typeof Highlight === 'undefined') return
    const all = new Highlight(), cur = new Highlight()
    _search.hits.forEach((hit, n) => {
      if (hit.ci !== _chapter) return
      const r = rangeFromDisplay(hit.start, hit.end)
      if (r) (n === _search.at ? cur : all).add(r)
    })
    CSS.highlights.set('ss-search', all)
    CSS.highlights.set('ss-search-current', cur)
  }

  function renderAa() {
    const el = document.getElementById('ss-aa')
    const p = prefs()
    const ev = _book.conversion || {}
    const seg = (label, opts, value, on) => h('div', { class: 'ss-aa-row' }, h('span', { class: 'ss-lbl' }, label),
      h('div', { class: 'seg ss-seg' }, opts.map(([v, l]) => h('button', { class: 'ss-seg-btn' + (value === v ? ' active' : ''), 'data-v': v, onclick: () => on(v) }, l))))
    const defaultText = ev.likely
      ? `On by default: ${ev.pageAnchors} paragraphs start at a printed-page marker, and ${Math.round(ev.ratio * 100)}% of those split a sentence — this looks like a PDF conversion.`
      : (ev.pageAnchors != null ? 'Off by default: no sign of a PDF conversion.' : 'This book was imported before repair existed. Update its text to measure it.')
    const repairBox = h('input', { type: 'checkbox', id: 'ss-repair-toggle', checked: _repair })
    repairBox.addEventListener('change', async () => {
      const keep = currentPosition()
      await window.quill.styleStudySetRepair({ id: _book.id, repair: repairBox.checked })
      _book.repair = repairBox.checked
      _repair = repairBox.checked
      _views = {}
      if (_search.q) _search.hits = []
      renderShell()
      await renderChapter({ position: keep })
      togglePanel('aa')
    })
    el.replaceChildren(
      seg('Layout', [['paged', 'Pages'], ['scroll', 'Scroll']], p.mode, v => setPrefs({ mode: v })),
      h('div', { class: 'ss-aa-row' }, h('span', { class: 'ss-lbl' }, 'Text size'),
        h('div', { class: 'seg ss-seg' },
          h('button', { class: 'ss-seg-btn', id: 'ss-size-down', onclick: () => setPrefs({ size: p.size - 1 }) }, 'A−'),
          h('button', { class: 'ss-seg-btn', id: 'ss-size-up', onclick: () => setPrefs({ size: p.size + 1 }) }, 'A+'))),
      seg('Paragraphs', [['indent', 'Indented'], ['spaced', 'Spaced']], p.style, v => setPrefs({ style: v })),
      h('label', { class: 'ss-aa-check' }, repairBox, ' Repair PDF-converted paragraphs'),
      h('div', { class: 'hint ss-hint' }, defaultText),
      _book.repair === true || _book.repair === false
        ? h('button', { class: 'btn sm', onclick: async () => { await window.quill.styleStudySetRepair({ id: _book.id, repair: null }); _book.repair = null; const keep = currentPosition(); _repair = effectiveRepair(_book); _views = {}; renderShell(); await renderChapter({ position: keep }) } }, 'Use the default for this book')
        : null,
      h('div', { class: 'ss-aa-row' },
        h('button', { class: 'btn sm', id: 'ss-update-book', onclick: () => updateText(false) }, 'Re-read from EPUB'),
        _book.hasPrev ? h('button', { class: 'btn sm', id: 'ss-restore-book', onclick: () => updateText(true) }, 'Restore previous version') : null),
    )
  }

  async function updateText(restore) {
    const keep = currentPosition()
    const res = restore ? await window.quill.styleStudyRestoreBook({ id: _book.id }) : await window.quill.styleStudyUpdateBook({ id: _book.id })
    if (!res || !res.ok) { if (res && !res.canceled) alert(res.error || 'Could not update the text.'); return }
    try { if (keep) localStorage.setItem(POS_KEY(_book.id), JSON.stringify(keep)) } catch {}
    await open(_book.id, { pickFor: _pickFor })
  }

  // ⌘F opens search while the reader is showing.
  document.addEventListener('keydown', e => {
    if (!_book || !document.getElementById('ss-page') || !(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'f') return
    if (!document.getElementById('view-stylelab')?.classList.contains('active')) return
    e.preventDefault()
    e.stopPropagation()
    const el = document.getElementById('ss-search')
    if (el.hidden) togglePanel('search')
    else document.getElementById('ss-search-input')?.focus()
  }, true)
  window.addEventListener('resize', () => {
    if (!document.getElementById('ss-page')) return
    const keep = currentPosition()
    layoutPager()
    if (keep) goToDisplay(positionToDisplay(keep))
    drawHighlights()
  })

  return {
    open, savedPosition, effectiveRepair,
    isOpen: () => !!document.getElementById('ss-page'),
    _test: {
      state: () => ({ chapter: _chapter, page: _page, pages: _pages, repair: _repair, extendFrom: _extendFrom, marks: _marks.length, hits: _search.hits.length, mode: prefs().mode }),
      currentPosition, rangeFromDisplay, nextPage, prevPage, view: () => _cv,
      // Is the character a saved position points at inside the visible page?
      visible: pos => {
        const r = rangeFromDisplay(positionToDisplay(pos), positionToDisplay(pos) + 1)
        const box = pagerEl().getBoundingClientRect()
        return !!r && [...r.getClientRects()].some(x => x.left >= box.left - 1 && x.right <= box.right + 1 && x.top >= box.top - 1 && x.bottom <= box.bottom + 1)
      },
    },
  }
})()
