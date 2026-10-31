/* Private factory input; concatenated by CLIENT_FILES, not a public module. */
    /* 选中态的两套光学现象（2026-10-31，第五十轮）
     * ------------------------------------------------------------------------
     * 悬停是「物体被引力吸近」（gravity.js 的塌陷记账），选中是「光线本身被改变」。
     * 两者不共享链：选中态一律不位移、不缩放、不改字号，只动字形。
     *
     * 现象一 · 多普勒红移 —— 纯 CSS（src/theme.css 的「选中态」一节）
     *   会话行的标题只往右侧长波端拖出两层暖色副影（香槟金 → 琥珀铜），越远越淡。
     *   左侧干净。颜色取 state-warn-secondary / state-warn-primary，两支令牌在
     *   暗档读作香槟金与琥珀金、亮档读作铜与深暖金，模式切换由令牌层完成。
     *
     * 现象二 · 引力透镜 —— 本文件
     *   CSS 无法弯曲字形几何，只能靠 SVG 位移图。位移图按非奇异等温球（NIS）
     *   透镜建模：中心偏折为 0、边缘饱和，所以字芯永远不动，只有轮廓被推。
     *   feImage 交一张固定几何图给 feDisplacementMap，R/G 通道就是 x/y 位移，
     *   浏览器原生采样 —— 与 lens.js 的悬停透镜同一条管线，只是位移源不同：
     *   悬停那张图是「向心收束」（物体被吸），这张图是「径向折返 + 光学中心偏右」
     *   （光线被弯），并且纵向分量刻意压到横向的四成，读作非对称的局部畸变，
     *   而不是四周均匀鼓包。
     *
     * 为什么位移图是固定几何图而不是 feTurbulence：用户规格明令禁止随机噪声，
     * 而且噪声的一次采样在文字边缘会读成毛刺，不是折射。
     *
     * 为什么形变只挂在文字节点上：filter 作用于整棵子树，挂在行/按钮上会连带
     * 图标与箭头一起扭。这里逐对象找真正的文字节点并打 data-uni-sel-text，
     * 找不到就整类跳过 —— 宁可没有效果，也不整行扭曲。
     *
     * 入场只在「交互产生的选中」时播一次（WAAPI 两阶段关键帧）：0% 是推向强一档
     * 的峰值、100% 是稳定值。页面加载时已选中的项、虚拟列表复用补上的项一律
     * 静态落终态，不播。滚动窗口内的变化也抑制（列表复用不是用户选择）。
     *
     * 属性钩子是本文件唯一的写操作：data-uni-sel-text 标记文字节点，
     * theme.css 只认这个属性；卸载时逐项摘掉，不留空属性。
     */

    var UniverseSelectionOptics = (function () {

        var LENS_ID = 'uni-sel-lens'
        var TEXT_ATTR = 'data-uni-sel-text'

        /* 六类「其他对象选中」。与 2026-10-30 真机 dump 过的落点一致，不增不减：
           设置导航当前项、模型/权限列表当前项、菜单选中项、会话标签页、停靠面板
           标签、右侧栏指南条目。会话行不在此列 —— 它走多普勒。 */
        var SELECTOR = [
            "[aria-current='true']",
            "[role='menuitemradio'][aria-checked='true']",
            "[role='menuitem'][class*='_selected_']",
            "[role='tab'][aria-selected='true']",
            "[data-dockkit-tab][aria-selected='true']",
            "[data-sidebar-right-guide-entry][aria-selected='true']",
        ].join(',')

        /* 位移图的几何：72x44 只是采样分辨率，preserveAspectRatio=none 会把它拉到
           每个元素自己的盒子上。光学中心偏右 6%，左侧梯度因此更陡 —— 这就是
           「非对称」在数据上的落点，而不是靠随机偏移。 */
        var MAP_W = 72
        var MAP_H = 44
        var CENTRE_X = 0.56
        var FALL = 0.8          /* (1-t)^0.8：中心平缓、边缘收口，不留接缝 */
        var CROSS = 0.42        /* 纵向位移 = 横向的 42% */
        var SCALE = 3.0        /* 最大位移 = SCALE/2 px = 1.5px */
        /* 实测（第五十一轮）：真机把 scale 拉到 5.0（位移 2.5px）逐级截图比对，
           字形并不会出现「弯曲」—— 径向位移场在 13px 字的范围内近似常数，整字
           只是被整体平移，抗锯齿一平均就读作没变。可见性只能靠「错位 + 次级像」
           共同给，所以位移停在 3.0，剩下的量交给 theme.css 的两层 text-shadow。
           这也是规格里那条退化闸的落点：不是性能不达标，是字形尺度上形变不可见。 */

        /* 入场：峰值 2.4 倍的稳定偏移，320ms 落回 1 —— 一次，不循环、不反向。 */
        var PEAK = 2.4
        var DURATION = 320
        var EASING = 'cubic-bezier(.2,1.18,.3,1)'
        var ROLL_QUIET = 250    /* 滚动后这段时间内的列表变化不播动画 */

        function clampByte(value) {
            if (value < 0) return 0
            if (value > 255) return 255
            return Math.round(value)
        }

        /* 位移图：R = 128 + vx*127、G = 128 + vy*127、B 固定 128、A 255。
           feDisplacementMap 的位移量 = scale * (通道/255 - 0.5)，所以通道就是
           「以 SCALE/2 为单位的位移向量」。方向指向光学中心 —— 边缘向内折返。 */
        function displacementMap() {
            var canvas = document.createElement('canvas')
            canvas.width = MAP_W
            canvas.height = MAP_H
            var ctx = canvas.getContext('2d')
            if (ctx === null) return ''
            var data = ctx.createImageData(MAP_W, MAP_H)
            var buf = data.data
            var cx = MAP_W * CENTRE_X
            var cy = MAP_H * 0.5
            var rx = MAP_W * 0.5
            var ry = MAP_H * 0.5
            for (var y = 0; y < MAP_H; y += 1) {
                for (var x = 0; x < MAP_W; x += 1) {
                    var i = (y * MAP_W + x) * 4
                    buf[i] = 128
                    buf[i + 1] = 128
                    buf[i + 2] = 128
                    buf[i + 3] = 255
                    var dx = x + 0.5 - cx
                    var dy = y + 0.5 - cy
                    var t = Math.sqrt((dx / rx) * (dx / rx) + (dy / ry) * (dy / ry))
                    if (t >= 1) continue
                    var len = Math.sqrt(dx * dx + dy * dy * CROSS * CROSS)
                    if (len < 0.0001) continue
                    var m = Math.pow(1 - t, FALL)
                    buf[i] = clampByte(128 + (-dx / len) * m * 127)
                    buf[i + 1] = clampByte(128 + (-dy * CROSS / len) * m * 127)
                }
            }
            ctx.putImageData(data, 0, 0)
            return canvas.toDataURL('image/png')
        }

        function mountFilter() {
            var NS = 'http://www.w3.org/2000/svg'
            var host = document.createElementNS(NS, 'svg')
            host.setAttribute('id', 'uni-sel-defs')
            host.setAttribute('aria-hidden', 'true')
            host.setAttribute('focusable', 'false')
            host.setAttribute('style',
                'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none')
            var filter = document.createElementNS(NS, 'filter')
            filter.setAttribute('id', LENS_ID)
            /* sRGB：线性光下算位移会把弯折放到错的位置（lens.js 同一条）。 */
            filter.setAttribute('color-interpolation-filters', 'sRGB')
            /* 区域向外扩：位移采样要拿得到边界外的像素，否则边缘被裁成硬切。 */
            filter.setAttribute('x', '-12%')
            filter.setAttribute('y', '-35%')
            filter.setAttribute('width', '124%')
            filter.setAttribute('height', '170%')
            var image = document.createElementNS(NS, 'feImage')
            image.setAttribute('preserveAspectRatio', 'none')
            image.setAttribute('result', 'sel-map')
            image.setAttribute('href', displacementMap())
            var shift = document.createElementNS(NS, 'feDisplacementMap')
            shift.setAttribute('in', 'SourceGraphic')
            shift.setAttribute('in2', 'sel-map')
            shift.setAttribute('xChannelSelector', 'R')
            shift.setAttribute('yChannelSelector', 'G')
            shift.setAttribute('scale', String(SCALE))
            filter.appendChild(image)
            filter.appendChild(shift)
            host.appendChild(filter)
            var root = document.body || document.documentElement
            root.appendChild(host)
            return host
        }

        function ownText(el) {
            for (var n = el.firstChild; n !== null; n = n.nextSibling) {
                if (n.nodeType === 3 && /\S/.test(n.nodeValue)) return true
            }
            return false
        }

        /* 找「真正承载文字」的那个节点：优先自身含直接文本的节点，否则第一棵
           有文字的子树。深度上限 3，避免一路挖到不相关的面板里。 */
        function textNodeOf(el, depth) {
            if (ownText(el)) return el
            if (depth <= 0) return null
            var kids = el.children
            for (var i = 0; i < kids.length; i += 1) {
                var hit = textNodeOf(kids[i], depth - 1)
                if (hit !== null) return hit
            }
            return null
        }

        function mountSelectionOptics() {
            if (typeof document === 'undefined') return undefined
            var host = mountFilter()
            if (typeof host === 'undefined') return undefined

            var alive = true
            var known = []
            var rolling = 0
            var motion = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
                ? window.matchMedia('(prefers-reduced-motion: reduce)') : null
            function reduced() { return motion !== null && motion.matches === true }

            function play(text) {
                if (reduced()) return
                if (typeof text.animate !== 'function') return
                var rate = null
                try {
                    rate = text.animate(
                        [{ '--uni-sel-k': String(PEAK) }, { '--uni-sel-k': '1' }],
                        { duration: DURATION, easing: EASING })
                } catch (error) {
                    /* 自定义属性补间需要 @property 注册；旧环境里宁可不动，也不要
                       跳一下。 */
                    return
                }
                if (rate === null) return
                /* 不 fill：动画结束属性回到样式表的稳定值（1），不需要写回。 */
                rate.addEventListener('finish', function () { rate.cancel() })
            }

            /* 一次同步：给新出现的文字节点打属性，给已经离开选中集合的摘掉。 */
            function sync(animateNew) {
                if (!alive) return
                var hit = document.querySelectorAll(SELECTOR)
                var next = []
                var plays = []
                for (var i = 0; i < hit.length; i += 1) {
                    var owner = hit[i]
                    if (owner.isConnected !== true) continue
                    var text = textNodeOf(owner, 3)
                    if (text === null) continue
                    next.push(owner)
                    if (text.getAttribute(TEXT_ATTR) === null) text.setAttribute(TEXT_ATTR, '')
                    if (animateNew && known.indexOf(owner) === -1) plays.push(text)
                }
                for (var j = 0; j < known.length; j += 1) {
                    if (next.indexOf(known[j]) !== -1) continue
                    var stale = known[j].querySelector('[' + TEXT_ATTR + ']')
                    if (stale !== null) stale.removeAttribute(TEXT_ATTR)
                }
                known = next
                for (var k = 0; k < plays.length; k += 1) play(plays[k])
            }

            function quietNow() { return Date.now() < rolling }

            var observer = typeof MutationObserver === 'function' ? new MutationObserver(function (records) {
                if (!alive) return
                var interactive = false
                var mounted = false
                for (var r = 0; r < records.length; r += 1) {
                    var record = records[r]
                    if (record.type === 'attributes') {
                        interactive = true
                    } else if (record.type === 'childList') {
                        var bags = [record.addedNodes, record.removedNodes]
                        for (var b = 0; b < bags.length; b += 1) {
                            var bag = bags[b]
                            for (var n = 0; n < bag.length; n += 1) {
                                var node = bag[n]
                                if (node === null || node === undefined) continue
                                var kind = node.nodeType
                                if (kind !== 1) continue
                                if (typeof node.matches === 'function' && node.matches(SELECTOR)) {
                                    mounted = true
                                } else if (typeof node.querySelector === 'function' &&
                                    node.querySelector(SELECTOR) !== null) {
                                    mounted = true
                                }
                            }
                        }
                    }
                }
                if (interactive) { sync(true); return }
                /* 列表复用：滚动窗口内不播，避免滚动时偶发闪烁。 */
                if (mounted) sync(!quietNow())
            }) : null

            if (observer !== null) {
                observer.observe(document.body || document.documentElement, {
                    attributes: true,
                    attributeFilter: ['aria-selected', 'aria-checked', 'aria-current'],
                    subtree: true,
                    childList: true,
                })
            }

            function onScroll() { rolling = Date.now() + ROLL_QUIET }
            document.addEventListener('scroll', onScroll, { passive: true, capture: true })

            /* 首次同步一定不播：此时「已选中」是加载态，不是用户刚选的。 */
            sync(false)

            return function () {
                alive = false
                observer !== null && observer.disconnect()
                document.removeEventListener('scroll', onScroll, { capture: true })
                for (var i = 0; i < known.length; i += 1) {
                    var stale = known[i].querySelector('[' + TEXT_ATTR + ']')
                    if (stale !== null) stale.removeAttribute(TEXT_ATTR)
                }
                known = []
                host.remove()
            }
        }

        return { mount: mountSelectionOptics }
    })()
