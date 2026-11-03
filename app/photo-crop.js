/* photo-crop.js — non-destructive crop for character photos (and any square thumbnail).
 *
 * A crop is { x, y, zoom }: x and y are the focal point as fractions of the image (0–1), zoom
 * is ≥ 1 over "just covers the frame". The original file is never changed. Because every frame
 * Quill draws a photo in is square, one crop renders the same in the 36px grid circle, the
 * 160px sheet square and the cropper stage. x and y are clamped so the image always covers.
 */
window.QuillPhoto = (() => {
  const MAX_ZOOM = 3

  function normalize(crop) {
    const zoom = Math.min(MAX_ZOOM, Math.max(1, Number(crop?.zoom) || 1))
    const x = Number.isFinite(Number(crop?.x)) ? Number(crop.x) : 0.5
    const y = Number.isFinite(Number(crop?.y)) ? Number(crop.y) : 0.5
    return { x, y, zoom }
  }

  // Geometry for a square frame of side S. Clamping depends only on aspect and zoom, so a crop
  // clamped once holds at every frame size.
  function layout(naturalW, naturalH, S, crop) {
    const { zoom } = normalize(crop)
    const scale = Math.max(S / naturalW, S / naturalH) * zoom
    const W = naturalW * scale, H = naturalH * scale
    const half = v => Math.min(0.5, S / (2 * v))
    const clamp = (v, h) => Math.min(1 - h, Math.max(h, v))
    const x = clamp(normalize(crop).x, half(W))
    const y = clamp(normalize(crop).y, half(H))
    return { W, H, left: S / 2 - x * W, top: S / 2 - y * H, crop: { x, y, zoom } }
  }

  // Frames that change size (responsive grid tiles) re-place their image.
  const _resize = typeof ResizeObserver === 'function'
    ? new ResizeObserver(entries => entries.forEach(e => e.target.querySelectorAll(':scope > img').forEach(img => img._quillPlace?.())))
    : null

  /** Position an <img> inside its square, overflow-hidden parent according to a crop. */
  function apply(img, crop) {
    if (!img) return
    const place = () => {
      const frame = img.parentElement
      const S = frame?.clientWidth
      if (!S || !img.naturalWidth) return
      const g = layout(img.naturalWidth, img.naturalHeight, S, crop)
      Object.assign(img.style, {
        position: 'absolute', maxWidth: 'none', objectFit: 'fill',
        width: g.W + 'px', height: g.H + 'px', left: g.left + 'px', top: g.top + 'px',
      })
    }
    // The frame must anchor the image. A card still being built isn't in the page yet, so its
    // computed position is '' rather than 'static'; anchor anything not already positioned.
    const framePos = getComputedStyle(img.parentElement).position
    if (framePos !== 'absolute' && framePos !== 'fixed' && framePos !== 'sticky') img.parentElement.style.position = 'relative'
    img._quillPlace = place
    _resize?.observe(img.parentElement)
    if (img.complete && img.naturalWidth) place()
    else img.addEventListener('load', place, { once: true })
  }

  /**
   * Open the cropper. Resolves to the chosen crop, or null when cancelled.
   * shapes: which previews to show beside the stage, e.g. ['square', 'circle'].
   */
  function open({ src, crop, title = 'Adjust photo', shapes = ['square', 'circle'] }) {
    return new Promise(resolve => {
      let state = normalize(crop)
      const STAGE = 300
      document.getElementById('photo-crop-overlay')?.remove()
      const overlay = document.createElement('div')
      overlay.id = 'photo-crop-overlay'
      overlay.className = 'overlay show'
      overlay.innerHTML = `
        <div class="modal photo-crop-modal" role="dialog" aria-modal="true" aria-labelledby="photo-crop-title">
          <h3 id="photo-crop-title">${escapeHtml(title)}</h3>
          <p class="photo-crop-hint">Drag to reposition. Scroll or use the slider to zoom. Arrow keys nudge.</p>
          <div class="photo-crop-body">
            <div class="photo-crop-stage" tabindex="0" role="img" aria-label="Crop area — arrow keys move, plus and minus zoom" style="width:${STAGE}px;height:${STAGE}px">
              <img alt="" draggable="false">
              <div class="photo-crop-guide"></div>
            </div>
            <div class="photo-crop-previews">
              ${shapes.includes('square') ? '<div class="photo-crop-preview square"><img alt=""></div><span>Sheet</span>' : ''}
              ${shapes.includes('circle') ? '<div class="photo-crop-preview circle"><img alt=""></div><span>Lists</span>' : ''}
            </div>
          </div>
          <label class="photo-crop-zoom">
            <span aria-hidden="true">−</span>
            <input type="range" min="1" max="${MAX_ZOOM}" step="0.01" aria-label="Zoom">
            <span aria-hidden="true">+</span>
          </label>
          <div class="modal-btns">
            <button class="btn" type="button" data-act="reset">Reset</button>
            <span style="flex:1"></span>
            <button class="btn" type="button" data-act="cancel">Cancel</button>
            <button class="btn primary" type="button" data-act="save">Save</button>
          </div>
        </div>`
      document.body.appendChild(overlay)
      const stage = overlay.querySelector('.photo-crop-stage')
      const stageImg = stage.querySelector('img')
      const previews = [...overlay.querySelectorAll('.photo-crop-preview img')]
      const slider = overlay.querySelector('input[type=range]')
      const previous = document.activeElement

      const render = () => {
        if (!stageImg.naturalWidth) return
        state = layout(stageImg.naturalWidth, stageImg.naturalHeight, STAGE, state).crop
        apply(stageImg, state)
        previews.forEach(img => apply(img, state))
        slider.value = String(state.zoom)
      }
      ;[stageImg, ...previews].forEach(img => { img.src = src })
      stageImg.addEventListener('load', render, { once: true })

      const displayed = () => layout(stageImg.naturalWidth, stageImg.naturalHeight, STAGE, state)
      const pan = (dx, dy) => {
        const g = displayed()
        state = { ...state, x: state.x - dx / g.W, y: state.y - dy / g.H }
        render()
      }
      const zoomTo = z => { state = { ...state, zoom: Math.min(MAX_ZOOM, Math.max(1, z)) }; render() }

      let drag = null
      stage.addEventListener('pointerdown', e => {
        drag = { x: e.clientX, y: e.clientY }
        try { stage.setPointerCapture(e.pointerId) } catch {}
        stage.classList.add('dragging')
      })
      stage.addEventListener('pointermove', e => {
        if (!drag) return
        pan(e.clientX - drag.x, e.clientY - drag.y)
        drag = { x: e.clientX, y: e.clientY }
      })
      const endDrag = () => { drag = null; stage.classList.remove('dragging') }
      stage.addEventListener('pointerup', endDrag)
      stage.addEventListener('pointercancel', endDrag)
      stage.addEventListener('wheel', e => { e.preventDefault(); zoomTo(state.zoom * (e.deltaY < 0 ? 1.06 : 1 / 1.06)) }, { passive: false })
      slider.addEventListener('input', () => zoomTo(Number(slider.value)))

      const finish = result => {
        overlay.remove()
        previous?.focus?.()
        resolve(result)
      }
      overlay.addEventListener('click', e => {
        const act = e.target.closest('[data-act]')?.dataset.act
        if (act === 'reset') { state = { x: 0.5, y: 0.5, zoom: 1 }; render() }
        if (act === 'cancel' || e.target === overlay) finish(null)
        if (act === 'save') finish({ x: +state.x.toFixed(4), y: +state.y.toFixed(4), zoom: +state.zoom.toFixed(3) })
      })
      overlay.addEventListener('keydown', e => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(null); return }
        if (e.key === 'Tab') {
          const items = [...overlay.querySelectorAll('button, input, [tabindex="0"]')]
          const first = items[0], last = items[items.length - 1]
          if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
          else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
          return
        }
        if (document.activeElement !== stage) return
        const step = 6
        // Arrows move the picture the way they point, like dragging it.
        if (e.key === 'ArrowLeft')  { e.preventDefault(); pan(-step, 0) }
        if (e.key === 'ArrowRight') { e.preventDefault(); pan(step, 0) }
        if (e.key === 'ArrowUp')    { e.preventDefault(); pan(0, -step) }
        if (e.key === 'ArrowDown')  { e.preventDefault(); pan(0, step) }
        if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomTo(state.zoom + 0.1) }
        if (e.key === '-') { e.preventDefault(); zoomTo(state.zoom - 0.1) }
      })
      stage.focus()
    })
  }

  return { open, apply, layout, normalize }
})()
