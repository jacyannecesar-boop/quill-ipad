/* context-drawer.js — the shared "Context · ~8.4k" button and drawer for every AI surface.
 *
 * QuillContext.attach(button, { scope, label, novelId, voiceKey, voiceDefault, shortcuts, buildPreview })
 *   scope     — what the chips belong to ('brainstorm', 'stylelab', 'ideas', 'whatif').
 *   novelId   — fixed novel (Brainstorm). Omitted: the drawer shows a novel picker, defaulting to
 *               the novel of the last file opened.
 *   voiceKey  — which "Match novel voice" toggle this button controls (defaults to scope), so
 *               Style Lab drills can share chips but not voice defaults.
 *   buildPreview — async () => messages, for the Full input estimate and Preview prompt.
 *
 * Chips persist per novel and scope in localStorage `quill_ctx:<novelId>:<scope>` as
 * { pinned: [id], turn: [id], local: [item], voice: { key: bool } }. "This turn" chips are
 * cleared by consumed(scope), which callers run only after a successful request.
 */
const QuillContext = (() => {
  const C = window.QuillAIContext
  const SURFACE = { brainstorm: 'Brainstorm', stylelab: 'Style Lab', ideas: 'Ideas', whatif: 'What If' }
  const GROUP_ORDER = [['chapter', 'Chapters'], ['scene', 'Scenes'], ['character', 'Characters'], ['world', 'World Bible']]
  const attachments = new Set()
  const itemCache = new Map()       // novelId → { at, items }
  const voiceCache = new Map()      // novelId → { at, ref }
  let novels = null                 // [{ path, title }]
  let drawer = null                 // { el, att }

  const esc = s => escapeHtml(String(s == null ? '' : s))

  // ── novels ──────────────────────────────────────────────────
  async function listNovels() {
    if (novels) return novels
    const census = await window.quill.censusManuscripts().catch(() => null)
    const projects = Array.isArray(census) ? census : (census && census.projects) || []
    novels = projects.map(p => ({ path: p.path, title: p.title || p.path }))
    return novels
  }
  async function defaultNovel(scope) {
    const list = await listNovels()
    let chosen = null
    try { chosen = localStorage.getItem(`quill_ctx_novel:${scope}`) } catch {}
    if (chosen && list.some(n => n.path === chosen)) return chosen
    const last = localStorage.getItem('quill_last') || ''
    return (list.find(n => last.startsWith(n.path + '/')) || list[0] || {}).path || ''
  }
  function novelTitle(id) { return (novels || []).find(n => n.path === id)?.title || String(id || '').split('/').pop() }

  // ── state ───────────────────────────────────────────────────
  const key = (novelId, scope) => `quill_ctx:${novelId}:${scope}`
  function load(novelId, scope) {
    let s = {}
    try { s = JSON.parse(localStorage.getItem(key(novelId, scope)) || '{}') || {} } catch {}
    return { pinned: s.pinned || [], turn: s.turn || [], local: s.local || [], voice: s.voice || {} }
  }
  function save(novelId, scope, s) {
    try { localStorage.setItem(key(novelId, scope), JSON.stringify(s)) } catch {}
    refreshAll(scope)
  }

  async function itemsFor(novelId, fresh = false) {
    if (!novelId) return []
    const hit = itemCache.get(novelId)
    if (hit && !fresh && Date.now() - hit.at < 30000) return hit.items
    const items = await window.quill.getContextItems(novelId).catch(() => [])
    itemCache.set(novelId, { at: Date.now(), items })
    return items
  }
  async function voiceFor(novelId, fresh = false) {
    if (!novelId) return { excerpts: [], notes: '', auto: true }
    const hit = voiceCache.get(novelId)
    if (hit && !fresh && Date.now() - hit.at < 30000) return hit.ref
    const ref = await window.quill.getVoiceReference(novelId).catch(() => ({ excerpts: [], notes: '', auto: true }))
    voiceCache.set(novelId, { at: Date.now(), ref })
    return ref
  }

  async function novelOf(att) { return att.opts.novelId || (att.novelId ||= await defaultNovel(att.opts.scope)) }

  // Selected items in pick order; ids that no longer exist (a renamed scene) drop out.
  async function selected(att, fresh = false) {
    const novelId = await novelOf(att)
    const s = load(novelId, att.opts.scope)
    const all = await itemsFor(novelId, fresh)
    const byId = new Map([...all, ...s.local].map(it => [it.id, it]))
    const out = []
    for (const id of [...s.pinned, ...s.turn]) {
      const it = byId.get(id)
      if (it && !out.includes(it)) out.push({ ...it, turn: s.turn.includes(id) })
    }
    return out
  }
  function voiceOn(att) {
    const s = load(att.novelId || att.opts.novelId || '', att.opts.scope)
    const k = att.opts.voiceKey || att.opts.scope
    return k in s.voice ? !!s.voice[k] : !!att.opts.voiceDefault
  }

  // ── public: what callers send ───────────────────────────────
  function find(scopeOrAtt) {
    if (scopeOrAtt && scopeOrAtt.opts) return scopeOrAtt
    return [...attachments].find(a => a.opts.scope === scopeOrAtt && a.btn.isConnected) || null
  }

  // { story, voice, items, voiceRef, storyTokens, voiceTokens, novelId }. Voice is '' when off.
  async function blocks(scopeOrAtt, { voice } = {}) {
    const att = find(scopeOrAtt)
    if (!att) return { story: '', voice: '', items: [], voiceRef: null, storyTokens: 0, voiceTokens: 0, novelId: '' }
    const novelId = await novelOf(att)
    const items = await selected(att)
    const story = C.storyBlock(items)
    const wantVoice = voice === undefined ? voiceOn(att) : voice
    const voiceRef = wantVoice ? await voiceFor(novelId) : null
    const v = voiceRef ? C.voiceBlock(voiceRef) : ''
    return { story, voice: v, items, voiceRef, storyTokens: C.estimateTokens(story), voiceTokens: C.estimateTokens(v), novelId }
  }

  function consumed(scopeOrAtt) {
    const att = find(scopeOrAtt)
    if (!att) return
    const novelId = att.novelId || att.opts.novelId
    if (!novelId) return
    const s = load(novelId, att.opts.scope)
    if (!s.turn.length) return
    s.local = s.local.filter(it => !s.turn.includes(it.id))
    s.turn = []
    save(novelId, att.opts.scope, s)
  }

  // Add items by id (from get-context-items) or as local items (notes, selections).
  async function add(scopeOrAtt, entries, { turn = false } = {}) {
    const att = find(scopeOrAtt)
    if (!att) return
    const novelId = await novelOf(att)
    const s = load(novelId, att.opts.scope)
    for (const e of [].concat(entries || [])) {
      const it = typeof e === 'string' ? { id: e } : e
      if (!it || !it.id) continue
      if (it.kind === 'note' || it.kind === 'selection') { s.local = s.local.filter(x => x.id !== it.id); s.local.push(it) }
      if (turn && s.pinned.includes(it.id)) continue   // already sent every turn
      s.pinned = s.pinned.filter(x => x !== it.id)
      s.turn = s.turn.filter(x => x !== it.id)
      ;(turn ? s.turn : s.pinned).push(it.id)
    }
    save(novelId, att.opts.scope, s)
  }
  async function toggleTurn(att, id) {
    const novelId = await novelOf(att)
    const s = load(novelId, att.opts.scope)
    if (s.turn.includes(id)) { s.turn = s.turn.filter(x => x !== id); s.pinned.push(id) }
    else if (s.pinned.includes(id)) { s.pinned = s.pinned.filter(x => x !== id); s.turn.push(id) }
    save(novelId, att.opts.scope, s)
  }
  async function remove(att, id) {
    const novelId = await novelOf(att)
    const s = load(novelId, att.opts.scope)
    s.pinned = s.pinned.filter(x => x !== id)
    s.turn = s.turn.filter(x => x !== id)
    s.local = s.local.filter(x => x.id !== id)
    save(novelId, att.opts.scope, s)
  }
  async function clear(scopeOrAtt) {
    const att = find(scopeOrAtt)
    if (!att) return
    const novelId = await novelOf(att)
    const s = load(novelId, att.opts.scope)
    save(novelId, att.opts.scope, { ...s, pinned: [], turn: [], local: [] })
  }
  async function allItems(scopeOrAtt) {
    const att = find(scopeOrAtt)
    return att ? itemsFor(await novelOf(att)) : []
  }

  // ── button ──────────────────────────────────────────────────
  async function refreshButton(att) {
    if (!att.btn.isConnected) { attachments.delete(att); return }
    const b = await blocks(att)
    const n = b.storyTokens + b.voiceTokens
    att.btn.innerHTML = `<span class="qc-btn-lbl">Context</span> <span class="qc-btn-n">${b.items.length ? C.formatTokens(n) : (b.voiceTokens ? C.formatTokens(n) : 'none')}</span>`
    att.btn.title = `${b.items.length} item${b.items.length === 1 ? '' : 's'}${b.voiceTokens ? ' + novel voice' : ''} · click to see or change what the AI receives`
    att.btn.classList.toggle('has-items', b.items.length > 0)
  }
  function refreshAll(scope) {
    for (const att of [...attachments]) if (!scope || att.opts.scope === scope) refreshButton(att)
    if (drawer && (!scope || drawer.att.opts.scope === scope)) renderDrawer()
  }

  function attach(btn, opts = {}) {
    if (!btn) return null
    for (const a of [...attachments]) if (a.btn === btn) attachments.delete(a)
    const att = { btn, opts: { voiceDefault: false, ...opts }, novelId: opts.novelId || null }
    attachments.add(att)
    btn.classList.add('qc-btn')
    btn.type = 'button'
    btn.onclick = e => { e.preventDefault(); open(att) }
    refreshButton(att)
    return {
      att,
      blocks: o => blocks(att, o),
      consumed: () => consumed(att),
      add: (entries, o) => add(att, entries, o),
      clear: () => clear(att),
      items: () => allItems(att),
      novel: () => novelOf(att),
      setNovel: id => { att.opts.novelId = id; att.novelId = id; refreshButton(att) },
      open: () => open(att),
      refresh: () => refreshButton(att),
    }
  }

  // ── drawer ──────────────────────────────────────────────────
  let pickerOpen = false, pickerQuery = '', noteOpen = false
  const pickerExpanded = new Set()   // chapter ids showing their scenes

  function open(att) {
    close()
    const el = document.createElement('aside')
    el.className = 'qc-drawer'
    el.setAttribute('role', 'dialog')
    document.body.appendChild(el)
    // An editor selection is offered as a chip; captured now, before the drawer takes focus.
    const sel = window.getSelection && String(window.getSelection() || '').trim()
    drawer = { el, att, selection: sel && sel.length > 20 ? sel : '' }
    pickerOpen = false; pickerQuery = ''; noteOpen = false
    itemCache.delete(att.novelId || att.opts.novelId)
    voiceCache.delete(att.novelId || att.opts.novelId)
    renderDrawer()
    document.addEventListener('keydown', onKey, true)
    document.addEventListener('mousedown', onOutside, true)
  }
  function close() {
    if (!drawer) return
    drawer.el.remove()
    drawer = null
    document.removeEventListener('keydown', onKey, true)
    document.removeEventListener('mousedown', onOutside, true)
  }
  // A click anywhere outside the drawer closes it, except inside its own dialogs (preview,
  // voice editor) or on a Context button, which reopens for its own surface.
  function onOutside(e) {
    if (!drawer || drawer.el.contains(e.target) || e.target.closest?.('.qc-modal, .qc-btn')) return
    close()
  }
  function onKey(e) { if (e.key === 'Escape' && drawer && !document.querySelector('.qc-modal')) { e.stopPropagation(); close() } }

  async function renderDrawer() {
    if (!drawer) return
    const { el, att } = drawer
    const scope = att.opts.scope
    const novelId = await novelOf(att)
    const [items, all, list] = await Promise.all([selected(att), itemsFor(novelId), att.opts.novelId ? Promise.resolve(null) : listNovels()])
    if (!drawer || drawer.el !== el) return
    const vOn = voiceOn(att)
    const vRef = await voiceFor(novelId)
    const vTokens = C.voiceTokens(vRef)
    const storyTokens = C.estimateTokens(C.storyBlock(items))
    const chosen = new Set(items.map(i => i.id))

    const chip = it => `
      <div class="qc-chip" data-id="${esc(it.id)}">
        <span class="qc-kind">${esc(C.KIND_LABELS[it.kind] || it.kind)}</span>
        <span class="qc-src qc-src-${esc(it.source)}">${esc(it.source)}</span>
        <span class="qc-title" title="${esc(it.group)}">${esc(it.title)}</span>
        <span class="qc-n">${C.formatTokens(C.estimateTokens(it.text))}</span>
        <button class="qc-turn${it.turn ? ' on' : ''}" data-turn="${esc(it.id)}" title="${it.turn ? 'Sent with the next request only. Click to keep it.' : 'Kept for every request. Click to send it once.'}">${it.turn ? 'this turn' : 'pinned'}</button>
        <button class="qc-x" data-remove="${esc(it.id)}" title="Remove">✕</button>
      </div>`

    let picker = ''
    if (pickerOpen) {
      const q = pickerQuery.toLowerCase().trim()
      const words = q.split(/\s+/).filter(Boolean)
      const match = it => words.every(w => `${it.title} ${it.group}`.toLowerCase().includes(w))
      const usable = all.filter(it => String(it.text || '').trim())   // outline-only items have nothing to send
      const row = (it, cls = '') => `
            <button class="qc-result${cls}${chosen.has(it.id) ? ' added' : ''}" data-add="${esc(it.id)}">
              <span class="qc-title">${esc(it.title)}</span>
              ${cls ? '' : `<span class="qc-sub">${esc(it.group)}</span>`}
              <span class="qc-n">${C.formatTokens(C.estimateTokens(it.text))}</span>
            </button>`
      let body
      if (words.length) {
        // Search: every match, grouped by kind, no cutoff.
        body = GROUP_ORDER.map(([kind, label]) => {
          const hits = usable.filter(it => it.kind === kind && match(it))
          return hits.length ? `<div class="qc-group">${label} · ${hits.length}</div>` + hits.map(it => row(it)).join('') : ''
        }).join('') || '<div class="ss-hint">Nothing matches.</div>'
      } else {
        // Browse: chapters in manuscript order, each expanding to its scenes; then characters and
        // World Bible sections in full.
        const scenesOf = ch => usable.filter(it => it.kind === 'scene' && it.id.slice(6, it.id.lastIndexOf('/')) === ch.id.slice(8))
        const chapters = usable.filter(it => it.kind === 'chapter')
        const manuscript = chapters.map(ch => {
          const open = pickerExpanded.has(ch.id)
          const scenes = scenesOf(ch)
          return `<div class="qc-chapter">
              <button class="qc-twisty" data-expand="${esc(ch.id)}" title="${open ? 'Hide' : 'Show'} scenes">${scenes.length ? (open ? '▾' : '▸') : ''}</button>
              ${row(ch, ' qc-ch-row')}
            </div>${open ? scenes.map(sc => row(sc, ' qc-scene-row')).join('') : ''}`
        }).join('')
        const chars = usable.filter(it => it.kind === 'character')
        const sections = [...new Set(usable.filter(it => it.kind === 'world').map(it => it.group))]
        body = (manuscript ? `<div class="qc-group">Manuscript · ${chapters.length} chapter${chapters.length === 1 ? '' : 's'}</div>${manuscript}` : '')
          + (chars.length ? `<div class="qc-group">Characters · ${chars.length}</div>${chars.map(it => row(it, ' qc-plain')).join('')}` : '')
          + sections.map(sec => {
            const ws = usable.filter(it => it.kind === 'world' && it.group === sec)
            return `<div class="qc-group">World Bible · ${esc(sec)}</div>${ws.map(it => row(it, ' qc-plain')).join('')}`
          }).join('')
          || '<div class="ss-hint">This novel has no chapters, characters or World Bible entries with text yet.</div>'
      }
      picker = `<div class="qc-picker">
        <input class="field qc-search" placeholder="Search chapters, scenes, characters, World Bible…" value="${esc(pickerQuery)}">
        <div class="qc-results">${body}</div>
      </div>`
    }

    const note = noteOpen ? `<div class="qc-note">
        <input class="field" id="qc-note-title" placeholder="Title, e.g. Relationship state">
        <textarea class="field" id="qc-note-text" rows="4" placeholder="e.g. Right after Crimson. Kit has told Anna not to look for him again."></textarea>
        <div class="qc-row"><button class="btn primary" id="qc-note-save">Add note</button><button class="btn" id="qc-note-cancel">Cancel</button></div>
      </div>` : ''

    const shortcuts = (att.opts.shortcuts || []).map((s, i) => `<button class="btn sm" data-shortcut="${i}">${esc(s.label)}</button>`).join('')

    // Re-rendering after each add or expand keeps the picker and drawer where they were scrolled.
    const keepScroll = { results: el.querySelector('.qc-results')?.scrollTop || 0, drawer: el.scrollTop }
    el.innerHTML = `
      <div class="qc-head">
        <div class="qc-head-title">Context · ${esc(att.opts.label || SURFACE[scope] || scope)}</div>
        <button class="qc-x qc-close" title="Close (Esc)">✕</button>
      </div>
      ${list ? `<label class="qc-lbl">Novel</label>
        <select class="field qc-novel">${list.map(n => `<option value="${esc(n.path)}"${n.path === novelId ? ' selected' : ''}>${esc(n.title)}</option>`).join('')}</select>` : `<div class="qc-novel-fixed">${esc(novelTitle(novelId))}</div>`}

      <div class="qc-sec-head"><span>Story context</span><span class="qc-n">${C.formatTokens(storyTokens)}</span></div>
      <div class="qc-chips">${items.map(chip).join('') || '<div class="ss-hint">Nothing attached. The AI gets only what this feature always sends.</div>'}</div>
      <div class="qc-row">
        <button class="btn sm" id="qc-add">${pickerOpen ? 'Done adding' : '+ Add'}</button>
        <button class="btn sm" id="qc-note">+ Note</button>
        ${drawer.selection ? `<button class="btn sm" id="qc-sel">+ Selection (${C.wordCount(drawer.selection)} words)</button>` : ''}
        ${items.length ? '<button class="btn sm" id="qc-clear">Clear</button>' : ''}
        ${shortcuts}
      </div>
      ${note}${picker}

      <div class="qc-sec-head"><span>Voice reference</span><span class="qc-n">${vOn ? C.formatTokens(vTokens) : 'off'}</span></div>
      <label class="qc-voice"><input type="checkbox" id="qc-voice"${vOn ? ' checked' : ''}> Match novel voice</label>
      <div class="qc-voice-meta">${vRef.auto
        ? `auto: latest ${C.VOICE_TARGET_WORDS.toLocaleString()} words — <a href="#" id="qc-voice-edit">set a reference</a>`
        : `${vRef.excerpts.length} excerpt${vRef.excerpts.length === 1 ? '' : 's'}${vRef.notes ? ' + notes' : ''} · <a href="#" id="qc-voice-edit">Edit</a>`}</div>

      <div class="qc-total"><span>Full input</span><span class="qc-n" id="qc-full">${C.formatTokens(storyTokens + (vOn ? vTokens : 0))}${att.opts.buildPreview ? '…' : ''}</span></div>
      ${att.opts.buildPreview ? '<button class="btn" id="qc-preview">Preview prompt</button>' : ''}
      <div class="qc-foot">Estimates: about 4 characters per token. Material is sent as story reference, not instructions.</div>`

    // Full input = everything the feature would send right now, not just these chips.
    if (att.opts.buildPreview) {
      Promise.resolve(att.opts.buildPreview()).then(msgs => {
        const full = el.querySelector('#qc-full')
        if (full && msgs) full.textContent = C.formatTokens(C.requestTokens(msgs))
      }).catch(() => {})
    }

    const results = el.querySelector('.qc-results')
    if (results) results.scrollTop = keepScroll.results
    el.scrollTop = keepScroll.drawer

    const $ = s => el.querySelector(s)
    $('.qc-close').onclick = close
    const novelSel = $('.qc-novel')
    if (novelSel) novelSel.onchange = () => {
      att.novelId = novelSel.value
      try { localStorage.setItem(`quill_ctx_novel:${scope}`, novelSel.value) } catch {}
      refreshAll(scope)
    }
    el.querySelectorAll('[data-remove]').forEach(b => { b.onclick = () => remove(att, b.dataset.remove) })
    el.querySelectorAll('[data-turn]').forEach(b => { b.onclick = () => toggleTurn(att, b.dataset.turn) })
    $('#qc-add').onclick = () => { pickerOpen = !pickerOpen; renderDrawer().then(() => drawer?.el.querySelector('.qc-search')?.focus()) }
    $('#qc-note').onclick = () => { noteOpen = !noteOpen; renderDrawer().then(() => drawer?.el.querySelector('#qc-note-title')?.focus()) }
    $('#qc-clear')?.addEventListener('click', () => clear(att))
    $('#qc-sel')?.addEventListener('click', () => {
      const text = drawer.selection
      drawer.selection = ''
      add(att, C.makeItem({ id: `sel:${C.hash(text)}`, novelId, kind: 'selection', title: `“${text.slice(0, 40).trim()}…”`, text }), { turn: true })
    })
    el.querySelectorAll('[data-shortcut]').forEach(b => {
      b.onclick = async () => { await att.opts.shortcuts[+b.dataset.shortcut].run({ add: (e, o) => add(att, e, o), clear: () => clear(att), items: () => allItems(att) }) }
    })
    if (noteOpen) {
      $('#qc-note-cancel').onclick = () => { noteOpen = false; renderDrawer() }
      $('#qc-note-save').onclick = () => {
        const text = $('#qc-note-text').value.trim()
        if (!text) return
        const title = $('#qc-note-title').value.trim() || 'Note'
        noteOpen = false
        add(att, C.makeItem({ id: `note:${Date.now().toString(36)}`, novelId, kind: 'note', source: 'reference', title, text }))
      }
    }
    if (pickerOpen) {
      const search = $('.qc-search')
      search.oninput = () => {
        pickerQuery = search.value
        const pos = search.selectionStart
        renderDrawer().then(() => { const s = drawer?.el.querySelector('.qc-search'); if (s) { s.focus(); s.setSelectionRange(pos, pos) } })
      }
      el.querySelectorAll('[data-expand]').forEach(b => {
        b.onclick = () => {
          const id = b.dataset.expand
          pickerExpanded.has(id) ? pickerExpanded.delete(id) : pickerExpanded.add(id)
          renderDrawer()
        }
      })
      el.querySelectorAll('[data-add]').forEach(b => {
        b.onclick = () => chosen.has(b.dataset.add) ? remove(att, b.dataset.add) : add(att, b.dataset.add)
      })
    }
    $('#qc-voice').onchange = e => {
      const s = load(novelId, scope)
      s.voice[att.opts.voiceKey || scope] = e.target.checked
      save(novelId, scope, s)
    }
    $('#qc-voice-edit').onclick = e => { e.preventDefault(); openVoiceEditor(novelId) }
    $('#qc-preview')?.addEventListener('click', async () => preview(await att.opts.buildPreview()))
  }

  // ── preview ─────────────────────────────────────────────────
  // The logical request: each message in send order, with its estimate. Providers package it
  // differently, so this is what Quill sends, not the exact bytes on the wire.
  function preview(messages) {
    const msgs = (messages || []).filter(m => m && String(m.content || '').trim())
    const ov = document.createElement('div')
    ov.className = 'overlay show qc-modal'
    ov.innerHTML = `<div class="modal qc-preview-modal">
      <h3>Preview prompt</h3>
      <p class="ss-hint">What Quill sends, in order · full input ${C.formatTokens(C.requestTokens(msgs))}</p>
      <div class="qc-preview-list">${msgs.map((m, i) => {
        const first = String(m.content).split('\n')[0].slice(0, 80)
        return `<details class="ss-send-item"${i === msgs.length - 1 ? ' open' : ''}>
          <summary>${esc(m.role)} · ${esc(first)} · ${C.formatTokens(C.estimateTokens(m.content))}</summary>
          <div class="ss-send-text qc-preview-text">${esc(m.content)}</div></details>`
      }).join('') || '<div class="ss-hint">Nothing to send yet.</div>'}</div>
      <div class="qc-row qc-right"><button class="btn primary" id="qc-preview-close">Close</button></div>
    </div>`
    document.body.appendChild(ov)
    const done = () => { ov.remove(); document.removeEventListener('keydown', esc_, true) }
    const esc_ = e => { if (e.key === 'Escape') { e.stopPropagation(); done() } }
    document.addEventListener('keydown', esc_, true)
    ov.querySelector('#qc-preview-close').onclick = done
    ov.onclick = e => { if (e.target === ov) done() }
  }

  // ── voice reference editor ──────────────────────────────────
  // Whole scenes with one click, or a run of paragraphs from an opened scene. Scenes come from
  // the drawer's own items, so each one shows its size before it's added.
  async function openVoiceEditor(novelId) {
    const ref = await window.quill.getVoiceReference(novelId).catch(() => ({ excerpts: [], notes: '', auto: true }))
    let excerpts = ref.auto ? [] : ref.excerpts.map(e => ({ ...e }))
    let notes = ref.notes || ''
    const scenes = (await itemsFor(novelId, true)).filter(it => it.kind === 'scene' && it.text.trim())
    let chosen = null, first = null, last = null, anchor = null, q = ''
    const paras = sc => sc.text.split(/\n+/).map(t => t.trim()).filter(Boolean)
    const pathOf = sc => sc.id.slice(6)
    const has = sc => excerpts.some(e => e.scenePath === pathOf(sc) && e.whole)

    const ov = document.createElement('div')
    ov.className = 'overlay show qc-modal'
    document.body.appendChild(ov)
    const done = () => { ov.remove(); document.removeEventListener('keydown', onEsc, true) }
    const onEsc = e => { if (e.key === 'Escape') { e.stopPropagation(); done() } }
    document.addEventListener('keydown', onEsc, true)

    const addScene = sc => {
      if (has(sc)) return
      excerpts.push({ title: `${sc.group} · ${sc.title}`, scenePath: pathOf(sc), text: paras(sc).join('\n\n'), whole: true })
    }

    const draw = () => {
      const total = C.voiceTokens({ excerpts, notes })
      const words = q.toLowerCase().split(/\s+/).filter(Boolean)
      const shown = scenes.filter(sc => words.every(w => `${sc.title} ${sc.group}`.toLowerCase().includes(w)))
      const listScroll = ov.querySelector('.qc-v-scenes')?.scrollTop || 0
      let lastGroup = null
      ov.innerHTML = `<div class="modal qc-voice-modal">
        <h3>Novel voice reference · ${esc(novelTitle(novelId))}</h3>
        <p class="ss-hint">Passages that sound most like the book, about 2–4k tokens in all. A good mix: ordinary narration, a dialogue-heavy exchange, a description or action passage. Add a whole scene, or open one to pick paragraphs. Excerpts are snapshots, so later edits to the scene don't change them.</p>
        <div class="qc-voice-cols">
          <div>
            <input class="field" id="qc-v-search" placeholder="Search scenes or chapters" value="${esc(q)}">
            <div class="qc-v-scenes">${shown.map(sc => {
              const head = sc.group !== lastGroup ? `<div class="sl-sg-group">${esc(sc.group)}</div>` : ''
              lastGroup = sc.group
              const added = has(sc)
              return `${head}<div class="qc-v-scene${chosen && chosen.sc.id === sc.id ? ' active' : ''}">
                <button class="qc-v-open" data-open="${esc(sc.id)}" title="Open to pick paragraphs"><span class="qc-title">${esc(sc.title)}</span><span class="qc-n">${C.formatTokens(C.estimateTokens(sc.text))}</span></button>
                <button class="btn sm${added ? ' primary' : ''}" data-whole="${esc(sc.id)}"${added ? ' disabled' : ''}>${added ? '✓ Added' : '+ Scene'}</button>
              </div>`
            }).join('') || '<div class="ss-hint">No scenes with prose match.</div>'}</div>
            ${chosen ? `
            <div class="qc-row qc-v-parahead">
              <span class="qc-title">${esc(chosen.sc.title)}</span>
              <button class="btn sm" id="qc-v-add"${first == null ? ' disabled' : ''}>${first == null ? 'Click paragraphs to select' : `Add ${last - first + 1} paragraph${last === first ? '' : 's'}`}</button>
              <button class="btn sm" id="qc-v-close-scene">Close scene</button>
            </div>
            <div class="ss-scene-paras qc-v-paras">${chosen.blocks.map((t, n) =>
              `<div class="ss-scene-para${first != null && n >= first && n <= last ? ' active' : ''}" data-n="${n}">${esc(t)}</div>`).join('')}</div>
            <div class="ss-hint">Click a paragraph, then shift-click another to take everything between.</div>` : ''}
          </div>
          <div>
            <div class="qc-sec-head"><span>Excerpts</span><span class="qc-n" id="qc-v-total">${C.formatTokens(total)}${total > 4000 ? ' · over 4k' : ''}</span></div>
            ${excerpts.map((e, i) => `<div class="qc-chip"><span class="qc-title" title="${esc(e.text.slice(0, 300))}">${esc(e.title || 'Excerpt')}${e.whole ? '' : ' · part'}</span><span class="qc-n">${C.formatTokens(C.estimateTokens(e.text))}</span><button class="qc-x" data-del="${i}" title="Remove">✕</button></div>`).join('') || '<div class="ss-hint">None yet: the latest manuscript words are used until you add some.</div>'}
            <label class="qc-lbl">Voice notes (optional)</label>
            <textarea class="field" id="qc-v-notes" rows="6" placeholder="A few lines on how the book sounds, e.g. from your voice guide.">${esc(notes)}</textarea>
          </div>
        </div>
        <div class="qc-row qc-right"><button class="btn" id="qc-v-cancel">Cancel</button><button class="btn primary" id="qc-v-save">Save reference</button></div>
      </div>`
      const $ = s => ov.querySelector(s)
      const list = $('.qc-v-scenes')
      if (list) list.scrollTop = listScroll
      $('#qc-v-search').oninput = e => { q = e.target.value; const p = e.target.selectionStart; draw(); const s = $('#qc-v-search'); s.focus(); s.setSelectionRange(p, p) }
      ov.querySelectorAll('[data-whole]').forEach(b => { b.onclick = () => { addScene(scenes.find(x => x.id === b.dataset.whole)); draw() } })
      ov.querySelectorAll('[data-open]').forEach(b => { b.onclick = () => {
        const sc = scenes.find(x => x.id === b.dataset.open)
        chosen = chosen && chosen.sc.id === sc.id ? null : { sc, blocks: paras(sc) }
        first = last = anchor = null
        draw()
      } })
      $('#qc-v-close-scene')?.addEventListener('click', () => { chosen = null; first = last = anchor = null; draw() })
      ov.querySelectorAll('.qc-v-paras .ss-scene-para').forEach(p => { p.onclick = e => {
        const n = +p.dataset.n
        first = e.shiftKey && anchor != null ? Math.min(anchor, n) : n
        last = e.shiftKey && anchor != null ? Math.max(anchor, n) : n
        if (!e.shiftKey) anchor = n
        const scroll = ov.querySelector('.qc-v-paras').scrollTop
        draw()
        ov.querySelector('.qc-v-paras').scrollTop = scroll
      } })
      $('#qc-v-add')?.addEventListener('click', () => {
        if (!chosen || first == null) return
        excerpts.push({ title: `${chosen.sc.group} · ${chosen.sc.title}`, scenePath: pathOf(chosen.sc), text: chosen.blocks.slice(first, last + 1).join('\n\n') })
        first = last = anchor = null
        draw()
      })
      ov.querySelectorAll('[data-del]').forEach(b => { b.onclick = () => { excerpts.splice(+b.dataset.del, 1); draw() } })
      $('#qc-v-notes').oninput = e => { notes = e.target.value; const n = $('#qc-v-total'); const t = C.voiceTokens({ excerpts, notes }); if (n) n.textContent = C.formatTokens(t) + (t > 4000 ? ' · over 4k' : '') }
      $('#qc-v-cancel').onclick = done
      $('#qc-v-save').onclick = async () => {
        const res = await window.quill.setVoiceReference({ novelRel: novelId, excerpts, notes }).catch(err => ({ ok: false, error: err.message }))
        if (!res.ok) { alert(res.error || 'Could not save the voice reference.'); return }
        voiceCache.delete(novelId)
        done()
        refreshAll()
      }
    }
    draw()
  }

  return { attach, blocks, consumed, add, clear, items: allItems, preview, close, openVoiceEditor, refreshAll }
})()
