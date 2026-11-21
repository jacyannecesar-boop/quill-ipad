/* bridgebuilder.js — Bridge: a worksheet for the stretch between the last scene written and the
 * next scene the writer can see. Five steps: where you are (the last scenes, read back), the
 * open threads, the lighthouse, what has to be true by then, and the scenes that get there,
 * each one following from the one before. A card or the lighthouse can be sent to Unsorted as
 * a scene idea, ready to plan in Build a Scene or draft out of order.
 *
 * Opened from the Structure tab (landing.js). Lives in the Structure Builder's frame (the sb-*
 * and stb-* styles). Saved in <novel>/.bridge.json through get-bridge / save-bridge; the logic
 * that doesn't touch the page is in ../bridge.js (QuillBridge). No AI: the questions do the work. */

const BridgeBuilder = (() => {
  const STEPS = [
    { id: 'now', label: 'Where you are' },
    { id: 'threads', label: 'Open threads' },
    { id: 'lighthouse', label: 'The lighthouse' },
    { id: 'needs', label: 'What has to be true' },
    { id: 'cards', label: 'Scenes to get there' },
  ]

  let _ctx = null      // { novelPath, title, template, scenesByBeat, structure, beats, goal, pov, sendScene, planScene, onClose }
  let _b = null        // the bridge being edited (QuillBridge.clean shape)
  let _where = null    // QuillBridge.whereYouAre of the manuscript
  let _order = []      // every scene path in reading order, for sorting threads
  let _busy = ''       // an AI helper is running: 'synopses' | 'threads' | 'cards'
  let _i = 0
  let _dirty = false
  let _timer = null

  const esc = s => escapeHtml(s)
  const $ = id => document.getElementById(id)
  const B = () => QuillBridge
  const newId = () => Math.random().toString(36).slice(2, 10)
  const area = (attrs, value, rows = 2, placeholder = '') =>
    `<textarea rows="${rows}" ${attrs}${placeholder ? ` placeholder="${esc(placeholder)}"` : ''}>${esc(value || '')}</textarea>`
  const filled = s => !!String(s || '').trim()
  const Threads = () => ThreadsPanel.store
  const openThreads = () => QuillThreads.sortOpen(Threads().list(), _order)

  async function open(ctx) {
    _ctx = ctx
    const [saved, acts] = await Promise.all([
      window.quill.getBridge(ctx.novelPath).catch(() => null),
      window.quill.getNovelStructure(ctx.novelPath).catch(() => []),
    ])
    _b = B().clean(saved?.ok ? saved.bridge : B().blank())
    _where = B().whereYouAre(acts)
    _order = B().scenesInOrder(acts).map(sc => sc.path)
    await Threads().load(ctx.novelPath)
    // Bridge used to keep its own thread list; it moves into the novel's threads once.
    if (_b.threads.length) {
      const moved = _b.threads.filter(t => t.text.trim() && !QuillThreads.isDuplicate(Threads().list(), t.text))
        .map(t => ({ old: t, made: QuillThreads.make({ text: t.text }) }))
      if (moved.length) Threads().addMany(moved.map(m => m.made))
      _b.advance = [..._b.advance, ...moved.filter(m => m.old.advance).map(m => m.made.id)]
      _b.threads = []
      _dirty = true
      await Threads().flush()
    }
    _i = startStep()
    if (_dirty) await flush()
    $('brb-heading').textContent = `Bridge: ${ctx.title || 'Untitled'}`
    $('bridge-builder-modal').classList.add('show')
    render()
  }

  // Pick up where the writer left off: the first step with nothing in it.
  function startStep() {
    if (!_b.updated) return 0
    if (!_b.lighthouse.kind && !filled(_b.lighthouse.text)) return 2
    if (!_b.needs.length) return 3
    return 4
  }

  async function close() {
    if (!_ctx) return
    await flush()
    $('bridge-builder-modal').classList.remove('show')
    const ctx = _ctx
    _ctx = null
    ctx.onClose?.(_b)
  }

  // ── Saving ──────────────────────────────────────────────────
  function changed() {
    _dirty = true
    clearTimeout(_timer)
    _timer = setTimeout(flush, 600)
  }

  async function flush() {
    clearTimeout(_timer)
    _timer = null
    if (!_ctx || !_dirty) return
    _dirty = false
    const result = await window.quill.saveBridge({ novelRel: _ctx.novelPath, bridge: _b })
      .catch(error => ({ ok: false, error: error.message }))
    const status = $('brb-save-status')
    if (!result?.ok) {
      _dirty = true
      if (status) status.textContent = `Couldn’t save the bridge${result?.error ? ` (${result.error})` : ''}. Trying again…`
      if (!_timer) _timer = setTimeout(flush, 3000)
    } else {
      _b.updated = result.bridge?.updated || _b.updated
      if (status) status.textContent = ''
    }
  }

  // ── Rendering ───────────────────────────────────────────────
  function stepState(id) {
    if (id === 'now') {
      const n = B().NOW_QUESTIONS.filter(q => filled(_b.now[q.id])).length
      return n === B().NOW_QUESTIONS.length ? 'mine' : n ? 'draft' : 'empty'
    }
    if (id === 'threads') return openThreads().some(t => _b.advance.includes(t.id)) ? 'mine' : openThreads().length ? 'draft' : 'empty'
    if (id === 'lighthouse') return _b.lighthouse.kind && filled(_b.lighthouse.text) ? 'mine' : _b.lighthouse.kind || filled(_b.lighthouse.text) ? 'draft' : 'empty'
    if (id === 'needs') return _b.needs.some(n => filled(n.text)) ? 'mine' : 'empty'
    const cards = _b.cards.filter(c => filled(c.then))
    return cards.length && cards.every(c => c.sentPath) ? 'mine' : cards.length ? 'draft' : 'empty'
  }

  function render() {
    const rail = $('brb-rail')
    rail.innerHTML = STEPS.map((s, i) => `<button type="button" class="sb-rail-step${i === _i ? ' active' : ''}" data-i="${i}">
      <i class="beat-dot" data-state="${stepState(s.id)}"></i><span class="stb-rail-label">${esc(s.label)}</span></button>`).join('')
    rail.querySelectorAll('.sb-rail-step').forEach(btn => { btn.onclick = () => go(Number(btn.dataset.i)) })
    const body = $('brb-body')
    const id = STEPS[_i].id
    body.innerHTML = `<div class="stb-kicker">Step ${_i + 1} of ${STEPS.length}</div>` + ({
      now: nowStep, threads: threadsStep, lighthouse: lighthouseStep, needs: needsStep, cards: cardsStep,
    })[id]()
    body.scrollTop = 0
    bind(body, id)
    $('brb-back').disabled = _i === 0
    $('brb-next').style.display = _i === STEPS.length - 1 ? 'none' : ''
    $('brb-done').textContent = _i === STEPS.length - 1 ? 'Done' : 'Save & close'
  }
  const refreshRail = () => $('brb-rail').querySelectorAll('.beat-dot').forEach((dot, i) => { dot.dataset.state = stepState(STEPS[i].id) })

  function nowStep() {
    const { recent, total } = _where
    const pos = B().position(_ctx.template, total, _ctx.goal)
    const where = pos ? `About ${pos.pct}% of your ${Number(_ctx.goal).toLocaleString()}-word goal: ${esc(pos.act)}${pos.beat ? `, around <b>${esc(pos.beat.label)}</b>` : ''}.`
      : total ? `${total.toLocaleString()} words so far. Set a word goal on the Overview to see where that falls in your structure.` : ''
    const label = beatId => (_ctx.template.acts || []).flatMap(a => a.beats).find(b => b.id === beatId)?.label
    const scenes = recent.length ? `<div class="brb-recent"><span class="sb-label">Your last ${recent.length === 1 ? 'scene' : `${recent.length} scenes`}, read back</span>
      ${recent.map(sc => {
        const beats = (sc.beats || []).map(label).filter(Boolean)
        return `<button type="button" class="brb-recent-scene" data-path="${esc(sc.path)}">
          <span class="brb-recent-title"><b>${esc(sc.title)}</b><span>${esc(sc.chapter)} · ${Number(sc.word_count || 0).toLocaleString()} words</span></span>
          ${sc.synopsis ? `<span class="brb-recent-syn">${esc(sc.synopsis)}</span>` : '<span class="brb-recent-syn none">No synopsis. What happens here, in a line?</span>'}
          ${beats.length ? `<span class="brb-recent-beats">${beats.map(b => `<i>${esc(b)}</i>`).join('')}</span>` : ''}
        </button>`
      }).join('')}</div>` : '<p class="stb-intro">No scenes with words in them yet. Bridge works best once you’ve written up to where you’re stuck.</p>'
    const missing = recent.filter(sc => !filled(sc.synopsis))
    const fill = missing.length ? `<div class="brb-actions brb-fill"><button type="button" class="brb-add" id="brb-ai-synopses"${_busy ? ' disabled' : ''}
      title="AI reads these scenes and suggests a one-line synopsis for each. You edit and choose what's saved.">${_busy === 'synopses' ? 'Reading your scenes…' : `Draft ${missing.length === 1 ? 'the missing synopsis' : `the ${missing.length} missing synopses`} with AI`}</button></div>` : ''
    return `<h4>Where you are</h4>
      <p class="stb-intro">Before deciding what comes next, read back what’s there. A one-line summary of each scene (a reverse outline) shows what the story has already set moving.</p>
      ${where ? `<p class="brb-pos">${where}</p>` : ''}
      ${scenes}
      ${fill}
      ${B().NOW_QUESTIONS.map(q => `<label class="sb-field"><span class="stb-q">${esc(q.q)}</span>
        <span class="stb-hint">${esc(q.hint)}</span>${area(`data-now="${q.id}"`, _b.now[q.id], 2)}</label>`).join('')}`
  }

  function threadsStep() {
    const threads = openThreads()
    const seeds = QuillThreads.seedsFrom(_ctx.structure, Threads().list())
    return `<h4>Open threads</h4>
      <p class="stb-intro">Every question the reader is holding: who did it, will they kiss, can she get home, what’s in the box. The middle sags when nothing on this list moves. Tick the ones the next stretch has to push forward.</p>
      <p class="stb-hint">These are your novel’s threads, the same list as Open threads on the Structure tab. Answered ones are kept there.</p>
      <div class="brb-list" id="brb-threads">
        ${threads.map(t => `<div class="brb-row" data-thread="${esc(t.id)}">
          <label class="brb-tick" title="The next stretch moves this"><input type="checkbox" data-advance${_b.advance.includes(t.id) ? ' checked' : ''}></label>
          ${area('data-thread-text', t.text, 1, 'A question the reader is holding')}
          <button type="button" class="brb-del" data-del title="Remove from the novel’s threads" aria-label="Remove">×</button></div>`).join('')}
      </div>
      <div class="brb-actions">
        <button type="button" class="brb-add" id="brb-add-thread">+ Thread</button>
        <button type="button" class="brb-add" id="brb-ai-threads"${_busy ? ' disabled' : ''} title="AI reads your scenes and suggests threads. You choose which to keep.">${_busy === 'threads' ? 'Reading your draft…' : 'Find threads in my draft'}</button>
        ${seeds.length && !Threads().everSaved() ? `<button type="button" class="brb-add" id="brb-seed-threads" title="${esc(seeds.join(' · '))}">Start from my Structure answers</button>` : ''}
      </div>`
  }

  function lighthouseStep() {
    const options = B().lighthouseOptions(_ctx.template, _ctx.scenesByBeat, _ctx.structure, _ctx.beats)
    const lh = _b.lighthouse
    const chosen = o => lh.kind === o.kind && (o.kind !== 'beat' || lh.beatId === o.beatId)
    return `<h4>The lighthouse</h4>
      <p class="stb-intro">You don’t need the whole middle. You need the next scene you can see from here, even if it’s far off: the next beat, a scene you’ve been dying to write, the moment everything turns. Aim for it, and the scenes between get easier to find.</p>
      <div class="brb-options">
        ${options.slice(0, 6).map(o => `<button type="button" class="brb-option${chosen(o) ? ' on' : ''}" data-kind="${o.kind}" data-beat="${esc(o.beatId)}">
          <b>${esc(o.label)}</b>${o.act ? `<span>${esc(o.act)}</span>` : ''}
          <em>${esc(o.text || o.hint)}</em></button>`).join('')}
        <button type="button" class="brb-option${lh.kind === 'free' ? ' on' : ''}" data-kind="free" data-beat=""><b>Something else</b><em>A scene that isn’t on the outline yet.</em></button>
      </div>
      <label class="sb-field"><span class="stb-q">The lighthouse scene, as you see it now</span>
        <span class="stb-hint">Where are they, who’s there, what happens? A guess is fine.</span>
        ${area('data-lighthouse', lh.text, 4)}</label>
      <div class="brb-send-row">
        ${lighthouseSent() ? `<span class="brb-sent">In Unsorted · <button type="button" class="brb-link" data-plan="${esc(lighthouseSent())}">Plan it →</button></span>`
          : `<button type="button" class="btn sm" id="brb-send-lighthouse"${filled(lh.text) ? '' : ' disabled'} title="Make it a scene idea in Unsorted, so you can draft it now and come back to the gap">Write it first: send to Unsorted</button>`}
      </div>`
  }
  // The lighthouse is kept as a card with needId 'lighthouse' once sent, so it's counted once.
  const lighthouseSent = () => _b.cards.find(c => c.needId === 'lighthouse')?.sentPath || ''

  function needsStep() {
    const lh = _b.lighthouse
    return `<h4>What has to be true</h4>
      <p class="stb-intro">When the lighthouse scene starts, what has to be true already? What they know, where they are, what they’ve lost, how far the relationship has got, what they still believe. Tick what your draft has already done. Each unticked line is a scene, or part of one.</p>
      ${filled(lh.text) ? `<div class="stb-recall"><span class="sb-label">Lighthouse</span><div>${esc(lh.text)}</div></div>` : ''}
      <div class="brb-list" id="brb-needs">
        ${_b.needs.map(n => `<div class="brb-row" data-need="${esc(n.id)}">
          <label class="brb-tick" title="Already true in the draft"><input type="checkbox" data-done${n.done ? ' checked' : ''}></label>
          ${area('data-need-text', n.text, 1, 'e.g. She knows the map is a fake')}
          <button type="button" class="brb-del" data-del title="Remove" aria-label="Remove">×</button></div>`).join('')}
      </div>
      <button type="button" class="brb-add" id="brb-add-need">+ Something that has to be true</button>
      ${_b.needs.some(n => !n.done && filled(n.text)) ? `<div class="stb-focus-foot"><span></span>
        <button type="button" class="btn sm" id="brb-make-cards" title="One scene card for each line that isn’t true yet">Make a scene card for each →</button></div>` : ''}`
  }

  function cardsStep() {
    const chain = B().chain(_b.cards.filter(c => c.needId !== 'lighthouse'))
    const linked = Object.fromEntries(chain.map(c => [c.id, c.linked]))
    const advancing = openThreads().filter(t => _b.advance.includes(t.id) && filled(t.text))
    const needText = id => _b.needs.find(n => n.id === id)?.text || ''
    const cards = _b.cards.filter(c => c.needId !== 'lighthouse')
    return `<h4>Scenes to get there</h4>
      <p class="stb-intro">One card per scene, in order. Write each as <b>because</b> (what the last scene caused) and <b>so</b> (what happens now). If a card only says “and then”, the chain is broken there. Pick an outcome: a scene that ends <i>yes, but…</i> or <i>no, and…</i> keeps the middle moving.</p>
      ${advancing.length ? `<div class="stb-recall"><span class="sb-label">Threads to move</span>${advancing.map(t => `<div>${esc(t.text)}</div>`).join('')}</div>` : ''}
      <div class="brb-cards" id="brb-cards">
        ${cards.map((c, i) => `<div class="brb-card${linked[c.id] ? '' : ' brb-unlinked'}" data-card="${esc(c.id)}">
          <div class="brb-card-head">
            <span class="brb-card-num">${i + 1}</span>
            ${c.needId && needText(c.needId) ? `<span class="brb-card-need">So that: ${esc(needText(c.needId))}</span>` : '<span class="brb-card-need"></span>'}
            <button type="button" class="brb-move" data-move="-1" title="Move up" aria-label="Move up"${i === 0 ? ' disabled' : ''}>↑</button>
            <button type="button" class="brb-move" data-move="1" title="Move down" aria-label="Move down"${i === cards.length - 1 ? ' disabled' : ''}>↓</button>
            <button type="button" class="brb-del" data-del title="Remove" aria-label="Remove">×</button>
          </div>
          <label class="sb-field"><span class="sb-label">Because…</span>${area('data-because', c.because, 1, i === 0 ? 'What the last scene you wrote set off' : 'What the scene before caused')}</label>
          <label class="sb-field"><span class="sb-label">So…</span>${area('data-then', c.then, 2, 'What happens in this scene')}</label>
          ${linked[c.id] ? '' : '<p class="brb-warn">No “because” yet: what makes this scene happen?</p>'}
          <div class="sb-chips brb-outcomes">${B().OUTCOMES.map(o => `<button type="button" class="sb-chip${c.outcome === o ? ' on' : ''}" data-outcome="${esc(o)}">${esc(o)}</button>`).join('')}</div>
          <details class="brb-pressure"${c.pressure ? ' open' : ''}><summary>Stuck on this one? Add pressure</summary>
            <div class="sb-chips">${B().PRESSURES.map(p => `<button type="button" class="sb-chip${c.pressure === p.id ? ' on' : ''}" data-pressure="${p.id}">${esc(p.label)}</button>`).join('')}</div>
            ${c.pressure ? `<p class="stb-hint brb-pressure-q">${esc(B().PRESSURES.find(p => p.id === c.pressure).q)}</p>` : ''}
          </details>
          <div class="brb-send-row">${c.sentPath
            ? `<span class="brb-sent">In Unsorted · <button type="button" class="brb-link" data-plan="${esc(c.sentPath)}">Plan it →</button></span>`
            : `<button type="button" class="btn sm" data-send${filled(c.then) ? '' : ' disabled'}>Send to Unsorted</button>`}</div>
        </div>`).join('')}
      </div>
      <div class="brb-actions">
        <button type="button" class="brb-add" id="brb-add-card">+ Scene</button>
        <button type="button" class="brb-add" id="brb-ai-cards"${_busy ? ' disabled' : ''} title="AI suggests scenes from your last scenes, threads and lighthouse. You choose which to keep.">${_busy === 'cards' ? 'Thinking…' : 'Suggest scenes with AI'}</button>
      </div>
      ${filled(_b.lighthouse.text) ? `<div class="brb-card brb-lighthouse-card"><span class="sb-label">Then the lighthouse</span><div>${esc(_b.lighthouse.text)}</div></div>` : ''}
      ${cards.filter(c => !c.sentPath && filled(c.then)).length > 1 ? `<div class="stb-focus-foot"><span></span>
        <button type="button" class="btn sm" id="brb-send-all">Send all to Unsorted</button></div>` : ''}`
  }

  function autosize(el) { el.style.height = 'auto'; el.style.height = el.scrollHeight + 2 + 'px' }

  function bind(root, id) {
    root.querySelectorAll('textarea').forEach(el => {
      setTimeout(() => autosize(el), 0)
      el.addEventListener('input', () => autosize(el))
    })
    root.querySelectorAll('[data-plan]').forEach(btn => { btn.onclick = () => plan(btn.dataset.plan) })
    if (id === 'now') {
      root.querySelectorAll('[data-now]').forEach(el => el.addEventListener('input', () => { _b.now[el.dataset.now] = el.value; changed(); refreshRail() }))
      root.querySelectorAll('.brb-recent-scene').forEach(btn => { btn.onclick = async () => { const p = btn.dataset.path; await close(); App.openFile(p) } })
      const fill = $('brb-ai-synopses')
      if (fill) fill.onclick = () => withBusy('synopses', async () => {
        const saved = await DraftAI.synopses({ novelPath: _ctx.novelPath, paths: _where.recent.filter(sc => !filled(sc.synopsis)).map(sc => sc.path), pov: _ctx.pov })
        if (!saved) return
        const acts = await window.quill.getNovelStructure(_ctx.novelPath).catch(() => null)
        if (acts) _where = B().whereYouAre(acts)
      })
    }
    if (id === 'threads') {
      root.querySelectorAll('[data-thread]').forEach(row => {
        const tid = row.dataset.thread
        row.querySelector('[data-thread-text]').addEventListener('input', e => { Threads().update(tid, { text: e.target.value }); refreshRail() })
        row.querySelector('[data-advance]').onchange = e => {
          _b.advance = e.target.checked ? [..._b.advance.filter(x => x !== tid), tid] : _b.advance.filter(x => x !== tid)
          changed(); refreshRail()
        }
        row.querySelector('[data-del]').onclick = () => {
          const t = Threads().get(tid)
          if (t && (t.text.trim() || t.note.trim()) && !confirm('Remove this thread from the novel’s threads?')) return
          Threads().remove(tid)
          _b.advance = _b.advance.filter(x => x !== tid)
          changed(); render()
        }
      })
      $('brb-add-thread').onclick = () => {
        const t = Threads().add({})
        _b.advance = [..._b.advance, t.id]
        changed(); render(); focusLast('[data-thread-text]')
      }
      $('brb-ai-threads').onclick = () => withBusy('threads', () => ThreadsPanel.findInDraft(_ctx.novelPath, _ctx.structure))
      const seed = $('brb-seed-threads')
      if (seed) seed.onclick = () => { Threads().addMany(QuillThreads.seedsFrom(_ctx.structure, Threads().list()).map(text => QuillThreads.make({ text }))); render() }
    }
    if (id === 'lighthouse') {
      root.querySelectorAll('.brb-option').forEach(btn => {
        btn.onclick = () => {
          const kind = btn.dataset.kind, beatId = btn.dataset.beat
          const option = B().lighthouseOptions(_ctx.template, _ctx.scenesByBeat, _ctx.structure, _ctx.beats)
            .find(o => o.kind === kind && o.beatId === beatId)
          const typed = filled(_b.lighthouse.text)
          _b.lighthouse = { kind, beatId, text: typed ? _b.lighthouse.text : (option?.text || '') }
          changed(); render()
          root.querySelector('[data-lighthouse]')?.focus()
        }
      })
      root.querySelector('[data-lighthouse]').addEventListener('input', e => {
        _b.lighthouse.text = e.target.value
        if (!_b.lighthouse.kind) _b.lighthouse.kind = 'free'
        const send = $('brb-send-lighthouse')
        if (send) send.disabled = !filled(e.target.value)
        changed(); refreshRail()
      })
      const send = $('brb-send-lighthouse')
      if (send) send.onclick = () => sendLighthouse()
    }
    if (id === 'needs') {
      bindList(root, '[data-need]', 'need', _b.needs, { text: 'data-need-text', flag: 'done', after: () => render() })
      $('brb-add-need').onclick = () => { _b.needs.push({ id: newId(), text: '', done: false }); changed(); render(); focusLast('[data-need-text]') }
      const make = $('brb-make-cards')
      if (make) make.onclick = () => { makeCards(); go(4) }
    }
    if (id === 'cards') {
      root.querySelectorAll('[data-card]').forEach(row => {
        const card = _b.cards.find(c => c.id === row.dataset.card)
        row.querySelector('[data-because]').addEventListener('input', e => {
          card.because = e.target.value; changed()
          row.classList.toggle('brb-unlinked', _b.cards.filter(c => c.needId !== 'lighthouse').indexOf(card) > 0 && !filled(card.because))
        })
        row.querySelector('[data-then]').addEventListener('input', e => {
          card.then = e.target.value; changed(); refreshRail()
          const send = row.querySelector('[data-send]')
          if (send) send.disabled = !filled(card.then)
        })
        row.querySelectorAll('[data-outcome]').forEach(btn => { btn.onclick = () => { card.outcome = card.outcome === btn.dataset.outcome ? '' : btn.dataset.outcome; changed(); render() } })
        row.querySelectorAll('[data-pressure]').forEach(btn => { btn.onclick = () => { card.pressure = card.pressure === btn.dataset.pressure ? '' : btn.dataset.pressure; changed(); render() } })
        row.querySelectorAll('[data-move]').forEach(btn => { btn.onclick = () => moveCard(card, Number(btn.dataset.move)) })
        row.querySelector('[data-del]').onclick = () => {
          if ((filled(card.because) || filled(card.then)) && !confirm('Remove this scene card?')) return
          _b.cards = _b.cards.filter(c => c !== card); changed(); render()
        }
        const send = row.querySelector('[data-send]')
        if (send) send.onclick = () => sendCards([card])
      })
      $('brb-add-card').onclick = () => { _b.cards.push(blankCard()); changed(); render(); focusLast('[data-then]') }
      $('brb-ai-cards').onclick = () => withBusy('cards', async () => {
        const gap = _b.cards.filter(c => c.needId !== 'lighthouse')
        const kept = await DraftAI.bridgeCards({
          novelPath: _ctx.novelPath,
          recentPaths: _where.recent.map(sc => sc.path),
          now: _b.now,
          threads: openThreads().filter(t => _b.advance.includes(t.id)).map(t => t.text).filter(filled),
          lighthouse: _b.lighthouse.text,
          needs: _b.needs.filter(n => !n.done && filled(n.text)).map(n => n.text),
          cards: gap.filter(c => filled(c.then)).map(c => B().synopsis(c)),
          foundation: _ctx.structure?.foundation || {},
        })
        if (!kept.length) return
        _b.cards = [...gap, ...kept.map(c => blankCard(c)), ..._b.cards.filter(c => c.needId === 'lighthouse')]
        changed()
      })
      const all = $('brb-send-all')
      if (all) all.onclick = () => sendCards(_b.cards.filter(c => c.needId !== 'lighthouse' && !c.sentPath && filled(c.then)))
    }
  }

  // Thread and need rows: text, a tick, and remove.
  function bindList(root, selector, key, items, { text, flag, after }) {
    root.querySelectorAll(selector).forEach(row => {
      const item = items.find(x => x.id === row.dataset[key])
      row.querySelector(`[${text}]`).addEventListener('input', e => { item.text = e.target.value; changed(); refreshRail() })
      row.querySelector('input[type="checkbox"]').onchange = e => { item[flag] = e.target.checked; changed(); refreshRail(); after?.() }
      row.querySelector('[data-del]').onclick = () => {
        const i = items.indexOf(item)
        if (i >= 0) items.splice(i, 1)
        changed(); render()
      }
    })
  }

  const blankCard = (patch = {}) => ({ id: newId(), because: '', then: '', outcome: '', pressure: '', needId: '', sentPath: '', ...patch })
  function focusLast(selector) {
    const all = $('brb-body').querySelectorAll(selector)
    all[all.length - 1]?.focus()
  }

  // One card per line that isn't true yet and has no card already.
  function makeCards() {
    const carded = new Set(_b.cards.map(c => c.needId))
    for (const need of _b.needs) {
      if (need.done || !filled(need.text) || carded.has(need.id)) continue
      _b.cards.push(blankCard({ needId: need.id }))
    }
    changed()
  }

  function moveCard(card, by) {
    const cards = _b.cards.filter(c => c.needId !== 'lighthouse')
    const i = cards.indexOf(card), j = i + by
    if (j < 0 || j >= cards.length) return
    ;[cards[i], cards[j]] = [cards[j], cards[i]]
    _b.cards = [...cards, ..._b.cards.filter(c => c.needId === 'lighthouse')]
    changed(); render()
  }

  // ── Sending to Unsorted ─────────────────────────────────────
  async function sendCards(cards) {
    const ordered = _b.cards.filter(c => c.needId !== 'lighthouse')
    for (const card of cards) {
      const n = ordered.indexOf(card) + 1
      const made = await _ctx.sendScene({ title: B().sceneTitle(card, n), synopsis: B().synopsis(card) })
        .catch(error => ({ ok: false, error: error.message }))
      if (!made?.ok) { alert(made?.error || 'Couldn’t make the scene.'); break }
      card.sentPath = made.path
      changed()
    }
    await flush()
    render()
  }

  async function sendLighthouse() {
    const text = String(_b.lighthouse.text || '').trim()
    if (!text) return
    const beat = (_ctx.template.acts || []).flatMap(a => a.beats).find(b => b.id === _b.lighthouse.beatId)
    const card = blankCard({ needId: 'lighthouse', then: text })
    const made = await _ctx.sendScene({ title: beat?.label || B().sceneTitle(card, 0), synopsis: text, beatId: beat?.id || '' })
      .catch(error => ({ ok: false, error: error.message }))
    if (!made?.ok) { alert(made?.error || 'Couldn’t make the scene.'); return }
    card.sentPath = made.path
    _b.cards = [..._b.cards.filter(c => c.needId !== 'lighthouse'), card]
    changed()
    await flush()
    render()
  }

  // Plan a sent scene in Build a Scene; Bridge closes first, and is a click away afterwards.
  async function plan(scenePath) {
    const ctx = _ctx
    await close()
    ctx.planScene?.(scenePath)
  }

  // Runs an AI helper (it opens its own preview over Bridge) and repaints Bridge afterwards.
  async function withBusy(kind, fn) {
    if (_busy) return
    const ctx = _ctx
    _busy = kind
    render()
    try { await fn() } finally {
      _busy = ''
      if (_ctx === ctx) render()
    }
  }

  function go(i) {
    if (i < 0 || i >= STEPS.length) return
    _i = i
    render()
  }

  function init() {
    $('brb-close').onclick = () => close()
    $('brb-back').onclick = () => go(_i - 1)
    $('brb-next').onclick = () => go(_i + 1)
    $('brb-done').onclick = () => close()
    $('bridge-builder-modal').addEventListener('keydown', e => {
      if (e.key === 'Escape') { e.stopPropagation(); close() }
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); go(_i + 1) }
    })
  }

  document.addEventListener('DOMContentLoaded', init)
  return { open, close, flush, isOpen: () => !!_ctx }
})()
