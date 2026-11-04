/* app.js */

const App = (() => {
  let _currentFile       = null
  let _currentFolder     = ''
  let _currentFolderType = 'general'
  let _sidebarOpen       = true
  let _focusMode         = false
  let _boardMode         = false
  let _navigationGeneration = 0
  let _currentCollection = null
  let _recoveryItems = []
  let _recoverySelected = null
  let _recoverySelectedFile = ''
  let _backupProject = null
  let _backupChoiceBusy = false
  let _archiveRestore = null
  let _archiveRestoreBusy = false
  let _archiveMerged = false
  let _trackedProjectPath = ''
  let _projectTimeLastTick = Date.now()
  let _projectTimeLastActivity = Date.now()
  let _projectTimePending = 0
  let _projectTimeFlush = Promise.resolve()

  function noteProjectActivity() {
    _projectTimeLastActivity = Date.now()
  }

  function sampleProjectTime() {
    const now = Date.now()
    const elapsed = Math.max(0, Math.min(30, (now - _projectTimeLastTick) / 1000))
    _projectTimeLastTick = now
    if (_trackedProjectPath && !document.hidden && document.hasFocus()
        && now - _projectTimeLastActivity <= 2 * 60 * 1000) {
      _projectTimePending += elapsed
    }
  }

  function flushProjectTime() {
    sampleProjectTime()
    const seconds = Math.floor(_projectTimePending)
    const projectPath = _trackedProjectPath
    if (!projectPath || seconds < 1) return _projectTimeFlush
    _projectTimePending -= seconds
    _projectTimeFlush = _projectTimeFlush
      .then(() => window.quill.trackProjectTime?.({ projectPath, seconds }))
      .then(result => showAchievementToast(result?.achievements))
      .catch(() => {})
    return _projectTimeFlush
  }

  async function setTrackedProject(projectPath) {
    if ((projectPath || '') === _trackedProjectPath) {
      noteProjectActivity()
      return
    }
    await flushProjectTime()
    _trackedProjectPath = projectPath || ''
    _projectTimePending = 0
    _projectTimeLastTick = Date.now()
    noteProjectActivity()
  }

  function init() {
    // theme and preferences
    Settings.init()
    Toolbar.init()
    try {
      if (localStorage.getItem('quill_sidebar_open') === '0') {
        _sidebarOpen = false
        document.getElementById('sidebar').classList.add('hidden')
      }
      const w = Number(localStorage.getItem('quill_split_width'))
      if (w >= 200 && w <= 700) _splitWidth = w
    } catch {}
    document.getElementById('theme-btn').onclick = Settings.toggleDark
    window.quill.onOpenSettings?.(() => Settings.open())
    window.quill.onOpenHelp?.(which => QuillHelp.open(which))
    // Badges main earns on its own (a Scene Builder plan, a chapter shuffle, an export).
    window.quill.onAchievementsEarned?.(badges => showAchievementToast(badges))
    // Mark drags that start outside the prose so the editor refuses them (see behaviors.js).
    document.addEventListener('dragstart', e => {
      if (e.target?.closest?.('.ProseMirror') || !e.dataTransfer) return
      try { e.dataTransfer.setData('application/x-quill-internal', '1') } catch {}
    }, true)

    // toolbar
    document.getElementById('read-btn').onclick        = toggleReadDraft
    document.getElementById('split-btn').onclick       = toggleSplitPanel
    document.getElementById('back-btn').onclick        = goBack
    document.getElementById('sidebar-toggle-btn').onclick = toggleSidebar
    document.getElementById('focus-btn').onclick          = toggleFocus
    document.getElementById('board-btn').onclick          = toggleBoard
    // A bare reference would pass the click event as the forced state, so it could never close.
    document.getElementById('notes-btn').onclick          = () => Editor.toggleInspector()
    document.getElementById('export-btn')?.addEventListener('click', Editor.exportDoc)
    document.getElementById('delete-btn')?.addEventListener('click', () => {
      if (_currentFile) showDeleteModal(_currentFile, 'file')
    })
    document.getElementById('snapshot-btn')?.addEventListener('click', openSnapshotModal)
    document.getElementById('trash-open-btn')?.addEventListener('click', openTrashModal)
    document.getElementById('recovery-open-btn')?.addEventListener('click', openRecoveryCenter)
    document.getElementById('snapshot-recovery-btn')?.addEventListener('click', () => {
      document.getElementById('snapshot-modal').classList.remove('show')
      openRecoveryCenter()
    })
    document.getElementById('recovery-close-btn')?.addEventListener('click', closeRecoveryCenter)
    document.getElementById('recovery-filter')?.addEventListener('change', renderRecoveryList)
    document.getElementById('recovery-restore-btn')?.addEventListener('click', restoreSelectedRecovery)
    document.getElementById('recovery-archive-btn')?.addEventListener('click', chooseArchiveToRestore)
    document.getElementById('recovery-file-select')?.addEventListener('change', event => {
      _recoverySelectedFile = decodeURIComponent(event.target.value)
      loadRecoveryPreview()
    })
    document.getElementById('recovery-modal')?.addEventListener('click', event => {
      if (event.target.id === 'recovery-modal') closeRecoveryCenter()
    })
    document.getElementById('backup-choice-close')?.addEventListener('click', closeBackupChoice)
    document.getElementById('backup-choice-local')?.addEventListener('click', backupProjectLocally)
    document.getElementById('backup-choice-cloud')?.addEventListener('click', backupLibraryToCloud)
    document.getElementById('backup-choice-modal')?.addEventListener('click', event => {
      if (event.target.id === 'backup-choice-modal') closeBackupChoice()
    })
    document.getElementById('archive-restore-close')?.addEventListener('click', closeArchiveRestore)
    document.getElementById('archive-restore-project')?.addEventListener('change', renderArchiveRestoreProject)
    document.getElementById('archive-restore-project-btn')?.addEventListener('click', () => restoreInspectedArchive('project'))
    document.getElementById('archive-restore-library-btn')?.addEventListener('click', () => restoreInspectedArchive('library'))
    document.getElementById('archive-merge-btn')?.addEventListener('click', mergeInspectedArchive)
    document.getElementById('archive-restore-modal')?.addEventListener('click', event => {
      if (event.target.id === 'archive-restore-modal') closeArchiveRestore()
    })
    document.getElementById('dash-backup-health')?.addEventListener('click', () => Settings.open('backups'))
    window.addEventListener('quill-cloud-backup-status', event => renderDashboardBackupHealth(event.detail))
    setInterval(() => refreshDashboardBackupHealth(), 6 * 60 * 60 * 1000)
    document.getElementById('entry-title')?.addEventListener('input', event => {
      if (_currentFile) setToolbarLocation(_currentFile, event.target.value || undefined)
    })
    for (const eventName of ['keydown', 'pointerdown', 'input', 'wheel']) {
      document.addEventListener(eventName, noteProjectActivity, { passive:true })
    }
    setInterval(() => {
      sampleProjectTime()
      if (_projectTimePending >= 60) flushProjectTime()
    }, 15000)
    window.addEventListener('blur', () => flushProjectTime())
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) flushProjectTime()
      else { _projectTimeLastTick = Date.now(); noteProjectActivity() }
    })

    // init modules
    Tree.init()
    Editor.init()
    RevisionNotes.init()
    Chapter.init()
    Board.init()
    Ideas.init()
    initSplitDivider()
    initOutline()
    updateBackBtn()  // set initial disabled state

    window.quill.onBeforeClose?.(async () => {
      // Work that could not be saved asks Stay or Discard first. Stay keeps the window open;
      // any other failure still closes, as before, rather than trapping the writer.
      if (typeof StyleStudy !== 'undefined' && !(await StyleStudy.confirmClose?.())) return
      try { await flushPendingWork() } catch (error) { if (error?.stay) return }
      try { await flushProjectTime() }
      finally { window.quill.closeReady?.() }
    })

    // ensure Style Lab folder exists (idempotent) then refresh tree
    window.quill.ensureStyleLab?.()
      .then(() => Tree.refresh())
      .catch(() => {})

    // Collapse carets for Ideas sidebar section
    initSectionCollapse('practice', 'practice-section-caret', 'practice-sidebar-section')
    initSectionCollapse('ideas', 'ideas-section-caret', 'ideas-sidebar-section')
    initSectionCollapse('projects', 'projects-section-caret', 'projects-sidebar-heading')

    // tag back button
    document.getElementById('tag-back-btn').onclick = () => {
      if (_currentFile) showView('editor')
      else if (_currentFolder) showView('landing')
      else showView('empty')
    }

    // comment search back button
    document.getElementById('comment-search-back').onclick = () => {
      if (_currentFile) showView('editor')
      else if (_currentFolder) showView('landing')
      else showView('empty')
    }

    // global search
    initGlobalSearch()
    document.getElementById('global-search-btn').onclick = () => openGlobalSearch()
    document.getElementById('collection-back-btn')?.addEventListener('click', goBack)

    // view-all-comments button
    document.getElementById('view-all-comments-btn').onclick = () => openCommentSearch('all')

    // load tree
    Tree.refresh()

    // always show dashboard on startup — user can continue from there
    loadDashboard()

    // Text fields (chapter and scene titles, naming dialogs, planning notes) get the editor's
    // -- → — so titles like "Chapter 11 — Fabric" can be typed. Capture runs before the
    // field's own input handlers, so they save the converted value.
    document.addEventListener('input', e => {
      const el = e.target
      if (e.inputType !== 'insertText' || e.data !== '-') return
      if (!(el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && el.type === 'text'))) return
      try { if (localStorage.getItem('quill_smart_typo') === 'off') return } catch {}
      const at = el.selectionStart
      if (at < 2 || at !== el.selectionEnd || el.value.slice(at - 2, at) !== '--') return
      el.value = el.value.slice(0, at - 2) + '—' + el.value.slice(at)
      el.setSelectionRange(at - 1, at - 1)
    }, true)

    // global keyboard shortcuts
    document.addEventListener('keydown', e => {
      const mod = e.metaKey || e.ctrlKey
      if (mod && e.key === 'n') { e.preventDefault(); newFile() }
      if (mod && e.key === 's') { e.preventDefault(); Editor.save() }
      if (mod && e.key === '\\') { e.preventDefault(); toggleSidebar() }
      const key = (e.key || '').toLowerCase()
      if (mod && key === 'f' && e.shiftKey) { e.preventDefault(); openGlobalSearch(); return }
      if (mod && key === 'r' && !e.shiftKey && !e.altKey) {
        e.preventDefault()
        if (document.getElementById('split-btn')?.offsetParent) toggleSplitPanel()
        return
      }
      if (mod && key === 'f') {
        e.preventDefault()
        const tb = document.getElementById('toolbar')
        const view = tb ? tb.dataset.view : ''
        if (view === 'editor') Editor.toggleFind()
        else openGlobalSearch()
      }
      if (mod && e.shiftKey && e.key.toLowerCase() === 't') {
        const v = document.getElementById('toolbar')?.dataset.view
        if (v === 'editor' || v === 'chapter') { e.preventDefault(); ThesaurusPopover.open(); return }
      }
      if (mod && e.key === '.') { e.preventDefault(); toggleFocus() }
      if (mod && e.key === ',') { e.preventDefault(); Settings.open() }
      const view = document.getElementById('toolbar')?.dataset.view
      if (mod && (view === 'editor' || view === 'chapter')) {
        if (e.key === '=' || e.key === '+') { e.preventDefault(); Settings.zoomBy(0.1) }
        if (e.key === '-') { e.preventDefault(); Settings.zoomBy(-0.1) }
        if (e.key === '0') { e.preventDefault(); Settings.resetZoom() }
      }
      if (e.key === 'Escape') {
        if (ThesaurusPopover.isOpen()) { ThesaurusPopover.close(); return }
        if (Settings.isOpen()) { Settings.close(); return }
        if (_focusMode) { toggleFocus(); return }
        Editor.closeFind()
        closeAnyModal()
      }
    })
  }

  // ── views ─────────────────────────────────────────────────
  function showView(name) {
    // Many view switches do not flush first. A chapter with unsaved edits is saved (or, if it
    // cannot be, the writer is asked) before it is torn down, and the switch waits for that.
    if (name !== 'chapter' && Chapter.hasUnsaved?.()) {
      Chapter.confirmLeave().then(leave => { if (leave) showView(name) })
      return
    }
    if (name !== 'stylelab' && typeof StyleStudy !== 'undefined' && StyleStudy.hasUnsaved?.()) {
      StyleStudy.confirmLeave().then(leave => { if (leave) showView(name) })
      return
    }
    if (name !== 'chapter' && Chapter.isOpen?.()) Chapter.close()
    if (name !== 'read-draft') ReadDraft.close(document.getElementById('read-draft-content'))
    // The novel page's Read Draft has its own selection and comment listeners; leaving the
    // page closes it so they can't act on pages shown elsewhere.
    const novelRead = document.getElementById('read-content')
    if (name !== 'landing' && novelRead) ReadDraft.close(novelRead)
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'))
    const el = document.getElementById('view-' + name)
    if (el) el.classList.add('active')
    // track current view on toolbar for CSS-based control greying
    const tb = document.getElementById('toolbar')
    if (tb) tb.dataset.view = name
    document.getElementById('scene-outline')?.classList.toggle('open', name === 'editor' && _outlineOpen)
  }

  function setToolbarLocation(itemPath, finalLabel) {
    const el = document.getElementById('location-hint')
    if (!el) return
    if (!itemPath) { el.textContent = ''; el.title = ''; return }
    const parts = itemPath.split('/').filter(Boolean)
    if (finalLabel && parts.length) parts[parts.length - 1] = finalLabel
    const label = parts.join(' › ')
    el.textContent = label
    el.title = label
  }

  async function flushPendingWork() {
    await Editor.flushPending?.()
    await Chapter.flushPending?.()
    await Comments.flush?.()
    await Landing.flushPending?.()
    await Board.flushPending?.()
    await Scraps.flushPending?.()
    if (typeof StyleStudy !== 'undefined') await StyleStudy.flushPending?.()
    await flushOutline()
  }

  // ── file/folder ops ───────────────────────────────────────
  async function openFile(path) {
    Settings.warmGrammar()
    const generation = ++_navigationGeneration
    Editor.cancelPendingOpen?.()
    // From here until the next scene is in, the prose editor takes no input: a keystroke would
    // land in the scene being left after its final save and vanish when the new one loads.
    Editor.freeze?.()
    try {
      await flushPendingWork()
      if (generation !== _navigationGeneration) return
      navPush({ type:'file', path, folderType: 'general' })
      _currentFile = path
      _boardMode   = false
      _bsvOpen     = false
      _readDraftMode = false
      const focusedProject = await Tree.focusForPath?.(path)
      await setTrackedProject(focusedProject?.folder_type === 'novel' ? focusedProject.path : '')
      if (generation !== _navigationGeneration) return
      Tree.setWorkspaceSection?.('manuscript')
      // clear all toolbar toggle states
      document.getElementById('board-btn').classList.remove('active')
      document.getElementById('brainstorm-btn')?.classList.remove('active')
      document.getElementById('read-btn').classList.remove('active')
      document.getElementById('split-btn').classList.remove('active')
      localStorage.setItem('quill_last', path)
      showView('editor')
      updateToolbarContext('editor')
      let folderType = 'general'
      try {
        folderType = await Editor.openFile(path) || 'general'
      } catch(e) {
        console.error('Editor.openFile error:', e)
      }
      if (generation !== _navigationGeneration) return
      Toolbar.setKind(focusedProject?.folder_type || folderType)
      setToolbarLocation(path, document.getElementById('entry-title')?.value || undefined)
      document.getElementById('footer-path').textContent = '~/' + path
      Tree.setActive(path)
      if (typeof Sprint !== 'undefined') Sprint.setFolderType(folderType)
      const snapBtn = document.getElementById('snapshot-btn')
      if (snapBtn) snapBtn.style.display = ''
      updateConceptArtBtn()
      const htop = _navHistory[_navHistory.length - 1]
      if (htop && htop.path === path) htop.folderType = folderType
      document.getElementById('scene-outline').classList.toggle('open', _outlineOpen)
      document.getElementById('outline-btn').classList.toggle('active', _outlineOpen)
      await loadOutline()
    } finally {
      Editor.unfreeze?.()
    }
  }

  // Scrivenings — every scene in this chapter as one document. Writing back is guarded by
  // scrivenings.mjs, which refuses rather than guessing when boundaries stop making sense.
  async function openChapter(folderPath) {
    if (!folderPath) return
    Settings.warmGrammar()
    await flushPendingWork()
    Editor.stopTimeTracking?.()
    const focusedProject = await Tree.focusForPath?.(folderPath)
    await setTrackedProject(focusedProject?.folder_type === 'novel' ? focusedProject.path : '')
    _currentFile   = null
    _boardMode     = false
    _bsvOpen       = false
    _readDraftMode = false
    showView('chapter')
    const opened = await Chapter.open(folderPath)
    if (opened) Tree.setActive?.(folderPath)
  }

  async function openFolder(folderPath, folderType) {
    const generation = ++_navigationGeneration
    Editor.cancelPendingOpen?.()
    await flushPendingWork()
    Editor.stopTimeTracking?.()
    if (generation !== _navigationGeneration) return
    navPush({ type:'folder', path: folderPath, folderType: folderType || 'general' })
    _currentFile       = null
    _currentFolder     = folderPath
    _currentFolderType = folderType || 'general'
    _boardMode         = false
    _bsvOpen           = false
    _readDraftMode     = false
    const focusedProject = await Tree.focusForPath?.(folderPath)
    await setTrackedProject(focusedProject?.folder_type === 'novel' ? focusedProject.path : '')
    if (generation !== _navigationGeneration) return
    if (focusedProject?.folder_type === 'novel') {
      if (folderPath === focusedProject.path) Tree.setWorkspaceSection?.('overview')
      else if (folderPath.toLowerCase().includes('/world bible')) Tree.setWorkspaceSection?.('worldbible')
      else Tree.setWorkspaceSection?.('manuscript')
    }
    setToolbarLocation(folderPath)
    // clear all toolbar toggle states
    document.getElementById('board-btn').classList.remove('active')
    document.getElementById('brainstorm-btn')?.classList.remove('active')
    document.getElementById('read-btn').classList.remove('active')
    document.getElementById('split-btn').classList.remove('active')
    // close split panel
    const sp = document.getElementById('split-panel')
    if (sp) sp.classList.remove('open')
    const sd = document.getElementById('split-divider')
    if (sd) sd.style.display = 'none'
    _splitOpen = false
    const snapBtn = document.getElementById('snapshot-btn')
    if (snapBtn) snapBtn.style.display = 'none'
    updateConceptArtBtn()
    // update toolbar context for scratch/journal/novel-specific button states
    updateToolbarContext(folderType || 'general')
    Toolbar.setKind(focusedProject?.folder_type || folderType)
    Tree.setActive(null)
    // Style Lab has its own view, not a landing page
    if ((folderType || '') === 'stylelab' && !folderPath.includes('/')) {
      showView('stylelab')
      try { await StyleLab.open() } catch(e) { console.error('StyleLab.open error:', e) }
      document.getElementById('footer-path').textContent = '~/' + folderPath
      return
    }
    showView('landing')
    try {
      await Landing.open(folderPath, folderType)
    } catch(e) {
      console.error('Landing.open error:', e)
    }
    document.getElementById('footer-path').textContent = '~/' + folderPath
    if (typeof Sprint !== 'undefined') Sprint.setFolderType(folderType || 'general')
  }

  // In a novel, a new scene gets a corkboard card so the board and outliner stay in step.
  async function addBoardCard(folder, title) {
    try {
      const board = await window.quill.getBoard(folder).catch(() => ({ cards:[] }))
      const cards = board.cards || []
      const exists = cards.some(c => (c.title||'').toLowerCase().trim() === title.toLowerCase().trim())
      if (!exists) {
        cards.push({ id: Math.random().toString(36).slice(2,10), title, body:'', tone:'quiet', image:null })
        await window.quill.saveBoard({ folderRel: folder, cards })
      }
    } catch {}
  }

  async function newFile(options = {}) {
    await flushPendingWork()
    if (options.project) {
      const insideProject = _currentFolder === options.project || _currentFolder.startsWith(options.project + '/')
      if (!insideProject || _currentFolderType !== options.folderType) setCurrentFolder(options.project, options.folderType)
    }
    if (options.folder !== undefined) setCurrentFolder(options.folder, options.folderType)
    const isNovel = _currentFolderType === 'novel' || _currentFolderType === 'act'
    let title = ''
    if (isNovel) {
      const project = options.project || _currentFolder.split('/')[0]
      const currentParent = options.project && _currentFile?.startsWith(project + '/')
        ? _currentFile.slice(0, _currentFile.lastIndexOf('/')) : _currentFolder
      const choice = await Tree.askManuscriptName({ project, parent:currentParent, kind:'scene' })
      if (choice === null) return
      title = choice.name
      setCurrentFolder(choice.parent, 'novel')
    }
    const result = await window.quill.newFile({ folder: _currentFolder, title, folder_type: _currentFolderType })
    if (isNovel) await addBoardCard(_currentFolder, result.title || result.path.split('/').pop().replace(/\.md$/, ''))
    await Tree.refresh()
    await openFile(result.path)
    if (options.prompt) {
      window.QuillEditor.insertPlainText(options.prompt + '\n\n')
      await Editor.save()
    }
    if (_currentFolderType === 'journal') window.QuillEditor.focus()
    else document.getElementById('entry-title').focus()
  }

  function setCurrentFolder(f, ft) { _currentFolder = f; if (ft) _currentFolderType = ft }
  function getCurrentFile()    { return _currentFile }

  // After main renames a folder, point everything still holding a path inside it at the new one.
  function followRename(from, to) {
    _currentFile = rebasePath(_currentFile, from, to)
    try {
      const last = localStorage.getItem('quill_last')
      if (last) localStorage.setItem('quill_last', rebasePath(last, from, to))
    } catch {}
    Editor.followRename(from, to)
  }
  function getCurrentFolder() { return _currentFolder }

  async function openNovelWorkspace(projectPath, destination) {
    await openFolder(projectPath, 'novel')
    const labels = {
      overview:'Overview', outliner:'Outliner', timeline:'Timeline', audit:'Manuscript Audit', outline:'Structure', case:'Case', characters:'Characters', novelboard:'Board',
      read:'Read Draft', freewrite:'Scene Generator', scraps:'Scraps', brainstorm:'Brainstorm', concept:'Concept Art',
      styleguide:'Style Guide',
    }

    if (destination === 'brainstorm') await toggleBrainstorm()
    else if (destination === 'concept') await openConceptArt()
    else Landing.activateNovelTab?.(destination)

    Tree.setWorkspaceSection?.(destination)
    setToolbarLocation(`${projectPath}/${labels[destination] || destination}`)
  }

  async function setManuscriptFont(font) {
    const novelPath = await findNovelRoot()
    if (!novelPath) return
    await window.quill.saveFolderMeta({ rel: novelPath, data: { manuscript_font: font } })
  }

  // ── UI toggles ────────────────────────────────────────────
  function toggleSidebar() {
    _sidebarOpen = !_sidebarOpen
    document.getElementById('sidebar').classList.toggle('hidden', !_sidebarOpen)
    try { localStorage.setItem('quill_sidebar_open', _sidebarOpen ? '1' : '0') } catch {}
  }

  function toggleFocus() {
    _focusMode = !_focusMode
    document.body.classList.toggle('focus', _focusMode)
    if (_focusMode) {
      document.getElementById('sidebar').classList.add('hidden')
      _sidebarOpen = false
    }
  }

  // There is one Board: the novel's. From a scene or chapter it opens filtered to that chapter.
  async function toggleBoard() {
    if (!_currentFile && !_currentFolder) return
    await flushPendingWork()
    const chapter = _currentFile
      ? _currentFile.split('/').slice(0, -1).join('/')
      : (_currentFolderType === 'act' ? '' : _currentFolder)
    await openBoard(chapter)
  }

  async function openBoard(chapterPath = '') {
    const novel = (chapterPath || _currentFile || _currentFolder || '').split('/')[0]
    if (!novel) return
    Board.setFilter(novel, chapterPath.includes('/') ? chapterPath : '')
    await openNovelWorkspace(novel, 'novelboard')
  }

  // ── delete modal (soft — moves to trash) ─────────────────
  let _delPath = null, _delType = null, _delResolve = null
  function showDeleteModal(path, type, message) {
    _delResolve?.(false)
    _delPath = path; _delType = type; _delResolve = null
    document.getElementById('delete-msg').textContent = message || (type === 'folder'
      ? 'The folder and everything inside it will be moved to Trash. You can restore it any time.'
      : 'The file will be moved to Trash. You can restore it any time.')
    document.getElementById('delete-modal').classList.add('show')
  }
  // The same modal for callers that act after the file is gone (the corkboard drops its card).
  // Resolves true once the file is in Trash, false if the writer backs out.
  function confirmTrash(path, { message } = {}) {
    showDeleteModal(path, 'file', message)
    return new Promise(resolve => { _delResolve = resolve })
  }
  function closeDeleteModal() {
    document.getElementById('delete-modal').classList.remove('show')
    _delResolve?.(false)
    _delResolve = null
  }
  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('delete-cancel').onclick  = () => closeDeleteModal()
    document.getElementById('delete-confirm').onclick = async () => {
      document.getElementById('delete-modal').classList.remove('show')
      const resolve = _delResolve
      _delResolve = null
      if (!_delPath) { resolve?.(false); return }
      try {
        await flushPendingWork()
        await window.quill.delete(_delPath)
      } catch (error) {
        alert('Couldn’t move to Trash: ' + error.message)
        resolve?.(false)
        return
      }
      if (_delPath === _currentFile) { _currentFile = null; showView('empty') }
      await Tree.refresh()
      _delPath = null
      resolve?.(true)
    }
    document.getElementById('delete-modal').addEventListener('click', e => {
      if (e.target.id === 'delete-modal') closeDeleteModal()
    })

    // ── trash modal ──────────────────────────────────────────
    document.getElementById('trash-modal').addEventListener('click', e => {
      if (e.target.id === 'trash-modal') document.getElementById('trash-modal').classList.remove('show')
    })
    document.getElementById('trash-close-btn').onclick = () => document.getElementById('trash-modal').classList.remove('show')
    document.getElementById('trash-empty-btn').onclick = async () => {
      if (!confirm('Permanently delete everything in Trash? This cannot be undone.')) return
      await window.quill.emptyTrash()
      renderTrashList([])
    }

    // ── snapshot modal ───────────────────────────────────────
    document.getElementById('snapshot-modal').addEventListener('click', e => {
      if (e.target.id === 'snapshot-modal') document.getElementById('snapshot-modal').classList.remove('show')
    })
    document.getElementById('snapshot-close-btn').onclick = () => document.getElementById('snapshot-modal').classList.remove('show')
    document.getElementById('snapshot-save-btn').onclick = async () => {
      if (!_currentFile) return
      await flushPendingWork()
      const nameInput = document.getElementById('snapshot-name-input')
      const name = nameInput.value.trim()
      const result = await window.quill.saveSnapshot({ rel: _currentFile, name })
      if (result.ok) {
        nameInput.value = ''
        document.getElementById('snapshot-save-btn').textContent = 'Saved ✓'
        setTimeout(() => { document.getElementById('snapshot-save-btn').textContent = 'Save Snapshot' }, 1800)
        await refreshSnapshotList()
      }
    }
    // snapshot restore confirm modal
    document.getElementById('snapshot-restore-modal').addEventListener('click', e => {
      if (e.target.id === 'snapshot-restore-modal') document.getElementById('snapshot-restore-modal').classList.remove('show')
    })
    document.getElementById('snapshot-restore-cancel').onclick = () => {
      document.getElementById('snapshot-restore-modal').classList.remove('show')
    }
  })

  function closeAnyModal() {
    document.querySelectorAll('.overlay.show').forEach(o => o.classList.remove('show'))
  }

  // ── Toolbar context class ──────────────────────────────────
  function updateToolbarContext(contextType) {
    const tb = document.getElementById('toolbar')
    if (!tb) return
    // remove old ctx- classes
    tb.className = tb.className.replace(/\bctx-\w+/g, '').trim()
    if (contextType) tb.classList.add('ctx-' + contextType)
  }

  // ── Global full-text search ───────────────────────────────
  let _searchTimer = null
  let _searchScope = 'project'  // 'project' or 'all'
  let _searchGeneration = 0
  let _searchQuery = ''
  let _searchProjectPath = ''
  let _searchResults = []
  let _searchTotal = 0
  let _searchHasMore = false
  let _replaceMode = false
  let _replaceSelection = new Set()
  let _replaceBusy = false

  function currentSearchProjectPath() {
    if (_searchScope !== 'project') return ''
    if (_currentFile) return _currentFile.split('/')[0]
    if (_currentFolder) return _currentFolder.split('/')[0]
    return ''
  }

  function updateSearchReplaceAvailability() {
    const input = document.getElementById('global-replace-input')
    const button = document.getElementById('search-review-replace-btn')
    const saveButton = document.getElementById('search-save-btn')
    const available = _searchScope === 'project' && Boolean(currentSearchProjectPath())
    if (input) input.disabled = !available || _replaceBusy
    if (button) button.disabled = !available || _replaceBusy
    if (saveButton) saveButton.disabled = !available || _replaceBusy
    if (!available && input) input.placeholder = _searchScope === 'all'
      ? 'Replace is limited to one project'
      : 'Open a project to replace'
    else if (input) input.placeholder = 'Replacement text (blank deletes)'
  }

  function setReplaceBusy(busy) {
    _replaceBusy = Boolean(busy)
    updateSearchReplaceAvailability()
    const apply = document.getElementById('search-replace-apply')
    if (apply) apply.disabled = _replaceBusy || _replaceSelection.size === 0
  }

  function initGlobalSearch() {
    const input    = document.getElementById('global-search-input')
    const backBtn  = document.getElementById('search-back-btn')
    const replaceInput = document.getElementById('global-replace-input')
    const replaceButton = document.getElementById('search-review-replace-btn')
    const saveButton = document.getElementById('search-save-btn')
    if (!input || !backBtn) return

    backBtn.onclick = () => {
      if (_currentFile) showView('editor')
      else if (_currentFolder) showView('landing')
      else showView('empty')
    }

    input.addEventListener('input', () => {
      cancelReplaceReview()
      clearTimeout(_searchTimer)
      _searchTimer = setTimeout(() => runGlobalSearch(input.value.trim()), 300)
    })
    input.addEventListener('keydown', e => {
      if (e.key === 'Escape') backBtn.click()
    })

    // scope toggle buttons
    document.querySelectorAll('.search-scope').forEach(btn => {
      btn.onclick = () => {
        document.querySelectorAll('.search-scope').forEach(b => b.classList.remove('active'))
        btn.classList.add('active')
        _searchScope = btn.dataset.scope
        cancelReplaceReview()
        updateSearchReplaceAvailability()
        if (input.value.trim()) runGlobalSearch(input.value.trim())
      }
    })
    replaceButton?.addEventListener('click', beginReplaceReview)
    saveButton?.addEventListener('click', saveCurrentProjectSearch)
    replaceInput?.addEventListener('keydown', event => {
      if (event.key === 'Enter') { event.preventDefault(); beginReplaceReview() }
      if (event.key === 'Escape' && _replaceMode) cancelReplaceReview()
    })
    replaceInput?.addEventListener('input', () => {
      if (_replaceMode) renderGlobalSearch(_searchQuery)
    })
    updateSearchReplaceAvailability()
  }

  async function openGlobalSearch() {
    await flushPendingWork()
    showView('search')
    updateSearchReplaceAvailability()
    setTimeout(() => {
      const input = document.getElementById('global-search-input')
      if (input) { input.focus(); input.select() }
    }, 60)
  }

  async function openSavedSearch(projectPath, query, name = '') {
    if (!projectPath || !query) return
    const currentProject = (_currentFile || _currentFolder || '').split('/')[0]
    if (currentProject !== projectPath) {
      _currentFile = null
      _currentFolder = projectPath
      _currentFolderType = 'novel'
    }
    _searchScope = 'project'
    document.querySelectorAll('.search-scope').forEach(button =>
      button.classList.toggle('active', button.dataset.scope === 'project'))
    const input = document.getElementById('global-search-input')
    if (input) input.value = query
    await openGlobalSearch()
    await runGlobalSearch(query)
    if (name) setToolbarLocation(`${projectPath}/Collections/${name}`)
  }

  async function openCollection(projectPath, id, name = '') {
    if (!projectPath || !id) return
    await flushPendingWork()
    navPush({ type:'collection', path:`${projectPath}::${id}`, projectPath, id, name })
    _currentFile = null
    _currentFolder = projectPath
    _currentFolderType = 'novel'
    _currentCollection = { projectPath, id, name }
    await Tree.focusForPath?.(projectPath)
    Tree.setWorkspaceSection?.(`static-collection-${id}`)
    showView('collection')
    updateToolbarContext('landing')
    setToolbarLocation(`${projectPath}/Collections/${name || 'Collection'}`)
    await renderCollection()
  }

  async function renderCollection() {
    if (!_currentCollection) return
    const { projectPath, id, name } = _currentCollection
    const title = document.getElementById('collection-title')
    const count = document.getElementById('collection-count')
    const list = document.getElementById('collection-list')
    if (title) title.textContent = name || 'Collection'
    if (list) list.innerHTML = '<div class="collection-empty">Loading…</div>'
    const result = await window.quill.getProjectCollection({ projectPath, id })
      .catch(err => ({ ok: false, error: err.message }))
    if (!result?.ok) {
      if (list) list.innerHTML = `<div class="collection-empty">${esc(result?.error || 'Collection unavailable.')}</div>`
      return
    }
    _currentCollection.name = result.collection.name
    if (title) title.textContent = result.collection.name
    if (count) count.textContent = `${result.scenes.length} scene${result.scenes.length === 1 ? '' : 's'}`
      + (result.missing ? ` · ${result.missing} missing` : '')
    if (!result.scenes.length) {
      list.innerHTML = '<div class="collection-empty">No scenes yet. Command-click scenes in the binder, then choose Add to collection.</div>'
      return
    }
    list.innerHTML = ''
    for (const scene of result.scenes) {
      const row = document.createElement('div')
      row.className = 'collection-scene-row'
      row.innerHTML = `
        <div>
          <div class="collection-scene-title">${esc(scene.title || 'Untitled')}</div>
          <div class="collection-scene-path">${esc(scene.path)}</div>
        </div>
        <span class="collection-scene-wc">${Number(scene.word_count || 0).toLocaleString()} words</span>
        <button class="collection-scene-remove" title="Remove from collection">×</button>`
      row.onclick = event => {
        if (!event.target.closest('.collection-scene-remove')) openFile(scene.path)
      }
      row.querySelector('.collection-scene-remove').onclick = async event => {
        event.stopPropagation()
        const removed = await window.quill.removeScenesFromCollection({
          projectPath, id, sceneIds: [scene.scene_id],
        }).catch(() => ({ ok: false }))
        if (removed.ok) {
          await Tree.refresh()
          await renderCollection()
        }
      }
      list.appendChild(row)
    }
  }

  async function saveCurrentProjectSearch() {
    const projectPath = currentSearchProjectPath()
    const query = document.getElementById('global-search-input')?.value.trim() || ''
    if (!projectPath || query.length < 2) {
      setSearchReplaceStatus('Open a project and search before saving.', true)
      return
    }
    const name = await requestName({
      title: 'Save search',
      message: `Save “${query}” as a live collection.`,
      value: query,
      confirmLabel: 'Save search',
    })
    if (name === null) return
    if (!name.trim()) {
      setSearchReplaceStatus('Give the saved search a name.', true)
      return
    }
    const result = await window.quill.saveProjectSearch({ projectPath, name, query })
      .catch(err => ({ ok: false, error: err.message }))
    if (!result?.ok) {
      setSearchReplaceStatus(result?.error || 'Could not save this search.', true)
      return
    }
    await Tree.refresh()
    setSearchReplaceStatus(`Saved “${result.search.name}” under Collections.`)
  }

  function searchMatchKey(match) {
    return [match.source, match.filePath || match.folderPath, match.itemId ?? match.itemIndex,
      match.field, match.matchStart, match.matchEnd, match.targetHash].join('|')
  }

  function setSearchReplaceStatus(message = '', isError = false) {
    const status = document.getElementById('search-replace-status')
    if (!status) return
    status.textContent = message
    status.classList.toggle('error', isError)
  }

  function requestName({ title = 'Name', message = '', value = '', confirmLabel = 'Save' } = {}) {
    const modal = document.getElementById('name-prompt-modal')
    const input = document.getElementById('name-prompt-input')
    const titleEl = document.getElementById('name-prompt-title')
    const messageEl = document.getElementById('name-prompt-message')
    const cancel = document.getElementById('name-prompt-cancel')
    const confirmButton = document.getElementById('name-prompt-confirm')
    if (!modal || !input || !titleEl || !messageEl || !cancel || !confirmButton) {
      return Promise.resolve(null)
    }

    titleEl.textContent = title
    messageEl.textContent = message
    messageEl.style.display = message ? '' : 'none'
    input.value = value
    confirmButton.textContent = confirmLabel
    modal.classList.add('show')

    return new Promise(resolve => {
      let settled = false
      const finish = result => {
        if (settled) return
        settled = true
        modal.classList.remove('show')
        modal.onclick = null
        cancel.onclick = null
        confirmButton.onclick = null
        input.onkeydown = null
        resolve(result)
      }
      const accept = () => finish(input.value.trim())
      cancel.onclick = () => finish(null)
      confirmButton.onclick = accept
      modal.onclick = event => { if (event.target === modal) finish(null) }
      input.onkeydown = event => {
        if (event.key === 'Enter') { event.preventDefault(); accept() }
        if (event.key === 'Escape') { event.preventDefault(); finish(null) }
      }
      requestAnimationFrame(() => { input.focus(); input.select() })
    })
  }

  function cancelReplaceReview() {
    const wasActive = _replaceMode || _replaceSelection.size > 0
    _replaceMode = false
    _replaceSelection.clear()
    setSearchReplaceStatus('')
    if (wasActive && _searchQuery) renderGlobalSearch(_searchQuery)
  }

  async function beginReplaceReview() {
    const query = document.getElementById('global-search-input')?.value.trim() || ''
    const projectPath = currentSearchProjectPath()
    if (!projectPath) {
      setSearchReplaceStatus('Replace works within one open project.', true)
      return
    }
    if (query.length < 2) {
      setSearchReplaceStatus('Search for at least 2 characters first.', true)
      return
    }

    setReplaceBusy(true)
    setSearchReplaceStatus('Loading exact replacement previews…')
    const generation = ++_searchGeneration
    const all = []
    let offset = 0
    let total = 0
    try {
      await flushPendingWork()
      do {
        const response = await window.quill.searchProject({ projectPath, query, offset, limit: 500 })
        const page = Array.isArray(response) ? response : (response.results || [])
        all.push(...page)
        total = Array.isArray(response) ? all.length : (response.total || 0)
        offset += page.length
        if (!page.length || Array.isArray(response) || !response.hasMore) break
      } while (offset < total)

      if (generation !== _searchGeneration) return
      if (!all.length) {
        setSearchReplaceStatus('No matches to replace.', true)
        return
      }
      _searchQuery = query
      _searchProjectPath = projectPath
      _searchResults = all
      _searchTotal = total
      _searchHasMore = false
      _replaceMode = true
      _replaceSelection = new Set(all.map(searchMatchKey))
      setSearchReplaceStatus('Review each change below before applying.')
      renderGlobalSearch(query)
    } catch (error) {
      console.error('Could not load replacement previews:', error)
      if (generation === _searchGeneration) {
        setSearchReplaceStatus(error?.message || 'Could not load replacement previews.', true)
      }
    } finally {
      setReplaceBusy(false)
    }
  }

  async function commitProjectReplace() {
    if (_replaceBusy) return
    const chosen = _searchResults.filter(match => _replaceSelection.has(searchMatchKey(match)))
    if (!chosen.length) {
      setSearchReplaceStatus('Select at least one match.', true)
      return
    }
    const replacement = document.getElementById('global-replace-input')?.value || ''
    if (!confirm(`Replace ${chosen.length} selected match${chosen.length === 1 ? '' : 'es'} in this project?\n\nQuill will back up every affected file first.`)) return

    setReplaceBusy(true)
    setSearchReplaceStatus('Validating and backing up…')
    let result
    try {
      await flushPendingWork()
      result = await window.quill.replaceProject({
        projectPath: _searchProjectPath,
        query: _searchQuery,
        replacement,
        matches: chosen,
      })
    } catch (error) {
      result = { ok: false, error: error?.message || 'Nothing was changed.' }
    } finally {
      setReplaceBusy(false)
    }

    if (!result?.ok) {
      setSearchReplaceStatus(result?.error || 'Nothing was changed.', true)
      return
    }

    let refreshError = null
    try {
      if (_currentFile && (result.changedPaths || []).includes(_currentFile)) {
        await Editor.openFile(_currentFile)
        await loadOutline()
      }
      // The landing page holds its folder's meta in memory and saves all of it back on the next
      // edit, which would undo a replacement in that .quill_meta. Reload it from disk.
      if (!_currentFile && _currentFolder) await Landing.open(_currentFolder, _currentFolderType)
      await Tree.refresh()
      _replaceMode = false
      _replaceSelection.clear()
      await runGlobalSearch(_searchQuery)
    } catch (error) {
      refreshError = error
      console.error('Replacement succeeded, but the view did not fully refresh:', error)
    }
    const backup = result.backupPath ? ` Backup: ${result.backupPath}` : ''
    const refreshNote = refreshError ? ' The replacement succeeded, but restart Quill to refresh the view.' : ''
    setSearchReplaceStatus(`Replaced ${result.replacements} match${result.replacements === 1 ? '' : 'es'} in ${result.filesChanged} file${result.filesChanged === 1 ? '' : 's'}.${backup}${refreshNote}`, Boolean(refreshError))
  }

  const CHAR_FIELD_LABELS = {
    name:'Name', desc:'Description', appearance:'Appearance', want:'Want', need:'Need',
    fear:'Fear', arc:'Arc', desire_profile:'Desire profile', backstory:'Backstory',
    wound:'Wound', lie:'Lie', truth:'Truth', voice:'Voice', relationships:'Relationships',
    key_scenes:'Key scenes', notes:'Notes',
  }

  const FOLDER_FIELD_LABELS = {
    chapter_goal:'Chapter goal', chapter_setting:'Setting', emotional_arc:'Emotional arc',
    opens_with:'Opens with', ends_with:'Ends with', pov_character:'POV character', pov:'POV',
    writing_guide:'Writing guide', ea_consent_spectrum:'Consent spectrum',
    ea_magic_during_intimacy:'Magic during intimacy', ea_claiming_and_marking:'Claiming and marking',
    ea_erotic_vocabulary:'Erotic vocabulary',
  }
  const humanizeField = field => {
    const text = String(field || '').replace(/_/g, ' ')
    return text.charAt(0).toUpperCase() + text.slice(1)
  }

  function searchSourceLabel(match) {
    const labels = {
      title: 'Title',
      body: `Manuscript · Line ${match.lineNumber}`,
      synopsis: 'Synopsis',
      purpose: 'Scene purpose',
      notes: `Notes · Line ${match.lineNumber}`,
      beat: `Beat ${(match.itemIndex ?? 0) + 1}${match.field === 'note' ? ' · Note' : ''}`,
      frontmatter: humanizeField(match.field),
      folder: FOLDER_FIELD_LABELS[match.field] || humanizeField(match.field),
      structure: `Structure beat · ${humanizeField(match.field)}`,
      corkboard: match.field === 'title' ? 'Corkboard · Card title' : 'Corkboard card',
      character: `Character · ${CHAR_FIELD_LABELS[match.field] || match.field}`,
      scrap: match.field === 'note' ? 'Scrap · Note' : 'Scrap',
    }
    return labels[match.source] || 'Match'
  }

  async function openGlobalSearchResult(match) {
    if (match.source === 'scrap' && match.folderPath) {
      await openNovelWorkspace(match.folderPath, 'scraps')
      if (match.itemId) setTimeout(() => Scraps.openNote(match.itemId), 150)
      return
    }
    if (match.source === 'character' && match.folderPath) {
      await openFolder(match.folderPath, match.folderType || 'novel')
      Landing.activateNovelTab?.('characters')
      if (match.itemIndex != null) Landing.openCharSheet?.(Number(match.itemIndex))
      return
    }
    if (match.source === 'corkboard' && match.folderPath) {
      await openFolder(match.folderPath, match.folderType || 'novel')
      await toggleBoard()
      return
    }
    if ((match.source === 'folder' || match.source === 'structure') && match.folderPath) {
      await openFolder(match.folderPath, match.folderType || 'novel')
      if (match.source === 'structure') Landing.activateNovelTab?.('outline')
      return
    }
    if (match.filePath) {
      await openFile(match.filePath)
      if (match.source === 'beat') toggleOutline(true)
      if (['synopsis', 'purpose', 'notes', 'frontmatter'].includes(match.source)) Editor.toggleInspector(true)
      return
    }
    if (match.folderPath) {
      await openFolder(match.folderPath, match.folderType || 'novel')
      await toggleBoard()
    }
  }

  function updateReplaceReviewCount() {
    const count = document.getElementById('search-replace-review-count')
    const apply = document.getElementById('search-replace-apply')
    const selected = _replaceSelection.size
    if (count) count.textContent = `${selected} of ${_searchResults.length} selected`
    if (apply) {
      apply.textContent = `Replace ${selected}`
      apply.disabled = selected === 0 || _replaceBusy
    }
  }

  function renderGlobalSearch(query) {
    const list    = document.getElementById('search-results-list')
    const countEl = document.getElementById('search-result-count')
    const loaded = _searchResults.length
    countEl.textContent = _searchHasMore
      ? `${loaded} of ${_searchTotal} matches`
      : `${_searchTotal} match${_searchTotal === 1 ? '' : 'es'}`

    if (!loaded) {
      list.innerHTML = '<div class="search-empty">No matches found.</div>'
      return
    }

    // Group scene fields together; independent corkboard cards group under their board.
    const byFile = {}
    _searchResults.forEach(r => {
      const group = r.source === 'scrap' ? 'scraps' : r.source === 'corkboard' ? 'board' : r.source
      const key = r.filePath
        || `${group}:${r.folderPath}${r.source === 'character' ? `:${r.itemId ?? r.itemIndex}` : ''}`
      if (!byFile[key]) byFile[key] = { title: r.fileTitle, matches: [] }
      byFile[key].matches.push(r)
    })

    list.innerHTML = ''
    if (_replaceMode) {
      const review = document.createElement('div')
      review.className = 'search-replace-review'
      review.innerHTML = `
        <span class="search-replace-review-count" id="search-replace-review-count"></span>
        <button class="btn sm" id="search-replace-all">Select all</button>
        <button class="btn sm" id="search-replace-none">Select none</button>
        <button class="btn sm" id="search-replace-cancel">Cancel</button>
        <button class="btn sm primary" id="search-replace-apply"></button>`
      list.appendChild(review)
      review.querySelector('#search-replace-all').onclick = () => {
        _replaceSelection = new Set(_searchResults.map(searchMatchKey))
        renderGlobalSearch(query)
      }
      review.querySelector('#search-replace-none').onclick = () => {
        _replaceSelection.clear()
        renderGlobalSearch(query)
      }
      review.querySelector('#search-replace-cancel').onclick = cancelReplaceReview
      review.querySelector('#search-replace-apply').onclick = commitProjectReplace
    }
    Object.entries(byFile).forEach(([filePath, group]) => {
      const section = document.createElement('div')
      section.className = 'search-file-group'
      section.innerHTML = `<div class="search-file-title">${esc(group.title)}</div>`

      group.matches.forEach(m => {
        const row = document.createElement('div')
        row.className = 'search-result-row'
        if (_replaceMode) {
          const key = searchMatchKey(m)
          const selected = _replaceSelection.has(key)
          const column = Math.max(0, Number(m.lineMatchStart) || 0)
          const beforeLine = String(m.matchLine || '')
          const afterLine = beforeLine.slice(0, column)
            + (document.getElementById('global-replace-input')?.value || '')
            + beforeLine.slice(column + String(m.matchedText || '').length)
          const exactBefore = esc(beforeLine.slice(0, column))
            + `<mark>${esc(m.matchedText)}</mark>`
            + esc(beforeLine.slice(column + String(m.matchedText || '').length))
          row.classList.add('replace-preview')
          row.classList.toggle('unselected', !selected)
          row.innerHTML = `
            <input type="checkbox" ${selected ? 'checked' : ''} aria-label="Select replacement">
            <div>
              <div class="search-result-line">${esc(searchSourceLabel(m))}</div>
              <div class="search-result-context">${exactBefore}</div>
              <div class="search-replacement-after">${esc(afterLine)}</div>
            </div>`
          const toggle = event => {
            if (event) event.stopPropagation()
            if (_replaceSelection.has(key)) _replaceSelection.delete(key)
            else _replaceSelection.add(key)
            row.querySelector('input').checked = _replaceSelection.has(key)
            row.classList.toggle('unselected', !_replaceSelection.has(key))
            updateReplaceReviewCount()
          }
          row.onclick = toggle
          row.querySelector('input').onclick = toggle
        } else {
          // Highlight matches without mutating the text being displayed.
          const highlighted = esc(m.context).replace(
            new RegExp('(' + esc(query).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi'),
            '<mark>$1</mark>'
          )
          row.innerHTML = `
            <div class="search-result-line">${esc(searchSourceLabel(m))}</div>
            <div class="search-result-context">${highlighted}</div>`
          row.onclick = () => openGlobalSearchResult(m)
        }
        section.appendChild(row)
      })
      list.appendChild(section)
    })

    if (_searchHasMore && !_replaceMode) {
      const more = document.createElement('button')
      more.className = 'search-load-more'
      more.textContent = `Load more (${_searchTotal - loaded} remaining)`
      more.onclick = () => runGlobalSearch(query, true)
      list.appendChild(more)
    }
    if (_replaceMode) updateReplaceReviewCount()
  }

  async function runGlobalSearch(query, append = false) {
    const list    = document.getElementById('search-results-list')
    const countEl = document.getElementById('search-result-count')
    if (!query || query.length < 2) {
      _searchGeneration++
      _searchResults = []
      _searchTotal = 0
      _searchHasMore = false
      list.innerHTML = '<div class="search-empty">Type at least 2 characters to search.</div>'
      countEl.textContent = ''
      return
    }

    let projectPath = _searchProjectPath
    if (!append || query !== _searchQuery) {
      projectPath = currentSearchProjectPath()
      _searchQuery = query
      _searchProjectPath = projectPath
      _searchResults = []
      _searchTotal = 0
      _searchHasMore = false
    }

    const generation = ++_searchGeneration
    if (!append) list.innerHTML = '<div class="search-empty">Searching…</div>'
    const response = await window.quill.searchProject({
      projectPath,
      query,
      offset: append ? _searchResults.length : 0,
      limit: 100,
    }).catch(() => ({ results: [], total: 0, hasMore: false }))
    if (generation !== _searchGeneration) return

    // Array fallback keeps a freshly reloaded renderer compatible with an older main process.
    const page = Array.isArray(response) ? response : (response.results || [])
    _searchResults = append ? _searchResults.concat(page) : page
    _searchTotal = Array.isArray(response) ? page.length : (response.total || 0)
    _searchHasMore = Array.isArray(response) ? false : Boolean(response.hasMore)
    renderGlobalSearch(query)
  }

  // ── Backups ───────────────────────────────────────────────
  function openBackupChoice(project) {
    _backupProject = project
    _backupChoiceBusy = false
    document.getElementById('backup-choice-project').textContent = `“${project.name}”`
    document.getElementById('backup-choice-status').textContent = ''
    document.getElementById('backup-choice-status').classList.remove('error')
    document.getElementById('backup-choice-local').disabled = false
    document.getElementById('backup-choice-cloud').disabled = false
    document.getElementById('backup-choice-close').disabled = false
    document.getElementById('backup-choice-modal').classList.add('show')
  }

  function closeBackupChoice() {
    if (_backupChoiceBusy) return
    document.getElementById('backup-choice-modal')?.classList.remove('show')
    _backupProject = null
  }

  function setBackupChoiceBusy(busy, message = '', error = false) {
    _backupChoiceBusy = busy
    const status = document.getElementById('backup-choice-status')
    status.textContent = message
    status.classList.toggle('error', error)
    document.getElementById('backup-choice-local').disabled = busy
    document.getElementById('backup-choice-cloud').disabled = busy
    document.getElementById('backup-choice-close').disabled = busy
  }

  async function backupProjectLocally() {
    const project = _backupProject
    if (!project || _backupChoiceBusy) return
    setBackupChoiceBusy(true, 'Preparing project backup…')
    await flushPendingWork()
    const result = await window.quill.backupProject({
      projectPath:project.path, projectName:project.name,
    }).catch(error => ({ ok:false, error:error.message }))
    if (result?.canceled) return setBackupChoiceBusy(false, '')
    setBackupChoiceBusy(false, result?.ok ? 'Local project ZIP saved.' : (result?.error || 'Local backup failed.'), !result?.ok)
  }

  async function backupLibraryToCloud() {
    if (_backupChoiceBusy) return
    setBackupChoiceBusy(true, 'Checking your cloud backup folder…')
    await flushPendingWork()
    let config = await window.quill.getCloudBackupSettings().catch(error => ({ error:error.message }))
    if (!config?.configured || !config?.folderAvailable) {
      config = await window.quill.chooseCloudBackupFolder().catch(error => ({ ok:false, error:error.message }))
      if (config?.canceled) return setBackupChoiceBusy(false, '')
      if (!config?.ok) return setBackupChoiceBusy(false, config?.error || 'Could not use that cloud folder.', true)
    }
    setBackupChoiceBusy(true, 'Creating and verifying the complete library backup…')
    const result = await window.quill.backupCloudLibrary().catch(error => ({ ok:false, error:error.message }))
    setBackupChoiceBusy(false, result?.ok ? `Cloud library backup saved: ${result.lastBackupFile}` : (result?.error || 'Cloud backup failed.'), !result?.ok)
    renderDashboardBackupHealth(result)
  }

  function backupAgeInDays(value) {
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return Infinity
    const today = new Date()
    const todayKey = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())
    const dateKey = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())
    return Math.max(0, Math.round((todayKey - dateKey) / 86400000))
  }

  function renderDashboardBackupHealth(status) {
    const button = document.getElementById('dash-backup-health')
    const title = document.getElementById('dash-backup-title')
    const detail = document.getElementById('dash-backup-detail')
    if (!button || !title || !detail || !status) return
    let state = 'warn'
    let heading = 'Cloud backup not set up'
    let explanation = 'Choose an iCloud Drive folder'
    if (status.error && !status.configured) {
      state = 'danger'; heading = 'Backup status unavailable'; explanation = status.error
    } else if (!status.configured) {
      state = 'warn'; heading = 'Cloud backup not set up'; explanation = 'Choose an iCloud Drive folder'
    } else if (!status.folderAvailable) {
      state = 'danger'; heading = 'Backup folder unavailable'; explanation = 'Choose the iCloud folder again'
    } else if (status.lastError) {
      state = 'danger'; heading = 'Last backup failed'; explanation = status.lastError
    } else if (!status.lastBackupAt || !status.lastBackupFile) {
      state = 'warn'; heading = 'No cloud backup yet'; explanation = 'Create your first library backup'
    } else if (status.lastBackupCloudOnly) {
      const days = backupAgeInDays(status.lastBackupAt)
      state = days <= 1 ? 'good' : days <= 3 ? 'warn' : 'danger'
      heading = days === 0 ? 'Backup stored in iCloud'
        : days === 1 ? 'iCloud backup from yesterday' : `iCloud backup · ${days} days old`
      explanation = 'Verified before upload · iCloud manages the local download'
    } else if (status.lastVerificationError || !status.lastBackupAvailable) {
      state = 'danger'; heading = 'Backup needs attention'
      explanation = status.lastVerificationError || 'The newest archive is missing'
    } else {
      const days = backupAgeInDays(status.lastBackupAt)
      if (days === 0) {
        state = 'good'; heading = 'Backup created today'
      } else if (days === 1) {
        state = 'good'; heading = 'Backup created yesterday'
      } else if (days <= 3) {
        state = 'warn'; heading = `Last backup ${days} days ago`
      } else {
        state = 'danger'; heading = `Backup overdue · ${days} days`
      }
      const checked = status.lastVerifiedAt ? 'Integrity checked' : 'Integrity check pending'
      explanation = status.automatic ? `${checked} · iCloud handles upload` : `${checked} · automatic backups off`
      // The iPad has no automatic backups; what matters is how much changed since the last ZIP.
      if (status.web) {
        const changes = status.changesSinceExport || 0
        explanation = changes ? `${changes} change${changes === 1 ? '' : 's'} since · tap to back up` : 'Nothing changed since'
        if (changes && state === 'good' && days > 0) state = 'warn'
      }
    }
    button.className = `dash-backup-health ${state}`
    title.textContent = heading
    detail.textContent = explanation
    button.title = `${heading}. ${explanation}. Open Backup settings.`
  }

  async function refreshDashboardBackupHealth() {
    const button = document.getElementById('dash-backup-health')
    if (button) button.className = 'dash-backup-health checking'
    const status = await window.quill.checkCloudBackupHealth().catch(error => ({ error:error.message }))
    renderDashboardBackupHealth(status)
    return status
  }

  function archiveSize(bytes) {
    if (!Number.isFinite(Number(bytes)) || Number(bytes) <= 0) return '0 bytes'
    const units = ['bytes', 'KB', 'MB', 'GB']
    const unit = Math.min(Math.floor(Math.log(Number(bytes)) / Math.log(1024)), units.length - 1)
    const value = Number(bytes) / (1024 ** unit)
    return `${value.toFixed(unit ? 1 : 0)} ${units[unit]}`
  }

  async function chooseArchiveToRestore() {
    await flushPendingWork()
    const result = await window.quill.chooseRestoreArchive().catch(error => ({ ok:false, error:error.message }))
    if (result?.canceled) return
    _archiveRestore = result?.ok ? result : null
    _archiveRestoreBusy = false
    const modal = document.getElementById('archive-restore-modal')
    const content = document.getElementById('archive-restore-content')
    const status = document.getElementById('archive-restore-status')
    modal.classList.add('show')
    status.classList.toggle('error', !result?.ok)
    status.textContent = result?.ok ? 'Archive verified. Nothing has been changed yet.' : (result?.error || 'This backup could not be inspected.')
    content.hidden = !result?.ok
    document.getElementById('archive-restore-project-btn').hidden = !result?.ok
    document.getElementById('archive-restore-library-btn').hidden = !result?.ok || result.type !== 'library'
    document.getElementById('archive-merge-btn').hidden = !result?.ok || result.type !== 'library'
    document.getElementById('archive-merge-btn').disabled = false
    ;['archive-restore-project-btn', 'archive-restore-library-btn', 'archive-merge-btn'].forEach(id => { document.getElementById(id).style.display = '' })
    document.getElementById('archive-restore-choice').hidden = !result?.ok || result.type !== 'library'
    document.getElementById('archive-restore-copies').hidden = true
    document.getElementById('archive-restore-close').textContent = 'Cancel'
    document.getElementById('archive-restore-close').disabled = false
    if (!result?.ok) {
      document.getElementById('archive-restore-summary').textContent = 'Quill could not verify that ZIP as a safe backup.'
      return
    }
    document.getElementById('archive-restore-summary').textContent = `${result.archiveName} · ${archiveSize(result.archiveBytes)} · ${result.projects.length} project${result.projects.length === 1 ? '' : 's'}`
    const select = document.getElementById('archive-restore-project')
    select.innerHTML = result.projects.map(project =>
      `<option value="${encodeURIComponent(project.id)}">${esc(project.name)}${project.type !== 'general' ? ` · ${esc(project.type)}` : ''}</option>`).join('')
    renderArchiveRestoreProject()
  }

  function renderArchiveRestoreProject() {
    if (!_archiveRestore) return
    const id = decodeURIComponent(document.getElementById('archive-restore-project').value || '')
    const project = _archiveRestore.projects.find(item => item.id === id) || _archiveRestore.projects[0]
    if (!project) return
    const extras = [project.hasTimeline ? 'timeline' : '', project.hasScraps ? 'scraps' : '',
      project.artwork ? `${project.artwork} artwork file${project.artwork === 1 ? '' : 's'}` : ''].filter(Boolean)
    document.getElementById('archive-restore-details').textContent = `${project.files} file${project.files === 1 ? '' : 's'}${extras.length ? ` · ${extras.join(' · ')}` : ''}`
    document.getElementById('archive-restore-project-btn').textContent = `Restore “${project.name}”`
  }

  function closeArchiveRestore() {
    if (_archiveRestoreBusy) return
    if (_archiveMerged) { window.location.reload(); return }
    document.getElementById('archive-restore-modal')?.classList.remove('show')
    _archiveRestore = null
  }

  async function restoreInspectedArchive(scope) {
    if (!_archiveRestore || _archiveRestoreBusy) return
    const selected = decodeURIComponent(document.getElementById('archive-restore-project').value || '')
    const project = _archiveRestore.projects.find(item => item.id === selected)
    const label = scope === 'library' ? 'your complete Quill library' : `the current “${project?.name || 'project'}” project`
    if (!confirm(`Replace ${label} with this verified backup? Quill will save a safety ZIP of the current library first.`)) return
    _archiveRestoreBusy = true
    const status = document.getElementById('archive-restore-status')
    status.classList.remove('error')
    status.textContent = 'Creating a safety backup, then restoring…'
    document.getElementById('archive-restore-close').disabled = true
    document.getElementById('archive-restore-project-btn').disabled = true
    document.getElementById('archive-restore-library-btn').disabled = true
    const result = await window.quill.restoreBackupArchive({
      token:_archiveRestore.token, scope, projectId:project?.id || '',
    }).catch(error => ({ ok:false, error:error.message }))
    if (!result?.ok) {
      _archiveRestoreBusy = false
      status.classList.add('error')
      status.textContent = result?.error || 'Restore failed. Your current library was not replaced.'
      document.getElementById('archive-restore-close').disabled = false
      document.getElementById('archive-restore-project-btn').disabled = false
      document.getElementById('archive-restore-library-btn').disabled = false
      return
    }
    status.textContent = `${scope === 'library' ? 'Library' : `“${result.project}”`} restored. Safety backup: ${result.safetyArchive}. Reloading Quill…`
    setTimeout(() => window.location.reload(), 1400)
  }

  // Bring In Changes: merge a library backup from the other device (main.js merge-backup-archive).
  async function mergeInspectedArchive() {
    if (!_archiveRestore || _archiveRestoreBusy) return
    _archiveRestoreBusy = true
    const status = document.getElementById('archive-restore-status')
    const buttons = ['archive-restore-close', 'archive-restore-project-btn', 'archive-restore-library-btn', 'archive-merge-btn']
    status.classList.remove('error')
    status.textContent = 'Comparing the backup with this library…'
    buttons.forEach(id => { document.getElementById(id).disabled = true })
    const result = await window.quill.mergeBackupArchive({ token:_archiveRestore.token }).catch(error => ({ ok:false, error:error.message }))
    _archiveRestoreBusy = false
    if (!result?.ok) {
      status.classList.add('error')
      status.textContent = result?.error || 'The merge failed. Nothing in your library was changed.'
      buttons.forEach(id => { document.getElementById(id).disabled = false })
      return
    }
    const s = result.summary
    const n = (count, one, many = `${one}s`) => `${count} ${count === 1 ? one : many}`
    const from = result.remoteName || 'the other device'
    const parts = [
      s.taken.length + s.restored.length ? `${n(s.taken.length + s.restored.length, 'file')} brought in from the ${from}` : '',
      s.combined.length ? `${n(s.combined.length, 'settings file')} combined` : '',
      s.trashed.length ? `${n(s.trashed.length, 'file')} deleted there moved to Trash` : '',
    ].filter(Boolean)
    status.textContent = parts.length || s.copies.length
      ? `${parts.join(' · ') || 'Merged'}.${s.copies.length ? ` ${n(s.copies.length, 'scene was', 'scenes were')} edited on both, so both versions are kept:` : ''}`
      : `Already up to date: nothing on the ${from} is newer than this library.`
    const copies = document.getElementById('archive-restore-copies')
    copies.innerHTML = s.copies.map(c => `<li>${esc(c.rel.replace(/\.md$/, ''))} <span class="muted">and</span> ${esc(c.as.split('/').pop().replace(/\.md$/, ''))}</li>`).join('')
    copies.hidden = !s.copies.length
    document.getElementById('archive-restore-content').hidden = true
    // .btn sets display, which beats the hidden attribute.
    ;['archive-restore-project-btn', 'archive-restore-library-btn', 'archive-merge-btn'].forEach(id => { document.getElementById(id).style.display = 'none' })
    const close = document.getElementById('archive-restore-close')
    close.textContent = 'Done'
    close.disabled = false
    _archiveMerged = (s.taken.length + s.restored.length + s.combined.length + s.trashed.length + s.copies.length) > 0
  }

  // ── Recovery Center ───────────────────────────────────────
  async function openRecoveryCenter() {
    await flushPendingWork()
    const modal = document.getElementById('recovery-modal')
    const list = document.getElementById('recovery-list')
    modal.classList.add('show')
    list.innerHTML = '<div class="recovery-empty">Loading backups…</div>'
    document.getElementById('recovery-restore-btn').disabled = true
    _recoverySelected = null
    _recoverySelectedFile = ''
    _recoveryItems = await window.quill.listRecoveryItems().catch(() => [])
    renderRecoveryList()
  }

  function closeRecoveryCenter() {
    document.getElementById('recovery-modal')?.classList.remove('show')
  }

  function recoveryItemLabel(item) {
    if (item.kind === 'snapshot') return item.name || 'Scene snapshot'
    if (item.kind === 'timeline-snapshot') return 'Timeline snapshot'
    if (item.backupType === 'replace') return item.query
      ? `Replace “${item.query}” → “${item.replacement || ''}”`
      : 'Project replacement backup'
    return item.reason || 'Before an earlier restore'
  }

  function recoveryItemKey(item) {
    if (item.kind === 'snapshot') return `snapshot|${item.rel}|${item.filename}`
    if (item.kind === 'timeline-snapshot') return `timeline|${item.projectPath}|${item.filename}`
    return `project|${item.projectPath}|${item.backupType}|${item.backupId}`
  }

  function renderRecoveryList() {
    const list = document.getElementById('recovery-list')
    if (!list) return
    const filter = document.getElementById('recovery-filter')?.value || 'all'
    const visible = _recoveryItems.filter(item => filter === 'all' || item.kind === filter)
    if (!visible.length) {
      list.innerHTML = '<div class="recovery-empty">No backups in this category yet.</div>'
      document.getElementById('recovery-preview-content').hidden = true
      document.getElementById('recovery-preview-empty').hidden = false
      document.getElementById('recovery-restore-btn').disabled = true
      return
    }
    const selectedKey = _recoverySelected ? recoveryItemKey(_recoverySelected) : ''
    list.innerHTML = visible.map(item => {
      const index = _recoveryItems.indexOf(item)
      const date = item.createdAt && !Number.isNaN(new Date(item.createdAt).getTime())
        ? new Date(item.createdAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
        : 'Date unavailable'
      const detail = item.kind === 'snapshot' ? `${item.title} · ${item.project}`
        : item.kind === 'timeline-snapshot' ? `Story timeline · ${item.project}`
        : `${item.project} · ${item.files} file${item.files === 1 ? '' : 's'}`
      return `<button class="recovery-item${recoveryItemKey(item) === selectedKey ? ' active' : ''}" data-index="${index}">
        <div class="recovery-item-title">${esc(recoveryItemLabel(item))}</div>
        <div class="recovery-item-detail">${esc(detail)}</div>
        <div class="recovery-item-detail">${esc(date)}</div>
      </button>`
    }).join('')
    list.querySelectorAll('.recovery-item').forEach(button => {
      button.onclick = () => selectRecoveryItem(_recoveryItems[Number(button.dataset.index)])
    })
    if (!_recoverySelected || !visible.some(item => recoveryItemKey(item) === selectedKey)) {
      selectRecoveryItem(visible[0])
    }
  }

  async function selectRecoveryItem(item) {
    if (!item) return
    _recoverySelected = item
    _recoverySelectedFile = ''
    document.querySelectorAll('.recovery-item').forEach(button => {
      const candidate = _recoveryItems[Number(button.dataset.index)]
      button.classList.toggle('active', candidate && recoveryItemKey(candidate) === recoveryItemKey(item))
    })
    await loadRecoveryPreview()
  }

  function renderRecoveryComparison(backupText, currentText) {
    const backupPane = document.getElementById('recovery-backup-text')
    const currentPane = document.getElementById('recovery-current-text')
    backupPane.replaceChildren()
    currentPane.replaceChildren()
    const rows = window.QuillRecoveryDiff.rows(backupText, currentText)
    const backupFragment = document.createDocumentFragment()
    const currentFragment = document.createDocumentFragment()
    rows.forEach((row, index) => {
      const backupLine = document.createElement('span')
      backupLine.className = `recovery-diff-line ${row.beforeType}`
      backupLine.dataset.line = String(index + 1)
      backupLine.textContent = row.before
      backupFragment.appendChild(backupLine)
      const currentLine = document.createElement('span')
      currentLine.className = `recovery-diff-line ${row.afterType}`
      currentLine.dataset.line = String(index + 1)
      currentLine.textContent = row.after
      currentFragment.appendChild(currentLine)
    })
    backupPane.appendChild(backupFragment)
    currentPane.appendChild(currentFragment)
  }

  async function loadRecoveryPreview() {
    const item = _recoverySelected
    if (!item) return
    const empty = document.getElementById('recovery-preview-empty')
    const content = document.getElementById('recovery-preview-content')
    const restore = document.getElementById('recovery-restore-btn')
    empty.hidden = false
    empty.textContent = 'Loading preview…'
    content.hidden = true
    restore.disabled = true
    const args = { ...item }
    if (_recoverySelectedFile) args.file = _recoverySelectedFile
    const preview = await window.quill.getRecoveryPreview(args)
      .catch(error => ({ ok: false, error: error.message }))
    if (!preview?.ok) {
      empty.textContent = preview?.error || 'This backup could not be previewed.'
      return
    }
    if (!_recoverySelectedFile) _recoverySelectedFile = preview.file || ''
    const select = document.getElementById('recovery-file-select')
    const files = preview.files || [preview.file]
    select.innerHTML = files.filter(Boolean).map(file =>
      `<option value="${encodeURIComponent(file)}"${file === _recoverySelectedFile ? ' selected' : ''}>${esc(file)}</option>`).join('')
    select.hidden = item.kind === 'snapshot' || item.kind === 'timeline-snapshot' || files.length < 2
    document.getElementById('recovery-preview-title').textContent = recoveryItemLabel(item)
    document.getElementById('recovery-preview-meta').textContent = item.kind === 'timeline-snapshot'
      ? `${preview.backup.events || 0} backup events / ${preview.current.events || 0} current events`
      : `${preview.file || item.rel} · ${preview.backup.words || 0} backup words / ${preview.current.words || 0} current words`
    renderRecoveryComparison(preview.backup.text, preview.current.text)
    const status = document.getElementById('recovery-status')
    status.textContent = preview.backup.truncated || preview.current.truncated ? 'Preview shortened; restore still uses the complete file.' : ''
    status.classList.remove('error')
    empty.hidden = true
    content.hidden = false
    restore.disabled = false
  }

  async function restoreSelectedRecovery() {
    const item = _recoverySelected
    if (!item) return
    const message = item.kind === 'snapshot'
      ? `Restore this snapshot of “${item.title}”? Quill will snapshot the current scene first.`
      : item.kind === 'timeline-snapshot'
        ? `Restore this version of the ${item.project} timeline? Quill will snapshot the current timeline first.`
        : `Restore all ${item.files} file${item.files === 1 ? '' : 's'} from this backup? Quill will back up their current state first.`
    if (!confirm(message)) return
    const restore = document.getElementById('recovery-restore-btn')
    const status = document.getElementById('recovery-status')
    restore.disabled = true
    status.classList.remove('error')
    status.textContent = 'Creating a safety backup and restoring…'
    await flushPendingWork()
    const result = item.kind === 'snapshot'
      ? await window.quill.restoreSnapshot({ rel: item.rel, filename: item.filename, backupName: 'Before Recovery Center restore' })
      : item.kind === 'timeline-snapshot'
        ? await window.quill.restoreTimelineSnapshot(item)
        : await window.quill.restoreRecoveryBackup(item)
    if (!result?.ok) {
      status.textContent = result?.error || 'Restore failed. Nothing was changed.'
      status.classList.add('error')
      restore.disabled = false
      return
    }
    const changed = item.kind === 'snapshot' ? [item.rel] : (result.changedPaths || [])
    if (_currentFile && changed.includes(_currentFile)) {
      await Editor.openFile(_currentFile)
      await loadOutline()
    }
    // An open chapter still holds the old text and baselines; its next autosave would write
    // them straight back over the restore.
    const chapterPath = Chapter.currentPath?.()
    if (chapterPath && changed.some(rel => rel.startsWith(chapterPath + '/'))) await Chapter.open(chapterPath)
    await Tree.refresh()
    if (item.kind === 'timeline-snapshot') await openNovelWorkspace(item.projectPath, 'timeline')
    status.textContent = `Restored ${item.kind === 'snapshot' ? 'the scene' : item.kind === 'timeline-snapshot' ? 'the timeline' : `${result.filesRestored} file${result.filesRestored === 1 ? '' : 's'}`}. A safety backup was saved first.`
    _recoveryItems = await window.quill.listRecoveryItems().catch(() => _recoveryItems)
    renderRecoveryList()
  }

  // ── Trash modal ───────────────────────────────────────────
  async function openTrashModal() {
    document.getElementById('trash-modal').classList.add('show')
    const items = await window.quill.getTrash().catch(() => [])
    renderTrashList(items)
  }

  function renderTrashList(items) {
    const list = document.getElementById('trash-list')
    if (!items.length) {
      list.innerHTML = '<div style="color:var(--muted);font-size:12.5px;padding:12px 0">Trash is empty.</div>'
      return
    }
    list.innerHTML = items.map(item => {
      const date = new Date(item.trashedAt).toLocaleDateString('en-US', { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' })
      const name = item.originalRel.split('/').pop()
      return `<div class="trash-row" data-trash="${esc(item.trashName)}">
        <div class="trash-row-info">
          <div class="trash-row-name">${esc(name)}</div>
          <div class="trash-row-path">${esc(item.originalRel)} · ${date}</div>
        </div>
        <div class="trash-row-actions">
          <button class="btn trash-restore" style="font-size:11px;height:24px;padding:0 10px">Restore</button>
          <button class="btn primary danger trash-perm-del" style="font-size:11px;height:24px;padding:0 10px">Delete</button>
        </div>
      </div>`
    }).join('')
    list.querySelectorAll('.trash-restore').forEach(btn => {
      btn.onclick = async () => {
        const trashName = btn.closest('.trash-row').dataset.trash
        await window.quill.restoreTrash(trashName)
        await Tree.refresh()
        const updated = await window.quill.getTrash().catch(() => [])
        renderTrashList(updated)
      }
    })
    list.querySelectorAll('.trash-perm-del').forEach(btn => {
      btn.onclick = async () => {
        const trashName = btn.closest('.trash-row').dataset.trash
        await window.quill.deleteFromTrash(trashName)
        const updated = await window.quill.getTrash().catch(() => [])
        renderTrashList(updated)
      }
    })
  }

  // ── Snapshot modal ────────────────────────────────────────
  async function openSnapshotModal() {
    if (!_currentFile) return
    document.getElementById('snapshot-modal').classList.add('show')
    await refreshSnapshotList()
  }

  async function refreshSnapshotList() {
    if (!_currentFile) return
    const snaps = await window.quill.getSnapshots(_currentFile).catch(() => [])
    const list  = document.getElementById('snapshot-list')
    if (!snaps.length) {
      list.innerHTML = '<div style="color:var(--muted);font-size:12.5px;padding:4px 0">No snapshots yet. Save one below.</div>'
      return
    }
    list.innerHTML = snaps.map((s, i) => `
      <div class="snap-row">
        <div style="flex:1;min-width:0">
          ${s.name ? `<div class="snap-name">${esc(s.name)}</div>` : ''}
          <div class="snap-label">${esc(s.label)}${i === 0 ? ' <span class="snap-badge">latest</span>' : ''}</div>
        </div>
        <div style="display:flex;gap:4px;flex-shrink:0">
          <button class="btn snap-restore-btn" data-filename="${esc(s.filename)}" style="font-size:11px;height:24px;padding:0 10px">Restore</button>
          <button class="btn snap-delete-btn" data-filename="${esc(s.filename)}" style="font-size:11px;height:24px;padding:0 6px;color:var(--muted)" title="Delete snapshot">✕</button>
        </div>
      </div>`).join('')
    list.querySelectorAll('.snap-restore-btn').forEach(btn => {
      btn.onclick = () => {
        const filename = btn.dataset.filename
        // show restore confirm modal
        const restoreModal = document.getElementById('snapshot-restore-modal')
        const nameInput = document.getElementById('snapshot-restore-name')
        nameInput.value = ''
        restoreModal.classList.add('show')
        nameInput.focus()
        document.getElementById('snapshot-restore-confirm').onclick = async () => {
          const backupName = nameInput.value.trim()
          await flushPendingWork()
          const result = await window.quill.restoreSnapshot({ rel: _currentFile, filename, backupName })
          if (result.ok) {
            restoreModal.classList.remove('show')
            document.getElementById('snapshot-modal').classList.remove('show')
            await Editor.openFile(_currentFile)
          }
        }
      }
    })
    list.querySelectorAll('.snap-delete-btn').forEach(btn => {
      btn.onclick = async () => {
        const filename = btn.dataset.filename
        const row = btn.closest('.snap-row')
        row.style.opacity = '0.4'
        await window.quill.deleteSnapshot({ rel: _currentFile, filename })
        await refreshSnapshotList()
      }
    })
  }

  async function openTagSearch(tag) {
    showView('tags')
    document.getElementById('tag-results-title').textContent = '#' + tag
    document.getElementById('tag-results-count').textContent = ''
    document.getElementById('tag-results-list').innerHTML = '<div style="padding:20px;color:var(--muted);font-size:13px">Loading…</div>'

    const results = await window.quill.searchByTag(tag).catch(() => [])
    document.getElementById('tag-results-count').textContent = results.length + ' ' + (results.length===1?'entry':'entries')
    const list = document.getElementById('tag-results-list')
    list.innerHTML = ''
    if (!results.length) {
      list.innerHTML = '<div style="padding:20px;color:var(--muted);font-size:13px">No entries found.</div>'
      return
    }
    results.forEach(entry => {
      const row = document.createElement('div')
      row.className = 'tag-result-row'
      const tags = (entry.tags||[]).map(t => `<span class="tag-result-chip">${t}</span>`).join('')
      const mood = entry.mood ? `<span style="margin-left:4px">${entry.mood.split(' ')[0]}</span>` : ''
      row.innerHTML = `
        <div class="tag-result-title">${entry.title||'Untitled'}${mood}</div>
        <div class="tag-result-date">${fmtDate(entry.date)}</div>
        <div class="tag-result-preview">${entry.preview||''}</div>
        <div class="tag-result-tags">${tags}</div>`
      row.onclick = () => openFile(entry.path)
      list.appendChild(row)
    })
  }

  function fmtDate(s) {
    if (!s) return ''
    const d = new Date(s.replace(' ','T'))
    return isNaN(d) ? s : d.toLocaleDateString('en-US',{weekday:'short',year:'numeric',month:'short',day:'numeric'})
  }

  async function openCommentSearch(filterType) {
    showView('comment-search')
    const projectName = (_currentFile || _currentFolder || '').split('/')[0] || ''
    document.getElementById('comment-search-title').textContent =
      projectName ? `Comments — ${projectName}` : 'All Comments'

    // wire filter buttons
    document.querySelectorAll('.cs-filter').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.type === filterType)
      btn.onclick = () => {
        document.querySelectorAll('.cs-filter').forEach(b => b.classList.remove('active'))
        btn.classList.add('active')
        renderCommentResults(allComments, btn.dataset.type)
      }
    })

    document.getElementById('comment-search-list').innerHTML =
      '<div style="padding:20px;color:var(--muted);font-size:13px">Loading…</div>'

    const projectPath = (_currentFile || _currentFolder || '').split('/')[0] || undefined
    const allComments = await window.quill.getAllComments({ projectPath }).catch(() => [])
    document.getElementById('comment-search-count').textContent =
      allComments.length + ' total'
    renderCommentResults(allComments, filterType)
  }

  function renderCommentResults(allComments, filterType) {
    const TYPE_COLORS = {
      revisit:'#f59e0b', rewrite:'#3b82f6', research:'#8b5cf6', cut:'#ef4444', note:'#10b981'
    }
    const filtered = filterType === 'all' ? allComments : allComments.filter(c => c.type === filterType)
    const list = document.getElementById('comment-search-list')
    list.innerHTML = ''

    document.getElementById('comment-search-count').textContent = filtered.length + ' comment' + (filtered.length===1?'':'s')

    if (!filtered.length) {
      list.innerHTML = '<div style="padding:20px;color:var(--muted);font-size:13px;font-style:italic">No comments of this type.</div>'
      return
    }

    // group by file
    const byFile = {}
    filtered.forEach(c => {
      if (!byFile[c.filePath]) byFile[c.filePath] = { title: c.fileTitle, comments: [] }
      byFile[c.filePath].comments.push(c)
    })

    Object.entries(byFile).forEach(([filePath, group]) => {
      const section = document.createElement('div')
      section.className = 'cs-file-section'
      section.innerHTML = `<div class="cs-file-title">${escapeHtml(group.title || filePath)}</div>`

      group.comments.forEach(c => {
        const color = TYPE_COLORS[c.type] || '#888'
        const row = document.createElement('div')
        row.className = 'cs-comment-row'
        row.style.borderLeft = `3px solid ${color}`
        row.innerHTML = `
          <div class="cs-comment-header">
            <span class="cs-comment-type" style="color:${color}">${c.type}</span>
            <span class="cs-comment-date">${c.date||''}</span>
          </div>
          <div class="cs-comment-text">"${escHtml(c.text)}"</div>
          ${c.note ? `<div class="cs-comment-note">${escHtml(c.note)}</div>` : ''}`
        row.onclick = () => openFile(filePath)
        section.appendChild(row)
      })
      list.appendChild(section)
    })
  }

  function escHtml(s) { return escapeHtml(s) }

  // ── Navigation history ────────────────────────────────────
  const _navHistory = []   // file, folder, or collection entries — dashboard is never pushed
  let _navPushing   = false // prevent push during back navigation

  function navPush(entry) {
    if (_navPushing) return
    const top = _navHistory[_navHistory.length - 1]
    if (top && top.type === entry.type && top.path === entry.path) return
    _navHistory.push(entry)
    if (_navHistory.length > 50) _navHistory.shift()
    updateBackBtn()
  }

  function updateBackBtn() {
    const btn = document.getElementById('back-btn')
    if (!btn) return
    const inSubView = typeof Landing !== 'undefined' && Landing.isInSubView && Landing.isInSubView()
    const inConceptArt = typeof ConceptArt !== 'undefined' && ConceptArt.isOpen && ConceptArt.isOpen()
    const disabled  = _navHistory.length === 0 && !inSubView && !inConceptArt
    btn.classList.toggle('back-btn-off', disabled)
  }

  async function goBack() {
    if (typeof Landing !== 'undefined' && Landing.goBack && Landing.goBack()) return



    // if brainstorm or read-draft is overlaying, close it and return to underlying view
    if (_bsvOpen) {
      _bsvOpen = false
      document.getElementById('brainstorm-btn')?.classList.remove('active')
      if (_currentFile) showView('editor')
      else if (_currentFolder) showView('landing')
      else showView('empty')
      updateBackBtn()
      return
    }
    if (_readDraftMode) {
      _readDraftMode = false
      document.getElementById('read-btn').classList.remove('active')
      if (_currentFile) showView('editor')
      else if (_currentFolder) showView('landing')
      else showView('empty')
      updateBackBtn()
      return
    }
    if (typeof ConceptArt !== 'undefined' && ConceptArt.isOpen && ConceptArt.isOpen()) {
      ConceptArt.close()
      document.getElementById('concept-art-btn')?.classList.remove('active')
      if (_currentFile) showView('editor')
      else if (_currentFolder) showView('landing')
      else showView('empty')
      updateBackBtn()
      return
    }

    const btn = document.getElementById('back-btn')
    if (btn?.classList.contains('back-btn-off')) return
    _navHistory.pop()
    if (_navHistory.length === 0) { loadDashboard(); updateBackBtn(); return }
    const prev = _navHistory[_navHistory.length - 1]
    _navPushing = true
    try {
      if (prev.type === 'file')        await openFile(prev.path)
      else if (prev.type === 'folder') await openFolder(prev.path, prev.folderType)
      else if (prev.type === 'collection') await openCollection(prev.projectPath, prev.id, prev.name)
    } finally {
      _navPushing = false
    }
    updateBackBtn()
  }
  let _readDraftMode  = false
  let _readNovelPath  = null

  async function toggleReadDraft() {
    await flushPendingWork()
    // find the novel root for current context
    const novelPath = await findNovelRoot()
    if (!novelPath) return

    // The whole novel has one home, the Read Draft page of the novel; the toolbar view is for
    // the chapter you're in.
    const chapterPath = _currentFile ? _currentFile.split('/').slice(0, -1).join('/') : _currentFolder
    if (!_readDraftMode && (!chapterPath || chapterPath === novelPath || _currentFolderType === 'act' && !_currentFile)) {
      await openNovelWorkspace(novelPath, 'read')
      return
    }

    if (_readDraftMode && _readNovelPath === novelPath) {
      _readDraftMode = false
      document.getElementById('read-btn').classList.remove('active')
      if (_currentFile) showView('editor')
      else if (_currentFolder) showView('landing')
      else showView('empty')
      return
    }

    _readDraftMode = true
    _readNovelPath = novelPath
    document.getElementById('read-btn').classList.add('active')
    document.getElementById('concept-art-btn')?.classList.remove('active')
    showView('read-draft')

    const titleEl   = document.getElementById('read-draft-title')
    const contentEl = document.getElementById('read-draft-content')
    const wcEl      = document.getElementById('read-draft-wc')
    const exportBtn = document.getElementById('read-draft-export')

    // back button
    document.getElementById('read-draft-back').onclick = () => {
      _readDraftMode = false
      document.getElementById('read-btn').classList.remove('active')
      if (_currentFile) showView('editor')
      else if (_currentFolder) showView('landing')
      else showView('empty')
    }

    const meta = await window.quill.getFolderMeta(novelPath).catch(() => ({}))
    if (contentEl) contentEl.innerHTML = '<div class="read-loading">Assembling…</div>'

    const allSections = await window.quill.assembleNovel(novelPath).catch(() => [])
    let sections = allSections
    let readerTitle = (meta.folder_title || novelPath.split('/').pop()) + ' — Draft'
    let contextual = false

    if (_currentFile) {
      const chapterPath = _currentFile.split('/').slice(0, -1).join('/')
      const start = allSections.findIndex(section => section.type === 'chapter' && section.path === chapterPath)
      if (start >= 0) {
        let end = start + 1
        while (end < allSections.length && allSections[end].type === 'scene') end++
        sections = allSections.slice(start, end)
        readerTitle = allSections[start].title
        contextual = true
      }
    } else if (_currentFolder && _currentFolder !== novelPath) {
      const start = allSections.findIndex(section => section.type === 'chapter' && section.path === _currentFolder)
      if (start >= 0) {
        let end = start + 1
        while (end < allSections.length && allSections[end].type === 'scene') end++
        sections = allSections.slice(start, end)
        readerTitle = allSections[start].title
        contextual = true
      }
    }

    if (titleEl) titleEl.textContent = readerTitle
    if (exportBtn) {
      exportBtn.textContent = 'Whole novel →'
      exportBtn.title = 'Read and export the whole novel'
      exportBtn.style.display = ''
      exportBtn.onclick = () => { _readDraftMode = false; document.getElementById('read-btn').classList.remove('active'); openNovelWorkspace(novelPath, 'read') }
    }
    if (contentEl) {
      const startChapter = contextual
        ? allSections.slice(0, allSections.indexOf(sections[0]) + 1).filter(s => s.type === 'chapter').length
        : 1
      const totalWords = await ReadDraft.render(contentEl, {
        sections, meta, scope: contextual ? 'chapter' : 'novel', startChapter, currentFile: _currentFile,
      })
      if (wcEl) wcEl.textContent = totalWords.toLocaleString() + ' words'
    }

  }

  async function findNovelRoot() {
    // collect all ancestor paths from current context, walk up, find novel
    const paths = []
    if (_currentFile) {
      const parts = _currentFile.split('/')
      for (let i = parts.length - 1; i >= 1; i--) paths.push(parts.slice(0, i).join('/'))
    } else if (_currentFolder) {
      const parts = _currentFolder.split('/')
      for (let i = parts.length; i >= 1; i--) paths.push(parts.slice(0, i).join('/'))
    }
    // check each path from closest to root — want the TOPMOST novel type
    // (chapters are stored as 'novel' too, so we want depth=1 novel, not depth=3)
    let novelCandidate = null
    for (const p of paths) {
      try {
        const m = await window.quill.getFolderMeta(p).catch(() => ({}))
        if (m.folder_type === 'novel') novelCandidate = p // keep overwriting — last one is closest to root
      } catch {}
    }
    // novelCandidate at this point is the shallowest 'novel' path = the actual novel root
    // But we want the SHALLOWEST, so we need to reverse: check from root outward
    if (paths.length) {
      const reversed = [...paths].reverse()
      for (const p of reversed) {
        try {
          const m = await window.quill.getFolderMeta(p).catch(() => ({}))
          if (m.folder_type === 'novel') return p  // first match from root = novel root, not chapter
        } catch {}
      }
    }
    return novelCandidate
  }

  // ── Split reference panel (resizable vertical split) ────────
  let _splitOpen   = false
  let _splitActive = 'characters'
  let _splitWidth  = 340  // default panel width in px

  function toggleSplitPanel() {
    _splitOpen = !_splitOpen
    document.getElementById('split-btn').classList.toggle('active', _splitOpen)
    const panel   = document.getElementById('split-panel')
    const divider = document.getElementById('split-divider')
    if (_splitOpen) {
      panel.style.width = _splitWidth + 'px'
      panel.classList.add('open')
      if (divider) divider.style.display = 'flex'
      populateSplitPanel()
    } else {
      panel.classList.remove('open')
      if (divider) divider.style.display = 'none'
    }
  }

  // wire divider drag on init
  function initSplitDivider() {
    const divider = document.getElementById('split-divider')
    if (!divider) return
    let dragging = false, startX = 0, startW = 0
    divider.addEventListener('mousedown', e => {
      e.preventDefault()
      dragging = true
      startX   = e.clientX
      startW   = _splitWidth
      document.body.style.cursor     = 'col-resize'
      document.body.style.userSelect = 'none'
    })
    document.addEventListener('mousemove', e => {
      if (!dragging) return
      const delta = startX - e.clientX   // drag left = bigger panel
      const newW  = Math.max(200, Math.min(700, startW + delta))
      _splitWidth = newW
      try { localStorage.setItem('quill_split_width', String(newW)) } catch {}
      document.getElementById('split-panel').style.width = newW + 'px'
    })
    document.addEventListener('mouseup', () => {
      if (!dragging) return
      dragging = false
      document.body.style.cursor     = ''
      document.body.style.userSelect = ''
    })
  }

  async function populateSplitPanel() {
    const novelPath = await findNovelRoot()
    const tabBar    = document.getElementById('split-panel-tabs')
    const body      = document.getElementById('split-panel-body')
    const closeBtn  = document.getElementById('split-close-btn')

    closeBtn.onclick = () => {
      _splitOpen = false
      document.getElementById('split-btn').classList.remove('active')
      document.getElementById('split-panel').classList.remove('open')
      const dv = document.getElementById('split-divider')
      if (dv) dv.style.display = 'none'
    }

    // Build tabs: Characters + World Bible sections that have cards
    const wbFolders  = novelPath
      ? await window.quill.getWorldBibleFolders(novelPath).catch(() => [])
      : []
    const wbSections = wbFolders.flatMap(wb => wb.sections || [])
      .filter(s => s.cards && s.cards.length > 0)  // only show sections with cards

    // inject tabs (before close button)
    tabBar.querySelectorAll('.split-tab').forEach(t => t.remove())
    const tabs = [
      { id: 'characters', label: 'Characters' },
      ...wbSections.map(s => ({ id: 'wb-' + s.name, label: s.title || s.name, section: s }))
    ]
    const fragment = document.createDocumentFragment()
    tabs.forEach(tab => {
      const btn = document.createElement('button')
      btn.className   = 'chip split-tab' + (tab.id === _splitActive ? ' active' : '')
      btn.dataset.stab = tab.id
      btn.textContent = tab.label
      btn.onclick     = () => {
        _splitActive = tab.id
        tabBar.querySelectorAll('.split-tab').forEach(t => t.classList.toggle('active', t.dataset.stab === tab.id))
        body.querySelectorAll('.split-pane').forEach(p => p.classList.toggle('active', p.dataset.spane === tab.id))
        if (tab.id === 'characters') loadSplitChars(novelPath)
        else if (tab.section) loadSplitWbSection(tab.section)
      }
      fragment.appendChild(btn)
    })
    tabBar.insertBefore(fragment, closeBtn)

    // inject panes
    body.innerHTML = ''
    tabs.forEach(tab => {
      const pane = document.createElement('div')
      pane.className   = 'split-pane' + (tab.id === _splitActive ? ' active' : '')
      pane.dataset.spane = tab.id
      const scroll = document.createElement('div')
      scroll.className = 'split-scroll'
      scroll.id = 'split-pane-' + tab.id.replace(/[^a-z0-9]/g,'_')
      pane.appendChild(scroll)
      body.appendChild(pane)
    })

    // load active pane
    const activeTab = tabs.find(t => t.id === _splitActive) || tabs[0]
    if (!activeTab) return
    if (activeTab.id === 'characters') loadSplitChars(novelPath)
    else if (activeTab.section) loadSplitWbSection(activeTab.section)
  }

  async function loadSplitChars(novelPath) {
    const el = document.getElementById('split-pane-characters')
    if (!el) return
    if (!novelPath) { el.innerHTML = '<div class="split-empty">Open a novel to see characters.</div>'; return }
    const meta  = await window.quill.getFolderMeta(novelPath).catch(() => ({}))
    const chars = meta.characters || []
    if (!chars.length) { el.innerHTML = '<div class="split-empty">No characters defined yet. Add them on the Characters tab.</div>'; return }
    const ids = chars.map(c => c.id).filter(Boolean)
    const images = ids.length ? await window.quill.getCharImagePaths({ novelRel: novelPath, charIds: ids }).catch(() => ({})) : {}
    el.innerHTML = chars.map((c, i) => {
      const roleKey = (c.role||'').toLowerCase().replace(/\s+/g,'-')
      const img = c.id && images[c.id]
      return `<div class="split-char-card" data-charidx="${i}" style="cursor:pointer" title="Open character sheet">
        <div class="split-char-header">
          ${img ? `<div class="split-char-avatar"><img src="../__vfs${esc(img)}" alt="" data-charidx="${i}"></div>` : `<div class="split-char-dot" data-role="${roleKey}"></div>`}
          <div class="split-char-name">${esc(c.name||'Unnamed')}</div>
          <div class="split-char-role">${esc(c.role||'')}</div>
        </div>
        ${c.desc        ? `<div class="split-char-field">${esc(c.desc)}</div>` : ''}
        ${c.appearance  ? `<div class="split-char-field"><span class="split-field-lbl">Appearance</span> ${esc(c.appearance)}</div>` : ''}
        ${c.want        ? `<div class="split-char-field"><span class="split-field-lbl">Want</span> ${esc(c.want)}</div>` : ''}
        ${c.fear        ? `<div class="split-char-field"><span class="split-field-lbl">Fear</span> ${esc(c.fear)}</div>` : ''}
        ${c.arc         ? `<div class="split-char-field"><span class="split-field-lbl">Arc</span> ${esc(c.arc)}</div>` : ''}
        ${c.relationships ? `<div class="split-char-field"><span class="split-field-lbl">Relationships</span> ${esc(c.relationships)}</div>` : ''}
        ${c.notes       ? `<div class="split-char-field split-char-notes">${esc(c.notes)}</div>` : ''}
      </div>`
    }).join('')
    el.querySelectorAll('.split-char-avatar img').forEach(img => QuillPhoto.apply(img, chars[Number(img.dataset.charidx)]?.photo))
    // wire click → open character sheet on novel landing
    el.querySelectorAll('.split-char-card').forEach(card => {
      card.onclick = async () => {
        const idx = parseInt(card.dataset.charidx, 10)
        // Navigate to novel landing and wait for full render
        await openFolder(novelPath, 'novel')
        // Activate the characters tab directly (no click event needed)
        const inner = document.getElementById('landing-inner')
        if (inner) {
          inner.querySelectorAll('.nl-tab').forEach(t => t.classList.remove('active'))
          inner.querySelectorAll('.nl-pane').forEach(p => p.classList.remove('active'))
          const charTab  = inner.querySelector('[data-nltab="characters"]')
          const charPane = inner.querySelector('[data-nlpane="characters"]')
          if (charTab)  charTab.classList.add('active')
          if (charPane) charPane.classList.add('active')
        }
        // Open the specific character sheet
        Landing.openCharSheet(idx)
      }
    })
  }

  async function loadSplitWbSection(section) {
    const safeId = 'split-pane-' + ('wb-' + section.name).replace(/[^a-z0-9]/g,'_')
    const el = document.getElementById(safeId)
    if (!el) return

    const cards = section.cards || []
    if (!cards.length) {
      el.innerHTML = '<div class="split-empty">No entries yet.</div>'
      return
    }

    // Show compact collapsed cards — name + one key field
    el.innerHTML = `
      <div class="split-wb-list">
        ${cards.map(card => {
          const title = card.title || card.name || 'Untitled'
          // pick first non-name, non-notes field with a value for preview
          const previewField = Object.entries(card)
            .find(([k,v]) => !['title','name','notes','date','_body','_path','_file'].includes(k) && v)
          const preview = previewField ? `<span class="split-wb-preview">${esc(String(previewField[1]).slice(0,60))}</span>` : ''
          return `<div class="split-wb-entry split-wb-clickable" data-path="${esc(card._path||'')}">
            <div class="split-wb-name">${esc(title)}</div>
            ${preview}
          </div>`
        }).join('')}
        <div class="split-wb-footer">
          <button class="btn ghost sm split-wb-open-folder">Open ${esc(section.title)} →</button>
        </div>
      </div>`

    el.querySelectorAll('.split-wb-clickable').forEach(row => {
      row.onclick = () => { if (row.dataset.path) App.openFile(row.dataset.path) }
    })
    el.querySelector('.split-wb-open-folder').onclick = () => {
      App.openFolder(section.path, 'worldbible')
    }
  }

  // ── Scene Beats (left strip) ───────────────────────────────
  let _outlineOpen = localStorage.getItem('quill_scene_beats_open') === 'on'
  let _outlineBeats = []    // [{id, title, note, done}]
  let _outlineSaveTimer = null

  function toggleOutline(forceState) {
    _outlineOpen = forceState !== undefined ? forceState : !_outlineOpen
    localStorage.setItem('quill_scene_beats_open', _outlineOpen ? 'on' : 'off')
    document.getElementById('outline-btn').classList.toggle('active', _outlineOpen)
    document.getElementById('scene-outline').classList.toggle('open', _outlineOpen)
    if (_outlineOpen) loadOutline()
  }

  async function loadOutline() {
    if (!_currentFile) {
      renderOutlineBeats([])
      return
    }
    const data = await window.quill.getOutline(_currentFile).catch(() => ({ beats: [] }))
    _outlineBeats = data.beats || []
    renderOutlineBeats(_outlineBeats)
  }

  function saveOutline() {
    if (!_currentFile) return
    clearTimeout(_outlineSaveTimer)
    _outlineSaveTimer = setTimeout(() => {
      _outlineSaveTimer = null
      window.quill.saveOutline({ rel: _currentFile, beats: _outlineBeats, fromPanel: true })
    }, 400)
  }

  async function flushOutline() {
    if (!_outlineSaveTimer || !_currentFile) return
    clearTimeout(_outlineSaveTimer)
    _outlineSaveTimer = null
    await window.quill.saveOutline({ rel: _currentFile, beats: _outlineBeats, fromPanel: true })
  }

  function renderOutlineBeats(beats) {
    const container = document.getElementById('outline-beats')
    if (!container) return
    if (!_currentFile) {
      container.innerHTML = '<div class="outline-empty">Open a scene to outline it.</div>'
      updateOutlineProgress()
      return
    }
    if (!beats.length) {
      container.innerHTML = '<div class="outline-empty">No beats yet. Plan your scene below.</div>'
      updateOutlineProgress()
      return
    }
    container.innerHTML = beats.map((b, i) => `
      <div class="outline-beat${b.done ? ' done' : ''}" data-idx="${i}">
        <span class="dnd-handle" title="Drag to reorder (or Alt+↑/↓)" aria-hidden="true">⠿</span>
        <button class="outline-check${b.done ? ' checked' : ''}" data-idx="${i}" title="${b.done ? 'Unmark' : 'Mark done'}">
          ${b.done
            ? '<svg width="12" height="12" viewBox="0 0 12 12"><path d="M2.5 6l2.5 2.5L9.5 4" stroke="var(--accent)" stroke-width="1.8" fill="none" stroke-linecap="round"/></svg>'
            : ''}
        </button>
        <div class="outline-beat-body">
          <div class="outline-beat-title" contenteditable="true" data-idx="${i}" data-field="title">${esc(b.title || '')}</div>
          <div class="outline-beat-note" contenteditable="true" data-idx="${i}" data-field="note" data-placeholder="emotion, arc note…">${esc(b.note || '')}</div>
        </div>
        <button class="outline-beat-del" data-idx="${i}" title="Remove beat">×</button>
      </div>
    `).join('')

    container.querySelectorAll('.outline-check').forEach(btn => {
      btn.onclick = e => {
        e.stopPropagation()
        const idx = parseInt(btn.dataset.idx, 10)
        _outlineBeats[idx].done = !_outlineBeats[idx].done
        renderOutlineBeats(_outlineBeats)
        saveOutline()
      }
    })
    container.querySelectorAll('.outline-beat-del').forEach(btn => {
      btn.onclick = e => {
        e.stopPropagation()
        const idx = parseInt(btn.dataset.idx, 10)
        _outlineBeats.splice(idx, 1)
        renderOutlineBeats(_outlineBeats)
        saveOutline()
      }
    })
    container.querySelectorAll('[contenteditable]').forEach(el => {
      el.addEventListener('input', () => {
        const idx   = parseInt(el.dataset.idx, 10)
        const field = el.dataset.field
        _outlineBeats[idx][field] = el.textContent.trim()
        saveOutline()
      })
      el.addEventListener('keydown', e => {
        if (e.key === 'Enter') {
          e.preventDefault()
          el.blur()
        }
      })
    })
    Dnd.sortable(container, {
      items: '.outline-beat', type: 'beat', handle: '.dnd-handle',
      onMove: (from, to) => { Dnd.move(_outlineBeats, from, to); renderOutlineBeats(_outlineBeats); saveOutline() },
    })
    updateOutlineProgress()
  }

  function updateOutlineProgress() {
    const total = _outlineBeats.length
    const done  = _outlineBeats.filter(b => b.done).length
    const label = document.getElementById('outline-progress-label')
    const fill  = document.getElementById('outline-progress-fill')
    if (label) label.textContent = `${done} of ${total} beat${total !== 1 ? 's' : ''}`
    if (fill) fill.style.width = total > 0 ? (done / total * 100) + '%' : '0%'
    const copy = document.getElementById('outline-copy-btn')
    const review = document.getElementById('outline-review-btn')
    if (copy) copy.disabled = total === 0
    if (review) review.disabled = total === 0
  }

  function sceneBeatsText() {
    const sceneName = document.getElementById('entry-title')?.value.trim()
      || (_currentFile ? _currentFile.split('/').pop().replace(/\.md$/, '') : 'Untitled scene')
    const lines = _outlineBeats.map((beat, index) => {
      const title = String(beat.title || '').trim() || '(untitled beat)'
      const note = String(beat.note || '').trim()
      return `${index + 1}. [${beat.done ? 'Done' : 'Open'}] ${title}${note ? `\n   ${note}` : ''}`
    })
    return `Scene beats — ${sceneName}\n\n${lines.join('\n')}`
  }

  function addOutlineBeat() {
    if (!_currentFile) return
    _outlineBeats.push({
      id: Date.now().toString(36) + Math.random().toString(36).slice(2,6),
      title: '',
      note: '',
      done: false
    })
    renderOutlineBeats(_outlineBeats)
    saveOutline()
    const container = document.getElementById('outline-beats')
    const allTitles = container.querySelectorAll('.outline-beat-title')
    const last = allTitles[allTitles.length - 1]
    if (last) { last.focus() }
  }

  function initOutline() {
    document.getElementById('outline-btn').onclick = () => toggleOutline()
    document.getElementById('outline-close-btn').onclick = () => toggleOutline(false)
    const addBeat = document.getElementById('outline-add')
    if (addBeat) addBeat.onclick = addOutlineBeat

    const reviewBtn = document.getElementById('outline-review-btn')
    if (reviewBtn) {
      reviewBtn.onclick = () => {
        if (!_outlineBeats.length) return
        const sceneName = _currentFile ? _currentFile.split('/').pop().replace(/\.md$/, '') : 'this scene'
        const beatList = _outlineBeats.map((b, i) => {
          const status = b.done ? '✓' : '○'
          const note = b.note ? ` — ${b.note}` : ''
          return `${status} ${i + 1}. ${b.title || '(untitled)'}${note}`
        }).join('\n')
        const msg = `Here are the scene beats I've outlined for "${sceneName}". Review them as an editorial collaborator — are they well-structured? Is the pacing right? Do they build tension effectively? What's missing? What could be stronger?\n\n${beatList}`
        toggleBrainstorm(msg)
      }
    }

    const copyBtn = document.getElementById('outline-copy-btn')
    if (copyBtn) {
      copyBtn.onclick = async () => {
        if (!_outlineBeats.length) return
        try {
          await navigator.clipboard.writeText(sceneBeatsText())
          copyBtn.textContent = 'Copied!'
          setTimeout(() => { copyBtn.textContent = 'Copy beats' }, 1400)
        } catch {
          copyBtn.textContent = 'Couldn’t copy'
          setTimeout(() => { copyBtn.textContent = 'Copy beats' }, 1800)
        }
      }
    }

    // keyboard shortcut ⌘O — toggle scene beats
    document.addEventListener('keydown', e => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'o') {
        e.preventDefault()
        toggleOutline()
      }
    })

    // keyboard shortcut ⌘⇧I — toggle scene inspector
    document.addEventListener('keydown', e => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key || '').toLowerCase() === 'i') {
        e.preventDefault()
        Editor.toggleInspector()
      }
    })
  }

  // ── Brainstorm toolbar view ───────────────────────────────
  let _bsvOpen        = false
  let _bsvNovelPath   = null
  let _bsvConvo       = null   // current conversation {id,title,date,messages}
  let _bsvHistory     = []
  let _bsvContext     = {}     // cached novel context for instructions tab
  let _bsvMode        = 'novel'  // 'novel' or 'journal'
  let _bsvJournalPath = null

  // Brainstorm's context button (context-drawer.js). Journal mode has no story context.
  let _bsvCtx = null
  function attachBsvContext() {
    const btn = document.getElementById('bsv-ctx-btn')
    if (!btn) return
    btn.hidden = _bsvMode === 'journal' || !_bsvNovelPath
    if (btn.hidden) { _bsvCtx = null; return }
    _bsvCtx = QuillContext.attach(btn, {
      scope: 'brainstorm', novelId: _bsvNovelPath, voiceDefault: false,
      shortcuts: [
        { label: 'All characters',  run: async h => h.add((await h.items()).filter(i => i.kind === 'character').map(i => i.id)) },
        { label: 'All World Bible', run: async h => h.add((await h.items()).filter(i => i.kind === 'world').map(i => i.id)) },
        { label: 'Story beats',     run: async h => { const it = await bsvBeatsItem(); if (it) h.add(it) } },
      ],
      buildPreview: async () => [
        ...(await bsvSystemMessages()),
        ...(_bsvConvo?.messages || []).slice(-13),
        { role: 'user', content: document.getElementById('bsv-input')?.value.trim() || '(your next message)' },
      ],
    })
    migrateBsvCtxMode()
  }

  async function bsvBeatsItem() {
    const ctx = await window.quill.getNovelContext(_bsvNovelPath).catch(() => ({}))
    if (!ctx.beats?.length) return null
    return QuillAIContext.makeItem({ id: 'beats', novelId: _bsvNovelPath, kind: 'note', source: 'reference', title: 'Story beats', text: ctx.beats.join('\n') })
  }

  // The old Context mode select is now drawer chips: pin what it used to send, once.
  async function migrateBsvCtxMode() {
    const mode = localStorage.getItem('quill_bsv_ctx_mode')
    if (!mode || !_bsvCtx) return
    localStorage.removeItem('quill_bsv_ctx_mode')
    if (mode === 'lean') return
    const want = k => mode === 'full' || mode === k
    const items = await _bsvCtx.items()
    await _bsvCtx.add(items.filter(i => (want('chars') && i.kind === 'character') || (want('world') && i.kind === 'world')).map(i => i.id))
    if (want('beats')) { const b = await bsvBeatsItem(); if (b) await _bsvCtx.add(b) }
  }

  // System messages for the next Brainstorm request: role, novel base, chips, voice, style guide.
  async function bsvSystemMessages() {
    if (_bsvMode === 'journal' && _bsvJournalPath) {
      const jctx = await window.quill.getJournalContext(_bsvJournalPath).catch(() => ({}))
      _bsvContext = jctx
      const sys = localStorage.getItem('quill_journal_sys_override') || buildJournalSystemPrompt(jctx)
      const data = buildJournalEntryContext(jctx)
      return [{ role: 'system', content: sys }, ...(data ? [{ role: 'system', content: data }] : [])]
    }
    const ctx = _bsvNovelPath ? await window.quill.getNovelContext(_bsvNovelPath).catch(() => ({})) : {}
    _bsvContext = ctx
    const msgs = [{ role: 'system', content: localStorage.getItem('quill_sys_override') || buildBsvSystemPrompt(ctx) }]
    const base = buildNovelContext(ctx)
    if (base) msgs.push({ role: 'system', content: base })
    if (_bsvCtx) {
      const b = await _bsvCtx.blocks()
      if (b.story) msgs.push({ role: 'system', content: b.story })
      if (b.voice) msgs.push({ role: 'system', content: b.voice })
    }
    // always inject writing guide as its own message, independent of instructions override
    if (_bsvNovelPath) {
      try {
        const wgMeta = await window.quill.getFolderMeta(_bsvNovelPath)
        if (wgMeta && wgMeta.writing_guide) {
          msgs.push({ role:'system', content: 'WRITER\'S STYLE GUIDE (always follow these in all feedback and suggestions):\n' + wgMeta.writing_guide })
        }
      } catch (e) {}
    }
    return msgs
  }

  async function toggleBrainstorm(prefillMessage) {
    await flushPendingWork()
    // disable for scratch projects
    if (_currentFolderType === 'scratch' && !await findNovelRoot()) {
      return
    }

    const novelPath = await findNovelRoot()

    // determine mode: journal if current context is a journal and no novel root
    let journalPath = null
    if (!novelPath && _currentFolderType === 'journal') {
      // find the journal root (top-level journal folder)
      if (_currentFolder) {
        const topFolder = _currentFolder.split('/')[0]
        try {
          const m = await window.quill.getFolderMeta(topFolder).catch(() => ({}))
          if (m.folder_type === 'journal') journalPath = topFolder
        } catch {}
      }
      if (!journalPath) journalPath = _currentFolder
    } else if (!novelPath && _currentFile) {
      // check if the file is inside a journal
      const topFolder = _currentFile.split('/')[0]
      try {
        const m = await window.quill.getFolderMeta(topFolder).catch(() => ({}))
        if (m.folder_type === 'journal') journalPath = topFolder
      } catch {}
    }

    _bsvMode = journalPath ? 'journal' : 'novel'
    _bsvJournalPath = journalPath
    if (_bsvOpen && !prefillMessage) {
      _bsvOpen = false
      document.getElementById('brainstorm-btn')?.classList.remove('active')
      if (_currentFile) showView('editor')
      else if (_currentFolder) showView('landing')
      else showView('empty')
      return
    }
    _bsvOpen      = true
    _bsvNovelPath = novelPath
    document.getElementById('brainstorm-btn')?.classList.add('active')
    document.getElementById('concept-art-btn')?.classList.remove('active')
    showView('brainstorm')
    await initBrainstormView(novelPath, prefillMessage)
  }

  async function initBrainstormView(novelPath, prefillMessage) {
    // close settings panel if it was left open from a previous session
    const settingsPanel = document.getElementById('bsv-api-settings')
    if (settingsPanel) settingsPanel.style.display = 'none'

    // reset instructions textarea so it repopulates for current mode
    const instrTa = document.getElementById('bsv-instructions-ta')
    if (instrTa) { instrTa.value = ''; delete instrTa.dataset.loaded }

    // pre-fetch context so instructions and system prompt are ready immediately
    if (_bsvMode === 'journal' && _bsvJournalPath) {
      _bsvContext = await window.quill.getJournalContext(_bsvJournalPath).catch(() => ({}))
    } else if (novelPath) {
      _bsvContext = await window.quill.getNovelContext(novelPath).catch(() => ({}))
    } else {
      _bsvContext = {}
    }

    attachBsvContext()

    // The model is set once in Settings → AI; the indicator links there.
    const modelIndicator = document.getElementById('bsv-model-name')
    const showModel = () => { if (modelIndicator) modelIndicator.textContent = QuillModels.label(QuillModels.current()) }
    showModel()
    document.addEventListener('quill-models-changed', showModel)

    // gear button toggles settings
    const gearBtn = document.getElementById('bsv-gear-btn')
    if (gearBtn) gearBtn.onclick = () => {
      const s = document.getElementById('bsv-api-settings')
      if (!s) return
      const isOpen = s.style.display !== 'none'
      s.style.display = isOpen ? 'none' : 'block'
      if (!isOpen) {
        // populate instructions textarea when opening
        const ta = document.getElementById('bsv-instructions-ta')
        if (ta && !ta.value) {
          const overrideKey = _bsvMode === 'journal' ? 'quill_journal_sys_override' : 'quill_sys_override'
          const override = localStorage.getItem(overrideKey)
          if (_bsvMode === 'journal') {
            ta.value = override || buildJournalSystemPrompt((_bsvContext)||{})
          } else {
            ta.value = override || buildBsvSystemPrompt((_bsvContext)||{})
          }
        }
      }
    }

    // save instructions button
    document.getElementById('bsv-save-instr')?.addEventListener('click', () => {
      const ta = document.getElementById('bsv-instructions-ta')
      if (!ta) return
      const overrideKey = _bsvMode === 'journal' ? 'quill_journal_sys_override' : 'quill_sys_override'
      localStorage.setItem(overrideKey, ta.value)
      document.getElementById('bsv-api-settings').style.display = 'none'
    })

    // reset instructions button
    document.getElementById('bsv-reset-instr')?.addEventListener('click', async () => {
      const ta = document.getElementById('bsv-instructions-ta')
      if (!ta) return
      const overrideKey = _bsvMode === 'journal' ? 'quill_journal_sys_override' : 'quill_sys_override'
      localStorage.removeItem(overrideKey)
      if (_bsvMode === 'journal') {
        const jctx = _bsvJournalPath ? await window.quill.getJournalContext(_bsvJournalPath).catch(()=>({})) : {}
        ta.value = buildJournalSystemPrompt(jctx)
      } else {
        const ctx = _bsvNovelPath ? await window.quill.getNovelContext(_bsvNovelPath).catch(()=>({})) : {}
        ta.value = buildBsvSystemPrompt(ctx)
      }
      ta.dataset.loaded = '1'
    })

    // back button
    document.getElementById('bsv-back').onclick = () => toggleBrainstorm()

    // load history — use journal path or novel path depending on mode
    const historyPath = _bsvMode === 'journal' ? _bsvJournalPath : novelPath
    _bsvHistory = historyPath
      ? await window.quill.getBrainstormHistory(historyPath).catch(() => [])
      : []
    renderBsvHistory()

    // new conversation button
    document.getElementById('bsv-new-btn').onclick = () => {
      _bsvConvo = null
      document.getElementById('bsv-messages').innerHTML = ''
      document.getElementById('bsv-convo-title').textContent = 'New conversation'
      document.querySelectorAll('.bsv-history-item').forEach(el => el.classList.remove('active'))
      showBsvIntro()
    }

    // send button + keyboard shortcut
    document.getElementById('bsv-send').onclick = () => sendBsvMsg()
    const inp = document.getElementById('bsv-input')
    inp.onkeydown = e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) sendBsvMsg() }

    const reviewChapterBtn = document.getElementById('bsv-review-chapter')
    if (reviewChapterBtn) {
      reviewChapterBtn.style.display = _bsvMode === 'novel' && _currentFile ? '' : 'none'
      reviewChapterBtn.onclick = () => {
        inp.value = '/chapter Review the current chapter as an editorial collaborator. What is working, what feels off, where does the pacing drag, and what would make the emotional and narrative turns stronger?'
        inp.focus()
      }
    }

    // start a new conversation or prefill
    if (!_bsvConvo) {
      document.getElementById('bsv-messages').innerHTML = ''
      document.getElementById('bsv-convo-title').textContent = 'New conversation'
      showBsvIntro()
    }
    if (prefillMessage) {
      inp.value = prefillMessage
      setTimeout(() => inp.focus(), 100)
    }
  }

  function showBsvIntro() {
    const msgs = document.getElementById('bsv-messages')
    if (!msgs) return
    msgs.innerHTML = ''
    const div = document.createElement('div')
    div.className = 'bsv-intro'

    if (_bsvMode === 'journal') {
      div.innerHTML = `
        <div class="bsv-intro-title">Reflect on your journal.</div>
        <div class="bsv-intro-body">
          <p>This AI reads your recent journal entries and can help you:</p>
          <ul>
            <li><strong>Notice patterns</strong> — recurring themes, moods, and concerns</li>
            <li><strong>Reflect deeper</strong> — ask about what you wrote today or this week</li>
            <li><strong>Track change</strong> — how your thinking has shifted over time</li>
          </ul>
          <p>It knows your recent entries, mood patterns, and tags. Try asking:</p>
          <div class="bsv-intro-cmd"><em>"What patterns do you see in my last few entries?"</em></div>
          <div class="bsv-intro-cmd"><em>"I wrote about work stress again — help me think about why."</em></div>
          <div class="bsv-intro-cmd"><em>"What have I been avoiding writing about?"</em></div>
          <p style="margin-top:10px;color:var(--muted);font-size:12px">⌘↵ to send.</p>
        </div>`
    } else {
      div.innerHTML = `
        <div class="bsv-intro-title">Brainstorm knows your story.</div>
        <div class="bsv-intro-body">
          <p>Brainstorm always sends your <strong>logline, genre, and POV</strong>. Everything else is in the <strong>Context</strong> button under the chat: add chapters, scenes, characters, World Bible entries or notes, and see roughly how many tokens each one costs.</p>
          <p>Slash commands add chips for one turn:</p>
          <div class="bsv-intro-cmd"><code>/scene</code> — load the scene you have open (if any)</div>
          <div class="bsv-intro-cmd"><code>/chapter</code> — load the full chapter containing the open scene</div>
          <div class="bsv-intro-cmd"><code>/read Chapter 1</code> — load a specific chapter, scene, or act by name</div>
          <div class="bsv-intro-cmd"><code>/chars</code> — load all characters for this turn</div>
          <div class="bsv-intro-cmd"><code>/world</code> — load your World Bible for this turn</div>
          <div class="bsv-intro-cmd"><code>/beats</code> — load story beats for this turn</div>
          <div class="bsv-intro-cmd"><code>/full</code> — load everything for this turn</div>
          <p style="margin-top:8px">Commands <strong>chain</strong>: <code>/chars /scene What's Selene's emotional arc across this scene?</code></p>
          <p style="margin-top:10px;color:var(--muted);font-size:12px">Slash-command chips are marked “this turn” and clear after a successful reply. Pin a chip in the drawer to keep it. ⌘↵ to send.</p>
        </div>`
    }
    msgs.appendChild(div)
  }

  function renderBsvHistory() {
    const list = document.getElementById('bsv-history-list')
    if (!list) return
    list.innerHTML = ''
    if (!_bsvHistory.length) {
      list.innerHTML = '<div class="bsv-history-empty">No past conversations yet.</div>'
      return
    }
    _bsvHistory.forEach(convo => {
      const item = document.createElement('div')
      item.className = 'bsv-history-item' + (_bsvConvo?.id === convo.id ? ' active' : '')
      item.innerHTML = `
        <div class="bsv-history-title">${esc(convo.title || 'Conversation')}</div>
        <div class="bsv-history-date">${convo.date || ''}</div>
        <button class="bsv-history-del f-btn" title="Delete">
          <svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>`
      item.onclick = e => {
        if (e.target.closest('.bsv-history-del')) return
        loadBsvConvo(convo)
      }
      item.querySelector('.bsv-history-del').onclick = async e => {
        e.stopPropagation()
        const delPath = _bsvMode === 'journal' ? _bsvJournalPath : _bsvNovelPath
        await window.quill.deleteBrainstorm({ novelPath: delPath, id: convo.id })
        _bsvHistory = _bsvHistory.filter(c => c.id !== convo.id)
        if (_bsvConvo?.id === convo.id) {
          _bsvConvo = null
          document.getElementById('bsv-messages').innerHTML = ''
          document.getElementById('bsv-convo-title').textContent = 'New conversation'
        }
        renderBsvHistory()
      }
      list.appendChild(item)
    })
  }

  function loadBsvConvo(convo) {
    _bsvConvo = convo
    document.getElementById('bsv-convo-title').textContent = convo.title || 'Conversation'
    document.querySelectorAll('.bsv-history-item').forEach(el => el.classList.remove('active'))
    document.querySelectorAll('.bsv-history-item').forEach(el => {
      if (el.querySelector('.bsv-history-title')?.textContent === convo.title) el.classList.add('active')
    })
    const msgs = document.getElementById('bsv-messages')
    msgs.innerHTML = ''
    ;(convo.messages || []).forEach(m => appendBsvMessage(m.role, m.content))
    msgs.scrollTop = msgs.scrollHeight
  }

  async function sendBsvMsg(overrideText) {
    const inp    = document.getElementById('bsv-input')
    const text   = overrideText || inp.value.trim()
    if (!text) return
    inp.value = ''

    const hasKey = await QuillAI.hasKey()
    const model  = QuillModels.current()
    if (!hasKey) { QuillAI.askForKey(); return }

    // init conversation if needed
    const isFirstMessage = !_bsvConvo
    if (!_bsvConvo) {
      const words = text.split(/\s+/).slice(0,6).join(' ')
      _bsvConvo = {
        id:       Math.random().toString(36).slice(2,10),
        title:    words + (text.split(/\s+/).length > 6 ? '…' : ''),
        date:     new Date().toLocaleDateString('en-US',{month:'short',day:'numeric'}),
        novelPath: _bsvNovelPath,
        messages: []
      }
      document.getElementById('bsv-convo-title').textContent = _bsvConvo.title
    }

    // ── Slash command parsing (supports chaining) ──
    // Recognized:
    //   /chars /char         — inject all characters this turn
    //   /world /wb           — inject world bible
    //   /beats /beat         — inject story beats
    //   /full                — inject everything
    //   /scene               — inject the currently open scene (if any) as /read of it
    //   /chapter             — inject the chapter containing the currently open scene
    //   /read <name>         — inject a specific file/folder by fuzzy-matched name (greedy: eats the rest, or up to next /cmd)
    // Commands can be chained; the remaining text after all commands is the user's actual request.
    let finalText = text
    const turnFlags = new Set()  // chips to add for this turn (chars/world/beats/full)
    const flashFlags = new Set() // what the command scan found (same + 'scene'/'read')
    let readTarget = null        // greedy: the name portion for /read, if any

    // Token-parse: consume leading /commands from left to right
    let remainder = text.trim()
    const CMD_NAMES = ['chars','char','world','wb','beats','beat','full','scene','chapter','read']
    const CMD_RE = new RegExp(`^\\/(${CMD_NAMES.join('|')})\\b`, 'i')
    // Greedy-capture pattern for /read target: everything up to the next /command or end
    const NEXT_CMD_RE = new RegExp(`\\s+\\/(${CMD_NAMES.join('|')})\\b`, 'i')

    while (remainder.startsWith('/')) {
      const m = remainder.match(CMD_RE)
      if (!m) break
      const cmd = m[1].toLowerCase()
      remainder = remainder.slice(m[0].length).replace(/^\s+/, '')

      if (cmd === 'char' || cmd === 'chars') {
        turnFlags.add('chars'); flashFlags.add('chars')
      } else if (cmd === 'world' || cmd === 'wb') {
        turnFlags.add('world'); flashFlags.add('world')
      } else if (cmd === 'beat' || cmd === 'beats') {
        turnFlags.add('beats'); flashFlags.add('beats')
      } else if (cmd === 'full') {
        turnFlags.add('full'); flashFlags.add('full')
      } else if (cmd === 'scene') {
        // Load current open scene via existing review pipeline (one-turn)
        // Resolved below, after we finish the command scan
        flashFlags.add('scene')
        readTarget = readTarget || '__CURRENT_SCENE__'
      } else if (cmd === 'chapter') {
        flashFlags.add('read')
        readTarget = '__CURRENT_CHAPTER__'
      } else if (cmd === 'read') {
        // Greedy: take everything up to the next /command, or to end of string
        const nextCmd = remainder.match(NEXT_CMD_RE)
        if (nextCmd) {
          readTarget = remainder.slice(0, nextCmd.index).trim()
          remainder = remainder.slice(nextCmd.index).replace(/^\s+/, '')
        } else {
          readTarget = remainder.trim()
          remainder = ''
        }
        flashFlags.add('read')
      }
    }

    const hasSlashCmd = flashFlags.size > 0
    if (hasSlashCmd) {
      // Show original message in chat, then a system note confirming what was loaded
      appendBsvMessage('user', text)
      _bsvConvo.messages.push({ role:'user', content: text })

      // Slash commands add "this turn" chips to the context drawer. A /read target that isn't a
      // manuscript scene or chapter (a note, a scratch page) is still injected into the message.
      const noteBits = []
      let readInjection = ''
      if (_bsvCtx) {
        const all = await _bsvCtx.items()
        const entries = []
        const full = turnFlags.has('full')
        if (full || turnFlags.has('chars')) { entries.push(...all.filter(i => i.kind === 'character')); noteBits.push('characters') }
        if (full || turnFlags.has('world')) { entries.push(...all.filter(i => i.kind === 'world')); noteBits.push('world bible') }
        if (full || turnFlags.has('beats')) { const b = await bsvBeatsItem(); if (b) { entries.push(b); noteBits.push('story beats') } }
        let hit = null
        if (readTarget === '__CURRENT_SCENE__' && _currentFile) hit = all.find(i => i.id === `scene:${_currentFile}`)
        else if (readTarget === '__CURRENT_CHAPTER__' && _currentFile) hit = all.find(i => i.id === `chapter:${_currentFile.split('/').slice(0, -1).join('/')}`)
        else if (readTarget && !readTarget.startsWith('__')) hit = QuillAIContext.resolveTitles([readTarget], all).found[0] || null
        if (hit) { entries.push(hit); noteBits.push(`"${hit.title}"`); readTarget = null }
        if (entries.length) await _bsvCtx.add(entries.map(i => (i.kind === 'note' ? i : i.id)), { turn: true })
      }
      if (readTarget) {
        if (readTarget === '__CURRENT_SCENE__') {
          if (_currentFile) {
            const data = await window.quill.getFile(_currentFile).catch(() => null)
            if (data) {
              const title = data.meta.title || _currentFile.split('/').pop().replace(/\.md$/,'')
              readInjection = `\n[Context loaded: ${title}]\n${data.body}`
            }
          }
        } else if (readTarget) {
          const ctx2 = readTarget === '__CURRENT_CHAPTER__'
            ? await currentChapterContext()
            : await findReadTarget(readTarget)
          if (ctx2) {
            readInjection = `\n[Context loaded: ${ctx2.title}]\n`
            if (ctx2.type === 'folder') {
              if (ctx2.meta.synopsis) readInjection += `Summary: ${ctx2.meta.synopsis}\n`
              if (ctx2.meta.goal) readInjection += `Goal: ${ctx2.meta.goal}\n`
              if (ctx2.meta.pov) readInjection += `POV: ${ctx2.meta.pov}\n`
              if (ctx2.cards.length) readInjection += `Storyboard:\n${ctx2.cards.join('\n')}\n`
              if (ctx2.draft) readInjection += `Chapter draft:\n${ctx2.draft}`
            } else if (ctx2.type === 'file') {
              readInjection += ctx2.body
            }
          } else {
            readInjection = `\n[Note: I tried to load "${readTarget}" but couldn't find a match in your novel tree.]\n`
          }
        }
        const titleMatch = readInjection.match(/\[Context loaded: ([^\]]+)\]/)
        if (titleMatch) {
          noteBits.push(`"${titleMatch[1]}"`)
        } else if (readTarget !== '__CURRENT_SCENE__' && readTarget !== '__CURRENT_CHAPTER__') {
          noteBits.push(`(couldn't find "${readTarget}")`)
        }
      }
      appendBsvSystemNote(noteBits.length ? '✓ added for this turn: ' + noteBits.join(', ') : 'Nothing to add for this turn.')

      // Build final user-facing prompt
      const userRequest = remainder.trim()
      if (readInjection) {
        finalText = userRequest
          ? `${readInjection}\n\n${userRequest}`
          : `${readInjection}\n\nPlease briefly summarize what you now see and ask me what I'd like to explore.`
      } else {
        finalText = userRequest
          || `I've loaded extra context for this turn. Briefly confirm what you now have access to and ask me where I want to start.`
      }
    } else {
      appendBsvMessage('user', text)
      _bsvConvo.messages.push({ role:'user', content: text })
    }

    const typingId = appendBsvMessageTyping()

    try {
      const sysMessages = await bsvSystemMessages()

      const resp = await QuillAI.fetch({
        method: 'POST',
        body: JSON.stringify({
          model,
          max_tokens: 4096,
          stream: true,
          messages: [
            ...sysMessages,
            // Send prior turns unchanged, but swap the last user message for `finalText`
            // so slash-command injections (/read body, etc.) actually reach the model.
            ..._bsvConvo.messages.slice(-14, -1),
            { role: 'user', content: finalText }
          ]
        })
      })

      if (!resp.ok) {
        const errData = await resp.json().catch(() => ({}))
        throw new Error(errData.error?.message || `HTTP ${resp.status}`)
      }

      let reply = ''
      const el = document.getElementById(typingId)
      const reader = resp.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const lines = buf.split('\n')
        // last element may be an incomplete line — hold it back for the next chunk
        buf = lines.pop()
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const raw = line.slice(6).trim()
          if (raw === '[DONE]') continue
          try {
            const parsed = JSON.parse(raw)
            const delta = parsed.choices?.[0]?.delta?.content || ''
            if (delta) {
              reply += delta
              if (el) {
                el.innerHTML = renderBsvMd(reply)
                document.getElementById('bsv-messages').scrollTop = 99999
              }
            }
          } catch {}
        }
      }
      // flush any trailing complete line left in the buffer
      if (buf.startsWith('data: ')) {
        const raw = buf.slice(6).trim()
        if (raw && raw !== '[DONE]') {
          try {
            const parsed = JSON.parse(raw)
            const delta = parsed.choices?.[0]?.delta?.content || ''
            if (delta) {
              reply += delta
              if (el) el.innerHTML = renderBsvMd(reply)
            }
          } catch {}
        }
      }

      if (!reply) reply = '(no response)'
      if (el) el.innerHTML = renderBsvMd(reply)

      _bsvConvo.messages.push({ role:'assistant', content: reply })
      if (reply !== '(no response)') _bsvCtx?.consumed()

      // auto-generate a descriptive title after the first exchange
      if (isFirstMessage && hasKey) {
        try {
          const titleResp = await QuillAI.fetch({
            method: 'POST',
            body: JSON.stringify({
              model: QuillModels.role('quick'),
              max_tokens: 20,
              messages: [
                { role: 'system', content: 'Generate a 3-5 word title for this conversation. Return ONLY the title, no punctuation, no quotes.' },
                { role: 'user', content: `User said: ${_bsvConvo.messages[0]?.content || ''}` }
              ]
            })
          })
          if (titleResp.ok) {
            const titleData = await titleResp.json()
            const generated = titleData.choices?.[0]?.message?.content?.trim()
            if (generated && generated.length < 60) {
              _bsvConvo.title = generated
              document.getElementById('bsv-convo-title').textContent = generated
            }
          }
        } catch (e) {}
      }

      // save to history
      const savePath = _bsvMode === 'journal' ? _bsvJournalPath : _bsvNovelPath
      await window.quill.saveBrainstorm({ novelPath: savePath, conversation: _bsvConvo })
      const existing = _bsvHistory.findIndex(c => c.id === _bsvConvo.id)
      if (existing >= 0) _bsvHistory[existing] = _bsvConvo
      else _bsvHistory.unshift(_bsvConvo)
      renderBsvHistory()

    } catch (err) {
      updateBsvMessage(typingId, `Error: ${err.message}`)
      // "This turn" chips stay attached after a failed request so the turn can be retried.
    }
  }

  function appendBsvMessage(role, content) {
    const msgs = document.getElementById('bsv-messages')
    if (!msgs) return null
    const div = document.createElement('div')
    div.className = `bs-message bs-${role}`
    div.innerHTML = renderBsvMd(content)
    msgs.appendChild(div)
    msgs.scrollTop = msgs.scrollHeight
    return div
  }

  // Small centered note for context-injection confirmations
  function appendBsvSystemNote(text) {
    const msgs = document.getElementById('bsv-messages')
    if (!msgs) return null
    const div = document.createElement('div')
    div.className = 'bs-system-note'
    div.textContent = text
    msgs.appendChild(div)
    msgs.scrollTop = msgs.scrollHeight
    return div
  }

  function appendBsvMessageTyping() {
    const msgs = document.getElementById('bsv-messages')
    const div  = document.createElement('div')
    div.className = 'bs-message bs-assistant'
    div.id = 'bsv-typing-' + Date.now()
    div.innerHTML = '<span class="bs-typing">●●●</span>'
    msgs.appendChild(div)
    msgs.scrollTop = msgs.scrollHeight
    return div.id
  }

  function updateBsvMessage(id, content) {
    const el = document.getElementById(id)
    if (el) { el.innerHTML = renderBsvMd(content); document.getElementById('bsv-messages').scrollTop = 99999 }
  }

  function renderBsvMd(text) {
    return String(text||'')
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>')
      .replace(/\*(.+?)\*/g,'<em>$1</em>')
      .replace(/\n/g,'<br>')
  }

  async function findReadTarget(nameQuery) {
    if (!_bsvNovelPath) return null
    const q = nameQuery.toLowerCase().trim()
    try {
      const tree = await window.quill.getTree()
      // search novel subtree for matching folder or file
      function findInNode(node) {
        // check folders
        for (const child of (node.children || [])) {
          const folderName  = (child.name || '').toLowerCase()
          const folderTitle = '' // we don't have folder_title in tree, check path basename
          if (folderName.includes(q) || q.includes(folderName)) {
            return child.path
          }
          const found = findInNode(child)
          if (found) return found
        }
        // check files
        for (const file of (node.files || [])) {
          if ((file.title||'').toLowerCase().includes(q) ||
              (file.name||'').toLowerCase().replace(/\.md$/,'').includes(q)) {
            return file.path
          }
        }
        return null
      }
      // find novel root node
      function findNovelNode(node, novelPath) {
        if (node.path === novelPath) return node
        for (const c of (node.children||[])) { const f = findNovelNode(c, novelPath); if (f) return f }
        return null
      }
      const novelNode = findNovelNode(tree, _bsvNovelPath)
      if (!novelNode) return null
      const matchPath = findInNode(novelNode)
      if (!matchPath) return null
      return await window.quill.getFileContext(matchPath).catch(() => null)
    } catch { return null }
  }

  async function currentChapterContext() {
    const chapterPath = _currentFile
      ? _currentFile.split('/').slice(0, -1).join('/')
      : _currentFolder
    if (!chapterPath) return null
    return window.quill.getFileContext(chapterPath).catch(() => null)
  }

  // Novel system prompt — role/personality only (shown in editable Instructions UI)
  function buildBsvSystemPrompt(ctx) {
    return `You are a fiction editorial collaborator — think experienced developmental editor meets trusted writing partner. You specialize in genre fiction, dark romance, romantasy, and literary speculative fiction. Your role is to help this writer think through their story, not to write it for them.

You are opinionated but not prescriptive. You notice when something isn't working and say so clearly, but you always explain why and offer multiple directions forward. You ask incisive questions. You celebrate what's working. You stay in the emotional register of the genre — you understand that slow burn tension, visceral prose, psychological complexity, and morally grey characters are features, not bugs.

You never sanitize. You never default to safe choices. You understand that dark romance and romantasy readers want earned intimacy, real stakes, and characters who feel dangerously alive.

NOVEL: ${ctx.title||'Untitled'} | GENRE: ${ctx.genre||''}

When the writer uses /read [name], you've received content from that file and should engage with it specifically.

Keep responses under 300 words unless depth is genuinely needed. Be direct. Be useful. Be the editor this writer actually needs.`
  }

  // Novel base — injected as a separate system message, NOT shown in Instructions UI. Characters,
  // World Bible, beats and manuscript arrive as context-drawer chips (bsvSystemMessages).
  function buildNovelContext(ctx) {
    const parts = []
    if (ctx.logline)  parts.push(`LOGLINE: ${ctx.logline}`)
    if (ctx.pov)      parts.push(`POV: ${ctx.pov}`)
    if (ctx.themes)   parts.push(`THEMES: ${ctx.themes}`)
    if (ctx.synopsis && ctx.synopsis.length < 500) parts.push(`SYNOPSIS: ${ctx.synopsis}`)
    return parts.join('\n')
  }

  // Journal system prompt — role/personality only (shown in editable Instructions UI)
  function buildJournalSystemPrompt(ctx) {
    const moodSummary = Object.entries(ctx.recentMoods || {})
      .sort((a, b) => b[1] - a[1])
      .map(([mood, count]) => `${mood}: ${count}`)
      .join(', ')

    const topTags = (ctx.topTags || []).join(', ')

    return `You are a reflective journaling companion. You help a writer notice patterns in their own writing, ask questions that go one layer deeper, and hold space for whatever they're processing. You are warm but not saccharine. You are perceptive but not presumptuous.

Your approach:
- Notice what's there, including what keeps coming back across entries. Name it simply.
- Ask one sharp question at a time. The kind that makes someone pause, not the kind that feels like a checklist.
- Never tell them how to feel. Never prescribe solutions. Never say "have you considered talking to a professional" unless they explicitly ask for that kind of guidance.
- Match their register. If they're raw, be direct. If they're reflective, go deeper. If they're avoidant, name the avoidance gently.
- You can notice contradictions between entries — "last week you said X, today you wrote Y" — but frame it as curiosity, not confrontation.
- Keep responses under 200 words. Journaling AI should feel like a thoughtful margin note, not a therapy session.

JOURNAL: ${ctx.title || 'Journal'}
TOTAL ENTRIES: ${ctx.totalEntries || 0}
RECENT MOOD DISTRIBUTION (last 30 days): ${moodSummary || 'No moods tracked yet.'}
RECURRING TAGS: ${topTags || 'None yet.'}`
  }

  // Journal entry data — injected as a separate system message, NOT shown in Instructions UI
  function buildJournalEntryContext(ctx) {
    const entries = (ctx.recentEntries || []).slice(0, 7)
    if (!entries.length) return ''
    const lines = entries.map(e => {
      const mood = e.mood ? ` [mood: ${e.mood}]` : ''
      const tags = e.tags?.length ? ` [tags: ${e.tags.join(', ')}]` : ''
      const preview = (e.preview || '').slice(0, 200)
      return `${e.date || 'undated'} — "${e.title}"${mood}${tags}\n${preview}${e.preview && e.preview.length > 200 ? '…' : ''}`
    })
    return `Recent journal entries for context:\n\n${lines.join('\n\n')}`
  }

  // Show/hide concept-art button based on whether we're in a novel context
  async function updateConceptArtBtn() {
    const btn = document.getElementById('concept-art-btn')
    if (!btn) return
    try {
      const novelPath = await findNovelRoot()
      btn.style.display = novelPath ? '' : 'none'
    } catch {
      btn.style.display = 'none'
    }
  }

  async function openConceptArt() {
    const novelPath = await findNovelRoot()
    if (!novelPath) return
    if (typeof ConceptArt === 'undefined') {
      console.error('[concept-art] module not loaded')
      return
    }
    // close other toolbar-view modes so we don't stack state
    _bsvOpen       = false
    _readDraftMode = false
    _boardMode     = false
    document.getElementById('brainstorm-btn')?.classList.remove('active')
    document.getElementById('read-btn').classList.remove('active')
    document.getElementById('board-btn').classList.remove('active')
    document.getElementById('concept-art-btn')?.classList.add('active')
    await ConceptArt.open(novelPath)
    updateBackBtn()
  }

  // ── AI Ask popover ────────────────────────────────────────
  let _askSelection = ''
  let _askPopoverOpen = false

  function initAskPopover() {
    document.getElementById('ct-ask-ai-btn').onclick = e => {
      e.stopPropagation()
      const sel = window.getSelection()
      _askSelection = sel ? sel.toString().trim() : ''
      document.getElementById('comment-toolbar').style.display = 'none'
      showAskPopover()
    }

    document.getElementById('ai-ask-send').onclick  = sendAskQuery
    document.getElementById('ai-ask-close').onclick = closeAskPopover
    document.getElementById('ai-ask-input').addEventListener('keydown', e => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) sendAskQuery()
      if (e.key === 'Escape') closeAskPopover()
    })
    document.getElementById('ai-ask-save').onclick = () => {
      const respEl   = document.getElementById('ai-ask-response')
      const respHtml = respEl.innerHTML
      const question = document.getElementById('ai-ask-input').value.trim()
      if (respHtml) {
        // Append Q&A to the Notes panel (not the Comments system)
        const notesBody = document.getElementById('notes-body')
        const entry = document.createElement('div')
        entry.style.cssText = 'margin-bottom:12px;padding-bottom:12px;border-bottom:1px solid var(--border)'
        entry.innerHTML = `<div style="font-size:11px;font-weight:600;color:var(--muted);margin-bottom:4px;font-family:var(--ui)">✦ Ask AI</div>`
                        + `<div style="font-size:12px;color:var(--muted);font-style:italic;margin-bottom:4px;font-family:var(--ui)">${esc(question)}</div>`
                        + `<div style="font-size:13px;color:var(--text);line-height:1.5;font-family:var(--ui)">${respHtml}</div>`
        notesBody.appendChild(entry)
        // Open notes panel if not already open
        Editor.toggleNotes(true)
        // Save notes to disk
        const currentFile = App.getCurrentFile ? App.getCurrentFile() : null
        if (currentFile) {
          window.quill.saveNotes({ rel: currentFile, content: notesBody.innerHTML }).catch(() => {})
        }
      }
      closeAskPopover()
    }
    document.addEventListener('mousedown', e => {
      if (_askPopoverOpen && !e.target.closest('#ai-ask-popover')) closeAskPopover()
    })
  }

  function showAskPopover() {
    _askPopoverOpen = true
    const popover = document.getElementById('ai-ask-popover')
    const selEl   = document.getElementById('ai-ask-selection')
    const respEl  = document.getElementById('ai-ask-response')
    const saveBtn = document.getElementById('ai-ask-save')
    const inp     = document.getElementById('ai-ask-input')

    selEl.textContent = _askSelection.length > 120
      ? '"' + _askSelection.slice(0,120) + '…"'
      : '"' + _askSelection + '"'
    respEl.style.display = 'none'
    respEl.textContent   = ''
    saveBtn.style.display = 'none'
    inp.value = ''

    // position near current selection — prefer below, flip above if not enough room
    const sel  = window.getSelection()
    const vw   = window.innerWidth
    const vh   = window.innerHeight
    const pw   = 360  // popover width from CSS
    const estH = 280  // estimated initial height (before response)

    let top, left
    if (sel && sel.rangeCount) {
      const rect = sel.getRangeAt(0).getBoundingClientRect()
      left = Math.max(8, Math.min(rect.left, vw - pw - 8))
      // Prefer below selection; flip above if it would go off-screen
      if (rect.bottom + 8 + estH < vh) {
        top = rect.bottom + 8
      } else {
        top = Math.max(8, rect.top - estH - 8)
      }
    } else {
      top  = 120
      left = Math.max(8, Math.min(400, vw - pw - 8))
    }
    popover.style.top  = top + 'px'
    popover.style.left = left + 'px'

    popover.style.display = 'flex'
    setTimeout(() => inp.focus(), 60)
  }

  // lightweight MD → HTML for Ask AI responses
  function _fmtAskMd(md) {
    let h = esc(md)
    // headers: # ## ### (must be at line start)
    h = h.replace(/^### (.+)$/gm, '<div style="font-weight:700;font-size:13px;margin:8px 0 4px">$1</div>')
    h = h.replace(/^## (.+)$/gm, '<div style="font-weight:700;font-size:14px;margin:8px 0 4px">$1</div>')
    h = h.replace(/^# (.+)$/gm, '<div style="font-weight:700;font-size:15px;margin:8px 0 4px">$1</div>')
    // bold **text** or __text__
    h = h.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    h = h.replace(/__(.+?)__/g, '<strong>$1</strong>')
    // italic *text* or _text_ (not inside words)
    h = h.replace(/(?<!\w)\*(?!\s)(.+?)(?<!\s)\*(?!\w)/g, '<em>$1</em>')
    h = h.replace(/(?<!\w)_(?!\s)(.+?)(?<!\s)_(?!\w)/g, '<em>$1</em>')
    // numbered lists: lines starting with 1. 2. etc
    h = h.replace(/^(\d+)\.\s+(.+)$/gm, '<div style="margin:2px 0;padding-left:1.2em;text-indent:-1.2em">$1. $2</div>')
    // paragraphs from double newlines
    h = h.replace(/\n\n+/g, '</p><p style="margin:6px 0 0">')
    // single newlines → <br>
    h = h.replace(/\n/g, '<br>')
    return '<p style="margin:0">' + h + '</p>'
  }

  async function sendAskQuery() {
    const question = document.getElementById('ai-ask-input').value.trim()
    if (!question) return
    const hasKey   = await QuillAI.hasKey()
    const model    = QuillModels.role('quick')  // quick reference questions use the cheap model
    if (!hasKey) { QuillAI.askForKey(); return }

    const btn    = document.getElementById('ai-ask-send')
    const respEl = document.getElementById('ai-ask-response')
    btn.textContent = '…'
    btn.disabled    = true
    respEl.style.display = 'block'
    respEl.textContent   = 'Thinking…'

    try {
      const novelPath = await findNovelRoot()
      const ctx  = novelPath ? await window.quill.getNovelContext(novelPath).catch(()=>({})) : {}

      // enrich with current file context
      let fileContext = ''
      if (_currentFile) {
        try {
          const fileData = await window.quill.getFile(_currentFile)
          const title    = fileData.meta?.title || _currentFile.split('/').pop().replace(/\.md$/,'')
          const body     = (fileData.body || '').trim()
          fileContext = `\n\nCurrent scene: "${title}"\n${body.slice(0, 1500)}${body.length > 1500 ? '\n[...continues]' : ''}`
        } catch {}
      }

      const sys  = `You are a writing collaborator. Give a concise, useful answer about the highlighted passage — under 150 words.

Novel: ${ctx.title||'Unknown'} | Genre: ${ctx.genre||''} | Logline: ${ctx.logline||''}
${fileContext}`

      const askMessages = [{ role:'system', content: sys }]
      // always inject writing guide as its own message
      if (novelPath) {
        try {
          const wgMeta = await window.quill.getFolderMeta(novelPath)
          if (wgMeta && wgMeta.writing_guide) {
            askMessages.push({ role:'system', content: 'WRITER\'S STYLE GUIDE (always follow these in all feedback and suggestions):\n' + wgMeta.writing_guide })
          }
        } catch (e) {}
      }
      askMessages.push({ role:'user', content: `Highlighted text: "${_askSelection}"\n\nQuestion: ${question}` })

      const resp = await QuillAI.fetch({
        method: 'POST',
        body: JSON.stringify({ model, max_tokens:300, stream: true, messages: askMessages })
      })
      if (!resp.ok) {
        const errData = await resp.json().catch(() => ({}))
        throw new Error(errData.error?.message || `HTTP ${resp.status}`)
      }
      let reply = ''
      respEl.textContent = ''
      const reader2 = resp.body.getReader()
      const decoder2 = new TextDecoder()
      let buf2 = ''
      while (true) {
        const { done, value } = await reader2.read()
        if (done) break
        buf2 += decoder2.decode(value, { stream: true })
        const lines = buf2.split('\n')
        buf2 = lines.pop()
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const raw = line.slice(6).trim()
          if (raw === '[DONE]') continue
          try {
            const delta = JSON.parse(raw).choices?.[0]?.delta?.content || ''
            if (delta) { reply += delta; respEl.innerHTML = _fmtAskMd(reply) }
          } catch {}
        }
      }
      if (buf2.startsWith('data: ')) {
        const raw = buf2.slice(6).trim()
        if (raw && raw !== '[DONE]') {
          try {
            const delta = JSON.parse(raw).choices?.[0]?.delta?.content || ''
            if (delta) { reply += delta; respEl.innerHTML = _fmtAskMd(reply) }
          } catch {}
        }
      }
      if (!reply) reply = '(no response)'
      respEl.innerHTML = _fmtAskMd(reply)
      document.getElementById('ai-ask-save').style.display = ''
      // Nudge popover up if it now overflows the bottom of the viewport
      const pop = document.getElementById('ai-ask-popover')
      const box = pop.getBoundingClientRect()
      if (box.bottom > window.innerHeight - 8) {
        pop.style.top = Math.max(8, window.innerHeight - box.height - 8) + 'px'
      }
    } catch (err) {
      respEl.textContent = 'Error: ' + err.message
    } finally {
      btn.textContent = 'Ask'
      btn.disabled    = false
    }
  }

  function closeAskPopover() {
    _askPopoverOpen = false
    document.getElementById('ai-ask-popover').style.display = 'none'
  }

  // wire ask popover after DOM loads
  document.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('ct-ask-ai-btn')) initAskPopover()
  })

  // ── Dashboard (home page) ─────────────────────────────────

  let _dashNovelPath = null

  // The italic line under the greeting. General lines are for any novel; a novel can add its
  // own under Overview → Dashboard lines (`dashboard_sublines`, one per row).
  const DASH_SUBLINES = [
    "Writing even a little rewires your brain toward story.",
    "The draft doesn't have to be good. It just has to exist.",
    "Every scene you finish is a scene no one else could have written.",
    "Slow burn requires patience from the author too.",
    "Your characters are waiting.",
    "The best scene you've ever written is still ahead of you.",
    "You don't have to write the whole novel today. Just the next sentence.",
    "Stories that scare the author a little are the ones worth reading.",
    "Tension is just unresolved desire. Give them more of it.",
    "The messy draft is still a draft. Keep going.",
    // for when the prose feels bad
    "Clean prose comes from revision. The story comes from you.",
    "Your first draft only has to be clear enough for you to fix later.",
    "Nobody falls in love with a sentence first. They fall in love with a person in trouble.",
    "You're allowed to write it badly today. You're not allowed to leave it unwritten.",
    "Readers forgive plain sentences. They don't forgive boring stories, and yours isn't boring.",
    "Every writer you admire has a drawer full of pages they'd never show you.",
    "Craft is a muscle. An ugly rep still counts.",
    "Voice comes from volume. Keep writing and it shows up.",
    // for the ideas person
    "You love stories. That's the qualification.",
    "Ideas get better once they're written down, even the half-formed ones.",
    "A strange idea on the page beats a perfect one in your head.",
    "Write the scene you're most excited about. The rest can catch up.",
    "Drafting is how you find out what the story is actually about.",
    "Somewhere in this draft is the scene that made you want to write the book.",
    // for the urban fantasy writer
    "Somebody has to write the monster hunter with rent due. Might as well be you.",
    "Somewhere a Fever fan is rereading Darkfever for the fifth time, waiting for your book.",
    "Every urban fantasy needs its Barrons. Who's yours?",
    "A city after midnight, a bad decision, and something with teeth. You know what to do.",
    "Write the book you keep looking for on the shelf.",
    "Leather jacket, silver knife, terrible coping skills. Your heroine's waiting.",
    "The genre isn't dead. It's waiting for new books.",
    "Magic in a parking lot is still magic.",
    "Put the vampire in a strip mall. Readers will follow you anywhere.",
  ]

  function pickDashboardSubline(projectMeta) {
    const own = String(projectMeta?.dashboard_sublines || '').split('\n').map(line => line.trim()).filter(Boolean)
    const pool = own.length && Math.random() < 0.5 ? own : DASH_SUBLINES
    return pool[Math.floor(Math.random() * pool.length)]
  }

  // ── Daily word goal ───────────────────────────────────────
  // The point of this is the moment it is met, so the "met" state is loud and the rest is
  // quiet. Celebrated once per local day; re-opening the dashboard does not replay it.
  function renderDailyGoal(stats) {
    const block = document.getElementById('dash-goal-block')
    if (!block || !stats) return
    const bar   = document.getElementById('dash-goal-bar')
    const label = document.getElementById('dash-goal-label')
    const edit  = document.getElementById('dash-goal-edit')
    const goal  = Number(stats.dailyGoal) || 0
    const words = Number(stats.todayWritten ?? stats.todayWords) || 0

    block.classList.toggle('has-goal', goal > 0)
    block.classList.toggle('met', Boolean(stats.goalMet))

    if (!goal) {
      bar.style.width = '0%'
      label.textContent = words > 0
        ? `${words.toLocaleString()} words today`
        : 'No words yet today'
      edit.textContent = 'Set goal'
    } else {
      bar.style.width = Math.min(100, Math.round((words / goal) * 100)) + '%'
      label.textContent = stats.goalMet
        ? `Goal met — ${words.toLocaleString()} words today`
        : `${words.toLocaleString()} / ${goal.toLocaleString()} words`
      edit.textContent = 'Change'
    }

    if (stats.goalMet) {
      const key = 'quill_goal_met_' + stats.today
      if (!localStorage.getItem(key)) {
        localStorage.setItem(key, '1')
        block.classList.add('celebrate')
        setTimeout(() => block.classList.remove('celebrate'), 2600)
      }
      Object.keys(localStorage).forEach(k => {
        if (k.startsWith('quill_goal_met_') && k !== key) localStorage.removeItem(k)
      })
    }
  }

  async function refreshDailyGoal() {
    const stats = await window.quill.getStats().catch(() => null)
    if (stats) renderDailyGoal(stats)
  }

  function initDailyGoalControls() {
    const editBtn  = document.getElementById('dash-goal-edit')
    const editRow  = document.getElementById('dash-goal-edit-row')
    const input    = document.getElementById('dash-goal-input')
    const saveBtn  = document.getElementById('dash-goal-save')
    const clearBtn = document.getElementById('dash-goal-clear')
    if (!editBtn || !editRow) return

    const commit = async (value) => {
      await window.quill.setDailyGoal({ goal: value }).catch(() => {})
      editRow.style.display = 'none'
      await refreshDailyGoal()
    }
    editBtn.onclick = () => {
      const showing = editRow.style.display !== 'none'
      editRow.style.display = showing ? 'none' : 'flex'
      if (!showing) { input.focus(); input.select() }
    }
    saveBtn.onclick = () => commit(parseInt(input.value, 10) || 0)
    clearBtn.onclick = () => { input.value = ''; commit(0) }
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') saveBtn.onclick()
      if (e.key === 'Escape') editRow.style.display = 'none'
    })
  }

  function fmtDashboardNumber(value) {
    const number = Number(value) || 0
    return number >= 100000 ? `${(number / 1000).toFixed(0)}k`
      : number >= 10000 ? `${(number / 1000).toFixed(1)}k` : number.toLocaleString()
  }

  function fmtDashboardDuration(seconds) {
    const minutes = Math.max(0, Math.floor((Number(seconds) || 0) / 60))
    if (minutes < 60) return `${minutes}m`
    const hours = Math.floor(minutes / 60)
    const remainder = minutes % 60
    return remainder ? `${hours}h ${remainder}m` : `${hours}h`
  }

  async function selectDashboardProject(stats, projectPath) {
    if (!projectPath) return
    _dashNovelPath = projectPath
    localStorage.setItem('quill_dash_active_project', projectPath)
    renderManuscriptProgress(stats, projectPath)
    const projectColor = stats?.projectProgress?.find(item => item.path === projectPath)?.color
    const glimpseEl = document.getElementById('dashboard-glimpse')
    if (glimpseEl && projectColor) glimpseEl.style.setProperty('--project-color', projectColor)

    const [meta, loose] = await Promise.all([
      window.quill.getFolderMeta(projectPath).catch(() => ({})),
      window.quill.projectLoosePages?.(projectPath).catch(() => null),
    ])
    if (_dashNovelPath !== projectPath) return
    const sublineEl = document.getElementById('dash-subline')
    if (sublineEl) sublineEl.textContent = pickDashboardSubline(meta)
    renderLoosePages(loose)
    renderContinue(stats?.projectProgress?.find(item => item.path === projectPath))

    const loadGlimpse = async () => {
      const passage = await window.quill.getRandomPassage(projectPath).catch(() => null)
      if (_dashNovelPath !== projectPath) return
      const textEl = document.getElementById('dash-glimpse-text')
      const sourceEl = document.getElementById('dash-glimpse-source')
      if (!passage || !glimpseEl || !textEl) {
        if (glimpseEl) glimpseEl.style.display = 'none'
        return
      }
      textEl.textContent = passage.text
        .replace(/\*\*(.+?)\*\*/g, '$1')
        .replace(/\*(.+?)\*/g, '$1')
        .replace(/~~(.+?)~~/g, '$1')
        .replace(/\*/g, '')
      if (sourceEl) sourceEl.textContent = '— ' + (passage.source || passage.title)
      // Clicking the quote opens its scene with the caret at the start of the passage.
      const openPassage = async () => {
        if (!passage.filePath) return
        await openFile(passage.filePath)
        window.QuillEditor.goToPassage?.(textEl.textContent)
      }
      textEl.onclick = openPassage
      textEl.onkeydown = e => { if (e.key === 'Enter') openPassage() }
      textEl.tabIndex = passage.filePath ? 0 : -1
      textEl.title = passage.filePath ? 'Open this passage in the scene' : ''
      textEl.classList.toggle('is-link', Boolean(passage.filePath))
      glimpseEl.style.display = ''
    }
    await loadGlimpse()
    const refreshBtn = document.getElementById('dash-glimpse-refresh')
    if (refreshBtn) refreshBtn.onclick = loadGlimpse
  }

  function fmtDashboardDate(ms) {
    const date = new Date(ms)
    const options = { month:'short', day:'numeric' }
    if (date.getFullYear() !== new Date().getFullYear()) options.year = 'numeric'
    return date.toLocaleDateString('en-US', options)
  }

  // ── Your writing: stat line + 26-week heat map ─────────────
  // One sequential hue (the theme accent) in four steps. Steps come from quantiles of the
  // writer's own non-zero days, so the scale fits their habits rather than a fixed word count.
  // Revision-only days (words cut or rewritten, focused time) get an outlined empty cell.
  function renderWritingSection(stats) {
    const heat = Array.isArray(stats.heatmap) ? stats.heatmap : []
    const week = heat.slice(-7)
    const weekWords = week.reduce((sum, day) => sum + day.words, 0)
    const writingDays = week.filter(day => day.words > 0).length
    const weekSeconds = (stats.projectProgress || []).reduce((total, project) =>
      total + Object.values(project.weekSeconds || {}).reduce((sum, seconds) => sum + Number(seconds || 0), 0), 0)
    const statItems = [
      [fmtDashboardNumber(stats.todayWritten ?? stats.todayWords ?? 0), 'written today'],
      [fmtDashboardNumber(weekWords), 'this week'],
      [fmtDashboardNumber(writingDays ? Math.round(weekWords / writingDays) : 0), 'avg / day'],
      [String(week.filter(day => day.active).length), 'days active'],
      [fmtDashboardDuration(weekSeconds), 'focused'],
      [String(stats.streak || 0), 'day streak'],
    ]
    const statLine = document.getElementById('dash-stat-line')
    if (statLine) statLine.innerHTML = statItems.map(([value, label]) =>
      `<span class="dash-stat"><b>${esc(value)}</b> ${esc(label)}</span>`).join('')
    // Written today = net change + words cut; the tooltip shows the split.
    const todayStat = statLine?.querySelector('.dash-stat')
    if (todayStat) {
      const net = Number(stats.todayWords) || 0, cut = Number(stats.todayCut) || 0
      todayStat.title = `${(net + cut).toLocaleString()} written · ${cut.toLocaleString()} cut · net ${net >= 0 ? '+' : ''}${net.toLocaleString()}`
    }

    const el = document.getElementById('dash-heatmap')
    if (!el || !heat.length) return
    const nonZero = heat.map(day => day.words).filter(words => words > 0).sort((a, b) => a - b)
    const quantile = q => nonZero.length ? nonZero[Math.min(nonZero.length - 1, Math.floor(q * nonZero.length))] : Infinity
    const cuts = [quantile(.25), quantile(.5), quantile(.75)]
    const maxWords = nonZero[nonZero.length - 1] || 1
    // Quartiles need enough days to mean anything; a short history scales linearly to its peak.
    const level = words => !words ? 0
      : nonZero.length < 8 ? Math.max(1, Math.ceil(words / maxWords * 4))
      : words <= cuts[0] ? 1 : words <= cuts[1] ? 2 : words <= cuts[2] ? 3 : 4
    const cell = 12, gap = 3, step = cell + gap, left = 26, top = 16
    const firstDay = new Date(heat[0].date + 'T12:00:00').getDay()
    const columns = Math.ceil((heat.length + firstDay) / 7)
    const width = left + columns * step, height = top + 7 * step
    const today = stats.today
    const months = []
    const rects = heat.map((day, index) => {
      const slot = index + firstDay
      const col = Math.floor(slot / 7), row = slot % 7
      const date = new Date(day.date + 'T12:00:00')
      if (date.getDate() <= 7 && row === 0 || index === 0) {
        const label = date.toLocaleDateString('en-US', { month:'short' })
        if (!months.length || months[months.length - 1].label !== label) months.push({ label, x:left + col * step })
      }
      const lvl = level(day.words)
      const cls = ['hm', `hm-${lvl}`, !day.words && day.active ? 'hm-revise' : '', day.date === today ? 'hm-today' : ''].filter(Boolean).join(' ')
      const tip = `${date.toLocaleDateString('en-US', { month:'short', day:'numeric' })} · ${day.words ? `${day.words.toLocaleString()} words` : day.active ? 'revision only' : 'no writing'}`
      return `<rect class="${cls}" x="${left + col * step}" y="${top + row * step}" width="${cell}" height="${cell}" rx="3" data-tip="${esc(tip)}"></rect>`
    }).join('')
    const labels = months.filter((month, index) => index === 0 || month.x - months[index - 1].x >= step * 3)
      .map(month => `<text class="hm-label" x="${month.x}" y="10">${month.label}</text>`).join('')
    const dayLabels = [[1, 'Mon'], [3, 'Wed'], [5, 'Fri']]
      .map(([row, label]) => `<text class="hm-label" x="0" y="${top + row * step + cell - 2}">${label}</text>`).join('')
    const writingDaysTotal = heat.filter(day => day.words > 0).length
    const totalWords = heat.reduce((sum, day) => sum + day.words, 0)
    el.innerHTML = `
      <svg viewBox="0 0 ${width} ${height}" role="img"
        aria-label="Writing activity, last 26 weeks: ${writingDaysTotal} writing days, ${totalWords.toLocaleString()} words">
        ${labels}${dayLabels}${rects}
      </svg>
      <div class="hm-legend"><span>less</span>${[0, 1, 2, 3, 4].map(lvl => `<i class="hm-${lvl}"></i>`).join('')}<span>more</span></div>
      <div class="hm-tip" hidden></div>`
    const tipEl = el.querySelector('.hm-tip')
    el.querySelector('svg').addEventListener('mouseover', event => {
      const rect = event.target.closest('rect')
      if (!rect) { tipEl.hidden = true; return }
      tipEl.textContent = rect.dataset.tip
      tipEl.hidden = false
      const box = rect.getBoundingClientRect(), host = el.getBoundingClientRect()
      tipEl.style.left = `${box.left - host.left + box.width / 2}px`
      tipEl.style.top = `${box.top - host.top}px`
    })
    el.querySelector('svg').addEventListener('mouseleave', () => { tipEl.hidden = true })
  }

  // Scratch pages and ideas that mention this novel. Shown for orientation only; they never
  // count toward the manuscript word total.
  function renderLoosePages(loose) {
    const el = document.querySelector('#dash-manuscript-card .dash-manuscript-loose')
    if (!el) return
    const pages = loose?.pages || []
    const ideas = loose?.ideas || []
    if (!pages.length && !ideas.length) { el.hidden = true; return }
    const parts = []
    if (pages.length) parts.push(`<button type="button" class="dash-link" data-loose-page="${esc(pages[0].path)}" title="${esc(pages.map(page => page.title).join('\n'))}">${pages.length} in Scratch</button> (${fmtDashboardNumber(loose.words)} words)`)
    if (ideas.length) parts.push(`<button type="button" class="dash-link" data-loose-idea="${esc(ideas[0].id)}" title="${esc(ideas.map(idea => idea.title).join('\n'))}">${ideas.length} idea${ideas.length === 1 ? '' : 's'}</button>`)
    el.innerHTML = `<span class="dash-sep">·</span>Loose pages: ${parts.join(' · ')}`
    el.hidden = false
    el.querySelector('[data-loose-page]')?.addEventListener('click', event => {
      const target = event.currentTarget.dataset.loosePage
      Tree.expandToFile(target)
      openFile(target)
    })
    el.querySelector('[data-loose-idea]')?.addEventListener('click', event => Ideas.openIdea(event.currentTarget.dataset.looseIdea))
  }

  // Continue row inside the manuscript card: the last-opened scene when it belongs to this
  // novel, otherwise this novel's most recently edited scene.
  async function renderContinue(project) {
    const el = document.querySelector('#dash-manuscript-card .dash-continue')
    if (!el || !project) return
    const last = localStorage.getItem('quill_last') || ''
    const target = last.startsWith(project.path + '/') ? last : project.lastEdited?.path
    if (!target) { el.hidden = true; return }
    const [fileData, outline] = await Promise.all([
      window.quill.getFile(target).catch(() => null),
      window.quill.getOutline(target).catch(() => ({ beats:[] })),
    ])
    if (_dashNovelPath !== project.path || !fileData) { if (!fileData) el.hidden = true; return }
    const title = fileData.meta?.title || target.split('/').pop().replace(/\.md$/, '')
    const chapter = target.split('/').slice(-2, -1)[0] || ''
    const words = Number(fileData.word_count || 0)
    const seconds = Editor.getTimeSpent?.(target) || 0
    const beats = Array.isArray(outline?.beats) ? outline.beats : []
    const done = beats.filter(beat => typeof beat === 'object' && beat?.done).length
    const next = beats.find(beat => !(typeof beat === 'object' && beat?.done))
    const nextTitle = typeof next === 'string' ? next : (next?.title || next?.text || '')
    const details = [
      chapter && chapter !== project.path ? esc(chapter) : '',
      `${words.toLocaleString()} word${words === 1 ? '' : 's'}`,
      seconds >= 60 ? `${fmtDashboardDuration(seconds)} in scene` : (!words ? 'not started' : ''),
      beats.length ? `${done} of ${beats.length} beats` : '',
      beats.length ? (nextTitle ? `Next: ${esc(nextTitle)}` : 'All beats done') : '',
    ].filter(Boolean)
    el.innerHTML = `
      <button type="button" class="dash-continue-btn">
        <span class="dash-continue-icon">↳</span>
        <span class="dash-continue-inner">
          <span class="dash-continue-top"><span class="dash-continue-label">Continue</span><span class="dash-continue-title">${esc(title)}</span></span>
          <span class="dash-continue-context">${details.join(' · ')}</span>
        </span>
        ${beats.length ? `<span class="dash-continue-beats-track"><i style="width:${Math.round(done / beats.length * 100)}%"></i></span>` : ''}
      </button>`
    el.hidden = false
    el.querySelector('button').onclick = () => {
      Tree.expandToFile(target)
      openFile(target)
    }
  }

  function renderManuscriptProgress(stats, activePath) {
    const card = document.getElementById('dash-manuscript-card')
    if (!card) return
    const projects = stats?.projectProgress || []
    const project = projects.find(item => item.path === activePath) || projects[0]
    if (!project) { card.style.display = 'none'; return }
    const totalWords = Math.max(0, Number(project.totalWords) || 0)
    const goal = Math.max(0, Number(project.goal) || 0)
    const goalPercent = goal ? Math.min(100, Math.round(totalWords / goal * 100)) : 0
    const scenes = Math.max(0, Number(project.scenes) || 0)
    const emptyScenes = Math.max(0, Number(project.emptyScenes) || 0)
    const proseScenes = scenes - emptyScenes
    const statusOrder = ['drafting', 'revising', 'done']
    const statuses = Object.entries(project.statusCounts || {})
      .filter(([status, count]) => status && count > 0)
      .sort(([a], [b]) => (statusOrder.indexOf(a) + 1 || 99) - (statusOrder.indexOf(b) + 1 || 99))
      .map(([status, count]) => `${count} ${esc(status)}`)

    // Outline-first novels have scene files waiting for prose; discovery drafts do not. A
    // scene ratio only means something for the first kind.
    const details = [
      emptyScenes > 0
        ? `Outline <strong>${proseScenes}</strong>/${scenes} scenes have prose`
        : `<strong>${scenes}</strong> scene${scenes === 1 ? '' : 's'} drafted`,
      ...statuses,
      Number(project.totalTimeSeconds) >= 60 ? `${fmtDashboardDuration(project.totalTimeSeconds)} invested` : '',
    ].filter(Boolean)

    card.style.setProperty('--project-color', project.color)
    card.style.display = ''
    card.innerHTML = `
      <div class="dash-manuscript-title-row">
        <button type="button" class="dash-manuscript-title" data-open-progress-project title="Open ${esc(project.title)}">${esc(project.title)}</button>
        <div class="dash-manuscript-controls">
          <div class="dash-manuscript-switcher">${projects.map(item => `<button type="button" data-progress-project="${esc(item.path)}" class="${[item.id === project.id ? 'active' : '', item.active === false ? 'inactive' : ''].filter(Boolean).join(' ')}" style="--project-color:${esc(item.color)}" title="Show ${esc(item.title)}"></button>`).join('')}</div>
          <label class="dash-project-color-picker" title="Choose ${esc(project.title)}’s color"><input type="color" value="${esc(project.color)}"><span class="dash-color-picker-swatch"></span></label>
          <span class="dash-tag ${project.active === false ? 'muted' : 'project'}">${project.active === false ? 'Inactive' : 'Active'}</span>
        </div>
      </div>
      <div class="dash-manuscript-word-total">
        <strong>${totalWords.toLocaleString()}</strong>
        <span>${goal ? `of ${goal.toLocaleString()} words` : 'words written'}</span>
        ${goal ? `<b>${goalPercent}%</b>` : ''}
      </div>
      ${goal ? `<div class="dash-manuscript-bar"><i style="width:${goalPercent}%"></i></div>` : ''}
      <div class="dash-manuscript-details">${details.join('<span class="dash-sep">·</span>')}<span class="dash-manuscript-loose" hidden></span></div>
      <div class="dash-continue" hidden></div>`
    card.querySelectorAll('[data-progress-project]').forEach(button => {
      button.onclick = () => {
        selectDashboardProject(stats, button.dataset.progressProject)
      }
    })
    card.querySelector('[data-open-progress-project]').onclick = () => openNovelWorkspace(project.path, 'overview')
    card.querySelector('input[type="color"]').onchange = async event => {
      await window.quill.saveFolderMeta({ rel:project.path, data:{ project_color:event.target.value } })
      project.color = event.target.value
      await selectDashboardProject(stats, project.path)
    }
  }

  // ── Achievements ─────────────────────────────────────────
  // A badge is a moment: a card slides in wherever the writer is, one badge at a time when
  // several land together, and each is marked seen so it never shows twice. The editor raises
  // it after a save, the sprint timer and the time tracker after theirs, and the dashboard for
  // anything earned some other way. Clicking it opens the Achievements page.
  const _toastQueue = []
  let _toastTimer = null
  function showAchievementToast(badges) {
    if (!badges?.length) return
    const queued = new Set(_toastQueue.map(b => b.id))
    _toastQueue.push(...badges.filter(b => !queued.has(b.id)))
    window.quill.ackAchievements({ ids: badges.map(b => b.id) }).catch(() => {})
    if (!_toastTimer) nextAchievementToast()
  }

  function nextAchievementToast() {
    const el = document.getElementById('achievement-toast')
    const badge = _toastQueue.shift()
    if (!el || !badge) { _toastTimer = null; return }
    el.dataset.tier = badge.tier || 1
    el.innerHTML = `<span class="achievement-toast-icon">${esc(badge.icon)}</span>
      <span class="achievement-toast-text">
        <span class="achievement-toast-kicker">Achievement unlocked</span>
        <strong>${esc(badge.name)}</strong>
        <span class="achievement-toast-desc${badge.quip ? ' quip' : ''}">${esc(badge.quip || badge.desc)}</span>
      </span>`
    el.classList.add('show')
    const hide = () => {
      clearTimeout(_toastTimer)
      el.classList.remove('show')
      _toastTimer = setTimeout(nextAchievementToast, 350)
    }
    el.onclick = () => { hide(); openAchievements() }
    _toastTimer = setTimeout(hide, 6000)
  }

  const TIER_NAMES = { 1: 'Bronze', 2: 'Silver', 3: 'Gold' }
  function fmtBadgeProgress({ value, target, unit }) {
    if (unit === 'hours') return `${+(value / 3600).toFixed(1)} / ${target / 3600} hours`
    return `${value.toLocaleString()} / ${target.toLocaleString()}${unit ? ' ' + unit : ''}`
  }

  async function openAchievements() {
    const data = await window.quill.getAchievements().catch(() => null)
    if (!data?.ok) return
    showAchievementToast(data.fresh)
    const badges = data.badges
    const earned = badges.filter(b => b.earned).length
    const tile = b => `
      <div class="badge ${b.earned ? 'earned' : 'locked'}${b.secret && !b.earned ? ' secret' : ''}" data-tier="${b.tier}" data-badge="${esc(b.id)}"
        title="${esc(TIER_NAMES[b.tier] || '')}${b.earned ? ' · earned' + (b.date ? ' ' + new Date(b.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : ' before tracking began') : ''}">
        <div class="badge-medal"><span>${esc(b.icon)}</span></div>
        <div class="badge-name">${esc(b.name)}</div>
        <div class="badge-desc">${esc(b.desc)}</div>
        ${b.quip ? `<div class="badge-quip">${esc(b.quip)}</div>` : ''}
        ${b.earned
          ? `<div class="badge-date">${b.date ? new Date(b.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Before tracking'}</div>`
          : b.progress ? `<div class="badge-progress"><i style="width:${Math.round(b.progress.value / b.progress.target * 100)}%"></i></div>
              <div class="badge-date">${fmtBadgeProgress(b.progress)}</div>` : ''}
      </div>`
    const recent = badges.filter(b => b.earned && b.date).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 3)

    let overlay = document.getElementById('achievements-overlay')
    if (overlay) overlay.remove()
    overlay = document.createElement('div')
    overlay.id = 'achievements-overlay'
    overlay.className = 'overlay show'
    overlay.innerHTML = `
      <div class="modal achievements-modal" role="dialog" aria-label="Achievements">
        <div class="achievements-head">
          <div>
            <h3>Achievements</h3>
            <p>${earned} of ${badges.length} earned${recent.length ? ` · latest: ${recent.map(b => `${esc(b.icon)} ${esc(b.name)}`).join(', ')}` : ''}</p>
          </div>
          <div class="achievements-meter"><i style="width:${Math.round(earned / badges.length * 100)}%"></i></div>
        </div>
        ${data.categories.map(cat => {
          const list = badges.filter(b => b.cat === cat.id)
          return `<section class="achievements-cat">
            <h4>${esc(cat.name)} <span>${list.filter(b => b.earned).length}/${list.length}</span></h4>
            <div class="badge-grid">${list.map(tile).join('')}</div>
          </section>`
        }).join('')}
        <div class="modal-btns"><button class="btn primary" id="achievements-close-btn">Done</button></div>
      </div>`
    document.body.appendChild(overlay)
    const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey) }
    const onKey = e => { if (e.key === 'Escape') close() }
    document.addEventListener('keydown', onKey)
    document.getElementById('achievements-close-btn').onclick = close
    overlay.onclick = e => { if (e.target === overlay) close() }
  }

  async function renderAchievementsLink() {
    const btn = document.getElementById('dash-achievements-btn')
    if (!btn) return
    btn.onclick = () => openAchievements()
    const data = await window.quill.getAchievements().catch(() => null)
    if (!data?.ok) return
    showAchievementToast(data.fresh)
    btn.textContent = `🏆 ${data.badges.filter(b => b.earned).length}/${data.badges.length} achievements →`
  }

  // An empty library gets a way in, not just a greeting and zeroed stats.
  async function renderFirstRun() {
    const section = document.getElementById('dash-start')
    if (!section) return
    const tree = await window.quill.getTree().catch(() => null)
    const hasProject = (tree?.children || []).some(c => c.folder_type === 'novel' || c.folder_type === 'journal')
    section.hidden = hasProject
    section.querySelectorAll('[data-start-type]').forEach(btn => {
      btn.onclick = () => Tree.showProjectModal(btn.dataset.startType)
    })
  }

  async function loadDashboard() {
    await flushPendingWork()
    Editor.stopTimeTracking?.()
    await setTrackedProject('')
    refreshDashboardBackupHealth()
    // Clear context before rebuilding the global sidebar so no old scene stays highlighted.
    _currentFile       = null
    _currentFolder     = ''
    _currentFolderType = 'general'
    Tree.setActive?.(null)
    await Tree.exitProjectFocus?.()
    showView('empty')
    updateToolbarContext('empty')
    Toolbar.setKind('')
    setToolbarLocation('')
    // reset toolbar toggle states
    _bsvOpen = false; _boardMode = false; _readDraftMode = false
    document.getElementById('board-btn').classList.remove('active')
    document.getElementById('brainstorm-btn')?.classList.remove('active')
    document.getElementById('read-btn').classList.remove('active')
    document.getElementById('split-btn').classList.remove('active')
    document.getElementById('concept-art-btn')?.classList.remove('active')
    updateConceptArtBtn()
    // close split panel if open
    const splitPanel = document.getElementById('split-panel')
    if (splitPanel) splitPanel.classList.remove('open')
    const splitDiv = document.getElementById('split-divider')
    if (splitDiv) splitDiv.style.display = 'none'
    _splitOpen = false
    renderFirstRun()
    const last      = localStorage.getItem('quill_last')
    const userName  = localStorage.getItem('quill_user_name') || ''
    const greeting  = document.getElementById('dashboard-greeting')
    if (!greeting) return

    // ── Greeting ──────────────────────────────────────────────
    const hour    = new Date().getHours()
    const nameStr = userName ? `, ${userName}` : ''

    // Pool of greetings keyed by time-of-day feel, with some wildcards
    // n = name with leading comma-space, or empty. Used inline: "Coffee and Quill{n}?"
    const n = userName ? `, ${userName}` : ''

    const morningGreetings = [
      `☕ Coffee and Quill${n}?`,
      `🌅 Early start${n}.`,
      `📝 Morning pages${n}?`,
      `🌤️ Up with the draft${n}.`,
      `✨ First words first${n}.`,
      `📖 The page is waiting${n}.`,
      `🌞 Good morning${n}.`,
    ]
    const afternoonGreetings = [
      `🖊️ Back at it${n}.`,
      `☀️ Afternoon session${n}.`,
      `📚 Still writing${n}?`,
      `✍️ Mid-scene${n}?`,
      `⏳ The chapter waits${n}.`,
      `👋 Good afternoon${n}.`,
      `📄 One more scene${n}?`,
    ]
    const eveningGreetings = [
      `🌙 Evening${n}.`,
      `🛏️ One scene before bed${n}?`,
      `🤫 The quiet hours${n}.`,
      `📝 Late draft${n}.`,
      `🌑 Night mode${n}.`,
      `✨ Good evening${n}.`,
      `🕯️ Last scene of the day${n}?`,
    ]
    const lateNightGreetings = [
      `🦉 Still up${n}?`,
      `🕛 The witching hour${n}.`,
      `💭 Can't sleep${n}?`,
      `🌒 Dark o'clock${n}.`,
      `🦇 Night owl${n}.`,
      `🌌 Writing past midnight${n}.`,
    ]
    const wildcardGreetings = [
      `👋 Hello${n}.`,
      `✏️ Hey${n}.`,
      `📖 There you are${n}.`,
      `🔖 Back again${n}.`,
      `✨ Ready${n}?`,
      `🖋️ Let's write${n}.`,
      `🗡️ Hunting season${n}.`,
      `🌃 The city's awake${n}.`,
      `🩸 Something's out there${n}.`,
      `🌕 Full moon tonight${n}?`,
      `🔮 Back to the magic${n}.`,
      `🖤 The monsters missed you${n}.`,
    ]

    // time-appropriate pool, 25% wildcard chance. The dark-fantasy wildcards are for novelists;
    // a library of journals only gets the plain ones.
    const libraryTree = await window.quill.getTree().catch(() => null)
    const hasNovel = (libraryTree?.children || []).some(c => c.folder_type === 'novel')
    let greetingPool
    if (Math.random() < 0.25) {
      greetingPool = hasNovel ? wildcardGreetings : wildcardGreetings.slice(0, 6)
    } else if (hour >= 0 && hour < 5) {
      greetingPool = lateNightGreetings
    } else if (hour < 12) {
      greetingPool = morningGreetings
    } else if (hour < 18) {
      greetingPool = afternoonGreetings
    } else {
      greetingPool = eveningGreetings
    }
    const salutation = greetingPool[Math.floor(Math.random() * greetingPool.length)]

    const namePromptHtml = !userName ? `
      <div id="dash-name-row">
        <input id="dash-name-input" type="text" class="l-field" placeholder="What should I call you?">
        <button class="btn primary" id="dash-name-save">Save</button>
      </div>` : ''

    greeting.innerHTML = `
      <div class="dash-greeting">${esc(salutation)}</div>
      <div class="dash-subline" id="dash-subline"></div>
      ${namePromptHtml}`

    const nameSave = document.getElementById('dash-name-save')
    if (nameSave) {
      nameSave.onclick = () => {
        const val = document.getElementById('dash-name-input')?.value.trim()
        if (val) { localStorage.setItem('quill_user_name', val); loadDashboard() }
      }
      document.getElementById('dash-name-input')?.addEventListener('keydown', e => {
        if (e.key === 'Enter') nameSave.click()
      })
    }

    // ── Subline under greeting ─────────────────────────────────
    // General line first; selectDashboardProject re-picks once the novel's own lines are known.
    const sublineEl = document.getElementById('dash-subline')
    if (sublineEl) sublineEl.textContent = pickDashboardSubline(null)

    // Establish per-manuscript baselines before loading progress. Historical project splits
    // begin here; Quill preserves older aggregate history rather than guessing ownership.
    const census = await window.quill.censusManuscripts().catch(() => null)
    const tracked = census ? await window.quill.trackWords(census).catch(() => null) : null
    showAchievementToast(tracked?.achievements)
    const stats = await window.quill.getStats().catch(() => null)

    // ── Daily goal ────────────────────────────────────────────
    if (stats) {
      const goalInput = document.getElementById('dash-goal-input')
      if (goalInput) goalInput.value = stats.dailyGoal ? String(stats.dailyGoal) : ''
      renderDailyGoal(stats)
      initDailyGoalControls()
    }

    if (stats) renderWritingSection(stats)
    // A damaged stats file is left untouched rather than reset, so say why the numbers are empty.
    const statsError = document.getElementById('dash-stats-error')
    if (statsError) {
      statsError.textContent = stats?.statsError || ''
      statsError.hidden = !stats?.statsError
    }
    const histBtn = document.getElementById('dash-history-btn')
    if (histBtn) histBtn.onclick = openHistoryModal
    renderAchievementsLink()

    // ── Selected novel: progress, continue, glimpse ─────────
    _dashNovelPath = null
    const preferredProject = localStorage.getItem('quill_dash_active_project')
    if (preferredProject && stats?.projectProgress?.some(project => project.path === preferredProject)) {
      _dashNovelPath = preferredProject
    } else if (last) {
      _dashNovelPath = await findNovelRootFromPath(last).catch(() => null)
    }
    // if last file was not in a novel, fall back to first novel in tree
    if (!_dashNovelPath) {
      const treeForGlimpse = await window.quill.getTree().catch(() => ({ children: [] }))
      const firstNovel = (treeForGlimpse.children || []).find(c => c.folder_type === 'novel')
      if (firstNovel) _dashNovelPath = firstNovel.path
    }
    if (_dashNovelPath) {
      await selectDashboardProject(stats, _dashNovelPath)
    }
  }

  function initSectionCollapse(key, caretId, sectionId) {
    const caret   = document.getElementById(caretId)
    const section = document.getElementById(sectionId)
    if (!caret || !section) return
    const map     = JSON.parse(localStorage.getItem('quill_sections_collapsed') || '{}')
    const isCol   = !!map[key]
    section.classList.toggle('collapsed', isCol)
    caret.classList.toggle('open', !isCol)
    const toggle = () => {
      const m = JSON.parse(localStorage.getItem('quill_sections_collapsed') || '{}')
      m[key] = !m[key]
      localStorage.setItem('quill_sections_collapsed', JSON.stringify(m))
      section.classList.toggle('collapsed', !!m[key])
      caret.classList.toggle('open', !m[key])
    }
    caret.onclick = e => { e.stopPropagation(); toggle() }
  }

  async function openHistoryModal() {
    const stats = await window.quill.getStats().catch(() => null)
    if (!stats) return
    const monthWords = stats.monthWords || {}
    const totals = stats.totals || {}
    const entries = Object.entries(monthWords) // already chronological
    const peakWords = Math.max(...entries.map(([,v]) => v), 0)
    const maxWords = Math.max(peakWords, 1)
    const fmt = n => n >= 1000 ? (n/1000).toFixed(1) + 'k' : (n||0).toLocaleString()

    // Style Lab rep stats from localStorage
    const repStats = typeof StyleLab !== 'undefined' ? StyleLab.getStats() : {}

    const barsHTML = entries.map(([date, words]) => {
      // Bars with words use a real proportional height (min 8% so even small days show)
      // Empty days get a tiny 2% baseline so the chart has visible structure
      const pct = words > 0 ? Math.max(8, Math.round((words / maxWords) * 100)) : 2
      const d = new Date(date + 'T12:00:00')
      const label = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      const isPeak = words > 0 && words === peakWords
      const cls = isPeak ? ' peak' : ''
      return `<div class="history-bar${cls}" title="${label}: ${(words||0).toLocaleString()} words">
        <div class="history-bar-val">${fmt(words)}</div>
        <div class="history-bar-fill${words === 0 ? ' empty' : ''}" style="height:${pct}%"></div>
      </div>`
    }).join('')

    const firstLabel = (() => {
      const d = new Date(entries[0][0] + 'T12:00:00')
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    })()
    const lastLabel = (() => {
      const d = new Date(entries[entries.length - 1][0] + 'T12:00:00')
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    })()

    let overlay = document.getElementById('history-overlay')
    if (overlay) overlay.remove()
    overlay = document.createElement('div')
    overlay.id = 'history-overlay'
    overlay.className = 'overlay show'
    overlay.innerHTML = `
      <div class="modal history-modal">
        <h3>Your writing history</h3>
        <p>Your last 30 days of words, plus some summary numbers. Style Lab reps are tracked separately.</p>

        <div class="history-pills">
          <div class="history-pill">
            <div class="history-pill-lbl">This week</div>
            <div class="history-pill-num">${fmt(totals.thisWeek)}</div>
            <div class="history-pill-sub">words</div>
          </div>
          <div class="history-pill">
            <div class="history-pill-lbl">Last week</div>
            <div class="history-pill-num">${fmt(totals.lastWeek)}</div>
            <div class="history-pill-sub">words</div>
          </div>
          <div class="history-pill">
            <div class="history-pill-lbl">This month</div>
            <div class="history-pill-num">${fmt(totals.thisMonth)}</div>
            <div class="history-pill-sub">words (calendar)</div>
          </div>
          <div class="history-pill">
            <div class="history-pill-lbl">Last 30 days</div>
            <div class="history-pill-num">${fmt(totals.last30)}</div>
            <div class="history-pill-sub">words total</div>
          </div>
          <div class="history-pill">
            <div class="history-pill-lbl">Current streak</div>
            <div class="history-pill-num">${stats.streak || 0}</div>
            <div class="history-pill-sub">day${stats.streak === 1 ? '' : 's'}</div>
          </div>
          <div class="history-pill">
            <div class="history-pill-lbl">Longest streak</div>
            <div class="history-pill-num">${stats.longestStreak || 0}</div>
            <div class="history-pill-sub">day${stats.longestStreak === 1 ? '' : 's'}</div>
          </div>
        </div>

        <div class="history-facts-block" id="history-facts-block" hidden>
          <div class="history-chart-head history-facts-head">
            <span>Fun facts</span>
            <span class="history-facts-controls">
              <span class="seg history-facts-range" role="group" aria-label="Fun facts range">
                <button type="button" data-range="all" class="active" aria-pressed="true">All time</button>
                <button type="button" data-range="recent" aria-pressed="false">Last 30 days</button>
              </span>
              <button class="dash-text-btn" id="history-facts-more" type="button">↺ More</button>
            </span>
          </div>
          <ul class="history-facts" id="history-facts"></ul>
        </div>

        <div class="history-chart-head">
          <span>Last 30 days</span>
          ${peakWords > 0 ? `<span class="history-chart-head-peak">Peak: ${fmt(peakWords)} words · hover bars for details</span>` : ''}
        </div>
        <div class="history-chart">${barsHTML}</div>
        <div class="history-chart-labels">
          <span>${firstLabel}</span>
          <span>${lastLabel}</span>
        </div>

        <div class="history-rep-row">
          <div class="history-rep-pill">
            <div class="history-pill-lbl">Style Lab reps</div>
            <div class="history-pill-num">${repStats.totalReps || 0}</div>
            <div class="history-pill-sub">total</div>
          </div>
          <div class="history-rep-pill">
            <div class="history-pill-lbl">Reps this week</div>
            <div class="history-pill-num">${repStats.weekReps || 0}</div>
            <div class="history-pill-sub">drill${(repStats.weekReps||0) === 1 ? '' : 's'}</div>
          </div>
          <div class="history-rep-pill">
            <div class="history-pill-lbl">Rep streak</div>
            <div class="history-pill-num">${repStats.streak || 0}</div>
            <div class="history-pill-sub">day${(repStats.streak||0) === 1 ? '' : 's'}</div>
          </div>
        </div>

        <div class="modal-btns">
          <button class="btn primary" id="history-close-btn">Done</button>
        </div>
      </div>`
    document.body.appendChild(overlay)
    document.getElementById('history-close-btn').onclick = () => overlay.remove()
    overlay.onclick = e => { if (e.target === overlay) overlay.remove() }
    renderFunFacts(overlay)
  }

  // Five facts at a time, all-time or for the last 30 days; ↺ More deals five others, favoring
  // ones not just shown. Facts about a scene open it.
  async function renderFunFacts(overlay) {
    const result = await window.quill.getFunFacts?.().catch(() => null)
    const sets = { all: result?.all || [], recent: result?.recent || [] }
    const block = overlay.querySelector('#history-facts-block')
    const list = overlay.querySelector('#history-facts')
    if (!(sets.all.length || sets.recent.length) || !block || !list || !overlay.isConnected) return
    block.hidden = false
    const more = overlay.querySelector('#history-facts-more')
    const rangeBtns = [...overlay.querySelectorAll('.history-facts-head [data-range]')]
    let facts = []
    let shown = new Set()
    const setRange = range => {
      rangeBtns.forEach(btn => {
        btn.classList.toggle('active', btn.dataset.range === range)
        btn.setAttribute('aria-pressed', String(btn.dataset.range === range))
      })
      facts = sets[range]
      shown = new Set()
      more.hidden = facts.length <= 5
      deal()
    }
    rangeBtns.forEach(btn => { btn.onclick = () => setRange(btn.dataset.range) })
    const deal = () => {
      if (!facts.length) {
        list.innerHTML = '<li class="history-fact history-fact-empty">Not enough writing in the last 30 days for fun facts yet.</li>'
        return
      }
      const shuffled = facts.slice().sort(() => Math.random() - 0.5)
      const pick = [...shuffled.filter(f => !shown.has(f.id)), ...shuffled.filter(f => shown.has(f.id))].slice(0, 5)
      shown = new Set(pick.map(f => f.id))
      list.innerHTML = pick.map(f => `
        <li class="history-fact">
          <span class="history-fact-icon" aria-hidden="true">${esc(f.icon)}</span>
          <span class="history-fact-text">${esc(f.text)}${f.path
            ? ` <button class="dash-text-btn history-fact-open" type="button" data-path="${esc(f.path)}">Open →</button>` : ''}</span>
        </li>`).join('')
      list.querySelectorAll('.history-fact-open').forEach(btn => {
        btn.onclick = () => { overlay.remove(); openFile(btn.dataset.path) }
      })
    }
    more.onclick = deal
    setRange(sets.all.length ? 'all' : 'recent')
  }

  async function findNovelRootFromPath(filePath) {
    if (!filePath) return null
    const parts = filePath.split('/')
    for (let i = 1; i <= parts.length; i++) {
      const p = parts.slice(0, i).join('/')
      if (!p) continue
      try {
        const m = await window.quill.getFolderMeta(p).catch(() => ({}))
        if (m.folder_type === 'novel') return p
      } catch {}
    }
    return null
  }

  function esc(s) { return escapeHtml(s) }

  return { init, openFile, openFolder, openChapter, openTagSearch, openCommentSearch, newFile, addBoardCard,
           showView, setCurrentFolder, getCurrentFile, followRename, getCurrentFolder, showDeleteModal, confirmTrash, showAchievementToast, openAchievements,
           toggleSidebar, toggleFocus, toggleBoard, openBoard, toggleBrainstorm, loadDashboard,
           openNovelWorkspace, setManuscriptFont, updateBackBtn, updateConceptArtBtn, openTrashModal,
           openGlobalSearch, openSavedSearch, openCollection, flushPendingWork, requestName, openBackupChoice,
           toggleOutline }
})()

document.addEventListener('DOMContentLoaded', () => App.init())
