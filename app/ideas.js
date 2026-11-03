/* ideas.js — Idea Workshop */

const Ideas = (() => {

  let _ideas        = []   // all ideas
  let _currentIdea  = null // active idea object
  let _convoHistory = []   // chat messages for current idea session
  let _settingsOpen = false
  let _initialized  = false
  let _chatMode     = 'develop' // 'develop' | 'explore'
  let _ideaCtx      = null      // shared context drawer handle

  // ── init ────────────────────────────────────────────────────
  async function init() {
    await loadIdeas()
    if (_initialized) return
    _initialized = true


    document.getElementById('idea-mode-develop').addEventListener('click', () => setMode('develop'))
    document.getElementById('idea-mode-explore').addEventListener('click', () => setMode('explore'))

    document.getElementById('idea-new-convo-btn').addEventListener('click', () => {
      const hasChat = _currentIdea && (_currentIdea.conversation || []).length > 0
      if (hasChat) {
        document.getElementById('idea-new-convo-confirm').style.display = 'flex'
      } else {
        clearIdeaConvo()
      }
    })
    document.getElementById('idea-new-convo-yes').addEventListener('click', () => {
      document.getElementById('idea-new-convo-confirm').style.display = 'none'
      clearIdeaConvo()
    })
    document.getElementById('idea-new-convo-no').addEventListener('click', () => {
      document.getElementById('idea-new-convo-confirm').style.display = 'none'
    })
    document.getElementById('idea-send').addEventListener('click', () => sendIdeaMsg())
    document.getElementById('idea-input').addEventListener('keydown', e => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) sendIdeaMsg()
    })
    document.getElementById('idea-gear-btn').addEventListener('click', toggleIdeaSettings)
    document.getElementById('idea-save-instr').addEventListener('click', saveIdeaInstructions)
    document.getElementById('idea-reset-instr').addEventListener('click', resetIdeaInstructions)
    document.getElementById('idea-ai-toggle').addEventListener('click', () => setDrawerOpen(!isDrawerOpen()))
    document.getElementById('idea-ai-close').addEventListener('click', () => setDrawerOpen(false))
    document.getElementById('idea-status').addEventListener('change', e => {
      if (_currentIdea) setIdeaStatus(_currentIdea.id, e.target.value)
    })
    document.getElementById('idea-add-fragment-btn').addEventListener('click', () => showFragmentInput())
    document.getElementById('idea-fragment-save').addEventListener('click', saveFragment)
    document.getElementById('idea-fragment-cancel').addEventListener('click', hideFragmentInput)
    document.getElementById('idea-hatch-btn').addEventListener('click', showHatchModal)
    document.getElementById('idea-hatch-next').addEventListener('click', startHatchAI)
    document.getElementById('idea-hatch-confirm').addEventListener('click', doHatch)
    document.getElementById('idea-hatch-cancel').addEventListener('click', hideHatchModal)
    document.getElementById('idea-hatch-backdrop')?.addEventListener('click', hideHatchModal)
    document.getElementById('idea-delete-btn').addEventListener('click', deleteCurrentIdea)

    // section toggle pills
    document.getElementById('hatch-toggles')?.addEventListener('click', e => {
      const pill = e.target.closest('.hatch-toggle-pill')
      if (pill) pill.classList.toggle('active')
    })

    initPictureInput()

    // scratchpad autosave
    document.getElementById('idea-scratchpad').addEventListener('input', debounce(saveCurrent, 800))

    updateModelIndicator()
    document.addEventListener('quill-models-changed', updateModelIndicator)
    setDrawerOpen(isDrawerOpen())

    // Ideas aren't inside a novel: the drawer picks which novel's material to attach.
    _ideaCtx = QuillContext.attach(document.getElementById('idea-ctx-btn'), {
      scope: 'ideas', voiceDefault: false,
      buildPreview: async () => [
        ...(await ideaSystemMessages()),
        ...(_currentIdea?.conversation || []).slice(-13),
        { role: 'user', content: document.getElementById('idea-input')?.value.trim() || '(your next message)' },
      ],
    })
  }

  async function ideaSystemMessages() {
    const msgs = [{ role: 'system', content: buildIdeaSystemPrompt() }]
    if (_ideaCtx) {
      const b = await _ideaCtx.blocks()
      if (b.story) msgs.push({ role: 'system', content: b.story })
      if (b.voice) msgs.push({ role: 'system', content: b.voice })
    }
    return msgs
  }

  // The AI chat lives in a drawer; whether it's open is remembered across launches.
  function isDrawerOpen() {
    try { return localStorage.getItem('quill_idea_ai_open') === '1' } catch { return false }
  }
  function setDrawerOpen(open) {
    try { localStorage.setItem('quill_idea_ai_open', open ? '1' : '0') } catch {}
    document.getElementById('view-ideas')?.classList.toggle('ai-open', open)
    const btn = document.getElementById('idea-ai-toggle')
    if (btn) { btn.setAttribute('aria-pressed', String(open)); btn.classList.toggle('active', open) }
    if (open) setTimeout(() => document.getElementById('idea-input')?.focus(), 40)
  }

  function showStatus(status) {
    const sel = document.getElementById('idea-status')
    if (sel) sel.value = status || 'hot'
    const dot = document.getElementById('idea-status-dot')
    if (dot) dot.dataset.status = status || 'hot'
  }

  function refreshSidebar() {
    if (typeof Tree !== 'undefined') Tree.refreshIdeaSidebar()
  }

  function setMode(mode) {
    _chatMode = mode
    document.getElementById('idea-mode-develop').classList.toggle('active', mode === 'develop')
    document.getElementById('idea-mode-explore').classList.toggle('active', mode === 'explore')
    const inp = document.getElementById('idea-input')
    if (inp) {
      inp.placeholder = mode === 'explore'
        ? 'Throw something at me — a feeling, an image, a "what if"… ⌘↵ to send'
        : 'Tell me about the idea… ⌘↵ to send'
    }
    // show welcome for current mode if no conversation
    if (!_currentIdea?.conversation?.length) renderIdeaWelcome()
  }

  // ── load & render idea list ──────────────────────────────────
  async function loadIdeas() {
    _ideas = await window.quill.getIdeas().catch(() => [])
    renderIdeaList()
  }

  function renderIdeaList() {
    refreshSidebar()
  }

  // ── open / create idea ───────────────────────────────────────
  async function openIdea(id) {
    const idea = _ideas.find(i => i.id === id)
    if (!idea) return
    _currentIdea  = idea
    _convoHistory = idea.conversation || []
    // mark active in sidebar
    document.querySelectorAll('.idea-sidebar-item').forEach(el => {
      el.classList.toggle('active', el.dataset.id === id)
    })
    populateIdeaView(idea)
  }

  function createNewIdea() {
    const id    = Math.random().toString(36).slice(2, 10)
    const idea  = {
      id,
      title:       'New idea',
      status:      'hot',
      scratchpad:  '',
      tags:        [],
      fragments:   [],
      conversation: [],
      created:     new Date().toISOString(),
    }
    _ideas.unshift(idea)
    _currentIdea  = idea
    _convoHistory = []
    window.quill.saveIdea(idea)
    renderIdeaList()
    refreshSidebar()
    populateIdeaView(idea)
    // focus title for immediate rename
    setTimeout(() => {
      const t = document.getElementById('idea-title-input')
      if (t) { t.select(); t.focus() }
    }, 60)
  }

  async function createFromInbox(note) {
    const text = String(note?.text || '').trim()
    if (!text) throw new Error('The inbox note is empty.')
    const firstLine = text.split(/\n/)[0].trim()
    const title = firstLine.length > 80 ? firstLine.slice(0, 79).trimEnd() + '…' : firstLine
    const detail = String(note?.note || '').trim()
    const scratchpad = [text, detail].filter(Boolean)
      .map(value => `<p>${escapeHtml(value).replace(/\n/g, '<br>')}</p>`).join('')
    const idea = {
      id: Math.random().toString(36).slice(2, 10),
      title: title || 'Untitled idea',
      status: 'hot',
      scratchpad,
      tags: [],
      fragments: [],
      conversation: [],
      created: new Date().toISOString(),
      source: { type: 'scratch-inbox', note_id: String(note.id || '') },
    }
    const result = await window.quill.saveIdea(idea)
    if (!result?.ok) throw new Error(result?.error || 'Could not create the idea.')
    _ideas = _ideas.filter(existing => existing.id !== idea.id)
    _ideas.unshift(idea)
    _currentIdea = idea
    _convoHistory = []
    renderIdeaList()
    refreshSidebar()
    App.showView('ideas')
    populateIdeaView(idea)
    return idea
  }

  function populateIdeaView(idea) {
    const emptyEl = document.getElementById('idea-empty-state')
    if (emptyEl) emptyEl.style.display = 'none'
    document.getElementById('view-ideas')?.classList.remove('no-idea')
    document.getElementById('idea-title-input').value = idea.title || ''
    showStatus(idea.status)
    const sp = document.getElementById('idea-scratchpad')
    if (sp) sp.innerHTML = sanitizeRichHtml(idea.scratchpad)
    renderTags(idea.tags || [])
    renderFragments(idea.fragments || [])
    renderIdeaChat(idea.conversation || [])
    hideFragmentInput()
    hideHatchModal()
    // wire title rename
    document.getElementById('idea-title-input').oninput = debounce(() => {
      if (!_currentIdea) return
      _currentIdea.title = document.getElementById('idea-title-input').value.trim() || 'Untitled idea'
      saveCurrent()
      renderIdeaList()
    }, 500)
    // show welcome prompt if no conversation yet
    if (!idea.conversation?.length) {
      renderIdeaWelcome()
    }
  }

  // ── scratchpad / tags ────────────────────────────────────────
  function saveCurrent() {
    if (!_currentIdea) return
    const sp = document.getElementById('idea-scratchpad')
    _currentIdea.scratchpad = sp ? sp.innerHTML : ''
    window.quill.saveIdea(_currentIdea)
  }

  function renderTags(tags) {
    const wrap = document.getElementById('idea-tags-wrap')
    wrap.innerHTML = ''
    tags.forEach((tag, i) => {
      const pill = document.createElement('span')
      pill.className = 'idea-tag-pill'
      pill.innerHTML = `${esc(tag)}<button class="idea-tag-remove" data-i="${i}" title="Remove tag" aria-label="Remove tag ${esc(tag)}">×</button>`
      pill.querySelector('.idea-tag-remove').addEventListener('click', () => removeTag(i))
      wrap.appendChild(pill)
    })
    const input = document.createElement('input')
    input.id          = 'idea-tag-input'
    input.className   = 'idea-tag-input'
    input.placeholder = tags.length ? '+ tag' : 'add tags…'
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ',') {
        e.preventDefault()
        addTag(e.target.value.trim().replace(/,+$/, ''))
        e.target.value = ''
      }
    })
    wrap.appendChild(input)
  }

  function addTag(tag) {
    if (!tag || !_currentIdea) return
    if (!_currentIdea.tags) _currentIdea.tags = []
    if (_currentIdea.tags.includes(tag)) return
    _currentIdea.tags.push(tag)
    renderTags(_currentIdea.tags)
    saveCurrent()
  }

  function removeTag(i) {
    if (!_currentIdea) return
    _currentIdea.tags.splice(i, 1)
    renderTags(_currentIdea.tags)
    saveCurrent()
  }

  // ── fragments ────────────────────────────────────────────────

  // Each fragment type gets its own paper on the mood board.
  const FRAG_FORM = {
    dialogue: 'quote', image: 'polaroid', vibe: 'swatch', 'tone ref': 'swatch', theme: 'swatch',
    character: 'index', location: 'postcard',
  }
  const PAPER = ['yellow', 'peach', 'coral', 'pink', 'lavender', 'blue', 'aqua', 'mint']
  const PAPER_DEFAULT = {
    vibe: 'lavender', 'tone ref': 'blue', theme: 'pink', scene: 'peach', conflict: 'coral',
    symbol: 'yellow', worldbuilding: 'aqua', note: 'yellow',
  }
  const formOf  = frag => FRAG_FORM[frag.type] || 'sticky'
  const paperOf = frag => PAPER.includes(frag.color) ? frag.color : (PAPER_DEFAULT[frag.type] || 'yellow')

  function renderFragments(fragments) {
    const grid = document.getElementById('idea-fragments-grid')
    grid.innerHTML = ''
    fragments.forEach((frag, i) => {
      const form = formOf(frag)
      const card = document.createElement('div')
      card.className = `idea-fragment-card frag-${form}` + (form === 'swatch' || form === 'sticky' ? ` scrap-${paperOf(frag)}` : '')
      card.dataset.idx = i
      card.dataset.type = frag.type || 'note'

      // drag handle
      const handle = document.createElement('div')
      handle.className = 'idea-frag-handle'
      handle.title = 'Drag to reorder'
      handle.innerHTML = '⠿'

      const label = document.createElement('div')
      label.className = 'idea-frag-label'
      label.textContent = frag.type || 'note'

      // Rich contenteditable body
      const body = document.createElement('div')
      body.className = 'idea-frag-rich'
      body.contentEditable = 'true'
      body.spellcheck = true
      body.innerHTML = sanitizeRichHtml(frag.body)
      body.setAttribute('data-placeholder', form === 'polaroid' ? 'Caption…' : 'Write fragment…')
      body.addEventListener('focus', () => card.classList.add('editing'))
      body.addEventListener('blur', () => {
        card.classList.remove('editing')
        const val = body.innerHTML
        if (val !== frag.body) {
          frag.body = val
          if (_currentIdea) saveCurrent()
        }
      })
      body.addEventListener('keydown', e => {
        if (e.key === 'Escape') { body.blur() }
      })

      const del = document.createElement('button')
      del.className = 'idea-frag-delete'
      del.title = 'Remove'
      del.textContent = '×'
      del.addEventListener('click', e => { e.stopPropagation(); removeFragment(i) })

      card.appendChild(handle)
      if (form === 'swatch') {
        // The colour block is the swatch; clicking it tries the next paint chip.
        const chip = document.createElement('button')
        chip.type = 'button'
        chip.className = 'idea-frag-chip'
        chip.title = 'Change colour'
        chip.setAttribute('aria-label', 'Change colour')
        chip.addEventListener('click', () => {
          frag.color = PAPER[(PAPER.indexOf(paperOf(frag)) + 1) % PAPER.length]
          renderFragments(_currentIdea.fragments)
          saveCurrent()
        })
        card.appendChild(chip)
      }
      if (form === 'polaroid') card.appendChild(polaroidPhoto(frag))
      card.appendChild(body)
      card.appendChild(label)
      card.appendChild(del)

      grid.appendChild(card)
    })
    Dnd.sortable(grid, {
      items: '.idea-fragment-card', type: 'fragment', handle: '.idea-frag-handle', axis: 'x',
      onMove: (from, to) => { Dnd.move(_currentIdea.fragments, from, to); renderFragments(_currentIdea.fragments); saveCurrent() },
    })
  }

  // ── pictures ─────────────────────────────────────────────────
  function polaroidPhoto(frag) {
    const photo = document.createElement('div')
    photo.className = 'idea-frag-photo'
    if (!frag.image || !_currentIdea) {
      photo.innerHTML = '<button type="button" class="idea-frag-photo-empty">Drop or choose a picture</button>'
      photo.querySelector('button').addEventListener('click', () => choosePicture(frag))
      return photo
    }
    const img = document.createElement('img')
    img.alt = stripHtml(frag.body || '')
    photo.appendChild(img)
    window.quill.ideaImagePath({ ideaId: _currentIdea.id, file: frag.image }).then(res => {
      if (res?.fullPath) img.src = '../__vfs' + res.fullPath
      else photo.classList.add('missing')
    })
    return photo
  }

  async function storePicture(result, frag, caption = '') {
    if (!result?.ok) { if (result?.error) alert(result.error); return }
    if (frag) {
      if (frag.image) window.quill.deleteIdeaImage({ ideaId: _currentIdea.id, file: frag.image })
      frag.image = result.file
    } else {
      _currentIdea.fragments ||= []
      _currentIdea.fragments.unshift({ type: 'image', body: caption, image: result.file, id: Date.now() })
    }
    renderFragments(_currentIdea.fragments)
    saveCurrent()
  }

  // `frag` set: put the picture on that polaroid; otherwise make a new one.
  async function choosePicture(frag = null, caption = '') {
    if (!_currentIdea) return
    const res = await window.quill.openFilesDialog({ filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif'] }] })
    const src = res?.filePaths?.[0]
    if (!src) return
    await storePicture(await window.quill.addIdeaImage({ ideaId: _currentIdea.id, srcPath: src }), frag, caption)
  }

  async function addPictureFile(file, frag = null) {
    if (!_currentIdea || !file?.type?.startsWith('image/')) return
    const allowed = await window.quill.allowDroppedImage(file).catch(() => null)
    const result = allowed?.filePath
      ? await window.quill.addIdeaImage({ ideaId: _currentIdea.id, srcPath: allowed.filePath })
      : await window.quill.addIdeaImageData({ ideaId: _currentIdea.id, mime: file.type, bytes: new Uint8Array(await file.arrayBuffer()) })
    await storePicture(result, frag)
  }

  function initPictureInput() {
    const section = document.querySelector('.idea-fragments-section')
    const hasImage = e => [...(e.dataTransfer?.items || [])].some(item => item.kind === 'file' && item.type.startsWith('image/'))
    section.addEventListener('dragover', e => {
      if (!hasImage(e)) return
      e.preventDefault()
      section.classList.add('picture-over')
    })
    section.addEventListener('dragleave', e => { if (!section.contains(e.relatedTarget)) section.classList.remove('picture-over') })
    section.addEventListener('drop', async e => {
      section.classList.remove('picture-over')
      if (!hasImage(e)) return
      e.preventDefault()
      const card = e.target.closest?.('.idea-fragment-card.frag-polaroid')
      const target = card ? _currentIdea?.fragments?.[Number(card.dataset.idx)] : null
      for (const file of [...e.dataTransfer.files].filter(f => f.type.startsWith('image/'))) {
        await addPictureFile(file, target && !target.image ? target : null)
      }
    })
    // Paste a picture anywhere on the page except inside the notes or a text field.
    document.addEventListener('paste', e => {
      if (!document.getElementById('view-ideas')?.classList.contains('active') || !_currentIdea) return
      if (e.target.closest?.('#idea-scratchpad, input, textarea, #idea-ai-drawer')) return
      const file = [...(e.clipboardData?.items || [])].find(item => item.kind === 'file' && item.type.startsWith('image/'))?.getAsFile()
      if (!file) return
      e.preventDefault()
      addPictureFile(file)
    })
    document.getElementById('idea-fragment-type').addEventListener('change', syncFragmentForm)
    document.getElementById('idea-fragment-pick').addEventListener('click', async () => {
      const caption = document.getElementById('idea-fragment-body').value.trim()
      await choosePicture(null, caption)
      hideFragmentInput()
    })
  }

  function syncFragmentForm() {
    const isImage = document.getElementById('idea-fragment-type').value === 'image'
    document.getElementById('idea-fragment-pick').hidden = !isImage
    document.getElementById('idea-fragment-body').placeholder = isImage ? 'Caption (optional)…' : 'Write the fragment…'
  }

  function showFragmentInput() {
    document.getElementById('idea-fragment-form').style.display = 'flex'
    document.getElementById('idea-fragment-body').value = ''
    document.getElementById('idea-fragment-type').value = 'vibe'
    syncFragmentForm()
    setTimeout(() => document.getElementById('idea-fragment-body').focus(), 40)
  }

  function hideFragmentInput() {
    document.getElementById('idea-fragment-form').style.display = 'none'
  }

  function saveFragment() {
    if (!_currentIdea) return
    const body = document.getElementById('idea-fragment-body').value.trim()
    const type = document.getElementById('idea-fragment-type').value
    if (!body && type !== 'image') return
    if (!_currentIdea.fragments) _currentIdea.fragments = []
    // Store plain text; it will render in the contenteditable body as-is
    _currentIdea.fragments.unshift({ type, body, id: Date.now() })
    renderFragments(_currentIdea.fragments)
    hideFragmentInput()
    saveCurrent()
  }

  function removeFragment(i) {
    if (!_currentIdea) return
    const [gone] = _currentIdea.fragments.splice(i, 1)
    if (gone?.image) window.quill.deleteIdeaImage({ ideaId: _currentIdea.id, file: gone.image })
    renderFragments(_currentIdea.fragments)
    saveCurrent()
  }

  // ── AI chat ──────────────────────────────────────────────────
  function clearIdeaConvo() {
    if (!_currentIdea) return
    _currentIdea.conversation = []
    _convoHistory = []
    window.quill.saveIdea(_currentIdea)
    renderIdeaWelcome()
  }

  function renderIdeaChat(messages) {
    const msgs = document.getElementById('idea-messages')
    msgs.innerHTML = ''
    messages.forEach(m => appendIdeaChatMsg(m.role, m.content, false))
    msgs.scrollTop = msgs.scrollHeight
  }

  function renderIdeaWelcome() {
    const msgs = document.getElementById('idea-messages')
    const exploreText = `Start anywhere — a feeling, an image, a character who won't leave you alone. I'll ask one question at a time. Nothing gets written down until you've said it first.`
    const developText = `Throw something at me — a concept, a dynamic, a "what if," a vibe. I'll help you make it concrete.`
    msgs.innerHTML = `
      <div class="idea-welcome">
        <div class="idea-welcome-icon">✦</div>
        <div class="idea-welcome-text">${_chatMode === 'explore' ? exploreText : developText}</div>
      </div>
    `
  }

  function appendIdeaChatMsg(role, content, scroll = true) {
    const msgs = document.getElementById('idea-messages')
    // remove welcome if present
    const welcome = msgs.querySelector('.idea-welcome')
    if (welcome) welcome.remove()
    const div = document.createElement('div')
    div.className = `idea-msg idea-msg-${role}`
    div.innerHTML = renderMd(content)
    msgs.appendChild(div)
    if (scroll) msgs.scrollTop = msgs.scrollHeight
    return div
  }

  function appendTyping() {
    const msgs = document.getElementById('idea-messages')
    const div  = document.createElement('div')
    div.className = 'idea-msg idea-msg-assistant'
    div.id = 'idea-typing-' + Date.now()
    div.innerHTML = '<span class="bs-typing">●●●</span>'
    msgs.appendChild(div)
    msgs.scrollTop = msgs.scrollHeight
    return div.id
  }

  function updateTyping(id, content) {
    const el = document.getElementById(id)
    if (el) {
      el.innerHTML = renderMd(content)
      document.getElementById('idea-messages').scrollTop = 99999
    }
  }

  async function sendIdeaMsg() {
    if (!_currentIdea) return
    const inp    = document.getElementById('idea-input')
    const text   = inp.value.trim()
    if (!text) return
    inp.value = ''

    const hasKey = await QuillAI.hasKey()
    const model  = QuillModels.current()
    if (!hasKey) {
      appendIdeaChatMsg('assistant', 'Add your OpenRouter API key in Settings → AI (⌘,) to chat.')
      return
    }

    if (!_currentIdea.conversation) _currentIdea.conversation = []
    appendIdeaChatMsg('user', text)
    _currentIdea.conversation.push({ role: 'user', content: text })

    const typingId = appendTyping()

    try {
      const resp = await QuillAI.fetch({
        method: 'POST',
        body: JSON.stringify({
          model,
          max_tokens: 800,
          stream: true,
          messages: [
            ...(await ideaSystemMessages()),
            ..._currentIdea.conversation.slice(-14),
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
        buf = lines.pop()
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const raw = line.slice(6).trim()
          if (raw === '[DONE]') continue
          try {
            const delta = JSON.parse(raw).choices?.[0]?.delta?.content || ''
            if (delta) {
              reply += delta
              if (el) {
                el.innerHTML = renderMd(reply)
                document.getElementById('idea-messages').scrollTop = 99999
              }
            }
          } catch {}
        }
      }
      if (buf.startsWith('data: ')) {
        const raw = buf.slice(6).trim()
        if (raw && raw !== '[DONE]') {
          try {
            const delta = JSON.parse(raw).choices?.[0]?.delta?.content || ''
            if (delta) { reply += delta; if (el) el.innerHTML = renderMd(reply) }
          } catch {}
        }
      }

      if (!reply) reply = '(no response)'
      if (el) el.innerHTML = renderMd(reply)
      _currentIdea.conversation.push({ role: 'assistant', content: reply })
      if (reply !== '(no response)') _ideaCtx?.consumed()
      window.quill.saveIdea(_currentIdea)
    } catch (err) {
      updateTyping(typingId, `Error: ${err.message}`)
    }
  }

  function buildIdeaSystemPrompt() {
    const override = localStorage.getItem('quill_idea_sys_override')
    if (override) return override

    const idea = _currentIdea || {}
    const tags  = (idea.tags || []).join(', ')
    const frags = (idea.fragments || []).map(f => `[${f.type}] ${f.body}`).join('\n')
    const scratch = stripHtml((idea.scratchpad || '')).slice(0, 1200)

    if (_chatMode === 'explore') {
      return `You are a thinking partner for a fiction writer in early-stage story development. Your job is to help them discover what they're actually trying to write — not to generate it for them.

HOW YOU WORK:
- Ask one narrow, specific question per response. Never more than one.
- The question should target the single most unresolved or interesting thing in what they just said.
- Never fill in the blank for them. If something is vague, ask about it — don't invent an answer.
- When they land on something — a character truth, a scene that feels right, a structural decision — briefly name what that decision means for the story (the "so what"), then ask the next question.
- Offer options only as friction, not as answers. If you do offer options, keep it to 2-3 and expect them to combine, reject, or redirect — not choose cleanly.
- Never summarize what they've told you back to them unprompted. You're not a mirror, you're a question.
- Match their register. If they're elliptical, stay with the ellipsis. If they're concrete, go concrete.
- Genre: dark romance and romantasy. You understand the conventions — earned intimacy, morally complicated people, want vs. need, the cost of desire. You don't sanitize.
- Keep responses short: 2-4 sentences maximum. Question last.

WHAT YOU'RE TRACKING (mentally, not out loud):
- What has been established so far
- What feels unresolved or undecided
- What decision, if made, would unlock the most

CURRENT IDEA: "${idea.title || 'Untitled'}"

SCRATCHPAD NOTES:
${scratch || '(nothing yet)'}

TAGS / GENRE SIGNALS: ${tags || '(none yet)'}

FRAGMENTS & VIBES:
${frags || '(none yet)'}

Start from what's here. If it's sparse, ask about the one thing that would make it real.`
    }

    // develop mode (original)
    return `You are a story development partner for a fiction writer. Your job is to help turn a vague spark into something concrete and usable — a premise with real shape, characters with personality, scenes that could actually exist on the page.

You are generative, not analytical. Your instinct is to build, not interrogate. When someone gives you a concept, you help make it more specific, more vivid, more interesting — you don't hold it at arm's length and ask them to "sit with it."

Your approach:
- Take the idea seriously and run with it. Offer a concrete direction, a specific scenario, a "what if this means..." that pushes toward something real.
- Make it tactile. Instead of "explore the power dynamic," give them: "What if the first time he lets her see him afraid, it's not a moment she earned — he just slips, and she has to decide what to do with it."
- Generate options when the idea is early. Give 2–3 concrete takes, not open-ended questions.
- Ask one sharp follow-up only when you genuinely need it to go further — not as a default move.
- Match the energy of dark romance and romantasy: tension, want, danger, earned intimacy, morally complicated people.
- If something is clichéd, say so fast and pivot to what would be more interesting. Be specific about why.
- Keep responses under 250 words. Dense and useful beats long and vague.

CURRENT IDEA: "${idea.title || 'Untitled'}"

SCRATCHPAD NOTES:
${scratch || '(nothing yet)'}

TAGS / GENRE SIGNALS: ${tags || '(none yet)'}

FRAGMENTS & VIBES:
${frags || '(none yet)'}

Build on what's here. If it's sparse, give them something to react to. If it's rich, go specific.`
  }

  // ── instructions (the model itself is set in Settings → AI) ──
  function toggleIdeaSettings() {
    _settingsOpen = !_settingsOpen
    document.getElementById('idea-api-settings').style.display = _settingsOpen ? 'block' : 'none'
    if (_settingsOpen) {
      document.getElementById('idea-instructions-ta').value =
        localStorage.getItem('quill_idea_sys_override') || buildIdeaSystemPrompt()
    }
  }

  function saveIdeaInstructions() {
    const ta  = document.getElementById('idea-instructions-ta')
    const val = ta.value.trim()
    if (val) localStorage.setItem('quill_idea_sys_override', val)
    else     localStorage.removeItem('quill_idea_sys_override')
    document.getElementById('idea-api-settings').style.display = 'none'
    _settingsOpen = false
  }

  function resetIdeaInstructions() {
    localStorage.removeItem('quill_idea_sys_override')
    document.getElementById('idea-instructions-ta').value = buildIdeaSystemPrompt()
  }

  function updateModelIndicator() {
    const m   = QuillModels.current()
    const el = document.getElementById('idea-model-name')
    if (el) el.textContent = QuillModels.label(m)
  }

  // ── hatch modal — AI preview flow ────────────────────────────
  let _hatchPreview = null

  function showHatchModal() {
    if (!_currentIdea) return
    _hatchPreview = null
    document.getElementById('idea-hatch-modal').style.display = 'flex'
    document.getElementById('idea-hatch-name').value = _currentIdea.title || ''
    document.getElementById('idea-hatch-error').textContent = ''
    showHatchPane('name')
    setTimeout(() => document.getElementById('idea-hatch-name').focus(), 60)
  }

  function hideHatchModal() {
    document.getElementById('idea-hatch-modal').style.display = 'none'
    _hatchPreview = null
  }

  function showHatchPane(pane) {
    document.getElementById('idea-hatch-pane-name').style.display    = pane === 'name'    ? '' : 'none'
    document.getElementById('idea-hatch-pane-loading').style.display = pane === 'loading' ? '' : 'none'
    document.getElementById('idea-hatch-pane-preview').style.display = pane === 'preview' ? '' : 'none'
    const dialog = document.querySelector('.idea-hatch-dialog')
    if (dialog) dialog.classList.toggle('preview-mode', pane === 'preview')
    // sync name into preview pane
    if (pane === 'preview') {
      const nameEl = document.getElementById('idea-hatch-name-preview')
      const srcEl  = document.getElementById('idea-hatch-name')
      if (nameEl && srcEl) nameEl.value = srcEl.value
    }
  }

  async function startHatchAI() {
    const name = document.getElementById('idea-hatch-name').value.trim()
    if (!name) { document.getElementById('idea-hatch-name').focus(); return }
    const hasKey = await QuillAI.hasKey()
    if (!hasKey) {
      document.getElementById('idea-hatch-error').textContent = 'Add your OpenRouter API key in Settings → AI (⌘,) first.'
      return
    }

    const activeSections = new Set()
    document.querySelectorAll('.hatch-toggle-pill.active').forEach(p => activeSections.add(p.dataset.section))

    showHatchPane('loading')
    const idea  = _currentIdea
    const model = QuillModels.current()
    const loadingEl = document.getElementById('idea-hatch-loading-msg')
    const setMsg = msg => { if (loadingEl) loadingEl.textContent = msg }

    const clean = s => (s || '').replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 500)
    const scratchpad = clean(stripHtml(idea.scratchpad))
    const frags = (idea.fragments || []).map(f => '[' + f.type + '] ' + clean(f.body)).join(' | ')
    const tags  = (idea.tags || []).join(', ')
    const ideaContext = [
      'IDEA TITLE: ' + (clean(idea.title) || 'Untitled'),
      'SCRATCHPAD: ' + scratchpad,
      'TAGS: ' + tags,
      'FRAGMENTS: ' + (frags || '(none)'),
    ].join('\n')

    const wantNovel  = activeSections.has('novel')
    const wantBeats  = activeSections.has('beats')
    const wantChars  = activeSections.has('characters')
    const wantWb     = activeSections.has('worldbible')

    const parsed = { novel: null, beats: null, characters: null, wbCards: null, beatTemplate: 'generic' }

    // ── detect beat template from idea content ─────────────────
    function detectBeatTemplate() {
      const haystack = [
        idea.title || '',
        stripHtml(idea.scratchpad || ''),
        (idea.tags || []).join(' '),
        (idea.fragments || []).map(f => stripHtml(f.body || '')).join(' '),
      ].join(' ').toLowerCase()
      const romanceWords = ['romance','romantic','love interest','slow burn','enemies to lovers',
        'forced proximity','love story','happily ever after','hea','heat','kiss','swoony']
      const fantasyWords = ['fantasy','magic','dragon','witch','fae','fey','fairy','realm',
        'kingdom','quest','curse','enchant','sorcerer','wizard','elf','dwarf','mythical',
        'supernatural','immortal','vampire','shifter','wolf','pirate','ship','island','lore']
      const isRomance = romanceWords.some(w => haystack.includes(w))
      const isFantasy = fantasyWords.some(w => haystack.includes(w))
      if (isRomance && isFantasy) return 'fantasy_romance'
      if (isRomance) return 'romance'
      return 'generic'
    }

    // ── beat schema per template ───────────────────────────────
    // One BEATn line per beat, in structure.js order, so hatched beats land on the same ids
    // the Structure tab shows.
    const BEAT_SCHEMAS = Object.fromEntries(Object.keys(QuillStructure.TEMPLATES).map(key => [key,
      QuillStructure.beatsOf(key).map((b, i) => ({ id: b.id, kv: `BEAT${i + 1}`, label: b.track ? `${b.label} (${b.track})` : b.label }))]))

    // helper: parse flat KEY: value lines into a map
    function parseKV(raw) {
      const kv = {}
      for (const line of raw.split('\n')) {
        const colon = line.indexOf(':')
        if (colon === -1) continue
        const key = line.slice(0, colon).trim().toUpperCase()
          .replace(/\s+/g, '_')
          .replace(/^CHAR_(\d)/, 'CHAR$1')
          .replace(/^WB_(\d)/, 'WB$1')
        // strip inline comments like  # label text
        const val = line.slice(colon + 1).replace(/#.*$/, '').trim()
        if (key && val && val !== '...' && val.toLowerCase() !== 'n/a') kv[key] = val
      }
      return kv
    }

    try {
      // ── CALL 1: novel fields + beats + characters ──────────────
      const needsCall1 = wantNovel || wantBeats || wantChars
      if (needsCall1) {
        setMsg('Reading your idea\u2026')

        // detect template before building prompt
        const beatTmplKey = detectBeatTemplate()
        parsed.beatTemplate = beatTmplKey
        const beatSchema = BEAT_SCHEMAS[beatTmplKey]

        const tmplLabels = {
          generic:         '3-act structure',
          romance:         'romance arc',
          fantasy_romance: 'fantasy romance dual-track (quest + romance)',
        }

        let template1 = ''
        if (wantNovel) template1 += 'LOGLINE: ...\nGENRE: ...\nTHEMES: ...\nPOV: ...\nSYNOPSIS: ...\n'
        if (wantBeats) {
          template1 += beatSchema.map(b => b.kv + ': ...  # ' + b.label).join('\n') + '\n'
        }
        if (wantChars) {
          for (let ci = 1; ci <= 2; ci++) {
            template1 += 'CHAR' + ci + '_NAME: ...\n'
              + 'CHAR' + ci + '_ROLE: ...\n'
              + 'CHAR' + ci + '_DESC: ...\n'
              + 'CHAR' + ci + '_WANT: ...\n'
              + 'CHAR' + ci + '_NEED: ...\n'
              + 'CHAR' + ci + '_FEAR: ...\n'
              + 'CHAR' + ci + '_ARC: ...\n'
              + 'CHAR' + ci + '_WOUND: ...\n'
          }
        }

        const beatInstructions = wantBeats
          ? 'Use the ' + tmplLabels[beatTmplKey] + ' for story beats. Fill EVERY BEAT# line — replace ... with your answer, keep the # comment as-is. Each beat: under 20 words.'
          : ''

        const prompt1 = [
          'You are a developmental editor helping a writer hatch a story idea into a structured novel project.',
          '',
          ideaContext,
          '',
          'Fill in every line of this template. Replace ... with your answer. One line per field. Do NOT change the key names (LOGLINE, BEAT1, CHAR1_NAME etc). Novel/synopsis: under 40 words. ' + beatInstructions + ' Character fields: under 15 words each. Skip truly inapplicable fields with: n/a',
          '',
          template1,
        ].join('\n')

        const ctrl1 = new AbortController()
        const t1 = setTimeout(() => ctrl1.abort(), 35000)

        if (wantBeats && wantChars) setMsg('Mapping story structure\u2026')
        else if (wantChars) setMsg('Building your characters\u2026')
        else setMsg('Mapping story structure\u2026')

        const resp1 = await QuillAI.fetch({
          method: 'POST', signal: ctrl1.signal,
          body: JSON.stringify({ model, max_tokens: 1500, messages: [{ role: 'user', content: prompt1 }] })
        })
        clearTimeout(t1)
        const data1 = await resp1.json()
        if (data1.error) throw new Error(data1.error.message || 'API error')
        const kv1 = parseKV(data1.choices?.[0]?.message?.content || '')

        if (wantNovel) {
          parsed.novel = {
            logline:  kv1['LOGLINE']  || '',
            genre:    kv1['GENRE']    || '',
            themes:   kv1['THEMES']   || '',
            pov:      kv1['POV']      || '',
            synopsis: kv1['SYNOPSIS'] || '',
          }
        }
        if (wantBeats) {
          parsed.beats = beatSchema.map(b => ({ id: b.id, label: b.label, text: kv1[b.kv] || '' }))
        }
        if (wantChars) {
          parsed.characters = []
          for (let ci = 1; ci <= 2; ci++) {
            const n = kv1['CHAR' + ci + '_NAME']
            if (n) {
              parsed.characters.push({
                name:  n,
                role:  kv1['CHAR' + ci + '_ROLE']  || '',
                desc:  kv1['CHAR' + ci + '_DESC']  || '',
                want:  kv1['CHAR' + ci + '_WANT']  || '',
                need:  kv1['CHAR' + ci + '_NEED']  || '',
                fear:  kv1['CHAR' + ci + '_FEAR']  || '',
                arc:   kv1['CHAR' + ci + '_ARC']   || '',
                wound: kv1['CHAR' + ci + '_WOUND'] || '',
              })
            }
          }
        }
      }

      // ── CALL 2: world bible (separate, focused call) ───────────
      if (wantWb) {
        setMsg('Building your world\u2026')

        const WB_SECTIONS = 'Locations, Magic & Rules, Factions, Terminology, History & Lore, Creatures & Races, Politics & Power, Religion & Mythology'

        const prompt2 = [
          'You are a developmental editor helping a writer build a World Bible for their novel.',
          '',
          ideaContext,
          '',
          'Based on the idea above, identify 4-6 specific world-building elements that are clearly implied or would be most useful to document. Prioritize variety — use different sections where the idea warrants it. For each one, choose the best section from: ' + WB_SECTIONS,
          '',
          'Fill in this template. Replace ... with your answer. One line per field.',
          'Name: under 6 words. Body: 1-2 sentences, specific and usable. Section must exactly match one from the list above.',
          'Fields: populate the most relevant fields for that section type:',
          '  Locations → type, atmosphere, significance, inhabitants',
          '  Magic & Rules → how_it_works, limitations, who_can_use',
          '  Factions → goal, leadership, relationship_to_protagonist',
          '  Terminology → definition, used_by',
          '  History & Lore → when, what_happened, impact',
          '  Creatures & Races → appearance, abilities, culture',
          '  Politics & Power → type, influence, key_figures',
          '  Religion & Mythology → beliefs, practices, role_in_story',
          '',
          'WB1_SECTION: ...\nWB1_NAME: ...\nWB1_BODY: ...\nWB1_FIELDS: field1=value1; field2=value2\nWB2_SECTION: ...\nWB2_NAME: ...\nWB2_BODY: ...\nWB2_FIELDS: field1=value1; field2=value2\nWB3_SECTION: ...\nWB3_NAME: ...\nWB3_BODY: ...\nWB3_FIELDS: field1=value1; field2=value2\nWB4_SECTION: ...\nWB4_NAME: ...\nWB4_BODY: ...\nWB4_FIELDS: field1=value1; field2=value2\nWB5_SECTION: ...\nWB5_NAME: ...\nWB5_BODY: ...\nWB5_FIELDS: field1=value1; field2=value2\nWB6_SECTION: ...\nWB6_NAME: ...\nWB6_BODY: ...\nWB6_FIELDS: field1=value1; field2=value2',
        ].join('\n')

        const ctrl2 = new AbortController()
        const t2 = setTimeout(() => ctrl2.abort(), 30000)

        const resp2 = await QuillAI.fetch({
          method: 'POST', signal: ctrl2.signal,
          body: JSON.stringify({ model, max_tokens: 900, messages: [{ role: 'user', content: prompt2 }] })
        })
        clearTimeout(t2)
        const data2 = await resp2.json()
        if (data2.error) throw new Error(data2.error.message || 'API error')
        const kv2 = parseKV(data2.choices?.[0]?.message?.content || '')

        parsed.wbCards = []
        for (let wi = 1; wi <= 6; wi++) {
          const sec = kv2['WB' + wi + '_SECTION']
          const wbn = kv2['WB' + wi + '_NAME']
          if (sec && wbn) {
            // parse WBn_FIELDS: "field1=value1; field2=value2" into an object
            const fields = {}
            const fieldsRaw = kv2['WB' + wi + '_FIELDS'] || ''
            fieldsRaw.split(';').forEach(pair => {
              const eqIdx = pair.indexOf('=')
              if (eqIdx > 0) {
                const k = pair.slice(0, eqIdx).trim().toLowerCase().replace(/\s+/g, '_')
                const v = pair.slice(eqIdx + 1).trim()
                if (k && v && v !== '...') fields[k] = v
              }
            })
            parsed.wbCards.push({ section: sec, name: wbn, body: kv2['WB' + wi + '_BODY'] || '', fields })
          }
        }
      }

      setMsg('Done!')
      parsed._name     = name
      parsed._sections = activeSections
      _hatchPreview    = parsed
      renderHatchPreview(_hatchPreview)
      showHatchPane('preview')

    } catch (err) {
      showHatchPane('name')
      const msg = err.name === 'AbortError'
        ? 'Request timed out \u2014 try again.'
        : 'AI error: ' + err.message
      document.getElementById('idea-hatch-error').textContent = msg
    }
  }

      function renderHatchPreview(data) {
    const sections = data._sections || new Set(['novel','beats','characters','worldbible'])
    const showSec = (id, key) => { const el = document.getElementById(id); if (el) el.style.display = sections.has(key) ? '' : 'none' }
    showSec('hp-section-novel',     'novel')
    showSec('hp-section-beats',     'beats')
    showSec('hp-section-characters','characters')
    showSec('hp-section-worldbible','worldbible')
    const n = data.novel || {}
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || '' }
    set('hp-logline', n.logline); set('hp-genre', n.genre)
    set('hp-themes', n.themes);   set('hp-pov', n.pov)
    set('hp-synopsis', n.synopsis)
    const beatsEl = document.getElementById('hp-beats')
    beatsEl.innerHTML = ''
    ;(data.beats || []).forEach(b => {
      const row = document.createElement('div')
      row.className = 'hp-beat-row'
      row.innerHTML = '<span class="hp-beat-label">' + esc(b.label) + '</span><textarea class="hp-field" data-beat-id="' + esc(b.id) + '" rows="2">' + esc(b.text || '') + '</textarea>'
      beatsEl.appendChild(row)
    })
    const charsEl = document.getElementById('hp-characters')
    charsEl.innerHTML = ''
    ;(data.characters || []).forEach((c, i) => {
      const card = document.createElement('div')
      card.className = 'hp-char-card'
      const fields = ['desc','want','need','fear','arc','wound'].map(f =>
        '<div class="hp-char-field"><div class="hp-char-field-label">' + f + '</div><input class="hp-char-field-val" data-char="' + i + '" data-field="' + f + '" value="' + esc(c[f]||'') + '" placeholder="' + f + '\u2026"></div>'
      ).join('')
      card.innerHTML = '<div class="hp-char-header"><input class="hp-char-name" data-char="' + i + '" data-field="name" value="' + esc(c.name||'') + '" placeholder="Name\u2026"><input class="hp-char-role" data-char="' + i + '" data-field="role" value="' + esc(c.role||'') + '" placeholder="Role\u2026"></div><div class="hp-char-fields">' + fields + '</div>'
      charsEl.appendChild(card)
    })
    const wbEl = document.getElementById('hp-wb-cards')
    wbEl.innerHTML = ''
    if (!data.wbCards?.length) {
      wbEl.innerHTML = '<div class="hp-empty">No world bible cards detected from this idea.</div>'
    } else {
      data.wbCards.forEach((card, i) => {
        const el = document.createElement('div')
        el.className = 'hp-wb-card'
        el.innerHTML = '<div class="hp-wb-section-pill">' + esc(card.section) + '</div><div class="hp-wb-card-body"><input class="hp-wb-name" data-wb="' + i + '" data-field="name" value="' + esc(card.name||'') + '" placeholder="Card name…"><textarea class="hp-wb-body" data-wb="' + i + '" data-field="body" rows="2">' + esc(card.body||'') + '</textarea></div>'
        wbEl.appendChild(el)
      })
    }
  }

  function readHatchPreviewEdits() {
    if (!_hatchPreview) return _hatchPreview
    const get = id => { const el = document.getElementById(id); return el ? el.value.trim() : '' }

    // only overwrite novel if it was generated
    if (_hatchPreview.novel !== null) {
      _hatchPreview.novel = { logline: get('hp-logline'), genre: get('hp-genre'), themes: get('hp-themes'), pov: get('hp-pov'), synopsis: get('hp-synopsis') }
    }

    document.querySelectorAll('[data-beat-id]').forEach(el => {
      const beat = (_hatchPreview.beats || []).find(b => b.id === el.dataset.beatId)
      if (beat) beat.text = el.value.trim()
    })
    document.querySelectorAll('[data-char]').forEach(el => {
      const i = parseInt(el.dataset.char)
      if (_hatchPreview.characters?.[i]) _hatchPreview.characters[i][el.dataset.field] = el.value.trim()
    })

    // wb: read name+body from inputs but preserve section from _hatchPreview (it's a pill div, not an input)
    document.querySelectorAll('[data-wb]').forEach(el => {
      const i = parseInt(el.dataset.wb)
      if (_hatchPreview.wbCards?.[i] && el.dataset.field !== 'section') {
        _hatchPreview.wbCards[i][el.dataset.field] = el.value.trim()
      }
    })

    return _hatchPreview
  }

  async function doHatch() {
    const preview = readHatchPreviewEdits()
    const name    = document.getElementById('idea-hatch-name-preview')?.value.trim() || preview?._name || document.getElementById('idea-hatch-name').value.trim()
    if (!name) return
    const btn = document.getElementById('idea-hatch-confirm')
    btn.textContent = 'Hatching…'; btn.disabled = true
    const result = await window.quill.hatchIdeaCommit({
      name,
      novel:        preview?.novel        || null,
      characters:   preview?.characters   || [],
      wbCards:      preview?.wbCards      || [],
      beats:        preview?.beats        || [],
      beatTemplate: preview?.beatTemplate || 'generic',
    })
    btn.textContent = 'Hatch novel →'; btn.disabled = false
    if (!result.ok) {
      const errEl = document.getElementById('idea-hatch-error2') || document.getElementById('idea-hatch-error')
      if (errEl) errEl.textContent = result.error || 'Something went wrong.'
      return
    }
    hideHatchModal()
    if (typeof Tree !== 'undefined') await Tree.refresh()
    if (typeof App  !== 'undefined') App.loadDashboard()
  }

  function extractField(field) {
    const scratch = stripHtml(_currentIdea?.scratchpad || '').toLowerCase()
    const lines = scratch.split('\n')
    for (const line of lines) {
      if (line.startsWith(field + ':')) return line.slice(field.length + 1).trim()
    }
    return ''
  }

  // ── idea status & management ─────────────────────────────────

  async function setIdeaStatus(id, status) {
    const idea = _ideas.find(i => i.id === id)
    if (!idea) return
    idea.status = status
    await window.quill.saveIdea(idea)
    if (_currentIdea?.id === id) { _currentIdea.status = status; showStatus(status) }
    refreshSidebar()
  }

  function getCurrentIdeaId() {
    return _currentIdea?.id || null
  }

  async function updateIdeaTitle(id, title) {
    const idea = _ideas.find(i => i.id === id)
    if (!idea) return
    idea.title = title
    await window.quill.saveIdea(idea)
    if (_currentIdea?.id === id) {
      _currentIdea.title = title
      const inp = document.getElementById('idea-title-input')
      if (inp && inp.value !== title) inp.value = title
    }
    refreshSidebar()
  }

  async function duplicateIdea(id) {
    const idea = _ideas.find(i => i.id === id)
    if (!idea) return
    const newIdea = JSON.parse(JSON.stringify(idea))
    newIdea.id      = Math.random().toString(36).slice(2, 10)
    newIdea.title   = (idea.title || 'Untitled idea') + ' (copy)'
    newIdea.created = new Date().toISOString()
    newIdea.conversation = []
    await window.quill.copyIdeaImages({ fromId: idea.id, toId: newIdea.id })
    _ideas.unshift(newIdea)
    await window.quill.saveIdea(newIdea)
    refreshSidebar()
    openIdea(newIdea.id)
  }

  async function deleteIdeaById(id) {
    await window.quill.deleteIdea(id)
    _ideas = _ideas.filter(i => i.id !== id)
    if (_currentIdea?.id === id) {
      _currentIdea  = null
      _convoHistory = []
      document.getElementById('idea-title-input').value = ''
      const sp = document.getElementById('idea-scratchpad')
      if (sp) sp.innerHTML = ''
      renderFragments([])
      renderTags([])
      document.getElementById('idea-messages').innerHTML = ''
      const emptyEl = document.getElementById('idea-empty-state')
      if (emptyEl) emptyEl.style.display = ''
      document.getElementById('view-ideas')?.classList.add('no-idea')
      if (_ideas.length) openIdea(_ideas[0].id)
    }
    refreshSidebar()
  }

  // ── delete idea (toolbar button inside view) ──────────────────
  async function deleteCurrentIdea() {
    if (!_currentIdea) return
    await deleteIdeaById(_currentIdea.id)
  }

  // ── helpers ──────────────────────────────────────────────────
  function stripHtml(html) {
    const tmp = document.createElement('div')
    tmp.innerHTML = html || ''
    return tmp.textContent || tmp.innerText || ''
  }

  function esc(s) { return escapeHtml(s) }

  function renderMd(text) {
    return String(text || '')
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>')
      .replace(/\*(.+?)\*/g,'<em>$1</em>')
      .replace(/\n/g,'<br>')
  }

  function debounce(fn, ms) {
    let t
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms) }
  }

  return {
    init, loadIdeas, openIdea, openNewIdea: createNewIdea, renderIdeaList,
    createFromInbox, setIdeaStatus, getCurrentIdeaId, updateIdeaTitle, duplicateIdea, deleteIdeaById,
  }

})()
