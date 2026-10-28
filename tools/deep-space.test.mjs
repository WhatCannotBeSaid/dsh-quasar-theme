import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFileSync } from 'node:fs'
import { performance } from 'node:perf_hooks'

const source = readFileSync(new URL('../src/runtime/deep-space.js', import.meta.url), 'utf8')

/* A DOM small enough to read: one host element, real insert/remove, and the
   observers the module owns. Everything the canvas is asked for is recorded, so
   a test can assert on what was painted -- glyph, colour and position -- instead
   of on pixels. */
function fixture({ hero = false, composer = null } = {}) {
  let id = 0
  const timers = new Map()
  const frames = new Map()
  const listeners = new Map()
  const painted = []
  const observers = []

  const ctx2d = {
    setTransform() {},
    clearRect() {},
    fillText(glyph, x, y) {
      painted.push({ glyph, x, y, style: ctx2d.fillStyle, alpha: alphaOf(ctx2d.fillStyle) })
    },
    fillStyle: '',
    font: '',
    textAlign: '',
    textBaseline: '',
  }

  class Observer {
    constructor(fn) { this.fn = fn; this.active = true; this.options = null; observers.push(this) }
    observe(target, options) { this.target = target; this.options = options || null }
    disconnect() { this.active = false }
  }

  function element(tag) {
    const node = {
      tagName: tag,
      children: [],
      dataset: {},
      attrs: {},
      scheme: '',
      style: { cssText: '', position: '', isolation: '' },
      parentNode: null,
      setAttribute(name, value) { node.attrs[name] = value },
      removeAttribute(name) { delete node.attrs[name] },
      hasAttribute(name) { return Object.prototype.hasOwnProperty.call(node.attrs, name) },
      getBoundingClientRect: () => ({ width: 480, height: 360, left: 0, top: 0, right: 480, bottom: 360 }),
      getContext: () => ctx2d,
      remove() {
        if (node.parentNode) node.parentNode.removeChild(node)
      },
      removeChild(child) {
        const at = node.children.indexOf(child)
        if (at >= 0) node.children.splice(at, 1)
        child.parentNode = null
        return child
      },
      insertBefore(child, before) {
        child.parentNode = node
        const at = before === undefined || before === null ? 0 : node.children.indexOf(before)
        node.children.splice(at < 0 ? 0 : at, 0, child)
        return child
      },
      appendChild(child) { return node.insertBefore(child, null) },
      querySelector(selector) {
        if (selector !== 'canvas[data-deep-space]') return null
        return node.children.find(child => child.attrs['data-deep-space'] !== undefined) || null
      },
      querySelectorAll() { return [] },
    }
    Object.defineProperty(node, 'parentElement', { get: () => node.parentNode })
    return node
  }

  function alphaOf(style) {
    const match = /rgba\([^)]*,\s*([0-9.]+)\)/.exec(String(style))
    return match ? Number(match[1]) : 1
  }

  const hostNode = element('div')
  const homeNode = hero ? element('div') : null
  const composerNode = composer ? Object.assign(element('div'), { rect: composer }) : null
  if (composerNode) {
    composerNode.getBoundingClientRect = () => ({ width: composer.w, height: composer.h, left: composer.x, top: composer.y, right: composer.x + composer.w, bottom: composer.y + composer.h })
  }

  const document = {
    hidden: false,
    documentElement: element('html'),
    body: element('body'),
    addEventListener: (kind, fn) => listeners.set(kind, fn),
    removeEventListener: kind => listeners.delete(kind),
    createElement: tag => element(tag),
    querySelector(selector) {
      if (selector === '[data-conversation-content]') return hostNode
      if (selector === "[data-slot='conversation.hero.brand.mark'],[data-slot='conversation.hero.workspace']") {
        return homeNode
      }
      if (selector === "[data-conversation-region='composer']") return composerNode
      return null
    },
    querySelectorAll(selector) {
      if (selector === "[data-conversation-region='composer']") return composerNode ? [composerNode] : []
      return []
    },
  }
  document.documentElement.appendChild(document.body)

  const sandbox = {
    window: { devicePixelRatio: 2, matchMedia: () => motion },
    document,
    performance,
    console,
    Math,
    Number,
    Object,
    Array,
    setTimeout: (fn) => { timers.set(++id, fn); return id },
    clearTimeout: (key) => timers.delete(key),
    requestAnimationFrame: (fn) => { frames.set(++id, fn); return id },
    cancelAnimationFrame: (key) => frames.delete(key),
    ResizeObserver: Observer,
    IntersectionObserver: Observer,
    MutationObserver: Observer,
    getComputedStyle: node => ({
      colorScheme: node && node.scheme ? node.scheme : 'dark',
      position: node && node.style ? node.style.position : 'relative',
      isolation: node && node.style ? node.style.isolation : 'auto',
    }),
  }

  const motion = {
    matches: false,
    addEventListener: (kind, fn) => listeners.set('motion', fn),
    removeEventListener: () => listeners.delete('motion'),
  }

  vm.createContext(sandbox)
  vm.runInContext(source, sandbox)

  function drain() {
    let count = 0
    while (timers.size) {
      assert.ok(count++ < 500)
      const tasks = [...timers.values()]
      timers.clear()
      tasks.forEach(fn => fn())
    }
  }
  function frame(time) {
    const tasks = [...frames.values()]
    frames.clear()
    tasks.forEach(fn => fn(time))
  }

  return {
    api: sandbox.UniverseDeepSpace,
    sandbox, hostNode, homeNode, composerNode, document, ctx2d,
    timers, frames, listeners, observers, painted, motion, drain, frame,
  }
}

