/* freewrite.js — the writer's free writing for a novel, as topic cards. Each card is a topic and
 * the thinking under it. Two views share one store: the Free write page (index cards; one opens
 * as a writing sheet) and a panel beside the Structure outline, so the thinking can be reread
 * while beats are filled in. Stored in <novel>/.freewrite.json; nothing else reads it.
 * A "Need a starting point?" card offers questions from the writer's own structure first. */

const FreeWrite = (() => {
  const COLORS = ['yellow', 'peach', 'coral', 'pink', 'lavender', 'blue', 'aqua', 'mint', 'green', 'sand']
  const GENERAL_PROMPTS = [
    'What scene are you most excited to write, and why that one?',
    'What are you avoiding in this book?',
    'Which character do you understand least right now?',
    'What would make the ending hurt more?',
    'What does your protagonist want that they would never say out loud?',
    'Where does the middle go slack, and what would wake it up?',
    'What’s the image you keep coming back to?',
    'What would the villain say this book is about?',
    'What’s one thing that must be true by the last page?',
    'What did you change your mind about this week?',
  ]

  let _novel = null
  let _cards = []
  let _timer = null
  let _dirty = false
  let _openId = null        // the card open as a sheet on the page
  let _panelOpen = null     // the card expanded in the Structure panel
  let _prompt = null        // { text, source }
  const _seenPrompts = new Set()
  const _views = new Set()  // { container, kind: 'page' | 'panel', opts }

  const esc = s => escapeHtml(s)
  const words = text => String(text || '').trim().split(/\s+/).filter(Boolean).length
  const now = () => new Date().toISOString()
  const byId = id => _cards.find(c => c.id === id)
  const colorOf = card => COLORS.includes(card.color) ? card.color : 'sand'
  const sorted = () => [..._cards].sort((a, b) => String(b.updated).localeCompare(String(a.updated)))

  function ago(iso) {
    const ms = Date.now() - Date.parse(iso)
    if (!Number.isFinite(ms)) return ''
    const min = Math.round(ms / 60000)
    if (min < 1) return 'just now'
    if (min < 60) return `${min}m ago`
    const hours = Math.round(min / 60)
    if (hours < 24) return `${hours}h ago`
    const days = Math.round(hours / 24)
    if (days < 30) return `${days}d ago`
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  }
  const countLabel = n => n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k words` : `${n} word${n === 1 ? '' : 's'}`

  // ── Store ────────────────────────────────────────────────
  async function load(novelPath) {
    if (_novel === novelPath) return
    await flush()
    const result = await window.quill.getFreewrite(novelPath).catch(() => null)
    _novel = novelPath
    _cards = Array.isArray(result?.cards) ? result.cards : []
    _openId = null
    _panelOpen = null
    _prompt = null
    _seenPrompts.clear()
  }

  function changed(card) {
    if (card) card.updated = now()
    _dirty = true
    clearTimeout(_timer)
    _timer = setTimeout(flush, 600)
  }

  async function flush() {
    clearTimeout(_timer)
    _timer = null
    if (!_dirty || !_novel) return
    _dirty = false
    const novel = _novel
    const result = await window.quill.saveFreewrite({ novelRel: novel, cards: _cards }).catch(error => ({ ok: false, error: error.message }))
    if (!result?.ok && _novel === novel) {
      _dirty = true
      document.querySelectorAll('[data-fw-status]').forEach(el => { el.textContent = 'Couldn’t save. Trying again…' })
      if (!_timer) _timer = setTimeout(flush, 3000)
    }
  }

  function newCard(title = '') {
    const used = new Set(_cards.slice(0, 3).map(colorOf))
    const color = COLORS.find(c => !used.has(c)) || 'sand'
    const card = { id: `fw-${crypto.randomUUID()}`, title, text: '', color, created: now(), updated: now() }
    _cards.unshift(card)
    changed()
    return card
  }

  function remove(id) {
    _cards = _cards.filter(c => c.id !== id)
    if (_openId === id) _openId = null
    if (_panelOpen === id) _panelOpen = null
    changed()
  }

  // Cards from elsewhere (the old Structure brain dump), saved straight away.
  async function importCards(novelPath, list) {
    await load(novelPath)
    const stamp = now()
    _cards = [...list.map(({ title = '', text = '' }, i) => ({ id: `fw-${crypto.randomUUID()}`, title, text,
      color: COLORS[(i + 1) % COLORS.length], created: stamp, updated: stamp })), ..._cards]
    _dirty = true
    await flush()
    renderAll()
    return !_dirty
  }

  // ── Views ────────────────────────────────────────────────
  async function showPage(novelPath, container, opts = {}) {
    await load(novelPath)
    addView(container, 'page', opts)
  }

  async function showPanel(novelPath, container, opts = {}) {
    await load(novelPath)
    addView(container, 'panel', opts)
  }

  function addView(container, kind, opts) {
    for (const view of _views) if (view.container === container || !view.container.isConnected) _views.delete(view)
    const view = { container, kind, opts }
    _views.add(view)
    render(view)
  }

  // Re-renders every view but the one being typed in.
  function renderAll(except) {
    for (const view of _views) {
      if (!view.container.isConnected) { _views.delete(view); continue }
      if (view === except || view.container.contains(document.activeElement)) continue
      render(view)
    }
  }

  function render(view) {
    if (view.kind === 'page') renderPage(view)
    else renderPanel(view)
  }

  function fit(el) {
    if (!el.offsetParent) return
    el.style.height = 'auto'
    el.style.height = el.scrollHeight + 'px'
  }

  // ── The page ─────────────────────────────────────────────
  function nextPrompt(view) {
    const own = (view.opts.prompts?.() || []).filter(p => p?.text)
    const taken = new Set(_cards.map(c => c.title.trim()))
    const pool = [...own, ...GENERAL_PROMPTS.map(text => ({ text, source: '' }))].filter(p => !taken.has(p.text))
    if (!pool.length) return null
    let fresh = pool.filter(p => !_seenPrompts.has(p.text))
    if (!fresh.length) { _seenPrompts.clear(); fresh = pool }
    // The book's own questions come first while there are any left.
    const mine = fresh.filter(p => p.source)
    const from = mine.length ? mine : fresh
    const pick = from[Math.floor(Math.random() * from.length)]
    _seenPrompts.add(pick.text)
    return pick
  }

  function renderPage(view) {
    const el = view.container
    const open = _openId && byId(_openId)
    if (open) return renderSheet(view, open)
    if (!_prompt) _prompt = nextPrompt(view)
    const cards = sorted()
    el.innerHTML = `<div class="fw-page">
      <div class="fw-bar">
        <span class="fw-intro">Write to find out what you think. None of this goes in the book.</span>
        <span class="fw-status" data-fw-status></span>
        <button type="button" class="btn primary sm" data-fw-new>+ New topic</button>
      </div>
      ${_prompt ? `<div class="fw-prompt">
        <span class="fw-prompt-kicker">Need a starting point?</span>
        <p class="fw-prompt-q">${esc(_prompt.text)}</p>
        ${_prompt.source ? `<span class="fw-prompt-src">From your structure · ${esc(_prompt.source)}</span>` : ''}
        <span class="fw-prompt-actions">
          <button type="button" class="btn sm" data-fw-prompt-use>Write about this</button>
          <button type="button" class="fw-link" data-fw-prompt-next>Another →</button>
        </span>
      </div>` : ''}
      ${cards.length ? `<div class="fw-grid">${cards.map(card => {
        const n = words(card.text)
        return `<button type="button" class="fw-card scrap-${colorOf(card)}" data-fw-open="${esc(card.id)}">
          <span class="fw-card-title${card.title.trim() ? '' : ' untitled'}">${esc(card.title.trim() || 'Untitled')}</span>
          <span class="fw-card-preview${card.text.trim() ? '' : ' empty'}">${esc(card.text.trim() || 'Nothing written yet.')}</span>
          <span class="fw-card-meta">${countLabel(n)} · ${esc(ago(card.updated))}</span>
        </button>`
      }).join('')}</div>`
        : '<p class="fw-empty">Your topics live here, one card each. Start one, or take the question above.</p>'}
    </div>`
    el.querySelector('[data-fw-new]').onclick = () => openCard(newCard().id, { focus: 'title' })
    el.querySelector('[data-fw-prompt-use]')?.addEventListener('click', () => {
      const card = newCard(_prompt.text)
      _prompt = null
      openCard(card.id, { focus: 'text' })
    })
    el.querySelector('[data-fw-prompt-next]')?.addEventListener('click', () => { _prompt = nextPrompt(view); renderPage(view) })
    el.querySelectorAll('[data-fw-open]').forEach(btn => { btn.onclick = () => openCard(btn.dataset.fwOpen, { focus: 'text' }) })
  }

  function renderSheet(view, card) {
    const el = view.container
    el.innerHTML = `<div class="fw-sheet scrap-${colorOf(card)}">
      <div class="fw-sheet-bar">
        <button type="button" class="fw-link" data-fw-back>← All topics</button>
        <span class="fw-swatches" role="group" aria-label="Card colour">${COLORS.map(c =>
          `<button type="button" class="scrap-swatch scrap-${c}${c === colorOf(card) ? ' active' : ''}" data-fw-color="${c}" aria-label="${c}" title="${c}"></button>`).join('')}</span>
        <button type="button" class="fw-link fw-delete" data-fw-delete>Delete</button>
      </div>
      <input class="fw-sheet-title" data-fw-title aria-label="Topic" placeholder="What are you figuring out?" value="${esc(card.title)}">
      <textarea class="fw-sheet-text" data-fw-text aria-label="Free writing" placeholder="Just write. Don’t fix anything, don’t go back.">${esc(card.text)}</textarea>
      <div class="fw-sheet-foot"><span data-fw-words>${countLabel(words(card.text))}</span><span class="fw-status" data-fw-status></span></div>
    </div>`
    const title = el.querySelector('[data-fw-title]')
    const text = el.querySelector('[data-fw-text]')
    const count = el.querySelector('[data-fw-words]')
    title.addEventListener('input', () => { card.title = title.value; changed(card); renderAll(view) })
    title.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); text.focus() } })
    text.addEventListener('input', () => {
      fit(text)
      card.text = text.value
      count.textContent = countLabel(words(card.text))
      changed(card)
      renderAll(view)
    })
    el.querySelector('[data-fw-back]').onclick = () => closeCard()
    el.querySelectorAll('[data-fw-color]').forEach(btn => {
      btn.onclick = () => {
        const sheet = el.querySelector('.fw-sheet')
        sheet.classList.remove(`scrap-${colorOf(card)}`)
        card.color = btn.dataset.fwColor
        sheet.classList.add(`scrap-${card.color}`)
        el.querySelectorAll('[data-fw-color]').forEach(b => b.classList.toggle('active', b === btn))
        changed(card)
        renderAll(view)
      }
    })
    el.querySelector('[data-fw-delete]').onclick = () => {
      if (words(card.text) > 20 && !confirm(`Delete “${card.title.trim() || 'Untitled'}” and everything written under it?`)) return
      remove(card.id)
      renderPage(view)
      renderAll(view)
    }
    setTimeout(() => fit(text), 0)
  }

  // Opens a card as a sheet in the page views.
  function openCard(id, { focus } = {}) {
    if (!byId(id)) return
    _openId = id
    for (const view of _views) {
      if (view.kind !== 'page' || !view.container.isConnected) continue
      renderPage(view)
      const target = view.container.querySelector(focus === 'title' ? '[data-fw-title]' : '[data-fw-text]')
      if (target && view.container.offsetParent) {
        target.focus()
        if (target.setSelectionRange) target.setSelectionRange(target.value.length, target.value.length)
      }
    }
    renderAll()
  }

  function closeCard() {
    const card = _openId && byId(_openId)
    // A card left with nothing in it goes away rather than cluttering the grid.
    if (card && !card.title.trim() && !card.text.trim()) remove(card.id)
    _openId = null
    renderAll()
    for (const view of _views) if (view.kind === 'page' && view.container.isConnected) renderPage(view)
  }

  // ── The Structure panel ──────────────────────────────────
  // A grid of small square cards, topic only, so many fit beside the outline. The selected one
  // opens under the grid for reading and writing.
  function renderPanel(view) {
    const el = view.container
    const cards = sorted()
    const count = view.opts.countEl
    if (count) count.textContent = cards.length ? `${cards.length} topic${cards.length === 1 ? '' : 's'}` : ''
    const open = _panelOpen && byId(_panelOpen)
    el.innerHTML = `<div class="fw-panel">
      <div class="fw-panel-bar">
        <button type="button" class="btn sm" data-fw-new>+ New topic</button>
        <button type="button" class="fw-link" data-fw-page>Open Free write →</button>
      </div>
      <span class="fw-status" data-fw-status></span>
      ${cards.length ? `<div class="fw-squares">${cards.map(card => `<button type="button"
          class="fw-square scrap-${colorOf(card)}${card === open ? ' selected' : ''}" data-fw-square="${esc(card.id)}"
          aria-pressed="${card === open}" title="${esc(card.title.trim() || 'Untitled')}">
          <span class="fw-square-title${card.title.trim() ? '' : ' untitled'}">${esc(card.title.trim() || 'Untitled')}</span>
          <span class="fw-square-meta">${countLabel(words(card.text))}</span>
        </button>`).join('')}</div>`
        : '<p class="fw-empty">Free-write here to work out what you think, then put it into the beats.</p>'}
      ${open ? `<div class="fw-open scrap-${colorOf(open)}">
        <div class="fw-open-head">
          <input class="fw-open-title" data-fw-title aria-label="Topic" placeholder="What are you figuring out?" value="${esc(open.title)}">
          <button type="button" class="fw-open-close" data-fw-close aria-label="Close" title="Close">×</button>
        </div>
        <textarea class="fw-open-text" data-fw-text aria-label="Free writing" placeholder="Just write.">${esc(open.text)}</textarea>
      </div>` : ''}
    </div>`
    const select = id => {
      const current = _panelOpen && byId(_panelOpen)
      if (current && !current.title.trim() && !current.text.trim()) remove(current.id)
      _panelOpen = id
      renderPanel(view)
      renderAll(view)
    }
    el.querySelector('[data-fw-new]').onclick = () => {
      select(newCard().id)
      el.querySelector('[data-fw-title]')?.focus()
    }
    el.querySelector('[data-fw-page]').onclick = () => view.opts.onOpenPage?.()
    el.querySelectorAll('[data-fw-square]').forEach(btn => {
      btn.onclick = () => {
        select(_panelOpen === btn.dataset.fwSquare ? null : btn.dataset.fwSquare)
        el.querySelector('[data-fw-text]')?.focus()
      }
    })
    if (!open) return
    el.querySelector('[data-fw-close]').onclick = () => select(null)
    const title = el.querySelector('[data-fw-title]')
    const text = el.querySelector('[data-fw-text]')
    const square = el.querySelector('.fw-square.selected')
    title.addEventListener('input', () => {
      open.title = title.value
      const label = square.querySelector('.fw-square-title')
      label.textContent = open.title.trim() || 'Untitled'
      label.classList.toggle('untitled', !open.title.trim())
      changed(open)
      renderAll(view)
    })
    title.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); text.focus() } })
    text.addEventListener('input', () => {
      fit(text)
      open.text = text.value
      square.querySelector('.fw-square-meta').textContent = countLabel(words(open.text))
      changed(open)
      renderAll(view)
    })
    setTimeout(() => fit(text), 0)
  }

  // Sizes the writing areas once a hidden view is shown.
  function refit(container) { container?.querySelectorAll('.fw-sheet-text, .fw-open-text').forEach(fit) }

  return { showPage, showPanel, openCard, importCards, flush, flushPending: flush, refit }
})()
