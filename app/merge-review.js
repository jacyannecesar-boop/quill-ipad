/* merge-review.js — Bring In Changes: review what a backup from the other device would change,
 * untick anything that should stay as it is, then apply the rest.
 *
 * main.js compares the ZIP with this library (preview-merge-archive) without changing anything;
 * Compare shows both versions of a scene (merge-preview-diff); apply-merge-preview applies the
 * ticked items. An unticked item is offered again by the next merge.
 */
const MergeReview = (() => {
  const HERE = document.documentElement.classList.contains('quill-web') ? (window.__quillWeb?.deviceName || 'iPad') : 'Mac'
  let _review = null
  let _skip = new Set()
  let _busy = false
  let _applied = false

  const $ = id => document.getElementById(id)
  const esc = text => escapeHtml(text)
  const n = (count, one, many = `${one}s`) => `${count.toLocaleString()} ${count === 1 ? one : many}`

  function groups(there) {
    return [
      { id:'edited', title:`Edited on the ${there}`, hint:`Replaces the version on this ${HERE}.` },
      { id:'moved', title:`Moved or renamed on the ${there}`, hint:`Moves here too, with its notes, history and time. Any edits made on the ${there} come with it.` },
      { id:'new', title:`New on the ${there}`, hint:'Added here.' },
      { id:'restored', title:`Deleted on this ${HERE}, edited on the ${there}`, hint:`Comes back, with the ${there}’s edits.` },
      { id:'both', title:'Edited on both', hint:`This ${HERE}’s version stays. The ${there}’s is added right after it as a copy, so you can compare and keep what you want.` },
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
    _skip = new Set()
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
    if (_review) window.quill.discardMergePreview({ token:_review.token }).catch(() => {})
    _review = null
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
      list.insertAdjacentHTML('afterbegin', `<p class="merge-review-note">This is the first merge between these two libraries, so Quill compared edit times. Where it couldn’t tell which side changed a scene, it keeps both versions.</p>`)
    }
    if (result.keptHere) {
      list.insertAdjacentHTML('beforeend', `<p class="merge-review-note">${n(result.keptHere, 'file')} changed only on this ${HERE} ${result.keptHere === 1 ? 'stays' : 'stay'} as ${result.keptHere === 1 ? 'it is' : 'they are'}.</p>`)
    }
    syncChecks()
    setStatus('Nothing has changed yet. Untick anything you want to leave as it is.')
  }

  function itemHTML(item, there) {
    const words = wordsLabel(item)
    const extra = [
      item.group === 'both' ? `adds “${esc(`${item.name} (${there} copy)`)}”` : '',
      item.fromWhere && item.fromWhere !== item.where ? `from ${esc(item.fromWhere)}` : '',
      item.fromName ? `renamed from “${esc(item.fromName)}”` : '',
      item.edited ? `with the ${there}’s edits` : '',
      item.companions ? 'with its notes and history' : '',
      item.op === 'combine' ? 'combined' : '',
    ].filter(Boolean).join(' · ')
    return `<li class="merge-item" data-id="${esc(item.id)}">
      <label class="merge-item-main">
        <input type="checkbox" class="merge-item-check" data-id="${esc(item.id)}" ${_skip.has(item.id) ? '' : 'checked'}>
        <span class="merge-item-text">
          <span class="merge-item-name">${esc(item.name)}</span>
          <span class="merge-item-where">${esc(item.where || 'Library')}${extra ? ` · ${extra}` : ''}</span>
        </span>
      </label>
      ${words ? `<span class="merge-item-words">${esc(words)}</span>` : ''}
      ${item.scene ? `<button class="btn sm merge-compare" data-id="${esc(item.id)}">Compare</button>` : ''}
      <div class="merge-diff" hidden></div>
    </li>`
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

  // ── Compare ───────────────────────────────────────────────
  async function toggleCompare(button) {
    const row = button.closest('.merge-item')
    const box = row.querySelector('.merge-diff')
    if (!box.hidden) { box.hidden = true; button.textContent = 'Compare'; return }
    button.textContent = 'Hide'
    box.hidden = false
    if (box.dataset.loaded) return
    box.innerHTML = '<div class="merge-diff-note">Loading…</div>'
    const item = _review.items.find(entry => entry.id === row.dataset.id)
    const result = await window.quill.mergePreviewDiff({ token:_review.token, id:item.id }).catch(error => ({ ok:false, error:error.message }))
    if (!result?.ok) { box.innerHTML = `<div class="merge-diff-note">${esc(result?.error || 'Could not load the two versions.')}</div>`; return }
    box.dataset.loaded = '1'
    box.innerHTML = diffHTML(result.here, result.there, _review.remoteName)
  }

  const paragraphs = text => String(text || '').split(/\n/).map(line => line.trim()).filter(Boolean)

  // Longest common subsequence over two lists; returns [op, a, b] runs: '=' both, '-' only in a, '+' only in b.
  function diffLists(a, b) {
    const rows = a.length + 1, cols = b.length + 1
    if (rows * cols > 6_000_000) return [...a.map(x => ['-', x]), ...b.map(x => ['+', x])]
    const table = Array.from({ length:rows }, () => new Uint32Array(cols))
    for (let i = a.length - 1; i >= 0; i--) {
      for (let j = b.length - 1; j >= 0; j--) {
        table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1])
      }
    }
    const out = []
    let i = 0, j = 0
    while (i < a.length && j < b.length) {
      if (a[i] === b[j]) { out.push(['=', a[i]]); i++; j++ }
      else if (table[i + 1][j] >= table[i][j + 1]) out.push(['-', a[i++]])
      else out.push(['+', b[j++]])
    }
    while (i < a.length) out.push(['-', a[i++]])
    while (j < b.length) out.push(['+', b[j++]])
    return out
  }

  // One edited paragraph, word by word.
  function wordDiffHTML(before, after) {
    const ops = diffLists(before.split(/(\s+)/), after.split(/(\s+)/))
    return ops.map(([op, word]) => op === '=' ? esc(word)
      : op === '-' ? `<del>${esc(word)}</del>` : `<ins>${esc(word)}</ins>`).join('')
  }

  function diffHTML(here, there, thereName) {
    if (here == null && there == null) return '<div class="merge-diff-note">Neither version could be read.</div>'
    if (here == null || there == null) {
      const text = paragraphs(here ?? there)
      const label = here == null ? `The ${thereName}’s version` : `This ${HERE}’s version`
      return `<div class="merge-diff-note">${esc(label)}:</div>${text.slice(0, 60).map(p => `<p>${esc(p)}</p>`).join('')}${text.length > 60 ? `<div class="merge-diff-note">… ${n(text.length - 60, 'more paragraph')}</div>` : ''}`
    }
    const ops = diffLists(paragraphs(here), paragraphs(there))
    if (!ops.some(([op]) => op !== '=')) return '<div class="merge-diff-note">The text is the same; only details like the title, status or notes differ.</div>'
    // Each run of removed paragraphs followed by added ones reads as edits, paired in order.
    const blocks = []
    for (let k = 0; k < ops.length;) {
      if (ops[k][0] === '=') { blocks.push({ same:ops[k][1] }); k++; continue }
      const gone = [], added = []
      while (k < ops.length && ops[k][0] === '-') gone.push(ops[k++][1])
      while (k < ops.length && ops[k][0] === '+') added.push(ops[k++][1])
      while (k < ops.length && ops[k][0] === '-') gone.push(ops[k++][1])
      const pairs = Math.min(gone.length, added.length)
      for (let p = 0; p < pairs; p++) blocks.push({ html:wordDiffHTML(gone[p], added[p]), kind:'edit' })
      for (const p of gone.slice(pairs)) blocks.push({ html:`<del>${esc(p)}</del>`, kind:'gone' })
      for (const p of added.slice(pairs)) blocks.push({ html:`<ins>${esc(p)}</ins>`, kind:'added' })
    }
    // Unchanged paragraphs fold away, keeping one either side of each change for context.
    const keep = blocks.map((b, k) => !b.same || !!blocks[k - 1]?.html || !!blocks[k + 1]?.html)
    let html = `<div class="merge-diff-note"><del>Struck</del> is only on this ${HERE}; <ins>underlined</ins> is only on the ${esc(thereName)}.</div>`
    let folded = 0
    blocks.forEach((b, k) => {
      if (!keep[k]) { folded++; return }
      if (folded) { html += `<div class="merge-diff-fold">${n(folded, 'unchanged paragraph')}</div>`; folded = 0 }
      html += b.same ? `<p class="merge-diff-same">${esc(b.same)}</p>` : `<p class="merge-diff-${b.kind}">${b.html}</p>`
    })
    if (folded) html += `<div class="merge-diff-fold">${n(folded, 'unchanged paragraph')}</div>`
    return html
  }

  // ── Applying ──────────────────────────────────────────────
  async function apply() {
    if (!_review || _busy) return
    _busy = true
    $('merge-review-apply').disabled = true
    $('merge-review-cancel').disabled = true
    setStatus('Saving a safety backup of this library, then bringing in the changes…')
    const result = await window.quill.applyMergePreview({ token:_review.token, skip:[..._skip] })
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
    const parts = [
      s.moved?.length ? `${n(s.moved.length, 'scene')} moved to match the ${there}` : '',
      s.taken.length + s.restored.length ? `${n(s.taken.length + s.restored.length, 'file')} brought in from the ${there}` : '',
      s.copies.length ? `${n(s.copies.length, 'scene')} kept in both versions` : '',
      s.combined.length ? `${n(s.combined.length, 'settings file')} combined` : '',
      s.trashed.length ? `${n(s.trashed.length, 'file')} moved to Trash` : '',
      result.skipped ? `${n(result.skipped, 'item')} left as ${result.skipped === 1 ? 'it was' : 'they were'} (offered again next time)` : '',
    ].filter(Boolean)
    _applied = s.taken.length + s.restored.length + s.copies.length + s.combined.length + s.trashed.length + (s.moved?.length || 0) > 0
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
      if (compare) { event.preventDefault(); toggleCompare(compare) }
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

  return { chooseAndReview, review, diffHTML }
})()
