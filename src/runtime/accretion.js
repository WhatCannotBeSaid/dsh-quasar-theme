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
     * 坐标系：官方那枚 svg 的 viewBox 是 0 0 24 24，两枚圆 r=9.5 都在 24 空间里。图元画在
     * 一个 transform: scale(24/14) 的 g 里。第五十七轮把 svg 的显示尺寸从 14px 提到 16px
     * （盒子放大、scale 属性不动），于是组内 1 单位 = 16/14 = 1.143 CSS px —— 下面那些数字
     * 仍按 14px 设计稿读，屏幕上整体乘 1.143。
     *
     * 尺寸（2026-10-31 第五十四轮，用户 m00896 选 A）：官方那环在 14px 下外径 11.08px、
     * 线宽 1.17px，第一稿外径 10px、线宽只有 0.7 起，装上去被指出「又小又细」。第五十七轮
     * 用户再指出「还是比官方小」，于是盒子提到 16px：外径 13.55 → 15.5px、点直径 2.51px，
     * 明显大过官方那环的 12.25px。槽位本来就是 16×20，盒子占满宽度但不出格。
     *
     * 运动：r(u) = 6.2 − 5.2u 线性落到 r = 1.0；方位角 φ(u) = 2π·1.5·(0.35u + 0.65u²)，
     * 全程 540°，且角速度随内落变快（φ′ 从 0.35 长到 1.65）。匀速整圈转是 pending 的
     * 语言，这里必须越接近中心越快 —— 两个状态在 14px 下的分界就在这里。
     *
     * 退场（用户 m00999 选 B，第五十七轮补留底）：u 进到 0.8 之后按年龄级联熄灭 —— 头部
     * 先熄，越老的尾段越晚熄。整条一起淡会被读成「整个图标闪了一下」，级联才读成「被吞」。
     *
     * 第五十七轮（用户 m01091：「光点消失到再出现会有一瞬间全黑」）：级联不再归零。最后一圈
     * 里第 i 段的亮度 = 年龄亮度 × 级联权重，只有最老那段例外 —— 它从年龄亮度 .04 一路升到
     * --uni-acc-floor，正好停在出生点上；下一轮整组的进场淡入又从同一个 floor 起步。
     *
     * 但只做这一条不够：头段归零时点也一起归零（weight 的 rank 0），于是 u ≈ 0.91 之后
     * 117ms 里屏幕上只剩最老那段 5.5px 长、0.7px 宽、亮度 .22 的弧 —— 16px 下读不出东西，
     * 用户当场回报「还是有一瞬的全黑」（m01217）。第二稿只让尾巴留底，忘了粒子本身也在
     * 归零。所以现在分开算：段按级联熄（谁先被吞），点按自己的落程收到 floor（粒子一直
     * 亮到落底）—— 点与出生点那抹余温在同位置、同亮度交接，这才是真正的无缝。
     *
     * 为什么亮度全部改由这里写：floor 没法用「样式表 .04 × stroke-opacity ≤ 1」表达（要
     * .34 就得乘 8.5）。所以样式表只管笔宽与颜色，每段的有效不透明度一律由这个文件算，
     * 年龄段亮度表就是下面的 UNI_ACC_AGE。
     *
     * 兜底：prefers-reduced-motion 或主题动效开关关掉时（client.js 写成
     * body[data-uni-motion='reduced']）不跑 rAF，只画一帧 —— 绿点停在轨迹上的 u = 0.6，
     * 身后是从出生点到该点的完整尾迹（用户 m00999 同轮定案：静态帧要能读出那条向内收紧
     * 的螺旋，只留一个孤点等于什么也没说）。
     *
     * 第六十轮（用户 m01412：「绿点从最外圈进到内圈后消失，然后外圈重新出现绿点……
     * 看起来突然从内圈跳到外圈」）。这是单粒子的固有代价：同一时刻只有一个亮点，且它要从
     * 最里圈瞬移回最外圈，眼睛会后退着跟一次 saccade。亮度上怎么留底都盖不住，因为盖不住
     * 的是「位置的主体」。grilling 定下的解法（m01416 选 B）：只在交接处交叠 —— 一轮走完后，
     * 上一轮的整幅终态（六段螺旋；中心那颗点在第六十二轮拿掉，m01745）在画面上多留
     * UNI_ACC_HANDOFF 轮，同时新一轮的
     * 点已经从外圈亮起来。于是交接那段里画面上有「一颗刚落到中心、一颗刚从外圈起步」两个
     * 主体，不存在瞬移。时序上新点先按 78ms 快速登场（读作「又落进来一颗」），旧点保持原亮
     * 度再淡出（m01423 选 A）；不做总亮度守恒，那是交叉淡入，会被读成「点从中心滑向外圈」，
     * 与吸积语义相反。旧一代的尾流在窗口里退成背景纹理（m01426 选 B）；第六十一轮起它不再
     * 额外乘系数，而是直接沿用自己收尾时的逐段亮度，否则那条尾巴会在接缝处被抬亮。
     *
     * 终态那一幅不需要每帧重算：它就是 u = 1 时的六段折线，几何永远是同一条曲线，所以在
     * uniAccretionGhostD 里算一次缓存起来；窗口里只改整组 opacity。第一轮不画它 —— 进站
     * 之前没有「上一轮」可以留。
     *
     * 第六十一轮（用户 m01488，m01544 撤销）：试过把亮点挪离两端（登场段 0.06 → 0.30、两端
     * 亮度压到 floor × 0.5），用户看过后指出真正的问题在别处 ——「绿点走完全程后它所走过的
     * 轨迹会突然亮一下再变暗」，那正是下面那条留底抬升在收尾时把暗尾巴抬到 floor 造成的。
     * 于是登场时机与端点亮度都退回原值，另修抬升（见 uniAccretionBandAlpha）。
     *
     * 挂在哪：复用现有 universe: paint layer 那个 effect（cli.11d 钉了恰好九个），
     * 不新增 effect。官方那两枚圆在样式表里藏掉，这一格的字形全部由这里写。
     */

    /* 14px 设计稿坐标 → 官方 24 空间的缩放（24 / 14）。盒子第五十七轮提到 16px 之后
       这个比值不动：盒子涨多少，屏幕上所有图元就整体乘多少（16/14 = 1.143）。 */
    var UNI_ACC_K = 24 / 14
    /* 官方 svg 的显示尺寸（CSS px）。只用于自检与注释对账，真正的放大写在样式表的
       width / height 上。 */
    var UNI_ACC_BOX = 16
    var UNI_ACC_CYCLE = 1300
    var UNI_ACC_R0 = 6.2
    /* 第三稿的落点：没有暗核挡在中心，点要一直落到虚空里再熄灭。 */
    var UNI_ACC_R1 = 1
    var UNI_ACC_DOT = 1.1
    /* 采样上限：全程 540°、落程 5.2px，实测轨迹 28.96px、34 点（大步长时更少），
       留足余量给内圈那段更密的采样。 */
    var UNI_ACC_SAMPLES = 56
    var UNI_ACC_STEP = 0.9
    /* 六段就是六个年龄段。笔宽写在样式表里（uni-acc-t0 … t5），有效不透明度写在这里：
       淡下去靠不透明度，不是换颜色 —— 整个状态只有一枚绿色令牌。 */
    var UNI_ACC_BANDS = 6
    /* 年龄段亮度（头 → 尾）。第五十七轮之前这六个数在样式表的 opacitiy 里，现在搬到这里，
       因为最老那段要能在结束时升到 floor，而「素材 × 权重」这种乘法表达不了抬升。 */
    var UNI_ACC_AGE = [0.55, 0.34, 0.2, 0.12, 0.07, 0.04]
    /* 留底亮度：样式表 --uni-acc-floor 是唯一真源（暗 .34 / 亮 .42），这里只是拿不到
       计算值时的兜底。readFloor 在装配与主题切换时读一次。 */
    var UNI_ACC_FLOOR_FALLBACK = 0.34
    /* 级联熄灭：u 过 0.8 开始收，头部立刻走，最老那段晚 UNI_ACC_FADE_STAGGER 才起步。
       每段各自的熄灭进度 = (death − rank·stagger) / (1 − stagger)，所以 death = 1 时整条为零。 */
    var UNI_ACC_FADE_FROM = 0.8
    var UNI_ACC_FADE_STAGGER = 0.45
    /* 兜底那一帧的相位（14px 设计坐标）：u = 0.6 即 r = 3.08。 */
    var UNI_ACC_STILL_U = 0.6
    /* 残影层淡出的长度：占一轮的前 55%（约 715ms）。再长就变成常驻螺旋，再短则新一轮的
       亮线还没来得及盖住内圈就先暗掉，衔接又断。 */
    var UNI_ACC_RESIDUE_FADE = 0.55
    /* 点的登场段：占一轮的前 6%（约 78ms）。它从 floor 长到满亮，正好接住上一轮落在 floor
       上的那一点 —— 出生与落底用的是同一个亮度，交接处不跳。 */
    var UNI_ACC_BORN = 0.06
    /* 交接窗口：一轮走完之后，上一轮的终态在画面上多留这么多（0.22 轮 ≈ 286ms），同时新一轮
       的点已经从外圈起步。这就是「两代同屏」的全部时长 —— 其余时间仍然只有一颗点在内旋。 */
    /* 收尾系数：走完一轮时每一段只保留自己年龄亮度的这么多（等比压暗，绝不抬升）。
       这个值同时是交接窗口里那幅「上一轮终态」的亮度，所以窗口两端逐段相等。 */
    var UNI_ACC_END = 0.35
    /* 交接窗口里旧一代尾流的等比压暗系数（m01426 选 B）。selfcheck 的 acc.2 把它钉在 0.45；
       声明缺失时下面按段计亮的那行读到 undefined，整条吸积流算出 NaN。 */
    var UNI_ACC_HANDOFF_DIM = 0.45
    /* 终态六段折线的路径串缓存（见 uniAccretionGhostD）。 */
    var UNI_ACC_GHOST_D = null

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

    /* 某一段在熄灭进度 death 时的有效不透明度（0..1）：年龄亮度乘一个收尾系数。
        收尾系数从 1 走到 UNI_ACC_END，于是每一段都只是**等比压暗**，永远不会有任何一段比
        它前一帧更亮 —— 这正是用户 m01544 指出的那个毛病：旧写法把所有段插值到 floor，走过
        的内圈 0.04 会被抬到 0.34（8.5 倍），点落底那一刻整条轨迹突然亮成一条均匀暗绿，再
        被残影淡掉。抬升这个动作现在根本不存在。
        级联仍在：头部先压、越老越晚，最后停在 UNI_ACC_END × 自身的年龄亮度上 —— 这个值正是
        交接窗口里那幅「上一轮终态」的逐段亮度，所以接缝处两帧逐段相等。 */
    function uniAccretionBandAlpha(index, death) {
        var last = UNI_ACC_BANDS - 1
        var pick = index < 0 ? 0 : index > last ? last : index
        var rank = last > 0 ? pick / last : 0
        var left = UNI_ACC_END + (1 - UNI_ACC_END) * uniAccretionWeight(death, rank)
        return UNI_ACC_AGE[pick] * left
    }

    /* 光点自己的散场 / 登场：两头都停在 floor 上，中间才有满亮的头部亮度。
        尾巴按 rank 级联（头段先熄），点不能跟着头段一起归零 —— 它是这一轮唯一的粒子，也是
        用户眼里唯一在动的东西，必须一路亮到落底。出生与收尾用同一个值，交接处因此没有亮度
        跳变。中途取 born 与 dying 的较小者，保证任意时刻都是「刚好那一档」。 */
    function uniAccretionDotAlpha(u, death, floor) {
        var age = UNI_ACC_AGE[0]
        var born = u < UNI_ACC_BORN ? u / UNI_ACC_BORN : 1
        var dying = 1 - death
        var lit = born < dying ? born : dying
        var out = floor + (age - floor) * lit
        return out < 0 ? 0 : out > 1 ? 1 : out
    }

    /* 交接层：上一轮走完的那条螺旋，在新一轮开头仍留在画面上，逐段从「它自己收尾时的亮度」
        淡出到 0。
        没有它，交接处就是一次「几何清零」—— 点走到中心，下一帧整条折线的 d 变成空串，
        螺旋瞬间消失、再从头长出来，那正是用户 m01308 说的「没有连贯感、还是有中断」。
        它的几何是写死的整条曲线（六段，见 uniAccretionGhostD），每帧只改六条 opacity，不进
        d 的重算，代价几乎为零。
        u = 0 时它逐段等于上一轮 u = 1 停住的亮度（uniAccretionBandAlpha(i, 1)）—— 同一条
        曲线、同一组坐标、逐段同一个数，于是交接那一帧的画面完全不变。
        第六十一轮把它从「一条均匀 floor 的弧」改成「逐段各自的收尾亮度」：均匀那版会在接缝
        处把本该很淡的旧段落拉亮，整条轨迹闪一下（用户 m01544「走完全程后轨迹会突然亮一下
        再变暗」）。现在它只可能比上一帧更暗。 */
    function uniAccretionHandoffAlpha(index, u) {
        if (u >= UNI_ACC_RESIDUE_FADE) return 0
        var left = 1 - u / UNI_ACC_RESIDUE_FADE
        return uniAccretionBandAlpha(index, 1) * left * left
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

    /* 整条曲线按年龄切成的六截（u = 1 时的那条螺旋）。交接层画的就是这一幅，几何每轮都
       一样，所以算一次缓存起来；每帧只改六条 stroke-opacity，不进 d 的重算。
       第六十一轮起它同时承担「形状不闪」与「上一代不走」两件事，原来那条单独的整曲线残影
       路径因此被删掉 —— 同一条曲线不必画两遍。 */
    function uniAccretionGhostD() {
        if (UNI_ACC_GHOST_D === null) {
            var full = uniAccretionTrail(1)
            var total = uniAccretionLength(full)
            var out = []
            for (var i = 0; i < UNI_ACC_BANDS; i += 1) {
                out.push(uniAccretionSlice(full, total * (i / UNI_ACC_BANDS), total * ((i + 1) / UNI_ACC_BANDS)))
            }
            UNI_ACC_GHOST_D = out
        }
        return UNI_ACC_GHOST_D
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
        /* 留底亮度与明暗档绑定，只在装配与主题/动效开关变化时读一次 —— 读计算样式按帧做
           太贵，而这两档切换本来就会翻 body 上的属性。 */
        var floor = UNI_ACC_FLOOR_FALLBACK
        var floorDirty = true

        /* 样式表 --uni-acc-floor 是真源；拿不到（早期帧、样式未挂）就退回兜底值。 */
        var readFloor = function () {
            floorDirty = false
            if (typeof getComputedStyle !== 'function' || document.body === null) {
                floor = UNI_ACC_FLOOR_FALLBACK
                return
            }
            var raw = getComputedStyle(document.body).getPropertyValue('--uni-acc-floor')
            var num = parseFloat(raw)
            floor = isFinite(num) && num >= 0 && num <= 1 ? num : UNI_ACC_FLOOR_FALLBACK
        }

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
            /* 交接层：先画它、压在最下层，让新一轮的亮线盖在上面。几何写死（u = 1 的六段）
               + 落在中心的那颗点；每帧只改六条的 stroke-opacity 与那颗点的 opacity。
               它就排在六段尾巴之前，所以同一条曲线不会画两遍。 */
            var ghost = make('g', { class: 'uni-acc-ghost' })
            var ghostTails = []
            var ghostD = uniAccretionGhostD()
            for (var k = 0; k < UNI_ACC_BANDS; k += 1) {
                var ghostBand = make('path', { class: 'uni-acc-t' + k, d: ghostD[k] })
                ghostTails.push(ghostBand)
                ghost.appendChild(ghostBand)
            }
            ghost.style.display = 'none'
            g.appendChild(ghost)
            var tails = []
            for (var i = 0; i < UNI_ACC_BANDS; i += 1) {
                var band = make('path', { class: 'uni-acc-t' + i })
                tails.push(band)
                g.appendChild(band)
            }
            var dot = make('circle', { class: 'uni-acc-dot', r: UNI_ACC_DOT })
            g.appendChild(dot)
            svg.appendChild(g)
            return {
                svg: svg,
                g: g,
                ghost: ghost,
                ghostTails: ghostTails,
                tails: tails,
                dot: dot,
                born: nowMs()
            }
        }

        /* 每行自己的出生时刻：用户要的是「绿点从出现到消失」的一整轮，所以行的相位必须
           从它自己挂上来的那一刻算起 —— 用全局面包时间的话，中途出现的行会从半空开始掉。 */
        var nowMs = function () {
            return typeof performance !== 'undefined' && typeof performance.now === 'function'
                ? performance.now()
                : Date.now()
        }

        var draw = function (row, points, death, u) {
            var total = uniAccretionLength(points)
            for (var i = 0; i < row.tails.length; i += 1) {
                var from = total * (i / row.tails.length)
                var to = total * ((i + 1) / row.tails.length)
                row.tails[i].setAttribute('d', total < 0.4 ? '' : uniAccretionSlice(points, from, to))
                /* 有效不透明度全部在这里写：样式表那层年龄段亮度已经搬进 UNI_ACC_AGE，
                   收尾时每段只做等比压暗，所以不能再靠「CSS × stroke-opacity」。 */
                row.tails[i].setAttribute('stroke-opacity', uniAccretionBandAlpha(i, death).toFixed(3))
            }
            var head = points[0]
            row.dot.setAttribute('cx', head.x.toFixed(2))
            row.dot.setAttribute('cy', head.y.toFixed(2))
            /* 头部段按 rank 0 最先熄，但点本身不跟着熄 —— 它要一路亮到落底，
               收场收到 floor、出生也从 floor 起（见 uniAccretionDotAlpha）。 */
            row.dot.style.opacity = uniAccretionDotAlpha(u, death, floor).toFixed(3)
        }

        /* 一轮的进度 → 熄灭进度 death（0.8 之后）。elapsed 是这一行跑过的圈数 ——
           交接层只在第一圈之后出现。 */
        var paint = function (row, u, elapsed) {
            var death = u <= UNI_ACC_FADE_FROM ? 0 : (u - UNI_ACC_FADE_FROM) / (1 - UNI_ACC_FADE_FROM)
            /* 整组不压 opacity：亮度全部由逐段的 stroke-opacity 与点的 opacity 表达。 */
            row.g.style.opacity = '1'
            draw(row, uniAccretionTrail(u), death > 1 ? 1 : death, u)
            paintHandoff(row, u)
        }

        /* 交接层：六段尾巴逐段从「它自己收尾时的亮度」二等分淡出，占一轮的前 55%（约 715ms），
           只减不增（用户 m01544：任何「上一帧比这一帧亮」的来源都要删干净）。这一层只留形状 ——
           中心那颗点已经拿掉（用户 m01745）：它停在正中不动、新点又在外圈亮起，读作第二颗粒子。
           窗口之外整层 display: none，不参与渲染。 */
        var paintHandoff = function (row, u) {
            var band = uniAccretionHandoffAlpha(0, u)
            if (band <= 0) {
                if (row.ghost.style.display !== 'none') row.ghost.style.display = 'none'
                return
            }
            if (row.ghost.style.display !== '') row.ghost.style.display = ''
            for (var i = 0; i < row.ghostTails.length; i += 1) {
                row.ghostTails[i].setAttribute('stroke-opacity', uniAccretionHandoffAlpha(i, u).toFixed(3))
            }
        }

        /* 兜底形态：不跑时间轴，直接给一帧静态 —— 停在轨迹上的 u = 0.6（r = 3.08），
           身后是从出生点一路走到这里的完整尾迹。留着整条尾迹，静态帧才还能读出那条向内
           收紧的螺旋；只留一个孤点等于什么也没说。它仍然是同一条曲线，不是另画的圆。
           静态帧不参与轮转，所以整组不压 opacity、点的散场权重也不压、也不画残影。 */
        var paintStill = function (row) {
            row.g.style.opacity = '1'
            draw(row, uniAccretionTrail(UNI_ACC_STILL_U), 0, UNI_ACC_STILL_U)
            /* 静止帧只画一颗点（用户 m01429 选 B）：两颗点会读成两个彼此无关的墨点，破坏
               小尺寸下的可读性。交接窗口里的旧一代同样不画。 */
            row.ghost.style.display = 'none'
            /* 动态形态里点的亮度由散场权重写（满亮时是头部年龄亮度 .55）；静态帧没有下一轮
               要交棒，点画满，别跟着那条 .55 的规则一起被压暗。 */
            row.dot.style.opacity = '1'
        }

        var sync = function () {
            if (floorDirty) readFloor()
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
                if (still) {
                    paintStill(row)
                } else {
                    var age = now - row.born
                    paint(row, (age % UNI_ACC_CYCLE) / UNI_ACC_CYCLE, age / UNI_ACC_CYCLE)
                }
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
            /* 动效开关与明暗档都写在 body 的属性上：前者决定跑不跑，后者决定留底亮度。
               单开一个只盯这两个属性的。 */
            if (document.body !== null) {
                pref = new MutationObserver(function () { floorDirty = true; kick() })
                pref.observe(document.body, {
                    attributes: true,
                    attributeFilter: ['data-uni-motion', 'data-ds-dark-theme']
                })
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
