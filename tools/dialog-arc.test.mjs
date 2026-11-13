/**
 * 对话页背景（2026-10-29 甲方案定稿）的断言。
 *
 * 定稿：两页共用同一块画布、同一份网格，换页只做一次连续运镜（viewX / alpha /
 * speed），并且取景框固定成整个 frame。用户选甲的理由（m02133 原话「甲，弧就停在现在的
 * 位置就行」）是转场要读作「一次镜头运动」，所以这里最重的两条断言不是「弧在不在」，
 * 而是：
 *   1. 换页期间画布尺寸与格数一个都不许变 —— 变就要重建近两万格子，重建期画布是空的、
 *      CSS 还把 canvas 藏起来，洞会闪一帧，正好闪在转场最显眼的那一帧；
 *   2. viewX 必须单调推到端点、端点精确，浓淡与速度沿同一条缓动一起走 —— 否则位置和
 *      透明度各硬切一次，屏幕上是两次切换。
 *
 * 这里的 fixture 刻意模仿浏览器里影响结果的几处约定：canvas 的 width / height 是缓冲区、
 * getBoundingClientRect 按 CSS 盒模型解算。GPU 后端是明确标记的边界替身，只记录绘制输入，
 * 不计算射线、字符或像素；真实字形、环让位与色阶由 gpu-browser-check.js 检查。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFileSync, existsSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import { CLIENT_FILES } from './build-contract.mjs'

const HOLE = readFileSync(new URL('../src/runtime/geodesic.js', import.meta.url), 'utf8') + '\n' +
  readFileSync(new URL('../src/runtime/accretion-disk.js', import.meta.url), 'utf8')
const CLIENT = readFileSync(new URL('../src/client.js', import.meta.url), 'utf8')
const CSS = readFileSync(new URL('../src/theme.css', import.meta.url), 'utf8')
const BUILT_PATH = new URL('../client.js', import.meta.url)
const BUILT = existsSync(BUILT_PATH) ? readFileSync(BUILT_PATH, 'utf8') : ''

/* 视口 1256 × 900；左栏 280，对话列 976，所以对话列中心在 280 + 976 / 2 = 768。
   半径按短边：阶段26 起用有限距离临界投影 rho_c = 0.34123924246684356
   （0.34 × 900 / 2 = 153 的旧值偏小 0.3645%），故 900 短边时约 153.56px。 */
const VIEWPORT = { width: 1256, height: 900 }
const COLUMN_LEFT = 280
const COLUMN_WIDTH = 976
const COLUMN_CENTER = COLUMN_LEFT + COLUMN_WIDTH / 2
const RHO_C = 0.34123924246684356
const RADIUS = RHO_C * Math.min(VIEWPORT.width, VIEWPORT.height) / 2
/* 对话页只露左半边：洞心正好压在视口右缘，右半出画。
   2026-10-29 用户两次点名：「黑洞在左边会挡住左侧栏的文字，挪到右边」→「只显示左半边黑洞」。 */
const ARC_X = VIEWPORT.width / 2
/* 甲：路径走弧线 + 飞行期盘自转（用户 m02685「向右旋转到达 / 向左旋转放回」）。
   倾角动不得（会整格重建），所以旋转拆成 viewY 起伏与 speed 脉冲两件逐帧的事。
   两个数字要和 src/runtime/accretion-disk.js 里的 ARC_BOW / ARC_SPIN 一致。 */
const ARC_BOW = 64
const ARC_SPIN = 1.05
/* 两页洞心的横向差：出画时整段位移就是这个数（视口宽 - 对话列中心）。 */
const TRAVEL = VIEWPORT.width - COLUMN_CENTER
/* 运镜时长，要和 src/client.js 的 MOVE_MS 一致；下面的帧时刻都按它推算。 */
const MOVE_MS = 1000
const HERO = "[data-slot='conversation.hero.brand.mark'],[data-slot='conversation.hero.workspace']"

/* 只记录控制器到后端的契约，不模拟 WebGL 或 Canvas 像素。 */
function gpuRecorder() {
  const draws = [], builds = []
  const api = { create() {
    let current = null
    return {
      build(input) {
        const result = { diagnostics: { state: 'ready', rays: input.columns * input.rows, exhausted: 0, retried: 0, unresolved: 0, invalid: 0, submitCpuMs: 0 }, dispose() {} }
        const task = Promise.resolve(result)
        builds.push({ input: { ...input }, task })
        return task
      },
      setGrid(result) { if (current) current.dispose(); current = result },
      draw(size, frame) { draws.push({ size: { ...size }, frame: { ...frame, patches: frame.patches.map(patch => ({ ...patch })) } }) },
      clear() {}, refreshAtlas() {}, invalidateAtlas() {},
      stats: () => ({ backend: 'transition-test-double', gpuFrameMs: null }),
      dispose() { if (current) current.dispose(); current = null },
    }
  } }
  return { api, draws, builds }
}

