/* models.js — the one list of AI models every dropdown in Quill shows.
 *
 * Static models go through OpenRouter. Providers that discover their models at runtime
 * (ChatGPT sign-in) add them with merge(). Custom model ids the writer saved live in
 * localStorage `quill_saved_models`; the shared choice lives in `quill_or_model`.
 */
const QuillModels = (() => {
  const STATIC = [
    { id: 'anthropic/claude-haiku-4-5',   label: 'Claude Haiku 4.5',   note: 'fast',         provider: 'openrouter' },
    { id: 'anthropic/claude-sonnet-4-6',  label: 'Claude Sonnet 4.6',  note: 'recommended',  provider: 'openrouter' },
    { id: 'anthropic/claude-opus-4-6',    label: 'Claude Opus 4.6',    note: '',             provider: 'openrouter' },
    { id: 'anthropic/claude-opus-4.7',    label: 'Claude Opus 4.7',    note: 'most capable', provider: 'openrouter' },
    { id: 'mistralai/mistral-medium-3.1', label: 'Mistral Medium 3.1', note: '',             provider: 'openrouter' },
    { id: 'mistralai/mistral-large',      label: 'Mistral Large',      note: '',             provider: 'openrouter' },
    { id: 'google/gemini-flash-1.5',      label: 'Gemini Flash 1.5',   note: '',             provider: 'openrouter' },
  ]
  // A role names a job, not a model, so call sites never hardcode an id.
  const ROLES = {
    default: 'anthropic/claude-haiku-4-5',
    quick:   'anthropic/claude-haiku-4-5',
    writing: 'anthropic/claude-sonnet-4-6',
  }
  const discovered = {}             // provider → [{ id, label, note, provider }]
  const connected = new Set(['openrouter'])   // until refresh() learns otherwise

  function saved() {
    try { return JSON.parse(localStorage.getItem('quill_saved_models') || '[]').filter(m => typeof m === 'string' && m) } catch { return [] }
  }
  function list() { return [...STATIC, ...Object.values(discovered).flat()] }
  function find(id) { return list().find(m => m.id === id) || null }
  function label(id) { return find(id)?.label || String(id || '').split('/').pop() }
  function providerOf(id) { return find(id)?.provider || 'openrouter' }

  // Falls back to any model on a connected provider when the preferred one is unavailable.
  function role(name) {
    const want = ROLES[name] || ROLES.default
    if (connected.has(providerOf(want))) return want
    return list().find(m => connected.has(m.provider))?.id || want
  }
  function current() { return localStorage.getItem('quill_or_model') || role('default') }
  function setCurrent(id) { if (id) localStorage.setItem('quill_or_model', id) }

  function merge(provider, models) {
    discovered[provider] = (models || []).map(m => ({ note: '', ...m, provider }))
    if (discovered[provider].length) connected.add(provider)
    else connected.delete(provider)
    document.dispatchEvent(new CustomEvent('quill-models-changed'))
  }

  // Which providers can answer right now, and the ChatGPT models this account may use. Runs at
  // startup and after Settings → AI changes.
  async function refresh() {
    const hasOr = await window.quill.hasOpenRouterKey().catch(() => false)
    const cg = await window.quill.chatgptStatus().catch(() => ({}))
    if (hasOr) connected.add('openrouter'); else connected.delete('openrouter')
    if (cg.sharing) {
      const res = await window.quill.chatgptModels().catch(() => ({ models: [] }))
      merge('chatgpt', res.models || [])
      return { openrouter: hasOr, chatgpt: cg, models: res.models || [], error: res.ok === false ? res.error : '' }
    }
    merge('chatgpt', [])
    return { openrouter: hasOr, chatgpt: cg, models: [], error: '' }
  }
  function isConnected(provider) { return connected.has(provider) }

  // <option>s for a model <select>. `custom` appends the "Custom model ID…" entry.
  function optionsHTML({ selected = current(), custom = true, customLabel = 'Custom model ID…', notes = true } = {}) {
    const known = new Set(list().map(m => m.id))
    const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
    const opt = (id, text) => `<option value="${esc(id)}"${id === selected ? ' selected' : ''}>${esc(text)}</option>`
    const groups = {}
    for (const m of list()) (groups[m.provider] ||= []).push(m)
    const providerName = { openrouter: 'OpenRouter', chatgpt: 'ChatGPT plan' }
    const multi = Object.keys(groups).length > 1
    const body = Object.entries(groups).map(([p, ms]) => {
      const opts = ms.map(m => opt(m.id, notes && m.note ? `${m.label} — ${m.note}` : m.label)).join('')
      return multi ? `<optgroup label="${esc(providerName[p] || p)}">${opts}</optgroup>` : opts
    }).join('')
    const mine = saved().filter(m => !known.has(m)).map(m => opt(m, m)).join('')
    // Keep an unknown current choice visible instead of silently showing another model.
    const orphan = selected && !known.has(selected) && !saved().includes(selected) && selected !== '__custom__' ? opt(selected, selected) : ''
    return body + mine + orphan + (custom ? `<option value="__custom__"${selected === '__custom__' ? ' selected' : ''}>${esc(customLabel)}</option>` : '')
  }

  setTimeout(() => refresh().catch(() => {}), 0)

  return { list, find, label, providerOf, role, current, setCurrent, merge, refresh, isConnected, saved, optionsHTML, ROLES }
})()
