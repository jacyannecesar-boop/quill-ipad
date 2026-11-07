/* landing.js */

const Landing = (() => {
  let _path        = null
  let _meta        = {}
  let _saveTimer   = null
  let _activeTab   = 'overview'
  let _inCharSheet = false   // true when char sheet sub-view is active
  let _exitCharSheet = null  // set by openCharSheet(); called by goBack()
  let _outlinerDrag = null
  let _timelineEvents = []
  let _timelineScenes = []
  let _timelineSaveTimer = null
  let _timelineSelectedId = null
  let _timelineSelectSceneId = null
  let _timelineFilters = { track:'', character:'', thread:'', location:'', link:'' }
  let _timelineView = (() => { try { return localStorage.getItem('quill_timeline_view') } catch { return null } })()
  let _timelineAnchor = null
  let _timelineScrollKey = ''
  let _timelineLedgerOpen = false
  let _timelineDeleted = null
  let _timelineUndoTimer = null
  const OUTLINER_STATUSES = ['drafting', 'revising', 'polishing', 'done']
  // Unsaved synopsis edits by scene path. Flushed on navigation and on quit, because a focused
  // field removed by a re-render never fires blur.
  const _outlinerPending = new Map()
  // The acts last rendered by the Outliner; Copy and Export read from these.
  let _outlinerActs = []

  // ── WB Add Modal ───────────────────────────────────────────
  function showWbAddModal(sectionName, folderPath, onAdded) {
    const overlay  = document.getElementById('wb-add-modal')
    const titleEl  = document.getElementById('wb-add-modal-title')
    const input    = document.getElementById('wb-add-modal-input')
    const confirm  = document.getElementById('wb-add-modal-confirm')
    const cancel   = document.getElementById('wb-add-modal-cancel')
    if (!overlay) return

    // singular label e.g. "Locations" → "Location"
    const label = sectionName.replace(/s$/, '')
    titleEl.textContent = `New ${label}`
    input.value = ''
    overlay.classList.add('open')
    setTimeout(() => input.focus(), 60)

    const close = () => {
      overlay.classList.remove('open')
      confirm.onclick = null
      cancel.onclick  = null
      overlay.onclick = null
      document.removeEventListener('keydown', onKey)
    }

    const doAdd = async () => {
      const cardName = input.value.trim()
      if (!cardName) { input.focus(); return }
      close()
      const result = await window.quill.newWbCard({
        sectionPath: folderPath,
        sectionType: sectionName,
        cardName,
      }).catch(() => null)
      if (result) {
        await Tree.refresh()
        if (onAdded) await onAdded()
        App.openFile(result.path)
      }
    }

    const onKey = e => {
      if (e.key === 'Enter')  { e.preventDefault(); doAdd() }
      if (e.key === 'Escape') close()
    }

    confirm.onclick  = doAdd
    cancel.onclick   = close
    overlay.onclick  = e => { if (e.target === overlay) close() }
    document.addEventListener('keydown', onKey)
  }

  // ── Prompts ────────────────────────────────────────────────
  const NOVEL = [
    "Write a character who mistakes being needed for being loved.",
    "Describe the version of events where the betrayal was also an act of care.",
    "Imagine a relationship where both people are performing a version of themselves that no longer exists.",
    "Write the power in being underestimated — and the cost of it.",
    "Explore what stays romantic only because it was never acted on.",
    "Describe a compromise that quietly destroys something.",
    "Write a character whose greatest flaw is also the most interesting thing about them.",
    "Imagine the moment someone realizes the story they've been telling themselves is wrong.",
    "Write the intimacy of being witnessed doing something ordinary.",
    "Describe a rescue that makes everything worse.",
    "Write two people who want the same thing for completely opposite reasons.",
    "Explore a kindness that costs more than cruelty would have.",
    "Imagine the first time someone chooses the villain — and means it.",
    "Write a love that looks like cruelty from the outside.",
    "Describe the moment the wrong person wins, and why it almost makes sense.",
    "Write a character who is right about everything and loved by no one.",
    "Explore the thing they don't say when they finally have the chance.",
    "Imagine a world where the rules exist for a reason no one remembers — and someone is about to remember.",
    "Write the part of the story where the monster is also the only honest one.",
    "Describe a power dynamic that shifts without either person noticing until it's too late.",
    "Write someone who has rehearsed this moment so many times it no longer feels real.",
    "Explore a myth that only one person still believes — and what it costs them.",
    "Imagine a negotiation between two people who have nothing left to lose.",
    "Write the version of the fairytale where the curse was also a gift.",
  ]
  const JOURNAL = [
    "What is something you've been carrying that you haven't said out loud yet?",
    "Describe a moment from this week that surprised you.",
    "What would you tell yourself one year ago?",
    "What are you pretending not to know?",
    "Write about something small that made you feel like yourself lately.",
    "What is something you want that you're afraid to want?",
    "Who are you becoming? Is that who you want to be?",
    "Describe the last time you felt genuinely content.",
    "What conversation have you been putting off, and why?",
    "Write about something you're grateful for that you don't usually acknowledge.",
    "What would you do if you weren't afraid?",
    "What does rest look like for you right now?",
  ]

  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)] }
  function esc(s) { return escapeHtml(s) }
  function uid() { return Math.random().toString(36).slice(2,10) }

  // ── Shared overview pieces ─────────────────────────────────
  // Novel, act, chapter and World Bible pages share one layout: a header meta line, a compact
  // properties card for short fields, and auto-growing cards for long text.

  function parseCharacters(value) {
    let list = value
    if (typeof list === 'string') { try { list = JSON.parse(list) } catch { list = [] } }
    return Array.isArray(list) ? list.filter(c => c && String(c.name || '').trim()) : []
  }

  function propRow(label, control) {
    return `<div class="l-prop"><span class="l-prop-lbl">${label}</span><div class="l-prop-val">${control}</div></div>`
  }

  function propText(key, value, placeholder) {
    return `<textarea class="l-field l-auto" data-key="${key}" rows="1" placeholder="${esc(placeholder)}">${esc(value || '')}</textarea>`
  }

  function selectHTML(key, value, options, placeholder) {
    const known = options.some(([v]) => v === (value || ''))
    return `<select class="l-select" data-key="${key}">
      ${placeholder !== undefined ? `<option value="">${esc(placeholder)}</option>` : ''}
      ${options.map(([v, label]) => `<option value="${esc(v)}"${v === (value || '') ? ' selected' : ''}>${esc(label)}</option>`).join('')}
      ${value && !known ? `<option value="${esc(value)}" selected>${esc(value)}</option>` : ''}
    </select>`
  }

  // POV character picker. The saved value lives in the hidden-able text input, so a stored
  // first name ("Anna") is shown as its character ("Anna Dorsey") without being rewritten until
  // the writer picks something else.
  function povSelectHTML(key, value, characters, extras = []) {
    const current = String(value || '').trim()
    const lower = current.toLowerCase()
    const match = characters.find(c => {
      const name = String(c.name).trim().toLowerCase()
      return name === lower || name.split(/\s+/)[0] === lower
    })
    const options = characters.map(c => {
      const selected = c === match
      return `<option value="${esc(selected ? current : c.name)}"${selected ? ' selected' : ''}>${esc(c.name)}</option>`
    })
    extras.forEach(extra => options.push(`<option value="${esc(extra)}"${!match && current === extra ? ' selected' : ''}>${esc(extra)}</option>`))
    const other = Boolean(current) && !match && !extras.includes(current)
    return `<div class="l-pov">
      <select class="l-select" data-pov-select>
        <option value=""${current ? '' : ' selected'}>—</option>
        ${options.join('')}
        <option value="__other__"${other ? ' selected' : ''}>Other…</option>
      </select>
      <input class="l-field l-pov-other" type="text" data-key="${key}" value="${esc(current)}" placeholder="Name" ${other ? '' : 'hidden'}>
    </div>`
  }

  function initOverviewControls(root) {
    root.querySelectorAll('.l-pov').forEach(wrap => {
      const select = wrap.querySelector('[data-pov-select]')
      const input = wrap.querySelector('.l-pov-other')
      select.addEventListener('change', () => {
        const other = select.value === '__other__'
        input.hidden = !other
        if (other) { input.focus(); input.select(); return }
        input.value = select.value
        input.dispatchEvent(new Event('input', { bubbles:true }))
      })
    })
    root.querySelectorAll('textarea.l-auto').forEach(ta => ta.addEventListener('input', () => resizeAutoField(ta)))
    root.querySelectorAll('details').forEach(details => details.addEventListener('toggle', () => resizeAutoFields(details)))
    resizeAutoFields(root)
    root.querySelectorAll('.l-backup-btn').forEach(button => {
      button.onclick = () => App.openBackupChoice({ path:_path, name:_meta.folder_title || _path.split('/').pop(), folder_type:button.dataset.backupType })
    })
    const goal = root.querySelector('.l-meta [data-key="project_word_goal"]')
    if (goal) goal.addEventListener('input', () => updateTotals(_path, { project_word_goal:goal.value }))
  }

  // Hidden fields (inactive tab, closed <details>) measure 0, so they are sized when shown.
  function resizeAutoField(ta) {
    if (!ta.offsetParent) return
    ta.style.height = 'auto'
    ta.style.height = ta.scrollHeight + 'px'
  }
  function resizeAutoFields(root) { root.querySelectorAll('textarea.l-auto').forEach(resizeAutoField) }

  function headerMetaHTML(meta, { goalPlaceholder, status, backup } = {}) {
    return `<div class="l-meta">
      <span class="l-wc" id="l-wc"></span>
      <div class="l-prog-wrap"><div class="l-prog-bar" id="l-prog" style="width:0%"></div></div>
      <label class="l-goal">goal <input class="l-field" type="number" min="0" data-key="project_word_goal"
        placeholder="${esc(goalPlaceholder || 'words')}" value="${esc(meta.project_word_goal || '')}"></label>
      ${status || ''}
      ${backup ? `<button class="btn sm l-backup-btn" type="button" data-backup-type="${backup}">↓ Back up…</button>` : ''}
    </div>`
  }

  // ── Public entry point ─────────────────────────────────────
  async function open(folderPath, folderType) {
    await flushPending()
    _path        = folderPath
    _inCharSheet = false   // reset sub-view state on every fresh open
    _exitCharSheet = null
    _meta = await window.quill.getFolderMeta(folderPath).catch(() => ({}))
    const name        = folderPath ? folderPath.split('/').pop() : 'Quill'
    const inner       = document.getElementById('landing-inner')
    const isSubfolder = folderPath.includes('/')

    let parentType = 'general'
    if (isSubfolder) {
      parentType = await window.quill.getParentFolderType(folderPath).catch(() => 'general')
    }

    // Route to correct template
    if (folderType === 'novel' && !isSubfolder) {
      inner.innerHTML = novelTabsHTML(name, _meta)
      initNovelTabs()
    } else if (folderType === 'act') {
      inner.innerHTML = actHTML(name, _meta)
      initSimplePage('general')
      initOverviewControls(inner)
      loadActChapters(folderPath)
    } else if (folderType === 'worldbible' && parentType === 'novel') {
      // The World Bible root holds sections, not entries; show every section at once.
      inner.innerHTML = worldBibleIndexHTML(name, _meta)
      initSimplePage('general')
      initOverviewControls(inner)
      initWorldBibleIndex(folderPath)
    } else if (folderType === 'worldbible') {
      inner.innerHTML = worldBibleFolderHTML(name, _meta)
      initSimplePage('general')
      initWorldBiblePage(folderPath)
    } else if (folderType === 'novel' && isSubfolder || parentType === 'novel') {
      const novelMeta = await window.quill.getFolderMeta(folderPath.split('/')[0]).catch(() => ({}))
      inner.innerHTML = chapterHTML(name, _meta, parseCharacters(novelMeta.characters), chapterNeedsPov(novelMeta, _meta))
      initChapterPage()
    } else if (folderType === 'journal' && !isSubfolder) {
      inner.innerHTML = journalHTML(name, _meta)
      initJournalPage(folderPath)
      initOverviewControls(inner)
    } else if (folderType === 'journal' && isSubfolder) {
      inner.innerHTML = journalSubHTML(name, _meta)
      initJournalPage(folderPath)
    } else if (folderType === 'scratch') {
      inner.innerHTML = scratchHTML(name, _meta)
      initScratchPage(folderPath)
    } else if (folderType === 'stylelab') {
      inner.innerHTML = stylelabRepsHTML(name, _meta)
      initStyleLabRepsPage(folderPath)
    } else {
      inner.innerHTML = generalHTML(name, _meta)
      initSimplePage('general')
    }

    // Renaming a chapter or act from its page renames the folder too, the same way the
    // sidebar's Rename does, once the writer finishes (Enter or leaving the field).
    const titleEl = inner.querySelector('.l-title[data-key="folder_title"]')
    if (isSubfolder && titleEl && (folderType === 'act' || parentType === 'novel' || parentType === 'act' || folderType === 'novel')) {
      titleEl.addEventListener('keydown', e => { if (e.key === 'Enter') titleEl.blur() })
      titleEl.addEventListener('change', () => renameFolderToTitle(folderPath, folderType, titleEl))
    }

    updateTotals(folderPath, _meta)
  }

  async function renameFolderToTitle(folderPath, folderType, titleEl) {
    const name = titleEl.value.trim()
    if (!name || name === folderPath.split('/').pop() || _path !== folderPath) return
    await flushPending()
    await App.flushPendingWork?.()
    const result = await window.quill.rename({ rel: folderPath, newName: name }).catch(error => ({ ok: false, error: error.message }))
    if (!result?.ok) {
      alert(result?.error || 'Could not rename this folder.')
      return
    }
    App.followRename(folderPath, result.path)
    await Tree.refresh()
    await App.openFolder(result.path, folderType)
  }

  // ── Novel: tabbed layout ────────────────────────────────────

  function novelTabsHTML(name, meta) {
    return `
    <div class="nl-header">
      <div class="nl-compact page-head"><div class="kicker">${esc(meta.folder_title||name)}</div><div class="page-title" id="nl-pane-title"></div></div>
      <div class="l-badge novel">Novel</div>
      <input class="l-title" type="text" data-key="folder_title"
        placeholder="Project title…" value="${esc(meta.folder_title||name)}">
      ${headerMetaHTML(meta, { goalPlaceholder:'e.g. 90000', status:selectHTML('project_status', meta.project_status === 'inactive' ? 'inactive' : 'active', [['active','Active'],['inactive','Inactive']]), backup:'novel' })}
    </div>
    <div class="nl-tabs">
      <button class="nl-tab active" data-nltab="overview">Overview</button>
      <button class="nl-tab" data-nltab="outliner">Outliner</button>
      <button class="nl-tab" data-nltab="timeline">Timeline</button>
      <button class="nl-tab" data-nltab="audit">Audit</button>
      <button class="nl-tab" data-nltab="outline">Structure</button>
      <button class="nl-tab" data-nltab="case">Case</button>
      <button class="nl-tab" data-nltab="characters">Characters</button>
      <button class="nl-tab" data-nltab="freewrite">Scene Generator</button>
      <button class="nl-tab" data-nltab="scraps">Scraps</button>
      <button class="nl-tab" data-nltab="novelboard">Board</button>
      <button class="nl-tab" data-nltab="read">Read Draft</button>
      <button class="nl-tab" data-nltab="styleguide">Style Guide</button>
    </div>
    <div class="nl-panes">

      <!-- OVERVIEW -->
      <div class="nl-pane active" data-nlpane="overview">
        <div class="l-card l-props">
          ${propRow('Genre', propText('genre', meta.genre, 'e.g. Dark romantasy, gothic romance…'))}
          ${propRow('Pen name', propText('pen_name', meta.pen_name, 'As it goes on the title page'))}
          ${propRow('Setting', propText('setting', meta.setting, 'World, time period, vibe…'))}
          ${propRow('POV', `<div class="l-inline">
            ${selectHTML('pov_person', meta.pov_person, [['first','First person'],['second','Second person'],['third_limited','Third limited'],['third_omniscient','Third omniscient'],['multiple','Multiple POV']], 'Person')}
            ${selectHTML('tense', meta.tense, [['past','Past tense'],['present','Present tense'],['mixed','Mixed tense']], 'Tense')}
            ${povSelectHTML('pov_character', meta.pov_character, parseCharacters(meta.characters), ['Multiple'])}
          </div>`)}
          ${propRow('POV notes', propText('pov', meta.pov, 'Voice, distance, rules…'))}
        </div>
        <div class="l-stack">
          <div class="l-card"><span class="l-lbl">Logline</span>
            <textarea class="l-field l-auto" data-key="logline" rows="1"
              placeholder="One sentence that captures your story…">${esc(meta.logline||'')}</textarea></div>
          <div class="l-card"><span class="l-lbl">Synopsis</span>
            <textarea class="l-field l-auto" data-key="synopsis" rows="1"
              placeholder="What happens? What's the emotional core?">${esc(meta.synopsis||'')}</textarea></div>
          <div class="l-card"><span class="l-lbl">Themes</span>
            <textarea class="l-field l-auto" data-key="themes" rows="1"
              placeholder="The deeper questions your story wrestles with…">${esc(meta.themes||'')}</textarea></div>
        </div>
        <div class="glimpse-block" id="glimpse-block">
          <div class="glimpse-tag">From your draft</div>
          <div class="glimpse-text" id="glimpse-text">Loading…</div>
          <div class="glimpse-footer">
            <span class="glimpse-source" id="glimpse-source"></span>
            <button class="l-prompt-btn" id="glimpse-refresh">↺ Another passage</button>
          </div>
        </div>
        <details class="l-details">
          <summary>Dashboard lines</summary>
          <textarea class="l-field l-auto" data-key="dashboard_sublines" rows="2"
            placeholder="One line per row. When this novel is on the dashboard, these show up under the greeting alongside the general ones.">${esc(meta.dashboard_sublines||'')}</textarea>
        </details>
      </div>

      <!-- OUTLINER -->
      <div class="nl-pane" data-nlpane="outliner">
        <div class="novel-outliner-toolbar">
          <span>Scenes in manuscript order. Drag a scene by its handle to reorder it or move it to another chapter.</span>
          <div class="outliner-toolbar-actions">
            <span id="novel-outliner-summary"></span>
            <button class="btn sm" id="outliner-copy-btn" disabled title="Copy the outline to the clipboard">Copy outline</button>
            <button class="btn sm" id="outliner-export-btn" disabled title="Save the outline as a Word document">Export .docx</button>
          </div>
        </div>
        <div id="novel-outliner" class="novel-outliner">
          <div class="read-loading">Loading outliner…</div>
        </div>
      </div>

      <!-- TIMELINE -->
      <div class="nl-pane" data-nlpane="timeline">
        <div class="timeline-toolbar">
          <span>Events stand on their own. Link a scene only when it helps.</span>
          <div class="timeline-toolbar-actions">
            <div class="seg timeline-view-switch" role="group" aria-label="Calendar view">
              <button type="button" data-tview="month">Month</button>
              <button type="button" data-tview="week">Week</button>
              <button type="button" data-tview="day">Day</button>
            </div>
            <button class="btn sm" id="timeline-add-btn">+ Event</button>
          </div>
        </div>
        <div class="timeline-seed-note">Events with a date like “Oct 1st 2024” sit on the calendar; “ten years earlier” goes to Before, “two days later” to After, anything else to Undated. Scenes appear here automatically only when their frontmatter already contains timeline metadata.</div>
        <div id="novel-timeline" class="novel-timeline"><div class="read-loading">Loading timeline…</div></div>
      </div>

      <!-- MANUSCRIPT AUDIT -->
      <div class="nl-pane" data-nlpane="audit">
        <div class="audit-toolbar">
          <span>Objective checks from your project data. Quill does not judge your prose.</span>
          <button class="btn sm" id="audit-refresh-btn">↻ Run audit</button>
        </div>
        <div id="revision-notes-overview"></div>
        <div id="manuscript-audit"><div class="read-loading">Running audit…</div></div>
      </div>

      <!-- STRUCTURE / OUTLINE -->
      <div class="nl-pane" data-nlpane="outline">
        <div class="outline-header">
          <div class="beat-tmpl-picker">
            <span class="beat-tmpl-label">Template</span>
            <button class="chip beat-tmpl-pill active" data-tmpl="generic">3-act</button>
            <button class="chip beat-tmpl-pill" data-tmpl="romance">Romance arc</button>
            <button class="chip beat-tmpl-pill" data-tmpl="fantasy_romance">Fantasy romance</button>
            <span class="structure-actions">
              <label class="check structure-triangle" title="Adds questions about the case, and asks the plot beats about the investigation. Turning it off hides them; nothing is deleted.">
                <input type="checkbox" id="structure-mystery"> Mystery <span class="l-hint-inline">(adds the Case board)</span></label>
              <label class="check structure-triangle" title="Adds rival questions and beats. Turning it off hides them; nothing is deleted.">
                <input type="checkbox" id="structure-triangle"> Love triangle</label>
              <button class="btn sm" id="structure-copy-btn" title="Copy the whole structure as Markdown">Copy structure</button>
              <button class="btn primary" id="structure-build-btn">Build structure →</button>
            </span>
          </div>
          <div class="beat-tmpl-note" id="beat-tmpl-note"></div>
        </div>
        <div class="spine" id="beats-container"></div>
      </div>

      <!-- CASE BUILDER (renderer/casebuilder.js) -->
      <div class="nl-pane" data-nlpane="case"><div id="case-builder"></div></div>

      <!-- CHARACTERS -->
      <div class="nl-pane" data-nlpane="characters">
        <div class="char-toolbar">
          <button class="btn sm" id="char-add-btn">+ Character</button>
          <button class="btn sm" id="char-export-btn" disabled title="Save every character sheet as one Word document">Export .docx</button>
        </div>
        <div class="char-grid" id="char-grid"></div>
      </div>

      <!-- FREEWRITE -->
      <div class="nl-pane" data-nlpane="freewrite">
        <div class="freewrite-wrap">

          <!-- Scene Generator (permanent tool) -->
          <div class="seed-scene-banner" id="seed-banner">
            <div class="seed-scene-header">
              <em class="seed-scene-icon">✦</em>
              <span class="seed-scene-title">Scene generator</span>
            </div>

            <!-- Controls — plain text inputs with placeholder hints -->
            <div class="seed-controls">
              <div class="seed-ctrl">
                <span class="seed-ctrl-label">POV voice</span>
                <input class="field seed-text-input" id="seed-pov" placeholder="e.g. first person, third limited…">
              </div>
              <div class="seed-ctrl">
                <span class="seed-ctrl-label">Atmosphere</span>
                <input class="field seed-text-input" id="seed-atmosphere" placeholder="e.g. gothic dark, tender, tense…">
              </div>
              <div class="seed-ctrl">
                <span class="seed-ctrl-label">Entry point</span>
                <input class="field seed-text-input" id="seed-entry" placeholder="e.g. the moment they meet, morning after…">
              </div>
              <div class="seed-ctrl">
                <span class="seed-ctrl-label">Length</span>
                <input class="field seed-text-input" id="seed-length" placeholder="e.g. ~500 words, flash, chapter opener…">
              </div>
              <div class="seed-ctrl full">
                <span class="seed-ctrl-label">Style</span>
                <div class="style-pills-wrap" id="seed-style-pills">
                  <button class="chip style-pill active" data-style="literary">literary</button>
                  <button class="chip style-pill" data-style="descriptive">descriptive</button>
                  <button class="chip style-pill" data-style="sardonic">sardonic</button>
                  <button class="chip style-pill" data-style="spare">spare</button>
                  <button class="chip style-pill" data-style="lush">lush</button>
                  <button class="chip style-pill" data-style="raw">raw</button>
                  <button class="chip style-pill" data-style="dreamlike">dreamlike</button>
                </div>
                <input class="field seed-text-input seed-custom-text" id="seed-custom-text" placeholder="or describe your own style…">
              </div>
            </div>

            <!-- AI settings row -->
            <div class="seed-settings-row">
              <button type="button" class="ai-model-link" data-open-settings="ai" title="Change the model in Settings → AI">Model: <span id="seed-model-name"></span></button>
              <button class="btn ghost sm seed-instr-btn" id="seed-instr-toggle">Instructions ›</button>
            </div>

            <!-- Instructions panel (collapsed by default) -->
            <div class="seed-instr-panel" id="seed-instr-panel" style="display:none">
              <div class="seed-instr-hint">Customize the AI's writing role. Leave blank to use the default.</div>
              <textarea class="field seed-instr-ta" id="seed-instr-ta" placeholder="You are a literary fiction writer specializing in dark romance…"></textarea>
              <div class="seed-instr-btns">
                <button class="btn sm primary" id="seed-instr-save">Save</button>
                <button class="btn sm" id="seed-instr-reset">Reset</button>
              </div>
            </div>

            <!-- Generated output (hidden until generated) -->
            <div class="seed-output" id="seed-output" style="display:none">
              <div class="seed-output-label">
                <span class="seed-output-dot"></span>
                <span id="seed-output-label-text">Scene</span>
              </div>
              <div class="seed-output-text" id="seed-output-text"></div>
              <div class="seed-output-actions">
                <button class="btn sm primary seed-action-btn" id="seed-open-btn">Open as new scene →</button>
                <button class="btn sm seed-action-btn" id="seed-copy-btn">Copy</button>
                <button class="btn sm seed-action-btn" id="seed-regen-btn">Regenerate</button>
                <button class="btn sm seed-action-btn" id="seed-brainstorm-btn">Send to Brainstorm</button>
              </div>
            </div>

            <!-- Footer / generate button -->
            <div class="seed-footer">
              <button class="btn primary seed-generate-btn" id="seed-generate-btn">Generate scene</button>
              <span class="seed-footer-note" id="seed-footer-note">Uses your novel's characters, genre, and logline as context</span>
            </div>
          </div>

          <div class="freewrite-hint">Looking for your brain dump? Loose ideas live in <b>Scraps</b> now; anything you wrote here is pinned there.</div>
        </div>
      </div>

      <!-- SCRAPS -->
      <div class="nl-pane" data-nlpane="scraps">
        <div class="novel-scraps" id="novel-scraps"></div>
      </div>

      <!-- NOVEL BOARD (all chapters as columns) -->
      <div class="nl-pane" data-nlpane="novelboard">
        <div class="novel-board-hint">
          A card for every scene, one column per chapter. Pick a chapter under Show to edit its cards in full.
        </div>
        <div class="novel-board-canvas" id="novel-board-canvas"></div>
      </div>

      <!-- READ DRAFT -->
      <div class="nl-pane" data-nlpane="read">
        <div class="read-toolbar">
          <span class="read-hint">Your full draft, stitched in order.</span>
          <button class="btn sm" id="read-copy-btn" title="Copy the chapters with written prose as Markdown">Copy prose</button>
          <button class="btn sm" id="read-export-btn" title="Only chapters with written prose">Export prose (.md)</button>
        </div>
        <div id="read-content" class="read-content">
          <div class="read-loading">Loading draft…</div>
        </div>
      </div>

      <!-- STYLE GUIDE -->
      <div class="nl-pane" data-nlpane="styleguide">
        <div class="styleguide-pane">
          <div class="styleguide-intro">Your writing rules, clich\u00e9s to avoid, voice notes, and style preferences. Automatically included in every Brainstorm and Ask AI response.</div>
          <textarea class="l-field styleguide-ta" data-key="writing_guide"
            placeholder="e.g. Avoid: \'she didn\'t realize\', eyes as emotional shorthand, mirroring dialogue tags\u2026" spellcheck="false">${esc(meta.writing_guide||'')}</textarea>

          <p class="styleguide-intro" style="margin-top:18px">Manuscript font and size are set from the toolbar while you write in this novel; spacing, indent and typewriter scrolling are in Settings (⌘,).</p>
        </div>
      </div>

    </div>`
  }

  // The novel's old Freewrite box now lives in Scraps: its text becomes pinned scraps (split
  // where a single scrap would be too long), and the box is cleared only after they're saved.
  async function moveFreewriteToScraps(novelPath) {
    const text = String(_meta.freewrite || '').trim()
    if (!text) return
    const chunks = []
    let current = ''
    for (const para of text.split(/\n{2,}/)) {
      if (current && (current.length + para.length + 2) > 18000) { chunks.push(current); current = '' }
      current = current ? current + '\n\n' + para : para
      while (current.length > 18000) { chunks.push(current.slice(0, 18000)); current = current.slice(18000) }
    }
    if (current) chunks.push(current)
    const data = await window.quill.getScraps(novelPath).catch(() => null)
    if (!data) return
    const now = new Date().toISOString()
    const moved = chunks.map((chunk, i) => ({
      id: Math.random().toString(36).slice(2, 10), text: chunk,
      note: chunks.length > 1 ? `From the Freewrite tab (${i + 1} of ${chunks.length})` : 'From the Freewrite tab',
      color: 'sand', kept: true, used: false, used_in: null, created: now,
    }))
    const result = await window.quill.saveScraps({ novelRel: novelPath, scraps: [...moved, ...(data.scraps || [])] }).catch(() => null)
    if (!result?.ok) return
    _meta.freewrite = ''
    await window.quill.saveFolderMeta({ rel: novelPath, data: { freewrite: '' } }).catch(() => {})
  }

  const TAB_TITLES = { audit:'Manuscript Audit', novelboard:'Board' }

  function initNovelTabs() {
    const inner = document.getElementById('landing-inner')
    moveFreewriteToScraps(_path)

    // tab switching
    inner.querySelectorAll('.nl-tab').forEach(tab => {
      tab.onclick = () => {
        inner.querySelectorAll('.nl-tab').forEach(t => t.classList.remove('active'))
        inner.querySelectorAll('.nl-pane').forEach(p => p.classList.remove('active'))
        tab.classList.add('active')
        inner.querySelector(`[data-nlpane="${tab.dataset.nltab}"]`).classList.add('active')
        _activeTab = tab.dataset.nltab
        const paneTitle = document.getElementById('nl-pane-title')
        if (paneTitle) paneTitle.textContent = TAB_TITLES[tab.dataset.nltab] || tab.textContent
        resizeAutoFields(inner.querySelector(`[data-nlpane="${tab.dataset.nltab}"]`))
        if (tab.dataset.nltab === 'outliner') {
          loadNovelOutliner(_path)
        }
        if (tab.dataset.nltab !== 'case') CaseBuilder.flush()
        if (tab.dataset.nltab === 'case') CaseBuilder.load(_path, document.getElementById('case-builder'))
        if (tab.dataset.nltab === 'timeline') loadTimeline(_path)
        if (tab.dataset.nltab === 'audit') loadManuscriptAudit(_path)
        if (tab.dataset.nltab === 'scraps') {
          const wall = document.getElementById('novel-scraps')
          if (wall) Scraps.showWall(_path, wall)
        }
        // lazy-load novel board when tab is clicked
        if (tab.dataset.nltab === 'novelboard') {
          const canvas = document.getElementById('novel-board-canvas')
          if (canvas) Board.showNovelOverview(_path, canvas)
        }
        // lazy-load read draft when tab is clicked
        if (tab.dataset.nltab === 'read') {
          loadReadDraft(_path)
        }
      }
    })

    // export button (also wired inside read pane)
    inner.addEventListener('click', e => {
      if (e.target.id === 'read-export-btn') exportNovelMd(_path)
      if (e.target.id === 'read-copy-btn') copyNovelMd(_path, e.target)
    })

    // load glimpse on open
    loadGlimpse(_path)
    initSeedScene(_path, _meta)

    // autosave on all [data-key] fields
    inner.querySelectorAll('[data-key]').forEach(el => {
      el.addEventListener('input',  scheduleSave)
      el.addEventListener('change', scheduleSave)
    })
    inner.querySelectorAll('[data-mkey]').forEach(el => {
      el.addEventListener('input',  scheduleSave)
      el.addEventListener('change', scheduleSave)
    })

    initOverviewControls(inner)

    // structure beats — picker + spine; the builder does the writing
    inner.querySelectorAll('.beat-tmpl-pill').forEach(pill => {
      pill.onclick = () => {
        const key = pill.dataset.tmpl
        _meta.beat_template = key
        scheduleSave()
        renderBeats(key)
      }
    })
    inner.querySelector('#structure-build-btn').onclick = () => {
      const beats = QuillStructure.beatsOf(_meta.beat_template, _structure.triangle)
      const next = beats.find(b => QuillStructure.beatState(b.id, _meta.beats || {}, _structure) !== 'mine')
      const started = Object.values(_structure.foundation || {}).some(v => String(v).trim())
      openStructureBuilder(started && next ? next.id : null)
    }
    inner.querySelector('#structure-copy-btn').onclick = e => copyStructure(e.currentTarget)
    // A love triangle adds rival questions and beats. Off hides them; the answers stay saved.
    inner.querySelector('#structure-mystery').onchange = async e => {
      _structure = { ..._structure, mystery: e.target.checked }
      renderBeats()
      await window.quill.saveStructure({ novelRel: _path, structure: _structure }).catch(() => {})
      Tree.refresh()   // shows or hides the Case row
    }
    inner.querySelector('#structure-triangle').onchange = async e => {
      _structure = { ..._structure, triangle: e.target.checked }
      renderBeats()
      await window.quill.saveStructure({ novelRel: _path, structure: _structure }).catch(() => {})
    }
    migrateBeats()
    renderBeats()
    loadStructure().then(() => renderBeats())

    // characters
    renderCharacters(_meta.characters || [])
    inner.querySelector('#char-add-btn').onclick = () => addCharacter()
    inner.querySelector('#timeline-add-btn').onclick = () => addTimelineEvent()
    inner.querySelector('#audit-refresh-btn').onclick = () => loadManuscriptAudit(_path)
    inner.querySelectorAll('[data-tview]').forEach(button => {
      button.onclick = () => setTimelineView(button.dataset.tview)
    })
  }

  async function loadTimeline(novelPath) {
    clearTimeout(_timelineSaveTimer)
    _timelineSaveTimer = null
    clearTimeout(_timelineUndoTimer)
    _timelineUndoTimer = null
    _timelineDeleted = null
    const container = document.getElementById('novel-timeline')
    if (!container) return
    container.innerHTML = '<div class="read-loading">Loading timeline…</div>'
    const result = await window.quill.getTimeline(novelPath).catch(error => ({ ok:false, error:error.message }))
    if (!document.body.contains(container)) return
    if (!result?.ok) {
      container.innerHTML = `<div class="outliner-empty">${esc(result?.error || 'Could not load the timeline.')}</div>`
      return
    }
    _timelineEvents = result.events || []
    _timelineScenes = result.scenes || []
    _timelineAnchor = null
    _timelineScrollKey = ''
    if (_timelineSelectSceneId) {
      _timelineSelectedId = _timelineEvents.find(event =>
        event.scene_id === _timelineSelectSceneId || event.seed_scene_id === _timelineSelectSceneId)?.id || null
      _timelineSelectSceneId = null
    }
    if (!_timelineEvents.some(event => event.id === _timelineSelectedId)) _timelineSelectedId = null
    renderTimeline()
  }

  async function loadManuscriptAudit(novelPath) {
    const container = document.getElementById('manuscript-audit')
    if (!container) return
    RevisionNotes.renderOverview(document.getElementById('revision-notes-overview'), novelPath)
    container.innerHTML = '<div class="read-loading">Running audit…</div>'
    const result = await window.quill.getManuscriptAudit(novelPath)
      .catch(error => ({ ok:false, error:error.message }))
    if (!document.body.contains(container)) return
    if (!result?.ok) {
      container.innerHTML = `<div class="outliner-empty">${esc(result?.error || 'Could not run the audit.')}</div>`
      return
    }
    renderManuscriptAudit(result)
  }

  function auditDistribution(title, values) {
    const entries = Object.entries(values || {}).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    if (!entries.length) return ''
    return `<section class="audit-distribution"><strong>${esc(title)}</strong><div>${entries.map(([label, count]) =>
      `<span>${esc(label)} <b>${count}</b></span>`).join('')}</div></section>`
  }

  function renderManuscriptAudit(result) {
    const container = document.getElementById('manuscript-audit')
    if (!container) return
    const summary = result.summary || {}
    const findings = result.findings || []
    const active = findings.filter(finding => finding.status === 'active')
    const reviewed = findings.filter(finding => finding.status !== 'active')
    const cards = [
      ['Scenes', summary.scenes || 0],
      ['Manuscript words', Number(summary.words || 0).toLocaleString()],
      ['Needs attention', active.filter(finding => finding.severity === 'attention').length],
      ['Open checks', active.length],
    ]
    const severityRank = { attention:0, review:1, info:2 }
    const findingHtml = finding => `<article class="audit-finding severity-${esc(finding.severity)}" data-audit-finding="${esc(finding.id)}" data-audit-rule="${esc(finding.rule)}">
      <div class="audit-finding-mark" aria-hidden="true"></div>
      <div class="audit-finding-copy">
        <div class="audit-finding-meta"><span>${esc(finding.category)}</span><span>${esc(finding.severity)}</span>${finding.status !== 'active' ? `<span>${esc(finding.status.replace('-', ' '))}</span>` : ''}</div>
        <strong>${esc(finding.title)}</strong><p>${esc(finding.detail)}</p>
      </div>
      <div class="audit-finding-actions">
        <button type="button" data-audit-open>${finding.target.kind === 'timeline' ? 'Open timeline' : 'Open scene'}</button>
        ${finding.status === 'active'
          ? '<button type="button" data-audit-state="resolved">Resolve</button><button type="button" data-audit-state="ignored">Ignore</button><button type="button" data-audit-state="not-applicable">N/A</button>'
          : '<button type="button" data-audit-state="active">Restore</button>'}
      </div>
    </article>`
    const grouped = [...new Set(active.map(finding => finding.category))].sort().map(category => {
      const rows = active.filter(finding => finding.category === category)
        .sort((a, b) => severityRank[a.severity] - severityRank[b.severity] || a.title.localeCompare(b.title))
      return `<section class="audit-group"><h3>${esc(category)} <span>${rows.length}</span></h3>${rows.map(findingHtml).join('')}</section>`
    }).join('')
    container.innerHTML = `
      <div class="audit-summary">${cards.map(([label, value]) => `<div><strong>${value}</strong><span>${label}</span></div>`).join('')}</div>
      <div class="audit-distributions">
        ${auditDistribution('Scene status', summary.statusCounts)}
        ${auditDistribution('Scene POV', summary.povCounts)}
        ${auditDistribution('Timeline threads', summary.threadCounts)}
      </div>
      <div class="audit-evidence"><span>${summary.comments || 0} comments</span><span>${summary.stubs || 0} placeholders</span><span>${summary.timelineEvents || 0} timeline events</span><span>${summary.chapters || 0} chapters</span>${summary.medianSceneWords ? `<span>${summary.medianSceneWords.toLocaleString()} median scene words</span>` : ''}</div>
      <div class="audit-findings">${grouped || '<div class="audit-clear"><strong>No active findings.</strong><span>Your explicit metadata, comments, placeholders, links, and continuity facts are clear.</span></div>'}</div>
      ${reviewed.length ? `<details class="audit-reviewed"><summary>Reviewed findings (${reviewed.length})</summary>${reviewed.map(findingHtml).join('')}</details>` : ''}`
    container.querySelectorAll('[data-audit-finding]').forEach(card => {
      const finding = findings.find(item => item.id === card.dataset.auditFinding)
      card.querySelector('[data-audit-open]').onclick = async () => {
        if (finding.target.kind === 'timeline') {
          selectTimelineEvent(finding.target.eventId)
          activateNovelTab('timeline')
        } else {
          await App.openFile(finding.target.path)
        }
      }
      card.querySelectorAll('[data-audit-state]').forEach(button => {
        button.onclick = async () => {
          button.disabled = true
          const saved = await window.quill.setManuscriptAuditDecision({
            novelRel:_path, findingId:finding.id, state:button.dataset.auditState,
          }).catch(error => ({ ok:false, error:error.message }))
          if (saved?.ok) await loadManuscriptAudit(_path)
          else { button.disabled = false; button.title = saved?.error || 'Could not save decision.' }
        }
      })
    })
  }

  function selectTimelineEvent(eventId) { _timelineSelectedId = eventId || null; _timelineAnchor = null }

  // Select an event and bring its date into view.
  function focusTimelineEvent(eventId) {
    _timelineSelectedId = eventId || null
    const event = _timelineEvents.find(item => item.id === eventId)
    _timelineAnchor = (event && SD.classify(event).date) || _timelineAnchor
  }

  function setTimelineView(view) {
    _timelineView = view
    try { localStorage.setItem('quill_timeline_view', view) } catch {}
    renderTimeline()
  }

  function syncTimelineViewSwitch() {
    const view = timelineView()
    document.querySelectorAll('[data-tview]').forEach(button => {
      button.classList.toggle('active', button.dataset.tview === view)
      button.setAttribute('aria-pressed', String(button.dataset.tview === view))
    })
  }
  function selectTimelineScene(sceneId) { _timelineSelectSceneId = sceneId || null }

  function addTimelineEvent() {
    // In Day view the writer is looking at one date, so the new event starts on it.
    const when = _timelineEvents.length && timelineView() === 'day'
      ? SD.formatDate(timelineAnchor(), timelineDateSample({})) : ''
    const event = {
      id: uid(), title: 'Untitled event', description: '', when, time: '', duration: '',
      track: '', placement: '', location: '', characters: [], threads: [], continuity: '', continuity_facts: [], scene_id: null,
      createdAt: new Date().toISOString(),
    }
    _timelineEvents.push(event)
    repositionTimelineEvent(event)
    _timelineSelectedId = event.id
    renderTimeline()
    scheduleTimelineSave()
    requestAnimationFrame(() => {
      document.querySelector('.timeline-detail [data-tfield="title"]')?.select()
    })
  }

  function timelineSceneOptions(event) {
    const currentPath = event.scene?.path || ''
    const options = ['<option value="">Standalone event</option>']
    if (event.missing_scene) options.push('<option value="" selected>Missing linked scene</option>')
    for (const scene of _timelineScenes) {
      options.push(`<option value="${esc(scene.path)}"${scene.path === currentPath ? ' selected' : ''}>${esc(scene.title)}</option>`)
    }
    return options.join('')
  }

  function continuityAnalysis(events) {
    const states = new Map()
    const issues = []
    const keyFor = fact => `${fact.subject.trim().toLocaleLowerCase()}\u0000${fact.fact.trim().toLocaleLowerCase()}`
    const sameValue = (a, b) => a.trim().toLocaleLowerCase() === b.trim().toLocaleLowerCase()
    events.forEach((event, eventIndex) => {
      ;(event.continuity_facts || []).forEach(fact => {
        const subject = String(fact.subject || '').trim()
        const name = String(fact.fact || '').trim()
        const before = String(fact.before || '').trim()
        const after = String(fact.after || '').trim()
        if (!subject || !name || (!before && !after)) return
        const key = keyFor({ subject, fact:name })
        const previous = states.get(key)
        if (before && previous && !sameValue(before, previous.value)) {
          issues.push({
            eventId:event.id, eventIndex, factId:fact.id, subject, fact:name, expected:before,
            previousValue:previous.value, previousEventId:previous.eventId,
            previousEventTitle:previous.eventTitle,
          })
        }
        const value = after || before
        states.set(key, { subject, fact:name, value, eventId:event.id, eventTitle:event.title || 'Untitled event', eventIndex })
      })
    })
    return { states:[...states.values()], issues }
  }

  function continuityFactsHtml(event, issues) {
    const issueByFact = new Map(issues.filter(issue => issue.eventId === event.id).map(issue => [issue.factId, issue]))
    const rows = (event.continuity_facts || []).map((fact, index) => {
      const issue = issueByFact.get(fact.id)
      return `<div class="continuity-fact-row" data-cfact-row="${index}">
        <input data-cfact="subject" value="${esc(fact.subject || '')}" placeholder="Subject (Mara)">
        <input data-cfact="fact" value="${esc(fact.fact || '')}" placeholder="Fact (location)">
        <input data-cfact="before" value="${esc(fact.before || '')}" placeholder="Before (village)">
        <input data-cfact="after" value="${esc(fact.after || '')}" placeholder="After (harbor)">
        <button type="button" data-cfact-delete title="Remove fact">×</button>
        ${issue ? `<div class="continuity-fact-warning">Before-state conflict: this event expects “${esc(issue.expected)}”, but “${esc(issue.previousEventTitle)}” last recorded “${esc(issue.previousValue)}”.</div>` : ''}
      </div>`
    }).join('')
    return rows || '<div class="continuity-facts-empty">No structured facts recorded for this event.</div>'
  }

  function continuityLedgerHtml(analysis) {
    const warningLabel = analysis.issues.length === 1 ? '1 warning' : `${analysis.issues.length} warnings`
    const factLabel = analysis.states.length === 1 ? '1 current fact' : `${analysis.states.length} current facts`
    const body = _timelineLedgerOpen ? `<div class="continuity-ledger-body">
      <p>Built only from structured facts you entered. Quill does not infer canon from manuscript prose.</p>
      ${analysis.issues.length ? `<div class="continuity-warning-list">${analysis.issues.map(issue =>
        `<button type="button" data-continuity-event="${esc(issue.eventId)}"><strong>${esc(issue.subject)} · ${esc(issue.fact)}</strong><span>“${esc(issue.expected)}” conflicts with “${esc(issue.previousValue)}” from ${esc(issue.previousEventTitle)}.</span></button>`).join('')}</div>` : ''}
      ${analysis.states.length ? `<div class="continuity-ledger-table"><div class="continuity-ledger-head"><span>Subject</span><span>Fact</span><span>Current value</span><span>Last recorded</span></div>${analysis.states.map(state =>
        `<button type="button" data-continuity-event="${esc(state.eventId)}"><span>${esc(state.subject)}</span><span>${esc(state.fact)}</span><strong>${esc(state.value)}</strong><span>${esc(state.eventTitle)}</span></button>`).join('')}</div>`
        : '<div class="continuity-ledger-empty">Add a structured continuity fact to an event to begin the ledger.</div>'}
    </div>` : ''
    return `<section class="continuity-ledger${analysis.issues.length ? ' has-warnings' : ''}">
      <button type="button" class="continuity-ledger-toggle" data-tledger-toggle aria-expanded="${_timelineLedgerOpen}">
        <strong>Continuity ledger</strong><span>${factLabel} · ${warningLabel}</span><i>${_timelineLedgerOpen ? '−' : '+'}</i>
      </button>${body}
    </section>`
  }

  function timelineUndoHtml() {
    if (!_timelineDeleted) return ''
    return `<div class="timeline-undo"><span>“${esc(_timelineDeleted.event.title || 'Untitled event')}” deleted.</span><button type="button" data-tundo>Undo</button></div>`
  }

  function bindTimelineUndo(container) {
    container.querySelector('[data-tundo]')?.addEventListener('click', () => {
      if (!_timelineDeleted) return
      clearTimeout(_timelineUndoTimer)
      const { event, index } = _timelineDeleted
      _timelineEvents.splice(Math.min(index, _timelineEvents.length), 0, event)
      _timelineSelectedId = event.id
      _timelineDeleted = null
      _timelineUndoTimer = null
      renderTimeline()
      scheduleTimelineSave()
    })
  }

  const SD = window.QuillStoryDate
  const TIMELINE_HOUR_PX = 60
  const TIMELINE_MIN_BLOCK = 30
  const TIMELINE_TRAYS = [['before', 'Before'], ['after', 'After'], ['undated', 'Undated']]
  const TIMELINE_TRACK_COLORS = ['var(--c-rewrite)', 'var(--c-research)', 'var(--c-revisit)', 'var(--c-cut)', 'var(--c-note)']
  const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
  const shortMonth = key => SD.MONTHS[+key.slice(5, 7) - 1].slice(0, 3)
  const dayNum = key => +key.slice(8, 10)

  function timelineTrackColor(track) {
    if (!track) return 'var(--accent)'
    let hash = 0
    for (const ch of track) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0
    return TIMELINE_TRACK_COLORS[hash % TIMELINE_TRACK_COLORS.length]
  }

  // The view the writer last picked, or Day when every dated event shares one date (one long
  // night, say) and Month otherwise.
  function timelineView() {
    if (['month', 'week', 'day'].includes(_timelineView)) return _timelineView
    const dates = new Set(_timelineEvents.map(event => SD.classify(event).date).filter(Boolean))
    return dates.size === 1 ? 'day' : 'month'
  }

  function timelineAnchor() {
    if (_timelineAnchor) return _timelineAnchor
    const selected = _timelineEvents.find(event => event.id === _timelineSelectedId)
    const selectedDate = selected && SD.classify(selected).date
    if (selectedDate) return selectedDate
    return firstTimelineDate() || SD.todayKey()
  }

  function firstTimelineDate() {
    return _timelineEvents.map(event => SD.classify(event).date).filter(Boolean).sort()[0] || null
  }

  function timelinePeriodLabel(view, anchor) {
    if (view === 'month') return `${SD.MONTHS[+anchor.slice(5, 7) - 1]} ${anchor.slice(0, 4)}`
    if (view === 'day') return `${WEEKDAYS[SD.dayOfWeek(anchor)]}, ${shortMonth(anchor)} ${dayNum(anchor)}, ${anchor.slice(0, 4)}`
    const start = SD.weekStart(anchor)
    const end = SD.addDays(start, 6)
    const startYear = start.slice(0, 4) === end.slice(0, 4) ? '' : `, ${start.slice(0, 4)}`
    return `${shortMonth(start)} ${dayNum(start)}${startYear} – ${shortMonth(end)} ${dayNum(end)}, ${end.slice(0, 4)}`
  }

  function shiftTimelineAnchor(direction) {
    const view = timelineView()
    const anchor = timelineAnchor()
    _timelineAnchor = view === 'month' ? SD.addMonths(anchor, direction)
      : SD.addDays(anchor, view === 'week' ? 7 * direction : direction)
  }

  // A date written back from the calendar copies the event's own date style, or else the
  // style of the first dated event, so "Oct 1st 2024" entries stay "Oct 3rd 2024".
  function timelineDateSample(event) {
    if (SD.parseWhen(event.when)?.date) return event.when
    return _timelineEvents.find(other => SD.parseWhen(other.when)?.date)?.when || ''
  }

  // Calendar order is the chronology the continuity ledger and the audit read, so a dated
  // event moves to sit after the last event at or before its moment. Undated events stay put.
  function repositionTimelineEvent(event) {
    const key = SD.sortKey(event)
    if (key == null) return
    _timelineEvents.splice(_timelineEvents.indexOf(event), 1)
    let at = -1
    _timelineEvents.forEach((other, index) => {
      const otherKey = SD.sortKey(other)
      if (otherKey != null && otherKey <= key) at = index + 1
    })
    if (at < 0) {
      const later = _timelineEvents.findIndex(other => { const k = SD.sortKey(other); return k != null && k > key })
      // Nothing keyed sorts after it either: Before-tray events lead, everything else trails.
      at = later >= 0 ? later : key === 'a' ? 0 : _timelineEvents.length
    }
    _timelineEvents.splice(at, 0, event)
  }

  function timelineNodeHtml(event, placed, warnings, extraClass = '', style = '') {
    const number = _timelineEvents.indexOf(event) + 1
    const when = placed.date
      ? (placed.minutes != null ? SD.formatTime(placed.minutes) : event.time || '')
      : [event.when, event.time].filter(Boolean).join(' · ')
    return `<button type="button" draggable="true" class="timeline-node ${extraClass}${event.id === _timelineSelectedId ? ' active' : ''}"
      data-id="${esc(event.id)}" style="--track-color:${timelineTrackColor(event.track)};${style}"
      title="${esc([event.title || 'Untitled event', event.track && `Track: ${event.track}`].filter(Boolean).join(' · '))}">
      <span class="timeline-node-marker">${number}</span>
      ${when ? `<span class="timeline-node-when">${esc(when)}</span>` : ''}
      <strong>${esc(event.title || 'Untitled event')}</strong>
      <span class="timeline-node-meta">${esc(event.location || (event.scene ? 'Linked scene' : ''))}</span>
      ${warnings ? `<span class="timeline-node-warning" title="Continuity warning">! ${warnings}</span>` : ''}
    </button>`
  }

  function timelineTraysHtml(trays, warningsByEvent) {
    const visible = TIMELINE_TRAYS.filter(([key]) => trays[key].length)
    return `<div class="timeline-trays${visible.length ? '' : ' empty'}">${TIMELINE_TRAYS.map(([key, label]) => `
      <section class="timeline-tray${trays[key].length ? '' : ' empty'}" data-tdrop-tray="${key}">
        <div class="timeline-tray-head"><strong>${label}</strong><span>${trays[key].length}</span></div>
        <div class="timeline-tray-list">${trays[key].map(([event, placed]) =>
          timelineNodeHtml(event, placed, warningsByEvent.get(event.id), 'timeline-chip')).join('')}</div>
      </section>`).join('')}</div>`
  }

  function timelineMonthHtml(anchor, byDate, warningsByEvent) {
    const first = SD.monthStart(anchor)
    const last = SD.addDays(SD.addMonths(anchor, 1), -1)
    const weeks = Math.ceil((SD.dayOfWeek(first) + dayNum(last)) / 7)
    let key = SD.weekStart(first)
    let cells = WEEKDAYS.map(day => `<div class="timeline-cal-dow">${day.slice(0, 3)}</div>`).join('')
    for (let i = 0; i < weeks * 7; i++, key = SD.addDays(key, 1)) {
      const items = byDate.get(key) || []
      const shown = items.slice(0, 3)
      cells += `<div class="timeline-cal-cell${key.slice(0, 7) === first.slice(0, 7) ? '' : ' outside'}" data-tdrop-date="${key}">
        <button type="button" class="timeline-cal-daynum" data-tday="${key}" aria-label="Open ${esc(timelinePeriodLabel('day', key))}">${dayNum(key)}</button>
        ${shown.map(([event, placed]) => timelineNodeHtml(event, placed, warningsByEvent.get(event.id), 'timeline-chip')).join('')}
        ${items.length > shown.length ? `<button type="button" class="timeline-cal-more" data-tday="${key}">+${items.length - shown.length} more</button>` : ''}
      </div>`
    }
    return `<div class="timeline-cal-month">${cells}</div>`
  }

  // Overlapping blocks split their day column side by side. Each cluster of mutually
  // overlapping events shares one width; a block's end is at least TIMELINE_MIN_BLOCK so
  // a five-minute call still has room for its title.
  function packTimelineBlocks(items) {
    const blocks = items.map(([event, placed]) => ({
      event, placed, start: placed.minutes,
      end: placed.minutes + Math.max(placed.duration || TIMELINE_MIN_BLOCK, TIMELINE_MIN_BLOCK),
    })).sort((a, b) => a.start - b.start)
    let cluster = []
    let clusterEnd = -1
    const close = () => {
      const columns = Math.max(1, ...cluster.map(block => block.column + 1))
      cluster.forEach(block => { block.columns = columns })
      cluster = []
    }
    for (const block of blocks) {
      if (block.start >= clusterEnd) { close(); clusterEnd = -1 }
      const taken = new Set(cluster.filter(other => other.end > block.start).map(other => other.column))
      block.column = 0
      while (taken.has(block.column)) block.column++
      cluster.push(block)
      clusterEnd = Math.max(clusterEnd, block.end)
    }
    close()
    return blocks
  }

  function timelineTimeGridHtml(days, byDate, warningsByEvent) {
    const pxPerMin = TIMELINE_HOUR_PX / 60
    const head = days.map(key =>
      `<button type="button" class="timeline-cal-colhead" data-tday="${key}">${WEEKDAYS[SD.dayOfWeek(key)].slice(0, 3)} <strong>${dayNum(key)}</strong></button>`).join('')
    const allDay = days.map(key => {
      const items = (byDate.get(key) || []).filter(([, placed]) => placed.minutes == null)
      return `<div class="timeline-cal-allday-cell" data-tdrop-date="${key}" data-tdrop-untimed>${items.map(([event, placed]) =>
        timelineNodeHtml(event, placed, warningsByEvent.get(event.id), 'timeline-chip')).join('')}</div>`
    }).join('')
    const hours = Array.from({ length: 24 }, (_, hour) =>
      `<div class="timeline-cal-hour">${hour === 0 ? '' : `${hour % 12 || 12} ${hour < 12 ? 'AM' : 'PM'}`}</div>`).join('')
    const columns = days.map(key => {
      const timed = (byDate.get(key) || []).filter(([, placed]) => placed.minutes != null)
      const blocks = packTimelineBlocks(timed).map(block => {
        const height = Math.max(block.placed.duration || TIMELINE_MIN_BLOCK, TIMELINE_MIN_BLOCK * 0.75) * pxPerMin
        const width = 100 / block.columns
        const style = `top:${block.start * pxPerMin}px;height:${height}px;left:calc(${block.column * width}% + 2px);width:calc(${width}% - 4px)`
        return timelineNodeHtml(block.event, block.placed, warningsByEvent.get(block.event.id), `timeline-block${height < 44 ? ' short' : ''}`, style)
      }).join('')
      return `<div class="timeline-cal-col" data-tdrop-date="${key}" data-tdrop-timed>${blocks}</div>`
    }).join('')
    return `<div class="timeline-cal-time" style="--tcal-days:${days.length};--tcal-hour:${TIMELINE_HOUR_PX}px">
      <div class="timeline-cal-timehead"><span></span>${head}</div>
      <div class="timeline-cal-allday"><span>All day</span>${allDay}</div>
      <div class="timeline-cal-scroll"><div class="timeline-cal-grid"><div class="timeline-cal-hours">${hours}</div>${columns}
        <div class="timeline-cal-drop-line"><span></span></div></div></div>
    </div>`
  }

  function renderTimeline() {
    const container = document.getElementById('novel-timeline')
    if (!container) return
    syncTimelineViewSwitch()
    if (!_timelineEvents.length) {
      container.innerHTML = `${timelineUndoHtml()}<div class="timeline-empty"><strong>No timeline events yet.</strong><span>Build the chronology independently, or add timeline metadata to a scene and reopen this view.</span><button class="btn sm" data-tfirst>+ Add the first event</button></div>`
      bindTimelineUndo(container)
      container.querySelector('[data-tfirst]').onclick = addTimelineEvent
      return
    }
    const previousScroll = container.querySelector('.timeline-cal-scroll')?.scrollTop
    const values = key => [...new Set(_timelineEvents.flatMap(event => {
      const value = event[key]
      return Array.isArray(value) ? value : value ? [value] : []
    }))].sort((a, b) => a.localeCompare(b))
    const filterDef = [
      ['track', 'All tracks', values('track')],
      ['character', 'All characters', values('characters')],
      ['thread', 'All threads', values('threads')],
      ['location', 'All locations', values('location')],
      ['link', 'All events', ['linked', 'standalone']],
    ]
    const filterHtml = filterDef.map(([key, label, options]) => {
      if (!options.length) return ''
      return `<select data-tfilter="${key}" aria-label="${label}"><option value="">${label}</option>${options.map(value =>
        `<option value="${esc(value)}"${_timelineFilters[key] === value ? ' selected' : ''}>${esc(value[0].toUpperCase() + value.slice(1))}</option>`).join('')}</select>`
    }).join('')
    const filtered = _timelineEvents.filter(event =>
      (!_timelineFilters.track || event.track === _timelineFilters.track)
      && (!_timelineFilters.character || (event.characters || []).includes(_timelineFilters.character))
      && (!_timelineFilters.thread || (event.threads || []).includes(_timelineFilters.thread))
      && (!_timelineFilters.location || event.location === _timelineFilters.location)
      && (!_timelineFilters.link || (_timelineFilters.link === 'linked' ? Boolean(event.scene_id) : !event.scene_id)))
    const continuity = continuityAnalysis(_timelineEvents)
    const warningsByEvent = new Map()
    continuity.issues.forEach(issue => warningsByEvent.set(issue.eventId, (warningsByEvent.get(issue.eventId) || 0) + 1))

    const trays = { before:[], after:[], undated:[] }
    const byDate = new Map()
    filtered.forEach(event => {
      const placed = SD.classify(event)
      if (placed.tray) trays[placed.tray].push([event, placed])
      else {
        if (!byDate.has(placed.date)) byDate.set(placed.date, [])
        byDate.get(placed.date).push([event, placed])
      }
    })
    // Untimed events lead their day; timed ones follow the clock; ties keep chronology order.
    byDate.forEach(items => items.sort((a, b) => (a[1].minutes ?? -1) - (b[1].minutes ?? -1)))

    const view = timelineView()
    const anchor = timelineAnchor()
    const calendar = view === 'month' ? timelineMonthHtml(anchor, byDate, warningsByEvent)
      : timelineTimeGridHtml(view === 'week' ? Array.from({ length:7 }, (_, i) => SD.addDays(SD.weekStart(anchor), i)) : [anchor], byDate, warningsByEvent)
    const firstDate = firstTimelineDate()
    container.dataset.view = view
    container.innerHTML = `
      ${timelineUndoHtml()}
      <div class="timeline-filterbar">${filterHtml}<button type="button" data-tclear>Clear</button><span>${filtered.length} of ${_timelineEvents.length} events</span></div>
      ${filtered.length ? `<div class="timeline-board">
        <div class="timeline-cal-nav">
          <button type="button" class="timeline-cal-step" data-tnav="-1" aria-label="Previous ${view}">‹</button>
          <strong>${esc(timelinePeriodLabel(view, anchor))}</strong>
          <button type="button" class="timeline-cal-step" data-tnav="1" aria-label="Next ${view}">›</button>
          ${firstDate ? '<button type="button" class="timeline-cal-first" data-tfirstdate>First event</button>' : ''}
        </div>
        ${timelineTraysHtml(trays, warningsByEvent)}
        ${calendar}
      </div>` : '<div class="timeline-filter-empty">No events match these filters.</div>'}
      <div class="timeline-overview-hint">Drag events to another date, onto the hour grid, or into Before, After or Undated. Select an event to edit it.</div>
      ${continuityLedgerHtml(continuity)}
      <div class="timeline-detail-wrap"></div>`
    bindTimelineUndo(container)
    container.querySelectorAll('[data-tfilter]').forEach(select => {
      select.onchange = () => { _timelineFilters[select.dataset.tfilter] = select.value; renderTimeline() }
    })
    container.querySelector('[data-tclear]').onclick = () => {
      _timelineFilters = { track:'', character:'', thread:'', location:'', link:'' }
      renderTimeline()
    }
    container.querySelector('[data-tledger-toggle]').onclick = () => {
      _timelineLedgerOpen = !_timelineLedgerOpen
      renderTimeline()
    }
    container.querySelectorAll('[data-continuity-event]').forEach(button => {
      button.onclick = () => {
        _timelineFilters = { track:'', character:'', thread:'', location:'', link:'' }
        focusTimelineEvent(button.dataset.continuityEvent)
        renderTimeline()
        document.querySelector('.timeline-detail')?.scrollIntoView({ block:'nearest' })
      }
    })
    container.querySelectorAll('[data-tnav]').forEach(button => {
      button.onclick = () => { shiftTimelineAnchor(Number(button.dataset.tnav)); renderTimeline() }
    })
    container.querySelector('[data-tfirstdate]')?.addEventListener('click', () => { _timelineAnchor = firstDate; renderTimeline() })
    container.querySelectorAll('[data-tday]').forEach(button => {
      button.onclick = () => { _timelineAnchor = button.dataset.tday; setTimelineView('day') }
    })
    container.querySelectorAll('.timeline-node').forEach(node => {
      node.onclick = () => { _timelineSelectedId = node.dataset.id; renderTimeline() }
    })
    const board = container.querySelector('.timeline-board')
    if (board) bindCalendarDrag(board)

    // Keep the hour grid where the writer left it while they edit; jump to the first event
    // only when the view or the period changes.
    const scroller = container.querySelector('.timeline-cal-scroll')
    if (scroller) {
      const scrollKey = `${view}|${anchor}`
      if (scrollKey === _timelineScrollKey && previousScroll != null) scroller.scrollTop = previousScroll
      else {
        const tops = [...scroller.querySelectorAll('.timeline-block')].map(block => block.offsetTop)
        scroller.scrollTop = tops.length ? Math.max(0, Math.min(...tops) - TIMELINE_HOUR_PX / 2) : 8 * TIMELINE_HOUR_PX
      }
      _timelineScrollKey = scrollKey
    }

    const selectedIndex = _timelineEvents.findIndex(event => event.id === _timelineSelectedId)
    if (selectedIndex < 0 || !filtered.some(event => event.id === _timelineSelectedId)) return
    const event = _timelineEvents[selectedIndex]
    const placed = SD.classify(event)
    const placement = event.placement || ''
    const whenHint = !placement && event.when && !SD.parseWhen(event.when)
    const detail = container.querySelector('.timeline-detail-wrap')
    detail.innerHTML = `
      <article class="timeline-detail" data-id="${esc(event.id)}">
        <div class="timeline-event-card">
          <div class="timeline-event-head">
            <input class="timeline-title" data-tfield="title" value="${esc(event.title || '')}" placeholder="Event title">
            <div class="timeline-order-actions">
              ${placed.tray ? `<button title="Move earlier" data-tmove="-1"${selectedIndex === 0 ? ' disabled' : ''}>←</button>
              <button title="Move later" data-tmove="1"${selectedIndex === _timelineEvents.length - 1 ? ' disabled' : ''}>→</button>` : ''}
              <button title="Close details" data-tclose>−</button>
              <button title="Delete event" data-tdelete>×</button>
            </div>
          </div>
          <textarea class="timeline-description" data-tfield="description" rows="2" placeholder="What happens?">${esc(event.description || '')}</textarea>
          <div class="timeline-fields">
            <label><span>When</span><input data-tfield="when" value="${esc(event.when || '')}" placeholder="Oct 1st 2024, ten years earlier…"></label>
            <label><span>Time</span><input data-tfield="time" value="${esc(event.time || '')}" placeholder="2:10 AM, after sunset"></label>
            <label><span>Duration</span><input data-tfield="duration" value="${esc(event.duration || '')}" placeholder="About two hours"></label>
            <label><span>Placement</span><select data-tplacement>
              ${[['', 'Calendar (from When)'], ['before', 'Before tray'], ['after', 'After tray'], ['undated', 'Undated tray']].map(([value, label]) =>
                `<option value="${value}"${placement === value ? ' selected' : ''}>${label}</option>`).join('')}
            </select></label>
            <label><span>Track</span><input data-tfield="track" value="${esc(event.track || '')}" placeholder="Present day, backstory…"></label>
            <label><span>Location</span><input data-tfield="location" value="${esc(event.location || '')}" placeholder="Where it happens"></label>
            <label><span>Linked scene</span><select data-tlink>${timelineSceneOptions(event)}</select></label>
            <label><span>Characters</span><input data-tfield="characters" value="${esc((event.characters || []).join(', '))}" placeholder="Comma separated"></label>
            <label><span>Plot threads</span><input data-tfield="threads" value="${esc((event.threads || []).join(', '))}" placeholder="Comma separated"></label>
          </div>
          ${whenHint ? '<div class="timeline-when-hint">Not a recognised date — shown in Undated. Try “Oct 1st 2024” or “ten years earlier”.</div>' : ''}
          <section class="continuity-facts">
            <div class="continuity-facts-title"><div><strong>Continuity facts</strong><span>Declare the state before and after this event. Blank “before” establishes a fact.</span></div><button type="button" data-cfact-add>+ Fact</button></div>
            <div class="continuity-facts-columns"><span>Subject</span><span>Fact</span><span>Before</span><span>After</span><span></span></div>
            <div class="continuity-facts-list">${continuityFactsHtml(event, continuity.issues)}</div>
          </section>
          <label class="timeline-continuity"><span>Continuity notes</span><textarea data-tfield="continuity" rows="2" placeholder="Unstructured reminders that should not become ledger facts.">${esc(event.continuity || '')}</textarea></label>
          ${event.scene ? `<button class="timeline-open-scene" type="button">Open ${esc(event.scene.title)} →</button>` : event.missing_scene ? '<div class="timeline-missing">Linked scene is missing. Unlink it to keep this as a standalone event.</div>' : ''}
        </div>
      </article>`

      detail.querySelectorAll('[data-tfield]').forEach(input => {
        input.addEventListener('input', () => {
          const key = input.dataset.tfield
          event[key] = key === 'characters' || key === 'threads'
            ? input.value.split(',').map(value => value.trim()).filter(Boolean)
            : input.value
          scheduleTimelineSave()
        })
        const field = input.dataset.tfield
        if (['when','time'].includes(field)) {
          input.addEventListener('change', () => {
            repositionTimelineEvent(event)
            const date = SD.classify(event).date
            if (date) _timelineAnchor = date
            renderTimeline(); scheduleTimelineSave()
          })
        } else if (['title','duration','track','characters','threads','location'].includes(field)) {
          input.addEventListener('change', () => renderTimeline())
        }
      })
      detail.querySelector('[data-tplacement]').onchange = e => {
        event.placement = e.target.value
        repositionTimelineEvent(event)
        renderTimeline(); scheduleTimelineSave()
      }
      detail.querySelector('[data-cfact-add]').onclick = () => {
        event.continuity_facts ||= []
        event.continuity_facts.push({ id:uid(), subject:'', fact:'', before:'', after:'' })
        renderTimeline(); scheduleTimelineSave()
        requestAnimationFrame(() => document.querySelector('.continuity-fact-row:last-child [data-cfact="subject"]')?.focus())
      }
      detail.querySelectorAll('[data-cfact-row]').forEach(row => {
        const factIndex = Number(row.dataset.cfactRow)
        row.querySelectorAll('[data-cfact]').forEach(input => {
          input.oninput = () => {
            event.continuity_facts[factIndex][input.dataset.cfact] = input.value
            scheduleTimelineSave()
          }
          input.onchange = () => renderTimeline()
        })
        row.querySelector('[data-cfact-delete]').onclick = () => {
          event.continuity_facts.splice(factIndex, 1)
          renderTimeline(); scheduleTimelineSave()
        }
      })
      detail.querySelector('[data-tlink]').onchange = e => {
        event.scene_path = e.target.value || null
        event.scene_id = null
        event.scene = e.target.value ? _timelineScenes.find(scene => scene.path === e.target.value) || null : null
        event.missing_scene = false
        saveTimeline(true)
      }
      detail.querySelectorAll('[data-tmove]').forEach(button => {
        button.onclick = () => {
          const next = selectedIndex + Number(button.dataset.tmove)
          if (next < 0 || next >= _timelineEvents.length) return
          const [moved] = _timelineEvents.splice(selectedIndex, 1)
          _timelineEvents.splice(next, 0, moved)
          renderTimeline(); scheduleTimelineSave()
        }
      })
      detail.querySelector('[data-tclose]').onclick = () => {
        _timelineSelectedId = null
        renderTimeline()
      }
      detail.querySelector('[data-tdelete]').onclick = () => {
        clearTimeout(_timelineUndoTimer)
        const [deleted] = _timelineEvents.splice(selectedIndex, 1)
        _timelineDeleted = { event:deleted, index:selectedIndex }
        _timelineUndoTimer = setTimeout(() => {
          _timelineDeleted = null
          _timelineUndoTimer = null
          renderTimeline()
        }, 8000)
        _timelineSelectedId = null
        renderTimeline(); scheduleTimelineSave()
      }
      detail.querySelector('.timeline-open-scene')?.addEventListener('click', () => App.openFile(event.scene.path))
  }

  // Drag a chip or block onto a date (rewrites `when` in the writer's style), onto the hour
  // grid (also rewrites `time`, snapped to 15 minutes), onto an all-day cell (clears `time`),
  // or into a tray (sets `placement`; the `when` text is kept so dragging back restores it).
  // Inside a tray, the drop position reorders the chronology like the old lanes did.
  function bindCalendarDrag(board) {
    let dragged = null
    let drop = null
    const pxPerMin = TIMELINE_HOUR_PX / 60
    const line = board.querySelector('.timeline-cal-drop-line')
    const clear = () => {
      board.classList.remove('dragging')
      board.querySelectorAll('.drag-over, .drag-source, .drop-before').forEach(el => el.classList.remove('drag-over', 'drag-source', 'drop-before'))
      if (line) line.style.display = 'none'
    }

    board.addEventListener('dragstart', e => {
      const node = e.target.closest?.('.timeline-node')
      if (!node) return
      dragged = _timelineEvents.find(event => event.id === node.dataset.id) || null
      if (!dragged) return
      e.dataTransfer.effectAllowed = 'move'
      e.dataTransfer.setData('text/plain', dragged.id)
      node.classList.add('drag-source')
      requestAnimationFrame(() => board.classList.add('dragging'))
    })
    board.addEventListener('dragend', () => { dragged = null; clear() })

    board.addEventListener('dragover', e => {
      const target = e.target.closest?.('[data-tdrop-date], [data-tdrop-tray]')
      if (!dragged || !target) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      board.querySelectorAll('.drag-over, .drop-before').forEach(el => el.classList.remove('drag-over', 'drop-before'))
      target.classList.add('drag-over')
      if (line) line.style.display = 'none'
      if (target.dataset.tdropTray) {
        const chips = [...target.querySelectorAll('.timeline-node')].filter(chip => chip.dataset.id !== dragged.id)
        const before = chips.find(chip => { const r = chip.getBoundingClientRect(); return e.clientY < r.top + r.height / 2 })
        before?.classList.add('drop-before')
        drop = { tray: target.dataset.tdropTray, beforeId: before?.dataset.id || null, afterId: chips[chips.length - 1]?.dataset.id || null }
      } else if (target.hasAttribute('data-tdrop-timed')) {
        const rect = target.getBoundingClientRect()
        const minutes = Math.max(0, Math.min(24 * 60 - 15, Math.round((e.clientY - rect.top) / pxPerMin / 15) * 15))
        drop = { date: target.dataset.tdropDate, minutes }
        if (line) {
          const grid = line.parentElement.getBoundingClientRect()
          line.style.display = 'block'
          line.style.top = `${minutes * pxPerMin}px`
          line.style.left = `${rect.left - grid.left}px`
          line.style.width = `${rect.width}px`
          line.querySelector('span').textContent = SD.formatTime(minutes)
        }
      } else {
        drop = { date: target.dataset.tdropDate, untimed: target.hasAttribute('data-tdrop-untimed') }
      }
    })
    board.addEventListener('dragleave', e => {
      if (!board.contains(e.relatedTarget)) clear()
    })

    board.addEventListener('drop', e => {
      const event = dragged
      const target = drop
      dragged = null
      drop = null
      clear()
      if (!event || !target || !e.target.closest?.('[data-tdrop-date], [data-tdrop-tray]')) return
      e.preventDefault()
      if (target.tray) {
        event.placement = target.tray
        const anchorId = target.beforeId || target.afterId
        if (anchorId) {
          _timelineEvents.splice(_timelineEvents.indexOf(event), 1)
          const at = _timelineEvents.findIndex(other => other.id === anchorId)
          _timelineEvents.splice(target.beforeId ? at : at + 1, 0, event)
        } else repositionTimelineEvent(event)
      } else {
        event.when = SD.formatDate(target.date, timelineDateSample(event))
        if (target.minutes != null) event.time = SD.formatTime(target.minutes)
        else if (target.untimed && SD.parseTime(event.time) != null) event.time = ''
        event.placement = ''
        _timelineAnchor = target.date
        repositionTimelineEvent(event)
      }
      _timelineSelectedId = event.id
      renderTimeline(); scheduleTimelineSave()
    })
  }

  function scheduleTimelineSave() {
    clearTimeout(_timelineSaveTimer)
    _timelineSaveTimer = setTimeout(() => saveTimeline(false), 650)
  }

  async function saveTimeline(rerender) {
    clearTimeout(_timelineSaveTimer)
    _timelineSaveTimer = null
    if (!_path || !_timelineEvents.length && !document.getElementById('novel-timeline')) return
    const result = await window.quill.saveTimeline({ novelRel: _path, events: _timelineEvents })
      .catch(error => ({ ok:false, error:error.message }))
    if (!result?.ok) { alert(result?.error || 'Could not save the timeline.'); return }
    _timelineScenes = result.scenes || _timelineScenes
    if (rerender) {
      _timelineEvents = result.events || []
      renderTimeline()
    } else {
      // Keep the objects captured by the current card handlers alive while the writer types.
      // Replacing the array here leaves the visible controls editing stale event objects.
      const returned = new Map((result.events || []).map(event => [event.id, event]))
      _timelineEvents.forEach(event => {
        const clean = returned.get(event.id)
        if (clean) Object.assign(event, clean)
      })
    }
  }

  async function flushOutliner() {
    const saves = [..._outlinerPending.values()]
    _outlinerPending.clear()
    await Promise.all(saves.map(save => save()))
  }

  async function loadNovelOutliner(novelPath) {
    await flushOutliner()
    const container = document.getElementById('novel-outliner')
    const summary = document.getElementById('novel-outliner-summary')
    if (!container) return
    // A rebuild after + Scene / + Chapter keeps the old outline up while loading, so the page
    // doesn't collapse and snap #landing-scroll back to the top.
    const scroller = document.getElementById('landing-scroll')
    const scrollTop = scroller?.scrollTop || 0
    if (!container.querySelector('.outliner-act, .outliner-empty')) {
      container.innerHTML = '<div class="read-loading">Loading outliner…</div>'
    }
    const [acts, unsorted] = await Promise.all([
      window.quill.getNovelStructure(novelPath).catch(() => []),
      window.quill.getUnsortedScenes(novelPath).catch(() => null),
    ])
    if (!document.body.contains(container)) return
    container.innerHTML = ''
    let sceneCount = 0
    let totalWords = 0
    const unsortedScenes = unsorted?.path ? unsorted.scenes || [] : []

    acts.forEach(act => {
      const actWrap = document.createElement('section')
      actWrap.className = 'outliner-act'
      if (act.folderTitle) {
        const heading = document.createElement('div')
        heading.className = 'outliner-act-title'
        heading.textContent = act.folderTitle
        actWrap.appendChild(heading)
      }

      ;(act.chapters || []).forEach(chapter => {
        const scenes = chapter.scenes || []
        sceneCount += scenes.length
        totalWords += scenes.reduce((sum, scene) => sum + (scene.word_count || 0), 0)
        actWrap.appendChild(outlinerInsertGap('Insert a chapter here', () => outlinerAddChapter(act.path, chapter.name)))
        actWrap.appendChild(buildOutlinerChapter(chapter, scenes))
      })
      // Every act (or the novel itself, when it has no acts) ends with its own + Chapter.
      actWrap.appendChild(outlinerAddButton('outliner-add-chapter', '+ Chapter', () => outlinerAddChapter(act.path)))
      container.appendChild(actWrap)
    })

    if (!acts.length) {
      container.innerHTML = '<div class="outliner-empty">The Outliner lists every chapter and scene with its synopsis and status, so you can see the whole book at once. Add a chapter with <b>+ Chapter</b> in the sidebar to begin.</div>'
      container.appendChild(outlinerAddButton('outliner-add-chapter', '+ Chapter', () => outlinerAddChapter(novelPath)))
    }
    // Scenes waiting for a chapter: they count in the totals, but aren't part of the
    // outline's order, so the export and "previous scene" skip them.
    const exportable = sceneCount
    if (unsortedScenes.length) {
      sceneCount += unsortedScenes.length
      totalWords += unsortedScenes.reduce((sum, scene) => sum + (scene.word_count || 0), 0)
      const group = document.createElement('section')
      group.className = 'outliner-act outliner-unsorted'
      group.appendChild(buildOutlinerChapter({ path: unsorted.path, name: 'Unsorted', folderTitle: 'Unsorted' },
        unsortedScenes, { unsorted: true }))
      container.appendChild(group)
    }
    if (summary) summary.textContent = `${sceneCount} scene${sceneCount === 1 ? '' : 's'} · ${totalWords.toLocaleString()} words`
      + (unsortedScenes.length ? ` (${unsortedScenes.length} unsorted)` : '')
    _outlinerActs = exportable ? acts : []
    initOutlinerExport()
    if (scroller) scroller.scrollTop = scrollTop
  }

  function outlinerAddButton(className, label, onclick) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = `outliner-add ${className}`
    button.textContent = label
    button.onclick = onclick
    return button
  }

  // A hover-only line between items: invisible until pointed at, then a line and a + that
  // inserts right there.
  function outlinerInsertButton(label, onclick) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'outliner-insert'
    button.title = label
    button.setAttribute('aria-label', label)
    button.innerHTML = '<span>+</span>'
    button.onclick = event => { event.stopPropagation(); onclick() }
    return button
  }

  function outlinerInsertGap(label, onclick) {
    const gap = document.createElement('div')
    gap.className = 'outliner-gap'
    gap.appendChild(outlinerInsertButton(label, onclick))
    return gap
  }

  // `before` is the folder name of the chapter to insert ahead of; blank appends.
  async function outlinerAddChapter(parent, before = '') {
    await flushOutliner()
    const result = await Tree.createStructureFolder(parent, 'chapter', before)
    if (!result) return
    await Tree.refresh()
    await loadNovelOutliner(_path)
  }

  // Stays on the Outliner: the new row's title opens the scene when you're ready to write.
  // `before` is the file of the scene to insert ahead of; `scenes` is the chapter as shown.
  async function outlinerAddScene(chapterPath, before = '', scenes = []) {
    await flushOutliner()
    const fallback = await window.quill.suggestName({ parent: chapterPath, kind: 'scene' }).catch(() => '')
    const title = await Tree.askName({ heading: 'New scene', fallback })
    if (title === null) return
    await outlinerCreateScene(chapterPath, title, before, scenes)
    await Tree.refresh()
    await loadNovelOutliner(_path)
  }

  // Shared by + Scene and the Scene Builder. A blank title takes the next scene number.
  async function outlinerCreateScene(chapterPath, title, before = '', scenes = []) {
    const result = await window.quill.newFile({ folder: chapterPath, title, folder_type: 'novel', before })
    await App.addBoardCard(chapterPath, result.title)
    if (before) {
      // New cards land at the end of the Corkboard; reordering lines the linked cards up
      // with the scenes, so the new card sits beside the scene it was inserted above.
      const order = scenes.map(scene => scene.file)
      order.splice(Math.max(0, order.indexOf(before)), 0, result.path.split('/').pop())
      await window.quill.reorder({ folder: chapterPath, order })
    }
    return result
  }

  // The scene just before a spot in reading order: before `scenePath`, or after the last scene
  // of `chapterPath` when building a new one there. Crosses chapter and act boundaries.
  function outlinerPreviousScene(chapterPath, scenePath = '', acts = _outlinerActs) {
    let prev = null
    for (const chapter of acts.flatMap(act => act.chapters || [])) {
      for (const scene of chapter.scenes || []) {
        if (scene.path === scenePath) return prev
        prev = scene
      }
      if (!scenePath && chapter.path === chapterPath) return prev
    }
    return prev
  }

  async function outlinerBuildScene(chapterPath, scenes, scenePath = '') {
    await flushOutliner()
    SceneBuilder.open({
      novelPath: _path,
      chapterPath,
      scenePath,
      prev: outlinerPreviousScene(chapterPath, scenePath),
      createScene: title => outlinerCreateScene(chapterPath, title, '', scenes),
      onClose: () => { if (document.getElementById('novel-outliner')) loadNovelOutliner(_path) },
    })
  }

  // Case Builder (and future manuscript tools) can hand an assigned obligation straight to
  // the scene plan without making the author detour through the Outliner first.
  async function openScenePlan(scenePath) {
    if (!_path || !scenePath) return false
    const acts = await window.quill.getNovelStructure(_path).catch(() => [])
    let chapter = null
    for (const act of acts) {
      chapter = (act.chapters || []).find(item => (item.scenes || []).some(scene => scene.path === scenePath))
      if (chapter) break
    }
    if (!chapter) {
      const unsorted = await window.quill.getUnsortedScenes(_path).catch(() => null)
      if (!(unsorted?.scenes || []).some(scene => scene.path === scenePath)) return false
      await buildUnsortedScene(_path, scenePath)
      return true
    }
    await flushOutliner()
    await SceneBuilder.open({
      novelPath: _path,
      chapterPath: chapter.path,
      scenePath,
      prev: outlinerPreviousScene(chapter.path, scenePath, acts),
      createScene: title => outlinerCreateScene(chapter.path, title, '', chapter.scenes || []),
      onClose: () => { if (document.getElementById('novel-outliner')) loadNovelOutliner(_path) },
    })
    return true
  }

  // A scene with no chapter yet lives in the novel's Unsorted folder. A new one starts on the
  // Scene Builder's free-write; Create puts it in Unsorted, ready to drag into a chapter later.
  async function buildUnsortedScene(novelPath, scenePath = '') {
    const made = await window.quill.ensureUnsortedFolder(novelPath).catch(error => ({ ok: false, error: error.message }))
    if (!made?.ok) { alert(made?.error || 'Could not make the Unsorted folder.'); return false }
    if (_path === novelPath) await flushOutliner()
    await SceneBuilder.open({
      novelPath,
      chapterPath: made.path,
      scenePath,
      prev: null,
      unsorted: true,
      startAt: scenePath ? '' : 'think',
      createScene: title => outlinerCreateScene(made.path, title),
      onClose: async () => {
        await Tree.refresh()
        if (_path === novelPath && document.getElementById('novel-outliner')) loadNovelOutliner(novelPath)
      },
    })
    return true
  }

  const plural = (n, word) => `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`
  const statusLabel = status => {
    const value = String(status || 'drafting')
    return value[0].toUpperCase() + value.slice(1)
  }

  // One shape for all three outputs, so the clipboard and the .docx never drift apart.
  function outlinerExportModel() {
    const acts = _outlinerActs.map(act => ({
      title: String(act.folderTitle || '').trim(),
      chapters: (act.chapters || []).map(chapter => {
        const scenes = (chapter.scenes || []).map(scene => ({
          title: String(scene.title || '').trim() || 'Untitled',
          synopsis: String(scene.synopsis || '').trim(),
          status: statusLabel(scene.status),
          words: scene.word_count || 0,
        }))
        const words = scenes.reduce((sum, scene) => sum + scene.words, 0)
        return { title: chapter.folderTitle || chapter.name, scenes,
          meta: `${plural(scenes.length, 'scene')} · ${plural(words, 'word')}` }
      }),
    })).filter(act => act.chapters.length)
    const scenes = acts.flatMap(act => act.chapters.flatMap(chapter => chapter.scenes))
    const words = scenes.reduce((sum, scene) => sum + scene.words, 0)
    return {
      title: String(_meta.folder_title || _path?.split('/').pop() || 'Untitled').trim(),
      summary: `${plural(scenes.length, 'scene')} · ${plural(words, 'word')}`,
      acts,
    }
  }

  function outlinerText(model) {
    const out = [`${model.title} — Outline`, model.summary]
    model.acts.forEach(act => {
      if (act.title) out.push('', act.title.toUpperCase())
      act.chapters.forEach(chapter => {
        out.push('', `${chapter.title} (${chapter.meta})`)
        chapter.scenes.forEach((scene, index) => {
          out.push(`  ${index + 1}. ${scene.title} [${scene.status} · ${plural(scene.words, 'word')}]`)
          if (scene.synopsis) scene.synopsis.split('\n').forEach(line => out.push(`     ${line}`))
        })
      })
    })
    return out.join('\n')
  }

  function outlinerHTML(model) {
    const body = model.acts.map(act =>
      (act.title ? `<h2>${esc(act.title)}</h2>` : '') + act.chapters.map(chapter =>
        `<h3>${esc(chapter.title)} <small>(${esc(chapter.meta)})</small></h3><ol>`
        + chapter.scenes.map(scene => `<li><b>${esc(scene.title)}</b> — ${esc(scene.status)} · ${esc(plural(scene.words, 'word'))}`
          + (scene.synopsis ? `<br>${esc(scene.synopsis).replace(/\n/g, '<br>')}` : '') + '</li>').join('')
        + '</ol>').join('')).join('')
    return `<h1>${esc(model.title)} — Outline</h1><p>${esc(model.summary)}</p>${body}`
  }

  function initOutlinerExport() {
    const copyBtn = document.getElementById('outliner-copy-btn')
    const exportBtn = document.getElementById('outliner-export-btn')
    if (!copyBtn || !exportBtn) return
    copyBtn.disabled = exportBtn.disabled = !_outlinerActs.length
    const flash = (button, label, reset, ms = 1400) => {
      button.textContent = label
      setTimeout(() => { button.textContent = reset }, ms)
    }

    copyBtn.onclick = async () => {
      await flushOutliner()
      const model = outlinerExportModel()
      const plain = outlinerText(model)
      try {
        // Rich HTML so headings and lists survive a paste into Docs or Word; plain text for everything else.
        try {
          await navigator.clipboard.write([new ClipboardItem({
            'text/plain': new Blob([plain], { type: 'text/plain' }),
            'text/html': new Blob([outlinerHTML(model)], { type: 'text/html' }),
          })])
        } catch {
          await navigator.clipboard.writeText(plain)
        }
        flash(copyBtn, 'Copied!', 'Copy outline')
      } catch {
        flash(copyBtn, 'Couldn’t copy', 'Copy outline', 1800)
      }
    }

    exportBtn.onclick = async () => {
      await flushOutliner()
      const model = outlinerExportModel()
      exportBtn.disabled = true
      try {
        const result = await window.quill.exportOutlineDocx({ title: model.title, parts: ManuscriptDocx.buildOutline(model) })
        if (result?.ok) flash(exportBtn, 'Saved!', 'Export .docx')
        else if (result?.error) alert(result.error)
      } finally {
        exportBtn.disabled = !_outlinerActs.length
      }
    }
  }

  function buildOutlinerChapter(chapter, scenes, { unsorted = false } = {}) {
    const wrap = document.createElement('section')
    wrap.className = 'outliner-chapter'
    const words = scenes.reduce((sum, scene) => sum + (scene.word_count || 0), 0)
    wrap.innerHTML = `
      <button class="outliner-chapter-header" type="button">
        <span>${esc(chapter.folderTitle || chapter.name)}</span>
        <span>${scenes.length} scene${scenes.length === 1 ? '' : 's'} · ${words.toLocaleString()} words</span>
      </button>
      <div class="outliner-columns" aria-hidden="true">
        <span>Scene</span><span>Synopsis</span><span>Status</span><span>Words</span>
      </div>
      <div class="outliner-rows"></div>`
    const header = wrap.querySelector('.outliner-chapter-header')
    if (unsorted) {
      header.disabled = true
      header.title = 'Scenes without a chapter yet. Drag one into a chapter above when you know where it goes.'
    } else header.onclick = () => App.openFolder(chapter.path, 'novel')
    // The Scene Builder for a scene here: unsorted scenes have no scene before them.
    const build = (scenePath = '') => unsorted ? buildUnsortedScene(_path, scenePath) : outlinerBuildScene(chapter.path, scenes, scenePath)
    const rows = wrap.querySelector('.outliner-rows')

    const finishDrop = async targetIndex => {
      if (!_outlinerDrag) return
      const source = _outlinerDrag
      _outlinerDrag = null
      if (source.chapterPath === chapter.path) {
        if (source.index === targetIndex) return
        const [moved] = scenes.splice(source.index, 1)
        const adjusted = source.index < targetIndex ? targetIndex - 1 : targetIndex
        scenes.splice(Math.max(0, adjusted), 0, moved)
        await window.quill.reorder({ folder: chapter.path, order: scenes.map(item => item.file) })
      } else {
        const result = await window.quill.moveSceneBetweenChapters({
          rel: source.path, destFolder: chapter.path, destIndex: targetIndex,
        })
        if (!result?.ok) { alert(result?.error || 'Could not move that scene.'); return }
        Editor.followTime?.(source.path, result.path)
      }
      await Tree.refresh()
      await loadNovelOutliner(_path)
    }

    rows.addEventListener('dragover', event => {
      if (!_outlinerDrag) return
      event.preventDefault()
      if (!event.target.closest('.outliner-row')) rows.classList.add('drag-over')
    })
    rows.addEventListener('dragleave', event => {
      if (!rows.contains(event.relatedTarget)) rows.classList.remove('drag-over')
    })
    rows.addEventListener('drop', async event => {
      if (event.target.closest('.outliner-row')) return
      event.preventDefault()
      rows.classList.remove('drag-over')
      await finishDrop(scenes.length)
    })

    const addRow = document.createElement('div')
    addRow.className = 'outliner-add-row'
    addRow.appendChild(outlinerAddButton('outliner-add-scene', '+ Scene', () => outlinerAddScene(chapter.path)))
    addRow.appendChild(outlinerAddButton('outliner-add-scene outliner-build-scene', unsorted ? '✦ Scene idea' : '✦ Build scene',
      () => build()))
    wrap.appendChild(addRow)
    if (!scenes.length) {
      rows.innerHTML = '<div class="outliner-chapter-empty">No scenes in this chapter yet.</div>'
      return wrap
    }

    scenes.forEach((scene, index) => {
      const status = scene.status || 'drafting'
      const statusClass = String(status).toLowerCase().replace(/[^a-z0-9_-]/g, '') || 'drafting'
      const row = document.createElement('div')
      row.className = 'outliner-row'
      row.dataset.index = String(index)
      row.dataset.path = scene.path
      const statusOptions = OUTLINER_STATUSES.map(s =>
        `<option value="${s}"${s === statusClass ? ' selected' : ''}>${s[0].toUpperCase() + s.slice(1)}</option>`).join('')
      row.innerHTML = `
        <div class="outliner-scene-cell">
          <span class="outliner-drag" title="Drag to reorder">⠿</span>
          <button class="outliner-scene-title" type="button">${esc(scene.title || 'Untitled')}</button>
          <button class="outliner-build" type="button" title="${scene.word_count ? 'Edit this scene’s plan' : 'Plan this scene in the Scene Builder'}">✦ ${scene.word_count ? 'Plan' : 'Build'}</button>
        </div>
        <textarea class="outliner-synopsis" rows="1" placeholder="Add a synopsis…">${esc(scene.synopsis || '')}</textarea>
        <div><select class="outliner-status status-${statusClass}" title="Scene status">${statusOptions}</select></div>
        <div class="outliner-words">${(scene.word_count || 0).toLocaleString()}</div>`
      row.querySelector('.outliner-scene-title').onclick = () => App.openFile(scene.path)
      const buildBtn = row.querySelector('.outliner-build')
      if (buildBtn) buildBtn.onclick = () => build(scene.path)
      // Sits on the row's top edge, so a drop onto it still counts as a drop on this row.
      row.appendChild(outlinerInsertButton('Insert a scene here', () => outlinerAddScene(chapter.path, scene.file, scenes)))

      // Only the handle starts a drag, so the synopsis field keeps normal text selection.
      const handle = row.querySelector('.outliner-drag')
      handle.addEventListener('mousedown', () => { row.draggable = true })
      handle.addEventListener('mouseup', () => { row.draggable = false })

      const synopsisIn = row.querySelector('.outliner-synopsis')
      const fitSynopsis = () => { synopsisIn.style.height = 'auto'; synopsisIn.style.height = synopsisIn.scrollHeight + 'px' }
      setTimeout(fitSynopsis, 0)
      let synopsisTimer = null
      const saveSynopsis = async () => {
        clearTimeout(synopsisTimer)
        synopsisTimer = null
        if (_outlinerPending.get(scene.path) === saveSynopsis) _outlinerPending.delete(scene.path)
        const value = synopsisIn.value
        if (value === (scene.synopsis || '')) return
        const result = await window.quill.updateSceneMeta({ rel: scene.path, synopsis: value })
        if (!result?.ok) { alert(result?.error || 'Could not save that synopsis.'); return }
        scene.synopsis = value
        Editor.syncSynopsisFromBoard?.(scene.path, value)
      }
      synopsisIn.addEventListener('input', () => {
        fitSynopsis()
        clearTimeout(synopsisTimer)
        synopsisTimer = setTimeout(saveSynopsis, 600)
        _outlinerPending.set(scene.path, saveSynopsis)
      })
      synopsisIn.addEventListener('blur', () => { if (synopsisTimer) saveSynopsis() })

      const statusSel = row.querySelector('.outliner-status')
      statusSel.addEventListener('change', async () => {
        const value = statusSel.value
        const result = await window.quill.updateSceneMeta({ rel: scene.path, status: value })
        if (!result?.ok) { alert(result?.error || 'Could not change the status.'); statusSel.value = scene.status || 'drafting'; return }
        scene.status = value
        statusSel.className = `outliner-status status-${value}`
        Editor.syncStatusFromOutliner?.(scene.path, value)
      })
      row.addEventListener('dragstart', event => {
        _outlinerDrag = { path: scene.path, chapterPath: chapter.path, index: Number(row.dataset.index) }
        row.classList.add('dragging')
        document.getElementById('novel-outliner')?.classList.add('dragging')
        event.dataTransfer.effectAllowed = 'move'
        event.dataTransfer.setData('text/plain', scene.path)
      })
      row.addEventListener('dragend', () => {
        row.draggable = false
        document.querySelectorAll('.outliner-row,.outliner-rows,#novel-outliner').forEach(item =>
          item.classList.remove('dragging', 'drag-over', 'drag-over-after'))
        setTimeout(() => { _outlinerDrag = null }, 50)
      })
      row.addEventListener('dragover', event => {
        event.preventDefault()
        if (_outlinerDrag?.path !== scene.path) {
          const rect = row.getBoundingClientRect()
          row.classList.toggle('drag-over-after', event.clientY > rect.top + rect.height / 2)
          row.classList.add('drag-over')
        }
      })
      row.addEventListener('dragleave', () => row.classList.remove('drag-over', 'drag-over-after'))
      row.addEventListener('drop', async event => {
        event.preventDefault(); event.stopPropagation()
        const after = row.classList.contains('drag-over-after')
        row.classList.remove('drag-over', 'drag-over-after')
        const targetIndex = Number(row.dataset.index) + (after ? 1 : 0)
        await finishDrop(targetIndex)
      })
      rows.appendChild(row)
    })
    return wrap
  }

  // ── Structure / Beats ──────────────────────────────────────
  // Templates and questions live in structure.js (QuillStructure). The tab is a read-only spine
  // of beat cards; writing happens in the Structure Builder, which opens at the clicked beat.

  let _structure = QuillStructure.blankStructure()
  let _scenesByBeat = {}

  async function loadStructure() {
    if (!_path) return
    const result = await window.quill.getStructure(_path).catch(() => null)
    _structure = result?.ok ? result.structure : QuillStructure.blankStructure()
    _scenesByBeat = result?.ok ? result.scenesByBeat : {}
  }

  // Old template ids carry their text into the new ones once, as earlier drafts.
  function migrateBeats() {
    const before = _meta.beats || {}
    const after = QuillStructure.migrate(before)
    _meta.beats = after
    if (Object.keys(after).some(id => after[id] !== before[id])) scheduleSave()
  }

  function renderBeats(templateKey) {
    const key = templateKey || _meta.beat_template || 'generic'
    const tmpl = QuillStructure.template(key, _structure.triangle)
    const beats = _meta.beats || {}

    document.querySelectorAll('.beat-tmpl-pill').forEach(p => {
      p.classList.toggle('active', p.dataset.tmpl === key)
    })
    const note = document.getElementById('beat-tmpl-note')
    if (note) note.textContent = tmpl.note || ''

    const container = document.getElementById('beats-container')
    if (!container) return
    const dual = tmpl.acts.some(act => act.beats.some(b => b.track === 'quest'))
    const triangle = document.getElementById('structure-triangle')
    if (triangle) triangle.checked = _structure.triangle === true
    const mystery = document.getElementById('structure-mystery')
    if (mystery) mystery.checked = _structure.mystery === true
    container.className = dual ? 'spine spine-dual' : 'spine'
    container.innerHTML = tmpl.acts.map(act => {
      const mine = act.beats.filter(b => QuillStructure.beatState(b.id, beats, _structure) === 'mine').length
      const unscened = act.beats.filter(b => !(_scenesByBeat[b.id] || []).length).length
      const head = `<div class="spine-act-head"><span>${esc(act.label)}</span>
        <em>${mine}/${act.beats.length} yours${unscened ? ` · ${unscened} without scenes` : ''}</em></div>`
      if (!dual) return `<section class="spine-act">${head}<div class="spine-list">${act.beats.map(beatCard).join('')}</div></section>`
      const track = name => act.beats.filter(b => b.track === name).map(beatCard).join('')
      return `<section class="spine-act">${head}
        <div class="spine-tracks">
          <div class="spine-track" data-track="quest"><div class="spine-track-label">Quest</div>${track('quest')}</div>
          <div class="spine-track" data-track="romance"><div class="spine-track-label">Romance</div>${track('romance')}${track('rival')}</div>
        </div>
        <div class="spine-shared">${track('shared')}</div>
      </section>`
    }).join('')
    container.querySelectorAll('.beat-card').forEach(card => {
      card.onclick = () => openStructureBuilder(card.dataset.beat)
    })
  }

  function beatCard(b) {
    const beats = _meta.beats || {}
    const state = QuillStructure.beatState(b.id, beats, _structure)
    const scenes = (_scenesByBeat[b.id] || []).length
    const preview = state === 'empty' ? '— empty —' : String(beats[b.id]).trim()
    return `<button type="button" class="beat-card" data-beat="${esc(b.id)}" data-state="${state}"${b.track ? ` data-track="${b.track}"` : ''}
      title="${state === 'draft' ? 'Earlier draft: not rewritten in your words yet' : state === 'mine' ? 'Written in the Structure Builder' : 'Not written yet'}">
      <span class="beat-card-head"><i class="beat-dot"></i><span class="beat-card-label">${esc(b.label)}</span></span>
      <span class="beat-preview">${esc(preview)}</span>
      <span class="beat-scenes${scenes ? '' : ' none'}">${scenes ? `${scenes} scene${scenes === 1 ? '' : 's'}` : 'no scenes yet'}</span>
    </button>`
  }

  function openStructureBuilder(startAt) {
    StructureBuilder.open({
      novelPath: _path,
      title: _meta.folder_title || _path.split('/').pop(),
      templateKey: _meta.beat_template || 'generic',
      beats: _meta.beats || {},
      structure: _structure,
      scenesByBeat: _scenesByBeat,
      startAt,
      onBeat: (id, text) => {
        _meta.beats = { ...(_meta.beats || {}), [id]: text }
        scheduleSave()
      },
      onClose: structure => {
        _structure = structure
        renderBeats()
      },
    })
  }

  async function copyStructure(btn) {
    const md = QuillStructure.toMarkdown({
      title: _meta.folder_title || _path.split('/').pop(),
      templateKey: _meta.beat_template || 'generic',
      beats: _meta.beats || {}, structure: _structure, scenesByBeat: _scenesByBeat,
      caseDigest: _structure.mystery ? await caseDigestFor(_path) : null,
    })
    try {
      await navigator.clipboard.writeText(md)
      btn.textContent = 'Copied'
    } catch {
      btn.textContent = 'Couldn’t copy'
    }
    setTimeout(() => { btn.textContent = 'Copy structure' }, 1600)
  }

  function activateNovelTab(tabName) {
    const tab = document.querySelector(`.nl-tab[data-nltab="${tabName}"]`)
    if (tab) tab.click()
  }

  // ── Characters ─────────────────────────────────────────────

  const CHAR_ROLES = ['Protagonist','Antagonist','Love interest','Supporting','Minor','Mentor','Foil']

  async function renderCharacters(chars) {
    const grid = document.getElementById('char-grid')
    if (!grid) return
    grid.innerHTML = ''

    const charIds = chars.map(c => c.id).filter(Boolean)
    const images = charIds.length && _path
      ? await window.quill.getCharImagePaths({ novelRel: _path, charIds }).catch(() => ({}))
      : {}

    chars.forEach((char, idx) => {
      const card = document.createElement('div')
      card.className = 'char-card'
      const role    = char.role || 'Supporting'
      const roleKey = role.toLowerCase().replace(/\s+/g, '-')
      const imgPath = char.id && images[char.id]

      card.innerHTML = `
        ${imgPath
          ? `<div class="char-card-thumb"><img src="../__vfs${esc(imgPath)}?t=${Date.now()}" draggable="false" alt=""></div>`
          : `<div class="char-role-dot" data-role="${roleKey}"></div>`}
        <div class="char-card-body">
          <div class="char-card-name">${esc(char.name || 'Unnamed')}</div>
          <div class="char-card-role">${role}</div>
        </div>
        <button class="char-open-btn btn sm">Open →</button>
        <button class="char-del f-btn" title="Delete character" aria-label="Delete ${esc(char.name || 'character')}">
          <svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>`

      if (imgPath) QuillPhoto.apply(card.querySelector('.char-card-thumb img'), char.photo)
      card.querySelector('.char-open-btn').onclick = e => { e.stopPropagation(); openCharSheet(idx) }
      card.querySelector('.char-del').onclick = e => {
        e.stopPropagation()
        if (!confirm(`Delete ${char.name || 'this character'}? Their sheet and photo will be removed.`)) return
        _meta.characters = (_meta.characters || []).filter((_, i) => i !== idx)
        if (char.id) window.quill.deleteCharImage({ novelRel: _path, charId: char.id }).catch(() => {})
        renderCharacters(_meta.characters); scheduleSave()
      }
      card.ondblclick = e => { if (!e.target.closest('button')) openCharSheet(idx) }
      grid.appendChild(card)
    })

    if (!(chars || []).length) {
      const intro = document.createElement('p')
      intro.className = 'char-empty-intro'
      intro.textContent = 'Each character gets a sheet for role, wants, wounds, voice and a photo. They appear in the Reference panel (⌘R) while you write and in scene POV pickers.'
      grid.appendChild(intro)
    }
    const addCard = document.createElement('button')
    addCard.type = 'button'
    addCard.className = 'char-add-card'
    addCard.innerHTML = `
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5">
        <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
      </svg>
      <span>Add character</span>`
    addCard.onclick = () => addCharacter()
    grid.appendChild(addCard)
    initCharacterExport()
  }

  // The character sheet's sections and fields, in sheet order. A blank label means the field
  // is the section's only text and prints under the heading alone.
  const CHAR_EXPORT_GROUPS = [
    ['Essence',        [['desc','Description'],['appearance','Appearance']]],
    ['Psychology',     [['want','Want'],['need','Need'],['fear','Fear'],['arc','Arc']]],
    ['Desire profile', [['desire_profile','']]],
    ['Backstory',      [['backstory',''],['wound','Wound'],['lie','Lie they believe'],['truth','Truth they need to learn']]],
    ['Relationships',  [['relationships','']]],
    ['Voice & scenes', [['voice','Voice'],['key_scenes','Key scenes']]],
    ['Notes',          [['notes','']]],
  ]

  function initCharacterExport() {
    const button = document.getElementById('char-export-btn')
    if (!button) return
    button.disabled = !(_meta.characters || []).length
    button.onclick = async () => {
      const novelPath = _path
      const chars = (_meta.characters || []).filter(char => char && typeof char === 'object')
      const filled = value => typeof value === 'string' && value.trim()
      const model = {
        title: String(_meta.folder_title || novelPath),
        summary: `${chars.length} character${chars.length === 1 ? '' : 's'}`,
        characters: chars.map(char => ({
          name: String(char.name || '').trim() || 'Unnamed',
          role: char.role || 'Supporting',
          groups: CHAR_EXPORT_GROUPS
            .map(([title, fields]) => ({ title, fields: fields.filter(([key]) => filled(char[key])).map(([key, label]) => [label, char[key].trim()]) }))
            .filter(group => group.fields.length),
        })),
      }
      button.disabled = true
      try {
        const result = await window.quill.exportCharactersDocx({ title: model.title, parts: ManuscriptDocx.buildCharacters(model) })
        if (result?.ok) {
          button.textContent = 'Saved!'
          setTimeout(() => { button.textContent = 'Export .docx' }, 1400)
        } else if (result?.error) alert(result.error)
      } catch (error) {
        alert(`Couldn’t export the characters: ${error.message}`)
      } finally {
        button.disabled = !(_meta.characters || []).length
      }
    }
  }

  function addCharacter() {
    const chars = _meta.characters || []
    chars.push({ id: uid(), name:'', role:'Supporting', desc:'', want:'', need:'', fear:'',
                 arc:'', appearance:'', desire_profile:'', backstory:'', wound:'', lie:'', truth:'',
                 voice:'', relationships:'', key_scenes:'', notes:'' })
    _meta.characters = chars
    renderCharacters(chars); scheduleSave()
    openCharSheet(chars.length - 1)
  }

  // Other novel tools can create a character without letting Landing's in-memory meta overwrite
  // it on the next autosave. Refresh the visible Characters tab when it is already open.
  function acceptCharacter(novelPath, character) {
    if (_path !== novelPath || !character?.id) return
    const chars = Array.isArray(_meta.characters) ? _meta.characters.slice() : []
    const at = chars.findIndex(c => c.id === character.id)
    if (at >= 0) chars[at] = character
    else chars.push(character)
    _meta.characters = chars
    if (document.querySelector('.nl-tab[data-nltab="characters"].active')) renderCharacters(chars)
  }

  async function openCharacter(novelPath, characterId) {
    await App.openNovelWorkspace(novelPath, 'characters')
    const index = (_meta.characters || []).findIndex(character => character.id === characterId)
    if (index < 0) return false
    openCharSheet(index)
    return true
  }

  // ── Character sheet full panel ─────────────────────────────
  function openCharSheet(idx) {
    const chars = _meta.characters || []
    const char  = chars[idx]
    if (!char) return
    _inCharSheet = true
    if (typeof App !== 'undefined' && App.updateBackBtn) App.updateBackBtn()

    // replace landing-inner content with character sheet
    const inner = document.getElementById('landing-inner')
    inner.dataset.charIdx = idx   // remember so we can save back

    inner.innerHTML = `
      <div class="char-sheet">

        <div class="cs-header">
          <div class="cs-photo-wrap" id="cs-photo-wrap">
            <div class="cs-photo-placeholder" id="cs-photo-placeholder" role="button" tabindex="0" title="Add a photo — click, or drop an image here">
              <svg viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="currentColor" stroke-width="1.2"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>
              <span class="cs-photo-placeholder-label">Add photo</span>
            </div>
            <img id="cs-photo-img" class="cs-photo-img" style="display:none" alt="">
            <div class="cs-photo-overlay" id="cs-photo-overlay">
              <button class="cs-photo-btn" id="cs-photo-view" type="button">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                <span>View</span>
              </button>
              <button class="cs-photo-btn" id="cs-photo-adjust" type="button" title="Reposition or zoom the photo">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 2v14a2 2 0 0 0 2 2h14"/><path d="M18 22V8a2 2 0 0 0-2-2H2"/></svg>
                <span>Adjust</span>
              </button>
              <button class="cs-photo-btn" id="cs-photo-change" type="button" title="Choose a different photo">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                <span>Change</span>
              </button>
              <button class="cs-photo-btn" id="cs-photo-remove" type="button" title="Remove the photo">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/></svg>
                <span>Remove</span>
              </button>
            </div>
          </div>
          <div class="cs-header-body">
            <input class="cs-name-input" type="text" id="cs-name" placeholder="Character name…" value="${esc(char.name||'')}">
            <div class="cs-header-meta">
              <select class="char-role-select" id="cs-role">
                ${CHAR_ROLES.map(r => `<option ${char.role===r?'selected':''}>${r}</option>`).join('')}
              </select>
            </div>
          </div>
        </div>

        <div class="cs-section-block">
          <div class="cs-section-title">Essence</div>
          <div class="cs-row cs-row-2">
            <div class="cs-col">
              <label class="char-lbl">One-line description</label>
              <textarea class="l-field cs-field cs-auto" id="cs-desc" rows="2" placeholder="Who are they in a sentence?">${esc(char.desc||'')}</textarea>
            </div>
            <div class="cs-col">
              <label class="char-lbl">Appearance</label>
              <textarea class="l-field cs-field cs-auto" id="cs-appearance" rows="2"
                placeholder="Physical description — what the reader sees, what they notice first…">${esc(char.appearance||'')}</textarea>
            </div>
          </div>
        </div>

        <div class="cs-section-block">
          <div class="cs-section-title">Psychology</div>
          <div class="cs-row cs-row-3 cs-row-stretch">
            <div class="cs-col">
              <label class="char-lbl">Want</label>
              <textarea class="l-field cs-field cs-auto" id="cs-want" rows="2" placeholder="External goal…">${esc(char.want||'')}</textarea>
            </div>
            <div class="cs-col">
              <label class="char-lbl">Need</label>
              <textarea class="l-field cs-field cs-auto" id="cs-need" rows="2" placeholder="What they actually need…">${esc(char.need||'')}</textarea>
            </div>
            <div class="cs-col">
              <label class="char-lbl">Fear</label>
              <textarea class="l-field cs-field cs-auto" id="cs-fear" rows="2" placeholder="What terrifies them…">${esc(char.fear||'')}</textarea>
            </div>
          </div>
          <div class="cs-col cs-col-full">
            <label class="char-lbl">Arc</label>
            <textarea class="l-field cs-field cs-auto" id="cs-arc" rows="2" placeholder="How do they change? Or fail to?">${esc(char.arc||'')}</textarea>
          </div>
        </div>

        <div class="cs-section-block">
          <div class="cs-section-title">Desire profile</div>
          <textarea class="l-field cs-field cs-auto" id="cs-desire_profile" rows="3"
            placeholder="What do they want from the other person, specifically? What does desire look like in their body, their behavior? What do they crave that they won't name?">${esc(char.desire_profile||'')}</textarea>
        </div>

        <div class="cs-section-block">
          <div class="cs-section-title">Backstory</div>
          <textarea class="l-field cs-field cs-auto" id="cs-backstory" rows="3"
            placeholder="History, formative experiences, where they come from…">${esc(char.backstory||'')}</textarea>
          <div class="cs-row cs-row-3 cs-row-stretch" style="margin-top:14px">
            <div class="cs-col">
              <label class="char-lbl">Wound</label>
              <textarea class="l-field cs-field cs-auto" id="cs-wound" rows="2"
                placeholder="The specific past pain that shaped everything…">${esc(char.wound||'')}</textarea>
            </div>
            <div class="cs-col">
              <label class="char-lbl">Lie they believe</label>
              <textarea class="l-field cs-field cs-auto" id="cs-lie" rows="2"
                placeholder="The false story they tell themselves…">${esc(char.lie||'')}</textarea>
            </div>
            <div class="cs-col">
              <label class="char-lbl">Truth they need to learn</label>
              <textarea class="l-field cs-field cs-auto" id="cs-truth" rows="2"
                placeholder="What the story is trying to teach them…">${esc(char.truth||'')}</textarea>
            </div>
          </div>
        </div>

        <div class="cs-section-block">
          <div class="cs-section-title">Relationships</div>
          <textarea class="l-field cs-field cs-auto" id="cs-relationships" rows="3"
            placeholder="How they relate to other characters — alliances, conflicts, history, dynamics…">${esc(char.relationships||'')}</textarea>
        </div>

        <div class="cs-section-block">
          <div class="cs-section-title">Voice &amp; scenes</div>
          <div class="cs-row cs-row-2">
            <div class="cs-col">
              <label class="char-lbl">Voice</label>
              <textarea class="l-field cs-field cs-auto" id="cs-voice" rows="2"
                placeholder="How they speak — cadence, vocabulary, mannerisms, phrases they use…">${esc(char.voice||'')}</textarea>
            </div>
            <div class="cs-col">
              <label class="char-lbl">Key scenes</label>
              <textarea class="l-field cs-field cs-auto" id="cs-key_scenes" rows="2"
                placeholder="Where do they appear? What are their most important moments?">${esc(char.key_scenes||'')}</textarea>
            </div>
          </div>
        </div>

        <div class="cs-section-block">
          <div class="cs-section-title">Notes</div>
          <textarea class="l-field cs-field cs-auto" id="cs-notes" rows="3"
            placeholder="Anything else — quirks, contradictions, things that don't fit elsewhere…">${esc(char.notes||'')}</textarea>
          <div id="cs-revision-notes"></div>
        </div>

      </div>`

    // wire char-sheet exit (called by toolbar back button via goBack())
    const exitCharSheet = async () => {
      _inCharSheet = false
      if (typeof App !== 'undefined' && App.updateBackBtn) App.updateBackBtn()
      saveCharSheet(idx)
      await flushPending()
      // re-open novel landing at characters tab
      open(_path, 'novel').then(() => {
        const tab = document.querySelector('[data-nltab="characters"]')
        if (tab) tab.click()
      })
    }
    _exitCharSheet = exitCharSheet

    // wire photo upload + view
    const novelPath = _path
    RevisionNotes.renderForCharacter(document.getElementById('cs-revision-notes'), novelPath, char.name)
    const charId    = char.id || ('char_' + idx)
    // ensure char has a stable id
    if (!char.id) { char.id = charId; scheduleSave() }
    const photoWrap        = document.getElementById('cs-photo-wrap')
    const photoImg         = document.getElementById('cs-photo-img')
    const photoPlaceholder = document.getElementById('cs-photo-placeholder')
    const photoOverlay     = document.getElementById('cs-photo-overlay')
    const viewBtn          = document.getElementById('cs-photo-view')
    const changeBtn        = document.getElementById('cs-photo-change')
    const adjustBtn        = document.getElementById('cs-photo-adjust')
    const removeBtn        = document.getElementById('cs-photo-remove')
    const currentChar      = () => (_meta.characters || [])[idx]

    let _photoFullPath = null  // latest path (used for View)

    const loadPhoto = async () => {
      try {
        const res = await window.quill.getCharImagePath({ novelRel: novelPath, charId })
        if (res?.fullPath) {
          _photoFullPath = res.fullPath
          // cache-bust so replacing an image actually refreshes visually
          photoImg.src = '../__vfs' + res.fullPath + '?t=' + Date.now()
          photoImg.style.display = 'block'
          photoPlaceholder.style.display = 'none'
          photoWrap.classList.add('has-photo')
          QuillPhoto.apply(photoImg, currentChar()?.photo)
        } else {
          _photoFullPath = null
          photoImg.removeAttribute('src')
          photoImg.style.display = 'none'
          photoPlaceholder.style.display = ''
          photoWrap.classList.remove('has-photo')
        }
      } catch {}
    }
    loadPhoto()

    const adjustPhoto = async () => {
      if (!_photoFullPath) return
      const c = currentChar()
      const crop = await QuillPhoto.open({
        src: '../__vfs' + _photoFullPath + '?t=' + Date.now(), crop: c?.photo,
        title: `Adjust ${c?.name || 'character'}’s photo`,
      })
      if (!crop || !c) return
      c.photo = crop
      scheduleSave()
      QuillPhoto.apply(photoImg, crop)
    }

    // A new photo starts centred, then goes straight to the cropper, like a profile photo.
    const savePhotoFrom = async srcPath => {
      try {
        await window.quill.saveCharImage({ novelRel: novelPath, charId, srcPath })
        const c = currentChar()
        if (c) { delete c.photo; scheduleSave() }
        await loadPhoto()
        await adjustPhoto()
      } catch (e) {
        console.error('[photo] upload error:', e)
        alert('Quill couldn’t add that photo. Use a JPG, PNG, WebP or GIF file.')
      }
    }

    const pickAndSavePhoto = async () => {
      const res = await window.quill.openFileDialog({ filters: [{ name:'Images', extensions:['jpg','jpeg','png','webp','gif'] }] }).catch(() => null)
      if (res?.filePath) await savePhotoFrom(res.filePath)
    }

    // placeholder click (no photo yet) and Change button both trigger upload
    photoPlaceholder.onclick = pickAndSavePhoto
    photoPlaceholder.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pickAndSavePhoto() } }
    changeBtn.onclick = (e) => { e.stopPropagation(); pickAndSavePhoto() }
    adjustBtn.onclick = (e) => { e.stopPropagation(); adjustPhoto() }
    removeBtn.onclick = async (e) => {
      e.stopPropagation()
      if (!confirm('Remove this photo? The character sheet stays.')) return
      await window.quill.deleteCharImage({ novelRel: novelPath, charId }).catch(() => {})
      const c = currentChar()
      if (c) { delete c.photo; scheduleSave() }
      await loadPhoto()
    }

    // Drop an image file from Finder onto the photo.
    photoWrap.addEventListener('dragover', e => {
      if (![...(e.dataTransfer?.types || [])].includes('Files')) return
      e.preventDefault()
      photoWrap.classList.add('drop-target')
    })
    photoWrap.addEventListener('dragleave', () => photoWrap.classList.remove('drop-target'))
    photoWrap.addEventListener('drop', async e => {
      const file = e.dataTransfer?.files?.[0]
      if (!file) return
      e.preventDefault()
      photoWrap.classList.remove('drop-target')
      const res = await window.quill.allowDroppedImage(file).catch(() => null)
      if (res?.filePath) await savePhotoFrom(res.filePath)
      else alert('Drop a JPG, PNG, WebP or GIF image.')
    })

    // View button opens lightbox
    viewBtn.onclick = (e) => {
      e.stopPropagation()
      if (!_photoFullPath) return
      openPhotoLightbox(_photoFullPath, char.name || 'Character')
    }

    // wire autosave on all cs-field elements AND the name input
    inner.querySelectorAll('.cs-field').forEach(el => {
      el.addEventListener('input', () => saveCharSheet(idx))
    })
    const csNameEl = document.getElementById('cs-name')
    if (csNameEl) csNameEl.addEventListener('input', () => saveCharSheet(idx))
    // auto-resize textareas as content grows
    inner.querySelectorAll('.cs-auto').forEach(ta => {
      const resize = () => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px' }
      ta.addEventListener('input', resize)
      resize()  // size on load
    })
    document.getElementById('cs-role').addEventListener('change', () => saveCharSheet(idx))
  }

  function saveCharSheet(idx) {
    const chars = _meta.characters || []
    const char  = chars[idx]
    if (!char) return
    const fields = ['name','role','desc','appearance','want','need','fear','arc',
                    'desire_profile','backstory','wound','lie','truth','relationships','voice','key_scenes','notes']
    fields.forEach(f => {
      const el = document.getElementById('cs-' + f)
      if (el) char[f] = el.value
    })
    _meta.characters = chars
    scheduleSave()
  }

  // ── Photo lightbox ─────────────────────────────────────────
  function openPhotoLightbox(fullPath, caption) {
    // close any existing lightbox (defensive)
    const prev = document.getElementById('cs-photo-lightbox')
    if (prev) prev.remove()

    const overlay = document.createElement('div')
    overlay.id = 'cs-photo-lightbox'
    overlay.className = 'cs-photo-lightbox'
    overlay.innerHTML = `
      <button class="cs-lb-close" type="button" aria-label="Close">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
      <div class="cs-lb-stage">
        <img class="cs-lb-img" src="../__vfs${esc(fullPath)}?t=${Date.now()}" alt="${esc(caption || '')}">
        ${caption ? `<div class="cs-lb-caption">${esc(caption)}</div>` : ''}
      </div>
    `
    const close = () => {
      document.removeEventListener('keydown', onKey)
      overlay.remove()
    }
    const onKey = (e) => { if (e.key === 'Escape') close() }
    overlay.onclick = (e) => { if (e.target === overlay) close() }
    overlay.querySelector('.cs-lb-close').onclick = close
    document.addEventListener('keydown', onKey)
    document.body.appendChild(overlay)
  }

  // ── World Bible ────────────────────────────────────────────

  function initWorldTabs() {
    const inner = document.getElementById('landing-inner')
    inner.querySelectorAll('.world-tab').forEach(tab => {
      tab.onclick = () => {
        inner.querySelectorAll('.world-tab').forEach(t => t.classList.remove('active'))
        inner.querySelectorAll('.world-pane').forEach(p => p.classList.remove('active'))
        tab.classList.add('active')
        inner.querySelector(`[data-wpane="${tab.dataset.wtab}"]`).classList.add('active')
      }
    })
  }

  function renderWorldEntries(category, entries) {
    const container = document.getElementById(`world-${category}`)
    if (!container) return
    container.innerHTML = ''
    entries.forEach((entry, idx) => {
      const row = document.createElement('div')
      row.className = 'world-entry'
      row.innerHTML = `
        <div class="world-entry-header">
          <input class="l-field world-name" type="text" placeholder="Name…" value="${esc(entry.name||'')}">
          <button class="world-del f-btn" title="Remove">
            <svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <textarea class="l-field world-desc" rows="2" placeholder="Description, notes, details…">${esc(entry.desc||'')}</textarea>`

      row.querySelector('.world-name').addEventListener('input', e => {
        entry.name = e.target.value
        saveWorld(category)
      })
      row.querySelector('.world-desc').addEventListener('input', e => {
        entry.desc = e.target.value
        saveWorld(category)
      })
      row.querySelector('.world-del').onclick = () => {
        const world = _meta.world || {}
        world[category] = (world[category]||[]).filter((_,i) => i !== idx)
        _meta.world = world
        renderWorldEntries(category, world[category])
        scheduleSave()
      }
      container.appendChild(row)
    })
  }

  function addWorldEntry(category) {
    const world = _meta.world || {}
    if (!world[category]) world[category] = []
    world[category].push({ id: uid(), name:'', desc:'' })
    _meta.world = world
    renderWorldEntries(category, world[category])
    saveWorld(category)
    const names = document.querySelectorAll(`#world-${category} .world-name`)
    if (names.length) names[names.length-1].focus()
  }

  function saveWorld(category) {
    clearTimeout(_saveTimer)
    _saveTimer = setTimeout(async () => {
      _saveTimer = null
      if (_path === null) return
      await window.quill.saveFolderMeta({ rel: _path, data: { world: _meta.world } })
    }, 600)
  }

  // ── Chapter page ───────────────────────────────────────────

  // A novel set to one POV character doesn't need a POV picker on every chapter. The row
  // stays when the novel is multi-POV, has no POV yet, or this chapter names someone else.
  function chapterNeedsPov(novelMeta, meta) {
    const novelPov = String(novelMeta.pov_character || '').trim().toLowerCase()
    if (!novelPov || novelPov === 'multiple' || novelMeta.pov_person === 'multiple') return true
    const own = String(meta.pov_character || '').trim().toLowerCase()
    return !!own && !novelPov.split(/\s+/).concat(novelPov).includes(own)
  }

  function chapterHTML(name, meta, characters = [], showPov = true) {
    const statusOptions = ['drafting','revising','polishing','done']
    const statusLabels  = { drafting:'Drafting', revising:'Revising', polishing:'Polishing', done:'Done ✓' }
    const statusPills   = statusOptions.map(s =>
      `<button class="status-pill ${(meta.status||'drafting')===s?'active':''}" data-status="${s}">${statusLabels[s]}</button>`
    ).join('')
    return `
    <div class="l-header">
      <div class="l-badge chapter">Chapter</div>
      <input class="l-title" type="text" data-key="folder_title"
        placeholder="Chapter title…" value="${esc(meta.folder_title||name)}">
      ${headerMetaHTML(meta, { goalPlaceholder:'e.g. 4000' })}
      <div class="l-header-row">
        <div class="seg chapter-status-row">
          ${statusPills}
          <input type="hidden" data-key="status" value="${esc(meta.status||'drafting')}">
        </div>
        <div class="chapter-actions">
          <button class="btn sm" id="ch-board-btn" title="This chapter's scene cards on the Board">Open in Board →</button>
          <button class="btn sm" id="ch-write-btn" title="Open every scene in this chapter as one continuous document">Edit whole chapter →</button>
        </div>
      </div>
    </div>
    <div class="rv-chapter-notice" id="ch-revision-notes" hidden></div>
    <div class="ch-panes">

      <div class="ch-pane active" data-chpane="overview">
        <div class="l-card l-props">
          ${showPov ? propRow('POV', povSelectHTML('pov_character', meta.pov_character, characters)) : ''}
          ${propRow('Setting', propText('chapter_setting', meta.chapter_setting, 'When and where…'))}
        </div>
        <div class="l-stack">
          <div class="l-card"><span class="l-lbl">What must happen in this chapter</span>
            <textarea class="l-field l-auto" data-key="chapter_goal" rows="1"
              placeholder="Plot beats, revelations, turning points that cannot be cut…">${esc(meta.chapter_goal||'')}</textarea></div>
          <div class="l-card"><span class="l-lbl">Emotional arc</span>
            <textarea class="l-field l-auto" data-key="emotional_arc" rows="1" placeholder="How does the reader feel start → end?">${esc(meta.emotional_arc||'')}</textarea></div>
          <div class="l-card"><span class="l-lbl">Summary</span>
            <textarea class="l-field l-auto" data-key="synopsis" rows="1"
              placeholder="A brief recap once written — useful for continuity checks.">${esc(meta.synopsis||'')}</textarea></div>
          <div class="l-card"><span class="l-lbl">Notes &amp; loose threads</span>
            <textarea class="l-field l-auto" data-key="notes" rows="1"
              placeholder="Continuity flags, things to fix in revision, questions to answer…">${esc(meta.notes||'')}</textarea></div>
        </div>
      </div>

    </div>`
  }

  function initChapterPage() {
    const inner = document.getElementById('landing-inner')

    // Scrivenings: the whole chapter as one document, writing back to each scene file.
    const writeBtn = inner.querySelector('#ch-write-btn')
    if (writeBtn) writeBtn.onclick = () => App.openChapter(_path)
    const boardBtn = inner.querySelector('#ch-board-btn')
    if (boardBtn) boardBtn.onclick = () => App.openBoard(_path)
    RevisionNotes.renderForChapter(inner.querySelector('#ch-revision-notes'), _path.split('/')[0], _path)

    // chapter tab switching
    inner.querySelectorAll('[data-chtab]').forEach(tab => {
      tab.onclick = () => {
        inner.querySelectorAll('[data-chtab]').forEach(t => t.classList.remove('active'))
        inner.querySelectorAll('.ch-pane').forEach(p => p.classList.remove('active'))
        tab.classList.add('active')
        inner.querySelector(`[data-chpane="${tab.dataset.chtab}"]`).classList.add('active')
        resizeAutoFields(inner.querySelector(`[data-chpane="${tab.dataset.chtab}"]`))
        if (tab.dataset.chtab === 'board') {
          const canvas = document.getElementById('chapter-board-canvas')
          if (canvas && !canvas.dataset.loaded) {
            canvas.dataset.loaded = '1'
            Board.showInLanding(_path, canvas)
          }
        }
      }
    })

    // data-key autosave
    inner.querySelectorAll('[data-key]').forEach(el => {
      el.addEventListener('input',  scheduleSave)
      el.addEventListener('change', scheduleSave)
    })

    initOverviewControls(inner)

    // status pills
    inner.querySelectorAll('.status-pill').forEach(pill => {
      pill.onclick = () => {
        inner.querySelectorAll('.status-pill').forEach(p => p.classList.remove('active'))
        pill.classList.add('active')
        const hidden = inner.querySelector('[data-key="status"]')
        if (hidden) hidden.value = pill.dataset.status
        scheduleSave()
      }
    })

    // prompt
    const pb = inner.querySelector('#l-prompt-refresh')
    if (pb) pb.onclick = () => {
      const el = inner.querySelector('#l-prompt-text')
      if (el) el.textContent = pick(NOVEL)
    }
  }

  // ── World Bible folder landing ─────────────────────────────

  // ── World Bible section landing ────────────────────────────

  // Field definitions per section type
  const WB_TEMPLATES = {
    'Locations':           [['name','Name'],['type','Type (city/forest/ruin…)'],['atmosphere','Atmosphere'],['significance','Significance'],['inhabitants','Who lives here']],
    'Magic & Rules':       [['name','Name'],['how_it_works','How it works'],['limitations','Limitations / cost'],['who_can_use','Who can use it'],['lore_origin','Lore / origin']],
    'Factions':            [['name','Name'],['goal','Goal'],['leadership','Leadership'],['members','Notable members'],['relationship_to_protagonist','Relationship to protagonist']],
    'Terminology':         [['name','Term'],['definition','Definition'],['used_by','Used by']],
    'History & Lore':      [['name','Event / era'],['when','When'],['what_happened','What happened'],['impact','Impact on present']],
    'Creatures & Races':   [['name','Name'],['appearance','Appearance'],['abilities','Abilities'],['culture','Culture'],['where_found','Where found']],
    'Politics & Power':    [['name','Entity name'],['type','Type (monarchy/guild…)'],['influence','Influence'],['key_figures','Key figures'],['tensions','Tensions']],
    'Religion & Mythology':[['name','Name'],['beliefs','Core beliefs'],['practices','Practices'],['symbols','Symbols'],['role_in_story','Role in story']],
  }

  function getWbTemplate(sectionName) {
    return WB_TEMPLATES[sectionName] || [['name','Name'],['description','Description']]
  }

  function worldBibleIndexHTML(name, meta) { return `
    <div class="l-header">
      <div class="l-badge worldbible">World Bible</div>
      <input class="l-title" type="text" data-key="folder_title"
        placeholder="World Bible" value="${esc(meta.folder_title||name)}">
      <div class="l-meta"><span class="l-wc" id="wb-index-count"></span>
        <button class="btn sm" id="wb-export-btn" disabled title="Save every section and entry as one Word document">Export .docx</button></div>
    </div>
    <div id="wb-index"><div class="act-chapter-loading">Loading…</div></div>` }

  function wbEntryPreview(card) {
    const skip = new Set(['title','name','date','tags','mood','word_goal','font','scene_id','_body','_path','_file'])
    const field = Object.entries(card).find(([key, value]) => !skip.has(key) && typeof value === 'string' && value.trim())
    const text = field ? field[1] : (card._body || '').split('\n').find(line => line.trim()) || ''
    return text.replace(/[*_#>]/g, '').trim()
  }

  async function initWorldBibleIndex(folderPath) {
    const el = document.getElementById('wb-index')
    if (!el) return
    const novelPath = folderPath.split('/')[0]
    const bibles = await window.quill.getWorldBibleFolders(novelPath).catch(() => [])
    if (_path !== folderPath) return
    const sections = (bibles.find(bible => bible.path === folderPath) || { sections:[] }).sections
    const filled = sections.filter(section => section.cards.length)
    const empty = sections.filter(section => !section.cards.length)
    const total = filled.reduce((sum, section) => sum + section.cards.length, 0)
    const countEl = document.getElementById('wb-index-count')
    if (countEl) countEl.textContent = `${total} entr${total === 1 ? 'y' : 'ies'} in ${filled.length} section${filled.length === 1 ? '' : 's'}`
    if (!sections.length) {
      el.innerHTML = '<div class="wb-empty-hint">No sections yet. Add one from the sidebar.</div>'
      return
    }
    el.innerHTML = filled.map(section => `
      <section class="wb-index-section">
        <div class="wb-index-head">
          <button type="button" class="wb-index-title" data-wb-open="${esc(section.path)}">${esc(section.title)}</button>
          <span class="wb-index-count">${section.cards.length}</span>
          <button type="button" class="btn sm" data-wb-add="${esc(section.path)}" data-wb-name="${esc(section.name)}">+ Add</button>
        </div>
        <div class="wb-index-list">
          ${section.cards.map(card => {
            const title = String(card.title || card.name || card._file.replace(/\.md$/, ''))
            const preview = wbEntryPreview(card)
            return `<button type="button" class="wb-index-entry" data-wb-entry="${esc(card._path)}">
              <span class="wb-index-entry-title">${esc(title)}</span>
              ${preview ? `<span class="wb-index-entry-preview">${esc(preview)}</span>` : ''}
            </button>`
          }).join('')}
        </div>
      </section>`).join('') + (empty.length ? `
      <div class="wb-index-empty">Empty: ${empty.map(section => `<button type="button" class="wb-index-link" data-wb-open="${esc(section.path)}">${esc(section.title)}</button>`).join(' · ')}</div>` : '')
    el.querySelectorAll('[data-wb-open]').forEach(button => { button.onclick = () => App.openFolder(button.dataset.wbOpen, 'worldbible') })
    el.querySelectorAll('[data-wb-entry]').forEach(button => { button.onclick = () => App.openFile(button.dataset.wbEntry) })
    el.querySelectorAll('[data-wb-add]').forEach(button => {
      button.onclick = () => showWbAddModal(button.dataset.wbName, button.dataset.wbAdd, () => initWorldBibleIndex(folderPath))
    })
    initWorldBibleExport(novelPath, filled, countEl?.textContent || '')
  }

  // Fields the export leaves out: the card title is its heading, the rest is bookkeeping.
  const WB_EXPORT_SKIP = new Set(['title','name','date','tags','mood','word_goal','font','scene_id'])

  function initWorldBibleExport(novelPath, sections, summary) {
    const button = document.getElementById('wb-export-btn')
    if (!button) return
    button.disabled = !sections.length
    button.onclick = async () => {
      const novelMeta = await window.quill.getFolderMeta(novelPath).catch(() => ({}))
      const model = {
        title: String(novelMeta?.folder_title || novelPath),
        summary,
        sections: sections.map(section => {
          const labels = Object.fromEntries(getWbTemplate(section.name)
            .map(([key, label]) => [key, label.replace(/\s*\(.*\)$/, '')]))
          return {
            title: section.title,
            cards: section.cards.map(card => ({
              title: String(card.title || card.name || card._file.replace(/\.md$/, '')),
              // Template fields first, in template order, then any extra frontmatter the card carries.
              fields: [...new Set([...Object.keys(labels), ...Object.keys(card)])]
                .filter(key => !key.startsWith('_') && !WB_EXPORT_SKIP.has(key))
                .filter(key => typeof card[key] === 'string' && card[key].trim())
                .map(key => [labels[key] || key.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase()), card[key].trim()]),
              body: card._body || '',
            })),
          }
        }),
      }
      button.disabled = true
      try {
        const result = await window.quill.exportWorldBibleDocx({ title: model.title, parts: ManuscriptDocx.buildWorldBible(model) })
        if (result?.ok) {
          button.textContent = 'Saved!'
          setTimeout(() => { button.textContent = 'Export .docx' }, 1400)
        } else if (result?.error) alert(result.error)
      } catch (error) {
        alert(`Couldn’t export the World Bible: ${error.message}`)
      } finally {
        button.disabled = !sections.length
      }
    }
  }

  function worldBibleFolderHTML(name, meta) { return `
    <div class="l-header">
      <div class="l-badge worldbible">World Bible</div>
      <input class="l-title" type="text" data-key="folder_title"
        placeholder="Section title…" value="${esc(meta.folder_title||name)}">
    </div>
    <div class="wb-section-intro">
      <textarea class="l-field" data-key="description" rows="2"
        placeholder="Notes about this section…">${esc(meta.description||'')}</textarea>
    </div>
    <div class="wb-cards-header">
      <button class="btn sm" id="wb-add-card-btn">+ Add ${esc(meta.folder_title||name).replace(/s$/,'')}</button>
    </div>
    <div id="wb-cards-list"></div>` }

  async function initWorldBiblePage(folderPath) {
    // Determine section name from path
    const sectionName = folderPath.split('/').pop()
    const template    = getWbTemplate(sectionName)

    // Load and render cards
    async function loadCards() {
      const list = document.getElementById('wb-cards-list')
      if (!list) return
      const tree = await window.quill.getTree().catch(() => null)
      if (!tree) return

      function findNode(node, target) {
        if (node.path === target) return node
        for (const c of (node.children||[])) { const f = findNode(c, target); if (f) return f }
        return null
      }
      const node  = findNode(tree, folderPath)
      const files = node ? (node.files || []) : []

      list.innerHTML = ''
      if (!files.length) {
        list.innerHTML = `<div class="wb-empty-hint">No entries yet — click the button above to add your first one.</div>`
        return
      }

      for (const file of files) {
        try {
          const data  = await window.quill.getFile(file.path).catch(() => null)
          if (!data) continue
          const fm    = data.meta || {}
          const rawTitle = fm.title || file.title || file.name.replace(/\.md$/,'')
          const title = (rawTitle === 'undefined' || !rawTitle) ? file.name.replace(/\.md$/,'') : rawTitle
          const card  = document.createElement('div')
          card.className  = 'wb-card'
          card.dataset.path = file.path

          // Build fields HTML (skip title since it's the header)
          const fieldsHtml = template.filter(([key]) => key !== 'name').map(([key, label]) => {
            const val = fm[key] || ''
            return `<div class="wb-card-field">
              <div class="wb-field-label">${esc(label)}</div>
              <div class="wb-field-value ${val ? '' : 'wb-field-empty'}">${esc(val) || '<em>—</em>'}</div>
            </div>`
          }).join('')

          // body notes
          const bodyPreview = data.body?.trim()
            ? `<div class="wb-card-notes">${esc(data.body.trim().slice(0,300))}${data.body.trim().length > 300 ? '…' : ''}</div>`
            : ''

          card.innerHTML = `
            <div class="wb-card-header">
              <div class="wb-card-title">${esc(title)}</div>
              <button class="wb-card-edit btn ghost sm">Edit</button>
              <button class="wb-card-toggle icon-btn" title="Show or hide details" aria-label="Show or hide details for ${esc(title)}">
                <svg viewBox="0 0 24 24" class="wb-chevron"><polyline points="6 9 12 15 18 9"/></svg>
              </button>
            </div>
            <div class="wb-card-body" style="display:none">
              ${fieldsHtml}
              ${bodyPreview}
            </div>`

          // toggle expand
          card.querySelector('.wb-card-header').addEventListener('click', e => {
            if (e.target.closest('.wb-card-edit')) return
            const body = card.querySelector('.wb-card-body')
            const chev = card.querySelector('.wb-chevron')
            const open = body.style.display !== 'none'
            body.style.display = open ? 'none' : 'block'
            chev.style.transform = open ? '' : 'rotate(180deg)'
          })

          // edit — opens file in editor
          card.querySelector('.wb-card-edit').onclick = e => {
            e.stopPropagation()
            App.openFile(file.path)
          }

          list.appendChild(card)
        } catch {}
      }
    }

    // Add card button — opens a clean modal dialog
    const addBtn = document.getElementById('wb-add-card-btn')
    if (addBtn) {
      addBtn.onclick = () => showWbAddModal(sectionName, folderPath, async () => { await loadCards() })
    }

    await loadCards()
  }

  // ── Act landing ────────────────────────────────────────────

  function actHTML(name, meta) { return `
    <div class="l-header">
      <div class="l-badge act">Act</div>
      <input class="l-title" type="text" data-key="folder_title"
        placeholder="Act title… e.g. Act I — The Ordinary World"
        value="${esc(meta.folder_title||name)}">
      <div class="l-meta"><span class="l-wc" id="l-wc"></span></div>
    </div>
    <div class="l-stack">
      <div class="l-card">
        <span class="l-lbl">Act purpose</span>
        <textarea class="l-field l-auto" data-key="purpose" rows="1"
          placeholder="What must this act accomplish? What changes by the end?">${esc(meta.purpose||'')}</textarea>
      </div>
      <div class="l-grid">
        <div class="l-card">
          <span class="l-lbl">Opens with</span>
          <textarea class="l-field l-auto" data-key="opens_with" rows="1" placeholder="Where do we begin…">${esc(meta.opens_with||'')}</textarea>
        </div>
        <div class="l-card">
          <span class="l-lbl">Ends with</span>
          <textarea class="l-field l-auto" data-key="ends_with" rows="1" placeholder="What's the turning point / exit…">${esc(meta.ends_with||'')}</textarea>
        </div>
      </div>
      <div class="l-card">
        <span class="l-lbl">Emotional journey</span>
        <textarea class="l-field l-auto" data-key="emotional_arc" rows="1" placeholder="Reader's emotional state: start → end of this act…">${esc(meta.emotional_arc||'')}</textarea>
      </div>
    </div>
    <div class="act-chapters-section">
      <div class="l-lbl">Chapters in this act</div>
      <div id="act-chapter-list"><div class="act-chapter-loading">Loading chapters…</div></div>
    </div>` }

  async function loadActChapters(actPath) {
    const list = document.getElementById('act-chapter-list')
    if (!list) return
    const tree = await window.quill.getTree().catch(() => null)
    if (!tree) { list.innerHTML = '<div class="act-chapter-loading">Could not load chapters.</div>'; return }

    function findNode(node, target) {
      if (node.path === target) return node
      for (const c of (node.children||[])) { const f = findNode(c, target); if (f) return f }
      return null
    }
    const actNode = findNode(tree, actPath)
    const chapters = actNode ? actNode.children || [] : []

    if (!chapters.length) {
      list.innerHTML = '<div class="act-chapter-loading">No chapter subfolders yet. Create folders inside this act.</div>'
      return
    }
    const metas = await Promise.all(chapters.map(ch => window.quill.getFolderMeta(ch.path).catch(() => ({}))))
    if (_path !== actPath) return
    list.innerHTML = ''
    chapters.forEach((ch, index) => {
      const meta = metas[index] || {}
      const scenes = []
      ;(function collect(n) { (n.files||[]).forEach(f => scenes.push(f)); (n.children||[]).forEach(collect) })(ch)
      const words = scenes.reduce((sum, f) => sum + (f.word_count || 0), 0)
      const withProse = scenes.filter(f => f.word_count > 0).length
      const goal = parseInt(meta.project_word_goal || '0', 10)
      const status = String(meta.status || '').trim()
      const details = [
        meta.pov_character ? esc(meta.pov_character) : '',
        scenes.length ? `${scenes.length} scene${scenes.length === 1 ? '' : 's'}${withProse < scenes.length ? ` · ${withProse} with prose` : ''}` : 'no scenes',
      ].filter(Boolean)
      const row = document.createElement('div')
      row.className = 'act-chapter-row'
      row.innerHTML = `
        <div class="act-chapter-main">
          <div class="act-chapter-name">${esc(meta.folder_title || ch.name)}</div>
          <div class="act-chapter-detail">${details.join(' · ')}</div>
        </div>
        ${status ? `<span class="l-status-tag ${esc(status)}">${esc(status)}</span>` : ''}
        <div class="act-chapter-wc">${words ? words.toLocaleString() : '—'}${goal ? ` / ${goal.toLocaleString()}` : ''}</div>`
      row.onclick = () => App.openFolder(ch.path, ch.folder_type || 'novel')
      list.appendChild(row)
    })
  }

  // ── Journal landing ────────────────────────────────────────

  function journalHTML(name, meta) { return `
    <div class="l-header">
      <div class="l-badge journal">Journal</div>
      <input class="l-title" type="text" data-key="folder_title"
        placeholder="Journal name…" value="${esc(meta.folder_title||name)}">
      <div class="l-meta"><span class="l-wc" id="l-wc"></span>
        <button class="btn sm l-backup-btn" type="button" data-backup-type="journal">↓ Back up…</button></div>
    </div>
    <div class="journal-write-actions"><button class="btn primary" id="journal-write-today">Write today’s entry</button></div>
    <div class="l-grid">
      <div class="l-card l-wide"><span class="l-lbl">What is this journal for?</span>
        <textarea class="l-field" data-key="purpose" rows="2"
          placeholder="Processing, tracking, creative exploration…">${esc(meta.purpose||'')}</textarea></div>
      <div class="l-card"><span class="l-lbl">Intention</span>
        <textarea class="l-field l-auto" data-key="intention" rows="2" placeholder="One word or phrase…">${esc(meta.intention||'')}</textarea></div>
      <div class="l-card"><span class="l-lbl">Writing rhythm</span>
        <textarea class="l-field l-auto" data-key="rhythm" rows="2" placeholder="e.g. every morning, weekly…">${esc(meta.rhythm||'')}</textarea></div>
    </div>
    <div class="l-journal-calendar-wrap">
      <div class="l-journal-cal-header">
        <button class="l-cal-nav" id="j-cal-prev" aria-label="Previous month">&#8249;</button>
        <span class="l-cal-month-label" id="j-cal-label"></span>
        <button class="l-cal-nav" id="j-cal-next" aria-label="Next month">&#8250;</button>
      </div>
      <div class="l-journal-calendar" id="j-cal-grid"></div>
      <div id="journal-day-entries" aria-live="polite"></div>
    </div>
    <div class="l-prompt">
      <div class="l-prompt-tag">Today's prompt</div>
      <div class="l-prompt-text" id="l-prompt-text">${esc(meta.last_prompt||pick(JOURNAL))}</div>
      <button class="btn primary" id="journal-write-prompt">Write from this prompt</button>
      <button class="l-prompt-btn" id="l-prompt-refresh">&#x21BA; New prompt</button>
    </div>` }

  // A folder inside a journal: same calendar and write actions, without the journal-level fields.
  function journalSubHTML(name, meta) {
    const full = journalHTML(name, meta)
    const doc = new DOMParser().parseFromString(`<div>${full}</div>`, 'text/html').body.firstChild
    doc.querySelector('.l-grid')?.remove()
    doc.querySelector('.l-backup-btn')?.remove()
    const badge = doc.querySelector('.l-badge')
    if (badge) badge.textContent = 'Journal folder'
    const title = doc.querySelector('.l-title')
    if (title) title.placeholder = 'Folder name…'
    const today = doc.querySelector('#journal-write-today')
    if (today) today.textContent = 'Write an entry here'
    return doc.innerHTML
  }

  async function initJournalPage(folderPath) {
    initSimplePage('journal')
    document.getElementById('journal-write-today').onclick = () => App.newFile({ folder:folderPath, folderType:'journal' })
    document.getElementById('journal-write-prompt').onclick = () => App.newFile({
      folder:folderPath, folderType:'journal', prompt:document.getElementById('l-prompt-text').textContent.trim(),
    })

    // Collect all entry dates across all subfolders recursively
    const allFiles = []
    async function collectFiles(fPath) {
      try {
        const files = await window.quill.getFilesInFolder(fPath)
        files.forEach(f => { if (f.date) allFiles.push({ path: f.path, date: f.date, title:f.title }) })
        const tree = await window.quill.getTree()
        function findNode(node, target) {
          if (node.path === target) return node
          for (const ch of (node.children||[])) { const r = findNode(ch, target); if (r) return r }
          return null
        }
        const node = findNode(tree, fPath)
        if (node) {
          for (const child of (node.children || [])) {
            await collectFiles(child.path)
          }
        }
      } catch(e) { console.error('collectFiles error', e) }
    }
    await collectFiles(folderPath)

    // Build a map of YYYY-MM-DD -> [file paths]
    const dateMap = {}
    allFiles.forEach(({ path: fp, date }) => {
      const d = (date || '').slice(0, 10)
      if (d && /^\d{4}-\d{2}-\d{2}$/.test(d)) {
        if (!dateMap[d]) dateMap[d] = []
        dateMap[d].push(fp)
      }
    })

    const now    = new Date()
    let calYear  = now.getFullYear()
    let calMonth = now.getMonth()

    function renderCalendar() {
      document.getElementById('journal-day-entries').innerHTML = ''
      const label = document.getElementById('j-cal-label')
      const grid  = document.getElementById('j-cal-grid')
      if (!label || !grid) return
      const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']
      const DAYS   = ['Su','Mo','Tu','We','Th','Fr','Sa']
      label.textContent = MONTHS[calMonth] + ' ' + calYear

      const firstDay  = new Date(calYear, calMonth, 1).getDay()
      const daysInMon = new Date(calYear, calMonth + 1, 0).getDate()
      const todayStr  = now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2,'0') + '-' + String(now.getDate()).padStart(2,'0')

      let html = DAYS.map(d => '<div class="j-cal-dow">' + d + '</div>').join('')
      for (let i = 0; i < firstDay; i++) html += '<div class="j-cal-empty"></div>'
      for (let d = 1; d <= daysInMon; d++) {
        const key  = calYear + '-' + String(calMonth+1).padStart(2,'0') + '-' + String(d).padStart(2,'0')
        const has  = !!dateMap[key]
        const isToday = key === todayStr
        const paths = JSON.stringify(has ? dateMap[key] : []).replace(/'/g, '&#39;')
        html += '<button type="button"' + (has ? '' : ' disabled') + ' aria-label="' + key + (has ? ', open entries' : ', no entries') + '" class="j-cal-day' + (has ? ' has-entry' : '') + (isToday ? ' today' : '') + '"'
             +  ' data-date="' + key + '" data-paths=\'' + paths + '\'>' + d + '</button>'
      }
      grid.innerHTML = html

      grid.querySelectorAll('.j-cal-day.has-entry').forEach(cell => {
        cell.onclick = () => {
          try {
            const paths = JSON.parse(cell.dataset.paths || '[]')
            const list = document.getElementById('journal-day-entries')
            list.innerHTML = '<h3>' + esc(cell.dataset.date) + '</h3>'
            paths.forEach(fp => {
              const button = document.createElement('button')
              button.type = 'button'
              button.className = 'btn sm'
              button.textContent = allFiles.find(file => file.path === fp)?.title || fp.split('/').pop().replace(/\.md$/, '')
              button.onclick = () => App.openFile(fp)
              list.appendChild(button)
            })
            list.querySelector('button')?.focus()
          } catch {}
        }
      })
    }

    renderCalendar()

    const prevBtn = document.getElementById('j-cal-prev')
    const nextBtn = document.getElementById('j-cal-next')
    if (prevBtn) prevBtn.onclick = () => { calMonth--; if (calMonth < 0) { calMonth = 11; calYear-- } renderCalendar() }
    if (nextBtn) nextBtn.onclick = () => { calMonth++; if (calMonth > 11) { calMonth = 0; calYear++ } renderCalendar() }
  }

  function generalHTML(name, meta) { return `
    <div class="l-header">
      <input class="l-title" type="text" data-key="folder_title"
        placeholder="Folder title…" value="${esc(meta.folder_title||name)}">
      <div class="l-wc" id="l-wc"></div>
    </div>
    <div class="l-grid">
      <div class="l-card l-wide"><span class="l-lbl">Description</span>
        <textarea class="l-field" data-key="description" rows="3"
          placeholder="What's in this folder?">${esc(meta.description||'')}</textarea></div>
    </div>` }

  function scratchHTML(name, meta) { return `
    <div class="l-header">
      <div class="l-badge scratch">Scratch</div>
      <input class="l-title" type="text" data-key="folder_title"
        placeholder="Scratch" value="${esc(meta.folder_title||name)}">
      <div class="l-wc" id="l-wc"></div>
    </div>
    <div class="scratch-landing">
      <div class="scratch-desc">Fragments, prompt responses, and orphaned pieces that don't have a home yet. When one is ready, right-click it in the sidebar and choose Move to….</div>
      <div class="scratch-tabs" role="tablist" aria-label="Scratch sections">
        <button class="scratch-tab active" data-scratch-tab="files" role="tab" aria-selected="true">Files</button>
        <button class="scratch-tab" data-scratch-tab="inbox" role="tab" aria-selected="false">Idea Inbox</button>
      </div>
      <div class="scratch-pane active" data-scratch-pane="files">
        <div class="scratch-toolbar">
          <button class="btn primary" id="scratch-new-btn">+ New file</button>
          <button class="btn sm" id="scratch-new-folder-btn">+ Subfolder</button>
        </div>
        <div id="scratch-file-list" class="scratch-file-list">
          <div class="scratch-empty">No files yet — click New file or write to a prompt from the dashboard.</div>
        </div>
      </div>
      <div class="scratch-pane" data-scratch-pane="inbox">
        <div class="scratch-inbox-intro">A low-pressure holding place for ideas you aren't ready to develop in Ideas.</div>
        <div id="scratch-idea-inbox" class="scratch-idea-inbox"></div>
      </div>
    </div>` }

  function initScratchPage(folderPath) {
    const inner = document.getElementById('landing-inner')
    inner.querySelectorAll('[data-key]').forEach(el => {
      el.addEventListener('input',  scheduleSave)
      el.addEventListener('change', scheduleSave)
    })
    inner.querySelectorAll('[data-scratch-tab]').forEach(tab => {
      tab.onclick = () => {
        const name = tab.dataset.scratchTab
        inner.querySelectorAll('[data-scratch-tab]').forEach(button => {
          const active = button === tab
          button.classList.toggle('active', active)
          button.setAttribute('aria-selected', String(active))
        })
        inner.querySelectorAll('[data-scratch-pane]').forEach(pane => {
          pane.classList.toggle('active', pane.dataset.scratchPane === name)
        })
        if (name === 'inbox') {
          const inbox = inner.querySelector('#scratch-idea-inbox')
          if (inbox && !inbox.dataset.mounted) {
            inbox.dataset.mounted = '1'
            Scraps.showInbox(folderPath, inbox)
          }
        }
      }
    })
    const newBtn = inner.querySelector('#scratch-new-btn')
    if (newBtn) {
      newBtn.onclick = () => {
        App.setCurrentFolder(folderPath, 'scratch')
        App.newFile()
      }
    }
    const newFolderBtn = inner.querySelector('#scratch-new-folder-btn')
    if (newFolderBtn) {
      newFolderBtn.onclick = () => {
        // dispatch to tree's simple folder modal via a custom event
        document.dispatchEvent(new CustomEvent('scratch-new-subfolder', { detail: { path: folderPath } }))
      }
    }
    // load files in this folder
    loadScratchFiles(folderPath)
  }

  async function loadScratchFiles(folderPath) {
    const listEl = document.getElementById('scratch-file-list')
    if (!listEl) return
    const files = await window.quill.getFilesInFolder(folderPath).catch(() => [])
    if (!files.length) return  // keep empty state
    listEl.innerHTML = ''
    files.forEach(f => {
      const row = document.createElement('div')
      row.className = 'scratch-file-row'
      const wc = f.word_count > 0 ? `<span class="scratch-file-wc">${f.word_count.toLocaleString()} w</span>` : ''
      row.innerHTML = `
        <span class="scratch-file-title">${esc(f.title || f.name.replace(/\.md$/,''))}</span>
        ${wc}`
      row.onclick = () => App.openFile(f.path)
      listEl.appendChild(row)
    })
  }

  // ── Style Lab: Recent reps list ─────────────────────────────
  function stylelabRepsHTML(name, meta) {
    return '<div class="l-header">' +
      '<div class="l-badge" style="background:var(--surface2);color:var(--muted);">Style Lab</div>' +
      '<div class="l-title" style="font-family:var(--heading);font-size:28px;line-height:1.2;">' + esc(meta.folder_title||name) + '</div>' +
    '</div>' +
    '<div class="scratch-landing">' +
      '<div class="scratch-desc">Every drill you complete with auto-save on lands here. Click any rep to read the prompt, your writing, and the feedback you got.</div>' +
      '<div id="sl-reps-list" class="scratch-file-list">' +
        '<div class="scratch-empty">No reps yet — head to Style Lab and run a drill. Auto-save is on by default.</div>' +
      '</div>' +
    '</div>'
  }

  function initStyleLabRepsPage(folderPath) {
    loadStyleLabReps(folderPath)
  }

  async function loadStyleLabReps(folderPath) {
    const listEl = document.getElementById('sl-reps-list')
    if (!listEl) return
    const files = await window.quill.getFilesInFolder(folderPath).catch(() => [])
    const reps = files.filter(f => f.kind === 'stylelab_rep' || /\d{4}-\d{2}-\d{2}/.test(f.title || ''))
    if (!reps.length) {
      listEl.innerHTML = '<div class="scratch-empty">No reps yet — head to Style Lab and run a drill. Auto-save is on by default.</div>'
      return
    }
    reps.sort((a, b) => {
      const da = (a.date || '') + (a.time || '')
      const db = (b.date || '') + (b.time || '')
      return db.localeCompare(da)
    })
    listEl.innerHTML = ''
    reps.forEach(f => {
      const row = document.createElement('div')
      row.className = 'scratch-file-row sl-rep-row'
      const drill = f.drill || (f.title || '').split('·')[0].trim() || 'Rep'
      const date  = f.date  || ''
      const time  = f.time ? ' · ' + f.time.slice(0,2) + ':' + f.time.slice(2) : ''

      const titleSpan = document.createElement('span')
      titleSpan.className = 'scratch-file-title'
      titleSpan.textContent = drill

      const dateSpan = document.createElement('span')
      dateSpan.className = 'scratch-file-wc'
      dateSpan.style.fontFamily = 'var(--ui)'
      dateSpan.textContent = date + time

      const delBtn = document.createElement('button')
      delBtn.className = 'sl-rep-del'
      delBtn.title = 'Delete this rep'
      delBtn.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" pointer-events="none"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>'

      row.appendChild(titleSpan)
      row.appendChild(dateSpan)
      row.appendChild(delBtn)

      row.addEventListener('click', (e) => {
        if (e.target.closest('.sl-rep-del')) return
        // A Style Study rep is a log entry; the study itself opens in Style Study.
        if (f.study_id && typeof StyleStudy !== 'undefined') { StyleStudy.openStudyFromAnywhere(f.study_id); return }
        App.openFile(f.path)
      })

      delBtn.addEventListener('click', async (e) => {
        e.stopPropagation()
        e.preventDefault()
        // Visual feedback
        delBtn.classList.add('confirm')
        try {
          const result = await window.quill.delete(f.path)
          if (result && result.ok !== false) {
            // Remove the row immediately for snappy feel
            row.remove()
            if (!listEl.querySelector('.sl-rep-row')) {
              listEl.innerHTML = '<div class="scratch-empty">No reps yet — head to Style Lab and run a drill. Auto-save is on by default.</div>'
            }
          } else {
            delBtn.classList.remove('confirm')
            console.error('Delete returned non-ok:', result)
          }
        } catch (err) {
          delBtn.classList.remove('confirm')
          console.error('Delete failed:', err)
        }
      })

      listEl.appendChild(row)
    })
  }

  function initSimplePage(type) {
    const inner = document.getElementById('landing-inner')
    inner.querySelectorAll('[data-key]').forEach(el => {
      el.addEventListener('input',  scheduleSave)
      el.addEventListener('change', scheduleSave)
    })
    const pb = inner.querySelector('#l-prompt-refresh')
    if (pb) pb.onclick = () => {
      const el = inner.querySelector('#l-prompt-text')
      if (el) el.textContent = type === 'journal' ? pick(JOURNAL) : pick(NOVEL)
    }
  }

  // ── Word count totals ──────────────────────────────────────

  async function updateTotals(folderPath, meta) {
    try {
      const tree = await window.quill.getTree()
      function find(node, target) {
        if (node.path === target) return node
        for (const c of (node.children||[])) { const f=find(c,target); if(f) return f }
        return null
      }
      const node = find(tree, folderPath)
      if (!node) return
      let total = 0
      function sum(n) { if (n.folder_type === 'worldbible') return; (n.files||[]).forEach(f=>total+=(f.word_count||0)); (n.children||[]).forEach(sum) }
      sum(node)
      const goal = parseInt(meta.project_word_goal||'0', 10)
      const pct = goal > 0 ? Math.min(100, Math.round((total/goal)*100)) : 0
      const wcel = document.getElementById('l-wc')
      if (wcel) wcel.textContent = goal > 0
        ? `${total.toLocaleString()} of ${goal.toLocaleString()} words · ${pct}%`
        : `${total.toLocaleString()} words`
      const bar = document.getElementById('l-prog')
      if (bar) {
        bar.style.width = pct + '%'
        bar.closest('.l-prog-wrap')?.toggleAttribute('hidden', !goal)
      }
    } catch {}
  }

  // ── Glimpse ────────────────────────────────────────────────

  async function loadGlimpse(novelPath) {
    const textEl   = document.getElementById('glimpse-text')
    const sourceEl = document.getElementById('glimpse-source')
    const block    = document.getElementById('glimpse-block')
    const refreshBtn = document.getElementById('glimpse-refresh')
    if (!textEl) return

    async function fetchPassage() {
      textEl.textContent = '…'
      const passage = await window.quill.getRandomPassage(novelPath).catch(() => null)
      if (!passage) {
        if (block) block.style.display = 'none'
        return
      }
      // strip markdown formatting — the container is already styled italic
      let clean = passage.text
        .replace(/\*\*(.+?)\*\*/g, '$1')
        .replace(/\*(.+?)\*/g, '$1')
        .replace(/~~(.+?)~~/g, '$1')
        .replace(/\*/g, '')              // remove any remaining stray asterisks
      textEl.textContent = clean
      if (sourceEl) sourceEl.textContent = 'from: ' + passage.title
    }

    if (refreshBtn) refreshBtn.onclick = fetchPassage
    await fetchPassage()
  }

  // ── Read Draft view ────────────────────────────────────────

  async function loadReadDraft(novelPath) {
    const container = document.getElementById('read-content')
    if (!container) return
    container.innerHTML = '<div class="read-loading">Assembling draft…</div>'
    await flushPending()   // a pen name typed a moment ago belongs on the title page
    const [sections, projectMeta] = await Promise.all([
      window.quill.assembleNovel(novelPath).catch(() => []),
      window.quill.getFolderMeta(novelPath).catch(() => ({})),
    ])
    if (!sections.length) {
      container.innerHTML = '<div class="read-loading">Nothing written yet.</div>'
      return
    }
    await ReadDraft.render(container, { sections, meta: projectMeta, scope: 'novel' })
  }

  // The draft as Markdown, prose only: a scene with no words (or only [stubs]) is left out,
  // and so is any chapter or act left with nothing in it. Built for pasting into a chat,
  // where a hundred empty outline headings would bury the pages that exist.
  async function buildProseMd(novelPath) {
    const sections = await window.quill.assembleNovel(novelPath).catch(() => [])
    const name = (_meta.folder_title || novelPath.split('/').pop() || 'Novel')
    let md = '', act = null, chapter = null, sceneInChapter = false
    sections.forEach(s => {
      if (s.type === 'act')          { act = s.title; chapter = null }
      else if (s.type === 'chapter') { chapter = s.title; sceneInChapter = false }
      else if (s.type === 'scene' && QuillWords.countPlain(s.body || '') > 0) {
        if (act !== null)     { md += `${md ? '---\n\n' : ''}# ${act}\n\n`; act = null }
        if (chapter !== null) { md += `## ${chapter}\n\n`; chapter = null }
        else if (sceneInChapter) md += '* * *\n\n'
        md += s.body.trim() + '\n\n'
        sceneInChapter = true
      }
    })
    return md ? { name, md: `# ${name}\n\n` + md } : null
  }

  async function exportNovelMd(novelPath) {
    const built = await buildProseMd(novelPath)
    if (!built) { alert('Nothing to export yet.'); return }
    await window.quill.exportNovelMd({ novelPath, title: built.name, content: built.md })
      .catch(e => alert('Export failed: ' + e.message))
  }

  async function copyNovelMd(novelPath, button) {
    const flash = (label, ms = 1400) => {
      button.textContent = label
      setTimeout(() => { button.textContent = 'Copy prose' }, ms)
    }
    const built = await buildProseMd(novelPath)
    if (!built) { alert('Nothing to copy yet.'); return }
    try {
      await navigator.clipboard.writeText(built.md)
      flash('Copied!')
    } catch {
      flash('Couldn’t copy', 1800)
    }
  }

  // ── Save ───────────────────────────────────────────────────

  function scheduleSave() {
    clearTimeout(_saveTimer)
    _saveTimer = setTimeout(() => {
      _saveTimer = null
      doSave()
    }, 800)
  }

  async function doSave() {
    if (_path === null) return
    clearTimeout(_saveTimer)
    _saveTimer = null
    const inner   = document.getElementById('landing-inner')
    const payload = {}
    inner.querySelectorAll('[data-key]').forEach(el => {
      payload[el.dataset.key] = el.value !== undefined ? el.value : el.textContent
    })
    inner.querySelectorAll('[data-mkey]').forEach(el => {
      payload[el.dataset.mkey] = el.value !== undefined ? el.value : el.textContent
    })
    const pt = inner.querySelector('#l-prompt-text')
    if (pt) payload.last_prompt = pt.textContent
    // preserve structured data that's saved separately
    if (_meta.beats)         payload.beats         = _meta.beats
    if (_meta.beat_template) payload.beat_template = _meta.beat_template
    if (_meta.characters)    payload.characters    = _meta.characters
    if (_meta.world)         payload.world         = _meta.world
    if (_meta.scenes)        payload.scenes        = _meta.scenes
    await window.quill.saveFolderMeta({ rel: _path, data: payload })
  }

  async function flushPending() {
    await flushOutliner()
    await CaseBuilder.flush()
    if (_timelineSaveTimer) await saveTimeline(false)
    if (!_saveTimer) return
    clearTimeout(_saveTimer)
    _saveTimer = null
    await doSave()
  }

  // ── Seed Scene Generator ──────────────────────────────────

  function initSeedScene(novelPath, meta) {
    const banner = document.getElementById('seed-banner')
    if (!banner) return

    // The model is set once in Settings → AI.
    const modelName = document.getElementById('seed-model-name')
    if (modelName) modelName.textContent = QuillModels.label(QuillModels.current())
    const apiKeyEl = document.getElementById('seed-api-key')
    if (apiKeyEl) {
      QuillAI.showKeyField(apiKeyEl)
      apiKeyEl.addEventListener('change', () => QuillAI.saveKeyField(apiKeyEl).catch(err => alert(err.message)))
    }

    // style pills — multi-select
    const activePills = new Set(['literary'])
    document.getElementById('seed-style-pills')?.addEventListener('click', e => {
      const pill = e.target.closest('.style-pill')
      if (!pill) return
      pill.classList.toggle('active')
      if (pill.classList.contains('active')) activePills.add(pill.dataset.style)
      else activePills.delete(pill.dataset.style)
    })

    // instructions toggle
    document.getElementById('seed-instr-toggle')?.addEventListener('click', () => {
      const panel = document.getElementById('seed-instr-panel')
      const btn   = document.getElementById('seed-instr-toggle')
      if (!panel) return
      const open = panel.style.display === 'none'
      panel.style.display = open ? '' : 'none'
      btn.textContent = open ? 'Instructions ‹' : 'Instructions ›'
      if (open) {
        const ta = document.getElementById('seed-instr-ta')
        if (ta && !ta.value) ta.value = localStorage.getItem('quill_seed_instructions') || ''
      }
    })
    document.getElementById('seed-instr-save')?.addEventListener('click', () => {
      const val = (document.getElementById('seed-instr-ta')?.value || '').trim()
      if (val) localStorage.setItem('quill_seed_instructions', val)
      else localStorage.removeItem('quill_seed_instructions')
      document.getElementById('seed-instr-panel').style.display = 'none'
      document.getElementById('seed-instr-toggle').textContent = 'Instructions ›'
    })
    document.getElementById('seed-instr-reset')?.addEventListener('click', () => {
      localStorage.removeItem('quill_seed_instructions')
      const ta = document.getElementById('seed-instr-ta')
      if (ta) ta.value = ''
    })

    let _lastScene = ''

    // generate
    const doGenerate = async () => {
      const hasKey = await QuillAI.hasKey()
      if (!hasKey) {
        document.getElementById('seed-footer-note').textContent = 'Add your OpenRouter API key in Settings → AI (⌘,) first.'
        return
      }
      const model      = QuillModels.current()
      const pov        = document.getElementById('seed-pov')?.value.trim()        || 'first person'
      const atmosphere = document.getElementById('seed-atmosphere')?.value.trim() || ''
      const entry      = document.getElementById('seed-entry')?.value.trim()      || ''
      const length     = document.getElementById('seed-length')?.value.trim()     || '~500 words'
      const customTxt  = document.getElementById('seed-custom-text')?.value.trim() || ''
      const pillStyles = [...activePills].join(', ')
      const styles     = [pillStyles, customTxt].filter(Boolean).join(', ')
      const instrOverride = localStorage.getItem('quill_seed_instructions')

      const chars = (meta.characters || []).slice(0, 3).map(c =>
        `${c.name || 'Unnamed'} (${c.role || ''}): want: ${c.want || ''}, fear: ${c.fear || ''}, wound: ${c.wound || ''}`
      ).join('\n')

      const systemPrompt = instrOverride || `You are a literary fiction writer specializing in ${meta.genre || 'genre fiction'}. You write scenes that are visceral, psychologically precise, and true to the emotional register of the story. You never sanitize. You write prose that earns its moments. You do not explain — you show.`

      const userPrompt = `Write a scene for this novel.

NOVEL: ${meta.folder_title || 'Untitled'}
GENRE: ${meta.genre || ''}
LOGLINE: ${meta.logline || ''}
THEMES: ${meta.themes || ''}

CHARACTERS:
${chars || '(none defined yet)'}

SCENE PARAMETERS:
- POV: ${pov}
- Atmosphere: ${atmosphere}
- Entry point: ${entry}
- Length: ${length}
- Style: ${styles}

Write only the scene itself. No title, no preamble, no commentary after. Start immediately in the action.`

      const btn = document.getElementById('seed-generate-btn')
      const noteEl = document.getElementById('seed-footer-note')
      btn.disabled = true
      btn.textContent = 'Generating…'
      noteEl.textContent = 'Reading your novel…'

      const outputEl  = document.getElementById('seed-output')
      const outputTxt = document.getElementById('seed-output-text')
      const labelTxt  = document.getElementById('seed-output-label-text')
      outputEl.style.display = 'none'

      try {
        const resp = await QuillAI.fetch({
          method: 'POST',
          body: JSON.stringify({
            model,
            max_tokens: 1200,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user',   content: userPrompt },
            ]
          })
        })
        const data  = await resp.json()
        if (data.error) throw new Error(data.error.message || 'API error')
        _lastScene  = data.choices?.[0]?.message?.content || ''
        outputTxt.textContent = _lastScene
        labelTxt.textContent  = ['Scene', styles, atmosphere, entry].filter(Boolean).join(' · ')
        outputEl.style.display = ''
        noteEl.textContent = 'Opens as a new scene file in Act 1'
      } catch (err) {
        noteEl.textContent = 'Error: ' + err.message
      } finally {
        btn.disabled = false
        btn.textContent = 'Generate scene'
      }
    }

    document.getElementById('seed-generate-btn')?.addEventListener('click', doGenerate)
    document.getElementById('seed-regen-btn')?.addEventListener('click', doGenerate)

    document.getElementById('seed-copy-btn')?.addEventListener('click', () => {
      if (_lastScene) navigator.clipboard.writeText(_lastScene).catch(() => {})
      const btn = document.getElementById('seed-copy-btn')
      btn.textContent = 'Copied!'
      setTimeout(() => { btn.textContent = 'Copy' }, 1500)
    })

    document.getElementById('seed-brainstorm-btn')?.addEventListener('click', () => {
      if (_lastScene && typeof App !== 'undefined') {
        App.toggleBrainstorm(`I've generated this seed scene — can you help me develop it?\n\n${_lastScene}`)
      }
    })

    document.getElementById('seed-open-btn')?.addEventListener('click', async () => {
      if (!_lastScene) return
      const btn = document.getElementById('seed-open-btn')
      btn.textContent = 'Creating…'; btn.disabled = true
      try {
        // find Act 1 folder
        const tree = await window.quill.getTree()
        let act1Path = null
        const findAct1 = node => {
          for (const child of (node.children || [])) {
            if (child.path && child.path.startsWith(novelPath) &&
                (child.folder_type === 'act' || (child.name || '').toLowerCase().includes('act'))) {
              act1Path = child.path; return
            }
            findAct1(child)
          }
        }
        findAct1(tree)
        const folder = act1Path || novelPath
        const result = await window.quill.newFile({ folder, title: 'Seed Scene' })
        if (result?.path) {
          // save the scene text into the new file
          await window.quill.saveFile({ rel: result.path, meta: { title: 'Seed Scene' }, body: _lastScene })
          if (typeof App !== 'undefined') await App.openFile(result.path)
          if (typeof Tree !== 'undefined') Tree.refresh()
        }
      } catch (err) {
        btn.textContent = 'Error'; setTimeout(() => { btn.textContent = 'Open as new scene →'; btn.disabled = false }, 2000)
        return
      }
      btn.textContent = 'Open as new scene →'; btn.disabled = false
    })
  }

  // ── Called by App.goBack() ────────────────────────────────
  function goBack() {
    if (_inCharSheet) {
      if (typeof _exitCharSheet === 'function') { _exitCharSheet(); return true }
    }
    return false
  }

  function isInSubView() { return _inCharSheet }

  return { open, openCharSheet, openCharacter, goBack, isInSubView, flushPending, activateNovelTab, acceptCharacter, openScenePlan, buildUnsortedScene,
           selectTimelineEvent, selectTimelineScene }
})()
