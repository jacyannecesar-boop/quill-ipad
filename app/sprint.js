/* sprint.js — Writing sprint timer, streak, stats */

const Sprint = (() => {
  let _duration      = 25        // minutes
  let _remaining     = 0         // seconds
  let _running       = false
  let _paused        = false     // true when paused mid-sprint
  let _interval      = null
  let _sprintWords   = 0         // words at sprint start
  let _lastWordCount = 0         // updated every tick as fallback
  let _startTime     = null
  let _activeTab     = 'notes'

  function init() {
    // sprint controls
    document.getElementById('sprint-start').onclick   = startSprint
    document.getElementById('sprint-pause').onclick   = pauseSprint
    document.getElementById('sprint-reset').onclick   = resetSprint

    // duration presets
    document.querySelectorAll('.sprint-preset').forEach(btn => {
      btn.onclick = () => {
        if (_running) return
        _duration = parseInt(btn.dataset.min, 10)
        document.querySelectorAll('.sprint-preset').forEach(b => b.classList.remove('active'))
        btn.classList.add('active')
        resetSprint()
      }
    })

    // custom duration
    document.getElementById('sprint-custom').addEventListener('change', e => {
      const v = parseInt(e.target.value, 10)
      if (v > 0 && v <= 180) {
        _duration = v
        document.querySelectorAll('.sprint-preset').forEach(b => b.classList.remove('active'))
        resetSprint()
      }
    })

    resetSprint()
  }

  function switchTab(tab) {
    _activeTab = tab
    if (tab === 'sprint') { loadStats(); _startStatsRefresh() } else { _stopStatsRefresh() }
    if (tab === 'tags')   loadTags()
    if (tab === 'comments' && typeof Comments !== 'undefined') Comments.render()
  }

  let _statsRefreshInterval = null
  function _startStatsRefresh() {
    _stopStatsRefresh()
    _statsRefreshInterval = setInterval(loadStats, 5000) // refresh every 5s
  }
  function _stopStatsRefresh() {
    if (_statsRefreshInterval) { clearInterval(_statsRefreshInterval); _statsRefreshInterval = null }
  }

  function setFolderType(type) {
    const tagsSection = document.getElementById('insp-tags-section')
    if (!tagsSection) return
    const shouldHide = (type === 'novel' || type === 'act')
    tagsSection.style.display = shouldHide ? 'none' : ''
  }

  // ── Timer ──────────────────────────────────────────────────

  function startSprint() {
    if (_running) return
    _running   = true
    _startTime = _startTime || Date.now()
    // only capture word count on fresh start, not on resume from pause
    if (!_paused) {
      const bodyEl = document.getElementById('entry-body')
      if (bodyEl) {
        const text   = bodyEl.innerText.trim()
        _sprintWords = QuillWords.countPlain(text)
      }
    }
    _paused = false
    document.getElementById('sprint-start').disabled  = true
    document.getElementById('sprint-pause').disabled  = false
    _interval = setInterval(tick, 1000)
    updateTimerDisplay()
  }

  function pauseSprint() {
    if (!_running) return
    _running  = false
    _paused   = true
    clearInterval(_interval)
    document.getElementById('sprint-start').disabled = false
    document.getElementById('sprint-pause').disabled = true
  }

  async function resetSprint() {
    clearInterval(_interval)
    _running   = false
    _paused    = false
    _remaining = _duration * 60
    _startTime = null
    document.getElementById('sprint-start').disabled = false
    document.getElementById('sprint-pause').disabled = true
    updateTimerDisplay()
    updateSprintWords()
    document.getElementById('sprint-ring-fill').style.strokeDashoffset = circumference()
  }

  function tick() {
    if (_remaining <= 0) {
      finishSprint(); return
    }
    _remaining--
    updateTimerDisplay()
    updateSprintWords()
    const total    = _duration * 60
    const progress = (_remaining / total)
    const circ     = circumference()
    document.getElementById('sprint-ring-fill').style.strokeDashoffset = circ * progress
  }

  async function finishSprint() {
    clearInterval(_interval)
    _running = false
    document.getElementById('sprint-start').disabled = false
    document.getElementById('sprint-pause').disabled = true

    // use live count, fall back to last tracked count during ticks
    const bodyEl = document.getElementById('entry-body')
    let wordsNow = _lastWordCount
    if (bodyEl) {
      const text = bodyEl.innerText.trim()
      if (text) wordsNow = QuillWords.countPlain(text)
    }
    const added = Math.max(0, wordsNow - _sprintWords)

    // save stats — log error visibly if it fails
    try {
      const saved = await window.quill.saveStats({ wordsAdded: added, sprintMinutes: _duration })
      App.showAchievementToast?.(saved?.achievements)
      await loadStats()  // refresh the stats panel immediately
    } catch (err) {
      console.error('Sprint stats save failed:', err)
    }

    document.getElementById('sprint-done-msg').textContent =
      `Sprint complete! ${added > 0 ? added.toLocaleString() + ' words written.' : 'Great session.'}`
    document.getElementById('sprint-done-msg').style.display = 'block'
    setTimeout(() => { document.getElementById('sprint-done-msg').style.display = 'none' }, 5000)
  }

  function updateTimerDisplay() {
    const m = Math.floor(_remaining / 60).toString().padStart(2,'0')
    const s = (_remaining % 60).toString().padStart(2,'0')
    document.getElementById('sprint-time').textContent = `${m}:${s}`
  }

  function updateSprintWords() {
    const bodyEl = document.getElementById('entry-body')
    if (!bodyEl || !_running) return
    const text   = bodyEl.innerText.trim()
    const now    = QuillWords.countPlain(text)
    _lastWordCount = now
    const added  = Math.max(0, now - _sprintWords)
    document.getElementById('sprint-word-delta').textContent = '+' + added.toLocaleString() + ' words'
  }

  function circumference() {
    return 2 * Math.PI * 44   // r=44 in the SVG
  }

  // ── Stats ──────────────────────────────────────────────────

  async function loadStats() {
    const stats = await window.quill.getStats().catch(() => ({}))

    document.getElementById('stat-streak').textContent      = (stats.streak||0) + ' day' + ((stats.streak||0)===1?'':'s')
    document.getElementById('stat-sessions').textContent    = (stats.totalSessions||0)
    document.getElementById('stat-longest').textContent     = (stats.longestSprint||0) + ' min'

    // today's words from weekWords
    const todayKey = window.QuillDates.localDateKey()
    const todayWords = (stats.weekWords||{})[todayKey] || 0
    const todayEl = document.getElementById('stat-today-words')
    if (todayEl) todayEl.textContent = todayWords.toLocaleString()

    // current scene time
    const sceneTimeEl = document.getElementById('stat-scene-time')
    if (sceneTimeEl) {
      const secs  = typeof Editor !== 'undefined' ? Editor.getTimeSpent() : 0
      const mins  = Math.floor(secs / 60)
      const hrs   = Math.floor(mins / 60)
      sceneTimeEl.textContent = secs < 60 ? '< 1 min'
        : hrs > 0 ? `${hrs}h ${mins % 60}m`
        : `${mins} min`
    }

    // scene time breakdown — scan localStorage for quill_time_ keys
    const sceneSection = document.getElementById('scene-times-section')
    const sceneList    = document.getElementById('scene-times-list')
    if (sceneSection && sceneList) {
      const entries = []
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i)
        if (!key.startsWith('quill_time_')) continue
        const secs = parseInt(localStorage.getItem(key) || '0', 10)
        if (secs < 60) continue
        // key = 'quill_time_' + path.replace(/[^a-z0-9]/gi, '_')
        // e.g. quill_time_The_Drowned_Gods_Act_1_Chapter_1_Scene_1_md
        // strip prefix and trailing _md, then take last non-empty segment
        const raw   = key.replace('quill_time_', '').replace(/_md$/i, '')
        const parts = raw.split('_').filter(Boolean)
        // scene name is the last segment(s) — join last 2-3 parts for readability
        // but skip pure numeric segments (like date prefixes)
        const nameParts = []
        for (let j = parts.length - 1; j >= 0 && nameParts.length < 3; j--) {
          if (/^\d{4,}$/.test(parts[j])) break // stop at date-like numbers
          nameParts.unshift(parts[j])
        }
        const name = nameParts.join(' ') || raw
        entries.push({ name, secs })
      }
      entries.sort((a, b) => b.secs - a.secs)
      if (entries.length) {
        sceneSection.style.display = ''
        sceneList.innerHTML = entries.slice(0, 10).map(e => {
          const mins = Math.floor(e.secs / 60)
          const hrs  = Math.floor(mins / 60)
          const label = hrs > 0 ? `${hrs}h ${mins % 60}m` : `${mins}m`
          const pct   = Math.round((e.secs / entries[0].secs) * 100)
          return `<div class="scene-time-row">
            <div class="scene-time-bar" style="width:${pct}%"></div>
            <span class="scene-time-name">${esc(e.name)}</span>
            <span class="scene-time-val">${label}</span>
          </div>`
        }).join('')
      } else {
        sceneSection.style.display = 'none'
      }
    }

    // weekly chart
    const weekWords = stats.weekWords || {}
    renderWeekChart(weekWords)
  }

  function esc(s) { return escapeHtml(s) }

  function renderWeekChart(weekWords) {
    const entries  = Object.entries(weekWords)
    const maxWords = Math.max(...entries.map(([,v])=>v), 1)
    const canvas   = document.getElementById('week-chart')
    if (!canvas) return

    canvas.innerHTML = ''
    entries.forEach(([date, count]) => {
      const day   = new Date(date+'T12:00:00').toLocaleDateString('en-US',{weekday:'short'})
      const pct   = Math.round((count/maxWords)*100)
      const col   = document.createElement('div')
      col.className = 'chart-col'
      col.innerHTML = `
        <div class="chart-bar-wrap">
          <div class="chart-bar" style="height:${Math.max(pct,2)}%" title="${count.toLocaleString()} words"></div>
        </div>
        <div class="chart-day">${day}</div>`
      canvas.appendChild(col)
    })
  }

  // ── Tags ───────────────────────────────────────────────────

  async function loadTags() {
    const tagMap = await window.quill.getAllTags().catch(() => ({}))
    const wrap   = document.getElementById('tag-cloud')
    if (!wrap) return
    wrap.innerHTML = ''

    const sorted = Object.entries(tagMap).sort((a,b) => b[1].length - a[1].length)
    if (!sorted.length) {
      wrap.innerHTML = '<div class="tag-empty">No tags yet. Add tags to journal entries to see them here.</div>'
      return
    }

    sorted.forEach(([tag, files]) => {
      const chip = document.createElement('button')
      chip.className   = 'tag-chip'
      chip.textContent = `${tag} (${files.length})`
      chip.onclick     = () => App.openTagSearch(tag)
      wrap.appendChild(chip)
    })
  }

  return { init, switchTab, loadTags, loadStats, setFolderType }
})()
