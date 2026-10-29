/**
 * 对话页背景（2026-10-29 甲方案定稿）的断言。
 *
 * 定稿：两页共用同一块画布、同一份网格，换页只做一次连续运镜（viewX / brightness /
 * speed），并且取景框固定成整个 frame。用户选甲的理由（m02133 原话「甲，弧就停在现在的
 * 位置就行」）是转场要读作「一次镜头运动」，所以这里最重的两条断言不是「弧在不在」，
 * 而是：
 *   1. 换页期间画布尺寸与格数一个都不许变 —— 变就要重建近两万格子，重建期画布是空的、
 *      CSS 还把 canvas 藏起来，洞会闪一帧，正好闪在转场最显眼的那一帧；
 *   2. viewX 必须单调推到端点、端点精确，亮度与速度一起收 —— 否则位置和透明度各硬切
 *      一次，屏幕上是两次切换。
 *
 * 这里的 fixture 刻意模仿浏览器里影响结果的几处约定：canvas 的 width / height 是缓冲区、
 * getBoundingClientRect 按 CSS 盒模型解算、ctx 的 setTransform 累积成矩阵、fillText 记录
 * 变换生效后的画布坐标。少了这几条，测试判的就只是测试自己的假设。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFileSync, existsSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import { CLIENT_FILES } from './build-contract.mjs'

const HOLE = readFileSync(new URL('../src/runtime/black-hole.js', import.meta.url), 'utf8')
const CLIENT = readFileSync(new URL('../src/client.js', import.meta.url), 'utf8')
const CSS = readFileSync(new URL('../src/theme.css', import.meta.url), 'utf8')
const BUILT_PATH = new URL('../client.js', import.meta.url)
const BUILT = existsSync(BUILT_PATH) ? readFileSync(BUILT_PATH, 'utf8') : ''

/* 视口 1256 × 900；左栏 280，对话列 976，所以对话列中心在 280 + 976 / 2 = 768。
   半径按短边：0.34 × 900 / 2 = 153px。 */
const VIEWPORT = { width: 1256, height: 900 }
const COLUMN_LEFT = 280
const COLUMN_WIDTH = 976
const COLUMN_CENTER = COLUMN_LEFT + COLUMN_WIDTH / 2
const RADIUS = 0.34 * Math.min(VIEWPORT.width, VIEWPORT.height) / 2
/* 对话页只露左半边：洞心正好压在视口右缘，右半出画。
   2026-10-29 用户两次点名：「黑洞在左边会挡住左侧栏的文字，挪到右边」→「只显示左半边黑洞」。 */
const ARC_X = VIEWPORT.width / 2
/* 甲：路径走弧线 + 飞行期盘自转（用户 m02685「向右旋转到达 / 向左旋转放回」）。
   倾角动不得（会整格重建），所以旋转拆成 viewY 起伏与 speed 脉冲两件逐帧的事。
   两个数字要和 src/runtime/black-hole.js 里的 ARC_BOW / ARC_SPIN 一致。 */
const ARC_BOW = 64
const ARC_SPIN = 1.05
/* 两页洞心的横向差：出画时整段位移就是这个数（视口宽 - 对话列中心）。 */
const TRAVEL = VIEWPORT.width - COLUMN_CENTER
/* 运镜时长，要和 src/client.js 的 MOVE_MS 一致；下面的帧时刻都按它推算。 */
const MOVE_MS = 1000
const HERO = "[data-slot='conversation.hero.brand.mark'],[data-slot='conversation.hero.workspace']"

/* 所有绘制字形的包围盒中点就是绘制出来的圆心。 */
function paintedCenter(painted) {
  const xs = painted.map(entry => entry.x)
  return (Math.min(...xs) + Math.max(...xs)) / 2
}

