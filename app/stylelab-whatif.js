/* stylelab-whatif.js — the What If drill.
 *
 * Premise → write 200–800 words → reflect → scoped feedback → optional alternate take → save
 * as a non-canon rep in Style Lab/What If/. Fic Writer shows what a premise could look like;
 * What If makes the writer find out what these characters do. They may resist the premise.
 *
 * AI prose never comes before the writer's own read: feedback and "Show another approach" stay
 * locked until at least one reflection answer is written. Story context and the novel voice
 * reference come from the shared drawer (context-drawer.js, scope 'whatif').
 */
const WhatIf = (() => {
  const C = window.QuillAIContext
  const DRAFT_KEY   = 'quill_whatif_draft'
  const SEEDS_KEY   = 'quill_whatif_seeds'
  const PROMPTS_KEY = 'quill_whatif_prompts'
  const CATEGORIES  = ['mundane friction', 'emotional pressure', 'professional conflict', 'unexpected vulnerability', 'relationship escalation']

  // `context` names cards and scenes by title; they resolve against the chosen novel, and any
  // that don't are shown on the rep instead of dropped.
  const SEEDS = [
    { category: 'relationship escalation', premise: 'Kit and Anna end up alone in Betsy for twenty minutes, two nights after Crimson. Neither of them can leave.', context: ['Anna Dorsey', 'Kit Ward', 'Crimson'] },
    { category: 'relationship escalation', premise: 'Their first kiss, at exactly where things stand after Crimson. Either of them is allowed to stop it.', context: ['Anna Dorsey', 'Kit Ward', 'Crimson'] },
    { category: 'emotional pressure', premise: "It's Thursday. Anna is at Joe's, and Kit walks in the way he used to.", context: ['Anna Dorsey', 'Kit Ward', "Joe's"] },
    { category: 'emotional pressure', premise: 'Philip asks Anna, one more time, to sign the Execution Protocol.', context: ['Anna Dorsey', 'Philip Dorsey', 'Kit Ward'] },
    { category: 'mundane friction', premise: 'Anna and Moreno are stuck in a two-hour line at the DMV on a day off.', context: ['Anna Dorsey', 'Tara Moreno'] },
    { category: 'mundane friction', premise: 'Pepper gets out, and Kit is the one who finds her.', context: ['Anna Dorsey', 'Kit Ward'] },
    { category: 'professional conflict', premise: 'Moreno wants to bring Kit in for questioning about Jessica Andersen. Anna has to decide what to say.', context: ['Anna Dorsey', 'Tara Moreno', 'Kit Ward'] },
    { category: 'professional conflict', premise: 'Davidson asks Anna to sit on something he found on VeinConnect until after Philip\'s briefing.', context: ['Anna Dorsey', 'Davidson'] },
    { category: 'unexpected vulnerability', premise: 'Weiss calls Moreno from paternity leave in the middle of a stakeout, and Anna hears her side of it.', context: ['Anna Dorsey', 'Tara Moreno'] },
    { category: 'unexpected vulnerability', premise: 'Auguste visits Anna on the Mesa and is, for once, telling the truth.', context: ['Anna Dorsey', 'Auguste', 'Crimson'] },
    { category: 'unexpected vulnerability', premise: "Philip shows up at Anna's place at 2 AM and doesn't say why.", context: ['Anna Dorsey', 'Philip Dorsey'] },
  ]

  const DEFAULT_PROMPTS = {
    suggest: `You write premises for "What If", a character-discovery drill in a fiction writing app. A premise is one or two plain sentences that put specific characters from the novel into a situation and leave what they do open.

Rules:
- Use only characters, places and facts from the story reference material, and respect where the story currently stands.
- No outcomes, no interpretation, no plot summary. Set the situation and stop.
- Make each premise pressure a different part of the characters.
- Respond with exactly three lines, each in the form: CATEGORY | PREMISE
- CATEGORY is one of: ${CATEGORIES.join(', ')}.`,
    alternate: `Write one alternate interpretation of a "What If" premise for a novel.

The story reference material governs canon and how these characters behave. The novel voice reference, if present, governs the prose: match the manuscript's POV, narrative distance, sentence rhythm, dialogue style, humor, descriptive density and emotional restraint. Learn the craft profile; never reuse distinctive phrases or sentences from the reference.

Do not force the premise's payoff if these characters would plausibly resist it. This is another possible execution of the premise, not a corrected or preferred version. Write 200–800 words. Return only the scene: no title, no preface, no notes.`,
    feedbackFocus: '',
  }

  let rep = null          // the rep in progress (persisted as a draft)
  let ctx = null          // drawer handle for the current screen
  let suggestions = []
  let catFilter = ''
  let busy = ''
  let draftTimer = null

  const esc = s => escapeHtml(String(s == null ? '' : s))
  const kit = () => StyleLab.kit
  const inner = () => document.getElementById('stylelab-inner')

  function blank() {
    return { premise: '', category: '', missing: [], mine: '', doneWriting: false,
      reflection: { surprised: '', inevitable: '', learned: '' }, hypothesis: '', reflected: false,
      feedback: '', alternate: '', comparison: '', path: null, savedAt: null, dirty: false }
  }
  function loadDraft() {
    try { const d = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null'); return d && d.premise ? { ...blank(), ...d } : null } catch { return null }
  }
  function saveDraft(now) {
    clearTimeout(draftTimer)
    const write = () => { try { localStorage.setItem(DRAFT_KEY, JSON.stringify(rep)) } catch {} }
    if (now) write(); else draftTimer = setTimeout(write, 400)
  }
  function prompts() {
    let o = {}
    try { o = JSON.parse(localStorage.getItem(PROMPTS_KEY) || '{}') || {} } catch {}
    return { suggest: o.suggest || DEFAULT_PROMPTS.suggest, alternate: o.alternate || DEFAULT_PROMPTS.alternate, feedbackFocus: o.feedbackFocus || '' }
  }
  function savedSeeds() {
    try { return JSON.parse(localStorage.getItem(SEEDS_KEY) || '[]').filter(s => s && s.premise) } catch { return [] }
  }
  const reflectionText = r => C.REFLECTION.map(([k]) => (r.reflection[k] || '').trim()).filter(Boolean).length

  function attachCtx(btn, buildPreview) {
    ctx = QuillContext.attach(btn, { scope: 'whatif', label: 'What If', voiceKey: 'whatif', voiceDefault: true, buildPreview })
    return ctx
  }

  function open() {
    rep = loadDraft()
    if (rep) renderRep()
    else renderPremise()
  }

  // ── AI ──────────────────────────────────────────────────────
  // One streamed chat completion; resolves with the whole reply, throws with the API's message.
  async function streamChat(messages, maxTokens, onDelta) {
    if (!(await QuillAI.hasKey())) { QuillAI.askForKey(); throw new Error('No API key saved.') }
    const resp = await QuillAI.fetch({ method: 'POST', body: JSON.stringify({ model: StyleLab.resolvedModel(), max_tokens: maxTokens, stream: true, messages }) })
    if (!resp.ok) { const d = await resp.json().catch(() => ({})); throw new Error(d.error?.message || `HTTP ${resp.status}`) }
    const reader = resp.body.getReader()
    const decoder = new TextDecoder()
    let buf = '', out = ''
    const take = line => {
      if (!line.startsWith('data: ')) return
      const raw = line.slice(6).trim()
      if (!raw || raw === '[DONE]') return
      try { const d = JSON.parse(raw).choices?.[0]?.delta?.content || ''; if (d) { out += d; onDelta && onDelta(out) } } catch {}
    }
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      const lines = buf.split('\n')
      buf = lines.pop()
      lines.forEach(take)
    }
    take(buf)
    return out.trim()
  }

  async function novelBase() {
    const novelId = ctx ? await ctx.novel() : ''
    const n = novelId ? await window.quill.getNovelContext(novelId).catch(() => ({})) : {}
    return [n.title && `NOVEL: ${n.title}`, n.genre && `GENRE: ${n.genre}`, n.logline && `LOGLINE: ${n.logline}`, n.pov && `POV: ${n.pov}`]
      .filter(Boolean).join('\n')
  }

  async function suggestMessages(lean) {
    const b = ctx ? await ctx.blocks({ voice: false }) : { story: '' }
    const base = await novelBase()
    const taken = rep && rep.premise ? `\nDon't repeat: ${rep.premise}` : ''
    return [
      { role: 'system', content: prompts().suggest },
      ...(base ? [{ role: 'system', content: base }] : []),
      ...(b.story ? [{ role: 'system', content: b.story }] : []),
      { role: 'user', content: `Write three What If premises.${lean ? `\nLean toward: ${lean}` : ''}${taken}` },
    ]
  }

  async function feedbackMessages() {
    const settings = StyleLab.getSettings()
    const focus = prompts().feedbackFocus
    const drill = { ...kit().DRILLS['what-if'], ...(focus ? { feedbackFocus: focus } : {}) }
    const sys = kit().buildSystemPrompt(drill, null, settings.brutality || 'honest', settings.instructions)
    const b = ctx ? await ctx.blocks() : { story: '', voice: '' }
    const refl = C.REFLECTION.filter(([k]) => rep.reflection[k].trim()).map(([k, label]) => `${label}: ${rep.reflection[k].trim()}`).join('\n')
    return [
      { role: 'system', content: sys },
      ...(b.story ? [{ role: 'system', content: b.story }] : []),
      ...(b.voice ? [{ role: 'system', content: b.voice }] : []),
      { role: 'user', content: `PROMPT I WAS GIVEN:\nWhat if: ${rep.premise}\n\nMY WRITING:\n${rep.mine.trim() || '(not written yet)'}${refl ? `\n\nMY REFLECTION (written before any AI feedback):\n${refl}` : ''}` },
    ]
  }

  async function alternateMessages() {
    const b = ctx ? await ctx.blocks() : { story: '', voice: '' }
    return [
      { role: 'system', content: prompts().alternate },
      ...(b.story ? [{ role: 'system', content: b.story }] : []),
      ...(b.voice ? [{ role: 'system', content: b.voice }] : []),
      { role: 'user', content: `What if: ${rep.premise}` },
    ]
  }

  // ── premise screen ──────────────────────────────────────────
  async function renderPremise() {
    const el = inner()
    if (!el) return
    const seeds = [...savedSeeds().map(s => ({ ...s, mine: true })), ...SEEDS]
    const shown = seeds.filter(s => !catFilter || s.category === catFilter)
    el.innerHTML = `
      <button class="btn ghost sm page-back" id="wi-back">‹ Style Lab</button>
      <div class="page-head">
        <div class="kicker">What If</div>
        <div class="page-title it sl-prompt">Put them in a situation. Find out what they do.</div>
        <div class="page-sub">They're allowed to resist the premise. A rep where nothing happens because one of them won't let it can be the best one.</div>
      </div>

      <section class="section">
        <div class="section-label">Write my own<span class="section-actions"><button id="wi-ctx" title="Attach the characters and scenes that matter. Suggestions and feedback use them."></button></span></div>
        <textarea class="field" id="wi-own" rows="2" placeholder="What if… e.g. Moreno and Kit, alone in an elevator that stops between floors."></textarea>
        <div class="btn-row wi-row">
          <button class="btn primary" id="wi-own-go">Use this premise</button>
          <button class="btn" id="wi-own-seed" title="Keep it in the seed list, with the context chips attached right now">☆ Save as seed</button>
          <button class="btn ghost" id="wi-suggest" title="With text in the box, suggestions lean toward it.">${busy === 'suggest' ? 'Thinking…' : '✨ Suggest from context'}</button>
          <button class="btn ghost icon" id="wi-prompts" title="Edit the What If AI prompts" aria-label="Edit the What If AI prompts">⚙</button>
        </div>
        <div class="card-list" id="wi-suggestions">${suggestions.map((s, i) => `
          <button class="card wi-seed" data-sug="${i}"><span class="card-kicker">${esc(s.category)}</span><span class="card-title">${esc(s.premise)}</span></button>`).join('')}</div>
      </section>

      <section class="section">
        <div class="section-label">Seeds</div>
        <div class="chip-row wi-cats">${['', ...CATEGORIES].map(c => `<button class="chip${c === catFilter ? ' on' : ''}" data-cat="${esc(c)}">${esc(c || 'All')}</button>`).join('')}</div>
        <div class="card-list wi-seeds">${shown.map(s => `
          <div class="wi-seed-wrap">
            <button class="card wi-seed" data-seed="${esc(s.premise)}"><span class="card-kicker">${esc(s.category || 'my seed')}</span><span class="card-title">${esc(s.premise)}</span>
              ${(s.context || []).length ? `<span class="card-meta">${esc(s.context.join(' · '))}</span>` : ''}</button>
            ${s.mine ? `<button class="btn ghost sm icon card-x" data-unseed="${esc(s.premise)}" title="Remove this seed" aria-label="Remove this seed">✕</button>` : ''}
          </div>`).join('')}</div>
      </section>

      <section class="section">
        <div class="section-label">Past reps</div>
        <div class="wi-past" id="wi-past"><div class="hint">Loading…</div></div>
      </section>
    `
    const $ = s => el.querySelector(s)
    attachCtx($('#wi-ctx'), () => suggestMessages($('#wi-own')?.value.trim()))
    $('#wi-back').onclick = () => StyleLab.renderLanding()
    $('#wi-own-go').onclick = () => { const p = $('#wi-own').value.trim(); if (p) choosePremise({ premise: p, category: '' }) }
    $('#wi-own-seed').onclick = async () => {
      const p = $('#wi-own').value.trim()
      if (!p) return
      const b = await ctx.blocks({ voice: false })
      const list = savedSeeds().filter(s => s.premise !== p)
      list.unshift({ premise: p, category: '', context: b.items.filter(i => i.kind !== 'note' && i.kind !== 'selection').map(i => i.title) })
      try { localStorage.setItem(SEEDS_KEY, JSON.stringify(list.slice(0, 60))) } catch {}
      renderPremise()
    }
    $('#wi-suggest').onclick = async () => {
      if (busy) return
      busy = 'suggest'
      renderPremise()
      try {
        const reply = await streamChat(await suggestMessages(el.querySelector('#wi-own')?.value.trim()), 400)
        suggestions = reply.split('\n').map(line => {
          const m = line.replace(/^[\s\-*\d.)]+/, '').match(/^([^|]+)\|\s*(.+)$/)
          if (!m) return null
          const cat = m[1].trim().toLowerCase()
          return { category: CATEGORIES.includes(cat) ? cat : '', premise: m[2].trim() }
        }).filter(Boolean).slice(0, 3)
        if (!suggestions.length && reply) suggestions = [{ category: '', premise: reply.split('\n')[0] }]
      } catch (err) {
        suggestions = []
        alert(`Couldn't get suggestions: ${err.message}`)
      }
      busy = ''
      renderPremise()
    }
    $('#wi-prompts').onclick = openPromptSettings
    el.querySelectorAll('[data-sug]').forEach(b => { b.onclick = () => choosePremise(suggestions[+b.dataset.sug]) })
    el.querySelectorAll('[data-cat]').forEach(b => { b.onclick = () => { catFilter = b.dataset.cat; renderPremise() } })
    el.querySelectorAll('[data-seed]').forEach(b => { b.onclick = () => choosePremise(seeds.find(s => s.premise === b.dataset.seed)) })
    el.querySelectorAll('[data-unseed]').forEach(b => { b.onclick = () => {
      try { localStorage.setItem(SEEDS_KEY, JSON.stringify(savedSeeds().filter(s => s.premise !== b.dataset.unseed))) } catch {}
      renderPremise()
    } })
    renderPast()
  }

  async function renderPast() {
    const box = document.getElementById('wi-past')
    if (!box) return
    const reps = await window.quill.listWhatIfReps().catch(() => [])
    if (!document.getElementById('wi-past')) return
    box.innerHTML = reps.slice(0, 12).map(r => `
      <button class="wi-past-row" data-path="${esc(r.path)}">
        <span class="wi-past-title">${esc(r.title)}</span>
        <span class="hint">${esc([r.date, r.characters].filter(Boolean).join(' · '))}</span>
      </button>`).join('') || '<div class="hint">No reps yet.</div>'
    box.querySelectorAll('[data-path]').forEach(b => { b.onclick = () => viewRep(b.dataset.path) })
  }

  async function choosePremise(seed) {
    if (!seed || !seed.premise) return
    rep = { ...blank(), premise: seed.premise, category: seed.category || '' }
    suggestions = []
    if (ctx) {
      const items = await ctx.items()
      const fromSeed = C.resolveTitles(seed.context || [], items)
      const named = C.matchCharacters(seed.premise, items)
      const ids = [...new Set([...fromSeed.found, ...named].map(i => i.id))]
      if (ids.length) await ctx.add(ids)
      rep.missing = fromSeed.missing
    }
    saveDraft(true)
    renderRep()
  }

  // ── the rep ─────────────────────────────────────────────────
  function renderRep() {
    const el = inner()
    if (!el || !rep) return
    const settings = StyleLab.getSettings()
    const { BRUTALITY_LEVELS, BRUTALITY_LABELS } = kit()
    const words = C.wordCount(rep.mine)
    const wcNote = words < 200 ? `${words} words · aim for 200–800` : words > 800 ? `${words} words · over 800, fine if it needed it` : `${words} words`
    const showReflect = rep.doneWriting || rep.reflected
    const unlocked = rep.reflected
    const fb = rep.feedback ? kit().parseFeedback(rep.feedback) : null

    el.innerHTML = `
      <div class="btn-row page-back">
        <button class="btn ghost sm" id="wi-back">‹ Style Lab</button>
        <span class="sl-spacer"></span>
        <button class="btn sm" id="wi-new">New What If</button>
      </div>
      <div class="page-head">
        <div class="kicker">What If${rep.category ? ` · ${esc(rep.category)}` : ''}</div>
        <div class="page-title it long sl-prompt">${esc(rep.premise)}</div>
        ${rep.missing.length ? `<div class="wi-missing">Not found in this novel: ${esc(rep.missing.join(', '))}. Add them from Context if they matter.</div>` : ''}
      </div>

      <section class="section">
        <div class="section-label">Your scene<span class="section-actions"><button id="wi-ctx" title="What the AI will know when it reads your scene."></button></span></div>
        <textarea class="field sl-writer" id="wi-mine" placeholder="${esc(kit().DRILLS['what-if'].writerPlaceholder)}" spellcheck="true">${esc(rep.mine)}</textarea>
        <div class="btn-row wi-row">
          ${showReflect ? '' : `<button class="btn primary" id="wi-done-writing"${words ? '' : ' disabled'}>Done writing → reflect</button>`}
          <span class="hint subtle sl-wc" id="wi-wc">${wcNote}</span>
        </div>
      </section>

      ${showReflect ? `
      <section class="section">
        <div class="section-label">Reflect first</div>
        <p class="hint">Before any AI reads it. At least one answer unlocks feedback and another take.</p>
        ${C.REFLECTION.map(([k, label]) => `
          <label class="sl-set-lbl">${esc(label)}</label>
          <textarea class="field" data-refl="${k}" rows="2">${esc(rep.reflection[k])}</textarea>`).join('')}
        <label class="sl-set-lbl">Character hypothesis (optional) · saved with the rep as provisional, never written to a card</label>
        <textarea class="field" id="wi-hyp" rows="2" placeholder="e.g. Kit protects people by leaving before they can ask him to stay.">${esc(rep.hypothesis)}</textarea>
        ${unlocked ? '' : `<div class="btn-row wi-row"><button class="btn primary" id="wi-lock"${reflectionText(rep) ? '' : ' disabled'}>Done reflecting</button></div>`}
      </section>
      ` : ''}

      ${unlocked ? `
      <div class="btn-row wi-actions">
        <button class="btn" id="wi-feedback"${busy ? ' disabled' : ''}>${busy === 'feedback' ? 'Reading…' : rep.feedback ? 'Feedback again' : 'Get feedback'}</button>
        <select class="field auto wi-brut" id="wi-brut" title="How hard feedback pushes">${BRUTALITY_LEVELS.map(l => `<option value="${l}"${l === (settings.brutality || 'honest') ? ' selected' : ''}>${BRUTALITY_LABELS[l]}</option>`).join('')}</select>
        <button class="btn" id="wi-alt"${busy ? ' disabled' : ''}>${busy === 'alternate' ? 'Writing…' : rep.alternate ? 'Another take again' : 'Show another approach'}</button>
        <span class="sl-spacer"></span>
        <button class="btn primary" id="wi-save">${rep.path ? (rep.dirty ? 'Save changes' : '✓ Saved') : 'Save rep'}</button>
      </div>
      ${rep.path ? `<div class="hint wi-hint wi-saved">Saved to ${esc(rep.path)}. It's an experiment: <code>canon: false</code>, never part of the manuscript.</div>` : '<div class="hint wi-hint wi-saved">The rep is complete without feedback or another take.</div>'}
      <div id="wi-fb">${fb ? `<section class="section sl-feedback"><div class="section-label">Feedback</div>${kit().feedbackCoreHTML(fb, rep.feedback)}</section>` : ''}</div>
      <div id="wi-altwrap">${rep.alternate ? altHTML() : ''}</div>
      ` : ''}
    `

    const $ = s => el.querySelector(s)
    attachCtx($('#wi-ctx'), () => (rep.reflected && rep.alternate && !rep.feedback ? alternateMessages() : feedbackMessages()))
    $('#wi-back').onclick = () => { saveDraft(true); StyleLab.renderLanding() }
    $('#wi-new').onclick = async () => {
      if (rep.mine.trim() && !rep.path && !confirm('Start a new What If? This rep hasn\'t been saved.')) return
      rep = null
      try { localStorage.removeItem(DRAFT_KEY) } catch {}
      await ctx?.clear()
      renderPremise()
    }
    const ta = $('#wi-mine')
    ta.oninput = () => {
      rep.mine = ta.value
      rep.dirty = true
      const n = C.wordCount(rep.mine)
      $('#wi-wc').textContent = n < 200 ? `${n} words · aim for 200–800` : n > 800 ? `${n} words · over 800, fine if it needed it` : `${n} words`
      const done = $('#wi-done-writing')
      if (done) done.disabled = !n
      saveDraft()
    }
    $('#wi-done-writing')?.addEventListener('click', () => { rep.doneWriting = true; saveDraft(true); renderRep(); el.querySelector('[data-refl]')?.focus() })
    el.querySelectorAll('[data-refl]').forEach(t => {
      t.oninput = () => {
        rep.reflection[t.dataset.refl] = t.value
        rep.dirty = true
        const lock = $('#wi-lock')
        if (lock) lock.disabled = !reflectionText(rep)
        saveDraft()
      }
    })
    const hyp = $('#wi-hyp')
    if (hyp) hyp.oninput = () => { rep.hypothesis = hyp.value; rep.dirty = true; saveDraft() }
    $('#wi-lock')?.addEventListener('click', () => { if (reflectionText(rep)) { rep.reflected = true; saveDraft(true); renderRep() } })
    if (!unlocked) return

    $('#wi-brut').onchange = e => { const s = StyleLab.getSettings(); s.brutality = e.target.value; kit().saveSettings(s) }
    $('#wi-feedback').onclick = runFeedback
    $('#wi-alt').onclick = runAlternate
    $('#wi-save').onclick = saveRep
    const cmp = $('#wi-cmp')
    if (cmp) cmp.oninput = () => { rep.comparison = cmp.value; rep.dirty = true; saveDraft(); const sv = $('#wi-save'); if (sv && rep.path) sv.textContent = 'Save changes' }
  }

  function altHTML() {
    return `
      <section class="section">
        <div class="section-label">Another approach</div>
        <p class="hint">One other way this book could have handled it. Not a correction.</p>
        <div class="wi-compare">
          <div><div class="kicker">Mine</div><div class="wi-prose">${esc(rep.mine)}</div></div>
          <div><div class="kicker">Another approach</div><div class="wi-prose" id="wi-alt-text">${esc(rep.alternate)}</div></div>
        </div>
        <label class="sl-set-lbl">What did the alternate choose differently? Would that strengthen or weaken yours, and why?</label>
        <textarea class="field" id="wi-cmp" rows="3">${esc(rep.comparison)}</textarea>
      </section>`
  }

  async function runFeedback() {
    if (busy || !rep.reflected) return
    busy = 'feedback'
    renderRep()
    const box = () => document.getElementById('wi-fb')
    try {
      const reply = await streamChat(await feedbackMessages(), 900, partial => {
        const b = box()
        if (b) b.innerHTML = `<section class="section sl-feedback"><div class="section-label">Feedback</div><div class="sl-fb-text pre">${esc(partial)}</div></section>`
      })
      rep.feedback = reply
      rep.dirty = true
      ctx?.consumed()
    } catch (err) {
      busy = ''
      renderRep()
      const b = box()
      if (b) b.innerHTML = `<section class="section sl-feedback"><div class="section-label">Feedback</div><p class="sl-fb-error">Feedback failed: ${esc(err.message)}</p></section>`
      return
    }
    busy = ''
    saveDraft(true)
    renderRep()
  }

  async function runAlternate() {
    if (busy || !rep.reflected) return
    busy = 'alternate'
    rep.alternate = rep.alternate || ''
    renderRep()
    const wrap = document.getElementById('wi-altwrap')
    if (wrap) wrap.innerHTML = altHTML()
    try {
      const reply = await streamChat(await alternateMessages(), 1600, partial => {
        const t = document.getElementById('wi-alt-text')
        if (t) t.textContent = partial
      })
      rep.alternate = reply
      rep.dirty = true
      ctx?.consumed()
    } catch (err) {
      busy = ''
      renderRep()
      alert(`Couldn't write another approach: ${err.message}`)
      return
    }
    busy = ''
    saveDraft(true)
    renderRep()
  }

  async function saveRep() {
    if (rep.path && !rep.dirty) return
    const b = ctx ? await ctx.blocks() : { items: [], voice: '', voiceRef: null, novelId: '' }
    const first = !rep.path
    const res = await window.quill.saveWhatIfRep({
      path: rep.path,
      premise: rep.premise, category: rep.category, mine: rep.mine,
      reflection: rep.reflection, hypothesis: rep.hypothesis,
      feedback: rep.feedback, alternate: rep.alternate, comparison: rep.comparison,
      context: b.items.map(i => ({ id: i.id, title: i.title, kind: i.kind, source: i.source, hash: i.hash })),
      voice: b.voice ? { auto: !!b.voiceRef?.auto, hash: C.hash(b.voice) } : null,
      inputTokens: C.requestTokens(await feedbackMessages()),
      novelTitle: (b.novelId || '').split('/').pop(),
      model: StyleLab.resolvedModel(),
    }).catch(err => ({ ok: false, error: err.message }))
    if (!res.ok) { alert(res.error || 'Could not save the rep.'); return }
    rep.path = res.path
    rep.dirty = false
    rep.savedAt = Date.now()
    if (first) kit().bumpStats()
    saveDraft(true)
    renderRep()
  }

  // ── past reps ───────────────────────────────────────────────
  async function viewRep(path) {
    const file = await window.quill.getFile(path).catch(() => null)
    const el = inner()
    if (!file || !el) return
    const body = String(file.body || '')
    const recorded = C.parseWhatIfContext(body)
    // Drift is only meaningful against the same novel the rep was run on.
    const novelId = ctx ? await ctx.novel() : ''
    const sameNovel = !file.meta?.novel || novelId.split('/').pop() === file.meta.novel
    const drift = sameNovel && ctx ? C.driftedItems(recorded, await ctx.items()) : []
    const premise = (body.match(/## Premise\n\n([\s\S]*?)(?:\n## |\s*$)/) || [])[1]?.trim() || ''
    const sections = body.split(/\n(?=## )/).map(sec => {
      const m = sec.match(/^## (.+)\n+([\s\S]*)$/)
      return m ? `<section class="section"><div class="section-label">${esc(m[1])}</div><div class="wi-prose">${esc(m[2].trim())}</div></section>` : ''
    }).join('')
    el.innerHTML = `
      <div class="btn-row page-back">
        <button class="btn ghost sm" id="wi-back">‹ What If</button>
        <span class="sl-spacer"></span>
        ${premise ? '<button class="btn sm" id="wi-again">Run this premise again</button>' : ''}
      </div>
      <div class="kicker">What If · ${esc(file.meta?.date || '')}${file.meta?.novel ? ` · ${esc(file.meta.novel)}` : ''}</div>
      ${drift.length ? `<div class="wi-missing">Changed since this rep: ${esc(drift.map(d => `${d.title}${d.missing ? ' (no longer found)' : ''}`).join(', '))}. The feedback and alternate were based on the older version.</div>` : ''}
      ${sections}`
    el.querySelector('#wi-back').onclick = renderPremise
    el.querySelector('#wi-again')?.addEventListener('click', () => choosePremise({ premise, category: file.meta?.category || '', context: recorded.map(r => r.title) }))
  }

  // ── prompt settings ─────────────────────────────────────────
  function openPromptSettings() {
    const p = prompts()
    const ov = document.createElement('div')
    ov.className = 'overlay show'
    ov.innerHTML = `<div class="modal sl-settings-modal">
      <h3>What If — AI prompts</h3>
      <label class="sl-set-lbl sl-set-modal-first">Suggest from context</label>
      <textarea class="field" id="wi-p-suggest" rows="8">${esc(p.suggest)}</textarea>
      <label class="sl-set-lbl">Another approach</label>
      <textarea class="field" id="wi-p-alt" rows="8">${esc(p.alternate)}</textarea>
      <label class="sl-set-lbl">Feedback focus</label>
      <div class="sl-set-hint">Added to Style Lab's feedback format and the four What If checks. Empty uses the default.</div>
      <textarea class="field" id="wi-p-fb" rows="4" placeholder="${esc(kit().DRILLS['what-if'].feedbackFocus)}">${esc(p.feedbackFocus)}</textarea>
      <div class="modal-btns sl-dg-btns">
        <button class="btn ghost" id="wi-p-reset">Reset to defaults</button>
        <div class="btn-row">
          <button class="btn" id="wi-p-cancel">Cancel</button>
          <button class="btn primary" id="wi-p-save">Save</button>
        </div>
      </div></div>`
    document.body.appendChild(ov)
    const $ = s => ov.querySelector(s)
    $('#wi-p-cancel').onclick = () => ov.remove()
    $('#wi-p-reset').onclick = () => { try { localStorage.removeItem(PROMPTS_KEY) } catch {}; ov.remove() }
    $('#wi-p-save').onclick = () => {
      const v = (id, def) => { const t = $(id).value.trim(); return t && t !== def.trim() ? t : '' }
      try {
        localStorage.setItem(PROMPTS_KEY, JSON.stringify({
          suggest: v('#wi-p-suggest', DEFAULT_PROMPTS.suggest), alternate: v('#wi-p-alt', DEFAULT_PROMPTS.alternate), feedbackFocus: $('#wi-p-fb').value.trim(),
        }))
      } catch {}
      ov.remove()
    }
  }

  return { open, SEEDS, CATEGORIES }
})()
