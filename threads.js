/* threads.js — a novel's open threads: the questions the reader is holding (who did it, will they
 * get together, can she get home, what's behind the door), where each one is raised, and where
 * it's answered. One list per novel in <novel>/.threads.json, shown on the Structure tab
 * (renderer/threadspanel.js) and used by Bridge's "Open threads" step.
 *
 * Pure: shared by main (cleaning what's saved) and the renderer (window.QuillThreads). */
;(function (root, factory) {
  const api = factory()
  if (typeof module !== 'undefined' && module.exports) module.exports = api
  else root.QuillThreads = api
})(typeof self !== 'undefined' ? self : globalThis, function () {
  const KINDS = [
    { id: 'mystery', label: 'Mystery', hint: 'Who, what or why: something hidden the reader wants to know.' },
    { id: 'relationship', label: 'Relationship', hint: 'Will they, won’t they; trust, betrayal, a bond under strain.' },
    { id: 'goal', label: 'Goal', hint: 'Can they get it, reach it, stop it, survive it?' },
    { id: 'promise', label: 'Setup', hint: 'Something shown that has to come back: a rule, an object, a warning.' },
    { id: 'inner', label: 'Inner', hint: 'Will they see past the lie, forgive, change?' },
  ]
  const STATUSES = ['open', 'answered', 'dropped']

  const newId = () => Math.random().toString(36).slice(2, 10)
  const text = (value, max) => typeof value === 'string' ? value.slice(0, max) : ''
  const safeId = value => typeof value === 'string' && /^[\w-]{1,64}$/.test(value) ? value : newId()
  const sceneRef = value => value && typeof value === 'object' && typeof value.path === 'string' && value.path
    ? { path: value.path.slice(0, 1000), title: text(value.title, 300) } : null

  function cleanOne(t) {
    return {
      id: safeId(t.id),
      text: text(t.text, 1000),
      kind: KINDS.some(k => k.id === t.kind) ? t.kind : '',
      status: STATUSES.includes(t.status) ? t.status : 'open',
      raised: sceneRef(t.raised),
      answered: sceneRef(t.answered),
      note: text(t.note, 4000),
      created: text(t.created, 40),
    }
  }

  function clean(list) {
    return (Array.isArray(list) ? list : []).slice(0, 500).filter(t => t && typeof t === 'object').map(cleanOne)
  }

  const make = (patch = {}) => cleanOne({ id: newId(), created: new Date().toISOString(), ...patch })

  // A thread said twice ("Who killed the king?" / "who killed the king") is one thread.
  const key = s => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
  const isDuplicate = (threads, value) => !!key(value) && threads.some(t => key(t.text) === key(value))

  // Starting threads from the Structure Builder's answers, one per line, skipping ones already listed.
  function seedsFrom(structure, threads = []) {
    const f = structure?.foundation || {}
    const seen = new Set(threads.map(t => key(t.text)))
    const out = []
    for (const line of ['question', 'threads', 'promise', 'payoff'].flatMap(k => String(f[k] || '').split(/\n+/))) {
      const value = line.replace(/^\s*[-*•]\s*/, '').trim()
      if (!value || seen.has(key(value))) continue
      seen.add(key(value))
      out.push(value)
    }
    return out
  }

  // Counts for the panel's heading.
  function counts(threads) {
    const list = threads || []
    return { open: list.filter(t => t.status === 'open').length, answered: list.filter(t => t.status === 'answered').length, total: list.length }
  }

  // Open threads raised longest ago first (the ones the reader has waited on longest), then the
  // rest in the order they were added. `order` is the manuscript's scene paths in reading order.
  function sortOpen(threads, order = []) {
    const at = path => { const i = order.indexOf(path); return i < 0 ? Infinity : i }
    return threads.filter(t => t.status === 'open')
      .map((t, i) => ({ t, i, at: at(t.raised?.path) }))
      .sort((a, b) => a.at - b.at || a.i - b.i).map(x => x.t)
  }

  return { KINDS, STATUSES, clean, make, isDuplicate, seedsFrom, counts, sortOpen }
})