/* 真跑 src/runtime/black-hole.js：取景、运镜、重建都在这里判。 */
function holeFixture({ reduced = false } = {}) {
  let id = 0
  const timers = new Map(), frames = new Map(), listeners = new Map(), attrs = {}, states = []
  const painted = [], arcs = [], anims = []
  const motion = {
    matches: reduced,
    addEventListener: (kind, fn) => listeners.set('motion', fn),
    removeEventListener: () => listeners.delete('motion'),
  }

  let matrix = { a: 1, d: 1, e: 0, f: 0 }
  const stack = []
  const place = (x, y) => ({ x: x * matrix.a + matrix.e, y: y * matrix.d + matrix.f })
  const ctx = {
    fillStyle: '', font: '', textAlign: '', textBaseline: '', globalAlpha: 1, lineWidth: 1,
    save() { stack.push({ ...matrix }) },
    restore() { if (stack.length) matrix = stack.pop() },
    setTransform(a, b, c, d, e, f) {
      if (!Number.isFinite(e) || !Number.isFinite(f)) throw new TypeError('setTransform 收到了非数值')
      matrix = { a, d, e, f }
    },
    clearRect() {}, beginPath() {}, closePath() {}, fill() {}, fillRect() {},
    stroke() {}, moveTo() {}, lineTo() {},
    arc(x, y, r) { arcs.push({ ...place(x, y), r }) },
    fillText(glyph, x, y) { painted.push({ glyph, style: ctx.fillStyle, alpha: ctx.globalAlpha, ...place(x, y) }) },
  }

  const style = {
    setProperty(name, value) { style[name] = value },
    removeProperty(name) { delete style[name] },
  }
  /* 记录每一次 data-black-hole-state：重建会再走一次 building，那就是「闪一帧」。 */
  const dataset = new Proxy({}, {
    set(target, key, value) { if (key === 'blackHoleState') states.push(value); target[key] = value; return true },
  })
  const canvas = {
    dataset, style, width: 0, height: 0, isConnected: true,
    setAttribute(name, value) { canvas[name] = value },
    removeAttribute(name) { delete canvas[name] },
    remove() { canvas.isConnected = false },
    getBoundingClientRect() {
      return {
        left: Number.parseFloat(style.left) || 0,
        top: Number.parseFloat(style.top) || 0,
        width: Number.parseFloat(style.width) || 0,
        height: Number.parseFloat(style.height) || 0,
      }
    },
    getContext: () => ctx,
    /* 合成器动画的替身：位移现在交给 canvas.animate 的关键帧，主线程不再逐帧写 viewX。
       测试不需要真跑动画，只要把关键帧留下来逐条核对。 */
    animate(frames, options) {
      const record = { frames, options, cancelled: false }
      anims.push(record)
      return { cancel() { record.cancelled = true }, finish() {}, finished: Promise.resolve() }
    },
  }
  const column = { getBoundingClientRect: () => ({ left: COLUMN_LEFT, top: 0, width: COLUMN_WIDTH, height: VIEWPORT.height }) }
  const frame = { getBoundingClientRect: () => ({ left: 0, top: 0, width: VIEWPORT.width, height: VIEWPORT.height }) }
  const body = {
    prepend() {},
    setAttribute(name, value) { attrs[name] = value },
    removeAttribute(name) { delete attrs[name] },
  }
  const doc = {
    hidden: false,
    body,
    documentElement: { style: { setProperty() {}, removeProperty() {}, getPropertyValue: () => null } },
    createElement: () => canvas,
    addEventListener: (kind, fn) => listeners.set(kind, fn),
    removeEventListener: kind => listeners.delete(kind),
    querySelector(selector) {
      if (selector === "[data-slot='root'] > * > div:has(> [data-slot='main'])") return column
      if (selector === "[data-slot='main']") return column
      if (selector === "[data-slot='root'] > *") return frame
      return null
    },
  }
  const viewport = {
    devicePixelRatio: 1,
    innerWidth: VIEWPORT.width, innerHeight: VIEWPORT.height,
    matchMedia: () => motion,
    addEventListener: (kind, fn) => listeners.set('window:' + kind, fn),
    removeEventListener: kind => listeners.delete('window:' + kind),
  }

  const context = vm.createContext({
    performance, console, document: doc, window: viewport,
    ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
    IntersectionObserver: class { observe() {} disconnect() {} },
    MutationObserver: class { observe() {} disconnect() {} },
    getComputedStyle: () => ({ colorScheme: 'dark', getPropertyValue: () => '' }),
    setTimeout: fn => { timers.set(++id, fn); return id },
    clearTimeout: key => timers.delete(key),
    requestAnimationFrame: fn => { frames.set(++id, fn); return id },
    cancelAnimationFrame: key => frames.delete(key),
  })
  vm.runInContext(HOLE, context)

  function drain() {
    let count = 0
    while (timers.size) {
      assert.ok(count++ < 4000, '定时器链没有收敛')
      const tasks = [...timers.values()]
      timers.clear()
      tasks.forEach(fn => fn())
    }
  }
  function frameAt(time) {
    const tasks = [...frames.values()]
    frames.clear()
    tasks.forEach(fn => fn(time))
  }
  return { api: context.UniverseBlackHole, canvas, attrs, states, painted, arcs, anims, listeners, frames, frameAt, drain }
}

