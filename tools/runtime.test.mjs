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
    '\n({ at: uniAccretionAt, trail: uniAccretionTrail, len: uniAccretionLength, slice: uniAccretionSlice, cap: UNI_ACC_SAMPLES, bands: UNI_ACC_BANDS, box: UNI_ACC_BOX })',
    { Math })
  const TAU = Math.PI * 2

  /* Radius: 6.2px at spawn, 1.0 at the end, always shrinking. 第五十四轮把盒画满（外径
     12.4px，官方环 11.08px）；第五十五轮撤掉中心暗核后落点收到 1.0 —— 没有实体挡在
     中心，点要一直落到虚空里再熄灭。 */
  assert.equal(api.at(0).r, 6.2)
  assert.equal(api.at(1).r, 1)
  let previous = Infinity
  for (let i = 0; i <= 64; i += 1) {
    const r = api.at(i / 64).r
    assert.ok(r < previous, `radius must shrink monotonically (u=${i / 64})`)
    previous = r
  }

  /* Angle: one and a half turns in total, never reversing. 第五十五轮：落程从 3.8 涨到
     5.2 之后圈数必须跟着加，否则相邻两趟的径向间隔松到读不成螺旋。 */
  assert.equal(api.at(0).phi, -Math.PI / 2)
  assert.ok(Math.abs((api.at(1).phi - api.at(0).phi) - TAU * 1.5) < 1e-9)
  let last = -Infinity
  for (let i = 0; i <= 64; i += 1) {
    const phi = api.at(i / 64).phi
    assert.ok(phi > last, `angle must advance monotonically (u=${i / 64})`)
    last = phi
  }

  /* Spawns at twelve o'clock, i.e. the top of the orbit: y = 7 − 6.2. */
  assert.ok(Math.abs(api.at(0).x - 7) < 1e-9)
  assert.ok(Math.abs(api.at(0).y - 0.8) < 1e-9)

  /* Angular speed grows inwards: this is what separates a fall from a spin. */
  const dphi = u => (api.at(u + 1e-6).phi - api.at(u).phi) / 1e-6
  assert.ok(dphi(0.9) > dphi(0.1) * 2, 'the inner orbit must turn faster than the outer one')

  /* Everything stays inside the box the icon is — and the widest band (1.15 design units) still
     fits between the outer orbit (6.2) and the edge (7). 第五十七轮盒子从 14px 提到 16px，
     但设计稿坐标仍是 14 宽，所以「不越界」要在设计稿里比：别超过 7。 */
  for (let i = 0; i <= 128; i += 1) {
    const point = api.at(i / 128)
    assert.ok(point.x > 0.5 && point.x < 13.5 && point.y > 0.5 && point.y < 13.5, `escaped the icon at u=${i / 128}`)
  }
  assert.ok(api.at(0).r + 1.15 / 2 < 7, 'the widest band would be clipped by the icon box')
  /* 盒子里 1 设计单位渲染成 box / 14 个 CSS px：16px 盒子下外径 15.5px，确实比官方那环
     （12.25px）大 —— 用户 m01092「还是比官方默认的大」就是在要这一点。 */
  assert.equal(api.box, 16, 'the box the user approved is 16px')
  assert.ok((api.at(0).r + 1.15 / 2) * (api.box / 14) < api.box / 2, 'the scaled mark must still fit the box')
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

