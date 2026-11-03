/* structure.js — the novel structure templates, the questions that help a writer fill them in
 * their own words, and the Markdown copy of the whole thing. Shared by main and renderer, so
 * the Structure tab, the Structure Builder, idea hatching and imports all read one beat list.
 *
 * Beat text lives in the novel's .quill_meta `beats` map; the builder's answers live in
 * <novel>/.structure.json. Beat ids are unique across templates because `beats` holds every
 * template's text at once, and switching templates must not overwrite anything.
 *
 * The questions lean on published craft advice (named in `source`), so a writer can go read
 * the reasoning. No AI: the questions do the work.
 *
 * Loaded as a plain script in the renderer (window.QuillStructure) and required by main.js.
 */
;(function (root, factory) {
  const api = factory()
  if (typeof module !== 'undefined' && module.exports) module.exports = api
  else root.QuillStructure = api
})(typeof self !== 'undefined' ? self : globalThis, function () {
  // track: 'quest' | 'romance' | 'shared' for the dual-track template, 'rival' for love-triangle
  // beats, null otherwise. `triangle: true` beats show only when the novel has a love triangle.
  const rival = (prefix, act) => ({
    option: { id: `${prefix}_rival_option`, track: 'rival', triangle: true, label: 'A second option', hint: 'The other person becomes a real possibility.' },
    secret: { id: `${prefix}_rival_secret`, track: 'rival', triangle: true, label: 'What the rival is hiding', hint: 'The rival’s secret comes out, or nearly does.' },
    pull: { id: `${prefix}_rival_pull`, track: 'rival', triangle: true, label: 'The rival’s pull', hint: 'The other person offers something while the main relationship is failing.' },
    choice: { id: `${prefix}_rival_choice`, track: 'rival', triangle: true, label: 'The choice', hint: 'Who they choose and why, or what’s still open for the next book.' },
  })[act]

  const TEMPLATES = {
    generic: {
      label: '3-act',
      note: 'Save the Cat’s beats, plus two pinch points from Dan Wells’s 7-point structure.',
      acts: [
        { label: 'Act I — Setup', beats: [
          { id: 'opening', label: 'Opening image', hint: 'The first picture of your protagonist and their world.' },
          { id: 'setup', label: 'Ordinary world and the lie', hint: 'Their everyday life, and where the lie shows up in it.' },
          { id: 'catalyst', label: 'Inciting incident', hint: 'The event they didn’t choose.' },
          { id: 'debate', label: 'Debate', hint: 'Why they hesitate, and what going forward will cost.' },
          { id: 'break1', label: 'Break into Act II', hint: 'The decision that commits them.' },
        ] },
        { label: 'Act IIa — Promise of the premise', beats: [
          { id: 'b_world', label: 'Fun and games', hint: 'The scenes the premise promised.' },
          { id: 'pinch1', label: 'Pinch 1', hint: 'The opposition shows what it can do.' },
          rival('g', 'option'),
          { id: 'midpoint', label: 'Midpoint', hint: 'A win or a loss that changes how they go about it.' },
        ] },
        { label: 'Act IIb — Pressure', beats: [
          { id: 'bad_guys', label: 'Bad guys close in', hint: 'Pressure from outside rises, and the lie starts costing them.' },
          { id: 'pinch2', label: 'Pinch 2', hint: 'The opposition hits something personal.' },
          rival('g', 'secret'),
          rival('g', 'pull'),
          { id: 'all_lost', label: 'All is lost', hint: 'The lowest point. What they lose.' },
          { id: 'dark_night', label: 'Dark night of the soul', hint: 'How they take the loss.' },
        ] },
        { label: 'Act III — Resolution', beats: [
          { id: 'break2', label: 'Break into Act III', hint: 'What gives them a way forward.' },
          { id: 'climax', label: 'Climax', hint: 'The final confrontation.' },
          rival('g', 'choice'),
          { id: 'resolution', label: 'Resolution and closing image', hint: 'Their world afterward, and the last image.' },
        ] },
      ],
    },
    romance: {
      label: 'Romance arc',
      note: 'The four phases from Gwen Hayes’s Romancing the Beat.',
      acts: [
        { label: 'Setup', beats: [
          { id: 'r_lives', label: 'Two lives', hint: 'Each of them before they meet, and what’s missing.' },
          { id: 'r_meet', label: 'The meet', hint: 'How they meet, and what each gets wrong about the other.' },
          { id: 'r_noway', label: 'No way', hint: 'The reasons this can’t happen.' },
          { id: 'r_adhesion', label: 'Adhesion', hint: 'What keeps putting them in each other’s way.' },
        ] },
        { label: 'Falling', beats: [
          { id: 'r_desire', label: 'Deepening desire', hint: 'Something that changes how one of them sees the other.' },
          { id: 'r_maybe', label: 'Maybe this could work', hint: 'A stretch where it’s going well.' },
          rival('r', 'option'),
          { id: 'r_midpoint', label: 'Midpoint of love', hint: 'Something they can’t take back: a confession, a night, a promise.' },
        ] },
        { label: 'Retreating', beats: [
          { id: 'r_doubt', label: 'Inkling of doubt', hint: 'The first sign the old reasons still stand.' },
          { id: 'r_shields', label: 'Shields up', hint: 'One of them pulls back to protect themselves.' },
          rival('r', 'secret'),
          rival('r', 'pull'),
          { id: 'r_breakup', label: 'The breakup', hint: 'How it ends between them.' },
        ] },
        { label: 'Fighting', beats: [
          { id: 'r_wakeup', label: 'Wake up', hint: 'What each of them has to face alone.' },
          { id: 'r_gesture', label: 'Grand gesture', hint: 'What one of them does to win the other back, and what it costs.' },
          rival('r', 'choice'),
          { id: 'r_whole', label: 'What whole-hearted love looks like', hint: 'The two of them together at the end.' },
        ] },
      ],
    },
    fantasy_romance: {
      label: 'Fantasy romance',
      note: 'Quest and romance side by side. Each act ends on a turning point they share.',
      acts: [
        { label: 'Act I — The call and the meet', beats: [
          { id: 'fq_world', track: 'quest', label: 'Ordinary world and the lie', hint: 'Their life and world before the quest.' },
          { id: 'fq_inciting', track: 'quest', label: 'The call', hint: 'The event that starts the quest.' },
          { id: 'fl_meet', track: 'romance', label: 'The meet', hint: 'How they meet, and what each gets wrong about the other.' },
          { id: 'fl_noway', track: 'romance', label: 'No way', hint: 'The reasons this can’t happen.' },
          { id: 'fx_bind', track: 'shared', label: 'Bound together', hint: 'The quest decision that ties them together.' },
        ] },
        { label: 'Act IIa — Promise of the premise', beats: [
          { id: 'fq_progress', track: 'quest', label: 'First real progress', hint: 'The quest moves forward in a way the reader can see.' },
          { id: 'fq_pinch1', track: 'quest', label: 'Pinch: the opposition’s strength', hint: 'The opposition shows what it can do.' },
          { id: 'fl_desire', track: 'romance', label: 'Deepening desire', hint: 'Something that changes how one of them sees the other, like an unexpected kindness.' },
          { id: 'fl_maybe', track: 'romance', label: 'Maybe this could work', hint: 'A stretch where it’s going well.' },
          rival('f', 'option'),
          { id: 'fx_midpoint', track: 'shared', label: 'Midpoint collision', hint: 'A quest revelation and a turn in the relationship, at the same time.' },
        ] },
        { label: 'Act IIb — Pressure', beats: [
          { id: 'fq_closing', track: 'quest', label: 'The opposition closes in', hint: 'The quest gets harder and the options run out.' },
          { id: 'fq_pinch2', track: 'quest', label: 'Pinch: the cost gets personal', hint: 'The opposition hits something personal.' },
          { id: 'fl_doubt', track: 'romance', label: 'Inkling of doubt', hint: 'The first sign the old reasons still stand.' },
          { id: 'fl_shields', track: 'romance', label: 'Shields up', hint: 'A wound comes up and one of them pulls back.' },
          rival('f', 'secret'),
          rival('f', 'pull'),
          { id: 'fx_lowpoint', track: 'shared', label: 'The low point', hint: 'The quest fails and the relationship breaks, together or one causing the other.' },
        ] },
        { label: 'Act III — What both tracks earn', beats: [
          { id: 'fq_key', track: 'quest', label: 'Dark night and the key', hint: 'The loss, then what gives them a way forward.' },
          { id: 'fl_wakeup', track: 'romance', label: 'Wake up', hint: 'What each of them has to face alone.' },
          rival('f', 'choice'),
          { id: 'fx_climax', track: 'shared', label: 'Climax and grand gesture', hint: 'Winning the quest and choosing each other come down to the same decision.' },
          { id: 'fx_resolution', track: 'shared', label: 'Resolution', hint: 'Their world afterward, and where the two of them stand.' },
        ] },
      ],
    },
  }

  // Novel-level questions, answered once. `step` groups them; `short` names them in the rail.
  // The rival group shows only when the novel has a love triangle.
  const FOUNDATION_STEPS = [
    { id: 'ending', label: 'The ending first', intro: 'What the book is about, and where it ends up.', source: 'Dan Wells, 7-point structure' },
    { id: 'arcs', label: 'Character arcs', intro: 'Your protagonist’s want, lie, need and wound.', source: 'K.M. Weiland, Creating Character Arcs' },
    { id: 'opposition', label: 'Opposition and stakes', intro: 'What stands in the way, and what’s at risk.', source: 'Romance genre craft; most structure guides' },
    { id: 'case', label: 'The case', intro: 'For a mystery or investigation. Start with what really happened, then plan how it’s uncovered.', source: 'Tzvetan Todorov, “The Typology of Detective Fiction”', mystery: true },
    { id: 'rival', label: 'The rival', intro: 'For a love triangle.', source: '', triangle: true },
    { id: 'promises', label: 'Promises, progress, payoff', intro: 'What the opening promises, and how it pays off.', source: 'Brandon Sanderson’s lectures' },
  ]
  const FOUNDATION = [
    { id: 'question', short: 'The big question', step: 'ending', q: 'What question does the whole book answer?', hint: 'Will they…? Can they…?' },
    { id: 'ending', short: 'The ending', step: 'ending', q: 'How does it end? What’s revealed, and where are your protagonist and the love interest when it’s over?', hint: 'A guess is fine.' },
    { id: 'opposite', short: 'Start vs. end', step: 'ending', q: 'Who is your protagonist on page one, and who are they on the last page?', hint: 'One sentence each.' },
    { id: 'want', short: 'Want', step: 'arcs', q: 'What does your protagonist want when the book opens?', hint: 'Something they could point to.' },
    { id: 'lie', short: 'The lie', step: 'arcs', q: 'What false belief do they hold about themselves or the world?', hint: 'If there’s more than one, pick the one the ending proves wrong.' },
    { id: 'need', short: 'Need', step: 'arcs', q: 'What do they actually need, which the lie keeps them from?', hint: 'Often not the same as the want.' },
    { id: 'wound', short: 'Wound', step: 'arcs', q: 'What happened to your protagonist before page one that made the lie feel true?', hint: 'One specific moment.' },
    { id: 'li', short: 'The love interest', step: 'arcs', q: 'What does the love interest want, what are they hiding, and what hurt them?', hint: '' },
    { id: 'opposition', short: 'Opposition', step: 'opposition', q: 'Who or what works against them, and what does it want?', hint: 'A person, a group, a system, or something in them.' },
    { id: 'stakes', short: 'Stakes', step: 'opposition', q: 'If they fail, what’s lost?', hint: 'For them, and for everyone else.' },
    { id: 'why_not', short: 'Why not together', step: 'opposition', q: 'Why can’t the two of them be together?', hint: 'One outside reason (the world, a rule, a job) and one inside reason (a flaw, a fear).' },
    { id: 'case_truth', short: 'What really happened', step: 'case', q: 'What really happened?', hint: 'The crime, in the order it happened.' },
    { id: 'case_culprit', short: 'Who and why', step: 'case', q: 'Who did it, and why?', hint: '' },
    { id: 'case_hiding', short: 'Who’s hiding what', step: 'case', q: 'Who’s hiding what?', hint: 'Including people who didn’t do it.' },
    { id: 'case_theory', short: 'The first theory', step: 'case', q: 'What does the investigation believe at first, and why is it wrong?', hint: '' },
    { id: 'case_layers', short: 'The case under the case', step: 'case', q: 'Is there a case under the case? How does one lead to the other?', hint: '' },
    { id: 'case_clues', short: 'Key clues', step: 'case', q: 'Which clues does the solution depend on?', hint: 'The ones the reader needs to have seen before the reveal.' },
    { id: 'rival', short: 'The other person', step: 'rival', q: 'Who’s the other person, and what do they offer that the love interest can’t?', hint: '' },
    { id: 'rival_want', short: 'What they want and hide', step: 'rival', q: 'What does the rival want, and what are they hiding?', hint: '' },
    { id: 'rival_why_not', short: 'Why not the rival', step: 'rival', q: 'Why can’t your protagonist be with the rival?', hint: 'One outside reason and one inside reason.' },
    { id: 'rival_plot', short: 'Where they cross the plot', step: 'rival', q: 'Where does the rival’s story cross the main plot?', hint: 'A thread, a case, a place, a person they share.' },
    { id: 'rival_knows', short: 'Who knows what, when', step: 'rival', q: 'When does each of them find out about the other, and how?', hint: '' },
    { id: 'rival_means', short: 'What each choice means', step: 'rival', q: 'What does choosing each of them say about who your protagonist becomes?', hint: 'Think about the lie and the need.' },
    { id: 'rival_settled', short: 'Settled or open', step: 'rival', q: 'Does this book settle the triangle, or leave it open?', hint: 'If it stays open, what’s unresolved at the end?' },
    { id: 'promise', short: 'The promise', step: 'promises', q: 'What does your first chapter promise the reader?', hint: 'Genre, tone, tropes.' },
    { id: 'threads', short: 'Threads and progress', step: 'promises', q: 'What kind of plot is each thread, and how will the reader see it moving?', hint: 'Mystery: clues found. Romance: trust gained and lost. Quest: ground covered.' },
    { id: 'payoff', short: 'Payoff', step: 'promises', q: 'What moment pays off the biggest promise?', hint: 'The scene readers picked the book up for.' },
    { id: 'known', short: 'A scene you know', step: 'promises', q: 'What scene, image or line do you already know is in this book?', hint: '' },
  ]

  // Questions per beat. `recall` shows the writer's foundation answers beside them.
  const q = (...list) => list
  const BEAT_QUESTIONS = {
    // 3-act
    opening: { recall: ['opposite'], questions: q('What does the reader see first?', 'What about this picture will be different by the last page?') },
    setup: { recall: ['want', 'lie'], questions: q('What does a normal day look like for your protagonist?', 'Where does the lie show up in how they live?', 'What’s already a little broken?') },
    catalyst: { recall: ['want'], questions: q('What event does your protagonist not choose?', 'What would their life look like if it never happened?') },
    debate: { recall: ['lie'], questions: q('What reason do they give for not going forward?', 'Which part of that reason is the lie talking?') },
    break1: { questions: q('What do they decide, and how is it their own choice?', 'What do they leave behind?') },
    b_world: { recall: ['promise', 'threads'], questions: q('Which scenes here are the ones the premise promised?', 'How does the reader see the plot move?') },
    pinch1: { recall: ['opposition'], questions: q('What does the opposition do that shows its real strength?', 'What does your protagonist learn about what they’re up against?') },
    midpoint: { recall: ['question'], questions: q('Is this a false victory or a false defeat?', 'What do they learn that changes how they act?', 'How do the stakes rise?') },
    bad_guys: { recall: ['threads', 'opposition'], questions: q('How does the pressure rise from outside?', 'How does the lie start costing them from inside?', 'How does the reader see the thread move here?') },
    pinch2: { recall: ['stakes'], questions: q('What does the opposition take or threaten that’s personal?', 'Who pays for their mistakes?') },
    all_lost: { recall: ['stakes'], questions: q('What do they lose?', 'Why does it look like the end?') },
    dark_night: { recall: ['lie', 'need'], questions: q('What do they feel, and what do they finally admit?', 'How does the lie fail them here?') },
    break2: { recall: ['need'], questions: q('What truth, idea or help makes one more try possible?', 'Where does it come from, and why couldn’t they see it before?') },
    climax: { recall: ['ending', 'lie', 'need', 'payoff'], questions: q('How do they face the opposition?', 'Do they act on the need, or on the lie?', 'Which promise does this pay off?') },
    resolution: { recall: ['ending', 'opposite'], questions: q('What does the world look like now?', 'Which image from the opening does this mirror, and what’s changed?') },
    // Romance
    r_lives: { recall: ['want', 'li', 'wound'], questions: q('What is each of them missing without knowing it?', 'What does each think they want from life right now?') },
    r_meet: { recall: ['li'], questions: q('Where and how do they meet?', 'What does each get wrong about the other?') },
    r_noway: { recall: ['why_not'], questions: q('What’s the outside reason this can’t happen?', 'What’s the inside reason, for each of them?') },
    r_adhesion: { questions: q('What keeps them in each other’s orbit?', 'Why can’t either of them just leave?') },
    r_desire: { recall: ['li'], questions: q('What does your protagonist see the love interest do that doesn’t fit who they thought they were?', 'Does the love interest know they were seen?') },
    r_maybe: { recall: ['threads'], questions: q('What does being good together look like, specifically?', 'How does the reader see the trust grow?') },
    r_midpoint: { recall: ['why_not'], questions: q('What happens that they can’t take back?', 'What does it cost each of them to let it happen?') },
    r_doubt: { recall: ['why_not'], questions: q('What’s the first sign the old reasons still stand?', 'Who notices first?') },
    r_shields: { recall: ['wound'], questions: q('Which wound takes over, and whose?', 'What does protecting themselves look like?') },
    r_breakup: { recall: ['why_not'], questions: q('How does it break?', 'Why does the breakup make sense to both of them?') },
    r_wakeup: { recall: ['lie', 'need', 'wound'], questions: q('What does each have to face alone?', 'What do they understand now that they couldn’t before?') },
    r_gesture: { recall: ['need'], questions: q('Who proves they’ve changed, and how?', 'What does it cost them?') },
    r_whole: { recall: ['ending', 'opposite'], questions: q('What do the two of them look like together now?', 'What’s different from how they met?') },
    // Fantasy romance
    fq_world: { recall: ['want', 'lie'], questions: q('What does your protagonist’s world look like before the quest?', 'Where does the lie show up in how they live?') },
    fq_inciting: { recall: ['want'], questions: q('What happens to your protagonist that can’t be undone?', 'What did they want the day before it happened?', 'Who wants them to walk away from it?') },
    fl_meet: { recall: ['li'], questions: q('Where and how do they meet?', 'What does each get wrong about the other?') },
    fl_noway: { recall: ['why_not'], questions: q('What’s the outside reason this can’t happen?', 'What’s the inside reason, for each of them?') },
    fx_bind: { questions: q('What quest decision ties the two of them together?', 'Why can’t either of them walk away now?') },
    fq_progress: { recall: ['threads', 'promise'], questions: q('How does the quest move forward?', 'How does the reader see it move: clues, ground, allies?') },
    fq_pinch1: { recall: ['opposition'], questions: q('What does the opposition do that shows its real strength?', 'What does it tell your protagonist about what they’re up against?') },
    fl_desire: { recall: ['li'], questions: q('What does your protagonist see the love interest do that doesn’t fit who they thought they were?', 'Does the love interest know they were seen?') },
    fl_maybe: { recall: ['threads'], questions: q('What does being good together look like, specifically?', 'How does the reader see the trust grow?') },
    fx_midpoint: { recall: ['question'], questions: q('What truth about the quest comes out here?', 'What happens between the two of them at the same moment?', 'Why can’t either of them go back to how it was?') },
    fq_closing: { recall: ['stakes', 'threads'], questions: q('How does the cost of the quest rise?', 'Which options close off?') },
    fq_pinch2: { recall: ['stakes', 'opposition'], questions: q('What does the opposition take or threaten that’s personal?', 'Who pays for their mistakes?') },
    fl_doubt: { recall: ['why_not'], questions: q('What’s the first sign the old reasons still stand?', 'Who notices first?') },
    fl_shields: { recall: ['wound', 'li'], questions: q('Which wound is revealed or reopened, and whose?', 'What does protecting themselves look like?', 'What does it make the reader dread?') },
    fx_lowpoint: { recall: ['li', 'why_not', 'wound'], questions: q('Which secret or choice breaks them?', 'How does the quest failure and the breakup connect?', 'Who’s right, and who’s hurt more?') },
    fq_key: { recall: ['lie', 'need'], questions: q('What does the loss make them admit?', 'What truth or help makes one more try possible?') },
    fl_wakeup: { recall: ['wound', 'need'], questions: q('What does each have to face alone?', 'What do they understand now that they couldn’t before?') },
    fx_climax: { recall: ['ending', 'lie', 'need', 'payoff'], questions: q('What does winning the quest require of them?', 'How does that choice prove the love, or the other way around?', 'Do they act on the need, or on the lie?') },
    fx_resolution: { recall: ['ending', 'opposite'], questions: q('What does the world look like now?', 'What does each track earn, and what did it cost?') },
  }

  const RIVAL_QUESTIONS = {
    option: { recall: ['rival', 'rival_want', 'rival_knows'], questions: q('What does the other person offer here that the love interest can’t?', 'Who knows about it so far?') },
    secret: { recall: ['rival_want', 'rival_plot'], questions: q('What comes out, or nearly comes out?', 'Who finds out, and what does it cost the rival?') },
    pull: { recall: ['rival', 'rival_why_not', 'why_not'], questions: q('What does the other person give your protagonist while the main relationship is failing?', 'What would choosing them cost?') },
    choice: { recall: ['rival_means', 'rival_settled'], questions: q('Who do they choose, and why?', 'If it stays open, what’s unresolved?') },
  }
  for (const prefix of ['g', 'r', 'f']) {
    for (const act of ['option', 'secret', 'pull', 'choice']) BEAT_QUESTIONS[`${prefix}_rival_${act}`] = RIVAL_QUESTIONS[act]
  }

  // With the Mystery switch on, these beats ask about the investigation instead. Their answers
  // are stored under their own keys ('m0', 'm1'…), so switching never mixes up the two sets.
  const MYSTERY_QUESTIONS = {
    // 3-act
    catalyst: { recall: ['case_truth'], questions: q('What case opens, and how does it reach your protagonist?', 'What’s the first thing that doesn’t fit?') },
    b_world: { recall: ['case_clues', 'case_theory'], questions: q('What clues come up, and what do they point to?', 'Who becomes a suspect?') },
    pinch1: { cases: 'case_culprit', recall: ['case_culprit'], questions: q('How does whoever’s behind it push back?', 'What does that show about who they’re dealing with?') },
    midpoint: { recall: ['case_theory', 'case_layers'], questions: q('What does the investigation learn that changes the theory?', 'Is this where the case under the case shows?') },
    bad_guys: { cases: 'case_theory', recall: ['case_hiding'], questions: q('Which lead dies, or which witness goes quiet?', 'Who’s lying, and does your protagonist know it yet?') },
    all_lost: { cases: 'case_theory', recall: ['case_theory'], questions: q('The false solution: who do they believe did it?', 'What does believing it cost?') },
    break2: { cases: 'case_clues', recall: ['case_clues'], questions: q('Which clue cracks it, and why didn’t it make sense before?', 'Where was it planted earlier for the reader to see?') },
    climax: { cases: 'case_culprit', recall: ['case_culprit', 'case_truth'], questions: q('How is the culprit confronted?', 'How is the truth proven, or forced out?') },
    // Fantasy romance, quest track
    fq_world: { recall: ['case_truth'], questions: q('What does a normal case look like for your protagonist before this one?', 'What’s already wrong that nobody’s looking at?') },
    fq_inciting: { recall: ['case_truth'], questions: q('What case opens, and how does it reach your protagonist?', 'What’s the first thing that doesn’t fit?') },
    fq_progress: { recall: ['case_clues', 'case_theory'], questions: q('What clues come up, and what do they point to?', 'Who becomes a suspect?') },
    fq_pinch1: { cases: 'case_culprit', recall: ['case_culprit'], questions: q('How does whoever’s behind it push back?', 'What does that show about who they’re dealing with?') },
    fq_closing: { cases: 'case_theory', recall: ['case_theory', 'case_hiding'], questions: q('What breaks the first theory?', 'Which lead dies, or which witness goes quiet?') },
    fq_pinch2: { recall: ['case_hiding', 'case_layers'], questions: q('How does the case turn personal?', 'Who gets hurt because of the investigation?') },
    fq_key: { cases: 'case_clues', recall: ['case_clues'], questions: q('Which clue cracks it, and why didn’t it make sense before?', 'Where was it planted earlier for the reader to see?') },
  }

  // The questions a beat asks for this novel, each with the key its answer is stored under.
  function questionsFor(id, structure = {}) {
    const mystery = structure.mystery === true && MYSTERY_QUESTIONS[id]
    const spec = mystery || BEAT_QUESTIONS[id] || { questions: [] }
    return { recall: spec.recall || [], cases: mystery ? spec.cases || '' : '', questions: spec.questions.map((text, i) => ({ key: mystery ? `m${i}` : String(i), text })) }
  }

  // Old beat ids that moved. Their text becomes an earlier draft under the new id.
  const MIGRATIONS = {
    fr_call: 'fq_inciting', fr_obstacle: 'fq_pinch1', fr_dark_quest: 'fq_key', fr_meet: 'fl_meet',
    fr_proximity: 'fx_bind', fr_crack: 'fl_desire', fr_collision: 'fx_midpoint', fr_black: 'fx_lowpoint',
    fr_climax_q: 'fx_climax', fr_closing: 'fx_resolution',
    r_proximity: 'r_adhesion', r_crack: 'r_desire', r_almost: 'r_maybe', r_shift: 'r_midpoint',
    r_black: 'r_breakup', r_reckoning: 'r_wakeup', r_reunion: 'r_gesture', r_closing: 'r_whole',
    finale: 'climax', closing: 'resolution',
  }

  // The template as a novel sees it: triangle beats only when the novel has a love triangle.
  function template(key, triangle = false) {
    const tmpl = TEMPLATES[key] || TEMPLATES.generic
    return { ...tmpl, acts: tmpl.acts.map(act => ({ ...act, beats: act.beats.filter(b => triangle || !b.triangle) })) }
  }
  const beatsOf = (key, triangle = false) => template(key, triangle).acts.flatMap(act => act.beats)
  const allBeatIds = () => Object.keys(TEMPLATES).flatMap(key => beatsOf(key, true).map(b => b.id))
  // Which optional groups show: pass the novel's structure ({ triangle, mystery }).
  const foundationSteps = (options = {}) => FOUNDATION_STEPS.filter(step =>
    (!step.triangle || options.triangle === true) && (!step.mystery || options.mystery === true))
  const foundationFor = (options = {}) => {
    const steps = new Set(foundationSteps(options).map(step => step.id))
    return FOUNDATION.filter(f => steps.has(f.step))
  }

  // Copies moved text into empty new ids. Returns a new map; never overwrites.
  function migrate(beats = {}) {
    const out = { ...beats }
    for (const [from, to] of Object.entries(MIGRATIONS)) {
      if (String(out[from] || '').trim() && !String(out[to] || '').trim()) out[to] = out[from]
    }
    return out
  }

  // 'empty' | 'draft' (text the writer hasn't rewritten in the builder) | 'mine'
  function beatState(id, beats = {}, structure = {}) {
    if (!String(beats[id] || '').trim()) return 'empty'
    return structure.mine?.[id] ? 'mine' : 'draft'
  }

  function blankStructure() {
    return { version: 1, triangle: false, mystery: false, foundation: {}, answers: {}, mine: {}, drafts: {} }
  }

  // The whole structure as Markdown, for pasting into a chat with an AI or a critique partner.
  // caseDigest: QuillCase.caseDigest(cases, scenes), printed as a Cases section when Mystery is on.
  function toMarkdown({ title = '', templateKey = 'generic', beats = {}, structure = {}, scenesByBeat = {}, caseDigest = null } = {}) {
    const s = { ...blankStructure(), ...structure }
    const tmpl = template(templateKey, s.triangle)
    const out = [`# ${title || 'Untitled'} — Structure (${tmpl.label})`, '']
    const foundation = foundationFor(s).filter(f => String(s.foundation[f.id] || '').trim())
    if (foundation.length) {
      out.push('## Foundation', '')
      for (const f of foundation) out.push(`**${f.q}** ${s.foundation[f.id].trim()}`, '')
    }
    const digest = s.mystery && caseDigest ? Object.entries(caseDigest).filter(([, lines]) => lines.length) : []
    if (digest.length) {
      out.push('## Cases (from the Case Builder)', '')
      for (const [id, lines] of digest) {
        out.push(`**${FOUNDATION.find(f => f.id === id)?.short || id}**`)
        lines.forEach(line => out.push(`- ${line}`))
        out.push('')
      }
    }
    for (const act of tmpl.acts) {
      out.push(`## ${act.label}`, '')
      for (const b of act.beats) {
        const track = b.track ? ` (${b.track})` : ''
        out.push(`### ${b.label}${track}`)
        const state = beatState(b.id, beats, s)
        if (state === 'empty') out.push('Beat: (not written yet)')
        else out.push(`Beat${state === 'draft' ? ' (earlier draft, not yet rewritten)' : ''}: ${String(beats[b.id]).trim()}`)
        const answers = s.answers[b.id] || {}
        for (const { key, text } of questionsFor(b.id, s).questions) {
          const a = String(answers[key] || '').trim()
          if (a) out.push(`- ${text} ${a}`)
        }
        const scenes = scenesByBeat[b.id] || []
        if (scenes.length) out.push(`- Scenes: ${scenes.map(sc => sc.title).join('; ')}`)
        out.push('')
      }
    }
    return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n'
  }

  return {
    TEMPLATES, FOUNDATION_STEPS, FOUNDATION, BEAT_QUESTIONS, MYSTERY_QUESTIONS, MIGRATIONS,
    template, beatsOf, allBeatIds, foundationSteps, foundationFor, questionsFor, migrate, beatState, blankStructure, toMarkdown,
  }
})
