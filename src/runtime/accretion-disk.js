/* Accretion disk — the ASCII cell layer over the geodesic kernel
 * ---------------------------------------------------------------------------------
 * What this file owns: the glyph alphabet, the grid, the 11-step tone mapping, the
 * per-frame animation of the disk (differential rotation and finite-lived,
 * sheared brightness patches) and the two canvases' mount/teardown on the page.
 *
 * What it does NOT own: the geodesics. Intersections and relativistic transfer
 * weights come from UniverseGeodesic; this layer supplies disk emission and turns
 * the resulting brightness into a character. The hole (shadow disc + photon ring) is a separate canvas entirely
 * (src/runtime/hole.js) and is only consulted here for the ring-band keep-out.
 */
var UniverseAccretionDisk = (function () {
  /* 物理常量从测地线内核借：本层不再重算任何度规量。 */
  var INNER = UniverseGeodesic.inner, OUTER = UniverseGeodesic.outer
  var CRIT_RATIO = UniverseGeodesic.ratio, STEP_BUDGET = UniverseGeodesic.budget
  var trace = UniverseGeodesic.trace
  var GLYPHS = ' .-:;+*o#%@' /* 11 档，索引 0..10；lastGlyph = length - 1 */
  var STROKES = '|-/\\'
  var defaults = { angle: 15, fps: 60, maxCells: 16000, cellWidth: 6, brightness: 1, speed: 1 }
  /* Schwarzschild circular-orbit law: Omega = r^(-3/2), with one visual time scale.
     ORBIT_RATE is a calibration knob (not a change to the metric or ray.g4).
     Hot-spot/arc motivation: Schnittman & Bertschinger, astro-ph/0309458;
     MHD variability motivation: Schnittman et al., astro-ph/0606615.
     These compact emission patches are a phenomenological model, NOT an MHD solver. */
  var ORBIT_RATE = 16, TAU = Math.PI * 2
  var PATCH_COUNT = 24, patchTime = NaN, patches = []
  function orbit(r) { return ORBIT_RATE / Math.pow(r, 1.5) }
  function patchesAt(time) {
    if (time === patchTime) return patches
    patchTime = time
    for (var i = 0; i < PATCH_COUNT; i++) {
      var radius = INNER + (OUTER - INNER) * (i + .5) / PATCH_COUNT
      var life = .9 * TAU / orbit(radius)
      var clock = time / life + (grainKey(i, -1) >>> 0) / 4294967296
      var cycle = Math.floor(clock), age = (clock - cycle) * life
      var seed = (grainKey(i, cycle) >>> 0) / 4294967296
      var p = patches[i] || (patches[i] = {})
      p.radius = radius
      p.age = age
      p.phi = seed * TAU
      p.radial = 1 / (radius * .24)
      p.angular = 1 / (.45 + .5 * seed)
      var fade = Math.sin(Math.PI * age / life)
      p.amplitude = (1.5 + seed) * fade * fade
    }
    return patches
  }
  function patchAt(p, r, phi, omega) {
    var dr = (r - p.radius) * p.radial
    if (Math.abs(dr) >= 1) return 0
    /* Advect EACH radius, not just the centre: a finite-width knot shears into an arc. */
    var dp = phi - p.phi - omega * p.age
    dp -= TAU * Math.round(dp / TAU)
    dp *= p.angular
    if (Math.abs(dp) >= 1) return 0
    var radial = 1 - dr * dr, angular = 1 - dp * dp
    return p.amplitude * radial * radial * radial * angular * angular * angular
  }
  function emission(r, phi, time) {
    var active = patchesAt(time), omega = orbit(r), value = .32
    // ponytail: 24 compact patches, not magnetic turbulence; use offline MHD fields for that.
    for (var i = 0; i < active.length; i++) value += patchAt(active[i], r, phi, omega)
    return value
  }
  /* 显示映射的 gamma（第三十阶段）。shade 返回的物理亮度一个字节都不改：契约测试要求
     盘发射项对 g⁴ 严格线性、对 S 严格线性，色调映射写进那里会同时破坏两条。这一档只决定
     「同一批亮度怎么落进 11 档字符」，不参与任何物理解算。
     取 .45 的理由：g⁴ 在整盘上跨 59 倍（逆行侧 0.06、顺行侧 3.55），旧的 .62 把暗侧
     压在 index 3 附近，左上角只剩稀疏的点和短横。.45 把左右两半的平均档位从 3.0 / 6.1
     抬到 4.1 / 6.9，落字率 99.3% → 100%，满档 @ 只从 2.7% 升到 4.1%。 */
  var TONE_GAMMA = .45
  /* 光子环让位：环由 hole.js 那块画布画成一条连续细线，ASCII 字符压在上面就成了一圈
     零散杂点。环外沿随方位在 140..215px 之间移动（下方被前景盘拉出一段外扩），整圈用一个
     半径会把没有环的上方连同前景盘一起挖空，所以洞那层烘焙时按方位扇区记下「环可见区的
     最外半径」（edge 数组），这里逐格查表，只跳过环真的有像素的那一段。
     扇区数不在这里另定义：直接用洞那层返回的 edge.length，两边永远不会数错。 */
  /* 取景位移：每帧把画布整体平移这么多像素再画，洞心就离开视图中心。
     默认 0 = 居中（新会话页）。对话页背景要的是「洞向右走出画面、只留盘左半边的镜环弧」，
     x 由 viewXFor() 从视口宽度和半径反算。y 在两个页面都是 0，只有转场途中抬起来走弧线
     （见 arcTo 的 bow）：去程是同一个洞被摆到右缘，不是换上第二颗。 */
  var VIEW_LIMIT = 4000
  function options(input) {
    input = input || {}
    function number(key, min, max) {
      var n = Number(input[key])
      return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : defaults[key]
    }
    return { angle: number('angle', 10, 50), fps: number('fps', 10, 240),
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
  /* Only the disk emissivity changes. The radial envelope, g^4 transfer, exposure,
     tone map, ray intersections and ring-band keep-out remain separate and unchanged. */
  function shade(ray, time, brightness) {
    var flux = 0
    if (ray.radius) {
      var r = ray.radius
      var edge = smooth(INNER - .2, INNER + .8, r) * (1 - smooth(14.5, 16.2, r))
      var surface = emission(r, ray.phi, time)
      flux += edge * Math.pow(INNER / r, 2) * surface * ray.g4 * 3.2
    }
    if (!(flux > 0)) return 0
    return 1 - Math.exp(-flux * brightness)
  }
  /* Stable seed for patch births: seeking to the same time gives the same field. */
  function grainKey(a, b) {
    var h = Math.imul(a, 374761393) ^ Math.imul(b, 668265263)
    h = Math.imul(h ^ (h >>> 13), 1274126177)
    return h ^ (h >>> 16)
  }

  /* holeLayer 是洞那层（hole.js）的渲染器：阴影圆、光子环与它的方位包络都由那边负责，
     这里只读它的半径与环包络给盘字让位。不传就是纯字符模式（测试桩、精简 DOM、拆分前的
     旧调用点），此时没有让位可做，落字照旧。 */
  function create(canvas, input, holeLayer) {
    var config = options(input), renderer = null, initialError = null
    try { renderer = UniverseAccretionGPU.create(canvas, GLYPHS, DARK, LIGHT) } catch (error) { initialError = error }
    var disposed = false, failed = false, raf = 0, buildTimer = 0, generation = 0, elapsed = 0, previous = 0, lastDraw = -Infinity
    var visible = true, frames = 0, totalPaint = 0, maxPaint = 0, buildCpu = 0, w = 0, h = 0, cols = 0, rows = 0, cw = 8, ch = 12, dpr = 1
    var ready = false, mode = 'dark', applied = false, arcAlpha = 1, modeHook = null, buildDiag = null, size = null, failure = null
    var motion = window.matchMedia('(prefers-reduced-motion: reduce)'), rAFGap = 0
    canvas.dataset.blackHoleBackend = 'webgl2'
    function running() { return !disposed && !failed && ready && visible && !document.hidden && !motion.matches && config.speed > 0 && w > 0 && h > 0 }
    function stop() { if (raf) cancelAnimationFrame(raf); raf = 0; previous = 0 }
    function fail(error) {
      if (disposed || failed) return
      failed = true; ready = false; generation++; stop()
      if (buildTimer) { clearTimeout(buildTimer); buildTimer = 0 }
      failure = error && error.message ? error.message : String(error)
      buildDiag = Object.assign({}, buildDiag, { state: 'failed', error: failure })
      canvas.dataset.blackHoleState = 'failed'; canvas.dataset.blackHoleError = failure
      if (renderer) renderer.dispose()
      if (typeof console !== 'undefined' && console.error) console.error('QUASAR GPU character layer stopped:', failure)
    }
    function draw() {
      if (disposed || failed || !w || !h || !ready) return
      var start = performance.now(), horizon = holeLayer ? holeLayer.radius() : CRIT_RATIO * Math.min(w, h) / 2
      var view = viewOf(w, h, config)
      try {
        renderer.refreshAtlas(size)
        renderer.draw(size, { horizon: horizon, ring: holeLayer ? holeLayer.ring() : null,
          baseX: view.x - (config.viewX || 0), baseY: view.y - (config.viewY || 0),
          viewX: Number(config.viewX) || 0, viewY: Number(config.viewY) || 0,
          brightness: config.brightness, light: mode === 'light', patches: patchesAt(elapsed) })
      } catch (error) { fail(error); return }
      var ms = performance.now() - start
      frames++; totalPaint += ms; maxPaint = Math.max(maxPaint, ms)
    }
    function tick(now) {
      raf = 0
      if (!running()) return
      var gap = previous ? now - previous : 0
      if (gap > 0 && gap < 200) rAFGap = rAFGap ? rAFGap * .7 + gap * .3 : gap
      if (previous) elapsed += Math.min((now - previous) / 1000, .1) * config.speed
      previous = now
      var interval = 1000 / config.fps, delta = now - lastDraw
      if (delta >= interval - .5) { draw(); lastDraw = Number.isFinite(delta) && delta >= interval ? now - delta % interval : now }
      if (running()) raf = requestAnimationFrame(tick)
    }
    function sync() { stop(); if (!document.hidden && visible) draw(); if (running()) raf = requestAnimationFrame(tick) }
    function resize() {
      if (disposed || failed) return
      var rect = canvas.getBoundingClientRect(), nw = rect.width || 0, nh = rect.height || 0, ndpr = Math.min(window.devicePixelRatio || 1, 1.5)
      if (!(nw > 0) || !(nh > 0)) {
        w = 0; h = 0; ready = false; generation++; stop()
        if (buildTimer) { clearTimeout(buildTimer); buildTimer = 0 }
        if (renderer) renderer.clear()
        return
      }
      if (nw === w && nh === h && ndpr === dpr && ready) return
      if (nw === w && nh === h && ready) {
        dpr = ndpr; canvas.width = Math.max(1, Math.round(w * dpr)); canvas.height = Math.max(1, Math.round(h * dpr))
        size.dpr = dpr; renderer.invalidateAtlas(); sync(); return
      }
      w = nw; h = nh; dpr = ndpr; ready = false; stop(); generation++
      var mine = generation
      if (buildTimer) clearTimeout(buildTimer)
      canvas.width = Math.max(1, Math.round(w * dpr)); canvas.height = Math.max(1, Math.round(h * dpr)); renderer.clear()
      cw = Math.max(config.cellWidth, Math.sqrt(w * h / (config.maxCells * 1.5)))
      cols = Math.max(1, Math.floor(w / cw)); cw = w / cols
      rows = Math.max(1, Math.floor(h / (cw * 1.5))); ch = h / rows
      size = { w: w, h: h, cw: cw, ch: ch, cols: cols, rows: rows, dpr: dpr }
      var layout = size, request = { width: w, height: h, cellWidth: cw, cellHeight: ch, columns: cols, rows: rows, angle: config.angle, budget: STEP_BUDGET }
      buildCpu = 0; buildDiag = { state: 'building', rays: cols * rows, exhausted: 0, retried: 0, unresolved: 0, budget: STEP_BUDGET, backend: 'webgl2' }
      canvas.dataset.blackHoleState = 'building'
      function alive() { return !disposed && !failed && mine === generation }
      buildTimer = setTimeout(function () {
        buildTimer = 0
        if (!alive()) return
        renderer.build(request, alive).then(function (result) {
          if (!alive()) { result.dispose(); return }
          buildDiag = Object.assign({}, result.diagnostics); buildCpu = result.diagnostics.submitCpuMs
          if (result.diagnostics.state !== 'ready') { result.dispose(); fail(Error('QUASAR GPU physical grid did not complete')); return }
          renderer.setGrid(result, layout); ready = true
          canvas.dataset.blackHoleState = 'ready'; sync()
        }).catch(function (error) { if (alive() && !error.cancelled) fail(error) })
      }, 0)
    }
    var observer = new ResizeObserver(resize); observer.observe(canvas)
    var intersection = new IntersectionObserver(function (entries) { visible = entries[0].isIntersecting; sync() }); intersection.observe(canvas)
    function publishVoid() {
      var root = document.documentElement
      if (!root || !root.style || typeof root.style.setProperty !== 'function') return
      var next = mode === 'light' ? '#edf0f4' : '#030509'
      var current = typeof root.style.getPropertyValue === 'function' ? root.style.getPropertyValue('--cp-void') : null
      if (current !== next) root.style.setProperty('--cp-void', next)
    }
    function applyMode() {
      var host = document.body || document.documentElement, scheme = getComputedStyle(host).colorScheme
      var next = scheme.includes('light') && !scheme.includes('dark') ? 'light' : 'dark'
      if (applied && next === mode) return
      applied = true; mode = next; publishVoid(); sync()
      if (modeHook) modeHook(mode)
    }
    function lost() { fail(Error('QUASAR WebGL2 context lost; refresh or re-enable the theme to retry')) }
    function fontChanged() { if (renderer && !disposed && !failed) { renderer.invalidateAtlas(); sync() } }
    var theme = new MutationObserver(applyMode)
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'class', 'data-ds-dark-theme'] })
    if (document.body) theme.observe(document.body, { attributes: true, attributeFilter: ['style', 'class', 'data-ds-dark-theme'] })
    document.addEventListener('visibilitychange', sync); motion.addEventListener('change', sync)
    canvas.addEventListener('webglcontextlost', lost)
    if (document.fonts && document.fonts.addEventListener) document.fonts.addEventListener('loadingdone', fontChanged)
    if (initialError) fail(initialError)
    applyMode(); resize()
    return {
      update: function (next) {
        var old = config; config = options(Object.assign({}, config, next))
        if (config.angle !== old.angle || config.cellWidth !== old.cellWidth || config.maxCells !== old.maxCells) { ready = false; resize() } else sync()
      },
      pose: function (next) { config = options(Object.assign({}, config, next)) },
      view: function () { var v = viewOf(w, h, config); return { x: v.x, y: v.y, radius: CRIT_RATIO * Math.min(w, h) / 2, width: w, height: h } },
      setMode: function (next) { applied = true; mode = next === 'light' ? 'light' : 'dark'; publishVoid(); sync(); if (modeHook) modeHook(mode) },
      setAlpha: function (next) { var value = Number(next); arcAlpha = value >= 0 && value <= 1 ? value : 1 },
      isLight: function () { return mode === 'light' }, onMode: function (fn) { modeHook = typeof fn === 'function' ? fn : null },
      stats: function () { return { frames: frames, width: canvas.width, height: canvas.height, cells: cols * rows, columns: cols, rows: rows,
        meanPaintMs: frames ? totalPaint / frames : 0, maxPaintMs: maxPaint, buildCpuMs: buildCpu, buildCpuScope: 'GPU submission only',
        rAFGapMs: rAFGap, running: running(), ready: ready, reducedMotion: motion.matches, config: Object.assign({}, config), alpha: arcAlpha,
        backend: 'webgl2', gpu: renderer ? renderer.stats() : null, error: failure,
        build: buildDiag ? Object.assign({}, buildDiag) : null, ring: holeLayer ? holeLayer.stats().ring : null } },
      resize: resize,
      dispose: function () {
        if (disposed) return
        disposed = true; generation++; stop()
        if (buildTimer) clearTimeout(buildTimer)
        observer.disconnect(); intersection.disconnect(); theme.disconnect()
        document.removeEventListener('visibilitychange', sync); motion.removeEventListener('change', sync); canvas.removeEventListener('webglcontextlost', lost)
        if (document.fonts && document.fonts.removeEventListener) document.fonts.removeEventListener('loadingdone', fontChanged)
        if (renderer) renderer.dispose()
        canvas.dataset.blackHoleState = 'disposed'
        var root = document.documentElement
        if (root && root.style && typeof root.style.removeProperty === 'function') root.style.removeProperty('--cp-void')
      }
    }
  }
  /* 两套墨都是「亮度→色阶」，索引 0 是盘最外缘（最冷），11 是近洞的热区。
     暗档照物理直觉走：外缘深棕、热区金白，跨度就是它的辨识度。
     亮档在浅底上不能更亮 —— 越亮越看不见 —— 所以热区不取金白而取赭金：
     色相压在 31°上下、饱和约 43%，对 #edf0f4 还有 3.1:1，黄在、但不飘成一片。
     外缘给足深褐（约 12:1）先立住盘面轮廓，中段沿同一支暖轴平滑升温，
     运动读的是「明度爬升 + 黄度升温」，不是整块发亮。 */
  var DARK = ['#2a1a12', '#3d2719', '#4f321d', '#623f22', '#774c27', '#8d5a2e', '#a46a36', '#bb7c40', '#d0904b', '#e3a65c', '#f2bd75', '#ffe0a8']
  var LIGHT = ['#342a23', '#3d3027', '#47372b', '#513e2f', '#5c4633', '#664d36', '#715539', '#7c5c3c', '#88653e', '#946d40', '#a07642', '#ad7f43']
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
    /* 洞那层（拆分第一阶段）：自己一块画布、自己的渲染器，只画阴影与光子环。
       属性名必须是 data-uni-hole-body —— client.js 的 HOLE_SELECTOR 是
       'canvas[data-uni-black-hole]' 且只取第一个匹配，两块画布若同属性，页面切换会
       拿到洞那层去冻结/恢复，盘那层就不动了。
       顺序：先 prepend 盘、再 prepend 洞 → 洞在前、盘在后；两个 z-index 都是 -1，
       同层的顺序决定堆叠，后画的盘于是压在光子环与阴影上，与拆分前同一块画布里的层次一致。 */
    var holeCanvas = null, holeLayer = null
    if (typeof UniverseHole !== 'undefined' && UniverseHole) {
      holeCanvas = document.createElement('canvas')
      holeCanvas.setAttribute('aria-hidden', 'true')
      holeCanvas.style.cssText = 'position:fixed;z-index:-1;pointer-events:none;'
      holeCanvas.dataset.uniHoleBody = ''
    }
    document.body.prepend(canvas)
    if (holeCanvas) document.body.prepend(holeCanvas)
    /* 洞那层挂不上不该连累盘：降级成纯字符模式（没有环让位，其余照旧）。 */
    try { holeLayer = holeCanvas ? UniverseHole.create(holeCanvas) : null }
    catch (error) {
      console.warn('Universe hole layer fallback:', error.message)
      holeLayer = null
      if (holeCanvas) { holeCanvas.remove(); holeCanvas = null }
    }
    try { renderer = create(canvas, undefined, holeLayer); document.body.setAttribute('data-uni-black-hole', '') }
    catch (error) {
      if (holeLayer) holeLayer.dispose()
      if (holeCanvas) holeCanvas.remove()
      canvas.remove()
      console.warn('QUASAR character layer could not mount:', error.message)
      return
    }
    /* 两块画布共用同一套位置、遮罩界线与转场关键帧，所以凡是逐块写 inline style 的地方
       都过这一张表，不重复写两遍（漏一块就是洞留在原地、盘飞走）。 */
    var layers = holeCanvas ? [canvas, holeCanvas] : [canvas]
    function setStyle(key, value) {
      for (var i = 0; i < layers.length; i++) layers[i].style[key] = key === 'opacity' && layers[i] === canvas ? String(diskOpacity(Number(value))) : value
    }
    /* 页背景转场要冻结/恢复渲染循环、读 ready，所以在画布上挂一个驱动句柄，
       和 deep-space 的 canvas.__uniDeepSpace 同一形状。 */
    canvas.__uniBlackHole = renderer
    function findColumn() {
      /* 0.2.2-rc.1 起所有 data-slot 宿主都是 display:contents：本身不产生盒子，
         getBoundingClientRect() 恒为 0×0。直接拿槽位当列会让取景退化到整幅中点
         （旧选择器 [data-slot='root'] > * > div:has(> [data-slot='main']) 在新结构下
         也失配）。改为优先 main.conversation、回落 main，再从槽位向上爬，
         返回第一个有真实尺寸的祖先——旧版槽位本身有盒子时就是它自己，保持兼容。 */
      var slot = document.querySelector("[data-slot='main.conversation']") ||
        document.querySelector("[data-slot='main']") ||
        /* 旧版（0.2.1 及以前）槽位是真盒子，且列不在 [data-slot='main'] 上，而在它的容器上；
           保留旧复合选择器作最后兜底，旧 DOM 与旧测试 mock 都能照常命中。 */
        document.querySelector("[data-slot='root'] > * > div:has(> [data-slot='main'])")
      var el = slot
      while (el && el !== document.body) {
        var rect = el.getBoundingClientRect()
        if (rect.width > 0 && rect.height > 0) return el
        el = el.parentElement
      }
      return null
    }
    function findFrame() {
      return document.querySelector("[data-slot='root'] > *") || column
    }
    function follow() {
      /* 转场运镜期间冻结取景重排：切页会让 body 子树与列/框尺寸大幅变动，此刻 place()/
         resize() 若插进来重设画布尺寸、重建网格，会和合成器上的位移动画打架，读起来就是
         洞直接跳到取景中心（回程尤其明显）。与 onResize(:816) 的 arcRaf 守护保持一致。 */
      if (arcRaf) return
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
      var top = (edge ? edge.top : 0) + 'px'
      var width = (typeof window === 'undefined' ? 0 : window.innerWidth) + 'px'
      var height = (edge ? edge.height : (typeof window === 'undefined' ? 0 : window.innerHeight)) + 'px'
      for (var i = 0; i < layers.length; i++) {
        layers[i].style.left = '0px'
        layers[i].style.top = top
        layers[i].style.width = width
        layers[i].style.height = height
      }
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
      for (var i = 0; i < layers.length; i++) layers[i].style.setProperty('--uni-hole-edge', left + 'px')
    }
    function sized() { if (arcRaf) return; place(); resize() }
    var observer = new ResizeObserver(sized)
    var shell = new MutationObserver(follow)
    shell.observe(document.body, { childList: true, subtree: true })
    /* 先安家再交给 ResizeObserver 守。顺序反了会出事：'resize()' 在画布还没尺寸时会把
       'w / h' 清成 0 并 'stop()'，而构造时对已观察元素的首次回调各家引擎给不给不保证，
       画布会停在 ready=false 上再也不动。所以这里自己先走一次 place + resize。
       resize 只能走渲染器入口，'create()' 内部那个 'resize' 是闭包，挂载侧看不见。 */
    /* 两块画布一起量：盘要重建网格，洞要重烘阴影圆与环。 */
    function resize() { renderer.resize(); if (holeLayer) holeLayer.resize() }
    follow()
    resize()
    observer.observe(canvas)

    /* 出画 / 回位（2026-10-29 甲方案，用户原话 m02133「甲，弧就停在现在的位置就行」）：
       洞不跟页面做 CSS 交叉淡化，全程可见，只把取景连续地推过去 —— 它的浓淡由本文件自己
       按位移进度插值（见下面的 ARC_FADE_*），不归页面管。
       为此取景框固定成整个 frame（见 place()），换页不改画布尺寸 —— 改尺寸要重建近两万个
       格子，重建期间画布是空的、CSS 还会把 canvas 藏起来，洞会闪一下，正好闪在转场最显眼
       的那一帧。所以两页共用同一块画布、同一份网格，只有 viewX / 墨量 / 速度在变，
       而这三样在 update() 里都只走 sync()，不重建，逐帧几乎免费。
       洞心落点：新会话页 = 对话列中心（画布变宽后要正补偿），
       对话页 = 视口右缘那条线（见 viewXFor），右半出画，只留左半边黑漆漆的圆。
       位移必须从画布宽度反算：半径和宽度不是同一个量。 */
    var ARC_SPEED = 0.35
    /* 甲：洞向右「旋转」到右缘，回程向左「旋转」放回（用户 m02685：「转场应该是新会话页的
       黑洞向右旋转到达目前对话页黑洞的位置，而从对话页返回新会话页则是那半个黑洞向左旋转
       放回新会话页黑洞的位置」）。
       倾角 angle 动不了 —— 它一变就触发整格重建（近两万格），正好闪在转场最显眼的一帧。
       所以旋转拆成两件都能逐帧做的事：
       1) 路径走弧线：用 viewY 把洞心抬起来再落回去，位移不再是直线。峰值 64px，
          sin(π·e) 起落都归零，两个端点还是干净的 y=0，静止态一点不受影响。
       2) 盘在飞的时候真的转：speed 直接乘进 elapsed（见 tick），所以飞行期加一个
          sin(π·e) 的转速脉冲，盘是看得出在自转的；落地收回 ARC_SPEED。
       脉冲峰值取 1.05 是为了别撞上 options() 里 speed 的上限 2（撞上就被夹平，转感丢失）。 */
    var ARC_BOW = 64
    var ARC_SPIN = 1.05
    /* 对话页那半个洞的墨量。它既是「压暗吸积盘以免遮字」的手段（用户 m02530
       「对话页亮色模式下的吸积盘有点遮挡文字，调整下吸积盘使其不遮挡文字，不改变位置」），
       也是转场淡入淡出的终点：飞去对话页时 alpha 1 → 这个值，回新会话页 1 ← 这个值，
       与位移共用同一条 easeInOutCubic（见 arcTo 里的 step），所以是「随着移动慢慢淡」。
       两档基准取不同值以限制阴影圆对正文的遮挡；亮档盘字单独映射到 ARC_INK_LIGHT。
       以下是阴影圆按 WCAG 相对亮度的 Weber 对比度 (Lbg - Lcomp) / Lbg
       反算到目标 0.25 的基准，不代表盘字的对比度：
         暗：#0c111a 底 + #030509 墨 → 0.2501
         亮：#edf0f4 底 + #101725 墨 → 0.2495
       全程不动几何：洞心、半径、取景、格子一概不变，只是这一帧的墨薄一点。 */
    var ARC_FADE_DARK = 0.341
    var ARC_FADE_LIGHT = 0.252
    /* 亮档盘字与暗档取同一浓度 0.341：两档观感对齐，不再为「浅底上黄更淡」额外加墨。
       浅底上深墨的视觉重量本来就比暗底上的亮墨重，同浓度已经足够；
       再往上加只会把对话文字压在盘下，这是用户反复要求收回的地方。
       正文压盘的场合仍以阴影圆的 .252 为准，这个值只作用于盘字画布。
       alpha 仍是两层共用的转场进度基准，映射仅用于盘画布的实际 opacity。 */
    var ARC_INK_LIGHT = 0.341
    function diskOpacity(alpha) {
      return renderer.isLight() ? 1 - (1 - alpha) * (1 - ARC_INK_LIGHT) / (1 - ARC_FADE_LIGHT) : alpha
    }
    var arcRaf = 0
    var arcAnim = null, arcAnims = []
    var arcSide = false
    var live = { viewX: 0, viewY: 0, brightness: defaults.brightness, speed: defaults.speed, alpha: 1 }

    /* 转场期不再抬帧率：位移已经交给合成器（见 arcTo），主线程这边只是继续按静止态
       defaults.fps 的方式出帧 —— 盘的自转本来就是 30fps 的观感，位置则跟屏幕同步。
       以前那条 ARC_FPS / 按刷新率挑整除数的逻辑因此整段删掉了。 */

    /* 该档位下盘该有多浓。 */
    function arcAlphaFor() { return renderer.isLight() ? ARC_FADE_LIGHT : ARC_FADE_DARK }

    /* 换档时补上浓淡：不补的话，在对话页直接切亮档会一直是暗档的满墨。
       setAlpha 自己不重画，所以这里补一次空 update() 把那一帧画出来。 */
    renderer.onMode(function () {
      if (!arcSide) return
      var next = arcAlphaFor()
      live.alpha = next
      renderer.setAlpha(next)
      setStyle('opacity', String(next))
      if (holeLayer) holeLayer.setMode(renderer.isLight() ? 'light' : 'dark')
      renderer.update({})
    })

    /* 只写姿态、不出帧。转场期每帧走这条：以前 apply() 走 renderer.update()，而 update()
       无条件 sync()→draw()，等于绕过 fps 门限自己画一遍；渲染器的 tick 又按 fps 画一遍。
       一次 320ms 的转场只有 19 帧画面，却被画了 29 次全量（每次约 15876 格 fillText）。
       现在转场期只有 tick 一个出帧口，画面数 = 帧数。 */
    function pose(next) {
      if (next) {
        if (next.viewX !== undefined) live.viewX = next.viewX
        if (next.viewY !== undefined) live.viewY = next.viewY
        if (next.brightness !== undefined) live.brightness = next.brightness
        if (next.speed !== undefined) live.speed = next.speed
        if (next.alpha !== undefined) live.alpha = next.alpha
      }
      renderer.setAlpha(live.alpha)
      renderer.pose({ viewX: live.viewX, viewY: live.viewY, brightness: live.brightness, speed: live.speed })
      /* 洞那层不吃亮度/速度：静止图，只有取景位移会让它重画一次。 */
      if (holeLayer) holeLayer.pose({ viewX: live.viewX, viewY: live.viewY })
    }
    /* 立刻落定，并且保证这一帧被画出来：瞬时路径与转场收尾用它。 */
    function apply(next) {
      pose(next)
      renderer.update({})
    }
    function arcStop() {
      if (arcRaf) cancelAnimationFrame(arcRaf)
      arcRaf = 0
      for (var i = 0; i < arcAnims.length; i++) arcAnims[i].cancel()
      arcAnims = []; arcAnim = null
      setStyle('transform', '')
    }
    /* 两页洞心的横向差：一整段位移的行程。交给合成器平移时它就是全部运动量。 */
    function travelX() {
      if (typeof window === 'undefined') return 0
      return Math.max(0, window.innerWidth - columnCenterX())
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
      /* 亮度不再参与转场：盘在对话页的浓淡统一由 alpha 承担（见 ARC_FADE_*），
         否则暗档会被压两层（0.4 × 0.341），比阴影圆还淡。 */
      var toBright = defaults.brightness
      var toSpeed = arcSide ? ARC_SPEED : defaults.speed
      var toAlpha = arcSide ? arcAlphaFor() : 1
      var homeX = viewXFor(false)
      var travel = travelX()
      /* 不能动的时候就只能瞬移：时长 0（reduced motion）、浏览器没有 WAAPI、或者两页的洞心
         本来就在同一处。 */
      if (!(ms > 0) || !(travel > 0) || typeof canvas.animate !== 'function') {
        setStyle('transform', '')
        setStyle('opacity', String(toAlpha))
        apply({ viewX: toX, viewY: 0, brightness: toBright, speed: toSpeed, alpha: toAlpha })
        return
      }
      var fromBright = live.brightness, fromSpeed = live.speed, fromAlpha = live.alpha
      /* 起点一帧：内容摆成新会话页的取景（洞在对话列中心），位移由 transform 承担。
         出画是从 0 平移到 +travel，回程是从 +travel 平移回 0 —— 两端在屏幕上完全重合，
         中间那段只是平移，洞的形状一个字都不变，所以不需要重建、也不需要逐帧重画。 */
      var from = arcSide ? 0 : travel
      var end = arcSide ? travel : 0
      setStyle('transform', 'translate3d(' + from + 'px, 0px, 0)')
      /* 起点浓度写进内联样式：动画被取消就回到这个值，不会弹回上一档的残留。
         真正会取消它的只有下一次 arcTo 开头的 arcStop() 和 teardown —— onResize
         在运镜期间直接 return，并不打断动画（那时的兜底是 finish 的落点）。 */
      setStyle('opacity', String(fromAlpha))
      pose({ viewX: homeX, viewY: 0 })
      renderer.update({})
      /* 弧线与缓动拆成 12 段关键帧交给合成器：easeInOutCubic + sin(π·e) 的抬升，
         和逐帧写 viewX 时的曲线逐点同值（步长 1/12）。 */
      var keys = [], STEPS = 12
      /* 关键帧里的长度按 0.01px 取整、并把 sin(π) 那点浮点残渣吞成 0 —— 否则终点会长成
         '-7.8e-15px'，读起来是噪声，落点也不再是逐位精确的 y=0。 */
      function px(v) { return (Math.abs(v) < 0.005 ? 0 : Math.round(v * 100) / 100) + 'px' }
      for (var i = 0; i <= STEPS; i++) {
        var kk = i / STEPS
        var ee = kk < 0.5 ? 4 * kk * kk * kk : 1 - Math.pow(-2 * kk + 2, 3) / 2
        keys.push({
          transform: 'translate3d(' + px(from + (end - from) * ee) + ', ' + px(-ARC_BOW * Math.sin(Math.PI * ee)) + ', 0)',
          /* 浓淡和位移同一份关键帧、同一条 ee：屏幕上的浓度因此跟位置逐点同步，
             也不再看主线程那一帧有没有被 fps 门限放行。 */
          opacity: fromAlpha + (toAlpha - fromAlpha) * ee,
          offset: kk,
          easing: 'linear',
        })
      }
      /* 两块画布共用位移和淡化进度；亮档仅提高盘字浓度，阴影圆沿用原关键帧。
         arcAnim 只留盘那份给 arcStop 之外的地方看。 */
      arcAnims = []
      for (var li = 0; li < layers.length; li++) {
        var layerKeys = layers[li] === canvas && renderer.isLight() ? keys.map(function (key) {
          return Object.assign({}, key, { opacity: diskOpacity(key.opacity) })
        }) : keys
        if (typeof layers[li].animate === 'function') arcAnims.push(layers[li].animate(layerKeys, { duration: ms, easing: 'linear', fill: 'forwards' }))
      }
      arcAnim = arcAnims[0] || null
      /* 亮度、转速还在主线程上插值 —— 它们不参与位移、也不进合成器关键帧，卡一下看不出来；
         浓淡已经挪进上面的 opacity，与位置同源。主线程再堵也影响不到这两样。 */
      var start = 0
      function step(now) {
        arcRaf = 0
        if (!start) start = now
        var k = (now - start) / ms
        if (k > 1) k = 1
        var e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2
        var bow = Math.sin(Math.PI * e)
        pose({
          brightness: fromBright + (toBright - fromBright) * e,
          /* 转速 = 端点插值 + 飞行脉冲：盘在途中是真的在自转，落地才收回 0.35。 */
          speed: fromSpeed + (toSpeed - fromSpeed) * e + ARC_SPIN * bow,
          /* 只做诊断镜像供 stats().alpha 采样：屏幕上的浓淡由关键帧决定。 */
          alpha: fromAlpha + (toAlpha - fromAlpha) * e,
        })
        if (k < 1) { arcRaf = requestAnimationFrame(step); return }
        finish()
      }
      function finish() {
        for (var ci = 0; ci < arcAnims.length; ci++) arcAnims[ci].cancel()
        arcAnims = []; arcAnim = null
        setStyle('transform', '')
        /* 落点按「此刻的档」重算：转场途中切亮/暗档时 toAlpha 是起飞时捕获的旧值，
           照它写会把 onMode 刚算对的值覆盖回去，对话页此后一直停错档。 */
        var landed = arcSide ? arcAlphaFor() : 1
        /* 取消动画会撤掉 fill:forwards，落点得写回内联样式，否则画布弹回起点浓度。 */
        setStyle('opacity', String(landed))
        /* 出画落地：内容得从「新会话页取景 + 平移」换成「对话页取景 + 无平移」，两者在屏幕上
           完全重合 —— 洞的位置连续，只有取景写对了；星点按格子落位，不随 viewX 动。
           回程落地不用换：内容本来就已经是新会话页的取景。 */
        /* 转场期间 follow()/sized() 被 arcRaf 挡住，落点仍是起飞时的取景；结束后按当前页
           再同步一次列与取景，保证洞精确落在目标页的洞心（回程尤其依赖 column 已切到
           新会话页）。 */
        follow()
        place()
        apply({ viewX: viewXFor(arcSide), viewY: 0, brightness: toBright, speed: toSpeed, alpha: landed })
      }
      arcRaf = requestAnimationFrame(step)
    }
    canvas.__uniArc = function (side, ms) { arcTo(!!side, Number(ms) || 0) }
    canvas.__uniSkyMode = function () { arcTo(true, 0) }
    canvas.__uniSkyModeOff = function () { arcTo(false, 0) }
    setStyle('opacity', '1')
    apply({ viewX: viewXFor(false), viewY: 0 })

    /* 冷启动时主题可能比对话列早一步挂上：那一次取景只能拿到视口中心的兜底值，
       洞心就比「从对话页返回」偏左半个左栏。列一出现就按同一套落点再落一次（瞬时），
       两端于是重合。最多等 2 秒，等不到列就维持原样。 */
    var settleLeft = 120
    var settleRaf = requestAnimationFrame(function settle() {
      settleRaf = 0
      if (column || --settleLeft <= 0) return arcTo(arcSide, 0)
      settleRaf = requestAnimationFrame(settle)
    })

    function onResize() {
      /* 转场跑一半时窗口变了：让这一帧落定，下一帧量到的新尺寸再接管。 */
      if (arcRaf) return
      place()
      apply({ viewX: viewXFor(arcSide), viewY: 0 })
    }
    window.addEventListener('resize', onResize)

    /* GPU 字符层统一使用 defaults.fps；交互事件不再降帧或重置绘制时钟。 */
    return function () {
      arcStop(); if (settleRaf) cancelAnimationFrame(settleRaf)
      renderer.dispose(); if (holeLayer) holeLayer.dispose(); shell.disconnect()
      if (column) observer.unobserve(column)
      if (frame) observer.unobserve(frame)
      observer.disconnect(); canvas.remove()
      if (holeCanvas) holeCanvas.remove()
      window.removeEventListener('resize', onResize)
      document.body.removeAttribute('data-uni-sky-mode')
      document.body.removeAttribute('data-uni-black-hole')
    }
  }
  /* 导出面：trace / ratio / budget / ringAt 是测地线内核的转口，本层真正拥有的是
     字符层与挂载；测试按同一组名字取物理，口径不变。 */
  return { create: create, mount: mount, options: options, viewOf: viewOf,
    trace: UniverseGeodesic.trace, shade: shade, glyphs: GLYPHS + STROKES,
    ratio: CRIT_RATIO, budget: STEP_BUDGET, ringAt: UniverseGeodesic.ringAt,
    debugSource: 'v4' }
})()