test('A3: the tail dies head first, so the centre reads as something that swallows', () => {
  /* 用户 m00999 选 B：级联熄灭 —— 头先熄、越老越晚熄，最后整条归零。整条一起淡会被读成
     「整个图标闪了一下」，所以这条钉的是顺序，不是好看。 */
  const source = read('src/runtime/accretion.js')
  const api = vm.runInNewContext(
    between(source, '    var UNI_ACC_K = 24 / 14', '    function mountAccretion(') +
    '\n({ weight: uniAccretionWeight, fadeFrom: UNI_ACC_FADE_FROM, stagger: UNI_ACC_FADE_STAGGER, bands: UNI_ACC_BANDS })',
    { Math })

  /* 熄灭从 u = 0.8 开始，之前一切照旧。 */
  assert.equal(api.fadeFrom, 0.8)
  assert.equal(api.weight(0, 0), 1)
  assert.equal(api.weight(0, 1), 1)

  /* 同一时刻：头部已经掉下去一大半，最老那段还一点没动。 */
  assert.ok(api.weight(0.3, 0) < 0.5, 'the head should be going out first')
  assert.equal(api.weight(0.3, 1), 1, 'the oldest band should not have moved yet')

  /* 任何时刻，越老的段剩得越多 —— 这就是「被吞」而不是「一起灭」。 */
  for (const death of [0.1, 0.5, 0.9]) {
    let keep = -1
    for (let i = 0; i < api.bands; i += 1) {
      const w = api.weight(death, i / (api.bands - 1))
      assert.ok(w >= keep, `band ${i} outlives a younger one at death=${death}`)
      keep = w
    }
  }

  /* 收尾：death = 1 时整条归零，且权重从不越出 [0, 1]。 */
  for (let i = 0; i < api.bands; i += 1) {
    assert.equal(api.weight(1, i / (api.bands - 1)), 0, `band ${i} survives the end of the turn`)
  }
  for (let d = 0; d <= 20; d += 1) {
    for (const rank of [0, 0.5, 1]) {
      const w = api.weight(d / 20, rank)
      assert.ok(w >= 0 && w <= 1, `weight escaped [0,1]: ${w}`)
    }
  }
})

test('A4: the cycle ends dimmed, never black, and the ink only ever falls', () => {
  /* 用户 m01091「光点消失到再出现会有一瞬间全黑」。第一版是把最老段抬到 floor 收尾，结果
     造出了 m01544 那个「突然亮一下」（见 A6）。现在的收尾是纯压暗：death = 1 时每段只剩
     自己亮度的 UNI_ACC_END，六段都还在画面上（没有一段退到 0），所以交接那一帧有形状可接；
     而整幅的总墨量只减不增，读起来就是持续向内、逐渐安静下来。 */
  const source = read('src/runtime/accretion.js')
  const api = vm.runInNewContext(
    between(source, '    var UNI_ACC_K = 24 / 14', '    function mountAccretion(') +
    '\n({ alpha: uniAccretionBandAlpha, age: UNI_ACC_AGE, bands: UNI_ACC_BANDS, fallback: UNI_ACC_FLOOR_FALLBACK, end: UNI_ACC_END })',
    { Math })
  const last = api.bands - 1

  /* 点的留底兜底值仍按暗档记；尾流的收尾系数是独立的一档。 */
  assert.equal(api.fallback, 0.34)
  assert.deepEqual(Array.from(api.age), [0.55, 0.34, 0.2, 0.12, 0.07, 0.04])
  assert.ok(api.end > 0.2 && api.end < 0.5, 'the end-of-cycle factor must leave a visible trace')

  /* death = 0：整条就是年龄亮度本身，没有第二层压暗。 */
  for (let i = 0; i <= last; i += 1) {
    assert.ok(Math.abs(api.alpha(i, 0) - api.age[i]) < 1e-12, `band ${i} is dimmed before the exit`)
  }
  /* death = 1：六段都还亮着（只是压到自身亮度的 end 倍）—— 没有任何一段归零，所以画面
     不会在接缝处变成一片黑，交接层接下的是一个有形状的终态。 */
  for (let i = 0; i <= last; i += 1) {
    assert.ok(api.alpha(i, 1) > 0, `band ${i} went black, so the seam has no shape to carry`)
  }

  /* 总墨量随 death 单调不增：一轮下来只能是「越来越安静」，不许中途整体变亮。 */
  let previousInk = Infinity
  for (let d = 0; d <= 40; d += 1) {
    let ink = 0
    for (let i = 0; i <= last; i += 1) ink += api.alpha(i, d / 40)
    assert.ok(ink <= previousInk + 1e-12, `the whole trail brightened at death ${d / 40}`)
    previousInk = ink
  }

  /* 年龄顺序全程不许被打乱：越靠出生点的段越暗。 */
  for (let d = 0; d <= 40; d += 1) {
    for (let i = 1; i <= last; i += 1) {
      assert.ok(api.alpha(i, d / 40) < api.alpha(i - 1, d / 40) + 1e-12, `the age order broke at death ${d / 40}`)
    }
  }

  /* 任何时刻都不越界 —— stroke-opacity 超出 [0,1] 会被浏览器截断，读起来就是一次跳变。 */
  for (let d = 0; d <= 40; d += 1) {
    for (let i = 0; i <= last; i += 1) {
      const value = api.alpha(i, d / 40)
      assert.ok(value >= 0 && value <= 1, `alpha escaped [0,1]: ${value}`)
    }
  }
})

