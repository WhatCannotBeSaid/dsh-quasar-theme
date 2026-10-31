/* Private factory input; concatenated by CLIENT_FILES, not a public module. */
    /* 悬停塌陷的命中区（2026-10-31，第四十九轮）
     *
     * 症状：悬停把元素自己缩到 0.97（纯图标按钮 0.90），命中区跟着缩。指针停在
     * 元素最外那 1.5%（图标按钮 5%）一圈时，:hover 立刻掉线 → 元素弹回原尺寸 →
     * 指针又落回元素上 → :hover 再次成立 → 再缩回去。两帧之间无限循环，肉眼
     * 就是元素边缘持续抽搐。会话行在第四十七轮用「父级悬停」隔离掉了；其余元素
     * （按钮、菜单项、标签页、设置行）没有专属包装，一直抖到现在。
     *
     * 为什么不能在样式表里修：抖动来自「触发状态的那个盒子，同时就是收缩的那个
     * 盒子」。CSS 里唯一稳定的触发面是祖先，而通用元素的祖先里还装着别的兄弟，
     * 挂上去会连坐（悬停标签就缩按钮）。所以把触发面从 :hover 上摘下来，改由
     * 这里按**未缩放的盒子**记账：
     *   · 指针进到元素里 → 挂 data-uni-grav，样式表负责塌陷；
     *   · 指针留在原始盒子里（哪怕已经落在塌陷挖出的那一圈外）→ 状态不变；
     *   · 指针离开原始盒子 → 摘掉属性，元素按 160ms 弹回。
     * 原始盒子由 rect / 当前 scale 反算：过渡进行到一半时 rect 与 computed scale
     * 是同一帧的值，除出来的仍是静止时的盒子，所以记账不受动画相位影响。
     *
     * 边界：
     *   · 只认鼠标与触控笔 —— 触摸的 :hover 是粘住的，跟着记账会留下永不还原的
     *     元素。
     *   · 指针掉进塌陷自己挖出的那一圈时，浏览器把命中交给祖先。这里靠「新候选
     *     是当前元素的祖先、且指针仍在原始盒子里」认出这类事件，不切换状态；
     *     没有这一条，行与行内的按钮会在塌陷时互相接管，循环换个形式回来。
     *   · 元素被重渲染移出文档（isConnected 为 false）时清状态，属性一并摘掉 ——
     *     宿主可能把同一个节点再插回来，留着属性会让它一回来就是塌陷态。
     */
    function mountHoverGravity() {
        if (typeof document === 'undefined' || typeof window === 'undefined') return undefined

        var ATTR = 'data-uni-grav'

        /* 与 theme.css「视界引力」一节的一一对应：静态那条列的是被压掉悬停底色
           的角色，塌陷那条列的是会缩的元素。两份清单必须同改 —— 样式表里多出的
           一个角色，在这里就是永不塌陷；这里多出的一个，就是塌陷后没人负责还原。
           会话行也在里面：只有「更多」弹出层里的行没有专属包装，靠这条兜住。 */
        var TARGETS = [
            'button',
            '[role="button"]',
            '[data-dockkit-tab]',
            '[data-dsh-panel-entry]',
            '[data-disclosure-row]',
            '[data-sidebar-right-guide-entry]',
            '[data-uni-ws-pin-button]',
            '[role="menuitem"]',
            '[role="menuitemcheckbox"]',
            '[role="menuitemradio"]',
            '[role="option"]',
            '[role="tab"]',
            '[role="radio"]',
            '[role="checkbox"]',
            '[role="switch"]',
            '[role="combobox"]',
            '[data-row-key]',
            'span:has(> [data-slot="sidebar.brand.mark"])',
            'span:has(> [data-slot="sidebar.brand.name"])'
        ].join(',')

        var active = null
        var box = null
        var lastX = null
        var lastY = null

        /* computed scale 是过渡插值后的当前值；写成 none 表示还没开始缩。
           数值非法时按 1 处理 —— 宁可把原始盒子量得偏小（提前还原），也不要让它
           偏大把指针留在外面时还维持塌陷。 */
        var scaleOf = function (el) {
            var computed = window.getComputedStyle(el)
            var raw = computed && computed.scale !== undefined ? String(computed.scale).trim() : 'none'
            if (raw === '' || raw === 'none') return 1
            var value = parseFloat(raw)
            return value > 0 ? value : 1
        }

        var measure = function (el) {
            var rect = el.getBoundingClientRect()
            var s = scaleOf(el)
            var halfW = rect.width / (2 * s)
            var halfH = rect.height / (2 * s)
            var cx = rect.left + rect.width / 2
            var cy = rect.top + rect.height / 2
            box = { left: cx - halfW, right: cx + halfW, top: cy - halfH, bottom: cy + halfH }
            return box
        }

        var holds = function (x, y) {
            return box !== null && x >= box.left && x <= box.right && y >= box.top && y <= box.bottom
        }

        var drop = function () {
            if (active !== null) active.removeAttribute(ATTR)
            active = null
            box = null
        }

        var activate = function (el) {
            if (el === active) return
            drop()
            /* 先量后挂：属性一挂上去，220ms 的过渡就开始了，之后的 rect 每一帧都
               不一样；此刻量到的是它这一帧的真实形态（可能是上一次还原的中途）。 */
            measure(el)
            active = el
            el.setAttribute(ATTR, '')
        }

        var onOver = function (event) {
            if (event.pointerType !== undefined && event.pointerType !== '' &&
                event.pointerType !== 'mouse' && event.pointerType !== 'pen') return
            var node = event.target
            if (!node || typeof node.closest !== 'function') return
            lastX = event.clientX
            lastY = event.clientY
            var el = node.closest(TARGETS)
            if (el === null || el === active) return
            /* 塌陷挖出的那一圈：指针其实没走，是命中被交还给了祖先。 */
            if (active !== null && el.contains(active) && holds(event.clientX, event.clientY)) return
            activate(el)
        }

        var onMove = function (event) {
            lastX = event.clientX
            lastY = event.clientY
            if (active === null) return
            if (active.isConnected === false) { drop(); return }
            if (holds(lastX, lastY)) return
            /* 缓存可能过期（滚动、重排、面板展开）：用实时几何再问一次。 */
            measure(active)
            if (holds(lastX, lastY)) return
            drop()
        }

        /* 指针不动、元素自己动（滚动、窗口缩放）时，pointermove 不会来。这里补
           一次量测，指针已经不在原始盒子里就还原。 */
        var onShift = function () {
            if (active === null) return
            if (active.isConnected === false) { drop(); return }
            measure(active)
            if (lastX !== null && !holds(lastX, lastY)) drop()
        }

        var onLeave = function () { drop() }

        document.addEventListener('pointerover', onOver, true)
        document.addEventListener('pointermove', onMove, { passive: true })
        document.addEventListener('scroll', onShift, { passive: true, capture: true })
        window.addEventListener('resize', onShift)
        window.addEventListener('blur', onLeave)
        var root = document.documentElement
        if (root !== null && typeof root.addEventListener === 'function') {
            root.addEventListener('pointerleave', onLeave)
        }

        return function () {
            document.removeEventListener('pointerover', onOver, true)
            document.removeEventListener('pointermove', onMove, { passive: true })
            document.removeEventListener('scroll', onShift, { passive: true, capture: true })
            window.removeEventListener('resize', onShift)
            window.removeEventListener('blur', onLeave)
            if (root !== null && typeof root.removeEventListener === 'function') {
                root.removeEventListener('pointerleave', onLeave)
            }
            drop()
        }
    }