test('取景框固定成整个 frame：洞心仍落在对话列中心，左栏交给 mask 斜坡隔离', () => {
  const f = holeFixture()
  const dispose = f.api.mount()
  f.drain()
  const hole = f.canvas.__uniBlackHole
  assert.equal(hole.stats().ready, true, '挂载即完成第一次烘焙')

  /* 框钉在视口左缘、整窗宽：换页不改尺寸的前提。 */
  assert.equal(f.canvas.style.left, '0px', '画布左缘钉在视口，不再从对话列左缘开始')
  assert.equal(f.canvas.style.width, VIEWPORT.width + 'px', '画布铺满整窗')
  assert.equal(f.canvas.style.height, VIEWPORT.height + 'px', '高度取 frame 高度')

  /* 画布变宽之后，洞心必须正补偿回对话列中心，而不是躺在整窗中心。 */
  f.frameAt(100)
  const centered = paintedCenter(f.painted)
  assert.ok(Math.abs(centered - COLUMN_CENTER) < 40, `新会话页洞应在对话列中间 ${COLUMN_CENTER}，实际 ${centered}`)
  assert.ok(Math.abs(centered - VIEWPORT.width / 2) > 100, '不是整窗居中：整窗中心在左栏那侧')
  assert.equal(f.canvas.style['--uni-hole-edge'], COLUMN_LEFT + 'px', '斜坡起点压在对话列左缘，洞不进左栏')

  const view = hole.view()
  assert.equal(view.width, VIEWPORT.width, '画布坐标按整窗宽算')
  assert.ok(Math.abs(Number(view.radius) - RADIUS) < 0.01, `半径按短边算，应为 ${RADIUS}`)

  dispose()
})

test('出画取景：圆心出画只剩左半弧，亮度与速度一起收到对话页的值', () => {
  const f = holeFixture()
  const dispose = f.api.mount()
  f.drain()
  const hole = f.canvas.__uniBlackHole
  f.frameAt(100)

  f.painted.length = 0
  f.canvas.__uniArc(true, 0)
  assert.equal(f.attrs['data-uni-sky-mode'], '', '对话页要能被 theme.css 认出来')
  assert.equal(f.canvas.style['--uni-hole-edge'], '0px', '下降坡收到 0：弧在右缘，左栏不再需要隔离')

  const config = hole.stats().config
  assert.ok(Math.abs(config.viewX - ARC_X) < 0.01, `viewX 应为 ${ARC_X}，实际 ${config.viewX}`)
  assert.ok(Math.abs(config.brightness - 0.4) < 1e-9, `亮度要收到 0.4，实际 ${config.brightness}`)
  assert.ok(Math.abs(config.speed - 0.35) < 1e-9, `速度要收到 0.35，实际 ${config.speed}`)

  const view = hole.view()
  assert.ok(Math.abs(view.x - (view.width / 2 + config.viewX)) < 1e-9, 'view() 必须把位移算进圆心')
  /* 半个洞就一种算法：洞心落在右缘这条线上，左边整半个圆可见、右边整半个出画。 */
  assert.ok(Math.abs(view.x - view.width) < 0.01, `洞心要压在视口右缘 ${view.width}，实际 ${view.x}`)
  assert.ok(view.x - Number(view.radius) > view.width / 2, '可见的那半圆要整个留在窗口里，不能被左边裁掉')

  /* 绘制坐标而不是配置：弧贴到窗口右缘，而且一个字形都不许落进左栏 —— 用户 m02420
     的原始抱怨就是「黑洞在左边会挡住左侧栏的文字」，这条断言守的正是它。 */
  f.frameAt(300)
  const xs = f.painted.map(entry => entry.x)
  assert.ok(Math.max(...xs) > VIEWPORT.width - 40, `弧要贴到窗口右缘 ${VIEWPORT.width}，实际最右 ${Math.max(...xs)}`)
  assert.ok(Math.min(...xs) > COLUMN_LEFT, `左栏一个字都不许有，实际最左 ${Math.min(...xs)}`)
  const ys = f.painted.map(entry => entry.y)
  assert.ok(Math.max(...ys) - Math.min(...ys) > 0, '纵向照常铺开')

  /* 露出的是半个圆：字形要铺到半圆左端，而不是只在右缘露一条边。 */
  const visible = f.painted.filter(entry => entry.x >= 0 && entry.x <= view.width)
  assert.ok(visible.length > 200, `可见的那半个洞要有字形，实际 ${visible.length}`)
  const leftmost = Math.min(...visible.map(entry => entry.x))
  assert.ok(leftmost < view.x - Number(view.radius) * 0.5, `半个圆要铺到左端，实际最左 ${leftmost}`)
  /* 镜环高光朝哪一侧由盘的公转方向决定，挪到右缘后朝外（出画那侧），所以只判「高光还在」。 */
  const bright = ['#bb7c40', '#d0904b', '#e3a65c', '#f2bd75', '#ffe0a8']
  const lit = visible.filter(entry => bright.includes(entry.style)).length
  assert.ok(lit >= 3, `可见的弧里要留着镜环高光，实际 ${lit}`)

  f.canvas.__uniSkyModeOff()
  assert.equal(f.attrs['data-uni-sky-mode'], undefined, '回新会话页要撤掉属性')
  const back = hole.view()
  assert.ok(Math.abs(back.x - COLUMN_CENTER) < 0.01, `复位成对话列中心 ${COLUMN_CENTER}，实际 ${back.x}`)
  assert.equal(f.canvas.style['--uni-hole-edge'], COLUMN_LEFT + 'px', '斜坡起点一起复位')

  dispose()
})

