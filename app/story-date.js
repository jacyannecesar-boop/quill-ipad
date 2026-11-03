/* Story-calendar parsing for the novel Timeline. Event `when`, `time` and `duration` stay
 * free text the writer typed ("Oct 1st 2024", "2 am", "about an hour"); this reads them on
 * render and never rewrites them on load. Kept dependency-free so node --test can load it.
 */
(function exposeStoryDate(root) {
  const MONTH_RE = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)'
  const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']
  const PLACEMENTS = ['before', 'after', 'undated']
  const pad = (n, width = 2) => String(n).padStart(width, '0')

  function monthIndex(token) {
    return MONTHS.findIndex(name => name.slice(0, 3).toLowerCase() === token.slice(0, 3).toLowerCase())
  }

  function validKey(year, month, day) {
    if (month < 0 || month > 11 || day < 1) return null
    if (day > new Date(Date.UTC(year, month + 1, 0)).getUTCDate()) return null
    return `${pad(year, 4)}-${pad(month + 1)}-${pad(day)}`
  }

  // Finds the first calendar date in `text`, plus enough about how it was written for
  // formatDate to write a new date the same way.
  function findDate(text) {
    const value = String(text || '')
    let m = value.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/)
    if (m) {
      const date = validKey(+m[1], +m[2] - 1, +m[3])
      if (date) return { date, style: { kind: 'iso' } }
    }
    m = value.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/)
    if (m) {
      const date = validKey(+m[3], +m[1] - 1, +m[2])
      if (date) return { date, style: { kind: 'slash' } }
    }
    m = value.match(new RegExp(`\\b${MONTH_RE}(\\.?)\\s+(\\d{1,2})(st|nd|rd|th)?(,?)\\s+(\\d{4})\\b`, 'i'))
    if (m) {
      const date = validKey(+m[6], monthIndex(m[1]), +m[3])
      if (date) return { date, style: { kind: 'mdy', month: m[1], dot: m[2], ordinal: Boolean(m[4]), comma: m[5] } }
    }
    m = value.match(new RegExp(`\\b(\\d{1,2})(st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH_RE}(\\.?)(,?)\\s+(\\d{4})\\b`, 'i'))
    if (m) {
      const date = validKey(+m[6], monthIndex(m[3]), +m[1])
      if (date) return { date, style: { kind: 'dmy', month: m[3], dot: m[4], ordinal: Boolean(m[2]), comma: m[5] } }
    }
    return null
  }

  // Bare "before"/"after" are left out on purpose: "After the funeral" names an anchor, not
  // a position outside the story's main span.
  const UNIT = '(?:minutes?|hours?|days?|weeks?|months?|years?|decades?|centuries|century)'
  const BEFORE_RE = new RegExp(`\\b(?:earlier|ago|prior|previously|backstory|flashback|${UNIT}\\s+before)\\b`, 'i')
  const AFTER_RE = new RegExp(`\\b(?:later|afterwards?|epilogue|years on|${UNIT}\\s+after)\\b`, 'i')

  function parseWhen(text) {
    const found = findDate(text)
    if (found) return { date: found.date }
    if (BEFORE_RE.test(text || '')) return { tray: 'before' }
    if (AFTER_RE.test(text || '')) return { tray: 'after' }
    return null
  }

  function parseTime(text) {
    const value = String(text || '').trim()
    if (/^midnight$/i.test(value)) return 0
    if (/^noon$/i.test(value)) return 12 * 60
    let m = value.match(/\b(\d{1,2})(?::([0-5]\d))?\s*([ap])\.?\s*m\b\.?/i)
    if (m) {
      const hour = +m[1]
      if (hour < 1 || hour > 12) return null
      return ((hour % 12) + (m[3].toLowerCase() === 'p' ? 12 : 0)) * 60 + (+m[2] || 0)
    }
    m = value.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/)
    if (m) return +m[1] * 60 + +m[2]
    return null
  }

  const ONES = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
    ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
    eighteen: 18, nineteen: 19 }
  const TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 }
  const NUMBER_RE = `(\\d+(?:\\.\\d+)?|half\\s+an?|(?:${Object.keys(TENS).join('|')})(?:[-\\s](?:${Object.keys(ONES).filter(w => ONES[w] < 10 && w.length > 2).join('|')}))?|${Object.keys(ONES).sort((a, b) => b.length - a.length).join('|')})`

  function wordNumber(token) {
    const word = token.toLowerCase().replace(/\s+/g, ' ')
    if (/^\d/.test(word)) return parseFloat(word)
    if (word.startsWith('half')) return 0.5
    if (word in ONES) return ONES[word]
    const [tens, ones] = word.split(/[-\s]/)
    return (TENS[tens] || 0) + (ONES[ones] || 0)
  }

  function parseDuration(text) {
    const value = String(text || '')
    const re = new RegExp(`\\b${NUMBER_RE}\\s*(minutes?|mins?|hours?|hrs?|h)\\b(\\s+and\\s+a\\s+half)?`, 'gi')
    let total = 0
    let matched = false
    for (const m of value.matchAll(re)) {
      const amount = wordNumber(m[1]) + (m[3] ? 0.5 : 0)
      total += /^h/i.test(m[2]) ? amount * 60 : amount
      matched = true
    }
    return matched && total > 0 ? Math.round(total) : null
  }

  function ordinal(day) {
    if (day % 100 >= 11 && day % 100 <= 13) return `${day}th`
    return day + ({ 1: 'st', 2: 'nd', 3: 'rd' }[day % 10] || 'th')
  }

  function matchCase(sample, word) {
    if (sample === sample.toUpperCase()) return word.toUpperCase()
    if (sample === sample.toLowerCase()) return word.toLowerCase()
    return word
  }

  // Writes `dateKey` the way `sampleWhen` wrote its date, so a dropped event reads like the
  // writer's own entries ("Oct 1st 2024" → "Oct 3rd 2024").
  function formatDate(dateKey, sampleWhen) {
    const [year, month, day] = dateKey.split('-').map(Number)
    const style = findDate(sampleWhen)?.style || { kind: 'mdy', month: 'Oct', dot: '', ordinal: false, comma: ',' }
    if (style.kind === 'iso') return dateKey
    if (style.kind === 'slash') return `${month}/${day}/${year}`
    const full = MONTHS[month - 1]
    const name = matchCase(style.month, style.month.length > 4 ? full : full.slice(0, 3)) + style.dot
    const dayText = style.ordinal ? ordinal(day) : String(day)
    return style.kind === 'dmy'
      ? `${dayText} ${name}${style.comma} ${year}`
      : `${name} ${dayText}${style.comma} ${year}`
  }

  function formatTime(minutes) {
    const hour = Math.floor(minutes / 60) % 24
    return `${hour % 12 || 12}:${pad(minutes % 60)} ${hour < 12 ? 'AM' : 'PM'}`
  }

  function classify(event = {}) {
    if (PLACEMENTS.includes(event.placement)) return { tray: event.placement }
    const when = parseWhen(event.when)
    if (!when) return { tray: 'undated' }
    if (when.tray) return { tray: when.tray }
    const minutes = parseTime(event.time) ?? parseTime(String(event.when || '').replace(/\b\d{4}\b/g, ''))
    return { date: when.date, minutes, duration: parseDuration(event.duration) }
  }

  // String keys that sort Before-tray events first, then dated events by date and minute
  // (untimed first on their day), then the After tray. Undated events have no key.
  function sortKey(event) {
    const placed = classify(event)
    if (placed.tray === 'before') return 'a'
    if (placed.tray === 'after') return 'c'
    if (placed.tray) return null
    return `b${placed.date}${pad(placed.minutes == null ? 0 : placed.minutes + 1, 4)}`
  }

  // Calendar arithmetic on YYYY-MM-DD keys, in UTC so daylight-saving days can't shift a date.
  const toUTC = key => { const [y, m, d] = key.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)) }
  const fromUTC = date => `${pad(date.getUTCFullYear(), 4)}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
  const addDays = (key, amount) => { const d = toUTC(key); d.setUTCDate(d.getUTCDate() + amount); return fromUTC(d) }
  const addMonths = (key, amount) => { const d = toUTC(key); return fromUTC(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + amount, 1))) }
  const dayOfWeek = key => toUTC(key).getUTCDay()
  const weekStart = key => addDays(key, -dayOfWeek(key))
  const monthStart = key => `${key.slice(0, 7)}-01`
  const todayKey = () => { const d = new Date(); return `${pad(d.getFullYear(), 4)}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` }

  const api = {
    MONTHS, parseWhen, parseTime, parseDuration, formatDate, formatTime, classify, sortKey,
    addDays, addMonths, dayOfWeek, weekStart, monthStart, todayKey,
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = api
  if (root) root.QuillStoryDate = api
})(typeof window !== 'undefined' ? window : null)
