/* study.js — pure bookkeeping for Style Study (no fs, no electron, no DOM).
 *
 * A study is one JSON file in `Style Lab/.studies/<id>.json`:
 *
 *   { v: 1, id, rev, createdAt, updatedAt, completedAt,
 *     source:   { kind: 'book'|'paste', bookId, bookTitle, author, chapterIndex, chapterTitle },
 *     excerpts: [{ id, role: 'focal'|'before'|'after'|'linked', t, i, chapterIndex, paraStart, paraEnd }],
 *     reaction: { text, chips: [] },
 *     notes:    [{ id, excerptId, start, end, quote, prefix, suffix, text, device }],
 *     effect:   { preset, text },
 *     format:   'imitation'|'own'|'skeleton'|'contrast',
 *     attempt:  { text, a, b, gainLose, sentences: [{ source, text }], moves, situation,
 *                 own: { path, sceneId, sceneTitle, original } },
 *     selfCheck: { feel, where, change },
 *     revision: { text },
 *     ai:       { readings: [{ id, excerptId, start, end, quote, reading, group, status, amended }], feedback },
 *     transfers: [{ id, situation, text, selfCheck, at }] }
 *
 * Excerpts are snapshots: a study never reads its book again to render, so deleting a book
 * leaves its studies intact. Note offsets index into the excerpt's `t`; `quote` + `prefix`
 * + `suffix` re-find the spot if offsets ever stop matching.
 *
 * Loaded as a plain script in the renderer (window.QuillStudy) and required by main.js.
 */