test('亮档的盘压成淡影：alpha 收到 0.35，位置与几何一个字都不动', () => {
  const f = holeFixture()
  const dispose = f.api.mount()
  f.drain()
  const hole = f.canvas.__uniBlackHole

  /* 暗档先量一遍：深蓝底上没有压字问题，盘的墨必须原样（alpha 1）。 */
  hole.setMode('dark')
  f.canvas.__uniArc(true, 0)
  f.frameAt(200)
  f.painted.length = 0
  f.frameAt(300)
  assert.ok(f.painted.length > 200, `暗档的弧要有字形，实际 ${f.painted.length}`)
  assert.deepEqual([...new Set(f.painted.map(entry => entry.alpha))], [1], '暗档的盘不许被压薄')

  const darkView = hole.view()

  /* 亮档：LIGHT 调色板高端近黑，压在浅色纸面上就是压字，用户 m02530 点名了。 */
  hole.setMode('light')
  f.frameAt(400)
  f.painted.length = 0
  f.frameAt(500)
  assert.ok(f.painted.length > 200, `亮档的弧也要有字形，实际 ${f.painted.length}`)
  assert.deepEqual([...new Set(f.painted.map(entry => entry.alpha))], [0.35], '亮档对话页的墨统一收到 0.35')

  /* 「不改变位置」是这条需求的硬约束：换档只许改浓淡。 */
  const lightView = hole.view()
  assert.equal(lightView.x, darkView.x, '换档不许动洞心')
  assert.equal(lightView.radius, darkView.radius, '换档不许动半径')
  const lightConfig = hole.stats().config
  assert.ok(Math.abs(lightConfig.viewX - ARC_X) < 0.01, `换档后 viewX 仍是 ${ARC_X}，实际 ${lightConfig.viewX}`)

  /* 回新会话页要把墨补回来，否则洞会一直淡着。 */
  f.canvas.__uniSkyModeOff()
  f.frameAt(600)
  f.painted.length = 0
  f.frameAt(700)
  assert.deepEqual([...new Set(f.painted.map(entry => entry.alpha))], [1], '回新会话页要恢复满墨')

  dispose()
})

test('换页不重建网格：画布尺寸、格数与 ready 全程不变，所以不会闪一帧', () => {
  const f = holeFixture()
  const dispose = f.api.mount()
  f.drain()
  const hole = f.canvas.__uniBlackHole
  const before = hole.stats()
  assert.deepEqual(f.states, ['building', 'ready'], `只有初次挂载会烘焙，实际 ${f.states.join(' → ')}`)

  f.canvas.__uniArc(true, 320)
  f.frameAt(0)
  f.frameAt(160)
  f.frameAt(320)
  f.drain()
  const after = hole.stats()

  assert.equal(after.width, before.width, '画布缓冲区宽度不许变')
  assert.equal(after.height, before.height, '画布缓冲区高度不许变')
  assert.equal(after.columns, before.columns, '列数变了就是重建')
  assert.equal(after.rows, before.rows, '行数变了就是重建')
  assert.equal(after.cells, before.cells, '格数变了就是重建')
  assert.equal(after.ready, true, '全程保持 ready')
  assert.deepEqual(f.states, ['building', 'ready'], `换页不许再烘焙一次，实际 ${f.states.join(' → ')}`)

  f.canvas.__uniArc(false, 320)
  f.frameAt(600)
  f.frameAt(920)
  f.drain()
  assert.equal(hole.stats().cells, before.cells, '回程同样不重建')
  assert.deepEqual(f.states, ['building', 'ready'], `回程也不许烘焙，实际 ${f.states.join(' → ')}`)
  dispose()
})

