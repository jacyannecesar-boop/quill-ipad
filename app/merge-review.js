/* merge-review.js — Bring In Changes: review what a backup from the other device would change,
 * untick anything that should stay as it is, pick between the two versions of anything changed on
 * both, then apply the rest.
 *
 * main.js compares the ZIP with this library (preview-merge-archive) without changing anything;
 * Compare shows the two versions of a scene as a diff (merge-preview-diff): the prose as changes,
 * and the scene's details (synopsis, status, notes…) on their own tab. For a scene changed on both
 * devices each change is a choice, starting from the newer device's. apply-merge-preview applies
 * the ticked items with those choices. An unticked item is offered again by the next merge.
 */
const MergeReview = (() => {
  const HERE = document.documentElement.classList.contains('quill-web') ? (window.__quillWeb?.deviceName || 'iPad') : 'Mac'
  let _review = null
  let _skip = new Set()
  let _busy = false
  let _applied = false
  // Scene changed on both -> { mode, hunks, fields, companions, name }; diffs loaded for Compare.
  let _choices = {}
  let _diffs = {}
  // Set while resolving a scene an earlier merge kept twice (the sidebar's "2 versions").
  let _copy = null

  const $ = id => document.getElementById(id)
  const esc = text => escapeHtml(text)
  const n = (count, one, many = `${one}s`) => `${count.toLocaleString()} ${count === 1 ? one : many}`

  function groups(there) {
    return [
      { id:'both', title:'Changed on both', hint:`Each difference starts with the newer version. Open Review to see the changes and pick what to keep: the words and the scene’s details (synopsis, status, notes…) separately.` },
      { id:'edited', title:`Edited on the ${there}`, hint:`Replaces the version on this ${HERE}.` },
      { id:'moved', title:`Moved or renamed on the ${there}`, hint:`Moves here too, with its notes, history and time. Any edits made on the ${there} come with it.` },
      { id:'new', title:`New on the ${there}`, hint:'Added here.' },
      { id:'restored', title:`Deleted on this ${HERE}, edited on the ${there}`, hint:`Comes back, with the ${there}’s edits.` },
      { id:'deleted', title:`Deleted on the ${there}`, hint:'Moves to Trash here, where you can still restore it.' },
      { id:'settings', title:'Settings, boards and Trash', hint:'Chapter order, corkboards, notes files and stats. Where both devices changed one, the two are combined.', collapsed:true },
    ]
  }

  // ── Choosing the ZIP ──────────────────────────────────────
  // From Settings → Backups: pick a ZIP, then go straight to the review.
  async function chooseAndReview() {
    if (typeof Settings !== 'undefined' && Settings.isOpen?.()) Settings.close()
    await App.flushPendingWork?.()
    const inspection = await window.quill.chooseRestoreArchive().catch(error => ({ ok:false, error:error.message }))
    if (inspection?.canceled) return
    if (!inspection?.ok) { alert(inspection?.error || 'Quill could not verify that ZIP as a safe backup.'); return }
    if (inspection.type !== 'library') {
      alert('That ZIP holds a single project, not a whole library. To restore it, use Recovery → Restore ZIP… instead.')
      return
    }
    review(inspection.token, inspection.archiveName)
  }

  async function review(token, archiveName = '') {
    _review = null
    _copy = null
    _skip = new Set()
    _choices = {}
    _diffs = {}
    _applied = false
    open()
    setStatus('Comparing the backup with this library…')
    $('merge-review-summary').textContent = archiveName
    $('merge-review-list').innerHTML = ''
    $('merge-review-apply').disabled = true
    _busy = true
    const result = await window.quill.previewMergeArchive({ token }).catch(error => ({ ok:false, error:error.message }))
    _busy = false
    if (!result?.ok) { setStatus(result?.error || 'The backup could not be compared.', true); return }
    show(result)
  }

  function open() {
    $('merge-review-modal').classList.add('show')
    $('merge-review-apply').style.display = ''
    $('merge-review-cancel').textContent = 'Cancel'
    $('merge-review-cancel').disabled = false
  }

  function close() {
    if (_busy) return
    if (_applied) { window.location.reload(); return }
    $('merge-review-modal').classList.remove('show')
    if (_review?.token) window.quill.discardMergePreview({ token:_review.token }).catch(() => {})
    _review = null
    _copy = null
  }

  function setStatus(text, error = false) {
    const status = $('merge-review-status')
    status.textContent = text
    status.classList.toggle('error', error)
  }

  // ── The list ──────────────────────────────────────────────
  function show(result) {
    _review = result
    _skip = new Set([..._skip].filter(id => result.items.some(item => item.id === id)))
    _diffs = {}
    for (const id of Object.keys(_choices)) if (!result.items.some(item => item.id === id && item.resolve)) delete _choices[id]
    const there = result.remoteName || 'other device'
    const madeAt = new Date(result.createdAt || NaN)
    const made = isNaN(madeAt) ? '' : ` · made ${madeAt.toLocaleString([], { dateStyle:'medium', timeStyle:'short' })}`
    $('merge-review-title').textContent = `Bring in changes from the ${there}`
    $('merge-review-summary').textContent = `${result.archiveName}${made}`
    const list = $('merge-review-list')
    if (!result.items.length) {
      list.innerHTML = `<p class="merge-review-empty">Nothing to bring in. Everything on the ${esc(there)} is already here.</p>`
      setStatus('')
      $('merge-review-apply').style.display = 'none'
      $('merge-review-cancel').textContent = 'Done'
      return
    }
    list.innerHTML = groups(there).map(group => {
      const items = result.items.filter(item => item.group === group.id)
      if (!items.length) return ''
      const body = `<p class="merge-group-hint">${esc(group.hint)}</p><ul class="merge-items">${items.map(item => itemHTML(item, there)).join('')}</ul>`
      const head = `<input type="checkbox" class="merge-group-check" data-group="${group.id}" aria-label="All of ${esc(group.title)}">
        <span class="merge-group-title">${esc(group.title)}</span><span class="merge-group-count">${items.length}</span>`
      return group.collapsed
        ? `<details class="merge-group" data-group="${group.id}"><summary class="merge-group-head">${head}</summary>${body}</details>`
        : `<section class="merge-group" data-group="${group.id}"><label class="merge-group-head">${head}</label>${body}</section>`
    }).join('')
    if (result.firstMerge) {
      list.insertAdjacentHTML('afterbegin', `<p class="merge-review-note">This is the first merge between these two libraries, so Quill compared edit times. Where it couldn’t tell which side changed a scene, it’s listed under Changed on both for you to choose.</p>`)
    }
    if (result.keptHere) {
      list.insertAdjacentHTML('beforeend', `<p class="merge-review-note">${n(result.keptHere, 'file')} changed only on this ${HERE} ${result.keptHere === 1 ? 'stays' : 'stay'} as ${result.keptHere === 1 ? 'it is' : 'they are'}.</p>`)
    }
    syncChecks()
    setStatus('Nothing has changed yet. Untick anything you want to leave as it is.')
  }

  const sideName = (side, there) => side === 'here' ? `this ${HERE}` : `the ${there}`
  const newerSide = item => item.newer === 'local' ? 'here' : 'there'

  function itemHTML(item, there) {
    const words = wordsLabel(item)
    const extra = [
      item.resolve ? `<span class="merge-item-choice">${choiceLabel(item, there)}</span>` : '',
      item.group === 'both' && !item.resolve ? `adds “${esc(`${item.name} (${there} copy)`)}”` : '',
      item.fromWhere && item.fromWhere !== item.where ? `from ${esc(item.fromWhere)}` : '',
      item.fromName ? `renamed from “${esc(item.fromName)}”` : '',
      item.altName ? `also named “${esc(item.altName)}”${item.altWhere !== item.where ? ` in ${esc(item.altWhere || 'Library')}` : ''} on ${esc(sideName(item.altSide, there))}` : '',
      item.edited ? `with the ${there}’s edits` : '',
      item.companions ? 'with its notes and history' : '',
      item.op === 'combine' ? 'combined' : '',
    ].filter(Boolean).join(' · ')
    return `<li class="merge-item${item.resolve ? ' merge-item-resolve' : ''}" data-id="${esc(item.id)}">
      <label class="merge-item-main">
        <input type="checkbox" class="merge-item-check" data-id="${esc(item.id)}" ${_skip.has(item.id) ? '' : 'checked'}>
        <span class="merge-item-text">
          <span class="merge-item-name">${esc(item.name)}</span>
          <span class="merge-item-where">${esc(item.where || 'Library')}${extra ? ` · <span class="merge-item-extra">${extra}</span>` : ''}</span>
        </span>
      </label>
      ${words ? `<span class="merge-item-words">${esc(words)}</span>` : ''}
      ${item.scene ? `<button class="btn sm merge-compare${item.resolve ? ' primary' : ''}" data-id="${esc(item.id)}">${item.resolve ? 'Review' : 'Compare'}</button>` : ''}
      <div class="merge-diff" hidden></div>
    </li>`
  }

  // What a scene changed on both will become, in a few words.
  function choiceLabel(item, there) {
    const c = _choices[item.id]
    const mode = c?.mode || 'merge'
    if (mode === 'here') return `keeps this ${HERE}’s version`
    if (mode === 'there') return `takes the ${there}’s version`
    if (mode === 'both') return `keeps both, adds “${esc(`${item.name} (${there} copy)`)}”`
    const diff = _diffs[item.id]
    if (!c || !diff) return `newer: ${esc(sideName(newerSide(item), there))}`
    const picks = [...Object.values(c.hunks), ...Object.values(c.fields), ...Object.values(c.companions)]
    const fromThere = picks.filter(v => v === 'there').length, mixed = picks.filter(v => v === 'both').length
    return `${n(picks.length, 'difference')}: ${fromThere} from the ${esc(there)}${mixed ? `, ${mixed} with both` : ''}`
  }

  function wordsLabel(item) {
    const w = item.words
    if (!w) return ''
    if (w.here != null && w.there != null) {
      const delta = w.there - w.here
      if (item.group === 'both') return `${w.here.toLocaleString()} here · ${w.there.toLocaleString()} there`
      return delta === 0 ? 'same length' : `${delta > 0 ? '+' : '−'}${n(Math.abs(delta), 'word')}`
    }
    if (w.there != null) return n(w.there, 'word')
    if (w.here != null) return n(w.here, 'word')
    return ''
  }

  function syncChecks() {
    const total = _review?.items.length || 0
    const chosen = total - _skip.size
    for (const box of document.querySelectorAll('#merge-review-list .merge-group-check')) {
      const ids = _review.items.filter(item => item.group === box.dataset.group).map(item => item.id)
      const off = ids.filter(id => _skip.has(id)).length
      box.checked = off === 0
      box.indeterminate = off > 0 && off < ids.length
    }
    const apply = $('merge-review-apply')
    apply.disabled = _busy || chosen === 0
    apply.textContent = chosen === total ? 'Bring In Changes' : `Bring In ${n(chosen, 'Change')}`
  }

  // ── Compare and Review ────────────────────────────────────
  async function toggleCompare(button) {
    const row = button.closest('.merge-item')
    const box = row.querySelector('.merge-diff')
    const item = _review.items.find(entry => entry.id === row.dataset.id)
    const label = item.resolve ? 'Review' : 'Compare'
    if (!box.hidden) { box.hidden = true; button.textContent = label; return }
    button.textContent = 'Hide'
    box.hidden = false
    if (box.dataset.loaded) return
    box.innerHTML = '<div class="merge-diff-note">Loading…</div>'
    const result = await window.quill.mergePreviewDiff({ token:_review.token, id:item.id }).catch(error => ({ ok:false, error:error.message }))
    if (!result?.ok) { box.innerHTML = `<div class="merge-diff-note">${esc(result?.error || 'Could not load the two versions.')}</div>`; return }
    box.dataset.loaded = '1'
    _diffs[item.id] = result
    if (item.resolve && !_choices[item.id]) _choices[item.id] = defaultChoice(item, result)
    renderDiff(row)
  }

  function defaultChoice(item, diff) {
    const side = newerSide(item)
    return {
      mode:'merge',
      hunks:Object.fromEntries(diff.hunks.filter(h => !('same' in h)).map(h => [h.id, side])),
      fields:Object.fromEntries(diff.fields.map(f => [f.key, side])),
      companions:Object.fromEntries(diff.companions.map(c => [c.rel, side])),
      name:diff.names ? (item.altSide === 'here' ? 'there' : 'here') : null,
      tab:'text',
    }
  }

  function renderDiff(row) {
    const item = _review.items.find(entry => entry.id === row.dataset.id)
    const diff = _diffs[item.id]
    const box = row.querySelector('.merge-diff')
    box.innerHTML = item.resolve ? resolveHTML(item, diff) : compareHTML(diff)
    const label = row.querySelector('.merge-item-choice')
    if (label) label.innerHTML = choiceLabel(item, _review.remoteName || 'other device')
  }

  const legend = there => `<div class="merge-diff-note merge-legend"><del>Red</del> is only on this ${esc(HERE)} · <ins>green</ins> is only on the ${esc(there)}</div>`

  // One change, block by block: edited blocks word by word.
  const linesHTML = lines => lines.map(line => `<p>${line.map(([op, text]) =>
    op === '=' ? esc(text) : op === '-' ? `<del>${esc(text)}</del>` : `<ins>${esc(text)}</ins>`).join('')}</p>`).join('')

  // The prose, unchanged blocks folded to one either side of each change. `change(h)` draws a change.
  function textHTML(diff, change) {
    const out = []
    diff.hunks.forEach((h, k) => {
      if (!('same' in h)) { out.push(change(h)); return }
      const text = h.text || []
      const before = k > 0 ? text.slice(0, 1) : [], after = k < diff.hunks.length - 1 ? text.slice(-1) : []
      if (text.length <= 2) { out.push(...text.map(t => `<p class="merge-diff-same">${esc(t)}</p>`)); return }
      const hidden = text.length - before.length - after.length
      out.push(...before.map(t => `<p class="merge-diff-same">${esc(t)}</p>`))
      if (hidden > 0) out.push(`<div class="merge-diff-fold">${n(hidden, 'unchanged paragraph')}</div>`)
      out.push(...after.map(t => `<p class="merge-diff-same">${esc(t)}</p>`))
    })
    return out.join('')
  }

  // Read-only: a scene changed on one side only.
  function compareHTML(diff) {
    const there = _review.remoteName || 'other device'
    if (diff.here == null && diff.there == null) return '<div class="merge-diff-note">Neither version could be read.</div>'
    const changes = diff.hunks.filter(h => !('same' in h)).length
    const text = changes
      ? `${legend(there)}${textHTML(diff, h => `<div class="merge-hunk">${linesHTML(h.lines)}</div>`)}`
      : '<div class="merge-diff-note">The words are the same.</div>'
    const fields = diff.fields.length
      ? `<div class="merge-diff-section">Details</div>${diff.fields.map(f => `<div class="merge-field merge-field-static">
          <span class="merge-field-label">${esc(f.label)}</span>
          <span class="merge-field-val"><del>${esc(f.here || '—')}</del></span>
          <span class="merge-field-val"><ins>${esc(f.there || '—')}</ins></span></div>`).join('')}`
      : ''
    return text + fields
  }

  // A scene changed on both: every difference is a choice.
  function resolveHTML(item, diff) {
    const there = _review.remoteName || 'other device'
    const c = _choices[item.id]
    const picking = c.mode === 'merge'
    const modes = [['merge', 'Pick changes'], ['here', `All from this ${HERE}`], ['there', `All from the ${there}`]]
    if (diff.canKeepBoth) modes.push(['both', 'Keep both'])
    const bar = `<div class="merge-modes" role="radiogroup" aria-label="What to keep">${modes.map(([mode, label]) =>
      `<button class="merge-mode${c.mode === mode ? ' on' : ''}" role="radio" aria-checked="${c.mode === mode}" data-mode="${mode}">${esc(label)}</button>`).join('')}</div>`
    const name = diff.names ? `<div class="merge-names"><span class="merge-field-label">Name and place</span>${['here', 'there'].map(side => {
      const p = diff.names[side]
      return `<button class="merge-pick merge-name${c.name === side ? ' on' : ''}" data-name="${side}">
        <span class="merge-pick-side">${esc(side === 'here' ? `This ${HERE}` : `The ${there}`)}</span>
        <span>${esc(p.title || p.name)}</span><span class="merge-pick-where">${esc(p.where || 'Library')}</span></button>`
    }).join('')}</div>` : ''
    if (c.mode === 'both') {
      return `${bar}${name}<div class="merge-diff-note">This ${esc(HERE)}’s version stays, and the ${esc(there)}’s is added right after it as “${esc(`${item.name} (${there} copy)`)}”.</div>`
    }
    const textChanges = diff.hunks.filter(h => !('same' in h))
    const details = diff.fields.length + diff.companions.length
    const tab = c.tab === 'details' && details ? 'details' : textChanges.length || !details ? 'text' : 'details'
    const tabs = `<div class="merge-tabs" role="tablist">
      <button class="merge-tab${tab === 'text' ? ' on' : ''}" role="tab" aria-selected="${tab === 'text'}" data-tab="text">Words <span class="merge-tab-count">${textChanges.length}</span></button>
      <button class="merge-tab${tab === 'details' ? ' on' : ''}" role="tab" aria-selected="${tab === 'details'}" data-tab="details" ${details ? '' : 'disabled'}>Details <span class="merge-tab-count">${details}</span></button>
      <span class="merge-result">${resultWords(diff, c).toLocaleString()} words after</span>
    </div>`
    const pickFor = (kind, key, value, options) => `<span class="merge-picks">${options.map(([side, label]) =>
      `<button class="merge-pick-btn${value === side ? ' on' : ''}" data-kind="${kind}" data-key="${esc(String(key))}" data-side="${side}" ${picking ? '' : 'disabled'}>${esc(label)}</button>`).join('')}</span>`
    const effective = (map, key) => picking ? c[map][key] : c.mode
    let body = ''
    if (tab === 'text') {
      body = textChanges.length
        ? legend(there) + textHTML(diff, h => {
          const v = effective('hunks', h.id)
          const options = [['here', h.here ? `This ${HERE}` : 'Leave out'], ['there', h.there ? `The ${there}` : 'Leave out']]
          if (h.here && h.there) options.push(['both', 'Both'])
          return `<div class="merge-hunk merge-hunk-pick take-${v}">${linesHTML(h.lines)}${pickFor('hunks', h.id, v, options)}</div>`
        })
        : '<div class="merge-diff-note">The words are the same on both. Only the details differ.</div>'
    } else {
      const row = (kind, key, label, here, thereHTML, value) => `<div class="merge-field take-${value}">
        <span class="merge-field-label">${esc(label)}</span>
        <button class="merge-pick merge-field-val${value === 'here' ? ' on' : ''}" data-kind="${kind}" data-key="${esc(key)}" data-side="here" ${picking ? '' : 'disabled'}>
          <span class="merge-pick-side">This ${esc(HERE)}</span>${here}</button>
        <button class="merge-pick merge-field-val${value === 'there' ? ' on' : ''}" data-kind="${kind}" data-key="${esc(key)}" data-side="there" ${picking ? '' : 'disabled'}>
          <span class="merge-pick-side">The ${esc(there)}</span>${thereHTML}</button></div>`
      body = diff.fields.map(f => row('fields', f.key, f.label, `<span class="merge-val">${esc(f.here || '—')}</span>`, `<span class="merge-val">${esc(f.there || '—')}</span>`, effective('fields', f.key))).join('')
      for (const comp of diff.companions) {
        const v = effective('companions', comp.rel)
        const what = comp.lines ? `<div class="merge-comp-lines">${linesHTML(comp.lines)}</div>` : `<span class="merge-val">${esc(comp.summary)}</span>`
        body += `<div class="merge-field merge-comp take-${v}"><span class="merge-field-label">${esc(comp.label)}</span>${what}
          ${pickFor('companions', comp.rel, v, [['here', `This ${HERE}’s`], ['there', `The ${there}’s`]])}</div>`
      }
    }
    return `${bar}${name}${tabs}<div class="merge-tab-body">${body}</div>`
  }

  function resultWords(diff, c) {
    let total = 0
    for (const h of diff.hunks) {
      if ('same' in h) { total += h.words; continue }
      const v = c.mode === 'merge' ? c.hunks[h.id] : c.mode
      if (v !== 'there') total += h.hereWords
      if (v !== 'here') total += h.thereWords
    }
    return total
  }

  function onDiffClick(event) {
    const row = event.target.closest('.merge-item')
    const id = row?.dataset.id
    const c = id && _choices[id]
    if (!c) return false
    const mode = event.target.closest('.merge-mode')
    const tab = event.target.closest('.merge-tab')
    const pick = event.target.closest('[data-kind]')
    const name = event.target.closest('.merge-name')
    if (mode) c.mode = mode.dataset.mode
    else if (tab) c.tab = tab.dataset.tab
    else if (name) c.name = name.dataset.name
    else if (pick && !pick.disabled) {
      const key = pick.dataset.kind === 'hunks' ? Number(pick.dataset.key) : pick.dataset.key
      c[pick.dataset.kind][key] = pick.dataset.side
    } else return false
    event.preventDefault()
    renderDiff(row)
    return true
  }

  // What apply-merge-preview needs: only the scenes the writer opened; the rest take the newer side.
  function choicesForApply() {
    const out = {}
    for (const [id, c] of Object.entries(_choices)) out[id] = { mode:c.mode, hunks:c.hunks, fields:c.fields, companions:c.companions, name:c.name }
    return out
  }

  // ── A scene kept twice by an earlier merge ────────────────
  // The original and its "(iPad copy)" in the same diff as the review; the result goes into the
  // original and the copy goes to Trash.
  async function resolveCopy(rel) {
    if (_busy) return
    await App.flushPendingWork?.()
    const diff = await window.quill.syncCopyDiff({ rel }).catch(error => ({ ok:false, error:error.message }))
    if (!diff?.ok) { alert(diff?.error || 'Quill could not compare the two versions.'); return }
    _copy = diff
    _skip = new Set()
    _applied = false
    const item = { id:diff.original, name:diff.name, where:diff.where, scene:true, resolve:true, newer:diff.newer, altSide:'' }
    _review = { token:null, remoteName:diff.device, items:[item] }
    _diffs = { [item.id]:diff }
    _choices = { [item.id]:defaultChoice(item, diff) }
    open()
    $('merge-review-title').textContent = `Two versions of “${diff.name}”`
    $('merge-review-summary').textContent = `This ${HERE}’s version and the ${diff.device}’s, kept side by side by an earlier Bring In Changes. Pick what to keep; the result stays as “${diff.name}” and the copy goes to Trash.`
    $('merge-review-list').innerHTML = `<ul class="merge-items"><li class="merge-item merge-item-resolve merge-item-solo" data-id="${esc(item.id)}"><div class="merge-diff"></div></li></ul>`
    renderDiff($('merge-review-list').querySelector('.merge-item'))
    $('merge-review-apply').disabled = false
    $('merge-review-apply').textContent = 'Keep This Version'
    setStatus('Nothing has changed yet.')
  }

  async function applyCopy() {
    const id = _copy.original, c = _choices[id]
    _busy = true
    $('merge-review-apply').disabled = true
    $('merge-review-cancel').disabled = true
    const result = await window.quill.resolveSyncCopy({ rel:_copy.copy, choice:{ mode:c.mode, hunks:c.hunks, fields:c.fields } })
      .catch(error => ({ ok:false, error:error.message }))
    _busy = false
    $('merge-review-cancel').disabled = false
    if (!result?.ok) { setStatus(result?.error || 'Nothing was changed.', true); $('merge-review-apply').disabled = false; return }
    _applied = true
    $('merge-review-list').innerHTML = ''
    setStatus(`Saved as “${_copy.name}”. The ${_copy.device}’s copy is in Trash, and it doesn’t count as words cut. Quill reloads when you tap Done.`)
    $('merge-review-apply').style.display = 'none'
    $('merge-review-cancel').textContent = 'Done'
  }

  // ── Applying ──────────────────────────────────────────────
  async function apply() {
    if (_copy && !_busy) return applyCopy()
    if (!_review || _busy) return
    _busy = true
    $('merge-review-apply').disabled = true
    $('merge-review-cancel').disabled = true
    setStatus('Saving a safety backup of this library, then bringing in the changes…')
    const result = await window.quill.applyMergePreview({ token:_review.token, skip:[..._skip], choices:choicesForApply() })
      .catch(error => ({ ok:false, error:error.message }))
    _busy = false
    $('merge-review-cancel').disabled = false
    if (result?.stale && result.review) {
      show(result.review)
      setStatus(result.error, true)
      return
    }
    if (!result?.ok) { setStatus(result?.error || 'The merge failed. Nothing in your library was changed.', true); syncChecks(); return }
    finish(result)
    if (_applied) await backUpMergedLibrary()
  }

  // On the Mac, the library now holds the other device's work, so the cloud backup is saved again
  // right away and the dashboard's backup age starts over. The iPad saves its ZIP through Save to
  // Files, which needs the writer, so it is left to them there.
  async function backUpMergedLibrary() {
    const config = await window.quill.getCloudBackupSettings?.().catch(() => null)
    if (!config || config.web || !config.configured || !config.folderAvailable) return
    const summary = $('merge-review-status')?.textContent || ''
    _busy = true
    $('merge-review-cancel').disabled = true
    setStatus(`${summary} Saving a fresh cloud backup…`)
    const backup = await window.quill.backupCloudLibrary().catch(error => ({ ok:false, error:error.message }))
    _busy = false
    $('merge-review-cancel').disabled = false
    if (backup?.ok) window.dispatchEvent(new CustomEvent('quill-cloud-backup-status', { detail:backup }))
    setStatus(backup?.ok ? `${summary} Cloud backup saved.` : `${summary} The cloud backup failed: ${backup?.error || 'unknown error'}.`, !backup?.ok)
  }

  function finish(result) {
    const s = result.summary
    const there = result.remoteName || 'other device'
    const resolved = s.resolved?.length || 0
    const parts = [
      s.moved?.length ? `${n(s.moved.length, 'scene')} moved to match the ${there}` : '',
      s.taken.length + s.restored.length ? `${n(s.taken.length + s.restored.length, 'file')} brought in from the ${there}` : '',
      resolved ? `${n(resolved, 'scene')} put together from both versions` : '',
      s.copies.length ? `${n(s.copies.length, 'scene')} kept in both versions` : '',
      s.combined.length ? `${n(s.combined.length, 'settings file')} combined` : '',
      s.trashed.length ? `${n(s.trashed.length, 'file')} moved to Trash` : '',
      result.skipped ? `${n(result.skipped, 'item')} left as ${result.skipped === 1 ? 'it was' : 'they were'} (offered again next time)` : '',
    ].filter(Boolean)
    _applied = s.taken.length + s.restored.length + s.copies.length + s.combined.length + s.trashed.length + (s.moved?.length || 0) + resolved > 0
    const items = new Map((_review?.items || []).map(item => [item.id, item]))
    _review = null
    $('merge-review-list').innerHTML = s.copies.length
      ? `<p class="merge-review-note">Kept in both versions. Each copy sits right after its original, with a “2 versions” badge in the sidebar:</p><ul class="archive-restore-copies">${
        s.copies.map(c => {
          const item = items.get(c.rel)
          const name = item?.name || c.rel.split('/').pop().replace(/\.md$/, '')
          return `<li>${esc(name)} <span class="muted">and</span> ${esc(`${name} (${there} copy)`)}${item?.where ? ` <span class="muted">· ${esc(item.where)}</span>` : ''}</li>`
        }).join('')}</ul>`
      : ''
    setStatus(`${parts.join(' · ') || 'Nothing was changed'}.${_applied ? ' Quill reloads when you tap Done.' : ''}`)
    $('merge-review-apply').style.display = 'none'
    $('merge-review-cancel').textContent = 'Done'
  }

  // ── Wiring ────────────────────────────────────────────────
  function init() {
    $('merge-review-cancel')?.addEventListener('click', close)
    $('merge-review-apply')?.addEventListener('click', apply)
    $('merge-review-modal')?.addEventListener('click', event => { if (event.target.id === 'merge-review-modal') close() })
    $('merge-review-list')?.addEventListener('click', event => {
      const compare = event.target.closest('.merge-compare')
      if (compare) { event.preventDefault(); toggleCompare(compare); return }
      if (event.target.closest('.merge-diff')) onDiffClick(event)
    })
    $('merge-review-list')?.addEventListener('change', event => {
      const box = event.target
      if (box.classList.contains('merge-item-check')) {
        if (box.checked) _skip.delete(box.dataset.id); else _skip.add(box.dataset.id)
      } else if (box.classList.contains('merge-group-check')) {
        for (const item of _review.items.filter(entry => entry.group === box.dataset.group)) {
          if (box.checked) _skip.delete(item.id); else _skip.add(item.id)
        }
        for (const check of box.closest('.merge-group').querySelectorAll('.merge-item-check')) check.checked = box.checked
      } else return
      syncChecks()
    })
    // A click on the group checkbox inside <summary> ticks it without opening the group.
    $('merge-review-list')?.addEventListener('click', event => {
      if (event.target.classList?.contains('merge-group-check') && event.target.closest('summary')) event.stopPropagation()
    }, true)
    $('settings-bring-in')?.addEventListener('click', chooseAndReview)
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init)
  else init()

  return { chooseAndReview, review, resolveCopy }
})()