function mountOnHost(f, options) {
  const canvas = f.sandbox.document.createElement('canvas')
  f.hostNode.appendChild(canvas)
  const created = []
  const original = f.sandbox.document.createElement
  f.sandbox.document.createElement = tag => {
    const node = original(tag)
    if (node.tagName === 'canvas') created.push(node)
    return node
  }
  const dispose = f.api.mount(f.hostNode, options)
  f.sandbox.document.createElement = original
  return { canvas: created[0], dispose }
}

test('the ASCII sky keeps its alphabet printable and its numbers inside the design range', () => {
  const { api } = fixture()
  const base = api.options()
  assert.equal(base.cell, 10)
  assert.equal(base.fps, 8)
  assert.equal(base.density, 0.035)
  assert.equal(api.options({ cell: 1 }).cell, 8)
  assert.equal(api.options({ cell: 400 }).cell, 32)
  assert.equal(api.options({ fps: 0 }).fps, 1)
  assert.equal(api.options({ fps: 900 }).fps, 30)
  assert.equal(api.options({ density: 9 }).density, 0.3)
  assert.equal(api.options({ maxAlpha: 0 }).maxAlpha, 0.05)
  assert.equal(api.options({ nebula: 7 }).nebula, 1)
  assert.equal(api.options({ quiet: -2 }).quiet, 0)
  assert.equal(api.options({ drift: 99 }).drift, 4)
  assert.match(api.glyphs, /^[\x20-\x7e]+$/)
  assert.ok(api.glyphs.indexOf(' ') > -1, 'the ramp starts at blank space')
  for (const banned of ['\u00b0', '\u2605', '\u25cf', '\u00b7']) {
    assert.equal(api.glyphs.includes(banned), false, 'no unicode marks in the sky')
  }
})

test('the field is smooth, deterministic and bounded', () => {
  const { api } = fixture()
  const a = api.field(120, 80, 0)
  const b = api.field(120, 80, 0)
  assert.equal(a, b, 'the same sample twice gives the same value')
  assert.ok(a >= 0 && a <= 1, 'bounded')
  let min = 1
  let max = 0
  for (let x = 0; x < 1180; x += 7) {
    for (let y = 0; y < 760; y += 7) {
      const value = api.field(x, y, 0)
      if (value < min) min = value
      if (value > max) max = value
    }
  }
  assert.ok(max - min > 0.25, 'the field actually varies across the column')
  const near = Math.abs(api.field(120, 80, 0) - api.field(122, 81, 0))
  assert.ok(near < 0.05, 'neighbouring samples are close, so the cloud has no seams')
  assert.notEqual(api.field(120, 80, 40), api.field(120, 80, 0), 'time warps the cloud')
})

