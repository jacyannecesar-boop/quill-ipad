/* words.js — one definition of what counts as a word, shared by main and renderer.
 *
 * Stubs are bracketed placeholders the writer parks in the draft — `[they look at the
 * footage]` — so they must never inflate a word count, a sprint delta or a scene goal.
 * They are ordinary text in the file: `[` and `]` are neither escapable in parse.mjs nor
 * escaped by serialize.mjs, so a stub round-trips byte-for-byte with no sidecar to lose.
 *
 * Loaded as a plain script in the renderer (window.QuillWords) and required by main.js.
 */
;(function (root, factory) {
  const api = factory()
  if (typeof module !== 'undefined' && module.exports) module.exports = api
  else root.QuillWords = api
})(typeof self !== 'undefined' ? self : globalThis, function () {
  // No `[` or newline inside: an unclosed bracket must not swallow the rest of the scene,
  // and `[a [b]` is one stub — `[b]` — not a stub that starts at the abandoned `[a`.
  const STUB_PATTERN = '\\[[^\\[\\]\\n]*\\]'

  function stubRegExp() { return new RegExp(STUB_PATTERN, 'g') }

  function stripStubs(text) { return String(text || '').replace(stubRegExp(), ' ') }

  // Splits on whitespace and em dashes, so `anything—an` is two words whichever dash style
  // the writer uses, and drops tokens with no letter or digit, so a spaced ` — ` or a lone
  // `…` is not a word.
  const WORD_BREAK = /[\s\u2014\u2E3A\u2E3B]+/

  function countWords(text) {
    return String(text || '').split(WORD_BREAK)
      .filter(token => /[\p{L}\p{N}]/u.test(token)).length
  }

  // The words countWords counts, lowercased and without punctuation, so comparing two drafts
  // does not see `said.` → `said,` as a cut.
  function wordTokens(text) {
    return String(text || '').split(WORD_BREAK)
      .filter(token => /[\p{L}\p{N}]/u.test(token))
      .map(token => token.toLowerCase().replace(/[^\p{L}\p{N}]/gu, ''))
  }

  // Myers' edit distance between two token lists, or null once it passes `limit`.
  function editDistance(a, b, limit) {
    const n = a.length, m = b.length, max = Math.min(n + m, limit)
    const offset = max + 1
    const v = new Int32Array(2 * max + 3)
    for (let d = 0; d <= max; d++) {
      for (let k = -d; k <= d; k += 2) {
        let x = k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1])
          ? v[offset + k + 1] : v[offset + k - 1] + 1
        let y = x - k
        while (x < n && y < m && a[x] === b[y]) { x++; y++ }
        v[offset + k] = x
        if (x >= n && y >= m) return d
      }
    }
    return null
  }

  // Words removed from and added to a draft, by a word-level diff. Deleting a word and typing
  // it back is neither; `written - cut` always equals the change in countWords. A rewrite too
  // large to diff within `limit` edits counts its changed middle by word frequency instead,
  // which can only understate a cut.
  function diffWords(before, after, limit = 1000) {
    const a = wordTokens(before), b = wordTokens(after)
    let start = 0
    while (start < a.length && start < b.length && a[start] === b[start]) start++
    let endA = a.length, endB = b.length
    while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB-- }
    const midA = a.slice(start, endA), midB = b.slice(start, endB)
    const edits = editDistance(midA, midB, limit)
    let kept
    if (edits !== null) kept = (midA.length + midB.length - edits) / 2
    else {
      const counts = new Map()
      for (const word of midA) counts.set(word, (counts.get(word) || 0) + 1)
      kept = 0
      for (const word of midB) if (counts.get(word) > 0) { counts.set(word, counts.get(word) - 1); kept++ }
    }
    return { cut:midA.length - kept, written:midB.length - kept }
  }

  // Counts prose in plain text — an innerText read, or a Markdown body already stripped of
  // its delimiters. Stubs are removed first.
  function countPlain(text) {
    return countWords(stripStubs(stripRevisionNotes(text)))
  }

  // ── Revision notes ──────────────────────────────────────────────────────────
  // A revision note is a writer's reminder parked in the scene, rendered as a callout in the
  // editor and never part of the prose. On disk it is one line (FORMAT.md, "Revision notes"):
  //   <!-- quill:revise rv_7f3a2c | Kit should be more mischievous here -->
  // The note's text is plain. `\` and `<` are backslash-escaped, `-->` is written `--\>` so
  // it cannot close the comment early, and a newline is written `<br>` so a note never spans
  // two lines. Scope and the archive live in the novel's .revisions.json, keyed by id.
  const NOTE_LINE = /^[ \t]*<!--\s*quill:revise\s+(rv_[A-Za-z0-9]+)\s*\|\s?(.*?)\s*-->[ \t\r]*$/
  const NOTE_LINES = new RegExp(NOTE_LINE.source, 'gm')

  function encodeNoteText(text) {
    return String(text || '')
      .replace(/\r\n?/g, '\n')
      .replace(/\\/g, '\\\\')
      .replace(/</g, '\\<')
      .replace(/-->/g, '--\\>')
      .replace(/\n/g, '<br>')
      .trim()
  }

  function decodeNoteText(raw) {
    let out = ''
    const s = String(raw || '')
    for (let i = 0; i < s.length;) {
      if (s[i] === '\\' && i + 1 < s.length) { out += s[i + 1]; i += 2; continue }
      if (s.startsWith('<br>', i)) { out += '\n'; i += 4; continue }
      out += s[i++]
    }
    return out
  }

  function noteLine(id, text) {
    return '<!-- quill:revise ' + id + ' | ' + encodeNoteText(text) + ' -->'
  }

  function parseNoteLine(line) {
    const m = NOTE_LINE.exec(String(line || ''))
    return m ? { id: m[1], text: decodeNoteText(m[2]) } : null
  }

  // Every note in a Markdown body, in order, with the 0-based line it sits on.
  function findNotes(body) {
    const notes = []
    String(body || '').split(/\r?\n/).forEach((line, index) => {
      const note = parseNoteLine(line)
      if (note) notes.push({ ...note, line: index })
    })
    return notes
  }

  function stripRevisionNotes(text) { return String(text || '').replace(NOTE_LINES, '') }

  function mintNoteId() {
    let hex = ''
    const c = typeof crypto !== 'undefined' && crypto.getRandomValues ? crypto : null
    if (c) for (const b of c.getRandomValues(new Uint8Array(4))) hex += b.toString(16).padStart(2, '0')
    else for (let i = 0; i < 8; i++) hex += Math.floor(Math.random() * 16).toString(16)
    return 'rv_' + hex
  }

  return {
    STUB_PATTERN, stubRegExp, stripStubs, countWords, countPlain, wordTokens, diffWords,
    NOTE_LINE, encodeNoteText, decodeNoteText, noteLine, parseNoteLine, findNotes,
    stripRevisionNotes, mintNoteId,
  }
})
