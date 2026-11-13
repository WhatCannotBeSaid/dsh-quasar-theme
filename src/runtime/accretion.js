/* 会话行 Running —— 日冕弧带（Corona Arc，2026-11-02）。
 *
 * 用户的规格（m00676 / m00685 / m00695 / m00698 / m00704，grilling 定案）：屏幕上始终只有
 * 一个位置主体、它逐帧连续、轨迹形状任何时刻都不出现断口。三条合起来直接判掉了螺旋：
 * 螺旋是一条开口曲线，两端位置不同（外圈 r = 6.2 与中心 r = 1 相距 5.2px），单主体走完一轮
 * 必须跨过这段距离 —— 那个跨越就是「点从中心消失又在外圈出现」的位移，亮度、残影、双流都只
 * 能盖住淡入淡出，盖不住位移本身。
 *
 * 于是这一格换成闭合圆环上的一段弧带：
 *   1. 几何闭合 —— 环上没有端点，一圈走完就是回到起点，位置天然连续；
 *   2. 形状连续 —— 弧长在 0.28 ~ 0.44 圈之间呼吸，头尾都在环上，永远不出现「起笔」；
 *   3. 单一主体 —— 弧带本身就是那颗「点」，头端 round cap 收成圆头，不再另画光点；
 *   4. 不读成 loading —— 角速度每圈两次微加速（±10%），弧长随相位伸缩、亮度跟着呼吸。
 *      匀速定长的弧就是官方 spinner 换皮，所以这两条非匀速是必需的（用户 m00695 允许）。
 *
 * 与 pending 的分界：pending 是固定椭圆 + 匀速绕行（a 6.6 / b 3.6 / 2600ms，官方原样，
 * 本文件不碰）；这里是**圆**、**顺时针**（用户 m00844 纠正过方向）、**1300ms**、
 * **弧带而非点**、**变速且呼吸**。
 *
 * 旧的整条吸积流（六段尾迹、静止交接层、双流相位交错、留底亮度）全部删除：那些机制存在的
 * 唯一理由是「给开口曲线的终点打掩护」—— 曲线一闭合，这笔账就不用结了。
 *
 * 挂在哪：复用现有 universe: paint layer 那个 effect（cli.11d 钉了恰好九个），不新增 effect。
 * 官方那两枚 r = 9.5 的圆在样式表里藏掉，这一格的字形全部由这里写。
 */

    /* 14px 设计稿坐标 → 官方 24 空间的缩放（24 / 14）。盒子 16px 是第五十七轮定的
       （用户 m01092）。 */
    var UNI_ACC_K = 24 / 14
    /* 官方 svg 的显示尺寸（CSS px）。只用于自检与注释对账。 */
    var UNI_ACC_BOX = 16
    /* 一圈的周期。pending 是 2600ms，这里快一倍；同一格里两个状态速度不同，才好区分。 */
    var UNI_ACC_CYCLE = 1300
    /* 环半径与圆心（设计单位）。屏幕半径 = 5.6 × 16/14 = 6.4px，直径 12.8px，
       与官方那枚 r = 9.5（12.25px 直径）同量级。 */
    var UNI_ACC_RING = 5.6
    var UNI_ACC_CX = 7
    var UNI_ACC_CY = 7
    /* 弧长（占整圈的比例）与它的呼吸区间。用户 m00695 允许：定长匀速就是 spinner 换皮。 */
    var UNI_ACC_ARC_MIN = 0.28
    var UNI_ACC_ARC_MAX = 0.44
    var UNI_ACC_ARC_MID = (UNI_ACC_ARC_MIN + UNI_ACC_ARC_MAX) / 2
    var UNI_ACC_ARC_SWING = (UNI_ACC_ARC_MAX - UNI_ACC_ARC_MIN) / 2
    /* 头段占弧长的比例（用户 m00698 选 B：头亮尾淡）。剩下的是三段尾，各自再乘一个衰减。 */
    var UNI_ACC_HEAD = 0.4
    var UNI_ACC_TAIL_DECAY = [0.85, 0.6, 0.38]
    /* 速度调制幅度：θ(t) = 2π(t − w·sin(4πt)/(4π))，导数 ∈ 2π(1 ± w)，恒正、不倒转。 */
    var UNI_ACC_WOBBLE = 0.1
    /* 头段与每段尾的采样数：环周长 35.2 设计单位，头段约 5.6 单位 / 8 段足够平滑。 */
    var UNI_ACC_SAMPLES = 8
    var UNI_ACC_TAIL_SAMPLES = 6
    /* 静态兜底帧的相位（prefers-reduced-motion）：取呼吸的中点偏上，弧长约 0.39 圈。 */
    var UNI_ACC_STILL_T = 0.22

    /* 相位重映射：把匀速的 t 变成「两次微加速」的角进度。t 与结果都在 [0,1) 上单调，
       所以一圈闭合、没有倒转，也没有任何需要交接的端点。 */
    function uniAccretionTurn(t) {
        var w = t - Math.floor(t)
        return w - UNI_ACC_WOBBLE * Math.sin(4 * Math.PI * w) / (4 * Math.PI)
    }

    /* 弧长（圈的比例）：每圈呼吸一次，t = 0 最长、t = 0.5 最短。 */
    function uniAccretionSpan(t) {
        return UNI_ACC_ARC_MID + UNI_ACC_ARC_SWING * Math.cos(2 * Math.PI * t)
    }

    /* 整体亮度跟着弧长走：弧最短时 0.75，最长时 1 —— 呼吸才看得出来。 */
    function uniAccretionGlow(span) {
        var k = (span - UNI_ACC_ARC_MIN) / (UNI_ACC_ARC_MAX - UNI_ACC_ARC_MIN)
        return 0.75 + 0.25 * k
    }

    /* 环上一点（设计坐标）。角度用 SVG 的屏幕坐标语义：y 向下，角度增大即视觉顺时针。 */
    function uniAccretionAt(angle) {
        return {
            x: UNI_ACC_CX + UNI_ACC_RING * Math.cos(angle),
            y: UNI_ACC_CY + UNI_ACC_RING * Math.sin(angle)
        }
    }

    /* 头端角度：顺时针（角度递增，SVG 的 y 朝下）。起点在正上方 −π/2，一圈之后回到
       同一点。用户 m00844：「方向反了！现在是逆时针，改成顺时针。」 */
    function uniAccretionHeadAngle(t) {
        return -Math.PI / 2 + Math.PI * 2 * uniAccretionTurn(t)
    }

    /* 一段弧上的采样点：从 from 走到 to（角度可以是任意方向），含两端。 */
    function uniAccretionArc(from, to, steps) {
        var n = steps < 2 ? 2 : steps
        var out = []
        for (var i = 0; i <= n; i += 1) {
            out.push(uniAccretionAt(from + (to - from) * (i / n)))
        }
        return out
    }

    /* 折线 → path 的 d。相邻重复点不推，避免 round 笔帽把零长段画成一颗圆点。 */
    function uniAccretionPath(points) {
        if (points.length < 2) return ''
        var d = 'M' + points[0].x.toFixed(2) + ' ' + points[0].y.toFixed(2)
        for (var i = 1; i < points.length; i += 1) {
            var last = points[i - 1]
            var here = points[i]
            if (here.x === last.x && here.y === last.y) continue
            d += 'L' + here.x.toFixed(2) + ' ' + here.y.toFixed(2)
        }
        return d
    }

    /* 一条弧带上四段各自的 [from, to] 与亮度。头段 40%，余下 60% 三等分、逐段变暗。
       全部角度都是绝对角，围着同一个圆 —— 一圈走完就回到起点，没有端点要交接。 */
    function uniAccretionSegments(t) {
        var phase = t - Math.floor(t)
        var span = uniAccretionSpan(phase)
        var glow = uniAccretionGlow(span)
        var head = uniAccretionHeadAngle(phase)
        var sweep = Math.PI * 2 * span
        var split = sweep * UNI_ACC_HEAD
        /* 顺时针走，所以尾巴落在头后面 —— 角度比头小的一侧。头段从 head 往回铺 split，
           余下三段继续往回铺到 head − sweep。 */
        var out = [{
            from: head,
            to: head - split,
            steps: UNI_ACC_SAMPLES,
            alpha: glow
        }]
        var tailFrom = head - split
        var tailTo = head - sweep
        for (var i = 0; i < UNI_ACC_TAIL_DECAY.length; i += 1) {
            out.push({
                from: tailFrom + (tailTo - tailFrom) * (i / UNI_ACC_TAIL_DECAY.length),
                to: tailFrom + (tailTo - tailFrom) * ((i + 1) / UNI_ACC_TAIL_DECAY.length),
                steps: UNI_ACC_TAIL_SAMPLES,
                alpha: glow * UNI_ACC_TAIL_DECAY[i]
            })
        }
        return out
    }

    function mountAccretion() {
        var SEL = "svg[data-state='ongoing']"

        /* 一次装配：一个缩放组 + 四段弧（一段头、三段尾）。官方那两枚圆被样式表藏起来，
           这里只需要往同一个 svg 里追加；宿主复用节点时靠 rows 里的记录认出同一行。 */
        var attach = function (svg, previous, api) {
            var make = api.make
            var g = make('g', { class: 'uni-acc', transform: 'scale(' + UNI_ACC_K + ')' })
            var arcs = []
            for (var i = 0; i <= UNI_ACC_TAIL_DECAY.length; i += 1) {
                arcs.push(make('path', { class: i === 0 ? 'uni-acc-arc uni-acc-arc-head' : 'uni-acc-arc uni-acc-arc-tail' }))
                g.appendChild(arcs[i])
            }
            var now = api.nowMs()
            var row = {
                svg: svg,
                host: typeof svg.closest === 'function' ? svg.closest('[data-row-key]') : null,
                g: g,
                arcs: arcs,
                born: previous === null ? now : previous.born
            }
            row.key = row.host === null ? null : row.host.getAttribute('data-row-key')
            if (api.isReduced()) paintStill(row)
            else paint(row, ((now - row.born) % UNI_ACC_CYCLE) / UNI_ACC_CYCLE)
            svg.appendChild(g)
            return row
        }

        /* 一帧：四段弧的 d 与 stroke-opacity 一起写。没有留底亮度、没有交接层 ——
           弧带在闭合环上绕行，任何时刻的几何都自带连续性。 */
        var paint = function (row, t) {
            row.g.style.opacity = '1'
            var segments = uniAccretionSegments(t)
            for (var i = 0; i < segments.length; i += 1) {
                var segment = segments[i]
                row.arcs[i].setAttribute('d', uniAccretionPath(uniAccretionArc(segment.from, segment.to, segment.steps)))
                row.arcs[i].setAttribute('stroke-opacity', segment.alpha.toFixed(3))
            }
        }

        /* 兜底形态：不跑时间轴，直接给一帧静态 —— 停在 UNI_ACC_STILL_T 的相位上，弧长约
           0.39 圈，头亮尾淡的形状仍然读得出方向。 */
        var paintStill = function (row) {
            paint(row, UNI_ACC_STILL_T)
        }

        return uniStatusRowMount({
            select: SEL,
            watchReducedMedia: true,
            /* 按 node、host、key 认行；同一行换 SVG 时用 host+key 续相位。 */
            find: function (rows, node, host, key) {
                for (var j = 0; j < rows.length; j += 1) {
                    if (rows[j].svg === node && rows[j].host === host && rows[j].key === key) return rows[j]
                }
                if (host !== null) {
                    for (var k = 0; k < rows.length; k += 1) {
                        if (rows[k].host === host && rows[k].key === key) return rows[k]
                    }
                }
                return null
            },
            needsAttach: function (found, node) {
                return found === null || found.svg !== node || found.g.parentNode !== node
            },
            attach: attach,
            detach: function (row) {
                if (row.g.parentNode !== null) row.g.parentNode.removeChild(row.g)
            },
            /* 静态模式与「没有 running 行」都不留 RAF 循环：前者每帧画同一帧是纯烧电，
               后者根本没人看。状态一变由观察器/prof 回调 kick 起来。 */
            frame: function (now, api) {
                if (api.isDirty()) { api.clearDirty(); api.sync() }
                api.bumpTicks()
                var rows = api.rows()
                if (api.isReduced() || rows.length === 0) {
                    for (var i = 0; i < rows.length; i += 1) paintStill(rows[i])
                    return
                }
                for (var j = 0; j < rows.length; j += 1) {
                    var row = rows[j]
                    paint(row, ((now - row.born) % UNI_ACC_CYCLE) / UNI_ACC_CYCLE)
                }
                api.nextFrame()
            }
        })
    }
