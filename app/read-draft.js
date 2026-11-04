/* read-draft.js — Read Draft as a standard manuscript, with an Editor mode for margin notes.
 *
 * Both Read Draft surfaces (the toolbar view and the novel landing tab) render through here.
 * The draft is laid out on fixed 8.5×11 pages in standard manuscript format: 12pt on 24pt
 * leading, 1" margins, running header, chapters opening a third of the way down. Those
 * metrics are shared with both exports (renderer/manuscript-docx.js and the print stylesheet
 * in main.js), so the preview, the PDF and the .docx all paginate alike.
 *
 * Editor mode never makes the prose editable. The only thing it writes is a scene's
 * `.comments.json` sidecar, in the same shape and anchor scheme the scene editor uses
 * (renderer/src/editor/comments.js): { blockIndex, start, end } over textblocks numbered in
 * document pre-order, counting a hard break as one character.
 */
const ReadDraft = (() => {
  const PAGE_W = 816, PAGE_H = 1056          // 8.5in × 11in at 96dpi
  const MARGIN = 96                          // 1in
  const LINE = 32                            // 12pt on 24pt leading: true double spacing
  const TEXT_H = PAGE_H - MARGIN * 2         // 864px = 27 lines exactly
  const GUTTER_W = 280
  const MODE_KEY = 'quill_read_mode'
  const SVG = 'http://www.w3.org/2000/svg'

  const TYPES = {
    revisit:  { label:'Revisit',  color:'#f59e0b' },
    rewrite:  { label:'Rewrite',  color:'#3b82f6' },
    research: { label:'Research', color:'#8b5cf6' },
    cut:      { label:'Cut',      color:'#ef4444' },
    note:     { label:'Note',     color:'#10b981' },
  }

  const esc = s => escapeHtml(s)

  // One live render per container; a newer render for the same container cancels the old.
  const _states = new Map()

  // ── Text offsets (hard break = 1 character, as in comments.js) ──────────

  function blockText(el) {
    let text = ''
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT)
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (n.nodeType === Node.TEXT_NODE) text += n.data
      else if (n.nodeName === 'BR') text += '\n'
    }
    return text
  }

  function offsetWithin(el, node, offset) {
    const range = document.createRange()
    range.setStart(el, 0)
    range.setEnd(node, offset)
    return blockText(range.cloneContents()).length
  }

  // The DOM point `offset` characters into `el`.
  function pointAt(el, offset) {
    let seen = 0
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT)
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (n.nodeType === Node.TEXT_NODE) {
        if (seen + n.data.length >= offset) return { node: n, offset: offset - seen }
        seen += n.data.length
      } else if (n.nodeName === 'BR') {
        if (seen === offset) return { node: n.parentNode, offset: [...n.parentNode.childNodes].indexOf(n) }
        seen += 1
      }
    }
    return { node: el, offset: el.childNodes.length }
  }

  // Keep only [from, to) of a block's content, splitting inline marks as needed.
  function sliceBlock(el, from, to) {
    const copy = el.cloneNode(true)
    const len = blockText(copy).length
    if (to < len) {
      const r = document.createRange()
      const p = pointAt(copy, to)
      r.setStart(p.node, p.offset); r.setEnd(copy, copy.childNodes.length); r.deleteContents()
    }
    if (from > 0) {
      const r = document.createRange()
      const p = pointAt(copy, from)
      r.setStart(copy, 0); r.setEnd(p.node, p.offset); r.deleteContents()
    }
    return copy
  }

  // ── Manuscript details ──────────────────────────────────────────────────

  const ONES = ['Zero','One','Two','Three','Four','Five','Six','Seven','Eight','Nine','Ten',
    'Eleven','Twelve','Thirteen','Fourteen','Fifteen','Sixteen','Seventeen','Eighteen','Nineteen']
  const TENS = ['','','Twenty','Thirty','Forty','Fifty','Sixty','Seventy','Eighty','Ninety']
  function spell(n) {
    if (n < 20) return ONES[n]
    if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? '-' + ONES[n % 10] : '')
    return String(n)
  }

  function roundedWords(n) {
    if (n < 1000) return `about ${Math.max(100, Math.round(n / 100) * 100).toLocaleString()} words`
    return `about ${(Math.round(n / 1000) * 1000).toLocaleString()} words`
  }

  function notesShown() {
    try { return localStorage.getItem('quill_read_draft_notes') === 'on' } catch { return false }
  }

  function plainWords(body) {
    const collect = node => node.type === 'text' ? node.text
      : node.type === 'hardBreak' ? '\n' : (node.content || []).map(collect).join(' ')
    return QuillWords.countPlain(collect(window.QuillMd.parseMarkdown(body)).trim())
  }

  // ── Pagination ──────────────────────────────────────────────────────────

  function makePage(state, { numbered = true } = {}) {
    const row = document.createElement('div')
    row.className = 'ms-row'
    const page = document.createElement('div')
    page.className = 'ms-page'
    if (numbered) {
      state.pageNo++
      const header = document.createElement('div')
      header.className = 'ms-header'
      header.textContent = [state.surname, state.shortTitle, state.pageNo].filter(Boolean).join(' / ')
      page.appendChild(header)
    }
    const text = document.createElement('div')
    text.className = 'ms-text'
    page.appendChild(text)
    const ink = document.createElementNS(SVG, 'svg')
    ink.setAttribute('class', 'ms-ink')
    ink.setAttribute('aria-hidden', 'true')
    page.appendChild(ink)
    const gutter = document.createElement('div')
    gutter.className = 'ms-gutter'
    row.append(page, gutter)
    state.column.appendChild(row)
    state.pages.push(page)
    state.text = text
    return text
  }

  const fits = (text, el) => el.offsetTop + el.offsetHeight <= TEXT_H

  // Place one element, starting a new page when it doesn't fit. Paragraphs split across
  // pages at a word boundary; the continuation carries data-off so offsets stay block-wide.
  function place(state, el) {
    if (!state.text) makePage(state)
    state.text.appendChild(el)
    if (fits(state.text, el)) return
    const splittable = el.dataset.b != null && el.tagName === 'P'
    if (!splittable) {
      if (state.text.children.length > 1) {
        el.remove(); makePage(state); state.text.appendChild(el)
      }
      return   // an unsplittable element taller than a page is left to overflow
    }
    const full = blockText(el)
    const base = Number(el.dataset.off || 0)
    // candidate split points: the start of each word after the first
    const cuts = []
    for (let i = 1; i < full.length; i++) if (/\s/.test(full[i - 1]) && !/\s/.test(full[i])) cuts.push(i)
    let lo = 0, hi = cuts.length - 1, best = -1
    const original = el
    let probe = el
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      const head = sliceBlock(original, 0, cuts[mid])
      probe.replaceWith(head); probe = head
      if (fits(state.text, head)) { best = mid; lo = mid + 1 } else hi = mid - 1
    }
    if (best < 0) {
      probe.remove()
      if (state.text.children.length === 0) {       // one word taller than a page: give up
        state.text.appendChild(original); makePage(state); return
      }
      makePage(state); place(state, original); return
    }
    const head = sliceBlock(original, 0, cuts[best])
    probe.replaceWith(head)
    const tail = sliceBlock(original, cuts[best], full.length)
    tail.classList.add('cont')
    tail.dataset.off = String(base + cuts[best])
    makePage(state)
    place(state, tail)
  }

  function sceneBlocks(scene, showNotes = false) {
    const holder = document.createElement('div')
    holder.innerHTML = window.QuillMd.renderMarkdownHtml(scene.body, { blockAttrs: true, showNotes })
    const out = []
    for (const child of [...holder.children]) {
      if (child.matches('hr, .scene-break')) { out.push(breakEl()); continue }
      for (const b of child.matches('[data-b]') ? [child] : child.querySelectorAll('[data-b]')) {
        b.dataset.scene = scene.path
      }
      out.push(child)
    }
    return out
  }

  function breakEl() {
    const el = document.createElement('div')
    el.className = 'ms-break'
    el.textContent = '#'
    return el
  }

  function titlePage(state, { title, pen, words }) {
    makePage(state, { numbered: false })
    state.text.parentElement.classList.add('ms-title-page')
    state.text.innerHTML = `
      <div class="ms-tp-top">
        <span>${esc(pen)}</span>
        <span>${esc(roundedWords(words))}</span>
      </div>
      <div class="ms-tp-center">
        <div class="ms-tp-title">${esc(title)}</div>
        ${pen ? `<div class="ms-tp-by">by ${esc(pen)}</div>` : ''}
      </div>`
    state.text = null
  }

  // What a chapter or part opening reads as. Shared with the .docx export so the preview and
  // the exported manuscript can never number or name a chapter differently.
  function openingLabel(kind, number, title) {
    const label = kind === 'act' ? `Part ${spell(number)}` : `Chapter ${spell(number)}`
    // A title that already names itself ("Chapter 3", "Part Two: …") stands alone.
    const selfNamed = new RegExp('^' + (kind === 'act' ? 'part|act' : 'chapter') + '\\b', 'i').test(title || '')
    return selfNamed || !title ? { label: title || label, title: '' } : { label, title }
  }

  function openingPage(state, kind, number, title) {
    const text = makePage(state)
    const head = document.createElement('div')
    head.className = kind === 'act' ? 'ms-part-open' : 'ms-chapter-open'
    const open = openingLabel(kind, number, title)
    head.innerHTML = `<div class="ms-open-label">${esc(open.label)}</div>`
      + (open.title ? `<div class="ms-open-title">${esc(open.title)}</div>` : '')
    text.appendChild(head)
    if (kind === 'act') state.text = null   // a part title gets its page to itself
  }

  const tick = () => new Promise(resolve => setTimeout(resolve, 0))

  async function paginate(state, sections, { scope, meta, startChapter }) {
    const title = meta.folder_title || 'Untitled'
    let words = 0
    for (const s of sections) if (s.type === 'scene' && s.body) words += plainWords(s.body)
    if (scope === 'novel') titlePage(state, { title, pen: state.pen, words })

    let chapterNo = startChapter - 1, actNo = 0, placed = 0, sceneInChapter = 0
    for (const s of sections) {
      if (state.cancelled) return words
      if (s.type === 'act') { openingPage(state, 'act', ++actNo, s.title); continue }
      if (s.type === 'chapter') { openingPage(state, 'chapter', ++chapterNo, s.title); sceneInChapter = 0; continue }
      if (s.type !== 'scene' || !s.body) continue
      if (sceneInChapter++ > 0) place(state, breakEl())
      state.sceneTitles.set(s.path, s.title || s.path.split('/').pop().replace(/\.md$/, ''))
      for (const el of sceneBlocks(s, state.showNotes)) {
        place(state, el)
        if (++placed % 150 === 0) await tick()
      }
    }
    if (scope === 'novel') {
      const end = document.createElement('div')
      end.className = 'ms-end'
      end.textContent = 'THE END'
      place(state, end)
    }
    return words
  }

  // ── Scale to the window ─────────────────────────────────────────────────

  function applyScale(state) {
    const editing = state.root.classList.contains('ms-editing')
    const want = PAGE_W + (editing ? GUTTER_W : 0) + 48
    const avail = state.desk.clientWidth || want
    state.scale = Math.min(1, avail / want)
    state.column.style.zoom = String(state.scale)
    if (editing) state.pages.forEach(page => layoutGutter(state, page))
  }

  // ── Editor mode: comments ───────────────────────────────────────────────

  function blockParts(state, scene, b) {
    return [...state.column.querySelectorAll(`[data-b="${b}"]`)].filter(el => el.dataset.scene === scene)
  }

  function fullBlockText(parts) { return parts.map(blockText).join('') }

  function sceneBlockCount(state, scene) {
    let max = -1
    state.column.querySelectorAll('[data-b]').forEach(el => {
      if (el.dataset.scene === scene) max = Math.max(max, Number(el.dataset.b))
    })
    return max + 1
  }

  // Same search order as resolve() in comments.js: the stored anchor, then nearby blocks,
  // then anywhere in the scene.
  function resolveAnchor(state, scene, comment) {
    const text = String(comment.text || '')
    if (!text) return null
    const a = comment.anchor
    const at = b => {
      const parts = blockParts(state, scene, b)
      if (!parts.length) return null
      const start = fullBlockText(parts).indexOf(text)
      return start >= 0 ? { blockIndex: b, start, end: start + text.length } : null
    }
    if (a && Number.isInteger(a.blockIndex)) {
      const parts = blockParts(state, scene, a.blockIndex)
      if (parts.length && fullBlockText(parts).slice(a.start, a.end) === text) {
        return { blockIndex: a.blockIndex, start: a.start, end: a.end }
      }
      for (let d = 0; d <= 3; d++) {
        for (const b of d ? [a.blockIndex - d, a.blockIndex + d] : [a.blockIndex]) {
          const hit = at(b); if (hit) return hit
        }
      }
    }
    const count = sceneBlockCount(state, scene)
    const order = [...Array(count).keys()]
    if (a) order.sort((x, y) => Math.abs(x - a.blockIndex) - Math.abs(y - a.blockIndex))
    for (const b of order) { const hit = at(b); if (hit) return hit }
    return null
  }

  function paint(state, scene, comment) {
    const { blockIndex, start, end } = comment.anchor
    for (const part of blockParts(state, scene, blockIndex)) {
      const off = Number(part.dataset.off || 0)
      const len = blockText(part).length
      const from = Math.max(start - off, 0), to = Math.min(end - off, len)
      if (to <= from) continue
      // Wrap each text node the range touches, so marks never straddle <em>/<strong>.
      const walker = document.createTreeWalker(part, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT)
      const hits = []
      let seen = 0
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        if (n.nodeName === 'BR') { seen += 1; continue }
        if (n.nodeType !== Node.TEXT_NODE) continue
        const s = Math.max(from - seen, 0), e = Math.min(to - seen, n.data.length)
        if (e > s) hits.push({ n, s, e })
        seen += n.data.length
      }
      for (const { n, s, e } of hits) {
        const r = document.createRange()
        r.setStart(n, s); r.setEnd(n, e)
        const mark = document.createElement('mark')
        mark.className = 'ms-mark'
        mark.dataset.cid = comment.id
        mark.dataset.type = TYPES[comment.type] ? comment.type : 'note'
        r.surroundContents(mark)
      }
    }
  }

  function unpaint(state, cid) {
    state.column.querySelectorAll(`.ms-ink path[data-cid="${cid}"]`).forEach(path => path.remove())
    state.column.querySelectorAll(`mark.ms-mark[data-cid="${cid}"]`).forEach(mark => {
      const parent = mark.parentNode
      mark.replaceWith(...mark.childNodes)
      parent.normalize()
    })
  }

  async function loadComments(state) {
    if (state.commentsLoaded) return
    state.commentsLoaded = true
    const scenes = [...state.sceneTitles.keys()]
    const files = await Promise.all(scenes.map(path =>
      window.quill.getComments(path).catch(() => ({ comments: [] }))))
    if (state.cancelled) return
    scenes.forEach((path, i) => {
      const list = Array.isArray(files[i]?.comments) ? files[i].comments : []
      state.comments.set(path, list)
      for (const c of list) {
        if (c.orphaned && !c.text) continue
        const hit = resolveAnchor(state, path, c)
        if (!hit) continue
        c.anchor = hit; c.orphaned = false
        paint(state, path, c)
        drawInk(state, c)
      }
    })
    renderAllCards(state)
  }

  function scheduleSave(state, scene) {
    clearTimeout(state.saveTimers.get(scene))
    state.saveTimers.set(scene, setTimeout(() => saveScene(state, scene), 500))
  }

  async function saveScene(state, scene) {
    clearTimeout(state.saveTimers.get(scene))
    state.saveTimers.delete(scene)
    const comments = state.comments.get(scene) || []
    try {
      await window.quill.saveComments({ rel: scene, v: 2, comments })
      window.dispatchEvent(new CustomEvent('quill:comments-written', { detail: { path: scene } }))
    } catch (e) {
      alert('Could not save the comment: ' + e.message)
    }
  }

  async function flush(container) {
    const state = _states.get(container)
    if (!state) return
    await Promise.all([...state.saveTimers.keys()].map(scene => saveScene(state, scene)))
  }

  // ── Editor mode: Pencil ink ─────────────────────────────────────────────
  // A Pencil stroke on a page (circle, underline, strike) marks the passage it covers. Saved on
  // the comment as `ink.d`, an SVG path relative to the top-left of the comment's first
  // highlight, so the mark follows the passage when the pages reflow.

  // Where `el` sits inside its page, in page pixels (layout offsets, unaffected by zoom).
  function pageOffset(el, page) {
    let x = 0, y = 0
    for (let n = el; n && n !== page; n = n.offsetParent) { x += n.offsetLeft; y += n.offsetTop }
    return { x, y }
  }

  function pagePoint(page, event) {
    const rect = page.getBoundingClientRect()
    const k = rect.width / page.offsetWidth || 1
    return [(event.clientX - rect.left) / k - page.clientLeft, (event.clientY - rect.top) / k - page.clientTop]
  }

  const pathData = (points, dx = 0, dy = 0) =>
    points.map(([x, y], i) => `${i ? 'L' : 'M'}${Math.round((x - dx) * 10) / 10} ${Math.round((y - dy) * 10) / 10}`).join('')

  function inkPath(d, type) {
    const path = document.createElementNS(SVG, 'path')
    path.setAttribute('d', d)
    if (type) path.dataset.type = type
    return path
  }

  function drawInk(state, c) {
    if (!c.ink?.d) return
    const mark = state.column.querySelector(`mark.ms-mark[data-cid="${c.id}"]`)
    const page = mark?.closest('.ms-page')
    if (!page) return
    const at = pageOffset(mark, page)
    const path = inkPath(c.ink.d, TYPES[c.type] ? c.type : 'note')
    path.dataset.cid = c.id
    path.setAttribute('transform', `translate(${at.x} ${at.y})`)
    page.querySelector('.ms-ink').appendChild(path)
  }

  function clearStroke(state) {
    state.stroke?.path.remove()
    state.stroke = null
  }

  // The text a stroke covers: characters whose centres fall inside its box. A flat stroke
  // (underline, strike-through) reaches up to the line it sits under.
  function strokeRange(page, box) {
    const k = page.getBoundingClientRect().width / page.offsetWidth || 1
    const line = LINE * k
    let { left, right, top, bottom } = box
    if (bottom - top < line) { top -= line * 0.6; bottom += line * 0.3 }
    const inside = r => {
      const x = r.left + r.width / 2, y = r.top + r.height / 2
      return x >= left && x <= right && y >= top && y <= bottom
    }
    let first = null, last = null
    const probe = document.createRange()
    for (const block of page.querySelectorAll('[data-b]')) {
      const br = block.getBoundingClientRect()
      if (br.bottom < top || br.top > bottom) continue
      const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT)
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        for (let i = 0; i < n.data.length; i++) {
          if (/\s/.test(n.data[i])) continue
          probe.setStart(n, i); probe.setEnd(n, i + 1)
          const r = probe.getClientRects()[0]
          if (!r || !inside(r)) continue
          if (!first) first = { n, i }
          last = { n, i }
        }
      }
    }
    if (!first) return null
    const range = document.createRange()
    range.setStart(first.n, first.i)
    range.setEnd(last.n, last.i + 1)
    return range
  }

  function startStroke(state, event) {
    const page = event.target.closest?.('.ms-page')
    if (!page || !state.root.classList.contains('ms-editing') || event.pointerType !== 'pen') return
    event.preventDefault()
    clearStroke(state)
    state.bar.style.display = 'none'
    window.getSelection()?.removeAllRanges()
    try { page.setPointerCapture(event.pointerId) } catch {}
    const path = inkPath('', '')
    path.classList.add('live')
    page.querySelector('.ms-ink').appendChild(path)
    state.stroke = { page, path, points: [pagePoint(page, event)], drawing: true,
      box: { left: event.clientX, right: event.clientX, top: event.clientY, bottom: event.clientY } }
  }

  function moveStroke(state, event) {
    const stroke = state.stroke
    if (!stroke?.drawing) return
    event.preventDefault()
    const coalesced = event.getCoalescedEvents?.()
    for (const e of coalesced?.length ? coalesced : [event]) {
      stroke.points.push(pagePoint(stroke.page, e))
      const b = stroke.box
      b.left = Math.min(b.left, e.clientX); b.right = Math.max(b.right, e.clientX)
      b.top = Math.min(b.top, e.clientY); b.bottom = Math.max(b.bottom, e.clientY)
    }
    stroke.path.setAttribute('d', pathData(stroke.points))
  }

  function endStroke(state) {
    const stroke = state.stroke
    if (!stroke?.drawing) return
    stroke.drawing = false
    const range = stroke.points.length > 2 && strokeRange(stroke.page, stroke.box)
    const target = range && rangeTarget(state, range)
    if (!target) { clearStroke(state); return }
    const { left, right, top, bottom } = stroke.box
    target.rect = { left, top, bottom, width: right - left }
    target.stroke = stroke
    showBar(state, target)
  }

  // ── Editor mode: margin cards ───────────────────────────────────────────

  function pageOf(el) { return el.closest('.ms-row')?.querySelector('.ms-page') }

  function renderAllCards(state) {
    state.column.querySelectorAll('.ms-gutter').forEach(g => { g.innerHTML = '' })
    for (const [scene, list] of state.comments) {
      for (const c of list) {
        const mark = state.column.querySelector(`mark.ms-mark[data-cid="${c.id}"]`)
        if (mark) addCard(state, scene, c, mark)
      }
    }
    state.pages.forEach(page => layoutGutter(state, page))
  }

  function addCard(state, scene, c, mark) {
    const row = mark.closest('.ms-row')
    const cfg = TYPES[c.type] || TYPES.note
    const card = document.createElement('div')
    card.className = 'ms-card'
    card.dataset.cid = c.id
    card.style.setProperty('--c', cfg.color)
    card.innerHTML = `
      <div class="ms-card-head">
        <span class="ms-card-type">${cfg.label}</span>
        <span class="ms-card-scene" title="${esc(state.sceneTitles.get(scene))}">${esc(state.sceneTitles.get(scene))}</span>
        <button class="ms-card-del" title="Remove comment">×</button>
      </div>
      <div class="ms-card-quote">“${esc(c.text.length > 90 ? c.text.slice(0, 90) + '…' : c.text)}”</div>
      <textarea class="ms-card-note" rows="1" placeholder="Add a note…">${esc(c.note || '')}</textarea>`
    const note = card.querySelector('.ms-card-note')
    const grow = () => { note.style.height = 'auto'; note.style.height = note.scrollHeight + 'px' }
    note.addEventListener('input', () => {
      c.note = note.value
      grow(); layoutGutter(state, row.querySelector('.ms-page'))
      scheduleSave(state, scene)
    })
    card.querySelector('.ms-card-del').onclick = () => {
      unpaint(state, c.id)
      state.comments.set(scene, state.comments.get(scene).filter(x => x.id !== c.id))
      card.remove()
      layoutGutter(state, row.querySelector('.ms-page'))
      saveScene(state, scene)
    }
    card.addEventListener('mouseenter', () => setActive(state, c.id, true))
    card.addEventListener('mouseleave', () => setActive(state, c.id, false))
    row.querySelector('.ms-gutter').appendChild(card)
    requestAnimationFrame(grow)
    return card
  }

  function setActive(state, cid, on) {
    state.column.querySelectorAll(`[data-cid="${cid}"]`).forEach(el => el.classList.toggle('active', on))
  }

  // Stack cards beside their highlights, pushing down any that would overlap.
  function layoutGutter(state, page) {
    const gutter = page.parentElement.querySelector('.ms-gutter')
    const cards = [...gutter.children]
    if (!cards.length) return
    const pageRect = page.getBoundingClientRect()
    const k = pageRect.height / PAGE_H || 1
    const wanted = cards.map(card => {
      const mark = page.querySelector(`mark.ms-mark[data-cid="${card.dataset.cid}"]`)
      return { card, top: mark ? (mark.getBoundingClientRect().top - pageRect.top) / k - 6 : 0 }
    }).sort((a, b) => a.top - b.top)
    let floor = 0
    for (const { card, top } of wanted) {
      const y = Math.max(top, floor)
      card.style.top = y + 'px'
      floor = y + card.offsetHeight + 8
    }
  }

  // ── Editor mode: selecting text ─────────────────────────────────────────

  function selectionTarget(state) {
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed || !sel.rangeCount) return null
    return rangeTarget(state, sel.getRangeAt(0))
  }

  function rangeTarget(state, range) {
    const block = node => (node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement)?.closest('[data-b]')
    const a = block(range.startContainer), b = block(range.endContainer)
    if (!a || !b || !state.column.contains(a)) return null
    if (a.dataset.scene !== b.dataset.scene || a.dataset.b !== b.dataset.b) return { error: 'Select within one paragraph.' }
    let start = Number(a.dataset.off || 0) + offsetWithin(a, range.startContainer, range.startOffset)
    let end = Number(b.dataset.off || 0) + offsetWithin(b, range.endContainer, range.endOffset)
    const scene = a.dataset.scene, blockIndex = Number(a.dataset.b)
    const full = fullBlockText(blockParts(state, scene, blockIndex))
    while (start < end && /\s/.test(full[start])) start++
    while (end > start && /\s/.test(full[end - 1])) end--
    if (end <= start) return null
    return { scene, anchor: { blockIndex, start, end }, text: full.slice(start, end), rect: range.getBoundingClientRect() }
  }

  function showBar(state, target) {
    const bar = state.bar
    if (!target) { bar.style.display = 'none'; return }
    bar.innerHTML = target.error
      ? `<span class="ms-selbar-hint">${esc(target.error)}</span>`
      : Object.entries(TYPES).map(([type, cfg]) =>
          `<button data-type="${type}" style="--c:${cfg.color}">${cfg.label}</button>`).join('')
    bar.style.display = 'flex'
    const r = target.rect
    const left = Math.max(8, Math.min(r.left + r.width / 2 - bar.offsetWidth / 2, window.innerWidth - bar.offsetWidth - 8))
    const top = r.top - bar.offsetHeight - 8 < 8 ? r.bottom + 8 : r.top - bar.offsetHeight - 8
    bar.style.left = left + 'px'
    bar.style.top = top + 'px'
    bar.querySelectorAll('button').forEach(btn => {
      btn.onmousedown = btn.onpointerdown = e => e.preventDefault()
      btn.onclick = () => addComment(state, target, btn.dataset.type)
    })
  }

  function addComment(state, target, type) {
    const c = {
      id: Math.random().toString(36).slice(2, 10), type, text: target.text,
      anchor: target.anchor, orphaned: false, note: '', date: new Date().toISOString().slice(0, 10),
    }
    const list = state.comments.get(target.scene) || []
    list.push(c)
    state.comments.set(target.scene, list)
    window.getSelection()?.removeAllRanges()
    state.bar.style.display = 'none'
    paint(state, target.scene, c)
    const mark = state.column.querySelector(`mark.ms-mark[data-cid="${c.id}"]`)
    const page = mark?.closest('.ms-page')
    if (target.stroke && page) {
      const at = pageOffset(mark, page)
      c.ink = { d: pathData(target.stroke.points, at.x, at.y) }
      drawInk(state, c)
    }
    clearStroke(state)
    const card = mark && addCard(state, target.scene, c, mark)
    if (mark) layoutGutter(state, pageOf(mark))
    saveScene(state, target.scene)
    card?.querySelector('.ms-card-note')?.focus()
  }

  // ── Mode ────────────────────────────────────────────────────────────────

  function getMode() {
    try { return localStorage.getItem(MODE_KEY) === 'edit' ? 'edit' : 'read' } catch { return 'read' }
  }

  async function setMode(state, mode) {
    try { localStorage.setItem(MODE_KEY, mode) } catch {}
    state.root.classList.toggle('ms-editing', mode === 'edit')
    state.toolbar.querySelectorAll('[data-mode]').forEach(b => b.classList.toggle('active', b.dataset.mode === mode))
    state.bar.style.display = 'none'
    clearStroke(state)
    applyScale(state)
    if (mode === 'edit') await loadComments(state)
  }

  // ── Export ──────────────────────────────────────────────────────────────

  // The pages as printed: no margin gutters, no cards, and comment highlights unwrapped.
  // A manuscript that goes out should not carry the writer's notes to self.
  function printablePages(state) {
    const clone = state.column.cloneNode(true)
    clone.querySelectorAll('.ms-gutter, .ms-card, .ms-ink').forEach(el => el.remove())
    clone.querySelectorAll('mark.ms-mark').forEach(mark => mark.replaceWith(...mark.childNodes))
    clone.removeAttribute('style')
    return clone.outerHTML
  }

  function initExport(state) {
    const wrap = state.toolbar.querySelector('.ms-export')
    const button = wrap.querySelector('.ms-export-btn')
    const close = () => wrap.classList.remove('open')
    button.onclick = e => { e.stopPropagation(); wrap.classList.toggle('open') }
    const onDown = e => { if (!wrap.contains(e.target)) close() }
    document.addEventListener('mousedown', onDown)
    const dispose = state.dispose
    state.dispose = () => { document.removeEventListener('mousedown', onDown); dispose() }
    wrap.querySelectorAll('[data-export]').forEach(item => {
      item.onclick = async () => {
        close()
        const label = button.textContent
        button.disabled = true
        button.textContent = 'Exporting…'
        try {
          const result = item.dataset.export === 'pdf' ? await exportPdf(state) : await exportDocx(state)
          if (result?.error) alert('Export failed: ' + result.error)
        } catch (error) {
          alert('Export failed: ' + error.message)
        } finally {
          button.disabled = false
          button.textContent = label
        }
      }
    })
  }

  function exportPdf(state) {
    // The PDF is these exact pages, so revision notes on screen would be printed.
    if (state.showNotes) return { error: 'Hide revision notes (💡 Notes) first — the PDF prints these exact pages.' }
    return window.quill.exportManuscriptPdf({
      title: state.title,
      mono: state.mono,
      pagesHTML: printablePages(state),
    })
  }

  function exportDocx(state) {
    const parts = ManuscriptDocx.build({
      sections: state.sections,
      meta: state.meta,
      scope: state.scope,
      startChapter: state.startChapter,
      label: openingLabel,
      words: roundedWords(state.words),
    })
    return window.quill.exportManuscriptDocx({ title: state.title, parts })
  }

  // ── Entry point ─────────────────────────────────────────────────────────

  /**
   * sections:     assembleNovel output (or the slice for one chapter)
   * meta:         the novel's folder meta (folder_title, pen_name, manuscript_font)
   * scope:        'novel' adds the title page and THE END; 'chapter' is just the pages
   * startChapter: the number of the first chapter in `sections`
   * currentFile:  a scene to scroll to once laid out
   * Returns the word count.
   */
  async function render(container, { sections, meta = {}, scope = 'novel', startChapter = 1, currentFile = null }) {
    // Also retire renders whose container is gone (the landing page re-renders its whole
    // pane), so their selection bar and document listeners don't linger.
    for (const [el, st] of _states) {
      if (el === container || !el.isConnected) { st.cancelled = true; st.dispose(); _states.delete(el) }
    }

    // A focused scene editor would keep reclaiming the selection Editor mode needs.
    if (document.activeElement?.closest?.('.ProseMirror')) document.activeElement.blur()
    container.innerHTML = ''
    container.classList.add('ms-root')
    const mono = meta.manuscript_font === 'mono'
      || (!meta.manuscript_font && sections.find(s => s.type === 'scene' && s.font)?.font === 'mono')
    container.classList.toggle('ms-mono', mono)

    const toolbar = document.createElement('div')
    toolbar.className = 'ms-toolbar'
    toolbar.innerHTML = `
      <div class="seg ms-seg">
        <button data-mode="read">Read</button>
        <button data-mode="edit">Editor</button>
      </div>
      <span class="ms-edit-hint">Select text, or circle it with Apple Pencil, to leave a note. The prose can’t be changed here.</span>
      ${sections.some(s => s.type === 'scene' && /quill:revise/.test(s.body || ''))
        ? `<button type="button" class="ms-notes-toggle${notesShown() ? ' active' : ''}" title="Show or hide 💡 revision notes. They are never exported.">💡 Notes</button>`
        : ''}
      <span class="ms-pages"></span>
      <div class="ms-export">
        <button class="btn sm ms-export-btn" type="button">Export manuscript</button>
        <div class="ms-export-menu">
          <button type="button" data-export="pdf"><b>PDF</b><span>These exact pages</span></button>
          <button type="button" data-export="docx"><b>Word (.docx)</b><span>Double spaced, for submission</span></button>
        </div>
      </div>`
    const desk = document.createElement('div')
    desk.className = 'ms-desk'
    const column = document.createElement('div')
    column.className = 'ms-column'
    desk.appendChild(column)
    container.append(toolbar, desk)

    const bar = document.createElement('div')
    bar.className = 'ms-selbar'
    document.body.appendChild(bar)

    const pen = String(meta.pen_name || '').trim()
    const title = String(meta.folder_title || 'Untitled').trim()
    const state = {
      root: container, toolbar, desk, column, bar, pages: [], text: null, pageNo: 0, scale: 1,
      pen, surname: pen.split(/\s+/).pop() || '',
      shortTitle: title.toUpperCase().split(/\s+/).slice(0, 4).join(' '),
      sceneTitles: new Map(), comments: new Map(), saveTimers: new Map(),
      commentsLoaded: false, cancelled: false,
      sections, meta, scope, startChapter, words: 0,
      mono, title,
      showNotes: notesShown(),
    }

    const onResize = () => applyScale(state)
    const onUp = () => setTimeout(() => {
      if (container.classList.contains('ms-editing') && !state.stroke) showBar(state, selectionTarget(state))
    }, 0)
    // A touch selection on iPad is adjusted with its handles, with no mouseup after.
    let selTimer = null
    const onSelection = () => {
      clearTimeout(selTimer)
      selTimer = setTimeout(() => {
        const sel = window.getSelection()
        if (state.stroke || !sel?.rangeCount || !column.contains(sel.anchorNode)) return
        onUp()
      }, 300)
    }
    const onDown = e => {
      if (bar.contains(e.target) || state.stroke?.drawing) return
      bar.style.display = 'none'
      clearStroke(state)
    }
    const onScroll = () => { if (state.stroke?.drawing) return; bar.style.display = 'none'; clearStroke(state) }
    // Pencil on a page draws instead of scrolling or selecting; fingers still do both.
    const onTouch = e => {
      if (container.classList.contains('ms-editing') && [...e.touches].some(t => t.touchType === 'stylus')
        && e.target.closest?.('.ms-page')) e.preventDefault()
    }
    const onPenDown = e => startStroke(state, e)
    const onPenMove = e => moveStroke(state, e)
    const onPenUp = () => endStroke(state)
    const onMarkClick = e => {
      const mark = e.target.closest('mark.ms-mark')
      if (!mark || !container.classList.contains('ms-editing') || !window.getSelection()?.isCollapsed) return
      const note = column.querySelector(`.ms-card[data-cid="${mark.dataset.cid}"] .ms-card-note`)
      note?.focus()
    }
    const ro = new ResizeObserver(onResize)
    ro.observe(desk)
    desk.addEventListener('pointerup', onUp)
    document.addEventListener('selectionchange', onSelection)
    document.addEventListener('pointerdown', onDown)
    column.addEventListener('pointerdown', onPenDown)
    column.addEventListener('pointermove', onPenMove)
    column.addEventListener('pointerup', onPenUp)
    column.addEventListener('pointercancel', () => clearStroke(state))
    column.addEventListener('touchstart', onTouch, { passive: false })
    column.addEventListener('touchmove', onTouch, { passive: false })
    // whichever ancestor scrolls (toolbar view or landing pane), the bar would drift
    document.addEventListener('scroll', onScroll, { capture: true, passive: true })
    column.addEventListener('click', onMarkClick)
    state.dispose = () => {
      ro.disconnect()
      clearTimeout(selTimer)
      document.removeEventListener('selectionchange', onSelection)
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('scroll', onScroll, { capture: true })
      bar.remove()
      for (const scene of state.saveTimers.keys()) saveScene(state, scene)
    }
    _states.set(container, state)

    toolbar.querySelectorAll('[data-mode]').forEach(btn => { btn.onclick = () => setMode(state, btn.dataset.mode) })
    const notesToggle = toolbar.querySelector('.ms-notes-toggle')
    if (notesToggle) notesToggle.onclick = async () => {
      try { localStorage.setItem('quill_read_draft_notes', notesShown() ? 'off' : 'on') } catch {}
      await flush(container)
      render(container, { sections, meta, scope, startChapter, currentFile })
    }
    initExport(state)

    // lay out at zoom 1 so measurements are in page pixels
    column.style.zoom = '1'
    const words = await paginate(state, sections, { scope, meta, startChapter })
    if (state.cancelled) return words
    state.words = words
    const pages = state.pageNo
    toolbar.querySelector('.ms-pages').textContent = `${pages} ${pages === 1 ? 'page' : 'pages'}`
    await setMode(state, getMode())

    if (currentFile) {
      const first = [...column.querySelectorAll('[data-scene]')].find(el => el.dataset.scene === currentFile)
      requestAnimationFrame(() => first?.scrollIntoView({ block: 'center' }))
    }
    return words
  }

  // Close out a container's render: saves pending notes, detaches listeners, drops the pages.
  async function close(container) {
    const state = _states.get(container)
    if (!state) return
    await flush(container)
    state.cancelled = true; state.dispose(); _states.delete(container)
    container.innerHTML = ''   // a whole novel's pages is a lot of DOM to keep off-screen
  }

  return { render, close, flush, plainWords }
})()
