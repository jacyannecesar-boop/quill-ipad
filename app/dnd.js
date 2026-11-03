/* dnd.js — one way to reorder things by dragging, used by every list in Quill.
 *
 *   Dnd.sortable(container, { items, type, onMove, handle, axis, endTarget })
 *
 * - The drop lands before or after the target depending on which half the pointer is in, and
 *   a single accent line shows where (dnd-before / dnd-after).
 * - Each list has a payload type (application/x-quill-<type>); a list ignores other drags,
 *   so nothing shows a "move" cursor where a drop would do nothing.
 * - handle: when an item has text you can edit, drags start only from its ⠿ handle.
 * - Keyboard: Alt+↑/↓ (Alt+←/→ for rows) moves the focused item by one.
 * - onMove(from, to) gets the item's old index and its index after the move.
 */
window.Dnd = (() => {
  let _drag = null   // { container, type, from }
  let _refocus = null

  const mime = type => 'application/x-quill-' + type

  function clearMarks(root = document) {
    root.querySelectorAll('.dnd-before, .dnd-after').forEach(el => el.classList.remove('dnd-before', 'dnd-after'))
  }

  /** Where `from` ends up when dropped before (after=false) or after target index `at`. */
  function finalIndex(from, at, after) {
    const insert = at + (after ? 1 : 0)
    return insert > from ? insert - 1 : insert
  }

  /** Move one element of an array in place; returns the array. */
  function move(list, from, to) {
    const [item] = list.splice(from, 1)
    list.splice(to, 0, item)
    return list
  }

  function sortable(container, { items, type, onMove, handle = null, axis = 'y', endTarget = null }) {
    if (!container) return
    const els = [...container.querySelectorAll(items)]
    const horizontal = axis === 'x'

    const afterPointer = (el, e) => {
      const r = el.getBoundingClientRect()
      return horizontal ? e.clientX > r.left + r.width / 2 : e.clientY > r.top + r.height / 2
    }
    const accepts = e => _drag && _drag.container === container && [...(e.dataTransfer?.types || [])].includes(mime(type))

    els.forEach((el, index) => {
      el.dataset.dndIndex = String(index)
      el.classList.add('dnd-item', horizontal ? 'dnd-x' : 'dnd-y')
      if (el.tabIndex < 0) el.tabIndex = 0

      if (handle) {
        const h = el.querySelector(handle)
        el.draggable = false
        if (h) {
          h.addEventListener('mousedown', () => { el.draggable = true })
          h.addEventListener('mouseup', () => { el.draggable = false })
        }
      } else {
        el.draggable = true
      }

      el.addEventListener('dragstart', e => {
        if (e.target !== el) return
        _drag = { container, type, from: index }
        e.dataTransfer.effectAllowed = 'move'
        try { e.dataTransfer.setData(mime(type), String(index)) } catch {}
        setTimeout(() => el.classList.add('dnd-dragging'), 0)
      })
      el.addEventListener('dragend', () => {
        el.classList.remove('dnd-dragging')
        if (handle) el.draggable = false
        clearMarks(container)
        endTarget?.classList.remove('dnd-end')
        _drag = null
      })
      el.addEventListener('dragover', e => {
        if (!accepts(e) || _drag.from === index) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        const after = afterPointer(el, e)
        if (el.classList.contains(after ? 'dnd-after' : 'dnd-before')) return
        clearMarks(container)
        el.classList.add(after ? 'dnd-after' : 'dnd-before')
      })
      el.addEventListener('dragleave', e => {
        if (!el.contains(e.relatedTarget)) el.classList.remove('dnd-before', 'dnd-after')
      })
      el.addEventListener('drop', e => {
        if (!accepts(e)) return
        e.preventDefault()
        e.stopPropagation()
        const from = _drag.from
        const to = finalIndex(from, index, afterPointer(el, e))
        clearMarks(container)
        _drag = null
        if (to !== from) onMove(from, to)
      })

      el.addEventListener('keydown', e => {
        if (!e.altKey || e.target !== el) return
        const back = horizontal ? 'ArrowLeft' : 'ArrowUp'
        const fwd  = horizontal ? 'ArrowRight' : 'ArrowDown'
        if (e.key !== back && e.key !== fwd) return
        const to = index + (e.key === fwd ? 1 : -1)
        if (to < 0 || to >= els.length) return
        e.preventDefault()
        _refocus = { container, index: to }
        onMove(index, to)
      })
    })

    // A drop on the "add" tile or the empty end of the list puts the item last.
    if (endTarget) {
      // Properties, not listeners: the tile can outlive a re-render and must not stack handlers.
      endTarget.ondragover = e => {
        if (!accepts(e)) return
        e.preventDefault()
        endTarget.classList.add('dnd-end')
      }
      endTarget.ondragleave = () => endTarget.classList.remove('dnd-end')
      endTarget.ondrop = e => {
        if (!accepts(e)) return
        e.preventDefault()
        endTarget.classList.remove('dnd-end')
        const from = _drag.from
        _drag = null
        if (from !== els.length - 1) onMove(from, els.length - 1)
      }
    }

    // After a keyboard move the list re-renders; keep focus on the item that moved.
    if (_refocus?.container === container) {
      els[_refocus.index]?.focus()
      _refocus = null
    }
  }

  // A short-lived "Undo" after a move that changed files on disk. Shares the revision-note
  // toast's element and styling.
  let _toastTimer = null
  function undoToast(message, undo) {
    let node = document.getElementById('rv-toast')
    if (!node) {
      node = document.createElement('div')
      node.id = 'rv-toast'
      node.setAttribute('role', 'status')
      document.body.appendChild(node)
    }
    node.innerHTML = `<span>${escapeHtml(message)}</span>`
    if (undo) {
      const button = document.createElement('button')
      button.type = 'button'
      button.textContent = 'Undo'
      button.onclick = () => { node.classList.remove('show'); undo() }
      node.appendChild(button)
    }
    node.classList.add('show')
    clearTimeout(_toastTimer)
    _toastTimer = setTimeout(() => node.classList.remove('show'), 8000)
  }

  return { sortable, move, finalIndex, mime, undoToast }
})()
