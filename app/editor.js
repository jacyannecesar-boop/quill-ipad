/* editor.js */

// A renamed or renumbered folder moves every path under it. Returns `p` rebased from `from`
// to `to`, or unchanged when it isn't inside.
function rebasePath(p, from, to) {
  if (!p || !from) return p
  if (p === from) return to
  return p.startsWith(from + '/') ? to + p.slice(from.length) : p
}

const Editor = (() => {
  let _path      = null
  let _loadedMd  = null   // body as it serializes right after open; unchanged → don't resend it
  let _goalVal   = 0
  let _saveTimer = null
  let _dotTimer  = null
  let _saveError = ''      // why the last save failed; cleared by the next one that succeeds
  let _saveFailures = 0
  let _frozen = 0          // navigations in flight; the prose editor takes no input while > 0
  let _notesFor = null     // the scene whose notes #notes-body is showing
  let _openGeneration = 0
  let _loadingDocument = false
  let _notesOpen = false
  let _ntimer    = null
  let _openWords      = 0
  let _trackedWords   = 0
  let _visit = null        // { path, md, startedAt, empty } for the procrastination badges
  let _typewriterMode = localStorage.getItem('quill_typewriter') === 'on'

  // ── Font size ─────────────────────────────────────────────
  const FS_MIN = 12
  const FS_MAX = 28
  const FS_KEY = 'quill_font_size'

  function getFontSize()      { return parseInt(localStorage.getItem(FS_KEY) || '16', 10) }
  let _shownFontSize = 16
  function applyFontSize(sz)  {
    document.getElementById('entry-body').style.fontSize = sz + 'px'
    _shownFontSize = sz
    localStorage.setItem(FS_KEY, sz)
    _renderStepper()
  }

  function _renderStepper() {
    const el = document.getElementById('fs-val')
    if (el) el.textContent = _shownFontSize
  }

  // ── Time tracking ─────────────────────────────────────────
  let _timeFilePath   = null   // which file is being timed
  let _timeStart      = null   // Date.now() when we started
  let _timeInterval   = null   // setInterval for live display
  let _timePaused     = false  // true when window is blurred
  let _timeLastActivity = 0    // last keypress, click, typing or scroll
  const TIME_IDLE_MS  = 2 * 60 * 1000  // same idle cutoff as project time in app.js

  function _timeKey(path) { return 'quill_time_' + path.replace(/[^a-z0-9]/gi, '_') }

  function _getStoredSeconds(path) {
    return parseInt(localStorage.getItem(_timeKey(path)) || '0', 10)
  }

  // Seconds since _timeStart, stopping two minutes after the last activity.
  function _activeSeconds() {
    if (!_timeStart || _timePaused) return 0
    const end = Math.min(Date.now(), _timeLastActivity + TIME_IDLE_MS)
    return Math.max(0, Math.floor((end - _timeStart) / 1000))
  }

  function _flushTime() {
    if (!_timeFilePath || !_timeStart || _timePaused) return
    const elapsed = _activeSeconds()
    // Past the idle cutoff, restart the clock so the idle stretch is never counted later.
    if (Date.now() - _timeLastActivity > TIME_IDLE_MS) _timeStart = Date.now()
    if (elapsed < 1) return
    const stored = _getStoredSeconds(_timeFilePath)
    localStorage.setItem(_timeKey(_timeFilePath), stored + elapsed)
    _timeStart = Date.now()  // reset so next flush doesn't double-count
  }

  function _noteTimeActivity() {
    const now = Date.now()
    // Coming back from idle: bank the time before the cutoff and start fresh from now.
    if (now - _timeLastActivity > TIME_IDLE_MS) _flushTime()
    _timeLastActivity = now
  }

  function _startTimeTracking(path) {
    _flushTime()  // flush any previous file
    clearInterval(_timeInterval)
    _timeFilePath = path
    _timeStart    = Date.now()
    _timeLastActivity = _timeStart
    _timePaused   = false
    _updateTimeDisplay()
    _timeInterval = setInterval(() => {
      if (!_timePaused) _updateTimeDisplay()
    }, 15000)  // update display every 15s
  }

  function _updateTimeDisplay() {
    const el = document.getElementById('time-spent')
    if (!el || !_timeFilePath) return
    const stored  = _getStoredSeconds(_timeFilePath)
    const total = stored + _activeSeconds()
    if (total < 60) { el.style.display = 'none'; return }
    const hrs  = Math.floor(total / 3600)
    const mins = Math.floor((total % 3600) / 60)
    const label = hrs > 0 ? `· ${hrs}h ${mins}m` : `· ${mins}m`
    el.textContent = label
    el.style.display = ''
    el.title = `Time spent on this scene: ${hrs > 0 ? hrs + 'h ' : ''}${mins}m`
  }

  function init() {
    // font family
    const fp = document.getElementById('font-picker')
    fp.value = localStorage.getItem('quill_font') || 'poppins'
    applyFont(fp.value)
    fp.onchange = () => {
      applyFont(fp.value)
      localStorage.setItem('quill_font', fp.value)
      if (App.getCurrentFile()) {
        scheduleSave()
        App.setManuscriptFont?.(fp.value)?.catch(() => {})
      }
    }

    // font size stepper — text size only; ⌘= / ⌘− zoom the page
    applyFontSize(getFontSize())
    // Steps from the size on screen. Inside a novel the size belongs to the whole novel, so it
    // is saved there too and every scene opens at it.
    const stepSize = delta => {
      const next = Math.min(FS_MAX, Math.max(FS_MIN, _shownFontSize + delta))
      if (next === _shownFontSize) return
      applyFontSize(next)
      if (_isNovelScene && _path) {
        window.quill.saveFolderMeta({ rel: _path.split('/')[0], data: { manuscript_font_size: next } }).catch(() => {})
      }
    }
    document.getElementById('fs-dec').onclick = () => stepSize(-1)
    document.getElementById('fs-inc').onclick = () => stepSize(1)
    window.addEventListener('quill-settings', _renderStepper)

    // time tracking: pause on blur, resume on focus
    window.addEventListener('blur',  () => { _flushTime(); _timePaused = true  })
    window.addEventListener('focus', () => { _timeStart = Date.now(); _timePaused = false; _updateTimeDisplay() })
    // time tracking: stop counting two minutes after the last keypress, click, typing or scroll
    for (const eventName of ['keydown', 'pointerdown', 'input', 'wheel']) {
      document.addEventListener(eventName, _noteTimeActivity, { passive:true })
    }

    // mood dots — delegated so dynamically-added custom dots also work
    const moodDots = document.getElementById('meta-mood-dots')
    if (moodDots) {
      moodDots.addEventListener('click', (e) => {
        const btn = e.target.closest('.mood-dot')
        if (!btn || btn.id === 'mood-add-btn') return
        const val = btn.dataset.mood || ''
        document.getElementById('mood-select').value = val
        _syncMoodDots(val)
        scheduleSave()
      })

      // right-click a CUSTOM mood → offer to remove it
      moodDots.addEventListener('contextmenu', (e) => {
        const btn = e.target.closest('.mood-dot.custom-mood')
        if (!btn) return
        e.preventDefault()
        const mood = btn.dataset.mood || ''
        if (!mood) return
        if (confirm(`Remove "${mood}" from your moods?`)) {
          _removeCustomMood(mood)
        }
      })
    }

    // load any saved custom moods
    _renderCustomMoods()

    // wire up the "+" add-mood popover
    _initMoodAdd()
    const titleInput = document.getElementById('entry-title')
    titleInput.addEventListener('input', scheduleSave)
    // A title is metadata, not the filename. Commit it immediately when editing finishes so
    // the binder cannot appear to accept a title and then lag behind the editor.
    titleInput.addEventListener('change', () => { save().catch(console.error) })
    titleInput.addEventListener('keydown', event => {
      if (event.key === 'Enter') { event.preventDefault(); titleInput.blur() }
    })
    window.QuillEditor.mount({
      element: document.getElementById('entry-body'),
      placeholder: 'Start writing…',
      onUpdate: () => {
        if (_loadingDocument) return
        updateStats(); updateGoalBar(); scheduleSave()
        Comments.onDocumentUpdate()
        Stubs.render()
        RevisionNotes.refreshInspector()
        refreshFindStatus()
      },
    })
    window.quill.onEditorCommand?.(handleEditorCommand)
    _applyTypewriterPadding()

    document.getElementById('mood-select').addEventListener('change', scheduleSave)
    document.getElementById('tags-input').addEventListener('input', scheduleSave)
    document.getElementById('notes-body').addEventListener('input', scheduleNotesSave)

    // goal bar click — inline input (prompt() disabled in Electron)
    document.getElementById('goal-row').addEventListener('click', e => {
      if (document.getElementById('goal-input-popover')) return
      const popover = document.createElement('div')
      popover.id = 'goal-input-popover'
      popover.innerHTML = `
        <input id="goal-input-field" type="number" min="0" placeholder="Word goal (0 to clear)"
          style="-webkit-user-select:text;user-select:text" value="${_goalVal||''}">
        <button id="goal-input-ok" class="btn primary">Set</button>
        <button id="goal-input-cancel" class="btn ghost sm icon" title="Cancel" aria-label="Cancel">✕</button>`
      document.getElementById('goal-row').insertAdjacentElement('afterend', popover)
      const inp = document.getElementById('goal-input-field')
      setTimeout(() => { inp.focus(); inp.select() }, 40)

      const commit = () => {
        const val = parseInt(inp.value, 10)
        _goalVal = isNaN(val) ? 0 : Math.max(0, val)
        popover.remove()
        updateGoalBar()
        scheduleSave()
      }
      document.getElementById('goal-input-ok').onclick     = commit
      document.getElementById('goal-input-cancel').onclick = () => popover.remove()
      inp.addEventListener('keydown', e => {
        if (e.key === 'Enter') commit()
        if (e.key === 'Escape') popover.remove()
      })
    })

    // inspector
    initInspector()

    // init sprint module
    Sprint.init()
    Grammar.init()

    // tag filter input
    const tagFilter = document.getElementById('tag-search-input')
    if (tagFilter) {
      tagFilter.addEventListener('input', e => {
        const q = e.target.value.toLowerCase()
        document.querySelectorAll('.tag-chip').forEach(chip => {
          chip.style.display = chip.textContent.toLowerCase().includes(q) ? '' : 'none'
        })
      })
    }

    const findBtn = document.getElementById('find-btn')
    findBtn.disabled = false
    findBtn.onclick = toggleFind
    document.getElementById('find-close-btn').onclick = closeFind
    document.getElementById('find-input').addEventListener('input', runFind)
    document.getElementById('find-prev').onclick = () => stepFind(-1)
    document.getElementById('find-next').onclick = () => stepFind(1)
    document.getElementById('find-input').addEventListener('keydown', e => {
      if (e.key === 'Enter') stepFind(e.shiftKey ? -1 : 1)
      if (e.key === 'Escape') closeFind()
    })
    document.getElementById('replace-btn').onclick = replaceOne
    document.getElementById('replace-all-btn').onclick = replaceAll
    ;['find-case','find-word','find-regex','find-selection'].forEach(id => {
      document.getElementById(id).addEventListener('change', runFind)
    })

    const commentToolbar = document.getElementById('comment-toolbar')
    commentToolbar.style.display = 'none'
    commentToolbar.removeAttribute('aria-disabled')
    commentToolbar.querySelectorAll('button').forEach(button => { button.disabled = false })
    commentToolbar.querySelectorAll('.ct-btn:not(.ct-ai-btn)').forEach(btn => {
      btn.onclick = () => Comments.addFromSelection(btn.dataset.type)
    })
    document.addEventListener('mousedown', e => {
      if (!e.target.closest('#comment-toolbar')) commentToolbar.style.display = 'none'
    })
    // Only mousedown used to hide the toolbar, so once it showed over a caret (a plain click can
    // leave the editor's selection briefly stale), typing underneath it never cleared it.
    document.addEventListener('selectionchange', () => {
      if (commentToolbar.style.display === 'none') return
      if (window.getSelection()?.isCollapsed) commentToolbar.style.display = 'none'
    })
    document.getElementById('entry-body').addEventListener('mouseup', () => {
      setTimeout(() => {
        const editor = window.QuillEditor.editor()
        const selection = editor?.state.selection
        const native = window.getSelection()
        if (!selection || selection.empty || !native?.rangeCount || native.isCollapsed) {
          commentToolbar.style.display = 'none'; return
        }
        const rect = native.getRangeAt(0).getBoundingClientRect()
        saveSelection()
        commentToolbar.style.display = 'flex'
        const left = Math.max(8, Math.min(rect.left + rect.width / 2 - commentToolbar.offsetWidth / 2,
          window.innerWidth - commentToolbar.offsetWidth - 8))
        commentToolbar.style.top = (rect.top + window.scrollY - commentToolbar.offsetHeight - 8) + 'px'
        commentToolbar.style.left = left + 'px'
      }, 10)
    })
    document.getElementById('entry-body').addEventListener('click', e => {
      const mark = e.target.closest('mark[data-cid]')
      if (mark) CommentPopover.open(mark.dataset.cid, mark.getBoundingClientRect())
    })
  }

  const WB_FIELD_LABELS = {
    'type': 'Type', 'atmosphere': 'Atmosphere', 'significance': 'Significance',
    'inhabitants': 'Who lives here', 'how_it_works': 'How it works',
    'limitations': 'Limitations / cost', 'who_can_use': 'Who can use it',
    'lore_origin': 'Lore / origin', 'goal': 'Goal', 'leadership': 'Leadership',
    'members': 'Notable members', 'relationship_to_protagonist': 'Relationship to protagonist',
    'definition': 'Definition', 'used_by': 'Used by', 'when': 'When',
    'what_happened': 'What happened', 'impact': 'Impact on present',
    'appearance': 'Appearance', 'abilities': 'Abilities', 'culture': 'Culture',
    'where_found': 'Where found', 'influence': 'Influence', 'key_figures': 'Key figures',
    'tensions': 'Tensions', 'beliefs': 'Core beliefs', 'practices': 'Practices',
    'symbols': 'Symbols', 'role_in_story': 'Role in story', 'description': 'Description',
    'notes': 'Notes',
  }

  function _syncMoodDots(val) {
    document.querySelectorAll('.mood-dot').forEach(b => {
      b.classList.toggle('active', b.dataset.mood === val)
    })
    const label = document.getElementById('meta-mood-label')
    if (label) label.textContent = val ? val : 'Mood'
  }

  // ── Custom moods ──────────────────────────────────────────
  const CUSTOM_MOODS_KEY = 'quill_custom_moods'

  function _loadCustomMoods() {
    try {
      const raw = localStorage.getItem(CUSTOM_MOODS_KEY)
      if (!raw) return []
      const arr = JSON.parse(raw)
      return Array.isArray(arr) ? arr.filter(m => m && m.emoji && m.label) : []
    } catch (e) { return [] }
  }

  function _saveCustomMoods(list) {
    localStorage.setItem(CUSTOM_MOODS_KEY, JSON.stringify(list))
  }

  function _renderCustomMoods() {
    const row = document.getElementById('meta-mood-dots')
    const addBtn = document.getElementById('mood-add-btn')
    if (!row || !addBtn) return
    // clear any previously-rendered custom dots
    row.querySelectorAll('.mood-dot.custom-mood').forEach(el => el.remove())
    const list = _loadCustomMoods()
    const hiddenSelect = document.getElementById('mood-select')
    list.forEach(m => {
      const val = `${m.emoji} ${m.label}`
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className = 'mood-dot custom-mood'
      btn.dataset.mood = val
      btn.dataset.emoji = m.emoji
      btn.title = `${m.label} (right-click to remove)`
      btn.textContent = m.emoji
      row.insertBefore(btn, addBtn)

      // make sure save-roundtrip still works by having this mood available in the hidden select
      if (hiddenSelect && !Array.from(hiddenSelect.options).some(o => o.value === val)) {
        const opt = document.createElement('option')
        opt.value = val; opt.textContent = val
        hiddenSelect.appendChild(opt)
      }
    })
    // re-sync active state in case current entry uses a custom mood
    _syncMoodDots(hiddenSelect ? hiddenSelect.value : '')
  }

  function _addCustomMood(emoji, label) {
    emoji = (emoji || '').trim()
    label = (label || '').trim()
    if (!emoji || !label) return false
    // take only the first visible character / grapheme of the emoji input
    const first = Array.from(emoji)[0]
    if (!first) return false
    const list = _loadCustomMoods()
    const val = `${first} ${label}`
    // avoid exact duplicates (same emoji + label)
    if (list.some(m => m.emoji === first && m.label.toLowerCase() === label.toLowerCase())) return false
    list.push({ emoji: first, label })
    _saveCustomMoods(list)
    _renderCustomMoods()
    return true
  }

  function _removeCustomMood(fullVal) {
    const list = _loadCustomMoods()
    const filtered = list.filter(m => `${m.emoji} ${m.label}` !== fullVal)
    _saveCustomMoods(filtered)
    // if the current entry was using this mood, clear it
    const hiddenSelect = document.getElementById('mood-select')
    if (hiddenSelect && hiddenSelect.value === fullVal) {
      hiddenSelect.value = ''
      scheduleSave()
    }
    _renderCustomMoods()
  }

  function _initMoodAdd() {
    const addBtn   = document.getElementById('mood-add-btn')
    const popover  = document.getElementById('mood-add-popover')
    const emojiIn  = document.getElementById('mood-add-emoji')
    const labelIn  = document.getElementById('mood-add-label')
    const confirm  = document.getElementById('mood-add-confirm')
    if (!addBtn || !popover) return

    const closePopover = () => {
      popover.classList.remove('open')
      emojiIn.value = ''
      labelIn.value = ''
    }

    const openPopover = () => {
      popover.classList.add('open')
      setTimeout(() => emojiIn.focus(), 0)
    }

    const tryAdd = () => {
      const ok = _addCustomMood(emojiIn.value, labelIn.value)
      if (ok) closePopover()
      else {
        // gentle shake for invalid input
        popover.animate(
          [{ transform:'translateX(0)' }, { transform:'translateX(-4px)' }, { transform:'translateX(4px)' }, { transform:'translateX(0)' }],
          { duration: 220 }
        )
      }
    }

    addBtn.onclick = (e) => {
      e.stopPropagation()
      if (popover.classList.contains('open')) closePopover()
      else openPopover()
    }
    confirm.onclick = tryAdd

    const onKey = (e) => {
      if (e.key === 'Enter') { e.preventDefault(); tryAdd() }
      else if (e.key === 'Escape') { e.preventDefault(); closePopover() }
    }
    emojiIn.addEventListener('keydown', onKey)
    labelIn.addEventListener('keydown', onKey)

    // click-outside to dismiss
    document.addEventListener('click', (e) => {
      if (!popover.classList.contains('open')) return
      if (popover.contains(e.target) || addBtn.contains(e.target)) return
      closePopover()
    })
  }

  // A visit ends when another scene opens. One that left a novel scene exactly as it found it
  // counts toward the procrastination badges; a glance under three seconds counts for nothing.
  function endVisit() {
    const visit = _visit
    _visit = null
    if (!visit || visit.path !== _path || _loadingDocument || _loadedMd === null) return
    const written = window.QuillEditor.getMarkdown() !== visit.md
    if (!written && Date.now() - visit.startedAt < 3000) return
    window.quill.recordSceneEvent?.({ rel: visit.path, type: written ? 'written-visit' : 'idle-visit', empty: visit.empty })
      .then(result => App.showAchievementToast?.(result?.achievements))
      .catch(() => {})
  }

  async function openFile(path) {
    endVisit()
    const generation = ++_openGeneration
    // Keep a copy of the scene as it is before this visit can change it.
    await window.quill.saveSnapshot({ rel: path, auto: true }).catch(() => {})
    const data = await window.quill.getFile(path)
    if (generation !== _openGeneration) return null

    _loadingDocument = true
    _path = path
    _loadedMd = null
    _wbExtraMeta = {}
    try {
    document.getElementById('entry-title').value = data.meta.title || ''
    window.QuillEditor.loadMarkdown(data.body)
    window._savedSel = null
    window._savedSelTarget = null
    _loadedMd = window.QuillEditor.getMarkdown()
    _applyIndentMode()
    _applyTypewriterPadding()
    // #editor-wrap is shared by every scene, so it still holds the last scene's scroll offset.
    const wrap = document.getElementById('editor-wrap')
    if (wrap) wrap.scrollTop = 0
    document.getElementById('entry-date').textContent = fmtDate(data.meta.date)
    document.getElementById('mood-select').value = data.meta.mood || ''
    _syncMoodDots(data.meta.mood || '')
    document.getElementById('tags-input').value = (data.meta.tags||[]).join(', ')
    document.getElementById('meta-fields').style.display = data.folder_type === 'journal' ? 'flex' : 'none'

    _goalVal = parseInt(data.meta.word_goal||'0', 10)
    updateStats(); updateGoalBar(); Stubs.render()

    // Everything save() sends must belong to this scene from the moment _path does. If this
    // open is cancelled at one of the awaits below, the previous scene's inspector values,
    // timeline fields, font or notes would otherwise be saved into this scene.
    _isNovelScene = data.folder_type === 'novel' || data.folder_type === 'act'
    _visit = _isNovelScene ? { path, md: _loadedMd, startedAt: Date.now(), empty: !_loadedMd.trim() } : null
    document.getElementById('insp-timeline-section').style.display = _isNovelScene ? '' : 'none'
    _timelineSceneState = { status:'none' }
    populateInspector(data.meta)
    document.getElementById('font-picker').value = data.meta.font || localStorage.getItem('quill_font')
      || (_isNovelScene ? 'lora' : 'poppins')
    const notesBody = document.getElementById('notes-body')
    notesBody.innerHTML = ''
    notesBody.contentEditable = 'false'
    _notesFor = null
    _applyFrozen()

    let projectFont = ''
    let projectMeta = {}
    if (data.folder_type === 'novel' || data.folder_type === 'act') {
      const projectPath = path.split('/')[0]
      projectMeta = await window.quill.getFolderMeta(projectPath).catch(() => ({}))
      if (generation !== _openGeneration) return null
      projectFont = projectMeta.manuscript_font || ''
    }
    const font = projectFont || data.meta.font || localStorage.getItem('quill_font')
      || ((data.folder_type === 'novel' || data.folder_type === 'act') ? 'lora' : 'poppins')
    document.getElementById('font-picker').value = font
    applyFont(font)
    const fontSize = parseInt(projectMeta.manuscript_font_size, 10) || getFontSize()
    applyFontSize(fontSize)

    // Paragraph indent and typewriter scrolling come from Settings only.
    _applyIndentMode()
    _applyTypewriterPadding()
    document.getElementById('font-picker').title = _isNovelScene
      ? 'Manuscript font — applies to every scene in this novel'
      : 'Font for this document'

    const nd = await window.quill.getNotes(path).catch(() => ({content:''}))
    if (generation !== _openGeneration) return null
    notesBody.innerHTML = nd.content || ''
    notesBody.contentEditable = 'true'
    _notesFor = path

    paintTimelineSceneStatus()
    if (_isNovelScene) {
      const timelineState = await window.quill.getTimelineSceneStatus({
        novelRel: path.split('/')[0], sceneRel: path,
      }).catch(() => ({ ok:false }))
      if (generation !== _openGeneration) return null
      _timelineSceneState = timelineState?.ok ? timelineState : { status:'none' }
      paintTimelineSceneStatus()
    }

    // render structured WB fields if this is a worldbible file
    renderWbFields(data)

    // load and render comments
    await Comments.load(path)
    if (generation !== _openGeneration) return null

    // start time tracking for this file
    _startTimeTracking(path)

    // Notes written elsewhere but scoped to this scene appear at the top as ghosts.
    if (_isNovelScene) RevisionNotes.sceneOpened(path).then(() => { if (_path === path) updateStats() }).catch(() => {})
    else RevisionNotes.refreshInspector()

    if (document.getElementById('inspector-scroll')?.dataset.tab === 'scraps') {
      Scraps.showDrawer(path, document.getElementById('insp-scraps'))
    }

    return data.folder_type || 'general'
    } finally {
      if (generation === _openGeneration) _loadingDocument = false
    }
  }

  function renderWbFields(data) {
    const existing = document.getElementById('wb-field-editor')
    if (existing) existing.remove()
    _wbExtraMeta = {}
    if (data.folder_type !== 'worldbible') return

    // find WB-specific fields (exclude standard frontmatter keys)
    const stdKeys = new Set(['title','date','tags','mood','word_goal','font'])
    const wbFields = Object.entries(data.meta).filter(([k]) => !stdKeys.has(k) && WB_FIELD_LABELS[k])

    // If no recognised WB fields, show ALL non-standard fields anyway
    const fieldsToRender = wbFields.length > 0
      ? wbFields
      : Object.entries(data.meta).filter(([k]) => !stdKeys.has(k))

    if (!fieldsToRender.length) return

    // seed wbExtraMeta with current values so first save doesn't lose them
    fieldsToRender.forEach(([k, v]) => { _wbExtraMeta[k] = v || '' })

    const container = document.createElement('div')
    container.id = 'wb-field-editor'
    container.innerHTML = fieldsToRender.map(([key, val]) => `
      <div class="wb-editor-field">
        <label class="wb-editor-label">${WB_FIELD_LABELS[key] || key}</label>
        <textarea class="wb-editor-input l-field" data-wbkey="${key}" rows="2"
          placeholder="—">${esc(val||'')}</textarea>
      </div>`).join('')

    // insert before the body editor
    const body = document.getElementById('entry-body')
    body.parentNode.insertBefore(container, body)

    // auto-save on input
    container.querySelectorAll('.wb-editor-input').forEach(ta => {
      ta.style.height = 'auto'
      ta.style.height = Math.max(34, ta.scrollHeight) + 'px'
      ta.addEventListener('input', () => {
        ta.style.height = 'auto'
        ta.style.height = Math.max(34, ta.scrollHeight) + 'px'
        scheduleWbFieldSave()
      })
    })
  }

  let _wbFieldTimer = null
  let _wbExtraMeta  = {}   // current session's WB field values
  let _isNovelScene = false

  function scheduleWbFieldSave() {
    clearTimeout(_wbFieldTimer)
    _wbFieldTimer = setTimeout(() => {
      _wbFieldTimer = null
      const container = document.getElementById('wb-field-editor')
      if (!container || !_path) return
      _wbExtraMeta = {}
      container.querySelectorAll('.wb-editor-input').forEach(ta => {
        _wbExtraMeta[ta.dataset.wbkey] = ta.value
      })
      // trigger normal save — main.js will preserve extra fields automatically
      save()
    }, 600)
  }

  function esc(s) { return escapeHtml(s) }

  // ── stats ─────────────────────────────────────────────────
  let _totalWords = 0
  function updateStats() {
    // Revision-note callouts sit in the page but are not prose.
    const words = RevisionNotes.countProse(document.getElementById('entry-body'))
    _totalWords = words
    const mins  = Math.ceil(words/200)
    document.getElementById('word-count').textContent = words.toLocaleString() + ' words'
    document.getElementById('read-time').textContent  = mins>0 ? '· '+mins+' min read' : ''
    return words
  }

  document.addEventListener('selectionchange', () => {
    const sel = window.getSelection()
    const body = document.getElementById('entry-body')
    const bar = document.getElementById('selection-wc')
    if (!sel || !body || !bar) return
    const text = sel.toString().trim()
    if (text && body.contains(sel.anchorNode)) {
      const selWords = QuillWords.countPlain(text)
      if (selWords > 0) {
        bar.textContent = selWords.toLocaleString() + ' of ' + _totalWords.toLocaleString() + ' words selected'
        bar.classList.add('visible')
        bar.style.display = ''
        return
      }
    }
    bar.classList.remove('visible')
  })

  function updateGoalBar() {
    const row = document.getElementById('goal-row')
    if (!_goalVal) { row.classList.remove('on'); return }
    row.classList.add('on')
    const wc  = updateStats()
    const pct = Math.min(100, Math.round((wc/_goalVal)*100))
    document.getElementById('goal-fill').style.width  = pct+'%'
    document.getElementById('goal-label').textContent = wc.toLocaleString()+' / '+_goalVal.toLocaleString()
    row.classList.toggle('done', wc >= _goalVal)
  }

  // ── save ──────────────────────────────────────────────────
  function scheduleSave() {
    if (_loadingDocument || !_path || _loadedMd === null) return
    clearTimeout(_saveTimer)
    _saveTimer = setTimeout(() => {
      _saveTimer = null
      save()
    }, 800)
    _setSaveStatus('saving')
  }

  function _setSaveStatus(status) {
    const el = document.getElementById('save-indicator')
    if (!el) return
    clearTimeout(_dotTimer)
    if (status === 'saving') {
      el.textContent = 'Saving…'
      el.className = 'save-indicator show'
    } else if (status === 'saved') {
      el.textContent = 'Saved'
      el.className = 'save-indicator show saved'
      el.title = ''
      _dotTimer = setTimeout(() => { el.className = 'save-indicator' }, 2000)
    } else if (status === 'error') {
      // Stays up until a save succeeds; the reason is one hover away.
      el.textContent = 'Not saved'
      el.className = 'save-indicator show error'
      el.title = _saveError
    }
  }

  // Track net manuscript growth. The main process census includes novel scenes only.
  async function _flushWordTracking() {
    if (!_path) return
    try {
      const census = await window.quill.censusManuscripts()
      const result = await window.quill.trackWords(census)
      App.showAchievementToast?.(result?.achievements)
    } catch {}
  }

  // Resolves true once main has the scene, false if the write failed. A failure keeps the
  // edits in the editor, says so in the toolbar, and retries with backoff; the pending retry
  // is what makes flushPending() treat the scene as unsaved.
  async function save() {
    if (!_path || _loadingDocument || _loadedMd === null) return true
    clearTimeout(_saveTimer)
    _saveTimer = null
    _flushTime()  // persist elapsed time on every save
    const tags = document.getElementById('tags-input').value.split(',').map(t=>t.trim()).filter(Boolean)
    const rel  = _path
    const md   = window.QuillEditor.getMarkdown()
    const extraMeta = { ..._wbExtraMeta }
    if (_isNovelScene) {
      extraMeta.timeline_when = _inspTimelineWhen
      extraMeta.timeline_time = _inspTimelineTime
      extraMeta.timeline_duration = _inspTimelineDuration
      extraMeta.timeline_track = _inspTimelineTrack
    }
    try {
      await window.quill.saveFile({
        rel,
        title:         document.getElementById('entry-title').value,
        // Omit the body when the prose is untouched, so a metadata-only save (tags, mood,
        // inspector fields) leaves the text on disk exactly as it was.
        body:          md === _loadedMd ? undefined : md,
        tags,
        mood:          document.getElementById('mood-select').value,
        wordGoal:      String(_goalVal||''),
        font:          document.getElementById('font-picker').value,
        extraMeta:     Object.keys(extraMeta).length ? extraMeta : undefined,
        sceneStatus:   _inspSceneStatus || '',
        scenePov:      _inspPov || '',
        sceneSetting:  _inspSetting || '',
        sceneSynopsis: _inspSynopsis || '',
        scenePurpose:  _inspPurpose || '',
      })
    } catch (error) {
      if (_path !== rel) return false
      _saveError = String(error?.message || error).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
      _saveFailures++
      _setSaveStatus('error')
      clearTimeout(_saveTimer)
      _saveTimer = setTimeout(() => { _saveTimer = null; save() }, Math.min(60000, 2000 * 2 ** (_saveFailures - 1)))
      return false
    }
    _saveError = ''
    _saveFailures = 0
    if (_path === rel) _loadedMd = md
    updateInspGoalProgress()
    // update daily word snapshot (census-based, runs after file is written)
    _flushWordTracking()
    _setSaveStatus('saved')
    Tree.refresh()
    return true
  }

  function scheduleNotesSave() {
    clearTimeout(_ntimer)
    _ntimer = setTimeout(async () => {
      _ntimer = null
      if (!_notesFor || _notesFor !== _path) return
      await window.quill.saveNotes({ rel: _notesFor, content: document.getElementById('notes-body').innerHTML })
    }, 900)
  }

  async function flushPending() {
    const saveDocument = Boolean(_saveTimer || _wbFieldTimer)
    clearTimeout(_saveTimer); _saveTimer = null
    if (_wbFieldTimer) {
      clearTimeout(_wbFieldTimer); _wbFieldTimer = null
      const container = document.getElementById('wb-field-editor')
      if (container) {
        _wbExtraMeta = {}
        container.querySelectorAll('.wb-editor-input').forEach(ta => {
          _wbExtraMeta[ta.dataset.wbkey] = ta.value
        })
      }
    }
    if (saveDocument && !(await save())) {
      const title = document.getElementById('entry-title').value.trim() || 'This scene'
      const discard = await window.quill.confirmDiscard({
        message: `“${title}” could not be saved.`,
        detail: `${_saveError}\n\nStay and Quill keeps retrying, or discard the changes made since the last save.`,
      })
      if (!discard) throw Object.assign(new Error('Unsaved scene changes.'), { stay: true })
      clearTimeout(_saveTimer); _saveTimer = null
      _saveError = ''; _saveFailures = 0
    }

    if (_ntimer) {
      clearTimeout(_ntimer); _ntimer = null
      if (_notesFor && _notesFor === _path) {
        await window.quill.saveNotes({
          rel: _notesFor,
          content: document.getElementById('notes-body').innerHTML,
        })
      }
    }
  }

  // App.openFile freezes the prose editor before flushing the scene it is leaving, and unfreezes
  // however the navigation ends. Keystrokes in between would land after that scene's last save
  // and vanish when the next scene loads. Counted, because navigations can overlap.
  function _applyFrozen() {
    const editor = window.QuillEditor.editor?.()
    if (editor && !editor.isDestroyed) editor.setEditable(_frozen === 0, false)
  }
  function freeze()   { _frozen++; _applyFrozen() }
  function unfreeze() { _frozen = Math.max(0, _frozen - 1); _applyFrozen() }

  function cancelPendingOpen() {
    _openGeneration++
    _loadingDocument = false
  }

  // ── inspector ──────────────────────────────────────────────
  let _inspSceneStatus  = 'drafting'
  let _inspSynopsis     = ''
  let _inspPov          = ''
  let _inspServes       = []   // structure beat ids (scene_beats); saved on its own, not by save()
  let _servesTemplate   = 'generic'
  let _inspSetting      = ''
  let _inspPurpose      = ''
  let _inspTimelineWhen = ''
  let _inspTimelineTime = ''
  let _inspTimelineDuration = ''
  let _inspTimelineTrack = ''
  let _timelineSceneState = { status: 'none' }

  function toggleInspector(forceState) {
    _notesOpen = forceState !== undefined ? forceState : !_notesOpen
    try { localStorage.setItem('quill_inspector_open', _notesOpen ? '1' : '0') } catch {}
    document.getElementById('inspector-panel').classList.toggle('open', _notesOpen)
    document.getElementById('notes-btn').classList.toggle('active', _notesOpen)
    if (!_notesOpen) Sprint.switchTab('notes')
  }

  function initInspector() {
    document.getElementById('inspector-close-btn').onclick = () => toggleInspector(false)

    document.getElementById('inspector-collapse-all-btn').onclick = () => {
      const sections = document.querySelectorAll('#inspector-scroll .insp-section')
      const allCollapsed = [...sections].every(s => s.classList.contains('collapsed'))
      const m = JSON.parse(localStorage.getItem('quill_sections_collapsed') || '{}')
      sections.forEach(s => {
        const key = s.id
        s.classList.toggle('collapsed', !allCollapsed)
        m[key] = !allCollapsed
        const caret = s.querySelector('.insp-caret')
        if (caret) caret.classList.toggle('open', allCollapsed)
      })
      localStorage.setItem('quill_sections_collapsed', JSON.stringify(m))
    }

    document.querySelectorAll('[data-inspector-tab]').forEach(btn => {
      btn.onclick = () => {
        const tab = btn.dataset.inspectorTab
        try { localStorage.setItem('quill_inspector_tab', tab) } catch {}
        document.querySelectorAll('[data-inspector-tab]').forEach(item => item.classList.toggle('active', item === btn))
        document.getElementById('inspector-scroll').dataset.tab = tab
        if (tab === 'scraps') Scraps.showDrawer(_path, document.getElementById('insp-scraps'))
        if (tab === 'sprint') {
          document.getElementById('insp-sprint-section').classList.remove('collapsed')
          Sprint.switchTab('sprint')
        } else {
          Sprint.switchTab('notes')
        }
      }
    })

    // status pills
    document.querySelectorAll('#insp-status-pills .insp-pill').forEach(btn => {
      btn.onclick = () => {
        _inspSceneStatus = btn.dataset.status
        document.querySelectorAll('#insp-status-pills .insp-pill').forEach(b => b.classList.remove('active'))
        btn.classList.add('active')
        scheduleSave()
      }
    })

    // inspector text fields auto-save
    const inspFields = [
      { id: 'insp-synopsis', setter: v => { _inspSynopsis = v } },
      { id: 'insp-pov',      setter: v => { _inspPov = v } },
      { id: 'insp-setting',  setter: v => { _inspSetting = v } },
      { id: 'insp-purpose',  setter: v => { _inspPurpose = v } },
      { id: 'insp-timeline-when', setter: v => { _inspTimelineWhen = v } },
      { id: 'insp-timeline-time', setter: v => { _inspTimelineTime = v } },
      { id: 'insp-timeline-duration', setter: v => { _inspTimelineDuration = v } },
      { id: 'insp-timeline-track', setter: v => { _inspTimelineTrack = v } },
    ]
    inspFields.forEach(({ id, setter }) => {
      const el = document.getElementById(id)
      if (el) el.addEventListener('input', () => {
        setter(el.value)
        if (id.startsWith('insp-timeline-') && _timelineSceneState.status === 'none') {
          _timelineSceneState = { status: 'pending' }
          paintTimelineSceneStatus()
        }
        scheduleSave()
      })
    })

    document.getElementById('insp-timeline-open').onclick = async () => {
      if (!_path || !_isNovelScene) return
      const projectPath = _path.split('/')[0]
      if (_timelineSceneState.event_id) Landing.selectTimelineEvent?.(_timelineSceneState.event_id)
      else {
        const data = await window.quill.getFile(_path).catch(() => null)
        if (data?.meta?.scene_id) Landing.selectTimelineScene?.(data.meta.scene_id)
      }
      App.openNovelWorkspace(projectPath, 'timeline')
    }

    // goal input in inspector
    const goalInput = document.getElementById('insp-goal-input')
    if (goalInput) {
      goalInput.addEventListener('change', () => {
        const val = parseInt(goalInput.value, 10)
        _goalVal = isNaN(val) ? 0 : Math.max(0, val)
        updateGoalBar()
        updateInspGoalProgress()
        scheduleSave()
      })
    }

    // collapsible sections — remembered per section across restarts
    const collapsed = (() => { try { return JSON.parse(localStorage.getItem('quill_sections_collapsed') || '{}') } catch { return {} } })()
    document.querySelectorAll('#inspector-scroll .insp-section').forEach(section => {
      if (section.id && section.id in collapsed) {
        section.classList.toggle('collapsed', Boolean(collapsed[section.id]))
        section.querySelector('.insp-caret')?.classList.toggle('open', !collapsed[section.id])
      }
    })
    document.querySelectorAll('.insp-collapsible').forEach(title => {
      title.onclick = () => {
        const section = title.closest('.insp-section')
        section.classList.toggle('collapsed')
        if (!section.id) return
        try {
          const m = JSON.parse(localStorage.getItem('quill_sections_collapsed') || '{}')
          m[section.id] = section.classList.contains('collapsed')
          localStorage.setItem('quill_sections_collapsed', JSON.stringify(m))
        } catch {}
      }
    })

    // Reopen the inspector, on the tab it was left on, if it was open last session.
    try {
      const tab = localStorage.getItem('quill_inspector_tab')
      if (tab && tab !== 'scene') document.querySelector(`[data-inspector-tab="${tab}"]`)?.click()
      if (localStorage.getItem('quill_inspector_open') === '1') toggleInspector(true)
    } catch {}
  }

  // Which of the novel's structure beats this scene serves. Written straight to frontmatter;
  // save() keeps fields it doesn't know, so the two never fight.
  async function renderServes() {
    const box = document.getElementById('insp-serves')
    if (!box) return
    box.style.display = _isNovelScene ? '' : 'none'
    if (!_isNovelScene || !_path) return
    const rel = _path
    const novel = rel.split('/')[0]
    const [meta, structure] = await Promise.all([
      window.quill.getFolderMeta(novel).catch(() => ({})),
      window.quill.getStructure(novel).catch(() => null),
    ])
    if (rel !== _path) return
    _servesTemplate = meta.beat_template || 'generic'
    const tmpl = QuillStructure.template(_servesTemplate, structure?.structure?.triangle === true)
    document.getElementById('insp-serves-chips').innerHTML = tmpl.acts.map(act =>
      `<div class="insp-serves-act">${escapeHtml(act.label)}</div>
       <div class="insp-serves-row">${act.beats.map(b => `<button type="button" class="chip insp-pill${_inspServes.includes(b.id) ? ' active' : ''}"
         data-serve="${escapeHtml(b.id)}">${escapeHtml(b.label)}</button>`).join('')}</div>`).join('')
    paintServesSummary()
    document.querySelectorAll('#insp-serves-chips [data-serve]').forEach(btn => {
      btn.onclick = () => {
        const id = btn.dataset.serve
        _inspServes = _inspServes.includes(id) ? _inspServes.filter(x => x !== id) : [..._inspServes, id]
        btn.classList.toggle('active', _inspServes.includes(id))
        paintServesSummary()
        window.quill.updateSceneMeta({ rel, beats: _inspServes }).catch(() => {})
      }
    })
  }
  function paintServesSummary() {
    const labels = QuillStructure.beatsOf(_servesTemplate, true).filter(b => _inspServes.includes(b.id)).map(b => b.label)
    document.getElementById('insp-serves-summary').textContent = labels.join(', ') || 'None'
  }

  function populateInspector(meta) {
    _inspSceneStatus = meta.scene_status || 'drafting'
    _inspSynopsis    = meta.scene_synopsis || ''
    _inspPov         = meta.scene_pov || ''
    _inspSetting     = meta.scene_setting || ''
    _inspPurpose     = meta.scene_purpose || ''
    _inspServes      = String(meta.scene_beats || '').split(',').map(id => id.trim()).filter(Boolean)
    renderServes()
    _inspTimelineWhen = meta.timeline_when || meta.story_date || meta.timeline_date || meta.story_day || meta.timeline_day || ''
    _inspTimelineTime = meta.timeline_time || meta.story_time || ''
    _inspTimelineDuration = meta.timeline_duration || ''
    _inspTimelineTrack = meta.timeline_track || ''

    document.querySelectorAll('#insp-status-pills .insp-pill').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.status === _inspSceneStatus)
    })
    document.getElementById('insp-synopsis').value = _inspSynopsis
    document.getElementById('insp-pov').value      = _inspPov
    document.getElementById('insp-setting').value  = _inspSetting
    document.getElementById('insp-purpose').value  = _inspPurpose
    document.getElementById('insp-timeline-when').value = _inspTimelineWhen
    document.getElementById('insp-timeline-time').value = _inspTimelineTime
    document.getElementById('insp-timeline-duration').value = _inspTimelineDuration
    document.getElementById('insp-timeline-track').value = _inspTimelineTrack

    const goalInput = document.getElementById('insp-goal-input')
    if (goalInput) goalInput.value = _goalVal || ''
    updateInspGoalProgress()
  }

  function paintTimelineSceneStatus() {
    const label = document.getElementById('insp-timeline-status')
    const button = document.getElementById('insp-timeline-open')
    if (!label || !button) return
    const state = _timelineSceneState || { status:'none' }
    const labels = {
      linked: `Linked to “${state.event_title || 'timeline event'}”`,
      seeded: `Timeline event exists · currently standalone`,
      pending: 'Will be added when Timeline opens',
      none: 'Not on timeline',
    }
    label.textContent = labels[state.status] || labels.none
    label.dataset.status = state.status || 'none'
    button.textContent = state.status === 'pending' ? 'Add to Timeline →'
      : state.status === 'linked' || state.status === 'seeded' ? 'View on Timeline →' : 'Open Timeline →'
  }

  function syncSynopsisFromBoard(path, synopsis) {
    if (_path !== path) return
    _inspSynopsis = synopsis || ''
    const field = document.getElementById('insp-synopsis')
    if (field) field.value = _inspSynopsis
  }

  function syncStatusFromOutliner(path, status) {
    if (_path !== path) return
    _inspSceneStatus = status || 'drafting'
    document.querySelectorAll('#insp-status-pills .insp-pill').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.status === _inspSceneStatus)
    })
  }

  // ── Typewriter mode ──────────────────────────────────────
  function toggleTypewriter(forceState) {
    _typewriterMode = forceState !== undefined ? forceState : !_typewriterMode
    localStorage.setItem('quill_typewriter', _typewriterMode ? 'on' : 'off')
    _applyTypewriterPadding()
    window.QuillEditor.refreshWritingBehavior()
  }

  function _applyTypewriterPadding() {
    const body = document.getElementById('entry-body')
    if (!body) return
    if (_typewriterMode) {
      const wrap = document.getElementById('editor-wrap')
      const h = wrap ? wrap.clientHeight : 400
      body.style.paddingBottom = Math.round(h * 0.5) + 'px'
    } else {
      body.style.paddingBottom = ''
    }
  }

  // ── Indent mode ─────────────────────────────────────────
  function toggleIndentMode(forceState) {
    const body = document.getElementById('entry-body')
    if (!body) return
    const on = forceState !== undefined ? forceState : !body.classList.contains('indent-mode')
    body.classList.toggle('indent-mode', on)
    localStorage.setItem('quill_indent_mode', on ? 'on' : 'off')
  }

  function _applyIndentMode() {
    const on = localStorage.getItem('quill_indent_mode') === 'on'
    const body = document.getElementById('entry-body')
    if (body) body.classList.toggle('indent-mode', on)
  }

  function updateInspGoalProgress() {
    const el = document.getElementById('insp-goal-progress')
    if (!el) return
    if (!_goalVal) { el.textContent = ''; return }
    const text = document.getElementById('entry-body').innerText.trim()
    const words = QuillWords.countPlain(text)
    const pct = Math.min(100, Math.round((words / _goalVal) * 100))
    el.textContent = `${words.toLocaleString()} / ${_goalVal.toLocaleString()} (${pct}%)`
  }

  // ── export ────────────────────────────────────────────────
  async function exportDoc() {
    await flushPending()
    const font = document.getElementById('font-picker').value
    const fontStack = { poppins:"'Poppins',sans-serif", lora:"'Lora',Georgia,serif",
      libsans:"Helvetica,Arial,sans-serif", baskerville:"'Baskerville','Times New Roman',serif",
      mono:"'Courier New',monospace" }[font] || 'sans-serif'
    window.quill.exportPrint({
      title:     document.getElementById('entry-title').value || 'Document',
      date:      document.getElementById('entry-date').textContent,
      bodyHTML:  window.QuillEditor.getHTML(),
      fontStack,
    })
  }

  // ── find ──────────────────────────────────────────────────
  function toggleFind() {
    const bar = document.getElementById('find-bar')
    if (bar.classList.contains('show')) { closeFind(); return }
    bar.classList.add('show')
    const input = document.getElementById('find-input')
    input.focus(); input.select()
  }
  function closeFind() {
    window.QuillEditor.clearSearch()
    document.getElementById('find-bar').classList.remove('show')
    document.getElementById('find-count').textContent=''
    window.QuillEditor.focus()
  }

  function findOptions() {
    return {
      caseSensitive: document.getElementById('find-case').checked,
      wholeWord: document.getElementById('find-word').checked,
      regex: document.getElementById('find-regex').checked,
      inSelection: document.getElementById('find-selection').checked,
    }
  }

  function refreshFindStatus(state = window.QuillEditor.searchState()) {
    const count = document.getElementById('find-count')
    if (!state) { count.textContent = ''; return }
    if (state.error) { count.textContent = 'Bad pattern'; count.title = state.error; return }
    count.title = ''
    count.textContent = state.matches.length ? `${state.index + 1}/${state.matches.length}` : 'None'
  }

  function runFind() {
    const term = document.getElementById('find-input').value
    if (!term) { window.QuillEditor.clearSearch(); document.getElementById('find-count').textContent=''; return }
    refreshFindStatus(window.QuillEditor.setSearch(term, findOptions()))
  }
  function stepFind(dir) {
    refreshFindStatus(window.QuillEditor.stepSearch(dir))
  }
  function replaceOne() {
    refreshFindStatus(window.QuillEditor.replaceCurrent(document.getElementById('replace-input').value))
  }
  function replaceAll() {
    refreshFindStatus(window.QuillEditor.replaceAll(document.getElementById('replace-input').value))
  }

  // ── font ──────────────────────────────────────────────────
  function applyFont(name) { document.getElementById('editor-inner').dataset.font = name }

  function fmtDate(s) {
    if (!s) return ''
    const d=new Date(s.replace(' ','T'))
    return isNaN(d)?s:d.toLocaleDateString('en-US',{weekday:'short',year:'numeric',month:'short',day:'numeric'})
  }

  function getTimeSpent(path) {
    const p = path || _timeFilePath
    if (!p) return 0
    const stored  = _getStoredSeconds(p)
    return stored + (_timeFilePath === p ? _activeSeconds() : 0)
  }

  function stopTimeTracking() {
    _flushTime()
    clearInterval(_timeInterval)
    _timeInterval = null
    _timeFilePath = null
    _timeStart = null
    _timePaused = true
    const el = document.getElementById('time-spent')
    if (el) el.style.display = 'none'
  }

  // Commands sent from the main process: the Edit menu, and the editor context menu.
  function handleEditorCommand(command) {
    if (command === 'thesaurus') { ThesaurusPopover.open(); return }
    if (command === 'revision-note') { RevisionNotes.insertHere(); return }
    const active = document.activeElement
    const inDocument = active?.id === 'entry-body' || active?.closest?.('#entry-body')
    if (inDocument && command === 'undo') window.QuillEditor.undo()
    else if (inDocument && command === 'redo') window.QuillEditor.redo()
    else if (command === 'undo' || command === 'redo') document.execCommand(command)
  }

  function currentPath() { return _path }

  // Main edited the open scene's file (an overview close or reopen); show what is on disk.
  async function reloadFromDisk() {
    if (!_path) return null
    return openFile(_path)
  }

  // The scene stays loaded after the writer leaves it for a folder page, so a folder rename must
  // move these too, or the next save (Cmd-S, or the flush on navigation) writes into a folder
  // that no longer exists.
  function followRename(from, to) {
    _path = rebasePath(_path, from, to)
    _notesFor = rebasePath(_notesFor, from, to)
    _timeFilePath = rebasePath(_timeFilePath, from, to)
    Comments.followRename(from, to)
  }

  return { init, openFile, save, scheduleSave, currentPath, followRename, reloadFromDisk, flushPending, cancelPendingOpen, freeze, unfreeze, syncSynopsisFromBoard, syncStatusFromOutliner,
           toggleInspector, toggleNotes: toggleInspector,
           toggleTypewriter, toggleIndentMode, applyFontSize, exportDoc, toggleFind, closeFind, getTimeSpent, stopTimeTracking,
           handleEditorCommand }
})()

