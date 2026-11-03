/* Universe geodesic kernel — Schwarzschild null geodesics and the thin-disk hit test
 * ---------------------------------------------------------------------------------
 * This file is the only place the physics lives: one ray in, one terminal state out.
 * It owns no canvas, no palette and no timing — the accretion disk (accretion-disk.js)
 * paints the cells it returns, and the hole layer (hole.js) bakes its photon ring from
 * the very same trace, so the ring and the disk can never drift apart.
 *
 * Units: G = M = c = 1. The camera sits at r = DISTANCE on the equatorial plane plus the
 * view angle, and rays are integrated with DP5(4) until they are captured, escape, or
 * run out of steps. INNER = 6 is the Schwarzschild ISCO, OUTER = 16 the outer edge of
 * the emitting disk.
 */
var UniverseGeodesic = (function () {
  var DISTANCE = 60
  var INNER = 6, OUTER = 16
  var B_CRIT = 3 * Math.sqrt(3)
  /* 视场：阴影约占画面短边的 SHADOW_SHARE。阴影与光子环的墨色不在这一层 —— 洞的像素由
     hole.js 那块独立画布负责，这里只提供它的半径比例与环权重。 */
  var SHADOW_SHARE = 0.34
  var TAN_HALF = B_CRIT / DISTANCE / SHADOW_SHARE
  /* 阴影在屏幕上的半径比例：有限距离临界光线的真实投影，不是 SHADOW_SHARE 的取整。
     b_c = 3√3 处的平嵌坐标满足 tanψ_c = b_c/√(D² − (1−2/D)·b_c²)，rho_c = tanψ_c/TAN_HALF。
     SHADOW_SHARE 从此只定视场（TAN_HALF），不再决定阴影画多大。 */
  var CRIT_RATIO = B_CRIT / Math.sqrt(DISTANCE * DISTANCE - (1 - 2 / DISTANCE) * B_CRIT * B_CRIT) / TAN_HALF
  /* 有限距离观察者的 √(1−2/D)：只用来把 r 处的频移换算成观察者测到的总频移。 */
  var SQRT_FD = Math.sqrt(1 - 2 / DISTANCE)
  /* 光子环的可见性：几何照旧，只收紧映射。RING_CORE 是 impact 参数空间里的高斯 σ
     （与 |o x v| 同单位，M），不是屏幕半径的比例，也不随视口缩放；峰值仍为 1。
     环权重只喂 Canvas 层：它既不是完整的辐射输运，也不参与 ASCII 盘的亮度。 */
  var RING_CORE = 0.15
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
  /* 导出面只有一份物理：盘（accretion-disk.js）拿 trace / shade 的输入，洞（hole.js）
     拿 ratio / ringAt / budget / trace。两边都不许再实现一遍公式。 */
  return { trace: trace, launch: launch, ratio: CRIT_RATIO, budget: STEP_BUDGET,
    inner: INNER, outer: OUTER, distance: DISTANCE, tanHalf: TAN_HALF,
    ringAt: function (u, v, angle) { return launch(u, v, angle).ring } }
})()
