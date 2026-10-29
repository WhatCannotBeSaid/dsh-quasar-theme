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
 * Cells are traced once per geometry change; only the orbital phase is
 * recalculated per frame. */
var UniverseBlackHole = (function () {
  var GLYPHS = ' .-:;+*o#%@'
  var STROKES = '|-/\\'
  var defaults = { angle: 15, fps: 30, maxCells: 16000, cellWidth: 6, brightness: 1, speed: 1 }
  var DISTANCE = 60
  var INNER = 6, OUTER = 16
  var B_CRIT = 3 * Math.sqrt(3)
  var SHADOW_SHARE = 0.34
  var HORIZON_INK = '#101725'
  /* 暗档的阴影底色。html 底部是 rgb(12,17,26) = '#0c111a'，阴影要压得比它还深，
     洞心才有一个可辨认的暗面；'#030509' 与 --cp-void 同值，是这套主题里最深的墨。 */
  var SHADOW_INK = '#030509'
  var TAN_HALF = B_CRIT / DISTANCE / SHADOW_SHARE
  var RING_WIDTH = 0.32
  /* 光子环的可见性（第八阶段）：几何照旧，只收紧映射。
     RING_CORE 把高斯重新归一化到原先的峰值强度（exp(0)=1），所以临界线上的环还是那么亮；
     变窄的是两侧的衰减 —— 0.32 的 σ 折到屏幕约 20px 的软过渡，比字符格宽两倍，线被摊成雾。
     RING_GAIN 是环项单独吃的增益，让它在高字形区独占：盘即使有 0.5 的亮度也抢不到 '%'。 */
  var RING_CORE = 0.15
  var RING_GAIN = 3.1
  var SWIRL = 16
  /* 静止态的自转：盘相位是「角向位置 - time * SWIRL / r^1.5」，只有这一项时整盘是一张固定
     的花纹在滑行，读不出「洞在转」。这里补三件逐帧便宜的事：
     SPIN   把整盘与对侧镜环一起慢速旋过去（同心旋转，不重建任何格子）；
     KNOTS  两层亮度团按 Kepler 角速度漂移，盘的明暗结构自己在变，而不是包在盘上的花纹；
     PULSE  全局通量的慢呼吸，乘法作用，不改任何几何。 */
  var SPIN = 0.42
  /* 盘面纹理的角速率。以前整个盘只有一个 Kepler 相位（SWIRL / r^1.5）：内缘比外缘快三倍，
     盘是「拧」着走的，最新帧与旧帧之间没有可读的位移。这里补一个整体角速度，
     内外缘同向同速，盘的明暗条纹一起转过去 —— 那才是「盘在旋」的观感。
     数值是量出来的：扫 2.4 / 2.0 / 1.6 / 1.2 四档，拿盘上 72 个角向样本做相关最大搜索，
     只有 1.2 让 1.8 秒后的图样出现干净的小角度位移（约 5°），其余几档要么一整圈假匹配，
     要么反向。 */
  var DISK = 1.2
  /* 亮度团与呼吸幅度都压在几个百分点：再大就是「闪」，不是「转」。 */
  var KNOTS = [
    { n: 1, radial: 1.9, angular: 1.0, weight: .16 },
    { n: 2, radial: 2.7, angular: -.62, weight: .11 }
  ]
  var PULSE = .03
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
    /* 光子环权重：窄高斯，峰值仍为 1。RING_WIDTH 保留为「名义宽度」，实际曲线用 RING_CORE
       —— 见上方常量的说明。 */
    var ring = Math.exp(-Math.pow((impact - B_CRIT) / RING_CORE, 2))
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
          return { radius: dr, phi: Math.atan2(qz, qx), boost: Math.min(1.7, Math.max(.4, Math.pow(shift, 1.8))), ring: ring, impact: impact }
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
  /* spin 是可选的第三层相位（见 SPIN）：不传等于 0，退回只按开普勒相位转，
     trace 出来的半径 / 方位角一个都不改，所以不传的调用点画面与以前逐位相同。
     要整盘旋起来就显式传 SPIN —— 唯一调用点（draw 里）就是这么传的。 */
  function shade(ray, time, brightness, spin) {
    var flux = 0
    var turn = time * (Number(spin) || 0)
    if (ray.ring) flux += ray.ring * RING_GAIN * (.92 + .08 * Math.cos(turn))
    if (ray.radius) {
      var r = ray.radius
      var phase = ray.phi - turn - time * (DISK + SWIRL / Math.pow(r, 1.5))
      var arms = .72 + .28 * Math.sin(2 * phase - 4 * Math.log(r / INNER))
      var band = .82 + .18 * Math.sin(r * 1.1 + 1.6 * Math.sin(2 * phase))
      /* 亮度团：径向按 log r 起波（等对数宽度），角向跟着同一套 Kepler 相位走，
         所以团块和盘一起转，但换相的节奏与双旋臂不同 —— 眼睛读到的是「盘里有东西在动」。 */
      var knots = 0
      for (var i = 0; i < KNOTS.length; i++) {
        var knot = KNOTS[i]
        knots += knot.weight * Math.sin(knot.n * phase + knot.radial * Math.log(r / INNER) - time * knot.angular)
      }
      var breathe = 1 + PULSE * Math.sin(time * .33)
      /* 外缘收口只在盘面最后 1.5M 内做。以前从 r=10 就开始衰减，与 Math.pow(INNER/r, 2)
         叠成双重压暗，r=15 那一档 460 个格里 325 个直接退化成空格，外围半环读不出字。
         物理内外缘仍是 INNER=6 / OUTER=16，这里只改「亮度怎么收到 0」。 */
      var edge = smooth(INNER - .2, INNER + .8, r) * (1 - smooth(14.5, 16.2, r))
      flux += edge * Math.pow(INNER / r, 2) * arms * (band + knots) * breathe * ray.boost * 3.2
    }
    if (!(flux > 0)) return 0
    return 1 - Math.exp(-flux * brightness)
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
    var visible = true, frames = 0, totalPaint = 0, maxPaint = 0, buildCpu = 0, w = 0, h = 0, cols = 0, rows = 0, grid = [], cw = 8, ch = 12, ready = false, mode = 'dark', applied = false, arcAlpha = 1, modeHook = null
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
      /* 亮档对话页的盘是淡影（见 ARC_ALPHA_LIGHT）：一整帧的墨量在这里统一收，墨盘、盘字、
         星点一起变薄，不需要每种颜色各自调淡。 */
      if (arcAlpha < 1) ctx.globalAlpha = arcAlpha
      /* 阴影底色两档都要先铺（此前只有亮档铺，暗档靠透明把整块地露给页面底纹，洞心因此
         是一张静止的纹理而不是洞）：
           - 被捕获的格子没有 glyph，draw() 下面的循环直接跳过它，这一块就没有任何不透明像素；
           - 画布每帧 clearRect 成全透明，暗档洞心于是整块透出 html 的底色与它的纹理。
         所以这里在盘字之前补一枚实心圆，把阴影先把地占住；盘字随后照常画在上面，穿过盘的
         前景一半（y=0 平面在观察者与洞之间的那半）就落在圆上，遮挡关系不变。
         圆心取未平移坐标（baseX/baseY）而不是视图圆心：位移由上面那句 setTransform 施加，
         这里再按视图坐标画就会把洞推第二遍。半径沿用同一个 horizon 公式，实测与网格里
         captured 格的边缘相差 0.12px（653 格最大半径 139.69，horizon 139.57）。
         颜色按档分开：暗档 SHADOW_INK 比 html 底色再深一档，才读得出是「洞」而不是底色；
         亮档维持 HORIZON_INK，浅纸上不铺墨的阴影会被当成空白。 */
      ctx.beginPath()
      ctx.arc(baseX, baseY, horizon, 0, Math.PI * 2)
      ctx.fillStyle = light ? HORIZON_INK : SHADOW_INK
      ctx.fill()
      ctx.font = '600 ' + Math.round(ch * .95) + 'px ui-monospace, Consolas, monospace'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      /* 每格都会走一遍的量提到循环外：一次转场是 19 帧 × 约 15876 格，这些值在帧内不变。
         lastIndex / 12 这两个常数以前在格子内部被求值了两万多次。 */
      var lastGlyph = GLYPHS.length - 1, ink = config.brightness, t = elapsed
      for (var i = 0; i < grid.length; i++) {
        var cell = grid[i], glyph = '', value = 0, bucket = 0
        if (cell.stroke) {
          glyph = cell.stroke
          ctx.fillStyle = light ? '#8d7a63' : '#8a5228'
        } else if (cell.radius || cell.ring) {
          value = shade(cell, t, ink, SPIN)
          if (value > .004) {
            /* (value * 12) | 0 与 Math.floor(value * 12) 在 value ∈ [0,1) 上逐位相同，
               value 不可能到 1（shade 返回 1 - exp(-flux)，flux > 0），所以上限那次比较是空转。 */
            var index = Math.min(lastGlyph, Math.floor(Math.pow(value, .62) * lastGlyph + .5))
            glyph = GLYPHS.charAt(index)
            bucket = (value * 12) | 0
            if (bucket > 11) bucket = 11
            var luminous = !light
            if (light) {
              var qx = (i % cols + .5) * cw - baseX, qy = (((i / cols) | 0) + .5) * ch - baseY
              luminous = qx * qx + qy * qy <= horizon * horizon
            }
            ctx.fillStyle = luminous ? DARK[bucket] : LIGHT[bucket]
          }
        }
        if (glyph && glyph !== ' ') ctx.fillText(glyph, (i % cols + .5) * cw, (((i / cols) | 0) + .5) * ch, cw)
      }
      if (arcAlpha < 1) ctx.globalAlpha = 1
      /* 位移只活在这一个函数里：帧末复位成居中，下一次进 draw() 再按当时的 config 决定。
         不复位的话，从对话页反向切回新会话页时，第一帧仍带着旧位移。 */
      if (shifted) ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      var ms = performance.now() - start
      frames++; totalPaint += ms; maxPaint = Math.max(maxPaint, ms)
    }
    function running() { return !disposed && ready && visible && !document.hidden && !motion.matches && config.speed > 0 && w > 0 && h > 0 }
    function stop() { if (raf) cancelAnimationFrame(raf); raf = 0; previous = 0 }
    /* 显示刷新周期的估计（rAF 间隔的指数滑动平均）。真正决定「动起来顺不顺」的不是我们
       画多快，而是画出来的帧能不能和刷新对齐：用户那台机器实测 rAF 间隔 6.2ms（约 160Hz），
       我们却按 60fps 出帧 —— 每次更新落在第 2 或第 3 个刷新上，速度看起来在忽快忽慢。
       这条估计只用来给飞行期挑一个刷新率的整除数，静止态一律不用。 */
    var rAFGap = 0
    function tick(now) {
      raf = 0
      if (!running()) return
      var gap = previous ? now - previous : 0
      if (gap > 0 && gap < 200) rAFGap = rAFGap ? rAFGap * .7 + gap * .3 : gap
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
            next[row * cols + col] = trace((2 * (col + .5) * cw - w) / short, (h - 2 * (row + .5) * ch) / short, config.angle)
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
      /* 亮暗档是盘的浓淡的唯一输入，而浓淡由 mount() 那一层决定（只有它知道洞在不在出画位），
         所以换档要回调出去，否则洞会一直停在上一档的墨量上。 */
      if (modeHook) modeHook(mode)
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
      /* 只写姿态、不重画：转场期每帧走这里，出帧由 tick 统一负责（一帧一画）。
         绝不从这里传 angle / cellWidth / maxCells —— 那三个要重建网格，而这里没有那条判断。 */
      pose: function (next) { config = options(Object.assign({}, config, next)) },
      view: function () {
        var v = viewOf(w, h, config)
        return { x: v.x, y: v.y, radius: SHADOW_SHARE * Math.min(w, h) / 2, width: w, height: h }
      },
      setMode: function (next) {
        applied = true
        mode = next === 'light' ? 'light' : 'dark'
        publishVoid(); sync()
        if (modeHook) modeHook(mode)
      },
      /* 盘的整体墨量：0..1，由 mount() 按「亮暗档 + 洞在不在出画位」决定。
         不自己 sync()：调用方紧跟着的 update() 就是那一帧，多画一次会多出 16000 格的绘制，
         而且会在旧取景上先画一帧（转场里肉眼可见的一跳）。 */
      setAlpha: function (next) {
        var value = Number(next)
        arcAlpha = value >= 0 && value <= 1 ? value : 1
      },
      isLight: function () { return mode === 'light' },
      onMode: function (fn) { modeHook = typeof fn === 'function' ? fn : null },
      stats: function () { return { frames: frames, width: canvas.width, height: canvas.height, cells: cols * rows, columns: cols, rows: rows, meanPaintMs: frames ? totalPaint / frames : 0, maxPaintMs: maxPaint, buildCpuMs: buildCpu, rAFGapMs: rAFGap, running: running(), ready: ready, reducedMotion: motion.matches, config: Object.assign({}, config) } },
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
    /* 亮档的吸积盘压成一层淡影。LIGHT 调色板的高端是近黑的（#30110b），盘最亮的圈整片压在
       浅色纸面上；对话页把洞挪到右缘后，正文恰好贴在这片墨后面 —— 用户 m02530
       「对话页亮色模式下的吸积盘有点遮挡文字，调整下吸积盘使其不遮挡文字，不改变位置」。
       压 alpha 是唯一不动几何的解法：洞心、半径、取景、格子全不变，只是这一帧的墨薄一点。
       暗档维持 1：深蓝底上不存在压字问题，那边不动。 */
    var ARC_ALPHA_LIGHT = 0.35
    var arcRaf = 0
    var arcAnim = null
    var arcSide = false
    var live = { viewX: 0, viewY: 0, brightness: defaults.brightness, speed: defaults.speed, alpha: 1 }

    /* 转场期不再抬帧率：位移已经交给合成器（见 arcTo），主线程这边只是继续按静止态
       defaults.fps 的方式出帧 —— 盘的自转本来就是 30fps 的观感，位置则跟屏幕同步。
       以前那条 ARC_FPS / 按刷新率挑整除数的逻辑因此整段删掉了。 */

    /* 该档位下盘该有多浓。暗档恒为 1，所以下面的插值在暗档是空转（1 → 1）。 */
    function arcAlphaFor() { return renderer.isLight() ? ARC_ALPHA_LIGHT : 1 }

    /* 换档时补上浓淡：不补的话，在对话页直接切亮档会一直是暗档的满墨。
       setAlpha 自己不重画，所以这里补一次空 update() 把那一帧画出来。 */
    renderer.onMode(function () {
      if (!arcSide) return
      var next = arcAlphaFor()
      live.alpha = next
      renderer.setAlpha(next)
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
    }
    /* 立刻落定，并且保证这一帧被画出来：瞬时路径与转场收尾用它。 */
    function apply(next) {
      pose(next)
      renderer.update({})
    }
    function arcStop() {
      if (arcRaf) cancelAnimationFrame(arcRaf)
      arcRaf = 0
      if (arcAnim) { arcAnim.cancel(); arcAnim = null; canvas.style.transform = '' }
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
      var toBright = arcSide ? ARC_BRIGHTNESS : defaults.brightness
      var toSpeed = arcSide ? ARC_SPEED : defaults.speed
      var toAlpha = arcSide ? arcAlphaFor() : 1
      var homeX = viewXFor(false)
      var travel = travelX()
      /* 不能动的时候就只能瞬移：时长 0（reduced motion）、浏览器没有 WAAPI、或者两页的洞心
         本来就在同一处。 */
      if (!(ms > 0) || !(travel > 0) || typeof canvas.animate !== 'function') {
        canvas.style.transform = ''
        apply({ viewX: toX, viewY: 0, brightness: toBright, speed: toSpeed, alpha: toAlpha })
        return
      }
      var fromBright = live.brightness, fromSpeed = live.speed, fromAlpha = live.alpha
      /* 起点一帧：内容摆成新会话页的取景（洞在对话列中心），位移由 transform 承担。
         出画是从 0 平移到 +travel，回程是从 +travel 平移回 0 —— 两端在屏幕上完全重合，
         中间那段只是平移，洞的形状一个字都不变，所以不需要重建、也不需要逐帧重画。 */
      var from = arcSide ? 0 : travel
      var end = arcSide ? travel : 0
      canvas.style.transform = 'translate3d(' + from + 'px, 0px, 0)'
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
          offset: kk,
          easing: 'linear',
        })
      }
      arcAnim = canvas.animate(keys, { duration: ms, easing: 'linear', fill: 'forwards' })
      /* 亮度、转速、浓淡还在主线程上插值 —— 它们不参与位移，卡一下也看不出来；
         真正的运动已经交给合成器，主线程再堵也不影响位置。 */
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
          alpha: fromAlpha + (toAlpha - fromAlpha) * e,
        })
        if (k < 1) { arcRaf = requestAnimationFrame(step); return }
        finish()
      }
      function finish() {
        if (arcAnim) { arcAnim.cancel(); arcAnim = null }
        canvas.style.transform = ''
        /* 出画落地：内容得从「新会话页取景 + 平移」换成「对话页取景 + 无平移」，两者在屏幕上
           完全重合 —— 洞的位置连续，只有取景写对了；星点按格子落位，不随 viewX 动。
           回程落地不用换：内容本来就已经是新会话页的取景。 */
        pose({ viewX: toX, viewY: 0, brightness: toBright, speed: toSpeed, alpha: toAlpha })
        renderer.update({})
      }
      arcRaf = requestAnimationFrame(step)
    }
    canvas.__uniArc = function (side, ms) { arcTo(!!side, Number(ms) || 0) }
    canvas.__uniSkyMode = function () { arcTo(true, 0) }
    canvas.__uniSkyModeOff = function () { arcTo(false, 0) }
    apply({ viewX: viewXFor(false), viewY: 0 })

    function onResize() {
      /* 转场跑一半时窗口变了：让这一帧落定，下一帧量到的新尺寸再接管。 */
      if (arcRaf) return
      place()
      apply({ viewX: viewXFor(arcSide), viewY: 0 })
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
  return { create: create, mount: mount, options: options, viewOf: viewOf, trace: trace, shade: shade, glyphs: GLYPHS + STROKES, debugSource: 'v3' }
})()
