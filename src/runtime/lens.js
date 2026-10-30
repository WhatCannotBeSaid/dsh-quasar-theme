/* Private factory input; concatenated by CLIENT_FILES, not a public module. */
    /* 悬停透镜（2026-10-30，第四十六轮）
     *
     * 黑洞主题的悬停从「背景 + 边框」换成「向心收束双环 + 重力透镜」。环是纯 CSS
     * （theme.css 的「悬停环」一节），透镜必须在这里：位移图是逐像素算出来的，
     * 样式表画不了。
     *
     * 为什么沿用 glass.js 的那套管线：feImage 交一张位移图给 feDisplacementMap，
     * R/G 两个通道就是 x/y 位移，浏览器原生完成采样。探针实测（2026-10-30，
     * uni-lens-probe.html）backdrop-filter: url(#id) 在 Electron 里生效、
     * CSS.supports 返回 true、开关两档都是 160fps（worst 6.5ms），没有可测代价。
     *
     * 与 glass.js 的三点不同：
     *   ① 图是径向的（向心），不是四周倒角；位移方向指向元素中心。
     *   ② 衰减用 (1 - t)^0.7 而不是 t²。探针实测 t² 太陡：420x40 的行上位移只
     *      堆在中心 260px 内，读作「中部横向挤压」而不是整块透镜。0.7 次幂让位移
     *      一直铺到外缘，同时仍严格归零（t → 1 时 m → 0），不留接缝。
     *   ③ 包络是椭圆：rx 用半宽、ry 用半高，所以宽行上透镜跟着整行走，圆形按钮
     *      （发送键 34x34）自动退化成正圆。外缘留 2px 平坦区，按设计第九条。
     *
     * 峰值 = 短边 x 0.15，上限 10px（设计第九条）。行 32px 高 ⇒ 4.8px；发送键
     * 34px ⇒ 5.1px。位移图边长把峰值算进 region，所以被采样的像素一定存在。
     */
    function mountHoverLens() {
        if (typeof document === 'undefined') return undefined
        var root = document.body || document.documentElement
        var disposed = false
        var frame = null
        var NS = 'http://www.w3.org/2000/svg'
        var two = function (value) { return Math.round(value * 100) / 100 }
        var pct = function (part, whole) { return two(part / whole * 100) + '%' }

        /* 两个主角（设计第三条）。行与发送键各一张图：尺寸差一个数量级，一张图
           撑不到两种几何上。会话行只认 session: 前缀 —— 侧栏里 workspace 与
           overflow 两种行也带 [data-row-key]，但它们不是主角。 */
        var targets = [
          { id: 'uni-lens-row', selector: '[data-row-key^="session:"]' },
          { id: 'uni-lens-send', selector: 'button[aria-label="发送消息"], button[aria-label="Send message"]' },
        ]

        /* 峰值与平坦区都从元素尺寸推，所以一张图对应一个尺寸；ResizeObserver
           重画，尺寸没变就不重画（同 glass.js 的缓存键）。 */
        var peakOf = function (w, h) {
          return Math.max(2, Math.min(10, Math.round(Math.min(w, h) * 0.15 * 100) / 100))
        }

        /* 位移图：R = 128 + vx*127、G = 128 + vy*127、B 固定 128、A 255。
           feDisplacementMap 的位移量 = scale * (通道/255 - 0.5)，所以 scale 取
           2 * 峰值时，(vx, vy) 直接就是「以峰值为单位的向心单位向量」。 */
        var lensMap = function (w, h, peak) {
          var W = Math.max(4, Math.round(w + 2 * peak))
          var H = Math.max(4, Math.round(h + 2 * peak))
          var canvas = document.createElement('canvas')
          canvas.width = W
          canvas.height = H
          var ctx = canvas.getContext('2d')
          if (ctx === null) return ''
          var data = ctx.createImageData(W, H)
          var buf = data.data
          var cx = peak + w / 2
          var cy = peak + h / 2
          var rx = Math.max(1, w / 2 - 2)
          var ry = Math.max(1, h / 2 - 2)
          for (var y = 0; y < H; y += 1) {
            for (var x = 0; x < W; x += 1) {
              var i = (y * W + x) * 4
              buf[i] = 128
              buf[i + 1] = 128
              buf[i + 2] = 128
              buf[i + 3] = 255
              var dx = x + 0.5 - cx
              var dy = y + 0.5 - cy
              var nx = dx / rx
              var ny = dy / ry
              var t = Math.sqrt(nx * nx + ny * ny)
              if (t >= 1) continue
              var len = Math.sqrt(dx * dx + dy * dy)
              if (len < 0.0001) continue
              var m = Math.pow(1 - t, 0.7)
              buf[i] = Math.round(128 + (-dx / len) * m * 127)
              buf[i + 1] = Math.round(128 + (-dy / len) * m * 127)
            }
          }
          ctx.putImageData(data, 0, 0)
          return canvas.toDataURL('image/png')
        }

        var host = document.createElementNS(NS, 'svg')
        host.setAttribute('id', 'uni-lens-defs')
        host.setAttribute('aria-hidden', 'true')
        host.setAttribute('focusable', 'false')
        host.setAttribute('style',
          'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none')

        var states = []
        for (var i = 0; i < targets.length; i += 1) {
          var target = targets[i]
          var filter = document.createElementNS(NS, 'filter')
          filter.setAttribute('id', target.id)
          /* sRGB：线性光下算位移会把弯折放到错的位置（glass.js 同一条）。 */
          filter.setAttribute('color-interpolation-filters', 'sRGB')
          var image = document.createElementNS(NS, 'feImage')
          image.setAttribute('preserveAspectRatio', 'none')
          image.setAttribute('result', 'lens-map')
          var shift = document.createElementNS(NS, 'feDisplacementMap')
          shift.setAttribute('in', 'SourceGraphic')
          shift.setAttribute('in2', 'lens-map')
          shift.setAttribute('xChannelSelector', 'R')
          shift.setAttribute('yChannelSelector', 'G')
          filter.appendChild(image)
          filter.appendChild(shift)
          host.appendChild(filter)
          states.push({ target: target, els: [], size: '', filter: filter, image: image, shift: shift })
        }
        root.appendChild(host)

        var paint = function (state) {
          if (disposed || state.els.length === 0) return
          var box = state.els[0].getBoundingClientRect()
          var w = Math.round(box.width)
          var h = Math.round(box.height)
          if (w < 8 || h < 8) return
          var peak = peakOf(w, h)
          var key = w + 'x' + h + '@' + peak
          if (key === state.size) return
          state.size = key
          /* 滤镜区域向外扩一个峰值，位移采样才拿得到边界外的像素。 */
          state.filter.setAttribute('x', pct(-peak, w))
          state.filter.setAttribute('y', pct(-peak, h))
          state.filter.setAttribute('width', pct(w + 2 * peak, w))
          state.filter.setAttribute('height', pct(h + 2 * peak, h))
          state.shift.setAttribute('scale', String(2 * peak))
          state.image.setAttribute('href', lensMap(w, h, peak))
        }

        var watcher = typeof ResizeObserver === 'function' ? new ResizeObserver(function (entries) {
          for (var e = 0; e < entries.length; e += 1) {
            for (var s = 0; s < states.length; s += 1) {
              if (states[s].els.indexOf(entries[e].target) !== -1) paint(states[s])
            }
          }
        }) : null

        /* 挂载扫描与 glass.js 同一套：会话行是列表虚拟化出来的，一次查询抓不全，
           用 MutationObserver 只在「新增/移除的节点可能匹配」时补一次扫描。 */
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
              state.size = ''
              paint(state)
            }
          }
        }

        var could = function (records, selector) {
          for (var r = 0; r < records.length; r += 1) {
            var bags = [records[r].addedNodes, records[r].removedNodes]
            for (var b = 0; b < bags.length; b += 1) {
              var bag = bags[b]
              if (bag === undefined || bag === null) continue
              for (var n = 0; n < bag.length; n += 1) {
                var node = bag[n]
                if (node === null || node === undefined) continue
                if (typeof node.matches === 'function' && node.matches(selector)) return true
                if (typeof node.querySelector === 'function' && node.querySelector(selector) !== null) return true
              }
            }
          }
          return false
        }

        var mounted = function (records) {
          for (var s = 0; s < states.length; s += 1) {
            if (could(records, states[s].target.selector)) return true
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