test('A5: the moving dot fades smoothly to zero at both spatially separate endpoints', () => {
  // Equal nonzero alpha at different coordinates was still a teleport. The trail,
  // tested by A7 and A8, carries visibility while the single dot crosses the seam.
  const source = read('src/runtime/accretion.js')
  const api = vm.runInNewContext(
    between(source, '    var UNI_ACC_K = 24 / 14', '    function mountAccretion(') +
    '\n({ dot: uniAccretionDotAlpha, age: UNI_ACC_AGE, born: UNI_ACC_BORN })',
    { Math }
  )

  for (const floor of [0.34, 0.42]) {
    assert.equal(api.dot(0, 0, floor), 0, 'the outer endpoint must not pop into view')
    /* 一轮中段是满亮的头部亮度。 */
    assert.ok(Math.abs(api.dot(0.5, 0, floor) - api.age[0]) < 1e-12, 'the dot never reaches full brightness')
    assert.equal(api.dot(1, 1, floor), 0, 'the inner endpoint must disappear before wrapping')
    const epsilon = 1e-5
    assert.ok(api.dot(epsilon, 0, floor) / epsilon < 0.01, 'birth slope must approach zero')
    assert.ok(api.dot(1 - epsilon, 1 - epsilon, floor) / epsilon < 0.01, 'death slope must approach zero')
    /* 交接的连续性：这一轮的最后一帧与下一轮的第一帧必须是同一个数。 */
    assert.ok(Math.abs(api.dot(1, 1, floor) - api.dot(0, 0, floor)) < 1e-12, 'the seam jumps between cycles')
    /* 光点可归零，但不越过头部亮度；跨圈可见性由整个图元验证。 */
    for (let d = 0; d <= 20; d += 1) {
      for (let u = 0; u <= 1; u += 0.05) {
        const value = api.dot(u, d / 20, floor)
        assert.ok(value >= 0, `the dot alpha became negative at u ${u}`)
        assert.ok(value <= api.age[0] + 1e-12, `the dot outran full brightness at u ${u}`)
      }
    }
  }
})

test('A6: the trail only ever dims as the dot lands, never brightens', () => {
  /* 用户 m01544「绿点走完全程后它所走过的轨迹会突然亮一下再变暗」。第一版的留底是把每段
     插值到 floor（0.34），于是走过去的内圈段被抬亮：0.04 → 0.34 是 8.5 倍、0.07 → 0.34 是
     4.9 倍 —— 点落底那一刻整条轨迹被拉成一条均匀的暗绿螺旋，这才是那个「亮一下」。收尾只能
     乘，不能加：每段始终落在「自身亮度 × UNI_ACC_END」与自身亮度之间。 */
  const source = read('src/runtime/accretion.js')
  const api = vm.runInNewContext(
    between(source, '    var UNI_ACC_K = 24 / 14', '    function mountAccretion(') +
    '\n({ alpha: uniAccretionBandAlpha, bands: UNI_ACC_BANDS, age: UNI_ACC_AGE, end: UNI_ACC_END })',
    { Math }
  )
  const last = api.bands - 1
  assert.ok(api.end > 0 && api.end < 1, 'the end-of-cycle factor must be a dimming factor')
  assert.equal(api.age.length, api.bands, 'the age ramp is not one per band')

  for (let i = 0; i <= last; i += 1) {
    let previous = 2
    for (let death = 0; death <= 1.0001; death += 0.02) {
      const value = api.alpha(i, death)
      assert.ok(value <= api.age[i] + 1e-12, `band ${i} outran its own brightness at death ${death}`)
      assert.ok(value >= api.age[i] * api.end - 1e-12, `band ${i} dimmed past the end factor at death ${death}`)
      assert.ok(value <= previous + 1e-12, `band ${i} rose on its way down`)
      previous = value
    }
    /* 落底那一刻：每段都只是自己亮度的 UNI_ACC_END，内圈段不会被拉到外圈段的亮度。 */
    assert.ok(Math.abs(api.alpha(i, 1) - api.age[i] * api.end) < 1e-12, `band ${i} does not end at its own scale`)
  }
  /* 越老的段始终越暗 —— 抬升会让这个顺序在收尾时被打乱。 */
  for (let death = 0; death <= 1.0001; death += 0.05) {
    for (let i = 1; i <= last; i += 1) {
      assert.ok(api.alpha(i, death) < api.alpha(i - 1, death) + 1e-12, `the age order broke at death ${death}`)
    }
  }
})