// ── Comments ──────────────────────────────────────────────────
// ── Comment popover ──────────────────────────────────────────
// Inline note editor anchored to the highlight. Writing a comment used to swing the whole
// Scene Inspector open; the Inspector is now only for reviewing the full list.
const CommentPopover = (() => {
  let _el = null
  let _cid = null
  let _bound = false

  function el() {
    if (!_el) _el = document.getElementById('comment-popover')
    return _el
  }

  function bind() {
    if (_bound) return
    const root = el()
    if (!root) return
    _bound = true
    root.querySelector('#cp-close').onclick = () => close()
    root.querySelector('#cp-delete').onclick = () => {
      const cid = _cid
      close()
      if (cid) Comments.remove(cid)
    }
    root.querySelector('#cp-open-inspector').onclick = () => {
      const cid = _cid
      close()
      if (cid) Comments.show(cid)
    }
    root.querySelectorAll('.cp-type-btn').forEach(btn => {
      btn.onclick = () => {
        if (!_cid) return
        Comments.setType(_cid, btn.dataset.type)
        paintTypes(btn.dataset.type)
      }
    })
    root.querySelector('#cp-note').addEventListener('input', e => {
      if (_cid) Comments.applyNote(_cid, e.target.value)
    })
    root.querySelector('#cp-note').addEventListener('keydown', e => {
      if (e.key === 'Escape') { e.stopPropagation(); close() }
    })
    document.addEventListener('mousedown', e => {
      if (!_cid) return
      if (e.target.closest('#comment-popover')) return
      close()
    })
    document.addEventListener('keydown', e => {
      if (_cid && e.key === 'Escape') close()
    })
  }

  function paintTypes(type) {
    el()?.querySelectorAll('.cp-type-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.type === type)
    })
  }

  // Anchor above the selection when there is room, below it when there isn't — the popover is
  // tall enough that clipping at the top of the viewport is easy to hit.
  function place(rect) {
    const root = el()
    root.style.visibility = 'hidden'
    root.style.display = 'flex'
    const width  = root.offsetWidth
    const height = root.offsetHeight
    const left = Math.max(8, Math.min(rect.left + rect.width / 2 - width / 2,
      window.innerWidth - width - 8))
    let top = rect.top - height - 8
    if (top < 8) top = Math.min(rect.bottom + 8, window.innerHeight - height - 8)
    root.style.left = left + 'px'
    root.style.top  = Math.max(8, top) + 'px'
    root.style.visibility = ''
  }

  function anchorRect(cid) {
    const mark = document.querySelector(`mark[data-cid="${cid}"]`)
    if (mark) return mark.getBoundingClientRect()
    const native = window.getSelection()
    if (native?.rangeCount) {
      const rect = native.getRangeAt(0).getBoundingClientRect()
      if (rect.width || rect.height) return rect
    }
    return null
  }

  function open(cid, rect = null) {
    const comment = Comments.get(cid)
    const root = el()
    if (!comment || !root) return
    bind()
    _cid = cid
    const cfg = Comments.typeConfig(comment.type)
    root.querySelector('#cp-quote').textContent = comment.orphaned
      ? 'Anchor lost — the quoted text could not be located.'
      : `“${comment.text || ''}”`
    root.querySelector('#cp-date').textContent = comment.date || ''
    root.querySelector('#cp-delete').title = `Remove ${cfg.label.toLowerCase()}`
    const note = root.querySelector('#cp-note')
    note.value = comment.note || ''
    paintTypes(comment.type)
    place(rect || anchorRect(cid) || { left: window.innerWidth / 2, right: window.innerWidth / 2,
      top: window.innerHeight / 2, bottom: window.innerHeight / 2, width: 0, height: 0 })
    note.focus()
    note.setSelectionRange(note.value.length, note.value.length)
  }

  function close() {
    if (!_cid) return
    _cid = null
    const root = el()
    if (root) root.style.display = 'none'
    Comments.flush()
  }

  function isOpen() { return _cid != null }

  // Anchor syncing hands back fresh comment objects on every doc update; re-read the open one
  // so the quote tracks edits, but never while the note is being typed into.
  function refreshFor() {
    if (!_cid) return
    const comment = Comments.get(_cid)
    if (!comment) { close(); return }
    const root = el()
    if (document.activeElement === root.querySelector('#cp-note')) return
    root.querySelector('#cp-quote').textContent = comment.orphaned
      ? 'Anchor lost — the quoted text could not be located.'
      : `“${comment.text || ''}”`
  }

  return { open, close, isOpen, refreshFor }
})()