;(function (root, factory) {
  const api = factory()
  if (typeof module !== 'undefined' && module.exports) module.exports = api
  else root.QuillStudy = api
})(typeof self !== 'undefined' ? self : globalThis, function () {
  const STUDY_ID = /^st_[A-Za-z0-9]{6,32}$/
  const CONTEXT_CHARS = 40
  const FORMATS = ['imitation', 'own', 'skeleton', 'contrast', 'voice']
  const ROLES = ['focal', 'before', 'after', 'linked']

  function str(v, max = 50000) { return String(v == null ? '' : v).slice(0, max) }
  function newId(prefix = 'st') {
    let s = ''
    while (s.length < 12) s += Math.random().toString(36).slice(2)
    return `${prefix}_${s.slice(0, 12)}`
  }
  function wordCount(text) { return (String(text || '').match(/\S+/g) || []).length }

  // Paragraphs [{ t, i }] → one excerpt text joined by blank lines, spans shifted to match.
  function joinParagraphs(paragraphs) {
    let t = ''
    const i = []
    for (const p of paragraphs || []) {
      if (t) t += '\n\n'
      for (const [s, e] of p.i || []) i.push([t.length + s, t.length + e])
      t += p.t || ''
    }
    return { t, i }
  }

  // ── Anchors ─────────────────────────────────────────────────

  function makeAnchor(text, start, end) {
    const s = Math.max(0, Math.min(start, end)), e = Math.min(text.length, Math.max(start, end))
    return {
      start: s, end: e,
      quote: text.slice(s, e),
      prefix: text.slice(Math.max(0, s - CONTEXT_CHARS), s),
      suffix: text.slice(e, e + CONTEXT_CHARS),
    }
  }

  function commonSuffixLen(a, b) { let n = 0; while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++; return n }
  function commonPrefixLen(a, b) { let n = 0; while (n < a.length && n < b.length && a[n] === b[n]) n++; return n }

  // Returns { start, end } in `text`, or null when the quote is gone.
  function resolveAnchor(text, a) {
    if (!a || !a.quote) return null
    if (text.slice(a.start, a.end) === a.quote) return { start: a.start, end: a.end }
    let best = null, bestScore = -1, from = 0
    for (;;) {
      const at = text.indexOf(a.quote, from)
      if (at < 0) break
      const score = commonSuffixLen(text.slice(Math.max(0, at - CONTEXT_CHARS), at), a.prefix || '')
        + commonPrefixLen(text.slice(at + a.quote.length, at + a.quote.length + CONTEXT_CHARS), a.suffix || '')
      if (score > bestScore) { best = at; bestScore = score }
      from = at + 1
    }
    return best == null ? null : { start: best, end: best + a.quote.length }
  }

  // Loose search for an AI-quoted phrase: ignores curly vs straight quotes, dash style and
  // whitespace runs. Returns { start, end } in the original text, or null.
  function normChar(c) {
    if ('‘’‚′`'.includes(c)) return "'"
    if ('“”„″'.includes(c)) return '"'
    if ('–—―'.includes(c)) return '-'
    if (c === '…') return '...'
    return c.toLowerCase()
  }
  // Whitespace runs become one space, and whitespace right after a hyphen disappears, so
  // "train-\n\nspotting" (raw, split paragraphs) matches "train-spotting" (repaired view).
  function normalizeWithMap(text) {
    let out = '', map = [], lastSpace = false
    for (let k = 0; k < text.length; k++) {
      const c = text[k]
      if (/\s/.test(c)) { if (!lastSpace && out && out[out.length - 1] !== '-') { out += ' '; map.push(k) } lastSpace = true; continue }
      lastSpace = false
      for (const n of normChar(c)) { out += n; map.push(k) }
    }
    return { out, map }
  }
  function findQuote(text, quote) {
    const q = String(quote || '').trim().replace(/^["'“”‘’]+|["'“”‘’]+$/g, '').trim()
    if (!q) return null
    const exact = text.indexOf(q)
    if (exact >= 0) return { start: exact, end: exact + q.length }
    const T = normalizeWithMap(text), Q = normalizeWithMap(q).out.trim()
    if (!Q) return null
    const at = T.out.indexOf(Q)
    if (at < 0) return null
    return { start: T.map[at], end: T.map[at + Q.length - 1] + 1 }
  }

  // Every loose match of `query` in `text`, as original offsets.
  function findAll(text, query, limit = 5000) {
    const Q = normalizeWithMap(String(query || '').trim()).out.trim()
    if (!Q) return []
    const T = normalizeWithMap(String(text || ''))
    const out = []
    let from = 0
    for (;;) {
      const at = T.out.indexOf(Q, from)
      if (at < 0 || out.length >= limit) break
      out.push({ start: T.map[at], end: T.map[at + Q.length - 1] + 1 })
      from = at + 1
    }
    return out
  }

  // ── Book text: raw paragraphs, an optional repaired view, and the map between them ──
  //
  // A book stores paragraphs exactly as the EPUB gave them. Repair (for PDF conversions) is a
  // view: groups of raw paragraphs shown as one. Every stored anchor uses RAW chapter offsets
  // (raw paragraphs joined by "\n\n"), so toggling repair or updating the book never moves it.

  const SENTENCE_END = /[.!?…:"”’)\]—–]$/
  const NEVER_JOIN_AFTER = /[…—?!"”’]$/
  const ABBREVIATION_END = /\b(?:St|Mr|Mrs|Ms|Dr|Mt|Jr|Sr)\.$/
  const OPENS_DIALOGUE = /^["“‘'—–-]/

  function quoteBalance(t) { return (t.match(/“/g) || []).length - (t.match(/”/g) || []).length }

  function shouldJoin(a, b) {
    if (!a || !b || a.h || b.h) return false
    const A = a.t, B = b.t
    // A speech split mid-quotation: A leaves a “ open, and B — which doesn't open one of its
    // own — closes it. (A new paragraph of the same speech starts with “, so it never matches.)
    // B may start with a dash ("and half / —half—ticked"): it is still inside the speech.
    if (quoteBalance(A) > 0 && !/^[“"]/.test(B) && quoteBalance(B) < 0) return true
    if (OPENS_DIALOGUE.test(B)) return false
    if (ABBREVIATION_END.test(A)) return /^[A-Z]/.test(B)
    if (NEVER_JOIN_AFTER.test(A) || SENTENCE_END.test(A)) return false
    // A lowercase continuation after a word or comma is a split sentence.
    if (/^[a-z]/.test(B)) return /[A-Za-z0-9,;’'-]$/.test(A)
    // A capitalised continuation only across a printed-page break, and only when A reads as
    // mid-sentence prose — not an unmarked heading like "CHAPTER TEN" or "Karen".
    return !!b.pb && A.length >= 60 && B.length >= 30 && /[a-z,;-]$/.test(A)
  }

  // Groups of raw paragraph indices; each group displays as one paragraph.
  function repairGroups(paragraphs) {
    const groups = []
    ;(paragraphs || []).forEach((p, n) => {
      const g = groups[groups.length - 1]
      if (g && shouldJoin(paragraphs[g[g.length - 1]], p)) g.push(n)
      else groups.push([n])
    })
    return groups
  }

  function rawChapterText(paragraphs) { return (paragraphs || []).map(p => p.t).join('\n\n') }

  function chapterView(paragraphs, repair) {
    paragraphs = paragraphs || []
    const groups = repair ? repairGroups(paragraphs) : paragraphs.map((_, n) => [n])
    const rawStarts = []
    let r = 0
    for (const p of paragraphs) { rawStarts.push(r); r += p.t.length + 2 }
    const paras = [], segs = []
    let d = 0
    groups.forEach((g, gi) => {
      if (gi) d += 2
      let t = ''
      const i = []
      g.forEach((n, k) => {
        const p = paragraphs[n]
        // No space at a hyphen ("train-" + "spotting") or before a dash ("half" + "—half—").
        if (k) t += (/-$/.test(t) && /^[a-z]/.test(p.t)) || /^[—–]/.test(p.t) ? '' : ' '
        for (const [s, e] of p.i || []) i.push([t.length + s, t.length + e])
        segs.push({ p: n, rStart: rawStarts[n], dStart: d + t.length, len: p.t.length })
        t += p.t
      })
      const para = { t, src: [g[0], g[g.length - 1]], start: d }
      if (i.length) para.i = i
      if (paragraphs[g[0]].h) para.h = 1
      paras.push(para)
      d += t.length
    })
    return { paras, segs, text: paras.map(p => p.t).join('\n\n'), raw: rawChapterText(paragraphs), repaired: !!repair }
  }

  // Offsets that fall in a separator snap to the start of the next piece of text.
  function rawToDisplay(view, r) {
    for (const s of view.segs) {
      if (r < s.rStart) return s.dStart
      if (r <= s.rStart + s.len) return s.dStart + (r - s.rStart)
    }
    return view.text.length
  }
  function displayToRaw(view, d) {
    for (const s of view.segs) {
      if (d < s.dStart) return s.rStart
      if (d <= s.dStart + s.len) return s.rStart + (d - s.dStart)
    }
    return view.raw.length
  }
  // Display offset → { para index, offset within that displayed paragraph }, and back.
  function displayPoint(view, d) {
    let k = 0
    while (k + 1 < view.paras.length && view.paras[k + 1].start <= d) k++
    const p = view.paras[k]
    return { para: k, offset: Math.max(0, Math.min(p ? p.t.length : 0, d - (p ? p.start : 0))) }
  }
  function displayOffset(view, para, offset) { const p = view.paras[para]; return p ? p.start + offset : 0 }

  // Finds an anchored passage in a book. Never guesses: a missing quote, or several equally
  // good matches, come back as { status: 'missing' | 'ambiguous' } and nothing is attached.
  function locatePassage(book, anchor) {
    if (!book || !anchor || !anchor.quote) return { status: 'missing' }
    const chapters = book.chapters || []
    let ci = Number.isInteger(anchor.chapterIndex) ? anchor.chapterIndex : -1
    if (anchor.chapterTitle && (!chapters[ci] || chapters[ci].title !== anchor.chapterTitle)) {
      const byTitle = chapters.map((c, n) => (c.title === anchor.chapterTitle ? n : -1)).filter(n => n >= 0)
      ci = byTitle.length === 1 ? byTitle[0] : -1
    }
    if (!chapters[ci]) return { status: 'missing' }
    const raw = rawChapterText(chapters[ci].paragraphs)
    const hits = findAll(raw, anchor.quote)
    if (!hits.length) return { status: 'missing' }
    const norm = s => normalizeWithMap(s).out
    const P = norm(anchor.prefix || ''), X = norm(anchor.suffix || '')
    const scored = hits.map(h => ({
      ...h,
      score: commonSuffixLen(norm(raw.slice(Math.max(0, h.start - 80), h.start)), P) + commonPrefixLen(norm(raw.slice(h.end, h.end + 80)), X),
    })).sort((a, b) => b.score - a.score)
    if (scored.length > 1 && scored[0].score < scored[1].score + 5) return { status: 'ambiguous', chapterIndex: ci, count: scored.length }
    return { status: 'ok', chapterIndex: ci, start: scored[0].start, end: scored[0].end }
  }

  function rawAnchor(paragraphs, chapterIndex, chapterTitle, start, end) {
    return { chapterIndex, chapterTitle: chapterTitle || '', ...makeAnchor(rawChapterText(paragraphs), start, end) }
  }

  // ── Sentences (for imitation): word count + punctuation breaks, nothing grammatical ──

  function splitSentences(text) {
    const out = []
    const re = /[^.!?…]+(?:[.!?…]+["'”’)\]]*|$)/g
    let m
    for (const para of String(text || '').split(/\n+/)) {
      while ((m = re.exec(para))) { const s = m[0].trim(); if (s) out.push(s); if (!m[0]) re.lastIndex++ }
      re.lastIndex = 0
    }
    return out
  }
  // "He ran, fell — and stopped." → "▢▢ , ▢ — ▢▢ ." style shape: word counts between marks.
  function punctuationShape(sentence) {
    const parts = String(sentence || '').split(/([,;:—–()]|\.\.\.|…|-{2})/)
    return parts.map(p => (/^([,;:—–()]|\.\.\.|…|-{2})$/.test(p) ? p : (wordCount(p) ? String(wordCount(p)) : ''))).filter(Boolean).join(' ')
  }

  // ── Sentence Surgery: habits worth a pass, found by pattern only ──
  // Narration is the paragraph with “quoted” dialogue blanked to spaces (same length, so
  // offsets still index the original), so a question asked aloud isn't a narrated question.
  // Each tag names the surgery pass it suggests and carries `spans` — [start, end) offsets
  // into the paragraph of exactly what set it off.

  const TELL_WORD = /\b(hot|heat|flush(?:ed)?|warm|pulse|heart)\b/gi
  const SELF_WORD = /\b(I|my|me)\b/i
  const SAID_ING = /\b(said|asked|added|continued|replied|muttered|whispered)\b[^.!?“”]{0,25}, [a-z]+ing\b/g
  const SURGERY_PASS_IDS = ['cut', 'tell', 'questions', 'rule', 'list']

  const BUILTIN_PATTERNS = [
    { id: 'questions', label: 'question run',    pass: 'questions', desc: 'Two or more narrated questions in one paragraph.' },
    { id: 'list',      label: 'list',            pass: 'list',      desc: '“There was/were” with two or more commas, or any sentence with three commas and “, and”.' },
    { id: 'tell',      label: 'heat/heart tell', pass: 'tell',      desc: 'hot, heat, flush, warm, pulse or heart in a sentence about I/me/my.' },
    { id: 'said-ing',  label: 'said, -ing',      pass: 'cut',       desc: 'A dialogue tag followed by “, -ing” (“Kit said, scanning the road”).' },
  ]

  function blankDialogue(t) { return t.replace(/“[^”]*”?/g, m => ' '.repeat(m.length)) }

  // Sentences of `s` with their offsets, split on .!?… and line breaks.
  function sentenceSpans(s) {
    const out = []
    const re = /[^.!?…\n]+(?:[.!?…]+["'”’)\]]*|$)/gm
    let m
    while ((m = re.exec(s))) {
      if (!m[0]) { re.lastIndex++; continue }
      const lead = m[0].length - m[0].trimStart().length
      const body = m[0].trim()
      if (body) out.push({ s: body, start: m.index + lead, end: m.index + lead + body.length })
    }
    return out
  }

  // A custom pattern's phrases → one RegExp, or null. A phrase written /like this/ is a regex;
  // anything else matches as whole words, ignoring case.
  function customPatternRegex(phrases) {
    const parts = []
    for (const raw of phrases || []) {
      const p = String(raw || '').trim()
      if (!p) continue
      const rx = p.match(/^\/(.+)\/$/)
      if (rx) { try { new RegExp(rx[1]); parts.push(`(?:${rx[1]})`) } catch {} continue }
      parts.push(`\\b${p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')}\\b`)
    }
    return parts.length ? new RegExp(parts.join('|'), 'gi') : null
  }

  function cleanCustomPattern(p) {
    p = p || {}
    const phrases = (Array.isArray(p.phrases) ? p.phrases : String(p.phrases || '').split(',')).map(x => str(x, 200).trim()).filter(Boolean).slice(0, 50)
    return {
      id: /^cp_[A-Za-z0-9]{4,32}$/.test(p.id) ? p.id : newId('cp'),
      label: str(p.label, 40).trim() || phrases[0] || 'pattern',
      phrases,
      narrationOnly: p.narrationOnly !== false,
      pass: SURGERY_PASS_IDS.includes(p.pass) ? p.pass : '',
      on: p.on !== false,
    }
  }

  // opts: { disabled: [builtin ids], custom: [cleanCustomPattern shapes] }
  function scanParagraph(text, opts = {}) {
    const t = String(text || '')
    const off = new Set(opts.disabled || [])
    const narration = blankDialogue(t)
    const sents = sentenceSpans(narration)
    const tags = []
    if (!off.has('questions')) {
      const qs = sents.filter(x => /\?["'”’)\]]*$/.test(x.s))
      if (qs.length >= 2) tags.push({ kind: 'questions', label: `${qs.length} questions`, pass: 'questions', spans: qs.map(x => [x.start, x.end]) })
    }
    if (!off.has('list')) {
      const commas = s => (s.match(/,/g) || []).length
      const hits = sents.filter(x => (/^There (was|were)\b/.test(x.s) && commas(x.s) >= 2) || (commas(x.s) >= 3 && /, and\b/.test(x.s)))
      if (hits.length) tags.push({ kind: 'list', label: 'list', pass: 'list', spans: hits.map(x => [x.start, x.end]) })
    }
    if (!off.has('tell')) {
      const spans = []
      for (const x of sents) {
        if (!SELF_WORD.test(x.s)) continue
        for (const m of x.s.matchAll(TELL_WORD)) spans.push([x.start + m.index, x.start + m.index + m[0].length])
      }
      if (spans.length) tags.push({ kind: 'tell', label: 'heat/heart tell', pass: 'tell', spans })
    }
    if (!off.has('said-ing')) {
      const spans = [...t.matchAll(SAID_ING)].map(m => [m.index, m.index + m[0].length])
      if (spans.length) tags.push({ kind: 'said-ing', label: 'said, -ing', pass: 'cut', spans })
    }
    for (const raw of opts.custom || []) {
      const p = cleanCustomPattern(raw)
      if (!p.on) continue
      const re = customPatternRegex(p.phrases)
      if (!re) continue
      const spans = [...(p.narrationOnly ? narration : t).matchAll(re)].filter(m => m[0]).map(m => [m.index, m.index + m[0].length])
      if (spans.length) tags.push({ kind: p.id, label: p.label, pass: p.pass, spans, custom: true })
    }
    return tags
  }

  // Paragraph → runs of text, each with the tag kinds covering it, for highlighting.
  function markSpans(text, tags) {
    const t = String(text || '')
    const cuts = new Set([0, t.length])
    for (const tag of tags || []) for (const [a, b] of tag.spans || []) { cuts.add(Math.max(0, a)); cuts.add(Math.min(t.length, b)) }
    const pts = [...cuts].sort((a, b) => a - b)
    const out = []
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1]
      if (a === b) continue
      const kinds = (tags || []).filter(tag => (tag.spans || []).some(([x, y]) => x <= a && y >= b)).map(tag => tag.kind)
      const last = out[out.length - 1]
      if (last && last.kinds.join() === kinds.join()) last.t += t.slice(a, b)
      else out.push({ t: t.slice(a, b), kinds })
    }
    return out
  }

  // ── Completion + stats ───────────────────────────────────────

  function isComplete(study) { return !!(study && study.revision && str(study.revision.text).trim()) }

  // Applies one rep to the Style Lab stats object. With `studyId`, a study already in
  // `countedStudies` is a no-op (returns null), so reconciling twice can't double-count.
  // `date` is when the rep happened; a rep from an earlier week or day adds to the total
  // without touching this week's count or the current streak.
  function bumpStats(stats, { date, now, dates, studyId } = {}) {
    const s = Object.assign({}, stats || {})
    s.countedStudies = Array.isArray(s.countedStudies) ? s.countedStudies.slice() : []
    if (studyId) {
      if (s.countedStudies.includes(studyId)) return null
      s.countedStudies.push(studyId)
    }
    now = now || new Date()
    date = date || now
    const day = dates.localDateKey(date)
    const dayBefore = dates.localDateKey(dates.addLocalDays(date, -1))
    s.totalReps = (s.totalReps || 0) + 1
    if (!s.lastRepDate || day > s.lastRepDate) s.lastRepDate = day
    if (s.streakDate === day) {
      // already counted that day
    } else if (s.streakDate === dayBefore) {
      s.streak = (s.streak || 0) + 1
      s.streakDate = day
    } else if (!s.streakDate || day > s.streakDate) {
      s.streak = 1
      s.streakDate = day
    }
    const week = dates.localWeekKey(date)
    if (week === dates.localWeekKey(now)) {
      if (s.weekKey !== week) { s.weekKey = week; s.weekReps = 0 }
      s.weekReps = (s.weekReps || 0) + 1
    }
    return s
  }

  // ── Recovery drafts ─────────────────────────────────────────

  // A disk save acknowledged for `ackRev` may clear the local draft only when nothing newer
  // was typed while it was in flight.
  function canClearDraft(ackRev, latestRev) { return Number(ackRev) === Number(latestRev) }
  function draftIsNewer(draft, disk) {
    return !!(draft && draft.study && Number(draft.rev || 0) > Number((disk && disk.rev) || 0))
  }

  // ── Validation (main process) ───────────────────────────────

  function cleanSpans(spans, len) {
    return (Array.isArray(spans) ? spans : [])
      .filter(sp => Array.isArray(sp) && sp.length === 2)
      .map(([s, e]) => [Math.max(0, Math.min(len, s | 0)), Math.max(0, Math.min(len, e | 0))])
      .filter(([s, e]) => e > s)
  }
  function cleanAnchor(a) {
    if (!a || typeof a !== 'object' || !a.quote) return null
    return {
      chapterIndex: Number.isInteger(a.chapterIndex) ? a.chapterIndex : null, chapterTitle: str(a.chapterTitle, 300),
      start: a.start | 0, end: a.end | 0, quote: str(a.quote, 200000), prefix: str(a.prefix, 80), suffix: str(a.suffix, 80),
    }
  }
  // A note the app anchored for you (the phrase you selected) is not an observation until you write one.
  function hasObservation(study) { return !!(study && (study.notes || []).some(n => str(n.text).trim())) }
  // The writer's own comparison of practice and source, answered before any AI feedback.
  const COMPARE_KEYS = ['sameMove', 'voice', 'copied', 'helped']
  function cleanCompare(c) { c = c || {}; return Object.fromEntries(COMPARE_KEYS.map(k => [k, str(c[k], 5000)])) }
  function hasComparison(study) { return !!(study && study.compare && COMPARE_KEYS.every(k => str(study.compare[k]).trim())) }
  function cleanSelfCheck(c) { c = c || {}; return { feel: str(c.feel, 5000), where: str(c.where, 5000), change: str(c.change, 5000) } }

  function cleanStudy(raw) {
    if (!raw || typeof raw !== 'object' || !STUDY_ID.test(raw.id || '')) return null
    const excerpts = (Array.isArray(raw.excerpts) ? raw.excerpts : []).slice(0, 40).map(e => {
      const t = str(e && e.t, 200000)
      return {
        id: str(e && e.id, 40), role: ROLES.includes(e && e.role) ? e.role : 'linked', t, i: cleanSpans(e && e.i, t.length),
        chapterIndex: Number.isInteger(e && e.chapterIndex) ? e.chapterIndex : null,
        paraStart: Number.isInteger(e && e.paraStart) ? e.paraStart : null,
        paraEnd: Number.isInteger(e && e.paraEnd) ? e.paraEnd : null,
        anchor: cleanAnchor(e && e.anchor),
      }
    }).filter(e => e.id && e.t)
    const ids = new Set(excerpts.map(e => e.id))
    const src = raw.source || {}
    const a = raw.attempt || {}
    const own = a.own || null
    return {
      v: 1, id: raw.id, rev: Number(raw.rev) || 0,
      createdAt: str(raw.createdAt, 40), updatedAt: str(raw.updatedAt, 40), completedAt: str(raw.completedAt, 40) || null,
      source: {
        kind: src.kind === 'book' ? 'book' : 'paste', bookId: str(src.bookId, 40), bookTitle: str(src.bookTitle, 300),
        author: str(src.author, 300), chapterIndex: Number.isInteger(src.chapterIndex) ? src.chapterIndex : null, chapterTitle: str(src.chapterTitle, 300),
      },
      excerpts,
      reaction: { text: str(raw.reaction && raw.reaction.text, 10000), chips: (raw.reaction && Array.isArray(raw.reaction.chips) ? raw.reaction.chips : []).map(c => str(c, 40)).slice(0, 20) },
      notes: (Array.isArray(raw.notes) ? raw.notes : []).filter(n => n && ids.has(n.excerptId)).slice(0, 500).map(n => ({
        id: str(n.id, 40), excerptId: n.excerptId, start: n.start | 0, end: n.end | 0, quote: str(n.quote, 5000),
        prefix: str(n.prefix, 80), suffix: str(n.suffix, 80), text: str(n.text, 5000), device: str(n.device, 80), auto: !!n.auto,
      })),
      effect: { preset: str(raw.effect && raw.effect.preset, 60), text: str(raw.effect && raw.effect.text, 2000), move: str(raw.effect && raw.effect.move, 2000) },
      format: FORMATS.includes(raw.format) ? raw.format : '',
      attempt: {
        text: str(a.text), a: str(a.a), b: str(a.b), gainLose: str(a.gainLose, 10000), moves: str(a.moves, 10000), situation: str(a.situation, 5000),
        contrast: str(a.contrast, 40),
        sentences: (Array.isArray(a.sentences) ? a.sentences : []).slice(0, 6).map(s => ({ source: str(s && s.source, 3000), marks: str(s && s.marks, 3000), text: str(s && s.text, 3000) })),
        own: own ? { path: str(own.path, 1000), sceneId: str(own.sceneId, 80), sceneTitle: str(own.sceneTitle, 300), original: str(own.original) } : null,
      },
      selfCheck: cleanSelfCheck(raw.selfCheck),
      compare: cleanCompare(raw.compare),
      revision: { text: str(raw.revision && raw.revision.text) },
      ai: {
        readings: (raw.ai && Array.isArray(raw.ai.readings) ? raw.ai.readings : []).slice(0, 60).map(r => ({
          id: str(r.id, 40), excerptId: ids.has(r.excerptId) ? r.excerptId : '', start: r.start | 0, end: r.end | 0,
          quote: str(r.quote, 3000), reading: str(r.reading, 3000), group: ['similar', 'another', 'different'].includes(r.group) ? r.group : 'another',
          status: ['open', 'dismissed', 'amended'].includes(r.status) ? r.status : 'open', amended: str(r.amended, 3000),
        })),
        feedback: raw.ai && raw.ai.feedback ? { text: str(raw.ai.feedback.text, 20000), at: str(raw.ai.feedback.at, 40), revealed: !!raw.ai.feedback.revealed } : null,
      },
      transfers: (Array.isArray(raw.transfers) ? raw.transfers : []).slice(0, 200).map(t => ({
        id: str(t && t.id, 40), situation: str(t && t.situation, 5000), text: str(t && t.text), selfCheck: cleanSelfCheck(t && t.selfCheck), at: str(t && t.at, 40),
      })),
    }
  }

  // ── Titles + export ─────────────────────────────────────────

  function studyTitle(study) {
    const focal = (study.excerpts || []).find(e => e.role === 'focal') || (study.excerpts || [])[0]
    const words = focal ? focal.t.split(/\s+/).slice(0, 6).join(' ') : 'Study'
    const book = study.source && study.source.bookTitle
    return `${book ? book + ' · ' : ''}${words}${focal && wordCount(focal.t) > 6 ? '…' : ''}`
  }

  function quoteBlock(text) { return String(text || '').split('\n').map(l => '> ' + l).join('\n') }

  function toMarkdown(study) {
    const L = []
    const src = study.source || {}
    L.push(`# ${studyTitle(study)}`, '')
    L.push(`*${[src.author, src.bookTitle, src.chapterTitle].filter(Boolean).join(' · ') || 'Pasted passage'}*`, '')
    for (const e of study.excerpts) {
      if (e.role !== 'focal') L.push(`**${e.role === 'linked' ? 'Linked excerpt' : e.role === 'before' ? 'Context before' : 'Context after'}**`, '')
      L.push(quoteBlock(e.t), '')
    }
    if (study.reaction.text || study.reaction.chips.length) {
      L.push('## Why I flagged it', '')
      if (study.reaction.chips.length) L.push(study.reaction.chips.join(' · '), '')
      if (study.reaction.text) L.push(study.reaction.text, '')
    }
    if (study.notes.length) {
      L.push('## Margin notes', '')
      for (const n of study.notes) L.push(`- “${n.quote}”${n.device ? ` *(${n.device})*` : ''} — ${n.text}`)
      L.push('')
    }
    const readings = (study.ai.readings || []).filter(r => r.status !== 'dismissed')
    if (readings.length) {
      L.push('## Other readings (AI)', '')
      for (const r of readings) L.push(`- “${r.quote}” — ${r.status === 'amended' ? r.amended : r.reading}`)
      L.push('')
    }
    if (study.effect.move) L.push('## The move', '', study.effect.move, '')
    if (study.effect.text) L.push('## Its effect', '', study.effect.text, '')
    const a = study.attempt
    if (study.format) {
      L.push('## Attempt', '')
      if (study.format === 'imitation') a.sentences.forEach(s => L.push(quoteBlock(s.source), '', s.text, ''))
      if (study.format === 'own' && a.own) L.push(`From *${a.own.sceneTitle}*:`, '', quoteBlock(a.own.original), '', a.text, '')
      if (study.format === 'voice') L.push(a.situation ? `Scene: ${a.situation}` : '', '', a.text, '')
      if (study.format === 'skeleton') L.push('Moves:', '', a.moves, '', a.situation ? `Situation: ${a.situation}` : '', '', a.text, '')
      if (study.format === 'contrast') L.push('**Version A**', '', a.a, '', '**Version B**', '', a.b, '', a.gainLose ? `Gain / lose: ${a.gainLose}` : '', '')
    }
    const cmp = study.compare || {}
    if (COMPARE_KEYS.some(k => cmp[k])) {
      L.push('## Comparison', '')
      if (cmp.sameMove) L.push(`- Same move? ${cmp.sameMove}`)
      if (cmp.voice) L.push(`- Still my character’s voice? ${cmp.voice}`)
      if (cmp.copied) L.push(`- Copied wording instead of the move? ${cmp.copied}`)
      if (cmp.helped) L.push(`- Did the move help here? ${cmp.helped}`)
      L.push('')
    }
    const sc = study.selfCheck
    if (sc.feel || sc.where || sc.change) {
      L.push('## Self-check', '')
      if (sc.feel) L.push(`- What I wanted: ${sc.feel}`)
      if (sc.where) L.push(`- Where it happens: ${sc.where}`)
      if (sc.change) L.push(`- What I'd change: ${sc.change}`)
      L.push('')
    }
    if (study.revision.text) L.push('## Revision', '', study.revision.text, '')
    if (study.ai.feedback && study.ai.feedback.text) L.push('## Feedback (AI)', '', study.ai.feedback.text, '')
    for (const t of study.transfers) {
      L.push(`## Transfer · ${String(t.at).slice(0, 10)}`, '')
      if (t.situation) L.push(`*${t.situation}*`, '')
      L.push(t.text, '')
    }
    return L.join('\n').replace(/\n{3,}/g, '\n\n')
  }

  return {
    STUDY_ID, FORMATS, newId, wordCount, joinParagraphs,
    makeAnchor, resolveAnchor, findQuote, findAll, splitSentences, punctuationShape,
    BUILTIN_PATTERNS, scanParagraph, markSpans, cleanCustomPattern, customPatternRegex,
    shouldJoin, repairGroups, rawChapterText, chapterView, rawToDisplay, displayToRaw, displayPoint, displayOffset,
    locatePassage, rawAnchor, cleanAnchor, hasObservation, hasComparison,
    isComplete, bumpStats, canClearDraft, draftIsNewer, cleanStudy, studyTitle, toMarkdown,
  }
})
