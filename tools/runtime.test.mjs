import { test } from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { effortFixture } from './effort-fixture.mjs'
import { CLIENT_FILES } from './build-contract.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = path => readFileSync(join(root, path), 'utf8')
// Execute production closures, not reimplementations. Moving a closure requires an
// explicit fixture update; missing boundaries fail rather than silently testing a fake.
// Files in a dependency order, not alphabetically: the brand mark's geometry half is a
// bare `var` the component half reads at its own script's evaluation, exactly as the
// factory concatenates them (CLIENT_FILES in tools/build-contract.mjs is the contract).
function clientSource() {
  return CLIENT_FILES.map(read).join('\n')
}
function between(source, start, end) {
  const a = source.indexOf(start)
  const b = source.indexOf(end, a + start.length)
  assert.ok(a >= 0 && b > a, `production boundaries: ${start} / ${end}`)
  return source.slice(a, b)
}
function mountEffect(label, bindings) {
  const effects = new Map()
  const context = { get: () => ({}), inject() {}, effect(fn, name) { effects.set(name, fn) } }
  const exports = vm.runInNewContext(`(function () { var module = {exports:{}}; var exports = module.exports; ${clientSource()} })()`, {
    PLUGIN_ID: 'dsh-universe-theme', TOKENS: {}, MANIFEST: {}, ...bindings,
  })
  exports.apply(context)
  assert.ok(effects.has(label), label)
  return effects.get(label)()
}
test('S10: built artifact registers one loader with unchanged public exports', () => {
  const registrations=[]
  vm.runInNewContext(read('client.js'), {window:{__ModuleLoader__:{load:value=>registrations.push(value)}}})
  assert.equal(registrations.length,1)
  assert.equal(registrations[0].id,'dsh-universe-theme')
  const exported=registrations[0].factory(name=>{throw Error('unexpected eager require: '+name)})
  assert.equal(exported.name,'dsh-universe-theme')
  assert.equal(typeof exported.apply,'function')
  /* 2026-10-31: 'uiSession' came with the session-row state markers and left with
     them; the theme asks for the five services it always had. */
  assert.deepEqual(Array.from(exported.inject),['theme','remote','locale','sessions','workspaces'])
})

test('S4: glass cancels queued scan and rejects late observer delivery after disposal', () => {
  let callback, frame, cancelled=0, queries=0, removed=0, disconnected=0
  const element=()=>({setAttribute(){},appendChild(){},remove(){removed++}})
  const context={document:{body:{appendChild(){}},createElementNS:element,querySelectorAll(){queries++;return []}},
    window:{requestAnimationFrame(fn){frame=fn;return 1},cancelAnimationFrame(){cancelled++}},
    MutationObserver:class{constructor(fn){callback=fn}observe(){}disconnect(){disconnected++}},
    ResizeObserver:class{observe(){throw Error('observe after disposal')}disconnect(){disconnected++}}}
  const dispose=vm.runInNewContext(read('src/runtime/glass.js')+'\nmountLiquidGlass()',context)
  const records=[{addedNodes:[{matches:()=>true}],removedNodes:[]}]
  assert.equal(queries,2)
  callback(records)
  const late=frame
  dispose();assert.equal(cancelled,1);assert.equal(removed,1);assert.equal(disconnected,2)
  late();callback(records)
  assert.equal(queries,2)
})

const flush = async () => { for (let i = 0; i < 15; i++) await Promise.resolve() }
function clocks() {
  const timers = new Map()
  let next = 1
  return {
    timers,
    setTimeout(fn) { const id = next++; timers.set(id, fn); return id },
    clearTimeout(id) { timers.delete(id) },
    fire() { const batch = [...timers.values()]; timers.clear(); batch.forEach(fn => fn()) },
  }
}

