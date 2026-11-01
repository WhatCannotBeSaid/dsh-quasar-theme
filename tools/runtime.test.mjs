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
  /* One query per target on the first scan: composer, guide, edited-files card,
     queued-message panel, deliverable card. */
  assert.equal(queries,5)
  callback(records)
  const late=frame
  dispose();assert.equal(cancelled,1);assert.equal(removed,1);assert.equal(disconnected,2)
  late();callback(records)
  assert.equal(queries,5)
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


test('A1: the corona arc is the geometry the user signed off', () => {
  /* 用户 m00704 定稿：圆 R = 5.6、圆心 (7,7)、周期 1300ms、逆时针、弧长 0.28~0.44 呼吸、
     头段 40%、尾段衰减 [0.85, 0.6, 0.38]、角速度调制 0.1。几何直接 eval 生产文件。 */
  const api = vm.runInNewContext(
    between(read('src/runtime/accretion.js'), '    var UNI_ACC_K = 24 / 14', '    function mountAccretion(') +
    '\n({ at: uniAccretionAt, head: uniAccretionHeadAngle, turn: uniAccretionTurn, span: uniAccretionSpan, glow: uniAccretionGlow, arc: uniAccretionArc, path: uniAccretionPath, segments: uniAccretionSegments, K: UNI_ACC_K, BOX: UNI_ACC_BOX, CYCLE: UNI_ACC_CYCLE, RING: UNI_ACC_RING, CX: UNI_ACC_CX, CY: UNI_ACC_CY, MIN: UNI_ACC_ARC_MIN, MAX: UNI_ACC_ARC_MAX, HEAD: UNI_ACC_HEAD, DECAY: UNI_ACC_TAIL_DECAY, WOBBLE: UNI_ACC_WOBBLE, STILL: UNI_ACC_STILL_T })',
    { Math }
  )
  assert.equal(api.RING, 5.6, 'the ring radius is not the agreed 5.6')
  assert.equal(api.CX, 7)
  assert.equal(api.CY, 7)
  assert.equal(api.CYCLE, 1300, 'the cycle is not the agreed 1300ms')
  assert.equal(api.K, 24 / 14)
  assert.equal(api.BOX, 16)
  /* 圆：环上每个点到圆心的距离恒等于 R —— 闭合曲线没有端点，这是「位置连续」的几何前提。 */
  for (let i = 0; i < 24; i += 1) {
    const p = api.at((i / 24) * Math.PI * 2)
    assert.ok(Math.abs(Math.hypot(p.x - 7, p.y - 7) - api.RING) < 1e-12, 'the path is not a circle')
    assert.ok(p.x > 1.3 && p.x < 12.7 && p.y > 1.3 && p.y < 12.7, 'the ring escapes the 16px cell')
  }
  /* 顺时针（用户 m00844）：t = 0 在正上方，t = 0.25 走到正右方（角度递增）。 */
  assert.ok(Math.abs(api.head(0) - (-Math.PI / 2)) < 1e-12)
  assert.ok(Math.abs(api.head(0.25)) < 1e-9, 'the arc does not run clockwise')
  /* 相位重映射恒正单调：一圈之内不倒转、不回头。 */
  let previous = api.turn(0)
  assert.equal(previous, 0)
  for (let i = 1; i < 144; i += 1) {
    const t = i / 144
    const here = api.turn(t)
    assert.ok(here > previous, `the turn went backwards at t = ${t}`)
    previous = here
  }
  assert.equal(api.turn(1), 0, 'the turn does not wrap back to the start of the lap')
  /* 弧长呼吸：最长 0.44 在 t = 0，最短 0.28 在 t = 0.5。 */
  assert.ok(Math.abs(api.span(0) - api.MAX) < 1e-12)
  assert.ok(Math.abs(api.span(0.5) - api.MIN) < 1e-12)
  for (let i = 0; i < 100; i += 1) {
    const span = api.span(i / 100)
    assert.ok(span >= api.MIN - 1e-12 && span <= api.MAX + 1e-12, 'the span left its breathing range')
  }
  assert.equal(api.glow(api.MAX), 1)
  assert.equal(api.glow(api.MIN), 0.75)
  /* 跨 realm 的数组原型不同，deepStrictEqual 会比原型；摊平成宿主数组再比。 */
  assert.deepEqual([...api.DECAY], [0.85, 0.6, 0.38])
  assert.equal(api.WOBBLE, 0.1)
})

