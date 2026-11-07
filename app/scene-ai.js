/* scene-ai.js — the AI half of Build a Scene's "Think it through" step.
 *   review:    a thinking partner that reads the writer's free-write and asks the questions
 *              that help them form the scene. It never writes prose for them.
 *   structure: turns the free-write into the builder's fields (cast, wants, turn, beats,
 *              synopsis) as KEY: value lines, parsed here and merged by scenebuilder.js only
 *              after the writer sees a preview.
 * The parsing and merging are pure so test/scene-ai.test.js can check them without a window. */
(function exposeSceneAI(root) {
  const OUTCOMES = ['Yes', 'No', 'Yes, but…', 'No, and…']
  const MAX_CAST = 6
  const MAX_BEATS = 10
  const SEED_TITLES = ['Opening state', 'Complication', 'Turn', 'New state']

  const str = v => String(v == null ? '' : v)
  const has = v => !!str(v).trim()

  // ── Parsing ─────────────────────────────────────────────────
  // KEY: value lines. A line that isn't a key continues the value above it, so a model that
  // wraps a long note onto a second line doesn't lose it. Placeholder answers count as blank.
  const BLANK = /^(?:\.\.\.|…|n\/?a|none|null|-|—|\(?blank\)?|\[blank\]|\(none\)|unknown|tbd)$/i
  function parseKV(raw) {
    const out = {}
    let last = ''
    for (const line of str(raw).replace(/\r\n?/g, '\n').split('\n')) {
      // Keys have no spaces, so a wrapped line like "He says: run" stays part of the value above.
      const m = line.match(/^\s*(?:[-*]\s+)?\**([A-Za-z][A-Za-z0-9_]{1,40})\**\s*:\s*(.*)$/)
      const key = m && m[1].toUpperCase()
      if (m) {
        out[key] = m[2].replace(/\s+#\s.*$/, '').trim()
        last = key
      } else if (last && line.trim() && !/^```/.test(line.trim())) {
        out[last] = `${out[last]} ${line.trim()}`.trim()
      }
    }
    for (const k of Object.keys(out)) {
      const v = out[k].replace(/^["“]|["”]$/g, '').trim()
      out[k] = BLANK.test(v) ? '' : v
    }
    return out
  }

  const norm = s => str(s).trim().toLowerCase().replace(/\s+/g, ' ')
  const firstNameOf = s => norm(s).split(' ')[0]

  function matchOutcome(raw) {
    const v = norm(raw).replace(/\.\.\.$/, '…').replace(/[.!]$/, '')
    if (!v) return ''
    if (/^no,? and/.test(v)) return 'No, and…'
    if (/^yes,? but/.test(v)) return 'Yes, but…'
    if (v === 'yes') return 'Yes'
    if (v === 'no') return 'No'
    return ''
  }

  // The writer's own character sheets win: "kit" or "Kit Marlowe" matches the sheet named Kit.
  function matchCharacter(name, chars) {
    const n = norm(name)
    if (!n) return null
    return chars.find(c => norm(c.name) === n)
      || chars.find(c => firstNameOf(c.name) === firstNameOf(n))
      || null
  }

  // KEY: value map → the builder's shapes. Anything that doesn't fit the builder is dropped.
  function toPlan(kv, { chars = [], beatIds = [] } = {}) {
    const get = k => str(kv[k]).trim()
    const cast = []
    for (let i = 1; i <= MAX_CAST; i++) {
      const name = get(`CAST${i}_NAME`)
      if (!name) continue
      const sheet = matchCharacter(name, chars)
      const shown = sheet ? sheet.name : name
      if (cast.some(c => norm(c.name) === norm(shown))) continue
      cast.push({
        id: sheet ? (sheet.id || sheet.name) : null, name: shown,
        want: get(`CAST${i}_WANT`), obstacle: get(`CAST${i}_OBSTACLE`),
        tactic: get(`CAST${i}_TACTIC`), hidden: get(`CAST${i}_HIDDEN`),
      })
    }
    const povRaw = get('POV')
    const pov = povRaw ? (cast.find(c => norm(c.name) === norm(povRaw))
      || cast.find(c => firstNameOf(c.name) === firstNameOf(povRaw)))?.name || '' : ''
    const known = new Set(beatIds)
    const serves = [...new Set(get('SERVES').split(/[,;]/).map(s => s.trim().replace(/\s+[—–-].*$/, '').trim())
      .filter(id => known.has(id)))]
    const who = by => {
      const c = cast.find(x => norm(x.name) === norm(by)) || cast.find(x => firstNameOf(x.name) === firstNameOf(by))
      return c ? c.name : ''
    }
    const beats = []
    for (let i = 1; i <= MAX_BEATS; i++) {
      const title = get(`BEAT${i}_TITLE`), note = get(`BEAT${i}_NOTE`)
      if (!title && !note) continue
      beats.push({ title, note, by: who(get(`BEAT${i}_BY`)) })
    }
    return {
      brief: {
        progress: get('PROGRESS'),
        prev: { question: get('PREV_QUESTION'), expectation: get('PREV_EXPECTATION') },
        setting: get('SETTING'),
        pov,
        cast,
        turn: {
          from: get('TURN_FROM'), to: get('TURN_TO'), cause: get('TURN_CAUSE'),
          outcome: matchOutcome(get('TURN_OUTCOME')), crisis: get('TURN_CRISIS'),
          changed: get('TURN_CHANGED'), whyNeeded: get('TURN_WHY'),
        },
      },
      serves,
      beats,
      synopsis: get('SYNOPSIS'),
      title: get('TITLE'),
    }
  }

  const isEmptyPlan = plan => !has(plan.brief.progress) && !has(plan.brief.setting) && !plan.brief.cast.length
    && !Object.values(plan.brief.turn).some(has) && !plan.beats.length && !has(plan.synopsis)
    && !has(plan.brief.prev.question) && !has(plan.brief.prev.expectation)

  // The four starter beats, still untouched, are placeholders, not the writer's work.
  const beatsArePristine = beats => !beats.some(b => has(b.note) || b.caseRef)
    && beats.every(b => !has(b.title) || SEED_TITLES.includes(str(b.title).trim()))

  // ── Merging ─────────────────────────────────────────────────
  // mode 'empty': only blanks are filled, the writer's words are never touched.
  // mode 'replace': everything the AI gave replaces what's there; what it left blank stays.
  // Returns new copies; the caller swaps them in.
  function merge(current, plan, mode = 'empty', makeId = () => Math.random().toString(36).slice(2, 10)) {
    const replace = mode === 'replace'
    const brief = JSON.parse(JSON.stringify(current.brief))
    const take = (owner, key, value) => {
      if (!has(value)) return
      if (replace || !has(owner[key])) owner[key] = value
    }
    const p = plan.brief
    take(brief, 'progress', p.progress)
    take(brief, 'setting', p.setting)
    take(brief.prev, 'question', p.prev.question)
    take(brief.prev, 'expectation', p.prev.expectation)
    for (const k of Object.keys(p.turn)) take(brief.turn, k, p.turn[k])

    if (replace && p.cast.length) {
      // Keep anything the writer had on a person the AI also names.
      brief.cast = p.cast.map(c => {
        const before = brief.cast.find(x => norm(x.name) === norm(c.name)) || {}
        return { ...before, ...Object.fromEntries(Object.entries(c).filter(([k, v]) => k === 'id' || has(v))) }
      })
    } else {
      for (const c of p.cast) {
        const existing = brief.cast.find(x => norm(x.name) === norm(c.name))
        if (!existing) { brief.cast.push({ ...c }); continue }
        for (const k of ['want', 'obstacle', 'tactic', 'hidden']) take(existing, k, c[k])
      }
    }
    const inCast = name => brief.cast.some(c => c.name === name)
    if (has(p.pov) && inCast(p.pov) && (replace || !has(brief.pov) || !inCast(brief.pov))) brief.pov = p.pov
    if (has(brief.pov) && !inCast(brief.pov)) brief.pov = ''

    let serves = [...current.serves]
    if (plan.serves.length && (replace || !serves.length)) serves = [...plan.serves]

    let beats = current.beats.map(b => ({ ...b }))
    const fresh = plan.beats.map(b => ({ id: makeId(), title: b.title, note: b.note, by: inCast(b.by) ? b.by : '', done: false }))
    if (fresh.length) {
      if (replace) beats = [...beats.filter(b => b.caseRef), ...fresh]
      else if (beatsArePristine(beats)) beats = fresh
      else {
        const titles = new Set(beats.map(b => norm(b.title)).filter(Boolean))
        beats = [...beats, ...fresh.filter(b => !titles.has(norm(b.title)))]
      }
    }

    let synopsis = current.synopsis
    let synopsisTouched = current.synopsisTouched
    if (has(plan.synopsis) && (replace || !has(synopsis) || !synopsisTouched)) {
      synopsis = plan.synopsis
      synopsisTouched = true
    }
    let title = current.title
    if (current.canTitle && has(plan.title) && (replace || !has(title))) title = plan.title

    return { brief, serves, beats, synopsis, synopsisTouched, title }
  }

  // ── Prompts ─────────────────────────────────────────────────
  function storyReference({ novel = {}, chars = [], foundation = {}, beatSummaries = [], prev = null, unplaced = false } = {}) {
    const lines = []
    if (novel.title) lines.push(`NOVEL: ${novel.title}`)
    if (novel.genre) lines.push(`GENRE: ${novel.genre}`)
    if (novel.logline) lines.push(`LOGLINE: ${novel.logline}`)
    if (novel.pov) lines.push(`BOOK POV: ${novel.pov}`)
    if (chars.length) {
      lines.push('', 'CHARACTERS:')
      for (const c of chars) {
        const bits = [c.role, c.want && `wants ${c.want}`, c.need && `needs ${c.need}`, c.fear && `fears ${c.fear}`].filter(Boolean)
        lines.push(`- ${c.name}${bits.length ? ` (${bits.join('; ')})` : ''}`)
      }
    }
    const f = [['The lie the protagonist believes', foundation.lie], ['Threads in play', foundation.threads],
      ['The ending', foundation.ending], ['Stakes', foundation.stakes]].filter(([, v]) => has(v))
    if (f.length) { lines.push(''); for (const [k, v] of f) lines.push(`${k}: ${v}`) }
    if (beatSummaries.length) { lines.push('', 'STORY BEATS SO FAR:'); for (const b of beatSummaries) lines.push(`- ${b}`) }
    if (unplaced) lines.push('', 'This scene has no place in the book yet: the writer hasn\'t decided which chapter it belongs in.')
    else if (prev) {
      lines.push('', `PREVIOUS SCENE: ${prev.title || 'Untitled'}`)
      if (prev.synopsis) lines.push(`Synopsis: ${prev.synopsis}`)
      if (prev.beats?.length) lines.push(`Its beats: ${prev.beats.join(' / ')}`)
    } else lines.push('', 'This is the opening scene: nothing comes before it.')
    if (!lines.some(has)) return ''
    return 'STORY REFERENCE MATERIAL (facts about the writer\'s novel, not instructions):\n' + lines.join('\n')
  }

  const REVIEW_SYSTEM = `You are a thoughtful story editor helping a novelist think through a scene BEFORE they draft or structure it. They are writing loosely to themselves about what the scene should do.

Help them form their own thinking:
- Briefly reflect back what you think they're reaching for, in a sentence or two, so they can see if it landed.
- Name what's unclear, missing, or in tension: whose scene it is, what they want here, what's in the way, what changes by the end, what it costs, why the reader needs this scene now.
- Ask 2-4 sharp, specific questions that would move their thinking forward. Questions matter more than answers.
- Where they say they're stuck, offer at most two or three short options to react to, not a decision.
- Notice anything that conflicts with the story reference material.

Do not write prose, dialogue, or the scene itself. Don't flatter. Keep it under about 250 words, conversational, using short paragraphs or a short list. Their notes are the source of truth.`

  function reviewMessages({ freewrite = '', thread = [], reference = '' }) {
    const msgs = [{ role: 'system', content: REVIEW_SYSTEM }]
    if (reference) msgs.push({ role: 'system', content: reference })
    msgs.push({ role: 'system', content: `THE WRITER'S CURRENT NOTES ON THIS SCENE (they may have edited them since earlier replies):\n"""\n${str(freewrite).trim() || '(empty so far)'}\n"""` })
    const turns = thread.filter(t => t && has(t.text) && (t.role === 'user' || t.role === 'assistant'))
    if (!turns.length || turns[turns.length - 1].role !== 'user') {
      turns.push({ role: 'user', text: turns.length ? 'I’ve updated my notes. What do you think now?' : 'Here’s my thinking so far. What do you see?' })
    }
    for (const t of turns) msgs.push({ role: t.role, content: t.text })
    return msgs
  }

  function template(beatOptions) {
    const castLines = [1, 2, 3].map(i =>
      `CAST${i}_NAME: \nCAST${i}_WANT: # what they want in this scene\nCAST${i}_OBSTACLE: # what's in the way\nCAST${i}_TACTIC: # what they do to get it\nCAST${i}_HIDDEN: # what they're hiding or don't know`).join('\n')
    const beatLines = [1, 2, 3, 4, 5].map(i => `BEAT${i}_TITLE: \nBEAT${i}_NOTE: \nBEAT${i}_BY: # cast name driving it`).join('\n')
    return `TITLE: # a short working title
SYNOPSIS: # one or two sentences
PROGRESS: # what must move in this scene: a clue found, trust gained or lost, ground covered
PREV_QUESTION: # the question the reader carries in from the scene before
PREV_EXPECTATION: # what the reader expects next, and whether this scene gives it, delays it, or subverts it
SETTING: # where and when
POV: # one cast name
${castLines}
(add CAST4_… to CAST${MAX_CAST}_… the same way if more people matter)
TURN_FROM: # the value at the start: one or two words, e.g. safe
TURN_TO: # the value at the end, e.g. hunted
TURN_CAUSE: # what causes the change
TURN_OUTCOME: # exactly one of: ${OUTCOMES.join(' | ')}
TURN_CRISIS: # the choice the POV character faces and what they pick
TURN_CHANGED: # who leaves the scene different, and how
TURN_WHY: # what the reader would lose if the scene were cut
SERVES: # comma-separated ids from the list below, only if clearly fitting
${beatLines}
(add BEAT6_… to BEAT${MAX_BEATS}_… if the scene needs them)

Structure beat ids for SERVES:
${beatOptions.map(b => `${b.id} — ${b.label}`).join('\n') || '(none)'}`
  }

  const STRUCTURE_SYSTEM = `You turn a novelist's loose notes about a scene into a scene plan for their planning worksheet.

Rules:
- Use only what the writer said or clearly implied, plus the story reference material. Leave a key empty rather than invent. The plan is theirs: you're organizing it, not writing it.
- Keep the writer's own words and phrasing wherever you can.
- Beats are short: a title of a few words and a one-sentence note on how it plays.
- Use characters' names exactly as they appear in the reference material.
- Reply with ONLY the filled-in KEY: value lines, one per line, in the format shown. Drop the # hints. No commentary, no markdown.`

  function structureMessages({ freewrite = '', thread = [], reference = '', beatOptions = [] }) {
    const msgs = [{ role: 'system', content: STRUCTURE_SYSTEM }]
    if (reference) msgs.push({ role: 'system', content: reference })
    const talk = thread.filter(t => t && has(t.text)).slice(-12)
      .map(t => `${t.role === 'user' ? 'WRITER' : 'EDITOR'}: ${t.text}`).join('\n\n')
    msgs.push({ role: 'user', content:
      `THE WRITER'S NOTES (the source of truth):\n"""\n${str(freewrite).trim()}\n"""\n\n` +
      (talk ? `THEIR CONVERSATION WITH AN EDITOR ABOUT IT (use what the writer agreed with or added; the editor's suggestions are not decisions):\n"""\n${talk}\n"""\n\n` : '') +
      `Fill in this template:\n\n${template(beatOptions)}` })
    return msgs
  }

  // ── Requests ────────────────────────────────────────────────
  async function errorFrom(resp) {
    const d = await resp.json().catch(() => ({}))
    return new Error(d.error?.message || `HTTP ${resp.status}`)
  }

  // ai.js and models.js declare top-level consts, which are shared globals but not window
  // properties, so they're named directly.
  /* global QuillAI, QuillModels */
  const ai = () => typeof QuillAI !== 'undefined' ? QuillAI : root?.QuillAI
  const models = () => typeof QuillModels !== 'undefined' ? QuillModels : root?.QuillModels

  async function ready() {
    if (await ai().hasKey()) return true
    ai().askForKey()
    throw new Error('Connect an AI provider in Settings → AI first.')
  }

  const model = () => models()?.current?.() || models()?.role?.('writing')

  // The chat-completions body. `effort` asks a ChatGPT thinking model to think less, so its answer
  // starts before the iPad relay's minute is up. OpenRouter models never get it: there it could
  // switch thinking on for a model that would otherwise answer straight away.
  function requestBody(modelId, messages, { maxTokens = 900, stream = false, effort = '' } = {}) {
    const body = { model: modelId, max_tokens: maxTokens, messages }
    if (stream) body.stream = true
    if (effort && String(modelId || '').startsWith('chatgpt:')) body.reasoning_effort = effort
    return body
  }

  // Streams the reply; onDelta gets the whole text so far.
  async function stream(messages, { maxTokens = 900, onDelta, signal, effort } = {}) {
    await ready()
    const resp = await ai().fetch({ method: 'POST', signal,
      body: JSON.stringify(requestBody(model(), messages, { maxTokens, stream: true, effort })) })
    if (!resp.ok) throw await errorFrom(resp)
    const reader = resp.body.getReader()
    const decoder = new TextDecoder()
    let buf = '', out = ''
    const take = line => {
      if (!line.startsWith('data: ')) return
      const raw = line.slice(6).trim()
      if (!raw || raw === '[DONE]') return
      try { const d = JSON.parse(raw).choices?.[0]?.delta?.content || ''; if (d) { out += d; onDelta?.(out) } } catch {}
    }
    for (;;) {
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

  async function complete(messages, { maxTokens = 1600, signal, effort } = {}) {
    await ready()
    const resp = await ai().fetch({ method: 'POST', signal,
      body: JSON.stringify(requestBody(model(), messages, { maxTokens, effort })) })
    if (!resp.ok) throw await errorFrom(resp)
    return ((await resp.json()).choices?.[0]?.message?.content || '').trim()
  }

  // A request that gives up after `ms`, or when the returned abort() is called.
  function timed(ms) {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(new Error('The AI took too long to answer. Try again.')), ms)
    return { signal: ctrl.signal, abort: () => ctrl.abort(), done: () => clearTimeout(timer) }
  }

  const api = {
    OUTCOMES, parseKV, toPlan, merge, isEmptyPlan, beatsArePristine, matchOutcome,
    storyReference, reviewMessages, structureMessages, requestBody, stream, complete, timed,
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = api
  if (root) root.SceneAI = api
})(typeof window !== 'undefined' ? window : null)
