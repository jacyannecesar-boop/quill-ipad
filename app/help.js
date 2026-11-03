/* help.js — the Help menu's two sheets: Keyboard Shortcuts (⌘/) and What's What in Quill.
 * Shortcut keys come from QuillShortcuts (toolbar.js), the same list the tooltips use. */
window.QuillHelp = (() => {
  const GROUPS = [
    ['Writing',   ['bold', 'italic', 'underline', 'strike', 'quote', 'bullets', 'numbers', 'sceneBreak', 'revisionNote', 'stub', 'synonyms']],
    ['Finding',   ['find', 'searchAll']],
    ['Panels',    ['sidebar', 'inspector', 'beats', 'reference', 'focus']],
    ['App',       ['newFile', 'save', 'settings', 'zoomIn', 'zoomOut', 'zoomReset', 'shortcuts']],
  ]

  // One line per tool: what it's for, so a writer can tell similar-sounding things apart.
  const GUIDE = [
    ['Writing', [
      ['Scenes and chapters', 'Scenes are the files you write in. Chapters and acts are folders that hold them, in the sidebar under Manuscript.'],
      ['Edit whole chapter', 'Opens every scene in a chapter as one long page. Find it on the chapter page.'],
      ['Scene break', 'The * * * button marks a break inside a scene.'],
      ['Stubs', 'Type [anything in brackets] (or ⌘[) to leave a placeholder. Stubs are listed in the Inspector and left out of word counts.'],
      ['Focus mode', 'Hides everything except the page. Press Esc to come back.'],
    ]],
    ['Notes and revision', [
      ['Comments', 'Select text and pick Revisit, Rewrite, Research, Cut or Note. Comments stay attached to those exact words.'],
      ['Revision notes 💡', 'A reminder parked in the page (⌘⇧R) that can apply to several scenes. Never exported or counted.'],
      ['Scene notes', 'Free notes about one scene, in the Inspector.'],
      ['Synopsis', 'One paragraph on what happens in a scene. The same text shows on the Board and in the Outliner.'],
      ['Scraps', 'Loose lines and ideas for this novel. Drag one into a scene, or press Insert.'],
      ['Ideas', 'Ideas for books you haven’t started yet. Found in the sidebar when no project is open.'],
    ]],
    ['Planning', [
      ['Board', 'Scene cards for the whole novel, one column per chapter. Drag cards to reorder or move scenes.'],
      ['Outliner', 'The same scenes as a list, with synopsis and status.'],
      ['Scene beats', 'The step-by-step plan for one scene, shown beside the page (⌘O).'],
      ['Story beats', 'The novel-wide structure (Structure tab): which scenes serve which turning point.'],
      ['Timeline', 'Events on a story calendar (month, week, day), with Before, After and Undated trays.'],
      ['Reference panel', 'Characters and World Bible entries beside your page (⌘R).'],
      ['Collections', '⌘-click scenes in the sidebar, or save a search, to group scenes. Collections appear under the manuscript once you have one.'],
    ]],
    ['Keeping work safe', [
      ['Snapshots', 'The camera button saves this scene as it is now; restore an older version from the same place.'],
      ['Recovery', 'Backups of your whole library, in the sidebar footer.'],
      ['Read draft', 'Your chapter or novel as manuscript pages, ready to export to PDF or Word.'],
    ]],
  ]

  function sheet(id, title, body) {
    document.getElementById('help-overlay')?.remove()
    const overlay = document.createElement('div')
    overlay.id = 'help-overlay'
    overlay.className = 'overlay show'
    overlay.innerHTML = `
      <div class="modal help-modal" role="dialog" aria-modal="true" aria-labelledby="help-title" data-help="${id}">
        <div class="help-head">
          <h3 id="help-title">${escapeHtml(title)}</h3>
          <button class="tb-btn" id="help-close" data-tip="Close">✕</button>
        </div>
        <div class="help-body">${body}</div>
      </div>`
    document.body.appendChild(overlay)
    QuillShortcuts.labelAll(overlay)
    const previous = document.activeElement
    const close = () => { overlay.remove(); previous?.focus?.() }
    overlay.addEventListener('click', e => { if (e.target === overlay) close() })
    overlay.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); close() } })
    overlay.querySelector('#help-close').onclick = close
    overlay.querySelector('#help-close').focus()
  }

  function shortcuts() {
    const { SHORTCUTS } = QuillShortcuts
    const body = GROUPS.map(([name, keys]) => `
      <section class="help-group">
        <h4>${name}</h4>
        <dl>${keys.map(k => `<div><dt>${escapeHtml(SHORTCUTS[k].label)}</dt><dd><kbd>${escapeHtml(SHORTCUTS[k].keys)}</kbd></dd></div>`).join('')}</dl>
      </section>`).join('')
    sheet('shortcuts', 'Keyboard shortcuts', `<div class="help-columns">${body}</div>
      <p class="help-foot">Select text for more formatting, comments and Ask AI. Hover any toolbar button to see what it does.</p>`)
  }

  function guide() {
    const body = GUIDE.map(([name, rows]) => `
      <section class="help-group">
        <h4>${name}</h4>
        <dl class="help-guide">${rows.map(([term, text]) => `<div><dt>${escapeHtml(term)}</dt><dd>${escapeHtml(text)}</dd></div>`).join('')}</dl>
      </section>`).join('')
    sheet('guide', 'What’s what in Quill', body)
  }

  function open(which) { which === 'guide' ? guide() : shortcuts() }

  return { open }
})()
