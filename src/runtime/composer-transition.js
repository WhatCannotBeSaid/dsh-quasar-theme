/* Private factory input; concatenated by CLIENT_FILES, not a public module. */

    /* 输入卡的换页转场（2026-11-01 第七十一轮，用户点名）
     *
     * 用户原话：「现在输入框在新会话页到对话页的转场中没有动画，是直接从原地消失然后在底部
     * 出现，我想加一个动画。」
     *
     * 两个位置由宿主决定，本文件不参与排版：
     *   ① 新会话页把卡片靠 flex 居中 —— [data-phase=hero] .scrollBody 上写
     *      justify-content:center；对话页把它钉在底 —— .composerSeat 上写
     *      position:sticky;bottom:0（都在
     *      @deepseek-ai/dsh-client-ui-conversation/lib/client.js）。
     *   ② 中间的 settling 相位整块藏掉座席 —— .root[data-phase=settling] .composerSeat
     *      上的 visibility:hidden。
     * 于是没有本文件时，卡片在两个位置之间没有任何一帧过渡：原地消失、底部出现。
     *
     * 形态（2026-11-03 定案，用户选「连续运镜」）：位移全量下沉，透明度全程可见、只在中点
     * 压到 0.86 再回实 —— 借黑洞的节奏，不借它的停泊浓度（卡片落地必须可读）；正向反向
     * 同一套参数；prefers-reduced-motion 为 reduce 时不播。
     *
     * 时长与曲线跟黑洞的那次运镜对齐（用户 2026-11-01：「跟黑洞的转场同步好不。」）：同 1000ms，
     * 同 easeInOutCubic —— 曲线照抄 accretion-disk.js 的做法烘焙成 12 段关键帧、每段标 linear，
     * 不用 cubic-bezier 近似（两边一起看会差出半帧，读作「没同步」）。两个数字与
     * src/client.js 的 MOVE_MS、accretion-disk.js 的 STEPS 是配套的，改一个就要改另一个。
     *
     * 为什么是 FLIP 的矩形差而不是 CSS 关键帧：两个位置由宿主的 flex / sticky 决定，两页的
     * 卡片尺寸也不一样，关键帧写不出「从上一页的实际位置出发」。所以只读矩形，把差值当起始
     * transform，再归零。
     *
     * 为什么起点矩形要提前记：相位离开 hero 的那一刻，滚动体不再居中、卡片已经摊到底部
     * （宿主随后才把它藏起来）。等翻页发生了再量，量到的就是终点。所以在 hero 页上按需记一份。
     *
     * 触发面只有三处：
     *   · MutationObserver —— 相位属性 data-phase / data-content-phase 与 hero 页的结构变化；
     *   · input —— 输入把卡片撑高，居中位置随之上下移动（hero）或顶边上移（对话页）；
     *   · resize —— 窗口尺寸变化。
     * 对话页的卡片钉在底、位置不随滚动改变，所以流式消息产生的 childList 变更一律不排帧：
     * 这个观察器只在 hero 页量矩形，别处一次 getBoundingClientRect 都不读。
     *
     * 动画对象是 [data-composer-card] 的父节点，不是座席、更不是卡片本身：座席在对话页带一层
     * 渐变底，动它会把背景一起拖走；卡片自己带 transform 会形成层叠上下文，把 z-index: -1 的
     * 模糊背板从背景之下翻到之上（2026-11-03 的「落位时整卡变暗」）。父节点两者都没有。
     *
     * 2026-11-03 追记：settling 经核实只出现在「打开历史会话、摘要仍在 loading」时（宿主
     * ConversationMainPanel 的 settling 判定），发第一条消息的 hero→active 并不经过它。
     * 所以「消失 → 冒出」的真正来源不是 settling 的 visibility:hidden，而是旧卡片节点在相位
     * 切换时被卸载、新卡片又以 opacity 0 起播。本轮把透明度改成全程可见（浅呼吸），新卡第一帧
     * 就带着回位的 transform 画在旧位置，观感即是同一张卡连续滑落；起点矩形只在相位切换
     * 时取用一次，绕过 settling 之类中间相才到的 active 不从过期位置起飞。
     */

    function mountComposerTransition() {
        if (typeof document === 'undefined' || typeof window === 'undefined') return undefined
        if (typeof MutationObserver !== 'function') return undefined
        if (typeof Element === 'undefined' || typeof Element.prototype.animate !== 'function') return undefined

        var CARD = '[data-composer-card]'
        var PHASE = '[data-phase]'
        /* 与黑洞运镜同步：src/client.js 的 MOVE_MS = 1000，accretion-disk.js 的 12 段 easeInOutCubic。 */
        var DURATION = 1000
        var STEPS = 12
        /* 小于这个像素差视为没动：不排动画，避免一次亚像素抖动也起一段过渡。 */
        var STILL = 1
        /* 运镜途中的最暗点。黑洞是「可见 → 变淡 → 停泊在淡态」，卡片落地必须回到可读的
           实态，所以只做一次浅呼吸（中点 0.86），不落到黑洞那个浓度。 */
        var DIM = 0.86

        var disposed = false
        var frame = 0
        var phase = null
        var heroAt = null
        var dockAt = null
        var running = null
        var observer = null

        /* 相位有两个来源，按可靠性排序：会话根 div 的 data-phase（样式表也认它），
           其次是 body 上的 data-content-phase（宿主给 paint 用的同一份事实）。 */
        function readPhase() {
            var root = document.querySelector(PHASE)
            if (root !== null) {
                var value = root.getAttribute('data-phase')
                if (value !== null && value !== '') return value
            }
            if (document.body !== null) return document.body.getAttribute('data-content-phase')
            return null
        }

        function cardOf() { return document.querySelector(CARD) }

        /* 动画施加在卡片的父节点上。卡片自己带 transform 时会成为层叠上下文，::before
           （z-index: -1 的模糊背板）就从卡片背景之下翻到之上 —— 运镜中整卡偏亮、落位时
           突然变暗，正是用户 2026-11-03 报的那一下。父节点没有背景也没有伪元素，带 transform
           只移动盒子，背板仍画在卡片背景之下。位移量按卡片 rect 算、施加在父节点上：
           两者同处一个坐标系，平移量相同。 */
        function stageOf(node) {
            var parent = node.parentElement
            if (parent === null || typeof parent.animate !== 'function') return node
            return parent
        }

        function boxOf(node) {
            var box = node.getBoundingClientRect()
            return { top: box.top, left: box.left }
        }

        /* 与 accretion-disk.js 里那条 e 逐字同式：中点才到半程，两端都慢。 */
        function ease(k) {
            return k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2
        }

        /* 关键帧里的长度取到 0.01px，并把浮点残渣吞成 0：终点要是 -7.8e-15px，落点就不精确。 */
        function px(v) {
            return (Math.abs(v) < 0.005 ? 0 : Math.round(v * 100) / 100) + 'px'
        }

        /* 记下当前相位的落点。动画进行中一律不记：getBoundingClientRect 读的是被 transform
           挪过的位置，那不是布局真值，记下来下一段动画会从错误的起点出发。 */
        function remember() {
            if (running !== null) return
            var node = cardOf()
            if (node === null) return
            if (phase === 'hero') heroAt = boxOf(node)
            else if (phase === 'active') dockAt = boxOf(node)
        }

        function flush() {
            frame = 0
            if (disposed) return
            remember()
        }

        function schedule() {
            if (frame !== 0 || disposed) return
            frame = window.requestAnimationFrame(flush)
        }

        function reduced() {
            return document.body !== null && document.body.getAttribute('data-uni-motion') === 'reduced'
        }

        function play(from) {
            var node = cardOf()
            if (node === null || from === null) return
            var to = boxOf(node)
            /* 这一帧的 to 是布局真值（animate 还没生效）。顺手记成反向运镜的起点：
               用户发完消息 1 秒内就点回新会话，也不必等 onfinish 那一帧。 */
            if (phase === 'active') dockAt = to
            else if (phase === 'hero') heroAt = to
            var dx = from.left - to.left
            var dy = from.top - to.top
            if (Math.abs(dx) < STILL && Math.abs(dy) < STILL) return
            if (reduced()) return
            if (running !== null) running.cancel()
            var keys = []
            for (var i = 0; i <= STEPS; i += 1) {
                var k = i / STEPS
                var e = ease(k)
                /* 全程可见：起点 1、中点 DIM、终点 1。黑洞是运镜中逐渐变淡并停泊在淡态，
                   卡片落地却必须是可读的实态，所以这里只借它的节奏，不借它的终态浓度。 */
                var dim = 1 - (1 - DIM) * Math.sin(Math.PI * e)
                keys.push({
                    transform: 'translate3d(' + px(dx * (1 - e)) + ', ' + px(dy * (1 - e)) + ', 0)',
                    opacity: Math.round(dim * 1000) / 1000,
                    offset: k,
                    easing: 'linear'
                })
            }
            var animation = stageOf(node).animate(keys, { duration: DURATION, easing: 'linear', fill: 'none' })
            running = animation
            /* 结束/取消都只清自己：cancel 事件是异步派发的，旧动画不能在下一段开始之后
               把 running 抹掉，否则 remember() 会把被 transform 挪过的矩形记成布局真值。 */
            animation.onfinish = function () { if (running === animation) running = null; schedule() }
            animation.oncancel = function () { if (running === animation) running = null }
        }

        function enter(next) {
            var prev = phase
            phase = next
            if (prev === null || prev === next) { schedule(); return }
            if (next === 'active') { play(heroAt); heroAt = null }
            else if (next === 'hero') { play(dockAt); dockAt = null }
            /* 中间相（settling 等）不是翻页：旧起点作废，免得下一次 active 从过期位置飞来。 */
            else { heroAt = null; dockAt = null }
            schedule()
        }

        function onMutations() {
            if (disposed) return
            var next = readPhase()
            if (next !== phase) { enter(next); return }
            if (phase === 'hero') schedule()
        }

        function onFrameTrigger() { schedule() }

        observer = new MutationObserver(onMutations)
        observer.observe(document.body || document.documentElement, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['data-phase', 'data-content-phase']
        })

        document.addEventListener('input', onFrameTrigger, true)
        window.addEventListener('resize', onFrameTrigger)

        phase = readPhase()
        remember()

        return function () {
            if (disposed) return
            disposed = true
            if (frame !== 0) window.cancelAnimationFrame(frame)
            frame = 0
            if (observer !== null) observer.disconnect()
            observer = null
            document.removeEventListener('input', onFrameTrigger, true)
            window.removeEventListener('resize', onFrameTrigger)
            if (running !== null) { running.cancel(); running = null }
        }
    }
