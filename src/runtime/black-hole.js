/* Original ASCII thin-disk renderer. No third-party code or font copied.
 * Geometry: Schwarzschild null geodesics in Cartesian form, x'' = -3 L^2 x / r^5,
 * G=M=c=1, from a fixed 60M observer. Capture is decided by the integration
 * (r < CAPTURE_R); it is not an analytic impact-parameter test, and the traced
 * capture edge only matches b = 3*sqrt(3) to the tolerances pinned in the tests.
 * The disk terminates at the first crossing of the y=0 plane inside 6M..16M.
 * The bright ring is a separate Canvas layer: a narrow Gaussian on the flat
 * impact parameter |o x v| (RING_CORE, expressed in impact units), not radiation
 * summed from higher-order disk images.
 * The camera keeps a fixed vertical field of view, so the shadow always spans
 * the same share of the viewport and the disk can be composed around it.
 * On light paper the shadow is painted as solid ink before the disk, because an
 * unpainted Schwarzschild shadow on a light page reads as empty space rather
 * than a hole; the disk's near side is then drawn with the luminous ramp on top.
 * Cells are traced once per geometry change; only the orbital phase is
 * recalculated per frame. */
var UniverseBlackHole = (function () {
  var GLYPHS = ' .-:;+*o#%@' /* 11 档，索引 0..10；lastGlyph = length - 1 */
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
  /* 光子环精细层的墨色（第十五阶段）。环是热的，不是灯光：
     暗档取暖白香槟金（亮，但偏奶油而非纯白），亮档取深暖金铜（压在浅纸上够黑）。
     两档都避开纯白/纯黑，环才读成「金属加热」而不是描边。 */
  var RING_INK_DARK = '#f3dcae'
  var RING_INK_LIGHT = '#6b3f14'
  var TAN_HALF = B_CRIT / DISTANCE / SHADOW_SHARE
  /* 阴影在屏幕上的半径比例：有限距离临界光线的真实投影，不是 SHADOW_SHARE 的取整。
     b_c = 3√3 处的平嵌坐标满足 tanψ_c = b_c/√(D² − (1−2/D)·b_c²)，rho_c = tanψ_c/TAN_HALF。
     SHADOW_SHARE 从此只定视场（TAN_HALF），不再决定阴影画多大。 */
  var CRIT_RATIO = B_CRIT / Math.sqrt(DISTANCE * DISTANCE - (1 - 2 / DISTANCE) * B_CRIT * B_CRIT) / TAN_HALF
  /* 有限距离观察者的 √(1−2/D)：只用来把 r 处的频移换算成观察者测到的总频移。 */
  var SQRT_FD = Math.sqrt(1 - 2 / DISTANCE)
  /* 光子环的可见性（第八阶段）：几何照旧，只收紧映射。
     RING_CORE 是 impact 参数空间里的高斯 σ（与 |o x v| 同单位，M），不是屏幕半径的比例，
     也不随视口缩放；高斯峰值仍为 1（exp(0)），所以临界线上的环还是那么亮。
     环权重只喂 Canvas 层：它既不是完整的辐射输运，也不参与 ASCII 盘的亮度。 */
  var RING_CORE = 0.15
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
  /* 相机初值与光子环权重。trace() 与环层烘焙共用这一份公式：烘焙先用它筛掉不可能
     达到 ring > .004 的像素，再去积分，算出来的权值仍是 trace() 里那一个。
     初速度按欧氏范数归一（|v|=1），所以 L=|o×v| 是角动量模长，不是 L/E。能量归一化
     E0=√(1−2L²/D³) 放到 trace 入口算一次，不放进这里 —— 环预筛要为每个被丢弃的像素
     调用 launch，这里多一次开方就多一份白算。b=Jy0/E0 才是无量纲的轴向角动量比。 */
  function launch(u, v, angle) {
    var a = angle * Math.PI / 180, sa = Math.sin(a), ca = Math.cos(a)
    var ox = 0, oy = DISTANCE * sa, oz = DISTANCE * ca
    var vx = u * TAN_HALF, vy = -sa + v * TAN_HALF * ca, vz = -ca - v * TAN_HALF * sa
    var len = Math.sqrt(vx * vx + vy * vy + vz * vz); vx /= len; vy /= len; vz /= len
    var lx = oy * vz - oz * vy, ly = oz * vx - ox * vz, lz = ox * vy - oy * vx
    var l2 = lx * lx + ly * ly + lz * lz
    var impact = Math.sqrt(l2)
    /* 光子环权重：impact 空间的窄高斯，峰值仍为 1；σ 是 RING_CORE，见上方说明。 */
    return { x: ox, y: oy, z: oz, px: vx, py: vy, pz: vz, l2: l2, impact: impact,
      ring: Math.exp(-Math.pow((impact - B_CRIT) / RING_CORE, 2)) }
  }
  /* 积分与事件参数。原来的变步长 velocity-Verlet 只有二阶精度、盘面交点用线性插值、
     420 步耗尽与正常逃逸返回同一个结果，近临界光线（临界曲线两侧约 1e-3 的屏幕带）
     因此既漏盘也误判终态。这里换成自适应 DP5(4)：局部位移误差按分量相对量控制，
     盘面交点用三次 Hermite 求根，资源耗尽单独成为一种终态。 */
  /* 单步相对误差上限：6 个分量各自除以 1+|状态| 后取最大。1e-9 是实测选的：再用 1e-7 时
     (0,.34125) 的首个盘内交点偏 4.25e-3M，1e-8 偏 5.7e-4M，1e-9 偏 3.0e-5M，1e-11 偏
     9.0e-7M。误差随 tol 收紧而单调下降，说明那 4e-3 是可复现的容差不足、不是临界混沌；
     但收敛**不是**严格的线性关系 —— 相邻两档的误差比在 7.5 / 19 / 33 之间变动，所以不能拿
     「tol 小一个量级就准一个量级」去外推别的目标或别的角度。1e-9 的步数只比 1e-7 多三成。 */
  var STEP_TOL = 1e-9
  var STEP_MAX = 2.6       /* 单步上限，与原来的 h 上限一致 */
  var STEP_BUDGET = 2400   /* 单条射线的步数预算（含被拒绝的尝试） */
  /* 单步方位角上限。它只是在步首按当时的 r 估计一步该走多少：h·L/r² ≤ 0.4 时取整步。
     r 在步内继续下降时，实际扫过的方位角会比这个估计值大，所以它不是「一步内最多一个
     y=0 交点」的保证 —— 那个保证没有证明过，事件检测也不依赖它。 */
  var ANGLE_CAP = .4
  var CAPTURE_R = 2.05     /* 落到 2.05M 以内：必然继续下落 */
  var ESCAPE_R = 108       /* 已远且仍在向外 */
  var DP_A = [
    [1 / 5],
    [3 / 40, 9 / 40],
    [44 / 45, -56 / 15, 32 / 9],
    [19372 / 6561, -25360 / 2187, 64448 / 6561, -212 / 729],
    [9017 / 3168, -355 / 33, 46732 / 5247, 49 / 176, -5103 / 18656],
    [35 / 384, 0, 500 / 1113, 125 / 192, -2187 / 6784, 11 / 84]
  ]
  var DP_B = [35 / 384, 0, 500 / 1113, 125 / 192, -2187 / 6784, 11 / 84, 0]
  var DP_E = [-71 / 57600, 0, 71 / 16695, -71 / 1920, 17253 / 339200, -22 / 525, 1 / 40]
  /* 7 个阶段的导数缓冲与工作向量。trace() 不重入（网格与环层都是串行调用），
     复用同一块内存，免得每条射线都扔一堆短命数组给 GC。 */
  var K = [], S = [0, 0, 0, 0, 0, 0], NEXT = [0, 0, 0, 0, 0, 0], ERR = [0, 0, 0, 0, 0, 0]
  var HV = [0, 0]
  for (var kInit = 0; kInit < 42; kInit++) K.push(0)
  /* 一步 DP5(4)：s 是 6 维状态 [x,y,z,px,py,pz]，结果写进 out，局部位移误差写进 err。 */
  function dpStep(s, h, l2, out, err) {
    var i, j, c, w, x, y, z, px, py, pz, r2, k, sum, esum
    for (i = 0; i < 7; i++) {
      x = s[0]; y = s[1]; z = s[2]; px = s[3]; py = s[4]; pz = s[5]
      if (i > 0) {
        var row = DP_A[i - 1]
        for (j = 0; j < row.length; j++) {
          w = h * row[j]; c = j * 6
          if (w === 0) continue
          x += w * K[c]; y += w * K[c + 1]; z += w * K[c + 2]
          px += w * K[c + 3]; py += w * K[c + 4]; pz += w * K[c + 5]
        }
      }
      r2 = x * x + y * y + z * z
      k = -3 * l2 / (r2 * r2 * Math.sqrt(r2))
      c = i * 6
      K[c] = px; K[c + 1] = py; K[c + 2] = pz
      K[c + 3] = k * x; K[c + 4] = k * y; K[c + 5] = k * z
    }
    for (i = 0; i < 6; i++) {
      sum = 0; esum = 0
      for (j = 0; j < 7; j++) { sum += DP_B[j] * K[j * 6 + i]; esum += DP_E[j] * K[j * 6 + i] }
      out[i] = s[i] + h * sum; err[i] = h * esum
    }
  }
  /* 三次 Hermite：用两端的位置与切向插值 y=0 的穿越位置。切线取 h*y'，
     于是插值在两端与积分器的高阶解同值同导，比线性插值少一个量级的定位误差。 */
  function hermite(t, h, p0, m0, p1, m1, out) {
    var t2 = t * t, t3 = t2 * t
    var h00 = 2 * t3 - 3 * t2 + 1, h10 = t3 - 2 * t2 + t
    var h01 = -2 * t3 + 3 * t2, h11 = t3 - t2
    out[0] = h00 * p0 + h10 * h * m0 + h01 * p1 + h11 * h * m1
    out[1] = ((6 * t2 - 6 * t) * p0 + (3 * t2 - 4 * t + 1) * h * m0 +
      (-6 * t2 + 6 * t) * p1 + (3 * t2 - 2 * t) * h * m1) / h
  }
  /* 二分求 y=0 的穿越时刻。端点约定：y1 恰为 0 时交点就是本步终点，返回 1；y0 恰为 0 时交点
     属于上一步终点（那一步已经计过），返回 -1；其余只有严格异号才有根。
     这里只认「异号」或「端点恰为 0」，因此一步内同号的多个根（偶数个）不会被发现，
     一步内奇数次穿越时二分也只收敛到其中一个。ANGLE_CAP 让实际扫过角通常小于 π，
     实践中很难落到这些情形，但代码没有证明它不会发生，也不做多根拆分。 */
  function crossFraction(y0, m0, y1, m1, h) {
    if (y0 === 0) return -1
    if (y1 === 0) return 1
    if (!(y0 * y1 < 0)) return -1
    var lo = 0, hi = 1, t, f
    for (var i = 0; i < 48; i++) {
      t = (lo + hi) * .5
      hermite(t, h, y0, m0, y1, m1, HV)
      f = HV[0]
      if (f * y0 > 0) lo = t; else hi = t
    }
    return (lo + hi) * .5
  }
  /* 盘面交点：落在 6M..16M 环带里才算命中，否则这条射线继续往外走。
     频移按圆形轨道物质的引力红移＋多普勒算：
       g = √(1−3/r) / [√(1−2/D) · (1 − r^−1.5 · b)]
     b 是初始轴向角动量比 Jy0/E0（有符号，随盘面旋转方向），不是事件处的坐标切向；
     √(1−3/r) 里已经含了轨道时间膨胀 √(1−β²)，不必再乘 √(1−2/r)。
     命中记录只存未夹限的 g⁴（第二十九阶段）：发射项的频移权重就是 g⁴，在构建命中记录时
     用四次乘法算一次，逐帧不再出现 pow/sqrt，也没有积分。旧的 ^1.8 显示映射与 [0.4,1.7]
     限幅已整体移除，不保留 boost 兼容字段 —— 盘亮度随 g⁴ 走，不再为复刻旧亮度二次归一。 */
  function diskHit(qx, qz, ring, impact, steps, axialB) {
    var dr = Math.sqrt(qx * qx + qz * qz)
    if (!(dr >= INNER && dr <= OUTER)) return null
    var g = Math.sqrt(1 - 3 / dr) / (SQRT_FD * (1 - Math.pow(dr, -1.5) * axialB))
    var g4 = g * g * g * g
    return { radius: dr, phi: Math.atan2(qz, qx),
      g4: g4,
      ring: ring, impact: impact, captured: false, terminal: 'disk', steps: steps }
  }
  /* Trace one ray. The disk terminates at the first crossing of the y=0 plane
     that falls inside 6M..16M; a crossing outside that band does not stop the
     ray, so a higher-order image can still be reached later. Only a ray that
     actually falls inside CAPTURE_R becomes shadow. The flat-coordinate impact
     parameter |o x v| is kept as the ring weight for the Canvas layer, whose
     crisp edge is painted separately; it is not a sky glow.
     返回的 terminal 区分四种结局：'disk' 命中首个盘内交点、'capture' 落入、
     'escape' 逃逸、'exhausted' 步数预算耗尽 —— 耗尽不是逃逸，它只说明这次没算完，
     调用方据此既不能把它当成物理终态，也不该静默当成成功。
     budget 可覆盖单条射线的步数预算（不传或非正数＝STEP_BUDGET）。它只给耗尽注入与
     网格的有限重试用，不改变初值、容差与任何几何。 */
  function trace(u, v, angle, budget) {
    var cam = launch(u, v, angle)
    var ring = cam.ring, impact = cam.impact, l2 = cam.l2
    /* 首个守恒量：初速度按 |v|=1 归一，故 E0=√(1−2L²/D³)；轴向角动量 Jy0 就是 launch
       里的 ly = oz·vx − ox·vz。b=Jy0/E0 无量纲，有符号，符号随盘面旋转方向。 */
    var energy0 = Math.sqrt(1 - 2 * l2 / (DISTANCE * DISTANCE * DISTANCE))
    var axialB = energy0 > 0 ? (cam.z * cam.px - cam.x * cam.pz) / energy0 : 0
    var inverse = l2 > 0 ? 1 / Math.sqrt(l2) : 0
    var limit = budget > 0 ? budget : STEP_BUDGET
    var s = S
    s[0] = cam.x; s[1] = cam.y; s[2] = cam.z
    s[3] = cam.px; s[4] = cam.py; s[5] = cam.pz
    var h = .25, tries = 0
    for (;;) {
      var x = s[0], y = s[1], z = s[2], px = s[3], py = s[4], pz = s[5]
      var r2 = x * x + y * y + z * z, r = Math.sqrt(r2)
      if (r < CAPTURE_R) return { captured: true, terminal: 'capture', ring: ring, impact: impact, steps: tries }
      if (r > ESCAPE_R && x * px + y * py + z * pz > 0) {
        return { captured: false, terminal: 'escape', ring: ring, impact: impact, steps: tries }
      }
      if (tries >= limit) {
        return { captured: false, terminal: 'exhausted', ring: ring, impact: impact, steps: tries }
      }
      var hh = h
      if (inverse && hh > ANGLE_CAP * r2 * inverse) hh = ANGLE_CAP * r2 * inverse
      if (hh > STEP_MAX) hh = STEP_MAX
      dpStep(s, hh, l2, NEXT, ERR)
      tries++
      /* 误差范数：分量相对量（1+|状态| 作尺度）取最大，只有全部达标才接受这一步。 */
      var scale = 0
      for (var i = 0; i < 6; i++) {
        var err = Math.abs(ERR[i]) / (STEP_TOL * (1 + Math.max(Math.abs(s[i]), Math.abs(NEXT[i]))))
        if (err > scale) scale = err
      }
      if (!(scale <= 1)) { h = hh * Math.max(.1, .9 * Math.pow(scale, -.2)); continue }
      /* 事件判定：严格异号，或这一步恰好落在 y=0 上（NEXT[1] === 0）而本步起点不在盘面上。
         端点交点交给 crossFraction 的端点约定处理（y1===0 → 1），下一步从 y=0 起步时
         y0===0 返回 -1，同一个交点不会被相邻两步各计一次。 */
      if (y * NEXT[1] < 0 || (NEXT[1] === 0 && y !== 0)) {
        var f = crossFraction(y, py, NEXT[1], NEXT[4], hh)
        var hit = null
        if (f > 0) {
          hermite(f, hh, x, px, NEXT[0], NEXT[3], HV); var qx = HV[0]
          hermite(f, hh, z, pz, NEXT[2], NEXT[5], HV); var qz = HV[0]
          hit = diskHit(qx, qz, ring, impact, tries, axialB)
        }
        if (hit) return hit
      }
      s[0] = NEXT[0]; s[1] = NEXT[1]; s[2] = NEXT[2]
      s[3] = NEXT[3]; s[4] = NEXT[4]; s[5] = NEXT[5]
      h = hh * (scale > 0 ? Math.min(4, Math.max(.2, .9 * Math.pow(scale, -.2))) : 4)
    }
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
      flux += edge * Math.pow(INNER / r, 2) * arms * (band + knots) * breathe * ray.g4 * 3.2
    }
    if (!(flux > 0)) return 0
    return 1 - Math.exp(-flux * brightness)
  }
  function lit(cell) { return cell ? !!(cell.radius || cell.ring) : false }
  /* 光子环的精细层（第十五阶段）。环的几何宽度只有 2px 上下（RING_CORE=0.15 换算到屏幕），
     而字符格高将近 10px —— ASCII 网格再密也表达不出一条连续细环，只会读成断续的亮点。
     这里不再走字符，改为在「环可能出现的那一圈」里按像素采样 trace() 的 impact，
     把 ring 权重烘成一张透明遮罩，逐帧只贴这张遮罩。
     烘焙只在初始化 / 视口变化 / 相关配置变化时做一次，逐帧零测地线积分。
     返回的 state 只有 'ready' 与 'incomplete'：只要有一条参与烘焙的射线步数耗尽，
     整张遮罩就不发布（canvas 为 null、drawn 计数保留），由调用方决定怎么处理。 */
  function bakeRing(w, h, angle) {
    /* 测试桩与精简 DOM 里可能没有 createElement / getContext / createImageData：
       没有精细环层就退回纯 ASCII，不能让整个渲染器挂掉。 */
    if (!document || typeof document.createElement !== 'function') return null
    var short = Math.max(1, Math.min(w, h))
    var horizon = CRIT_RATIO * short / 2
    /* 采样窗口：环峰随方位角在 140..215px 之间移动（下方被前景盘拉出一段外扩），
       窗口必须按实测最外环峰留余量，不能只贴阴影半径。
       映射与网格构建（chunk 里那次 trace 调用）完全一致：分母是 short，不是本窗口边长。 */
    var outer = horizon * 1.75
    var size = Math.ceil(outer) * 2
    if (!(size > 0) || size > 4096) return null
    var off = document.createElement('canvas')
    if (!off || typeof off.getContext !== 'function') return null
    off.width = size; off.height = size
    var octx = off.getContext('2d')
    if (!octx || typeof octx.createImageData !== 'function') return null
    var image = octx.createImageData(size, size)
    if (!image || !image.data) return null
    var data = image.data
    var cx = size / 2, cy = size / 2
    var start = performance.now()
    var peak = 0, attempted = 0, drawn = 0, exhausted = 0, retried = 0, unresolved = 0
    var pending = []
    /* 一个像素的落笔：终态未定、被捕获、权重不够的一律不写。抽成函数是为了让
       「首轮」与「有限重试」共用同一段判据，重试不会因为漏抄一个条件而写出不同的像素。 */
    function plot(row, col, rad, ray) {
      if (ray.terminal === 'exhausted') return false
      if (ray.captured) return false
      var weight = ray.ring
      if (!(weight > .004)) return false
      /* 跨越内切边缘的一像素做线性淡入，避免硬切出一道新的圆边。 */
      if (rad < horizon + 1.5) weight *= (rad - horizon - .5)
      if (weight > peak) peak = weight
      var i4 = (row * size + col) * 4
      data[i4] = 255; data[i4 + 1] = 255; data[i4 + 2] = 255
      data[i4 + 3] = 255 * Math.pow(weight, 1.7)
      drawn++
      return true
    }
    for (var row = 0; row < size; row++) {
      var sy = cy - row - .5
      for (var col = 0; col < size; col++) {
        var sx = col + .5 - cx
        var rad = Math.sqrt(sx * sx + sy * sy)
        /* 环只画在阴影之外。ring 权重在 impact 逼近 B_CRIT 时对「即将被捕获」的光线
           同样给高值 —— 那是光子环在数学上的位置，但它落在阴影半径以内约 9px，
           直接贴上去等于给阴影描了一圈边，与「阴影完整深黑」冲突。这里从阴影半径起
           画：形状、粗细与径向外沿仍完全由 trace() 的 ring 值决定，切掉的只是被判为
           已经进入阴影的那部分。 */
        if (rad < horizon + .5 || rad > outer) continue
        var u = (2 * sx) / short, v = (2 * sy) / short
        /* 先用同一份 launch() 公式筛掉注定 ring ≤ .004 的像素，再审积分：环峰只占这一圈
           里约 1/14 的面积，其余像素的积分结果最后都会被这一个判定丢掉。判定顺序没变
           （先 captured 后权重），输出与逐像素全积分逐位相同。 */
        if (!(launch(u, v, angle).ring > .004)) continue
        attempted++
        var ray = trace(u, v, angle)
        /* 步数耗尽的射线没有终态：既不能当成「逃逸所以环在这里」，也不能静默丢掉像素 ——
           丢掉的像素会在遮罩上留下空洞，而调用方完全看不到这件事。 */
        if (ray.terminal === 'exhausted') { exhausted++; pending.push([row, col, rad, u, v]); continue }
        plot(row, col, rad, ray)
      }
    }
    /* 与网格同一条有限恢复策略：只重算耗尽的那几格，预算翻倍一次，不做第二次。
       网格能在翻倍预算下救回的射线，环层也不该因为同一条射线整张作废；
       仍然算不完才整张不发布。 */
    if (pending.length) {
      for (var pi = 0; pi < pending.length; pi++) {
        var p = pending[pi]
        retried++
        var again = trace(p[3], p[4], angle, STEP_BUDGET * 2)
        if (again.terminal === 'exhausted') unresolved++
        else plot(p[0], p[1], p[2], again)
      }
    }
    var ms = performance.now() - start
    /* 有射线没算完，遮罩就整体不发布：state 与计数一起返回，调用方据此知道环层为什么缺，
       而不是拿到一张看着正常、实际上缺了像素的图。 */
    if (unresolved) return { canvas: null, size: size, cx: cx, cy: cy, horizon: horizon, peak: peak,
      ms: ms, state: 'incomplete', attempted: attempted, drawn: drawn, exhausted: exhausted,
      retried: retried, unresolved: unresolved }
    octx.putImageData(image, 0, 0)
    return { canvas: off, size: size, cx: cx, cy: cy, horizon: horizon, peak: peak, ms: ms,
      state: 'ready', attempted: attempted, drawn: drawn, exhausted: exhausted,
      retried: retried, unresolved: 0 }
  }
  /* 阴影描边曾在这里给被捕获格写 stroke 字符。第十五阶段已整体移除：
     它既不随时间动（只在 buildGrid 里算一次），也不属于吸积盘，
     却正好压在阴影边缘与光子环的起点上，读成一圈静止的杂字。 */
  function silhouette(grid, cols, rows) {
    for (var i = 0; i < cols * rows; i++) {
      if (grid[i] && grid[i].stroke) grid[i].stroke = ''
    }
  }
  function create(canvas, input) {
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
    /* 环遮罩缓存：只在视口尺寸或仰角变化时重烘一次，逐帧零成本。
       ringDiag 是环层的诊断：bakeRing 返回 incomplete / 不可用时不发布遮罩，原因留在这里。 */
    var bakedRing = null, bakedFor = '', ringDiag = null
    function ensureRing() {
      var key = w + 'x' + h + '@' + config.angle
      if (bakedRing && bakedFor === key) return
      bakedFor = key
      var baked = w > 0 && h > 0 ? bakeRing(w, h, config.angle) : null
      /* 只有完整烘完的遮罩才进缓存。incomplete 的遮罩整张作废：贴上去等于静默发布缺像素的环。 */
      if (baked && baked.state === 'ready' && baked.canvas) {
        bakedRing = baked
        ringDiag = { state: 'ready', size: baked.size, attempted: baked.attempted,
          drawn: baked.drawn, exhausted: baked.exhausted, retried: baked.retried,
          unresolved: baked.unresolved, peak: baked.peak, ms: baked.ms }
      } else {
        bakedRing = null
        /* drawn 记的是「真正发布出去」的像素数，所以失败分支永远是 0；
           烘到一半才被作废的那些像素记在 discarded 上，两个数分开，
           否则从 stats 上看不出整张遮罩是被丢弃的、也看不出丢了多少。 */
        ringDiag = baked
          ? { state: baked.state, size: baked.size, attempted: baked.attempted, drawn: 0,
            discarded: baked.drawn, exhausted: baked.exhausted, retried: baked.retried,
            unresolved: baked.unresolved, peak: baked.peak, ms: baked.ms }
          : { state: 'unavailable' }
      }
      tintedRing = {}
    }
    /* 遮罩是白色 + alpha，贴图前按档染一次色：同一张遮罩只染一次，逐帧不再重绘。
       染色用 'source-in' 换成纯色，alpha 通道原样保留 —— 环的粗细与形状完全来自
       trace() 的 ring 值，没有任何硬编码圆环。 */
    var tintedRing = {}
    function ringImage(ink) {
      if (!bakedRing) return null
      var key = bakedRing.size + ':' + ink
      if (tintedRing[key]) return tintedRing[key]
      var c = document.createElement('canvas')
      c.width = bakedRing.size; c.height = bakedRing.size
      var x = c.getContext('2d')
      x.drawImage(bakedRing.canvas, 0, 0)
      x.globalCompositeOperation = 'source-in'
      x.fillStyle = ink
      x.fillRect(0, 0, c.width, c.height)
      tintedRing[key] = c
      return c
    }
    var motion = window.matchMedia('(prefers-reduced-motion: reduce)')
    function draw() {
      if (disposed || !w || !h || !ready) return
      var start = performance.now(), light = mode === 'light'
      var horizon = CRIT_RATIO * Math.min(w, h) / 2
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
         这里再按视图坐标画就会把洞推第二遍。半径沿用同一个 horizon 公式；1256×821 的
         网格里 capture 格的最大格心半径 139.88px，与本阶段 horizon 140.0787px 相差约
         0.20px（旧取整半径 139.57px 时约 0.31px），阴影圆与网格判据仍对齐在 1px 内。
         颜色按档分开：暗档 SHADOW_INK 比 html 底色再深一档，才读得出是「洞」而不是底色；
         亮档维持 HORIZON_INK，浅纸上不铺墨的阴影会被当成空白。 */
      ctx.beginPath()
      ctx.arc(baseX, baseY, horizon, 0, Math.PI * 2)
      ctx.fillStyle = light ? HORIZON_INK : SHADOW_INK
      ctx.fill()
      /* 光子环（第十五阶段）：夹在阴影与盘字之间。盘的前景臂随后压在环上，
         所以「盘穿过洞前方」的遮挡关系不变，环只是把阴影外沿那一圈补连续。
         遮罩是设备无关位图，按 shadow 半径等比缩放后贴到 baseX/baseY 上。
         两档用各自的环比色而不是一律纯白：暗底的环是发光，亮纸上的环是墨，
         一律贴白会在亮档把阴影边缘烧掉一圈。 */
      if (bakedRing) {
        var ringSize = bakedRing.size, scale = horizon / bakedRing.horizon
        var img = ringImage(light ? RING_INK_LIGHT : RING_INK_DARK)
        ctx.save()
        /* 环色与 alpha 一起决定「亮到什么程度」：暗档要清晰明亮（环芯接近高光但不到纯白），
           亮档要压在浅纸上有足够反差（环芯接近深金铜）。两者都只覆盖 r128–160 那一圈，
           吸积盘的 ASCII 层完全不动。 */
        ctx.globalAlpha = light ? .74 : .86
        if (img) ctx.drawImage(img, baseX - ringSize / 2 * scale,
          baseY - ringSize / 2 * scale, ringSize * scale, ringSize * scale)
        ctx.restore()
      }
      ctx.font = '600 ' + Math.round(ch * .95) + 'px ui-monospace, Consolas, monospace'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      /* 每格都会走一遍的量提到循环外：一次转场是 19 帧 × 约 15876 格，这些值在帧内不变。
         lastIndex / 12 这两个常数以前在格子内部被求值了两万多次。 */
      var lastGlyph = GLYPHS.length - 1, ink = config.brightness, t = elapsed
      for (var i = 0; i < grid.length; i++) {
        var cell = grid[i], glyph = '', value = 0, bucket = 0
        if (cell.radius) {
          /* 盘格一律照常显影：这里以前有一条 "if (gd >= horizon - 1 && gd <= 150) continue"，
             拿「环层肉眼可见的最外半径」150px 当遮罩，把阴影外整条环带里的盘格一起跳过，
             好让 Canvas 环层不被字符打断。但那条带子里本来就有一半是有效前景盘（近侧盘面
             压在洞前），而 150 是个跟窗口无关的固定像素 —— 1256×821 只挡掉 2.6%，
             800×400 挡掉 65%，全是同一批几何没道理地被吃掉。
             现在环带里照常落字：环层仍在上一步整张画好，字符压在其上，洞外没有盘交点的地方
             照旧只有环、没有字。注意字符是稀疏的 ASCII 格，环仍会从字缝里透出来 ——
             视觉上得到的是「环上叠字」，不是严格意义上的「盘把环挡住」。要让环在盘后真正
             消失，就得按逐像素的盘命中再生成一条遮罩去削环层；但那条遮罩并不只覆盖「有效
             前景盘」—— 环带里凡是射线命中盘面的像素都会被削，其中既有近侧前景盘，也有盘在
             洞后方那一段（它同样在环的位置上），还有本来靠环自身贡献信号的像素，所以它不是
             一次纯粹的「前景盘遮住环」。本阶段明确不做，也没有做。
             遮挡没有放松：被捕获的格子没有 radius，依旧一个字都不落。 */
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
      ensureRing()
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
          grid = []; ready = false
          canvas.dataset.blackHoleState = 'failed'
          stop()
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
          ctx.clearRect(0, 0, w, h)
          return
        }
        silhouette(next, cols, rows); grid = next; ready = true
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
         不自己 sync()：调用方紧跟着的 update() 就是那一帧，多画一次会多出 16000 格的绘制，
         而且会在旧取景上先画一帧（转场里肉眼可见的一跳）。 */
      setAlpha: function (next) {
        var value = Number(next)
        arcAlpha = value >= 0 && value <= 1 ? value : 1
      },
      isLight: function () { return mode === 'light' },
      onMode: function (fn) { modeHook = typeof fn === 'function' ? fn : null },
      stats: function () { return { frames: frames, width: canvas.width, height: canvas.height, cells: cols * rows, columns: cols, rows: rows, meanPaintMs: frames ? totalPaint / frames : 0, maxPaintMs: maxPaint, buildCpuMs: buildCpu, rAFGapMs: rAFGap, running: running(), ready: ready, reducedMotion: motion.matches, config: Object.assign({}, config),
        build: buildDiag ? Object.assign({}, buildDiag) : null,
        ring: ringDiag ? Object.assign({}, ringDiag) : null } },
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
