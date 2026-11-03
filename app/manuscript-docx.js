/* manuscript-docx.js — builds the OOXML parts of a standard-manuscript .docx.
 *
 * Word repaginates on its own, so this builds from the novel's sections rather than from the
 * pages Read Draft laid out: 12pt Times (or Courier), true double spacing, 1" margins, a
 * half-inch first-line indent, an unnumbered title page, a running "Surname / TITLE / page"
 * header, chapters opening a third of the way down, and "#" on its own line for scene breaks.
 *
 * buildOutline() writes the novel Outliner as a plain working document through the same packaging,
 * and buildWorldBible() and buildCharacters() do the same for the World Bible and character sheets.
 *
 * Returns the parts as {path: string} — main.js zips them into the .docx container.
 */
const ManuscriptDocx = (() => {
  const IN = 1440                     // twips per inch
  const PT = 20                       // twips per point
  const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'
  const R = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'

  const esc = s => String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    // Control characters are not legal in XML and Word refuses the whole file over one.
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')

  // ── Runs and paragraphs ───────────────────────────────────────────────

  function runs(nodes) {
    let xml = ''
    for (const node of nodes || []) {
      if (node.type === 'hardBreak') { xml += '<w:r><w:br/></w:r>'; continue }
      if (node.type !== 'text') { xml += runs(node.content); continue }
      const marks = new Set((node.marks || []).map(mark => mark.type))
      let rPr = ''
      if (marks.has('bold')) rPr += '<w:b/>'
      if (marks.has('italic')) rPr += '<w:i/>'
      if (marks.has('underline')) rPr += '<w:u w:val="single"/>'
      if (marks.has('strike')) rPr += '<w:strike/>'
      xml += `<w:r>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ''}`
        + `<w:t xml:space="preserve">${esc(node.text)}</w:t></w:r>`
    }
    return xml
  }

  function para(inner, opts = {}) {
    const { align, indent = null, before = 0, after = 0, pageBreak = false,
      left = 0, tabRight = 0, sectPr = '' } = opts
    let pPr = ''
    if (pageBreak) pPr += '<w:pageBreakBefore/>'
    if (tabRight) pPr += `<w:tabs><w:tab w:val="right" w:pos="${tabRight}"/></w:tabs>`
    if (before || after) pPr += `<w:spacing w:before="${before}" w:after="${after}"/>`
    if (left || indent != null) {
      pPr += `<w:ind${left ? ` w:left="${left}"` : ''}`
        + `${indent != null ? ` w:firstLine="${indent}"` : ''}/>`
    }
    if (align) pPr += `<w:jc w:val="${align}"/>`
    if (sectPr) pPr += sectPr
    return `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ''}${inner}</w:p>`
  }

  const text = (s, opts) => para(runs([{ type: 'text', text: s }]), opts)
  const blank = () => '<w:p/>'

  // ── Scene prose ───────────────────────────────────────────────────────

  const INDENT = IN / 2                // 0.5" first line, as in Read Draft

  function block(node, listPrefix = null) {
    switch (node.type) {
      case 'paragraph':
        if (!node.content?.length) return blank()
        return para(runs(node.content), listPrefix != null
          ? { left: INDENT, indent: 0 }
          : { indent: INDENT })
      case 'heading':
        return para(`<w:r><w:rPr><w:b/></w:rPr>`
          + `<w:t xml:space="preserve">${esc(plain(node))}</w:t></w:r>`, { align: 'center' })
      case 'blockquote':
        return (node.content || []).map(child =>
          para(runs(child.content), { left: INDENT, indent: 0 })).join('')
      case 'horizontalRule':
        return text('#', { align: 'center' })
      case 'bulletList':
      case 'orderedList':
        // Fiction rarely carries lists; a marker plus an indent beats shipping numbering.xml.
        return (node.content || []).map((item, i) => {
          const marker = node.type === 'orderedList' ? `${i + 1}. ` : '• '
          return (item.content || []).map((child, j) => para(
            (j === 0 ? runs([{ type: 'text', text: marker }]) : '') + runs(child.content),
            { left: INDENT, indent: 0 })).join('')
        }).join('')
      default:
        return node.content ? (node.content || []).map(child => block(child)).join('') : ''
    }
  }

  function plain(node) {
    if (node.type === 'text') return node.text || ''
    if (node.type === 'hardBreak') return ' '
    return (node.content || []).map(plain).join('')
  }

  // ── Document ──────────────────────────────────────────────────────────

  function sectPr({ header }) {
    return '<w:sectPr>'
      + (header ? '<w:headerReference w:type="default" r:id="rId2"/>' : '')
      + '<w:pgSz w:w="12240" w:h="15840"/>'
      + `<w:pgMar w:top="${IN}" w:right="${IN}" w:bottom="${IN}" w:left="${IN}"`
      + ' w:header="720" w:footer="720" w:gutter="0"/>'
      + (header ? '<w:pgNumType w:start="1"/>' : '')
      + '</w:sectPr>'
  }

  function titlePage({ pen, title, words }) {
    // Contact block top-left, word count pushed to the right margin by a single tab stop.
    const top = para(
      runs([{ type: 'text', text: pen || '' }])
      + '<w:r><w:tab/></w:r>'
      + runs([{ type: 'text', text: words }]),
      { tabRight: IN * 6.5 })
    // 3.5" down, matching the preview's title block.
    const heading = text((title || 'Untitled').toUpperCase(), { align: 'center', before: IN * 3.5 })
    const by = pen ? text(`by ${pen}`, { align: 'center' }) : ''
    // The section break lives on the last paragraph of the section it ends.
    const closer = para('', { sectPr: sectPr({ header: false }) })
    return top + heading + by + closer
  }

  /**
   * sections:     assembleNovel output (or one chapter's slice)
   * meta:         the novel's folder meta (folder_title, pen_name, manuscript_font)
   * scope:        'novel' adds the title page and THE END; 'chapter' is just the prose
   * startChapter: the number of the first chapter in `sections`
   * label:        (kind, number, title) => the chapter/part opening line, from Read Draft
   * words:        rounded word-count line for the title page
   */
  function build({ sections, meta = {}, scope = 'novel', startChapter = 1, label, words }) {
    const title = String(meta.folder_title || 'Untitled').trim()
    const pen = String(meta.pen_name || '').trim()
    const mono = meta.manuscript_font === 'mono'
      || (!meta.manuscript_font && sections.find(s => s.type === 'scene' && s.font)?.font === 'mono')
    const font = mono ? 'Courier New' : 'Times New Roman'

    let body = scope === 'novel' ? titlePage({ pen, title, words }) : ''
    let chapterNo = startChapter - 1, actNo = 0, sceneInChapter = 0
    let first = true

    for (const section of sections) {
      if (section.type === 'act') {
        const head = label('act', ++actNo, section.title)
        body += text(head.label, { align: 'center', before: IN * 3.75, pageBreak: !first })
        if (head.title && head.title !== head.label) body += text(head.title, { align: 'center' })
        first = false
        sceneInChapter = 0
        continue
      }
      if (section.type === 'chapter') {
        const head = label('chapter', ++chapterNo, section.title)
        const gap = { after: IN / 2 }
        body += head.title && head.title !== head.label
          ? text(head.label, { align: 'center', before: IN * 2.25, pageBreak: !first })
            + text(head.title, { align: 'center', ...gap })
          : text(head.label, { align: 'center', before: IN * 2.25, pageBreak: !first, ...gap })
        first = false
        sceneInChapter = 0
        continue
      }
      if (section.type !== 'scene' || !section.body) continue
      if (sceneInChapter++ > 0) body += text('#', { align: 'center' })
      const doc = window.QuillMd.parseMarkdown(section.body)
      for (const node of doc.content || []) body += block(node)
      first = false
    }

    if (scope === 'novel') body += text('THE END', { align: 'center', before: 24 * PT })
    body += sectPr({ header: true })

    const headerLine = [pen.split(/\s+/).pop() || '',
      title.toUpperCase().split(/\s+/).slice(0, 4).join(' ')].filter(Boolean).join(' / ')

    const header = HEAD + `<w:hdr ${W} ${R}>`
      + '<w:p><w:pPr><w:jc w:val="right"/>'
      + `<w:spacing w:line="${12 * PT}" w:lineRule="auto"/></w:pPr>`
      + `<w:r><w:t xml:space="preserve">${esc(headerLine)}${headerLine ? ' / ' : ''}</w:t></w:r>`
      + '<w:r><w:fldChar w:fldCharType="begin"/></w:r>'
      + '<w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r>'
      + '<w:r><w:fldChar w:fldCharType="separate"/></w:r>'
      + '<w:r><w:t>1</w:t></w:r>'
      + '<w:r><w:fldChar w:fldCharType="end"/></w:r>'
      + '</w:p></w:hdr>'

    // 24pt leading on a 12pt face. "atLeast" rather than "auto" because Word derives auto
    // double spacing from font metrics (~27.6pt for Times), which would not match the
    // preview's 32px lines or the PDF printed from them.
    return pack({ body, font, spacing: `<w:spacing w:before="0" w:after="0" w:line="${24 * PT}" w:lineRule="atLeast"/>`, header })
  }

  // ── Outline ───────────────────────────────────────────────────────────

  const styled = (s, { bold, italic, size, color } = {}) => {
    let rPr = ''
    if (bold) rPr += '<w:b/>'
    if (italic) rPr += '<w:i/>'
    if (color) rPr += `<w:color w:val="${color}"/>`
    if (size) rPr += `<w:sz w:val="${size * 2}"/><w:szCs w:val="${size * 2}"/>`
    return `<w:r>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ''}<w:t xml:space="preserve">${esc(s)}</w:t></w:r>`
  }

  /**
   * The Outliner as a plain working document: act and chapter headings, then each scene's
   * title, status and word count with its synopsis beneath. No manuscript formatting.
   * model: { title, summary, acts: [{ title, chapters: [{ title, meta, scenes: [{ title, synopsis, status, words }] }] }] }
   */
  function buildOutline(model) {
    const GREY = '6B6B6B'
    let body = para(styled(`${model.title} — Outline`, { bold: true, size: 20 }), { after: 4 * PT })
      + para(styled(model.summary, { color: GREY }), { after: 12 * PT })
    for (const act of model.acts) {
      if (act.title) body += para(styled(act.title, { bold: true, size: 16 }), { before: 18 * PT, after: 6 * PT })
      for (const chapter of act.chapters) {
        body += para(styled(chapter.title, { bold: true, size: 13 })
          + styled(`   ${chapter.meta}`, { color: GREY, size: 10 }), { before: 12 * PT, after: 4 * PT })
        chapter.scenes.forEach((scene, i) => {
          const words = `${scene.words.toLocaleString()} word${scene.words === 1 ? '' : 's'}`
          body += para(styled(`${i + 1}. `) + styled(scene.title, { bold: true })
            + styled(`  ·  ${scene.status}  ·  ${words}`, { color: GREY, size: 10 }),
          { left: IN / 4, indent: 0, before: 4 * PT, after: scene.synopsis ? 0 : 2 * PT })
          if (scene.synopsis) {
            scene.synopsis.split('\n').forEach(line => {
              body += para(styled(line), { left: IN / 2, indent: 0, after: 2 * PT })
            })
          }
        })
      }
    }
    body += sectPr({ header: false })
    return pack({ body, font: 'Times New Roman', spacing: '<w:spacing w:before="0" w:after="0" w:line="276" w:lineRule="auto"/>' })
  }

  // ── World Bible ───────────────────────────────────────────────────────

  /**
   * Every World Bible card as one reference document: a heading per section, then each card's
   * title, its filled fields as "Label: value", and its notes as formatted Markdown.
   * model: { title, summary, sections: [{ title, cards: [{ title, fields: [[label, value]], body }] }] }
   */
  function buildWorldBible(model) {
    const GREY = '6B6B6B'
    let body = para(styled(`${model.title} — World Bible`, { bold: true, size: 20 }), { after: 4 * PT })
      + para(styled(model.summary, { color: GREY }), { after: 12 * PT })
    for (const section of model.sections) {
      body += para(styled(section.title, { bold: true, size: 16 }), { before: 18 * PT, after: 6 * PT })
      for (const card of section.cards) {
        body += para(styled(card.title, { bold: true, size: 13 }), { before: 12 * PT, after: 4 * PT })
        for (const [label, value] of card.fields) {
          body += para(styled(`${label}: `, { bold: true, color: GREY }) + styled(value), { after: 2 * PT })
        }
        if (!card.body) continue
        for (const node of window.QuillMd.parseMarkdown(card.body).content || []) body += note(node)
      }
    }
    body += sectPr({ header: false })
    return pack({ body, font: 'Times New Roman', spacing: '<w:spacing w:before="0" w:after="0" w:line="276" w:lineRule="auto"/>' })
  }

  // ── Characters ────────────────────────────────────────────────────────

  /**
   * Every character sheet, one per page: name and role, then each filled sheet section. A
   * section with one field (Backstory text, Notes) prints the text under its heading; a section
   * with several prints "Label: value" lines. Line breaks typed in a field are kept.
   * model: { title, summary, characters: [{ name, role, groups: [{ title, fields: [[label, value]] }] }] }
   */
  function buildCharacters(model) {
    const GREY = '6B6B6B'
    let body = para(styled(`${model.title} — Characters`, { bold: true, size: 20 }), { after: 4 * PT })
      + para(styled(model.summary, { color: GREY }), { after: 12 * PT })
    model.characters.forEach((character, i) => {
      body += para(styled(character.name, { bold: true, size: 18 }), { pageBreak: i > 0, before: i > 0 ? 0 : 12 * PT, after: 2 * PT })
        + para(styled(character.role, { italic: true, color: GREY }), { after: 6 * PT })
      for (const group of character.groups) {
        body += para(styled(group.title, { bold: true, size: 13 }), { before: 10 * PT, after: 2 * PT })
        for (const [label, value] of group.fields) {
          value.split('\n').filter(line => line.trim()).forEach((line, j) => {
            const lead = label && j === 0 ? styled(`${label}: `, { bold: true, color: GREY }) : ''
            body += para(lead + styled(line), { after: 3 * PT })
          })
        }
      }
    })
    body += sectPr({ header: false })
    return pack({ body, font: 'Times New Roman', spacing: '<w:spacing w:before="0" w:after="0" w:line="276" w:lineRule="auto"/>' })
  }

  // Card notes are reference text, not prose: block paragraphs with space after, no first-line indent.
  function note(node) {
    const gap = { before: 4 * PT, after: 2 * PT }
    switch (node.type) {
      case 'paragraph':
        return node.content?.length ? para(runs(node.content), gap) : ''
      case 'heading':
        return para(styled(plain(node), { bold: true }), { before: 8 * PT, after: 2 * PT })
      case 'blockquote':
        return (node.content || []).map(child => para(runs(child.content), { ...gap, left: INDENT })).join('')
      case 'horizontalRule':
        return ''
      case 'bulletList':
      case 'orderedList':
        return (node.content || []).map((item, i) => {
          const marker = node.type === 'orderedList' ? `${i + 1}. ` : '• '
          return (item.content || []).map((child, j) => para(
            (j === 0 ? runs([{ type: 'text', text: marker }]) : '') + runs(child.content),
            { left: IN / 4, indent: 0, after: 2 * PT })).join('')
        }).join('')
      default:
        return (node.content || []).map(note).join('')
    }
  }

  // ── Package ───────────────────────────────────────────────────────────

  function pack({ body, font, spacing, header = null }) {
    return {
      '[Content_Types].xml': HEAD
        + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        + '<Default Extension="xml" ContentType="application/xml"/>'
        + '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
        + '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'
        + (header ? '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>' : '')
        + '</Types>',

      '_rels/.rels': HEAD
        + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
        + '</Relationships>',

      'word/_rels/document.xml.rels': HEAD
        + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
        + (header ? '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>' : '')
        + '</Relationships>',

      'word/styles.xml': HEAD + `<w:styles ${W}>`
        + '<w:docDefaults><w:rPrDefault><w:rPr>'
        + `<w:rFonts w:ascii="${font}" w:hAnsi="${font}" w:cs="${font}"/>`
        + `<w:sz w:val="${12 * 2}"/><w:szCs w:val="${12 * 2}"/>`
        + `</w:rPr></w:rPrDefault><w:pPrDefault><w:pPr>${spacing}`
        + '</w:pPr></w:pPrDefault></w:docDefaults>'
        + '<w:style w:type="paragraph" w:default="1" w:styleId="Normal">'
        + '<w:name w:val="Normal"/></w:style>'
        + '</w:styles>',

      ...(header ? { 'word/header1.xml': header } : {}),

      'word/document.xml': HEAD + `<w:document ${W} ${R}><w:body>${body}</w:body></w:document>`,
    }
  }

  return { build, buildOutline, buildWorldBible, buildCharacters }
})()
