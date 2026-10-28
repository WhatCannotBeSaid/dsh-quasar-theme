/* Deep-space field for the conversation column.
 *
 * The sky is a fixed character grid, not a list of particles. Every cell carries
 * one sample of one smooth scalar field, and both the glyph and its alpha come
 * from that sample alone, so neighbouring cells are one ramp step apart and the
 * eye reads a cloud instead of separate sparks.
 *
 * The nebula is a three-octave value noise, domain-warped by two slower octaves
 * and then read through a geometry mask: the middle of the column is cleared, the
 * two side bands and the outer rim keep the cloud. The field is re-sampled a
 * dozen times a second from a time-warped coordinate, which makes the cloud
 * breathe in place -- nothing in the picture travels across the screen, because
 * the stars are placed once per rebuild from a cell hash and never move.
 *
 * Integration contract borrowed from dsh-ascii-whales (the only reference used
 * here): one canvas per [data-conversation-content] column, absolute inset:0 in
 * its own stacking context, pointer-events:none, an IntersectionObserver so an
 * off-screen column costs nothing, and a disposer that leaves no observer, timer,
 * animation frame or DOM node behind. Unlike that project the canvas is NOT
 * limited to the empty (hero) page: it is shown over a conversation too, so the
 * transcript, the composer and the toolbar stay clear because the field is faded
 * inside the reading ellipse and cut out under the composer.
 *
 * Cost stays bounded by growing the cell until the grid fits about 9000 cells, and
 * by skipping the field evaluation for every cell the mask already cleared.
 */