// ── Thesaurus popover ────────────────────────────────────────
// Synonyms for the word under the cursor, anchored to it. The lookup and all of
// its morphology happen in the main process (thesaurus.js); this only asks,
// renders, and swaps the word.
const ThesaurusPopover = (() => {
  let _el = null
  let _open = false
  let _range = null      // {from, to} of the word being replaced
  let _bound = false
  let _words = []        // flat list of buttons, for arrow-key navigation
  let _cursor = -1
  let _token = 0         // guards against a slow lookup landing after a close
  let _target = null     // scene or chapter editor selected when the lookup opened

  function el() {
    if (!_el) _el = document.getElementById('thesaurus-popover')
    return _el
  }

  function bind() {
    if (_bound) return
    const root = el()
    if (!root) return
    _bound = true
    root.querySelector('#th-close').onclick = () => close()
    document.addEventListener('mousedown', e => {
      if (!_open) return
      if (e.target.closest('#thesaurus-popover')) return
      close()
    })
    document.addEventListener('keydown', e => {
      if (!_open) return
      if (e.key === 'Escape') { e.stopPropagation(); close(); return }
      if (e.key === 'ArrowDown' || e.key === 'ArrowRight' || (e.key === 'Tab' && !e.shiftKey)) {
        e.preventDefault(); move(1)
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft' || (e.key === 'Tab' && e.shiftKey)) {
        e.preventDefault(); move(-1)
      } else if (e.key === 'Enter' && _cursor >= 0) {
        e.preventDefault(); choose(_words[_cursor].textContent)
      }
    }, true)
  }

  function move(step) {
    if (!_words.length) return
    _words[_cursor]?.classList.remove('selected')
    _cursor = (_cursor + step + _words.length) % _words.length
    const btn = _words[_cursor]
    btn.classList.add('selected')
    btn.scrollIntoView({ block: 'nearest' })
  }

  // Anchor above the word when there is room, below it when there isn't — the
  // same flip-and-clamp the comment popover uses.
  function place(rect) {
    const root = el()
    root.style.visibility = 'hidden'
    root.style.display = 'flex'
    const width  = root.offsetWidth
    const height = root.offsetHeight
    const left = Math.max(8, Math.min(rect.left + rect.width / 2 - width / 2,
      window.innerWidth - width - 8))
    let top = rect.top - height - 8
    if (top < 8) top = Math.min(rect.bottom + 8, window.innerHeight - height - 8)
    root.style.left = left + 'px'
    root.style.top  = Math.max(8, top) + 'px'
    root.style.visibility = ''
  }

  function caretRect() {
    const selection = window.getSelection()
    if (selection?.rangeCount) {
      const rect = selection.getRangeAt(0).getBoundingClientRect()
      if (rect.width || rect.height) return rect
    }
    const body = document.getElementById('entry-body')?.getBoundingClientRect()
    if (body) return { left: body.left + body.width / 2, right: body.left + body.width / 2,
      top: body.top + 80, bottom: body.top + 80, width: 0, height: 0 }
    return { left: window.innerWidth / 2, right: window.innerWidth / 2,
      top: window.innerHeight / 2, bottom: window.innerHeight / 2, width: 0, height: 0 }
  }

  function choose(word) {
    if (!_range || !_target || !word) return
    const { from, to } = _range
    const target = _target
    close()
    target.replaceWord(from, to, word)
    target.focus()
  }

  function render(result) {
    const root = el()
    const groups = root.querySelector('#th-groups')
    const empty  = root.querySelector('#th-empty')
    root.querySelector('#th-word').textContent = result.query
    // Say when the word was found under a different form, so "sprinted" coming
    // back for "ran" is not a surprise.
    root.querySelector('#th-base').textContent =
      result.base && result.base !== result.query ? `· ${result.base}` : ''

    groups.innerHTML = ''
    _words = []
    _cursor = -1

    if (!result.groups.length) {
      groups.style.display = 'none'
      empty.style.display = ''
      empty.textContent = `No synonyms for “${result.query}”.`
      return
    }
    groups.style.display = ''
    empty.style.display = 'none'

    for (const group of result.groups) {
      const section = document.createElement('div')
      section.className = 'th-group'
      const label = document.createElement('div')
      label.className = 'th-pos'
      label.textContent = group.label
      const list = document.createElement('div')
      list.className = 'th-words'
      for (const word of group.words) {
        const btn = document.createElement('button')
        btn.className = 'th-word-btn'
        btn.type = 'button'
        btn.textContent = word
        btn.onclick = () => choose(word)
        list.appendChild(btn)
        _words.push(btn)
      }
      section.appendChild(label)
      section.appendChild(list)
      groups.appendChild(section)
    }
  }

  async function open() {
    const root = el()
    const inChapter = document.getElementById('toolbar')?.dataset.view === 'chapter'
    const target = inChapter ? window.QuillChapter : window.QuillEditor
    if (!root || !target) return
    const hit = target.wordAtCursor?.()
    if (!hit) { close(); return }

    bind()
    const rect = caretRect()
    const token = ++_token
    let result
    try {
      result = await window.quill.thesaurusLookup(hit.word)
    } catch (err) {
      console.warn('Thesaurus lookup failed:', err)
      return
    }
    if (token !== _token) return      // closed or superseded while we waited
    const rel = App.getCurrentFile?.()
    if (rel) window.quill.recordSceneEvent?.({ rel, type: 'thesaurus' })
      .then(counted => App.showAchievementToast?.(counted?.achievements))
      .catch(() => {})

    _open = true
    _target = target
    _range = { from: hit.from, to: hit.to }
    render(result)
    place(rect)
  }

  function close() {
    _token++
    if (!_open) return
    _open = false
    _range = null
    _target = null
    _words = []
    _cursor = -1
    const root = el()
    if (root) root.style.display = 'none'
  }

  function isOpen() { return _open }

  return { open, close, isOpen }
})()