test('运镜连续：位移交给合成器，内容只在两端各画一次', () => {
  const f = holeFixture()
  const dispose = f.api.mount()
  f.drain()
  const hole = f.canvas.__uniBlackHole
  const home = hole.stats().config.viewX
  assert.ok(Math.abs(home - (COLUMN_CENTER - VIEWPORT.width / 2)) < 0.01, `首页 viewX 应为 ${COLUMN_CENTER - VIEWPORT.width / 2}，实际 ${home}`)

  /* 位移交给合成器（用户 m02944「交给GPU吧，我们目前没有星野，只有一个ASCII黑洞」）：
     起飞时内容摆成新会话页的取景，路上只动 canvas 的 transform，主线程不再逐帧写 viewX。 */
  f.canvas.__uniArc(true, MOVE_MS)
  const out = f.anims.at(-1)
  assert.ok(out, '出画必须走 canvas.animate')
  assert.equal(out.frames[0].transform, 'translate3d(0px, 0px, 0)', '出画从原位起手')
  assert.equal(out.frames.at(-1).transform, 'translate3d(' + TRAVEL + 'px, 0px, 0)', '出画落到整段行程')
  assert.equal(hole.stats().config.viewX, home, '飞行期内容不许跟着动：位移全在 transform 上')

  /* 弧顶写在关键帧里：中点抬到 -ARC_BOW，两端归零。 */
  const outMid = out.frames.find(frame => frame.offset === 0.5)
  assert.ok(outMid, '关键帧要有中点')
  assert.equal(outMid.transform, 'translate3d(' + TRAVEL / 2 + 'px, ' + (-ARC_BOW) + 'px, 0)')
  assert.equal(out.frames[0].transform.split(',')[1].trim(), '0px', '起点不抬起')
  assert.equal(out.frames.at(-1).transform.split(',')[1].trim(), '0px', '落点精确回 y=0')

  f.frameAt(1000)
  const spins = [hole.stats().config.speed]
  const brights = [hole.stats().config.brightness]
  for (const t of [1250, 1500, 1750]) {
    f.frameAt(t)
    spins.push(hole.stats().config.speed)
    brights.push(hole.stats().config.brightness)
  }
  /* 自转：speed 乘进 elapsed（见 tick），脉冲峰值必须明显高过端点插值，否则盘看着是停的。 */
  assert.ok(Math.max(...spins) >= 1.2, `飞行期盘要真的转起来，峰值只有 ${Math.max(...spins)}`)
  assert.ok(Math.max(...spins) <= 2, `转速别撞上 options() 的上限 2，撞上就被夹平：${Math.max(...spins)}`)
  assert.ok(brights.at(-1) < brights[0] - 0.05, `亮度要在路上收向 0.4，实际 ${brights[0]} → ${brights.at(-1)}`)

  f.frameAt(2100)
  assert.equal(hole.stats().config.viewX, ARC_X, '落地把取景写成交互页的那一格')
  assert.equal(f.canvas.style.transform, '', '落地要清掉 transform，静止态不留合成器层')
  assert.ok(out.cancelled, '落地要撤掉动画，别留着一直占层')

  const config = hole.stats().config
  assert.ok(Math.abs(config.brightness - 0.4) < 1e-9, '亮度收到 0.4')
  assert.ok(Math.abs(config.speed - 0.35) < 1e-9, '速度收到 0.35')

  /* 回程：内容直接摆成新会话页的取景（终点就是它），位移从 +TRAVEL 收回 0，
     所以回程落地不需要换取景 —— 那一刻画面已经对上了。 */
  f.canvas.__uniArc(false, MOVE_MS)
  const back = f.anims.at(-1)
  assert.equal(back.frames[0].transform, 'translate3d(' + TRAVEL + 'px, 0px, 0)', '回程从右缘起手')
  assert.equal(back.frames.at(-1).transform, 'translate3d(0px, 0px, 0)', '回程收回原位')
  assert.equal(hole.stats().config.viewX, home, '回程起手就把内容摆回新会话页的取景')
  f.frameAt(2200)
  f.frameAt(2500)
  /* 弧顶在时长正中间（k=0.5），所以转速峰值要在这里取。 */
  f.frameAt(2600)
  const backSpin = hole.stats().config.speed
  f.frameAt(2900)
  f.frameAt(3200)
  assert.ok(backSpin >= 1.2, `回程盘也要转起来，实际 ${backSpin}`)
  assert.ok(Math.abs(hole.stats().config.viewX - home) < 0.01, `回程端点应为 ${home}`)
  assert.ok(Math.abs(hole.stats().config.brightness - 1) < 1e-9, '亮度复位成 1')
  assert.equal(hole.stats().config.viewY, 0, '落地 y 回到 0')
  assert.equal(f.canvas.style.transform, '', '回程落地同样清掉 transform')
  dispose()
})