function panelFixture(useFrame = true) {
  const clock = clocks(), frames = clocks(), observers = []
  const listeners = new Map()
  const body = { children: [] }
  const trigger = { getBoundingClientRect: () => ({ left: 100, width: 80, top: 200, bottom: 220, height: 20 }) }
  const attrs = new Map([['role', 'dialog']])
  const panel = {
    nodeType: 1, tagName: 'DIV', parentNode: body, parentElement: body, isConnected: true,
    style: { left: '100px', getPropertyValue(n) { return this[n] || '' }, getPropertyPriority() { return '' }, setProperty(n, v) { this[n] = v }, removeProperty(n) { delete this[n] } }, offsetWidth: 200,
    getAttribute: n => attrs.get(n) ?? null, hasAttribute: n => attrs.has(n),
    setAttribute: (n, v) => attrs.set(n, v), removeAttribute: n => attrs.delete(n),
    getBoundingClientRect: () => ({ width: panel.offsetWidth, top: 160, bottom: 190, left: parseFloat(panel.style.left), height: 30 }),
  }
  body.children.push(panel)
  const document = { body, querySelectorAll(selector) { return selector.includes('aria-expanded') ? [trigger] : selector.includes('permission') ? [] : [panel] } }
  class Observer {
    constructor(fn) { this.fn = fn; this.targets = new Map(); observers.push(this) }
    observe(target, options) { this.targets.set(target, options) }
    disconnect() { this.targets.clear() }
    emit(record) {
      if ([...this.targets].some(([target, o]) =>
        (record.target === target || o.subtree && record.target.parentNode === target) &&
        (record.type === 'attributes' ? o.attributes && (!o.attributeFilter || o.attributeFilter.includes(record.attributeName)) : o.childList))) this.fn([record])
    }
  }
  const window = { innerWidth: 600, getComputedStyle: () => ({position:'fixed'}),
    addEventListener: (n, fn) => listeners.set(n, fn), removeEventListener: n => listeners.delete(n) }
  if (useFrame) { window.requestAnimationFrame = frames.setTimeout; window.cancelAnimationFrame = frames.clearTimeout }
  const dispose = mountEffect('universe: centred panels', { document, window, MutationObserver: Observer,
    setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout,
    requestAnimationFrame: useFrame ? frames.setTimeout : undefined,
    cancelAnimationFrame: useFrame ? frames.clearTimeout : undefined })
  clock.fire() // deferEffect initialization
  return {panel, body, dispose, frames, clock, observers, listeners, emit(record) { observers.forEach(o => o.emit(record)) }}
}

test('S4: direct panel attributes schedule correction; disposal restores owned left', () => {
  const f = panelFixture()
  assert.equal(f.panel.style.left, '40px')
  f.panel.style.left = '105px'
  f.emit({ type: 'attributes', target: f.panel, attributeName: 'style' })
  f.frames.fire()
  assert.equal(f.panel.style.left, '40px')
  f.dispose()
  assert.equal(f.panel.style.left, '105px')
  assert.equal(f.panel.hasAttribute('data-uni-panel-centred'), false)
  assert.equal(f.observers.every(o => o.targets.size === 0), true)
})

for (const frame of [true, false]) test(`S4: disposal cancels queued ${frame ? 'frame' : 'timer'} and respects host writes`, () => {
  const f = panelFixture(frame)
  f.listeners.get('resize')()
  f.panel.style.left = '177px'
  f.dispose()
  f.frames.fire(); f.clock.fire()
  assert.equal(f.panel.style.left, '177px')
  assert.equal(f.panel.hasAttribute('data-uni-panel-centred'), false)
  assert.equal(f.frames.timers.size + f.clock.timers.size, 0)
})

test('S2: queued workspace moves cannot start after disposal', async () => {
  let release
  const first = new Promise(resolve => { release = resolve })
  const sent = []
  const api = vm.runInNewContext(`var disposed = false; ${between(clientSource(), '        function step(id, beforeId)', '        /* Walk the pinned ids')}; ({step, dispose() { disposed = true }})`, {
    workspaces: { insertBefore(id) { sent.push(id); return first } },
  })
  let chain = Promise.resolve()
  for (const id of ['one', 'two', 'three']) chain = chain.then(api.step(id))
  await flush()
  assert.deepEqual(sent, ['one'])
  api.dispose(); release(); await chain
  assert.deepEqual(sent, ['one'])
})

