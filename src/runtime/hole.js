/* 黑洞本体（2026-11-03 拆分第一阶段）：阴影盘 + 光子环，自己一块画布。
 *
 * 用户的判据（m00515）：「吸积盘应该是吸积盘，黑洞是黑洞」。此前两者共用一个模块、
 * 一块画布、一套 config：draw() 里先铺阴影圆、再贴光子环、最后落盘的字符，环带里还要
 * 反过来把盘的字挖掉（「让位」）。拆开之后这里只回答一件事：洞长什么样。
 *
 * 本层没有自己的动画。阴影是解析圆（Schwarzschild 的阴影与倾角无关，正圆就够），
 * 光子环是一张烘好的位图；两者都不随时间变，所以这里不进 rAF —— 只在尺寸、明暗档、
 * 取景位移变化时重画一次。位置与浓淡由挂载层通过 canvas.style 的 transform 与 opacity
 * 统一驱动，和吸积盘那块画布走同一份关键帧。
 *
 * 光子环为什么还要光线追踪：环的权重来自 trace() 的 ring 值（impact 逼近 B_CRIT 时
 * 的高斯），不是手画的圆。用的仍是吸积盘那个求交器，经 UniverseGeodesic.ringAt /
 * .trace 调用；本文件不重复实现测地线。
 */