test('主线程卡住不再冻住洞：位置在合成器上，主线程只补最后那一帧', () => {
  /* 真机日志里四段 390~490ms 的长任务（m02920）以前会把洞冻在半路。现在整段行程是一条
     合成器动画，主线程断供只影响「盘转了几帧」和落地那一帧的取景写入。 */
  const f = holeFixture()
  const dispose = f.api.mount()
  f.drain()
  const hole = f.canvas.__uniBlackHole
  const home = hole.stats().config.viewX

  f.canvas.__uniArc(true, MOVE_MS)
  const out = f.anims.at(-1)
  f.frameAt(1000)
  const drawnBefore = hole.stats().frames
  /* 480ms 的空档：一个 rAF 都不跑。 */
  f.frameAt(1480)
  assert.equal(hole.stats().config.viewX, home, '空档里内容不许自己往前走：位移不归主线程管')
  assert.ok(hole.stats().frames - drawnBefore <= 1, '空档里最多补一帧，不该连画一串')
  assert.equal(f.canvas.style.transform, 'translate3d(0px, 0px, 0)', '合成器动画仍在跑，位移不变')
  assert.equal(out.cancelled, false, '空档不许提前撤动画')

  /* 恢复之后照样收尾，端点精确。 */
  f.frameAt(1800)
  f.frameAt(2100)
  assert.equal(hole.stats().config.viewX, ARC_X, '卡顿之后仍然精确落到对话页取景')
  assert.equal(f.canvas.style.transform, '', '收尾照常清 transform')
  dispose()
})

test('reduced motion：交给 __uniArc 的时长为 0 时瞬时落点，不申请动画帧', () => {
  const f = holeFixture({ reduced: true })
  const dispose = f.api.mount()
  f.drain()
  const hole = f.canvas.__uniBlackHole
  f.canvas.__uniArc(true, 0)
  assert.ok(Math.abs(hole.stats().config.viewX - ARC_X) < 0.01, '瞬时端点')
  assert.equal(f.frames.size, 0, '不运镜就不出帧')
  dispose()
})

/* ── client.js：谁在什么时候拨取景 ───────────────────────────────────────────── */

/* 跑构建产物 client.js —— 那才是浏览器里真的会执行的东西，由 __ModuleLoader__ 交进
   factory。src/client.js 不是独立模块（factory 会内联它并先定义 module/exports 与六个
   常量），所以这里只跑产物；产物与源码是否同步由 npm run check 负责。 */