test('S5: keyboard group action retains raw provider ID', () => {
  const source = read('src/model-effort-picker.js')
  const code = between(source.slice(source.indexOf('  function createModelSelect(')), '    function onKey(event)', '    searchInput.addEventListener')
  for (const id of ['a.b', 'a/b', '中文', 'a_b', 'x'.repeat(500)]) {
    let toggled
    const node = { getAttribute: () => 'slug-collision', uniGroupId: id }
    vm.runInNewContext(`${code}; onKey({key:'ArrowLeft', target:node, preventDefault(){}})`, {
      node, toggleGroup(value) { toggled = value },
    })
    assert.equal(toggled, id)
  }
})

test('S5/S8: identical effort notifications keep nodes and pending updates in place', () => {
  const f = effortFixture(), rows = f.rows()
  rows[1].focus()
  for (let i = 0; i < 1000; i++) f.instance.sync()
  assert.deepEqual(f.rows(), rows)
  assert.equal(f.counts().created, 2)
  assert.equal(f.document.activeElement, rows[1])
  f.state().pending = true; f.instance.sync()
  assert.equal(f.rows()[0].disabled, true)
  assert.equal(f.rows()[1], rows[1])
  f.state().pending = false; f.instance.sync()
  assert.equal(rows[0].disabled, false)
  assert.equal(f.counts().placements, 0)
})

test('S5/S8: changed effort content repositions once, including empty and translation', () => {
  const f = effortFixture()
  f.instance.open = true
  f.rows()[1].focus()
  f.state().current.reasoningEffort = 'high'; f.instance.sync()
  assert.equal(f.rows()[1].getAttribute('aria-checked'), 'true')
  assert.equal(f.document.activeElement, f.rows()[1])
  assert.equal(f.counts().placements, 1)
  f.language('zh'); f.instance.sync()
  assert.equal(f.counts().placements, 2)
  f.setState({current:null,groups:[],pending:false}); f.instance.sync()
  assert.equal(f.rows().length, 0)
  assert.equal(f.counts().placements, 3)
  assert.equal(f.instance.paint(), false)
  f.instance.destroyed=true; f.instance.sync()
  assert.equal(f.counts().placements, 3)
})

test('S6: the pin fallback admits outside mutations until scoped rows return', () => {
  const source = clientSource()
  const pin = between(source, '        function touches(records)', '        /* Only the row key')
  const api = vm.runInNewContext(`var scopeHost = {isConnected:true, contains(){return false}}, scopeMissed = true;
      ${pin}; ({touches, scoped() {scopeMissed = false}})`)
  const records = [{ target: {}, addedNodes: [], removedNodes: [] }]
  assert.equal(api.touches(records), true)
  api.scoped(); assert.equal(api.touches(records), false)
})

/* The boot mask's one-shot rule. The user's requirement (2026-10-21): the mask plays
   once per DSH process -- quitting and reopening DSH replays it, a reload inside one
   running instance does not. That is exactly sessionStorage's lifetime: it survives a
   reload of the same window and dies with it. The previous rule keyed the same mark
   into localStorage, so "once per build" meant "once ever" and the mask simply stopped
   appearing; every refresh looked like a missing animation. These three cases pin the
   new rule and the storage that implements it, driving the real mountBootScreen. */
function bootFixture({ session = new Map(), local = new Map(), search = '' } = {}) {
  const makeEl = () => {
    const el = {
      style: { setProperty() {} }, attrs: {}, children: [], parentNode: null, textContent: '',
      setAttribute(k, v) { el.attrs[k] = String(v) },
      getAttribute(k) { return el.attrs[k] ?? null },
      appendChild(c) { el.children.push(c); c.parentNode = el; return c },
      removeChild(c) { const i = el.children.indexOf(c); if (i >= 0) el.children.splice(i, 1); c.parentNode = null; return c },
      querySelector: () => makeEl(),
    }
    return el
  }
  const body = makeEl()
  const storage = (map) => ({
    getItem: k => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)) },
    removeItem: k => { map.delete(k) },
  })
  const context = {
    PLUGIN_ID: 'dsh-universe-theme',
    document: {
      body,
      querySelector: sel => (sel.indexOf('style[data-plugin-css=') === 0 ? makeEl() : null),
      createElement: makeEl,
    },
    window: {
      localStorage: storage(local),
      sessionStorage: storage(session),
      matchMedia: () => ({ matches: false }),
      setTimeout: () => 1,
      setItem: () => {},
    },
    location: { search },
    requestAnimationFrame: () => 1,
    cancelAnimationFrame() {},
    setInterval: () => 1,
    clearInterval() {},
  }
  const mount = vm.runInNewContext(
    `${read('src/boot-screen.js')}\nmountBootScreen`, context)
  const masks = () => body.children.filter(c => c.attrs['data-uni-boot'] !== undefined).length
  return { mount, masks, session, local }
}

