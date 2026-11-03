/* stylelab-study.js — Style Study: close reading from your own books.
 *
 * React → notice → choose one effect → attempt → self-check → revise, then later a transfer
 * attempt with the source hidden. Every step works without an API key; the AI layer only
 * offers other readings and feedback on the chosen effect.
 *
 * Studies are JSON (study.js, saved through main.js). Every edit bumps `rev` and is copied to
 * a local recovery draft before the debounced disk save; the draft is cleared only when the
 * save acknowledged is the latest revision. Book text is always rendered as text.
 */
const StyleStudy = (() => {
  const S = window.QuillStudy
  const DRAFT_KEY = id => `quill_study_draft_${id}`
  const RECENT_SCENES_KEY = 'quill_study_recent_scenes'
  const FOCAL_WORD_CAP = 600

  const EFFECTS = [
    { id: 'claim-choice', label: 'Claim vs. choice', hint: 'Keep the gap between what Anna says she is doing and what she does.' },
    { id: 'detail-meaning', label: 'Detail that changes meaning', hint: 'One detail whose implication is left unexpanded.' },
    { id: 'leverage', label: 'Exchange that shifts leverage', hint: 'Dialogue that changes suspicion, intimacy, or the next decision.' },
    { id: 'info-moment', label: 'Information at the right moment', hint: 'Cut, move, or dramatize exposition that interrupts an active question.' },
    { id: 'oriented-action', label: 'Fast but oriented action', hint: 'Cause, position and options stay clear at speed.' },
    { id: 'interview-turn', label: 'An interview that changes direction', hint: 'The witness resists, contradicts an assumption, exposes a bias, or forces a new decision.' },
    { id: 'attention', label: 'Reveal through attention', hint: 'What the narrator notices tells us what she feels.' },
    { id: 'delay', label: 'Delay an answer', hint: 'Hold back the thing the reader wants for one beat longer.' },
    { id: 'physical-choice', label: 'Make a physical choice carry emotion', hint: 'An action stands in for a feeling no one names.' },
  ]
  const GUT_CHIPS = ['tension', 'funny', 'hot', 'dread', 'voice', 'character', 'gut-punch']
  const DEVICES = ['understatement', 'withholding', 'comic undercut', 'sentence-length cut', 'one-line paragraph',
    'specific nouns', 'delayed reveal', 'physical tell', 'callback', 'list', 'repetition', 'juxtaposition',
    'dialogue without tags', 'subtext', 'time compression', 'free indirect style', 'sensory anchor', 'white space']
  const FORMATS = [
    { id: 'own', label: 'Revise my own passage', desc: 'Use the move on a paragraph or exchange from your manuscript.' },
    { id: 'voice', label: 'Voice transfer', desc: 'Get the same effect in your character’s voice, in a scene you set up. Borrow the craft, not the prose.' },
    { id: 'imitation', label: 'Sentence imitation', desc: 'Copy the grammatical and rhythmic shape of 2–3 sentences — not the imagery or wording.' },
    { id: 'contrast', label: 'Contrast', desc: 'Write the beat once with the move and once without it. Compare what changes.' },
    { id: 'skeleton', label: 'Skeleton transfer', desc: 'List the moves (familiar place → signs of change → memory → contradiction), then rebuild them with your people.' },
  ]
  const CONTRASTS = {
    move: { label: 'With and without the move', a: 'With the move', b: 'Without it' },
    explanation: { label: 'Explanation', a: 'Lean version', b: 'Expansive version' },
    interiority: { label: 'Interiority', a: 'Anna admits it', b: 'Her attention and behavior reveal it' },
    action: { label: 'Action', a: 'Clear causal sequence', b: 'Compressed, orientation kept' },
    investigation: { label: 'Investigation', a: 'The clue, as written', b: 'Same clue, the witness forces another route' },
  }

  // ── State ───────────────────────────────────────────────────
  let _view = 'home'          // home | reader | paste | study | transfer
  let _tab = 'shelf'          // shelf | studies
  let _study = null
  let _savedRev = 0
  let _saveTimer = null
  let _inflight = null
  let _saveError = ''
  let _noBackup = false
  let _retryTimer = null
  let _revealNotes = false
  let _completing = false
  let _saver = args => window.quill.styleStudySave(args)
  let _confirm = args => window.quill.styleStudyConfirmLeave(args)

  function inner() { return document.getElementById('stylelab-inner') }
  function esc(s) { return escapeHtml(String(s == null ? '' : s)) }
  function h(tag, props, ...kids) {
    const el = document.createElement(tag)
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue
      if (k === 'class') el.className = v
      else if (k === 'text') el.textContent = v
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v)
      else if (k === 'value') el.value = v
      else el.setAttribute(k, v === true ? '' : v)
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)))
    return el
  }
  function words(t) { return S.wordCount(t) }
  function clone(o) { return JSON.parse(JSON.stringify(o)) }

  // ── Saving ──────────────────────────────────────────────────

  function writeDraft() {
    try {
      localStorage.setItem(DRAFT_KEY(_study.id), JSON.stringify({ rev: _study.rev, savedAt: new Date().toISOString(), study: _study }))
      _noBackup = false
    } catch { _noBackup = true }
  }
  function clearDraft(id) { try { localStorage.removeItem(DRAFT_KEY(id)) } catch {} }
  function readDraft(id) { try { return JSON.parse(localStorage.getItem(DRAFT_KEY(id)) || 'null') } catch { return null } }

  function markDirty({ rerenderPreview = true } = {}) {
    if (!_study) return
    _study.rev = (_study.rev || 0) + 1
    writeDraft()
    clearTimeout(_saveTimer)
    _saveTimer = setTimeout(() => { _saveTimer = null; saveNow() }, 600)
    updateBadge()
    updateStepDots()
    if (rerenderPreview) updateSendPreview()
  }

  function saveNow() {
    if (!_study) return Promise.resolve(true)
    clearTimeout(_saveTimer); _saveTimer = null
    const run = async () => {
      const study = _study
      if (!study || study.rev === _savedRev) return true
      const snapshot = clone(study)
      const rev = snapshot.rev
      // Completion is part of the same write as the revision that earned it.
      const newlyComplete = !snapshot.completedAt && S.isComplete(snapshot)
      if (newlyComplete) snapshot.completedAt = new Date().toISOString()
      let res
      try { res = await _saver({ study: snapshot }) } catch (err) { res = { ok: false, error: err.message || String(err) } }
      if (_study !== study) return !!(res && res.ok)
      if (res && res.ok) {
        _savedRev = Math.max(_savedRev, rev)
        _saveError = ''
        if (newlyComplete && !study.completedAt) study.completedAt = snapshot.completedAt
        if (S.canClearDraft(rev, study.rev)) clearDraft(study.id)
        if (newlyComplete) recordCompletion(study)
      } else {
        _saveError = (res && res.error) || 'The save failed.'
        clearTimeout(_retryTimer)
        _retryTimer = setTimeout(() => saveNow(), 4000)
      }
      updateBadge()
      return !!(res && res.ok)
    }
    _inflight = (_inflight || Promise.resolve()).then(run, run)
    return _inflight
  }

  function hasUnsaved() { return !!_study && (_study.rev !== _savedRev || !!_saveTimer) }

  function updateBadge() {
    const el = document.getElementById('ss-save-badge')
    if (!el || !_study) return
    let text = 'Saved', cls = 'ok'
    if (_saveError) { text = _noBackup ? 'Unsaved — no local backup' : 'Unsaved — retrying'; cls = 'bad' }
    else if (hasUnsaved()) { text = 'Saving…'; cls = '' }
    el.textContent = text
    el.className = 'ss-save-badge ' + cls
  }

  // Resolves true once it is safe to leave the study.
  async function confirmLeave() {
    if (!_study) return true
    for (;;) {
      await saveNow()
      if (!hasUnsaved()) return true
      const answer = await _confirm({ detail: _saveError || 'The save failed.', backup: !_noBackup })
      if (answer === 'leave') return true
      if (answer === 'stay') return false
    }
  }

  // Used by App.flushPendingWork, which also runs from background work (cloud backup), so it
  // only saves and never asks. Leaving asks through App.showView's guard; closing the window
  // asks through confirmClose.
  async function flushPending() {
    if (_study) await saveNow()
  }
  async function confirmClose() {
    if (!_study || !hasUnsaved()) return true
    return confirmLeave()
  }

  async function leaveStudy(next) {
    if (!(await confirmLeave())) return
    clearTimeout(_retryTimer)
    _study = null
    _savedRev = 0
    _saveError = ''
    next()
  }

  // ── Completion ──────────────────────────────────────────────

  async function recordCompletion(study) {
    if (_completing) return
    _completing = true
    try {
      await window.quill.saveStyleLabRep({
        drill: 'Style Study',
        prompt: `${S.studyTitle(study)}\n\nEffect: ${study.effect.text || '—'}`,
        userText: study.revision.text,
        feedback: '',
        studyId: study.id,
        date: study.completedAt,
      }).catch(() => {})
      StyleLab.recordStudyRep?.(study.id, study.completedAt)
    } finally { _completing = false }
  }

  // Heals completions whose rep file or count never landed (a crash between steps).
  async function reconcile() {
    try {
      const [studies, repIds] = await Promise.all([window.quill.styleStudyList(), window.quill.styleStudyRepIds()])
      const have = new Set(repIds || [])
      for (const s of studies || []) {
        if (!s.completedAt) continue
        if (!have.has(s.id)) {
          const full = await window.quill.styleStudyGet({ id: s.id })
          if (full) await window.quill.saveStyleLabRep({
            drill: 'Style Study', prompt: `${S.studyTitle(full)}\n\nEffect: ${full.effect.text || '—'}`,
            userText: full.revision.text, feedback: '', studyId: full.id, date: full.completedAt,
          }).catch(() => {})
        }
        StyleLab.recordStudyRep?.(s.id, s.completedAt)
      }
    } catch {}
  }

  // ── Entry points ────────────────────────────────────────────

  async function open() {
    _view = 'home'
    await window.quill.ensureStyleLab?.().catch(() => {})
    renderHome()
    reconcile()
  }

  async function openStudyFromAnywhere(id) {
    if (typeof App !== 'undefined' && App.openFolder) await App.openFolder('Style Lab', 'stylelab')
    await openStudy(id)
  }

  // ── Home: Bookshelf + Studies ───────────────────────────────

  async function renderHome() {
    _view = 'home'
    const root = inner()
    if (!root) return
    root.innerHTML = ''
    const tabs = h('div', { class: 'seg ss-tabs' },
      h('button', { class: 'ss-tab' + (_tab === 'shelf' ? ' active' : ''), 'data-tab': 'shelf', onclick: () => { _tab = 'shelf'; renderHome() } }, 'Bookshelf'),
      h('button', { class: 'ss-tab' + (_tab === 'studies' ? ' active' : ''), 'data-tab': 'studies', onclick: () => { _tab = 'studies'; renderHome() } }, 'Studies'),
    )
    root.append(
      h('button', { class: 'btn ghost sm page-back', id: 'ss-back-lab', onclick: () => StyleLab.renderLanding() }, '‹ Style Lab'),
      h('div', { class: 'page-head' },
        h('div', { class: 'kicker' }, 'Style Study'),
        h('div', { class: 'page-title it sl-prompt' }, 'Read closely. Notice first. Then try it yourself.'),
        h('div', { class: 'page-sub sl-prompt-sub' }, 'Pick a passage from a book you admire, say what it does, and practice that effect in your own prose. The AI is optional at every step.')),
      tabs,
    )
    const body = h('div', { class: 'ss-home-body' })
    root.append(body)
    if (_tab === 'shelf') await renderShelf(body)
    else await renderStudiesList(body)
  }

  async function renderShelf(body) {
    const [books, later] = await Promise.all([
      window.quill.styleStudyListBooks().catch(() => []),
      window.quill.styleStudyListLater().catch(() => []),
    ])
    const status = h('div', { class: 'ss-status', id: 'ss-import-status' })
    body.append(h('div', { class: 'ss-row' },
      h('button', { class: 'btn primary', id: 'ss-import', onclick: () => importBook(status) }, 'Import EPUB…'),
      h('button', { class: 'btn', id: 'ss-paste', onclick: renderPaste }, 'Paste a passage instead'),
      status,
    ))
    if (later.length) {
      body.append(h('div', { class: 'section-label' }, 'Highlights'))
      const list = h('div', { class: 'ss-later-list' })
      for (const item of later) {
        const phrase = item.phrase || item.text || ''
        list.append(h('div', { class: 'card ss-later', 'data-later': item.id, onclick: e => {
          if (e.target.closest('.ss-x')) return
          startStudy(laterToSeed(item))
        } },
          h('div', { class: 'ss-later-meta' }, `${item.bookTitle || 'Book'} · ${item.chapterTitle || ''}`),
          h('div', { class: 'ss-later-text', text: phrase.slice(0, 260) + (phrase.length > 260 ? '…' : '') }),
          item.note ? h('div', { class: 'ss-later-note', text: item.note }) : null,
          h('button', { class: 'btn ghost sm icon ss-x', title: 'Remove highlight', onclick: async () => { await window.quill.styleStudyDeleteLater({ id: item.id }); renderHome() } }, '×'),
        ))
      }
      body.append(list)
    }
    body.append(h('div', { class: 'section-label' }, 'Your books'))
    if (!books.length) {
      body.append(h('div', { class: 'hint' }, 'No books yet. Import a DRM-free EPUB; only its text is kept, inside your Style Lab folder.'))
      return
    }
    const grid = h('div', { class: 'card-grid ss-book-grid' })
    for (const b of books) {
      const pos = StyleReader.savedPosition(b.id)
      const outdated = (b.parserVersion || 1) < 2
      const status = h('div', { class: 'card-meta ss-book-meta faint' })
      grid.append(h('div', { class: 'card ss-book', 'data-book': b.id, onclick: e => { if (!e.target.closest('.ss-x, .ss-book-update')) StyleReader.open(b.id) } },
        h('div', { class: 'card-title ss-book-title', text: b.title }),
        h('div', { class: 'card-meta ss-book-meta', text: [b.author, `${b.chapters} chapters`, `${Math.round((b.words || 0) / 1000)}k words`].filter(Boolean).join(' · ') }),
        h('div', { class: 'card-meta ss-book-meta ss-continue', text: pos ? 'Continue reading ›' : `Imported ${String(b.importedAt).slice(0, 10)}` }),
        outdated ? h('button', { class: 'btn sm ss-book-update', title: 'Re-read this book with the current importer: italics from styles, and paragraph repair for PDF conversions. The old text is kept so you can restore it.', onclick: async () => {
          status.textContent = 'Updating…'
          const r = await window.quill.styleStudyUpdateBook({ id: b.id })
          if (r && r.ok) renderHome()
          else status.textContent = (r && !r.canceled && r.error) || ''
        } }, 'Update text') : null,
        status,
        h('button', { class: 'btn ghost sm icon ss-x', title: 'Remove from shelf (studies are kept)', onclick: async () => {
          if (!confirm(`Remove “${b.title}” from the shelf? Your studies from it are kept.`)) return
          await window.quill.styleStudyDeleteBook({ id: b.id }); renderHome()
        } }, '×'),
      ))
    }
    body.append(grid)
  }

  async function importBook(status) {
    status.textContent = 'Reading…'
    const res = await window.quill.styleStudyImportEpub({}).catch(err => ({ ok: false, error: err.message }))
    if (res.canceled) { status.textContent = ''; return }
    if (!res.ok) { status.textContent = res.error || 'Import failed.'; status.classList.add('bad'); return }
    if (res.duplicate) { status.textContent = `Already on your shelf: ${res.title}`; setTimeout(() => StyleReader.open(res.id), 600); return }
    renderHome()
  }

  async function renderStudiesList(body) {
    const studies = await window.quill.styleStudyList().catch(() => [])
    const onDisk = new Set(studies.map(s => s.id))
    // Drafts for studies that never reached disk (a crash before the first save).
    const orphans = []
    try {
      for (let k = 0; k < localStorage.length; k++) {
        const key = localStorage.key(k)
        const m = /^quill_study_draft_(st_[A-Za-z0-9]+)$/.exec(key || '')
        if (m && !onDisk.has(m[1])) { const d = readDraft(m[1]); if (d && d.study) orphans.push(d) }
      }
    } catch {}
    if (!studies.length && !orphans.length) {
      body.append(h('div', { class: 'hint' }, 'No studies yet. Open a book on the Bookshelf, select a passage, and choose “Study this”.'))
      return
    }
    for (const d of orphans) {
      body.append(h('div', { class: 'card static ss-study-row recovered' },
        h('div', { class: 'ss-study-title', text: `Unsaved study: ${S.studyTitle(d.study)}` }),
        h('div', { class: 'ss-study-meta', text: `Recovered from ${new Date(d.savedAt).toLocaleString()}` }),
        h('div', { class: 'ss-row' },
          h('button', { class: 'btn sm', onclick: () => openLoaded(d.study, { fromDraft: true }) }, 'Restore'),
          h('button', { class: 'btn sm', onclick: () => { clearDraft(d.study.id); renderHome() } }, 'Discard')),
      ))
    }
    for (const s of studies) {
      const effect = s.effect && (s.effect.move || s.effect.text || '')
      body.append(h('div', { class: 'card static ss-study-row', 'data-study': s.id },
        h('div', { class: 'ss-study-title', text: (s.completedAt ? '✓ ' : '') + s.title }),
        h('div', { class: 'ss-study-meta', text: [effect && `Studying: ${effect}`, s.transfers ? `${s.transfers} transfer${s.transfers === 1 ? '' : 's'}` : '', String(s.updatedAt).slice(0, 10)].filter(Boolean).join(' · ') }),
        h('div', { class: 'ss-row' },
          h('button', { class: 'btn sm ss-open', onclick: () => openStudy(s.id) }, 'Open'),
          effect ? h('button', { class: 'btn sm ss-transfer', onclick: () => openTransfer(s.id) }, 'Try this move in a new situation') : null,
          h('button', { class: 'btn sm', onclick: async () => {
            const r = await window.quill.styleStudyExport({ id: s.id })
            if (r && r.ok) App.openFile(r.path)
          } }, 'Export as Markdown'),
          h('button', { class: 'btn sm ss-del', onclick: async () => {
            if (!confirm('Delete this study? Its Recent reps entry stays.')) return
            await window.quill.styleStudyDelete({ id: s.id }); clearDraft(s.id); renderHome()
          } }, 'Delete')),
      ))
    }
  }

  // ── Paste ───────────────────────────────────────────────────

  async function renderPaste() {
    _view = 'paste'
    const root = inner()
    root.innerHTML = ''
    const saved = await window.quill.getStyleLabPassages().catch(() => [])
    const ta = h('textarea', { class: 'field sl-writer', id: 'ss-paste-text', placeholder: 'Paste a passage you want to study.', spellcheck: 'true' })
    const author = h('input', { class: 'field', id: 'ss-paste-author', placeholder: 'Author' })
    const source = h('input', { class: 'field', id: 'ss-paste-source', placeholder: 'Source' })
    const start = (text, a, src) => {
      const paragraphs = String(text).split(/\n\s*\n/).map(t => ({ t: t.replace(/\s*\n\s*/g, ' ').trim() })).filter(p => p.t)
      if (!paragraphs.length) return
      startStudy({ source: { kind: 'paste', author: a, bookTitle: src }, paragraphs })
    }
    root.append(
      h('button', { class: 'btn ghost sm page-back', onclick: renderHome }, '‹ Style Study'),
      h('div', { class: 'kicker' }, 'Style Study · Paste'),
      ta,
      h('div', { class: 'ss-row' }, author, source,
        h('button', { class: 'btn primary', id: 'ss-paste-go', onclick: () => {
          if (!ta.value.trim()) return
          window.quill.saveStyleLabPassage({ author: author.value.trim() || 'Unknown', source: source.value.trim(), text: ta.value.trim() }).catch(() => {})
          start(ta.value, author.value.trim(), source.value.trim())
        } }, 'Study this')),
    )
    const library = StyleLab.libraryPassages || []
    for (const [title, list] of [['Saved passages', saved], ['From the library', library]]) {
      if (!list.length) continue
      const cards = h('div', { class: 'card-list' })
      for (const p of list) {
        cards.append(h('button', { class: 'card sl-passage-card', onclick: () => start(p.text, p.author, p.source) },
          h('div', { class: 'sl-passage-head' }, h('div', { class: 'card-title', text: [p.author, p.source].filter(Boolean).join(' · ') })),
          h('div', { class: 'sl-passage-text', text: p.text })))
      }
      root.append(h('section', { class: 'section' }, h('div', { class: 'section-label' }, title), cards))
    }
  }

  // ── Study lifecycle ─────────────────────────────────────────

  function removeFloat() { document.getElementById('ss-float')?.remove() }

  function excerptFrom(role, paragraphs, src, anchor = null) {
    const { t, i } = S.joinParagraphs(paragraphs)
    return { id: S.newId('ex'), role, t, i, chapterIndex: src.chapterIndex ?? null, paraStart: null, paraEnd: null, anchor: anchor || null }
  }

  // Highlights saved on the Bookshelf carry snapshots, so a study can start without the book.
  function laterToSeed(item) {
    return {
      source: { kind: item.bookId ? 'book' : 'paste', bookId: item.bookId, bookTitle: item.bookTitle, author: item.author, chapterIndex: item.chapterIndex, chapterTitle: item.chapterTitle },
      paragraphs: item.paragraphs && item.paragraphs.length ? item.paragraphs : [{ t: item.text }],
      phraseText: item.phrase || '',
      note: item.note || '',
      highlightId: item.id,
    }
  }

  // seed: { source, paragraphs, anchor?, phrase?: { start, end } | phraseText?, note?, highlightId? }
  async function startStudy(seed) {
    removeFloat()
    if (_study && hasUnsaved() && !(await confirmLeave())) return
    const now = new Date().toISOString()
    const focal = excerptFrom('focal', seed.paragraphs, seed.source, seed.anchor)
    let phrase = seed.phrase || null
    if (!phrase && seed.phraseText) {
      const r = S.findQuote(focal.t, seed.phraseText)
      if (r && r.end - r.start < focal.t.length) phrase = r
    }
    // The phrase you selected is anchored for you, but it is not an observation until you
    // write one: `auto` notes start empty and don't unlock the AI comparison.
    const notes = phrase ? [{ id: S.newId('n'), excerptId: focal.id, ...S.makeAnchor(focal.t, phrase.start, phrase.end), text: '', device: '', auto: true }] : []
    _study = S.cleanStudy({
      id: S.newId('st'), rev: 0, createdAt: now, updatedAt: now,
      source: seed.source, excerpts: [focal], notes, reaction: { text: seed.note || '', chips: [] },
    })
    _savedRev = -1          // nothing on disk yet
    _saveError = ''
    _revealNotes = false
    markDirty()
    await saveNow()
    if (seed.highlightId) window.quill.styleStudyDeleteLater({ id: seed.highlightId }).catch(() => {})
    _view = 'study'
    renderStudy()
  }

  async function openStudy(id) {
    removeFloat()
    if (_study && _study.id !== id && !(await confirmLeave())) return
    const disk = await window.quill.styleStudyGet({ id }).catch(() => null)
    const draft = readDraft(id)
    if (!disk && !draft) { alert('That study could not be found.'); return renderHome() }
    openLoaded(disk || draft.study, { fromDraft: !disk, draft: disk && S.draftIsNewer(draft, disk) ? draft : null })
  }

  function openLoaded(study, { fromDraft = false, draft = null } = {}) {
    _study = S.cleanStudy(study) || study
    _savedRev = fromDraft ? -1 : _study.rev
    _saveError = ''
    _revealNotes = false
    _view = 'study'
    renderStudy()
    if (fromDraft) { markDirty(); saveNow() }
    if (draft) showRestoreBanner(draft)
  }

  function showRestoreBanner(draft) {
    const root = inner()
    const banner = h('div', { class: 'ss-restore', id: 'ss-restore' },
      h('span', {}, `Restore unsaved changes from ${new Date(draft.savedAt).toLocaleString()}?`),
      h('button', { class: 'btn primary', id: 'ss-restore-yes', onclick: () => {
        const rev = _study.rev
        _study = S.cleanStudy(draft.study) || draft.study
        _study.rev = Math.max(rev, draft.rev)
        renderStudy(); markDirty(); saveNow()
      } }, 'Restore'),
      h('button', { class: 'btn sm', onclick: () => { clearDraft(_study.id); banner.remove() } }, 'Discard'))
    root.prepend(banner)
  }

  async function addLinkedExcerpt(studyId, seed) {
    if (!_study || _study.id !== studyId) await openStudy(studyId)
    if (!_study) return
    _study.excerpts.push(excerptFrom('linked', seed.paragraphs, seed.source, seed.anchor))
    markDirty()
    _view = 'study'
    renderStudy()
  }

  function focalAnchor(st) {
    const focal = st.excerpts.find(e => e.role === 'focal')
    if (!focal) return null
    return focal.anchor || { chapterIndex: focal.chapterIndex ?? st.source.chapterIndex, chapterTitle: st.source.chapterTitle, quote: focal.t, prefix: '', suffix: '' }
  }

  // Context is found by locating the focal passage's text in the book as it is now — never by
  // old paragraph numbers — and read from the same view (repaired or not) the reader shows.
  async function expandContext(dir) {
    const st = _study
    const book = await window.quill.styleStudyGetBook({ id: st.source.bookId }).catch(() => null)
    if (!book) { alert('The book is no longer on your shelf, so there is no more context to add.'); return }
    const loc = S.locatePassage(book, focalAnchor(st))
    if (loc.status !== 'ok') { showLocate(loc.status); return }
    const view = S.chapterView(book.chapters[loc.chapterIndex].paragraphs, StyleReader.effectiveRepair(book))
    const ds = S.rawToDisplay(view, loc.start), de = S.rawToDisplay(view, loc.end)
    const a = S.displayPoint(view, ds).para, b = S.displayPoint(view, Math.max(ds, de - 1)).para
    const role = dir < 0 ? 'before' : 'after'
    const existing = st.excerpts.find(e => e.role === role)
    const have = existing ? existing.t.split('\n\n').length : 0
    const [s, e] = dir < 0 ? [Math.max(0, a - have - 2), a - 1] : [b + 1, Math.min(view.paras.length - 1, b + have + 2)]
    if (s > e) return
    const paras = view.paras.slice(s, e + 1)
    const ch = book.chapters[loc.chapterIndex]
    const anchor = S.rawAnchor(ch.paragraphs, loc.chapterIndex, ch.title, S.displayToRaw(view, paras[0].start), S.displayToRaw(view, paras[paras.length - 1].start + paras[paras.length - 1].t.length))
    const fresh = excerptFrom(role, paras, st.source, anchor)
    if (existing) {
      // Context grows outward; notes on it keep their place because their text shifts with it.
      const shift = dir < 0 ? fresh.t.length - existing.t.length : 0
      fresh.id = existing.id
      for (const n of st.notes) if (n.excerptId === existing.id) { n.start += shift; n.end += shift }
      Object.assign(existing, fresh)
    } else {
      dir < 0 ? st.excerpts.unshift(fresh) : st.excerpts.push(fresh)
    }
    markDirty()
    renderSource()
  }

  function showLocate(status) {
    const el = document.getElementById('ss-locate')
    if (!el) return
    el.hidden = !status || status === 'ok'
    el.textContent = status === 'gone' ? 'Book removed from shelf' : 'Passage location needs updating'
    el.title = status === 'gone'
      ? 'The study keeps its own copy of the passage. Context and “Back to the book” need the book on your shelf.'
      : 'The book’s current text has no single clear match for this passage, so it is not attached anywhere. Your study keeps its own copy.'
  }

  async function checkBookLocation() {
    const st = _study
    if (!st || !st.source.bookId) return
    const book = await window.quill.styleStudyGetBook({ id: st.source.bookId }).catch(() => null)
    if (_study !== st) return
    if (!book) return showLocate('gone')
    showLocate(S.locatePassage(book, focalAnchor(st)).status)
  }

  // ── Study page: source pane + stepped work pane ─────────────

  const STEPS = [['notice', 'Notice'], ['effect', 'Move & effect'], ['attempt', 'Practice'], ['revise', 'Compare & revise']]
  let _step = 'notice'
  let _sourceTab = 'book'
  let _lastFocus = {}
  let _stepScroll = {}

  function uiKey(id) { return `quill_study_ui_${id}` }
  function loadUi() { try { return JSON.parse(localStorage.getItem(uiKey(_study.id)) || '{}') || {} } catch { return {} } }
  function saveUi() { try { localStorage.setItem(uiKey(_study.id), JSON.stringify({ step: _step, scroll: _stepScroll, source: _sourceTab })) } catch {} }

  function section(title, sub) {
    return h('div', { class: 'ss-section' }, h('div', { class: 'section-label ss-section-title' }, title), sub ? h('div', { class: 'ss-section-sub' }, sub) : null)
  }

  function field(tag, props, getter, setter) {
    const el = h(tag, props)
    el.value = getter() || ''
    el.addEventListener('input', () => { setter(el.value); markDirty() })
    return el
  }

  function renderStudy() {
    const root = inner()
    if (!root || !_study) return
    removeFloat()
    const st = _study
    const src = st.source
    root.innerHTML = ''
    const ui = loadUi()
    _step = STEPS.some(([k]) => k === ui.step) || ui.step === 'ai' ? ui.step : 'notice'
    _stepScroll = ui.scroll || {}
    _sourceTab = ui.source || 'book'
    _lastFocus = {}
    root.append(h('div', { class: 'ss-study-head' },
      src.bookId ? h('button', { class: 'btn sm', id: 'ss-back-book', onclick: () => leaveStudy(() => StyleReader.open(src.bookId)) }, `‹ Back to ${src.bookTitle || 'the book'}`) : null,
      h('button', { class: 'btn sm', id: 'ss-study-back', onclick: () => leaveStudy(() => { _tab = 'studies'; renderHome() }) }, '‹ Studies'),
      h('div', { class: 'ss-study-kicker', text: [[src.author, src.bookTitle].filter(Boolean).join(', '), src.chapterTitle].filter(Boolean).join(' · ') || 'Pasted passage' }),
      h('span', { class: 'ss-locate', id: 'ss-locate', hidden: true }),
      h('button', { class: 'btn sm ss-layout-btn', id: 'ss-layout-btn', title: 'Switch between the passage beside your writing and the passage above it', onclick: cycleLayout }, 'Layout'),
      h('button', { class: 'btn sm', id: 'ss-export', onclick: async () => {
        await saveNow()
        const r = await window.quill.styleStudyExport({ id: st.id })
        const note = document.getElementById('ss-export-note')
        if (note) note.textContent = r && r.ok ? `Exported to ${r.path}` : (r && r.error) || 'Export failed.'
      } }, 'Export'),
      h('span', { class: 'ss-status', id: 'ss-export-note' }),
      h('span', { id: 'ss-save-badge', class: 'ss-save-badge' }, 'Saved')))

    root.append(h('div', { class: 'ss-target', id: 'ss-target' }))
    const source = h('div', { class: 'ss-source', id: 'ss-source' })
    const work = h('div', { class: 'ss-work', id: 'ss-work' })
    const study = h('div', { class: 'ss-study', id: 'ss-study' }, source, work)
    root.append(study)
    renderSource()

    const stepper = h('div', { class: 'ss-stepper', id: 'ss-stepper' },
      STEPS.map(([k, label], n) => h('button', { class: 'chip ss-step-btn', 'data-step': k, onclick: () => showStep(k) },
        h('span', { class: 'ss-step-dot' }), `${n + 1} ${label}`)),
      h('button', { class: 'chip ss-step-btn ss-step-ai', 'data-step': 'ai', onclick: () => showStep('ai') }, 'AI (optional)'),
      h('span', { class: 'ss-step-count', id: 'ss-step-count' }))
    work.append(stepper)
    const panels = { notice: buildNotice(), effect: buildEffect(), attempt: buildAttemptStep(), revise: buildRevise(), ai: renderAI() }
    for (const [k, panel] of Object.entries(panels)) {
      const wrap = h('div', { class: 'ss-step', 'data-panel': k, hidden: true }, panel)
      const idx = STEPS.findIndex(([s]) => s === k)
      if (idx >= 0 && idx < STEPS.length - 1) wrap.append(h('div', { class: 'ss-step-nav' }, h('button', { class: 'btn', onclick: () => showStep(STEPS[idx + 1][0]) }, `Next: ${STEPS[idx + 1][1]} ›`)))
      work.append(wrap)
    }
    // Drawn now that the panel is in the page, so the format cards exist before any click.
    renderAttemptPanel()
    work.addEventListener('focusin', e => { if (e.target.id && e.target.matches('textarea, input, select')) _lastFocus[_step] = e.target.id })
    work.addEventListener('scroll', () => { _stepScroll[_step] = work.scrollTop })
    showStep(_step, { focus: false })
    layoutStudy()
    updateBadge()
    updateSendPreview()
    updateStepDots()
    checkBookLocation()
  }

  // 'auto' stacks the panes when side by side would leave each under ~560px (about 60
  // characters a line); 'side' and 'stacked' are the writer's override, kept across studies.
  const LAYOUT_KEY = 'quill_study_layout'
  const STACK_BELOW = 1150
  function layoutPref() { try { return localStorage.getItem(LAYOUT_KEY) || 'auto' } catch { return 'auto' } }
  function isStacked(el) {
    const pref = layoutPref()
    return pref === 'stacked' || (pref === 'auto' && el.clientWidth < STACK_BELOW)
  }
  function layoutStudy() {
    const el = document.getElementById('ss-study')
    if (!el) return
    const view = document.getElementById('view-stylelab')
    if (view) view.scrollTop = 0
    el.classList.toggle('stacked', isStacked(el))
    el.style.height = Math.max(420, window.innerHeight - el.getBoundingClientRect().top - 12) + 'px'
    fitSource()
    const btn = document.getElementById('ss-layout-btn')
    if (btn) btn.textContent = el.classList.contains('stacked') ? 'Layout: passage above' : 'Layout: side by side'
  }
  // Stacked, the passage panel is as tall as the passage, up to 40% of the window, unless
  // the writer has dragged it to a size of their own.
  function fitSource() {
    const el = document.getElementById('ss-study'), pane = document.getElementById('ss-source')
    if (!el || !pane) return
    if (!el.classList.contains('stacked')) { pane.style.height = ''; return }
    if (pane.dataset.userSized) return
    pane.style.height = ''
    const fit = Math.min(pane.scrollHeight + 2, Math.round(window.innerHeight * 0.4))
    pane.style.height = fit + 'px'
    pane.dataset.fitHeight = String(fit)
  }
  function cycleLayout() {
    const el = document.getElementById('ss-study')
    // Switch to whichever layout isn't showing now; that choice sticks.
    try { localStorage.setItem(LAYOUT_KEY, el && el.classList.contains('stacked') ? 'side' : 'stacked') } catch {}
    layoutStudy()
  }
  window.addEventListener('resize', () => { if (_view === 'study') layoutStudy() })

  // Steps are built once and hidden, so text, caret and scroll survive switching.
  function showStep(step, { focus = true } = {}) {
    const work = document.getElementById('ss-work')
    if (!work) return
    _stepScroll[_step] = work.scrollTop
    _step = step
    work.querySelectorAll('.ss-step').forEach(p => { p.hidden = p.dataset.panel !== step })
    work.querySelectorAll('.ss-step-btn').forEach(b => b.classList.toggle('active', b.dataset.step === step))
    const n = STEPS.findIndex(([k]) => k === step)
    const count = document.getElementById('ss-step-count')
    if (count) count.textContent = n >= 0 ? `Step ${n + 1} of ${STEPS.length}` : 'Optional'
    work.scrollTop = _stepScroll[step] || 0
    if (step === 'attempt' && _study.format === 'own' && _study.attempt.own) setSourceTab('mine')
    if (focus) {
      const target = document.getElementById(_lastFocus[step] || '') || work.querySelector(`.ss-step[data-panel="${step}"] .ss-write, .ss-step[data-panel="${step}"] textarea`)
      if (target) { target.focus({ preventScroll: true }); target.scrollIntoView({ block: 'nearest' }) }
    }
    saveUi()
  }

  // The craft target, kept in view: the move you named, else the effect.
  function updateTarget() {
    const el = document.getElementById('ss-target')
    if (!el || !_study) return
    const move = _study.effect.move.trim(), effect = _study.effect.text.trim()
    el.replaceChildren(h('span', { class: 'ss-target-lbl' }, 'Studying: '),
      move || effect ? h('span', { text: move || effect }) : h('span', { class: 'ss-target-empty' }, 'name the move in step 2'))
  }

  function updateStepDots() {
    const st = _study
    if (!st) return
    updateTarget()
    const done = {
      notice: !!(st.reaction.text.trim() || st.reaction.chips.length || S.hasObservation(st)),
      effect: !!(st.effect.move.trim() || st.effect.text.trim()),
      attempt: !!attemptText(st).trim(),
      revise: !!st.revision.text.trim(),
    }
    document.querySelectorAll('.ss-step-btn').forEach(b => b.classList.toggle('done', !!done[b.dataset.step]))
  }

  // ── Source pane ─────────────────────────────────────────────

  function setSourceTab(tab) { _sourceTab = tab; saveUi(); renderSource() }

  function renderSource() {
    const pane = document.getElementById('ss-source')
    if (!pane || !_study) return
    const st = _study
    const keepScroll = pane.scrollTop
    const own = st.attempt.own
    const first = attemptText(st)
    if (_sourceTab === 'mine' && !own) _sourceTab = 'book'
    if (_sourceTab === 'first' && !first.trim()) _sourceTab = 'book'
    const tabs = h('div', { class: 'ss-source-tabs' },
      h('button', { class: 'chip ss-source-tab' + (_sourceTab === 'book' ? ' active' : ''), 'data-src': 'book', onclick: () => setSourceTab('book') }, st.source.kind === 'book' ? 'Book passage' : 'Passage'),
      own ? h('button', { class: 'chip ss-source-tab' + (_sourceTab === 'mine' ? ' active' : ''), 'data-src': 'mine', onclick: () => setSourceTab('mine') }, 'My passage') : null,
      first.trim() ? h('button', { class: 'chip ss-source-tab' + (_sourceTab === 'first' ? ' active' : ''), 'data-src': 'first', onclick: () => setSourceTab('first') }, 'My first attempt') : null,
      h('button', { class: 'ss-source-collapse', id: 'ss-source-collapse', title: 'Collapse the passage', onclick: () => pane.classList.toggle('collapsed') }, '▾'))
    const body = h('div', { class: 'ss-source-body' })
    if (_sourceTab === 'mine') {
      body.append(h('div', { class: 'ss-lbl', text: own.sceneTitle }), h('div', { class: 'ss-excerpt-text', id: 'ss-own-original', text: own.original }))
    } else if (_sourceTab === 'first') {
      body.append(h('div', { class: 'ss-excerpt-text', id: 'ss-first-copy', text: first }))
    } else {
      for (const ex of st.excerpts) body.append(renderExcerpt(ex))
      if (st.source.bookId) {
        body.append(h('div', { class: 'ss-row ss-ctx' },
          h('button', { class: 'btn sm', id: 'ss-ctx-before', onclick: () => expandContext(-1) }, '+ context before'),
          h('button', { class: 'btn sm', id: 'ss-ctx-after', onclick: () => expandContext(1) }, '+ context after'),
          h('button', { class: 'btn sm', id: 'ss-add-excerpt', onclick: async () => {
            if (!(await confirmLeave())) return
            const book = await window.quill.styleStudyGetBook({ id: st.source.bookId }).catch(() => null)
            const loc = book ? S.locatePassage(book, focalAnchor(st)) : { status: 'gone' }
            StyleReader.open(st.source.bookId, { chapterIndex: loc.status === 'ok' ? loc.chapterIndex : null, pickFor: st.id })
          } }, '+ related passage')))
      }
      body.append(h('div', { class: 'hint ss-hint' }, 'Select a phrase to add a margin note.'))
    }
    pane.replaceChildren(tabs, body)
    pane.scrollTop = keepScroll
    if (!pane.dataset.watched) {
      pane.dataset.watched = '1'
      // A drag on the resize handle leaves a height we didn't set: from then on, keep it.
      pane.addEventListener('mouseup', () => { if (pane.style.height && pane.style.height !== pane.dataset.fitHeight + 'px') pane.dataset.userSized = '1' })
    }
    fitSource()
  }

  // Excerpt text with italics, note highlights and (for imitation) chosen sentences, built
  // from offsets — text only.
  function renderExcerpt(ex) {
    const wrap = h('div', { class: 'ss-excerpt ss-role-' + ex.role, 'data-excerpt': ex.id })
    if (ex.role !== 'focal') wrap.append(h('div', { class: 'ss-excerpt-role' }, ex.role === 'linked' ? 'Linked excerpt' : ex.role === 'before' ? 'Context before' : 'Context after'))
    const body = h('div', { class: 'ss-excerpt-text', 'data-text-for': ex.id })
    const marks = new Array(ex.t.length + 1).fill(null).map(() => ({ it: false, sent: false, notes: [] }))
    for (const [s, e] of ex.i || []) for (let k = s; k < e; k++) marks[k].it = true
    for (const n of _study.notes.filter(n => n.excerptId === ex.id)) {
      const r = S.resolveAnchor(ex.t, n)
      if (r) for (let k = r.start; k < r.end; k++) marks[k].notes.push(n.id)
    }
    if (_study.format === 'imitation' && ex.role === 'focal') {
      for (const s of _study.attempt.sentences) {
        const at = ex.t.indexOf(s.source)
        if (at >= 0) for (let k = at; k < at + s.source.length; k++) marks[k].sent = true
      }
    }
    let k = 0
    while (k < ex.t.length) {
      const m = marks[k]
      let j = k + 1
      while (j < ex.t.length && marks[j].it === m.it && marks[j].sent === m.sent && marks[j].notes.join() === m.notes.join()) j++
      let node = document.createTextNode(ex.t.slice(k, j))
      if (m.it) { const em = h('em'); em.append(node); node = em }
      if (m.sent) { const sp = h('span', { class: 'ss-sent' }); sp.append(node); node = sp }
      if (m.notes.length) { const mk = h('mark', { class: 'ss-hl', 'data-notes': m.notes.join(' ') }); mk.append(node); node = mk }
      body.append(node)
      k = j
    }
    body.addEventListener('mouseup', () => setTimeout(() => offerNote(ex, body), 0))
    body.addEventListener('click', e => {
      const mk = e.target.closest('mark.ss-hl')
      if (!mk || !window.getSelection()?.isCollapsed) return
      const id = mk.dataset.notes.split(' ')[0]
      showStep('notice', { focus: false })
      const card = document.querySelector(`.ss-note[data-note="${id}"]`)
      card?.scrollIntoView({ block: 'nearest' })
      card?.querySelector('textarea')?.focus({ preventScroll: true })
    })
    wrap.append(body)
    return wrap
  }

  // Selection offsets inside a rendered excerpt equal offsets into its canonical text,
  // because the element holds exactly that text (italics and marks only wrap it).
  function selectionOffsets(container) {
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed || !sel.rangeCount) return null
    const range = sel.getRangeAt(0)
    if (!container.contains(range.startContainer) || !container.contains(range.endContainer)) return null
    const pre = document.createRange()
    pre.selectNodeContents(container)
    pre.setEnd(range.startContainer, range.startOffset)
    const start = pre.toString().length
    const end = start + range.toString().length
    return end > start ? { start, end, rect: range.getBoundingClientRect() } : null
  }

  function offerNote(ex, body) {
    removeFloat()
    const off = selectionOffsets(body)
    if (!off) return
    const bar = h('div', { class: 'ss-float', id: 'ss-float', style: `top:${window.scrollY + off.rect.bottom + 6}px;left:${Math.max(12, off.rect.left)}px;` },
      h('button', { class: 'btn primary', id: 'ss-add-note', onclick: () => {
        const a = S.makeAnchor(ex.t, off.start, off.end)
        const note = { id: S.newId('n'), excerptId: ex.id, ...a, text: '', device: '' }
        _study.notes.push(note)
        removeFloat()
        window.getSelection()?.removeAllRanges()
        markDirty()
        renderSource()
        renderMargin()
        showStep('notice', { focus: false })
        const ta = document.querySelector(`.ss-note[data-note="${note.id}"] textarea`)
        ta?.scrollIntoView({ block: 'nearest' })
        ta?.focus({ preventScroll: true })
      } }, 'Add margin note'))
    document.body.append(bar)
  }

  // ── Work pane steps ─────────────────────────────────────────

  function buildNotice() {
    const st = _study
    const chips = h('div', { class: 'chip-row ss-chips' })
    for (const c of GUT_CHIPS) {
      chips.append(h('button', { class: 'chip ss-chip' + (st.reaction.chips.includes(c) ? ' active' : ''), onclick: e => {
        const i = st.reaction.chips.indexOf(c)
        i >= 0 ? st.reaction.chips.splice(i, 1) : st.reaction.chips.push(c)
        e.currentTarget.classList.toggle('active'); markDirty()
      } }, c))
    }
    return h('div', {},
      section('Why did I flag this?', 'Your gut reaction, before any analysis.'),
      field('textarea', { class: 'field ss-ta', id: 'ss-reaction', rows: 3, placeholder: 'It made me…' }, () => st.reaction.text, v => { st.reaction.text = v }),
      chips,
      section('Margin notes', 'Select a phrase in the passage to add one. Labels are optional.'),
      h('div', { class: 'ss-margin', id: 'ss-margin' }, ...marginCards()))
  }

  function renderMargin() {
    const el = document.getElementById('ss-margin')
    if (el) el.replaceChildren(...marginCards())
    updateSendPreview()
    updateStepDots()
  }

  function marginCards() {
    const st = _study
    const out = [h('datalist', { id: 'ss-devices' }, DEVICES.map(d => h('option', { value: d })))]
    if (!st.notes.length) out.push(h('div', { class: 'hint ss-hint' }, 'No notes yet.'))
    for (const n of st.notes) {
      const ex = st.excerpts.find(e => e.id === n.excerptId)
      const found = ex && S.resolveAnchor(ex.t, n)
      out.push(h('div', { class: 'ss-note' + (found ? '' : ' orphan'), 'data-note': n.id,
        onmouseenter: () => document.querySelectorAll('.ss-hl').forEach(m => m.classList.toggle('lit', m.dataset.notes.split(' ').includes(n.id))),
        onmouseleave: () => document.querySelectorAll('.ss-hl.lit').forEach(m => m.classList.remove('lit')) },
        n.auto ? h('div', { class: 'ss-lbl' }, 'The phrase you selected') : null,
        h('div', { class: 'ss-note-quote', text: `“${n.quote.length > 160 ? n.quote.slice(0, 160) + '…' : n.quote}”` }),
        field('textarea', { class: 'field ss-ta ss-note-text', id: `ss-note-${n.id}`, rows: 2, placeholder: 'What is this doing? (your observation)' }, () => n.text, v => { n.text = v; updateSendPreview() }),
        h('div', { class: 'ss-row' },
          field('input', { class: 'field ss-device', list: 'ss-devices', placeholder: 'label (optional)' }, () => n.device, v => { n.device = v }),
          h('button', { class: 'btn ghost sm icon ss-x', title: 'Delete note', onclick: () => { st.notes = st.notes.filter(x => x !== n); markDirty(); renderSource(); renderMargin() } }, '×'))))
    }
    return out
  }

  function buildEffect() {
    const st = _study
    const effectInput = field('input', { class: 'field', id: 'ss-effect', placeholder: 'e.g. make attraction visible while Anna denies it' }, () => st.effect.text, v => { st.effect.text = v })
    const presets = h('div', { class: 'chip-row ss-chips' })
    for (const e of EFFECTS) {
      presets.append(h('button', { class: 'chip ss-chip' + (st.effect.preset === e.id ? ' active' : ''), title: e.hint, 'data-effect': e.id, onclick: () => {
        st.effect.preset = e.id
        st.effect.text = e.label + ': ' + e.hint
        effectInput.value = st.effect.text
        presets.querySelectorAll('.ss-chip').forEach(c => c.classList.toggle('active', c.dataset.effect === e.id))
        markDirty()
      } }, e.label))
    }
    return h('div', {},
      section('What did the writer do?', 'Name the move — the mechanism you could reuse, not how it feels. A sequence helps: familiar place → signs of change → memory → contradiction.'),
      field('textarea', { class: 'field ss-ta', id: 'ss-move', rows: 3, placeholder: 'e.g. anchors the setting in his history, moves from concrete detail to feeling, ends on a contradiction' }, () => st.effect.move, v => { st.effect.move = v; updateTarget() }),
      section('What does it do to the reader?', 'The effect you’ll practice. Pick a preset or write your own.'), presets, effectInput)
  }

  function buildAttemptStep() {
    const wrap = h('div', {}, section('Practice', 'Pick a format and write. The passage stays in view.'),
      h('div', { class: 'ss-formats', id: 'ss-formats' }), h('div', { class: 'ss-attempt', id: 'ss-attempt' }))
    return wrap
  }

  function renderAttemptPanel() {
    const st = _study
    const formats = document.getElementById('ss-formats'), box = document.getElementById('ss-attempt')
    if (!formats || !box) return
    formats.replaceChildren(...FORMATS.map(f => h('button', { class: 'card ss-format' + (st.format === f.id ? ' active' : ''), 'data-format': f.id, onclick: () => {
      st.format = f.id; markDirty(); renderAttemptPanel(); renderSource()
    } }, h('div', { class: 'ss-format-name' }, f.label), h('div', { class: 'ss-format-desc' }, f.desc))))
    box.replaceChildren()
    if (st.format) renderAttempt(box)
  }

  function buildRevise() {
    const st = _study
    const rev = field('textarea', { class: 'field ss-ta ss-write', id: 'ss-revision', rows: 8, placeholder: 'Second attempt.' }, () => st.revision.text, v => { st.revision.text = v })
    const q = (key, label) => [h('label', { class: 'ss-lbl' }, label),
      field('textarea', { class: 'field ss-ta', id: `ss-cmp-${key}`, rows: 2 }, () => st.compare[key], v => { st.compare[key] = v; updateSendPreview() })]
    // Older studies answered these; keep showing them if they have text.
    const legacy = ['feel', 'where'].filter(k => st.selfCheck[k].trim()).flatMap(k => [
      h('label', { class: 'ss-lbl' }, k === 'feel' ? 'What did I want the reader to feel, infer, or anticipate?' : 'Where does my text produce that effect?'),
      field('textarea', { class: 'field ss-ta', id: `ss-sc-${k}`, rows: 2 }, () => st.selfCheck[k], v => { st.selfCheck[k] = v })])
    return h('div', {},
      section('Compare', 'Your read first. Put your practice beside the source (“My first attempt” is a tab on the passage). The AI tab opens once these are answered.'),
      ...q('sameMove', 'Did I use the same underlying move? Where in my text?'),
      ...q('voice', 'Does it still sound like my character’s voice, or like the original author?'),
      ...q('copied', 'Did I copy wording or imagery instead of the move?'),
      ...q('helped', 'Did the move actually help here, or would the scene be better without it?'),
      ...legacy,
      h('label', { class: 'ss-lbl' }, 'What would I change on a second attempt?'),
      field('textarea', { class: 'field ss-ta', id: 'ss-sc-change', rows: 2 }, () => st.selfCheck.change, v => { st.selfCheck.change = v }),
      h('div', { class: 'ss-row' }, h('div', { class: 'ss-lbl' }, 'Revision'),
        h('button', { class: 'btn sm', onclick: () => { if (!rev.value.trim()) { rev.value = attemptText(st); st.revision.text = rev.value; markDirty() } } }, 'Start from my attempt')),
      rev,
      h('div', { class: 'ss-row ss-footer' },
        h('button', { class: 'btn sm', id: 'ss-go-transfer', onclick: () => { if (!st.effect.text.trim() && !st.effect.move.trim()) { showStep('effect'); return } leaveStudy(() => openTransfer(st.id)) } }, 'Try this move in a new situation')))
  }

  // ── Attempt formats ─────────────────────────────────────────

  function attemptText(st) {
    const a = st.attempt
    if (st.format === 'imitation') return a.sentences.map(s => s.text).filter(Boolean).join(' ')
    if (st.format === 'contrast') return [a.a && `A: ${a.a}`, a.b && `B: ${a.b}`].filter(Boolean).join('\n\n')
    return a.text || ''
  }

  function refreshAttemptCopy() {
    const el = document.getElementById('ss-first-copy')
    if (el) el.textContent = attemptText(_study)
    else if (!document.querySelector('.ss-source-tab[data-src="first"]') && attemptText(_study).trim()) renderSource()
  }

  function renderAttempt(box) {
    const st = _study, a = st.attempt
    const dirty = () => { markDirty(); refreshAttemptCopy() }
    const ta = (id, get, set, rows = 6, placeholder = '') => {
      const el = h('textarea', { class: 'field ss-ta ss-write', id, rows, placeholder })
      el.value = get() || ''
      el.addEventListener('input', () => { set(el.value); dirty() })
      return el
    }
    if (st.format === 'imitation') {
      const focal = st.excerpts.find(e => e.role === 'focal') || st.excerpts[0]
      const sentences = S.splitSentences(focal ? focal.t : '')
      const picker = h('div', { class: 'ss-sentences' })
      sentences.slice(0, 40).forEach(s => {
        const on = a.sentences.some(x => x.source === s)
        picker.append(h('button', { class: 'ss-sentence' + (on ? ' active' : ''), onclick: () => {
          if (on) a.sentences = a.sentences.filter(x => x.source !== s)
          else if (a.sentences.length < 3) a.sentences.push({ source: s, marks: '', text: '' })
          markDirty(); renderAttemptPanel(); renderSource()
        } }, s))
      })
      box.append(h('div', { class: 'hint ss-hint' }, 'Pick up to three sentences (they are underlined in the passage). Copy the shape — length, clause order, where it turns — not the imagery or wording.'), picker)
      a.sentences.forEach((s, n) => {
        box.append(h('div', { class: 'ss-imitate' },
          h('div', { class: 'ss-imitate-src', text: s.source }),
          h('div', { class: 'ss-shape', text: `${words(s.source)} words · shape: ${S.punctuationShape(s.source)}` }),
          field('input', { class: 'field', placeholder: 'Your marks: where is the emphasis, where does it turn?' }, () => s.marks, v => { s.marks = v }),
          ta(`ss-imitate-${n}`, () => s.text, v => { s.text = v }, 2, 'Same shape, your content.')))
      })
    } else if (st.format === 'own') {
      box.append(renderOwnPicker())
      if (a.own) {
        box.append(h('div', { class: 'ss-row' }, h('div', { class: 'ss-lbl', text: `After · ${a.own.sceneTitle} (the original is on the passage)` }),
          h('button', { class: 'btn sm', onclick: () => navigator.clipboard?.writeText(a.text || '') }, 'Copy')),
          ta('ss-attempt-text', () => a.text, v => { a.text = v }, 10, 'Your revision of this passage. The scene file is never changed.'))
      }
    } else if (st.format === 'voice') {
      const target = st.effect.move.trim() || st.effect.text.trim()
      box.append(
        target ? h('div', { class: 'hint ss-hint', text: `The move: ${target}` }) : h('div', { class: 'hint ss-hint' }, 'Name the move in step 2 first; that’s what you’re carrying over.'),
        h('label', { class: 'ss-lbl' }, 'The scene'),
        field('textarea', { class: 'field ss-ta', id: 'ss-voice-scene', rows: 2, placeholder: 'e.g. Anna walks into Joe’s, where she and Kit drank in college. Make it familiar and alien without saying she feels both.' }, () => a.situation, v => { a.situation = v }),
        h('div', { class: 'hint ss-hint' }, 'Same effect, your character’s words. If a sentence sounds like the original author, it’s imitation — rewrite it the way your character would say it.'),
        ta('ss-attempt-text', () => a.text, v => { a.text = v }, 10, 'In your character’s voice.'))
    } else if (st.format === 'skeleton') {
      box.append(
        h('label', { class: 'ss-lbl' }, 'The moves, in order'),
        field('textarea', { class: 'field ss-ta', id: 'ss-moves', rows: 5, placeholder: '1. mundane action\n2. sensory detail\n3. joke that undercuts it\n4. one-line turn' }, () => a.moves, v => { a.moves = v }),
        h('label', { class: 'ss-lbl' }, 'Your situation and characters'),
        field('input', { class: 'field', id: 'ss-situation', placeholder: 'e.g. Anna and Kit outside Joe’s, after the interview' }, () => a.situation, v => { a.situation = v }),
        ta('ss-attempt-text', () => a.text, v => { a.text = v }, 10, 'Rebuild the moves with your people.'))
    } else if (st.format === 'contrast') {
      const kind = CONTRASTS[a.contrast] ? a.contrast : 'move'
      const sel = h('select', { class: 'field', id: 'ss-contrast', onchange: () => { a.contrast = sel.value; markDirty(); renderAttemptPanel() } },
        Object.entries(CONTRASTS).map(([k, c]) => h('option', { value: k, selected: k === kind }, c.label)))
      const c = CONTRASTS[kind]
      box.append(sel,
        h('div', { class: 'ss-lbl' }, c.a), ta('ss-contrast-a', () => a.a, v => { a.a = v }, 6),
        h('div', { class: 'ss-lbl' }, c.b), ta('ss-contrast-b', () => a.b, v => { a.b = v }, 6),
        h('label', { class: 'ss-lbl' }, 'What does each version gain and lose?'),
        field('textarea', { class: 'field ss-ta', id: 'ss-gainlose', rows: 3 }, () => a.gainLose, v => { a.gainLose = v }))
    }
  }

  // Scene picker: current scene, scenes picked before, then search across the novel.
  function renderOwnPicker() {
    const st = _study
    const wrap = h('div', { class: 'ss-own' })
    const status = h('div', { class: 'hint ss-hint' }, 'Loading your manuscript…')
    const search = h('input', { class: 'field', id: 'ss-scene-search', placeholder: 'Search scenes by title' })
    const list = h('div', { class: 'ss-scene-list', id: 'ss-scene-list' })
    const paras = h('div', { class: 'ss-scene-paras', id: 'ss-scene-paras' })
    wrap.append(status, search, list, paras)
    ;(async () => {
      const { scenes, rank, current } = await listManuscriptScenes()
      status.textContent = scenes.length ? '' : 'No manuscript scenes found.'
      const draw = () => {
        const q = search.value.trim().toLowerCase()
        list.innerHTML = ''
        const shown = scenes
          .filter(sc => !q || `${sc.title} ${sc.chapter}`.toLowerCase().includes(q))
          .sort((x, y) => rank(x) - rank(y))
          .slice(0, q ? 30 : 8)
        for (const sc of shown) {
          list.append(h('button', { class: 'ss-scene' + (st.attempt.own && st.attempt.own.path === sc.path ? ' active' : ''), 'data-scene': sc.path, onclick: () => pickScene(sc, paras) },
            h('span', { class: 'ss-scene-title', text: sc.title }), h('span', { class: 'ss-scene-meta', text: `${sc.chapter}${sc.path === current ? ' · current' : rank(sc) < 1000 ? ' · recent' : ''}` })))
        }
      }
      search.addEventListener('input', draw)
      draw()
    })()
    return wrap
  }

  // Every scene across the user's novels, plus a rank: the open scene first, then recent picks.
  // Shared with Style Lab's Sentence Surgery.
  async function listManuscriptScenes() {
    const census = await window.quill.censusManuscripts().catch(() => null)
    const projects = Array.isArray(census) ? census : (census && census.projects) || []
    const scenes = []
    for (const p of projects) {
      const acts = await window.quill.getNovelStructure(p.path).catch(() => [])
      for (const act of acts || []) for (const ch of act.chapters || []) for (const sc of ch.scenes || []) {
        scenes.push({ path: sc.path, sceneId: sc.scene_id, title: sc.title, chapter: ch.folderTitle || ch.name, novel: p.title })
      }
    }
    let recent = []
    try { recent = JSON.parse(localStorage.getItem(RECENT_SCENES_KEY) || '[]') } catch {}
    const current = localStorage.getItem('quill_last') || ''
    const rank = sc => (sc.path === current ? 0 : recent.includes(sc.path) ? 1 + recent.indexOf(sc.path) : 1000)
    return { scenes, rank, current }
  }

  // A scene's paragraphs, with stubs and revision notes stripped. Null if it can't be read.
  async function sceneParagraphs(path) {
    const file = await window.quill.getFile(path).catch(() => null)
    if (!file) return null
    let body = String(file.body || '')
    if (window.QuillWords) body = window.QuillWords.stripRevisionNotes(window.QuillWords.stripStubs(body))
    // Quill scenes put one line break between paragraphs.
    return body.split(/\n+/).map(t => t.trim()).filter(Boolean)
  }

  function rememberScene(path) {
    try {
      const recent = JSON.parse(localStorage.getItem(RECENT_SCENES_KEY) || '[]').filter(p => p !== path)
      localStorage.setItem(RECENT_SCENES_KEY, JSON.stringify([path, ...recent].slice(0, 8)))
    } catch {}
  }

  async function pickScene(sc, paras) {
    const blocks = await sceneParagraphs(sc.path)
    if (!blocks) return
    paras.innerHTML = ''
    paras.append(h('div', { class: 'hint ss-hint' }, 'Click the first paragraph, then shift-click the last, to choose a paragraph, exchange or short run.'))
    let anchor = null
    blocks.forEach((t, n) => paras.append(h('div', { class: 'ss-scene-para', 'data-n': n, text: t, onclick: e => {
      const first = e.shiftKey && anchor != null ? Math.min(anchor, n) : n
      const last = e.shiftKey && anchor != null ? Math.max(anchor, n) : n
      if (!e.shiftKey) anchor = n
      paras.querySelectorAll('.ss-scene-para').forEach(p => p.classList.toggle('active', +p.dataset.n >= first && +p.dataset.n <= last))
      const hadOwn = !!_study.attempt.own
      _study.attempt.own = { path: sc.path, sceneId: sc.sceneId || '', sceneTitle: sc.title, original: blocks.slice(first, last + 1).join('\n\n') }
      markDirty()
      _sourceTab = 'mine'
      saveUi()
      renderSource()
      if (!hadOwn) {
        const box = document.getElementById('ss-attempt')
        if (box && !document.getElementById('ss-attempt-text')) {
          const a = _study.attempt
          const ta = h('textarea', { class: 'field ss-ta ss-write', id: 'ss-attempt-text', rows: 10, placeholder: 'Your revision of this passage. The scene file is never changed.' })
          ta.value = a.text || ''
          ta.addEventListener('input', () => { a.text = ta.value; markDirty(); refreshAttemptCopy() })
          box.append(h('div', { class: 'ss-lbl', text: `After · ${sc.title} (the original is on the passage)` }), ta)
        }
      }
    } })))
    rememberScene(sc.path)
  }

  // ── Optional AI ─────────────────────────────────────────────

  function voiceSample() {
    const own = _study.attempt.own
    return own && own.original ? { label: `Your voice: “${own.sceneTitle}”`, text: own.original } : null
  }

  function sendItems(kind) {
    const st = _study
    const items = st.excerpts.map(e => ({ label: e.role === 'focal' ? 'Passage' : e.role === 'linked' ? 'Linked excerpt' : `Context ${e.role}`, text: e.t }))
    if (kind === 'compare') {
      const written = st.notes.filter(n => n.text.trim())
      if (written.length) items.push({ label: `Your ${written.length} margin note${written.length === 1 ? '' : 's'}`, text: written.map(n => `“${n.quote}” — ${n.text}`).join('\n') })
    } else {
      if (st.effect.move) items.push({ label: 'The move', text: st.effect.move })
      if (st.effect.text) items.push({ label: 'Chosen effect', text: st.effect.text })
      if (st.format === 'voice' && st.attempt.situation) items.push({ label: 'Scene', text: st.attempt.situation })
      const at = attemptText(st)
      if (at) items.push({ label: 'Your attempt', text: at })
      if (st.revision.text) items.push({ label: 'Your revision', text: st.revision.text })
      if (S.hasComparison(st)) items.push({ label: 'Your comparison', text: [
        `Same move? ${st.compare.sameMove}`, `Still my character’s voice? ${st.compare.voice}`,
        `Copied wording? ${st.compare.copied}`, `Did it help? ${st.compare.helped}`].join('\n') })
      const v = voiceSample()
      if (v) items.push(v)
    }
    return items
  }

  function renderAI() {
    const box = h('div', { class: 'ss-ai', id: 'ss-ai' })
    box.append(section('Compare with AI (optional)', 'Other readings of your passage, and feedback judged only against your chosen effect.'))
    const preview = h('div', { class: 'ss-send', id: 'ss-send-preview' })
    const readings = h('div', { id: 'ss-readings' })
    const feedback = h('div', { id: 'ss-feedback' })
    box.append(
      h('div', { class: 'ss-restore', id: 'ss-ai-lock' }, 'Answer the four Compare questions in step 4 first — your read before the AI’s.'),
      h('div', { class: 'hint ss-hint' }, 'Nothing is sent until you press a button. This is exactly what each button sends:'),
      preview,
      h('div', { class: 'ss-row' },
        h('button', { class: 'btn', id: 'ss-compare', onclick: runCompare }, 'Compare readings'),
        h('button', { class: 'btn', id: 'ss-feedback-btn', onclick: runFeedback }, 'Feedback on my attempt'),
        h('span', { class: 'ss-status', id: 'ss-ai-status' })),
      readings, feedback)
    setTimeout(() => { renderReadings(); renderFeedback() }, 0)
    return box
  }

  function updateSendPreview() {
    const el = document.getElementById('ss-send-preview')
    if (!el || !_study) return
    el.innerHTML = ''
    for (const [kind, title] of [['compare', 'Compare readings sends'], ['feedback', 'Feedback sends']]) {
      const col = h('div', { class: 'ss-send-col' }, h('div', { class: 'ss-lbl' }, title))
      for (const it of sendItems(kind)) {
        col.append(h('details', { class: 'ss-send-item' }, h('summary', { text: `${it.label} · ${words(it.text)} words` }), h('div', { class: 'ss-send-text', text: it.text })))
      }
      el.append(col)
    }
    // The AI comes after your own read: a written note (the auto-anchored phrase doesn't count)
    // and your answers to the comparison in step 4.
    const compared = S.hasComparison(_study)
    const lock = document.getElementById('ss-ai-lock')
    if (lock) lock.hidden = compared
    const compareBtn = document.getElementById('ss-compare')
    if (compareBtn) compareBtn.disabled = !compared || !S.hasObservation(_study)
    const fbBtn = document.getElementById('ss-feedback-btn')
    if (fbBtn) fbBtn.disabled = !compared || !(attemptText(_study) || _study.revision.text) || !(_study.effect.text || _study.effect.move)
  }

  async function aiCall(system, user, maxTokens) {
    if (!(await QuillAI.hasKey())) { QuillAI.askForKey(); return null }
    const resp = await QuillAI.fetch({ method: 'POST', body: JSON.stringify({ model: StyleLab.resolvedModel(), max_tokens: maxTokens, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }) })
    if (!resp.ok) { const d = await resp.json().catch(() => ({})); throw new Error(d.error?.message || `HTTP ${resp.status}`) }
    const data = await resp.json()
    return data.choices?.[0]?.message?.content?.trim() || ''
  }

  async function runCompare() {
    const st = _study
    const status = document.getElementById('ss-ai-status')
    status.textContent = 'Reading…'
    const sys = `You are a close reader talking with a novelist who has already annotated a passage they admire. Offer your own readings of specific phrases so they can compare. Your readings are other possible interpretations, not an answer key.

For each reading, copy the phrase EXACTLY from the passage. Group each one:
- similar: you read a phrase they noted the same way
- different: a phrase they noted, read differently
- another: a phrase they did not note

Explain effects in plain language (what it makes the reader feel, infer, or anticipate). Use a technical term only if it truly helps. No praise, no summary.

Respond with 4-8 lines, nothing else, each exactly:
READING: <exact phrase> | <similar|different|another> | <one or two sentences>`
    const user = sendItems('compare').map(it => `${it.label.toUpperCase()}:\n${it.text}`).join('\n\n')
    try {
      const reply = await aiCall(sys, user, 900)
      if (reply == null) { status.textContent = ''; return }
      const fresh = []
      for (const line of reply.split('\n')) {
        const m = /^\s*READING:\s*(.+?)\s*\|\s*(similar|different|another)\s*\|\s*(.+)$/i.exec(line)
        if (!m) continue
        let hit = null
        for (const ex of st.excerpts) { const r = S.findQuote(ex.t, m[1]); if (r) { hit = { ex, r }; break } }
        fresh.push({ id: S.newId('r'), excerptId: hit ? hit.ex.id : '', start: hit ? hit.r.start : 0, end: hit ? hit.r.end : 0,
          quote: hit ? hit.ex.t.slice(hit.r.start, hit.r.end) : m[1].replace(/^["“]|["”]$/g, ''), reading: m[3].trim(), group: m[2].toLowerCase(), status: 'open', amended: '' })
      }
      st.ai.readings = [...st.ai.readings.filter(r => r.status !== 'open'), ...fresh]
      status.textContent = fresh.length ? '' : 'No readings came back in the expected shape.'
      markDirty()
      renderReadings()
    } catch (err) { status.textContent = 'Failed: ' + err.message }
  }

  function renderReadings() {
    const wrap = document.getElementById('ss-readings')
    if (!wrap || !_study) return
    wrap.innerHTML = ''
    const groups = [['similar', 'Similar observations'], ['another', 'Another possible reading'], ['different', 'Different interpretation']]
    for (const [g, title] of groups) {
      const list = _study.ai.readings.filter(r => r.group === g && r.status !== 'dismissed')
      if (!list.length) continue
      wrap.append(h('div', { class: 'ss-lbl' }, title))
      for (const r of list) {
        const amend = h('textarea', { class: 'field ss-ta', rows: 2, style: r.status === 'amended' ? '' : 'display:none' })
        amend.value = r.amended || r.reading
        amend.addEventListener('input', () => { r.amended = amend.value; r.status = 'amended'; markDirty({ rerenderPreview: false }) })
        wrap.append(h('div', { class: 'ss-reading', 'data-reading': r.id },
          h('div', { class: 'ss-note-quote', text: `“${r.quote}”${r.excerptId ? '' : ' (not found in the passage)'}` }),
          h('div', { class: 'ss-reading-text', text: r.reading }),
          amend,
          h('div', { class: 'ss-row' },
            h('button', { class: 'btn sm', onclick: () => { amend.style.display = '' ; amend.focus() } }, 'Amend'),
            h('button', { class: 'btn sm', onclick: () => { r.status = 'dismissed'; markDirty(); renderReadings() } }, 'Dismiss'))))
      }
    }
  }

  async function runFeedback() {
    const st = _study
    const status = document.getElementById('ss-ai-status')
    status.textContent = 'Reading your attempt…'
    const settings = StyleLab.getSettings ? StyleLab.getSettings() : {}
    const tone = { gentle: 'Warm and encouraging.', kind: 'Warm but honest.', honest: 'Direct, like a colleague.', sharp: 'Blunt.', brutal: 'Very blunt.' }[settings.brutality] || 'Direct, like a colleague.'
    const about = settings.instructions && settings.instructions.trim() ? `\nABOUT THIS WRITER:\n${settings.instructions.trim()}\n` : ''
    const sys = `You are giving feedback on one practice exercise. The writer studied a passage, named the move it makes and ONE effect to practice, wrote an attempt (and maybe a revision) in their own novel's voice, then compared it to the source themselves. Judge ONLY whether their text uses that move to produce the chosen effect. Do not comment on anything outside it. Respond to their own comparison: say where you agree, and where you read it differently. Flag any place where they borrowed the source's wording or imagery instead of its move.

Preserve the narrator's characteristic humor, selective attention, and the gap between what she claims and what she chooses when they serve the passage. Assess whether this particular use supports the chosen effect: a joke can be characteristic and still interrupt a moment, and you may say so.

Tone: ${tone} Tone changes how you say it, never how much you cover.${about}
Respond in exactly this format, plain text, no markdown:
EFFECTIVE_CHOICE: <one choice that produces the effect, quoting their words>
OBSTACLE: <one thing in the way of the effect, quoting their words>
NEXT_EXPERIMENT: <one concrete thing to try on the next attempt>
EXAMPLE: <one sentence showing that experiment>`
    const user = sendItems('feedback').map(it => `${it.label.toUpperCase()}:\n${it.text}`).join('\n\n')
    try {
      const reply = await aiCall(sys, user, 700)
      if (reply == null) { status.textContent = ''; return }
      st.ai.feedback = { text: reply, at: new Date().toISOString(), revealed: false }
      status.textContent = ''
      markDirty()
      renderFeedback()
    } catch (err) { status.textContent = 'Failed: ' + err.message }
  }

  function renderFeedback() {
    const wrap = document.getElementById('ss-feedback')
    if (!wrap || !_study || !_study.ai.feedback) return
    const text = _study.ai.feedback.text
    const get = label => (new RegExp(`${label}:\\s*([\\s\\S]*?)(?=\\n[A-Z_]+:|$)`).exec(text) || [])[1]?.trim() || ''
    const parts = [['EFFECTIVE_CHOICE', 'What works'], ['OBSTACLE', 'What is in the way'], ['NEXT_EXPERIMENT', 'Next experiment']]
    wrap.innerHTML = ''
    const fb = h('div', { class: 'sl-feedback' })
    const any = parts.some(([k]) => get(k))
    if (!any) fb.append(h('div', { class: 'sl-fb-text pre', text }))
    for (const [k, label] of parts) {
      const v = get(k)
      if (v) fb.append(h('div', { class: 'sl-fb-block' }, h('div', { class: 'sl-fb-label working' }, label), h('div', { class: 'sl-fb-text', text: v })))
    }
    const example = get('EXAMPLE')
    if (example) {
      // The example stays hidden until the writer has made their own revision.
      const canReveal = !!_study.revision.text.trim()
      if (_study.ai.feedback.revealed) fb.append(h('div', { class: 'sl-fb-block' }, h('div', { class: 'sl-fb-label rewrite' }, 'Example'), h('div', { class: 'sl-fb-rewrite', id: 'ss-example', text: example })))
      else fb.append(h('button', { class: 'btn sm', id: 'ss-reveal-example', disabled: !canReveal, title: canReveal ? '' : 'Save your revision first',
        onclick: () => { _study.ai.feedback.revealed = true; markDirty(); renderFeedback() } }, canReveal ? 'Show an example rewrite' : 'Show an example rewrite (after your revision)'))
    }
    wrap.append(fb)
  }

  // ── Transfer ────────────────────────────────────────────────

  async function openTransfer(id) {
    if (_study && _study.id !== id && !(await confirmLeave())) return
    const disk = await window.quill.styleStudyGet({ id }).catch(() => null)
    if (!disk) return renderHome()
    _study = disk
    _savedRev = disk.rev
    _saveError = ''
    _revealNotes = false
    _view = 'transfer'
    renderTransfer()
  }

  function renderTransfer(draftIn) {
    const st = _study
    const root = inner()
    root.innerHTML = ''
    // The attempt in progress is kept locally until it is saved into the study.
    const TKEY = `quill_study_transfer_${st.id}`
    let stored = null
    try { stored = JSON.parse(localStorage.getItem(TKEY) || 'null') } catch {}
    const draft = draftIn || stored || { situation: '', text: '', selfCheck: { feel: '', where: '', change: '' } }
    const keep = () => { try { localStorage.setItem(TKEY, JSON.stringify(draft)) } catch {} }
    const input = (tag, props, get, set) => { const el = h(tag, props); el.value = get(); el.addEventListener('input', () => { set(el.value); keep() }); return el }
    root.append(
      h('div', { class: 'btn-row page-back' },
        h('button', { class: 'btn ghost sm', id: 'ss-transfer-back', onclick: () => leaveStudy(() => { _tab = 'studies'; renderHome() }) }, '‹ Studies')),
      h('div', { class: 'kicker' }, 'Transfer · without the example'),
      h('div', { class: 'ss-effect-only', id: 'ss-transfer-effect', text: [st.effect.move, st.effect.text].filter(s => s && s.trim()).join(' — ') || 'No move or effect named for this study.' }),
      h('label', { class: 'ss-lbl' }, 'A new situation (a different scene from the one you studied)'),
      input('input', { class: 'field', id: 'ss-transfer-situation', placeholder: 'e.g. Anna questions Thomas about the missing ledger' }, () => draft.situation, v => { draft.situation = v }),
      input('textarea', { class: 'field ss-ta ss-write', id: 'ss-transfer-text', rows: 10, placeholder: 'Write it.' }, () => draft.text, v => { draft.text = v }),
      h('label', { class: 'ss-lbl' }, 'What did I want the reader to feel, infer, or anticipate?'),
      input('textarea', { class: 'field ss-ta', rows: 2, id: 'ss-transfer-feel' }, () => draft.selfCheck.feel, v => { draft.selfCheck.feel = v }),
      h('label', { class: 'ss-lbl' }, 'Where does my text produce that effect?'),
      input('textarea', { class: 'field ss-ta', rows: 2, id: 'ss-transfer-where' }, () => draft.selfCheck.where, v => { draft.selfCheck.where = v }),
      h('label', { class: 'ss-lbl' }, 'What would I change?'),
      input('textarea', { class: 'field ss-ta', rows: 2, id: 'ss-transfer-change' }, () => draft.selfCheck.change, v => { draft.selfCheck.change = v }),
      h('div', { class: 'ss-row' },
        h('button', { class: 'btn primary', id: 'ss-transfer-save', onclick: async () => {
          if (!draft.text.trim()) return
          st.transfers.push({ id: S.newId('tr'), situation: draft.situation, text: draft.text, selfCheck: draft.selfCheck, at: new Date().toISOString() })
          markDirty()
          const ok = await saveNow()
          try { localStorage.removeItem(TKEY) } catch {}
          _revealNotes = true
          renderTransfer({ situation: '', text: '', selfCheck: { feel: '', where: '', change: '' } })
          const note = document.getElementById('ss-transfer-status')
          if (note) note.textContent = ok ? 'Saved. Your notes are below.' : 'Not saved yet — retrying.'
        } }, 'Save attempt'),
        h('span', { class: 'ss-status', id: 'ss-transfer-status' }), h('span', { id: 'ss-save-badge', class: 'ss-save-badge' })),
    )
    if (_revealNotes || st.transfers.length) {
      const reveal = h('div', { class: 'ss-reveal', id: 'ss-reveal' })
      if (_revealNotes) {
        reveal.append(h('div', { class: 'section-label ss-section-title' }, 'Your study'))
        for (const ex of st.excerpts) reveal.append(h('div', { class: 'ss-excerpt-text ss-dim', text: ex.t }))
        for (const n of st.notes) reveal.append(h('div', { class: 'ss-note-quote', text: `“${n.quote}” — ${n.text}` }))
        if (st.attempt.moves) reveal.append(h('div', { class: 'ss-attempt-copy', text: st.attempt.moves }))
      } else {
        reveal.append(h('button', { class: 'btn sm', id: 'ss-reveal-notes', onclick: () => { _revealNotes = true; renderTransfer(draft) } }, 'Reveal my notes'))
      }
      root.append(reveal)
    }
    if (st.transfers.length) {
      root.append(h('div', { class: 'section-label' }, `Earlier transfers (${st.transfers.length})`))
      for (const t of st.transfers.slice().reverse()) {
        root.append(h('div', { class: 'ss-transfer-past' }, h('div', { class: 'ss-study-meta', text: `${String(t.at).slice(0, 10)}${t.situation ? ' · ' + t.situation : ''}` }), h('div', { class: 'ss-attempt-copy', text: t.text })))
      }
    }
    updateBadge()
  }

  // Close guard: if the window closes while a save is pending, the beforeunload copy in
  // localStorage is already current (markDirty writes it synchronously).
  window.addEventListener('beforeunload', () => { if (_study && hasUnsaved()) writeDraft() })

  return {
    open, openStudy, openStudyFromAnywhere, openTransfer, startStudy, addLinkedExcerpt, hasUnsaved, confirmLeave, confirmClose, flushPending, reconcile,
    listManuscriptScenes, sceneParagraphs, rememberScene,
    isActive: () => !!_study,
    _test: { setSaver: fn => { _saver = fn }, setConfirm: fn => { _confirm = fn }, showStep, layoutStudy, state: () => ({ study: _study, savedRev: _savedRev, saveError: _saveError, view: _view, step: _step, sourceTab: _sourceTab }) },
  }
})()