test('A2: the shape never breaks — one closed ring, one continuous outline', () => {
  /* 用户的判据（m00676）第二条：轮廓任何时刻都不断口、不重新起笔。这里逐相位检查四段弧首尾
     相接、全部落在同一个圆上，并且 t = 0 与 t = 1 是同一点 —— 没有「起笔」，也就没有接缝。 */
  const api = vm.runInNewContext(
    between(read('src/runtime/accretion.js'), '    var UNI_ACC_K = 24 / 14', '    function mountAccretion(') +
    '\n({ at: uniAccretionAt, head: uniAccretionHeadAngle, span: uniAccretionSpan, arc: uniAccretionArc, path: uniAccretionPath, segments: uniAccretionSegments })',
    { Math }
  )
  for (let i = 0; i < 200; i += 1) {
    const t = i / 200
    const phase = t < 1 ? t : 0
    const segments = api.segments(phase)
    assert.equal(segments.length, 4, 'the band is not one head plus three tail segments')
    const head = api.head(phase)
    assert.ok(Math.abs(segments[0].from - head) < 1e-12, 'the head segment does not start at the head')
    for (let s = 1; s < segments.length; s += 1) {
      assert.ok(Math.abs(segments[s].from - segments[s - 1].to) < 1e-9, `gap between segments at t = ${t}`)
    }
    /* 四段拼起来正好是 2π·span（顺时针，尾巴在头的角度较小一侧）：总长度只随呼吸变。 */
    const sweep = Math.PI * 2 * api.span(phase)
    assert.ok(Math.abs(segments[3].to - (head - sweep)) < 1e-9, 'the band length disagrees with the span')
    for (const segment of segments) {
      const points = api.arc(segment.from, segment.to, 4)
      for (const p of points) {
        assert.ok(Math.abs(Math.hypot(p.x - 7, p.y - 7) - 5.6) < 1e-12, 'a sampled point left the ring')
      }
      const d = api.path(points)
      assert.ok(d.startsWith('M') && d.includes('L'), 'a segment degenerated to a dot')
    }
  }
  /* 一圈闭合：t = 1 与 t = 0 是同一个位置，误差只来自浮点。 */
  const start = api.at(api.head(0))
  const wrap = api.at(api.head(1))
  assert.ok(Math.hypot(start.x - wrap.x, start.y - wrap.y) < 1e-9, 'the arc does not close after one lap')
})

test('A3: the head leads, the tail decays, and nothing is invisible inside the band', () => {
  const api = vm.runInNewContext(
    between(read('src/runtime/accretion.js'), '    var UNI_ACC_K = 24 / 14', '    function mountAccretion(') +
    '\n({ segments: uniAccretionSegments, span: uniAccretionSpan, glow: uniAccretionGlow, DECAY: UNI_ACC_TAIL_DECAY })',
    { Math }
  )
  for (let i = 0; i < 120; i += 1) {
    const t = i / 120
    const segments = api.segments(t)
    const glow = api.glow(api.span(t))
    assert.ok(Math.abs(segments[0].alpha - glow) < 1e-12, 'the head is not driven by the breathing glow')
    assert.ok(segments[0].alpha > 0.74 && segments[0].alpha <= 1, 'the head brightness left 0.75..1')
    for (let s = 1; s < 4; s += 1) {
      assert.ok(Math.abs(segments[s].alpha - glow * api.DECAY[s - 1]) < 1e-12, 'a tail band ignores the decay ramp')
      assert.ok(segments[s].alpha < segments[s - 1].alpha, 'the tail does not fade towards its end')
      assert.ok(segments[s].alpha > 0, 'a tail band is invisible, so the band has a hole')
    }
  }
})