test('S11: the boot mask plays once per run and replays only after DSH restarts', () => {
  const seenKey = 'dsh-universe-theme/boot/seen'
  const mark = 'uni-boot/@BUILD@'

  const first = bootFixture()
  first.mount()
  assert.equal(first.masks(), 1, 'a fresh run must play the mask')
  assert.equal(first.session.get(seenKey), '1', 'the run mark must be recorded in sessionStorage')
  assert.equal(first.local.has(seenKey), false, 'the run mark must not be written to localStorage')

  // A reload inside the same run: same sessionStorage, a brand-new document.
  const reload = bootFixture({ session: first.session })
  reload.mount()
  assert.equal(reload.masks(), 0, 'a reload inside one run must not replay the mask')

  // ?boot=1 still forces one replay inside a run, without touching the record.
  const forced = bootFixture({ session: first.session, search: '?boot=1' })
  forced.mount()
  assert.equal(forced.masks(), 1, '?boot=1 must force a replay')

  // A stale mark left by the old localStorage rule must not suppress the mask:
  // the leftover key from before this change is what made the animation vanish.
  const stale = bootFixture({ local: new Map([[seenKey, mark]]) })
  stale.mount()
  assert.equal(stale.masks(), 1, 'an old localStorage mark must not suppress the mask')
})

/* 悬停塌陷的触发面（2026-10-31，第四十九轮）：样式表只认 data-uni-grav，属性由
   mountHoverGravity 按未缩放的盒子写入。这两条用例钉的就是当初的死循环 —— 元素
   缩了之后指针仍停在同一像素上，状态必须保持；指针真正离开原始盒子才还原。 */
function gravityElement(box, spec = {}) {
  const element = {
    attrs: new Set(),
    parent: spec.parent ?? null,
    isConnected: true,
    scale: 1,
    setAttribute(name) { element.attrs.add(name) },
    removeAttribute(name) { element.attrs.delete(name) },
    armed() { return element.attrs.has('data-uni-grav') },
    contains(node) { for (let p = node; p; p = p.parent) if (p === element) return true; return false },
    closest() { return spec.closest ?? element },
    getBoundingClientRect() {
      const w = box.width * element.scale, h = box.height * element.scale
      return { left: box.left + (box.width - w) / 2, top: box.top + (box.height - h) / 2, width: w, height: h }
    },
  }
  return element
}

function gravityFixture() {
  const documentListeners = [], windowListeners = [], rootListeners = []
  const track = list => (type, fn, options) => {
    list.push({ type, fn, capture: options === true || !!(options && options.capture) })
  }
  const untrack = list => (type, fn) => {
    const at = list.findIndex(entry => entry.type === type && entry.fn === fn)
    assert.ok(at >= 0, `listener ${type} was registered before it is removed`)
    list.splice(at, 1)
  }
  const document = {
    documentElement: { addEventListener: track(rootListeners), removeEventListener: untrack(rootListeners) },
    addEventListener: track(documentListeners),
    removeEventListener: untrack(documentListeners),
  }
  const window = {
    addEventListener: track(windowListeners),
    removeEventListener: untrack(windowListeners),
    getComputedStyle: element => ({ scale: String(element.scale) }),
  }
  const stop = vm.runInNewContext(read('src/runtime/gravity.js') + '\nmountHoverGravity()', { document, window })
  const fire = (list, type, event) => {
    const entry = list.find(candidate => candidate.type === type)
    assert.ok(entry, `no ${type} listener`)
    entry.fn(event)
  }
  return {
    documentListeners, windowListeners, rootListeners, stop,
    over: (target, x, y, pointerType = 'mouse') => fire(documentListeners, 'pointerover', { target, clientX: x, clientY: y, pointerType }),
    move: (target, x, y) => fire(documentListeners, 'pointermove', { target, clientX: x, clientY: y, pointerType: 'mouse' }),
    scroll: () => fire(documentListeners, 'scroll', {}),
    blur: () => fire(windowListeners, 'blur', {}),
  }
}

