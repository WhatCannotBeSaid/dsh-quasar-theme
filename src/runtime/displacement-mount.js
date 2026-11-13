/* Private factory input; concatenated by CLIENT_FILES, not a public module. */

    /* 悬浮位移滤镜的共同脚手架（2026-11-07 抽取）。
     *
     * glass.js（液体玻璃）与 lens.js（悬停透镜）用的是同一条浏览器原生管线：
     * 一个 0 尺寸的宿主 <svg>，每个目标一对 <filter><feImage><feDisplacementMap>，
     * 一张 ResizeObserver 表只在像素尺寸真变了才重画，一个 MutationObserver 只在
     * 「新增/移除的节点可能匹配某个目标」时补一次挂载扫描，最后由 dispose 收尾。
     * 这段脚手架两份逐字重复了约 180 行，只留这一处。
     *
     * 真正不同、因此仍留在各自文件里的只有两样：位移图怎么算（glassMap / lensMap），
     * 以及每个目标怎么摆（filter 区域、位移 scale、是否在建立时就固定 scale）。两者
     * 以 opts 的钩子交进来：
     *   opts.hostId    宿主 <svg> 的 id
     *   opts.mapName   feImage/@result 与 feDisplacementMap/@in2 共用的结果名
     *   opts.targets   [{ id, selector, ... }]
     *   opts.init      可选，(state) => void，建立每个 filter 后调用（glass 固定 scale）
     *   opts.key       (state, w, h) => string，尺寸缓存键；变了才重画
     *   opts.draw      (state, w, h) => void，写 filter 区域、位移 scale 与图片 href
     *
     * 行为与抽取前逐条等价：同一元素上按同样顺序下同样的属性，位移图仍由各自的
     * glassMap / lensMap 原样生成。 */
    var uniTwo = function (value) { return Math.round(value * 100) / 100 }
    var uniPct = function (part, whole) { return uniTwo(part / whole * 100) + '%' }

    var uniMountDisplacement = function (opts) {
        if (typeof document === 'undefined') return undefined
        var root = document.body || document.documentElement
        var disposed = false
        var frame = null
        var NS = 'http://www.w3.org/2000/svg'

        var host = document.createElementNS(NS, 'svg')
        host.setAttribute('id', opts.hostId)
        host.setAttribute('aria-hidden', 'true')
        host.setAttribute('focusable', 'false')
        host.setAttribute('style',
          'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none')

        var states = []
        for (var i = 0; i < opts.targets.length; i += 1) {
          var target = opts.targets[i]
          var filter = document.createElementNS(NS, 'filter')
          filter.setAttribute('id', target.id)
          /* sRGB，否则位移在线性光里算，弯折落到错的位置。 */
          filter.setAttribute('color-interpolation-filters', 'sRGB')
          var image = document.createElementNS(NS, 'feImage')
          image.setAttribute('preserveAspectRatio', 'none')
          image.setAttribute('result', opts.mapName)
          var shift = document.createElementNS(NS, 'feDisplacementMap')
          shift.setAttribute('in', 'SourceGraphic')
          shift.setAttribute('in2', opts.mapName)
          shift.setAttribute('xChannelSelector', 'R')
          shift.setAttribute('yChannelSelector', 'G')
          filter.appendChild(image)
          filter.appendChild(shift)
          host.appendChild(filter)
          var state = { target: target, els: [], size: '', filter: filter, image: image, shift: shift }
          if (opts.init) opts.init(state)
          states.push(state)
        }
        root.appendChild(host)

        /* Draw only when the pixel size actually changed: a sub-pixel reflow would
           otherwise rebuild a ~1 KB data URL on every frame of a resize. els[0] is the
           map's geometry source: one filter id carries one map, and a multi-element
           target is one geometry by construction (see each file's targets). */
        var paint = function (state) {
          if (disposed || state.els.length === 0) return
          var box = state.els[0].getBoundingClientRect()
          var w = Math.round(box.width)
          var h = Math.round(box.height)
          if (w < 8 || h < 8) return
          var key = opts.key(state, w, h)
          if (key === state.size) return
          state.size = key
          opts.draw(state, w, h)
        }

        var watcher = typeof ResizeObserver === 'function' ? new ResizeObserver(function (entries) {
          /* 一批里同一个 state 可能被多个 entry 命中（glass 的 guide 六行共用一张图）。
             图只有一张、几何只认 els[0]，所以每个 state 本批只处理一次；Set 以 state
             身份为准，局部变量，回调结束即丢，下一批照常重新处理。 */
          var done = new Set()
          for (var e = 0; e < entries.length; e += 1) {
            for (var s = 0; s < states.length; s += 1) {
              if (states[s].els.indexOf(entries[e].target) === -1) continue
              if (done.has(states[s])) continue
              done.add(states[s])
              paint(states[s])
            }
          }
        }) : null

        /* The app mounts its shell asynchronously, so a one-shot lookup would miss a
           surface that is not there yet. Cheap re-scan, coalesced to one per frame.
           A target may own several elements, so this walks the whole match set: new
           nodes get observed, departing ones unobserved, and the map is redrawn only
           when the set actually changed; the cached size survives an unchanged set. */
        var scan = function () {
          if (disposed) return
          for (var s = 0; s < states.length; s += 1) {
            var state = states[s]
            var found = document.querySelectorAll(state.target.selector)
            var next = []
            var changed = found.length !== state.els.length
            for (var f = 0; f < found.length; f += 1) {
              if (state.els.indexOf(found[f]) === -1) {
                if (watcher !== null) watcher.observe(found[f])
                changed = true
              }
              next.push(found[f])
            }
            for (var g = 0; g < state.els.length; g += 1) {
              if (next.indexOf(state.els[g]) === -1) {
                if (watcher !== null) watcher.unobserve(state.els[g])
                changed = true
              }
            }
            state.els = next
            if (changed) {
              /* The set is the trigger. An unchanged set means no geometry moved here,
                 and the read inside paint() would force a layout to redraw a map nobody
                 asked to redraw -- on a streaming reply that is a forced layout on every
                 frame. A real resize is the ResizeObserver's business. */
              state.size = ''
              paint(state)
            }
          }
        }

        /* The scan exists to catch a surface that has just been mounted, so it only has
           to run when a batch could have mounted or unmounted one. The added/removed-node
           test that decides this is shared: see uniMutationTouches in
           src/runtime/mutation-records.js. */
        var mounted = function (records) {
          for (var s = 0; s < states.length; s += 1) {
            if (uniMutationTouches(records, states[s].target.selector)) return true
          }
          return false
        }

        var queued = false
        var mounts = typeof MutationObserver === 'function' ? new MutationObserver(function (records) {
          if (disposed || !mounted(records)) return
          if (queued) return
          queued = true
          frame = window.requestAnimationFrame(function () { frame = null; queued = false; scan() })
        }) : null
        if (mounts !== null) {
          mounts.observe(root, { childList: true, subtree: true })
        }
        scan()

        return () => {
          disposed = true
          if (frame !== null) window.cancelAnimationFrame(frame)
          frame = null
          if (mounts !== null) mounts.disconnect()
          if (watcher !== null) watcher.disconnect()
          host.remove()
        }
    }