function clientHarness({ reduced = false, home = false } = {}) {
  let id = 0, hole = null, mounted = 0
  let heroPresent = home
  const timers = new Map(), frames = new Map(), listeners = new Map()
  const calls = []
  const wake = []

  const context2d = {
    fillStyle: '', font: '', textAlign: '', textBaseline: '', globalAlpha: 1, lineWidth: 1,
    save() {}, restore() {}, setTransform() {}, clearRect() {}, fillRect() {},
    beginPath() {}, closePath() {}, fill() {}, stroke() {}, moveTo() {}, lineTo() {},
    arc() {}, fillText() {},
  }
  function makeCanvas() {
    const style = { setProperty(name, value) { style[name] = value }, removeProperty(name) { delete style[name] } }
    const canvas = {
      dataset: {}, style, width: 0, height: 0, isConnected: true,
      setAttribute(name, value) { canvas[name] = value },
      removeAttribute(name) { delete canvas[name] },
      remove() { canvas.isConnected = false },
      getBoundingClientRect: () => ({ left: 0, top: 0, width: VIEWPORT.width, height: VIEWPORT.height }),
      getContext: () => context2d,
    }
    /* 真 mounted 的洞里 __uniArc 是写上去的，这里包一层记录是谁拨了取景、拨到哪一端。 */
    let arc = null
    Object.defineProperty(canvas, '__uniArc', {
      configurable: true,
      get: () => (arc === null ? undefined : function (side, ms) { calls.push(`arc:${side}:${ms}`); return arc(side, ms) }),
      set: value => { arc = value },
    })
    return canvas
  }
  const column = { getBoundingClientRect: () => ({ left: COLUMN_LEFT, top: 0, width: COLUMN_WIDTH, height: VIEWPORT.height }) }
  const frame = { getBoundingClientRect: () => ({ left: 0, top: 0, width: VIEWPORT.width, height: VIEWPORT.height }) }
  const body = {
    dataset: {},
    prepend(child) { child.isConnected = true; hole = child; mounted += 1; calls.push('mountHole') },
    setAttribute() {}, removeAttribute() {},
  }
  const document = {
    hidden: false,
    documentElement: { style: { setProperty() {}, removeProperty() {}, getPropertyValue: () => null } },
    body,
    createElement: tag => (tag === 'canvas' ? makeCanvas() : { style: {}, dataset: {}, appendChild() {}, setAttribute() {}, remove() {} }),
    addEventListener: (kind, fn) => listeners.set(kind, fn),
    removeEventListener: kind => listeners.delete(kind),
    querySelector(selector) {
      if (selector === 'canvas[data-uni-black-hole]') return hole
      if (selector === HERO) return heroPresent ? { getAttribute: () => '' } : null
      if (selector === "[data-slot='root'] > * > div:has(> [data-slot='main'])") return column
      if (selector === "[data-slot='main']") return column
      if (selector === "[data-slot='root'] > *") return frame
      return null
    },
    querySelectorAll: () => [],
    getElementById: () => null,
    head: { appendChild() {} },
  }
  const motion = {
    matches: reduced,
    addEventListener: (kind, fn) => listeners.set('motion', fn),
    removeEventListener: () => listeners.delete('motion'),
  }
  const window = {
    devicePixelRatio: 1,
    innerWidth: VIEWPORT.width, innerHeight: VIEWPORT.height,
    matchMedia: () => motion,
    addEventListener: (kind, fn) => listeners.set('window:' + kind, fn),
    removeEventListener: kind => listeners.delete('window:' + kind),
    setTimeout: fn => { timers.set(++id, fn); return id },
    clearTimeout: key => timers.delete(key),
    requestAnimationFrame: fn => { frames.set(++id, fn); return id },
    cancelAnimationFrame: key => frames.delete(key),
    document,
  }
  const sandbox = {
    window, document, performance, console,
    setTimeout: window.setTimeout, clearTimeout: window.clearTimeout,
    requestAnimationFrame: window.requestAnimationFrame, cancelAnimationFrame: window.cancelAnimationFrame,
    getComputedStyle: direction => ({ colorScheme: 'dark', position: 'relative', isolation: 'auto', getPropertyValue: () => '' }),
    ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
    IntersectionObserver: class { observe() {} disconnect() {} },
    MutationObserver: class { constructor(fn) { wake.push(fn) } observe() {} disconnect() {} },
  }
  window.globalThis = window

  const context = vm.createContext(sandbox)
  context.globalThis = context
  let factory = null
  window.__ModuleLoader__ = { load(options) { factory = options.factory } }
  vm.runInContext(BUILT, context)
  assert.equal(typeof factory, 'function', '构建产物要通过 __ModuleLoader__ 交出一个 factory')
  const plugin = factory(() => ({}))
  assert.equal(typeof plugin.apply, 'function', 'factory 要返回带 apply 的模块')

  const observable = (snapshot = new Map()) => ({ getSnapshot: () => snapshot, subscribe: () => () => {} })
  const stub = () => ({
    on: () => () => {}, off: () => {}, emit: () => {}, removeListener: () => {},
    get: () => undefined, set: () => {}, update: () => {},
    sessionStatus: observable(), list: observable(),
  })
  const effects = []
  const ctx = {
    get: name => (name === 'theme' ? { overrideTokens: () => () => {} } : stub()),
    effect(fn, label) { effects.push({ fn, label }) },
    inject() {}, on() { return () => {} }, off() {}, emit() {},
    set() {}, provide() {}, plugin() {},
  }
  plugin.apply(ctx)
  const paint = effects.filter(entry => entry.label === 'universe: page backgrounds')
  assert.equal(paint.length, 1, `页背景 effect 必须有且只有一个，实际 ${paint.length}`)
  paint[0].fn()

  function drain() {
    let count = 0
    while (timers.size) {
      assert.ok(count++ < 5000, '定时器链没有收敛')
      const tasks = [...timers.values()]
      timers.clear()
      tasks.forEach(fn => fn())
    }
  }
  return {
    calls, drain, mounted: () => mounted, hasHole: () => hole !== null,
    /* 切页：翻转 HERO 的存在性，再踢一下 MutationObserver —— 真机上就是这个序列。 */
    page(next) { heroPresent = next; wake.forEach(fn => fn([])) },
  }
}

