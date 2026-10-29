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
  var SHADOW_SHARE = 0.34
  var HORIZON_INK = '#101725'
  var TAN_HALF = B_CRIT / DISTANCE / SHADOW_SHARE
  var RING_WIDTH = 0.32
  var SWIRL = 16
  /* 取景位移：每帧把画布整体平移这么多像素再画，洞心就离开视图中心。
     默认 0 = 居中（新会话页）。对话页背景要的是「洞向右走出画面、只留盘左半边的镜环弧」，
     具体数值由 viewXFor() 从视口宽度和半径反算，y 恒为 0。 */
  var VIEW_LIMIT = 4000
  function options(input) {
    input = input || {}
    function number(key, min, max) {
      var n = Number(input[key])
      return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : defaults[key]
    }
    return { angle: number('angle', 10, 50), fps: number('fps', 10, 60),
      maxCells: number('maxCells', 2000, 24000), cellWidth: number('cellWidth', 6, 16),
      brightness: number('brightness', .15, 2), speed: number('speed', 0, 2),
      viewX: number('viewX', -VIEW_LIMIT, VIEW_LIMIT), viewY: number('viewY', -VIEW_LIMIT, VIEW_LIMIT) }
  }
  /* 洞在画布坐标里的圆心。投影仍以画布中心为原点（几何都在 trace() 里按 u,v 归一），
     位移只发生在绘制时刻，所以换取景不需要重算任何格子。 */
  function viewOf(w, h, config) {
    var dx = Number(config.viewX) || 0, dy = Number(config.viewY) || 0
    /* 半径与画布尺寸挂在 view() 的包装里；viewOf 只回答「洞心在哪」。
       写成两行是为了让异常和日志里的行号稳定指向下面那一句。 */
    var x = (w || 0) / 2 + dx, y = (h || 0) / 2 + dy
    return { x: x, y: y }
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
    var config = options(input), ctx = canvas.getContext('2d', { alpha: true })
    if (!ctx) throw Error('Canvas 2D unavailable')
    var disposed = false, raf = 0, buildTimer = 0, generation = 0, elapsed = 0, previous = 0, lastDraw = -Infinity
    var visible = true, frames = 0, totalPaint = 0, maxPaint = 0, buildCpu = 0, w = 0, h = 0, cols = 0, rows = 0, grid = [], cw = 8, ch = 12, ready = false, mode = 'dark', applied = false
    /* dpr 必须在 create() 这一层：draw() 用它算位移变换，resize() 用它定缓冲区尺寸，
       以前它只活在 resize() 里，位移那行一跑到就是 ReferenceError。 */
    var dpr = 1
    var motion = window.matchMedia('(prefers-reduced-motion: reduce)')
    function draw() {
      if (disposed || !w || !h || !ready) return
      var start = performance.now(), light = mode === 'light'
      var horizon = SHADOW_SHARE * Math.min(w, h) / 2
      /* 圆心从 viewOf() 拿：它已经含了位移，而位移要靠 setTransform 生效，所以下面画字之前
         必须把「含位移的圆心」减去位移换回未平移的画布坐标。直接拿 view.x 当画布坐标只在
         viewX = 0 时成立 —— 对话页一让洞出画，整个盘的格子就会被再推一次位移，整片跑到右边去。 */
      var view = viewOf(w, h, config), cx = view.x, cy = view.y
      var baseX = cx - (config.viewX || 0), baseY = cy - (config.viewY || 0)
      /* view() 的包装里有半径，这里只取圆心；半径按同一公式就地算。 */
      var shifted = !!(config.viewX || config.viewY)
      /* 画布透明（2026-10-29 终版）：左栏透明、透出 body 那层底，主区也必须透出同一层，
         否则画布的不透明清屏色与左栏的底色永远差一档 —— 前面几次「割裂」都是这么来的。
         底色交给 body，画布每帧只清上一帧。清屏按缓冲区像素走：这里 ctx 还带着 dpr 变换，
         用 w × h 当坐标只擦掉左上角一小块，其余格子会叠在上一帧上。 */
      ctx.save()
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.restore()
      /* 取景位移在这里落地：画布本身不动，绘制原点整体平移。setTransform 重置成单位阵
         之后必须把 dpr 重新乘回去，否则高 DPI 下字会缩一半。
         偏移量不能直接读 config：options() 对没传的键会保留上一轮的值，首次 update 只给
         viewX 时 viewY 是 undefined，乘出来 NaN —— setTransform 收到 NaN 在浏览器里是
         静默忽略整条变换，新会话页会一直在错的原点下画。 */
      if (shifted) ctx.setTransform(dpr, 0, 0, dpr, dpr * (Number(config.viewX) || 0), dpr * (Number(config.viewY) || 0))
      if (light) {
        ctx.beginPath()
        ctx.arc(baseX, baseY, horizon, 0, Math.PI * 2)
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
              var qx = (i % cols + .5) * cw - baseX, qy = (((i / cols) | 0) + .5) * ch - baseY
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
      /* 位移只活在这一个函数里：帧末复位成居中，下一次进 draw() 再按当时的 config 决定。
         不复位的话，从对话页反向切回新会话页时，第一帧仍带着旧位移。 */
      if (shifted) ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
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
      dpr = Math.min(window.devicePixelRatio || 1, 1.5)
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
    /* theme.css paints the left column with this colour instead of a second veil, so
       the sidebar and the canvas share one source of truth. It is published here, not
       declared in the sheet, because the clear colour below is what the sidebar has to
       match -- and this file already owns that pair. */
    function publishVoid() {
      var root = document.documentElement
      if (!root || !root.style || typeof root.style.setProperty !== 'function') return
      var next = mode === 'light' ? '#edf0f4' : '#030509'
      /* 值没变就别写：documentElement.style 上的每次写入都会喂回下面那个 observer。 */
      var current = typeof root.style.getPropertyValue === 'function' ? root.style.getPropertyValue('--cp-void') : null
      if (current === next) return
      root.style.setProperty('--cp-void', next)
    }
    function applyMode() {
      var host = document.body || document.documentElement, scheme = getComputedStyle(host).colorScheme
      var next = scheme.includes('light') && !scheme.includes('dark') ? 'light' : 'dark'
      /* 主题层的 style/class/属性变化（亮暗档切换、令牌改写）命中的是同一个 observer；
         模式没变就别 sync()：那是一次 16000 格的全量绘制，还会把 elapsed 的差分清零。 */
      if (applied && next === mode) return
      applied = true
      mode = next; publishVoid(); sync()
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
      view: function () {
        var v = viewOf(w, h, config)
        return { x: v.x, y: v.y, radius: SHADOW_SHARE * Math.min(w, h) / 2, width: w, height: h }
      },
      setMode: function (next) { mode = next === 'light' ? 'light' : 'dark'; publishVoid(); sync() },
      stats: function () { return { frames: frames, width: canvas.width, height: canvas.height, cells: cols * rows, columns: cols, rows: rows, meanPaintMs: frames ? totalPaint / frames : 0, maxPaintMs: maxPaint, buildCpuMs: buildCpu, running: running(), ready: ready, reducedMotion: motion.matches, config: Object.assign({}, config) } },
      resize: function () { resize() },
      dispose: function () {
        if (disposed) return
        disposed = true; generation++; stop()
        if (buildTimer) clearTimeout(buildTimer)
        observer.disconnect(); intersection.disconnect(); theme.disconnect()
        document.removeEventListener('visibilitychange', sync)
        motion.removeEventListener('change', sync)
        grid = []
        canvas.dataset.blackHoleState = 'disposed'
        var root = document.documentElement
        if (root && root.style && typeof root.style.removeProperty === 'function') root.style.removeProperty('--cp-void')
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
    canvas.style.cssText = 'position:fixed;z-index:-1;pointer-events:none;'
    var renderer, column = null, frame = null
    canvas.dataset.uniBlackHole = ''
    document.body.prepend(canvas)
    try { renderer = create(canvas); document.body.setAttribute('data-uni-black-hole', '') }
    catch (error) { canvas.remove(); console.warn('Universe ASCII black hole fallback:', error.message); return }
    /* 页背景转场要冻结/恢复渲染循环、读 ready，所以在画布上挂一个驱动句柄，
       和 deep-space 的 canvas.__uniDeepSpace 同一形状。 */
    canvas.__uniBlackHole = renderer
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
      /* 取景框固定成整个 frame（整窗宽、标题栏以下的整高），两页不变。
         以前框是「对话列左边到 frame 右边」，出画时要把框换成视口 —— 换框就要重建网格，
         重建期间画布是空的、CSS 还把 canvas 藏起来，洞会闪一下，正好闪在转场最显眼的那
         一帧。现在框不动，位置全交给 viewX 表达；左栏的隔离改由 mask 的 alpha 斜坡负责
         （setEdge() 推 --uni-hole-edge），所以洞不会漏进左栏。 */
      var edge = frame ? frame.getBoundingClientRect() : null
      canvas.style.left = '0px'
      canvas.style.top = (edge ? edge.top : 0) + 'px'
      canvas.style.width = (typeof window === 'undefined' ? 0 : window.innerWidth) + 'px'
      canvas.style.height = (edge ? edge.height : (typeof window === 'undefined' ? 0 : window.innerHeight)) + 'px'
      setEdge()
    }
    /* 左栏隔离的界线：斜坡起点压在对话列左缘，新会话页左栏那一侧 alpha 为 0；
       对话页收到 0（弧已经挪到视口右缘，左栏那片根本不用再隔离）。
       theme.css 里 @property 注册过 <length>，所以这一格由 CSS transition 连续推过去，
       边界是溶解的而不是跳一下。 */
    function setEdge() {
      /* 注意 place() 在挂载流程里比下面的 arc 状态块先跑，那时 arcSide 还没赋值 ——
         「没赋值」和 false 同义（还没出画），所以这里显式跟 true 比，别写成 !arcSide。 */
      var left = 0
      if (arcSide !== true && column) left = column.getBoundingClientRect().left || 0
      canvas.style.setProperty('--uni-hole-edge', left + 'px')
    }
    function sized() { place(); resize() }
    var observer = new ResizeObserver(sized)
    var shell = new MutationObserver(follow)
    shell.observe(document.body, { childList: true, subtree: true })
    /* 先安家再交给 ResizeObserver 守。顺序反了会出事：'resize()' 在画布还没尺寸时会把
       'w / h' 清成 0 并 'stop()'，而构造时对已观察元素的首次回调各家引擎给不给不保证，
       画布会停在 ready=false 上再也不动。所以这里自己先走一次 place + resize。
       resize 只能走渲染器入口，'create()' 内部那个 'resize' 是闭包，挂载侧看不见。 */
    function resize() { renderer.resize() }
    follow()
    resize()
    observer.observe(canvas)

    /* 出画 / 回位（2026-10-29 甲方案，用户原话 m02133「甲，弧就停在现在的位置就行」）：
       洞不参与透明度交叉淡化，全程可见，只把取景连续地推过去。
       为此取景框固定成整个 frame（见 place()），换页不改画布尺寸 —— 改尺寸要重建近两万个
       格子，重建期间画布是空的、CSS 还会把 canvas 藏起来，洞会闪一下，正好闪在转场最显眼
       的那一帧。所以两页共用同一块画布、同一份网格，只有 viewX / 亮度 / 速度在变，
       而这三样在 update() 里都只走 sync()，不重建，逐帧几乎免费。
       洞心落点：新会话页 = 对话列中心（画布变宽后要正补偿），
       对话页 = 视口右缘那条线（见 viewXFor），右半出画，只留左半边黑漆漆的圆。
       位移必须从画布宽度反算：半径和宽度不是同一个量。 */
    var ARC_BRIGHTNESS = 0.4
    var ARC_SPEED = 0.35
    var arcRaf = 0
    var arcSide = false
    var live = { viewX: 0, brightness: defaults.brightness, speed: defaults.speed }

    /* 镜像和渲染器一起写：arcTo() 要靠 live 记住「推到哪儿了」，被打断才能接着推。 */
    function apply(next) {
      if (next) {
        if (next.viewX !== undefined) live.viewX = next.viewX
        if (next.brightness !== undefined) live.brightness = next.brightness
        if (next.speed !== undefined) live.speed = next.speed
      }
      renderer.update({ viewX: live.viewX, brightness: live.brightness, speed: live.speed })
    }
    function arcStop() {
      if (arcRaf) cancelAnimationFrame(arcRaf)
      arcRaf = 0
    }
    function boxWidth() {
      var width = parseFloat(canvas.style.width) || 0
      if (width > 0) return width
      return typeof window === 'undefined' ? 0 : window.innerWidth
    }
    /* 对话列中心：和当年按列取景时同一结果，回程要让洞精确落回原处。 */
    function columnCenterX() {
      if (typeof window === 'undefined') return boxWidth() / 2
      var area = column ? column.getBoundingClientRect() : null
      if (!area) return window.innerWidth / 2
      var edge = frame ? frame.getBoundingClientRect() : area
      var right = Math.max(area.left + area.width, edge.left + edge.width)
      return area.left + Math.max(0, right - area.left) / 2
    }
    /* 两个端点只差这一个数字：洞心该落在屏幕的哪个 x。
       对话页只露**左半边**（2026-10-29 用户两次点名：「黑洞在左边会挡住左侧栏的文字，挪到右边」
       →「只显示左半边黑洞」）：洞心正好压在视口右缘，右半出画，看得见的是一整个半圆，
       切面就贴在窗口右边。左侧栏那片字因此干干净净。
       不是「露出一点点弧」：圆心要落在右缘这条线上，多一像素少一像素都读成「只露一条边」。 */
    function viewXFor(side) {
      var half = boxWidth() / 2
      if (!side) return columnCenterX() - (parseFloat(canvas.style.left) || 0) - half
      return boxWidth() - half
    }
    function arcTo(side, ms) {
      arcStop()
      arcSide = !!side
      if (arcSide) document.body.setAttribute('data-uni-sky-mode', '')
      else document.body.removeAttribute('data-uni-sky-mode')
      setEdge()
      var toX = viewXFor(arcSide)
      var toBright = arcSide ? ARC_BRIGHTNESS : defaults.brightness
      var toSpeed = arcSide ? ARC_SPEED : defaults.speed
      if (!(ms > 0) || typeof requestAnimationFrame !== 'function') {
        apply({ viewX: toX, brightness: toBright, speed: toSpeed })
        return
      }
      var fromX = live.viewX, fromBright = live.brightness, fromSpeed = live.speed
      var origin = 0
      function step(now) {
        arcRaf = 0
        if (!origin) origin = now
        var k = (now - origin) / ms
        if (k > 1) k = 1
        /* easeOutCubic：起手快、落点慢，读作镜头推过去停住，而不是匀速平移。 */
        var e = 1 - Math.pow(1 - k, 3)
        apply({
          viewX: fromX + (toX - fromX) * e,
          brightness: fromBright + (toBright - fromBright) * e,
          speed: fromSpeed + (toSpeed - fromSpeed) * e,
        })
        if (k < 1) { arcRaf = requestAnimationFrame(step); return }
        apply({ viewX: toX, brightness: toBright, speed: toSpeed })
      }
      arcRaf = requestAnimationFrame(step)
    }
    canvas.__uniArc = function (side, ms) { arcTo(!!side, Number(ms) || 0) }
    canvas.__uniSkyMode = function () { arcTo(true, 0) }
    canvas.__uniSkyModeOff = function () { arcTo(false, 0) }
    apply({ viewX: viewXFor(false) })

    function onResize() {
      /* 转场跑一半时窗口变了：让这一帧落定，下一帧量到的新尺寸再接管。 */
      if (arcRaf) return
      place()
      apply({ viewX: viewXFor(arcSide) })
    }
    window.addEventListener('resize', onResize)

    return function () {
      arcStop()
      renderer.dispose(); shell.disconnect()
      if (column) observer.unobserve(column)
      if (frame) observer.unobserve(frame)
      observer.disconnect(); canvas.remove()
      window.removeEventListener('resize', onResize)
      document.body.removeAttribute('data-uni-sky-mode')
      document.body.removeAttribute('data-uni-black-hole')
    }
  }
  return { create: create, mount: mount, options: options, viewOf: viewOf, trace: trace, shade: shade, glyphs: GLYPHS + STARS + STROKES, debugSource: 'v3' }
})()
