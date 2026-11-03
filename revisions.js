/* revisions.js — pure bookkeeping for revision notes (no fs, no electron).
 *
 * A revision note's text and position live in the scene file as one marker line (see
 * words.js and renderer/src/editor/markdown/FORMAT.md). Everything else lives in the novel's
 * `.revisions.json`, handled here as a plain object:
 *
 *   { v: 1,
 *     notes:   { [id]: { home_scene_id, text, created, scope } },        // open notes
 *     archive: [ { id, text, scope, home_scene_id, home_label, created, closed } ] }
 *
 * `scope` says where a note applies beyond the spot it sits in:
 *   { book: bool, chapters: [chapter_id], scenes: [scene_id], characters: [name] }
 *
 * The scene file is the source of truth for whether a note is open: a marker that vanishes
 * from its home scene is archived, and a marker that reappears (undo, paste, restore from
 * Trash) is restored with its scope intact.
 *
 * Loaded as a plain script in the renderer (window.QuillRevisions) and required by main.js.
 */
;(function (root, factory) {
  const api = factory()
  if (typeof module !== 'undefined' && module.exports) module.exports = api
  else root.QuillRevisions = api
})(typeof self !== 'undefined' ? self : globalThis, function () {
  const NOTE_ID = /^rv_[A-Za-z0-9]{1,32}$/
  const MAX_ARCHIVE = 2000

  function text(value, max = 20000) { return String(value == null ? '' : value).slice(0, max) }

  function idList(value, max = 500) {
    if (!Array.isArray(value)) return []
    return [...new Set(value.map(item => text(item, 200).trim()).filter(Boolean))].slice(0, max)
  }

  function cleanScope(scope) {
    const s = scope && typeof scope === 'object' ? scope : {}
    return {
      book: !!s.book,
      chapters: idList(s.chapters),
      scenes: idList(s.scenes),
      characters: idList(s.characters, 100),
    }
  }

  function emptyStore() { return { v: 1, notes: {}, archive: [] } }

  function cleanStore(data) {
    const out = emptyStore()
    if (!data || typeof data !== 'object') return out
    const notes = data.notes && typeof data.notes === 'object' && !Array.isArray(data.notes) ? data.notes : {}
    for (const [id, note] of Object.entries(notes)) {
      if (!NOTE_ID.test(id) || !note || typeof note !== 'object') continue
      out.notes[id] = {
        home_scene_id: text(note.home_scene_id, 200),
        text: text(note.text),
        created: text(note.created, 40),
        scope: cleanScope(note.scope),
      }
    }
    const seen = new Set(Object.keys(out.notes))
    for (const item of Array.isArray(data.archive) ? data.archive : []) {
      if (!item || typeof item !== 'object' || !NOTE_ID.test(item.id) || seen.has(item.id)) continue
      seen.add(item.id)
      out.archive.push({
        id: item.id,
        text: text(item.text),
        scope: cleanScope(item.scope),
        home_scene_id: text(item.home_scene_id, 200),
        home_label: text(item.home_label, 400),
        created: text(item.created, 40),
        closed: text(item.closed, 40),
      })
    }
    out.archive = out.archive.slice(0, MAX_ARCHIVE)
    return out
  }

  // A note parked in a scene is about that scene until the writer widens it.
  function defaultScope({ sceneId } = {}) {
    return cleanScope({ scenes: sceneId ? [sceneId] : [] })
  }

  function archiveNote(store, id, { text: finalText, homeLabel = '', now }) {
    const note = store.notes[id]
    if (!note) return false
    delete store.notes[id]
    store.archive = store.archive.filter(item => item.id !== id)
    store.archive.unshift({
      id,
      text: finalText == null ? note.text : text(finalText),
      scope: note.scope,
      home_scene_id: note.home_scene_id,
      home_label: text(homeLabel, 400),
      created: note.created,
      closed: now,
    })
    store.archive = store.archive.slice(0, MAX_ARCHIVE)
    return true
  }

  // Bring an id back to the open list (from the archive when it is there), homed in `sceneId`.
  function openNote(store, id, { text: noteText, sceneId, chapterId, now }) {
    if (store.notes[id]) {
      store.notes[id].home_scene_id = sceneId || store.notes[id].home_scene_id
      if (noteText != null) store.notes[id].text = text(noteText)
      return 'kept'
    }
    const archived = store.archive.find(item => item.id === id)
    if (archived) {
      store.archive = store.archive.filter(item => item.id !== id)
      store.notes[id] = {
        home_scene_id: sceneId || archived.home_scene_id,
        text: noteText == null ? archived.text : text(noteText),
        created: archived.created || now,
        scope: archived.scope,
      }
      return 'restored'
    }
    store.notes[id] = {
      home_scene_id: sceneId || '',
      text: text(noteText),
      created: now,
      scope: defaultScope({ chapterId, sceneId }),
    }
    return 'created'
  }

  /* One scene was saved. `before` / `after` are findNotes() results for its old and new body.
   * A note that left this scene is archived only if this scene was its home — when it was cut
   * here and already pasted (and saved) elsewhere, the other scene owns it now. Returns
   * whether the store changed. */
  function applySceneSave(store, { sceneId, chapterId, before = [], after = [], homeLabel = '', now }) {
    let changed = false
    const afterIds = new Set(after.map(note => note.id))
    for (const note of before) {
      if (afterIds.has(note.id)) continue
      const entry = store.notes[note.id]
      if (entry && (!entry.home_scene_id || entry.home_scene_id === sceneId)) {
        changed = archiveNote(store, note.id, { text: note.text, homeLabel, now }) || changed
      }
    }
    for (const note of after) {
      const entry = store.notes[note.id]
      if (entry && entry.home_scene_id === sceneId && entry.text === note.text) continue
      openNote(store, note.id, { text: note.text, sceneId, chapterId, now })
      changed = true
    }
    return changed
  }

  /* The whole novel was read. `found` is every marker in manuscript order, each
   * { id, text, scene_id, chapter_id, label }. Markers win: anything found is open, anything
   * open but not found (scene deleted, edited outside Quill) is archived. A duplicate id — a
   * scene copied outside Quill — is reported so the caller can re-mint it. */
  function reconcile(store, found, { now, labelForScene = () => '' } = {}) {
    let changed = false
    const seen = new Set()
    const duplicates = []
    for (const note of found) {
      if (seen.has(note.id)) { duplicates.push(note); continue }
      seen.add(note.id)
      const entry = store.notes[note.id]
      if (entry && entry.home_scene_id === note.scene_id && entry.text === note.text) continue
      openNote(store, note.id, { text: note.text, sceneId: note.scene_id, chapterId: note.chapter_id, now })
      changed = true
    }
    for (const id of Object.keys(store.notes)) {
      if (seen.has(id)) continue
      archiveNote(store, id, { homeLabel: labelForScene(store.notes[id].home_scene_id), now })
      changed = true
    }
    return { changed, duplicates }
  }

  /* Does an open note apply to this scene? Home scenes show the note itself, so they are
   * excluded here; this answers "which notes should appear as ghosts". Character scope is a
   * filter for the overview and character sheet, not a placement — a note on Kit would
   * otherwise follow every Kit scene. Book scope surfaces once, at the start of the novel. */
  function appliesTo(note, { sceneId, chapterId, isFirstScene = false }) {
    if (!note || note.home_scene_id === sceneId) return false
    const scope = note.scope || {}
    if (scope.scenes?.includes(sceneId)) return true
    if (chapterId && scope.chapters?.includes(chapterId)) return true
    return !!(scope.book && isFirstScene)
  }

  return {
    NOTE_ID, cleanScope, cleanStore, emptyStore, defaultScope,
    archiveNote, openNote, applySceneSave, reconcile, appliesTo,
  }
})
