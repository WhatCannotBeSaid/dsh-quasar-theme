    /* 会话行状态 SVG 动画的共同脚手架（2026-11-07，A2）。
     *
     * accretion.js（Running 日冕弧）与 kepler.js（Pending 开普勒）各自把一枚 svg 挂进
     * 会话行的状态节点。两边的挂载骨架本各写一遍：环境守卫、nowMs、isReduced、make、
     * sync（querySelectorAll → rows 对账 → attach / 摘除）、MutationObserver 双观察器
     * （文档子树 + body 的 data-uni-motion）、prefers-reduced-motion、teardown、首帧启动。
     * 这里只收骨架；各动效的几何、attach 与逐帧绘制仍留在各自文件，通过 opts 钩子接入。
     *
     * opts:
     *   select               选择器（决定哪些宿主节点归本动效管）
     *   find(rows,node,host,key)  在已挂行里找同一宿主，返回 row 或 null
     *   needsAttach(found,node)   true 时调用 attach（首次 / 宿主重建）
     *   attach(node,found,api)    装配并返回 row；旧节点清理由 attach 自己负责
     *   detach(row)               从 DOM 摘除该行的图形
     *   frame(now,api)            一帧：读 api.rows()/api.isDirty()，末尾用 api.nextFrame() 续帧
     *   init(api)                 可选，挂载开始时调用（如 kepler 定全行共用的 origin）
     *   watchReducedMedia         可选，true 时监听 prefers-reduced-motion 变化
     */
    var uniStatusRowMount = function (opts) {
        if (typeof document === 'undefined' || typeof window === 'undefined') return undefined
        if (typeof window.requestAnimationFrame !== 'function') return undefined

        var SVG_NS = 'http://www.w3.org/2000/svg'
        var rows = []
        var raf = 0
        var ticks = 0
        var dirty = true
        var disposed = false
        var observer = null
        var pref = null
        var prefQuery = null
        var onPref = function () { }

        var nowMs = function () {
            return typeof performance !== 'undefined' && typeof performance.now === 'function'
                ? performance.now()
                : Date.now()
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

        var api = {
            SVG_NS: SVG_NS,
            nowMs: nowMs,
            isReduced: isReduced,
            make: make,
            rows: function () { return rows },
            isDirty: function () { return dirty },
            clearDirty: function () { dirty = false },
            tickCount: function () { return ticks },
            bumpTicks: function () { ticks += 1 },
            sync: function () { sync() },
            nextFrame: function () { if (raf === 0) raf = window.requestAnimationFrame(frame) }
        }

        /* 一次对账：把现存宿主节点和 rows 对齐，缺的 attach、多的摘除。 */
        var sync = function () {
            var live = document.querySelectorAll(opts.select)
            var next = []
            for (var i = 0; i < live.length; i += 1) {
                var node = live[i]
                var host = typeof node.closest === 'function' ? node.closest('[data-row-key]') : null
                var key = host === null ? null : host.getAttribute('data-row-key')
                var found = opts.find(rows, node, host, key)
                if (found === null || opts.needsAttach(found, node)) found = opts.attach(node, found, api)
                next.push(found)
            }
            for (var j = 0; j < rows.length; j += 1) {
                if (next.indexOf(rows[j]) < 0) opts.detach(rows[j])
            }
            rows = next
        }

        var frame = function (now) {
            raf = 0
            if (disposed) return
            opts.frame(now, api)
        }

        var kick = function () {
            if (disposed) return
            dirty = true
            sync()
            dirty = false
            if (raf === 0) raf = window.requestAnimationFrame(frame)
        }

        if (typeof opts.init === 'function') opts.init(api)
        sync()
        /* 观察器是全局构造器（fixture 也按全局提供），不是 window 上的属性。 */
        if (typeof MutationObserver === 'function') {
            /* 只有可能改变 select 命中的批次才同步，规则见 uniStatusMutationTouches。 */
            observer = new MutationObserver(function (records) {
                if (!disposed && uniStatusMutationTouches(records, opts.select)) kick()
            })
            observer.observe(document.documentElement, {
                subtree: true,
                childList: true,
                attributes: true,
                attributeFilter: ['data-state', 'data-row-key']
            })
            /* 动效开关写在 body 的属性上：它决定跑不跑，所以单独盯一个观察器。 */
            if (document.body !== null) {
                pref = new MutationObserver(function () { kick() })
                pref.observe(document.body, {
                    attributes: true,
                    attributeFilter: ['data-uni-motion']
                })
            }
        }
        if (opts.watchReducedMedia && typeof window.matchMedia === 'function') {
            prefQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
            onPref = function () { kick() }
            if (typeof prefQuery.addEventListener === 'function') prefQuery.addEventListener('change', onPref)
            else if (typeof prefQuery.addListener === 'function') prefQuery.addListener(onPref)
        }
        dirty = false
        if (raf === 0) raf = window.requestAnimationFrame(frame)

        return function () {
            if (disposed) return
            disposed = true
            if (raf !== 0) window.cancelAnimationFrame(raf)
            raf = 0
            if (observer !== null) observer.disconnect()
            if (pref !== null) pref.disconnect()
            if (prefQuery !== null) {
                if (typeof prefQuery.removeEventListener === 'function') prefQuery.removeEventListener('change', onPref)
                else if (typeof prefQuery.removeListener === 'function') prefQuery.removeListener(onPref)
            }
            for (var i = 0; i < rows.length; i += 1) opts.detach(rows[i])
            rows = []
        }
    }
