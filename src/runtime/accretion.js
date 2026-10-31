/* Private factory input; concatenated by CLIENT_FILES, not a public module. */
    /* 会话行 Running —— 吸积流（2026-10-31 第五十三轮，第三稿）
     *
     * 用户规格（m00361 第八节，参数逐字）：一个绿点，尾流必须由绿点自己走过的轨迹实时
     * 生成 —— 不许预绘螺旋、圆环、吸积盘、光晕。这一条直接判掉了 CSS 关键帧：关键帧能做
     * 的只是把一张画好的图整体 rotate + scale，尾巴永远是假的。
     *
     * 第二稿（用户 m00391）：「我要的是绿点从出现到消失的所有轨迹」。于是尾巴不再是固定
     * 4px，而是每帧从头部一路采回 u = 0（本轮出生点），重生瞬间归零重画；轨迹按弧长均分
     * 成六段，段号即年龄 —— 0 号是头部，越老越淡、越细。末尾读出来是一圈多的暗绿螺旋，
     * 头部仍是唯一亮点。「越靠近中心越亮」不是另外画上去的渐变：半径本来就随 u 单调减小，
     * 弧长即年龄。
     *
     * 第三稿（用户 m00986，隐式吸积中心）：**中心不画任何东西**。原本画在 svg background
     * 上的 2px 暗核撤掉，中心点 (7, 7) 只剩一个约定 —— 没有圆心实体，引力中心完全由
     * 「点越转越快、越转越靠内、最后被吃掉」这一个动作暗示。落点因此收到 r = 1.0：没有
     * 暗核挡在中心，点可以一直落到虚空中再熄灭，2.4 那个悬空小圈不能留。
     *
     * 坐标系：官方那枚 svg 显示 14×14、viewBox 0 0 24 24，两枚圆 r=9.5 都在 24 空间里。
     * 图元画在一个 transform: scale(24/14) 的 g 里，组内 1 单位正好等于 14px 下的 1px，
     * 所以下面所有数字都可以直接按「屏幕像素」读。
     *
     * 尺寸（2026-10-31 第五十四轮，用户 m00896 选 A）：官方那环在 14px 下外径 11.08px、
     * 线宽 1.17px，第一稿外径 10px、线宽只有 0.7 起，装上去被指出「又小又细」。盒子是
     * 官方尺寸、主题不改，所以只能在盒内画满：外半径 6.2、点直径 2.2、尾宽 1.15 → 0.5。
     * 外径 12.4px 略大于官方环，线宽与它齐平，读起来是同一个眼熟的尺寸。
     *
     * 运动：r(u) = 6.2 − 5.2u 线性落到 r = 1.0；方位角 φ(u) = 2π·1.5·(0.35u + 0.65u²)，
     * 全程 540°，且角速度随内落变快（φ′ 从 0.35 长到 1.65）。匀速整圈转是 pending 的
     * 语言，这里必须越接近中心越快 —— 两个状态在 14px 下的分界就在这里。
     *
     * 退场（用户 m00999 选 B）：u 进到 0.8 之后按年龄级联熄灭 —— 头部先熄，越老的尾段
     * 越晚熄，最后整条归零。整条一起淡会被读成「整个图标闪了一下」，级联才读成「被吞」。
     * 熄灭只压不透明度，宽度与颜色不动；熄灭的不透明度用 stroke-opacity 属性去乘样式表
     * 给的那一层年龄段不透明度，两者是乘法关系，互不覆盖。
     *
     * 兜底：prefers-reduced-motion 或主题动效开关关掉时（client.js 写成
     * body[data-uni-motion='reduced']）不跑 rAF，只画一帧 —— 绿点停在轨迹上的 u = 0.6，
     * 身后是从出生点到该点的完整尾迹（用户 m00999 同轮定案：静态帧要能读出那条向内收紧
     * 的螺旋，只留一个孤点等于什么也没说）。
     *
     * 挂在哪：复用现有 universe: paint layer 那个 effect（cli.11d 钉了恰好九个），
     * 不新增 effect。官方那两枚圆在样式表里藏掉，这一格的字形全部由这里写。
     */

    /* 14px 设计稿坐标 → 官方 24 空间的缩放（24 / 14）。 */
    var UNI_ACC_K = 24 / 14
    var UNI_ACC_CYCLE = 1300
    var UNI_ACC_R0 = 6.2
    /* 第三稿的落点：没有暗核挡在中心，点要一直落到虚空里再熄灭。 */
    var UNI_ACC_R1 = 1
    var UNI_ACC_DOT = 1.1
    /* 采样上限：全程 540°、落程 5.2px，实测轨迹 28.96px、34 点（大步长时更少），
       留足余量给内圈那段更密的采样。 */
    var UNI_ACC_SAMPLES = 56
    var UNI_ACC_STEP = 0.9
    /* 六段就是六个年龄段。宽度与不透明度写在样式表里（uni-acc-t0 … t5），淡下去靠
       不透明度，不是换颜色 —— 整个状态只有一枚绿色令牌。 */
    var UNI_ACC_BANDS = 6
    /* 级联熄灭：u 过 0.8 开始收，头部立刻走，最老那段晚 UNI_ACC_FADE_STAGGER 才起步。
       每段各自的熄灭进度 = (death − rank·stagger) / (1 − stagger)，所以 death = 1 时整条为零。 */
    var UNI_ACC_FADE_FROM = 0.8
    var UNI_ACC_FADE_STAGGER = 0.45
    /* 兜底那一帧的相位（14px 设计坐标）：u = 0.6 即 r = 3.08。 */
    var UNI_ACC_STILL_U = 0.6

    /* 纯几何，无副作用：tests 直接 eval 这一个文件后调用它来钉参数。
       返回 14px 设计坐标下的点。 */
    function uniAccretionAt(u) {
        var r = UNI_ACC_R0 + (UNI_ACC_R1 - UNI_ACC_R0) * u
        var phi = Math.PI * 2 * 1.5 * (0.35 * u + 0.65 * u * u) - Math.PI / 2
        return { u: u, r: r, phi: phi, x: 7 + r * Math.cos(phi), y: 7 + r * Math.sin(phi) }
    }

    /* 某一老段在熄灭进度 death 时还剩多少。rank = 0 是头部，rank = 1 是最老的那段。
       头部从 death = 0 就开始掉，最老那段等到 death = STAGGER 才动，两者同速走到 death = 1
       一起归零 —— 于是最后消失的是外圈那一点余痕，读作「流已经被吞完」。 */
    function uniAccretionWeight(death, rank) {
        if (death <= 0) return 1
        var start = rank * UNI_ACC_FADE_STAGGER
        if (death <= start) return 1
        var left = 1 - (death - start) / (1 - UNI_ACC_FADE_STAGGER)
        return left > 0 ? left : 0
    }

    /* 局部线速度（px / 单位相位）：把采样步长换算成固定的弧长间隔。内圈走得快，步长就得
       小，否则同样的点数在外圈铺得开、在内圈挤成一团。 */
    function uniAccretionSpeed(u) {
        var here = uniAccretionAt(u)
        var back = uniAccretionAt(Math.max(0, u - 1e-4))
        return Math.hypot(here.x - back.x, here.y - back.y) / 1e-4
    }

    /* 这一轮走过的全部轨迹：从头部一路采回出生点 u = 0。重生时 u 归零，轨迹自然从零长起。 */
    function uniAccretionTrail(u) {
        var points = [uniAccretionAt(u)]
        var at = u
        while (points.length < UNI_ACC_SAMPLES && at > 0) {
            var span = UNI_ACC_STEP / Math.max(uniAccretionSpeed(at), 1e-6)
            var next = Math.max(0, at - Math.max(span, 1e-5))
            if (next === at) break
            points.push(uniAccretionAt(next))
            at = next
        }
        /* 末点必须落在出生点上，否则螺旋在起手处被截成一条不封口的线。 */
        if (at > 0) points.push(uniAccretionAt(0))
        return points
    }

    /* 折线总长：把六段均分到「当前这一条轨迹」上，轨迹短时每段也短，不会出现空段。 */
    function uniAccretionLength(points) {
        var total = 0
        for (var i = 1; i < points.length; i += 1) {
            total += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y)
        }
        return total
    }

    /* 把折线截成「距头部 from..to 弧长」的一段。两端都做线性插值，所以六段之间没有断口，
       也不会因为采样点落在区间外而丢掉一整截。 */
    function uniAccretionSlice(points, from, to) {
        var total = 0
        var out = []
        for (var i = 1; i < points.length; i += 1) {
            var a = points[i - 1]
            var b = points[i]
            var len = Math.hypot(b.x - a.x, b.y - a.y)
            var start = total
            total += len
            if (total <= from || start >= to) continue
            var span = len === 0 ? 1 : len
            var t0 = Math.max(0, (from - start) / span)
            var t1 = Math.min(1, (to - start) / span)
            if (out.length === 0) {
                out.push({ x: a.x + (b.x - a.x) * t0, y: a.y + (b.y - a.y) * t0 })
            }
            /* 相邻两段共享端点：上一段已经推过同一个点，这里再推一次就会在 d 里留下零长
               线段，配 stroke-linecap: round 会被画成一枚直径等于笔宽的圆点 —— 整条尾巴
               因此读成珠链而不是一条线。所以只在点真的变了才推。 */
            var end = { x: a.x + (b.x - a.x) * t1, y: a.y + (b.y - a.y) * t1 }
            var last = out[out.length - 1]
            if (end.x !== last.x || end.y !== last.y) out.push(end)
        }
        if (out.length < 2) return ''
        var d = 'M' + out[0].x.toFixed(2) + ' ' + out[0].y.toFixed(2)
        for (var k = 1; k < out.length; k += 1) {
            d += 'L' + out[k].x.toFixed(2) + ' ' + out[k].y.toFixed(2)
        }
        return d
    }

    function mountAccretion() {
        if (typeof document === 'undefined' || typeof window === 'undefined') return undefined
        if (typeof window.requestAnimationFrame !== 'function') return undefined

        var SEL = "svg[data-state='ongoing']"
        var SVG_NS = 'http://www.w3.org/2000/svg'
        var rows = []
        var raf = 0
        var ticks = 0
        var dirty = true
        var disposed = false
        var observer = null
        var pref = null

        /* 与 theme.css 的兜底规则同源：一个属性决定跑还是停。 */
        var isReduced = function () {
            return document.body !== null && document.body.dataset !== undefined &&
                document.body.dataset.uniMotion === 'reduced'
        }

        var make = function (name, attrs) {
            var el = document.createElementNS(SVG_NS, name)
            for (var key in attrs) {
                if (Object.prototype.hasOwnProperty.call(attrs, key)) el.setAttribute(key, attrs[key])
            }
            return el
        }

        /* 一次装配：一个缩放组 + 六段尾巴 + 一个绿点。官方那两枚圆被样式表藏起来，这里只
           需要往同一个 svg 里追加；宿主复用节点时靠 rows 里的记录认出同一行，不会重复装配。 */
        var attach = function (svg) {
            var g = make('g', { class: 'uni-acc', transform: 'scale(' + UNI_ACC_K + ')' })
            var tails = []
            for (var i = 0; i < UNI_ACC_BANDS; i += 1) {
                var band = make('path', { class: 'uni-acc-t' + i })
                tails.push(band)
                g.appendChild(band)
            }
            var dot = make('circle', { class: 'uni-acc-dot', r: UNI_ACC_DOT })
            g.appendChild(dot)
            svg.appendChild(g)
            return { svg: svg, g: g, tails: tails, dot: dot, born: nowMs() }
        }

        /* 每行自己的出生时刻：用户要的是「绿点从出现到消失」的一整轮，所以行的相位必须
           从它自己挂上来的那一刻算起 —— 用全局面包时间的话，中途出现的行会从半空开始掉。 */
        var nowMs = function () {
            return typeof performance !== 'undefined' && typeof performance.now === 'function'
                ? performance.now()
                : Date.now()
        }

        var draw = function (row, points, death) {
            var total = uniAccretionLength(points)
            for (var i = 0; i < row.tails.length; i += 1) {
                var from = total * (i / row.tails.length)
                var to = total * ((i + 1) / row.tails.length)
                row.tails[i].setAttribute('d', total < 0.4 ? '' : uniAccretionSlice(points, from, to))
                /* 熄灭按年龄分流：样式表那层 opacity 是年龄段自己的亮度，这里用
                   stroke-opacity 再乘一个退场权重 —— 两个 opacity 相乘，不互相覆盖。 */
                var rank = row.tails.length > 1 ? i / (row.tails.length - 1) : 0
                row.tails[i].setAttribute('stroke-opacity', uniAccretionWeight(death, rank).toFixed(3))
            }
            var head = points[0]
            row.dot.setAttribute('cx', head.x.toFixed(2))
            row.dot.setAttribute('cy', head.y.toFixed(2))
            /* 头部是 rank = 0，永远第一个熄 —— 点没了、尾还在收，才读得出「被吞」。 */
            row.dot.style.opacity = uniAccretionWeight(death, 0).toFixed(3)
        }

        /* 一轮的进度 → 两件事：整体的淡入（进场的 0.06）与熄灭进度 death（0.8 之后）。
           整组 opacity 只管进场；退场交给逐段的 stroke-opacity，两者不打架。 */
        var paint = function (row, u) {
            var fadeIn = u < 0.06 ? u / 0.06 : 1
            var death = u <= UNI_ACC_FADE_FROM ? 0 : (u - UNI_ACC_FADE_FROM) / (1 - UNI_ACC_FADE_FROM)
            row.g.style.opacity = fadeIn.toFixed(3)
            draw(row, uniAccretionTrail(u), death > 1 ? 1 : death)
        }

        /* 兜底形态：不跑时间轴，直接给一帧静态 —— 停在轨迹上的 u = 0.6（r = 3.08），
           身后是从出生点一路走到这里的完整尾迹。留着整条尾迹，静态帧才还能读出那条向内
           收紧的螺旋；只留一个孤点等于什么也没说。它仍然是同一条曲线，不是另画的圆。 */
        var paintStill = function (row) {
            draw(row, uniAccretionTrail(UNI_ACC_STILL_U), 0)
        }

        var sync = function () {
            var live = document.querySelectorAll(SEL)
            var next = []
            for (var i = 0; i < live.length; i += 1) {
                var svg = live[i]
                var found = null
                for (var j = 0; j < rows.length; j += 1) {
                    if (rows[j].svg === svg) { found = rows[j]; break }
                }
                /* 认的是「同一个 svg 节点 + 我们那组图元还挂在它身上」。宿主重渲染可能把子节点
                   一起抹掉却复用节点本身，只按节点身份认会认下一个空壳 —— 那一格就永久空白了。 */
                if (found !== null && found.g.parentNode !== svg) found = null
                if (found === null) found = attach(svg)
                next.push(found)
            }
            rows = next
        }

        var tick = function (now) {
            raf = 0
            if (disposed) return
            ticks += 1
            /* 每帧 querySelectorAll 太贵：变更由 observer 打脏，另外每 30 帧兜一次，
               防止有行是「没有 childList 变化」地被复用出来的。 */
            if (dirty || ticks % 30 === 0) { dirty = false; sync() }
            var still = isReduced()
            for (var i = 0; i < rows.length; i += 1) {
                var row = rows[i]
                if (row.svg.isConnected === false) continue
                if (still) paintStill(row)
                else paint(row, ((now - row.born) % UNI_ACC_CYCLE) / UNI_ACC_CYCLE)
            }
            /* 静态形态只需要一帧；动态形态一直排下去。 */
            if (!still) raf = window.requestAnimationFrame(tick)
        }

        var kick = function () {
            if (disposed) return
            dirty = true
            sync()
            if (raf === 0) raf = window.requestAnimationFrame(tick)
        }

        if (typeof MutationObserver === 'function') {
            observer = new MutationObserver(function () { kick() })
            /* data-state 是属性，不是子节点：只盯 childList 的话，pending → ongoing 这一次
               翻动要等兜底那 30 帧才被看见，而这期间样式表已经把官方的环藏了 —— 那一格会
               空半秒。所以同一个 observer 连这个属性一起盯。 */
            observer.observe(document.documentElement, {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: ['data-state']
            })
            /* 动效开关写在 body 的属性上；单开一个只盯这一个属性的。 */
            if (document.body !== null) {
                pref = new MutationObserver(function () { kick() })
                pref.observe(document.body, { attributes: true, attributeFilter: ['data-uni-motion'] })
            }
        }

        sync()
        kick()

        return function () {
            disposed = true
            if (raf !== 0) window.cancelAnimationFrame(raf)
            raf = 0
            if (observer !== null) observer.disconnect()
            if (pref !== null) pref.disconnect()
            observer = null
            pref = null
            for (var i = 0; i < rows.length; i += 1) {
                var g = rows[i].g
                if (g.parentNode !== null) g.parentNode.removeChild(g)
            }
            rows = []
        }
    }