test('the sky is a sparse grid of single ASCII glyphs, never rising to reading contrast', () => {
  const f = fixture()
  const canvas = f.sandbox.document.createElement('canvas')
  const controller = f.api.create(canvas)
  f.drain()

  const stats = controller.stats()
  assert.equal(stats.ready, true)
  assert.equal(stats.width, 480)
  assert.equal(stats.height, 360)
  assert.equal(canvas.width, 960, 'device pixel ratio is honoured')
  assert.equal(stats.columns, Math.ceil(480 / stats.cell))
  assert.equal(stats.rows, Math.ceil(360 / stats.cell))
  assert.ok(stats.cells > 500 && stats.cells < 9000, 'the grid stays inside the cell budget')
  assert.ok(stats.stars > 0, 'a sky, not an empty field')
  assert.ok(stats.stars < stats.cells * 0.08, 'sparse: under 8% of cells hold a star')
  assert.ok(stats.nebula > 0, 'the veil exists')

  f.frame(100)
  assert.ok(f.painted.length > 0)
  assert.ok(f.painted.every(entry => entry.glyph.length === 1))
  assert.ok(f.painted.every(entry => f.api.glyphs.includes(entry.glyph)))
  const peak = Math.max(...f.painted.map(entry => entry.alpha))
  assert.ok(peak <= stats.config.maxAlpha + 1e-9, 'alpha never rises to reading contrast')
  assert.ok(f.painted.every(entry => entry.style.startsWith('rgba(')), 'the ink is an rgba tint')
})

test('the middle of the column stays clear while the veils keep their body', () => {
  const f = fixture()
  const canvas = f.sandbox.document.createElement('canvas')
  const controller = f.api.create(canvas)
  f.drain()
  f.frame(100)

  const stats = controller.stats()
  const cx = stats.width / 2
  const cy = stats.height / 2
  const middle = f.painted.filter(entry => Math.abs(entry.x - cx) < stats.width * 0.10
    && Math.abs(entry.y - cy) < stats.height * 0.10)
  assert.equal(middle.length, 0, 'nothing is painted under the reading column')

  const left = f.painted.filter(entry => entry.x < stats.width * 0.25).length
  const right = f.painted.filter(entry => entry.x > stats.width * 0.75).length
  assert.ok(left > 0 && right > 0, 'both sides carry a veil')
  /* The sky is meant to be dim: the heaviest ramp step stays a rare accent and
     the mean ink sits far below the ceiling, so no patch of it competes with a
     line of text. */
  const brightest = f.painted.filter(entry => entry.glyph === '+').length
  assert.ok(brightest < f.painted.length * 0.15, 'the top step is an accent, not a texture')
  const mean = f.painted.reduce((sum, entry) => sum + entry.alpha, 0) / f.painted.length
  assert.ok(mean < stats.config.maxAlpha * 0.45, 'the field averages well below reading contrast')
})

test('stars sit still between frames: only the cloud is allowed to move', () => {
  const f = fixture()
  const canvas = f.sandbox.document.createElement('canvas')
  const controller = f.api.create(canvas)
  f.drain()

  f.painted.length = 0
  f.frame(0)
  const first = f.painted.filter(entry => entry.glyph === "'" || entry.glyph === '+' || entry.glyph === '*')
    .map(entry => entry.glyph + ':' + entry.x + ':' + entry.y)
  f.painted.length = 0
  f.frame(60000)
  const second = f.painted.filter(entry => entry.glyph === "'" || entry.glyph === '+' || entry.glyph === '*')
    .map(entry => entry.glyph + ':' + entry.x + ':' + entry.y)
  assert.ok(first.length > 0)
  assert.deepEqual(second, first, 'a minute later the stars are in exactly the same cells')
})

test('the composer rectangle is cut out, glyphs included', () => {
  const f = fixture({ composer: { x: 60, y: 260, w: 360, h: 80 } })
  const canvas = f.sandbox.document.createElement('canvas')
  const controller = f.api.create(canvas)
  f.drain()
  f.frame(100)
  const inside = f.painted.filter(entry => entry.x >= 50 && entry.x <= 430 && entry.y >= 250 && entry.y <= 350)
  assert.equal(inside.length, 0, 'no glyph lands under the composer')
})

test('a theme flip re-reads the column colour scheme and repaints', () => {
  const f = fixture()
  f.hostNode.scheme = 'dark'
  const canvas = f.sandbox.document.createElement('canvas')
  f.hostNode.appendChild(canvas)
  const controller = f.api.create(canvas)
  f.drain()
  f.frame(100)
  const darkPeak = Math.max(...f.painted.map(entry => entry.alpha))
  const darkStyle = f.painted[0].style
  assert.match(darkStyle, /208,214,222/)

  f.painted.length = 0
  f.hostNode.scheme = 'light'
  const themeObserver = f.observers.find(entry => entry.active
    && entry.options && entry.options.attributeFilter
    && entry.options.attributeFilter.indexOf('data-ds-dark-theme') >= 0)
  assert.ok(themeObserver, 'the module watches the document for theme flips')
  themeObserver.fn()
  f.frame(20000)
  const lightStyle = f.painted[0].style
  assert.match(lightStyle, /62,64,72/, 'light mode paints dark ink on the pale panel')
  assert.notEqual(lightStyle, darkStyle)
  assert.ok(darkPeak > 0)
  controller.dispose()
})