test('A7: the hand-off layer carries the seam with its bands and hands over no second dot', () => {
  /* 两件事由同一层承担：①用户 m01308「没有连贯感、还是有中断」—— 一轮走完，折线的 d 变成
     空串，螺旋瞬间消失再长出来，交接层用写死几何的整条曲线把那一帧接下；②用户 m01412
     「看起来突然从内圈跳到外圈」—— 上一轮的终态在窗口里陪新点走一小段，单粒子交接才不是
     瞬移。第六十一轮（用户 m01594 选 A）让这一层的每一段从「它自己收尾时的亮度」起淡，
     接缝处逐段相等，所以交接那一帧画面完全不变。 */
  const source = read('src/runtime/accretion.js')
  const api = vm.runInNewContext(
    between(source, '    var UNI_ACC_K = 24 / 14', '    function mountAccretion(') +
    '\n({ hand: uniAccretionHandoffAlpha, alpha: uniAccretionBandAlpha, ds: uniAccretionGhostD, at: uniAccretionAt, trail: uniAccretionTrail, len: uniAccretionLength, fade: UNI_ACC_RESIDUE_FADE, bands: UNI_ACC_BANDS })',
    { Math }
  )
  const last = api.bands - 1

  assert.ok(api.fade > 0.3 && api.fade < 0.8, 'the hand-off must sit in the first half of a cycle')

  /* 接缝：u = 0 的第一帧，每段正好等于它收尾时的亮度 —— 画面不该有任何变化。 */
  for (let i = 0; i <= last; i += 1) {
    assert.ok(
      Math.abs(api.hand(i, 0) - api.alpha(i, 1)) < 1e-12,
      `hand-off band ${i} does not start on the brightness it ended on`
    )
    let previous = 2
    for (let u = 0; u <= 1; u += 0.02) {
      const value = api.hand(i, u)
      assert.ok(value <= previous + 1e-12, `hand-off band ${i} brightened again while leaving`)
      assert.ok(value >= 0 && value <= 1, `hand-off band ${i} escaped [0,1]: ${value}`)
      previous = value
    }
    /* 窗口用完就彻底让位 —— 余下大半轮仍然只有一条新长出来的亮线。 */
    assert.ok(api.fade > 0.3 && api.fade < 0.8, 'the band fade window must sit in the first half of a cycle')
    assert.equal(api.hand(i, api.fade), 0, `hand-off band ${i} outstays its window`)
    assert.equal(api.hand(i, 0.9), 0, `hand-off band ${i} is still visible late in the cycle`)
  }

  /* 用户 m01745：「去掉绿点到达终点后在中心位置闪一下的绿点」。交接层只准留形状：一旦
     再往这一层塞一颗停在 (7,8) 的点，画面上就有第二颗粒子钉在正中闪，读作红心。 */
  assert.ok(!/uniAccretionHandoffDot/.test(source), 'the hand-off dot helper came back')
  assert.ok(!/ghostDot/.test(source), 'the hand-off layer appends a circle again')
  assert.ok(!/uniAccretionAt\(1\)/.test(source.split('var paintHandoff')[0].split('var attach')[1] || ''), 'the hand-off layer still anchors a point on the landing spot')

  /* 几何：终态那六段折线就是整条曲线，首尾相接，合起来等于整条轨迹。 */
  const ds = api.ds()
  assert.equal(ds.length, api.bands)
  const numbers = band => band.slice(1).split('L').map((part) => {
    const [x, y] = part.split(' ').map(Number)
    return { x, y }
  })
  const full = api.trail(1)
  let total = 0
  let first = null
  for (let i = 0; i < ds.length; i += 1) {
    assert.ok(/^M[-\d.]+ [-\d.]+(L[-\d.]+ [-\d.]+)+$/.test(ds[i]), `hand-off band ${i} is not a polyline`)
    const pts = numbers(ds[i])
    if (first === null) first = pts[0]
    for (let k = 1; k < pts.length; k += 1) {
      total += Math.hypot(pts[k].x - pts[k - 1].x, pts[k].y - pts[k - 1].y)
    }
  }
  assert.ok(Math.abs(total - api.len(full)) < 0.06, `the hand-off layer does not cover the curve: ${total} vs ${api.len(full)}`)
  assert.ok(Math.hypot(first.x - api.at(1).x, first.y - api.at(1).y) < 0.02, 'the hand-off layer must start where the dot lands')
})