const Comments = (() => {
  let _path     = null
  let _comments = []   // [{id, type, text, note, date}]
  let _saveTimer = null
  let _loading = false

  const TYPE_CONFIG = {
    revisit:  { label:'Revisit',  color:'#f59e0b', bg:'#fffbeb' },
    rewrite:  { label:'Rewrite',  color:'#3b82f6', bg:'#eff6ff' },
    research: { label:'Research', color:'#8b5cf6', bg:'#f5f3ff' },
    cut:      { label:'Cut',      color:'#ef4444', bg:'#fef2f2' },
    note:     { label:'Note',     color:'#10b981', bg:'#ecfdf5' },
  }

  async function load(path) {
    if (_path !== path) CommentPopover.close()
    _path = path
    const data  = await window.quill.getComments(path).catch(() => ({ comments:[] }))
    _comments   = data.comments || []
    _loading = true
    const loaded = window.QuillEditor.loadComments(_comments, data.v || 1)
    _comments = loaded.comments
    _loading = false
    render()
    if (loaded.migrated) await save()
  }

  function scheduleSave() {
    clearTimeout(_saveTimer)
    _saveTimer = setTimeout(() => { _saveTimer = null; save() }, 500)
  }

  function onDocumentUpdate() {
    if (_loading || !_path || !_comments.length) return
    _comments = window.QuillEditor.getCommentAnchors(_comments)
    render()
    CommentPopover.refreshFor()
    scheduleSave()
  }

  function addFromSelection(type, note = '', quiet = false) {
    const id = Math.random().toString(36).slice(2,10)
    // The mark collapses the live selection's rect, so capture it before applying the mark.
    const native = window.getSelection()
    const rect = native?.rangeCount ? native.getRangeAt(0).getBoundingClientRect() : null
    const anchor = window.QuillEditor.addComment(id, type)
    if (!anchor) {
      if (!quiet) alert('Select text within a single paragraph to add a comment.')
      return false
    }
    _comments.push({ id, type, text: anchor.text, anchor: anchor.anchor, orphaned: false,
      note, date: new Date().toISOString().slice(0,10) })
    document.getElementById('comment-toolbar').style.display = 'none'
    render(); scheduleSave()
    if (!quiet) CommentPopover.open(id, rect)
    return true
  }

  function get(cid) { return _comments.find(c => c.id === cid) || null }

  function typeConfig(type) { return TYPE_CONFIG[type] || TYPE_CONFIG.note }

  // One path for note edits, shared by the popover and the Inspector card.
  function applyNote(cid, value) {
    const comment = get(cid)
    if (!comment) return
    comment.note = value
    const cfg = typeConfig(comment.type)
    const mark = document.querySelector(`mark[data-cid="${cid}"]`)
    if (mark) mark.title = `${cfg.label}${comment.note ? ': ' + comment.note : ''}`
    const card = document.querySelector(`.comment-item[data-cid="${cid}"] .comment-note`)
    if (card && card.value !== value) card.value = value
    scheduleSave()
  }

  function setType(cid, type) {
    const comment = get(cid)
    if (!comment || !TYPE_CONFIG[type] || comment.type === type) return
    comment.type = type
    window.QuillEditor.setCommentType(cid, type)
    const cfg = TYPE_CONFIG[type]
    const mark = document.querySelector(`mark[data-cid="${cid}"]`)
    if (mark) mark.title = `${cfg.label}${comment.note ? ': ' + comment.note : ''}`
    render(); scheduleSave()
  }

  function remove(cid) {
    window.QuillEditor.removeComment(cid)
    _comments = _comments.filter(c => c.id !== cid)
    scheduleSave(); render()
  }

  function show(cid) {
    Editor.toggleInspector(true)
    const section = document.getElementById('insp-comments-section')
    if (section) section.classList.remove('collapsed')
    render()
    setTimeout(() => {
      const item = document.querySelector(`.comment-item[data-cid="${cid}"]`)
      item?.scrollIntoView({ behavior:'smooth', block:'nearest' })
      item?.querySelector('.comment-note')?.focus()
    }, 80)
  }

  function render() {
    const list  = document.getElementById('comments-list')
    const empty = document.getElementById('comments-empty')
    if (!list) return
    list.innerHTML = ''
    if (!_comments.length) {
      if (empty) empty.style.display = 'block'
      return
    }
    if (empty) empty.style.display = 'none'

    _comments.forEach(c => {
      const cfg  = TYPE_CONFIG[c.type] || TYPE_CONFIG.note
      const item = document.createElement('div')
      item.className    = 'comment-item' + (c.orphaned ? ' orphaned' : '')
      item.dataset.cid  = c.id
      item.style.borderLeft = `3px solid ${cfg.color}`
      item.innerHTML = `
        <div class="comment-item-header">
          <span class="comment-type-badge" style="color:${cfg.color}">${cfg.label}</span>
          <span class="comment-date">${c.date||''}</span>
          ${c.orphaned ? '<span class="comment-orphaned" title="The quoted text could not be located">Anchor lost</span>' : ''}
          <button class="comment-del f-btn" title="Remove comment">
            <svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div class="comment-text">"${esc(c.text)}"</div>
        <textarea class="comment-note" placeholder="Add a note…" rows="2">${esc(c.note||'')}</textarea>`

      item.querySelector('.comment-note').addEventListener('input', e => {
        applyNote(c.id, e.target.value)
      })
      item.querySelector('.comment-del').onclick = () => {
        if (CommentPopover.isOpen()) CommentPopover.close()
        remove(c.id)
      }
      item.querySelector('.comment-text').onclick = () => {
        if (!c.orphaned) window.QuillEditor.goToComment(c.id)
      }
      list.appendChild(item)
    })
  }

  async function save() {
    if (!_path) return
    clearTimeout(_saveTimer); _saveTimer = null
    _comments = window.QuillEditor.getCommentAnchors(_comments)
    await window.quill.saveComments({ rel: _path, v: 2, comments: _comments }).catch(() => {})
  }

  async function flush() {
    if (_saveTimer) await save()
  }

  // Read Draft's Editor mode writes this scene's sidecar directly; drop what's in memory and
  // take the file's version so the next save doesn't put the old list back.
  async function reload() {
    if (!_path) return
    clearTimeout(_saveTimer); _saveTimer = null
    window.QuillEditor.clearComments()
    await load(_path)
  }
  window.addEventListener('quill:comments-written', e => {
    if (e.detail?.path && e.detail.path === _path) reload()
  })

  // add a freeform note comment (from AI ask popover)
  function addNote(text, noteContent) {
    if (addFromSelection('note', noteContent, true)) return
    const id = Math.random().toString(36).slice(2,10)
    _comments.push({ id, type:'note', text: text.slice(0,120), note: noteContent,
      date: new Date().toISOString().slice(0,10), orphaned: true, anchor: null })
    scheduleSave(); render()
  }

  function esc(s) { return escapeHtml(s) }

  function followRename(from, to) { _path = rebasePath(_path, from, to) }

  return { load, reload, addFromSelection, addNote, onDocumentUpdate, show, flush, render,
    get, remove, setType, applyNote, typeConfig, scheduleSave, followRename }
})()

