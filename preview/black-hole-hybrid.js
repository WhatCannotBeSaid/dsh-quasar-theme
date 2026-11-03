/* Preview-only hybrid renderer: continuous shadow, photon ring and restrained
 * bloom under an ASCII accretion disk.
 *
 * Reuses the existing renderer instead of re-deriving the physics:
 *   - UniverseAccretionDisk.trace(u, v, angle)  geodesic march, disk crossings,
 *     Doppler boost, photon-sphere ring weight, capture flag.
 *   - UniverseAccretionDisk.shade(ray, time, brightness)  disk flux model.
 * Both come from src/runtime/accretion-disk.js, loaded by the page before this file.
 *
 * What is added here (art direction, not new physics):
 *   - The critical curve (impact parameter 3*sqrt(3) M) is solved analytically
 *     per screen angle, so the shadow edge and the thin ring are crisp vector
 *     shapes instead of glyph outlines.
 *   - A blurred copy of the traced disk supplies the soft halo.
 *   - Time is frozen: the orbital phase is a constant.
 *
 * The camera constants below mirror src/runtime/accretion-disk.js. If that module
 * changes DISTANCE or SHADOW_SHARE, the ring and the traced disk drift apart.
 */
(function () {
  'use strict'
  var U = window.UniverseAccretionDisk
  if (!U) throw new Error('UniverseAccretionDisk missing: load src/runtime/accretion-disk.js first')

  var DISTANCE = 60              // observer radius, mirrors src/runtime/accretion-disk.js
  var B_CRIT = 3 * Math.sqrt(3)  // critical impact parameter
  var SHADOW_SHARE = 0.40        // shadow spans this share of the short side
  var TAN_HALF = B_CRIT / DISTANCE / SHADOW_SHARE
  var INCLINATION = 9            // degrees above the disk plane, frozen
  var PHASE = 0                  // frozen orbital phase
  var FLUX = 1.35                 // fixed global disk brightness
  var CELL = 100                 // one glyph cell per viewport-height/CELL pixels
  var RAMP = ' .:-=+*o#%@'
  var PALETTE = ['#22130a', '#2f1a0d', '#3e2211', '#502b16', '#63351b', '#784021',
    '#8e4d28', '#a55b30', '#bd6c39', '#d58045', '#ec9a5c', '#ffe3b8']
  var STEPS = 512

  function smooth(lo, hi, x) {
    var t = Math.min(1, Math.max(0, (x - lo) / (hi - lo)))
    return t * t * (3 - 2 * t)
  }

  function impactAt(u, v) {
    var a = INCLINATION * Math.PI / 180, sa = Math.sin(a), ca = Math.cos(a)
    var dx = u * TAN_HALF, dy = -sa + v * TAN_HALF * ca, dz = -ca - v * TAN_HALF * sa
    var len = Math.sqrt(dx * dx + dy * dy + dz * dz)
    dx /= len; dy /= len; dz /= len
    var oy = DISTANCE * sa, oz = DISTANCE * ca
    var lx = oy * dz - oz * dy, ly = oz * dx, lz = -oy * dx
    return Math.sqrt(lx * lx + ly * ly + lz * lz)
  }

  function create(canvas) {
    var ctx = canvas.getContext('2d', { alpha: false })
    if (!ctx) throw new Error('Canvas 2D unavailable')
    var w = 0, h = 0, short = 0, cols = 0, rows = 0, cw = 0, ch = 0
    var values = [], glow = null, glowCtx = null, glowImage = null, peak = 1
    var shadow = null, generation = 0, timer = 0, ready = false, disposed = false
    var observer = new ResizeObserver(schedule)

    function schedule() {
      if (timer) clearTimeout(timer)
      timer = setTimeout(resize, 60)
    }

    function resize() {
      timer = 0
      if (disposed) return
      var rect = canvas.getBoundingClientRect()
      var nw = Math.max(1, Math.round(rect.width)), nh = Math.max(1, Math.round(rect.height))
      if (nw === w && nh === h && ready) return
      w = nw; h = nh; short = Math.min(w, h); ready = false; generation++
      var mine = generation
      var dpr = Math.min(window.devicePixelRatio || 1, 2)
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      cw = Math.max(4.5, Math.min(12, h / CELL))
      cols = Math.max(1, Math.round(w / cw)); cw = w / cols
      rows = Math.max(1, Math.round(h / (cw * 1.5))); ch = h / rows
      shadow = criticalCurve()
      glow = document.createElement('canvas')
      glow.width = cols; glow.height = rows
      glowCtx = glow.getContext('2d')
      glowImage = glowCtx.createImageData(cols, rows)
      values = new Array(cols * rows)
      canvas.dataset.hybridState = 'building'
      var row = 0
      function chunk() {
        timer = 0
        if (disposed || mine !== generation) return
        var start = performance.now()
        do {
          for (var col = 0; col < cols; col++) {
            var u = (2 * (col + 0.5) * cw - w) / short
            var v = (h - 2 * (row + 0.5) * ch) / short
            var ray = U.trace(u, v, INCLINATION)
            var value = 0
            if (ray.radius) {
              // Preview-only: relativistic beaming is damped to about half its
              // traced strength, so one limb does not flare into a white blob.
              var boost = 1 + (ray.boost - 1) * 0.4
              value = U.shade({ radius: ray.radius, phi: ray.phi, boost: boost }, PHASE, FLUX)
              // Preview tone curve: a soft shoulder keeps the brightest limb out
              // of flat white, so the glyph ramp stays legible all the way up.
              value = value / (1 + value * 1.5)
              // Preview exposure curve, not physics: hold the inner band, let the
              // outer disk fall away so the ring keeps a soft outer edge.
              value *= smooth(6.05, 6.6, ray.radius) * (1 - smooth(10.5, 14, ray.radius))
              // Restrained left/right asymmetry: brighter on the left.
              value *= 1 + 0.09 * (1 - 2 * ((col + 0.5) / cols))
            }
            values[row * cols + col] = value
          }
          row++
        } while (row < rows && performance.now() - start < 6)
        if (row < rows) timer = setTimeout(chunk, 0)
        else { blurCells(); measurePeak(); ready = true; canvas.dataset.hybridState = 'ready'; paint() }
      }
      timer = setTimeout(chunk, 0)
    }

    /* Display filter, not physics: two 3x3 box passes over the traced cell grid.
       Traced single-cell speckle would otherwise quantise into scattered glyph
       clusters; smoothing keeps the bright band and both arcs continuous. */
    function blurCells() {
      if (cols < 3 || rows < 3) return
      var a = values, b = new Array(values.length)
      for (var pass = 0; pass < 2; pass++) {
        for (var y = 0; y < rows; y++) {
          var y0 = y > 0 ? y - 1 : 0, y1 = y < rows - 1 ? y + 1 : rows - 1
          for (var x = 0; x < cols; x++) {
            var x0 = x > 0 ? x - 1 : 0, x1 = x < cols - 1 ? x + 1 : cols - 1
            var sum = 0
            for (var yy = y0; yy <= y1; yy++) {
              for (var xx = x0; xx <= x1; xx++) sum += a[yy * cols + xx]
            }
            b[y * cols + x] = sum / ((y1 - y0 + 1) * (x1 - x0 + 1))
          }
        }
        var swap = a; a = b; b = swap
      }
      if (a !== values) for (var i = 0; i < values.length; i++) values[i] = a[i]
    }

    /* Display exposure: normalise to the brightest traced cell so the ramp uses
       its whole alphabet. Without this every covered cell lands on the same
       glyph and the disk reads as one flat slab of 'o'. */
    function measurePeak() {
      peak = 0
      for (var i = 0; i < values.length; i++) if (values[i] > peak) peak = values[i]
      if (!(peak > 0)) peak = 1
    }

    function levelAt(i) {
      var t = values[i] / peak
      if (!(t > 0)) return 0
      return Math.pow(t, 0.8)
    }

    /* Solve impact(u,v) = B_CRIT outward from the centre, one point per screen
       angle: the near-circular shadow edge and the ring both ride this polygon. */
    function criticalCurve() {
      var path = new Path2D()
      var lo = 0.0025, hi = 2.4
      for (var k = 0; k <= STEPS; k++) {
        var t = k / STEPS * Math.PI * 2, du = Math.cos(t), dv = Math.sin(t)
        var a = lo, b = hi
        for (var i = 0; i < 44; i++) {
          var mid = (a + b) * 0.5
          if (impactAt(du * mid, dv * mid) < B_CRIT) a = mid; else b = mid
        }
        var r = (a + b) * 0.5
        var px = (du * r * short + w) * 0.5, py = (h - dv * r * short) * 0.5
        if (k === 0) path.moveTo(px, py); else path.lineTo(px, py)
      }
      path.closePath()
      return path
    }

    function buildGlow() {
      var data = glowImage.data
      for (var i = 0; i < values.length; i++) {
        var value = levelAt(i), p = i * 4
        data[p + 3] = 0
        if (!(value > 0)) continue
        var index = Math.min(PALETTE.length - 1, Math.floor(Math.pow(value, 0.8) * PALETTE.length))
        var hex = PALETTE[index]
        data[p] = parseInt(hex.slice(1, 3), 16)
        data[p + 1] = parseInt(hex.slice(3, 5), 16)
        data[p + 2] = parseInt(hex.slice(5, 7), 16)
        data[p + 3] = Math.round(Math.min(1, Math.pow(value, 1.1)) * 235)
      }
      glowCtx.putImageData(glowImage, 0, 0)
    }

    function paint() {
      if (disposed || !ready) return
      ctx.globalCompositeOperation = 'source-over'
      ctx.globalAlpha = 1
      ctx.filter = 'none'
      ctx.fillStyle = '#03050a'
      ctx.fillRect(0, 0, w, h)
      var lift = ctx.createRadialGradient(w * 0.5, h * 0.46, short * 0.04, w * 0.5, h * 0.46, short * 0.92)
      lift.addColorStop(0, 'rgba(20,16,18,1)')
      lift.addColorStop(0.55, 'rgba(9,8,11,1)')
      lift.addColorStop(1, 'rgba(3,4,8,1)')
      ctx.fillStyle = lift
      ctx.fillRect(0, 0, w, h)

      // 1. Shadow: flat, clean, slightly darker than the sky.
      ctx.fillStyle = '#010206'
      ctx.fill(shadow)

      // 2. Disk bloom from the traced cells, two passes (tight + wide haze).
      buildGlow()
      ctx.save()
      ctx.globalCompositeOperation = 'lighter'
      ctx.imageSmoothingEnabled = true
      ctx.globalAlpha = 0.30
      ctx.filter = 'blur(' + Math.max(6, Math.round(cw * 1.7)) + 'px)'
      ctx.drawImage(glow, 0, 0, w, h)
      ctx.globalAlpha = 0.12
      ctx.filter = 'blur(' + Math.max(18, Math.round(cw * 6)) + 'px)'
      ctx.drawImage(glow, 0, 0, w, h)
      ctx.restore()

      // 3. Photon ring: one thin bright stroke with a small shadow blur halo,
      //    shaded left-to-right so the two sides are not equally bright.
      var tint = ctx.createLinearGradient(0, 0, w, 0)
      tint.addColorStop(0, 'rgba(255,244,222,0.98)')
      tint.addColorStop(0.45, 'rgba(255,236,204,0.9)')
      tint.addColorStop(1, 'rgba(255,222,182,0.62)')
      ctx.save()
      ctx.lineJoin = 'round'
      ctx.shadowColor = 'rgba(255,186,116,0.55)'
      ctx.shadowBlur = short * 0.045
      ctx.strokeStyle = tint
      ctx.lineWidth = Math.max(1.15, short * 0.0021)
      ctx.stroke(shadow)
      ctx.restore()

      // 4. ASCII disk last: the near side of the disk crosses in front of the
      //    shadow and stays visible, because nothing is painted over it after.
      ctx.font = '600 ' + Math.round(ch * 0.94) + 'px ui-monospace, "Cascadia Mono", Consolas, monospace'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      for (var row = 0; row < rows; row++) {
        for (var col = 0; col < cols; col++) {
          var value = levelAt(row * cols + col)
          if (!(value > 0.055)) continue
          var index = Math.floor(Math.pow(value, 1.25) * (RAMP.length - 1) + 0.5)
          var glyph = RAMP.charAt(Math.min(RAMP.length - 1, Math.max(1, index)))
          ctx.fillStyle = PALETTE[Math.min(PALETTE.length - 1, Math.floor(Math.pow(value, 0.85) * PALETTE.length))]
          ctx.fillText(glyph, (col + 0.5) * cw, (row + 0.5) * ch)
        }
      }
    }

    observer.observe(canvas)
    resize()
    return {
      paint: paint,
      dispose: function () {
        if (disposed) return
        disposed = true; generation++
        if (timer) clearTimeout(timer)
        observer.disconnect()
        values = []
        canvas.dataset.hybridState = 'disposed'
      }
    }
  }

  window.UniverseAccretionDiskHybrid = { create: create, impactAt: impactAt, constants: {
    DISTANCE: DISTANCE, B_CRIT: B_CRIT, TAN_HALF: TAN_HALF, INCLINATION: INCLINATION } }
})()
