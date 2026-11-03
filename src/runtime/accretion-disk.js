/* Accretion disk — the ASCII cell layer over the geodesic kernel
 * ---------------------------------------------------------------------------------
 * What this file owns: the glyph alphabet, the grid, the 11-step tone mapping, the
 * per-frame animation of the disk (differential rotation, brightness knots, the slow
 * global breath) and the two canvases' mount/teardown on the page.
 *
 * What it does NOT own: the geodesics. trace and shade's physics come from
 * UniverseGeodesic; this file only decides how a returned ray is turned into a
 * character. The hole (shadow disc + photon ring) is a separate canvas entirely
 * (src/runtime/hole.js) and is only consulted here for the ring-band keep-out.
 */
var UniverseAccretionDisk = (function () {
  /* 物理常量从测地线内核借：本层不再重算任何度规量。 */
  var INNER = UniverseGeodesic.inner, OUTER = UniverseGeodesic.outer
  var CRIT_RATIO = UniverseGeodesic.ratio, STEP_BUDGET = UniverseGeodesic.budget
  var trace = UniverseGeodesic.trace
  var GLYPHS = ' .-:;+*o#%@' /* 11 档，索引 0..10；lastGlyph = length - 1 */
  var STROKES = '|-/\\'
  var defaults = { angle: 15, fps: 30, maxCells: 16000, cellWidth: 6, brightness: 1, speed: 1 }
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
  /* 格子静态几何的惰性缓存（第三十二阶段）。逐帧重复算的只有「画布偏移、到洞心的距离、
     环扇区」这几样，它们只随网格与取景变；shade / 相位 / 字符 / 颜色仍是每帧现算。
     记录按原网格索引落位，只给被看过且真是盘面的格子建（环区粗筛一次都不命中的格子不建），
     首次访问就算 gx/gy/d2，d（半径）与 b（扇区桶）只在原来的环区分支真的要它们时才算，
     没有全网格预热。5 号格是「d 精确算过」的标记：格子与 baseX/baseY 没变，d2 就没变，
     精确算过一次就一直算过，下帧不再开方。 */
  var GX = 0, GY = 1, D2 = 2, D = 3, BIN = 4, EXACT = 5
  function geomFor(cache, cols, i, cw, ch, baseX, baseY) {
    var g = cache[i]
    if (!g) { g = cache[i] = new Float64Array(6); g[BIN] = -1; g[EXACT] = 0 }
    var gx = g[GX], gy = g[GY], gx2 = (i % cols + .5) * cw - baseX, gy2 = (((i / cols) | 0) + .5) * ch - baseY
    /* 坐标没变（没位移、没换格宽）就整条记录原样复用：d2 与「精确算过」都不必重来。 */
    if (!(gx === gx2 && gy === gy2)) {
      g[GX] = gx = gx2; g[GY] = gy = gy2; g[D2] = gx * gx + gy * gy; g[EXACT] = 0
    }
    return g
  }
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
  /* Brightness is a flux in [0,1): a smooth radial profile times a slow two-arm
     spiral, so neighbouring cells stay close in value and the glyphs read as a
     surface instead of noise. The artificial ring weight does not enter this
     flux (phase 15 moved it to the Canvas layer), and that weight is not a
     radiative-transfer result. */
  /* spin 是可选的第三层相位（见 SPIN）：不传等于 0，退回只按开普勒相位转，
     trace 出来的半径 / 方位角一个都不改，所以不传的调用点画面与以前逐位相同。
     要整盘旋起来就显式传 SPIN —— 唯一调用点（draw 里）就是这么传的。 */
  function shade(ray, time, brightness, spin) {
    var flux = 0
    var turn = time * (Number(spin) || 0)
    /* 环权重不再进入 ASCII 亮度（第十五阶段）：光子环已经交给 bakeRing 的 Canvas 精细层，
       字符只负责吸积盘。以前这里会把环权重加进 flux，盘交点格因此被环带顶到满档 @，
       环的位置就叠出一圈字符。ray.ring 仍由 trace 产出，只喂给精细层。 */
    if (ray.radius) {
      var r = ray.radius
      var phase = ray.phi - turn - time * (DISK + SWIRL / Math.pow(r, 1.5))
      /* log r 只算一次，旋臂与亮度团共用；乘加顺序原样保留。 */
      var logR = Math.log(r / INNER)
      var arms = .72 + .28 * Math.sin(2 * phase - 4 * logR)
      var band = .82 + .18 * Math.sin(r * 1.1 + 1.6 * Math.sin(2 * phase))
      /* 亮度团：径向按 log r 起波（等对数宽度），角向跟着同一套 Kepler 相位走，
         所以团块和盘一起转，但换相的节奏与双旋臂不同 —— 眼睛读到的是「盘里有东西在动」。 */
      var knots = 0
      for (var i = 0; i < KNOTS.length; i++) {
        var knot = KNOTS[i]
        knots += knot.weight * Math.sin(knot.n * phase + knot.radial * logR - time * knot.angular)
      }
      var breathe = 1 + PULSE * Math.sin(time * .33)
      /* 外缘收口只在盘面最后 1.5M 内做。以前从 r=10 就开始衰减，与 Math.pow(INNER/r, 2)
         叠成双重压暗，r=15 那一档 460 个格里 325 个直接退化成空格，外围半环读不出字。
         物理内外缘仍是 INNER=6 / OUTER=16，这里只改「亮度怎么收到 0」。 */
      var edge = smooth(INNER - .2, INNER + .8, r) * (1 - smooth(14.5, 16.2, r))
      flux += edge * Math.pow(INNER / r, 2) * arms * (band + knots) * breathe * ray.g4 * 3.2
    }
    if (!(flux > 0)) return 0
    return 1 - Math.exp(-flux * brightness)
  }
  function lit(cell) { return cell ? !!(cell.radius || cell.ring) : false }
  /* holeLayer 是洞那层（hole.js）的渲染器：阴影圆、光子环与它的方位包络都由那边负责，
     这里只读它的半径与环包络给盘字让位。不传就是纯字符模式（测试桩、精简 DOM、拆分前的
     旧调用点），此时没有让位可做，落字照旧。 */
  function create(canvas, input, holeLayer) {
    var config = options(input), ctx = canvas.getContext('2d', { alpha: true })
    if (!ctx) throw Error('Canvas 2D unavailable')
    var disposed = false, raf = 0, buildTimer = 0, generation = 0, elapsed = 0, previous = 0, lastDraw = -Infinity
    var visible = true, frames = 0, totalPaint = 0, maxPaint = 0, buildCpu = 0, w = 0, h = 0, cols = 0, rows = 0, grid = [], cw = 8, ch = 12, ready = false, mode = 'dark', applied = false, arcAlpha = 1, modeHook = null
    /* 最近一次网格构建的诊断：state 只可能是 ready / failed / building / 空（还没建过）。
       rays 是格数，exhausted 是首次耗尽格数，retried 是重算过的格数，unresolved 是重算后
       仍然耗尽的格数，budget 是首次预算。 */
    var buildDiag = null
    /* dpr 必须在 create() 这一层：draw() 用它算位移变换，resize() 用它定缓冲区尺寸，
       以前它只活在 resize() 里，位移那行一跑到就是 ReferenceError。 */
    var dpr = 1
    /* 静态几何缓存：只留当前这一份。键是「这份缓存按哪一次取景算的」，任一输入直接比不等
       就整份作废重算 —— 不快照 grid 内容、不哈希环包络。grid / w / h / cols 用全等，
       cw / ch / baseX / baseY / horizon 用 Object.is：同尺寸 resize 短路、只改时间/亮度/速度/
       明暗档的那几帧都不动这些输入，缓存照旧命中。baseX/baseY 照 draw 的原式取（那里恒等于
       w/2、h/2），不写死、不靠舍入抹平；horizon 进键是因为环带分支拿它比。 */
    var geo = [], geoGrid = null, geoW = 0, geoH = 0, geoCols = 0
    var geoCw = NaN, geoCh = NaN, geoX = NaN, geoY = NaN, geoHZ = NaN
    function ensureGeo(baseX, baseY, horizon) {
      if (geoGrid === grid && geoW === w && geoH === h && geoCols === cols &&
        Object.is(geoCw, cw) && Object.is(geoCh, ch) &&
        Object.is(geoX, baseX) && Object.is(geoY, baseY) && Object.is(geoHZ, horizon)) return
      geo = []; geoGrid = grid; geoW = w; geoH = h; geoCols = cols
      geoCw = cw; geoCh = ch; geoX = baseX; geoY = baseY; geoHZ = horizon
    }
    var motion = window.matchMedia('(prefers-reduced-motion: reduce)')
    function draw() {
      if (disposed || !w || !h || !ready) return
      var start = performance.now(), light = mode === 'light'
      /* 半径与环包络都来自洞那层：两边各算一次必然漂移（拆分前阴影圆与盘内缘就是这么差的
         0.2px）。holeLayer 缺席时退回本地公式，纯字符模式仍要一个半径判亮档内外。 */
      var horizon = holeLayer ? holeLayer.radius() : CRIT_RATIO * Math.min(w, h) / 2
      /* 圆心从 viewOf() 拿：它已经含了位移，而位移要靠 setTransform 生效，所以下面画字之前
         必须把「含位移的圆心」减去位移换回未平移的画布坐标。直接拿 view.x 当画布坐标只在
         viewX = 0 时成立 —— 对话页一让洞出画，整个盘的格子就会被再推一次位移，整片跑到右边去。 */
      var view = viewOf(w, h, config), cx = view.x, cy = view.y
      var baseX = cx - (config.viewX || 0), baseY = cy - (config.viewY || 0)
      /* 缓存键到这时才组得齐。baseX/baseY 恒等于 w/2、h/2，也照样从这两行取，不另外写死。 */
      ensureGeo(baseX, baseY, horizon)
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
      /* 对话页的盘是淡影（见 ARC_FADE_DARK / ARC_FADE_LIGHT），但这一帧不在这里压墨：
         浓淡交由画布自身的 opacity 承担（arcTo 把它写进合成器关键帧）。理由是逐帧
         globalAlpha 只有 fps 门限放行的 30 格能画出来，位移却在合成器上按 60fps 走，
         末段又被 easeInOutCubic 压平，落地补画一次就读成「快到位时突然定档」。
         整块画布一层 opacity 则与位移共用同一份关键帧、同一条缓动，盘字、阴影圆、
         光子环按同一比例一起变薄，也不再看主线程这一帧有没有出。 */
      /* 阴影圆与光子环不在这里画：洞那层（hole.js）有自己一块画布，实心阴影与烘好的
         环在同一张纸上，盘字的遮挡关系靠 DOM 顺序（洞在下、盘在上）而不是绘制顺序。
         这一层的角色因此只剩「落盘的字」，而字要绕着环让位 —— 半径与方位包络仍从洞那层读，
         不能各算一份：拆分前阴影圆与盘内缘就是这么漂开 0.2px 的。 */
      /* 让位要用的量在帧内不变，提到循环外。ring 是洞那层的烘焙结果：edge 是方位包络，
         edgeMax 是最外半径，horizon 是烘焙时的阴影半径 —— ringScale 通常正好是 1，只有取景
         尺寸在 resize 与重烘之间错开时才会偏离。扇区数直接用 edge.length，不另设常数。 */
      var ring = holeLayer ? holeLayer.ring() : null
      var ringEdge = ring && ring.edge ? ring.edge : null
      var ringScale = ring ? horizon / ring.horizon : 1
      var ringClear = Math.sqrt(cw * cw + ch * ch) / 2 + 1
      var ringOuter = ringEdge ? ring.edgeMax * ringScale + ringClear : 0
      var ringBins = ringEdge ? ringEdge.length : 0
      ctx.font = '600 ' + Math.round(ch * .95) + 'px ui-monospace, Consolas, monospace'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      /* 每格都会走一遍的量提到循环外：一次转场是 19 帧 × 约 15876 格，这些值在帧内不变。
         lastIndex / 12 这两个常数以前在格子内部被求值了两万多次。 */
      var lastGlyph = GLYPHS.length - 1, ink = config.brightness, t = elapsed
      for (var i = 0; i < grid.length; i++) {
        var cell = grid[i], glyph = '', value = 0, bucket = 0
        if (cell.radius) {
          /* 环上不落字：第十五阶段把环交给 Canvas 精细层之后，盘格在环的位置上照常显影，
             环层就从字缝里透出来，读成「一圈零散杂点压在细环上」。
             这里在 shade 之前把环带里的盘格跳掉。
             边界不用固定像素：环峰随方位在 140..215px 之间移动，下方被前景盘拉出一段外扩，
             上方则贴得紧。整圈取同一个半径，要么清不干净，要么把没有环的前景盘一起挖空。
             所以查 bakeRing 记下的方位包络 edge[方位]，只清环真有像素的方向。
             没有环层时一律不清：测试桩、精简 DOM 与烘焙失败都走这条路，纯 ASCII 模式不需要
             为不存在的环让位。遮挡本身没有放松：被捕获的格子没有 radius，依旧一个字都不落。 */
          if (ringEdge) {
            var g0 = geomFor(geo, cols, i, cw, ch, baseX, baseY)
            /* 先用平方半径粗筛：绝大多数格子在环带之外，省掉每帧一万多次开方与反正切。 */
            if (g0[D2] < ringOuter * ringOuter) {
              /* 环包络是可变数据：edge 由 bakeRing 边烘边写，换一次烘焙内容就变，而对象身份
                 不变。所以「让位」的最终布尔值不缓存 —— 每次都用当前的 ringEdge / ringScale /
                 ringClear / horizon 现比，缓存的只是距离和扇区桶，不是「这一格永远跳过」。
                 距离也比在这一支里，比较符号与开方顺序原样保留。 */
              var gd = g0[D]
              if (!g0[EXACT]) { gd = Math.sqrt(g0[D2]); g0[D] = gd; g0[EXACT] = 1 }
              /* 阴影圆内那几格是近侧盘面压在洞前，不属于环，照常落字。 */
              if (gd > horizon) {
                var rb = g0[BIN]
                if (rb < 0) rb = g0[BIN] = (((Math.atan2(g0[GY], g0[GX]) + Math.PI) / (Math.PI * 2) * ringBins) | 0) % ringBins
                if (gd <= ringEdge[rb] * ringScale + ringClear) continue
              }
            }
          }
          value = shade(cell, t, ink, SPIN)
          if (value > .004) {
            /* 字与墨都走同一个显示映射：物理亮度 value 先过 TONE_GAMMA，再落进 11 档字符。
               两处必须用同一个 shown —— 只压字形不压墨色，暗侧会拿到亮的字形配最暗的墨，
               读起来反而更糊。落字门槛 .004 仍是物理阈值，不随 gamma 变。 */
            var shown = Math.pow(value, TONE_GAMMA)
            /* (shown * 12) | 0 与 Math.floor(shown * 12) 在 shown ∈ [0,1) 上逐位相同，
               shown 不可能到 1（value < 1，gamma > 0），所以上限那次比较是空转。 */
            var index = Math.min(lastGlyph, Math.floor(shown * lastGlyph + .5))
            glyph = GLYPHS.charAt(index)
            bucket = (shown * 12) | 0
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
      if (!(nw > 0) || !(nh > 0)) { w = 0; h = 0; ready = false; geo = []; geoGrid = null; stop(); return }
      if (nw === w && nh === h && ready) return
      w = nw; h = nh; ready = false; stop(); generation++
      var mine = generation
      /* 环烘完才动手铺格子：draw 会在构建期同步跑一遍，缓存若在环就绪之前先冷启动，
         那批格子的扇区桶会按「环未就绪」的路子留下未算状态，等环层就绪后白白多算一轮。
         挪到烘完再失效，缓存键仍按当前 grid 与取景判定，构建期命中照常。 */
      geo = []; geoGrid = null
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
      buildDiag = { state: 'building', rays: 0, exhausted: 0, retried: 0, unresolved: 0, budget: STEP_BUDGET }
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
        if (row < rows) { buildTimer = setTimeout(chunk, 0); return }
        finishBuild(next, short)
      }
      function finishBuild(next, short) {
        var i, q
        /* 耗尽格先做一次有限恢复：只重算耗尽的那几格，预算翻倍（2400 → 4800），不改变初值、
           容差与几何，也不做第二次重试。仍然耗尽的格让整张网格失败闭合。
           重试也是构建成本，必须计进 buildCpu，否则 stats 上的构建耗时会漏掉这一段。 */
        var retryStart = performance.now()
        var bad = []
        for (i = 0; i < next.length; i++) if (next[i] && next[i].terminal === 'exhausted') bad.push(i)
        for (i = 0; i < bad.length; i++) {
          q = bad[i]
          var qr = (q / cols) | 0, qc = q - qr * cols
          next[q] = trace((2 * (qc + .5) * cw - w) / short, (h - 2 * (qr + .5) * ch) / short, config.angle, STEP_BUDGET * 2)
        }
        var left = 0
        for (i = 0; i < next.length; i++) if (next[i] && next[i].terminal === 'exhausted') left++
        buildCpu += performance.now() - retryStart
        buildDiag = { state: left ? 'failed' : 'ready', rays: next.length, exhausted: bad.length,
          retried: bad.length, unresolved: left, budget: STEP_BUDGET }
        if (left) {
          /* 没算完的射线不能伪装成逃逸、捕获或命中：整张网格作废，画布明确置为失败态并清空。
             ready 保持 false，所以 draw() / tick() 都不会再把这张网格当成可用结果。 */
          grid = []; ready = false; geo = []; geoGrid = null
          canvas.dataset.blackHoleState = 'failed'
          stop()
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
          ctx.clearRect(0, 0, w, h)
          return
        }
        grid = next; ready = true
        canvas.dataset.blackHoleState = 'ready'; sync()
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
        if (config.angle !== old.angle || config.cellWidth !== old.cellWidth || config.maxCells !== old.maxCells) { ready = false; resize() } else sync()      },
      /* 只写姿态、不重画：转场期每帧走这里，出帧由 tick 统一负责（一帧一画）。
         绝不从这里传 angle / cellWidth / maxCells —— 那三个要重建网格，而这里没有那条判断。 */
      pose: function (next) { config = options(Object.assign({}, config, next)) },
      view: function () {
        var v = viewOf(w, h, config)
        return { x: v.x, y: v.y, radius: CRIT_RATIO * Math.min(w, h) / 2, width: w, height: h }
      },
      setMode: function (next) {
        applied = true
        mode = next === 'light' ? 'light' : 'dark'
        publishVoid(); sync()
        if (modeHook) modeHook(mode)
      },
      /* 盘的整体墨量：0..1，由 mount() 按「亮暗档 + 洞在不在出画位」决定。
         它现在只是诊断镜像（stats().alpha）—— 绘制不读它，浓淡真正生效的地方是
         canvas.style.opacity 和转场关键帧里的 opacity。不自己 sync() 的理由不变：
         多画一次会多出 16000 格的绘制，而且会在旧取景上先画一帧。 */
      setAlpha: function (next) {
        var value = Number(next)
        arcAlpha = value >= 0 && value <= 1 ? value : 1
      },
      isLight: function () { return mode === 'light' },
      onMode: function (fn) { modeHook = typeof fn === 'function' ? fn : null },
      stats: function () { return { frames: frames, width: canvas.width, height: canvas.height, cells: cols * rows, columns: cols, rows: rows, meanPaintMs: frames ? totalPaint / frames : 0, maxPaintMs: maxPaint, buildCpuMs: buildCpu, rAFGapMs: rAFGap, running: running(), ready: ready, reducedMotion: motion.matches, config: Object.assign({}, config), alpha: arcAlpha,
        build: buildDiag ? Object.assign({}, buildDiag) : null,
        ring: holeLayer ? holeLayer.stats().ring : null } },
      resize: function () { resize() },
      dispose: function () {
        if (disposed) return
        disposed = true; generation++; stop()
        if (buildTimer) clearTimeout(buildTimer)
        observer.disconnect(); intersection.disconnect(); theme.disconnect()
        document.removeEventListener('visibilitychange', sync)
        motion.removeEventListener('change', sync)
        grid = []
        geo = []; geoGrid = null
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
      console.warn('Universe ASCII black hole fallback:', error.message)
      return
    }
    /* 两块画布共用同一套位置、遮罩界线与转场关键帧，所以凡是逐块写 inline style 的地方
       都过这一张表，不重复写两遍（漏一块就是洞留在原地、盘飞走）。 */
    var layers = holeCanvas ? [canvas, holeCanvas] : [canvas]
    function setStyle(key, value) {
      for (var i = 0; i < layers.length; i++) layers[i].style[key] = value
    }
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
    function sized() { place(); resize() }
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
       两档取不同值是为了观感一致。LIGHT 调色板高端近黑（#30110b）、DARK 是深蓝底，
       同一个 alpha 在亮档看起来比暗档浓约 35%，于是按 WCAG 相对亮度的 Weber 对比度
       (Lbg - Lcomp) / Lbg 反算，让两档落到同一个目标 0.25：
         暗：#0c111a 底 + #030509 墨 → 0.2501
         亮：#edf0f4 底 + #101725 墨 → 0.2495
       全程不动几何：洞心、半径、取景、格子一概不变，只是这一帧的墨薄一点。 */
    var ARC_FADE_DARK = 0.341
    var ARC_FADE_LIGHT = 0.252
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
      /* 两块画布各自一份同参数动画：合成器上两层的 transform 与 opacity 逐点同值，
         屏幕上就是同一个洞在移动、同比例变淡。arcAnim 只留盘那份给 arcStop 之外的地方看。 */
      arcAnims = []
      for (var li = 0; li < layers.length; li++) {
        if (typeof layers[li].animate === 'function') arcAnims.push(layers[li].animate(keys, { duration: ms, easing: 'linear', fill: 'forwards' }))
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
        pose({ viewX: toX, viewY: 0, brightness: toBright, speed: toSpeed, alpha: landed })
        renderer.update({})
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