test('洞常驻：挂载唯一，换页只拨取景，同一页的后续变更不再动它', () => {
  const h = clientHarness()
  assert.deepEqual(h.calls, ['mountHole', 'arc:true:0'], `冷启动在对话页：挂载后直接落端点，实际 ${h.calls.join(' → ')}`)
  assert.equal(h.hasHole(), true)

  h.calls.length = 0
  h.page(true)
  assert.deepEqual(h.calls, ['arc:false:1000'], `回新会话页只运镜，实际 ${h.calls.join(' → ')}`)

  h.calls.length = 0
  h.page(false)
  assert.deepEqual(h.calls, ['arc:true:1000'], `进对话页只运镜，实际 ${h.calls.join(' → ')}`)

  /* 页面翻转豁免 180ms 窗口：上面的断言没 drain 就成立，说明翻页当拍就拨了。 */
  h.calls.length = 0
  h.drain()
  assert.deepEqual(h.calls, [], `同一页的后续变更不许再拨取景，实际 ${h.calls.join(' → ')}`)
  assert.equal(h.mounted(), 1, '全程只挂载一次，洞不参与交叉淡化也就不该被撤掉')
  assert.equal(h.hasHole(), true)
})

test('冷启动在新会话页：挂载后落端点，随后照常运镜', () => {
  const h = clientHarness({ home: true })
  assert.deepEqual(h.calls, ['mountHole', 'arc:false:0'], `冷启动在首页：落端点，实际 ${h.calls.join(' → ')}`)
  h.calls.length = 0
  h.page(false)
  assert.deepEqual(h.calls, ['arc:true:1000'], `进对话页运镜，实际 ${h.calls.join(' → ')}`)
  assert.equal(h.mounted(), 1)
})

test('prefers-reduced-motion：取景直接落端点，交给 __uniArc 的时长是 0', () => {
  const h = clientHarness({ reduced: true })
  assert.deepEqual(h.calls, ['mountHole', 'arc:true:0'], `减少动效下冷启动也要落端点，实际 ${h.calls.join(' → ')}`)
  h.calls.length = 0
  h.page(true)
  assert.deepEqual(h.calls, ['arc:false:0'], `减少动效下不运镜，实际 ${h.calls.join(' → ')}`)
})

/* ── 契约：源码与样式表里不许留下被否的旧写法 ────────────────────────────────── */

test('client.js 一个背景一个主人：交叉淡化的整套 API 都已消失', () => {
  for (const dead of ['FADE_MS', 'SKY_SELECTOR', 'rampFade', 'fadeTo(', 'dropSky', 'UniverseDeepSpace']) {
    assert.ok(!CLIENT.includes(dead), `旧转场的残留：${dead}`)
  }
  assert.match(CLIENT, /hole\.__uniArc\(!home/, 'client 只通过 __uniArc 拨取景')
  assert.match(CLIENT, /UniversePageMode\.watchPageMode/, '页面判定从 page-mode.js 取')
})

test('契约：星野整条链路下架，构建清单换成页面判定', () => {
  assert.ok(CLIENT_FILES.includes('src/runtime/page-mode.js'), '构建清单要含 page-mode.js')
  assert.ok(!CLIENT_FILES.includes('src/runtime/deep-space.js'), 'deep-space.js 不该再进包')
  for (const gone of ['src/runtime/deep-space.js', 'tools/deep-space.test.mjs', 'preview/deep-space.html', 'tools/build-deep-space-preview.mjs']) {
    assert.equal(existsSync(new URL('../' + gone, import.meta.url)), false, `${gone} 应该已经不在了`)
  }
})

test('theme.css：左栏隔离靠 @property 斜坡，边界由 transition 连续推过去', () => {
  assert.match(CSS, /@property --uni-hole-edge\s*\{[^}]*syntax:\s*'<length>'/, '要注册成 <length> 才能 transition')
  assert.match(CSS, /transparent var\(--uni-hole-edge\), currentColor calc\(var\(--uni-hole-edge\) \+ 72px\)/, '斜坡起点由变量推，宽度 72px')
  assert.match(CSS, /body\[data-uni-motion='reduced'\] canvas\[data-uni-black-hole\] \{\s*transition: none;/, '减少动效下边界瞬时到位')
  assert.doesNotMatch(CSS, /transparent 0, currentColor 72px/, '旧的固定 72px 斜坡已删')
})

test('构建产物跟得上源码：client.js 里已经有 __uniArc', () => {
  if (!BUILT) return
  assert.ok(BUILT.includes('__uniArc'), '产物里没有 __uniArc，说明没重新构建')
  assert.ok(!BUILT.includes('UniverseDeepSpace'), '产物里还带着星野')
})
