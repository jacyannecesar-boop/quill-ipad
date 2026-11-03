/* escape.js — the one HTML escaper every renderer template uses.
 * Quotes are escaped too, so the result is safe inside attribute values as well as element
 * text. Several files once kept their own copy without quote escaping, which let text like
 * `x" onfocus="…` from an AI reply break out of a value="…" attribute.
 */
window.escapeHtml = function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

// Rich text Quill stores as HTML (idea scratchpads, fragments) goes back through innerHTML.
// Keep only the formatting the toolbar can produce and drop every attribute, so a stored or
// imported ideas.json can't carry an <img onerror> or <script> into the page. DOMParser
// builds an inert document, so nothing in the input runs or loads while it is inspected.
const RICH_TAGS = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE', 'BR', 'P', 'DIV',
  'SPAN', 'UL', 'OL', 'LI', 'H1', 'H2', 'H3', 'BLOCKQUOTE'])
// Unwrapping these would turn their source into visible text, so they go entirely.
const DROP_TAGS = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'IFRAME', 'OBJECT', 'SVG', 'MATH'])

window.sanitizeRichHtml = function sanitizeRichHtml(html) {
  const doc = new DOMParser().parseFromString(`<body>${html || ''}</body>`, 'text/html')
  const clean = node => {
    for (const child of [...node.childNodes]) {
      if (child.nodeType === Node.TEXT_NODE) continue
      if (child.nodeType !== Node.ELEMENT_NODE || DROP_TAGS.has(child.tagName.toUpperCase())) { child.remove(); continue }
      clean(child)
      if (!RICH_TAGS.has(child.tagName)) { child.replaceWith(...child.childNodes); continue }
      for (const attr of [...child.attributes]) child.removeAttribute(attr.name)
    }
  }
  clean(doc.body)
  return doc.body.innerHTML
}
