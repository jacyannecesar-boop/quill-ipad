/* tree.js */

const Tree = (() => {
  let _folderParent  = ''
  let _renamePath    = null
  let _dragSrc       = null
  let _didDrag       = false
  let _folderDragSrc = null
  let _folderDragging= false
  let _treeData       = null
  let _focusedProject = null
  let _workspaceSection = 'manuscript'
  let _selectedFiles = new Set()
  let _selectionAnchorPath = null

  // ── Keyboard access ─────────────────────────────────────────
  // Rows are divs built in several places, so they are made focusable as they appear rather
  // than at each render site. Enter opens, ↑/↓ move, →/← open and close folders,
  // Shift+F10 or the context-menu key opens the row's menu.
  const ROW = '.folder-row, .file-row'
  // A scene kept twice by merging a backup from the other device (backup-merge.js copyName).
  const SYNC_COPY = /\((?:Mac|iPad) copy(?: \d+)?\)\.md$/

  function initKeyboardRows() {
    const sidebar = document.getElementById('sidebar')
    if (!sidebar) return
    const prepare = root => root.querySelectorAll?.(ROW).forEach(row => {
      if (row.tabIndex === 0) return
      row.tabIndex = 0
      row.setAttribute('role', 'treeitem')
      const name = row.querySelector('.folder-name, .file-title')?.textContent
      if (name) row.setAttribute('aria-label', name)
    })
    prepare(sidebar)
    new MutationObserver(() => prepare(sidebar)).observe(sidebar, { childList: true, subtree: true })

    sidebar.addEventListener('keydown', e => {
      const row = e.target.closest?.(ROW)
      if (!row || e.target !== row) return
      const rows = [...sidebar.querySelectorAll(ROW)].filter(r => r.getClientRects().length)
      const i = rows.indexOf(row)
      const caret = row.querySelector('.folder-caret')
      const isOpen = caret?.classList.contains('open')
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); row.click() }
      else if (e.key === 'ArrowDown') { e.preventDefault(); rows[i + 1]?.focus() }
      else if (e.key === 'ArrowUp')   { e.preventDefault(); rows[i - 1]?.focus() }
      else if (e.key === 'ArrowRight' && caret && !isOpen) { e.preventDefault(); caret.click() }
      else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        if (caret && isOpen) caret.click()
        else row.parentElement?.closest('.folder-children')?.closest('.tree-folder')?.querySelector(':scope > .folder-row')?.focus()
      } else if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
        e.preventDefault()
        const r = row.getBoundingClientRect()
        row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: r.left + 24, clientY: r.bottom }))
      }
    })
  }

  async function init() {
    initKeyboardRows()
    document.getElementById('new-folder-btn').onclick = () => showProjectModal()
    document.getElementById('new-file-btn').onclick   = () => App.newFile()
    document.getElementById('all-projects-btn')?.addEventListener('click', () => App.loadDashboard())
    document.getElementById('binder-clear-selection-btn')?.addEventListener('click', clearFileSelection)
    document.getElementById('binder-add-collection-btn')?.addEventListener('click', addSelectionToCollection)

    // folder modal (used for WB sections only now)
    const fc = document.getElementById('folder-create')
    const fcancel = document.getElementById('folder-cancel')
    if (fc) fc.onclick = createFolder
    if (fcancel) fcancel.onclick = closeFolderModal
    document.getElementById('folder-name-input').addEventListener('keydown', e => { if (e.key==='Enter') createFolder() })
    overlayClose('folder-modal', closeFolderModal)

    // new-project modal
    const npc = document.getElementById('new-project-create')
    const npcancel = document.getElementById('new-project-cancel')
    if (npc) npc.onclick = createProject
    if (npcancel) npcancel.onclick = closeProjectModal
    document.getElementById('new-project-name').addEventListener('keydown', e => { if (e.key==='Enter') createProject() })
    overlayClose('new-project-modal', closeProjectModal)
    document.querySelectorAll('.np-type-btn').forEach(btn => {
      btn.onclick = () => {
        document.querySelectorAll('.np-type-btn').forEach(b => b.classList.remove('active'))
        btn.classList.add('active')
      }
    })

    // import lives with New Project: it is another way to start one
    document.getElementById('np-import-btn')?.addEventListener('click', runImport)

    // sidebar Projects + button
    document.getElementById('project-new-btn-sidebar')?.addEventListener('click', showProjectModal)

    // idea new button in sidebar
    document.getElementById('idea-new-btn-sidebar')?.addEventListener('click', async () => {
      App.showView('ideas')
      Ideas.openNewIdea()
    })

    await renderIdeaSidebar()

    // rename modal
    document.getElementById('rename-confirm').onclick = doRename
    document.getElementById('rename-cancel').onclick  = closeRenameModal
    document.getElementById('rename-input').addEventListener('keydown', e => { if (e.key==='Enter') doRename() })
    overlayClose('rename-modal', closeRenameModal)

    // simple folder modal (scratch/general subfolders)
    document.getElementById('simple-folder-confirm')?.addEventListener('click', createSimpleFolder)
    document.getElementById('simple-folder-cancel')?.addEventListener('click', closeSimpleFolderModal)
    document.getElementById('simple-folder-input')?.addEventListener('keydown', e => { if (e.key==='Enter') createSimpleFolder() })
    overlayClose('simple-folder-modal', closeSimpleFolderModal)

    // name dialog
    const nameInput = document.getElementById('name-modal-input')
    document.getElementById('name-modal-confirm')?.addEventListener('click', () => finishName(nameInput.value.trim()))
    document.getElementById('name-modal-cancel')?.addEventListener('click', () => finishName(null))
    nameInput?.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); finishName(nameInput.value.trim()) }
    })
    document.getElementById('name-modal').addEventListener('keydown', e => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finishName(null); return }
      if (e.key !== 'Tab') return
      const fields = [...document.querySelectorAll('#name-modal input,#name-modal select,#name-modal button')]
        .filter(el => !el.disabled && el.getClientRects().length)
      const first = fields[0], last = fields[fields.length - 1]
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
    })
    overlayClose('name-modal', () => finishName(null))

    // scratch landing page subfolder button
    document.addEventListener('scratch-new-subfolder', e => {
      showSimpleFolderModal(e.detail.path, 'scratch')
    })
  }

  async function refresh() {
    // save which folder paths are currently open so we can restore after rebuild
    const openPaths = new Set()
    document.querySelectorAll('.folder-children.open').forEach(el => {
      const row = el.previousElementSibling
      if (row && row.dataset.path) openPaths.add(row.dataset.path)
    })
    // also merge in any persisted open paths from localStorage
    try {
      const saved = JSON.parse(localStorage.getItem('quill_tree_open') || '[]')
      saved.forEach(p => openPaths.add(p))
    } catch {}
    const tree = await window.quill.getTree()
    _treeData = tree

    if (_focusedProject) {
      const project = (tree.children || []).find(child => child.path === _focusedProject)
      if (project) {
        renderFocusedProject(project, openPaths)
        pruneSelectionToProject(project.path)
        updateSelectionBar()
        _saveTreeOpenState()
        return
      }
      _focusedProject = null
      document.getElementById('sidebar')?.classList.remove('project-focused')
      document.body.classList.remove('project-workspace')
    }
    clearFileSelection()

    // Pull Style Lab out of the main tree. Render a fixed Projects-style
    // structure in the Practice section: "Style Lab" collapsible parent with
    // Recent Reps / Saved Lines / Saved Passages children.
    const practiceWrap = document.getElementById('practice-list-sidebar')
    if (practiceWrap) {
      practiceWrap.innerHTML = ''
      renderPracticeSection(practiceWrap, openPaths)
    }
    // Filter stylelab out of the main tree before rendering
    const mainTree = Object.assign({}, tree, {
      children: (tree.children || []).filter(c => c.folder_type !== 'stylelab')
    })
    renderTree(mainTree, null, 0, 'novel', openPaths)
    // persist final open state after render
    _saveTreeOpenState()
    await renderIdeaSidebar()
  }

  async function focusForPath(itemPath) {
    if (!itemPath) return null
    if (!_treeData) _treeData = await window.quill.getTree()
    const rootPath = itemPath.split('/')[0]
    const project = (_treeData.children || []).find(child => child.path === rootPath)
    if (!project || project.folder_type === 'stylelab') {
      await exitProjectFocus()
      return null
    }

    const changed = _focusedProject !== project.path
    if (changed) clearFileSelection()
    _focusedProject = project.path
    document.getElementById('sidebar')?.classList.add('project-focused')
    document.body.classList.add('project-workspace')
    if (changed) await refresh()
    else updateWorkspaceHeader(project)
    return project
  }

  async function exitProjectFocus() {
    if (!_focusedProject) return
    _focusedProject = null
    _workspaceSection = 'manuscript'
    clearFileSelection()
    document.getElementById('sidebar')?.classList.remove('project-focused')
    document.body.classList.remove('project-workspace')
    await refresh()
  }

  function updateWorkspaceHeader(project) {
    const name = document.getElementById('workspace-project-name')
    const kind = document.getElementById('workspace-project-kind')
    const title = document.getElementById('workspace-project-title')
    if (name) name.textContent = project.name
    if (kind) kind.textContent = project.folder_type === 'novel' ? 'Novel' : project.folder_type
    if (title) title.onclick = () => {
      if (project.folder_type === 'novel') App.openNovelWorkspace(project.path, 'overview')
      else App.openFolder(project.path, project.folder_type || 'general')
    }
  }

  function workspaceSection(wrap, label) {
    const heading = document.createElement('div')
    heading.className = 'workspace-section-label'
    heading.textContent = label
    wrap.appendChild(heading)
  }

  function workspaceNavRow(wrap, project, section, label, icon, action) {
    const row = document.createElement('button')
    row.type = 'button'
    row.setAttribute('aria-current', _workspaceSection === section ? 'page' : 'false')
    row.className = 'workspace-nav-row' + (_workspaceSection === section ? ' active' : '')
    row.dataset.workspaceSection = section
    row.innerHTML = `<span class="workspace-nav-icon">${icon}</span><span>${esc(label)}</span>`
    row.onclick = async () => {
      const restoreFocus = document.activeElement === row
      clearFileSelection()
      setWorkspaceSection(section)
      await action()
      if (restoreFocus) document.querySelector(`[data-workspace-section="${section}"]`)?.focus()
    }
    wrap.appendChild(row)
  }

  function renderFocusedProject(project, openPaths) {
    const wrap = document.getElementById('tree-wrap')
    wrap.innerHTML = ''
    updateWorkspaceHeader(project)

    workspaceSection(wrap, project.folder_type === 'novel' ? 'Manuscript' : 'Contents')
    const actions = document.createElement('div')
    actions.className = 'workspace-create-actions'
    const add = document.createElement('button')
    add.type = 'button'
    add.className = 'btn sm'
    add.id = 'workspace-new-file'
    add.textContent = project.folder_type === 'journal' ? '+ New entry' : project.folder_type === 'novel' ? '+ Scene' : '+ New file'
    add.onclick = () => App.newFile({ project: project.path, folderType: project.folder_type })
    actions.appendChild(add)
    if (project.folder_type === 'novel') {
      const chapter = document.createElement('button')
      chapter.type = 'button'
      chapter.className = 'btn sm'
      chapter.textContent = '+ Chapter'
      chapter.onclick = async () => {
        const currentFile = App.getCurrentFile()
        const currentFolder = currentFile ? currentFile.slice(0, currentFile.lastIndexOf('/')) : App.getCurrentFolder()
        const parent = currentFolder === project.path || currentFolder.startsWith(project.path + '/') ? currentFolder : project.path
        const result = await createStructureFolder(parent, 'chapter')
        if (!result) return
        await refresh()
        await App.openFolder(result.path, 'novel')
      }
      actions.appendChild(chapter)
      const act = document.createElement('button')
      act.type = 'button'
      act.className = 'btn sm'
      act.textContent = '+ Act'
      act.onclick = async () => {
        const result = await createStructureFolder(project.path, 'act')
        if (!result) return
        await refresh()
        await App.openFolder(result.path, 'act')
      }
      actions.appendChild(act)
    }
    wrap.appendChild(actions)
    const manuscriptChildren = (project.children || []).filter(child =>
      child.folder_type !== 'worldbible' && child.name.toLowerCase() !== 'world bible')
    renderTree({ children: manuscriptChildren }, wrap, 0, project.folder_type || 'general', openPaths)
    ;(project.files || []).forEach(file => renderWorkspaceRootFile(file, project, wrap))
    if (!manuscriptChildren.length && !(project.files || []).length) {
      const empty = document.createElement('div')
      empty.className = 'idea-sidebar-empty'
      empty.textContent = project.folder_type === 'journal' ? 'No entries yet — use + New entry above.' : 'Nothing here yet — add a chapter, then scenes inside it.'
      wrap.appendChild(empty)
    }

    if (project.folder_type !== 'novel') return

    const worldBible = (project.children || []).find(child =>
      child.folder_type === 'worldbible' || child.name.toLowerCase() === 'world bible')

    workspaceSection(wrap, 'Planning')
    workspaceNavRow(wrap, project, 'overview', 'Overview', '⌂', () => App.openNovelWorkspace(project.path, 'overview'))
    workspaceNavRow(wrap, project, 'outliner', 'Outliner', '☷', () => App.openNovelWorkspace(project.path, 'outliner'))
    workspaceNavRow(wrap, project, 'timeline', 'Timeline', '↝', () => App.openNovelWorkspace(project.path, 'timeline'))
    workspaceNavRow(wrap, project, 'audit', 'Manuscript Audit', '✓', () => App.openNovelWorkspace(project.path, 'audit'))
    workspaceNavRow(wrap, project, 'outline', 'Structure', '◇', () => App.openNovelWorkspace(project.path, 'outline'))
    workspaceNavRow(wrap, project, 'case', 'Case', '⌕', () => App.openNovelWorkspace(project.path, 'case'))
    // Case is for mysteries: shown when Structure's Mystery box is ticked, or a case exists.
    const caseRow = wrap.lastElementChild
    caseRow.hidden = true
    Promise.all([
      window.quill.getStructure(project.path).catch(() => null),
      window.quill.getCases(project.path).catch(() => null),
    ]).then(([structure, cases]) => {
      caseRow.hidden = !(structure?.structure?.mystery === true || (cases?.cases || []).length > 0)
    })
    workspaceNavRow(wrap, project, 'characters', 'Characters', '♙', () => App.openNovelWorkspace(project.path, 'characters'))
    if (worldBible) {
      workspaceNavRow(wrap, project, 'worldbible', 'World Bible', '◎', () => App.openFolder(worldBible.path, 'worldbible'))
    }
    workspaceNavRow(wrap, project, 'novelboard', 'Board', '▦', () => App.openNovelWorkspace(project.path, 'novelboard'))
    workspaceNavRow(wrap, project, 'read', 'Read Draft', '◫', () => App.openNovelWorkspace(project.path, 'read'))

    // Collections only appear once there is one; ⌘-click scenes or save a search to make one.
    if ((project.collections || []).length + (project.saved_searches || []).length) {
      workspaceSection(wrap, 'Collections')
      renderSavedSearches(wrap, project)
    }

    workspaceSection(wrap, 'Studio')
    workspaceNavRow(wrap, project, 'freewrite', 'Scene Generator', '✎', () => App.openNovelWorkspace(project.path, 'freewrite'))
    workspaceNavRow(wrap, project, 'scraps', 'Scraps', '❏', () => App.openNovelWorkspace(project.path, 'scraps'))
    workspaceNavRow(wrap, project, 'brainstorm', 'Brainstorm', '✦', () => App.openNovelWorkspace(project.path, 'brainstorm'))
    workspaceNavRow(wrap, project, 'concept', 'Concept Art', '◉', () => App.openNovelWorkspace(project.path, 'concept'))
    workspaceNavRow(wrap, project, 'styleguide', 'Style Guide', 'Aa', () => App.openNovelWorkspace(project.path, 'styleguide'))
  }

  function renderSavedSearches(wrap, project) {
    const collections = Array.isArray(project.collections) ? project.collections : []
    const searches = Array.isArray(project.saved_searches) ? project.saved_searches : []
    if (!collections.length && !searches.length) {
      const hint = document.createElement('div')
      hint.className = 'workspace-collection-empty'
      hint.textContent = 'Select scenes or save a search'
      wrap.appendChild(hint)
      return
    }
    for (const collection of collections) {
      const sectionKey = `static-collection-${collection.id}`
      const row = document.createElement('div')
      row.className = 'workspace-nav-row workspace-saved-search'
        + (_workspaceSection === sectionKey ? ' active' : '')
      row.dataset.workspaceSection = sectionKey
      const sceneCount = Array.isArray(collection.scene_ids) ? collection.scene_ids.length : 0
      row.title = `${sceneCount} scene${sceneCount === 1 ? '' : 's'}`
      row.innerHTML = `
        <span class="workspace-nav-icon">◇</span>
        <span class="workspace-saved-search-name">${esc(collection.name || 'Collection')}</span>
        <button class="workspace-saved-search-delete" title="Delete collection">×</button>`
      row.onclick = async event => {
        if (event.target.closest('.workspace-saved-search-delete')) return
        clearFileSelection()
        setWorkspaceSection(sectionKey)
        await App.openCollection(project.path, collection.id, collection.name)
      }
      row.querySelector('.workspace-saved-search-delete').onclick = async event => {
        event.stopPropagation()
        const result = await window.quill.deleteProjectCollection({ projectPath: project.path, id: collection.id })
          .catch(() => ({ ok: false }))
        if (result.ok) await refresh()
      }
      wrap.appendChild(row)
    }
    for (const search of searches) {
      const sectionKey = `collection-${search.id}`
      const row = document.createElement('div')
      row.className = 'workspace-nav-row workspace-saved-search'
        + (_workspaceSection === sectionKey ? ' active' : '')
      row.dataset.workspaceSection = sectionKey
      row.title = `Search for “${search.query}”`
      row.innerHTML = `
        <span class="workspace-nav-icon">⌕</span>
        <span class="workspace-saved-search-name">${esc(search.name || search.query)}</span>
        <button class="workspace-saved-search-delete" title="Delete saved search">×</button>`
      row.onclick = async event => {
        if (event.target.closest('.workspace-saved-search-delete')) return
        clearFileSelection()
        setWorkspaceSection(sectionKey)
        await App.openSavedSearch(project.path, search.query, search.name)
      }
      row.querySelector('.workspace-saved-search-delete').onclick = async event => {
        event.stopPropagation()
        const result = await window.quill.deleteProjectSearch({ projectPath: project.path, id: search.id })
          .catch(() => ({ ok: false }))
        if (result.ok) await refresh()
      }
      wrap.appendChild(row)
    }
  }

  function renderWorkspaceRootFile(file, project, wrap) {
    const row = document.createElement('div')
    row.className = 'file-row workspace-root-file' + (file.path === App.getCurrentFile() ? ' active' : '')
    row.dataset.path = file.path
    row.dataset.folder = project.path
    const wc = file.word_count > 0 ? file.word_count.toLocaleString() + ' w' : ''
    row.draggable = true
    row.innerHTML = `<span class="file-drag" title="Drag onto a folder to move">⠿</span><span class="file-title">${esc(file.title || 'Untitled')}</span><span class="file-wc">${wc}</span>`
    row.addEventListener('mousedown', () => { _didDrag = false })
    // Dropped on a folder row, this moves through the same path as any other scene.
    row.addEventListener('dragstart', e => {
      if (_selectedFiles.size > 1) { e.preventDefault(); return }
      _dragSrc = { path: file.path, folder: project.path }
      _didDrag = true
      e.dataTransfer.effectAllowed = 'move'
      e.dataTransfer.setData('text/plain', file.path)
      setTimeout(() => row.classList.add('dragging'), 0)
    })
    row.addEventListener('dragend', () => {
      row.classList.remove('dragging')
      document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'))
      setTimeout(() => { _dragSrc = null; _didDrag = false }, 50)
    })
    row.onclick = event => {
      if (_didDrag) return
      if (handleFileSelection(event, row, file.path)) return
      App.setCurrentFolder(project.path, project.folder_type)
      App.openFile(file.path)
    }
    row.addEventListener('contextmenu', event => {
      event.preventDefault()
      showFileContextMenu(event.clientX, event.clientY, file, project.path)
    })
    wrap.appendChild(row)
  }

  function setWorkspaceSection(section) {
    _workspaceSection = section || 'manuscript'
    document.querySelectorAll('.workspace-nav-row').forEach(row => {
      row.classList.toggle('active', row.dataset.workspaceSection === _workspaceSection)
      row.setAttribute('aria-current', row.dataset.workspaceSection === _workspaceSection ? 'page' : 'false')
    })
  }

  function _saveTreeOpenState() {
    const paths = []
    document.querySelectorAll('.folder-children.open').forEach(el => {
      const row = el.previousElementSibling
      if (row && row.dataset.path) paths.push(row.dataset.path)
    })
    localStorage.setItem('quill_tree_open', JSON.stringify(paths))
  }

  function setActive(path) {
    document.querySelectorAll('.file-row').forEach(el =>
      el.classList.toggle('active', el.dataset.path === path))
  }

  // ── Practice section: renders "STYLE LAB" as a tree-type-header
  // (matching the NOVELS/JOURNALS subsection style under PROJECTS),
  // with three fixed children below: Recent Reps / Saved Lines / Saved Passages.
  function renderPracticeSection(wrap, openPaths) {
    const STYLELAB_KEY = 'Style Lab'
    const isOpen = openPaths.has(STYLELAB_KEY) || localStorage.getItem('quill_stylelab_expanded') !== '0'

    // Subsection header — matches .tree-type-header used by Novels/Journals
    const header = document.createElement('div')
    header.className = 'tree-type-header collapsible' + (isOpen ? '' : ' collapsed')
    header.dataset.path = STYLELAB_KEY

    const caret = document.createElement('span')
    caret.className = 'section-caret'
    caret.textContent = '▸'
    header.appendChild(caret)

    const label = document.createElement('span')
    label.className = 'tree-type-label'
    label.textContent = 'Style Lab'
    header.appendChild(label)

    const groupWrap = document.createElement('div')
    groupWrap.className = 'tree-group' + (isOpen ? '' : ' collapsed')

    // Header click toggles expand/collapse; click on label opens landing
    header.addEventListener('click', e => {
      if (e.target.closest('button')) return
      if (e.target.closest('.section-caret')) {
        const nowOpen = header.classList.contains('collapsed')
        header.classList.toggle('collapsed', !nowOpen)
        groupWrap.classList.toggle('collapsed', !nowOpen)
        localStorage.setItem('quill_stylelab_expanded', nowOpen ? '1' : '0')
        return
      }
      // clicking the label opens the Style Lab landing AND ensures expanded
      header.classList.remove('collapsed')
      groupWrap.classList.remove('collapsed')
      localStorage.setItem('quill_stylelab_expanded', '1')
      App.openFolder('Style Lab', 'stylelab')
    })

    // Children rows — match the look of project file children
    const currentPath = App.getCurrentFile()
    const currentView = document.getElementById('toolbar')?.dataset.view || ''

    const makeChild = (label, onClick, isActive) => {
      const childRow = document.createElement('div')
      childRow.className = 'file-row' + (isActive ? ' active' : '')
      childRow.style.paddingLeft = '20px'
      childRow.innerHTML = `
        <span class="file-drag" style="opacity:0;pointer-events:none">⠿</span>
        <span class="file-title">${esc(label)}</span>`
      childRow.onclick = onClick
      return childRow
    }

    groupWrap.appendChild(makeChild('Recent Reps', () => {
      App.openFolder('Style Lab/Recent reps', 'stylelab')
    }, false))

    groupWrap.appendChild(makeChild('Saved Lines', () => {
      App.openFile('Style Lab/Saved lines.md')
    }, currentPath === 'Style Lab/Saved lines.md'))

    groupWrap.appendChild(makeChild('Saved Passages', () => {
      if (typeof StyleLab !== 'undefined' && StyleLab.openSavedPassages) {
        StyleLab.openSavedPassages()
      }
    }, currentView === 'saved-passages'))

    wrap.appendChild(header)
    wrap.appendChild(groupWrap)
  }

  // ── render ────────────────────────────────────────────────

  function renderTree(node, container, depth, parentType, openPaths) {
    const wrap = container || document.getElementById('tree-wrap')
    if (!container) wrap.innerHTML = ''
    depth      = depth || 0
    parentType = parentType || 'novel'
    openPaths  = openPaths  || new Set()

    const children = node.children || []

    // At depth 0 (top-level projects), group by folder type with section headers
    if (depth === 0 && !container) {
      const GROUP_ORDER = ['novel', 'journal', 'scratch', 'worldbible', 'general']
      const GROUP_LABELS = { novel: 'Novels', journal: 'Journals', scratch: 'Scratch', worldbible: 'World Bibles', general: 'Projects' }
      const groups = {}
      children.forEach(child => {
        const t = child.folder_type || 'novel'
        if (!groups[t]) groups[t] = []
        groups[t].push(child)
      })
      const collapsedMap = JSON.parse(localStorage.getItem('quill_sections_collapsed') || '{}')
      const renderGroup = (type) => {
        if (!groups[type] || groups[type].length === 0) return
        const typeCount = Object.keys(groups).length
        const isCollapsed = !!collapsedMap[type]
        if (typeCount > 1) {
          const header = document.createElement('div')
          header.className = 'tree-type-header collapsible' + (isCollapsed ? ' collapsed' : '')
          header.dataset.groupType = type
          const caret = document.createElement('span')
          caret.className = 'section-caret'
          caret.textContent = '▸'
          header.appendChild(caret)
          const label = document.createElement('span')
          label.textContent = GROUP_LABELS[type] || type
          header.appendChild(label)
          header.addEventListener('click', () => {
            const map = JSON.parse(localStorage.getItem('quill_sections_collapsed') || '{}')
            map[type] = !map[type]
            localStorage.setItem('quill_sections_collapsed', JSON.stringify(map))
            header.classList.toggle('collapsed', !!map[type])
            groupWrap.classList.toggle('collapsed', !!map[type])
          })
          wrap.appendChild(header)
        }
        const groupWrap = document.createElement('div')
        groupWrap.className = 'tree-group' + (isCollapsed && typeCount > 1 ? ' collapsed' : '')
        groupWrap.dataset.groupType = type
        wrap.appendChild(groupWrap)
        groups[type].forEach(child => renderTreeItem(child, groupWrap, 0, 'novel', openPaths))
      }
      GROUP_ORDER.forEach(renderGroup)
      Object.keys(groups).forEach(type => {
        if (GROUP_ORDER.includes(type)) return
        renderGroup(type)
      })
      return
    }

    children.forEach(child => {
      renderTreeItem(child, wrap, depth, parentType, openPaths)
    })
  }

  function renderTreeItem(child, wrap, depth, parentType, openPaths) {
    const ownType = child.folder_type || 'novel'
    const effType = ownType !== 'general' ? ownType : parentType
    const folderEl = document.createElement('div')
    folderEl.className = 'tree-folder'

    const row = document.createElement('div')
    row.className = 'folder-row'
    row.style.paddingLeft = (8 + depth * 14) + 'px'
    row.dataset.path = child.path

    // Badge logic: always show at depth 0 (top-level projects), show for typed subfolders
    const BADGE_LABELS = { novel:'Novel', journal:'Journal', act:'Act', worldbible:'World Bible', scratch:'Scratch', stylelab:'Lab' }
    const isChapter  = ownType === 'novel' && parentType === 'act'
    const badgeType  = isChapter ? 'chapter' : ownType
    const badgeLabel = isChapter ? 'Chapter' : (BADGE_LABELS[ownType] || ownType)
    const isTopLevelProject = !child.path.includes('/')
    const showBadge = false
    const badge = showBadge
      ? `<span class="folder-badge ${badgeType}">${badgeLabel}</span>` : ''

    // Novel rows name what the buttons make: acts hold chapters, chapters hold scenes and
    // never nest further, so neither gets a subfolder button.
    const isNovelChapter = ownType === 'novel' && !isTopLevelProject
    const addLabel = ownType === 'act' ? 'New chapter'
      : ownType === 'novel' ? 'New scene'
      : ownType === 'journal' ? 'New entry' : 'New file'
    const subLabel = ownType === 'act' || isNovelChapter ? ''
      : ownType === 'novel' ? 'New act' : 'New subfolder'

    row.innerHTML = `
      <span class="folder-caret">▶</span>
      <span class="folder-name">${esc(child.name)}</span>
      ${badge}
      <span class="folder-actions">
        <button class="f-btn" data-a="${ownType === 'act' ? 'newchapter' : 'newfile'}" data-p="${child.path}" data-ft="${effType}" title="${addLabel}">
          <svg viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg></button>
        ${subLabel ? `<button class="f-btn" data-a="subfolder" data-p="${child.path}" data-ft="${effType}" title="${subLabel}">
          <svg viewBox="0 0 24 24"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg></button>` : ''}
        <button class="f-btn" data-a="rename"    data-p="${child.path}" data-n="${esc(child.name)}" title="Rename">
          <svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
        <button class="f-btn" data-a="delete"    data-p="${child.path}" title="Delete">
          <svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/></svg></button>
      </span>`

    const childWrap = document.createElement('div')
    childWrap.className = 'folder-children'
    const caret = row.querySelector('.folder-caret')

    // restore open state from before refresh, or open if contains active file
    const shouldOpen = openPaths.has(child.path) || hasActive(child, App.getCurrentFile())
    if (shouldOpen) {
      childWrap.classList.add('open'); caret.classList.add('open')
    }

    caret.onclick = e => {
      e.stopPropagation()
      if (_folderDragging) return
      childWrap.classList.toggle('open')
      caret.classList.toggle('open')
      _saveTreeOpenState()
    }

    row.onclick = e => {
      if (e.target.closest('.f-btn')) return
      if (e.target.closest('.folder-caret')) return
      if (_folderDragging) return
      clearFileSelection()
      childWrap.classList.add('open')
      caret.classList.add('open')
      _saveTreeOpenState()
      App.setCurrentFolder(child.path)
      App.openFolder(child.path, effType)
    }

    // derive parent path from child path for drag reordering
    const childParentPath = child.path.includes('/')
      ? child.path.split('/').slice(0, -1).join('/')
      : ''

    // folder drag — only for act/novel-type subfolders (not top-level projects). Acts and
    // chapters reorder among their siblings; a chapter can also go into another act, either
    // dropped on the act (to the end) or beside one of that act's chapters.
    if (childParentPath && (ownType === 'act' || ownType === 'novel')) {
      row.draggable = true
      const dropKind = () => {
        const src = _folderDragSrc
        if (!src || src.path === child.path) return null
        if (src.parentPath === childParentPath) return 'reorder'
        if (src.isChapter && ownType === 'act' && child.path !== src.parentPath) return 'into-act'
        if (src.isChapter && isChapter) return 'beside-chapter'
        return null
      }
      const clearDropLine = () => row.classList.remove('drag-over', 'drop-before', 'drop-after')
      row.addEventListener('dragstart', e => {
        _folderDragSrc = { path: child.path, parentPath: childParentPath, depth, isChapter }
        _folderDragging = true
        e.dataTransfer.effectAllowed = 'move'
        e.dataTransfer.setData('text/plain', child.path)
        setTimeout(() => row.classList.add('dragging'), 0)
      })
      row.addEventListener('dragend', () => {
        row.classList.remove('dragging')
        document.querySelectorAll('.drag-over, .drop-before, .drop-after')
          .forEach(el => el.classList.remove('drag-over', 'drop-before', 'drop-after'))
        setTimeout(() => { _folderDragSrc = null; _folderDragging = false }, 50)
      })
      row.addEventListener('dragover', e => {
        const kind = dropKind()
        if (!kind) return
        e.preventDefault(); e.stopPropagation()
        if (kind === 'beside-chapter') {
          const r = row.getBoundingClientRect()
          const after = e.clientY > r.top + r.height / 2
          row.classList.toggle('drop-after', after)
          row.classList.toggle('drop-before', !after)
        } else row.classList.add('drag-over')
      })
      row.addEventListener('dragleave', clearDropLine)
      row.addEventListener('drop', e => {
        const kind = dropKind()
        const after = row.classList.contains('drop-after')
        clearDropLine()
        if (!kind) return
        e.preventDefault(); e.stopPropagation()
        const src = _folderDragSrc
        if (kind === 'reorder') reorderFolders(src.parentPath, src.path, child.path)
        else if (kind === 'into-act') moveChapterToAct(src.path, child.path)
        else {
          const siblings = childFolderNames(childParentPath)
          const at = siblings.indexOf(child.path.split('/').pop())
          moveChapterToAct(src.path, childParentPath, at < 0 ? undefined : at + (after ? 1 : 0))
        }
      })
    }

    // drop target for FILES being moved into this folder. Acts hold chapters, not scenes, so
    // they refuse scene drops and say where to drop instead.
    const refusesScenes = ownType === 'act' || ownType === 'worldbible'
    row.addEventListener('dragover', e => {
      if (_folderDragSrc || !_dragSrc) return // folder dragging — handled above
      if (refusesScenes) { row.title = 'Drop scenes on a chapter inside this act'; return }
      e.preventDefault(); row.classList.add('drag-over')
    })
    row.addEventListener('dragleave', () => { row.classList.remove('drag-over'); row.removeAttribute('title') })
    row.addEventListener('drop', e => {
      e.preventDefault(); row.classList.remove('drag-over')
      if (_folderDragSrc || refusesScenes) return
      if (_dragSrc && _dragSrc.folder !== child.path) moveFile(child.path)
    })

    row.querySelectorAll('.f-btn').forEach(btn => {
      btn.onclick = async e => {
        e.stopPropagation()
        const a = btn.dataset.a, p = btn.dataset.p, ft = btn.dataset.ft
        if (a === 'newfile')   { App.setCurrentFolder(p, ft); App.newFile() }
        if (a === 'newchapter') {
          const result = await createStructureFolder(p, 'chapter')
          if (!result) return
          await refresh()
          App.openFolder(result.path, 'novel')
        }
        if (a === 'subfolder') {
          if (ft === 'novel' || ft === 'act') {
            const result = await createStructureFolder(p, ft === 'novel' ? 'act' : 'chapter')
            if (!result) return
            await refresh()
            App.openFolder(result.path, ft === 'novel' ? 'act' : 'novel')
          } else if (ft === 'journal') {
            const result = await window.quill.newFolder({ parent: p, name: '', folder_type: 'journal', auto_name: true })
            await refresh()
            App.openFolder(result.path, 'journal')
          } else if (ft === 'scratch') {
            showSimpleFolderModal(p, 'scratch')
          } else {
            showFolderModal(p, ft)
          }
        }
        if (a === 'rename')    { showRenameModal(p, 'folder', btn.dataset.n) }
        if (a === 'delete')    { App.showDeleteModal(p, 'folder') }
      }
    })

    folderEl.appendChild(row)
    folderEl.appendChild(childWrap)
    wrap.appendChild(folderEl)

    // right-click context menu on folder
    row.addEventListener('contextmenu', e => {
      e.preventDefault()
      showFolderContextMenu(e.clientX, e.clientY, child, ownType)
    })

    // render subfolders and files into childWrap
    renderTree(child, childWrap, depth + 1, effType, openPaths)

    // files inside this folder
    const folderPath = child.path || ''
    ;(child.files || []).forEach(file => {
      const fileRow = document.createElement('div')
      fileRow.className = 'file-row' + (file.path === App.getCurrentFile() ? ' active' : '')
      fileRow.style.paddingLeft = (10 + (depth + 1) * 14) + 'px'
      fileRow.dataset.path   = file.path
      fileRow.dataset.folder = folderPath
      fileRow.draggable      = true

      const wc = file.word_count > 0 ? file.word_count.toLocaleString() + ' w' : ''
      fileRow.innerHTML = `
        <span class="file-drag" title="Drag to reorder or move">⠿</span>
        <span class="file-title">${esc(file.title || 'Untitled')}</span>${SYNC_COPY.test(file.path || '') ? '<span class="file-sync-copy" title="Kept twice when merging a backup: this is the other device’s version. Keep the one you want and delete the other.">2 versions</span>' : ''}
        <span class="file-actions">
          <button class="f-btn rename-btn" title="Rename">
            <svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          <button class="f-btn delete-btn" title="Delete file">
            <svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/></svg>
          </button>
        </span>
        <span class="file-wc">${wc}</span>`

      fileRow.querySelector('.rename-btn').onclick = e => {
        e.stopPropagation()
        showRenameModal(file.path, 'file', file.title || file.name.replace(/\.md$/, ''))
      }

      fileRow.querySelector('.delete-btn').onclick = e => {
        e.stopPropagation()
        App.showDeleteModal(file.path, 'file')
      }

      fileRow.addEventListener('mousedown', () => { _didDrag = false })
      fileRow.onclick = e => {
        if (e.target.closest('.f-btn')) return
        if (_didDrag) return
        if (handleFileSelection(e, fileRow, file.path)) return
        App.setCurrentFolder(folderPath)
        App.openFile(file.path)
      }

      fileRow.addEventListener('dragstart', e => {
        if (_selectedFiles.size > 1) { e.preventDefault(); return }
        _dragSrc = { path: file.path, folder: folderPath }
        _didDrag = true
        e.dataTransfer.effectAllowed = 'move'
        e.dataTransfer.setData('text/plain', file.path)
        setTimeout(() => fileRow.classList.add('dragging'), 0)
      })
      fileRow.addEventListener('dragend', () => {
        fileRow.classList.remove('dragging')
        document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'))
        document.querySelectorAll('#sidebar .dnd-before, #sidebar .dnd-after').forEach(el => el.classList.remove('dnd-before', 'dnd-after'))
        setTimeout(() => { _dragSrc = null; _didDrag = false }, 50)
      })
      // Same rule as every other list: the top or bottom half of a row decides the side.
      const below = e => { const r = fileRow.getBoundingClientRect(); return e.clientY > r.top + r.height / 2 }
      fileRow.addEventListener('dragover', e => {
        if (!_dragSrc || _dragSrc.path === file.path) return
        e.preventDefault(); e.stopPropagation()
        const after = below(e)
        if (fileRow.classList.contains(after ? 'dnd-after' : 'dnd-before')) return
        document.querySelectorAll('#sidebar .dnd-before, #sidebar .dnd-after').forEach(el => el.classList.remove('dnd-before', 'dnd-after'))
        fileRow.classList.add('dnd-y', after ? 'dnd-after' : 'dnd-before')
      })
      fileRow.addEventListener('dragleave', e => {
        if (!fileRow.contains(e.relatedTarget)) fileRow.classList.remove('dnd-before', 'dnd-after')
      })
      fileRow.addEventListener('drop', e => {
        e.preventDefault(); e.stopPropagation()
        fileRow.classList.remove('dnd-before', 'dnd-after')
        if (!_dragSrc) return
        const after = below(e)
        if (_dragSrc.folder === folderPath) reorderFiles(folderPath, _dragSrc.path, file.path, after)
        else {
          const names = (child.files || []).map(f => f.path)
          moveFile(folderPath, names.indexOf(file.path) + (after ? 1 : 0))
        }
      })

      fileRow.addEventListener('contextmenu', e => {
        e.preventDefault()
        showFileContextMenu(e.clientX, e.clientY, file, folderPath)
      })

      childWrap.appendChild(fileRow)
    })
  }

  function hasActive(node, active) {
    if (!active) return false
    for (const f of (node.files||[])) if (f.path===active) return true
    for (const c of (node.children||[])) if (hasActive(c, active)) return true
    return false
  }

  function visibleBinderRows() {
    return Array.from(document.querySelectorAll('#tree-wrap .file-row[data-path]'))
      .filter(row => row.offsetParent !== null)
  }

  function handleFileSelection(event, row, filePath) {
    const toggle = event.metaKey || event.ctrlKey
    const range = event.shiftKey
    if (!toggle && !range) {
      clearFileSelection()
      return false
    }
    event.preventDefault()
    event.stopPropagation()
    if (range && _selectionAnchorPath) {
      const rows = visibleBinderRows()
      const paths = rows.map(item => item.dataset.path)
      const from = paths.indexOf(_selectionAnchorPath)
      const to = paths.indexOf(filePath)
      if (from >= 0 && to >= 0) {
        if (!toggle) _selectedFiles.clear()
        const [start, end] = from < to ? [from, to] : [to, from]
        paths.slice(start, end + 1).forEach(item => _selectedFiles.add(item))
      }
    } else if (_selectedFiles.has(filePath)) {
      _selectedFiles.delete(filePath)
    } else {
      _selectedFiles.add(filePath)
    }
    _selectionAnchorPath = filePath
    applySelectionClasses()
    updateSelectionBar()
    return true
  }

  function applySelectionClasses() {
    document.querySelectorAll('#tree-wrap .file-row[data-path]').forEach(row =>
      row.classList.toggle('multi-selected', _selectedFiles.has(row.dataset.path)))
  }

  function updateSelectionBar() {
    applySelectionClasses()
    const bar = document.getElementById('binder-selection-bar')
    const count = document.getElementById('binder-selection-count')
    if (bar) bar.classList.toggle('hidden', _selectedFiles.size === 0 || !_focusedProject)
    if (count) count.textContent = `${_selectedFiles.size} scene${_selectedFiles.size === 1 ? '' : 's'} selected`
  }

  function clearFileSelection() {
    _selectedFiles.clear()
    _selectionAnchorPath = null
    updateSelectionBar()
  }

  function pruneSelectionToProject(projectPath) {
    _selectedFiles = new Set(Array.from(_selectedFiles).filter(filePath => filePath.startsWith(projectPath + '/')))
    if (_selectionAnchorPath && !_selectedFiles.has(_selectionAnchorPath)) _selectionAnchorPath = null
  }

  async function addSelectionToCollection() {
    if (!_focusedProject || !_selectedFiles.size) return
    const project = (_treeData?.children || []).find(child => child.path === _focusedProject)
    if (!project) return
    const existing = (project.collections || []).map(item => item.name).filter(Boolean)
    const message = existing.length
      ? `Enter a new collection name, or use an existing one: ${existing.join(', ')}`
      : 'Name the collection for these scenes.'
    const name = await App.requestName({
      title: 'Add to collection',
      message,
      value: existing[0] || '',
      confirmLabel: 'Add scenes',
    })
    if (name === null || !name.trim()) return
    const saved = await window.quill.saveProjectCollection({ projectPath: project.path, name })
      .catch(err => ({ ok: false, error: err.message }))
    if (!saved?.ok) { alert(saved?.error || 'Could not create the collection.'); return }
    const added = await window.quill.addScenesToCollection({
      projectPath: project.path,
      id: saved.collection.id,
      paths: Array.from(_selectedFiles),
    }).catch(err => ({ ok: false, error: err.message }))
    if (!added?.ok) { alert(added?.error || 'Could not add the selected scenes.'); return }
    clearFileSelection()
    await refresh()
    setWorkspaceSection(`static-collection-${saved.collection.id}`)
    await App.openCollection(project.path, saved.collection.id, saved.collection.name)
  }

  // ── drag helpers ──────────────────────────────────────────

  // Inside one project a scene moves with its notes, history and board card (matched by
  // scene_id) in one step, and can be undone. Between projects the older path still applies.
  async function moveFile(destFolder, destIndex) {
    if (!_dragSrc) return
    await App.flushPendingWork?.()
    const srcFolder = _dragSrc.folder
    const srcPath   = _dragSrc.path
    const fileName  = srcPath.split('/').pop().replace(/\.md$/, '')
    if (srcFolder && srcFolder.split('/')[0] === destFolder.split('/')[0]) {
      const srcIndex = Array.from(document.querySelectorAll(`.file-row[data-folder="${CSS.escape(srcFolder)}"]`)).findIndex(r => r.dataset.path === srcPath)
      _dragSrc = null
      const result = await window.quill.moveSceneBetweenChapters({ rel: srcPath, destFolder, destIndex: Number.isInteger(destIndex) ? destIndex : undefined })
      if (result?.ok === false) { alert(result.error); return }
      Editor.followTime?.(srcPath, result.path)
      await afterSceneMoved(srcPath, destFolder)
      const movedPath = `${destFolder}/${srcPath.split('/').pop()}`
      Dnd.undoToast(`Moved “${fileName}” to ${destFolder.split('/').pop()}.`, async () => {
        const back = await window.quill.moveSceneBetweenChapters({ rel: movedPath, destFolder: srcFolder, destIndex: srcIndex >= 0 ? srcIndex : undefined })
        if (back?.ok === false) { alert(back.error); return }
        Editor.followTime?.(movedPath, back.path)
        await afterSceneMoved(movedPath, srcFolder)
      })
      return
    }

    // Move the board card: remove from source board, add to dest board
    try {
      const [srcBoard, destBoard] = await Promise.all([
        window.quill.getBoard(srcFolder).catch(() => ({ cards:[] })),
        window.quill.getBoard(destFolder).catch(() => ({ cards:[] })),
      ])
      const srcCards  = srcBoard.cards  || []
      const destCards = destBoard.cards || []
      // find card by filename match in source
      const cardIdx = srcCards.findIndex(c =>
        (c.title||'').toLowerCase().trim() === fileName.toLowerCase().trim()
      )
      if (cardIdx >= 0) {
        const [card] = srcCards.splice(cardIdx, 1)
        destCards.push(card)
        await Promise.all([
          window.quill.saveBoard({ folderRel: srcFolder,  cards: srcCards  }),
          window.quill.saveBoard({ folderRel: destFolder, cards: destCards }),
        ])
      }
    } catch {}

    const moved = await window.quill.moveFile({ rel: srcPath, destFolder })
    if (moved?.path) Editor.followTime?.(srcPath, moved.path)
    _dragSrc = null
    refresh()
  }

  async function afterSceneMoved(oldPath, destFolder) {
    await refresh()
    if (App.getCurrentFile?.() === oldPath) App.openFile(`${destFolder}/${oldPath.split('/').pop()}`)
  }

  async function reorderFiles(folderPath, fromPath, toPath, after = false) {
    const rows  = Array.from(document.querySelectorAll(`.file-row[data-folder="${CSS.escape(folderPath)}"]`))
    const names = rows.map(r => r.dataset.path.split('/').pop())
    const before = names.slice()
    const fi    = names.indexOf(fromPath.split('/').pop())
    const ti    = names.indexOf(toPath.split('/').pop())
    if (fi < 0 || ti < 0 || fi === ti) return
    const to = Dnd.finalIndex(fi, ti, after)
    if (to === fi) return
    Dnd.move(names, fi, to)
    await window.quill.reorder({ folder: folderPath, order: names })
    await refresh()
    Dnd.undoToast('Scene order changed.', async () => {
      await window.quill.reorder({ folder: folderPath, order: before })
      refresh()
    })
  }

  // Child folder names of `parentPath` in the order the sidebar shows them.
  function childFolderNames(parentPath) {
    return Array.from(document.querySelectorAll('.folder-row'))
      .filter(r => {
        const p = r.dataset.path || ''
        const parts = p.split('/')
        const parentParts = parentPath ? parentPath.split('/') : []
        return parts.length === parentParts.length + 1 &&
               (parentPath ? p.startsWith(parentPath + '/') : !p.includes('/'))
      })
      .map(r => (r.dataset.path || '').split('/').pop())
  }

  // A chapter, its scenes and their history move in one step on the main side; Undo moves it
  // back to the same spot in its old act.
  async function moveChapterToAct(chapterPath, actPath, destIndex) {
    await App.flushPendingWork?.()
    const chapterName = chapterPath.split('/').pop()
    const result = await window.quill.moveChapterToAct({ rel: chapterPath, destAct: actPath, destIndex })
    if (result?.ok === false) { alert(result.error); return }
    await afterChapterMoved(chapterPath, result.path)
    Dnd.undoToast(`Moved “${chapterName}” to ${actPath.split('/').pop()}.`, async () => {
      const back = await window.quill.moveChapterToAct({ rel: result.path, destAct: result.sourceAct,
        destIndex: result.sourceIndex >= 0 ? result.sourceIndex : undefined })
      if (back?.ok === false) { alert(back.error); return }
      await afterChapterMoved(result.path, back.path)
    })
  }

  async function afterChapterMoved(oldPath, newPath) {
    const moved = p => p && (p === oldPath || p.startsWith(oldPath + '/'))
    const currentFile = App.getCurrentFile?.()
    const currentFolder = App.getCurrentFolder?.()
    await refresh()
    if (moved(currentFile)) await App.openFile(newPath + currentFile.slice(oldPath.length))
    else if (!currentFile && moved(currentFolder)) await App.openFolder(newPath + currentFolder.slice(oldPath.length), 'novel')
  }

  function showMoveChapterMenu(chapterPath) {
    const actPath = chapterPath.split('/').slice(0, -1).join('/')
    const novelPath = actPath.split('/').slice(0, -1).join('/')
    const acts = (findTreeNode(_treeData, novelPath)?.children || [])
      .filter(c => c.folder_type === 'act' && c.path !== actPath)
    if (!acts.length) { alert('This novel has no other act to move the chapter into.'); return }
    showCtxMenu(window.innerWidth / 2 - 120, window.innerHeight / 3, acts.map(act => ({
      label: act.folder_title || act.name || act.path.split('/').pop(), icon: '▸',
      action: () => moveChapterToAct(chapterPath, act.path),
    })))
  }

  function findTreeNode(node, wanted) {
    if (!node) return null
    if (node.path === wanted) return node
    for (const c of node.children || []) {
      const hit = findTreeNode(c, wanted)
      if (hit) return hit
    }
    return null
  }

  async function reorderFolders(parentPath, fromPath, toPath) {
    const names = childFolderNames(parentPath)
    const fi = names.indexOf(fromPath.split('/').pop())
    const ti = names.indexOf(toPath.split('/').pop())
    if (fi < 0 || ti < 0 || fi === ti) return
    names.splice(fi, 1); names.splice(ti, 0, fromPath.split('/').pop())
    await window.quill.reorder({ folder: parentPath || '', order: names, type: 'folders' })
    refresh()
  }

  // ── new project modal ─────────────────────────────────────

  function showProjectModal(type = 'novel') {
    document.getElementById('new-project-name').value = ''
    const importStatus = document.getElementById('np-import-status')
    if (importStatus) importStatus.textContent = ''
    if (typeof type !== 'string') type = 'novel'  // called as a click handler
    document.querySelectorAll('.np-type-btn').forEach(b =>
      b.classList.toggle('active', b.dataset.type === type))
    document.getElementById('new-project-modal').classList.add('show')
    setTimeout(() => document.getElementById('new-project-name').focus(), 60)
  }

  async function runImport() {
    const btn = document.getElementById('np-import-btn')
    const status = document.getElementById('np-import-status')
    const say = (text, error = false) => { status.textContent = text; status.classList.toggle('error', error) }
    btn.disabled = true
    say('Importing…')
    try {
      const result = await window.quill.importNovel()
      if (result.canceled) { say(''); return }
      if (!result.ok) { say(result.error || 'Import failed.', true); return }
      const s = result.summary || {}
      const parts = []
      if (s.acts)            parts.push(`${s.acts} act${s.acts !== 1 ? 's' : ''}`)
      if (s.chapters)        parts.push(`${s.chapters} chapter${s.chapters !== 1 ? 's' : ''}`)
      if (s.scenes)          parts.push(`${s.scenes} scene${s.scenes !== 1 ? 's' : ''}`)
      if (s.characters)      parts.push(`${s.characters} character${s.characters !== 1 ? 's' : ''}`)
      if (s.worldBibleCards) parts.push(`${s.worldBibleCards} WB card${s.worldBibleCards !== 1 ? 's' : ''}`)
      say(`Imported${parts.length ? ': ' + parts.join(', ') : ''}.`)
      await refresh()
      App.loadDashboard()
    } catch (err) {
      console.error('Import error:', err)
      say('Import failed.', true)
    } finally {
      btn.disabled = false
    }
  }

  function closeProjectModal() {
    document.getElementById('new-project-modal').classList.remove('show')
  }

  async function createProject() {
    const name = document.getElementById('new-project-name').value.trim()
    if (!name) { document.getElementById('new-project-name').focus(); return }
    const activeBtn = document.querySelector('.np-type-btn.active')
    const folder_type = activeBtn ? activeBtn.dataset.type : 'novel'
    closeProjectModal()
    const result = await window.quill.newFolder({ parent: '', name, folder_type })
    if (result?.ok === false) { alert(result.error); return }
    await refresh()
    App.openFolder(result.path, folder_type)
  }

  // ── folder modal (World Bible sections only) ──────────────

  function showFolderModal(parent, parentType) {
    _folderParent = parent || ''
    document.getElementById('folder-name-input').value = ''
    const typeRow    = document.getElementById('folder-type-row')
    const typeLabel  = document.getElementById('folder-type-label')
    const typeSel    = document.getElementById('folder-type-select')
    const modalTitle = document.querySelector('#folder-modal h3')

    if (parentType === 'novel') {
      // inside novel → Act (one-click, no modal needed) or World Bible section
      // Acts are now created directly without a modal — this branch handles edge cases
      typeSel.innerHTML = `<option value="act">Act</option>`
      typeSel.value = 'act'
      typeRow.classList.add('hidden')
      if (modalTitle) modalTitle.textContent = 'New act'
      document.getElementById('folder-modal').classList.add('show')
      setTimeout(() => document.getElementById('folder-name-input').focus(), 60)
    } else if (parentType === 'act') {
      // chapters → one-click, no modal
      // handled directly in subfolder button handler
    } else if (parentType === 'worldbible') {
      typeSel.innerHTML = `
        <option value="Locations">Locations</option>
        <option value="Magic &amp; Rules">Magic &amp; Rules</option>
        <option value="Terminology">Terminology</option>
        <option value="History &amp; Lore">History &amp; Lore</option>
        <option value="Creatures &amp; Races">Creatures &amp; Races</option>
        <option value="Politics &amp; Power">Politics &amp; Power</option>
        <option value="Religion &amp; Mythology">Religion &amp; Mythology</option>
        <option value="__custom__">Custom…</option>`
      typeSel.value = 'Locations'
      typeRow.classList.remove('hidden')
      if (typeLabel) typeLabel.textContent = 'Section type'
      if (modalTitle) modalTitle.textContent = 'New World Bible section'
      typeSel.onchange = () => {
        const nameIn = document.getElementById('folder-name-input')
        if (typeSel.value !== '__custom__' && nameIn && !nameIn.value.trim()) {
          nameIn.value = typeSel.value
        }
      }
      document.getElementById('folder-modal').classList.add('show')
      setTimeout(() => document.getElementById('folder-name-input').focus(), 60)
    }
  }

  function closeFolderModal() { document.getElementById('folder-modal').classList.remove('show') }

  async function createFolder() {
    let name = document.getElementById('folder-name-input').value.trim()
    const typeVal = document.getElementById('folder-type-select').value
    // World Bible preset category
    if (!['act', 'novel', 'journal', 'worldbible', '__custom__'].includes(typeVal)) {
      if (!name) name = typeVal
      const result = await window.quill.newFolder({ parent: _folderParent, name, folder_type: 'worldbible' })
      if (result?.ok === false) { alert(result.error); return }
      closeFolderModal(); refresh()
      return
    }
    if (!name) return
    const type = typeVal === '__custom__' ? 'worldbible' : typeVal
    const result = await window.quill.newFolder({ parent: _folderParent, name, folder_type: type })
    if (result?.ok === false) { alert(result.error); return }
    closeFolderModal(); refresh()
  }

  // ── rename modal ──────────────────────────────────────────

  function showRenameModal(path, type, currentName) {
    _renamePath = { path, type }
    document.getElementById('rename-title').textContent = type==='folder' ? 'Rename folder' : 'Rename file'
    document.getElementById('rename-input').value = currentName || path.split('/').pop().replace(/\.md$/,'')
    document.getElementById('rename-modal').classList.add('show')
    setTimeout(() => { const i=document.getElementById('rename-input'); i.focus(); i.select() }, 60)
  }
  function closeRenameModal() { document.getElementById('rename-modal').classList.remove('show'); _renamePath=null }
  async function doRename() {
    const name = document.getElementById('rename-input').value.trim()
    if (!name || !_renamePath) return
    await App.flushPendingWork?.()
    const oldTitle = _renamePath.path.split('/').pop().replace(/\.md$/, '')
    const result   = await window.quill.rename({ rel: _renamePath.path, newName: name })
    if (!result?.ok) {
      alert(result?.error || 'Could not rename this item.')
      return
    }
    const renamedFocusedProject = _renamePath.type === 'folder' && _renamePath.path === _focusedProject
    const renamedProjectType = (_treeData?.children || []).find(child => child.path === _focusedProject)?.folder_type || 'general'
    if (renamedFocusedProject) _focusedProject = result.path
    if (_renamePath.type === 'folder') App.followRename(_renamePath.path, result.path)
    else Editor.followTime?.(_renamePath.path, result.path)
    if (_renamePath.type === 'file') {
      try {
        const folder = _renamePath.path.includes('/')
          ? _renamePath.path.split('/').slice(0,-1).join('/')
          : ''
        const fileData = await window.quill.getFile(result.path).catch(() => null)
        const fileSid  = fileData?.meta?.scene_id || null
        const board    = await window.quill.getBoard(folder).catch(() => ({ cards:[] }))
        const cards    = board.cards || []
        const card     = cards.find(c =>
          (fileSid && c.scene_id && c.scene_id === fileSid) ||
          (c.title||'').toLowerCase().trim() === oldTitle.toLowerCase().trim()
        )
        if (card) {
          card.title = name
          if (fileSid && !card.scene_id) card.scene_id = fileSid
          await window.quill.saveBoard({ folderRel: folder, cards })
        }
      } catch {}
    }
    if (_renamePath.path === App.getCurrentFile() && result.path) {
      await App.openFile(result.path)
    }
    closeRenameModal()
    await refresh()
    if (renamedFocusedProject) await App.openFolder(result.path, renamedProjectType)
  }

  // ── idea sidebar ──────────────────────────────────────────

  const STATUS_META = {
    hot:        { label: 'Hot',        color: 'var(--accent)',  order: 0 },
    developing: { label: 'Developing', color: 'var(--c-revisit)',        order: 1 },
    shelved:    { label: 'Shelved',    color: 'var(--muted)',   order: 2 },
  }
  const STATUS_CYCLE = { hot: 'developing', developing: 'shelved', shelved: 'hot' }

  let _ideaCtxMenu = null
  let _ctxMenu     = null  // shared project/file context menu

  // ── shared context menu renderer ─────────────────────────
  function showCtxMenu(x, y, items) {
    if (_ctxMenu) _ctxMenu.remove()
    const menu = document.createElement('div')
    menu.className = 'idea-ctx-menu'
    menu.style.cssText = `left:${x}px;top:${y}px`
    _ctxMenu = menu

    items.forEach(item => {
      if (item.sep) {
        const sep = document.createElement('div')
        sep.className = 'idea-ctx-sep'
        menu.appendChild(sep)
        return
      }
      const row = document.createElement('div')
      row.className = 'idea-ctx-item' + (item.danger ? ' danger' : '')
      row.innerHTML = `<span class="idea-ctx-icon">${item.icon || ''}</span><span>${esc(item.label)}</span>`
      row.addEventListener('click', () => { menu.remove(); _ctxMenu = null; item.action() })
      menu.appendChild(row)
    })

    document.body.appendChild(menu)
    setTimeout(() => {
      document.addEventListener('mousedown', function handler(e) {
        if (!menu.contains(e.target)) { menu.remove(); _ctxMenu = null; document.removeEventListener('mousedown', handler) }
      })
    }, 0)
  }

  // ── folder right-click menu ───────────────────────────────
  function showFolderContextMenu(x, y, folder, ownType) {
    const items = ownType === 'act'
      ? [{ label: 'New chapter', icon: '✦', action: async () => {
          const result = await createStructureFolder(folder.path, 'chapter')
          if (!result) return
          await refresh()
          App.openFolder(result.path, 'novel')
        } }]
      : [{ label: ownType === 'novel' ? 'New scene' : ownType === 'journal' ? 'New entry' : 'New file', icon: '✦',
          action: () => { App.setCurrentFolder(folder.path, ownType); App.newFile() } }]
    // scratch and general folders support subfolders with a name prompt
    if (ownType === 'scratch' || ownType === 'general') {
      items.push({ label: 'New subfolder', icon: '▸', action: () => showSimpleFolderModal(folder.path, ownType) })
    }

    const isTopNovel = ownType === 'novel' && !folder.path.includes('/')
    if (ownType === 'act') {
      const novelPath = folder.path.split('/')[0]
      items.push({ label: 'Renumber chapters', icon: '#', action: () => doRenumber({ path: novelPath, name: novelPath }, 'chapter', true) })
    }
    if (isTopNovel) {
      items.push(
        { label: 'Renumber chapters', icon: '#', action: () => doRenumber(folder, 'chapter', true) },
        { label: 'Renumber acts',     icon: '#', action: () => doRenumber(folder, 'act', false) }
      )
    }

    if (ownType === 'novel' && folder.path.split('/').length >= 3
        && findTreeNode(_treeData, folder.path.split('/').slice(0, -1).join('/'))?.folder_type === 'act') {
      items.push({ label: 'Move to act…', icon: '→', action: () => showMoveChapterMenu(folder.path) })
    }

    items.push(
      { sep: true },
      { label: 'Rename', icon: '✎', action: () => showRenameModal(folder.path, 'folder', folder.name) },
      { sep: true },
      { label: 'Delete', icon: '✕', danger: true, action: () => App.showDeleteModal(folder.path, 'folder') }
    )
    showCtxMenu(x, y, items)
  }

  async function doRenumber(folder, childType, globalScope) {
    const prefix = childType === 'act' ? 'acts' : 'chapters'
    if (!confirm(`Renumber all ${prefix} in "${folder.name}" sequentially?`)) return
    await App.flushPendingWork?.()
    const result = await window.quill.renumberChildren({
      parentRel: folder.path, childType, globalScope
    }).catch(err => ({ ok: false, error: err.message }))
    if (!result?.ok) { alert(result?.error || 'Renumber failed.'); return }
    const cur = App.getCurrentFile?.()
    for (const r of result.renames || []) App.followRename(r.old, r.new)
    const moved = App.getCurrentFile?.()
    if (cur && moved !== cur) await App.openFile(moved)
    await refresh()
  }

  // ── file right-click menu ─────────────────────────────────
  function showFileContextMenu(x, y, file, folderPath) {
    const items = [
      { label: 'Duplicate scene', icon: '⧉', action: () => duplicateScene(file, false) },
      { label: 'New scene from outline', icon: '↳', action: () => duplicateScene(file, true) },
      { sep: true },
      { label: 'Rename', icon: '✎', action: () => showRenameModal(file.path, 'file', file.title || file.name.replace(/\.md$/, '')) },
      { label: 'Move to…', icon: '→', action: () => showMoveToModal(file.path) },
      { sep: true },
      { label: 'Delete', icon: '✕', danger: true, action: () => App.showDeleteModal(file.path, 'file') },
    ]
    showCtxMenu(x, y, items)
  }

  async function duplicateScene(file, outlineOnly) {
    await App.flushPendingWork?.()
    const result = await window.quill.duplicateScene({ rel: file.path, outlineOnly }).catch(err => ({
      ok: false,
      error: err.message,
    }))
    if (!result?.ok) {
      alert(result?.error || 'Could not duplicate this scene.')
      return
    }
    await refresh()
    App.setCurrentFolder(result.path.split('/').slice(0, -1).join('/'))
    await App.openFile(result.path)
  }

  // ── move-to picker ────────────────────────────────────────
  async function showMoveToModal(filePath) {
    const tree = await window.quill.getTree().catch(() => null)
    if (!tree) return

    // collect all folders (flat) from the tree as move targets
    const folders = []
    function collectFolders(node, depth) {
      if (node.path) folders.push({ path: node.path, name: node.path, type: node.folder_type })
      for (const c of (node.children || [])) collectFolders(c, depth + 1)
    }
    collectFolders(tree, 0)

    // filter out the file's own folder
    const ownFolder = filePath.includes('/') ? filePath.split('/').slice(0,-1).join('/') : ''
    const targets = folders.filter(f => f.path !== ownFolder && f.type !== 'act' && f.type !== 'worldbible')
    if (!targets.length) return

    // build a simple inline picker using the ctx menu system
    const items = targets.map(f => ({
      label: f.path,
      icon: { novel:'✦', journal:'◎', scratch:'✂', act:'▸', general:'◦' }[f.type] || '◦',
      // Same path as a drag, so the board card, notes and Undo come along.
      action: () => { _dragSrc = { path: filePath, folder: ownFolder }; return moveFile(f.path) }
    }))
    // show at center of screen
    const x = window.innerWidth / 2 - 120
    const y = window.innerHeight / 3
    showCtxMenu(x, y, [
      ...items
    ])
  }

  // ── name dialog (new act / chapter / scene / track) ──────
  // Resolves to the typed name, '' when confirmed blank (the caller uses its generic
  // name, shown as the placeholder), or null when cancelled.
  let _nameResolve = null
  let _nameLocation = null
  let _nameReturnFocus = null

  function askName({ heading, fallback = '', placeholder = '', location = null }) {
    const modal = document.getElementById('name-modal')
    const input = document.getElementById('name-modal-input')
    if (!modal || !input) return Promise.resolve(null)
    if (_nameResolve) finishName(null)
    _nameLocation = location
    _nameReturnFocus = document.activeElement
    document.getElementById('name-location').hidden = !location
    document.getElementById('name-modal-heading').textContent = heading
    input.value = ''
    input.placeholder = fallback || placeholder
    document.getElementById('name-modal-hint').textContent = fallback ? `Leave blank to use “${fallback}”.` : ''
    modal.classList.add('show')
    if (location) setupNameLocation(location)
    setTimeout(() => { if (modal.classList.contains('show')) input.focus() }, 60)
    return new Promise(resolve => { _nameResolve = resolve })
  }

  function finishName(value) {
    document.getElementById('name-modal')?.classList.remove('show')
    const resolve = _nameResolve
    const result = value !== null && _nameLocation ? { name:value, parent:_nameLocation.parent } : value
    _nameResolve = null
    _nameLocation = null
    if (_nameReturnFocus?.isConnected) _nameReturnFocus.focus()
    _nameReturnFocus = null
    resolve?.(result)
  }

  // Project-scoped destinations: acts filter chapters, and every default remains visible.
  async function askManuscriptName({ project, parent, kind }) {
    const tree = await window.quill.getTree()
    const novel = (tree.children || []).find(node => node.path === project && node.folder_type === 'novel')
    if (!novel) { alert('This novel is no longer available. Reopen the project and try again.'); return null }
    const acts = (novel.children || []).filter(node => node.folder_type === 'act')
    const containers = [novel, ...acts]
    const chapters = containers.flatMap(node => (node.children || [])
      .filter(child => ['novel', 'general'].includes(child.folder_type) && child.name.toLowerCase() !== 'world bible'))
    const nodes = [...containers, ...chapters]
    const titles = new Map(await Promise.all(nodes.map(async node => {
      const meta = await window.quill.getFolderMeta(node.path).catch(() => ({}))
      return [node.path, meta.folder_title || node.name]
    })))
    return askName({ heading:kind === 'scene' ? 'New scene' : 'New chapter',
      location:{ novel, acts, chapters, titles, parent, kind } })
  }

  function setupNameLocation(location) {
    const { novel, acts, chapters, titles, kind } = location
    const actSelect = document.getElementById('name-act-select')
    const chapterSelect = document.getElementById('name-chapter-select')
    const within = (parent, node) => parent === node.path || parent.startsWith(node.path + '/')
    const initialAct = acts.find(node => within(location.parent, node))
    const initialChapter = chapters.find(node => within(location.parent, node))
    const option = (value, label) => new Option(label, value)
    actSelect.replaceChildren(option(novel.path, 'No act — novel level'), ...acts.map(node => option(node.path, titles.get(node.path))))
    actSelect.value = initialAct?.path || novel.path
    document.getElementById('name-act-row').hidden = !acts.length
    document.getElementById('name-chapter-row').hidden = kind !== 'scene'
    document.getElementById('name-location-project').textContent = 'Novel: ' + titles.get(novel.path)
    let generation = 0
    const updateDestination = async () => {
      const request = ++generation
      const parent = kind === 'scene' ? chapterSelect.value : actSelect.value
      location.parent = parent
      const labels = [titles.get(novel.path)]
      if (actSelect.value !== novel.path) labels.push(titles.get(actSelect.value))
      if (kind === 'scene' && parent !== actSelect.value) labels.push(titles.get(parent))
      document.getElementById('name-location-preview').textContent = 'Create in: ' + labels.join(' › ')
      const fallback = await window.quill.suggestName({ parent, kind }).catch(() => '')
      if (_nameLocation !== location || request !== generation) return
      document.getElementById('name-modal-input').placeholder = fallback
      document.getElementById('name-modal-hint').textContent = fallback ? `Leave blank to use “${fallback}”.` : ''
    }
    const updateChapters = (selected = '') => {
      const container = actSelect.value
      const available = chapters.filter(node => node.path.slice(0, node.path.lastIndexOf('/')) === container)
      chapterSelect.replaceChildren(option(container, 'No chapter — directly in ' + titles.get(container)),
        ...available.map(node => option(node.path, titles.get(node.path))))
      chapterSelect.value = available.some(node => node.path === selected) ? selected : container
      updateDestination()
    }
    actSelect.onchange = () => updateChapters()
    chapterSelect.onchange = updateDestination
    updateChapters(initialChapter?.path)
  }

  // An insertion point pins the parent; free creation offers a visible location picker.
  async function createStructureFolder(parent, kind, before = '') {
    const folder_type = kind === 'act' ? 'act' : 'novel'
    while (true) {
      let name
      if (kind === 'chapter' && !before) {
        const choice = await askManuscriptName({ project:parent.split('/')[0], parent, kind })
        if (choice === null) return null
        name = choice.name
        parent = choice.parent
      } else {
        const fallback = await window.quill.suggestName({ parent, kind }).catch(() => '')
        name = await askName({ heading:kind === 'act' ? 'New act' : 'New chapter', fallback })
        if (name === null) return null
      }
      const result = await window.quill.newFolder(name
        ? { parent, name, folder_type, before }
        : { parent, name:'', folder_type, auto_name:true, before })
      if (result?.ok !== false) return result
      alert(result.error)
    }
  }

  // ── simple folder modal (scratch/general subfolders) ─────
  let _simpleFolderParent = null
  let _simpleFolderType   = 'general'

  function showSimpleFolderModal(parentPath, parentType) {
    _simpleFolderParent = parentPath
    _simpleFolderType   = 'general'
    const modal = document.getElementById('simple-folder-modal')
    const input = document.getElementById('simple-folder-input')
    if (!modal || !input) return
    input.value = ''
    modal.classList.add('show')
    setTimeout(() => { input.focus() }, 60)
  }

  function closeSimpleFolderModal() {
    const modal = document.getElementById('simple-folder-modal')
    if (modal) modal.classList.remove('show')
    _simpleFolderParent = null
  }

  async function createSimpleFolder() {
    const name = document.getElementById('simple-folder-input').value.trim()
    if (!name || !_simpleFolderParent) return
    closeSimpleFolderModal()
    const result = await window.quill.newFolder({ parent: _simpleFolderParent, name, folder_type: _simpleFolderType })
    if (result?.ok === false) { alert(result.error); return }
    await refresh()
    App.openFolder(result.path, _simpleFolderType)
  }


  async function renderIdeaSidebar() {
    const ideas = await window.quill.getIdeas().catch(() => [])
    const list  = document.getElementById('idea-list-sidebar')
    if (!list) return
    list.innerHTML = ''

    if (!ideas.length) {
      list.innerHTML = '<div class="idea-sidebar-empty">No ideas yet — click + to add one</div>'
      return
    }

    // group by status
    const groups = { hot: [], developing: [], shelved: [] }
    ideas.forEach(idea => {
      const s = idea.status || 'hot'
      if (groups[s]) groups[s].push(idea)
      else groups.hot.push(idea)
    })

    Object.entries(STATUS_META).forEach(([status, meta]) => {
      const bucket = groups[status]
      // always render hot/developing, only render shelved if non-empty
      if (status === 'shelved' && !bucket.length) return

      const collapseKey = 'quill_idea_group_collapsed_' + status
      const isCollapsed = localStorage.getItem(collapseKey) === '1'

      // group header
      const header = document.createElement('div')
      header.className = 'tree-type-header collapsible idea-group-header' + (isCollapsed ? ' collapsed' : '')
      header.dataset.status = status
      header.innerHTML = `
        <span class="section-caret">▸</span>
        <span class="idea-group-dot" style="background:${meta.color}"></span>
        <span class="tree-type-label">${meta.label}</span>
        <span class="idea-group-count">${bucket.length}</span>
      `
      header.addEventListener('click', () => {
        const collapsed = localStorage.getItem(collapseKey) === '1'
        localStorage.setItem(collapseKey, collapsed ? '0' : '1')
        renderIdeaSidebar()
      })
      list.appendChild(header)

      // drop zone for dragging into this group
      const groupBody = document.createElement('div')
      groupBody.className = 'idea-group-body' + (isCollapsed ? ' collapsed' : '')
      groupBody.dataset.status = status
      const isIdea = e => [...(e.dataTransfer?.types || [])].includes(Dnd.mime('idea'))
      groupBody.addEventListener('dragover', e => {
        if (!isIdea(e)) return
        e.preventDefault()
        groupBody.classList.add('drag-over')
      })
      groupBody.addEventListener('dragleave', () => groupBody.classList.remove('drag-over'))
      groupBody.addEventListener('drop', async e => {
        e.preventDefault()
        groupBody.classList.remove('drag-over')
        if (!isIdea(e)) return
        const id = e.dataTransfer.getData(Dnd.mime('idea'))
        if (!id) return
        await Ideas.setIdeaStatus(id, status)
      })

      if (!bucket.length && !isCollapsed) {
        const empty = document.createElement('div')
        empty.className = 'idea-group-empty'
        empty.textContent = 'Drop ideas here'
        groupBody.appendChild(empty)
      }

      bucket.forEach(idea => {
        const el = document.createElement('div')
        el.className = 'idea-sidebar-item'
        el.dataset.id = idea.id
        el.draggable = true
        const dotColor = STATUS_META[idea.status || 'hot']?.color || 'var(--accent)'

        el.innerHTML = `
          <span class="idea-sidebar-dot" title="Cycle status" style="background:${dotColor};opacity:1;cursor:pointer;flex-shrink:0"></span>
          <span class="idea-sidebar-name">${esc(idea.title || 'Untitled idea')}</span>
          <span class="idea-sidebar-actions">
            <button class="idea-sidebar-action-btn" title="Rename" data-action="rename">
              <svg viewBox="0 0 24 24" width="11" height="11"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            </button>
            <button class="idea-sidebar-action-btn danger" title="Delete" data-action="delete">
              <svg viewBox="0 0 24 24" width="11" height="11"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/></svg>
            </button>
          </span>
        `

        // click → open idea
        el.addEventListener('click', e => {
          if (e.target.closest('.idea-sidebar-dot')) return
          if (e.target.closest('.idea-sidebar-action-btn')) return
          document.querySelectorAll('.idea-sidebar-item').forEach(i => i.classList.remove('active'))
          el.classList.add('active')
          App.showView('ideas')
          Ideas.openIdea(idea.id)
        })

        // action buttons
        el.querySelector('[data-action="rename"]').addEventListener('click', e => {
          e.stopPropagation()
          startInlineRename(idea)
        })
        el.querySelector('[data-action="delete"]').addEventListener('click', e => {
          e.stopPropagation()
          confirmDeleteIdea(idea)
        })

        // dot click → cycle status
        el.querySelector('.idea-sidebar-dot').addEventListener('click', async e => {
          e.stopPropagation()
          const next = STATUS_CYCLE[idea.status || 'hot']
          await Ideas.setIdeaStatus(idea.id, next)
        })

        // drag
        el.addEventListener('dragstart', e => {
          e.dataTransfer.setData('text/plain', idea.id)
          e.dataTransfer.setData(Dnd.mime('idea'), idea.id)
          el.classList.add('dragging')
        })
        el.addEventListener('dragend', () => el.classList.remove('dragging'))

        // right-click context menu
        el.addEventListener('contextmenu', e => {
          e.preventDefault()
          showIdeaContextMenu(e.clientX, e.clientY, idea)
        })

        groupBody.appendChild(el)
      })

      list.appendChild(groupBody)
    })

    // mark active
    const currentId = Ideas.getCurrentIdeaId?.()
    if (currentId) {
      const active = list.querySelector(`.idea-sidebar-item[data-id="${currentId}"]`)
      if (active) active.classList.add('active')
    }
  }

  function showIdeaContextMenu(x, y, idea) {
    // remove any existing menu
    if (_ideaCtxMenu) _ideaCtxMenu.remove()

    const menu = document.createElement('div')
    menu.className = 'idea-ctx-menu'
    menu.style.cssText = `left:${x}px;top:${y}px`
    _ideaCtxMenu = menu

    const items = [
      { label: 'Rename',    icon: '✎', action: () => startInlineRename(idea) },
      { label: 'Duplicate', icon: '⧉', action: () => duplicateIdea(idea) },
      { sep: true },
      { label: 'Mark Hot',        icon: '●', color: 'var(--accent)', action: () => Ideas.setIdeaStatus(idea.id, 'hot') },
      { label: 'Mark Developing', icon: '●', color: 'var(--c-revisit)',       action: () => Ideas.setIdeaStatus(idea.id, 'developing') },
      { label: 'Mark Shelved',    icon: '●', color: 'var(--muted)',   action: () => Ideas.setIdeaStatus(idea.id, 'shelved') },
      { sep: true },
      { label: 'Delete', icon: '✕', danger: true, action: () => confirmDeleteIdea(idea) },
    ]

    items.forEach(item => {
      if (item.sep) {
        const sep = document.createElement('div')
        sep.className = 'idea-ctx-sep'
        menu.appendChild(sep)
        return
      }
      const row = document.createElement('div')
      row.className = 'idea-ctx-item' + (item.danger ? ' danger' : '')
      row.innerHTML = `<span class="idea-ctx-icon" style="${item.color ? 'color:' + item.color : ''}">${item.icon}</span><span>${esc(item.label)}</span>`
      row.addEventListener('click', () => { menu.remove(); _ideaCtxMenu = null; item.action() })
      menu.appendChild(row)
    })

    document.body.appendChild(menu)

    // close on outside click
    setTimeout(() => {
      document.addEventListener('mousedown', function handler(e) {
        if (!menu.contains(e.target)) {
          menu.remove()
          _ideaCtxMenu = null
          document.removeEventListener('mousedown', handler)
        }
      })
    }, 10)

    // keep menu within viewport
    const rect = menu.getBoundingClientRect()
    if (rect.right  > window.innerWidth)  menu.style.left = (x - rect.width)  + 'px'
    if (rect.bottom > window.innerHeight) menu.style.top  = (y - rect.height) + 'px'
  }

  function startInlineRename(idea) {
    const el = document.querySelector(`.idea-sidebar-item[data-id="${idea.id}"] .idea-sidebar-name`)
    if (!el) return
    const nameSpan = el
    const orig = idea.title || 'Untitled idea'
    const input = document.createElement('input')
    input.className = 'idea-inline-rename'
    input.value = orig
    nameSpan.replaceWith(input)
    input.focus()
    input.select()
    const commit = async () => {
      const val = input.value.trim() || orig
      idea.title = val
      await Ideas.updateIdeaTitle(idea.id, val)
    }
    input.addEventListener('blur', commit)
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter')  { e.preventDefault(); input.blur() }
      if (e.key === 'Escape') { input.value = orig; input.blur() }
    })
  }

  async function duplicateIdea(idea) {
    await Ideas.duplicateIdea(idea.id)
  }

  async function confirmDeleteIdea(idea) {
    // reuse App's delete modal if available, else direct delete
    await Ideas.deleteIdeaById(idea.id)
  }

  // ── helpers ───────────────────────────────────────────────

  function esc(s) { return escapeHtml(s) }
  function overlayClose(id, fn) {
    document.getElementById(id).addEventListener('click', e => { if (e.target.id===id) fn() })
  }

  function expandToFile(filePath) {
    if (!filePath) return
    // walk parent paths and open each folder
    const parts = filePath.split('/')
    for (let i = 1; i < parts.length; i++) {
      const folderPath = parts.slice(0, i).join('/')
      const row = document.querySelector(`.folder-row[data-path="${folderPath}"]`)
      if (row) {
        const childWrap = row.nextElementSibling
        const caret = row.querySelector('.folder-caret')
        if (childWrap && !childWrap.classList.contains('open')) {
          childWrap.classList.add('open')
          if (caret) caret.classList.add('open')
        }
      }
    }
    _saveTreeOpenState()
    // also highlight the file
    setActive(filePath)
  }

  return { init, refresh, setActive, setWorkspaceSection, focusForPath, exitProjectFocus,
           expandToFile, showProjectModal, refreshIdeaSidebar: renderIdeaSidebar,
           askName, askManuscriptName, createStructureFolder }
})()