var UniverseDeepSpace = (function () {
  var NEBULA = ' .:;'
  var STARS = ".'+*"
  var HOST = '[data-conversation-content]'
  var HERO = "[data-slot='conversation.hero.brand.mark'],[data-slot='conversation.hero.workspace']"
  var COMPOSER = "[data-conversation-region='composer']"
  var MARK = 'uniDeepSpace'
  var TINT = { dark: '208,214,222', light: '62,64,72' }
  var CELLS = 16000
  var NEBULA_PEAK = 0.72
  var defaults = { cell: 8, fps: 8, density: 0.035, nebula: 1, quiet: 0.96, drift: 1, maxAlpha: 0.42 }

  function options(input) {
    input = input || {}
    function number(key, min, max) {
      var n = Number(input[key])
      return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : defaults[key]
    }
    return {
      cell: number('cell', 8, 32),
      fps: number('fps', 1, 30),
      density: number('density', 0, 0.3),
      nebula: number('nebula', 0, 1),
      quiet: number('quiet', 0, 1),
      drift: number('drift', 0, 4),
      maxAlpha: number('maxAlpha', 0.05, 0.6),
    }
  }

  function smooth(low, high, value) {
    var t = Math.min(1, Math.max(0, (value - low) / (high - low)))
    return t * t * (3 - 2 * t)
  }

  /* Deterministic per-cell hash in [0,1). Everything the build needs to look
     random -- star chance, star magnitude, the dither that softens the fringe --
     comes from here, so a rebuild of the same grid draws the same sky. */
  function hash01(x, y, salt) {
    var h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(salt | 0, 1274126177)
    h = Math.imul(h ^ (h >>> 13), 1274126177)
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296
  }

  /* Bilinear value noise on the integer lattice with a cubic fade. Cheaper than a
     gradient noise and, at three octaves, smooth enough that a ramp step never
     turns into a visible edge. */
  function noise(x, y) {
    var ix = Math.floor(x), iy = Math.floor(y)
    var fx = x - ix, fy = y - iy
    var u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy)
    var a = hash01(ix, iy, 17), b = hash01(ix + 1, iy, 17)
    var c = hash01(ix, iy + 1, 17), d = hash01(ix + 1, iy + 1, 17)
    var top = a + (b - a) * u, bottom = c + (d - c) * u
    return top + (bottom - top) * v
  }

  function fbm(x, y) {
    /* Two octaves, low one dominant. A third octave adds variance at the cell
       scale, and variance at the cell scale is exactly what reads as grain: the
       eye stops seeing a cloud and starts seeing static. */
    return (noise(x + 7.3, y - 4.1) * 0.68
      + noise(x * 2.4 - 11.7, y * 2.4 + 5.9) * 0.32)
  }

  /* Filaments: the cloud's fine structure, at roughly a third of its wavelength.
     The lit marks are grouped by this field instead of by an independent per-cell
     hash, so neighbours light up together and the result is wisps and gaps rather
     than white noise. */
  function filaments(x, y) {
    /* Rotated off the axes on purpose: an axis-aligned lattice draws vertical
       seams that read as rain, and value noise has no way to hide them. */
    var rx = (x * 0.7071 - y * 0.7071) * 0.019
    var ry = (x * 0.7071 + y * 0.7071) * 0.024
    return noise(rx + 31.7, ry - 17.3) * 0.70
      + noise(rx * 2.3 - 5.1, ry * 2.3 + 23.9) * 0.30
  }

  /* One sample of the cloud. The two slow noises displace the sample point, which
     is what turns a static blob into something that folds; the drift terms move
     the whole field about 60px per ten minutes, slow enough to never read as
     scrolling. Both are driven by the same clock so a pause freezes the shape. */
  function field(x, y, time) {
    /* Features are deliberately large -- a third of the panel -- and the vertical
       scale is shorter than the horizontal one, so the result stretches into
       veils instead of round puffs. Drift is about 15px a minute. */
    var drift = time * 0.0008
    var px = x * 0.0032, py = y * 0.0021
    var qx = noise(px + drift * 0.6 + 4.3, py - drift * 0.25 + 1.9)
    var qy = noise(px - drift * 0.3 + 9.1, py + drift * 0.45 - 2.7)
    var wx = px + (qx - 0.5) * 1.15 + drift * 0.05
    var wy = py + (qy - 0.5) * 1.15 - drift * 0.03
    /* Rotate the lattice so the octaves do not line up with the screen axes. */
    return fbm(wx * 0.78 - wy * 0.62, wx * 0.62 + wy * 0.78)
  }

  /* Four magnitude tiers, drawn 84/12/3/1 per hundred. Every value is a share of
     maxAlpha, so the ceiling option stays the ceiling. */
  function starTier(h) {
    if (h < 0.84) return { glyph: 1, alpha: 0.28 + h * 0.21 }
    if (h < 0.96) return { glyph: 2, alpha: 0.52 + (h - 0.84) * 1.4 }
    if (h < 0.99) return { glyph: 3, alpha: 0.72 + (h - 0.96) * 2.4 }
    return { glyph: 4, alpha: 0.88 + (h - 0.99) * 12 }
  }

  function rectOf(element) {
    if (!element || typeof element.getBoundingClientRect !== 'function') return null
    var box = element.getBoundingClientRect()
    if (!box || !(box.width > 0) || !(box.height > 0)) return null
    return box
  }

  function create(canvas, input) {
    var config = options(input)
    var ctx = canvas.getContext('2d')
    var width = 0, height = 0, dpr = 1, cols = 0, rows = 0, cw = 0, ch = 0, cells = 0
    var mask = null
    var shine = null, baseX = null, baseY = null, grain = null, dither = null
    var jitterX = null, jitterY = null, starGlyph = null, starAlpha = null
    var starCount = 0, litCount = 0
    var elapsed = 0, previous = 0, lastDraw = -Infinity, raf = 0
    var paintCount = 0, paintCpu = 0, buildCpu = 0
    var levels = [0, 0, 0, 0, 0, 0]
    var ready = false, disposed = false, visible = true, reduced = false
    var mode = 'dark', tint = TINT.dark, palette = {}
    var rebuildTimer = 0, timers = []
    var motion = typeof window !== 'undefined' && window.matchMedia
      ? window.matchMedia('(prefers-reduced-motion: reduce)')
      : null

    if (motion && typeof motion.matches === 'boolean') reduced = motion.matches

    function mark(state) {
      if (canvas.dataset) canvas.dataset[MARK + 'State'] = state
    }

    function clearTimers() {
      while (timers.length) clearTimeout(timers.pop())
      rebuildTimer = 0
    }

    function later(fn, delay) {
      var id = setTimeout(function () {
        var at = timers.indexOf(id)
        if (at >= 0) timers.splice(at, 1)
        if (!disposed) fn()
      }, delay)
      timers.push(id)
      return id
    }

    /* Cache one rgba string per quantised alpha so the paint loop stops building
       strings; the cache is dropped whenever the theme flips the tint. */
    function ink(alpha) {
      var key = Math.round(alpha * 200)
      if (key < 1) key = 1
      if (key > 200) key = 200
      var value = palette[key]
      if (value === undefined) {
        value = 'rgba(' + tint + ',' + (key / 200).toFixed(3) + ')'
        palette[key] = value
      }
      return value
    }

    /* Boxes that must stay empty: the composer rectangle and the hero mark. They
       are read in canvas-local coordinates, because the canvas paints in CSS
       pixels of its own column. */
    function hotspotNodes() {
      var out = []
      if (typeof document === 'undefined') return out
      var scope = canvas.parentElement || canvas.parentNode || document
      var selectors = [COMPOSER, HERO]
      for (var s = 0; s < selectors.length; s++) {
        var nodes = null
        if (scope && typeof scope.querySelectorAll === 'function') nodes = scope.querySelectorAll(selectors[s])
        if ((nodes === null || nodes.length === 0) && typeof document.querySelectorAll === 'function') {
          nodes = document.querySelectorAll(selectors[s])
        }
        if (!nodes) continue
        for (var i = 0; i < nodes.length; i++) {
          if (out.indexOf(nodes[i]) < 0) out.push(nodes[i])
        }
      }
      return out
    }

    function hotspots() {
      var list = []
      var self = rectOf(canvas)
      if (self === null) return list
      var nodes = hotspotNodes()
      for (var i = 0; i < nodes.length; i++) {
        var box = rectOf(nodes[i])
        if (box === null) continue
        var pad = nodes[i].getAttribute && nodes[i].getAttribute('data-conversation-region') === 'composer' ? 10 : 8
        list.push({
          left: box.left - self.left - pad,
          right: box.right - self.left + pad,
          top: box.top - self.top - pad,
          bottom: box.bottom - self.top + pad,
        })
      }
      return list
    }

    function blocked(boxes, x, y) {
      for (var i = 0; i < boxes.length; i++) {
        var box = boxes[i]
        if (x >= box.left && x <= box.right && y >= box.top && y <= box.bottom) return true
      }
      return false
    }

    /* One pass over the grid. Everything geometric is computed here, not per
       frame: the mask, the noise coordinates, the dither grain and the stars. */
    function build() {
      var started = typeof performance !== 'undefined' ? performance.now() : 0
      var box = rectOf(canvas)
      if (box === null) {
        ready = false
        return false
      }
      width = Math.round(box.width)
      height = Math.round(box.height)
      ready = false
      /* A lost context (GPU blocklist, context stolen) is not a crash: the sky
         stays empty and the caller keeps its canvas. */
      if (!ctx || typeof ctx.fillText !== 'function') return false
      if (width < 24 || height < 24) return false

      dpr = typeof window !== 'undefined' && window.devicePixelRatio > 0
        ? Math.min(2, window.devicePixelRatio)
        : 1
      canvas.width = Math.max(1, Math.round(width * dpr))
      canvas.height = Math.max(1, Math.round(height * dpr))
      if (typeof ctx.setTransform === 'function') ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

      var size = Math.max(config.cell, Math.sqrt((width * height) / CELLS))
      cols = Math.max(3, Math.round(width / size))
      rows = Math.max(3, Math.round(height / size))
      cw = width / cols
      ch = height / rows
      var total = cols * rows

      var nextMask = new Float32Array(total)
      var nextShine = new Float32Array(total)
      var nextX = new Float32Array(total)
      var nextY = new Float32Array(total)
      var nextGrain = new Float32Array(total)
      var nextDither = new Float32Array(total)
      var nextJx = new Float32Array(total)
      var nextJy = new Float32Array(total)
      var nextGlyph = new Uint8Array(total)
      var nextAlpha = new Float32Array(total)
      var boxes = hotspots()

      var cx = width * 0.5, cy = height * 0.46
      /* The quiet zone is the reading column itself, not a circle: messages run
         the full height of the panel, so a rectangular keep-out with a feathered
         rim is what actually protects the text. */
      var hw = Math.min(width * 0.36, 420), hh = height * 0.46
      var pad = Math.min(hw, hh) * 0.55
      /* Left veil, right shoulder, floor haze. Fractions of the panel, so the
         composition survives any window size. */
      /* Bands, not blobs: a nebula is read from its sheets, and a tilted ribbon
         is recognised long before a round haze is. Each band keeps its width,
         loses it at both ends, and is graded by the noise so it breaks into
         clumps instead of running like a stripe. */
      var bands = [
        { x: width * 0.17, y: height * 0.78, angle: -0.24, len: height * 0.62, width: height * 0.16, peak: 1.00 },
        { x: width * 0.90, y: height * 0.26, angle: 0.28, len: height * 0.46, width: height * 0.12, peak: 0.92 },
        { x: width * 0.52, y: height * 0.98, angle: 0.03, len: width * 0.40, width: height * 0.10, peak: 0.58 },
      ]
      var lit = 0, stars = 0

      for (var row = 0; row < rows; row++) {
        for (var col = 0; col < cols; col++) {
          var index = row * cols + col
          var x = (col + 0.5) * cw
          var y = (row + 0.5) * ch
          /* Sample the two sides from the same field but at different offsets:
             the noise is amorphous, so neither side runs dry, and the offset
             keeps the panel from becoming an obvious mirror. */
          nextX[index] = cx - Math.abs(x - cx) + (x > cx ? 137 : 0)
          nextY[index] = y
          nextGrain[index] = hash01(col, row, 5)
          nextDither[index] = hash01(col, row, 71)
          /* Just under half a cell of jitter, drawn from the same hash. Without it the
             glyphs sit on a perfect lattice and a flat patch of one ramp step
             reads as a screen door rather than as cloud. */
          nextJx[index] = (hash01(col, row, 83) - 0.5) * cw * 0.62
          nextJy[index] = (hash01(col, row, 97) - 0.5) * ch * 0.62
          if (blocked(boxes, x, y)) continue

          var qx = Math.max(0, Math.abs(x - cx) - (hw - pad)) / pad
          var qy = Math.max(0, Math.abs(y - cy) - (hh - pad)) / pad
          var q = Math.sqrt(qx * qx + qy * qy)
          var reading = 1 - smooth(0.62, 1.30, q)

          /* The veils are placed, not discovered: three soft kernels -- one down
             the left, one on the right shoulder, a low haze along the floor.
             A pure noise field has no silhouette, and without a silhouette the
             eye has nothing to recognise, no matter how good the grain is. The
             noise below only warps their rims and textures their bodies. */
          var warp = (noise(x * 0.0034 + 3.3, y * 0.0034 - 7.1) - 0.5) * 1.35
            + (noise(x * 0.0092 - 8.4, y * 0.0092 + 2.6) - 0.5) * 0.35
          var shape = 0
          for (var k = 0; k < bands.length; k++) {
            var band = bands[k]
            var turn = band.angle + warp * 0.18
            var ca = Math.cos(turn), sa = Math.sin(turn)
            var ux = x - band.x, uy = y - band.y
            var along = (ux * ca + uy * sa) / band.len
            var across = (uy * ca - ux * sa) / band.width
            var fall = band.peak * (1 - smooth(0.52, 1.06, Math.abs(along)))
            fall *= 1 - smooth(0.28, 1.02, Math.abs(across) * (1 + warp * 0.40))
            if (fall > shape) shape = fall
          }
          /* The body of every veil is filled; the noise only grades it, which is
             what keeps a solid mass from looking like a flat disc. */
          var density = shape > 0
            ? shape * (0.34 + 0.66 * smooth(0.34, 0.66, field(x, y, 0)))
            : 0
          nextShine[index] = density
          /* Visibility is the reading gate alone; the density carries the shape,
             so a cloud can be thin at its rim without vanishing. */
          var m = 1 - config.quiet * reading
          if (m > 0.02) nextMask[index] = m

          /* Stars are tied to the geometry, not to the cloud, so the fringe and
             the cleared middle keep a few very dim ones. */
          var rate = config.density * 1.4 * (0.10 + 0.90 * density)
          if (rate > 0 && hash01(col, row, 23) < rate) {
            var star = starTier(hash01(col, row, 41))
            nextGlyph[index] = star.glyph
            nextAlpha[index] = star.alpha * config.maxAlpha
            stars++
          }
        }
      }

      /* The overlap of the puffs saturates a raw sum, and a saturated cloud is
         a flat rectangle of texture. Normalising against the field's own peak
         is what gives the mass a real core and a real edge. */
      for (var n = 0; n < total; n++) {
        if (nextShine[n] > 0.10 && nextMask[n] > 0.02) lit++
      }

      mask = nextMask
      shine = nextShine
      baseX = nextX
      baseY = nextY
      grain = nextGrain
      dither = nextDither
      jitterX = nextJx
      jitterY = nextJy
      starGlyph = nextGlyph
      starAlpha = nextAlpha
      cells = total
      starCount = stars
      litCount = lit
      ready = true
      buildCpu = (typeof performance !== 'undefined' ? performance.now() : 0) - started
      mark('ready')
      watchHotspots()
      return true
    }

    function paint() {
      if (disposed || !ready || cells === 0 || !ctx || typeof ctx.fillText !== 'function') return
      var started = typeof performance !== 'undefined' ? performance.now() : 0
      if (typeof ctx.clearRect === 'function') ctx.clearRect(0, 0, width, height)
      var scale = mode === 'light' ? 1.9 : 1
      var peak = config.maxAlpha * NEBULA_PEAK
      var top = NEBULA.length - 1
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.font = '600 ' + Math.round(ch * 0.92) + 'px ui-monospace, SFMono-Regular, Menlo, monospace'
      var hist = [0, 0, 0, 0, 0, 0]

      for (var i = 0; i < cells; i++) {
        var glyph = '', alpha = 0
        var m = mask[i]
        if (m > 0.02) {
          /* The density is baked, so a frame only has to choose a glyph and an
             alpha. Breathing is one sine on a slowly varying phase: the mass
             swells and dims where it is thick, which is the only motion the
             picture needs. */
          /* Only the body of the cloud draws. A faint everywhere-field is what
             makes a picture read as grain; the black gaps between the veils are
             the depth. */
          var body = shine[i] * config.nebula
          if (body > 0.08) {
            var mass = Math.pow((body - 0.08) / 0.92, 0.72)
            var breath = 1 + 0.16 * Math.sin(elapsed * 0.045 + body * 7.5)
            var level = 1 + Math.floor(mass * (top - 1) + dither[i] * 0.22)
            if (level > top) level = top
            alpha = peak * Math.pow(mass, 0.80) * m * breath
            if (alpha > 0.006) {
              hist[level]++
              glyph = NEBULA.charAt(level)
            }
          }
        }
        var sg = starGlyph[i]
        if (sg !== 0) {
          glyph = STARS.charAt(sg - 1)
          alpha = starAlpha[i]
        }
        if (glyph === '' || alpha <= 0.006) continue
        if (alpha > config.maxAlpha) alpha = config.maxAlpha
        ctx.fillStyle = ink(alpha * scale)
        ctx.fillText(glyph,
          (i % cols + 0.5) * cw + jitterX[i],
          (((i / cols) | 0) + 0.5) * ch + jitterY[i])
      }

      levels = hist
      if (typeof performance !== 'undefined') paintCpu += performance.now() - started
      paintCount++
    }

    /* A column is 12fps, not 60: the field changes over minutes, so frames are
       spent on a grid of samples, never on motion. Slow cloud alone justifies the
       loop; drift 0 freezes it and drops to the single still frame. */
    function running() {
      return !disposed && ready && visible && !reduced && config.drift > 0 && width > 0
        && typeof document !== 'undefined' && !document.hidden
    }

    function stop() {
      if (raf) cancelAnimationFrame(raf)
      raf = 0
      previous = 0
    }

    function sync() {
      stop()
      if (typeof document === 'undefined' || !document.hidden) {
        if (visible) paint()
      }
      if (running()) raf = requestAnimationFrame(tick)
    }

    function tick(now) {
      raf = 0
      if (!running()) return
      if (previous) elapsed += Math.min(0.25, (now - previous) / 1000) * config.drift
      previous = now
      var interval = 1000 / config.fps
      if (now - lastDraw >= interval - 0.5) {
        paint()
        lastDraw = now
      }
      raf = requestAnimationFrame(tick)
    }

    function rebuild() {
      rebuildTimer = 0
      if (disposed) return
      if (build()) sync()
      else mark('waiting')
    }

    var resizer = typeof ResizeObserver === 'function' ? new ResizeObserver(function () {
      if (disposed || rebuildTimer !== 0) return
      rebuildTimer = later(rebuild, 140)
    }) : null
    if (resizer) resizer.observe(canvas)

    /* The composer grows to several lines while someone types. Its rectangle is
       cut out of the sky at build time, so without this the new rows would keep
       the glyphs painted for the shorter box. */
    var hot = typeof ResizeObserver === 'function' ? new ResizeObserver(function () {
      if (disposed || rebuildTimer !== 0) return
      rebuildTimer = later(rebuild, 120)
    }) : null

    function watchHotspots() {
      if (!hot || typeof hot.observe !== 'function') return
      var nodes = hotspotNodes()
      for (var i = 0; i < nodes.length; i++) {
        try { hot.observe(nodes[i]) } catch (error) { /* detached node */ }
      }
    }

    var watcher = typeof IntersectionObserver === 'function' ? new IntersectionObserver(function (entries) {
      visible = !!(entries[0] && entries[0].isIntersecting)
      sync()
    }) : null
    if (watcher) watcher.observe(canvas)

    /* The tint is re-read, not remembered: the old build sampled colorScheme once
       at create time, so a light/dark flip left a white-on-white sky. Both the
       shell's scheme and the theme's own body[data-ds-dark-theme] switch land
       here. */
    function applyMode() {
      var scheme = ""
      var body = typeof document !== "undefined" ? document.body : null
      /* The column is the element that actually carries the theme color-scheme:
         it is what paints the panel behind the glyphs. Reading the body only
         meant a light panel inside a dark document chose the wrong tint, and the
         field near vanished. */
      var host = (canvas && (canvas.parentElement || canvas.parentNode)) || body
      if (body && typeof body.hasAttribute === "function" && body.hasAttribute("data-ds-dark-theme")) {
        scheme = "dark"
      } else if (host && typeof getComputedStyle === "function") {
        try { scheme = getComputedStyle(host).colorScheme || "" } catch (error) { scheme = "" }
        if (!scheme && body && typeof getComputedStyle === "function") {
          try { scheme = getComputedStyle(body).colorScheme || "" } catch (error2) { scheme = "" }
        }
      }
      mode = scheme.indexOf('light') >= 0 && scheme.indexOf('dark') < 0 ? 'light' : 'dark'
      tint = TINT[mode]
      palette = {}
      if (ready && !running()) paint()
    }

    var theme = typeof MutationObserver === 'function' ? new MutationObserver(applyMode) : null
    var attributes = ['style', 'class', 'data-ds-dark-theme', 'data-theme']
    if (theme && typeof document !== 'undefined') {
      if (document.documentElement) theme.observe(document.documentElement, { attributes: true, attributeFilter: attributes })
      if (document.body) theme.observe(document.body, { attributes: true, attributeFilter: attributes })
      /* applyMode() reads the column's own color-scheme, so a flip that lands
         only on the column has to be watched too. */
      var themeRoot = canvas.parentElement || canvas.parentNode
      if (themeRoot && typeof themeRoot.setAttribute === 'function') {
        try { theme.observe(themeRoot, { attributes: true, attributeFilter: attributes }) } catch (error) { /* detached */ }
      }
    }

    function onMotion() {
      reduced = !!motion.matches
      sync()
    }

    if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
      document.addEventListener('visibilitychange', sync)
    }
    if (motion && typeof motion.addEventListener === 'function') motion.addEventListener('change', onMotion)

    applyMode()
    rebuild()

    return {
      stats: function () {
        return {
          ready: ready,
          stars: starCount,
          nebula: levels[1] + levels[2] + levels[3] + levels[4],
          levels: levels.slice(),
          lit: litCount,
          cells: cells,
          cell: cw,
          columns: cols,
          rows: rows,
          width: width,
          height: height,
          frames: paintCount,
          buildCpuMs: buildCpu,
          meanPaintMs: paintCount === 0 ? 0 : paintCpu / paintCount,
          running: raf !== 0,
          reducedMotion: reduced,
          mode: mode,
          config: Object.assign({}, config),
        }
      },
      /* Same surface as the black hole: changing a number rebuilds the sky, and
         drift 0 freezes it without tearing the canvas down. */
      update: function (patch) {
        if (disposed) return
        config = options(Object.assign({}, config, patch))
        if (rebuildTimer !== 0) return
        rebuildTimer = later(rebuild, 60)
      },
      dispose: function () {
        if (disposed) return
        disposed = true
        stop()
        clearTimers()
        mark('disposed')
        if (resizer && typeof resizer.disconnect === 'function') resizer.disconnect()
        if (hot && typeof hot.disconnect === 'function') hot.disconnect()
        if (watcher && typeof watcher.disconnect === 'function') watcher.disconnect()
        if (theme && typeof theme.disconnect === 'function') theme.disconnect()
        if (typeof document !== 'undefined' && typeof document.removeEventListener === 'function') {
          document.removeEventListener('visibilitychange', sync)
        }
        if (motion && typeof motion.removeEventListener === 'function') motion.removeEventListener('change', onMotion)
        mask = null
        shine = null
        baseX = null
        baseY = null
        grain = null
        dither = null
        jitterX = null
        jitterY = null
        starGlyph = null
        starAlpha = null
        cells = 0
      },
    }
  }

  /* Mounting is the theme's half of the job: find the column, put the canvas in
     the one layer that survives what React does to it, and hand back a disposer.
     Idempotent -- a second call reuses the canvas already there, which is what
     keeps an effect re-run from stacking a second canvas and a second loop. */
  function mount(host, input) {
    if (typeof document === 'undefined') return undefined
    var target = host || document.querySelector(HOST)
    if (!target || typeof document.createElement !== 'function') return undefined
    var existing = target.querySelector('canvas[data-' + 'deep-space]')
    if (existing && existing.dataset && existing.dataset.deepSpaceOwner === 'universe') {
      if (typeof existing.__uniDeepSpaceDispose === 'function') return existing.__uniDeepSpaceDispose
      /* An earlier mount left its canvas behind without a disposer (create
         threw). Clear it instead of stacking a second one on top. */
      if (existing.parentNode) existing.parentNode.removeChild(existing)
    }
    var canvas = document.createElement('canvas')
    canvas.setAttribute('aria-hidden', 'true')
    canvas.setAttribute('data-deep-space', '')
    canvas.dataset.deepSpaceOwner = 'universe'
    canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;'
      + 'z-index:-1;pointer-events:none;display:block'

    var computed = null
    try { computed = getComputedStyle(target) } catch (error) { computed = null }
    var restorePosition = false
    var restoreIsolation = false
    if (computed !== null) {
      if (computed.position === 'static') {
        target.style.position = 'relative'
        restorePosition = true
      }
      if (computed.isolation !== 'isolate') {
        target.style.isolation = 'isolate'
        restoreIsolation = true
      }
    }
    target.insertBefore(canvas, target.firstChild)

    var controller = null
    try {
      controller = create(canvas, input)
    } catch (error) {
      controller = null
    }
    if (controller === null) {
      /* Nothing to animate (no 2D context, or a create() failure): put the
         column back exactly as it was rather than leave an inert overlay. */
      if (canvas.parentNode) canvas.parentNode.removeChild(canvas)
      if (restorePosition) target.style.position = ''
      if (restoreIsolation) target.style.isolation = ''
      return undefined
    }
    /* Debug handle for the preview harness and the browser console; the canvas is
       removed on dispose, so it cannot outlive the controller. */
    canvas.__uniDeepSpace = controller

    /* React may rebuild the column's children on its own schedule. When the
       canvas is the thing that got dropped, put it back and repaint: otherwise
       the sky would be gone for the rest of the session. */
    var gone = false
    var guard = typeof MutationObserver === 'function' ? new MutationObserver(function () {
      if (gone || canvas.parentNode === target) return
      if (target.isConnected === false) return
      target.insertBefore(canvas, target.firstChild)
      controller.update({})
    }) : null
    if (guard && typeof guard.observe === 'function') guard.observe(target, { childList: true })

    function dispose() {
      if (gone) return
      gone = true
      controller.dispose()
      if (guard && typeof guard.disconnect === 'function') guard.disconnect()
      if (canvas.parentNode) canvas.parentNode.removeChild(canvas)
      if (restorePosition) target.style.position = ''
      if (restoreIsolation) target.style.isolation = ''
    }
    canvas.__uniDeepSpaceDispose = dispose
    return dispose
  }

  function isHome() {
    if (typeof document === 'undefined') return false
    return document.querySelector(HERO) !== null
  }

  /* One watcher for both backgrounds. The conversation column is created and
     destroyed as the shell moves between pages, so this reports not only whether
     the home page is showing but also when the host element it painted into has
     been replaced -- otherwise the sky would vanish after the first session
     switch and never come back.

     Mutations on a streaming transcript are frequent, so the check is collapsed
     into one wake-up per 180ms. */
  function watchPageMode(callback) {
    if (typeof document === 'undefined' || typeof callback !== 'function') {
      return function noop() {}
    }
    var stopped = false
    var timer = 0
    var lastHome = null
    var lastHost = null

    function check() {
      timer = 0
      if (stopped) return
      var home = isHome()
      var host = home ? null : document.querySelector(HOST)
      if (home === lastHome && host === lastHost) return
      lastHome = home
      lastHost = host
      callback(home)
    }

    function wake() {
      if (stopped || timer !== 0) return
      timer = setTimeout(check, 180)
    }

    var observer = null
    if (typeof MutationObserver === 'function') {
      observer = new MutationObserver(wake)
      var root = document.body || document.documentElement
      if (root) observer.observe(root, { childList: true, subtree: true })
    }
    check()

    return function stop() {
      if (stopped) return
      stopped = true
      if (timer !== 0) clearTimeout(timer)
      timer = 0
      if (observer !== null) observer.disconnect()
    }
  }

  return {
    options: options,
    create: create,
    mount: mount,
    isHome: isHome,
    watchPageMode: watchPageMode,
    field: field,
    glyphs: NEBULA + STARS,
  }
})()