/* 真跑 src/runtime/accretion-disk.js：取景、运镜、重建都在这里判。 */
function holeFixture({ reduced = false, withBody = false } = {}) {
  let id = 0
  const timers = new Map(), frames = new Map(), listeners = new Map(), attrs = {}, states = []
  const gpu = gpuRecorder(), anims = []
  const motion = {
    matches: reduced,
    addEventListener: (kind, fn) => listeners.set('motion', fn),
    removeEventListener: () => listeners.delete('motion'),
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
    addEventListener(kind, fn) { (canvas.events ||= new Map()).set(kind, fn) },
    removeEventListener(kind) { canvas.events?.delete(kind) },
    getBoundingClientRect() {
      return {
        left: Number.parseFloat(style.left) || 0,
        top: Number.parseFloat(style.top) || 0,
        width: Number.parseFloat(style.width) || 0,
        height: Number.parseFloat(style.height) || 0,
      }
    },
    getContext() { throw Error('Character controller must not request a 2D context') },
    /* 合成器动画的替身：位移现在交给 canvas.animate 的关键帧，主线程不再逐帧写 viewX。
       测试不需要真跑动画，只要把关键帧留下来逐条核对。 */
    animate(frames, options) {
      const record = { frames, options, cancelled: false }
      anims.push(record)
      return { cancel() { record.cancelled = true }, finish() {}, finished: Promise.resolve() }
    },
  }
  const bodyAnims = []
  const bodyCanvas = {
    dataset: {}, style: { setProperty(name, value) { this[name] = value } },
    setAttribute() {}, remove() {},
    animate(frames, options) {
      const record = { frames, options, cancelled: false }
      bodyAnims.push(record)
      return { cancel() { record.cancelled = true } }
    },
  }
  let created = 0
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
    createElement: () => withBody && created++ > 0 ? bodyCanvas : canvas,
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
    performance, console, document: doc, window: viewport, UniverseAccretionGPU: gpu.api,
    UniverseHole: withBody ? { create: () => ({
      radius: () => RADIUS, ring: () => null, stats: () => ({ ring: null }),
      resize() {}, pose() {}, setMode() {}, dispose() {},
    }) } : undefined,
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
  async function settle() {
    drain()
    await Promise.all(gpu.builds.map(entry => entry.task))
    for (let i = 0; i < 4; i++) await Promise.resolve()
    assert.equal(canvas.__uniBlackHole.stats().ready, true, 'GPU fixture 构建必须实际发布 ready，不能只清 timer')
  }
  return { api: context.UniverseAccretionDisk, canvas, bodyCanvas, bodyAnims, attrs, states, draws: gpu.draws, builds: gpu.builds, anims, listeners, frames, frameAt, drain, settle }
}

test('取景框固定成整个 frame：洞心仍落在对话列中心，左栏交给 mask 斜坡隔离', async () => {
  const f = holeFixture()
  const dispose = f.api.mount()
  await f.settle()
  const hole = f.canvas.__uniBlackHole
  assert.equal(hole.stats().ready, true, '挂载即完成第一次烘焙')

  /* 框钉在视口左缘、整窗宽：换页不改尺寸的前提。 */
  assert.equal(f.canvas.style.left, '0px', '画布左缘钉在视口，不再从对话列左缘开始')
  assert.equal(f.canvas.style.width, VIEWPORT.width + 'px', '画布铺满整窗')
  assert.equal(f.canvas.style.height, VIEWPORT.height + 'px', '高度取 frame 高度')

  /* 画布变宽之后，洞心必须正补偿回对话列中心，而不是躺在整窗中心。 */
  f.frameAt(100)
  const drawn = f.draws.at(-1)
  assert.ok(drawn, '控制器必须向 GPU 提交一帧')
  const centered = drawn.frame.baseX + drawn.frame.viewX
  assert.equal(centered, COLUMN_CENTER, '提交给 GPU 的洞心在对话列中心')
  assert.ok(Math.abs(centered - VIEWPORT.width / 2) > 100, '不是整窗居中：整窗中心在左栏那侧')
  assert.equal(drawn.frame.baseY + drawn.frame.viewY, VIEWPORT.height / 2)
  assert.equal(f.canvas.style['--uni-hole-edge'], COLUMN_LEFT + 'px', '斜坡起点压在对话列左缘，洞不进左栏')

  const view = hole.view()
  assert.equal(view.width, VIEWPORT.width, '画布坐标按整窗宽算')
  assert.ok(Math.abs(Number(view.radius) - RADIUS) < 0.01, `半径按短边算，应为 ${RADIUS}`)

  dispose()
})