// ── Stubs ────────────────────────────────────────────────────
// Placeholders parked in the prose as `[like this]`. There is nothing to load or save: the
// brackets are the record, so this module only lists what is currently in the document.
const Stubs = (() => {
  function esc(s) { return escapeHtml(s) }

  function render() {
    const list  = document.getElementById('stubs-list')
    const empty = document.getElementById('stubs-empty')
    const count = document.getElementById('insp-stub-count')
    if (!list) return
    const stubs = window.QuillEditor.listStubs() || []
    if (count) count.textContent = stubs.length ? String(stubs.length) : ''
    list.innerHTML = ''
    if (!stubs.length) {
      if (empty) empty.style.display = 'block'
      return
    }
    if (empty) empty.style.display = 'none'

    stubs.forEach((stub, index) => {
      const item = document.createElement('div')
      item.className = 'stub-item'
      const label = stub.inner.trim()
      item.innerHTML = `<span class="stub-item-num">${index + 1}</span>` +
        `<span class="stub-item-text">${label ? esc(label) : '<em>empty</em>'}</span>`
      // Jump by index, not by position: this list was built from an older document.
      item.onclick = () => window.QuillEditor.goToStub(index)
      list.appendChild(item)
    })
  }

  function show() {
    Editor.toggleInspector(true)
    document.getElementById('insp-stubs-section')?.classList.remove('collapsed')
    render()
  }

  return { render, show }
})()

