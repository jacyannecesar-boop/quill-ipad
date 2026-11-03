/* chapter.js — Scrivenings controller: editing a whole chapter across its scene files.
 *
 * All of the risky mapping lives in the bundle (scrivenings.mjs). This file is the UI half:
 * load, debounce, and write back. Three rules matter here:
 *   1. A refusal from pendingSave() is shown verbatim and nothing is written. The chapter
 *      stays dirty and will retry once the document makes sense again.
 *   2. Baselines are committed only after main confirms the write, so a failed save retries
 *      instead of quietly deciding the scene is clean.
 *   3. Unsaved work is never torn down silently. Leaving the chapter, by navigation or by
 *      closing the window, first tries to save; if that is refused or fails, the writer
 *      chooses between staying and discarding.
 */
const Chapter = (() => {
  let _path       = null
  let _generation = 0      // same guard the scene editor uses against navigation races
  let _saveTimer  = null
  let _mounted    = false
  let _unsaved    = false  // edits main has not confirmed on disk

  const el = id => document.getElementById(id)

  function _setStatus(text, state) {
    const node = el('chapter-save-indicator')
    if (!node) return
    node.textContent = text || ''
    node.className = 'save-indicator' + (text ? ' show' : '') + (state ? ' ' + state : '')
  }

  function _showError(message) {
    const node = el('chapter-error')
    if (!node) return
    node.textContent = message
    node.classList.add('show')
  }

  function _clearError() { el('chapter-error')?.classList.remove('show') }

  // Match the scene editor's manuscript presentation. The font arrives as a data-font
  // attribute, which the stylesheet turns into --editor; without it the chapter falls back to
  // the Poppins default and a Lora manuscript reads as sans-serif.
  async function _applyManuscriptStyle(path, generation) {
    const body = el('chapter-body')
    if (!body) return
    const projectPath = String(path || '').split('/')[0]
    const meta = projectPath
      ? await window.quill.getFolderMeta(projectPath).catch(() => ({}))
      : {}
    if (generation !== _generation) return
    // Chapters are manuscript, so they default to Lora like the scene editor does.
    body.dataset.font = meta.manuscript_font || localStorage.getItem('quill_font') || 'lora'
    const size = parseInt(meta.manuscript_font_size, 10)
      || parseInt(localStorage.getItem('quill_font_size'), 10) || 16
    body.style.fontSize = size + 'px'
    body.classList.toggle('indent-mode', Boolean(Settings.get('indent')))
  }

  function _updateWordCount() {
    const body = el('chapter-body')
    const node = el('chapter-wc')
    if (!body || !node) return
    const words = RevisionNotes.countProse(body)
    node.textContent = words.toLocaleString() + ' words'
  }

  async function open(path) {
    const generation = ++_generation
    _path = null                       // never point at a chapter before its prose has loaded
    _clearError()
    _setStatus('')
    const result = await window.quill.getChapterScenes(path).catch(() => null)
    if (generation !== _generation) return false
    if (!result?.ok) {
      _showError(result?.error || 'This chapter could not be opened.')
      return false
    }
    if (!_mounted) {
      window.QuillChapter.mount({ element: el('chapter-body'), onUpdate: scheduleSave })
      _mounted = true
    }
    window.QuillChapter.loadChapter(result.scenes)
    _unsaved = false
    _path = path
    el('chapter-title').textContent = result.title || 'Chapter'
    await _applyManuscriptStyle(path, generation)
    if (generation !== _generation) return false
    _updateWordCount()
    if (!result.scenes.length) _showError('This chapter has no scene files yet. Create scenes from the Storyboard first.')
    return true
  }

  function scheduleSave() {
    _updateWordCount()
    if (!_path) return
    _unsaved = true
    clearTimeout(_saveTimer)
    _saveTimer = setTimeout(() => { _saveTimer = null; save() }, 900)
    _setStatus('Saving…')
  }

  async function save() {
    if (!_path) return
    clearTimeout(_saveTimer); _saveTimer = null
    const pending = window.QuillChapter.pendingSave()
    if (!pending.ok) {
      // Refusals are the whole safety story: show why, write nothing, stay dirty.
      _showError(pending.error)
      _setStatus('Not saved', 'error')
      return
    }
    _clearError()
    if (!pending.scenes.length) {
      if (!_saveTimer) _unsaved = false
      _setStatus('Saved', 'saved')
      return
    }

    const rel = _path
    const result = await window.quill
      .saveChapterBodies({ folder: rel, scenes: pending.scenes.map(s => ({ path: s.path, body: s.body })) })
      .catch(err => ({ ok: false, error: String(err && err.message || err) }))
    if (_path !== rel) return
    if (!result?.ok) {
      _showError(result?.error || 'The chapter could not be saved.')
      _setStatus('Not saved', 'error')
      return
    }
    window.QuillChapter.commitSaved(pending.scenes)
    // Edits made while this save was in flight have armed a new timer and stay unsaved.
    if (!_saveTimer) _unsaved = false
    _setStatus('Saved', 'saved')
    Tree.refresh?.()
  }

  // Save anything pending. If the chapter still is not on disk, ask: Stay throws (so whatever
  // was about to happen — navigation, closing the window — stops), Discard lets it proceed.
  async function flushPending() {
    if (_saveTimer) {
      clearTimeout(_saveTimer); _saveTimer = null
      await save()
    }
    if (!_path || !_unsaved) return
    const error = el('chapter-error')
    const reason = (error?.classList.contains('show') && error.textContent) || 'The chapter could not be saved.'
    const discard = await window.quill.confirmDiscard({
      message: `“${el('chapter-title')?.textContent || 'This chapter'}” has changes that are not saved.`,
      detail: `${reason}\n\nStay to fix it here, or discard every change made since the last save.`,
    })
    if (!discard) throw Object.assign(new Error('Unsaved chapter changes.'), { stay: true })
    _unsaved = false
  }

  // For view switches that did not flush first: true once it is safe to leave.
  async function confirmLeave() {
    try { await flushPending(); return true } catch { return false }
  }

  async function close() {
    await flushPending()
    _generation++
    _path = null
    window.QuillChapter.destroy()
    _mounted = false
    _clearError()
    _setStatus('')
  }

  function isOpen() { return Boolean(_path) }
  function hasUnsaved() { return Boolean(_path) && (_unsaved || Boolean(_saveTimer)) }
  function currentPath() { return _path }

  function init() {
    el('chapter-back')?.addEventListener('click', async () => {
      const path = _path
      try { await close() } catch { return }   // the writer chose to stay
      if (path) App.openFolder(path, 'novel')
    })
  }

  return { init, open, close, save, scheduleSave, flushPending, confirmLeave, isOpen, hasUnsaved, currentPath }
})()