test('出画取景：圆心出画只剩左半弧，速度收到对话页的值', async () => {
  const f = holeFixture()
  const dispose = f.api.mount()
  await f.settle()
  const hole = f.canvas.__uniBlackHole
  f.frameAt(100)

  f.draws.length = 0
  f.canvas.__uniArc(true, 0)
  assert.equal(f.attrs['data-uni-sky-mode'], '', '对话页要能被 theme.css 认出来')
  assert.equal(f.canvas.style['--uni-hole-edge'], '0px', '下降坡收到 0：弧在右缘，左栏不再需要隔离')

  const config = hole.stats().config
  assert.ok(Math.abs(config.viewX - ARC_X) < 0.01, `viewX 应为 ${ARC_X}，实际 ${config.viewX}`)
  assert.ok(Math.abs(config.brightness - 1) < 1e-9, `亮度保持 1（淡化只走 alpha），实际 ${config.brightness}`)
  assert.ok(Math.abs(config.speed - 0.35) < 1e-9, `速度要收到 0.35，实际 ${config.speed}`)
  assert.equal(config.fps, 60, '对话页降转速但不降帧率')

  const view = hole.view()
  assert.ok(Math.abs(view.x - (view.width / 2 + config.viewX)) < 1e-9, 'view() 必须把位移算进圆心')
  /* 半个洞就一种算法：洞心落在右缘这条线上，左边整半个圆可见、右边整半个出画。 */
  assert.ok(Math.abs(view.x - view.width) < 0.01, `洞心要压在视口右缘 ${view.width}，实际 ${view.x}`)
  assert.ok(view.x - Number(view.radius) > view.width / 2, '可见的那半圆要整个留在窗口里，不能被左边裁掉')

  /* 此处只验 GPU 入口的相机契约；可见字符/遮罩由真实 GPU 像素检查承担。 */
  f.frameAt(300)
  const drawn = f.draws.at(-1)
  assert.ok(drawn, '出画后仍向 GPU 提交字符帧')
  assert.equal(drawn.size.w, VIEWPORT.width)
  assert.equal(drawn.size.h, VIEWPORT.height)
  assert.equal(drawn.frame.viewX, ARC_X)
  assert.equal(drawn.frame.viewY, 0)
  assert.equal(drawn.frame.baseX + drawn.frame.viewX, drawn.size.w, 'GPU 洞心压在右缘')
  assert.ok(Math.abs(drawn.frame.horizon - Number(view.radius)) < 1e-9)

  f.canvas.__uniSkyModeOff()
  assert.equal(f.attrs['data-uni-sky-mode'], undefined, '回新会话页要撤掉属性')
  const back = hole.view()
  assert.ok(Math.abs(back.x - COLUMN_CENTER) < 0.01, `复位成对话列中心 ${COLUMN_CENTER}，实际 ${back.x}`)
  assert.equal(f.canvas.style['--uni-hole-edge'], COLUMN_LEFT + 'px', '斜坡起点一起复位')

  dispose()
})