// ── Grammar & Style Check ────────────────────────────────────
const Grammar = (() => {
  let _issues = []
  let _index = 0
  let _runVersion = 0
  let _replacements = []
  let _replacementIndex = 0

  const $modal     = document.getElementById('grammar-modal')
  const $progress  = document.getElementById('grammar-progress')
  const $sentence  = document.getElementById('grammar-sentence')
  const $message   = document.getElementById('grammar-message')
  const $suggestion = document.getElementById('grammar-suggestion')
  const $accept    = document.getElementById('grammar-accept')
  const $dismiss   = document.getElementById('grammar-dismiss')
  const $inlineCb  = document.getElementById('grammar-inline-cb')

  function esc(s) { return escapeHtml(s) }

  async function run() {
    const version = ++_runVersion
    $modal.classList.add('show')
    document.getElementById('grammar-engine').textContent = Settings.get('languageTool')
      ? 'Offline · Harper + LanguageTool'
      : 'Offline · Harper'
    $progress.textContent = ''
    $sentence.textContent = ''
    $message.textContent = 'Checking…'
    // LanguageTool may still be starting (about 10 seconds after Quill opens or after it has
    // been idle); say so rather than leaving a message that looks stuck.
    if (Settings.get('languageTool')) {
      window.quill.languageToolStatus?.().then(status => {
        if (version !== _runVersion || !$modal.classList.contains('show')) return
        if (/^Checking/.test($message.textContent)) {
          $message.textContent = status.running
            ? 'Checking with Harper and LanguageTool…'
            : 'Starting LanguageTool and checking… The first check after opening Quill can take 10–15 seconds.'
        }
      }).catch(() => {})
    }
    $suggestion.textContent = ''
    $accept.disabled = true
    $dismiss.disabled = true
    document.getElementById('grammar-skip').disabled = true
    try {
      _issues = await window.QuillEditor.runGrammarCheck()
    } catch (error) {
      console.error('Grammar check failed:', error)
      $message.textContent = 'The grammar check failed. Please try again.'
      return
    }
    if (version !== _runVersion || !$modal.classList.contains('show')) return
    if (!_issues.length) {
      $progress.textContent = ''
      $sentence.textContent = ''
      $message.textContent = 'No grammar or style issues found.'
      $suggestion.textContent = ''
      $accept.disabled = true
      $dismiss.disabled = true
      document.getElementById('grammar-skip').disabled = true
      return
    }
    _index = 0
    document.getElementById('grammar-skip').disabled = false
    show()
  }

  function show() {
    const issue = _issues[_index]
    $progress.textContent = `${_index + 1} of ${_issues.length}`

    const before = esc(issue.sentence.slice(0, issue.sentenceOffset))
    const match  = esc(issue.actual)
    const after  = esc(issue.sentence.slice(issue.sentenceOffset + issue.actual.length))
    $sentence.innerHTML = `${before}<mark class="grammar-highlight grammar-${issue.category}">${match}</mark>${after}`

    $message.textContent = issue.message
    $dismiss.disabled = !issue.ignoreHash

    _replacements = [...new Set(issue.expected || [])]
    _replacementIndex = 0
    $suggestion.replaceChildren()
    if (_replacements.length) {
      const label = document.createElement('span')
      label.className = 'grammar-suggestion-label'
      label.textContent = _replacements.length > 1 ? 'Suggestions:' : 'Suggestion:'
      $suggestion.appendChild(label)
      for (const [index, replacement] of _replacements.entries()) {
        const button = document.createElement('button')
        button.type = 'button'
        button.className = 'grammar-suggestion-choice' + (index === 0 ? ' active' : '')
        button.textContent = replacement || 'Remove'
        button.onclick = () => {
          _replacementIndex = index
          $suggestion.querySelectorAll('.grammar-suggestion-choice').forEach((choice, i) =>
            choice.classList.toggle('active', i === index))
        }
        $suggestion.appendChild(button)
      }
      $accept.disabled = false
    } else {
      $suggestion.textContent = 'No automatic fix available.'
      $accept.disabled = true
    }

    scrollToIssue(issue)
  }

  function scrollToIssue(issue) {
    const editor = window.QuillEditor.editor()
    if (!editor) return
    try {
      editor.commands.setTextSelection({ from: issue.from, to: issue.to })
      editor.commands.scrollIntoView()
    } catch {}
  }

  async function accept() {
    const issue = _issues[_index]
    if (!issue) return
    const version = ++_runVersion
    const suggestion = _replacements[_replacementIndex]
    if (!_replacements.length) return
    window.QuillEditor.applyGrammarFix(issue, suggestion)
    $accept.disabled = true
    $dismiss.disabled = true
    $message.textContent = 'Rechecking…'
    try {
      _issues = await window.QuillEditor.runGrammarCheck()
    } catch (error) {
      console.error('Grammar recheck failed:', error)
      $message.textContent = 'Harper could not recheck this scene. Please try again.'
      return
    }
    if (version !== _runVersion || !$modal.classList.contains('show')) return
    if (!_issues.length) { close(); return }
    _index = Math.min(_index, _issues.length - 1)
    show()
  }

  async function dismiss() {
    const issue = _issues[_index]
    if (!issue?.ignoreHash) return
    const version = ++_runVersion
    $accept.disabled = true
    $dismiss.disabled = true
    $message.textContent = 'Dismissing this suggestion…'
    try {
      await window.QuillEditor.dismissGrammarIssue(issue)
      _issues = await window.QuillEditor.runGrammarCheck()
    } catch (error) {
      console.error('Could not dismiss grammar suggestion:', error)
      $message.textContent = 'This suggestion could not be dismissed. Please try again.'
      $dismiss.disabled = false
      return
    }
    if (version !== _runVersion || !$modal.classList.contains('show')) return
    if (!_issues.length) { close(); return }
    _index = Math.min(_index, _issues.length - 1)
    show()
  }

  function skip() {
    _index++
    if (_index >= _issues.length) { close(); return }
    show()
  }

  function close() {
    _runVersion++
    $modal.classList.remove('show')
    window.QuillEditor.clearGrammar()
    _issues = []
    _index = 0
    _replacements = []
    _replacementIndex = 0
  }

  function initInline() {
    const saved = localStorage.getItem('quill_grammar_inline') === 'on'
    $inlineCb.checked = saved
    if (saved) window.QuillEditor.setGrammarInline(true).catch(error => {
      console.error('Could not start inline grammar checking:', error)
    })
    $inlineCb.onchange = () => {
      const on = $inlineCb.checked
      localStorage.setItem('quill_grammar_inline', on ? 'on' : 'off')
      window.QuillEditor.setGrammarInline(on).catch(error => {
        console.error('Could not update inline grammar checking:', error)
      })
      window.QuillChapter?.setGrammarInline?.(on)
      const settingsCb = document.getElementById('settings-grammar')
      if (settingsCb) settingsCb.checked = on
    }
  }

  function init() {
    document.getElementById('grammar-btn').onclick = run
    document.getElementById('grammar-close').onclick = close
    document.getElementById('grammar-skip').onclick = skip
    $dismiss.onclick = dismiss
    $accept.onclick = accept
    $modal.addEventListener('click', e => { if (e.target === $modal) close() })
    initInline()
  }

  return { init, run }
})()