test('A4: the band lengthens and shortens, and the glow rides that breathing', () => {
  const api = vm.runInNewContext(
    between(read('src/runtime/accretion.js'), '    var UNI_ACC_K = 24 / 14', '    function mountAccretion(') +
    '\n({ span: uniAccretionSpan, glow: uniAccretionGlow, MIN: UNI_ACC_ARC_MIN, MAX: UNI_ACC_ARC_MAX })',
    { Math }
  )
  /* 半圈内单调缩短、半圈内单调伸长：一整圈只呼吸一次，读起来才是「呼吸」不是「抖动」。 */
  for (let i = 1; i < 50; i += 1) {
    assert.ok(api.span(i / 100) < api.span((i - 1) / 100), 'the first half of the breath is not monotonic')
  }
  for (let i = 1; i <= 100; i += 1) {
    const a = 0.5 + (i - 1) / 200
    const b = 0.5 + i / 200
    assert.ok(api.span(b) > api.span(a), 'the second half of the breath is not monotonic')
  }
  /* 亮度与弧长严格同向：弧最短时最暗，最长时最亮。 */
  /* 从最短那一刻起步：亮度在 t = 0.5 最低，之后随弧长单调抬回 1。 */
  let previous = api.glow(api.span(0.5))
  for (let i = 1; i <= 100; i += 1) {
    const here = api.glow(api.span(0.5 + i / 200))
    assert.ok(here > previous, 'the glow does not rise with the span')
    previous = here
  }
})