test('暗档盘字 0.341、亮档盘字 0.341，位置与几何不变', async () => {
  const f = holeFixture()
  const dispose = f.api.mount()
  await f.settle()
  const hole = f.canvas.__uniBlackHole

  /* 暗档先量一遍：两档观感要一样，暗档的墨按 Weber 等值收到 0.341，不是满墨。 */
  hole.setMode('dark')
  f.canvas.__uniArc(true, 0)
  f.frameAt(200)
  f.draws.length = 0
  f.frameAt(300)
  assert.ok(f.draws.length > 0, '暗档必须向 GPU 提交字符帧')
  assert.equal(f.draws.at(-1).frame.light, false)
  assert.equal(f.draws.at(-1).frame.brightness, 1)
  assert.equal('alpha' in f.draws.at(-1).frame, false, '转场整体 alpha 不得混入 GPU 色调映射')
  assert.ok(Math.abs(Number(f.canvas.style.opacity) - 0.341) < 1e-9, `暗档对话页的画布透明度 0.341，实际 ${f.canvas.style.opacity}`)

  const darkView = hole.view()

  /* 亮档盘字走单一暖轴（外缘深褐 → 中段暖褐 → 热区赭金），画布不透明度按 ARC_INK_LIGHT 收到 0.341。 */
  hole.setMode('light')
  f.frameAt(400)
  f.draws.length = 0
  f.frameAt(500)
  assert.ok(f.draws.length > 0, '亮档必须向 GPU 提交字符帧')
  assert.equal(f.draws.at(-1).frame.light, true)
  assert.equal(f.draws.at(-1).frame.brightness, 1)
  assert.equal('alpha' in f.draws.at(-1).frame, false)
  assert.ok(Math.abs(Number(f.canvas.style.opacity) - 0.341) < 1e-9, `亮档对话页的画布不透明度 0.341，实际 ${f.canvas.style.opacity}`)

  /* 「不改变位置」是这条需求的硬约束：换档只许改浓淡。 */
  const lightView = hole.view()
  assert.equal(lightView.x, darkView.x, '换档不许动洞心')
  assert.equal(lightView.radius, darkView.radius, '换档不许动半径')
  const lightConfig = hole.stats().config
  assert.ok(Math.abs(lightConfig.viewX - ARC_X) < 0.01, `换档后 viewX 仍是 ${ARC_X}，实际 ${lightConfig.viewX}`)

  /* 回新会话页要把墨补回来，否则洞会一直淡着。 */
  f.canvas.__uniSkyModeOff()
  f.frameAt(600)
  f.draws.length = 0
  f.frameAt(700)
  assert.ok(f.draws.length > 0)
  assert.equal(f.draws.at(-1).frame.brightness, 1, '复位不改变 GPU 亮度，浓淡只走画布透明度')
  assert.ok(Math.abs(Number(f.canvas.style.opacity) - 1) < 1e-9, `回新会话页要把画布透明度补回 1，实际 ${f.canvas.style.opacity}`)

  dispose()
})

test('亮档只提升盘字：阴影圆保持 .252，去回程关键帧与新会话页端点不变', async () => {
  const f = holeFixture({ withBody: true })
  const dispose = f.api.mount()
  await f.settle()
  const renderer = f.canvas.__uniBlackHole
  renderer.setMode('light')
  f.canvas.__uniArc(true, MOVE_MS)
  const disk = f.anims.at(-1).frames
  const body = f.bodyAnims.at(-1).frames
  assert.equal(disk[0].opacity, 1)
  assert.ok(Math.abs(disk.at(-1).opacity - .341) < 1e-9)
  assert.ok(Math.abs(body.at(-1).opacity - .252) < 1e-9)
  disk.forEach((key, i) => {
    assert.equal(key.transform, body[i].transform)
    assert.ok(Math.abs((1 - key.opacity) / (1 - .341) - (1 - body[i].opacity) / (1 - .252)) < 1e-9)
  })
  f.canvas.__uniSkyMode()
  assert.ok(Math.abs(Number(f.canvas.style.opacity) - .341) < 1e-9)
  assert.equal(Number(f.bodyCanvas.style.opacity), .252)
  f.canvas.__uniArc(false, MOVE_MS)
  assert.ok(Math.abs(f.anims.at(-1).frames[0].opacity - .341) < 1e-9)
  assert.equal(f.bodyAnims.at(-1).frames[0].opacity, .252)
  assert.equal(f.anims.at(-1).frames.at(-1).opacity, 1)
  assert.equal(f.bodyAnims.at(-1).frames.at(-1).opacity, 1)
  f.canvas.__uniSkyModeOff()
  assert.equal(Number(f.canvas.style.opacity), 1)
  assert.equal(Number(f.bodyCanvas.style.opacity), 1)
  f.canvas.__uniSkyMode()
  renderer.setMode('dark')
  assert.equal(Number(f.canvas.style.opacity), .341)
  assert.equal(Number(f.bodyCanvas.style.opacity), .341)
  dispose()
})