test('painting stops for a hidden tab, an offscreen column, reduced motion and disposal', () => {
  const f = fixture()
  const canvas = f.sandbox.document.createElement('canvas')
  const controller = f.api.create(canvas)
  f.drain()
  assert.equal(f.frames.size, 1, 'one frame is scheduled once the sky exists')

  f.document.hidden = true
  f.listeners.get('visibilitychange')()
  assert.equal(f.frames.size, 0)
  f.document.hidden = false
  f.listeners.get('visibilitychange')()
  assert.equal(f.frames.size, 1)

  f.painted.length = 0
  f.motion.matches = true
  f.listeners.get('motion')()
  assert.equal(f.frames.size, 0, 'reduced motion freezes the field')
  assert.ok(f.painted.length > 0, 'the frozen field is painted once, then left alone')

  f.motion.matches = false
  f.listeners.get('motion')()
  assert.equal(f.frames.size, 1)

  controller.update({ drift: 0 })
  assert.ok(f.timers.size > 0, 'an update rebuilds on a timer')
  f.drain()
  assert.equal(f.frames.size, 0, 'no drift means no animation loop')

  controller.dispose()
  controller.dispose()
  assert.equal(f.frames.size, 0)
  assert.equal(f.timers.size, 0)
  assert.equal(f.listeners.size, 0)
  assert.ok(f.observers.every(observer => observer.active === false))
  assert.equal(canvas.dataset.uniDeepSpaceState, 'disposed')
})

test('mount paints into the column, not the body, and leaves the host as it found it', () => {
  const f = fixture()
  const { canvas, dispose } = mountOnHost(f)
  assert.equal(typeof dispose, 'function')
  assert.equal(canvas.attrs['data-deep-space'], '')
  assert.equal(canvas.attrs['aria-hidden'], 'true')
  assert.equal(canvas.dataset.deepSpaceOwner, 'universe')
  assert.equal(canvas.parentNode, f.hostNode)
  assert.equal(f.hostNode.children[0], canvas, 'prepended, so the column paints over it')
  assert.match(canvas.style.cssText, /position:absolute/)
  assert.match(canvas.style.cssText, /z-index:-1/)
  assert.match(canvas.style.cssText, /pointer-events:none/)
  assert.equal(f.hostNode.style.isolation, 'isolate', 'the negative layer needs its own stacking context')
  assert.equal(typeof canvas.__uniDeepSpace, 'object', 'the debug handle is exposed for the preview harness')

  const again = f.api.mount(f.hostNode)
  assert.equal(again, dispose, 'an existing canvas hands back its own disposer, not a second copy')
  assert.equal(f.hostNode.children.length, 2, 'no second canvas')

  dispose()
  assert.equal(canvas.parentNode, null)
  assert.equal(f.hostNode.style.isolation, '')
})

test('one watcher reports page mode and re-fires when the column is rebuilt', () => {
  const f = fixture({ hero: false })
  const seen = []
  const stop = f.api.watchPageMode(home => seen.push(home))
  assert.deepEqual(seen, [false], 'the current page is reported immediately')

  f.homeNode = f.sandbox.document.createElement('div')
  const originalQuery = f.sandbox.document.querySelector
  let current = f.homeNode
  f.sandbox.document.querySelector = selector => {
    if (selector.startsWith("[data-slot='conversation.hero.brand.mark']")) return current
    if (selector === '[data-conversation-content]') return f.hostNode
    return originalQuery.call(f.sandbox.document, selector)
  }

  assert.equal(f.api.isHome(), true)
  const observer = f.observers.find(entry => entry.active)
  observer.fn()
  f.drain()
  assert.deepEqual(seen, [false, true])

  observer.fn()
  f.drain()
  assert.deepEqual(seen, [false, true], 'an unchanged page stays silent')

  current = null
  observer.fn()
  f.drain()
  assert.deepEqual(seen, [false, true, false])

  stop()
  assert.equal(f.observers.every(entry => entry.active === false), true)
  assert.equal(f.timers.size, 0)
})
