/* stylelab.js — the writing gym */

const StyleLab = (() => {

  // ── Drill definitions ─────────────────────────────────────
  const DRILLS = {
    'what-if': {
      name:  'What If',
      dot:   '#8a4f7d',
      desc:  'Put your characters in a situation and find out what they do. Reflect, then see another take.',
      custom: true,  // its own runner (stylelab-whatif.js)
      prompts: [],
      writerPlaceholder: 'Write the scene. The characters are allowed to resist the premise.',
      criteria: [
        'Consistent with where the story and these characters currently stand',
        'Holds POV: only what the narrator could know, notice or assume',
        'Characters act from their own motives and resist the premise where they would',
        'Any emotional turn is earned on the page, not announced',
      ],
      feedbackFocus: "This is a character-discovery rep, not a prose drill. Judge character truth against the story reference material, not sentence polish. A rep where the characters refuse the premise's payoff can be a strong rep. Do not suggest making the scene more dramatic or more romantic for its own sake.",
    },
    'sentence-surgery': {
      name:  'Sentence Surgery',
      dot:   '#5b6b3a',
      desc:  'Take a paragraph from your manuscript and make one or two passes on it. Same voice, fewer habits.',
      custom: true,  // picks its prompt from the manuscript, not a list
      prompts: [],
      writerPlaceholder: 'Edit the paragraph here. The scene file is never changed.',
      criteria: [
        'Tighter or clearer than the original',
        "Still Anna: her humor and the gap between what she claims and what she does survive",
        'Did the chosen passes without making the prose more literary',
      ],
      feedbackFocus: "The writer is revising a paragraph from their own first-person novel (narrator: Anna). Compare BEFORE and AFTER. Judge only the passes they chose. In WORKING, name the single edit that helped most. Never push toward more figurative or literary prose; a plainer sentence that sounds like her beats a prettier one that doesn't.",
    },

    'pov-lens': {
      name:  'POV Lens',
      dot:   '#3d7a78',
      desc:  'Describe a place through what one character wants or fears there. Three details, no inventory.',
      prompts: [
        { place: "Marisa and Jessica's apartment in IV", state: "Anna, looking for whatever Jessica left behind while Marisa cries in the kitchen." },
        { place: 'The back office at Seven', state: "Anna, waiting for the computer to boot, her throat still aching from the fledgling's forearm." },
        { place: "Pueblo Street outside Kit's apartment, 2 AM", state: "Anna, parked where she always parked, two weeks after he turned. She isn't going in." },
        { place: "Sangre's main floor", state: 'Anna, her second time in, knowing Kit might be on the dance floor.' },
        { place: 'The bullpen at HQ', state: 'Anna, her first morning back, in the minute before anyone notices her.' },
        { place: 'Room 22 at the Harbor Motel, cleaned and rented again', state: 'Anna, back alone and off the clock.' },
        { place: "Philip's office", state: 'Anna, waiting for him to come back from the press briefing, alone with his commendations.' },
        { place: "Sangre's main floor", state: 'Moreno, counting treaty violations. Third person close.' },
      ],
      writerPlaceholder: 'What does she notice first, and what does she think of it?',
      criteria: [
        'Filtered through the stated want or fear, not a neutral camera',
        'Selective: three concrete details or fewer, each earning its place',
        "At least one detail carries the character's judgment",
        'More specific without more ornament',
      ],
      feedbackFocus: 'This drill trains selection: description that builds setting and character at once. A "There was X, Y, and Z" list is the habit being trained out.',
    },

    'beat-prose': {
      name:  'Beat → Prose',
      dot:   '#2d6a4f',
      desc:  'Given a beat, write the scene. Land the emotional turn in 150 words.',
      prompts: [
        { beat: "She realizes he's been lying the whole time.", constraint: "POV: her. 120–150 words. The realization should land in the middle, not the end." },
        { beat: "A character returns to a place they swore they'd never come back to.", constraint: "Third person close. 100–140 words. Open with a physical detail, not an emotion." },
        { beat: "Two characters who love each other have to pretend, in front of others, that they don't.", constraint: "Any POV. 130–160 words. No dialogue." },
        { beat: "A character forgives someone who isn't sorry.", constraint: "First person. 100–140 words. Don't use the word 'forgive.'" },
        { beat: "Someone asks a question they already know the answer to, and gets it anyway.", constraint: "120–150 words. The second half should feel slower than the first." },
        { beat: "A character breaks a promise to themselves.", constraint: "Third person. 100–140 words. End on a physical action, not a thought." },
        { beat: "Two people who haven't spoken in a year meet again by accident.", constraint: "Any POV. 130–160 words. The first line should not name either of them." },
        { beat: "A character chooses the wrong thing on purpose.", constraint: "120–150 words. We should feel the rightness of the wrong choice." },
      ],
      writerPlaceholder: "Write the scene here. Don't worry about it being good — worry about it being specific.",
    },

    'metaphor-forge': {
      name:  'Metaphor Forge',
      dot:   '#a0522d',
      desc:  'Three metaphors per prompt: cliché, better, strange. Build voice.',
      prompts: [
        { subject: "grief, after loss", note: "Specific, not grand." },
        { subject: "being wanted by someone you shouldn't want back", note: "No hearts, no fire." },
        { subject: "a silence that has a shape", note: "Make it physical." },
        { subject: "the moment just before a decision", note: "Not a fork in a road." },
        { subject: "jealousy that the character won't name", note: "Not green, not acid." },
        { subject: "the feeling of being seen too clearly by someone", note: "Not a mirror." },
        { subject: "desire that has gone on too long", note: "Not hunger, not thirst." },
        { subject: "a memory that won't stay where it's supposed to", note: "Not a ghost." },
      ],
      writerPlaceholder: "CLICHÉ (name it)\n\n\nBETTER\n\n\nSTRANGE\n",
    },

    'voice-match': {
      name:  'Voice Match',
      dot:   '#3b6bbf',
      desc:  'Pick a character. Write them in a mundane situation. Score against their profile.',
      prompts: [
        { situation: "ordering coffee from a stranger" },
        { situation: "waiting for someone who's late" },
        { situation: "losing their keys" },
        { situation: "lying about being fine" },
        { situation: "apologizing for something small" },
        { situation: "being interrupted mid-thought" },
        { situation: "choosing what to eat when they're not hungry" },
        { situation: "pretending not to recognize someone" },
      ],
      writerPlaceholder: "3–4 sentences in their voice. Don't name them — let the voice do it.",
    },

    'pacing-gym': {
      name:  'Pacing Gym',
      dot:   '#8a4fb8',
      desc:  'Same beat, three speeds: compressed, scene, stretched.',
      prompts: [
        { beat: "A character sees a letter on a table they weren't expecting." },
        { beat: "Two people almost kiss and then don't." },
        { beat: "A door closes on a conversation that wasn't finished." },
        { beat: "Someone drops a glass." },
        { beat: "A character hears their name from across a crowded room." },
        { beat: "A phone rings at the wrong moment." },
        { beat: "A character catches their reflection unexpectedly." },
        { beat: "Someone reaches for a hand and pulls back." },
      ],
      writerPlaceholder: "COMPRESSED (one sentence)\n\n\nSCENE (a paragraph)\n\n\nSTRETCHED (half a page — every second counts)\n",
      criteria: [
        'The three versions differ in time covered, not just length',
        'The stretched version slows at the moment that matters',
        'The compressed version still lands the beat',
      ],
    },

    'rewrite-cliche': {
      name:  'Rewrite the Cliché',
      dot:   '#b83030',
      desc:  'Take a dark romance cliché. Make it precise, specific, earned.',
      prompts: [
        { line: "Her heart raced as his eyes met hers." },
        { line: "He was dangerous, and she knew it, but she couldn't stay away." },
        { line: "Time seemed to stop when he walked into the room." },
        { line: "She felt a shiver run down her spine." },
        { line: "He was the kind of man who broke women like her." },
        { line: "Their chemistry was electric." },
        { line: "She had never felt anything like this before." },
        { line: "He looked at her like she was the only person in the world." },
      ],
      writerPlaceholder: "Rewrite the line. Keep the beat — make the prose earn it.",
      criteria: [
        'Keeps the original emotional beat',
        'Specific to these people, not swappable into any book',
        'No new cliché in its place',
      ],
    },

    'sensory-anchor': {
      name:  'Sensory Anchor',
      dot:   '#c88a2a',
      desc:  'Write a beat using only non-visual senses. Kill the visual default.',
      prompts: [
        { dialogue: '"I told you I would come back."', note: "Build the beat around this line." },
        { dialogue: '"Don\'t look at me like that."', note: "Build the beat around this line." },
        { dialogue: '"You don\'t have to say anything."', note: "Build the beat around this line." },
        { dialogue: '"I knew the moment I saw you."', note: "Build the beat around this line." },
        { dialogue: '"Stop pretending you don\'t know."', note: "Build the beat around this line." },
        { dialogue: '"I\'m not asking."', note: "Build the beat around this line." },
      ],
      writerPlaceholder: "Sound, smell, touch, temperature, taste. No sight, no looking, no seeing.",
      criteria: [
        'Non-visual senses carry the beat',
        'Embodied (pressure, temperature, distance, weight), not a catalog of smells',
        'The dialogue line lands harder for the setup',
      ],
    },

    'interiority': {
      name:  'Interiority Drill',
      dot:   '#2d6a4f',
      desc:  'Given an external event, write surface thought, buried feeling, and physical tell.',
      prompts: [
        { event: "Their name is mentioned in a conversation they weren't part of." },
        { event: "Someone they love compliments someone else." },
        { event: "An old text message surfaces on their screen." },
        { event: "A stranger says something kind to them." },
        { event: "They walk past a place that used to matter." },
        { event: "Someone asks them how they're doing and actually waits for the answer." },
        { event: "They find something in a pocket they forgot they had." },
      ],
      writerPlaceholder: "SURFACE THOUGHT (what they notice themselves thinking)\n\n\nBURIED FEELING (what they'd never say out loud)\n\n\nPHYSICAL TELL (the body's giveaway)\n",
      criteria: [
        'The three layers are distinct from each other',
        'The buried feeling is implied by the surface and the tell, not restated',
        'The physical tell is specific to this feeling, not heat, flush, or heartbeat',
      ],
    },

    'dialogue-spar': {
      name:  'Dialogue Spar',
      dot:   '#7a3d8f',
      desc:  'Two characters, conflicting wants. Write the exchange. No fancy tags, no monologue.',
      prompts: [
        { setup: "She's about to tell him she's leaving. He doesn't know yet — but he can feel something is off and is asking the wrong questions to avoid the right ones." },
        { setup: "He's apologizing for something he doesn't actually think he was wrong about. She knows it, and is deciding whether to let him get away with it." },
        { setup: "Two exes run into each other at a mutual friend's thing. Both are pretending to be fine. One is lying better than the other." },
        { setup: "She's asking him for a favor she has no right to ask. He's going to say yes and they both know it — the question is how long she'll make him wait to offer." },
        { setup: "He's trying to confess he's in love with her without using the word love. She's pretending not to understand." },
        { setup: "She caught him in a small lie. The conversation is ostensibly about the lie. It is actually about something much bigger that neither of them is naming." },
        { setup: "Two people who slept together once, months ago, and never talked about it. Now they have to work together on something. This is the first conversation." },
        { setup: "He's telling her he can't see her anymore. He doesn't mean it. She knows he doesn't mean it. He needs her to argue him out of it. She isn't going to." },
      ],
      writerPlaceholder: "Write the exchange. \"Said\" tags only. Minimal blocking — a gesture or two, max. No internal monologue. Let the silences and the wrong answers do the work.",
    },

    'style-study': {
      name:  'Style Study',
      dot:   '#4a6fa5',
      desc:  'Close-read a passage from a book you admire, choose one effect, and practice it in your own prose.',
      custom: true,  // uses its own runner
      writerPlaceholder: "Rewrite the passage in your own voice. Keep the beat — make the prose yours.",
    },
  }

  // Prose drills first: these target the habits the draft actually shows. Nothing is removed.
  const DRILL_ORDER = ['what-if', 'sentence-surgery', 'pov-lens', 'style-study', 'sensory-anchor', 'rewrite-cliche', 'interiority', 'pacing-gym', 'beat-prose', 'voice-match', 'dialogue-spar', 'metaphor-forge']

  // Sentence Surgery passes. scanParagraph tags in study.js name the pass they suggest.
  const SURGERY_PASSES = [
    { id: 'cut',       label: 'Cut 10–15%',                  hint: 'Same meaning, fewer words. Participle tags ("she said, tapping…") are usually first to go.' },
    { id: 'tell',      label: 'Trade one stock tell',        hint: 'Swap a heat/heart reaction for something only this feeling, in this room, would cause.' },
    { id: 'questions', label: 'Collapse a question run',     hint: 'Keep the one question that matters, or turn the run into a statement.' },
    { id: 'rule',      label: 'Move a rule out of the action', hint: 'World rules wait until the action stops, or go.' },
    { id: 'list',      label: 'Break up a list',             hint: 'Keep the details she would judge, and give one of them her opinion.' },
  ]

  // ── Public-domain passage library for Style Study ─────────
  // Only authors dead >70 years, out of copyright in most jurisdictions.
  const PASSAGES = [
    {
      author: 'Virginia Woolf',
      source: 'Mrs Dalloway',
      text: "She had a perpetual sense, as she watched the taxi cabs, of being out, out, far out to sea and alone; she always had the feeling that it was very, very dangerous to live even one day."
    },
    {
      author: 'F. Scott Fitzgerald',
      source: 'The Great Gatsby',
      text: "He smiled understandingly—much more than understandingly. It was one of those rare smiles with a quality of eternal reassurance in it, that you may come across four or five times in life. It faced—or seemed to face—the whole external world for an instant, and then concentrated on you with an irresistible prejudice in your favor."
    },
    {
      author: 'Jane Austen',
      source: 'Persuasion',
      text: "She had been forced into prudence in her youth, she learned romance as she grew older: the natural sequel of an unnatural beginning."
    },
    {
      author: 'Charlotte Brontë',
      source: 'Jane Eyre',
      text: "I am no bird; and no net ensnares me: I am a free human being with an independent will, which I now exert to leave you."
    },
    {
      author: 'Edith Wharton',
      source: 'The Age of Innocence',
      text: "Each time you happen to me all over again. She held her muff to her face as if to hide herself from the truth of what she was about to say."
    },
    {
      author: 'Joseph Conrad',
      source: 'Heart of Darkness',
      text: "The yarns of seamen have a direct simplicity, the whole meaning of which lies within the shell of a cracked nut. But Marlow was not typical (if his propensity to spin yarns be excepted), and to him the meaning of an episode was not inside like a kernel but outside, enveloping the tale which brought it out only as a glow brings out a haze."
    },
    {
      author: 'Katherine Mansfield',
      source: 'Bliss',
      text: "Although Bertha Young was thirty she still had moments like this when she wanted to run instead of walk, to take dancing steps on and off the pavement, to bowl a hoop, to throw something up in the air and catch it again, or to stand still and laugh at—nothing—at nothing, simply."
    },
    {
      author: 'Thomas Hardy',
      source: 'Tess of the d\'Urbervilles',
      text: "She had never before been to Flintcomb-Ash. She knew nobody here. She was wanted because her muscles were firm. Over the flat lea of Flintcomb-Ash the rain showers formed themselves into cuts: and the field, in that misty afternoon, looked like nothing more than a vast expanse of upturned coffin-lids."
    },
  ]

  const BRUTALITY_LEVELS = ['gentle', 'kind', 'honest', 'sharp', 'brutal']
  const BRUTALITY_LABELS = { gentle: 'Gentle', kind: 'Kind', honest: 'Honest', sharp: 'Sharp', brutal: 'Brutal' }


  // ── Default AI generator config per drill ────────────────
  // Use ${genre} as a token that gets replaced at generation time.
  const DEFAULT_DRILL_INSTRUCTIONS = {
    'beat-prose':     `Invent a short scene BEAT for a writer practicing the \${genre} genre. One sentence describing an emotional moment. Plus a CONSTRAINT (POV, word count 100-160, one craft rule like "no dialogue" or "open with a physical detail").`,
    'metaphor-forge': `Invent an abstract SUBJECT for a metaphor drill in the \${genre} genre. Something emotional but specific (e.g. "jealousy that the character won't name"). Plus a short NOTE ruling out one obvious cliché (e.g. "no hearts, no fire").`,
    'voice-match':    `Invent a mundane SITUATION for a character voice drill (e.g. "ordering coffee from a stranger"). Keep it small and everyday. No genre-specific framing.`,
    'pacing-gym':     `Invent a small concrete BEAT suitable for a pacing drill in the \${genre} genre. One sentence. Should be a physical action or moment that can be rendered fast or slow.`,
    'rewrite-cliche': `Invent a real cliché LINE from the \${genre} genre — something that would make a sharp reader groan. One sentence, in quotes.`,
    'sensory-anchor': `Invent a single line of DIALOGUE that would fit in a \${genre} scene. Emotionally charged but short.`,
    'interiority':    `Invent a small external EVENT for an interiority drill in the \${genre} genre. One sentence. Something a character could react to with layered feeling.`,
    'pov-lens':       `Invent a PLACE for a description drill in the \${genre} genre: an ordinary, specific room, street, or business a character walks into (not a castle or a ballroom). Then the character's STATE there: one sentence on what they want or fear in that place right now. Name the character by a role or first name, not by a feeling.`,
    'dialogue-spar':  `Write a SETUP for a dialogue subtext drill. A setup is a snapshot of a charged moment between two people who are already in a room together — NOT a story pitch, and NOT an interpretation of the scene's meaning. Your job is to set the scene up, not solve it.

STRICT RULES:
- Use "he" and "she" (or "they"). NEVER name archetypes, roles, jobs, or creature types. No "warrior", "scholar", "vampire", "detective", "king", "witch", "mortal", "immortal", etc.
- NO setting words. No libraries, castles, taverns, forests, bedrooms, midnight, cities. The reader should not know where they are.
- NO backstory, no worldbuilding, no magic, no plot mechanics.
- NO naming the topic they argue about.
- ASYMMETRIC INTERIORITY: describe ONE person's inner move clearly — what they're about to do, hiding, realizing. Describe the OTHER person only as a sense, a gap, a wrong move they're making. Do NOT narrate both interiors in full.
- NAME THE MOVE, NOT THE MEANING: say what someone is *doing* (asking the wrong questions, pretending not to understand, apologizing for something he doesn't mean). Do NOT name the tragic irony, the emotional theme, or what the scene is "about". Leave the writer something to discover.
- 2 short sentences. Ideally the first sets up the situation, the second names the gap.

Genre (\${genre}) should only influence emotional temperature — NOT setting, creatures, or plot.

GOOD EXAMPLES (match this exact shape — notice how each leaves the subtext *unnamed*):
- "She's about to tell him she's leaving. He doesn't know yet — but he can feel something is off and is asking the wrong questions to avoid the right ones."
- "He's apologizing for something he doesn't actually think he was wrong about. She knows it, and is deciding whether to let him get away with it."
- "She caught him in a small lie. The conversation is ostensibly about the lie. It is actually about something much bigger that neither of them is naming."
- "He's trying to confess he's in love with her without using the word love. She's pretending not to understand."

BAD EXAMPLE 1 — pitch mode (names archetypes, sets a scene, pitches a plot):
"A cursed immortal warrior and a mortal scholar meet in a library at midnight; she wants him to help break an ancient spell while he wants her to leave before she discovers what he's protecting."

BAD EXAMPLE 2 — over-explained mode (right shape, but narrates both interiors and names the tragic irony outright, leaving nothing to discover):
"She's pretending his silence doesn't hurt her, asking practical questions about logistics to keep him talking. He's silent because he's already decided to go and is memorizing the sound of her voice, mistaking her efficiency for acceptance."
— Too much. The writer should discover that he's memorizing her voice, and that he's misreading her. Don't pre-interpret the scene.

Now write ONE new setup. Two sentences. Name the move, not the meaning. Leave the writer room.`,
  }

  const DEFAULT_FORMAT_HINTS = {
    'beat-prose':     'BEAT: ...\nCONSTRAINT: ...',
    'metaphor-forge': 'SUBJECT: ...\nNOTE: ...',
    'voice-match':    'SITUATION: ...',
    'pacing-gym':     'BEAT: ...',
    'rewrite-cliche': 'LINE: ...',
    'sensory-anchor': 'DIALOGUE: ...',
    'interiority':    'EVENT: ...',
    'pov-lens':       'PLACE: ...\nSTATE: ...',
    'dialogue-spar':  'SETUP: ...',
  }

  const DEFAULT_DRILL_MAX_TOKENS = 120

  // Per-drill generator overrides live in localStorage as { drillKey: { prompt, max_tokens } }.
  // An old stored `model` is ignored: the model comes from Settings → AI.
  function getDrillOverrides() {
    try { return JSON.parse(localStorage.getItem('quill_stylelab_overrides') || '{}') || {} }
    catch { return {} }
  }
  function saveDrillOverrides(obj) {
    localStorage.setItem('quill_stylelab_overrides', JSON.stringify(obj || {}))
  }
  // Returns the effective config for a drill, merging overrides over defaults.
  function getDrillConfig(drillKey) {
    const ov = getDrillOverrides()[drillKey] || {}
    return {
      prompt:     ov.prompt     && ov.prompt.trim()     ? ov.prompt     : (DEFAULT_DRILL_INSTRUCTIONS[drillKey] || ''),
      model:      resolvedModel(),
      max_tokens: Number.isFinite(ov.max_tokens) && ov.max_tokens > 0 ? ov.max_tokens : DEFAULT_DRILL_MAX_TOKENS,
    }
  }

  // ── State ─────────────────────────────────────────────────
  let _currentDrill  = null
  let _currentPrompt = null
  let _feedbackText  = ''
  let _repCount      = 0
  let _savedLines    = []

  // ── Helpers ───────────────────────────────────────────────
  function esc(s) { return escapeHtml(s) }
  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)] }
  function getSettings() {
    const raw = localStorage.getItem('quill_stylelab_settings')
    const defaults = {
      instructions: '',
      genre:        'dark romance / romantasy',
      brutality:    'honest',
      drillsOn:     Object.fromEntries(DRILL_ORDER.map(k => [k, true])),
      autoSave:     true,
    }
    try {
      const parsed = raw ? JSON.parse(raw) : {}
      return Object.assign({}, defaults, parsed, {
        drillsOn: Object.assign({}, defaults.drillsOn, parsed.drillsOn || {}),
      })
    } catch { return defaults }
  }
  function saveSettings(s) {
    localStorage.setItem('quill_stylelab_settings', JSON.stringify(s))
  }
  // Every AI tool uses the one model chosen in Settings → AI.
  function resolvedModel() { return QuillModels.current() }
  function getStats() {
    let stats
    try { stats = JSON.parse(localStorage.getItem('quill_stylelab_stats') || '{}') } catch { stats = {} }
    // Normalize stale values on read so the landing display is always correct,
    // even if the user hasn't completed a rep in a long time.
    const now = new Date()
    const today = window.QuillDates.localDateKey(now)
    const yesterday = window.QuillDates.localDateKey(window.QuillDates.addLocalDays(now, -1))
    const currentWeekKey = window.QuillDates.localWeekKey(now)
    // Streak is broken if last rep wasn't today or yesterday.
    if (stats.streakDate !== today && stats.streakDate !== yesterday) {
      stats.streak = 0
    }
    // Weekly count resets if we've rolled into a new week.
    if (stats.weekKey !== currentWeekKey) {
      stats.weekReps = 0
    }
    return stats
  }
  function bumpStats() {
    let stats
    try { stats = JSON.parse(localStorage.getItem('quill_stylelab_stats') || '{}') } catch { stats = {} }
    const next = QuillStudy.bumpStats(stats, { dates: window.QuillDates })
    localStorage.setItem('quill_stylelab_stats', JSON.stringify(next))
  }
  // One rep per Style Study, dated when it was completed. The study id and the totals are
  // one object written in one setItem, so a crash can't count without recording, or the reverse.
  function recordStudyRep(studyId, completedAt) {
    let stats
    try { stats = JSON.parse(localStorage.getItem('quill_stylelab_stats') || '{}') } catch { stats = {} }
    const date = completedAt ? new Date(completedAt) : new Date()
    const next = QuillStudy.bumpStats(stats, { studyId, date: Number.isNaN(date.getTime()) ? new Date() : date, dates: window.QuillDates })
    if (!next) return false
    try { localStorage.setItem('quill_stylelab_stats', JSON.stringify(next)) } catch { return false }
    return true
  }

  // ── Entry ─────────────────────────────────────────────────
  async function open() {
    await window.quill.ensureStyleLab().catch(() => {})
    // Awaited, so a caller that opens a study right after (Recent Reps) can't have this
    // landing page land on top of it.
    await renderLanding()
    StyleStudy.reconcile?.()
  }

  // ── Landing page ──────────────────────────────────────────
  async function renderLanding() {
    _currentDrill  = null
    _currentPrompt = null
    _feedbackText  = ''
    const inner = document.getElementById('stylelab-inner')
    if (!inner) return
    const settings = getSettings()
    const stats    = getStats()
    const streakHTML = stats.streak
      ? `🔥 ${stats.streak} day streak · ${stats.weekReps || 0} reps this week · ${stats.totalReps || 0} total`
      : (stats.totalReps
          ? `No reps this week · ${stats.totalReps} total. Pick a drill to start a new streak.`
          : 'Start your first rep today.')

    // Load recent saved lines
    await loadSavedLines()
    const linesHTML = _savedLines.length
      ? _savedLines.slice(0, 3).map(l => `<div class="sl-line">${esc(l)}</div>`).join('')
      : `<p class="hint">No saved lines yet. Save the ones you want to keep — this is your proof of work.</p>`

    const drillCardsHTML = DRILL_ORDER
      .filter(k => settings.drillsOn[k] !== false)
      .map(k => {
        const d = DRILLS[k]
        return `
          <button class="card sl-drill-card" data-drill="${k}" style="--dot:${d.dot}">
            <div class="card-title"><span class="sl-drill-dot"></span>${esc(d.name)}</div>
            <div class="card-text">${esc(d.desc)}</div>
          </button>`
      }).join('')

    inner.innerHTML = `
      <div class="page-head sl-head">
        <div>
          <div class="kicker">Style Lab</div>
          <div class="page-title it">The writing gym.</div>
          <div class="page-sub">Short drills. Honest feedback. You're not here to be good — you're here to put in the reps. Pick a drill.</div>
        </div>
        <button class="btn ghost icon" id="sl-settings-btn" title="Style Lab settings" aria-label="Style Lab settings">
          <svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
        </button>
      </div>
      <section class="section">
        <div class="section-label">Drills<span class="section-actions hint">${streakHTML}</span></div>
        <div class="card-grid sl-drill-grid">${drillCardsHTML}</div>
      </section>
      <section class="section">
        <div class="section-label">Your book of lines</div>
        ${linesHTML}
        ${_savedLines.length ? `<p class="hint subtle sl-lines-foot">${_savedLines.length} saved line${_savedLines.length === 1 ? '' : 's'} · click "Saved lines" in the sidebar to see all</p>` : ''}
      </section>
    `

    // Wire drill cards
    inner.querySelectorAll('.sl-drill-card').forEach(card => {
      card.onclick = () => {
        const k = card.dataset.drill
        openDrill(k)
      }
    })
    // Wire settings gear
    document.getElementById('sl-settings-btn').onclick = openSettings
  }

  // ── Load saved lines from the commonplace file ────────────
  async function loadSavedLines() {
    try {
      const file = await window.quill.getFile('Style Lab/Saved lines.md').catch(() => null)
      if (!file || !file.body) { _savedLines = []; return }
      // Extract blockquote lines
      const lines = file.body.split('\n')
      const quoted = []
      for (const ln of lines) {
        const m = ln.match(/^>\s+(.+)$/)
        if (m) quoted.push(m[1].trim())
      }
      _savedLines = quoted.reverse() // newest first
    } catch {
      _savedLines = []
    }
  }

  // ── Drill runner ──────────────────────────────────────────
  function openDrill(drillKey) {
    const drill = DRILLS[drillKey]
    if (!drill) return
    _currentDrill  = drillKey
    _feedbackText  = ''
    if (drill.custom && drillKey === 'style-study') {
      _currentPrompt = null
      StyleStudy.open()
      return
    }
    if (drillKey === 'sentence-surgery') {
      _currentPrompt = null
      renderSurgeryPicker()
      return
    }
    if (drillKey === 'what-if') {
      _currentPrompt = null
      WhatIf.open()
      return
    }
    _currentPrompt = pick(drill.prompts)
    renderDrillRunner()
  }

  // ── Sentence Surgery: patterns ──
  // Built-ins can be switched off; custom patterns are the writer's own. Per-device, like the
  // rest of Style Lab's settings.
  const PATTERNS_KEY = 'quill_surgery_patterns'
  const BOOK_KEY = 'quill_surgery_book'
  function getPatterns() {
    try {
      const p = JSON.parse(localStorage.getItem(PATTERNS_KEY) || '{}') || {}
      return {
        disabled: Array.isArray(p.disabled) ? p.disabled.filter(x => typeof x === 'string') : [],
        custom: (Array.isArray(p.custom) ? p.custom : []).map(QuillStudy.cleanCustomPattern),
      }
    } catch { return { disabled: [], custom: [] } }
  }
  function savePatterns(p) { try { localStorage.setItem(PATTERNS_KEY, JSON.stringify(p)) } catch {} }
  function scanSurgery(text) { return QuillStudy.scanParagraph(text, getPatterns()) }

  // Paragraph HTML with whatever set each tag off highlighted.
  function markedHTML(text, tags) {
    return QuillStudy.markSpans(text, tags)
      .map(r => r.kinds.length ? `<mark class="sl-sg-hit" data-kinds="${esc(r.kinds.join(' '))}">${esc(r.t)}</mark>` : esc(r.t))
      .join('')
  }
  function tagPillsHTML(tags) {
    return tags.length
      ? `<div class="sl-sg-tags">${tags.map(x => `<span class="sl-sg-tag${x.custom ? ' custom' : ''}" data-kind="${esc(x.kind)}" title="Hover to see what set this off">${esc(x.label)}</span>`).join('')}</div>`
      : ''
  }
  // Hovering a pill dims every highlight except its own, within the same paragraph block.
  function wirePills(root) {
    root.querySelectorAll('.sl-sg-tag[data-kind]').forEach(pill => {
      const box = pill.closest('.ss-scene-para, .sl-sg-origwrap')
      if (!box) return
      pill.onmouseenter = () => box.querySelectorAll('mark.sl-sg-hit').forEach(m => m.classList.toggle('dim', !m.dataset.kinds.split(' ').includes(pill.dataset.kind)))
      pill.onmouseleave = () => box.querySelectorAll('mark.sl-sg-hit').forEach(m => m.classList.remove('dim'))
    })
  }

  // ── Sentence Surgery: pick a paragraph (or a short run) from the manuscript ──
  async function renderSurgeryPicker() {
    const inner = document.getElementById('stylelab-inner')
    if (!inner) return
    inner.innerHTML = `
      <button class="btn ghost sm page-back" id="sl-back-btn">‹ Style Lab</button>
      <div class="page-head">
        <div class="kicker">Sentence Surgery</div>
        <div class="page-title it long sl-prompt">Pick a paragraph from your manuscript.</div>
        <div class="page-sub sl-prompt-sub">Tags mark habits worth a pass, and the words that set each one off are highlighted (hover a tag to see just its words). Click a paragraph; shift-click to extend to a short run or an exchange.</div>
      </div>
      <details class="sl-sg-patterns" id="sl-sg-patterns"></details>
      <section class="section">
        <div class="section-label">Scene</div>
        <div class="hint" id="sl-sg-status">Loading your manuscript…</div>
        <div class="chip-row sl-sg-books" id="sl-sg-books"></div>
        <input class="field" id="sl-sg-search" placeholder="Search scenes by title or chapter">
        <div class="ss-scene-list sl-sg-scenes" id="sl-sg-scenes"></div>
      </section>
      <section class="section">
        <div class="section-label">Paragraph<span class="section-actions"><label class="check"><input type="checkbox" id="sl-sg-flagged"> Tagged paragraphs only</label></span></div>
        <div class="ss-scene-paras" id="sl-sg-paras"></div>
      </section>
      <div class="btn-row sl-drill-actions">
        <button class="btn primary" id="sl-sg-start" disabled>Operate on this</button>
      </div>
    `
    document.getElementById('sl-back-btn').onclick = renderLanding
    const status  = document.getElementById('sl-sg-status')
    const booksEl = document.getElementById('sl-sg-books')
    const search  = document.getElementById('sl-sg-search')
    const list    = document.getElementById('sl-sg-scenes')
    const parasEl = document.getElementById('sl-sg-paras')
    const flagged = document.getElementById('sl-sg-flagged')
    const start   = document.getElementById('sl-sg-start')
    const patEl   = document.getElementById('sl-sg-patterns')
    let chosen = null   // { sc, blocks, first, last }

    const { scenes, rank, current } = await StyleStudy.listManuscriptScenes()
    if (!document.getElementById('sl-sg-scenes')) return  // navigated away while loading
    status.textContent = scenes.length ? '' : 'No manuscript scenes found.'

    // Book: last one used here, else the open scene's book, else the first.
    const books = [...new Set(scenes.map(sc => sc.novel))]
    let book = null
    try { book = localStorage.getItem(BOOK_KEY) } catch {}
    if (book !== '' && !books.includes(book)) book = (scenes.find(sc => sc.path === current) || scenes[0] || {}).novel || ''

    const drawBooks = () => {
      booksEl.innerHTML = [...books, ''].map(b => `<button class="chip sl-sg-book${b === book ? ' active' : ''}" data-book="${esc(b)}">${esc(b || 'All books')}</button>`).join('')
      booksEl.querySelectorAll('.sl-sg-book').forEach(btn => {
        btn.onclick = () => {
          book = btn.dataset.book
          try { localStorage.setItem(BOOK_KEY, book) } catch {}
          drawBooks()
          drawScenes()
        }
      })
    }

    // Scenes in manuscript order, under a header per chapter (and per book under All books).
    const drawScenes = () => {
      const q = search.value.trim().toLowerCase()
      const shown = scenes.filter(sc => (!book || sc.novel === book) && (!q || `${sc.title} ${sc.chapter} ${sc.novel}`.toLowerCase().includes(q)))
      let lastGroup = null
      list.innerHTML = shown.map(sc => {
        const group = book ? sc.chapter : `${sc.novel} · ${sc.chapter}`
        const head = group !== lastGroup ? `<div class="kicker sl-sg-group">${esc(group)}</div>` : ''
        lastGroup = group
        const meta = sc.path === current ? 'current' : rank(sc) < 1000 ? 'recent' : ''
        return `${head}<button class="ss-scene${chosen && chosen.sc.path === sc.path ? ' active' : ''}" data-path="${esc(sc.path)}">
            <span class="ss-scene-title">${esc(sc.title)}</span>
            <span class="ss-scene-meta">${meta}</span>
          </button>`
      }).join('') || '<div class="hint">No scenes match.</div>'
      list.querySelectorAll('.ss-scene').forEach(btn => {
        btn.onclick = () => openScene(scenes.find(sc => sc.path === btn.dataset.path))
      })
      const active = list.querySelector('.ss-scene.active')
      if (active) active.scrollIntoView({ block: 'nearest' })
    }

    let anchor = null
    const drawParas = () => {
      if (!chosen) { parasEl.innerHTML = ''; return }
      const { blocks, first, last } = chosen
      parasEl.innerHTML = blocks.map((t, n) => {
        const tags = scanSurgery(t)
        if (flagged.checked && !tags.length) return ''
        const on = first != null && n >= first && n <= last
        return `<div class="ss-scene-para${on ? ' active' : ''}" data-n="${n}">${markedHTML(t, tags)}${tagPillsHTML(tags)}</div>`
      }).join('') || '<div class="hint">No tagged paragraphs in this scene.</div>'
      parasEl.querySelectorAll('.ss-scene-para').forEach(el => {
        el.onclick = e => {
          const n = +el.dataset.n
          chosen.first = e.shiftKey && anchor != null ? Math.min(anchor, n) : n
          chosen.last  = e.shiftKey && anchor != null ? Math.max(anchor, n) : n
          if (!e.shiftKey) anchor = n
          start.disabled = false
          drawParas()
        }
      })
      wirePills(parasEl)
    }

    // Patterns panel: switch built-ins off, add your own.
    const drawPatterns = () => {
      const pats = getPatterns()
      const on = QuillStudy.BUILTIN_PATTERNS.filter(b => !pats.disabled.includes(b.id)).length + pats.custom.filter(c => c.on).length
      const passOpts = sel => ['', ...SURGERY_PASSES.map(x => x.id)].map(id =>
        `<option value="${id}"${id === sel ? ' selected' : ''}>${id ? esc(SURGERY_PASSES.find(x => x.id === id).label) : 'No pass'}</option>`).join('')
      patEl.innerHTML = `
        <summary>Patterns · ${on} on</summary>
        <div class="sl-sg-pat-body">
          ${QuillStudy.BUILTIN_PATTERNS.map(b => `
            <label class="check sl-sg-pat"><input type="checkbox" data-builtin="${b.id}" ${pats.disabled.includes(b.id) ? '' : 'checked'}>
              <span><b>${esc(b.label)}</b> <span class="hint">${esc(b.desc)}</span></span>
            </label>`).join('')}
          ${pats.custom.map(c => `
            <div class="sl-sg-pat custom" data-id="${c.id}">
              <input type="checkbox" data-f="on" ${c.on ? 'checked' : ''} title="On">
              <input class="field sl-sg-pat-label" data-f="label" value="${esc(c.label)}" placeholder="Tag name">
              <input class="field sl-sg-pat-phrases" data-f="phrases" value="${esc(c.phrases.join(', '))}" placeholder="etched, stony, /^Suddenly/">
              <label class="check sl-sg-pat-opt" title="Ignore words inside “quoted” dialogue"><input type="checkbox" data-f="narrationOnly" ${c.narrationOnly ? 'checked' : ''}> narration only</label>
              <select class="field auto" data-f="pass">${passOpts(c.pass)}</select>
              <button class="btn ghost sm icon" data-del title="Delete pattern" aria-label="Delete pattern">✕</button>
            </div>`).join('')}
          <div class="sl-sg-pat-foot">
            <button class="btn sm" id="sl-sg-pat-add">+ Add pattern</button>
            <span class="hint">Comma-separated words or phrases, matched as whole words in any case. Write <code>/like this/</code> for a regex. The pass is pre-checked when a tagged paragraph is picked.</span>
          </div>
        </div>`
      patEl.querySelectorAll('input[data-builtin]').forEach(cb => {
        cb.onchange = () => {
          const p = getPatterns()
          p.disabled = cb.checked ? p.disabled.filter(x => x !== cb.dataset.builtin) : [...new Set([...p.disabled, cb.dataset.builtin])]
          savePatterns(p); drawPatterns(); drawParas()
        }
      })
      let timer = null
      patEl.querySelectorAll('.sl-sg-pat.custom').forEach(row => {
        const id = row.dataset.id
        const update = (redrawPanel) => {
          const p = getPatterns()
          const c = p.custom.find(x => x.id === id)
          if (!c) return
          c.on = row.querySelector('[data-f=on]').checked
          c.label = row.querySelector('[data-f=label]').value
          c.phrases = row.querySelector('[data-f=phrases]').value.split(',').map(s => s.trim()).filter(Boolean)
          c.narrationOnly = row.querySelector('[data-f=narrationOnly]').checked
          c.pass = row.querySelector('[data-f=pass]').value
          savePatterns(p)
          if (redrawPanel) drawPatterns()
          drawParas()
        }
        row.querySelectorAll('input[type=checkbox], select').forEach(el => { el.onchange = () => update(true) })
        row.querySelectorAll('input.field').forEach(el => {
          el.oninput = () => { clearTimeout(timer); timer = setTimeout(() => update(false), 250) }
          el.onchange = () => { clearTimeout(timer); update(true) }
        })
        row.querySelector('[data-del]').onclick = () => {
          const p = getPatterns()
          p.custom = p.custom.filter(x => x.id !== id)
          savePatterns(p); drawPatterns(); drawParas()
        }
      })
      document.getElementById('sl-sg-pat-add').onclick = () => {
        const p = getPatterns()
        p.custom.push(QuillStudy.cleanCustomPattern({ label: '', phrases: [] }))
        savePatterns(p)
        drawPatterns()
        const rows = patEl.querySelectorAll('.sl-sg-pat.custom [data-f=label]')
        if (rows.length) rows[rows.length - 1].focus()
      }
    }

    async function openScene(sc) {
      if (!sc) return
      const blocks = await StyleStudy.sceneParagraphs(sc.path)
      if (!blocks) { status.textContent = `Couldn't read “${sc.title}”.`; return }
      chosen = { sc, blocks, first: null, last: null }
      anchor = null
      start.disabled = true
      StyleStudy.rememberScene(sc.path)
      drawScenes()
      drawParas()
    }

    search.oninput = drawScenes
    flagged.onchange = drawParas
    start.onclick = () => {
      if (!chosen || chosen.first == null) return
      const picked = chosen.blocks.slice(chosen.first, chosen.last + 1)
      const tags = picked.flatMap(t => scanSurgery(t))
      const suggested = [...new Set(tags.map(x => x.pass).filter(Boolean))]
      _currentPrompt = {
        sceneTitle: chosen.sc.title,
        chapter:    chosen.sc.chapter,
        novel:      chosen.sc.novel,
        path:       chosen.sc.path,
        original:   picked.join('\n\n'),
        passes:     suggested.length ? suggested.slice(0, 2) : ['cut'],
      }
      renderDrillRunner()
    }
    drawPatterns()
    drawBooks()
    drawScenes()
    // Open the current or most recent scene in this book so there's something to read straight away.
    const first = scenes.filter(sc => !book || sc.novel === book).sort((x, y) => rank(x) - rank(y))[0]
    if (first && rank(first) < 1000) openScene(first)
  }

  // ── Shared context drawer ────────────────────────────────
  // Chips are shared across drills; "Match novel voice" is remembered per drill and starts on
  // only for drills that judge voice.
  const VOICE_DRILLS = new Set(['sentence-surgery', 'pov-lens', 'voice-match'])
  let _drillCtx = null
  function attachDrillContext(btn, buildPreview, drillKey = _currentDrill) {
    _drillCtx = QuillContext.attach(btn, {
      scope: 'stylelab', label: `Style Lab · ${DRILLS[drillKey]?.name || ''}`,
      voiceKey: `stylelab:${drillKey}`, voiceDefault: VOICE_DRILLS.has(drillKey), buildPreview,
    })
    return _drillCtx
  }

  // Feedback request for the current drill. With nothing attached and voice off, this is the
  // same request Style Lab always sent.
  async function drillMessages(userText) {
    const settings = getSettings()
    const drill = DRILLS[_currentDrill]
    const prompt = _currentPrompt
    const sys = buildSystemPrompt(drill, prompt, settings.brutality || 'honest', settings.instructions)
    const ctx = _drillCtx ? await _drillCtx.blocks() : { story: '', voice: '' }
    return [
      { role: 'system', content: sys },
      ...(ctx.story ? [{ role: 'system', content: ctx.story }] : []),
      ...(ctx.voice ? [{ role: 'system', content: ctx.voice }] : []),
      { role: 'user',   content: `PROMPT I WAS GIVEN:\n${promptAsText(drill, prompt)}\n\n${_currentDrill === 'sentence-surgery' ? 'AFTER (my revision)' : 'MY WRITING'}:\n${userText}` },
    ]
  }

  function renderDrillRunner() {
    const drill = DRILLS[_currentDrill]
    const prompt = _currentPrompt
    const inner = document.getElementById('stylelab-inner')
    if (!inner) return
    const settings = getSettings()
    const brutalityIdx = BRUTALITY_LEVELS.indexOf(settings.brutality || 'honest')

    const promptHTML = renderPromptText(_currentDrill, prompt)
    const isSurgery = _currentDrill === 'sentence-surgery'
    const surgeryHTML = isSurgery ? `
      ${prompt.original.split('\n\n').map(t => { const tags = scanSurgery(t); return `<div class="sl-sg-origwrap"><div class="sl-sg-orig">${markedHTML(t, tags)}</div>${tagPillsHTML(tags)}</div>` }).join('')}
      <section class="section sl-sg-passes">
        <div class="section-label">Passes · pick one or two</div>
        ${SURGERY_PASSES.map(p => `
          <label class="check sl-sg-pass"><input type="checkbox" data-pass="${p.id}" ${prompt.passes.includes(p.id) ? 'checked' : ''}>
            <span><b>${esc(p.label)}</b> <span class="hint">${esc(p.hint)}</span></span>
          </label>`).join('')}
      </section>` : ''

    inner.innerHTML = `
      <button class="btn ghost sm page-back" id="sl-back-btn">‹ Style Lab</button>
      <div class="page-head">
        <div class="kicker">${esc(drill.name)}</div>
        <div class="page-title it long sl-prompt">${promptHTML}</div>
        <div class="page-sub sl-prompt-sub">${esc(getPromptSub(_currentDrill, prompt))}</div>
      </div>
      ${surgeryHTML}

      <section class="section">
        <div class="section-label">Your rep<span class="section-actions"><button id="sl-ctx-btn"></button></span></div>
        <textarea class="field sl-writer" id="sl-writer-ta" placeholder="${esc(drill.writerPlaceholder)}" spellcheck="true"></textarea>
        <div class="sl-brutality" title="How hard should the feedback push?">
          <span class="hint">Feedback</span>
          <span class="hint subtle">gentle</span>
          <input type="range" id="sl-brut-slider" min="0" max="4" step="1" value="${brutalityIdx}">
          <span class="hint subtle">brutal</span>
          <span class="sl-brut-level" id="sl-brut-level">${BRUTALITY_LABELS[settings.brutality || 'honest']}</span>
        </div>
      </section>

      <div class="btn-row sl-drill-actions">
        <button class="btn primary" id="sl-submit-btn">Submit for feedback</button>
        <button class="btn" id="sl-reroll-btn">${isSurgery ? 'Pick another paragraph' : 'New prompt'}</button>
        ${isSurgery ? '' : `
        <button class="btn ghost" id="sl-surprise-btn" title="Generate a new prompt with AI">✨ Surprise me</button>
        <button class="btn ghost" id="sl-save-prompt-btn" title="Save this prompt for later">☆ Save prompt</button>
        <button class="btn ghost icon" id="sl-drill-gen-settings-btn" title="Edit AI generator for this drill" aria-label="Edit AI generator for this drill">⚙</button>`}
        <span class="hint subtle sl-wc" id="sl-wc">0 words · ⌘↵ to submit</span>
      </div>

      <div id="sl-feedback-wrap"></div>
    `

    // Wire
    attachDrillContext(document.getElementById('sl-ctx-btn'), () => drillMessages(document.getElementById('sl-writer-ta')?.value.trim() || '(your writing)'))
    document.getElementById('sl-back-btn').onclick = renderLanding
    document.getElementById('sl-reroll-btn').onclick = () => {
      if (isSurgery) { renderSurgeryPicker(); return }
      _currentPrompt = pick(drill.prompts)
      renderDrillRunner()
    }
    const ta = document.getElementById('sl-writer-ta')
    const wc = document.getElementById('sl-wc')
    const updateWc = () => {
      const words = (ta.value.trim().match(/\S+/g) || []).length
      if (isSurgery) {
        // Before → after, so the cut pass checks itself without AI.
        const before = QuillStudy.wordCount(prompt.original)
        const pct = before ? Math.round((before - words) / before * 1000) / 10 : 0
        wc.textContent = `${before} → ${words} words · ${pct > 0 ? '−' : pct < 0 ? '+' : ''}${Math.abs(pct)}% · ⌘↵ to submit`
        return
      }
      wc.textContent = `${words} word${words === 1 ? '' : 's'} · ⌘↵ to submit`
    }
    ta.oninput = updateWc
    if (isSurgery) {
      ta.value = prompt.original
      updateWc()
      wirePills(inner)
      inner.querySelectorAll('.sl-sg-pass input').forEach(cb => {
        cb.onchange = () => {
          prompt.passes = [...inner.querySelectorAll('.sl-sg-pass input:checked')].map(x => x.dataset.pass)
        }
      })
    }
    ta.onkeydown = e => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        submitDrill()
      }
    }
    setTimeout(() => ta.focus(), 30)

    // Brutality slider (sticky)
    const slider = document.getElementById('sl-brut-slider')
    const lvlEl  = document.getElementById('sl-brut-level')
    slider.oninput = () => {
      const lvl = BRUTALITY_LEVELS[parseInt(slider.value)]
      lvlEl.textContent = BRUTALITY_LABELS[lvl]
      const s = getSettings()
      s.brutality = lvl
      saveSettings(s)
    }

    document.getElementById('sl-submit-btn').onclick = submitDrill
    const surpriseBtn = document.getElementById('sl-surprise-btn')
    if (surpriseBtn) surpriseBtn.onclick = generateAIPrompt
    const genSetBtn = document.getElementById('sl-drill-gen-settings-btn')
    if (genSetBtn) genSetBtn.onclick = () => openDrillGenSettings(_currentDrill)
    const savePromptBtn = document.getElementById('sl-save-prompt-btn')
    if (savePromptBtn) {
      savePromptBtn.onclick = async () => {
        const promptText = promptAsText(DRILLS[_currentDrill], _currentPrompt)
        await window.quill.appendSavedPrompt({
          drill: DRILLS[_currentDrill].name,
          promptText,
        }).catch(() => {})
        savePromptBtn.textContent = '★ Saved'
        savePromptBtn.disabled = true
        setTimeout(() => {
          savePromptBtn.textContent = '☆ Save prompt'
          savePromptBtn.disabled = false
        }, 2000)
      }
    }
  }

  // ── AI prompt generator (cheap, uses Haiku) ───────────────
  async function generateAIPrompt() {
    const hasKey = await QuillAI.hasKey()
    if (!hasKey) { QuillAI.askForKey(); return }
    const btn = document.getElementById('sl-surprise-btn')
    if (!btn) return
    const origText = btn.textContent
    btn.textContent = '✨ Generating…'
    btn.disabled = true

    const settings = getSettings()
    const genre = settings.genre || 'dark romance / romantasy'
    const drill = DRILLS[_currentDrill]

    const cfg = getDrillConfig(_currentDrill)
    const instruction = (cfg.prompt || '').replace(/\$\{genre\}/g, genre)
    const formatHint  = DEFAULT_FORMAT_HINTS[_currentDrill] || ''

    const sys = `You generate writing drill prompts for the "${drill.name}" drill in a writing gym app. Respond with ONLY the requested fields in the exact format shown. No preamble, no explanation, no markdown. Follow any length guidance in the user message exactly.`
    // Attached story context makes the prompt about this novel; the voice reference is never
    // needed to invent a prompt.
    const ctx = _drillCtx ? await _drillCtx.blocks({ voice: false }) : { story: '' }
    const user = `${instruction}${ctx.story ? '\n\nSet the prompt in the novel described in the story reference material: use its characters, places and situations where they fit the drill.' : ''}\n\nRespond in this exact format:\n${formatHint}`

    try {
      const resp = await QuillAI.fetch({
        method: 'POST',
        body: JSON.stringify({
          model: cfg.model,
          max_tokens: cfg.max_tokens,
          messages: [
            { role: 'system', content: sys },
            ...(ctx.story ? [{ role: 'system', content: ctx.story }] : []),
            { role: 'user',   content: user }
          ],
        })
      })
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
      const data = await resp.json()
      const text = data.choices?.[0]?.message?.content?.trim() || ''
      const parsed = parseGeneratedPrompt(_currentDrill, text)
      if (parsed) {
        _currentPrompt = parsed
        renderDrillRunner()
        return
      }
      throw new Error('Could not parse generated prompt')
    } catch (err) {
      btn.textContent = '✗ Failed'
      setTimeout(() => { btn.textContent = origText; btn.disabled = false }, 1800)
    }
  }

  function parseGeneratedPrompt(drillKey, text) {
    const getField = (label) => {
      const re = new RegExp(`${label}:\\s*([^\\n]+)`, 'i')
      const m = text.match(re)
      return m ? m[1].trim().replace(/^["'"]|["'"]$/g, '') : ''
    }
    if (drillKey === 'beat-prose') {
      const beat = getField('BEAT'), constraint = getField('CONSTRAINT')
      return beat ? { beat, constraint: constraint || '100-150 words.' } : null
    }
    if (drillKey === 'metaphor-forge') {
      const subject = getField('SUBJECT'), note = getField('NOTE')
      return subject ? { subject, note: note || 'Specific, not grand.' } : null
    }
    if (drillKey === 'voice-match') {
      const situation = getField('SITUATION')
      return situation ? { situation } : null
    }
    if (drillKey === 'pacing-gym') {
      const beat = getField('BEAT')
      return beat ? { beat } : null
    }
    if (drillKey === 'rewrite-cliche') {
      const line = getField('LINE')
      return line ? { line: line.replace(/^["'"]|["'"]$/g, '') } : null
    }
    if (drillKey === 'sensory-anchor') {
      const dialogue = getField('DIALOGUE')
      return dialogue ? { dialogue: dialogue.startsWith('"') ? dialogue : `"${dialogue}"`, note: 'Build the beat around this line.' } : null
    }
    if (drillKey === 'interiority') {
      const event = getField('EVENT')
      return event ? { event } : null
    }
    if (drillKey === 'dialogue-spar') {
      const setup = getField('SETUP')
      return setup ? { setup } : null
    }
    if (drillKey === 'pov-lens') {
      const place = getField('PLACE'), state = getField('STATE')
      return place && state ? { place, state } : null
    }
    return null
  }

  function renderPromptText(drillKey, p) {
    if (drillKey === 'beat-prose')      return `<em>${esc(p.beat)}</em>`
    if (drillKey === 'metaphor-forge')  return `Write three metaphors for: <em>${esc(p.subject)}</em>`
    if (drillKey === 'voice-match')     return `Write your character <em>${esc(p.situation)}</em>`
    if (drillKey === 'pacing-gym')      return `<em>${esc(p.beat)}</em>`
    if (drillKey === 'rewrite-cliche')  return `Rewrite this line: <em>"${esc(p.line)}"</em>`
    if (drillKey === 'sensory-anchor')  return `Build a beat around: <em>${esc(p.dialogue)}</em>`
    if (drillKey === 'interiority')     return `<em>${esc(p.event)}</em>`
    if (drillKey === 'dialogue-spar')   return `<em>${esc(p.setup)}</em>`
    if (drillKey === 'pov-lens')        return `<em>${esc(p.place)}</em> · ${esc(p.state)}`
    if (drillKey === 'sentence-surgery') return `<em>${esc(p.sceneTitle)}</em> · ${esc([p.novel, p.chapter].filter(Boolean).join(', '))}`
    return ''
  }
  function getPromptSub(drillKey, p) {
    if (drillKey === 'beat-prose')      return p.constraint || ''
    if (drillKey === 'metaphor-forge')  return `One cliché (name it). One better. One strange. ${p.note || ''}`
    if (drillKey === 'voice-match')     return "3–4 sentences. Don't name them — let the voice do it."
    if (drillKey === 'pacing-gym')      return "Write it three ways: compressed, scene, stretched."
    if (drillKey === 'rewrite-cliche')  return "Keep the emotional beat. Make the prose earn it. Specific over grand."
    if (drillKey === 'sensory-anchor')  return p.note + " Only non-visual senses — no sight, no looking, no seeing."
    if (drillKey === 'interiority')     return "Three layers: surface thought, buried feeling, physical tell."
    if (drillKey === 'dialogue-spar')   return "\"Said\" tags only. Minimal blocking. No internal monologue. Let the subtext carry it."
    if (drillKey === 'pov-lens')        return "75–150 words. Three concrete details at most; at least one carries her judgment. No \"There was\" lists."
    if (drillKey === 'sentence-surgery') return "Make only the passes you check. Don't make it more literary; make it more her."
    return ''
  }

  // ── Submit drill for feedback ─────────────────────────────
  async function submitDrill() {
    const ta = document.getElementById('sl-writer-ta')
    const userText = (ta.value || '').trim()
    if (!userText) return
    if (_currentDrill === 'sentence-surgery' && userText === _currentPrompt.original.trim()) {
      const wc = document.getElementById('sl-wc')
      if (wc) wc.textContent = 'No edits yet. Make a pass first.'
      return
    }
    const hasKey = await QuillAI.hasKey()
    if (!hasKey) {
      QuillAI.askForKey()
      return
    }
    const settings = getSettings()
    const model = resolvedModel()
    const brutality = settings.brutality || 'honest'

    const wrap = document.getElementById('sl-feedback-wrap')
    wrap.innerHTML = `
      <section class="section sl-feedback">
        <div class="section-label">Feedback</div>
        <p class="hint">Reading your work…</p>
      </section>`

    const drill  = DRILLS[_currentDrill]
    const prompt = _currentPrompt

    try {
      const resp = await QuillAI.fetch({
        method: 'POST',
        body: JSON.stringify({
          model,
          max_tokens: 900,
          stream: true,
          messages: await drillMessages(userText),
        })
      })
      if (!resp.ok) {
        const errData = await resp.json().catch(() => ({}))
        throw new Error(errData.error?.message || `HTTP ${resp.status}`)
      }

      let reply = ''
      const reader = resp.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop()
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const raw = line.slice(6).trim()
          if (raw === '[DONE]') continue
          try {
            const parsed = JSON.parse(raw)
            const delta = parsed.choices?.[0]?.delta?.content || ''
            if (delta) {
              reply += delta
              renderStreamingFeedback(reply)
            }
          } catch {}
        }
      }
      if (buf.startsWith('data: ')) {
        const raw = buf.slice(6).trim()
        if (raw && raw !== '[DONE]') {
          try {
            const delta = JSON.parse(raw).choices?.[0]?.delta?.content || ''
            if (delta) { reply += delta; renderStreamingFeedback(reply) }
          } catch {}
        }
      }

      _feedbackText = reply
      if (reply) _drillCtx?.consumed()
      renderFinalFeedback(reply, userText)

      // Auto-save the rep
      if (settings.autoSave) {
        await window.quill.saveStyleLabRep({
          drill:     drill.name,
          prompt:    promptAsText(drill, prompt),
          userText,
          feedback:  reply,
          brutality,
          model,
        }).catch(err => console.error('save-rep failed:', err))
      }
      bumpStats()
    } catch (err) {
      wrap.innerHTML = `
        <section class="section sl-feedback">
          <div class="section-label">Feedback</div>
          <p class="sl-fb-error">Feedback failed: ${esc(err.message || String(err))}</p>
          <p class="hint">Check your OpenRouter key and model, then try again.</p>
        </section>`
    }
  }

  function promptAsText(drill, p) {
    if (_currentDrill === 'beat-prose')      return `Beat: ${p.beat}\nConstraint: ${p.constraint}`
    if (_currentDrill === 'metaphor-forge')  return `Write three metaphors for: ${p.subject}. One cliché (named), one better, one strange. ${p.note || ''}`
    if (_currentDrill === 'voice-match')     return `Write the writer's character ${p.situation}. 3–4 sentences, voice only.`
    if (_currentDrill === 'pacing-gym')      return `Beat: ${p.beat}. Write three versions: compressed (1 sentence), scene (paragraph), stretched (half page).`
    if (_currentDrill === 'rewrite-cliche')  return `Rewrite this cliché so it earns the emotion: "${p.line}"`
    if (_currentDrill === 'sensory-anchor')  return `Build a beat around this line of dialogue: ${p.dialogue}. Only non-visual senses — no sight.`
    if (_currentDrill === 'interiority')     return `External event: ${p.event}. Write surface thought, buried feeling, physical tell.`
    if (_currentDrill === 'dialogue-spar')   return `Two-character scenario: ${p.setup}\nWrite the exchange. "Said" tags only, minimal blocking, no internal monologue. The subtext is the work.`
    if (_currentDrill === 'pov-lens')        return `Place: ${p.place}\nPOV state: ${p.state}\nDescribe the place through that state. 75–150 words, three concrete details at most, at least one carrying the character's judgment. No inventory lists.`
    if (_currentDrill === 'sentence-surgery') {
      const passes = SURGERY_PASSES.filter(x => (p.passes || []).includes(x.id)).map(x => `${x.label} (${x.hint})`)
      return `Paragraph from my manuscript, "${p.sceneTitle}" (${[p.novel, p.chapter].filter(Boolean).join(', ')}).\n\nBEFORE:\n${p.original}\n\nPasses I chose:\n${passes.length ? passes.map(x => '- ' + x).join('\n') : '- (none checked; judge it as a general tightening)'}`
    }
    return ''
  }

  // ── Streaming feedback render (partial) ───────────────────
  function renderStreamingFeedback(partial) {
    const wrap = document.getElementById('sl-feedback-wrap')
    if (!wrap) return
    wrap.innerHTML = `
      <section class="section sl-feedback">
        <div class="section-label">Feedback</div>
        <div class="sl-fb-text pre">${esc(partial)}</div>
      </section>`
  }

  // Score lines and WORKING / PUSH / REWRITE blocks of a parsed feedback reply.
  function feedbackCoreHTML(parsed, reply) {
    const CHECK_MARK = { yes: '✓', partly: '½', no: '✗' }
    const ratingHTML = parsed.checks.length
      ? `<div class="sl-rating sl-checks">
          ${parsed.ratingNote ? `<div class="sl-rating-note">${esc(parsed.ratingNote)}</div>` : ''}
          ${parsed.checks.map(c => `
            <div class="sl-check ${c.verdict}">
              <span class="sl-check-mark">${CHECK_MARK[c.verdict] || '·'}</span>
              <span><b>${esc(c.criterion)}</b>${c.note ? ` · ${esc(c.note)}` : ''}</span>
            </div>`).join('')}
        </div>`
      : parsed.stars
      ? `<div class="sl-rating">
          <div class="sl-stars">${parsed.stars}</div>
          <div class="sl-rating-note">${esc(parsed.ratingNote || '')}</div>
        </div>`
      : ''

    return `
        ${ratingHTML}
        ${parsed.working ? `
          <div class="sl-fb-block">
            <div class="sl-fb-label working">What's working</div>
            <div class="sl-fb-text">${esc(parsed.working)}</div>
          </div>` : ''}
        ${parsed.push ? `
          <div class="sl-fb-block">
            <div class="sl-fb-label push">What to push on</div>
            <div class="sl-fb-text">${esc(parsed.push)}</div>
          </div>` : ''}
        ${parsed.rewrite ? `
          <div class="sl-fb-block">
            <div class="sl-fb-label rewrite">One rewrite</div>
            <div class="sl-fb-rewrite">${esc(parsed.rewrite)}</div>
            ${parsed.rewriteHint ? `<div class="sl-fb-rewrite-hint">${esc(parsed.rewriteHint)}</div>` : ''}
          </div>` : ''}
        ${(!parsed.working && !parsed.push && !parsed.rewrite) ? `
          <div class="sl-fb-text pre">${esc(reply)}</div>` : ''}
`
  }

  // ── Parse structured feedback and render final ────────────
  function renderFinalFeedback(reply, userText) {
    const parsed = parseFeedback(reply)
    const wrap = document.getElementById('sl-feedback-wrap')
    if (!wrap) return

    wrap.innerHTML = `
      <section class="section sl-feedback">
        <div class="section-label">Feedback</div>
        ${feedbackCoreHTML(parsed, reply)}
        <div class="btn-row sl-fb-actions">
          <button class="btn" id="sl-try-again">Try again</button>
          <button class="btn" id="sl-next-drill">Next drill</button>
          ${parsed.rewrite ? `<button class="btn ghost sl-save-btn" id="sl-save-line">✦ Save line to book</button>` : ''}
          <div class="sl-spacer"></div>
          <button class="btn primary" id="sl-done">Done</button>
        </div>
      </section>
    `

    document.getElementById('sl-try-again').onclick = () => {
      document.getElementById('sl-feedback-wrap').innerHTML = ''
      const ta = document.getElementById('sl-writer-ta')
      if (ta) {
        ta.value = _currentDrill === 'sentence-surgery' ? _currentPrompt.original : ''
        ta.dispatchEvent(new Event('input'))
        ta.focus()
      }
    }
    document.getElementById('sl-next-drill').onclick = () => {
      if (_currentDrill === 'sentence-surgery') { renderSurgeryPicker(); return }
      _currentPrompt = pick(DRILLS[_currentDrill].prompts)
      renderDrillRunner()
    }
    document.getElementById('sl-done').onclick = renderLanding
    const saveBtn = document.getElementById('sl-save-line')
    if (saveBtn) {
      saveBtn.onclick = async () => {
        // Save the user's best line, not the rewrite. Pull from user text heuristically
        // but default to offering the rewrite + their text. For now, prompt them to confirm the best line.
        const best = pickBestUserLine(userText) || parsed.rewrite
        await window.quill.appendSavedLine({ line: best, source: DRILLS[_currentDrill].name }).catch(()=>{})
        saveBtn.textContent = '✓ Saved'
        saveBtn.classList.add('saved')
        _savedLines.unshift(best)
      }
    }
  }

  // Heuristic: find the user's longest sentence as "best" candidate
  function pickBestUserLine(text) {
    if (!text) return ''
    const sentences = text.split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(Boolean)
    if (!sentences.length) return ''
    sentences.sort((a, b) => b.length - a.length)
    return sentences[0].length > 200 ? sentences[0].slice(0, 200) + '…' : sentences[0]
  }

  // ── Parse flat KEY: block format from model ───────────────
  function parseFeedback(text) {
    const result = { stars: '', checks: [], ratingNote: '', working: '', push: '', rewrite: '', rewriteHint: '' }
    if (!text) return result
    // CHECK: <criterion> | yes|partly|no | <one clause>  (drills with criteria)
    for (const m of text.matchAll(/^CHECK:\s*(.+)$/gim)) {
      const [criterion, verdict, ...note] = m[1].split('|').map(s => s.trim())
      const v = String(verdict || '').toLowerCase()
      if (criterion) result.checks.push({ criterion, verdict: ['yes', 'partly', 'no'].includes(v) ? v : '', note: note.join(' | ') })
    }
    // Look for STARS: 1-3
    const starMatch = text.match(/STARS?:\s*([123])/i)
    if (starMatch) {
      const n = parseInt(starMatch[1])
      result.stars = '✦'.repeat(n) + ' ✧'.repeat(3 - n)
    }
    const noteMatch = text.match(/RATING:\s*([^\n]+)/i)
    if (noteMatch) result.ratingNote = noteMatch[1].trim()
    const working = text.match(/WORKING:\s*([\s\S]*?)(?=\n[A-Z]+:|$)/i)
    if (working) result.working = working[1].trim()
    const push = text.match(/PUSH:\s*([\s\S]*?)(?=\n[A-Z]+:|$)/i)
    if (push) result.push = push[1].trim()
    const rewrite = text.match(/REWRITE:\s*([\s\S]*?)(?=\n[A-Z]+:|$)/i)
    if (rewrite) result.rewrite = rewrite[1].trim().replace(/^["'"]|["'"]$/g, '')
    const hint = text.match(/HINT:\s*([^\n]+)/i)
    if (hint) result.rewriteHint = hint[1].trim()
    return result
  }

  // ── System prompt for feedback AI ─────────────────────────
  function buildSystemPrompt(drill, prompt, brutality, customInstructions) {
    const brutalityMap = {
      gentle: "Be genuinely kind. Lead with what's working. Soften the criticism. Today the writer needs encouragement more than precision. Do not be sycophantic, but err generous.",
      kind:   "Be warm but honest. Name what's good first, then what to push on. Specific and constructive, never harsh.",
      honest: "Be honest and direct. Name specific strengths and specific weaknesses without softening. Treat the writer as a colleague.",
      sharp:  "Be sharp and unsparing. Call out clichés by name. Don't hedge. The writer wants you to find the weak sentences.",
      brutal: "Be brutally honest. Name every cliché, every piece of telling-not-showing, every generic phrase. The writer wants no mercy. Still be precise — brutality is about truth, not cruelty.",
    }
    const customBlock = customInstructions && customInstructions.trim()
      ? `\n\nABOUT THIS WRITER (they wrote this about themselves):\n${customInstructions.trim()}\n\nHonor this. It's the context for all your feedback.`
      : ''
    // Drills with criteria get judged on those only, one CHECK line each, instead of a star score.
    const criteria = drill.criteria || []
    const scopeBlock = criteria.length
      ? `\n\nJUDGE ONLY THESE (this drill trains one skill; ignore everything else, including things you'd change in a manuscript edit):\n${criteria.map(c => `- ${c}`).join('\n')}${drill.feedbackFocus ? `\n\n${drill.feedbackFocus}` : ''}`
      : ''
    const scoreLines = criteria.length
      ? criteria.map(c => `CHECK: ${c} | [yes, partly, or no] | [one short clause, quoting their words if you can]`).join('\n')
      : 'STARS: [1, 2, or 3 — 1 if it mostly missed, 2 if something landed, 3 if it really worked]'
    return `You are a fiction editor running a writing drill called "${drill.name}" in an app called Style Lab. The writer is practicing — this is a gym, not a manuscript. Your job is to give tight, specific feedback that helps them improve.

FEEDBACK MODE: ${brutality.toUpperCase()}
${brutalityMap[brutality] || brutalityMap.honest}
${customBlock}${scopeBlock}

RESPOND IN THIS EXACT FORMAT (flat keys, no markdown, no bold):

${scoreLines}
RATING: [one short sentence, 6-12 words, summarizing the rep]
WORKING: [2-4 sentences. Name the specific sentence, image, or move that's doing real work. Quote it back to them. Say why it lands.]
PUSH: [2-4 sentences. Name the specific weakness — cliché, on-the-nose emotion, explaining the metaphor, generic sensory detail, whatever it actually is. Be concrete, name the sentence.]
REWRITE: [ONE line — a single-sentence demo of how one specific moment could be sharper. Not a full rewrite of their work. Just one demo line they can learn from.]
HINT: [one short sentence explaining what the rewrite is doing differently]

Critical rules:
- Never rewrite their whole piece. ONE demo line only.
- Be specific. "This sentence doesn't work" is useless. "The phrase 'her heart raced' is the exact cliché this genre is drowning in" is useful.
- Trust the writer to handle honesty. Don't pad.
- If they did something great, say so plainly — don't undersell to seem balanced.
- No markdown, no bold, no bullet points. Plain prose under each label.`
  }

  // ── Per-drill AI generator settings modal ──────────────────
  function openDrillGenSettings(drillKey) {
    const drill = DRILLS[drillKey]
    if (!drill) return
    const cfg       = getDrillConfig(drillKey)
    const defaultPrompt     = DEFAULT_DRILL_INSTRUCTIONS[drillKey] || ''
    const defaultMaxTokens  = DEFAULT_DRILL_MAX_TOKENS

    let overlay = document.getElementById('sl-drill-gen-overlay')
    if (overlay) overlay.remove()
    overlay = document.createElement('div')
    overlay.id = 'sl-drill-gen-overlay'
    overlay.className = 'overlay show'

    overlay.innerHTML = `
      <div class="modal sl-settings-modal">
        <h3>${esc(drill.name)} — AI generator</h3>
        <p>Edit how "✨ Surprise me" generates prompts for this drill. Use <code>\${genre}</code> as a placeholder for your Style Lab genre.</p>

        <label class="sl-set-lbl sl-set-modal-first">Max tokens</label>
        <div class="sl-set-hint">How long the generated prompt can be. Default ${defaultMaxTokens}. Raise for drills with long instructions or multi-sentence outputs.</div>
        <input class="field" id="sl-dg-max-tokens" type="number" min="20" max="2000" step="10" value="${cfg.max_tokens}">

        <label class="sl-set-lbl">Generator prompt</label>
        <div class="sl-set-hint">Sent to the model as the user message. Leave blank to use the default. Use <code>\${genre}</code> where the genre should appear.</div>
        <textarea class="field sl-dg-prompt" id="sl-dg-prompt" rows="12" placeholder="${esc(defaultPrompt)}">${esc(cfg.prompt === defaultPrompt ? '' : cfg.prompt)}</textarea>

        <div class="modal-btns sl-dg-btns">
          <button class="btn ghost" id="sl-dg-reset" title="Reset this drill's generator to defaults">Reset to default</button>
          <div class="btn-row">
            <button class="btn" id="sl-dg-cancel">Cancel</button>
            <button class="btn primary" id="sl-dg-save">Save</button>
          </div>
        </div>
      </div>`
    document.body.appendChild(overlay)

    document.getElementById('sl-dg-cancel').onclick = () => overlay.remove()
    overlay.onclick = e => { if (e.target === overlay) overlay.remove() }

    document.getElementById('sl-dg-reset').onclick = () => {
      // Clear the textarea (so placeholder = default shows through), and reset tokens in the form
      document.getElementById('sl-dg-prompt').value = ''
      document.getElementById('sl-dg-max-tokens').value = defaultMaxTokens
    }

    document.getElementById('sl-dg-save').onclick = () => {
      const all = getDrillOverrides()
      const promptVal = document.getElementById('sl-dg-prompt').value
      const maxTokVal = parseInt(document.getElementById('sl-dg-max-tokens').value, 10)

      // Only store fields that differ from defaults. If everything matches defaults, drop the override entirely.
      const entry = {}
      if (promptVal.trim() && promptVal !== defaultPrompt) entry.prompt = promptVal
      if (Number.isFinite(maxTokVal) && maxTokVal > 0 && maxTokVal !== defaultMaxTokens) entry.max_tokens = maxTokVal

      if (Object.keys(entry).length === 0) {
        delete all[drillKey]
      } else {
        all[drillKey] = entry
      }
      saveDrillOverrides(all)
      overlay.remove()
    }
  }

  // ── Settings (a pane in Settings → Style Lab) ─────────────
  function openSettings() { Settings.open('stylelab') }

  // Fills the Settings pane. Every change saves at once, like the rest of Settings.
  function renderSettingsPane(el) {
    const s = getSettings()
    el.innerHTML = `
      <div class="settings-section">Feedback</div>
      <div class="settings-row settings-row-stack">
        <div><span class="settings-label">About you as a writer</span><span class="settings-hint">What you struggle with, what you overdo, what to push on. Style Lab's feedback reads this.</span></div>
        <textarea class="field" id="sl-set-instructions" rows="4" placeholder="I write dark romance. I tend to overwrite and explain my metaphors. Be ruthless about cuts.">${esc(s.instructions || '')}</textarea>
      </div>
      <div class="settings-row">
        <div><span class="settings-label">Default brutality</span><span class="settings-hint" id="sl-set-brut-level">${BRUTALITY_LABELS[s.brutality || 'honest']}</span></div>
        <div class="settings-control sl-brutality">
          <span class="hint subtle">gentle</span>
          <input type="range" id="sl-set-brut" min="0" max="4" step="1" value="${BRUTALITY_LEVELS.indexOf(s.brutality || 'honest')}">
          <span class="hint subtle">brutal</span>
        </div>
      </div>
      <div class="settings-section">Prompts</div>
      <div class="settings-row">
        <div><span class="settings-label">Genre</span><span class="settings-hint">Used when AI writes new drill prompts, e.g. "literary sci-fi" or "cozy mystery".</span></div>
        <div class="settings-control"><input class="settings-text" id="sl-set-genre" placeholder="dark romance / romantasy" value="${esc(s.genre || '')}"></div>
      </div>
      <div class="settings-section">Drills</div>
      <div class="settings-row settings-row-stack">
        <div><span class="settings-label">Drills shown</span></div>
        <div class="sl-set-drills">
          ${DRILL_ORDER.map(k => `
            <label class="check"><input type="checkbox" data-drill="${k}" ${s.drillsOn[k] !== false ? 'checked' : ''}>${esc(DRILLS[k].name)}</label>
          `).join('')}
        </div>
      </div>
      <div class="settings-row">
        <div><span class="settings-label">Auto-save completed reps</span></div>
        <div class="settings-control"><input type="checkbox" id="sl-set-autosave" ${s.autoSave ? 'checked' : ''}></div>
      </div>`

    const brutSlider = el.querySelector('#sl-set-brut')
    const save = () => {
      const next = getSettings()
      next.instructions = el.querySelector('#sl-set-instructions').value
      next.genre        = el.querySelector('#sl-set-genre').value.trim() || 'dark romance / romantasy'
      next.brutality    = BRUTALITY_LEVELS[parseInt(brutSlider.value)]
      next.autoSave     = el.querySelector('#sl-set-autosave').checked
      el.querySelectorAll('.sl-set-drills input[type=checkbox]').forEach(cb => { next.drillsOn[cb.dataset.drill] = cb.checked })
      delete next.model
      delete next.customModel
      saveSettings(next)
      // Refresh the drill list only while it is on screen; never pull the writer out of a drill.
      if (document.querySelector('#stylelab-inner .sl-drill-grid')) renderLanding()
    }
    brutSlider.oninput = () => {
      el.querySelector('#sl-set-brut-level').textContent = BRUTALITY_LABELS[BRUTALITY_LEVELS[parseInt(brutSlider.value)]]
    }
    el.querySelectorAll('input, textarea').forEach(input => input.addEventListener('change', save))
  }

  // ── Saved Passages view (reached from sidebar) ────────────
  async function openSavedPassages() {
    // Switch to the saved passages view
    if (typeof App !== 'undefined' && App.showView) {
      App.showView('saved-passages')
    }
    const inner = document.getElementById('saved-passages-inner')
    if (!inner) return

    const passages = await window.quill.getStyleLabPassages().catch(() => [])

    const renderList = () => {
      if (!passages.length) {
        inner.innerHTML = `
          <div class="page-head">
            <div class="kicker">Practice · Style Lab</div>
            <div class="page-title it">Saved passages</div>
            <div class="page-sub">Passages you've pasted into Style Study and kept for later.</div>
          </div>
          <div class="empty-state inline"><p>No saved passages yet. Paste one into Style Study and check "Save to library" to keep it here.</p></div>`
        return
      }
      inner.innerHTML = `
        <div class="page-head">
          <div class="kicker">Practice · Style Lab</div>
          <div class="page-title it">Saved passages</div>
          <div class="page-sub">${passages.length} passage${passages.length === 1 ? '' : 's'} in your library. Click one to study it.</div>
        </div>
        <div class="card-list" id="sl-saved-full-list"></div>
      `
      const wrap = document.getElementById('sl-saved-full-list')
      wrap.innerHTML = passages.map(p => `
        <div class="card sl-passage-card" data-id="${esc(p.id)}" role="button" tabindex="0">
          <div class="sl-passage-head">
            <div class="card-title">${esc(p.author)}${p.source ? ' · <em class="sl-passage-source">' + esc(p.source) + '</em>' : ''}</div>
            <div class="card-meta sl-passage-date">${esc(p.date || '')}</div>
            <button class="btn ghost sm sl-passage-del" data-del-id="${esc(p.id)}" title="Delete passage" aria-label="Delete passage">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/></svg>
            </button>
          </div>
          <div class="sl-passage-text">${esc(p.text)}</div>
          <div class="sl-passage-actions">
            <button class="btn sm sl-passage-study" data-study-id="${esc(p.id)}">Study this passage →</button>
          </div>
        </div>
      `).join('')
      // Click body → study it
      wrap.querySelectorAll('.sl-passage-card').forEach(card => {
        card.onclick = (e) => {
          if (e.target.closest('.sl-passage-del')) return
          if (e.target.closest('.sl-passage-study')) return
          const id = card.dataset.id
          const p  = passages.find(x => x.id === id)
          if (!p) return
          startStudyWithPassage(p)
        }
      })
      wrap.querySelectorAll('.sl-passage-study').forEach(btn => {
        btn.onclick = (e) => {
          e.stopPropagation()
          const id = btn.dataset.studyId
          const p  = passages.find(x => x.id === id)
          if (p) startStudyWithPassage(p)
        }
      })
      wrap.querySelectorAll('.sl-passage-del').forEach(btn => {
        btn.onclick = async (e) => {
          e.stopPropagation()
          const id = btn.dataset.delId
          await window.quill.deleteStyleLabPassage({ id }).catch(() => {})
          // refresh the local list and re-render
          const idx = passages.findIndex(p => p.id === id)
          if (idx >= 0) passages.splice(idx, 1)
          renderList()
        }
      })
    }
    renderList()
  }

  function startStudyWithPassage(p) {
    if (typeof App !== 'undefined' && App.openFolder) {
      App.openFolder('Style Lab', 'stylelab').then(() => {
        const paragraphs = String(p.text || '').split(/\n\s*\n/).map(t => ({ t: t.replace(/\s*\n\s*/g, ' ').trim() })).filter(x => x.t)
        StyleStudy.startStudy({ source: { kind: 'paste', author: p.author || '', bookTitle: p.source || '' }, paragraphs })
      })
    }
  }

  // What If (stylelab-whatif.js) runs on the same settings, feedback format and context drawer.
  const kit = { DRILLS, BRUTALITY_LEVELS, BRUTALITY_LABELS, buildSystemPrompt, parseFeedback, feedbackCoreHTML, bumpStats, attachDrillContext, saveSettings }

  return { open, openDrill, renderLanding, openSettings, renderSettingsPane, openSavedPassages, getStats, getSettings, resolvedModel, recordStudyRep, libraryPassages: PASSAGES, kit }
})()