var UniverseHole = (function () {
  /* 与 geodesic.js 的相机常量、accretion-disk.js 的 radius 公式必须同源：radius 与它的 view().radius 是同一个数，
     否则阴影圆和盘的内缘会对不上。ratio 由那片提供，这里不复制公式。 */
  var HORIZON_INK = '#101725'
  /* 亮纸上的阴影：不铺墨的阴影会被当成空白，所以压一档浅蓝灰。 */
  var SHADOW_INK = '#030509'
  /* 暗档的环是发光（接近高光但不到纯白），亮纸上的环是墨（深金铜）。 */
  var RING_INK_DARK = '#f3dcae'
  var RING_INK_LIGHT = '#6b3f14'
  /* 环包络的方位分档：盘字让位时按这个精度查表。 */
  var RING_BINS = 360
  /* 只把肉眼读得出来的像素记进包络。alpha 才 2、3 的边缘像素如果也参与，
     包络会被拉到理论上限 1.75 倍半径，等于整圈都清空。 */
  var RING_VISIBLE = .12
  var defaults = { angle: 15 }

  function options(input) {
    var source = input && typeof input === 'object' ? input : {}
    function number(key, min, max) {
      var value = Number(source[key])
      if (!Number.isFinite(value)) value = defaults[key]
      return Math.min(max, Math.max(min, value))
    }
    return { angle: number('angle', 10, 50) }
  }

  /* 环遮罩：白色 + alpha 的设备无关位图，环的形状与粗细全部来自 trace() 的 ring 值。 */
  function bakeRing(w, h, angle) {
    /* 测试桩与精简 DOM 里可能没有 createElement / getContext / createImageData：
       没有精细环层就没有环，不能让整个挂载挂掉。 */
    if (typeof document === 'undefined' || !document || typeof document.createElement !== 'function') return null
    if (typeof UniverseGeodesic === 'undefined' || !UniverseGeodesic) return null
    var short = Math.max(1, Math.min(w, h))
    var horizon = UniverseGeodesic.ratio * short / 2
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
    /* 环可见区的方位包络：edge[bin] 记该扇区里最外一枚「肉眼可见」像素的半径。
       吸积盘那一层绘制时逐格按方位查这张表，决定要不要为环让位。 */
    var edge = new Float32Array(RING_BINS), edgeMax = 0
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
      if (weight >= RING_VISIBLE) {
        /* row 向下增长，屏幕 y 是 row + .5 - cy；与绘制侧 atan2(gy, gx) 同一套方向。 */
        var bin = (((Math.atan2(row + .5 - cy, col + .5 - cx) + Math.PI) / (Math.PI * 2) * RING_BINS) | 0) % RING_BINS
        if (rad > edge[bin]) edge[bin] = rad
        if (rad > edgeMax) edgeMax = rad
      }
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
           画：形状、粗细与径向外沿仍完全由 trace() 的 ring 值决定。 */
        if (rad < horizon + .5 || rad > outer) continue
        var u = (2 * sx) / short, v = (2 * sy) / short
        /* 先用同一份 ring 权重筛掉注定 ≤ .004 的像素，再审积分：环峰只占这一圈
           里约 1/14 的面积，其余像素的积分结果最后都会被这一个判定丢掉。 */
        if (!(UniverseGeodesic.ringAt(u, v, angle) > .004)) continue
        attempted++
        var ray = UniverseGeodesic.trace(u, v, angle)
        /* 步数耗尽的射线没有终态：既不能当成「逃逸所以环在这里」，也不能静默丢掉像素 ——
           丢掉的像素会在遮罩上留下空洞，而调用方完全看不到这件事。 */
        if (ray.terminal === 'exhausted') { exhausted++; pending.push([row, col, rad, u, v]); continue }
        plot(row, col, rad, ray)
      }
    }
    /* 与网格同一条有限恢复策略：只重算耗尽的那几格，预算翻倍一次，不做第二次。 */
    if (pending.length) {
      for (var pi = 0; pi < pending.length; pi++) {
        var p = pending[pi]
        retried++
        var again = UniverseGeodesic.trace(p[3], p[4], angle, UniverseGeodesic.budget * 2)
        if (again.terminal === 'exhausted') unresolved++
        else plot(p[0], p[1], p[2], again)
      }
    }
    var ms = performance.now() - start
    /* 有射线没算完，遮罩就整体不发布：state 与计数一起返回，调用方据此知道环层为什么缺，
       而不是拿到一张看着正常、实际上缺了像素的图。 */
    if (unresolved) return { canvas: null, size: size, cx: cx, cy: cy, horizon: horizon, peak: peak,
      edge: edge, edgeMax: edgeMax,
      ms: ms, state: 'incomplete', attempted: attempted, drawn: drawn, exhausted: exhausted,
      retried: retried, unresolved: unresolved }
    octx.putImageData(image, 0, 0)
    return { canvas: off, size: size, cx: cx, cy: cy, horizon: horizon, peak: peak,
      edge: edge, edgeMax: edgeMax,
      ms: ms, state: 'ready', attempted: attempted, drawn: drawn, exhausted: exhausted,
      retried: retried, unresolved: 0 }
  }

  function create(canvas, input) {
    var config = options(input), ctx = canvas.getContext('2d', { alpha: true })
    if (!ctx) throw Error('Canvas 2D unavailable')
    var disposed = false, w = 0, h = 0, dpr = 1, mode = 'dark'
    var bakedRing = null, bakedFor = '', ringDiag = null, tintedRing = {}
    var viewX = 0, viewY = 0
    /* 洞的像素半径：与吸积盘 view().radius 同一个公式，阴影圆和盘的内缘才对得上。 */
    function radius() { return UniverseGeodesic.ratio * Math.min(w, h) / 2 }
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
          unresolved: baked.unresolved, peak: baked.peak, ms: baked.ms,
          edge: baked.edge, edgeMax: baked.edgeMax }
      } else {
        bakedRing = null
        /* drawn 记的是「真正发布出去」的像素数，所以失败分支永远是 0；
           烘到一半才被作废的那些像素记在 discarded 上，两个数分开。 */
        ringDiag = baked
          ? { state: baked.state, size: baked.size, attempted: baked.attempted, drawn: 0,
            discarded: baked.drawn, exhausted: baked.exhausted, retried: baked.retried,
            unresolved: baked.unresolved, peak: baked.peak, ms: baked.ms }
          : { state: 'unavailable' }
      }
      tintedRing = {}
    }
    /* 遮罩是白色 + alpha，贴图前按档染一次色：同一张遮罩只染一次，重画不再重算。
       染色用 'source-in' 换成纯色，alpha 通道原样保留。 */
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
    function redraw() {
      if (disposed || !w || !h) return
      var light = mode === 'light'
      var shifted = !!(viewX || viewY)
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      /* 取景位移与吸积盘同一套：画布不动、绘制原点整体平移，位移由挂载层的 transform 另行施加。 */
      ctx.setTransform(dpr, 0, 0, dpr, dpr * viewX, dpr * viewY)
      var baseX = w / 2, baseY = h / 2, horizon = radius()
      /* 阴影底色两档都要先铺：暗档若靠透明露出页面底纹，洞心就是一张静止的纹理而不是洞。 */
      ctx.beginPath()
      ctx.arc(baseX, baseY, horizon, 0, Math.PI * 2)
      ctx.fillStyle = light ? HORIZON_INK : SHADOW_INK
      ctx.fill()
      /* 光子环夹在阴影与盘字之间：盘的前景臂压在环上，「盘穿过洞前方」的遮挡关系不变。 */
      if (bakedRing) {
        var ringSize = bakedRing.size, scale = horizon / bakedRing.horizon
        var img = ringImage(light ? RING_INK_LIGHT : RING_INK_DARK)
        ctx.save()
        ctx.globalAlpha = light ? .74 : .86
        if (img) ctx.drawImage(img, baseX - ringSize / 2 * scale,
          baseY - ringSize / 2 * scale, ringSize * scale, ringSize * scale)
        ctx.restore()
      }
      if (shifted) ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    function resize() {
      var rect = canvas.getBoundingClientRect(), nw = rect.width || 0, nh = rect.height || 0
      /* 0 尺寸（挂载瞬间、容器被隐藏）：什么都别画，等 ResizeObserver 再来一次。 */
      if (!(nw > 0) || !(nh > 0)) { w = 0; h = 0; bakedRing = null; return }
      if (nw === w && nh === h && bakedRing) return
      w = nw; h = nh
      dpr = Math.min((typeof window !== 'undefined' && window.devicePixelRatio) || 1, 1.5)
      canvas.width = Math.max(1, Math.round(w * dpr))
      canvas.height = Math.max(1, Math.round(h * dpr))
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ensureRing()
      redraw()
    }
    resize()
    return {
      /* 取景位移：只在端点变化（转场起飞/落地），不在飞行途中逐帧调用。 */
      pose: function (next) {
        if (!next) return
        var nx = next.viewX === undefined ? viewX : Number(next.viewX) || 0
        var ny = next.viewY === undefined ? viewY : Number(next.viewY) || 0
        if (nx === viewX && ny === viewY) return
        viewX = nx; viewY = ny
        redraw()
      },
      setMode: function (next) {
        var value = next === 'light' ? 'light' : 'dark'
        if (value === mode) return
        mode = value
        redraw()
      },
      isLight: function () { return mode === 'light' },
      radius: radius,
      /* 吸积盘那一层查这张包络给环让位；没有环时返回 null，纯字符模式不需要让位。 */
      ring: function () { return bakedRing ? bakedRing : null },
      stats: function () {
        return { width: canvas.width, height: canvas.height, radius: radius(),
          ring: ringDiag ? Object.assign({}, ringDiag) : null }
      },
      resize: function () { resize() },
      dispose: function () {
        if (disposed) return
        disposed = true
        bakedRing = null; tintedRing = {}; ringDiag = { state: 'disposed' }
      }
    }
  }
  return { create: create, options: options }
})()
