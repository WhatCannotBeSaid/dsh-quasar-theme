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
     * 那套脚手架（宿主 <svg> → filter → 尺寸监听 → 挂载扫描 → 卸载）已抽取到
     * src/runtime/displacement-mount.js（uniMountDisplacement），与 glass.js 共用；
     * 本文件只保留透镜特有的目标清单、峰值与位移图 lensMap。
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

        return uniMountDisplacement({
          hostId: 'uni-lens-defs',
          mapName: 'lens-map',
          targets: targets,
          key: function (state, w, h) { return w + 'x' + h + '@' + peakOf(w, h) },
          draw: function (state, w, h) {
            var peak = peakOf(w, h)
            /* 滤镜区域向外扩一个峰值，位移采样才拿得到边界外的像素。 */
            state.filter.setAttribute('x', uniPct(-peak, w))
            state.filter.setAttribute('y', uniPct(-peak, h))
            state.filter.setAttribute('width', uniPct(w + 2 * peak, w))
            state.filter.setAttribute('height', uniPct(h + 2 * peak, h))
            state.shift.setAttribute('scale', String(2 * peak))
            state.image.setAttribute('href', lensMap(w, h, peak))
          }
        })
    }