// Save selection before a toolbar button steals focus
window._savedSel = null
window._savedSelTarget = null

function saveSelection(target = document.activeElement) {
  if (target?.closest('#toolbar')) return
  const sel = window.getSelection()
  if (sel && sel.rangeCount > 0) {
    window._savedSel = sel.getRangeAt(0).cloneRange()
    window._savedSelTarget = target
  }
}

function restoreSelection() {
  if (window._savedSel && window._savedSelTarget?.isConnected) {
    window._savedSelTarget.focus()
    const sel = window.getSelection()
    sel.removeAllRanges()
    sel.addRange(window._savedSel)
    return window._savedSelTarget
  }
  return null
}

function fmt(cmd, val) {
  // Try to restore a saved selection (set by toolbar button mousedown)
  const restored = restoreSelection()
  const isDocument = restored && (restored.id === 'entry-body' || restored.closest?.('#entry-body'))
  const inChapter = document.getElementById('toolbar')?.dataset.view === 'chapter'
  if (inChapter && (!restored || restored.closest?.('#chapter-body'))) {
    window.QuillChapter?.applyFormat?.(cmd, val)
    window._savedSel = null
    window._savedSelTarget = null
    return
  }
  if (restored && !isDocument) {
    document.execCommand(cmd, false, val || null)
    // trigger save for scratchpad
    if (restored.id === 'idea-scratchpad') {
      restored.dispatchEvent(new Event('input', { bubbles: true }))
    } else if (restored.classList.contains('idea-frag-rich')) {
      // Fragment saves on blur; no action needed here
    }
    window._savedSel = null
    window._savedSelTarget = null
    return
  }
  window.QuillEditor.applyFormat(cmd, val)
  window._savedSel = null
  window._savedSelTarget = null
}