test('G1: a collapsed element keeps its trigger while the pointer stays in the unscaled box', () => {
  const fixture = gravityFixture()
  const button = gravityElement({ left: 0, top: 0, width: 100, height: 40 })
  fixture.over(button, 1, 20)
  assert.equal(button.armed(), true, 'entering the element arms the collapse')
  /* 塌陷到 0.97 后 rect 左右各内移 1.5px，指针停在 1px 处已经落在命中区外 ——
     :hover 那一版就是在这里掉线的。 */
  button.scale = 0.97
  fixture.move(button, 1, 20)
  assert.equal(button.armed(), true, 'the ring the collapse dug out is still the element')
  fixture.scroll()
  assert.equal(button.armed(), true, 'scrolling under a still pointer must not disarm')
  fixture.move(button, -1, 20)
  assert.equal(button.armed(), false, 'leaving the unscaled box releases it')
  fixture.stop()
})

test('G2: an ancestor cannot steal the state, touch never arms it, disposal clears it', () => {
  const fixture = gravityFixture()
  const button = gravityElement({ left: 0, top: 0, width: 120, height: 40 })
  const label = gravityElement({ left: 10, top: 10, width: 60, height: 20 }, { parent: button })
  fixture.over(label, 20, 20)
  assert.equal(label.armed(), true)
  assert.equal(button.armed(), false)
  /* 塌陷挖出的那一圈把命中交还给祖先：指针其实没走，不能换人。 */
  fixture.over(button, 20, 20)
  assert.equal(label.armed(), true)
  assert.equal(button.armed(), false)
  /* 触摸的 :hover 是粘住的，跟着记账会留下永不还原的元素。 */
  fixture.over(button, 300, 300, 'touch')
  assert.equal(label.armed(), true)
  /* 元素被重渲染移出文档：下一次移动直接清状态，不去碰离开文档的节点。 */
  label.isConnected = false
  fixture.move(label, 20, 20)
  assert.equal(label.armed(), false)
  const next = gravityElement({ left: 300, top: 300, width: 40, height: 40 })
  fixture.over(next, 310, 310)
  assert.equal(next.armed(), true)
  fixture.blur()
  assert.equal(next.armed(), false)
  fixture.stop()
  assert.equal(fixture.documentListeners.length, 0)
  assert.equal(fixture.windowListeners.length, 0)
  assert.equal(fixture.rootListeners.length, 0)
})


test('A1: the accretion geometry is the spec, not a lookalike', () => {
  /* Runs the production file's own geometry, extracted by its boundaries: the constants and
     the three pure functions come out as one closure-free scope. A reimplementation here
     would test nothing, so the extraction is asserted by between(). */
  const source = read('src/runtime/accretion.js')
  const api = vm.runInNewContext(
    between(source, '    var UNI_ACC_K = 24 / 14', '    function mountAccretion(') +
    '\n({ at: uniAccretionAt, trail: uniAccretionTrail, len: uniAccretionLength, slice: uniAccretionSlice, cap: UNI_ACC_SAMPLES, bands: UNI_ACC_BANDS })',
    { Math })
  const TAU = Math.PI * 2

  /* Radius: five pixels at spawn, two at the centre, always shrinking. */
  assert.equal(api.at(0).r, 5)
  assert.equal(api.at(1).r, 2)
  let previous = Infinity
  for (let i = 0; i <= 64; i += 1) {
    const r = api.at(i / 64).r
    assert.ok(r < previous, `radius must shrink monotonically (u=${i / 64})`)
    previous = r
  }

  /* Angle: one and a quarter turns in total, never reversing. */
  assert.equal(api.at(0).phi, -Math.PI / 2)
  assert.ok(Math.abs((api.at(1).phi - api.at(0).phi) - TAU * 1.25) < 1e-9)
  let last = -Infinity
  for (let i = 0; i <= 64; i += 1) {
    const phi = api.at(i / 64).phi
    assert.ok(phi > last, `angle must advance monotonically (u=${i / 64})`)
    last = phi
  }

  /* Spawns at twelve o'clock, i.e. the top of the 14px box, not somewhere random. */
  assert.ok(Math.abs(api.at(0).x - 7) < 1e-9)
  assert.ok(Math.abs(api.at(0).y - 2) < 1e-9)

  /* Angular speed grows inwards: this is what separates a fall from a spin. */
  const dphi = u => (api.at(u + 1e-6).phi - api.at(u).phi) / 1e-6
  assert.ok(dphi(0.9) > dphi(0.1) * 2, 'the inner orbit must turn faster than the outer one')

  /* Everything stays inside the 14x14 box the icon is. */
  for (let i = 0; i <= 128; i += 1) {
    const point = api.at(i / 128)
    assert.ok(point.x > 1 && point.x < 13 && point.y > 1 && point.y < 13, `escaped the icon at u=${i / 128}`)
  }
})

