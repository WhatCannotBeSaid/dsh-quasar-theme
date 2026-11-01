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

        /* 兜底：光标是 pointer 的元素也算可悬停对象（2026-10-31 第五十七轮）。
           用户要把悬停收束覆盖到「所有能悬停的地方」，而上面那份清单永远会漏：
           输入框上方的工具条是整条 div、设置导航格与插件分类项各用一套组件，
           都不是 button 也没有角色属性。照 CSS 的做法只能一直追着补选择器。
           这里改用「光标形状」当判据 —— 宿主对任何可交互元素都设 cursor:pointer，
           正文段落是 auto、可选中文字是 text，天然排除在外。

           只往上找 8 层：指针落在按钮里的图标上时，图标本身未必有 pointer，要先
           爬到按钮；但爬太高会把整个侧栏也算进来，等于「所有元素都收束」。

           选中态一律不参与（与样式表那三个 :not 同口径）：选中项已经用底色表达，
           再缩一下会让「当前在哪」跟着指针游移。 */
        /* range 滑块不参与收束（2026-10-31 第五十七轮补充）：它是可拖拽控件，
           缩 3% 会让手柄的命中区跟着变，拖到边缘时手感与静止态对不上。这条同时
           写进 EXCLUDED，让清单路径与兜底路径都拦得住 —— 只拦兜底的话，将来若
           有别的选择器把 input 收进 TARGETS，滑块又会漏回来。 */
        var EXCLUDED = "[aria-selected='true'],[aria-checked='true'],[aria-current='true'],input[type='range']"
        var POINTER_DEPTH = 8

        /* 品牌三件套里唯一没有自己元素的是 SYSTEM —— 它是按钮的 ::after。所以
           悬停 SYSTEM 只能靠「按钮带属性 → 样式表缩 ::after」这条路。按钮自己
           比 SYSTEM 大得多，还盖着 WHALE-01 与 SYSTEM 之间的 gap、按钮左右两侧的
           空白，属性一挂上去，指针停在那些空白里 SYSTEM 也会缩 —— 就是用户报的
           「三处互相影响」的另一半（2026-10-31 第七十轮）。
           这里按**与点击分区同一条界**收窄（src/client.js 的点击判定也用 name 盒
           右缘判 SYSTEM）：按钮只在指针越过 name 右缘之后才参与 hover 记账，
           左边一律不挂。Logo 与 WHALE-01 各有自己的 SPAN，closest() 本来就先命中
           它们，不需要在这里特判。 */
        var BRAND_BUTTON = 'button:has([data-slot="sidebar.brand.name"])'
        var BRAND_NAME = '[data-slot="sidebar.brand.name"]'

        var pointerTarget = function (node) {
            var el = node
            for (var i = 0; i < POINTER_DEPTH; i++) {
                if (el === null || el === undefined || el === document.body || el === document.documentElement) return null
                var cursor = ''
                try {
                    var computed = window.getComputedStyle(el)
                    cursor = computed && computed.cursor !== undefined ? String(computed.cursor) : ''
                } catch (error) {
                    cursor = ''
                }
                if (cursor === 'pointer') {
                    if (typeof el.matches === 'function' && el.matches(EXCLUDED)) return null
                    return el
                }
                el = el.parentElement
            }
            return null
        }

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
            /* 品牌按钮的命中盒左界收到 name 右缘（见 BRAND_BUTTON 的说明）。按钮
               不缩、name 也不跟着按钮缩，两枚 rect 同帧同比例，直接用即可；指针
               从 SYSTEM 区左移进 gap 时 holds() 立刻不成立，onMove 摘属性。 */
            if (typeof el.matches === 'function' && el.matches(BRAND_BUTTON)) {
                var nameBox = el.querySelector(BRAND_NAME)
                if (nameBox !== null) {
                    var edge = nameBox.getBoundingClientRect().right
                    if (edge > box.left) box.left = edge
                }
            }
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
            if (el === null) el = pointerTarget(node)
            /* 清单路径也要过一遍 EXCLUDED：closest() 不看排除项，range 滑块与
               选中项都可能被某个更宽的选择器收进来。 */
            if (el !== null && typeof el.matches === 'function' && el.matches(EXCLUDED)) el = null
            /* 品牌按钮只在 SYSTEM 区（name 右缘之后）参与 hover 记账；落在
               WHALE-01 与 SYSTEM 之间的 gap、或按钮左侧空白上时当作没有目标，
               不挂属性。见 BRAND_BUTTON 的说明。 */
            if (el !== null && typeof el.matches === 'function' && el.matches(BRAND_BUTTON)) {
                var nameNode = el.querySelector(BRAND_NAME)
                if (nameNode === null || event.clientX < nameNode.getBoundingClientRect().right) el = null
            }
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
