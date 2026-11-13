/* Private factory input; concatenated by CLIENT_FILES, not a public module. */
    /* 会话行 Pending —— 开普勒轨道（2026-11-01 第七十二轮）
     *
     * 用户规格（附图「Pending - 开普勒轨道」，本轮 m00003）：「沿固定椭圆轨道运行，
     * 保持稳定周期运动」，「图中的『中心引力核心』不要，只需要椭圆轨道和运动光点」。
     * 附图另给出三件事：关键帧 T0–T4 是沿同一条固定椭圆连续绕行；实际尺寸 16 / 20 /
     * 24px 三档；与 Running（吸积流）的分界是「绕」对「落」——后者半径逐渐减小、
     * 越靠近越快，前者半径不变、周期稳定。
     *
     * 钩子：span[data-state='warning']。DSH 0.2.1-rc.5 的会话行只有 ongoing /
     * warning / done / idle 四个 data-state（primitives 的 StateDot 只对 ongoing 出
     * svg，其余都是 span），没有 pending。warning 就是官方自己的 pendingInteraction
     * （等待审批 / 计划确认 / 提问），用户 2026-11-01 指定 pending 挂在这一态上。
     *
     * 为什么运动必须离开样式表：附图要的是「光点在椭圆上绕行」，而 CSS 关键帧只能把
     * 一个画好的椭圆整体 rotate —— 光点会跟着椭圆的自转一起转，椭圆本身也在转，那读
     * 起来是两个圆在互相打转，不是一颗点沿轨道走。所以椭圆静止，光点每帧独立取点。
     *
     * 匀速取的是**弧长**参数，不是角度参数：椭圆的角速度在长轴两端最慢、短轴两端最快，
     * 按角度走会看到点「在两端蹭、在侧面冲」。按弧长换算就得到真正的恒定线速度，也是
     * 用户写的「稳定周期运动」。换算表 128 段、算一次缓存（UNI_KEP_LUT）。
     *
     * 附图那张「运动速度示意（类开普勒第二定律）」在这套几何下没有落点：那张示意把
     * 焦点放在椭圆一端（左端才叫「接近中心」），而这枚图标里的椭圆是**以格子中心为
     * 几何中心**的 —— 焦点偏到一端，长轴一端会顶出 16px 格子（a + c 超过半格），24px
     * 那档尤其明显。所以这里按「等弧长绕行」实现，与附图面板的差异如实记在此处。
     *
     * 相位：所有行共用同一个原点，不按行各算各的出生时刻 —— 官方那圈 spinner 也是用
     * getAnimations 把 startTime 对齐到 0 的。等待态一律同步，才不会读成「各转各的」。
     *
     * 坐标系：viewBox 0 0 16 16，椭圆中心 (8, 8)、半长轴 6.6、半短轴 3.6、倾角 -30°。
     * 盒子换成 20px / 24px 时整组只是等比放大（附图那三档），几何不用改。
     *
     * 光点不带晕：附图 24px 那档的点有一圈暖晕，16px 那档只有一颗点，而会话行只有
     * 16px 这一档 —— 0.8px 的轨道上叠任何 blur，轨道先糊掉。
     */

    /* 一圈的时长。比 running 的 1300ms 慢一倍：等待不是紧急事件，慢才读作「稳」。 */
    var UNI_KEP_PERIOD = 2600
    /* 16 单位设计坐标里的椭圆。半长轴 6.6 + 半短轴 3.6 的旋转盒半宽 6.0、半高 4.5，
       格子里留得下一整圈（含 0.8 的描边），24px 档放大后也不出格。 */
    var UNI_KEP_A = 6.6
    var UNI_KEP_B = 3.6
    /* 倾角：附图里长轴从左下伸向右上，约 -30°。 */
    var UNI_KEP_TILT = -Math.PI / 6
    var UNI_KEP_CX = 8
    var UNI_KEP_CY = 8
    /* 光点半径：16 单位下 1 → 直径 2px，比官方那枚 10px 点的内圆（inset 20% 即 6px）
       小，但比 running 的点（2.51px）细一档 —— 等待态本来就该轻。 */
    var UNI_KEP_DOT = 1
    /* 弧度换算表的段数。128 段在 16px 下一段弧长约 0.23px，远小于一个像素。 */
    var UNI_KEP_STEPS = 128
    /* reduced-motion 下的静止相位：0.62 圈，落在长轴偏下的位置，既不在正上方也不在
       长轴端点上，静止帧才看得出这是一条倾斜的椭圆。 */
    var UNI_KEP_STILL = 0.62
    /* 换算表缓存（见 uniKeplerLut）。 */
    var UNI_KEP_LUT = null

    /* 纯几何，无副作用：tests 直接 eval 这一个文件后调用它来钉参数。
       参数角 θ（弧度）→ 16 单位坐标下的点。椭圆是轴对齐的，先取参数点再绕中心转。 */
    function uniKeplerPoint(theta) {
        var cos = Math.cos(UNI_KEP_TILT)
        var sin = Math.sin(UNI_KEP_TILT)
        var ux = Math.cos(theta) * UNI_KEP_A
        var uy = Math.sin(theta) * UNI_KEP_B
        return { x: UNI_KEP_CX + ux * cos - uy * sin, y: UNI_KEP_CY + ux * sin + uy * cos }
    }

    /* θ 的均匀采样 → 累计弧长。匀速绕行靠它把「走过的长度」换成参数角。 */
    function uniKeplerLut() {
        if (UNI_KEP_LUT === null) {
            var cum = [0]
            var total = 0
            var prev = uniKeplerPoint(0)
            for (var i = 1; i <= UNI_KEP_STEPS; i += 1) {
                var here = uniKeplerPoint((i / UNI_KEP_STEPS) * Math.PI * 2)
                total += Math.hypot(here.x - prev.x, here.y - prev.y)
                cum.push(total)
                prev = here
            }
            UNI_KEP_LUT = { cum: cum, total: total }
        }
        return UNI_KEP_LUT
    }

    /* s ∈ [0, 1) 是一圈里走过的弧长比例 —— 匀速就是这个意思：角速度随椭圆曲率变，
       线速度恒定。二分查表 + 段内线性插值，单帧代价是一次 log2(128) = 7 次比较。 */
    function uniKeplerAt(s) {
        var lut = uniKeplerLut()
        var wrapped = s - Math.floor(s)
        var target = wrapped * lut.total
        var lo = 0
        var hi = lut.cum.length - 1
        while (hi - lo > 1) {
            var mid = (lo + hi) >> 1
            if (lut.cum[mid] <= target) lo = mid
            else hi = mid
        }
        var span = lut.cum[hi] - lut.cum[lo]
        /* 末段：hi 是末点，target 正好等于总长时 t = 1，落回 θ = 2π = 0，接缝闭合。 */
        var t = span <= 0 ? 0 : (target - lut.cum[lo]) / span
        return uniKeplerPoint(((lo + t) / UNI_KEP_STEPS) * Math.PI * 2)
    }

    function mountKepler() {
        /* 只认会话行前导格里的那一枚。会话行自带 data-row-key='session:<id>'，而悬停卡
           是 portal 出去的、没有这个祖先，所以卡片里那枚同样的 warning 点不会被接管。 */
        var SEL = "[data-row-key^='session:'] span[data-state='warning']"
        /* 全行共用的原点：第一帧定下来，之后不再变 —— 中途挂上来的行直接接进同一相位。 */
        var origin = 0

        /* 一次装配：一枚静止的椭圆 + 一颗会走的光点。官方那枚 span 自己留作宿主 ——
           它的 ::after 是官方点，样式表在 :has(> svg.uni-kep) 成立时把它关掉，于是
           「我们挂上来了」和「官方点让位」是同一件事，中间没有空帧。 */
        var attach = function (marker, found, api) {
            /* 宿主换了节点（虚拟列表复用行）：旧的那枚先摘掉，免得一个格子里塞两个。 */
            if (found !== null && found.svg.parentNode !== null) found.svg.parentNode.removeChild(found.svg)
            var make = api.make
            var svg = make('svg', {
                class: 'uni-kep',
                viewBox: '0 0 ' + (UNI_KEP_CX * 2) + ' ' + (UNI_KEP_CY * 2),
                width: UNI_KEP_CX * 2,
                height: UNI_KEP_CY * 2,
                'aria-hidden': 'true',
                focusable: 'false'
            })
            svg.appendChild(make('ellipse', {
                class: 'uni-kep-orbit',
                cx: UNI_KEP_CX,
                cy: UNI_KEP_CY,
                rx: UNI_KEP_A,
                ry: UNI_KEP_B,
                transform: 'rotate(' + ((UNI_KEP_TILT * 180) / Math.PI).toFixed(2) + ' ' + UNI_KEP_CX + ' ' + UNI_KEP_CY + ')'
            }))
            var dot = make('circle', { class: 'uni-kep-dot', r: UNI_KEP_DOT })
            svg.appendChild(dot)
            var host = typeof marker.closest === 'function' ? marker.closest('[data-row-key]') : null
            var row = {
                marker: marker,
                host: host,
                key: host === null ? null : host.getAttribute('data-row-key'),
                svg: svg,
                dot: dot
            }
            /* 先绘制再挂载：样式表关掉官方点的那一帧，光点已经在轨道上。 */
            if (api.isReduced()) paintStill(row)
            else paint(row, Math.max(0, api.nowMs() - origin) / UNI_KEP_PERIOD)
            marker.appendChild(svg)
            return row
        }

        /* 一帧的坐标只要两位小数的字符串，几何对象本身不动：同一相位算一次、
           格式化一次，整帧各行共用。 */
        var formattedAt = function (s) {
            var at = uniKeplerAt(s)
            return { x: at.x.toFixed(2), y: at.y.toFixed(2) }
        }

        /* at 是可选的、已格式化的坐标：tick 每帧算一次传给它管理的每一行；
           不传就自己算，首绘与静止帧走的就是这条路。 */
        var paint = function (row, s, at) {
            if (at === undefined) at = formattedAt(s)
            row.dot.setAttribute('cx', at.x)
            row.dot.setAttribute('cy', at.y)
        }

        /* 兜底形态：不动，光点停在 UNI_KEP_STILL 那一格。轨道始终整圈都在 —— 静止帧
           也要能读出「一条倾斜的椭圆」，所以不裁减、不淡出。 */
        var paintStill = function (row) {
            paint(row, UNI_KEP_STILL)
        }

        return uniStatusRowMount({
            select: SEL,
            init: function (api) { origin = api.nowMs() },
            /* 只按 node、host、key 认行；宿主重建由 needsAttach 触发重新装配。 */
            find: function (rows, node, host, key) {
                for (var j = 0; j < rows.length; j += 1) {
                    if (rows[j].marker === node && rows[j].host === host && rows[j].key === key) return rows[j]
                }
                return null
            },
            needsAttach: function (found, node) {
                return found === null || found.svg.parentNode !== node
            },
            attach: attach,
            detach: function (row) {
                if (row.svg.parentNode !== null) row.svg.parentNode.removeChild(row.svg)
            },
            /* 每帧 querySelectorAll 太贵：变更由 observer 打脏，另外每 30 帧兜一次，
               防止有行是「没有 childList 变化」地被复用出来的。 */
            frame: function (now, api) {
                api.bumpTicks()
                if (api.isDirty() || api.tickCount() % 30 === 0) { api.clearDirty(); api.sync() }
                var rows = api.rows()
                var still = api.isReduced()
                var s = Math.max(0, now - origin) / UNI_KEP_PERIOD
                var at = still ? null : formattedAt(s)
                for (var i = 0; i < rows.length; i += 1) {
                    var row = rows[i]
                    if (row.svg.isConnected === false) continue
                    if (still) paintStill(row)
                    else paint(row, s, at)
                }
                /* 静态形态只需要一帧；动态形态一直排下去。 */
                if (!still && rows.length > 0) api.nextFrame()
            }
        })
    }