test('换页不重建网格：画布尺寸、格数与 ready 全程不变，所以不会闪一帧', async () => {
  const f = holeFixture()
  const dispose = f.api.mount()
  await f.settle()
  const hole = f.canvas.__uniBlackHole
  const before = hole.stats()
  assert.deepEqual(f.states, ['building', 'ready'], `只有初次挂载会烘焙，实际 ${f.states.join(' → ')}`)

  f.canvas.__uniArc(true, 320)
  f.frameAt(0)
  f.frameAt(160)
  f.frameAt(320)
  await f.settle()
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
  await f.settle()
  assert.equal(hole.stats().cells, before.cells, '回程同样不重建')
  assert.deepEqual(f.states, ['building', 'ready'], `回程也不许烘焙，实际 ${f.states.join(' → ')}`)
  dispose()
})

test('运镜连续：位移交给合成器，内容只在两端各画一次', async () => {
  const f = holeFixture()
  const dispose = f.api.mount()
  await f.settle()
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
  /* 每帧墨量从 stats().alpha 读（renderer.setAlpha 的当前值）：它不受 fps 门限影响，
     不会因为这一帧恰好没出帧就漏采。 */
  const alphas = [1]
  for (const t of [1250, 1500, 1750]) {
    f.frameAt(t)
    spins.push(hole.stats().config.speed)
    brights.push(hole.stats().config.brightness)
    alphas.push(hole.stats().alpha)
  }
  /* 飞行期不许出现「中间插值」写进内联：浓淡只在合成器关键帧上走。
     内联只允许是两个端点的档值（起点 1，换档时 onMode 写的 .341/.252）——
     哪天有人把逐帧 globalAlpha 塞回 pose/step，这里会读到 0.5xx 这种中间值。 */
  const inline = Number(f.canvas.style.opacity)
  assert.ok([1, 0.341, 0.252].some(v => Math.abs(inline - v) < 1e-9), `飞行期内联浓度只能是端点档值，实际 ${inline}`)
  /* 自转：speed 乘进 elapsed（见 tick），脉冲峰值必须明显高过端点插值，否则盘看着是停的。 */
  assert.ok(Math.max(...spins) >= 1.2, `飞行期盘要真的转起来，峰值只有 ${Math.max(...spins)}`)
  assert.ok(Math.max(...spins) <= 2, `转速别撞上 options() 的上限 2，撞上就被夹平：${Math.max(...spins)}`)
  /* 亮度不参与转场：对话页的淡只由 alpha 承担，盘别被压两层。 */
  assert.ok(brights.every(v => Math.abs(v - 1) < 1e-9), `亮度全程保持 1，实际 ${brights.join(' → ')}`)
  /* 浓淡跟着位移走：去程沿同一条 e 从满墨降到暗档终值 0.341，中间不许回头、也不许一口气到底。 */
  assert.ok(alphas.every((a, i) => i === 0 || a <= alphas[i - 1] + 1e-9), `去程 alpha 不许回头，实际 ${alphas.join(' → ')}`)
  assert.ok(alphas.at(-1) < 0.999, `去程没落地就得先淡下去，实际 ${alphas.at(-1)}`)
  assert.ok(alphas.at(-1) > 0.34, `去程不该一口气淡到终点，实际 ${alphas.at(-1)}`)
  /* 浓淡必须真的写进合成器关键帧 —— 这是「浓度与位置同源」的唯一证据。 */
  assert.equal(out.frames[0].opacity, 1, '去程关键帧从满墨起手')
  assert.ok(Math.abs(out.frames.at(-1).opacity - 0.341) < 1e-9, `去程关键帧落到 0.341，实际 ${out.frames.at(-1).opacity}`)
  assert.ok(out.frames.every((key, i) => i === 0 || key.opacity <= out.frames[i - 1].opacity + 1e-9), '关键帧浓淡单调不回头')

  f.frameAt(2100)
  assert.equal(hole.stats().config.viewX, ARC_X, '落地把取景写成交互页的那一格')
  assert.equal(f.canvas.style.transform, '', '落地要清掉 transform，静止态不留合成器层')
  assert.ok(out.cancelled, '落地要撤掉动画，别留着一直占层')

  const config = hole.stats().config
  assert.ok(Math.abs(config.brightness - 1) < 1e-9, '亮度保持 1，淡化只走 alpha')
  assert.ok(Math.abs(config.speed - 0.35) < 1e-9, '速度收到 0.35')
  const landed = hole.stats().alpha
  assert.ok(Math.abs(landed - 0.341) < 1e-9, `落地墨量是暗档终值 0.341，实际 ${landed}`)

  /* 回程：内容直接摆成新会话页的取景（终点就是它），位移从 +TRAVEL 收回 0，
     所以回程落地不需要换取景 —— 那一刻画面已经对上了。 */
  f.canvas.__uniArc(false, MOVE_MS)
  const back = f.anims.at(-1)
  assert.equal(back.frames[0].transform, 'translate3d(' + TRAVEL + 'px, 0px, 0)', '回程从右缘起手')
  assert.equal(back.frames.at(-1).transform, 'translate3d(0px, 0px, 0)', '回程收回原位')
  assert.ok(Math.abs(back.frames[0].opacity - 0.341) < 1e-9, `回程关键帧从 0.341 起手，实际 ${back.frames[0].opacity}`)
  assert.equal(back.frames.at(-1).opacity, 1, '回程关键帧落回满墨')
  assert.equal(hole.stats().config.viewX, home, '回程起手就把内容摆回新会话页的取景')
  f.frameAt(2200)
  f.frameAt(2500)
  /* 回程反着淡回来：中途必须已经在 0.341 与 1 之间，不能等落地才跳。 */
  const backAlpha = hole.stats().alpha
  assert.ok(backAlpha > 0.341 && backAlpha < 0.999, `回程要往回淡入，实际 ${backAlpha}`)
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

test('转场途中切亮档：落地按当前档收墨，不被起飞时捕获的旧值压回去', async () => {
  /* 起飞那一帧 toAlpha 是暗档 0.341。飞到一半换成亮档，onMode 把内联和 live.alpha
     都改成了基准 0.252（盘字另外映射为 .341）。落地按当前档重算，
     诊断基准仍保留亮档值，盘字保持亮档自己的实际不透明度。 */
  const f = holeFixture()
  const dispose = f.api.mount()
  await f.settle()
  const hole = f.canvas.__uniBlackHole
  f.canvas.__uniArc(true, MOVE_MS)
  f.frameAt(1500)
  hole.setMode('light')
  f.frameAt(1600)
  f.frameAt(2100)
  f.frameAt(2600)
  assert.ok(Math.abs(Number(f.canvas.style.opacity) - 0.341) < 1e-9, `亮档盘字落地不透明度 0.341，实际 ${f.canvas.style.opacity}`)
  assert.ok(Math.abs(hole.stats().alpha - 0.252) < 1e-9, `诊断镜像也要是亮档值，实际 ${hole.stats().alpha}`)
  dispose()
})

test('主线程卡住不再冻住洞：位置在合成器上，主线程只补最后那一帧', async () => {
  /* 真机日志里四段 390~490ms 的长任务（m02920）以前会把洞冻在半路。现在整段行程是一条
     合成器动画，主线程断供只影响「盘转了几帧」和落地那一帧的取景写入。 */
  const f = holeFixture()
  const dispose = f.api.mount()
  await f.settle()
  f.frameAt(0) /* 挂载的冷启动 settle 补帧先落地，下面「一个 rAF 都不跑」的空档才从干净状态起算 */
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

test('reduced motion：交给 __uniArc 的时长为 0 时瞬时落点，不申请动画帧', async () => {
  const f = holeFixture({ reduced: true })
  const dispose = f.api.mount()
  await f.settle()
  f.frameAt(0) /* 同上：消费掉挂载的 settle 补帧，否则「不运镜就不出帧」会数到那一帧 */
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
    addEventListener(kind, fn) { (canvas.events ||= new Map()).set(kind, fn) },
    removeEventListener(kind) { canvas.events?.delete(kind) },
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
    /* 洞拆成两块画布后 prepend 两次（先盘后洞，DOM 里洞在前）。真页面上 client.js 的
       HOLE_SELECTOR 只认 data-uni-black-hole，所以替身也按属性筛：带 data-uni-hole-body
       的那块只是背景层，不参与转场，也不算第二次挂载。 */
    prepend(child) {
      child.isConnected = true
      if (child.dataset && 'uniHoleBody' in child.dataset) return
      hole = child; mounted += 1; calls.push('mountHole')
    },
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
    window, document, performance, console, __quasarGPUForArcTests: gpuRecorder().api,
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
  const gpuEntry = 'UniverseAccretionGPU.create(canvas, GLYPHS, DARK, LIGHT)'
  assert.equal(BUILT.split(gpuEntry).length, 2, '只替换构建产物中的唯一 GPU 后端边界，不替换 mount/转场')
  const withTestBackend = BUILT.replace(gpuEntry, 'globalThis.__quasarGPUForArcTests.create(canvas, GLYPHS, DARK, LIGHT)')
  vm.runInContext(withTestBackend, context)
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
