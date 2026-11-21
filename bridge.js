/* bridge.js — Bridge: getting from the last scene written to the next scene the writer can see.
 * The worksheet (renderer/bridgebuilder.js) walks five steps: where you are, the open threads,
 * the lighthouse (the next scene you know), what has to be true by then, and the scenes that
 * get there, each one following from the one before ("because… so…"). Cards can be sent to
 * Unsorted as scene ideas, so the lighthouse and the gap can be drafted in any order.
 *
 * Pure: shared by main (cleaning what's saved in <novel>/.bridge.json) and the renderer
 * (window.QuillBridge). No AI: the questions do the work.
 */
;(function (root, factory) {
  const api = factory()
  if (typeof module !== 'undefined' && module.exports) module.exports = api
  else root.QuillBridge = api
})(typeof self !== 'undefined' ? self : globalThis, function () {
  const OUTCOMES = ['Yes', 'No', 'Yes, but…', 'No, and…']

  // What usually wakes a middle up. Each one is a question to answer about this book, not a
  // trope to paste in.
  const PRESSURES = [
    { id: 'reversal', label: 'Reversal', q: 'What do they think is true that turns out to be the opposite?' },
    { id: 'reveal', label: 'A reveal that changes the past', q: 'What could they learn that makes an earlier scene mean something else?' },
    { id: 'lie', label: 'The lie costs them', q: 'Where does believing the lie lose them something they wanted?' },
    { id: 'ally', label: 'An ally turns', q: 'Who on their side has a reason to stop helping, or to start lying?' },
    { id: 'clock', label: 'The clock tightens', q: 'What deadline can arrive early, or what door can close?' },
    { id: 'collide', label: 'Two threads collide', q: 'Which subplot can crash into the main plot here?' },
    { id: 'choice', label: 'No good option', q: 'What choice can you give them where both answers cost something?' },
    { id: 'false_win', label: 'A false win', q: 'What can they get that looks like winning and isn’t?' },
    { id: 'closer', label: 'Closer, then further', q: 'What brings the two of them closer, and what does it cost one of them?' },
    { id: 'consequence', label: 'A consequence lands', q: 'What did they do earlier that should come back now?' },
  ]

  const NOW_QUESTIONS = [
    { id: 'changed', q: 'What changed in the last scene you wrote?', hint: 'One sentence. If nothing changed, say that too.' },
    { id: 'want', q: 'What does your protagonist want right now, and what’s in the way?', hint: 'Right now, not at the end of the book.' },
    { id: 'worry', q: 'What is the reader worried about at this point?', hint: 'If you can’t name a worry, the next scene should make one.' },
  ]

  const id = () => Math.random().toString(36).slice(2, 10)
  const text = (value, max = 4000) => typeof value === 'string' ? value.slice(0, max) : ''
  const safeId = value => typeof value === 'string' && /^[\w-]{1,64}$/.test(value) ? value : id()
  const list = (value, max) => Array.isArray(value) ? value.slice(0, max).filter(x => x && typeof x === 'object') : []

  function blank() {
    return { version: 1, now: {}, advance: [], threads: [], lighthouse: { kind: '', beatId: '', text: '' }, needs: [], cards: [], updated: '' }
  }

  // Everything saved goes through here, in main and in the renderer.
  function clean(input) {
    const b = input && typeof input === 'object' ? input : {}
    const now = b.now && typeof b.now === 'object' ? b.now : {}
    const lh = b.lighthouse && typeof b.lighthouse === 'object' ? b.lighthouse : {}
    return {
      version: 1,
      now: Object.fromEntries(NOW_QUESTIONS.map(q => [q.id, text(now[q.id])])),
      // The novel's threads live in .threads.json (threads.js); Bridge keeps which ones the next
      // stretch has to move. `threads` is the list Bridge kept before that, read once to move it.
      advance: (Array.isArray(b.advance) ? b.advance : []).filter(x => typeof x === 'string' && /^[\w-]{1,64}$/.test(x)).slice(0, 500),
      threads: list(b.threads, 100).map(t => ({ id: safeId(t.id), text: text(t.text, 1000), advance: t.advance === true })),
      lighthouse: {
        kind: ['beat', 'known', 'free'].includes(lh.kind) ? lh.kind : '',
        beatId: typeof lh.beatId === 'string' ? lh.beatId.slice(0, 64) : '',
        text: text(lh.text),
      },
      needs: list(b.needs, 100).map(n => ({ id: safeId(n.id), text: text(n.text, 1000), done: n.done === true })),
      cards: list(b.cards, 100).map(c => ({
        id: safeId(c.id),
        because: text(c.because, 2000),
        then: text(c.then, 2000),
        outcome: OUTCOMES.includes(c.outcome) ? c.outcome : '',
        pressure: PRESSURES.some(p => p.id === c.pressure) ? c.pressure : '',
        needId: typeof c.needId === 'string' ? c.needId.slice(0, 64) : '',
        sentPath: typeof c.sentPath === 'string' ? c.sentPath.slice(0, 1000) : '',
      })),
      updated: text(b.updated, 40),
    }
  }

  // The manuscript in reading order (acts → chapters → scenes, as get-novel-structure gives it).
  function scenesInOrder(acts) {
    const out = []
    for (const act of acts || []) {
      for (const ch of act.chapters || []) {
        for (const sc of ch.scenes || []) out.push({ ...sc, chapter: ch.folderTitle || ch.name || '', act: act.folderTitle || '' })
      }
    }
    return out
  }

  // The last scenes with words in them, oldest first, and the words written so far.
  function whereYouAre(acts, count = 6) {
    const all = scenesInOrder(acts)
    const total = all.reduce((sum, sc) => sum + (Number(sc.word_count) || 0), 0)
    let last = all.length - 1
    while (last >= 0 && !(Number(all[last].word_count) > 0)) last--
    const recent = last < 0 ? [] : all.slice(Math.max(0, last - count + 1), last + 1)
    return { total, recent, scenes: all.length }
  }

  // Where a word count falls in a template, if the novel has a goal. Acts split the book
  // evenly (Act I and III a quarter each, the middle half), and beats split their act evenly.
  // A rough guide, said as one: "around the Midpoint".
  function position(template, words, goal) {
    const g = Number(goal) || 0
    if (!template || !g || !(words > 0)) return null
    const pct = Math.min(words / g, 1)
    const acts = template.acts || []
    const share = acts.length === 4 ? [0.25, 0.25, 0.25, 0.25] : acts.map(() => 1 / acts.length)
    let start = 0
    for (let i = 0; i < acts.length; i++) {
      const end = start + share[i]
      if (pct <= end || i === acts.length - 1) {
        const beats = acts[i].beats.filter(b => b.track !== 'rival')
        const at = beats.length ? beats[Math.min(beats.length - 1, Math.floor(((pct - start) / share[i]) * beats.length))] : null
        return { pct: Math.round(pct * 100), act: acts[i].label, beat: at }
      }
      start = end
    }
    return null
  }

  // Lighthouse choices: the template beats that have no scenes yet, from the last beat a
  // scene serves onward (so a book written past Act I doesn't offer the opening again), then
  // the "scene you already know" from the foundation, if there is one.
  function lighthouseOptions(template, scenesByBeat, structure, beatsText) {
    const beats = (template?.acts || []).flatMap(act => act.beats.map(b => ({ ...b, act: act.label })))
    const has = b => (scenesByBeat?.[b.id] || []).length > 0
    let lastServed = -1
    beats.forEach((b, i) => { if (has(b)) lastServed = i })
    const options = beats.slice(lastServed + 1).filter(b => !has(b)).map(b => ({
      kind: 'beat', beatId: b.id, label: b.label, act: b.act, hint: b.hint || '', text: String(beatsText?.[b.id] || ''),
    }))
    const known = String(structure?.foundation?.known || '').trim()
    if (known) options.push({ kind: 'known', beatId: '', label: 'The scene you already know', act: '', hint: '', text: known })
    return options
  }

  // A card's chain check: whether its "because" picks up the card before it. A card with no
  // because, after the first, is the gap the writer still has to close ("and then" plotting).
  function chain(cards) {
    return (cards || []).map((card, i) => ({
      id: card.id,
      linked: i === 0 || !!String(card.because || '').trim(),
    }))
  }

  // A card as a scene idea's synopsis.
  function synopsis(card) {
    const because = String(card.because || '').trim().replace(/[.\s]+$/, '')
    const then = String(card.then || '').trim()
    const line = because && then ? `Because ${lower(because)}, ${lower(then)}` : (then || because)
    return [line, card.outcome ? `(${card.outcome})` : ''].filter(Boolean).join(' ')
  }
  // Mid-sentence, a leading "She" or "The" goes lower case; names keep their capital.
  const lower = s => s.replace(/^(because|so|then)\s+/i, '')
    .replace(/^(She|He|They|It|We|You|The|A|An|His|Her|Their|Its|Our|This|That|Someone|Everyone|Nobody)\b/, w => w.toLowerCase())

  const TRAILING = /^(a|an|the|and|or|but|of|to|in|on|at|by|for|with|from|into|under|over|about|after|before|as|than|her|his|their|its|that|who)$/i

  // A short title for a card's scene idea: the first few words of what happens.
  function sceneTitle(card, n) {
    const words = String(card.then || card.because || '').trim().replace(/[.!?…]+$/, '').split(/\s+/).filter(Boolean)
    if (!words.length) return `Bridge scene ${n}`
    const kept = words.slice(0, 6).map(w => w.replace(/[,;:]+$/, ''))
    // Don't stop on a little word: "She finds the letter under" reads as cut off.
    while (kept.length > 2 && TRAILING.test(kept[kept.length - 1])) kept.pop()
    const short = kept.join(' ')
    return short.charAt(0).toUpperCase() + short.slice(1)
  }

  // One line for the Structure outline: what the plan is aiming at and how far it's got.
  function summary(bridge, template) {
    const b = bridge || blank()
    if (!b.cards.length && !b.lighthouse.kind && !String(b.lighthouse.text || '').trim()) return ''
    const beat = (template?.acts || []).flatMap(a => a.beats).find(x => x.id === b.lighthouse.beatId)
    const target = b.lighthouse.kind === 'beat' ? (beat?.label || 'a beat')
      : b.lighthouse.kind === 'known' ? 'the scene you know' : b.lighthouse.text ? 'your lighthouse' : ''
    // The lighthouse, once sent, is kept as a card (needId 'lighthouse'); it isn't a gap scene.
    const gap = b.cards.filter(c => c.needId !== 'lighthouse')
    const sent = gap.filter(c => c.sentPath).length
    const parts = []
    if (gap.length) parts.push(`${sent} of ${gap.length} scene${gap.length === 1 ? '' : 's'} sent`)
    if (target) parts.push(`heading for ${target}`)
    return `Bridge: ${parts.join(' · ')}`
  }

  return { OUTCOMES, PRESSURES, NOW_QUESTIONS, blank, clean, scenesInOrder, whereYouAre, position, lighthouseOptions, chain, synopsis, sceneTitle, summary }
})
