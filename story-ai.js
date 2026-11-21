/* story-ai.js — prompts and reply parsing for the AI helpers that read the writer's draft:
 *   synopses: a one-line synopsis for each written scene (the Outliner, Bridge's read-back)
 *   threads:  the open questions the draft raises, where each is raised and answered (Threads)
 *   bridge:   scene cards from the last scene written to the lighthouse (Bridge)
 * Every result is shown as a preview the writer edits and accepts (renderer/draft-ai.js); nothing
 * is written straight to the novel. Replies are plain numbered lines, parsed here, so a model
 * that wraps or decorates its answer still reads. The requests themselves go through SceneAI.
 *
 * Pure: required by tests, loaded in the renderer as window.StoryAI. */
;(function (root, factory) {
  const api = factory()
  if (typeof module !== 'undefined' && module.exports) module.exports = api
  else root.StoryAI = api
})(typeof self !== 'undefined' ? self : globalThis, function () {
  const str = v => String(v == null ? '' : v)
  const words = s => str(s).trim().split(/\s+/).filter(Boolean).length
  const tidy = s => str(s).trim().replace(/^["“'‘]+|["”'’]+$/g, '').replace(/\s+/g, ' ').trim()
  const lines = raw => str(raw).replace(/\r\n?/g, '\n').split('\n').map(l => l.trim()).filter(l => l && !/^```/.test(l))

  const EDITOR = 'You are a careful developmental editor helping a novelist keep track of their own draft. ' +
    'You report what is on the page. You never invent events, never write prose for the book, and never judge the writing.'

  // ── Synopses ────────────────────────────────────────────────
  // Scenes go in batches of about `budget` words, so a long book is several requests.
  function batches(scenes, budget = 9000) {
    const out = []
    let cur = [], size = 0
    for (const sc of scenes) {
      const n = words(sc.text)
      if (cur.length && size + n > budget) { out.push(cur); cur = []; size = 0 }
      cur.push(sc)
      size += n
    }
    if (cur.length) out.push(cur)
    return out
  }

  function synopsisMessages(scenes, { pov = '' } = {}) {
    const body = scenes.map((sc, i) => `### SCENE ${i + 1}: ${str(sc.title)}\n${str(sc.text).trim()}`).join('\n\n')
    return [
      { role: 'system', content: EDITOR },
      { role: 'user', content:
        'Write a one-sentence synopsis for each scene below: what happens and what changes, in present tense, ' +
        'naming characters as the text does. 12–30 words. No commentary, no quotation marks.\n' +
        (pov ? `The book's point of view: ${pov}.\n` : '') +
        `Answer with exactly one line per scene, in this form:\n1: <synopsis>\n2: <synopsis>\n\n${body}` },
    ]
  }

  // "3: She lies." / "3. She lies." / "Scene 3 — She lies." → { 2: 'She lies.' } (0-based)
  function parseSynopses(raw, count) {
    const out = {}
    for (const line of lines(raw)) {
      const m = line.match(/^\**(?:scene\s*)?(\d{1,3})\**\s*[:.)\-–—]\s*(.+)$/i)
      if (!m) continue
      const i = Number(m[1]) - 1
      const text = tidy(m[2].replace(/^\*+|\*+$/g, ''))
      if (i >= 0 && i < count && text && !(i in out)) out[i] = text
    }
    return out
  }

  // ── Threads ─────────────────────────────────────────────────
  const KIND_WORDS = { mystery: 'mystery', relationship: 'relationship', romance: 'relationship', goal: 'goal', quest: 'goal',
    setup: 'promise', promise: 'promise', inner: 'inner', internal: 'inner' }

  // What a scene says, kept short: its synopsis if it has one, else its opening, and always its
  // last lines, where questions tend to be left.
  function sceneDigest(sc) {
    const t = str(sc.text).replace(/\s+/g, ' ').trim()
    const start = str(sc.synopsis).trim() || t.slice(0, 700)
    const end = t.length > 700 ? t.slice(-400) : ''
    return `${start}${end ? ` … ${end}` : ''}`
  }

  function threadMessages(scenes, { existing = [], question = '' } = {}) {
    const list = scenes.map((sc, i) => `${i + 1}. ${str(sc.title)}: ${sceneDigest(sc)}`).join('\n')
    const known = existing.filter(t => str(t.text).trim()).map(t => `- ${t.text}`).join('\n')
    return [
      { role: 'system', content: EDITOR },
      { role: 'user', content:
        'Below is a novel draft, scene by scene. List the open threads: questions the story has made the reader ask ' +
        '(a mystery, a relationship, a goal, a setup that must pay off, an inner struggle). For each, give the scene ' +
        'number where it is raised and where it is answered, or "open" if the draft has not answered it yet. ' +
        'Phrase each as a question the reader would ask. Only threads the text actually raises. At most 25.\n' +
        (question ? `The book's central question, in the writer's words: ${question}\n` : '') +
        (known ? `The writer already tracks these; don't repeat them:\n${known}\n` : '') +
        'One thread per line, exactly like this:\nTHREAD: <question> | KIND: mystery, relationship, goal, setup or inner | RAISED: <scene number> | ANSWERED: <scene number or open>\n\n' +
        `SCENES:\n${list}` },
    ]
  }

  // → [{ text, kind, raised (0-based index or -1), answered (index or -1) }]
  function parseThreads(raw, count) {
    const out = []
    const num = v => { const m = str(v).match(/\d{1,3}/); const i = m ? Number(m[0]) - 1 : -1; return i >= 0 && i < count ? i : -1 }
    for (const line of lines(raw)) {
      if (!/thread\**\s*:/i.test(line)) continue
      const fields = {}
      for (const part of line.split('|')) {
        const m = part.match(/^\s*[-*]?\s*\**([A-Za-z]+)\**\s*:\s*(.*)$/)
        if (m) fields[m[1].toUpperCase()] = m[2].trim()
      }
      const text = tidy(fields.THREAD || '')
      if (!text) continue
      out.push({
        text,
        kind: KIND_WORDS[str(fields.KIND).toLowerCase().replace(/[^a-z]/g, '')] || '',
        raised: num(fields.RAISED),
        answered: /^\s*(open|no|none|not yet|unanswered|-|—)?\s*$/i.test(str(fields.ANSWERED)) ? -1 : num(fields.ANSWERED),
      })
    }
    return out
  }

  // ── Timeline ────────────────────────────────────────────────
  function timelineMessages(scenes, { threads = [], before = '' } = {}) {
    const body = scenes.map((sc, i) => `### SCENE ${i + 1}: ${str(sc.title)}\n${str(sc.text).trim()}`).join('\n\n')
    return [
      { role: 'system', content: EDITOR },
      { role: 'user', content:
        'For each scene below, note its place in story time, only from what the text says or clearly implies.\n' +
        'WHEN: a calendar date if the text gives one (e.g. Oct 1 2024); otherwise how it relates to the scene before, in the text’s own terms ' +
        '("the next morning", "three days later", "ten years earlier"); blank if there is no clue.\n' +
        'TIME: time of day (dawn, 2 am, evening) or blank. LENGTH: how long the scene lasts (minutes, an hour, all night) or blank.\n' +
        'WHERE: the place. WHO: the characters present, comma separated.\n' +
        (threads.length ? `THREADS: which of these open threads the scene touches, copied exactly, comma separated, or blank:\n${threads.map(t => `- ${t}`).join('\n')}\n` : '') +
        (before ? `The scene just before these happened: ${before}\n` : '') +
        'Answer with exactly one line per scene, like this:\n' +
        `1: WHEN: … | TIME: … | LENGTH: … | WHERE: … | WHO: …${threads.length ? ' | THREADS: …' : ''}\n\n${body}` },
    ]
  }

  // → { 0: { when, time, duration, location, characters: [], threads: [] } }. Threads are kept only
  // when they match one of `threads` (case and punctuation aside).
  function parseTimeline(raw, count, threads = []) {
    const known = new Map(threads.map(t => [str(t).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim(), t]))
    const blank = v => /^(?:-|—|–|n\/?a|none|unknown|unclear|blank|not stated|no clue|\?)?$/i.test(str(v).trim().replace(/[.()]/g, ''))
    const val = v => blank(v) ? '' : tidy(v)
    const listOf = v => blank(v) ? [] : str(v).split(/,|;| and /).map(x => tidy(x)).filter(x => x && !blank(x))
    const out = {}
    for (const line of lines(raw)) {
      const m = line.match(/^\**(?:scene\s*)?(\d{1,3})\**\s*[:.)\-–—]\s*(.+)$/i)
      if (!m) continue
      const i = Number(m[1]) - 1
      if (i < 0 || i >= count || i in out) continue
      const f = {}
      for (const part of m[2].split('|')) {
        const kv = part.match(/^\s*\**([A-Za-z]+)\**\s*:\s*(.*)$/)
        if (kv) f[kv[1].toUpperCase()] = kv[2].trim()
      }
      const row = {
        when: val(f.WHEN), time: val(f.TIME), duration: val(f.LENGTH || f.DURATION), location: val(f.WHERE || f.LOCATION),
        characters: listOf(f.WHO || f.CHARACTERS),
        threads: listOf(f.THREADS).map(t => known.get(t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim())).filter(Boolean),
      }
      if (row.when || row.time || row.duration || row.location || row.characters.length || row.threads.length) out[i] = row
    }
    return out
  }

  // ── Bridge cards ────────────────────────────────────────────
  function bridgeMessages({ recent = [], now = {}, threads = [], lighthouse = '', needs = [], cards = [], foundation = {} }) {
    const scenes = recent.map((sc, i) => `${i + 1}. ${str(sc.title)}: ${sceneDigest(sc)}`).join('\n')
    const lines2 = (title, list) => list.length ? `${title}:\n${list.map(x => `- ${x}`).join('\n')}\n` : ''
    const said = [['What changed in the last scene', now.changed], ['What the protagonist wants now', now.want], ['What the reader is worried about', now.worry]]
      .filter(([, v]) => str(v).trim()).map(([k, v]) => `${k}: ${v}`).join('\n')
    const arc = [['Want', foundation.want], ['The lie', foundation.lie], ['Need', foundation.need], ['Opposition', foundation.opposition], ['Stakes', foundation.stakes]]
      .filter(([, v]) => str(v).trim()).map(([k, v]) => `${k}: ${v}`).join('\n')
    return [
      { role: 'system', content: EDITOR + ' Here you are suggesting options for the writer to choose from, built only from what they have already set up.' },
      { role: 'user', content:
        'The writer is stuck between the last scene they wrote and a scene they can see ahead (the lighthouse). ' +
        'Suggest 3 to 6 scenes, in order, that get from one to the other. Each scene must be caused by the one before ' +
        '("because… so…", never "and then"), should move at least one open thread, and should end on a turn ' +
        '(Yes, but… or No, and… where possible). Use the characters and threads already in the draft. Keep each line short: these are options, not an outline to obey.\n\n' +
        (arc ? `THE PROTAGONIST:\n${arc}\n\n` : '') +
        (scenes ? `THE LAST SCENES WRITTEN:\n${scenes}\n\n` : '') +
        (said ? `THE WRITER SAYS:\n${said}\n\n` : '') +
        lines2('OPEN THREADS TO MOVE', threads) +
        lines2('HAS TO BE TRUE BEFORE THE LIGHTHOUSE', needs) +
        lines2('SCENE CARDS THE WRITER ALREADY HAS (fit around these)', cards) +
        `THE LIGHTHOUSE: ${str(lighthouse).trim() || '(not chosen yet: head for the next turning point)'}\n\n` +
        'One scene per line, exactly like this:\nBECAUSE: <what the scene before caused> | SO: <what happens in this scene> | OUTCOME: Yes, No, Yes but, or No and' },
    ]
  }

  const OUTCOME = v => {
    const s = str(v).toLowerCase().replace(/[^a-z ]/g, '').trim()
    if (/^no ?and/.test(s)) return 'No, and…'
    if (/^yes ?but/.test(s)) return 'Yes, but…'
    if (s === 'yes') return 'Yes'
    if (s === 'no') return 'No'
    return ''
  }

  // → [{ because, then, outcome }]
  function parseCards(raw) {
    const out = []
    for (const line of lines(raw)) {
      if (!/\bso\**\s*:/i.test(line)) continue
      const fields = {}
      for (const part of line.replace(/^\s*(?:\d+[.)]\s*|[-*]\s*)/, '').split('|')) {
        const m = part.match(/^\s*\**([A-Za-z]+)\**\s*:\s*(.*)$/)
        if (m) fields[m[1].toUpperCase()] = m[2].trim()
      }
      const then = tidy(fields.SO || '')
      if (!then) continue
      out.push({ because: tidy(fields.BECAUSE || '').replace(/^because\s+/i, ''), then, outcome: OUTCOME(fields.OUTCOME) })
    }
    return out.slice(0, 8)
  }

  return { batches, synopsisMessages, parseSynopses, sceneDigest, threadMessages, parseThreads, timelineMessages, parseTimeline, bridgeMessages, parseCards }
})
