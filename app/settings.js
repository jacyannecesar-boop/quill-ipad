/* settings.js — app preferences: storage, live application, and the Settings modal */

const Settings = (() => {
  const KEY = 'quill_settings'

  // Palettes sit on top of a light or dark base so the existing [data-theme=dark] rules still apply.
  const PALETTES = {
    light:    { base: 'light', label: 'Light' },
    paper:    { base: 'light', label: 'Paper' },
    sepia:    { base: 'light', label: 'Sepia' },
    dark:     { base: 'dark',  label: 'Dark' },
    midnight: { base: 'dark',  label: 'Midnight' },
    system:   { base: null,    label: 'Match system' },
  }

  // Interface size is a page zoom; the editor page divides it back out (--ui-scale in style.css)
  // so the manuscript keeps its own size.
  const UI_SCALE = { small: 0.9, default: 1, large: 1.12, larger: 1.25 }

  // Interface and heading font choices. The manuscript font is separate (toolbar, --editor).
  const UI_FONTS = {
    poppins:     "'Poppins','LibSans',system-ui,sans-serif",
    system:      "-apple-system,BlinkMacSystemFont,'Helvetica Neue',sans-serif",
    libsans:     "'LibSans','Helvetica Neue',Arial,sans-serif",
    lora:        "'Lora',Georgia,serif",
    baskerville: "'Baskerville','Times New Roman',serif",
  }

  const DEFAULTS = {
    uiFont: 'poppins', headingFont: 'lora',
    palette: 'light', systemLight: 'light', systemDark: 'dark', accent: '', uiSize: 'default',
    zoom: 1, pageWidth: 820, margin: 60, lineHeight: 1.85,
    spellcheck: true, languageTool: false, dialect: 'american',
  }

  // Bounds for numeric settings; out-of-range or garbage values fall back to the default.
  const RANGES = {
    zoom: [0.5, 2], pageWidth: [560, 1100], margin: [20, 140], lineHeight: [1.4, 2.2],
  }

  // Preferences that predate this module keep their own keys, because editor.js,
  // chapter.js and the grammar checker read them directly.
  const LEGACY = {
    font: 'quill_font', fontSize: 'quill_font_size', indent: 'quill_indent_mode',
    typewriter: 'quill_typewriter', grammarInline: 'quill_grammar_inline',
  }

  let _s = { ...DEFAULTS }
  const _darkQuery = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null

  function _storageGet(key) { try { return localStorage.getItem(key) } catch { return null } }
  function _storageSet(key, v) { try { localStorage.setItem(key, v) } catch {} }

  function _sanitize(raw) {
    const s = { ...DEFAULTS }
    if (!raw || typeof raw !== 'object') return s
    if (PALETTES[raw.palette]) s.palette = raw.palette
    if (PALETTES[raw.systemLight]?.base === 'light') s.systemLight = raw.systemLight
    if (PALETTES[raw.systemDark]?.base === 'dark') s.systemDark = raw.systemDark
    if (typeof raw.accent === 'string' && /^#[0-9a-f]{6}$/i.test(raw.accent)) s.accent = raw.accent
    if (raw.uiSize in UI_SCALE) s.uiSize = raw.uiSize
    if (raw.uiFont in UI_FONTS) s.uiFont = raw.uiFont
    if (raw.headingFont in UI_FONTS) s.headingFont = raw.headingFont
    if (typeof raw.spellcheck === 'boolean') s.spellcheck = raw.spellcheck
    if (typeof raw.languageTool === 'boolean') s.languageTool = raw.languageTool
    if (['american', 'british', 'canadian', 'australian', 'indian'].includes(raw.dialect)) s.dialect = raw.dialect
    for (const [k, [lo, hi]] of Object.entries(RANGES)) {
      const n = Number(raw[k])
      if (Number.isFinite(n) && n >= lo && n <= hi) s[k] = n
    }
    return s
  }

  function _load() {
    const stored = _storageGet(KEY)
    if (stored) {
      try { _s = _sanitize(JSON.parse(stored)); return } catch {}
    }
    // First run: carry over the old light/dark toggle.
    _s = { ...DEFAULTS, palette: _storageGet('quill_theme') === 'dark' ? 'dark' : 'light' }
    _save()
  }

  function _save() { _storageSet(KEY, JSON.stringify(_s)) }

  // The palette actually showing: "Match system" resolves to the chosen light or dark theme.
  function _effectivePalette() {
    if (_s.palette !== 'system') return _s.palette
    return _darkQuery?.matches ? _s.systemDark : _s.systemLight
  }

  function _baseTheme() { return PALETTES[_effectivePalette()].base }

  function apply() {
    const root = document.documentElement
    const effective = _effectivePalette()
    const base = PALETTES[effective].base
    root.setAttribute('data-theme', base)
    if (effective !== base) root.setAttribute('data-palette', effective)
    else root.removeAttribute('data-palette')

    const scale = UI_SCALE[_s.uiSize]
    window.quill?.setUiZoom?.(scale)
    root.style.setProperty('--ui-scale', String(scale))

    root.style.setProperty('--ui', UI_FONTS[_s.uiFont])
    root.style.setProperty('--heading', UI_FONTS[_s.headingFont])
    root.style.setProperty('--editor-zoom', String(_s.zoom))
    root.style.setProperty('--page-width', _s.pageWidth + 'px')
    root.style.setProperty('--page-margin', _s.margin + 'px')
    root.style.setProperty('--editor-lh', String(_s.lineHeight))
    if (_s.accent) {
      root.style.setProperty('--accent', _s.accent)
      root.style.setProperty('--adim', `color-mix(in srgb, ${_s.accent} 18%, var(--surface))`)
    } else {
      root.style.removeProperty('--accent')
      root.style.removeProperty('--adim')
    }
    // Keeps the old key meaningful for anything that still reads it.
    _storageSet('quill_theme', base)

    const spell = _s.spellcheck ? 'true' : 'false'
    document.querySelectorAll('#entry-body .ProseMirror, #entry-title, #chapter-body .ProseMirror')
      .forEach(el => el.setAttribute('spellcheck', spell))
  }

  function get(key) {
    if (key in LEGACY) {
      const v = _storageGet(LEGACY[key])
      if (key === 'fontSize') return parseInt(v || '16', 10)
      if (key === 'font') return v || 'poppins'
      return v === 'on'
    }
    return _s[key]
  }

  function set(key, value) {
    if (key in LEGACY) {
      const v = typeof value === 'boolean' ? (value ? 'on' : 'off') : String(value)
      _storageSet(LEGACY[key], v)
    } else {
      _s = _sanitize({ ..._s, [key]: value })
      _save()
      apply()
    }
    _sync()
    window.dispatchEvent(new CustomEvent('quill-settings', { detail: { key } }))
  }

  function zoomBy(delta) {
    const next = Math.round((_s.zoom + delta) * 10) / 10
    set('zoom', Math.min(RANGES.zoom[1], Math.max(RANGES.zoom[0], next)))
  }
  function resetZoom() { set('zoom', 1) }

  // The sidebar moon button: flip between the light and dark families.
  function toggleDark() { set('palette', _baseTheme() === 'dark' ? 'light' : 'dark') }

  function resetAll() {
    if (!confirm('Reset every setting to its default? Your writing is not affected.')) return
    _s = { ...DEFAULTS }
    _save()
    apply()
    set('font', 'poppins')
    set('fontSize', 16)
    set('indent', false)
    set('typewriter', false)
    set('grammarInline', false)
    _applyLegacyToEditor(['fontSize', 'indent', 'typewriter', 'grammarInline'])
  }

  // ── Modal ─────────────────────────────────────────────────
  const $ = id => document.getElementById(id)

  function _fmt(key, v) {
    if (key === 'zoom') return Math.round(v * 100) + '%'
    if (key === 'lineHeight') return Number(v).toFixed(2)
    return v + 'px'
  }

  // Reflect current values into the modal's controls.
  function _sync() {
    const modal = $('settings-modal')
    if (!modal) return
    modal.querySelectorAll('[data-palette-choice]').forEach(b =>
      b.classList.toggle('active', b.dataset.paletteChoice === _s.palette))
    $('settings-system-row').hidden = _s.palette !== 'system'
    $('settings-system-now').textContent = _s.palette === 'system'
      ? `Now showing ${PALETTES[_effectivePalette()].label} because macOS is in ${_darkQuery?.matches ? 'dark' : 'light'} mode.`
      : ''
    const accent = $('settings-accent')
    accent.value = _s.accent || _cssVar('--accent') || '#2d6a4f'
    $('settings-accent-reset').disabled = !_s.accent
    modal.querySelectorAll('[data-seg]').forEach(group => {
      const key = group.dataset.seg
      const cur = key === 'indent' ? (get('indent') ? 'on' : 'off') : _s[key]
      group.querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.value === cur))
    })
    modal.querySelectorAll('input[type=range][data-key]').forEach(inp => {
      const key = inp.dataset.key
      inp.value = _s[key]
      const out = modal.querySelector(`[data-out="${key}"]`)
      if (out) out.textContent = _fmt(key, _s[key])
    })
    $('settings-font').value = get('font')
    $('settings-font-size').value = get('fontSize')
    $('settings-typewriter').checked = get('typewriter')
    $('settings-grammar').checked = get('grammarInline')
    $('settings-spellcheck').checked = _s.spellcheck
    $('settings-dialect').value = _s.dialect
    $('settings-ui-font').value = _s.uiFont
    $('settings-heading-font').value = _s.headingFont
  }

  function _cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  }

  // Push a changed legacy preference into the open scene, the way its old control did.
  function _applyLegacyToEditor(keys) {
    if (typeof Editor === 'undefined') return
    for (const key of keys) {
      if (key === 'fontSize') Editor.applyFontSize?.(get('fontSize'))
      if (key === 'indent') Editor.toggleIndentMode?.(get('indent'))
      if (key === 'typewriter') Editor.toggleTypewriter?.(get('typewriter'))
      if (key === 'grammarInline') {
        const cb = $('grammar-inline-cb')
        if (cb) cb.checked = get('grammarInline')
        window.QuillEditor?.setGrammarInline?.(get('grammarInline'))?.catch?.(error => {
          console.error('Could not update inline grammar checking:', error)
        })
        window.QuillChapter?.setGrammarInline?.(get('grammarInline'))
      }
    }
  }

  function _showTab(name) {
    // A tab saved by an older version (or a typo) would hide every pane; fall back to the first.
    if (!document.querySelector(`#settings-modal .settings-pane[data-pane="${name}"]`)) name = 'appearance'
    document.querySelectorAll('#settings-modal .settings-tab').forEach(t =>
      t.classList.toggle('active', t.dataset.tab === name))
    document.querySelectorAll('#settings-modal .settings-pane').forEach(p =>
      p.hidden = p.dataset.pane !== name)
    _storageSet('quill_settings_tab', name)
  }

  // You + AI tabs: values live outside quill_settings (name in localStorage, goal in stats,
  // key in main), so they're read fresh each time the window opens.
  async function _syncYouAndAi() {
    if ($('settings-user-name')) $('settings-user-name').value = localStorage.getItem('quill_user_name') || ''
    const stats = await window.quill?.getStats?.().catch(() => null)
    if ($('settings-daily-goal')) $('settings-daily-goal').value = stats?.dailyGoal ? String(stats.dailyGoal) : '0'
    _renderChatGPT()
    _renderModelPicker()
    if (typeof StyleLab !== 'undefined' && $('settings-stylelab')) StyleLab.renderSettingsPane($('settings-stylelab'))
    if (typeof QuillAI !== 'undefined') {
      QuillAI.showKeyField($('settings-ai-key'))
      const has = await window.quill.hasOpenRouterKey().catch(() => false)
      if ($('settings-ai-status')) $('settings-ai-status').textContent = has ? 'A key is saved. Paste a new one to replace it.' : 'No key yet. Get one at openrouter.ai/keys.'
    }
  }

  // The one model every AI tool uses (`quill_or_model`), plus the writer's custom model ids.
  function _renderModelPicker() {
    const esc = window.escapeHtml
    const sel = $('settings-ai-model')
    if (!sel || typeof QuillModels === 'undefined') return
    sel.innerHTML = QuillModels.optionsHTML({ selected: QuillModels.current(), customLabel: 'Custom model ID…' })
    $('settings-ai-custom-row').hidden = true
    const saved = QuillModels.saved()
    $('settings-ai-saved-row').hidden = !saved.length
    const box = $('settings-ai-saved')
    const pick = saved.includes(QuillModels.current()) ? QuillModels.current() : saved[0]
    box.innerHTML = `<select id="settings-ai-saved-select" aria-label="Your custom models">
        ${saved.map(m => `<option value="${esc(m)}"${m === pick ? ' selected' : ''}>${esc(m)}</option>`).join('')}
      </select> <button type="button" class="btn sm" id="settings-ai-saved-remove">Remove</button>`
    $('settings-ai-saved-remove').onclick = () => {
      const id = $('settings-ai-saved-select').value
      localStorage.setItem('quill_saved_models', JSON.stringify(QuillModels.saved().filter(m => m !== id)))
      if (QuillModels.current() === id) QuillModels.setCurrent(QuillModels.role('default'))
      _modelChanged()
    }
  }
  function _modelChanged() {
    _renderModelPicker()
    document.dispatchEvent(new CustomEvent('quill-models-changed'))
  }

  // ChatGPT connection: Continue → browser sign-in → Connected (email, model count, actions).
  async function _renderChatGPT(note) {
    const box = $('settings-cg-actions'), status = $('settings-cg-status'), title = $('settings-cg-title')
    if (!box) return
    // A window reloaded after an update can carry this pane while the app behind it is older.
    if (!window.quill?.chatgptStatus || !window.quill?.chatgptSignIn) {
      title.textContent = 'Restart Quill to connect ChatGPT'
      status.textContent = 'Quill was updated while it was open. Quit it (⌘Q) and open it again, then come back here.'
      box.innerHTML = ''
      return
    }
    const st = await window.quill.chatgptStatus().catch(() => ({}))
    const esc = window.escapeHtml
    if (st.pending) {
      title.textContent = 'Waiting for ChatGPT…'
      status.textContent = 'Finish signing in in your browser, then come back here.'
      box.innerHTML = '<button class="btn sm" id="settings-cg-cancel">Cancel</button>'
      $('settings-cg-cancel').onclick = async () => { await window.quill.chatgptCancelSignIn(); _renderChatGPT() }
      return
    }
    if (st.connected) {
      const r = typeof QuillModels !== 'undefined' ? await QuillModels.refresh().catch(() => null) : null
      const n = r?.models?.length || 0
      title.textContent = st.sharing ? 'Using ChatGPT plan' : 'ChatGPT connected (no plan usage)'
      status.innerHTML = st.sharing
        ? `Connected as ${esc(st.email || 'your account')} · ${r?.error ? esc(r.error) : `${n} model${n === 1 ? '' : 's'} available`}${note ? ` · ${esc(note)}` : ''}`
        : 'Sign-in worked, but plan usage was not granted. Reconnect and allow Quill to use your plan.'
      box.innerHTML = `<button class="btn sm" id="settings-cg-usage">Manage usage</button>
        <button class="btn sm" id="settings-cg-reconnect">Reconnect</button>
        <button class="btn sm danger" id="settings-cg-disconnect">Disconnect</button>`
      $('settings-cg-usage').onclick = () => window.quill.chatgptManageUsage()
      _renderChatGPTUsage()
      $('settings-cg-reconnect').onclick = _connectChatGPT
      $('settings-cg-disconnect').onclick = async () => {
        if (!confirm('Disconnect ChatGPT? Quill stops using your plan until you connect again.')) return
        await window.quill.chatgptDisconnect()
        await QuillModels?.refresh?.()
        _renderChatGPT()
      }
      return
    }
    if ($('settings-cg-usage-box')) $('settings-cg-usage-box').hidden = true
    title.textContent = 'Use your ChatGPT plan'
    status.textContent = note || "Plus and Pro plans can power Quill's AI tools without an API key. Usage counts toward your plan. Quill only sends what you attach; ChatGPT never shares your chats or memory with Quill."
    box.innerHTML = '<button class="btn sm primary" id="settings-cg-connect">Continue with ChatGPT</button>'
    $('settings-cg-connect').onclick = _connectChatGPT
  }

  // What Quill itself has sent through the plan. OpenAI doesn't tell apps what's left, so the
  // remaining allowance lives behind Manage usage.
  async function _renderChatGPTUsage() {
    const box = $('settings-cg-usage-box')
    if (!box || !window.quill.chatgptUsage) return
    const u = await window.quill.chatgptUsage().catch(() => null)
    if (!u) { box.hidden = true; return }
    const k = n => n >= 1000 ? `${(n / 1000).toFixed(n < 10000 ? 1 : 0).replace(/\.0$/, '')}k` : String(n)
    const line = (label, p) => `<div class="settings-cg-usage-row"><span>${label}</span><span>${p.requests} request${p.requests === 1 ? '' : 's'} · ${p.estimated ? '~' : ''}${k(p.input)} in · ${p.estimated ? '~' : ''}${k(p.output)} out</span></div>`
    const limit = u.lastLimitAt && Date.now() - u.lastLimitAt < 7 * 86400000
      ? `<div class="settings-hint settings-cg-limit">Hit a usage limit ${new Date(u.lastLimitAt).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}.</div>` : ''
    box.innerHTML = `<div class="settings-label">Quill's use of your plan</div>
      ${line('Last 5 hours', u.fiveHours)}${line('Today', u.today)}${line('Last 7 days', u.week)}${limit}
      <div class="settings-hint">Tokens Quill sent and received through ChatGPT. Your remaining allowance and reset times are only shown in ChatGPT: use Manage usage. On Plus, the 5-hour limit is shared with every app using your plan.</div>`
    box.hidden = false
  }

  async function _connectChatGPT() {
    $('settings-cg-title').textContent = 'Opening your browser…'
    $('settings-cg-status').textContent = 'Sign in to ChatGPT there and allow Quill to use your plan.'
    $('settings-cg-actions').innerHTML = ''
    const done = window.quill.chatgptSignIn()
    setTimeout(() => _renderChatGPT(), 150)   // shows "Waiting for ChatGPT…" while the browser is open
    const res = await done.catch(err => ({ ok: false, error: err.message }))
    if (typeof QuillModels !== 'undefined') await QuillModels.refresh().catch(() => {})
    _renderChatGPT(res.ok ? '' : res.error)
  }

  function _bindYouAndAi() {
    $('settings-user-name')?.addEventListener('change', e => {
      const v = e.target.value.trim()
      try { v ? localStorage.setItem('quill_user_name', v) : localStorage.removeItem('quill_user_name') } catch {}
    })
    $('settings-daily-goal')?.addEventListener('change', e => {
      window.quill?.setDailyGoal?.({ goal: Number(e.target.value) || 0 }).catch(() => {})
    })
    $('settings-ai-model')?.addEventListener('change', e => {
      if (e.target.value === '__custom__') {
        $('settings-ai-custom-row').hidden = false
        $('settings-ai-custom').focus()
        return
      }
      QuillModels.setCurrent(e.target.value)
      _modelChanged()
    })
    $('settings-ai-custom-save')?.addEventListener('click', () => {
      const id = $('settings-ai-custom').value.trim()
      if (!id) return
      const saved = QuillModels.saved()
      if (!saved.includes(id)) localStorage.setItem('quill_saved_models', JSON.stringify([...saved, id]))
      QuillModels.setCurrent(id)
      $('settings-ai-custom').value = ''
      _modelChanged()
    })
    document.addEventListener('quill-models-changed', () => {
      if ($('settings-modal')?.classList.contains('show') && document.activeElement !== $('settings-ai-model')) _renderModelPicker()
    })
    $('settings-ai-save')?.addEventListener('click', async () => {
      try { await QuillAI.saveKeyField($('settings-ai-key')); await QuillModels?.refresh?.(); _syncYouAndAi() } catch (err) { alert(err.message) }
    })
  }

  function open(tab) {
    _sync()
    _syncYouAndAi()
    if (tab) _showTab(tab)
    $('settings-modal').classList.add('show')
    window.quill?.languageToolStatus?.().then(_renderLanguageTool).catch(() => {})
    _refreshCloudBackup()
  }

  // ── LanguageTool install / on-off row ─────────────────────
  let _ltStatus = null
  const MB = n => Math.round(n / 1048576)

  function _renderLanguageTool(status) {
    if (status) _ltStatus = status
    const st = _ltStatus
    if (!st || !$('settings-lt-install')) return
    const hint = $('settings-lt-hint')
    const bar = $('settings-lt-progress')
    const installing = st.installing
    $('settings-lt-install').hidden = st.installed || installing
    $('settings-lt-install').textContent = `Install (${MB(st.downloadBytes)} MB download)`
    $('settings-lt-enabled').hidden = !st.installed || installing
    $('settings-lt-enabled').checked = _s.languageTool
    $('settings-lt-remove').hidden = !st.installed || installing
    bar.hidden = !installing
    hint.classList.toggle('settings-lt-error', Boolean(st.error) && !installing)
    if (installing && st.progress) {
      const { phase, received, total } = st.progress
      bar.firstElementChild.style.width = Math.round((received / total) * 100) + '%'
      hint.textContent = `${phase}… ${MB(received)} of ${MB(total)} MB`
    } else if (installing) {
      hint.textContent = 'Starting download…'
    } else if (st.error) {
      hint.textContent = `Install failed: ${st.error}`
    } else if (st.installed) {
      hint.textContent = _s.languageTool
        ? 'On. LanguageTool starts when grammar checking runs and stops after 10 quiet minutes. Uses up to about 500 MB of memory while running.'
        : 'Installed but off. Turn it on to add LanguageTool\'s checks to the underlines.'
    } else {
      hint.textContent = 'Runs LanguageTool on your Mac next to the built-in checker. Catches more mistakes (me/I, less/fewer, its/it\'s, lay/lie…). Nothing leaves your computer. Needs about 500 MB of disk.'
    }
  }

  // Re-run inline checking so turning LanguageTool on or off shows up right away.
  function _recheckGrammar() {
    if (get('grammarInline')) _applyLegacyToEditor(['grammarInline'])
  }

  function _bindLanguageTool() {
    window.quill?.onLanguageToolStatus?.(_renderLanguageTool)
    $('settings-lt-install').onclick = async () => {
      _renderLanguageTool({ ..._ltStatus, installing: true, error: '' })
      const result = await window.quill.languageToolInstall()
      if (result?.ok) { set('languageTool', true); warmLanguageTool(); _recheckGrammar() }
      _renderLanguageTool(await window.quill.languageToolStatus())
    }
    $('settings-lt-enabled').onchange = e => {
      set('languageTool', e.target.checked)
      warmLanguageTool()
      _renderLanguageTool()
      _recheckGrammar()
    }
    $('settings-lt-remove').onclick = async () => {
      set('languageTool', false)
      _renderLanguageTool(await window.quill.languageToolUninstall())
      _recheckGrammar()
    }
  }
  function close() {
    $('settings-modal')?.classList.remove('show')
    // Name and daily goal show on the dashboard; redraw it if it's what's behind the window.
    if (document.getElementById('toolbar')?.dataset.view === 'empty') App.loadDashboard?.()
  }
  function isOpen() { return !!$('settings-modal')?.classList.contains('show') }

  function _bindModal() {
    const modal = $('settings-modal')
    if (!modal) return
    modal.addEventListener('mousedown', e => { if (e.target === modal) close() })
    $('settings-done-btn').onclick = close
    $('settings-reset-btn').onclick = resetAll
    modal.querySelectorAll('.settings-tab').forEach(t => t.onclick = () => _showTab(t.dataset.tab))
    _showTab(_storageGet('quill_settings_tab') || 'appearance')

    modal.querySelectorAll('[data-palette-choice]').forEach(b =>
      b.onclick = () => set('palette', b.dataset.paletteChoice))
    $('settings-accent').oninput = e => set('accent', e.target.value)
    $('settings-accent-reset').onclick = () => set('accent', '')

    modal.querySelectorAll('[data-seg]').forEach(group => {
      group.querySelectorAll('button').forEach(b => b.onclick = () => {
        const key = group.dataset.seg
        if (key === 'indent') {
          set('indent', b.dataset.value === 'on')
          _applyLegacyToEditor(['indent'])
        } else set(key, b.dataset.value)
      })
    })
    modal.querySelectorAll('input[type=range][data-key]').forEach(inp =>
      inp.oninput = () => set(inp.dataset.key, Number(inp.value)))

    $('settings-font').onchange = e => set('font', e.target.value)
    $('settings-font-size').onchange = e => {
      const n = Math.min(28, Math.max(12, parseInt(e.target.value, 10) || 16))
      set('fontSize', n)
      _applyLegacyToEditor(['fontSize'])
    }
    for (const [id, key] of [['settings-typewriter', 'typewriter'], ['settings-grammar', 'grammarInline']]) {
      $(id).onchange = e => { set(key, e.target.checked); _applyLegacyToEditor([key]) }
    }
    $('settings-spellcheck').onchange = e => set('spellcheck', e.target.checked)
    $('settings-ui-font').onchange = e => set('uiFont', e.target.value)
    $('settings-heading-font').onchange = e => set('headingFont', e.target.value)
    $('settings-dialect').onchange = e => {
      set('dialect', e.target.value)
      _recheckGrammar()
    }
    _bindLanguageTool()
  }

  // Load the grammar checkers in the background so the first check doesn't wait on them.
  // Harper waits a moment so it doesn't compete with the scene that is opening.
  let _warmTimer = null
  function warmGrammar() {
    if (_s.languageTool) window.quill?.languageToolWarm?.().catch(() => {})
    clearTimeout(_warmTimer)
    _warmTimer = setTimeout(() => window.QuillEditor?.warmGrammar?.(), 1500)
  }
  function warmLanguageTool() {
    if (_s.languageTool) window.quill?.languageToolWarm?.().catch(() => {})
  }

  // ── Cloud backups ─────────────────────────────────────────
  let _cloudBackup = null
  let _cloudBusy = false

  function _backupSize(bytes) {
    const amount = Number(bytes) || 0
    if (amount < 1024) return `${amount} bytes`
    if (amount < 1048576) return `${Math.round(amount / 1024)} KB`
    return `${(amount / 1048576).toFixed(amount < 10485760 ? 1 : 0)} MB`
  }

  function _renderCloudBackup(status) {
    if (status) _cloudBackup = status
    const current = _cloudBackup
    if (!current || !$('settings-cloud-folder')) return
    const configured = Boolean(current.configured)
    const available = Boolean(current.folderAvailable)
    const folder = $('settings-cloud-folder')
    folder.textContent = configured ? current.folder : 'No folder selected.'
    folder.title = current.folder || ''
    $('settings-cloud-auto').checked = Boolean(current.automatic)
    $('settings-cloud-auto').disabled = !configured
    $('settings-cloud-retention').value = String(current.retention || 10)
    $('settings-cloud-retention').disabled = !configured
    $('settings-cloud-open').disabled = !available || _cloudBusy
    $('settings-cloud-now').disabled = !available || _cloudBusy
    $('settings-cloud-choose').disabled = _cloudBusy
    $('settings-cloud-now').textContent = _cloudBusy ? 'Backing Up…' : 'Back Up Now'
    const seeChanges = document.getElementById('web-see-changes')   // iPad only (build-web)
    if (seeChanges) seeChanges.hidden = _cloudBusy || !current.changesSinceExport
    const message = $('settings-cloud-status')
    message.classList.toggle('error', Boolean(current.lastError))
    if (_cloudBusy) message.textContent = 'Saving current work and creating a verified library archive…'
    else if (current.lastError) message.textContent = `Last backup failed: ${current.lastError}`
    else if (!configured) message.textContent = 'Choose an iCloud Drive folder to begin.'
    else if (!available) message.textContent = 'The selected backup folder is unavailable. Choose it again.'
    else if (current.lastBackupAt) {
      const when = new Date(current.lastBackupAt).toLocaleString([], { dateStyle:'medium', timeStyle:'short' })
      const location = current.lastBackupCloudOnly ? ' · Stored in iCloud' : ''
      const changes = current.web ? ` · ${current.changesSinceExport || 'no'} change${current.changesSinceExport === 1 ? '' : 's'} since` : ''
      message.textContent = `Last backup: ${when} · ${current.lastBackupFile} · ${_backupSize(current.lastBackupBytes)}${location}${changes}`
    } else message.textContent = 'Ready. No cloud backup has been created yet.'
  }

  async function _refreshCloudBackup() {
    const status = await window.quill?.getCloudBackupSettings?.().catch(() => null)
    if (status) _renderCloudBackup(status)
    return status
  }

  async function _chooseCloudBackupFolder() {
    const result = await window.quill.chooseCloudBackupFolder().catch(error => ({ ok:false, error:error.message }))
    if (result?.canceled) return
    _renderCloudBackup(result?.ok ? result : { ...result, lastError:result?.error || 'Could not use that folder.' })
    window.dispatchEvent(new CustomEvent('quill-cloud-backup-status', { detail:result }))
  }

  async function _backupCloudNow() {
    if (_cloudBusy) return
    _cloudBusy = true
    _renderCloudBackup()
    try {
      await App.flushPendingWork()
      const result = await window.quill.backupCloudLibrary()
      _renderCloudBackup(result)
      window.dispatchEvent(new CustomEvent('quill-cloud-backup-status', { detail:result }))
    } catch (error) {
      _renderCloudBackup({ ...(_cloudBackup || {}), lastError:error.message || 'Backup failed.' })
    } finally {
      _cloudBusy = false
      _renderCloudBackup()
    }
  }

  function _bindCloudBackup() {
    $('settings-cloud-choose').onclick = _chooseCloudBackupFolder
    $('settings-cloud-now').onclick = _backupCloudNow
    $('settings-cloud-open').onclick = async () => {
      const result = await window.quill.openCloudBackupFolder()
      if (!result?.ok) _renderCloudBackup({ ...(_cloudBackup || {}), lastError:result?.error || 'Could not open the folder.' })
    }
    $('settings-cloud-auto').onchange = async event => {
      const result = await window.quill.updateCloudBackupSettings({ automatic:event.target.checked })
      _renderCloudBackup(result)
      window.dispatchEvent(new CustomEvent('quill-cloud-backup-status', { detail:result }))
    }
    $('settings-cloud-retention').onchange = async event => {
      _renderCloudBackup(await window.quill.updateCloudBackupSettings({ retention:Number(event.target.value) }))
    }
  }

  function _scheduleCloudBackup() {
    setTimeout(async () => {
      try {
        await App.flushPendingWork()
        const result = await window.quill?.runCloudBackupIfDue?.()
        if (result) window.dispatchEvent(new CustomEvent('quill-cloud-backup-status', { detail:result }))
        if (result && !$('settings-modal')?.classList.contains('show')) _cloudBackup = result
        else if (result) _renderCloudBackup(result)
      } catch {}
    }, 8000)
  }

  function init() {
    apply()
    warmLanguageTool()
    _darkQuery?.addEventListener?.('change', () => { if (_s.palette === 'system') { apply(); _sync() } })
    _bindModal()
    _bindYouAndAi()
    _bindCloudBackup()
    $('settings-open-btn')?.addEventListener('click', open)
    _scheduleCloudBackup()
  }

  // Apply before the rest of the app renders so there's no flash of the default theme.
  _load()
  apply()

  return { init, apply, get, set, warmGrammar, zoomBy, resetZoom, toggleDark, resetAll, open, close, isOpen, PALETTES }
})()

window.QuillSettings = Settings
