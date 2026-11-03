/* Line-level comparison for Recovery Center. Kept dependency-free so it works offline. */
(function exposeRecoveryDiff(root) {
  const value = (map, key) => map.has(key) ? map.get(key) : -Infinity

  function fallbackOperations(before, after) {
    let start = 0
    while (start < before.length && start < after.length && before[start] === after[start]) start++
    let beforeEnd = before.length
    let afterEnd = after.length
    while (beforeEnd > start && afterEnd > start && before[beforeEnd - 1] === after[afterEnd - 1]) {
      beforeEnd--
      afterEnd--
    }
    return [
      ...before.slice(0, start).map(line => ({ type:'same', line })),
      ...before.slice(start, beforeEnd).map(line => ({ type:'remove', line })),
      ...after.slice(start, afterEnd).map(line => ({ type:'add', line })),
      ...before.slice(beforeEnd).map(line => ({ type:'same', line })),
    ]
  }

  function operations(before, after) {
    if (before.length + after.length > 5000) return fallbackOperations(before, after)
    const trace = []
    let frontier = new Map([[1, 0]])
    const max = before.length + after.length
    // A radically different large file can make Myers' trace unnecessarily expensive. The
    // fallback still marks the changed region accurately, just without finding internal anchors.
    const searchLimit = Math.min(max, 1200)
    for (let distance = 0; distance <= searchLimit; distance++) {
      trace.push(new Map(frontier))
      for (let diagonal = -distance; diagonal <= distance; diagonal += 2) {
        let x = diagonal === -distance
          || (diagonal !== distance && value(frontier, diagonal - 1) < value(frontier, diagonal + 1))
          ? value(frontier, diagonal + 1) : value(frontier, diagonal - 1) + 1
        let y = x - diagonal
        while (x < before.length && y < after.length && before[x] === after[y]) { x++; y++ }
        frontier.set(diagonal, x)
        if (x < before.length || y < after.length) continue

        const result = []
        for (let d = trace.length - 1; d >= 0; d--) {
          const previous = trace[d]
          const k = x - y
          const previousK = k === -d || (k !== d && value(previous, k - 1) < value(previous, k + 1))
            ? k + 1 : k - 1
          const previousX = value(previous, previousK)
          const previousY = previousX - previousK
          while (x > previousX && y > previousY) {
            result.push({ type:'same', line:before[x - 1] })
            x--; y--
          }
          if (d === 0) break
          if (x === previousX) {
            result.push({ type:'add', line:after[y - 1] })
            y--
          } else {
            result.push({ type:'remove', line:before[x - 1] })
            x--
          }
        }
        return result.reverse()
      }
    }
    return fallbackOperations(before, after)
  }

  function rows(beforeText, afterText) {
    const before = String(beforeText ?? '').split('\n')
    const after = String(afterText ?? '').split('\n')
    const ops = operations(before, after)
    const output = []
    for (let index = 0; index < ops.length;) {
      if (ops[index].type === 'same') {
        output.push({ before:ops[index].line, after:ops[index].line, beforeType:'same', afterType:'same' })
        index++
        continue
      }
      const removed = []
      const added = []
      while (index < ops.length && ops[index].type !== 'same') {
        if (ops[index].type === 'remove') removed.push(ops[index].line)
        else added.push(ops[index].line)
        index++
      }
      for (let offset = 0; offset < Math.max(removed.length, added.length); offset++) {
        output.push({
          before:removed[offset] ?? '', after:added[offset] ?? '',
          beforeType:offset < removed.length ? 'removed' : 'empty',
          afterType:offset < added.length ? 'added' : 'empty',
        })
      }
    }
    return output
  }

  const api = { rows }
  if (typeof module !== 'undefined' && module.exports) module.exports = api
  if (root) root.QuillRecoveryDiff = api
})(typeof window !== 'undefined' ? window : null)
