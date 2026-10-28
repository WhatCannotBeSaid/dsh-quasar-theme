/* Original ASCII thin-disk renderer. No third-party code or font copied.
 * Geometry: Schwarzschild null geodesics in Cartesian form, x'' = -3 L^2 x / r^5,
 * G=M=c=1, from a fixed 60M observer. Capture is analytic (impact parameter
 * under 3*sqrt(3)), so the shadow is exact and costs no integration; the disk is
 * the first crossing of the y=0 plane inside 6M..20M, with the photon ring
 * drawn from rays that graze the critical impact parameter.
 * The camera keeps a fixed vertical field of view, so the shadow always spans
 * the same share of the viewport and the disk can be composed around it.
 * On light paper the shadow is painted as solid ink before the disk, because an
 * unpainted Schwarzschild shadow on a light page reads as empty space rather
 * than a hole; the disk's near side is then drawn with the luminous ramp on top.
 * Cells are traced once per geometry change; only the orbital phase and the
 * star twinkle are recalculated per frame. */
var UniverseBlackHole = (function () {
  var GLYPHS = ' .-:;+*o#%@'
  var STARS = ".,'"
  var STROKES = '|-/\\'
  var defaults = { angle: 15, fps: 30, maxCells: 16000, cellWidth: 6, brightness: 1, speed: 1 }
  var DISTANCE = 60
  var INNER = 6, OUTER = 16
  var B_CRIT = 3 * Math.sqrt(3)
  var SHADOW_SHARE = 0.44
  var HORIZON_INK = '#101725'
  var TAN_HALF = B_CRIT / DISTANCE / SHADOW_SHARE
  var RING_WIDTH = 0.32
  var SWIRL = 16
  function options(input) {
    input = input || {}
    function number(key, min, max) {
      var n = Number(input[key])
      return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : defaults[key]
    }
    return { angle: number('angle', 10, 50), fps: number('fps', 10, 60),
      maxCells: number('maxCells', 2000, 24000), cellWidth: number('cellWidth', 6, 16),
      brightness: number('brightness', .15, 2), speed: number('speed', 0, 2) }
  }
  function smooth(lo, hi, x) {
    var t = Math.min(1, Math.max(0, (x - lo) / (hi - lo)))
    return t * t * (3 - 2 * t)
  }
  /* Trace one ray. The disk is sampled on every crossing of the y=0 plane, so
     the half in front of the hole is drawn too; only a ray that actually falls
     inside the photon sphere becomes shadow. The impact parameter is kept as a
     sky glow so the critical curve stays a crisp ring. */
  function trace(u, v, angle) {
    var a = angle * Math.PI / 180, sa = Math.sin(a), ca = Math.cos(a)
    var ox = 0, oy = DISTANCE * sa, oz = DISTANCE * ca
    var vx = u * TAN_HALF, vy = -sa + v * TAN_HALF * ca, vz = -ca - v * TAN_HALF * sa
    var len = Math.sqrt(vx * vx + vy * vy + vz * vz); vx /= len; vy /= len; vz /= len
    var lx = oy * vz - oz * vy, ly = oz * vx - ox * vz, lz = ox * vy - oy * vx
    var l2 = lx * lx + ly * ly + lz * lz
    var impact = Math.sqrt(l2)
    var ring = Math.exp(-Math.pow((impact - B_CRIT) / RING_WIDTH, 2))
    var x = ox, y = oy, z = oz, px = vx, py = vy, pz = vz
    for (var i = 0; i < 420; i++) {
      var r2 = x * x + y * y + z * z, r = Math.sqrt(r2)
      if (r < 2.05) return { captured: true }
      if (r > 108 && x * px + y * py + z * pz > 0) break
      var h = Math.min(2.6, Math.max(.06, r * .07))
      var k = -3 * l2 / (r2 * r2 * r)
      var nx = x + px * h + .5 * k * x * h * h
      var ny = y + py * h + .5 * k * y * h * h
      var nz = z + pz * h + .5 * k * z * h * h
      var nr2 = nx * nx + ny * ny + nz * nz, nk = -3 * l2 / (nr2 * nr2 * Math.sqrt(nr2))
      if (y * ny <= 0) {
        var f = y / (y - ny), qx = x + (nx - x) * f, qz = z + (nz - z) * f
        var dr = Math.sqrt(qx * qx + qz * qz)
        if (dr >= INNER && dr <= OUTER) {
          var dx = px + .5 * (k * x + nk * nx) * h, dy = py + .5 * (k * y + nk * ny) * h,
            dz = pz + .5 * (k * z + nk * nz) * h
          var toward = (qz * dx - qx * dz) / (dr * Math.sqrt(dx * dx + dy * dy + dz * dz))
          var beta = Math.sqrt(1 / (dr - 2))
          var shift = Math.sqrt(1 - 2 / dr) * Math.sqrt(1 - beta * beta) / (1 - beta * toward)
          return { radius: dr, phi: Math.atan2(qz, qx), boost: Math.min(1.7, Math.max(.4, Math.pow(shift, 1.8))), ring: ring * .3, impact: impact }
        }
      }
      px += .5 * (k * x + nk * nx) * h
      py += .5 * (k * y + nk * ny) * h
      pz += .5 * (k * z + nk * nz) * h
      x = nx; y = ny; z = nz
    }
    return { captured: false, ring: ring, impact: impact }
  }
  /* Brightness is a flux in [0,1): the disk carries lanes and knots advected by
     the Keplerian phase, the photon ring adds a fixed thin annulus. */
  /* Brightness is a flux in [0,1): a smooth radial profile times a slow two-arm
     spiral, so neighbouring cells stay close in value and the glyphs read as a
     surface instead of noise. The photon ring adds a thin fixed annulus. */
  function shade(ray, time, brightness) {
    var flux = 0
    if (ray.ring) flux += ray.ring * 2.2
    if (ray.radius) {
      var r = ray.radius
      var phase = ray.phi - time * SWIRL / Math.pow(r, 1.5)
      var arms = .72 + .28 * Math.sin(2 * phase - 4 * Math.log(r / INNER))
      var band = .82 + .18 * Math.sin(r * 1.1 + 1.6 * Math.sin(2 * phase))
      var edge = smooth(INNER - .2, INNER + .8, r) * (1 - smooth(10, 16, r))
      flux += edge * Math.pow(INNER / r, 2) * arms * band * ray.boost * 3.2
    }
    if (!(flux > 0)) return 0
    return 1 - Math.exp(-flux * brightness)
  }
  function star(col, row) {
    var h = ((col * 73856093) ^ (row * 19349663)) >>> 0
    h = (h ^ (h >>> 13)) >>> 0
    if (h % 1000 >= 3) return null
    return { glyph: STARS[h % STARS.length], mag: .3 + ((h >>> 7) % 100) / 100 * .55, phase: ((h >>> 17) % 628) / 100 }
  }
  function lit(cell) { return cell ? !!(cell.radius || cell.ring) : false }
  /* Give the shadow a drawn edge: a captured cell that touches a lit cell takes a
     stroke glyph, so the black disc keeps an outline where the disk is too dim to
     draw one. The stroke follows the edge's dominant direction. */
  function silhouette(grid, cols, rows) {
    for (var row = 0; row < rows; row++) {
      for (var col = 0; col < cols; col++) {
        var i = row * cols + col, cell = grid[i]
        if (!cell || !cell.captured) continue
        var horizontal = (col > 0 && lit(grid[i - 1])) || (col < cols - 1 && lit(grid[i + 1]))
        var vertical = (row > 0 && lit(grid[i - cols])) || (row < rows - 1 && lit(grid[i + cols]))
        if (horizontal) cell.stroke = '|'
        else if (vertical) cell.stroke = '-'
        else if ((col > 0 && row > 0 && lit(grid[i - cols - 1])) || (col < cols - 1 && row < rows - 1 && lit(grid[i + cols + 1]))) cell.stroke = '\\'
        else if ((col < cols - 1 && row > 0 && lit(grid[i - cols + 1])) || (col > 0 && row < rows - 1 && lit(grid[i + cols - 1]))) cell.stroke = '/'
      }
    }
  }
  function create(canvas, input) {
    var config = options(input), ctx = canvas.getContext('2d', { alpha: false })
    if (!ctx) throw Error('Canvas 2D unavailable')
    var disposed = false, raf = 0, buildTimer = 0, generation = 0, elapsed = 0, previous = 0, lastDraw = -Infinity
    var visible = true, frames = 0, totalPaint = 0, maxPaint = 0, buildCpu = 0, w = 0, h = 0, cols = 0, rows = 0, grid = [], cw = 8, ch = 12, ready = false, mode = 'dark'
    var motion = window.matchMedia('(prefers-reduced-motion: reduce)')
    function draw() {
      if (disposed || !w || !h || !ready) return
      var start = performance.now(), light = mode === 'light'
      var horizon = SHADOW_SHARE * Math.min(w, h) / 2, cx = w / 2, cy = h / 2
      ctx.fillStyle = light ? '#edf0f4' : '#030509'
      ctx.fillRect(0, 0, w, h)
      if (light) {
        ctx.beginPath()
        ctx.arc(cx, cy, horizon, 0, Math.PI * 2)
        ctx.fillStyle = HORIZON_INK
        ctx.fill()
      }
      ctx.font = '600 ' + Math.round(ch * .95) + 'px ui-monospace, Consolas, monospace'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      for (var i = 0; i < grid.length; i++) {
        var cell = grid[i], glyph = '', value = 0, bucket = 0
        if (cell.stroke) {
          glyph = cell.stroke
          ctx.fillStyle = light ? '#8d7a63' : '#8a5228'
        } else if (cell.radius || cell.ring) {
          value = shade(cell, elapsed, config.brightness)
          if (value > .004) {
            var index = Math.min(GLYPHS.length - 1, Math.floor(Math.pow(value, .62) * (GLYPHS.length - 1) + .5))
            glyph = GLYPHS.charAt(index)
            bucket = Math.min(11, Math.max(0, Math.floor(value * 12)))
            var luminous = !light
            if (light) {
              var qx = (i % cols + .5) * cw - cx, qy = (((i / cols) | 0) + .5) * ch - cy
              luminous = qx * qx + qy * qy <= horizon * horizon
            }
            ctx.fillStyle = luminous ? DARK[bucket] : LIGHT[bucket]
          }
        } else if (cell.star) {
          var twinkle = .55 + .45 * Math.sin(elapsed * .45 + cell.star.phase)
          var level = Math.min(STARS.length - 1, Math.max(0, Math.floor(cell.star.mag * twinkle * 3)))
          glyph = STARS.charAt(level)
          ctx.fillStyle = light ? '#9ba5b3' : '#2b3f57'
        }
        if (glyph && glyph !== ' ') ctx.fillText(glyph, (i % cols + .5) * cw, (((i / cols) | 0) + .5) * ch, cw)
      }
      var ms = performance.now() - start
      frames++; totalPaint += ms; maxPaint = Math.max(maxPaint, ms)
    }
    function running() { return !disposed && ready && visible && !document.hidden && !motion.matches && config.speed > 0 && w > 0 && h > 0 }
    function stop() { if (raf) cancelAnimationFrame(raf); raf = 0; previous = 0 }
    function tick(now) {
      raf = 0
      if (!running()) return
      if (previous) elapsed += Math.min((now - previous) / 1000, .1) * config.speed
      previous = now
      var interval = 1000 / config.fps, delta = now - lastDraw
      if (delta >= interval - .5) { draw(); lastDraw = Number.isFinite(delta) && delta >= interval ? now - delta % interval : now }
      raf = requestAnimationFrame(tick)
    }
    function sync() { stop(); if (!document.hidden && visible) draw(); if (running()) raf = requestAnimationFrame(tick) }
    function resize() {
      var rect = canvas.getBoundingClientRect(), nw = rect.width || 0, nh = rect.height || 0
      /* 空容器的 rect 不会是负数，但会以 0 出现（挂载瞬间、容器被隐藏）：0 下没有任何格子可
         画，'Math.floor(w / cw)' 会算出 0 列，'new Array(0)' 之后的行循环写 'next[-1]' 直接抛
         「Invalid array length」，create() 整个挂不上。方框为 0 时先停在这里，等容器的
         ResizeObserver 再来一次。 */
      if (!(nw > 0) || !(nh > 0)) { w = 0; h = 0; ready = false; stop(); return }
      if (nw === w && nh === h && ready) return
      w = nw; h = nh; ready = false; stop(); generation++
      var mine = generation
      if (buildTimer) clearTimeout(buildTimer)
      var dpr = Math.min(window.devicePixelRatio || 1, 1.5)
      canvas.width = Math.max(1, Math.round(w * dpr))
      canvas.height = Math.max(1, Math.round(h * dpr))
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      cw = Math.max(config.cellWidth, Math.sqrt(w * h / (config.maxCells * 1.5)))
      cols = Math.max(1, Math.floor(w / cw)); cw = w / cols
      rows = Math.max(1, Math.floor(h / (cw * 1.5))); ch = h / rows
      var next = new Array(cols * rows), row = 0, short = Math.max(1, Math.min(w, h))
      buildCpu = 0
      canvas.dataset.blackHoleState = 'building'
      function chunk() {
        buildTimer = 0
        if (disposed || mine !== generation) return
        var start = performance.now()
        do {
          for (var col = 0; col < cols; col++) {
            var cell = trace((2 * (col + .5) * cw - w) / short, (h - 2 * (row + .5) * ch) / short, config.angle)
            if (!cell.radius && !cell.ring && !cell.captured) cell.star = star(col, row)
            next[row * cols + col] = cell
          }
          row++
        } while (row < rows && performance.now() - start < 6)
        buildCpu += performance.now() - start
        if (row < rows) buildTimer = setTimeout(chunk, 0)
        else { silhouette(next, cols, rows); grid = next; ready = true; canvas.dataset.blackHoleState = 'ready'; sync() }
      }
      if (w > 0 && h > 0) buildTimer = setTimeout(chunk, 0)
    }
    var observer = new ResizeObserver(resize); observer.observe(canvas)
    var intersection = new IntersectionObserver(function (entries) { visible = entries[0].isIntersecting; sync() }); intersection.observe(canvas)
    function applyMode() {
      var host = document.body || document.documentElement, scheme = getComputedStyle(host).colorScheme
      mode = scheme.includes('light') && !scheme.includes('dark') ? 'light' : 'dark'; sync()
    }
    var theme = new MutationObserver(applyMode)
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'class', 'data-ds-dark-theme'] })
    if (document.body) theme.observe(document.body, { attributes: true, attributeFilter: ['style', 'class', 'data-ds-dark-theme'] })
    document.addEventListener('visibilitychange', sync)
    motion.addEventListener('change', sync)
    applyMode(); resize()
    return {
      update: function (next) {
        var old = config
        config = options(Object.assign({}, config, next))
        if (config.angle !== old.angle || config.cellWidth !== old.cellWidth || config.maxCells !== old.maxCells) { ready = false; resize() } else sync()
      },
      setMode: function (next) { mode = next === 'light' ? 'light' : 'dark'; sync() },
      stats: function () { return { frames: frames, width: canvas.width, height: canvas.height, cells: cols * rows, columns: cols, rows: rows, meanPaintMs: frames ? totalPaint / frames : 0, maxPaintMs: maxPaint, buildCpuMs: buildCpu, running: running(), ready: ready, reducedMotion: motion.matches, config: Object.assign({}, config) } },
      dispose: function () {
        if (disposed) return
        disposed = true; generation++; stop()
        if (buildTimer) clearTimeout(buildTimer)
        observer.disconnect(); intersection.disconnect(); theme.disconnect()
        document.removeEventListener('visibilitychange', sync)
        motion.removeEventListener('change', sync)
        grid = []
        canvas.dataset.blackHoleState = 'disposed'
      }
    }
  }
  var DARK = ['#2a1a12', '#3d2719', '#4f321d', '#623f22', '#774c27', '#8d5a2e', '#a46a36', '#bb7c40', '#d0904b', '#e3a65c', '#f2bd75', '#ffe0a8']
  var LIGHT = ['#b3a291', '#a8917b', '#9c8063', '#906e4d', '#855e38', '#784d28', '#6b3e1d', '#5f3219', '#532715', '#471f12', '#3c180f', '#30110b']
  /* 黑洞只存在于「对话区 + 右栏」这一块视图里，左栏是一张独立的纸。
     以前画布 'position: fixed; inset: 0' 铺满整个视口：黑洞连左栏一起画，只靠左栏自己的漆
     把它盖住；那条漆一旦被清掉，洞就漏进左栏。现在取景由两个元素共同决定：

       column  '[data-slot=main]' 所在的那一列（会话正文、输入卡都在这列里）。左边界取它的
               左边缘，所以左栏不进入取景。
       frame   '[data-slot=root]' 的唯一子元素；右栏是 column 的兄弟，和它同包在 frame 里。
               右边界取 frame 的右边缘，所以右栏在取景内，不会被在右栏边缘切一刀。

     真机 DOM 已核对（2026-10-29，DSH Web 1256px 视口）：frame 与 column 之间还隔着两层
     无属性 div，所以 '[data-slot=root] > *:has(> [data-slot=main])' 匹配不到任何节点；当前
     结构是 '[data-slot=root] > * > div:has(> [data-slot=main])'（column，实测 x=280、宽 976）
     外面包着 '[data-slot=root] > *'（frame，实测 x=0、宽 1256）。

     画布仍是 fixed，rect 由容器量；z-index 保持 -1，veil 由 body::after 那一层负责，画布
     不需要再叠。右栏收起/展开只改 frame 里那两列的宽度，column 的 ResizeObserver 会触发
     重算，黑洞跟着重新取景。 */
  function mount() {
    if (typeof document === 'undefined' || !document.body) return
    var canvas = document.createElement('canvas')
    canvas.setAttribute('aria-hidden', 'true')
    canvas.dataset.uniBlackHole = ''
    canvas.style.cssText = 'position:fixed;z-index:-1;pointer-events:none;'
    document.body.prepend(canvas)
    var renderer, column = null, frame = null
    try { renderer = create(canvas); document.body.setAttribute('data-uni-black-hole', '') }
    catch (error) { canvas.remove(); console.warn('Universe ASCII black hole fallback:', error.message); return }
    function findColumn() {
      return document.querySelector("[data-slot='root'] > * > div:has(> [data-slot='main'])") ||
        document.querySelector("[data-slot='main']")
    }
    function findFrame() {
      return document.querySelector("[data-slot='root'] > *") || column
    }
    function follow() {
      var nextColumn = findColumn()
      var nextFrame = nextColumn ? findFrame() : null
      if (nextColumn === column && nextFrame === frame) return
      if (column) observer.unobserve(column)
      if (frame) observer.unobserve(frame)
      column = nextColumn
      frame = nextFrame
      /* 还没挂出主区时按视口占位，下一轮页面切换会再进来一次。 */
      if (column) observer.observe(column)
      if (frame) observer.observe(frame)
      place()
    }
    function place() {
      var area = column
        ? column.getBoundingClientRect()
        : { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight }
      var edge = frame ? frame.getBoundingClientRect() : area
      var right = Math.max(area.left + area.width, edge.left + edge.width)
      canvas.style.left = area.left + 'px'
      canvas.style.top = edge.top + 'px'
      canvas.style.width = Math.max(0, right - area.left) + 'px'
      canvas.style.height = edge.height + 'px'
    }
    var observer = new ResizeObserver(place)
    var shell = new MutationObserver(follow)
    shell.observe(document.body, { childList: true, subtree: true })
    follow()
    return function () {
      renderer.dispose(); shell.disconnect()
      if (column) observer.unobserve(column)
      if (frame) observer.unobserve(frame)
      observer.disconnect(); canvas.remove()
      document.body.removeAttribute('data-uni-black-hole')
    }
  }
  return { create: create, mount: mount, options: options, trace: trace, shade: shade, glyphs: GLYPHS + STARS + STROKES }
})()
