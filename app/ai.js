/* ai.js — OpenRouter access for the renderer, without the renderer ever holding the key.
 *
 * QuillAI.fetch(init) takes the same init object a fetch() to OpenRouter would (method,
 * body, signal; headers are ignored because main adds them) and resolves with a real
 * Response, so callers keep using resp.ok, resp.json() and resp.body.getReader().
 */
const QuillAI = (() => {
  const streams = new Map()

  window.quill.onAiEvent(ev => {
    const stream = streams.get(ev.id)
    if (!stream) return
    if (ev.type === 'chunk') stream.enqueue(ev.data)
    else {
      streams.delete(ev.id)
      if (ev.type === 'end') stream.close()
      else stream.error(new TypeError(ev.message || 'Network error'))
    }
  })

  async function fetch(init = {}) {
    const id = crypto.randomUUID()
    const abortError = () => new DOMException('The operation was aborted.', 'AbortError')
    if (init.signal?.aborted) throw abortError()
    let controller
    const body = new ReadableStream({
      start(c) { controller = c; streams.set(id, c) },
      cancel() { streams.delete(id); window.quill.aiAbort(id) },
    })
    let rejectHead
    const aborted = new Promise((_, reject) => { rejectHead = reject })
    init.signal?.addEventListener('abort', () => {
      window.quill.aiAbort(id)
      if (streams.delete(id)) controller.error(abortError())
      rejectHead(abortError())
    }, { once: true })
    const head = await Promise.race([window.quill.aiRequest(id, String(init.body || '')), aborted])
    if (head.error) { streams.delete(id); throw new TypeError(head.error) }
    return new Response(body, {
      status: head.status, statusText: head.statusText,
      headers: head.contentType ? { 'content-type': head.contentType } : {},
    })
  }

  // One-time move of a key saved by older versions out of plaintext localStorage.
  try {
    const legacy = localStorage.getItem('quill_or_key')
    if (legacy) {
      window.quill.setOpenRouterKey(legacy)
        .then(() => localStorage.removeItem('quill_or_key'))
        .catch(err => console.error('Could not move the OpenRouter key to secure storage:', err))
    }
  } catch {}

  // Key inputs never show the saved key: they stay empty, the placeholder says whether a key
  // is saved, and typing a new one replaces it.
  function showKeyField(el) {
    if (!el) return
    el.value = ''
    window.quill.hasOpenRouterKey()
      .then(has => { el.placeholder = has ? 'Key saved — paste a new one to replace it' : 'sk-or-v1-…' })
      .catch(() => {})
  }

  async function saveKeyField(el) {
    const key = el?.value.trim()
    if (!key) return
    await window.quill.setOpenRouterKey(key)
    showKeyField(el)
  }

  // Every AI tool sends a writer here when no provider is set up.
  function askForKey() {
    if (confirm('AI tools need an OpenRouter API key or a ChatGPT connection. Open Settings → AI?')) Settings.open('ai')
  }

  // True when any provider can answer: an OpenRouter key, or ChatGPT with plan usage. Main
  // still reports a clear error if the chosen model's own provider isn't set up.
  async function hasKey() {
    const [or, cg] = await Promise.all([
      window.quill.hasOpenRouterKey().catch(() => false),
      window.quill.chatgptStatus().then(s => !!s.sharing).catch(() => false),
    ])
    return or || cg
  }

  // Any "API key: Settings → AI" link opens that tab.
  document.addEventListener('click', e => {
    const link = e.target.closest?.('[data-open-settings]')
    if (link) { e.preventDefault(); Settings.open(link.dataset.openSettings) }
  })

  return {
    fetch,
    askForKey,
    showKeyField,
    saveKeyField,
    hasKey,
    setKey: key => window.quill.setOpenRouterKey(key),
  }
})()