test('A5: no pre-drawn art and no CSS-driven motion — the frame writes the geometry', () => {
  const source = read('src/runtime/accretion.js')
  const raw = read('src/theme.css')
  const sheet = raw.replace(/\/\*[\s\S]*?\*\//g, '')
  /* 图元只有 g 与 path：没有 circle（弧带本身就是主体）、没有 dasharray 假弧、没有渐变滤镜。 */
  assert.ok(!/createElementNS\(SVG_NS, 'circle'\)/.test(source), 'a separate dot is back')
  assert.ok(!/stroke-dasharray/.test(source), 'the arc is faked with dashes')
  assert.ok(!/(linearGradient|radialGradient|feGaussianBlur)/.test(source), 'a gradient or glow filter came back')
  /* 运动不能交给 CSS：旋转会把整条弧带整体转走，头尾关系就没了。 */
  assert.ok(!/setAttribute\('transform'/.test(source), 'the band is spun by a transform')
  const section = raw.split('日冕弧带')[1].split('会话行 Pending')[0]
  assert.ok(section.length > 0, 'the corona arc section is not in the stylesheet')
  assert.ok(!/animation:|@keyframes/.test(section.replace(/\/\*[\s\S]*?\*\//g, '')), 'the stylesheet animates the band')
})

test('A6: the outline reads as a band — head 40%, three decaying tail segments', () => {
  const api = vm.runInNewContext(
    between(read('src/runtime/accretion.js'), '    var UNI_ACC_K = 24 / 14', '    function mountAccretion(') +
    '\n({ arc: uniAccretionArc, path: uniAccretionPath, segments: uniAccretionSegments, span: uniAccretionSpan, HEAD: UNI_ACC_HEAD, RING: UNI_ACC_RING })',
    { Math }
  )
  const lengthOf = d => {
    const pts = d.slice(1).split('L').map(part => part.split(' ').map(Number))
    let total = 0
    for (let i = 1; i < pts.length; i += 1) total += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])
    return total
  }
  for (const t of [0, 0.17, 0.33, 0.62, 0.88]) {
    const segments = api.segments(t)
    const sweep = Math.PI * 2 * api.span(t)
    const bandLength = api.RING * sweep
    const head = lengthOf(api.path(api.arc(segments[0].from, segments[0].to, 8)))
    assert.ok(Math.abs(head - bandLength * api.HEAD) / head < 0.01, `the head is not 40% of the band at t = ${t}`)
    let total = 0
    for (const segment of segments) {
      total += lengthOf(api.path(api.arc(segment.from, segment.to, segment.steps)))
    }
    assert.ok(Math.abs(total - bandLength) / total < 0.01, `the band length is off at t = ${t}`)
  }
})

test('A7: one subject only — four paths, no second dot anywhere', () => {
  const source = read('src/runtime/accretion.js')
  assert.ok(!/'circle'/.test(source), 'a circle element is still created')
  assert.ok(source.includes("'uni-acc-arc uni-acc-arc-head'"), 'the head path has no class')
  assert.ok(source.includes("'uni-acc-arc uni-acc-arc-tail'"), 'the tail paths have no class')
  /* 旧的整条吸积流必须连名字都不剩：留下任何一个常量都说明有人把开口曲线修回来了。 */
  for (const dead of ['uni-acc-ghost', 'UNI_ACC_TAIL_SPAN', 'UNI_ACC_STAGGER', 'uniAccretionTrail', 'uniAccretionDotAlpha']) {
    assert.ok(!source.includes(dead), dead + ' survived the move to a closed ring')
  }
})

/* 会话行 Running —— 弧带的宿主替身。一棵够用的假 DOM：rAF 由测试手动推进，观察器手工触发，
   没有 getComputedStyle —— 弧带的亮度全部由 geometry 算，样式表只给颜色与笔宽。 */
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
    document,
    performance: { now: () => now },
    window: { requestAnimationFrame: fn => { frames.set(++id, fn); return id }, cancelAnimationFrame: n => frames.delete(n) },
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
  const groupOf = row => row.svg.children.find(el => el.getAttribute('class') === 'uni-acc')
  return {
    mount, add, frames, observers, descendants, mutate,
    move: (row, other) => { row.host.removeChild(row.svg); other.host.appendChild(row.svg); row.host = other.host },
    replace: row => { row.host.removeChild(row.svg); row.svg = row.host.appendChild(new Element('svg', { 'data-state': 'ongoing' })) },
    reduced: value => { body.dataset.uniMotion = value ? 'reduced' : 'full'; mutate(body, 'data-uni-motion') },
    step: time => { now = time; const pending = [...frames.values()]; frames.clear(); pending.forEach(fn => fn(time)) },
    /* 弧带：一个 g.uni-acc，四条 path（第一条是头段）。没有 circle，所以也没有 dot 辅助函数。 */
    group: row => groupOf(row),
    arcs: row => {
      const g = groupOf(row)
      return g === undefined ? [] : g.children
    },
    head: row => {
      const g = groupOf(row)
      return g === undefined ? undefined : g.children[0]
    },
    visible: row => {
      const g = groupOf(row)
      if (g === undefined || g.style.display === 'none') return false
      return g.children.some(el => {
        if (el.getAttribute('d') === null || el.getAttribute('d') === '') return false
        return Number(el.getAttribute('stroke-opacity')) > 0
      })
    },
  }
}


test('A8: mounted arc paints before the first RAF and never blanks across seams', () => {
  const f = accretionFixture()
  const row = f.add('session:parent')
  const dispose = f.mount()
  assert.ok(f.visible(row), 'mount must not hide the official icon with empty graphics')
  assert.equal(f.arcs(row).length, 4, 'the band is not one head plus three tail segments')
  assert.ok(f.head(row).getAttribute('class').includes('uni-acc-arc-head'))
  for (let ms = 0; ms <= 6500; ms += 1000 / 144) {
    f.step(ms)
    assert.ok(f.visible(row), `blank animation at ${ms}ms`)
    assert.equal(f.arcs(row).length, 4, 'the frame changed the number of segments')
    assert.ok(f.head(row).getAttribute('d').length > 4, 'the head segment lost its geometry')
  }
  dispose()
  assert.equal(f.frames.size, 0)
  assert.equal(row.svg.children.length, 0)
  assert.ok(f.observers.every(observer => observer.disconnected))
})

test('A9: SVG or group replacement preserves phase; a reused row key starts a new cycle', () => {
  const f = accretionFixture()
  const row = f.add('session:parent')
  const dispose = f.mount()
  f.step(500)
  const before = f.head(row).getAttribute('d')
  const old = f.group(row)
  f.replace(row)
  f.mutate()
  assert.equal(f.head(row).getAttribute('d'), before, 'SVG replacement reset the arc phase')
  assert.equal(old.parentNode, null, 'replaced SVG retained stale theme graphics')
  row.svg.removeChild(f.group(row))
  f.mutate()
  assert.equal(f.head(row).getAttribute('d'), before, 'child replacement reset the arc phase')
  row.host.setAttribute('data-row-key', 'session:other')
  f.mutate(row.host, 'data-row-key')
  assert.notEqual(f.head(row).getAttribute('d'), before, 'virtual row reuse inherited another session phase')
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

test('A11: reduced motion is a single static arc that resumes without duplicate graphics', () => {
  const f = accretionFixture()
  const row = f.add('session:parent')
  const dispose = f.mount()
  f.reduced(true)
  f.step(500)
  const still = f.head(row).getAttribute('d')
  assert.equal(f.frames.size, 0, 'the still frame keeps a RAF loop alive')
  f.step(1000)
  assert.equal(f.head(row).getAttribute('d'), still, 'reduced motion kept animating')
  assert.ok(f.visible(row), 'the still frame is invisible, which blanks the icon')
  assert.equal(f.arcs(row).length, 4)
  f.reduced(false)
  f.step(1100)
  assert.notEqual(f.head(row).getAttribute('d'), still, 'the arc never resumed')
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
  const before = f.head(row).getAttribute('d')
  row.svg.removeChild(f.group(row))
  f.move(row, other)
  f.mutate(row.host)
  assert.notEqual(f.head(row).getAttribute('d'), before)
  assert.ok(f.visible(row))
  dispose()
})

test('A13: key-only row reuse is observed even with RAF stopped by reduced motion', () => {
  const f = accretionFixture()
  const row = f.add('session:parent')
  const dispose = f.mount()
  const initial = f.head(row).getAttribute('d')
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
  assert.equal(f.head(row).getAttribute('d'), initial, 'reused row did not restart at its visible birth phase')
  dispose()
})

test('A14: the head walks the ring without a jump at the seam', () => {
  /* 用户 m00676 的第一条判据：单一主体、逐帧不瞬移。这里逐帧取头端第一个坐标点，一跳超过半
     个设计单位就红。一圈 1300ms 在 144Hz 下每帧约 0.19 单位，限 0.6 留出 ±10% 变速余量。 */
  const f = accretionFixture()
  const row = f.add('session:parent')
  const dispose = f.mount()
  const pointOf = d => d.slice(1).split('L')[0].split(' ').map(Number)
  let previous = null
  let biggest = 0
  for (let ms = 0; ms <= 5200; ms += 1000 / 144) {
    f.step(ms)
    const here = pointOf(f.head(row).getAttribute('d'))
    if (previous !== null) biggest = Math.max(biggest, Math.hypot(here[0] - previous[0], here[1] - previous[1]))
    previous = here
  }
  assert.ok(biggest < 0.6, `the head jumped ${biggest} design units in one frame`)
  dispose()
})

test('A15: the still frame is one frozen band and disposal leaves nothing behind', () => {
  const f = accretionFixture()
  const row = f.add('session:parent')
  const dispose = f.mount()
  f.reduced(true)
  f.step(300)
  const frozen = f.arcs(row).map(arc => arc.getAttribute('d'))
  assert.equal(frozen.filter(d => d !== '').length, 4, 'the still frame does not show the whole band')
  f.step(2600)
  assert.deepEqual(f.arcs(row).map(arc => arc.getAttribute('d')), frozen, 'the still frame drifted')
  dispose()
  assert.equal(f.frames.size, 0)
  assert.equal(row.svg.children.length, 0)
  assert.ok(f.observers.every(observer => observer.disconnected))
})

/* 会话行 Pending —— 开普勒轨道。几何直接 eval 生产文件，不重写一份算术。 */
function keplerApi() {
  return vm.runInNewContext(
    read('src/runtime/kepler.js') + '\n({ at: uniKeplerAt, point: uniKeplerPoint, lut: uniKeplerLut, A: UNI_KEP_A, B: UNI_KEP_B, tilt: UNI_KEP_TILT, period: UNI_KEP_PERIOD, still: UNI_KEP_STILL, cx: UNI_KEP_CX, cy: UNI_KEP_CY, dot: UNI_KEP_DOT })',
    {},
  )
}

test('K1: the orbit is a tilted ellipse that stays inside the 16px leading cell', () => {
  const k = keplerApi()
  assert.ok(k.A > k.B, 'the orbit flattened into a circle')
  assert.equal(k.tilt, -Math.PI / 6, 'the long axis no longer leans -30deg')
  assert.equal(k.cx, 8)
  assert.equal(k.cy, 8)
  let maxX = 0
  let maxY = 0
  for (let i = 0; i < 720; i += 1) {
    const at = k.at(i / 720)
    maxX = Math.max(maxX, Math.abs(at.x - k.cx))
    maxY = Math.max(maxY, Math.abs(at.y - k.cy))
  }
  /* 旋转盒半宽/半高：sqrt((a·cos30)² + (b·sin30)²) ≈ 5.99，另一半 ≈ 4.54。 */
  assert.ok(Math.abs(maxX - 5.99) < 0.02, `half-width drifted to ${maxX}`)
  assert.ok(Math.abs(maxY - 4.54) < 0.02, `half-height drifted to ${maxY}`)
  /* 16px 格子里还要留得下 0.8 的描边和半像素抗锯齿。 */
  assert.ok(maxX + 0.4 <= 8 && maxY + 0.4 <= 8, 'the orbit pokes out of its cell')
})

test('K2: the arc-length table is a closed, strictly increasing parametrisation', () => {
  const k = keplerApi()
  const lut = k.lut()
  assert.equal(lut.cum.length, 129)
  for (let i = 1; i < lut.cum.length; i += 1) assert.ok(lut.cum[i] > lut.cum[i - 1], `flat step at ${i}`)
  assert.ok(Math.abs(lut.cum[128] - lut.total) < 1e-12)
  let dense = 0
  let prev = k.point(0)
  for (let i = 1; i <= 200000; i += 1) {
    const here = k.point((i / 200000) * Math.PI * 2)
    dense += Math.hypot(here.x - prev.x, here.y - prev.y)
    prev = here
  }
  assert.ok(Math.abs(lut.total - dense) / dense < 0.001, `table length ${lut.total} vs ${dense}`)
  const start = k.at(0)
  const end = k.at(1)
  assert.ok(Math.hypot(start.x - end.x, start.y - end.y) < 1e-9, 'one turn does not close')
  assert.ok(Math.hypot(k.at(0.25).x - k.at(1.25).x, k.at(0.25).y - k.at(1.25).y) < 1e-9, 'phase does not wrap')
})

test('K3: the dot walks equal arc per equal time, which is the uniform speed the mock asks for', () => {
  const k = keplerApi()
  const steps = 64
  const chords = []
  for (let i = 0; i < steps; i += 1) {
    const a = k.at(i / steps)
    const b = k.at((i + 1) / steps)
    chords.push(Math.hypot(b.x - a.x, b.y - a.y))
  }
  const ratio = Math.max(...chords) / Math.min(...chords)
  assert.ok(ratio < 1.02, `arc-length sampling is uneven: ${ratio}`)
  /* 反面钉桩：同一批步长如果按参数角走（椭圆的自然角速度），快慢差会到 1.8 倍。 */
  const naive = []
  for (let i = 0; i < steps; i += 1) {
    const a = k.point((i / steps) * Math.PI * 2)
    const b = k.point(((i + 1) / steps) * Math.PI * 2)
    naive.push(Math.hypot(b.x - a.x, b.y - a.y))
  }
  assert.ok(Math.max(...naive) / Math.min(...naive) > 1.5, 'the fixture cannot tell uniform arc from uniform angle')
})

function keplerFixture() {
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
      assert.equal(selector, "[data-row-key^='session:'] span[data-state='warning']")
      return descendants(root).filter(el => el.name === 'span' && el.getAttribute('data-state') === 'warning' &&
        el.parentNode !== null && String(el.parentNode.getAttribute('data-row-key') || '').startsWith('session:'))
    },
  }
  const mount = vm.runInNewContext(read('src/runtime/kepler.js') + '\nmountKepler', {
    document, performance: { now: () => now },
    window: { requestAnimationFrame: fn => { frames.set(++id, fn); return id }, cancelAnimationFrame: n => frames.delete(n) },
    MutationObserver: class {
      constructor(fn) { this.fn = fn; observers.push(this) }
      observe(target, options) { this.target = target; this.options = options }
      disconnect() { this.disconnected = true }
    },
  })
  const add = key => {
    const host = body.appendChild(new Element('div', { 'data-row-key': key }))
    const marker = host.appendChild(new Element('span', { 'data-state': 'warning' }))
    return { host, marker }
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
    svg: row => row.marker.children.find(el => el.getAttribute('class') === 'uni-kep'),
    dot: row => descendants(row.marker).find(el => el.name === 'circle'),
    orbit: row => descendants(row.marker).find(el => el.name === 'ellipse'),
    reduced: value => { body.dataset.uniMotion = value ? 'reduced' : 'full'; mutate(body, 'data-uni-motion') },
    step: time => { now = time; const pending = [...frames.values()]; frames.clear(); pending.forEach(fn => fn(time)) },
  }
}

test('K4: the marker keeps its own slot, paints before the first frame, and every row shares one phase', () => {
  const f = keplerFixture()
  const one = f.add('session:one')
  const two = f.add('session:two')
  const dispose = f.mount()
  for (const row of [one, two]) {
    const svg = f.svg(row)
    assert.ok(svg, 'no orbit was mounted')
    assert.equal(svg.parentNode, row.marker, 'the graphics must live inside the leading cell, not next to it')
    assert.equal(svg.getAttribute('viewBox'), '0 0 16 16')
    assert.equal(svg.getAttribute('aria-hidden'), 'true')
    assert.equal(f.orbit(row).getAttribute('rx'), '6.6')
    assert.equal(f.orbit(row).getAttribute('ry'), '3.6')
    assert.equal(f.orbit(row).getAttribute('transform'), 'rotate(-30.00 8 8)')
    assert.ok(f.dot(row).getAttribute('cx') !== null, 'the dot must be on the orbit before the first frame')
  }
  assert.equal(f.dot(one).getAttribute('cx'), f.dot(two).getAttribute('cx'), 'rows drifted out of phase')
  const first = f.dot(one).getAttribute('cx')
  f.step(650)
  assert.notEqual(f.dot(one).getAttribute('cx'), first, 'the dot did not move')
  assert.equal(f.dot(one).getAttribute('cx'), f.dot(two).getAttribute('cx'), 'rows drifted out of phase while running')
  dispose()
  assert.equal(f.frames.size, 0)
  assert.equal(one.marker.children.length, 0)
  assert.equal(two.marker.children.length, 0)
  assert.ok(f.observers.every(observer => observer.disconnected))
})

test('K5: reduced motion freezes the dot on a painted frame and keeps the whole orbit', () => {
  const f = keplerFixture()
  const k = keplerApi()
  const row = f.add('session:one')
  const dispose = f.mount()
  f.step(400)
  f.reduced(true)
  f.step(900)
  assert.equal(f.frames.size, 0, 'reduced motion still schedules frames')
  const still = k.at(k.still)
  assert.equal(f.dot(row).getAttribute('cx'), still.x.toFixed(2))
  assert.equal(f.dot(row).getAttribute('cy'), still.y.toFixed(2))
  assert.ok(f.orbit(row), 'reduced motion dropped the orbit itself')
  f.reduced(false)
  f.step(1400)
  assert.notEqual(f.dot(row).getAttribute('cx'), still.x.toFixed(2), 'motion did not resume')
  assert.equal(f.descendants(row.marker).filter(el => el.getAttribute('class') === 'uni-kep').length, 1)
  dispose()
})