function accretionFixture() {
  class Element {
    constructor(name, attrs = {}) { this.name = name; this.attrs = attrs; this.children = []; this.parentNode = null; this.style = {}; this.dataset = {} }
    setAttribute(key, value) { this.attrs[key] = String(value) }
    getAttribute(key) { return this.attrs[key] ?? null }
    appendChild(child) { child.parentNode = this; this.children.push(child); return child }
    removeChild(child) { this.children.splice(this.children.indexOf(child), 1); child.parentNode = null }
    closest() { let el = this; while (el && !el.attrs['data-row-key']) el = el.parentNode; return el }
    get isConnected() { return this === root || this.parentNode?.isConnected === true }
  }
  const root = new Element('html')
  const body = root.appendChild(new Element('body'))
  let now = 0
  let id = 0
  const frames = new Map()
  const observers = []
  const descendants = el => el.children.flatMap(child => [child, ...descendants(child)])
  const document = {
    body, documentElement: root, createElementNS: (_, name) => new Element(name),
    querySelectorAll: selector => {
      assert.equal(selector, "svg[data-state='ongoing']")
      return descendants(root).filter(el => el.name === 'svg' && el.getAttribute('data-state') === 'ongoing')
    },
  }
  const mount = vm.runInNewContext(read('src/runtime/accretion.js') + '\nmountAccretion', {
    document, performance: { now: () => now },
    window: { requestAnimationFrame: fn => { frames.set(++id, fn); return id }, cancelAnimationFrame: n => frames.delete(n) },
    getComputedStyle: () => ({ getPropertyValue: () => '0.34' }),
    MutationObserver: class {
      constructor(fn) { this.fn = fn; observers.push(this) }
      observe(target, options) { this.target = target; this.options = options }
      disconnect() { this.disconnected = true }
    },
  })
  const add = key => {
    const host = body.appendChild(new Element('div', { 'data-row-key': key }))
    const svg = host.appendChild(new Element('svg', { 'data-state': 'ongoing' }))
    return { host, svg }
  }
  const mutate = (target = root, attributeName = null) => {
    const type = attributeName === null ? 'childList' : 'attributes'
    for (const observer of observers) {
      const options = observer.options
      if (observer.disconnected || !options[type]) continue
      if (observer.target !== target && !(options.subtree && descendants(observer.target).includes(target))) continue
      if (type === 'attributes' && options.attributeFilter && !options.attributeFilter.includes(attributeName)) continue
      observer.fn([{ type, target, attributeName }])
    }
  }
  return {
    mount, add, frames, observers, descendants, mutate,
    move: (row, other) => { row.host.removeChild(row.svg); other.host.appendChild(row.svg); row.host = other.host },
    replace: row => { row.host.removeChild(row.svg); row.svg = row.host.appendChild(new Element('svg', { 'data-state': 'ongoing' })) },
    reduced: value => { body.dataset.uniMotion = value ? 'reduced' : 'full'; mutate(body, 'data-uni-motion') },
    step: time => { now = time; const pending = [...frames.values()]; frames.clear(); pending.forEach(fn => fn(time)) },
    group: row => row.svg.children.find(el => el.getAttribute('class') === 'uni-acc'),
    dot: row => descendants(row.svg).find(el => el.name === 'circle'),
    visible: row => descendants(row.svg).some(el => {
      if (el.name === 'circle') return Number(el.style.opacity) > 0
      if (el.name !== 'path' || !el.getAttribute('d')) return false
      return el.parentNode.style.display !== 'none' && Number(el.getAttribute('stroke-opacity')) > 0
    }),
  }
}

test('A8: mounted animation has no blank frame through repeated cycle seams and paints before first RAF', () => {
  const f = accretionFixture()
  const row = f.add('session:parent')
  const dispose = f.mount()
  assert.ok(f.visible(row), 'mount must not hide the official icon with empty graphics')
  assert.equal(f.group(row).children[0].style.display, 'none', 'first cycle must not invent a previous trail')
  for (let ms = 0; ms <= 6500; ms += 1000 / 144) {
    f.step(ms)
    assert.ok(f.visible(row), `blank animation at ${ms}ms`)
    assert.equal(f.descendants(row.svg).filter(el => el.name === 'circle').length, 1)
  }
  dispose()
  assert.equal(f.frames.size, 0)
  assert.equal(row.svg.children.length, 0)
  assert.ok(f.observers.every(observer => observer.disconnected))
})

