/* toolbar.js — tooltips, per-view visibility and the ⋯ More menu for the top toolbar.
 *
 * SHORTCUTS is the one list of keyboard shortcuts. Tooltips are built from it (data-tip plus
 * data-shortcut), and so is the ⌘/ shortcut sheet, so a hint can't name a key nothing binds.
 *
 * Visibility is an allowlist: data-views names the #toolbar[data-view] values a control shows
 * in, data-kinds the project kinds (novel, journal, other). No attribute means "everywhere".
 */
window.QuillShortcuts = (() => {
  const SHORTCUTS = {
    newFile:      { keys: '⌘N',  label: 'New scene or entry' },
    save:         { keys: '⌘S',  label: 'Save now' },
    sidebar:      { keys: '⌘\\', label: 'Show or hide the sidebar' },
    settings:     { keys: '⌘,',  label: 'Settings' },
    shortcuts:    { keys: '⌘/',  label: 'Keyboard shortcuts' },
    find:         { keys: '⌘F',  label: 'Find and replace in this scene' },
    searchAll:    { keys: '⌘⇧F', label: 'Search all your writing' },
    bold:         { keys: '⌘B',  label: 'Bold' },
    italic:       { keys: '⌘I',  label: 'Italic' },
    underline:    { keys: '⌘U',  label: 'Underline' },
    strike:       { keys: '⌘⇧S', label: 'Strikethrough' },
    quote:        { keys: '⌘⇧B', label: 'Block quote' },
    bullets:      { keys: '⌘⇧8', label: 'Bulleted list' },
    numbers:      { keys: '⌘⇧7', label: 'Numbered list' },
    sceneBreak:   { keys: '⌘⇧↵', label: 'Scene break (* * *)' },
    revisionNote: { keys: '⌘⇧R', label: 'Revision note' },
    stub:         { keys: '⌘[',  label: 'Stub — a [placeholder] left out of word counts' },
    synonyms:     { keys: '⌘⇧T', label: 'Synonyms for the word at the cursor' },
    beats:        { keys: '⌘O',  label: 'Scene beats' },
    inspector:    { keys: '⌘⇧I', label: 'Scene inspector' },
    reference:    { keys: '⌘R',  label: 'Reference panel' },
    focus:        { keys: '⌘.',  label: 'Focus mode (Esc to leave)' },
    zoomIn:       { keys: '⌘=',  label: 'Zoom in' },
    zoomOut:      { keys: '⌘−',  label: 'Zoom out' },
    zoomReset:    { keys: '⌘0',  label: 'Actual size' },
  }

  function tooltip(tip, shortcut) {
    const keys = SHORTCUTS[shortcut]?.keys
    return keys ? `${tip} (${keys})` : tip
  }

  // The visible name is the part before " — ", so a screen reader hears "Bold", not the hint.
  function label(el) {
    const tip = el.dataset.tip
    if (!tip) return
    el.title = tooltip(tip, el.dataset.shortcut)
    el.setAttribute('aria-label', tip.split(' — ')[0])
    // Menu rows show their shortcut at the right edge.
    if (el.getAttribute('role') === 'menuitem' && SHORTCUTS[el.dataset.shortcut]) el.dataset.keys = SHORTCUTS[el.dataset.shortcut].keys
  }

  function labelAll(root = document) { root.querySelectorAll('[data-tip]').forEach(label) }

  return { SHORTCUTS, tooltip, label, labelAll }
})()

window.Toolbar = (() => {
  let _menuOpen = false

  function kindOf(folderType) {
    if (folderType === 'journal') return 'journal'
    if (['novel', 'act', 'worldbible'].includes(folderType)) return 'novel'
    return 'other'
  }

  function setKind(folderType) {
    const tb = document.getElementById('toolbar')
    if (tb) tb.dataset.kind = kindOf(folderType)
  }

  function update() {
    const tb = document.getElementById('toolbar')
    if (!tb) return
    const view = tb.dataset.view || 'empty'
    const kind = tb.dataset.kind || 'other'
    document.querySelectorAll('#toolbar [data-views], #toolbar [data-kinds], #more-menu [data-views], #more-menu [data-kinds]').forEach(el => {
      const views = el.dataset.views?.split(' ')
      const kinds = el.dataset.kinds?.split(' ')
      el.hidden = Boolean((views && !views.includes(view)) || (kinds && !kinds.includes(kind)))
    })
    if (_menuOpen && document.getElementById('more-btn')?.hidden) closeMenu()
  }

  function openMenu() {
    const btn = document.getElementById('more-btn')
    const menu = document.getElementById('more-menu')
    if (!btn || !menu) return
    menu.hidden = false
    const r = btn.getBoundingClientRect()
    const width = menu.offsetWidth
    menu.style.top = (r.bottom + 4) + 'px'
    menu.style.left = Math.max(8, Math.min(r.left, innerWidth - width - 8)) + 'px'
    btn.setAttribute('aria-expanded', 'true')
    btn.classList.add('active')
    _menuOpen = true
    menu.querySelector('button:not([hidden])')?.focus({ preventScroll: true })
  }

  function closeMenu({ refocus = false } = {}) {
    const btn = document.getElementById('more-btn')
    const menu = document.getElementById('more-menu')
    if (menu) menu.hidden = true
    btn?.setAttribute('aria-expanded', 'false')
    btn?.classList.remove('active')
    _menuOpen = false
    if (refocus) btn?.focus()
  }

  function init() {
    QuillShortcuts.labelAll()
    const tb = document.getElementById('toolbar')
    if (!tb) return
    new MutationObserver(update).observe(tb, { attributes: true, attributeFilter: ['data-view', 'data-kind'] })
    update()

    const btn = document.getElementById('more-btn')
    const menu = document.getElementById('more-menu')
    btn.addEventListener('click', () => (_menuOpen ? closeMenu() : openMenu()))
    // Items run their own handlers (data-fmt, ids wired elsewhere); the menu only closes after.
    menu.addEventListener('click', e => { if (e.target.closest('button')) setTimeout(closeMenu, 0) })
    menu.addEventListener('keydown', e => {
      const items = [...menu.querySelectorAll('button:not([hidden])')]
      const i = items.indexOf(document.activeElement)
      if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length]?.focus() }
      if (e.key === 'ArrowUp')   { e.preventDefault(); items[(i - 1 + items.length) % items.length]?.focus() }
      if (e.key === 'Escape')    { e.preventDefault(); e.stopPropagation(); closeMenu({ refocus: true }) }
    })
    document.addEventListener('mousedown', e => {
      if (_menuOpen && !menu.contains(e.target) && !btn.contains(e.target)) closeMenu()
    })
    window.addEventListener('resize', () => { if (_menuOpen) closeMenu() })

    document.getElementById('more-synonyms').addEventListener('click', () => ThesaurusPopover.open())
    document.getElementById('more-search').addEventListener('click', () => document.getElementById('global-search-btn').click())
    document.getElementById('more-shortcuts').addEventListener('click', () => QuillHelp.open('shortcuts'))
    document.getElementById('more-guide').addEventListener('click', () => QuillHelp.open('guide'))
  }

  return { init, update, setKind, closeMenu }
})()
