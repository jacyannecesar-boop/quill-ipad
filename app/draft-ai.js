/* draft-ai.js — AI that reads the writer's draft and proposes, never writes:
 *   synopses(novel)   one-line synopses for written scenes that have none (Outliner, Bridge)
 *   threads(novel)    the open threads the draft raises, with where they're raised and answered
 *   bridgeCards(ctx)  scene cards from the last scene written to Bridge's lighthouse
 * Each opens the AI preview (#ai-preview-modal): every suggestion is editable, ticked by default,
 * and nothing reaches the novel until the writer presses the accept button. Prompts and parsing
 * are in ../story-ai.js; requests go through SceneAI (the model chosen in Settings → AI). */

const DraftAI = (() => {
  const $ = id => document.getElementById(id)
  const esc = s => escapeHtml(s)
  let _open = null   // { resolve, abort, items }

  const aiError = error => {
    const message = String(error?.message || error || '')
    if (error?.name === 'AbortError' || /abort/i.test(message)) return ''
    return message || 'Something went wrong.'
  }

  // ── The preview ─────────────────────────────────────────────
  // run({ signal, report, picked }) returns items: { id, label, meta, fields: [{ key, label, value, rows }] }.
  // Resolves with the ticked items (fields as edited), or null when cancelled.
  // With `scope`, the writer first chooses which chapters the AI reads, and nothing is sent until
  // they press Read: scope = { novelPath, eligible(scene, redo), redo: 'label' | undefined, unit }.
  // `picked` is then the Set of scene paths chosen.
  function preview({ title, intro, accept = 'Add selected', empty = 'Nothing to suggest.', scope = null, run }) {
    if (_open) close(null)
    const ctrl = new AbortController()
    return new Promise(resolve => {
      _open = { resolve, abort: () => ctrl.abort(), items: [], phase: scope ? 'scope' : 'run', accept, scope, chapters: [], redo: false }
      $('aip-heading').textContent = title
      $('aip-intro').textContent = intro || ''
      $('aip-list').innerHTML = ''
      $('aip-accept').disabled = true
      $('aip-all').hidden = true
      $('ai-preview-modal').classList.add('show')
      const start = picked => {
        if (!_open || ctrl.signal.aborted) return
        _open.phase = 'run'
        $('aip-list').innerHTML = ''
        $('aip-accept').textContent = accept
        $('aip-accept').disabled = true
        $('aip-all').hidden = true
        status('Asking the AI…', true)
        const report = text => { if (_open && !ctrl.signal.aborted) status(text, true) }
        Promise.resolve().then(() => run({ signal: ctrl.signal, report, picked })).then(items => {
          if (!_open || ctrl.signal.aborted) return
          _open.phase = 'review'
          _open.items = items || []
          status(_open.items.length ? `${_open.items.length} suggestion${_open.items.length === 1 ? '' : 's'}. Edit anything, untick what you don’t want.` : empty)
          render()
        }).catch(error => {
          if (!_open || ctrl.signal.aborted) return
          const message = aiError(error)
          status(message ? `Couldn’t finish: ${message}` : 'Stopped.')
        })
      }
      _open.start = start
      if (scope) loadScope(scope); else start(null)
    })
  }

  // ── Choosing chapters ───────────────────────────────────────
  async function loadScope(scope) {
    status('Loading your chapters…', true)
    const acts = await window.quill.getNovelStructure(scope.novelPath).catch(() => [])
    if (!_open || _open.scope !== scope) return
    _open.chapters = acts.flatMap(act => (act.chapters || []).map(ch => ({
      path: ch.path, act: act.folderTitle || '', title: ch.folderTitle || ch.name, scenes: ch.scenes || [], on: true,
    })))
    renderScope()
  }

  const scopeScenes = ch => ch.scenes.filter(sc => _open.scope.eligible(sc, _open.redo))
  const scopeWords = list => list.reduce((n, sc) => n + (Number(sc.word_count) || 0), 0)

  function renderScope() {
    const { chapters, scope } = _open
    const unit = scope.unit || 'scene'
    const list = $('aip-list')
    let lastAct = null
    list.innerHTML = `${scope.redo ? `<label class="check aip-redo"><input type="checkbox" id="aip-redo"${_open.redo ? ' checked' : ''}> ${esc(scope.redo)}</label>` : ''}
      ${chapters.map((ch, i) => {
        const n = scopeScenes(ch).length
        const head = ch.act && ch.act !== lastAct ? `<div class="aip-act">${esc(ch.act)}</div>` : ''
        lastAct = ch.act
        return `${head}<label class="aip-chapter${n ? '' : ' none'}">
          <input type="checkbox" data-ch="${i}"${ch.on && n ? ' checked' : ''}${n ? '' : ' disabled'}>
          <span class="aip-ch-title">${esc(ch.title)}</span>
          <span class="aip-ch-meta">${n ? `${n} ${unit}${n === 1 ? '' : 's'} · ${scopeWords(scopeScenes(ch)).toLocaleString()} words` : `nothing to read`}</span></label>`
      }).join('') || '<p class="aip-empty">No chapters yet.</p>'}`
    list.querySelectorAll('[data-ch]').forEach(box => { box.onchange = () => { chapters[Number(box.dataset.ch)].on = box.checked; paintScope() } })
    const redo = $('aip-redo')
    if (redo) redo.onchange = () => { _open.redo = redo.checked; renderScope() }
    paintScope()
  }

  function scopePicked() {
    return _open.chapters.filter(ch => ch.on).flatMap(scopeScenes)
  }

  function paintScope() {
    const picked = scopePicked()
    const unit = _open.scope.unit || 'scene'
    const usable = _open.chapters.filter(ch => scopeScenes(ch).length)
    status(usable.length ? 'Choose the chapters to read. Nothing is sent until you press Read.' : 'There’s nothing here for the AI to read yet.')
    $('aip-accept').textContent = picked.length ? `Read ${picked.length} ${unit}${picked.length === 1 ? '' : 's'} (${scopeWords(picked).toLocaleString()} words)` : 'Read'
    $('aip-accept').disabled = !picked.length
    $('aip-all').hidden = usable.length < 2
    $('aip-all').textContent = usable.every(ch => ch.on) ? 'Untick all' : 'Tick all'
  }

  function status(text, busy = false) {
    const el = $('aip-status')
    el.textContent = text
    el.classList.toggle('busy', busy)
  }

  function render() {
    const list = $('aip-list')
    list.innerHTML = _open.items.map((item, i) => `<div class="aip-item" data-i="${i}">
      <label class="aip-tick"><input type="checkbox" checked aria-label="Keep this suggestion"></label>
      <div class="aip-item-body">
        <div class="aip-item-label"><b>${esc(item.label || '')}</b>${item.meta ? `<span>${esc(item.meta)}</span>` : ''}</div>
        <div class="aip-fields${item.fields.length > 2 ? ' grid' : ''}">${item.fields.map(f => `<label class="aip-field">${f.label ? `<span>${esc(f.label)}</span>` : ''}
          <textarea rows="${f.rows || 1}" data-key="${esc(f.key)}">${esc(f.value || '')}</textarea></label>`).join('')}</div>
      </div></div>`).join('')
    list.querySelectorAll('textarea').forEach(el => {
      const fit = () => { el.style.height = 'auto'; el.style.height = el.scrollHeight + 2 + 'px' }
      setTimeout(fit, 0)
      el.addEventListener('input', fit)
    })
    const sync = () => {
      const ticked = list.querySelectorAll('.aip-tick input:checked').length
      $('aip-accept').disabled = !ticked
      $('aip-all').hidden = _open.items.length < 3
      $('aip-all').textContent = ticked === _open.items.length ? 'Untick all' : 'Tick all'
      list.querySelectorAll('.aip-item').forEach(row => row.classList.toggle('off', !row.querySelector('.aip-tick input').checked))
    }
    list.querySelectorAll('.aip-tick input').forEach(box => { box.onchange = sync })
    sync()
  }

  function chosen() {
    return [...$('aip-list').querySelectorAll('.aip-item')].filter(row => row.querySelector('.aip-tick input').checked).map(row => {
      const item = _open.items[Number(row.dataset.i)]
      const values = Object.fromEntries([...row.querySelectorAll('textarea')].map(el => [el.dataset.key, el.value.trim()]))
      return { ...item, values }
    })
  }

  function close(result) {
    if (!_open) return
    const { resolve, abort } = _open
    _open = null
    abort()
    $('ai-preview-modal').classList.remove('show')
    resolve(result)
  }

  // Asks once, streaming so a slow model's connection stays open; `label` is shown with progress.
  async function ask(messages, { signal, report, label, maxTokens }) {
    const t = SceneAI.timed(300000)
    const stop = () => t.abort()
    signal.addEventListener('abort', stop)
    try {
      return await SceneAI.stream(messages, {
        maxTokens, signal: t.signal, effort: 'low',
        onDelta: out => report(`${label} · ${out.split('\n').filter(l => l.trim()).length} lines so far`),
      })
    } finally {
      t.done()
      signal.removeEventListener('abort', stop)
    }
  }

  const titled = sc => `${sc.title}${sc.chapter ? ` · ${sc.chapter}` : ''}`

  // ── Synopses ────────────────────────────────────────────────
  // `paths` limits it to those scenes (Bridge's read-back); otherwise every written scene with
  // no synopsis. Returns how many were saved.
  async function synopses({ novelPath, paths = null, pov = '' }) {
    const picked = await preview({
      title: 'Draft synopses from your scenes',
      intro: 'One line per scene, read from what you wrote. They go into each scene’s synopsis (the Outliner, the Board, Bridge). Edit them so they sound like you.',
      accept: 'Save synopses',
      empty: 'Every written scene already has a synopsis.',
      // From the Outliner the writer picks chapters; Bridge names its scenes.
      scope: paths ? null : {
        novelPath, unit: 'scene', redo: 'Also redo scenes that already have a synopsis',
        eligible: (sc, redo) => Number(sc.word_count) > 0 && (redo || !String(sc.synopsis || '').trim()),
      },
      run: async ({ signal, report, picked }) => {
        report('Reading your scenes…')
        const result = await window.quill.getSceneTexts(novelPath)
        if (!result?.ok) throw new Error(result?.error || 'Couldn’t read the scenes.')
        const want = paths ? new Set(paths) : picked
        const scenes = result.scenes.filter(sc => sc.text.trim() && want.has(sc.path))
        const groups = StoryAI.batches(scenes)
        const items = []
        for (const [n, group] of groups.entries()) {
          const label = groups.length > 1 ? `Reading part ${n + 1} of ${groups.length}` : `Reading ${group.length} scene${group.length === 1 ? '' : 's'}`
          report(label)
          const raw = await ask(StoryAI.synopsisMessages(group, { pov }), { signal, report, label, maxTokens: 80 * group.length + 300 })
          const lines = StoryAI.parseSynopses(raw, group.length)
          group.forEach((sc, i) => {
            if (!lines[i]) return
            items.push({ id: sc.path, label: titled(sc), meta: sc.synopsis ? 'replaces the synopsis it has' : '',
              fields: [{ key: 'synopsis', value: lines[i], rows: 2 }] })
          })
        }
        if (scenes.length && !items.length) throw new Error('the reply didn’t contain synopses I could read. Try again.')
        return items
      },
    })
    if (!picked) return 0
    let saved = 0
    for (const item of picked) {
      if (!item.values.synopsis) continue
      const r = await window.quill.updateSceneMeta({ rel: item.id, synopsis: item.values.synopsis }).catch(() => null)
      if (r?.ok) saved++
    }
    return saved
  }

  // ── Threads ─────────────────────────────────────────────────
  // Adds the accepted threads to the novel's list (ThreadsPanel's store). Returns how many.
  async function threads({ novelPath, existing = [], question = '' }) {
    let scenes = []
    const kindLabel = id => QuillThreads.KINDS.find(k => k.id === id)?.label || ''
    const picked = await preview({
      title: 'Find threads in your draft',
      intro: 'The questions your draft has the reader asking, with where each is raised and answered. Check them against what you meant: the AI can only see what’s on the page.',
      accept: 'Add to threads',
      empty: 'No new threads found.',
      scope: { novelPath, unit: 'scene', eligible: sc => Number(sc.word_count) > 0 },
      run: async ({ signal, report, picked }) => {
        report('Reading your scenes…')
        const result = await window.quill.getSceneTexts(novelPath)
        if (!result?.ok) throw new Error(result?.error || 'Couldn’t read the scenes.')
        scenes = result.scenes.filter(sc => sc.text.trim() && picked.has(sc.path))
        if (!scenes.length) return []
        const label = `Reading ${scenes.length} scene${scenes.length === 1 ? '' : 's'}`
        const raw = await ask(StoryAI.threadMessages(scenes, { existing, question }), { signal, report, label, maxTokens: 2400 })
        const found = StoryAI.parseThreads(raw, scenes.length).filter(t => !QuillThreads.isDuplicate(existing, t.text))
        if (!found.length && raw.trim() && !/thread/i.test(raw)) throw new Error('the reply didn’t contain threads I could read. Try again.')
        return found.map((t, i) => ({
          id: String(i), thread: t,
          label: [kindLabel(t.kind), t.raised >= 0 ? `raised in ${scenes[t.raised].title}` : ''].filter(Boolean).join(' · ') || 'Thread',
          meta: t.answered >= 0 ? `answered in ${scenes[t.answered].title}` : 'still open',
          fields: [{ key: 'text', value: t.text, rows: 1 }],
        }))
      },
    })
    if (!picked) return []
    const ref = i => i >= 0 && scenes[i] ? { path: scenes[i].path, title: scenes[i].title } : null
    return picked.filter(item => item.values.text).map(item => QuillThreads.make({
      text: item.values.text, kind: item.thread.kind,
      status: item.thread.answered >= 0 ? 'answered' : 'open',
      raised: ref(item.thread.raised), answered: ref(item.thread.answered),
    }))
  }

  // ── Timeline ────────────────────────────────────────────────
  // Suggests a timeline event for each chosen scene that has none yet: when, time of day, how
  // long, where, who, and which open threads it touches. Returns the events to add, linked to
  // their scenes (save-timeline turns scene_path into the scene's id).
  async function timeline({ novelPath, events = [], threads = [] }) {
    const linked = new Set(events.flatMap(e => [e.scene?.path, e.scene_path]).filter(Boolean))
    const threadTexts = threads.map(t => t.text).filter(t => String(t || '').trim())
    const lines = []
    const picked = await preview({
      title: 'Find timeline events in your draft',
      intro: 'For each scene with no event yet: when it happens, the time of day, how long, where and who’s there, as the text tells it. A real date lands on the calendar; “the next morning” or “three days later” lands in the trays, ready for you to place.',
      accept: 'Add to timeline',
      empty: 'No timeline details found in those scenes.',
      scope: { novelPath, unit: 'scene', eligible: sc => Number(sc.word_count) > 0 && !linked.has(sc.path) },
      run: async ({ signal, report, picked: want }) => {
        report('Reading your scenes…')
        const result = await window.quill.getSceneTexts(novelPath)
        if (!result?.ok) throw new Error(result?.error || 'Couldn’t read the scenes.')
        const all = result.scenes.filter(sc => sc.text.trim())
        const scenes = all.filter(sc => want.has(sc.path))
        const groups = StoryAI.batches(scenes)
        const items = []
        for (const [n, group] of groups.entries()) {
          const label = groups.length > 1 ? `Reading part ${n + 1} of ${groups.length}` : `Reading ${group.length} scene${group.length === 1 ? '' : 's'}`
          report(label)
          const prev = all[all.indexOf(group[0]) - 1]
          const raw = await ask(StoryAI.timelineMessages(group, { threads: threadTexts, before: prev ? `${prev.title}${prev.synopsis ? ` (${prev.synopsis})` : ''}` : '' }),
            { signal, report, label, maxTokens: 90 * group.length + 300 })
          const rows = StoryAI.parseTimeline(raw, group.length, threadTexts)
          group.forEach((sc, i) => {
            const r = rows[i]
            if (!r) return
            lines.push({ id: sc.path, scene: sc, row: r })
            items.push({ id: sc.path, label: titled(sc), meta: r.threads.length ? `touches: ${r.threads.join(', ')}` : '',
              fields: [
                { key: 'when', label: 'When', value: r.when },
                { key: 'time', label: 'Time of day', value: r.time },
                { key: 'duration', label: 'How long', value: r.duration },
                { key: 'location', label: 'Where', value: r.location },
                { key: 'characters', label: 'Who', value: r.characters.join(', ') },
              ] })
          })
        }
        if (scenes.length && !items.length) throw new Error('the reply didn’t contain timeline details I could read. Try again.')
        return items
      },
    })
    if (!picked) return []
    return picked.map(item => {
      const { scene, row } = lines.find(l => l.id === item.id)
      const v = item.values
      return {
        title: scene.title, description: scene.synopsis || '', scene_path: scene.path,
        when: v.when, time: v.time, duration: v.duration, location: v.location,
        characters: String(v.characters || '').split(',').map(x => x.trim()).filter(Boolean),
        threads: row.threads, placement: '',
      }
    })
  }

  // ── Bridge cards ────────────────────────────────────────────
  // ctx: { novelPath, recentPaths, now, threads, lighthouse, needs, cards, foundation }.
  // Returns [{ because, then, outcome }] for the cards the writer kept.
  async function bridgeCards(ctx) {
    const picked = await preview({
      title: 'Suggest scenes to get there',
      intro: 'Options built from your last scenes, your threads and your lighthouse. Keep the ones that spark something, and rewrite them in your own words.',
      accept: 'Add as scene cards',
      empty: 'No scenes suggested. Try again, or add a lighthouse first.',
      run: async ({ signal, report }) => {
        report('Reading your last scenes…')
        const result = await window.quill.getSceneTexts(ctx.novelPath)
        const want = new Set(ctx.recentPaths || [])
        const recent = (result?.scenes || []).filter(sc => want.has(sc.path))
        const raw = await ask(StoryAI.bridgeMessages({ ...ctx, recent }), { signal, report, label: 'Thinking through the gap', maxTokens: 1400 })
        const cards = StoryAI.parseCards(raw)
        if (!cards.length && raw.trim()) throw new Error('the reply didn’t contain scenes I could read. Try again.')
        return cards.map((c, i) => ({
          id: String(i), outcome: c.outcome, label: `Scene ${i + 1}`, meta: c.outcome,
          fields: [{ key: 'because', label: 'Because…', value: c.because, rows: 1 }, { key: 'then', label: 'So…', value: c.then, rows: 2 }],
        }))
      },
    })
    if (!picked) return []
    return picked.filter(item => item.values.then).map(item => ({ because: item.values.because, then: item.values.then, outcome: item.outcome }))
  }

  function init() {
    $('aip-cancel').onclick = () => close(null)
    $('aip-close').onclick = () => close(null)
    $('aip-accept').onclick = () => {
      if (!_open) return
      if (_open.phase === 'scope') _open.start(new Set(scopePicked().map(sc => sc.path)))
      else if (_open.phase === 'review') close(chosen())
    }
    $('aip-all').onclick = () => {
      if (_open?.phase === 'scope') {
        const on = !_open.chapters.filter(ch => scopeScenes(ch).length).every(ch => ch.on)
        _open.chapters.forEach(ch => { ch.on = on })
        renderScope()
        return
      }
      const boxes = [...$('aip-list').querySelectorAll('.aip-tick input')]
      const on = !boxes.every(b => b.checked)
      boxes.forEach(b => { b.checked = on; b.dispatchEvent(new Event('change')) })
    }
    $('ai-preview-modal').addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); close(null) } })
  }

  document.addEventListener('DOMContentLoaded', init)
  return { synopses, threads, timeline, bridgeCards, preview, isOpen: () => !!_open }
})()