function insertStub() {
  restoreSelection()
  window.QuillEditor.insertStub()
  window._savedSel = null
  window._savedSelTarget = null
  return true
}

function insertWritingBreak(type) {
  if (type !== 'scene') return false
  window.QuillEditor.insertBreak('scene')
  window._savedSel = null
  window._savedSelTarget = null
  return true
}

// Toolbar buttons declare behavior with data attributes instead of inline handlers, which
// the Content-Security-Policy blocks. `data-fmt="cmd,val;cmd2"` runs fmt() once per step.
const TOOLBAR_ACTIONS = {
  'scene-break':  () => insertWritingBreak('scene'),
  'stub':         () => insertStub(),
  'hatch-cancel': () => document.getElementById('idea-hatch-cancel').click(),
  'home':         () => App.loadDashboard(),
}
document.addEventListener('focusout', e => {
  if (e.target.closest('#entry-body')) saveSelection(e.target)
}, true)
document.addEventListener('mousedown', e => {
  if (e.target.closest('[data-save-selection]')) saveSelection()
  if (e.target.closest('[data-keep-focus]')) e.preventDefault()
}, true)
document.addEventListener('click', e => {
  const fmtEl = e.target.closest('[data-fmt]')
  if (fmtEl) {
    for (const step of fmtEl.dataset.fmt.split(';')) fmt(...step.split(','))
    return
  }
  const actionEl = e.target.closest('[data-toolbar-action]')
  if (actionEl) TOOLBAR_ACTIONS[actionEl.dataset.toolbarAction]?.()
})
