/* threadspanel.js — the novel's open threads on the Structure tab, beside the outline: each
 * question the reader is holding, what kind it is, the scene that raises it and the scene that
 * answers it. Threads still open are listed first, the ones raised longest ago at the top.
 *
 * ThreadsPanel.store is the one copy of the list in the renderer, so Bridge's "Open threads" step
 * and the panel always agree. Saved in <novel>/.threads.json through get-threads / save-threads;
 * cleaning and helpers are in ../threads.js (QuillThreads). "Find threads in my draft" is
 * DraftAI.threads, a preview the writer accepts. */

const ThreadsPanel = (() => {
  const esc = s => escapeHtml(s)
  const T = () => QuillThreads

  // ── The store ───────────────────────────────────────────────
  const store = (() => {
    let novel = null, threads = [], saved = false, timer = null, dirty = false
    const listeners = new Set()
    const emit = () => listeners.forEach(fn => { try { fn(threads) } catch {} })

    async function load(novelPath) {
      if (novel === novelPath && threads) return threads
      await flush()
      const result = await window.quill.getThreads(novelPath).catch(() => null)
      novel = novelPath
      threads = result?.ok ? result.threads : []
      saved = !!result?.saved
      emit()
      return threads
    }
    async function reload(novelPath) { novel = null; return load(novelPath) }

    function changed() {
      dirty = true
      saved = true
      clearTimeout(timer)
      timer = setTimeout(flush, 500)
      emit()
    }

    async function flush() {
      clearTimeout(timer)
      timer = null
      if (!novel || !dirty) return
      dirty = false
      const result = await window.quill.saveThreads({ novelRel: novel, threads }).catch(error => ({ ok: false, error: error.message }))
      if (!result?.ok) {
        dirty = true
        if (!timer) timer = setTimeout(flush, 3000)
      }
    }

    return {
      load, reload, flush,
      list: () => threads,
      novel: () => novel,
      everSaved: () => saved,
      get: id => threads.find(t => t.id === id),
      add(patch) { const t = T().make(patch); threads = [...threads, t]; changed(); return t },
      addMany(list) { threads = [...threads, ...list]; changed() },
      update(id, patch) { threads = threads.map(t => t.id === id ? { ...t, ...patch } : t); changed() },
      remove(id) { threads = threads.filter(t => t.id !== id); changed() },
      subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn) },
    }
  })()

  // ── The panel ───────────────────────────────────────────────
  let _ctx = null      // { novelPath, container, countEl, structure: () => structure }
  let _scenes = []     // { path, title, chapter } in reading order, for the scene pickers
  let _expanded = null // the thread open for editing
  let _showClosed = false
  let _unsub = null

  async function show(novelPath, container, opts = {}) {
    _ctx = { novelPath, container, ...opts }
    _unsub?.()
    _unsub = store.subscribe(() => { if (_ctx?.container === container && document.body.contains(container)) paintCount() })
    const [, acts] = await Promise.all([store.load(novelPath), window.quill.getNovelStructure(novelPath).catch(() => [])])
    _scenes = QuillBridge.scenesInOrder(acts).map(sc => ({ path: sc.path, title: sc.title, chapter: sc.chapter }))
    render()
  }

  function paintCount() {
    const c = T().counts(store.list())
    if (_ctx?.countEl) _ctx.countEl.textContent = c.total ? `${c.open} open` : ''
  }

  const sceneTitle = ref => ref ? (_scenes.find(s => s.path === ref.path)?.title || ref.title || 'a scene') : ''
  const kindLabel = id => T().KINDS.find(k => k.id === id)?.label || ''

  function sceneSelect(field, ref, empty) {
    const known = ref && _scenes.some(s => s.path === ref.path)
    return `<select data-scene="${field}"><option value="">${esc(empty)}</option>
      ${ref && !known ? `<option value="${esc(ref.path)}" selected>${esc(ref.title || ref.path)} (moved?)</option>` : ''}
      ${_scenes.map(s => `<option value="${esc(s.path)}"${ref?.path === s.path ? ' selected' : ''}>${esc(s.title)}${s.chapter ? ` · ${esc(s.chapter)}` : ''}</option>`).join('')}
    </select>`
  }

  function row(t) {
    const open = _expanded === t.id
    const where = [t.raised ? `raised in ${sceneTitle(t.raised)}` : '', t.status === 'answered' ? (t.answered ? `answered in ${sceneTitle(t.answered)}` : 'answered') : t.status === 'dropped' ? 'dropped' : '']
      .filter(Boolean).join(' · ')
    return `<div class="thr-item${open ? ' open' : ''}" data-thread="${esc(t.id)}" data-status="${t.status}">
      <button type="button" class="thr-line" aria-expanded="${open}">
        ${t.kind ? `<span class="thr-kind" data-kind="${t.kind}">${esc(kindLabel(t.kind))}</span>` : ''}
        <span class="thr-text">${esc(t.text || 'Untitled thread')}</span>
        ${where ? `<span class="thr-where">${esc(where)}</span>` : ''}
      </button>
      ${open ? `<div class="thr-edit">
        <textarea rows="1" data-field="text" placeholder="A question the reader is holding">${esc(t.text)}</textarea>
        <div class="sb-chips thr-kinds">${T().KINDS.map(k => `<button type="button" class="sb-chip${t.kind === k.id ? ' on' : ''}" data-kind="${k.id}" title="${esc(k.hint)}">${esc(k.label)}</button>`).join('')}</div>
        <label class="thr-field"><span>Raised in</span>${sceneSelect('raised', t.raised, 'Not placed yet')}</label>
        <div class="seg thr-status">${T().STATUSES.map(s => `<button type="button" data-status="${s}" class="${t.status === s ? 'on' : ''}">${s === 'open' ? 'Open' : s === 'answered' ? 'Answered' : 'Dropped'}</button>`).join('')}</div>
        ${t.status === 'answered' ? `<label class="thr-field"><span>Answered in</span>${sceneSelect('answered', t.answered, 'Not written yet')}</label>` : ''}
        <textarea rows="1" data-field="note" placeholder="Notes: what the answer is, how it should land">${esc(t.note)}</textarea>
        <div class="thr-edit-foot"><button type="button" class="thr-del" data-del>Remove</button><button type="button" class="thr-done" data-done>Done</button></div>
      </div>` : ''}
    </div>`
  }

  function render() {
    const box = _ctx?.container
    if (!box || !document.body.contains(box)) return
    const threads = store.list()
    const order = _scenes.map(s => s.path)
    const open = T().sortOpen(threads, order)
    const closed = threads.filter(t => t.status !== 'open')
    const seeds = T().seedsFrom(_ctx.structure?.(), threads)
    box.innerHTML = `
      <p class="thr-intro">The questions your reader is holding. Keep each one moving, and answer it before the end (or on purpose in a sequel).</p>
      <div class="thr-list">${open.map(row).join('') || '<p class="thr-empty">No open threads yet.</p>'}</div>
      <div class="thr-actions">
        <button type="button" class="brb-add" id="thr-add">+ Thread</button>
        <button type="button" class="brb-add" id="thr-ai" title="AI reads your scenes and suggests threads. You choose which to keep.">Find threads in my draft</button>
        ${seeds.length && !store.everSaved() ? `<button type="button" class="brb-add" id="thr-seed" title="${esc(seeds.join(' · '))}">Start from my Structure answers</button>` : ''}
      </div>
      ${closed.length ? `<button type="button" class="thr-closed-toggle" id="thr-closed">${_showClosed ? 'Hide' : 'Show'} ${closed.length} answered or dropped</button>
        ${_showClosed ? `<div class="thr-list thr-closed">${closed.map(row).join('')}</div>` : ''}` : ''}`
    bind(box)
    paintCount()
  }

  function bind(box) {
    box.querySelectorAll('[data-thread]').forEach(el => {
      const id = el.dataset.thread
      el.querySelector('.thr-line').onclick = () => { _expanded = _expanded === id ? null : id; render(); focusText(id) }
      if (_expanded !== id) return
      el.querySelectorAll('textarea').forEach(area => {
        const fit = () => { area.style.height = 'auto'; area.style.height = area.scrollHeight + 2 + 'px' }
        setTimeout(fit, 0)
        area.addEventListener('input', () => {
          fit()
          store.update(id, { [area.dataset.field]: area.value })
          if (area.dataset.field === 'text') el.querySelector('.thr-text').textContent = area.value || 'Untitled thread'
        })
      })
      el.querySelectorAll('[data-kind]').forEach(btn => { btn.onclick = () => { const t = store.get(id); store.update(id, { kind: t.kind === btn.dataset.kind ? '' : btn.dataset.kind }); render() } })
      el.querySelectorAll('.thr-status [data-status]').forEach(btn => { btn.onclick = () => { store.update(id, { status: btn.dataset.status }); render() } })
      el.querySelectorAll('[data-scene]').forEach(sel => {
        sel.onchange = () => {
          const scene = _scenes.find(s => s.path === sel.value)
          store.update(id, { [sel.dataset.scene]: sel.value ? { path: sel.value, title: scene?.title || '' } : null })
          render()
        }
      })
      el.querySelector('[data-del]').onclick = () => {
        const t = store.get(id)
        if ((t.text.trim() || t.note.trim()) && !confirm('Remove this thread?')) return
        store.remove(id); _expanded = null; render()
      }
      el.querySelector('[data-done]').onclick = () => { _expanded = null; render() }
    })
    box.querySelector('#thr-add').onclick = () => { const t = store.add({}); _expanded = t.id; render(); focusText(t.id) }
    box.querySelector('#thr-ai').onclick = () => findInDraft()
    const seed = box.querySelector('#thr-seed')
    if (seed) seed.onclick = () => { store.addMany(T().seedsFrom(_ctx.structure?.(), store.list()).map(text => T().make({ text }))); render() }
    const closed = box.querySelector('#thr-closed')
    if (closed) closed.onclick = () => { _showClosed = !_showClosed; render() }
  }

  function focusText(id) {
    const area = _ctx?.container?.querySelector(`[data-thread="${CSS.escape(id)}"] textarea[data-field="text"]`)
    if (area) { area.focus(); area.setSelectionRange(area.value.length, area.value.length) }
  }

  // Shared with Bridge: AI suggestions added to the store. Returns how many were added.
  async function findInDraft(novelPath = _ctx?.novelPath, structure = _ctx?.structure?.()) {
    if (!novelPath) return 0
    await store.load(novelPath)
    const added = await DraftAI.threads({ novelPath, existing: store.list(), question: structure?.foundation?.question || '' })
    if (added.length) store.addMany(added)
    if (_ctx?.novelPath === novelPath) render()
    return added.length
  }

  return { store, show, render, findInDraft, flush: () => store.flush() }
})()