test('A9: SVG or group replacement preserves phase; a reused row key starts a new visible cycle', () => {
  const f = accretionFixture()
  const row = f.add('session:parent')
  const dispose = f.mount()
  f.step(500)
  const before = { ...f.dot(row).attrs }
  const old = f.group(row)
  f.replace(row)
  f.mutate()
  assert.deepEqual(f.dot(row).attrs, before, 'SVG replacement reset the trajectory')
  assert.equal(old.parentNode, null, 'replaced SVG retained stale theme graphics')
  row.svg.removeChild(f.group(row))
  f.mutate()
  assert.deepEqual(f.dot(row).attrs, before, 'child replacement reset the trajectory')
  row.host.setAttribute('data-row-key', 'session:other')
  f.mutate(row.host, 'data-row-key')
  assert.notEqual(f.dot(row).getAttribute('cx'), before.cx, 'virtual row reuse inherited another session phase')
  assert.ok(f.visible(row))
  assert.equal(row.svg.children.length, 1, 'repeated sync duplicated graphics')
  dispose()
})

test('A10: parent completion removes its graphics while independently ongoing child keeps its own state', () => {
  const f = accretionFixture()
  const parent = f.add('session:parent')
  const child = f.add('session:child')
  const dispose = f.mount()
  f.step(500)
  const childGroup = f.group(child)
  parent.svg.setAttribute('data-state', 'complete')
  f.mutate(parent.svg, 'data-state')
  assert.equal(f.group(parent), undefined, 'completed parent still has running graphics')
  assert.equal(parent.svg.getAttribute('data-state'), 'complete')
  assert.equal(child.svg.getAttribute('data-state'), 'ongoing')
  assert.equal(f.group(child), childGroup, 'parent completion remounted the child')
  f.step(600)
  assert.ok(f.visible(child))
  child.svg.setAttribute('data-state', 'stopped')
  f.mutate(child.svg, 'data-state')
  f.step(700)
  assert.equal(f.frames.size, 0, 'no ongoing row should leave a perpetual RAF loop')
  assert.equal(f.group(child), undefined)
  dispose()
})

test('A11: reduced motion is static, resumes without duplicate graphics and disposes cleanly', () => {
  const f = accretionFixture()
  const row = f.add('session:parent')
  const dispose = f.mount()
  f.reduced(true)
  f.step(500)
  const still = { ...f.dot(row).attrs }
  assert.equal(f.frames.size, 0)
  assert.equal(f.dot(row).style.opacity, '1')
  f.step(1000)
  assert.deepEqual(f.dot(row).attrs, still)
  f.reduced(false)
  f.step(1100)
  assert.notEqual(f.dot(row).getAttribute('cx'), still.cx)
  assert.equal(row.svg.children.length, 1)
  dispose()
  assert.equal(f.frames.size, 0)
})

test('A12: moving a reused SVG across row hosts cannot inherit its previous host phase', () => {
  const f = accretionFixture()
  const row = f.add('session:parent')
  const other = f.add('session:other')
  other.svg.setAttribute('data-state', 'complete')
  const dispose = f.mount()
  f.step(500)
  const before = f.dot(row).getAttribute('cx')
  row.svg.removeChild(f.group(row))
  f.move(row, other)
  f.mutate(row.host)
  assert.notEqual(f.dot(row).getAttribute('cx'), before)
  assert.ok(f.visible(row))
  dispose()
})

test('A13: key-only row reuse is observed even with RAF stopped by reduced motion', () => {
  const f = accretionFixture()
  const row = f.add('session:parent')
  const dispose = f.mount()
  const initialX = f.dot(row).getAttribute('cx')
  f.reduced(true)
  f.step(500)
  assert.equal(f.frames.size, 0)
  const previous = f.group(row)
  row.host.setAttribute('data-row-key', 'session:other')
  f.mutate(row.host, 'data-row-key')
  assert.notEqual(f.group(row), previous, 'key-only reuse was not observed')
  assert.equal(previous.parentNode, null)
  assert.ok(f.visible(row))
  f.reduced(false)
  f.step(500)
  assert.equal(f.dot(row).getAttribute('cx'), initialX, 'reused row did not restart at its visible birth phase')
  dispose()
})
