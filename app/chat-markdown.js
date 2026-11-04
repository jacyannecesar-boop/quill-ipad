/* Markdown in AI replies (Brainstorm), rendered the way chat models write it: CommonMark-style
 * paragraphs, # to ###### headings, - * + and 1. lists nested by indent, > quotes, ``` code,
 * tables, --- rules, **bold** *italic* ~~strike~~ `code`. Everything is escaped first, so a reply
 * can't inject markup. Links show their text with the address on hover; they don't navigate,
 * since Quill's window never opens pages. Not Quill's manuscript dialect (editor/markdown/FORMAT.md),
 * which treats every line as its own block. Works on a half-streamed reply: an unclosed fence
 * renders as code so far. */
(function exposeChatMarkdown(root) {
  const esc = text => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

  function inline(text) {
    const codes = []
    let h = esc(text).replace(/`([^`\n]+)`/g, (_, code) => `\u0000${codes.push(code) - 1}\u0000`)
    h = h
      .replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, '<span class="cmd-link" title="$2">$1</span>')
      .replace(/\*\*\*(?=\S)(.+?)(?<=\S)\*\*\*/g, '<strong><em>$1</em></strong>')
      .replace(/(\*\*|__)(?=\S)(.+?)(?<=\S)\1/g, '<strong>$2</strong>')
      .replace(/(?<![\w*])\*(?=[^\s*])(.+?)(?<=[^\s*])\*(?![\w*])/g, '<em>$1</em>')
      .replace(/(?<!\w)_(?=\S)(.+?)(?<=\S)_(?!\w)/g, '<em>$1</em>')
      .replace(/~~(?=\S)(.+?)(?<=\S)~~/g, '<del>$1</del>')
    return h.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[i]}</code>`)
  }

  const LIST = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/
  const RULE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/
  const FENCE = /^\s{0,3}(```|~~~)/
  const TABLE_SEP = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/
  const cells = line => line.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim())
  const width = s => s.replace(/\t/g, '    ').length

  // A list starting at lines[i]; items nest when indented past their parent's marker.
  function list(lines, i, indent) {
    const ordered = /\d/.test(lines[i].match(LIST)[2])
    const start = ordered ? parseInt(lines[i].match(LIST)[2], 10) : 1
    const items = []
    while (i < lines.length) {
      const m = lines[i].match(LIST)
      if (!m || width(m[1]) < indent) break
      if (width(m[1]) > indent) {   // a nested list belongs to the item above
        const [html, next] = list(lines, i, width(m[1]))
        if (items.length) items[items.length - 1] += html
        else items.push(html)
        i = next
        continue
      }
      if (/\d/.test(m[2]) !== ordered) break
      let body = m[3]
      i++
      // continuation lines: indented text, not a new marker
      while (i < lines.length && lines[i].trim() && !LIST.test(lines[i]) && /^\s+/.test(lines[i])) body += '\n' + lines[i++].trim()
      items.push(inline(body).replace(/\n/g, '<br>'))
      // a blank line between items stays inside the list
      if (i < lines.length && !lines[i].trim() && i + 1 < lines.length && LIST.test(lines[i + 1]) && width(lines[i + 1].match(LIST)[1]) >= indent) i++
    }
    const tag = ordered ? 'ol' : 'ul'
    const attr = ordered && start !== 1 ? ` start="${start}"` : ''
    return [`<${tag}${attr}>${items.map(item => `<li>${item}</li>`).join('')}</${tag}>`, i]
  }

  function blocks(lines) {
    const out = []
    let i = 0
    while (i < lines.length) {
      const line = lines[i]
      if (!line.trim()) { i++; continue }
      const fence = line.match(FENCE)
      if (fence) {
        const code = []
        i++
        while (i < lines.length && !lines[i].trim().startsWith(fence[1])) code.push(lines[i++])
        i++
        out.push(`<pre><code>${esc(code.join('\n'))}</code></pre>`)
        continue
      }
      const heading = line.match(/^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/)
      if (heading) { out.push(`<h${heading[1].length}>${inline(heading[2])}</h${heading[1].length}>`); i++; continue }
      if (RULE.test(line)) { out.push('<hr>'); i++; continue }
      if (/^\s{0,3}>/.test(line)) {
        const quoted = []
        while (i < lines.length && /^\s{0,3}>/.test(lines[i])) quoted.push(lines[i++].replace(/^\s{0,3}>\s?/, ''))
        out.push(`<blockquote>${blocks(quoted)}</blockquote>`)
        continue
      }
      if (LIST.test(line)) {
        const [html, next] = list(lines, i, width(line.match(LIST)[1]))
        out.push(html)
        i = next
        continue
      }
      if (line.includes('|') && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1]) && lines[i + 1].includes('-')) {
        const head = cells(line)
        i += 2
        const rows = []
        while (i < lines.length && lines[i].includes('|') && lines[i].trim()) rows.push(cells(lines[i++]))
        out.push(`<div class="cmd-table"><table><thead><tr>${head.map(c => `<th>${inline(c)}</th>`).join('')}</tr></thead>`
          + `<tbody>${rows.map(r => `<tr>${head.map((_, k) => `<td>${inline(r[k] || '')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`)
        continue
      }
      const para = []
      while (i < lines.length && lines[i].trim() && !FENCE.test(lines[i]) && !/^\s{0,3}(#{1,6}\s|>)/.test(lines[i])
        && !RULE.test(lines[i]) && !(para.length && LIST.test(lines[i]))) para.push(lines[i++].trim())
      if (!para.length) para.push(lines[i++].trim())   // a lone line no rule above claimed
      out.push(`<p>${para.map(inline).join('<br>')}</p>`)
    }
    return out.join('')
  }

  function render(text) {
    return blocks(String(text || '').replace(/\r\n?/g, '\n').split('\n'))
  }

  const api = { render }
  if (typeof module !== 'undefined' && module.exports) module.exports = api
  if (root) root.QuillChatMd = api
})(typeof window !== 'undefined' ? window : null)
