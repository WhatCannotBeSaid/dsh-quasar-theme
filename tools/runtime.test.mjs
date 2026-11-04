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
/* glass.js and lens.js read the shared added/removed-node test from a module that
   precedes them in CLIENT_FILES. A single-file mount therefore loads its production
   prefix rather than gaining a copy of the helper: the source under test is still the
   shipped text, in the shipped order. */
function upTo(file) {
  const at = CLIENT_FILES.indexOf(file)
  assert.ok(at >= 0, file + ' is not in CLIENT_FILES')
  return CLIENT_FILES.slice(0, at).map(read).join('\n')
}
function mountEffect(label, bindings) {
  return effectRunner(label, bindings)()
}
/* Same as mountEffect, but hands back the installer so a test can choose when it
   runs the deferred effect instead of running it immediately. */
function effectRunner(label, bindings) {
  const effects = new Map()
  const context = { get: () => ({}), inject() {}, effect(fn, name) { effects.set(name, fn) } }
  const exports = vm.runInNewContext(`(function () { var module = {exports:{}}; var exports = module.exports; ${clientSource()} })()`, {
    PLUGIN_ID: 'dsh-quasar-theme', TOKENS: {}, MANIFEST: {}, ...bindings,
  })
  exports.apply(context)
  assert.ok(effects.has(label), label)
  return effects.get(label)
}
test('S10: built artifact registers one loader with unchanged public exports', () => {
  const registrations=[]
  vm.runInNewContext(read('client.js'), {window:{__ModuleLoader__:{load:value=>registrations.push(value)}}})
  assert.equal(registrations.length,1)
  assert.equal(registrations[0].id,'dsh-quasar-theme')
  const exported=registrations[0].factory(name=>{throw Error('unexpected eager require: '+name)})
  assert.equal(exported.name,'dsh-quasar-theme')
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
  const dispose=vm.runInNewContext(upTo('src/runtime/glass.js')+read('src/runtime/glass.js')+'\nmountLiquidGlass()',context)
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
   没有 getComputedStyle —— 弧带的亮度全部由 geometry 算，样式表只给颜色与笔宽。
   nodeType / matches / querySelector 只覆盖当前两个 SEL：自身名字即选择器，祖先链按
   data-row-key 前缀匹配，够 uniStatusMutationTouches 保守判定，不写通用 CSS 引擎。 */
function makeFixtureElements(kind, rootOf) {
  const descendants = el => (el.children ?? []).flatMap(child => [child, ...descendants(child)])
  class Element {
    constructor(name, attrs = {}) { this.name = name; this.attrs = attrs; this.children = []; this.parentNode = null; this.style = {}; this.dataset = {}; this.nodeType = 1 }
    setAttribute(key, value) { this.attrs[key] = String(value) }
    getAttribute(key) { return this.attrs[key] ?? null }
    appendChild(child) { child.parentNode = this; this.children.push(child); return child }
    removeChild(child) { this.children.splice(this.children.indexOf(child), 1); child.parentNode = null }
    closest() { let el = this; while (el && !el.attrs['data-row-key']) el = el.parentNode; return el }
    get isConnected() { return this === rootOf() || this.parentNode?.isConnected === true }
    /* kind === 'kepler'：祖先链上任一 [data-row-key^='session:']，不是只看直接父节点。 */
    matches(selector) {
      if (selector === kind.selector) return this.name === kind.tag && this.getAttribute('data-state') === kind.state
      const m = /^\[data-row-key\^='(.*)'\]/.exec(selector)
      if (m === null) return false
      const key = this.getAttribute('data-row-key')
      return key !== null && key.startsWith(m[1])
    }
    querySelector(selector) { return descendants(this).find(el => el.nodeType === 1 && el.matches(selector)) ?? null }
  }
  /* 真 MutationRecord 的节点袋：长度、下标与 item() 同时存在。 */
  const bag = nodes => Object.assign(nodes.slice(), { item: i => nodes[i] ?? null })
  /* removed 缺省时空袋，带删除的批次必须真把节点放进 removedNodes。 */
  const record = (nodes, removed = []) => ({ type: 'childList', target: rootOf(), addedNodes: bag(nodes), removedNodes: bag(removed) })
  const text = data => ({ nodeType: 3, data })
  return { Element, descendants, bag, record, text, make: (name, attrs = {}) => new Element(name, attrs) }
}

function accretionFixture() {
  const kind = { selector: "svg[data-state='ongoing']", tag: 'svg', state: 'ongoing' }
  let root = null
  const { Element, descendants, record, text, make } = makeFixtureElements(kind, () => root)
  root = new Element('html')
  const body = root.appendChild(new Element('body'))
  let now = 0
  let id = 0
  const frames = new Map()
  const observers = []
  /* scans：document.querySelectorAll 的次数。sync() 每次扫描恰好调一次，所以它把「同步初始化」
     与「之后观察器回调里的 kick」分得开：两者都是 kick/sync 自己数出来的，不靠推断。 */
  const scans = { total: 0, atMount: null }
  const document = {
    body, documentElement: root, createElementNS: (_, name) => new Element(name),
    querySelectorAll: selector => {
      assert.equal(selector, "svg[data-state='ongoing']")
      scans.total += 1
      return descendants(root).filter(el => el.name === 'svg' && el.getAttribute('data-state') === 'ongoing')
    },
  }
  const mount = vm.runInNewContext(upTo('src/runtime/accretion.js') + read('src/runtime/accretion.js') + '\nmountAccretion', {
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
  /* 不带批次（旧调用形态）时给一条缺节点袋的记录：真实的生产代码只能保守同步，测试也不
     假装它有证据。带 nodes 时是标准 childList 批次，走过滤路径。 */
  const mutate = (target = root, attributeName = null, nodes = null, removed = null) => {
    const type = attributeName === null ? 'childList' : 'attributes'
    for (const observer of observers) {
      const options = observer.options
      if (observer.disconnected || !options[type]) continue
      if (observer.target !== target && !(options.subtree && descendants(observer.target).includes(target))) continue
      if (type === 'attributes' && options.attributeFilter && !options.attributeFilter.includes(attributeName)) continue
      observer.fn([type === 'childList' && nodes !== null ? record(nodes, removed ?? []) : { type, target, attributeName }])
    }
  }
  const groupOf = row => row.svg.children.find(el => el.getAttribute('class') === 'uni-acc')
  return {
    /* 包一层只为记账：fixture 里不用 assert，所以「挂载完成那一刻」的累计扫描次数由这里截下。 */
    mount: () => { const dispose = mount(); scans.atMount = scans.total; return dispose },
    scans,
    add, frames, observers, descendants, mutate, record, text, make,
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


test('A16: mount scans once, the first RAF adds no scan and keeps its stop rule, later kicks still sync', () => {
  /* 三种挂载初始态。每次 document.querySelectorAll 记 1 次扫描，所以「挂载同步阶段」与
     「之后观察器/偏好回调触发的 kick」在账上是两条线，这里只对前者断言恒为 1。 */
  const cases = [
    { name: 'ongoing row', rows: 1, reduced: false },
    { name: 'no ongoing row', rows: 0, reduced: false },
    { name: 'ongoing row + reduced', rows: 1, reduced: true },
    { name: 'no ongoing row + reduced', rows: 0, reduced: true },
  ]
  for (const kase of cases) {
    const f = accretionFixture()
    const row = kase.rows ? f.add('session:parent') : null
    if (kase.reduced) f.reduced(true)
    const scansAtSetup = f.scans.total
    const dispose = f.mount()
    const label = `${kase.name}: `
    assert.equal(f.scans.atMount - scansAtSetup, 1, label + 'mount must scan exactly once')
    if (row !== null) {
      /* 首绘必须先于挂载返回：图形不是等到首帧才出现，观察器/偏好监听的顺序也没被打乱。 */
      assert.equal(f.visible(row), true, label + 'first paint must be visible before mount returns')
      assert.equal(f.arcs(row).length, 4, label + 'the whole band must be painted before mount returns')
    }
    /* 首帧沿用原条件被请求：即使没有行或 reduced，也由这一帧按原逻辑决定停不停。 */
    assert.equal(f.frames.size, 1, label + 'the initial RAF must still be requested')
    f.step(16)
    assert.equal(f.scans.total - scansAtSetup, 1, label + 'the first RAF must not scan again')
    /* 只有「没有行或 reduced」这两种初始态的首帧才收工；普通态照旧继续跑。 */
    const staysIdle = kase.rows === 0 || kase.reduced
    if (staysIdle) assert.equal(f.frames.size, 0, label + 'no ongoing row or reduced motion must leave no RAF loop')
    else assert.equal(f.frames.size, 1, label + 'a running row must keep its RAF loop')
    /* 真实变更走 kick：kick 自己同步一次，紧接着的那一帧不再扫。 */
    const observed = row ?? f.add('session:late')
    if (row === null) f.mutate(observed.host)
    else { observed.host.setAttribute('data-row-key', 'session:other'); f.mutate(observed.host, 'data-row-key') }
    const afterKick = f.scans.total
    assert.equal(afterKick - scansAtSetup, 2, label + 'an observed change must sync once inside kick')
    assert.ok(f.visible(observed), label + 'the kick must paint the change synchronously')
    f.step(32)
    assert.equal(f.scans.total, afterKick, label + 'the frame after a kick must not scan again')
    if (row === null) assert.equal(f.group(observed).parentNode, observed.svg, label + 'the late row never got its graphics')
    dispose()
    assert.equal(f.frames.size, 0, label + 'disposal must cancel the RAF')
  }
})

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

test('A17: only batches that can change the selector wake the scan, and a related one still syncs inside the callback', () => {
  const f = accretionFixture()
  const row = f.add('session:parent')
  const dispose = f.mount()
  f.step(16)
  const scans = f.scans.total
  const frames = f.frames.size
  /* 无关的纯新增：自身与子树都不命中——流式回复时一帧里能挂几十个这种节点。 */
  const wrapper = f.make('div', {})
  wrapper.appendChild(f.text('hello '))
  wrapper.appendChild(f.make('p', {}))
  f.mutate(row.host, null, [wrapper])
  assert.equal(f.scans.total, scans, 'an unrelated batch paid a document scan')
  assert.equal(f.frames.size, frames, 'an unrelated batch scheduled a second RAF callback')
  /* 一个批次里三条相关记录（两条自身命中、一条同批），也只扫描一次。 */
  const late = row.host.appendChild(f.make('svg', { 'data-state': 'ongoing' }))
  const other = f.add('session:other')
  f.mutate(row.host, null, [wrapper, late, other.svg])
  assert.equal(f.scans.total, scans + 1, 'a batch must be scanned once, not once per record')
  assert.ok(f.visible({ svg: late }), 'the related batch did not paint before the callback returned')
  assert.ok(f.visible(other), 'the second related record was never attached')
  f.step(32)
  assert.equal(f.scans.total, scans + 1, 'the frame after a kick scanned again')
  dispose()
})

test('A18: own graphics and removed nodes stay conservative; real nodes and reparents still sync', () => {
  /* 宿主的 childList 只收直接子节点，所以采用「追加一个新子树」的批次再加一层包装来模拟
     真实监听范围；包装层自身与子树都不命中，就应当跳过。 */
  const f = accretionFixture()
  const row = f.add('session:parent')
  const dispose = f.mount()
  f.step(16)
  const scans = f.scans.total
  /* 1) 自身图形的回声若真的进了 observer（g.uni-acc 的装配），它本身不命中 SEL。 */
  const echo = row.svg.appendChild(f.make('span', {}))
  f.mutate(row.svg, null, [echo])
  assert.equal(f.scans.total, scans, 'an unrelated echo of its own graphics was scanned')
  /* 2) 通知了 g.uni-acc 被摘掉：批次里没有任何命中节点，但那是删除，必须同步一次。 */
  const before = scans + 1
  f.mutate(row.svg, null, [])
  assert.equal(f.scans.total, before, 'a notification with an empty childList must still sync')
  assert.ok(f.group(row), 'graphics are missing after a conservative sync')
  /* 3) 真把整棵 g.uni-acc 摘掉再通知：摘掉后文档里已没有这个 svg，这一批只能同
     step 4（sync 只认文档里还挂着的图形根），所以这里不再断言它会被同一个批次补回。 */
  const g = f.group(row)
  row.svg.removeChild(g)
  f.mutate(row.svg, null, [])
  assert.equal(f.scans.total, before + 1, 'removing the graphics did not sync')
  /* 4) 真删掉仍在文档里的图形根后，带删除的批次必须同步一次；这一同步只认「文档里还挂着的
     图形根」（既有限制），所以不在这里断言同一个批次会补回。 */
  const wrapper = f.make('div', {})
  f.mutate(row.svg, null, [wrapper])
  assert.equal(f.scans.total, before + 1, 'an unrelated wrapper was scanned')
  row.svg.removeChild(f.group(row))
  /* 真删除记录：被摘掉的图形根必须出现在 removedNodes 里，这一批才是「带删除」的批次。 */
  f.mutate(row.svg, null, [], [f.group(row)])
  assert.equal(f.scans.total, before + 2, 'a batch carrying a graphics unmount did not sync')
  dispose()
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
  const kind = { selector: "[data-row-key^='session:'] span[data-state='warning']", tag: 'span', state: 'warning' }
  let root = null
  let queries = 0
  const { Element, descendants, record, text, make } = makeFixtureElements(kind, () => root)
  root = new Element('html')
  const body = root.appendChild(new Element('body'))
  let now = 0
  let id = 0
  const frames = new Map()
  const observers = []
  const document = {
    body, documentElement: root, createElementNS: (_, name) => new Element(name),
    querySelectorAll: selector => {
      assert.equal(selector, kind.selector)
      queries += 1
      return descendants(root).filter(el => el.matches(selector))
    },
  }
  const mount = vm.runInNewContext(upTo('src/runtime/kepler.js') + read('src/runtime/kepler.js') + '\nmountKepler', {
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
  /* 旧的单参调用给一条缺节点袋的记录：生产代码只能保守同步。带 nodes 时是标准批次。 */
  const mutate = (target = root, attributeName = null, nodes = null, removed = null) => {
    const type = attributeName === null ? 'childList' : 'attributes'
    for (const observer of observers) {
      const options = observer.options
      if (observer.disconnected || !options[type]) continue
      if (observer.target !== target && !(options.subtree && descendants(observer.target).includes(target))) continue
      if (type === 'attributes' && options.attributeFilter && !options.attributeFilter.includes(attributeName)) continue
      observer.fn([type === 'childList' && nodes !== null ? record(nodes, removed ?? []) : { type, target, attributeName }])
    }
  }
  const marker = el => el.closest()
  return {
    mount, add, make, frames, observers, descendants, mutate, record, text,
    queries: () => queries,
    svg: row => row.marker.children.find(el => el.getAttribute('class') === 'uni-kep'),
    dot: row => descendants(row.marker).find(el => el.name === 'circle'),
    orbit: row => descendants(row.marker).find(el => el.name === 'ellipse'),
    reduced: value => { body.dataset.uniMotion = value ? 'reduced' : 'full'; mutate(body, 'data-uni-motion') },
    step: time => { now = time; const pending = [...frames.values()]; frames.clear(); pending.forEach(fn => fn(time)) },
    /* 新宿主：一个外层容器套着带 data-row-key 的祖先行，状态节点挂在包一层 span 里。
       kepler 的 SEL 要求行是状态节点的祖先，不是直接父节点。 */
    nest: (key, markerName = 'span') => {
      const shell = body.appendChild(new Element('div'))
      const host = shell.appendChild(new Element('div', { 'data-row-key': key }))
      const slot = host.appendChild(new Element('div'))
      const state = slot.appendChild(new Element(markerName, { 'data-state': 'warning' }))
      return { shell, host, slot, marker: state }
    },
    /* 测试要模拟的自身图形回声：observer 会看到自己 append 的那枚 svg。 */
    echo: row => record([row.svg ?? row.marker.children.find(el => el.getAttribute('class') === 'uni-kep')]),
    marker,
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

test('K6: one mount syncs once, and a kick does not sync again on the frame it schedules', () => {
  const f = keplerFixture()
  const row = f.add('session:one')
  const dispose = f.mount()
  /* 挂载只该同步一次：kick 自己同步，挂载处不再先来一遍。 */
  assert.equal(f.queries(), 1, 'mount synced more than once')
  f.step(16)
  assert.equal(f.queries(), 1, 'the first frame synced again right after mount')
  /* 外部变更：kick 内同步一次，紧随其后的那一帧不该再同步。 */
  f.mutate(row.host, 'data-row-key')
  assert.equal(f.queries(), 2, 'the observer did not sync inside kick')
  f.step(32)
  assert.equal(f.queries(), 2, 'the frame after a kick synced the document again')
  /* 周期性兜底仍在：第 30 帧无条件同步一次。 */
  for (let i = 3; i <= 30; i += 1) f.step(i * 16)
  assert.equal(f.queries(), 3, 'the periodic fallback sync was lost')
  dispose()
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

/* 状态动效过滤的边界。跑的就是 src/runtime/mutation-records.js 里的生产函数，用例只给它
   最小的节点形状，不重写逻辑。 */
test('M1: only a complete batch of unrelated pure additions may answer false', () => {
  const helper = vm.runInNewContext(
    upTo('src/runtime/mutation-records.js') + read('src/runtime/mutation-records.js') + '\n;({ uniStatusMutationTouches })', {}).uniStatusMutationTouches
  const SEL = "svg[data-state='ongoing']"
  const self = { nodeType: 1, matches: s => s === SEL, querySelector: () => null }
  const subtree = { nodeType: 1, matches: () => false, querySelector: s => (s === SEL ? self : null) }
  const miss = { nodeType: 1, matches: () => false, querySelector: () => null }
  const text = { nodeType: 3, data: 'hello' }
  const comment = { nodeType: 8, data: 'n' }
  const bag = nodes => Object.assign(nodes.slice(), { item: i => nodes[i] ?? null })
  const add = (added, removed = []) => ({ type: 'childList', addedNodes: bag(added), removedNodes: bag(removed) })
  const attr = { type: 'attributes', attributeName: 'data-state', addedNodes: bag([]), removedNodes: bag([]) }
  for (const [label, records, want] of [
    ['unrelated element', [add([miss])], false],
    ['unrelated text', [add([text])], false],
    ['unrelated comment', [add([comment])], false],
    ['several unrelated records', [add([miss]), add([text]), add([comment])], false],
    ['own match', [add([self])], true],
    ['descendant match', [add([subtree])], true],
    ['attribute record', [attr], true],
    ['attribute amid unrelated additions', [add([miss]), attr], true],
    ['a removal', [add([], [miss])], true],
    ['a removal in a later record', [add([miss]), add([], [text])], true],
    ['relevant record at the tail', [add([miss]), add([text]), add([self])], true],
    ['missing addedNodes', [{ type: 'childList', removedNodes: bag([]) }], true],
    ['missing removedNodes', [{ type: 'childList', addedNodes: bag([miss]) }], true],
    ['missing type', [{ addedNodes: bag([miss]), removedNodes: bag([]) }], true],
    ['null records', null, true],
    /* 节点袋的 item() 不是函数时保守路径会抛错；只校验它不返回 false。真浏览器节点袋
       由 DOM 保证 item() 存在。 */
    ['a bag whose item() is missing', [{ type: 'childList', addedNodes: Object.assign([miss], { item: undefined }), removedNodes: Object.assign([], { item: undefined }) }], 'throws'],
  ]) {
    let answer
    try { answer = helper(records, SEL) } catch (e) { answer = 'throws' }
    assert.equal(answer, want, label)
  }
  /* 形状异常的批次单独跑：它们可能抛错，不该掩盖前面对照表的结论。 */
  for (const [label, records] of [
    ['empty batch', []],
    ['empty childList', [add([])]],
    ['null addition', [add([miss, null])]],
    ['unknown node type', [add([{ nodeType: 11, childNodes: [], children: [] }])]],
  ]) {
    let answer
    try { answer = helper(records, SEL) } catch (e) { answer = true }
    assert.equal(answer, true, label)
  }
  /* 自身命中先于子树搜索：短路顺序是契约的一部分。 */
  const order = []
  const short = { nodeType: 1, matches: () => { order.push('matches'); return true }, querySelector: () => { order.push('querySelector'); return null } }
  assert.equal(helper([add([short])], SEL), true)
  assert.deepEqual(order, ['matches'])
})

test('A19: the accretion scan runs once per change batch, not per record, and stays conservative at the edges', () => {
  const f = accretionFixture()
  const row = f.add('session:parent')
  const dispose = f.mount()
  f.step(16)
  const scans = f.scans.total
  /* 一条无关记录 + 一条相关记录：按整批逐条检查，不能因为第一条无关就整批跳过。 */
  f.mutate(row.host, null, [f.make('div', {}), row.svg, f.make('p', {})])
  assert.equal(f.scans.total, scans + 1, 'a related record behind an unrelated one must still sync once')
  /* 新包装节点里带一条真实状态节点：包装自身不命中，后代命中，必须同步一次。 */
  const holder = f.add('session:wrapped')
  const pack = f.make('div', {})
  const inner = pack.appendChild(f.make('svg', { 'data-state': 'ongoing' }))
  holder.host.appendChild(pack)
  f.mutate(holder.host, null, [pack])
  assert.equal(f.scans.total, scans + 2, 'a wrapped state node did not sync')
  assert.ok(f.group({ svg: inner }), 'the new wrapped state node never got its band')
  /* data-state 原地变化是属性记录：一律相关。 */
  inner.setAttribute('data-state', 'done')
  f.mutate(inner, 'data-state')
  assert.equal(f.scans.total, scans + 3, 'an in-place data-state change did not sync')
  /* 跨宿主动 ->key 变化 -> 虚拟行复用，全部走属性与删除，必须同步。 */
  const other = f.add('session:other')
  f.move(row, other)
  f.mutate(row.host, 'data-row-key')
  const moved = f.scans.total
  f.replace(row)
  f.mutate(row.host, null, [f.make('div', {})])
  assert.ok(f.scans.total >= moved, 'reparented rows stopped syncing')
  dispose()
})

test('K8: unrelated batches skip the scan, while ancestors, wrappers and removals still sync', () => {
  const f = keplerFixture()
  const row = f.nest('session:deep')
  const dispose = f.mount()
  assert.equal(f.queries(), 1)
  /* 无关纯新增：自身与子树都不命中 SEL，不扫描、不再唤醒 RAF。 */
  const wrapper = f.make('div', {})
  wrapper.appendChild(f.text('x'))
  f.mutate(row.slot, null, [wrapper])
  assert.equal(f.queries(), 1, 'an unrelated batch paid a document scan')
  /* 真正的状态节点挂在两层包装里，靠祖先链上的 session 行命中：必须同步。 */
  const box = row.slot.appendChild(f.make('div', {}))
  const state = box.appendChild(f.make('span', { 'data-state': 'warning' }))
  f.mutate(row.slot, null, [box])
  assert.equal(f.queries(), 2, 'an ancestor-chain match did not sync')
  assert.ok(f.svg({ marker: state }), 'the orbit was not mounted for the nested marker')
  /* 自身图形回声：uni-kep 的 svg 自己不命中 SEL，可以跳过。 */
  const echo = f.svg({ marker: state })
  f.mutate(state, null, [echo])
  assert.equal(f.queries(), 2, 'an echo of its own graphics was scanned')
  /* 删除整个 svg.uni-kep：同步方式不变，批次里有删除就必须同步一次；同步只认图形根的
     挂载关系（既有限制），所以这里只断言扫描发生。 */
  state.removeChild(echo)
  f.mutate(state, null, [f.text('x')], [echo])
  assert.equal(f.queries(), 3, 'a batch carrying a removal did not sync')
  dispose()
  /* dispose 之后排队的回调不复活：观察器已断开，回调也不再扫描。 */
  const after = f.queries()
  for (const observer of f.observers) if (!observer.disconnected) observer.fn([{ type: 'childList', addedNodes: [], removedNodes: [] }])
  assert.equal(f.queries(), after)
})

test('S10: the shared added/removed-node test answers exactly as its two copies did', () => {
  /* Boundary cases the two former inline copies classified identically, now answered
     by one function: a node that IS the target, a node that merely CONTAINS one, a
     removal, an empty batch, a record missing a bag, and a node that matches neither. */
  const api = vm.runInNewContext(upTo('src/runtime/mutation-records.js') + read('src/runtime/mutation-records.js') + '\n;({uniMutationTouches})', {})
  const hit = { matches: sel => sel === '.hit', querySelector: () => null }
  const parent = { matches: () => false, querySelector: sel => (sel === '.hit' ? hit : null) }
  const miss = { matches: () => false, querySelector: () => null }
  const batch = (added, removed) => [{ addedNodes: added, removedNodes: removed }]
  assert.equal(api.uniMutationTouches(batch([hit], []), '.hit'), true, 'self match')
  assert.equal(api.uniMutationTouches(batch([parent], []), '.hit'), true, 'descendant match')
  assert.equal(api.uniMutationTouches(batch([], [hit]), '.hit'), true, 'removal counts')
  assert.equal(api.uniMutationTouches(batch([miss], [miss]), '.hit'), false, 'unrelated nodes')
  assert.equal(api.uniMutationTouches([], '.hit'), false, 'empty batch')
  assert.equal(api.uniMutationTouches([{ addedNodes: [null, miss] }], '.hit'), false, 'missing bag and null node')
  /* Short-circuit order: the node's own matches is asked before its descendants, so a
     self-match never pays for a subtree query. */
  const order = []
  api.uniMutationTouches(batch([{ matches: () => { order.push('matches'); return true }, querySelector: () => { order.push('querySelector'); return null } }], []), '.hit')
  assert.deepEqual(order, ['matches'])
})

/* ---------------------------------------------------------------------------
   2026-11-02: the composer's typed state and the brand row's three zones moved
   out of src/client.js into their own factory inputs. These tests drive the
   extracted mounts through the effect the client still registers, which is the
   only thing that proves the entry, the label and the deferral survived.
   --------------------------------------------------------------------------- */

function composerFixture() {
  const listeners = new Map()
  const frames = new Map()
  const writes = []
  const cards = []
  const timers = []
  let next = 1
  function node(initial, editorText) {
    let editor = editorText === undefined ? undefined : { textContent: editorText }
    const attrs = new Map()
    return {
      attrs,
      setText(text) { editor = text === null ? undefined : { textContent: text } },
      querySelector(selector) {
        if (selector === '[data-composer-input]') return editor ?? null
        if (selector === "[role='textbox']") return editor ?? null
        return null
      },
      getAttribute(name) { return attrs.has(name) ? attrs.get(name) : null },
      setAttribute(name, value) { writes.push([name, value]); attrs.set(name, value) },
      removeAttribute(name) { writes.push([name, undefined]); attrs.delete(name) },
    }
  }
  const document = {
    querySelectorAll(selector) { return selector === '[data-composer-card]' ? cards : [] },
    addEventListener(name, fn, capture) { listeners.set(name, { fn, capture }) },
    removeEventListener(name, fn, capture) { if (listeners.get(name)?.fn === fn && capture) listeners.delete(name) },
  }
  function mount() {
    /* Through effectRunner, not a bare apply(): apply() returns early when the theme
       service is missing, so a fixture that stubs get() with undefined registers
       nothing and would test an empty effect map. The effect install is deferred. */
    const inst = effectRunner('universe: composer typed state', {
      document, KeyboardEvent: function () {},
      setTimeout(fn) { timers.push(fn); return timers.length }, clearTimeout() {},
      requestIdleCallback: undefined, cancelIdleCallback: undefined,
      requestAnimationFrame(fn) { const id = next++; frames.set(id, fn); return id },
      cancelAnimationFrame(id) { frames.delete(id) },
    })
    /* Installed synchronously here, so the sync inside it and the listener
       registrations are both visible before any event is fired. The install is
       deferred, so the timeout it arms has to be run before the assertions. */
    const dispose = inst()
    assert.equal(timers.length, 1, 'the deferred install no longer arms its timeout fallback')
    timers.shift()()
    assert.deepEqual([...listeners.keys()].sort(), ['focusin', 'focusout', 'input'])
    for (const [name, entry] of listeners) assert.equal(entry.capture, true, name + ' lost capture')
    return dispose
  }
  return {
    mount, listeners, frames, writes, cards, node,
    step() { const pending = [...frames.values()]; frames.clear(); pending.forEach(fn => fn(0)) },
  }
}

test('C1: the composer mount syncs once on install, then coalesces events into one frame', () => {
  const f = composerFixture()
  const card = f.node('', '')
  f.cards.push(card)
  const dispose = f.mount()
  /* Mounted synchronously inside the deferred task: an empty card gets no attribute. */
  assert.equal(f.writes.length, 0)
  assert.equal(card.getAttribute('data-uni-composer-typed'), null)
  /* Three events in one turn share one frame; a real character writes 'true' once. */
  card.setText('hi')
  f.listeners.get('input').fn()
  f.listeners.get('focusin').fn()
  f.listeners.get('focusout').fn()
  assert.equal(f.frames.size, 1, 'three events in one turn must share one frame')
  f.step()
  assert.deepEqual(f.writes, [['data-uni-composer-typed', 'true']])
  f.listeners.get('input').fn(); f.step()
  assert.equal(f.writes.length, 1, 'an unchanged answer wrote the attribute again')
  /* Zero-width marks and ASCII whitespace still read as empty. */
  card.setText('\u200b\u200c\u200d\ufeff \t\n\r')
  f.listeners.get('input').fn(); f.step()
  assert.deepEqual(f.writes.at(-1), ['data-uni-composer-typed', undefined], 'zero-width text kept the typed state')
  assert.equal(card.getAttribute('data-uni-composer-typed'), null)
  /* A card with no editor at all is empty, not an error. */
  f.cards.push(f.node('ignored'))
  f.listeners.get('input').fn(); f.step()
  assert.equal(f.writes.length, 2, 'a card with no editor must not write')
  dispose()
  assert.equal(f.listeners.size, 0, 'listeners outlived disposal')
  assert.equal(f.frames.size, 0)
})

test('C2: both extracted effects are still deferred, and disposal cancels the pending install', () => {
  for (const label of ['universe: brand row zones', 'universe: composer typed state']) {
    const listeners = new Map()
    let scheduled = 0, cleared = 0
    const document = {
      querySelectorAll: () => [], documentElement: { dataset: {} }, activeElement: null, body: {},
      addEventListener(name, fn) { listeners.set(name, fn) },
      removeEventListener(name, fn) { if (listeners.get(name) === fn) listeners.delete(name) },
      dispatchEvent() {},
    }
    const effects = new Map()
    const context = { get: () => ({}), inject() {}, effect(fn, name) { effects.set(name, fn) } }
    const exports = vm.runInNewContext(`(function () { var module = {exports:{}}; var exports = module.exports; ${clientSource()} })()`, {
      PLUGIN_ID: 'dsh-quasar-theme', TOKENS: {}, MANIFEST: {}, document, KeyboardEvent: function () {},
      requestIdleCallback: () => 1, cancelIdleCallback() {},
      setTimeout() { scheduled++; return scheduled }, clearTimeout() { cleared++ },
      requestAnimationFrame: () => 1, cancelAnimationFrame() {},
    })
    exports.apply(context)
    const dispose = effects.get(label)()
    assert.equal(listeners.size, 0, label + ' installed before the deferred task ran')
    assert.equal(scheduled, 1, label + ' did not defer through a timer')
    dispose()
    assert.equal(cleared, 1, label + ' left its deferred timer behind')
    assert.equal(listeners.size, 0, label + ' installed after disposal')
  }
})

function brandFixture(invoke) {
  const listeners = new Map()
  const clicks = []
  const dispatched = []
  const boxes = new Map()
  const found = new Map()
  function buttonFor(row) {
    const name = { getBoundingClientRect: () => ({ right: boxes.get(row).name }) }
    const mark = row.marked ? { getBoundingClientRect: () => ({ right: boxes.get(row).mark }) } : null
    return {
      querySelector(selector) {
        if (selector === "[data-slot='sidebar.brand.name']") return name
        if (selector === "[data-slot='sidebar.brand.mark']") return mark
        return null
      },
    }
  }
  const document = {
    documentElement: { dataset: {} }, activeElement: null,
    querySelectorAll: () => [],
    querySelector(selector) { return found.has(selector) ? found.get(selector) : null },
    addEventListener(name, fn, capture) { listeners.set(name, { fn, capture }) },
    removeEventListener(name, fn, capture) { if (listeners.get(name)?.fn === fn && capture) listeners.delete(name) },
    dispatchEvent(event) { dispatched.push(event) },
  }
  const effects = new Map()
  const bindings = {
    get(id) { return id === 'shortcuts' && invoke ? { registry: { invoke } } : {} },
    inject() {}, effect(fn, name) { effects.set(name, fn) },
  }
  const idles = []
  const exports = vm.runInNewContext(`(function () { var module = {exports:{}}; var exports = module.exports; ${clientSource()} })()`, {
    PLUGIN_ID: 'dsh-quasar-theme', TOKENS: {}, MANIFEST: {}, document,
    KeyboardEvent: function (type, init) { this.init = init },
    setTimeout: () => 1, clearTimeout() {},
    requestIdleCallback(fn) { idles.push(fn); return 1 }, cancelIdleCallback() {},
  })
  exports.apply(bindings)

  return {
    document, listeners, boxes, found, clicks, dispatched, effects,
    buttonFor,
    /* The brand listener is installed by a deferred effect. Its install is run here
       synchronously, so a click can be fired without a frame loop. */
    mount() {
      const dispose = effects.get('universe: brand row zones')()
      idles.shift()()
      return dispose
    },
    click(row, event) {
      const target = event.target === undefined ? { closest: () => buttonFor(row) } : event.target
      listeners.get('click').fn({ button: 0, detail: 1, stopPropagation() {}, preventDefault() {}, ...event, target })
    },
  }
}

test('B1: the three brand zones route to their own surface and every other click falls through', () => {
  const f = brandFixture()
  const row = { marked: true }
  f.boxes.set(row, { mark: 40, name: 100 })
  const panelRow = { click() { f.clicks.push('panel') } }
  const launcher = { click() { f.clicks.push('settings') } }
  const PANEL = "[data-slot='sidebar'] > div > nav[aria-label] > button:has([data-slot='sidebar.panellist'])[aria-label='插件'], [data-slot='sidebar'] > div > nav[aria-label] > button:has([data-slot='sidebar.panellist'])[aria-label='Plugins']"
  f.found.set(PANEL, panelRow)
  f.found.set("[data-slot='settings.launcher'] > button", launcher)
  const dispose = f.mount()
  const stopped = []
  const event = x => ({ clientX: x, stopPropagation() { stopped.push(x) }, preventDefault() {} })
  f.click(row, event(10)); f.click(row, event(70)); f.click(row, event(140))
  assert.deepEqual(f.clicks, ['panel', 'settings'])
  /* The middle zone is nobody's: the official new session keeps it, nothing is stopped. */
  assert.deepEqual(stopped, [10, 140])
  /* A keyboard activation carries no coordinates and is never intercepted. */
  f.click(row, { clientX: 10, detail: 0 })
  assert.deepEqual(stopped, [10, 140])
  /* A modified click belongs to the browser. */
  f.click(row, { clientX: 10, ctrlKey: true })
  assert.deepEqual(stopped, [10, 140])
  /* A brand button with no own mark has no plugins zone. */
  const bare = { marked: false }
  f.boxes.set(bare, { mark: 40, name: 100 })
  f.click(bare, event(10))
  assert.deepEqual(stopped, [10, 140])
  /* An event with no node at all is not a brand click; it must not throw. */
  f.click(row, { clientX: 10, target: null })
  assert.deepEqual(stopped, [10, 140])
  /* The two boundaries themselves: mark.right is still plugins (strict <), name.right
     is already settings (>=), and everything strictly between belongs to the official
     New session. */
  f.click(row, event(40)); f.click(row, event(99))
  assert.deepEqual(f.clicks, ['panel', 'settings'])
  assert.deepEqual(stopped, [10, 140])
  f.click(row, event(100))
  assert.deepEqual(f.clicks, ['panel', 'settings', 'settings'])
  assert.deepEqual(stopped, [10, 140, 100])
  /* A right-button click never reaches the router, whatever the coordinates. */
  f.click(row, { ...event(10), button: 2 })
  assert.deepEqual(stopped, [10, 140, 100])
  dispose()
  assert.equal(f.listeners.size, 0)
})

test('B2: settings falls back from the launcher button to invoke(), then to one chord', () => {
  const row = { marked: true }
  const f = brandFixture((id, context) => { f.calls.push([id, context.modal, context.region]); throw Error('no') })
  f.calls = []
  f.boxes.set(row, { mark: 40, name: 100 })
  const dispose = f.mount()
  const event = { clientX: 140, stopPropagation() {}, preventDefault() {} }
  f.click(row, event)
  /* No launcher: the registry is asked first; it throws, so the chord is the last door. */
  assert.deepEqual(f.calls, [['settings.open', null, 'page']])
  assert.equal(f.dispatched.length, 1)
  /* The web build (no platform attribute) binds Ctrl+Alt+, -- one chord, not two. */
  assert.equal(f.dispatched[0].init.altKey, true)
  f.document.documentElement.dataset.platform = 'desktop'
  f.click(row, event)
  assert.equal(f.dispatched.at(-1).init.altKey, false)
  assert.equal(f.dispatched.length, 2)
  assert.equal(f.dispatched.every(e => e.init.ctrlKey === true && e.init.key === ','), true)
  dispose()

  /* The launcher wins when it is there, and no chord is sent. */
  const g = brandFixture(() => { g.clicks.push('invoke') })
  g.boxes.set(row, { mark: 40, name: 100 })
  g.found.set("[data-slot='settings.launcher'] > button", { click() { g.clicks.push('settings') } })
  const disposeG = g.mount()
  g.click(row, event)
  assert.deepEqual(g.clicks, ['settings'])
  assert.equal(g.dispatched.length, 0)
  disposeG()

  /* A missing plugin row is not intercepted, so the click still reaches the official handler. */
  const h = brandFixture(null)
  h.boxes.set(row, { mark: 40, name: 100 })
  const stopped = []
  const disposeH = h.mount()
  h.click(row, { clientX: 10, stopPropagation() { stopped.push('x') }, preventDefault() {} })
  assert.deepEqual(stopped, [])
  disposeH()
})

/* ---------------------------------------------------------------- glass / lens */

/* The shipped glass.js/lens.js runs inside a vm sandbox and a ResizeObserver batch is
   delivered straight into the instance it registered. Everything the sandbox can reach
   -- the element list, the box, the two record arrays -- is created here and only ever
   mutated in place: the sandbox keeps the instance it saw at mount time, so replacing
   an array or an element property from the host would never be observed. */
function glassFixture({ guideCount = 1, composer = false } = {}) {
  const reads = []
  const attributes = []
  const box = { width: 200, height: 40 }
  const guide = []
  for (let i = 0; i < guideCount; i += 1) guide.push({ style: { filter: 'url(#uni-lg-guide)' } })
  const input = composer ? [{ style: { filter: 'url(#uni-lg-input)' } }] : []
  for (const el of [...guide, ...input]) {
    el.getBoundingClientRect = () => { reads.push(el); return { width: box.width, height: box.height } }
  }
  /* id 记的是 filter 的 id；tag.key 记的是写入的属性名；value 是写进去的那串字符，
     所以 data:image/svg+xml 的位移图本身也在比对范围里。 */
  const makeNode = (ns, tag, id) => ({
    tag,
    id,
    setAttribute(key, value) { attributes.push([id === undefined ? tag : id, key, String(value)]) },
    getAttribute() { return null },
    appendChild() {},
    remove() {},
  })
  const resizes = []
  const context = {
    document: {
      body: { appendChild() {} },
      createElementNS: (ns, tag, id) => makeNode(ns, tag, id),
      querySelectorAll(selector) {
        if (selector === '[data-sidebar-right-guide-entry]') return guide
        if (selector === '[data-composer-card]') return input
        return []
      },
    },
    window: { requestAnimationFrame() { return 1 }, cancelAnimationFrame() {} },
    MutationObserver: class { constructor() {} observe() {} disconnect() {} },
    ResizeObserver: class { constructor(fn) { resizes.push(fn) } observe() {} unobserve() {} disconnect() {} },
  }
  const dispose = vm.runInNewContext(upTo('src/runtime/glass.js') + withFilterIds(read('src/runtime/glass.js')) + '\nmountLiquidGlass()', context)
  const reset = () => { reads.length = 0; attributes.length = 0 }
  const setBox = (width, height) => { box.width = width; box.height = height }
  const batch = targets => targets.map(target => ({ target }))
  return { guide, input, resizes, reset, setBox, batch, reads, attributes, dispose }
}

/* The double cannot know which <filter> it is building; the test prefix supplies that id
   to createElementNS without touching the shipped logic. The map node inherits it too,
   so a recorded attribute says which filter owns the write and which state drew it. */
function withFilterIds(source) {
  return source
    .replace('var filter = document.createElementNS(NS, \'filter\')', 'var filter = document.createElementNS(NS, \'filter\', target.id)')
    .replace('var image = document.createElementNS(NS, \'feImage\')', 'var image = document.createElementNS(NS, \'feImage\', target.id + \':map\')')
}

function lensFixture({ both = false } = {}) {
  const reads = []
  const attributes = []
  const images = []
  const box = { width: 200, height: 32 }
  const row = { style: { filter: 'url(#uni-lens-row)' } }
  const send = { style: { filter: 'url(#uni-lens-send)' } }
  for (const el of [row, send]) el.getBoundingClientRect = () => { reads.push(el); return { width: box.width, height: box.height } }
  const makeNode = (ns, tag, id) => ({
    tag,
    id,
    setAttribute(key, value) { attributes.push([id === undefined ? tag : id, key, String(value)]) },
    getAttribute() { return null },
    appendChild() {},
    remove() {},
  })
  const resizes = []
  const context = {
    document: {
      body: { appendChild() {} },
      createElementNS: (ns, tag, id) => makeNode(ns, tag, id),
      createElement: () => {
        const canvas = {
          width: 0,
          height: 0,
          toDataURL() { return 'data:image/png;base64,canvas-' + canvas.width + 'x' + canvas.height },
          getContext: () => ({
            createImageData: (w, h) => ({ width: w, height: h, data: new Array(w * h * 4).fill(0) }),
            /* 记下真正被 putImageData 的尺寸与 RGBA，不靠恒定字符串冒充位移图。 */
            putImageData(data) {
              images.push({ width: data.width, height: data.height, data: Array.from(data.data) })
            },
          }),
        }
        return canvas
      },
      querySelectorAll(selector) {
        if (selector === '[data-row-key^="session:"]') return both ? [row, send] : [row]
        if (selector.indexOf('button[aria-label') === 0) return both ? [row, send] : [send]
        return []
      },
    },
    window: { requestAnimationFrame() { return 1 }, cancelAnimationFrame() {} },
    MutationObserver: class { constructor() {} observe() {} disconnect() {} },
    ResizeObserver: class { constructor(fn) { resizes.push(fn) } observe() {} unobserve() {} disconnect() {} },
  }
  const dispose = vm.runInNewContext(upTo('src/runtime/lens.js') + read('src/runtime/lens.js') + '\nmountHoverLens()', context)
  const reset = () => { reads.length = 0; attributes.length = 0; images.length = 0 }
  const setBox = (width, height) => { box.width = width; box.height = height }
  const batch = targets => targets.map(target => ({ target }))
  return { row, send, resizes, reset, setBox, batch, reads, attributes, images, dispose }
}

test('G5: a non-first element still drives the state, and the batch order is kept', () => {
  const f = glassFixture({ guideCount: 3 })
  f.setBox(260, 60)
  f.reset()
  f.resizes[0](f.batch([f.guide[2]]))
  assert.deepEqual(f.reads, [f.guide[0]], 'a notification for a non-first element must still read the geometry source')
  assert.ok(f.attributes.some(([id, key]) => id === 'uni-lg-guide:map' && key === 'href'), 'the shared map must be redrawn')

  /* 下一批仍是同一尺寸：几何照读一次，滤镜重写为零。 */
  f.reset()
  f.resizes[0](f.batch([f.guide[0], f.guide[2]]))
  assert.deepEqual(f.reads, [f.guide[0]], 'a later matching batch still reads the geometry once')
  assert.equal(f.attributes.length, 0, 'an unchanged size must rewrite no filter attribute')

  f.setBox(300, 60)
  f.reset()
  f.resizes[0](f.batch([f.guide[1], f.guide[0], f.guide[2]]))
  assert.deepEqual(f.reads, [f.guide[0]], 'the first matching entry draws the state, the rest are skipped')
  const xWrites = f.attributes.filter(([id, key]) => id === 'uni-lg-guide' && key === 'x')
  assert.equal(xWrites.length, 1, 'the filter must be rewritten exactly once for the batch')

  f.resizes[0]([])
  f.resizes[0](f.batch([{ style: {} }]))
  const afterJunk = { reads: f.reads.length, attributes: f.attributes.length }
  assert.equal(afterJunk.reads, 1, 'empty and unrelated batches must not read geometry')
  assert.equal(afterJunk.attributes, f.attributes.length, 'empty and unrelated batches must not write')

  f.reset()
  f.dispose()
  f.resizes[0](f.batch([f.guide[0]]))
  assert.equal(f.reads.length, 0, 'a late delivery after disposal must not read geometry')
  assert.equal(f.attributes.length, 0, 'a late delivery after disposal must not write attributes')
})

test('G3: one element matching two states is handled once per state, in first-hit order', () => {
  const f = glassFixture({ guideCount: 1, composer: true })
  const shared = f.guide[0]
  f.setBox(240, 60)
  f.reset()
  f.resizes[0](f.batch([shared, f.input[0], shared]))
  /* guide 与 input 是两个 state，各自从 els[0] 读几何；第一批里共享元素的 entry 先到，
     所以 guide 先画，input 随后用自己的元素再读一次——两边都只处理一次。 */
  assert.deepEqual(f.reads, [shared, f.input[0]], 'each state reads its own els[0] once for the batch')
  assert.deepEqual(
    f.attributes.filter(([, key]) => key === 'x').map(([id]) => id),
    ['uni-lg-guide', 'uni-lg-input'],
    'each state writes its own filter once, in the order its first entry appears',
  )
  assert.deepEqual(
    [...new Set(f.attributes.filter(([id]) => id.indexOf(':map') === -1).map(([id]) => id))],
    ['uni-lg-guide', 'uni-lg-input'],
    'no state may write the other one\'s filter',
  )
})

test('G4: a duplicated batch writes the same filter attributes and map as a single delivery', () => {
  const run = targets => {
    const f = glassFixture({ guideCount: 2 })
    f.setBox(260, 40)
    f.reset()
    f.resizes[0](f.batch(targets(f)))
    const written = f.attributes.map(entry => entry.slice())
    /* 跨 fixture 的元素身份不同，比较的是"读了几个、是不是同一张图的几何来源"，
       不是对象同一性。 */
    const read = f.reads.map(el => f.guide.indexOf(el))
    f.dispose()
    return { written, read }
  }
  const single = run(f => [f.guide[0]])
  const duplicated = run(f => [f.guide[0], f.guide[1], f.guide[0]])
  assert.ok(single.written.length > 0, 'the fixture must actually write something')
  const href = single.written.find(([, key]) => key === 'href')
  assert.ok(href && href[2].indexOf('data:image/svg+xml') === 0 && href[2].length > 500,
    'the single delivery must have built a real displacement map, not a placeholder')
  assert.deepEqual(duplicated.written, single.written, 'the redundant entries changed a filter attribute or the map')
  assert.deepEqual(duplicated.read, single.read, 'the redundant entries changed how often els[0] was read')
  assert.deepEqual(single.read, [0], 'the single delivery reads els[0] once')
})

test('L1: lens draws one map per state per batch and keeps its geometry source', () => {
  const f = lensFixture()
  assert.equal(f.resizes.length, 1, 'lens must register exactly one ResizeObserver')
  f.setBox(240, 32)
  f.reset()
  f.resizes[0](f.batch([f.row, f.row, f.row]))
  assert.deepEqual(f.reads, [f.row], 'a duplicated batch must read the geometry source once')
  assert.equal(f.images.length, 1, 'and put one displacement map')

  /* 下一批匹配但仍然同尺寸：读一次几何，位移图与滤镜都不重建。 */
  f.reset()
  f.resizes[0](f.batch([f.row, f.row]))
  assert.deepEqual(f.reads, [f.row], 'a later matching batch still reads the geometry once')
  assert.equal(f.images.length, 0, 'an unchanged size must not rebuild the map')
  assert.equal(f.attributes.length, 0, 'an unchanged size must rewrite no filter attribute')

  f.setBox(300, 32)
  f.reset()
  f.resizes[0](f.batch([f.send, f.row, f.send]))
  assert.deepEqual(f.reads, [f.send, f.row], 'both states once each, in first-hit order')
  assert.equal(f.images.length, 2, 'both maps must be rebuilt')
})

test('L2: lens keeps skipping unrelated batches and late deliveries, and drops the repeated map', () => {
  const f = lensFixture()
  f.setBox(280, 40)
  f.reset()
  f.resizes[0](f.batch([f.row, f.row]))
  const once = f.images.length

  f.setBox(320, 40)
  f.reset()
  f.resizes[0](f.batch([{ style: {} }]))
  assert.equal(f.reads.length, 0, 'an unrelated batch must not read geometry')
  assert.equal(f.images.length, 0, 'an unrelated batch must not rebuild the map')

  f.reset()
  f.dispose()
  f.resizes[0](f.batch([f.row]))
  assert.equal(f.reads.length, 0, 'a late delivery after disposal must not read geometry')
  assert.equal(f.images.length, 0, 'a late delivery after disposal must not write a map')
  assert.equal(once, 1, 'a duplicated batch inside one delivery must still put exactly one map')
})

test('L3: one element matching two states gets one map each, with the region and scale of its own state', () => {
  const f = lensFixture({ both: true })
  f.setBox(200, 40)
  f.reset()
  f.resizes[0](f.batch([f.row, f.send, f.row]))
  /* both 模式下两个 state 的匹配集合都是 [row, send]，els[0] 同为 row：同一批里两个
     state 各画一次，各自从 els[0] 读一次几何（各自的状态槽，不去重跨 state），顺序按
     各自首次命中决定（row 先到，uni-lens-row 先画）。 */
  assert.deepEqual(f.reads, [f.row, f.row], 'each state reads its own geometry once, from the shared els[0]')
  const hrefs = f.attributes.filter(([, key]) => key === 'href').map(([tag, , value]) => tag + ' ' + value)
  assert.equal(hrefs.length, 2, 'each state must write one map')
  /* peak = max(2, min(10, round(min(w, h) * 0.15 * 100) / 100)) with w=200, h=40 -> 6 */
  const peak = 6
  const scales = f.attributes.filter(([, key]) => key === 'scale').map(([, , value]) => value)
  assert.deepEqual(scales, [String(2 * peak), String(2 * peak)], 'each state sets the displacement scale from its own geometry')
  const widths = f.attributes.filter(([, key]) => key === 'width').map(([tag, , value]) => value)
  assert.deepEqual(widths, ['106%', '106%'], 'each filter region is one peak wider on both sides')
  assert.equal(f.images.length, 2, 'both states put their own map')
  assert.deepEqual(f.images.map(image => image.width), [200 + 2 * peak, 200 + 2 * peak])
  assert.deepEqual(f.images.map(image => image.height), [40 + 2 * peak, 40 + 2 * peak])
})

test('L4: a duplicated delivery leaves the same map bytes, region and scale as a single one', () => {
  const run = targets => {
    const f = lensFixture()
    f.setBox(240, 40)
    f.reset()
    f.resizes[0](f.batch(targets(f)))
    const written = f.attributes.map(entry => entry.slice())
    const images = f.images.map(image => image.slice ? image : image)
    f.dispose()
    return { written, images: images.map(image => ({ width: image.width, height: image.height, data: image.data.slice() })) }
  }
  const single = run(f => [f.row])
  const duplicated = run(f => [f.row, f.row, f.row])
  assert.equal(single.images.length, 1, 'the single delivery must put exactly one map')
  const data = single.images[0].data
  assert.equal(data.length, single.images[0].width * single.images[0].height * 4, 'the map must carry one RGBA per pixel')
  assert.ok(new Set(data).size > 3, 'the map must vary, not be a constant fill')
  assert.deepEqual(duplicated.images, single.images, 'the redundant entries changed the image bytes or its size')
  assert.deepEqual(duplicated.written, single.written, 'the redundant entries changed a filter attribute')
})

/* Same fixture shape as keplerFixture, but the shipped kepler.js runs in a sandbox
   whose Number.prototype.toFixed is wrapped, so the count is what the production path
   actually called. The host's Number.prototype is never touched. */
function keplerFixedFixture() {
  let fixed = 0
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
  const descendants = el => el.children.flatMap(child => [child, ...descendants(child)])
  const context = {
    document: {
      body, documentElement: root, createElementNS: (_, name) => new Element(name),
      querySelectorAll: () => descendants(root).filter(el => el.name === 'span' && el.getAttribute('data-state') === 'warning'),
    },
    performance: { now: () => now },
    window: { requestAnimationFrame: fn => { frames.set(++id, fn); return id }, cancelAnimationFrame: n => frames.delete(n) },
    MutationObserver: class { constructor() {} observe() {} disconnect() {} },
  }
  vm.createContext(context)
  vm.runInContext('var native = Number.prototype.toFixed; ' +
    'Number.prototype.toFixed = function (digits) { globalThis.__fixed(digits); return native.call(this, digits) }', context)
  context.__fixed = () => { fixed += 1 }
  const mount = vm.runInContext(upTo('src/runtime/kepler.js') + read('src/runtime/kepler.js') + '\nmountKepler', context)
  const reference = vm.runInNewContext(upTo('src/runtime/kepler.js') + read('src/runtime/kepler.js') + '\n;({ at: uniKeplerAt, period: UNI_KEP_PERIOD })')
  const add = key => {
    const host = body.appendChild(new Element('div', { 'data-row-key': key }))
    return host.appendChild(new Element('span', { 'data-state': 'warning' }))
  }
  const dot = marker => descendants(marker).find(el => el.name === 'circle')
  return {
    mount, add, dot, reference,
    reset: () => { fixed = 0 },
    fixed: () => fixed,
    step: time => { now = time; const pending = [...frames.values()]; frames.clear(); pending.forEach(fn => fn(time)) },
  }
}


test('K7: a dynamic frame formats twice, not twice per row, and every row matches uniKeplerAt', () => {
  const f = keplerFixedFixture()
  const rows = [f.add('session:a'), f.add('session:b'), f.add('session:c'), f.add('session:d')]
  const dispose = f.mount()
  /* Reference: the SAME shipped uniKeplerAt, asked for the phase the frame used. */
  for (const time of [50, 375, 1000, 2599]) {
    f.reset()
    f.step(time)
    assert.equal(f.fixed(), 2, 'a frame with four rows must format x and y once')
    const want = f.reference.at(time / f.reference.period)
    for (const row of rows) {
      assert.equal(f.dot(row).getAttribute('cx'), want.x.toFixed(2), 'cx of a row drifted at ' + time)
      assert.equal(f.dot(row).getAttribute('cy'), want.y.toFixed(2), 'cy of a row drifted at ' + time)
    }
  }

  /* A still frame reuses the static phase, which formats once per phase, not per row. */
  dispose()
  const still = keplerFixedFixture()
  const stillRows = [still.add('session:a'), still.add('session:b')]
  const stopStill = still.mount()
  still.reset()
  still.step(60)
  const formatted = still.fixed()
  for (const row of stillRows) {
    assert.equal(still.dot(row).getAttribute('cx'), still.reference.at(60 / still.reference.period).x.toFixed(2))
  }
  assert.ok(formatted >= 2, 'a still frame still formats its shared phase')
  stopStill()
})

/* ── 输入卡换页转场（第八十一轮）──────────────────────────────────────────────── */
/* 跑生产闭包，不重写一份曲线：mountComposerTransition 的源码直接取
   src/runtime/composer-transition.js，宿主侧只给最小 document / window。 */
function composerSwapFixture() {
  const frames = clocks()
  const observers = []
  let phase = 'hero'
  const root = { getAttribute: name => (name === 'data-phase' ? phase : null) }
  const card = {
    rect: { top: 400, left: 100 },
    plays: [],
    getBoundingClientRect() { return this.rect },
    animate(keys, options) {
      this.plays.push({ keys, options, target: this })
      const animation = {
        onfinish: null,
        oncancel: null,
        cancel() { if (typeof this.oncancel === 'function') this.oncancel() },
      }
      card.animation = animation
      return animation
    },
  }
  /* 生产代码把动画施加在卡片的父节点上：卡片自己带 transform 会形成层叠上下文，
     z-index: -1 的模糊背板会翻到卡面之上（见 composer-transition.js 的 stageOf）。 */
  card.parentElement = {
    animate(keys, options) {
      card.plays.push({ keys, options, target: this })
      const animation = {
        onfinish: null,
        oncancel: null,
        cancel() { if (typeof this.oncancel === 'function') this.oncancel() },
      }
      card.animation = animation
      return animation
    },
  }
  const body = { getAttribute: name => (name === 'data-content-phase' ? phase : null) }
  const document = {
    body,
    querySelector(selector) {
      if (selector === '[data-phase]') return root
      if (selector === '[data-composer-card]') return card
      return null
    },
    addEventListener() {},
    removeEventListener() {},
  }
  class Observer {
    constructor(fn) { this.fn = fn; observers.push(this) }
    observe() {}
    disconnect() {}
    emit() { this.fn([]) }
  }
  const window = {
    requestAnimationFrame: frames.setTimeout,
    cancelAnimationFrame: frames.clearTimeout,
    addEventListener() {},
    removeEventListener() {},
  }
  const Element = { prototype: { animate() {} } }
  const source = read('src/runtime/composer-transition.js')
  const start = source.indexOf('function mountComposerTransition()')
  assert.ok(start > 0, 'production boundary: mountComposerTransition')
  const make = new Function('document', 'window', 'MutationObserver', 'Element',
    source.slice(start) + '\nreturn mountComposerTransition')
  const mount = make(document, window, Observer, Element)
  const dispose = mount()
  const move = (next, top) => {
    phase = next
    card.rect = { top, left: 100 }
    observers.forEach(observer => observer.emit())
    frames.fire()
  }
  /* 真机上一段运镜结束会触发 onfinish，之后的帧才记落点；测试必须补这一步，
     否则反向运镜永远没有起点。 */
  const finish = () => {
    if (typeof card.animation.onfinish === 'function') card.animation.onfinish()
    frames.fire()
  }
  return { card, parent: card.parentElement, move, finish, dispose }
}

test('SW1: hero→active 全量位移、全程可见，只在运镜中点浅呼吸', () => {
  const f = composerSwapFixture()
  f.move('active', 800)
  const play = f.card.plays[0]
  assert.ok(play, '相位切换必须起一段动画')
  assert.equal(play.options.duration, 1000, '与黑洞运镜同长')
  assert.equal(play.keys.length, 13, '12 段关键帧')
  assert.equal(play.keys[0].opacity, 1, '首帧不许从透明起播')
  assert.equal(play.keys[6].opacity, 0.86, '中点浅呼吸')
  assert.equal(play.keys[12].opacity, 1, '落地必须回到可读的实态')
  assert.equal(play.keys[0].transform, 'translate3d(0px, -400px, 0)', '位移取全量差值')
  assert.equal(play.target, f.parent, '动画施加在父节点：卡片自己带 transform 会把模糊背板翻到卡面之上')
  f.dispose()
})

test('SW2: 反向 active→hero 同样运镜，绕过中间相的 active 不从旧位置起飞', () => {
  const back = composerSwapFixture()
  back.move('active', 800)
  back.finish()
  back.card.plays.length = 0
  back.move('hero', 400)
  const play = back.card.plays[0]
  assert.ok(play, '回英雄页也要运镜')
  assert.equal(play.keys[0].transform, 'translate3d(0px, 400px, 0)', '反向位移取反号')
  back.dispose()

  const crossed = composerSwapFixture()
  crossed.move('settling', 400)
  crossed.move('active', 800)
  assert.equal(crossed.card.plays.length, 0, 'settling 之后的 active 不许从过期位置飞来')
  crossed.dispose()
})

test('SW3: 不等上一段收尾就往返，反向仍有起点', () => {
  const f = composerSwapFixture()
  f.move('active', 800)
  f.card.plays.length = 0
  f.move('hero', 400)
  const play = f.card.plays[0]
  assert.ok(play, '1 秒内往返也要反向运镜')
  assert.equal(play.keys[0].transform, 'translate3d(0px, 400px, 0)', '起点取自布局真值，不等 onfinish')
  f.dispose()
})
