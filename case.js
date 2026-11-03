/* case.js — the Case Builder's fixed lists, fair-play check, Markdown copy, and the digest the
 * Structure Builder shows under its "The case" questions. Shared by main (validation) and the
 * renderer. Cases live in <novel>/.cases.json; scenes are referred to by scene_id.
 *
 * The workflow follows the usual mystery advice: write what really happened from the culprit's
 * side, ask what each step left behind, give each clue a job, decide how it's found, and check
 * that every clue the solution needs is on the page before the reveal (fair play).
 *
 * The investigation is the detective's side: stops in order (where they go, what they learn,
 * what they believe now). A stop needn't have a scene yet, so a case can be ordered and checked
 * while it's still being brainstormed. A stop without a scene between two stops that have one
 * sits between them; one after the last stop with a scene hasn't been written, so it sits after
 * the manuscript; one before the first sits just before it.
 *
 * Loaded as a plain script in the renderer (window.QuillCase) and required by main.js.
 */
;(function (root, factory) {
  const api = factory()
  if (typeof module !== 'undefined' && module.exports) module.exports = api
  else root.QuillCase = api
})(typeof self !== 'undefined' ? self : globalThis, function () {
  const KINDS = [
    { id: 'physical', label: 'Physical', example: 'An object, a wound, residue: silver dust where there shouldn’t be any.' },
    { id: 'records', label: 'Records', example: 'A paper trail: a motel booking, a requisition log, camera footage.' },
    { id: 'witness', label: 'Witness', example: 'What someone saw or heard, usually partly wrong.' },
    { id: 'behaviour', label: 'Behaviour', example: 'Someone acting wrong: a call that makes no sense, a lie that’s too quick.' },
    { id: 'absence', label: 'Absence', example: 'Something that should be there and isn’t: missing footage, a memo that never came.' },
    { id: 'supernatural', label: 'Supernatural', example: 'A trace only the uncanny leaves: a feeding mark, residue from a spell or a compulsion, a ward that’s been broken.' },
  ]
  const JOBS = [
    { id: 'true', label: 'True clue', example: 'Points toward what really happened.' },
    { id: 'herring', label: 'Red herring', example: 'Points the wrong way, on purpose or because of someone’s unrelated secret.' },
    { id: 'double', label: 'Double meaning', example: 'Means one thing when found and something else later.' },
  ]
  const METHODS = [
    { id: 'scene', label: 'Working the scene' },
    { id: 'canvass', label: 'Canvass / witnesses' },
    { id: 'victim', label: 'The victim' },
    { id: 'records', label: 'Records / favours' },
    { id: 'lab', label: 'Lab or results that take time' },
    { id: 'pressure', label: 'Pressuring someone' },
    { id: 'surveillance', label: 'Surveillance' },
    { id: 'lore', label: 'Archives / lore' },
    { id: 'informant', label: 'An informant on the other side' },
    { id: 'ability', label: 'A power or sense' },
    { id: 'other', label: 'Other' },
  ]
  // The builder's groups, in order. Each opens on an intro screen with its hint.
  const STEPS = [
    { id: 'truth', label: 'What really happened', hint: 'Write it from the culprit’s side, one step at a time, in order. Mistakes and loose ends are where clues come from.' },
    { id: 'clues', label: 'Clues', hint: 'Every step leaves something behind. Pick a step and ask what trace it left and who could notice it, or add a clue on its own.' },
    { id: 'leads', label: 'The investigation', hint: 'The detective’s side, in order: where they go, what they find, what they believe now, and what sends them to the next stop. A stop doesn’t need a scene yet.' },
    { id: 'suspects', label: 'Suspects', hint: 'Everyone the reader might suspect. Each needs a reason to look guilty and something that clears them.' },
    { id: 'rules', label: 'Solution rules', hint: 'Any fact the solution depends on: a forensic limit, a law, a technical constraint, or how a power works. The reader has to learn it before the reveal, or the answer feels like a cheat.' },
    { id: 'reveal', label: 'Reveal order', hint: 'Every clue in manuscript order. Key clues should be on the page before the reveal.' },
  ]

  const label = (list, id) => list.find(x => x.id === id)?.label || ''
  const uid = () => Math.random().toString(36).slice(2, 10)

  function blankCase(title = '') {
    return { id: uid(), title, revealSceneId: '', revealLeadId: '', truth: [], clues: [], suspects: [], leads: [], rules: [], board: {} }
  }

  // Fills in what older case files don't have, in place.
  function normalize(c) {
    for (const k of ['truth', 'clues', 'suspects', 'leads', 'rules']) if (!Array.isArray(c[k])) c[k] = []
    if (typeof c.revealLeadId !== 'string') c.revealLeadId = ''
    if (!c.board || typeof c.board !== 'object' || Array.isArray(c.board)) c.board = {}
    for (const cl of c.clues) {
      if (typeof cl.leadId !== 'string') cl.leadId = ''
      if (typeof cl.leadsTo !== 'string') cl.leadsTo = ''
      if (!Array.isArray(cl.alsoSceneIds)) cl.alsoSceneIds = []
    }
    return c
  }

  const leadName = (l, n) => String(l?.title || '').trim() || String(l?.where || '').trim() || `Stop ${n + 1}`

  // Where things fall in reading order, as numbers: a scene is its index in the manuscript; a
  // stop is its scene's, or (planned) placed by its neighbours as the header describes.
  function positions(c = {}, scenes = []) {
    const order = new Map(scenes.map((scene, i) => [scene.id, i]))
    const leads = c.leads || []
    const anchor = leads.map(l => order.has(l.sceneId) ? order.get(l.sceneId) : null)
    const leadPos = new Map()
    leads.forEach((l, k) => {
      if (anchor[k] !== null) return leadPos.set(l.id, { at: anchor[k], planned: false })
      let p = k - 1
      while (p >= 0 && anchor[p] === null) p--
      let n = k + 1
      while (n < leads.length && anchor[n] === null) n++
      const at = p >= 0 && n < leads.length ? anchor[p] + (k - p) / 1000
        : n < leads.length ? anchor[n] - (n - k) / 1000
        : scenes.length + k / 1000
      leadPos.set(l.id, { at, planned: true })
    })
    // A scene wins over a stop; either gives { at, planned, sceneId, leadId }, or null.
    const place = (sceneId, leadId) => {
      if (order.has(sceneId)) return { at: order.get(sceneId), planned: false, sceneId, leadId: '' }
      if (leadPos.has(leadId)) {
        const lead = leads.find(l => l.id === leadId)
        return { ...leadPos.get(leadId), sceneId: order.has(lead.sceneId) ? lead.sceneId : '', leadId }
      }
      return null
    }
    return {
      place,
      clue: cl => place(cl.foundSceneId, cl.leadId),
      reveal: () => place(c.revealSceneId, c.revealLeadId),
      lead: id => leadPos.get(id) || null,
    }
  }

  // The case board: the case, its suspects and its clues pinned to a corkboard, each where the
  // writer dragged it (c.board, keyed 'case', 'suspect:<id>', 'clue:<id>'). A card never moved
  // gets a spot: the case and suspects across the top, clues in rows of five below.
  const CARD_WIDTH = { case: 190, suspect: 150, clue: 200 }
  function boardLayout(c = {}) {
    const saved = c.board && typeof c.board === 'object' ? c.board : {}
    const out = []
    const put = (kind, id, x, y) => {
      const key = kind === 'case' ? 'case' : `${kind}:${id}`
      const at = saved[key]
      const moved = Boolean(at && Number.isFinite(at.x) && Number.isFinite(at.y))
      out.push({ key, kind, id, x: moved ? at.x : x, y: moved ? at.y : y, w: CARD_WIDTH[kind], moved })
    }
    put('case', '', 40, 28)
    ;(c.suspects || []).forEach((s, n) => put('suspect', s.id, 270 + n * 190, 24 + (n % 2) * 12))
    ;(c.clues || []).forEach((cl, n) => put('clue', cl.id, 40 + (n % 5) * 215, 330 + Math.floor(n / 5) * 150))
    return out
  }

  // Red string from each clue to the suspect it points at, pin to pin; a red herring's is dashed.
  function boardStrings(c = {}, layout = boardLayout(c)) {
    const card = new Map(layout.map(x => [x.key, x]))
    const pin = x => ({ x: x.x + x.w / 2, y: x.y + 10 })
    return (c.clues || []).filter(cl => cl.suspectId && card.has(`suspect:${cl.suspectId}`) && card.has(`clue:${cl.id}`))
      .map(cl => ({ clueId: cl.id, suspectId: cl.suspectId, herring: cl.job === 'herring',
        from: pin(card.get(`clue:${cl.id}`)), to: pin(card.get(`suspect:${cl.suspectId}`)) }))
  }

  // Scenes are [{ id, title, chapter }] in manuscript order. Warnings are plain sentences, each
  // with the clue, suspect or rule it's about so the page can jump there.
  function fairPlay(c = {}, scenes = []) {
    const pos = positions(c, scenes)
    const sceneIds = new Set(scenes.map(scene => scene.id))
    const missingScene = id => Boolean(id && !sceneIds.has(id))
    const clues = c.clues || []
    const suspects = c.suspects || []
    const warnings = []
    const name = clue => `“${String(clue.text || '').trim() || 'Untitled clue'}”`
    const reveal = pos.reveal()
    // Only once there are clues to order; an empty case isn't wrong, just unstarted.
    if (!reveal && clues.length) warnings.push({ kind: missingScene(c.revealSceneId) ? 'missing-reveal-scene' : 'no-reveal',
      text: missingScene(c.revealSceneId) ? 'The scene assigned to the reveal is missing. Relink it or build a replacement scene.'
        : 'The case has no reveal yet. Pick the scene or stop where the truth comes out.' })
    const key = clues.filter(clue => clue.key)
    if (clues.length && !key.length) warnings.push({ kind: 'no-key', text: 'No clue is marked Key. Which ones does the solution depend on?' })
    for (const clue of key) {
      const at = pos.clue(clue)
      if (missingScene(clue.foundSceneId)) warnings.push({ kind: 'missing-clue-scene', clueId: clue.id,
        text: `The scene assigned to key clue ${name(clue)} is missing. Relink it or build a replacement scene.` })
      else if (!at) warnings.push({ kind: 'key-unplaced', clueId: clue.id, text: `Key clue ${name(clue)} isn’t in a scene or a stop yet.` })
      else if (reveal && at.at > reveal.at) {
        warnings.push({ kind: 'key-late', clueId: clue.id, planned: at.planned || reveal.planned, text: at.planned || reveal.planned
          ? `Key clue ${name(clue)} is planned for after the reveal. The reader won’t have seen it.`
          : `Key clue ${name(clue)} first appears after the reveal. The reader can’t have seen it.` })
      }
    }
    for (const lead of c.leads || []) if (missingScene(lead.sceneId)) warnings.push({
      kind: 'missing-lead-scene', leadId: lead.id,
      text: `The scene assigned to investigation stop “${leadName(lead, (c.leads || []).indexOf(lead))}” is missing. Relink it or build a replacement scene.`,
    })
    for (const suspect of suspects) {
      const framed = clues.some(clue => clue.job === 'herring' && clue.suspectId === suspect.id)
      if (framed && !suspect.culprit && !String(suspect.clearedBy || '').trim()) {
        warnings.push({ kind: 'uncleared', suspectId: suspect.id, text: `A red herring points at ${suspect.name || 'a suspect'}, but nothing clears them yet.` })
      }
    }
    const culprits = suspects.filter(s => s.culprit)
    if (suspects.length && !culprits.length) warnings.push({ kind: 'no-culprit', text: 'No suspect is marked Culprit yet.' })
    for (const s of culprits) {
      if (!clues.some(clue => clue.suspectId === s.id && (clue.job === 'true' || clue.job === 'double'))) {
        warnings.push({ kind: 'culprit-unpointed', suspectId: s.id, text: `No true clue points at ${s.name || 'the culprit'} yet. The reader needs a way to get there.` })
      }
    }
    for (const rule of c.rules || []) {
      const text = String(rule.text || '').trim()
      if (!text) continue
      const at = pos.place(rule.sceneId, rule.leadId)
      if (missingScene(rule.sceneId)) warnings.push({ kind: 'missing-rule-scene', ruleId: rule.id,
        text: `The scene assigned to solution rule “${text}” is missing. Relink it before the reveal.` })
      else if (!at) warnings.push({ kind: 'rule-unplaced', ruleId: rule.id, text: `The solution depends on “${text}”, but the reader isn’t shown it anywhere yet.` })
      else if (reveal && at.at > reveal.at) warnings.push({ kind: 'rule-late', ruleId: rule.id, text: `The solution depends on “${text}”, but the reader doesn’t learn it until after the reveal.` })
    }
    return warnings
  }

  // Softer than fair play: things that usually help, not things that break the mystery.
  function notes(c = {}, scenes = []) {
    const pos = positions(c, scenes)
    const sceneIds = new Set(scenes.map(scene => scene.id))
    const out = []
    for (const clue of (c.clues || []).filter(cl => cl.key && pos.clue(cl))) {
      const seen = new Set([pos.clue(clue).sceneId || `lead:${clue.leadId}`, ...(clue.alsoSceneIds || [])])
      if (seen.size < 2) out.push({ kind: 'key-once', clueId: clue.id, text: `Key clue “${String(clue.text || '').trim() || 'Untitled clue'}” is only shown once. Readers usually need to see an important clue more than once.` })
    }
    for (const clue of c.clues || []) {
      const missing = (clue.alsoSceneIds || []).filter(id => id && !sceneIds.has(id)).length
      if (missing) out.push({ kind: 'missing-repeat-scene', clueId: clue.id,
        text: `${missing} secondary scene assignment for “${String(clue.text || '').trim() || 'Untitled clue'}” is missing. Remove or relink it.` })
    }
    return out
  }

  // Clues by chapter in reading order, for the pacing strip: [{ label, clues: [{ id, job, key }],
  // reveal }]. Stops planned past the manuscript share one "Not written yet" cell at the end.
  function pacing(c = {}, scenes = []) {
    const pos = positions(c, scenes)
    const cells = []
    const cellFor = at => {
      const label = at >= scenes.length ? 'Not written yet' : (scenes[Math.floor(at)].chapter || scenes[Math.floor(at)].title)
      let cell = cells.find(x => x.label === label)
      if (!cell) cells.push(cell = { label, clues: [], reveal: false })
      return cell
    }
    for (const s of scenes) cellFor(scenes.indexOf(s))
    const placed = (c.clues || []).map(cl => [cl, pos.clue(cl)]).filter(([, at]) => at).sort((a, b) => a[1].at - b[1].at)
    for (const [cl, at] of placed) cellFor(at.at).clues.push({ id: cl.id, job: cl.job || '', key: !!cl.key })
    const reveal = pos.reveal()
    if (reveal) cellFor(reveal.at).reveal = true
    return cells
  }

  const sceneName = (scenes, id) => scenes.find(s => s.id === id)?.title || ''

  function toMarkdown(c = {}, { scenes = [] } = {}) {
    const out = [`# Case: ${c.title || 'Untitled'}`, '']
    const truth = (c.truth || []).filter(t => [t.title, t.when, t.who, t.what, t.mistake].some(v => String(v || '').trim()))
    if (truth.length) {
      out.push('## What really happened', '')
      truth.forEach((t, i) => out.push(`${i + 1}. ${t.title ? `**${t.title}** — ` : ''}${[t.when, t.who].filter(Boolean).join(', ')}${t.when || t.who ? ': ' : ''}${t.what || ''}${t.mistake ? ` (went wrong: ${t.mistake})` : ''}`))
      out.push('')
    }
    const leads = (c.leads || []).filter(l => [l.title, l.where, l.who, l.learned, l.theory].some(v => String(v || '').trim()))
    const allLeads = c.leads || []
    const leadTitle = id => { const l = allLeads.find(x => x.id === id); return l ? leadName(l, allLeads.indexOf(l)) : '' }
    if (leads.length) {
      out.push('## The investigation', '')
      leads.forEach((l, i) => {
        const where = [l.where, l.who].filter(v => String(v || '').trim()).join(', ')
        const at = sceneName(scenes, l.sceneId) || (l.planned ? `planned: ${l.planned}` : '')
        out.push(`${i + 1}. **${leadName(l, allLeads.indexOf(l))}**${where && where !== l.title ? ` — ${where}` : ''}${at ? ` (${at})` : ''}`)
        if (l.learned) out.push(`   - Learns: ${l.learned}`)
        if (l.theory) out.push(`   - Believes now: ${l.theory}`)
        const next = (c.clues || []).filter(cl => cl.leadId === l.id && cl.leadsTo).map(cl => `${cl.text || 'Untitled clue'} → ${leadTitle(cl.leadsTo)}`)
        if (next.length) out.push(`   - Leads on: ${next.join('; ')}`)
      })
      out.push('')
    }
    const suspects = (c.suspects || []).filter(s => String(s.name || '').trim())
    if (suspects.length) {
      out.push('## Suspects', '')
      for (const s of suspects) {
        out.push(`### ${s.name}${s.culprit ? ' (culprit)' : ''}`)
        for (const [k, v] of [['Means', s.means], ['Motive', s.motive], ['Opportunity', s.opportunity], ['Hiding', s.hiding], ['Cleared by', s.clearedBy]]) {
          if (String(v || '').trim()) out.push(`- ${k}: ${v}`)
        }
        out.push('')
      }
    }
    const clues = (c.clues || []).filter(cl => String(cl.text || '').trim())
    if (clues.length) {
      out.push('## Clues', '')
      for (const cl of clues) {
        const suspect = (c.suspects || []).find(s => s.id === cl.suspectId)?.name
        const tags = [label(KINDS, cl.kind), label(JOBS, cl.job), cl.key ? 'key' : ''].filter(Boolean).join(', ')
        out.push(`- **${cl.text}**${tags ? ` (${tags})` : ''}`)
        const points = [suspect, cl.pointsTo].filter(Boolean).join(' — ')
        if (points) out.push(`  - Points to: ${points}`)
        if (cl.job === 'double' && cl.meansLater) out.push(`  - Means later: ${cl.meansLater}`)
        const found = [label(METHODS, cl.method), sceneName(scenes, cl.foundSceneId)].filter(Boolean)
        if (found.length) out.push(`  - Found: ${found.join(', in ')}`)
        if (cl.leadId && leadTitle(cl.leadId)) out.push(`  - Found during: ${leadTitle(cl.leadId)}`)
        if (cl.leadsTo && leadTitle(cl.leadsTo)) out.push(`  - Leads to: ${leadTitle(cl.leadsTo)}`)
        const also = (cl.alsoSceneIds || []).map(id => sceneName(scenes, id)).filter(Boolean)
        if (also.length) out.push(`  - Also shown in: ${also.join('; ')}`)
        if (cl.note) out.push(`  - Note: ${cl.note}`)
      }
      out.push('')
    }
    const rules = (c.rules || []).filter(r => String(r.text || '').trim())
    if (rules.length) {
      out.push('## World rules the solution depends on', '')
      for (const r of rules) {
        const at = sceneName(scenes, r.sceneId) || leadTitle(r.leadId)
        out.push(`- ${r.text}${at ? ` — shown in ${at}` : ''}`)
      }
      out.push('')
    }
    const reveal = sceneName(scenes, c.revealSceneId) || leadTitle(c.revealLeadId)
    if (reveal) out.push(`Reveal: ${reveal}`, '')
    const warnings = fairPlay(c, scenes)
    if (warnings.length) {
      out.push('## Fair-play warnings', '')
      warnings.forEach(w => out.push(`- ${w.text}`))
    }
    return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n'
  }

  // What the Structure Builder shows under its "The case" questions and mystery beats: one
  // list of short lines per foundation question id, across all cases.
  function caseDigest(cases = [], scenes = []) {
    const d = { case_truth: [], case_culprit: [], case_hiding: [], case_theory: [], case_layers: [], case_clues: [] }
    const many = cases.length > 1
    for (const c of cases) {
      const tag = many ? `${c.title || 'Untitled'}: ` : ''
      for (const t of c.truth || []) {
        const line = [t.title, t.when, t.who, t.title ? '' : t.what].filter(v => String(v || '').trim()).join(' · ')
        if (line) d.case_truth.push(tag + line)
      }
      for (const s of c.suspects || []) {
        if (s.culprit && s.name) d.case_culprit.push(`${tag}${s.name}${s.motive ? ` — ${s.motive}` : ''}`)
        if (s.name && String(s.hiding || '').trim()) d.case_hiding.push(`${tag}${s.name}: ${s.hiding}`)
      }
      for (const cl of c.clues || []) {
        if (!String(cl.text || '').trim()) continue
        if (cl.job === 'herring') {
          const at = (c.suspects || []).find(s => s.id === cl.suspectId)?.name || cl.pointsTo
          d.case_theory.push(`${tag}${cl.text}${at ? ` → ${at}` : ''}`)
        }
        if (cl.key) {
          const lead = (c.leads || []).find(l => l.id === cl.leadId)
          const at = sceneName(scenes, cl.foundSceneId) || sceneName(scenes, lead?.sceneId)
            || (lead ? `planned: ${leadName(lead, c.leads.indexOf(lead))}` : 'no scene yet')
          d.case_clues.push(`${tag}${cl.text} — ${at}`)
        }
      }
      const first = (c.leads || []).find(l => String(l.theory || '').trim())
      if (first) d.case_theory.unshift(`${tag}At first: ${first.theory}`)
      if (String(c.title || '').trim()) d.case_layers.push(c.title)
    }
    if (d.case_layers.length < 2) d.case_layers = []
    return d
  }

  return { KINDS, JOBS, METHODS, STEPS, blankCase, normalize, leadName, positions, boardLayout, boardStrings, fairPlay, notes, pacing, toMarkdown, caseDigest, label }
})