test('A2: the trail is every pixel the dot has travelled, sliced without gaps', () => {
  /* 用户 m00391：「我要的是绿点从出现到消失的所有轨迹」。所以这里钉的不是某个固定长度，
     而是「量到出生点为止」和「随相位单调变长」这两件事 —— 前者是这次的规格，后者是
     吸积该有的样子（越往里，身后的轨迹越长）。 */
  const source = read('src/runtime/accretion.js')
  const api = vm.runInNewContext(
    between(source, '    var UNI_ACC_K = 24 / 14', '    function mountAccretion(') +
    '\n({ at: uniAccretionAt, trail: uniAccretionTrail, len: uniAccretionLength, slice: uniAccretionSlice, cap: UNI_ACC_SAMPLES, bands: UNI_ACC_BANDS })',
    { Math })

  /* 刚出生的那一刻没有历史：一个点，切出来是空字符串，而不是一圈绕回去的假尾巴。 */
  const born = api.trail(0)
  assert.equal(born.length, 1, 'the trail starts as a single point')
  assert.equal(api.len(born), 0)
  assert.equal(api.slice(born, 0, 1), '')

  /* 越往里走，轨迹越长 —— 45°、90°、135° 三档单调递增，且远超旧的 4px 上限。 */
  const quarter = api.len(api.trail(0.25))
  const half = api.len(api.trail(0.5))
  const all = api.len(api.trail(1))
  assert.ok(quarter > 0 && quarter < half && half < all, `trail must grow: ${quarter} ${half} ${all}`)
  assert.ok(all > 20, `the whole turn is more than a stub: ${all}`)

  /* 每一步都走回出生点：头是当前点，尾是 u = 0。 */
  for (const u of [0.2, 0.55, 1]) {
    const points = api.trail(u)
    assert.deepEqual(points[0], api.at(u), 'the trail starts at the dot')
    const last = points[points.length - 1]
    assert.ok(Math.hypot(last.x - api.at(0).x, last.y - api.at(0).y) < 1e-9, `the trail stops short of u=0 (u=${u})`)
    assert.ok(points.length <= api.cap, 'sample count stays inside the cap')
  }

  /* 六段首尾相接、合起来等于整条轨迹：接缝处不许有断口，也不许有重叠。 */
  const points = api.trail(0.8)
  const total = api.len(points)
  const bands = []
  for (let i = 0; i < api.bands; i += 1) {
    bands.push(api.slice(points, total * (i / api.bands), total * ((i + 1) / api.bands)))
  }
  for (const band of bands) {
    assert.ok(/^M[-\d.]+ [-\d.]+(L[-\d.]+ [-\d.]+)+$/.test(band), `band is not a polyline: ${band}`)
  }
  const numbers = band => band.slice(1).split('L').map((part) => {
    const [x, y] = part.split(' ').map(Number)
    return { x, y }
  })
  let joined = 0
  for (const band of bands) {
    const pts = numbers(band)
    for (let i = 1; i < pts.length; i += 1) {
      joined += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y)
    }
  }
  assert.ok(Math.abs(joined - total) < 0.05, `bands do not cover the trail: ${joined} vs ${total}`)
})
