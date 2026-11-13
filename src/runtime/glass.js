/* Private factory input; concatenated by CLIENT_FILES, not a public module. */
    /* 液体玻璃（2026-10-07，第二十四轮）。
     *
     * 宿主 <svg> → <filter>/<feImage>/<feDisplacementMap> → 尺寸监听 → 挂载扫描 →
     * 卸载这一整套脚手架已抽取到 src/runtime/displacement-mount.js（uniMountDisplacement），
     * 与 lens.js 共用。本文件只保留玻璃特有的两样：目标清单，和 glass 的位移图 glassMap。
     */
    function mountLiquidGlass() {
        /* 2026-10-07: the command window's target was removed with its paint rule —
           the user asked for the task panel's material, and TodoPanel declares no
           refraction. The composer and, since the borderless round, the right
           column's six guide entries keep one.

           2026-11-01: the edited-files card joined them. It is a collapsed row of a
           fixed height, so the shared-map caveat below costs nothing here — every
           card on screen is the same geometry unless one is expanded, and an
           expanded card is the only reader of a stretched rim.

           One target may own SEVERAL elements: the guide is six identical rows, and
           the sheet can name the filter only once, so they share one map. That is
           correct only while the elements are one geometry — measured, all six are
           380x56 — so the map is drawn from the target's FIRST element and the rest
           are measured too, which keeps a resize (and a column drag) repainting. If a
           future build gives the six different sizes, split them into two targets. */
        /* 2026-11-02: the queued-message panel joined them. It is ONE element whose
           height follows how many messages are queued (40px for one row, up to 180px
           for the scrolling list), so it never shares a map with anything and the
           ResizeObserver below redraws it on every height change. Its bevel is 10,
           not the card's 14: the shortest panel is 40px tall, where the clamp would
           pull 14 down to 13 and the rim would eat the whole strip. */
        /* 2026-11-02: the deliverable card (an attached file / image preview row) joined
           them. Its resting box is a fixed 60px tall, so the card's 14px bevel survives
           the one-third clamp and it can borrow that geometry rather than declare a new
           one. */
        var targets = [
          { id: 'uni-lg-input', selector: '[data-composer-card]', bezel: 14, scale: 14 },
          { id: 'uni-lg-guide', selector: '[data-sidebar-right-guide-entry]', bezel: 14, scale: 14 },
          { id: 'uni-lg-card', selector: '[class*="HOHHba_card"]', bezel: 14, scale: 14 },
          { id: 'uni-lg-panel', selector: '[class*="F07MqG_panel"]', bezel: 10, scale: 10 },
          { id: 'uni-lg-deliverable', selector: '[class*="K5rwea_file"]', bezel: 14, scale: 14 },
        ]

        /* One map, drawn at the size of the region (the box plus one bevel all round) and
           handed to feImage with no placement attributes, so one map pixel covers one
           region pixel. Two gradients are mixed with screen so each carries one channel.
           R lies flat at 0 over the strip outside the element, ramps 0 -> 128 across the
           element's own bevel, holds 128 through the middle and mirrors that on the far
           side up to 255; G does the same vertically. The offset is therefore zero
           everywhere further than one bevel from an edge, and points outward at the rim. */
        var glassMap = function (w, h, bx, by) {
          var W = w + 2 * bx
          var H = h + 2 * by
          var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '">'
            + '<defs>'
            + '<linearGradient id="h" x1="0" y1="0" x2="1" y2="0">'
            + '<stop offset="0" stop-color="rgb(0,0,0)"/>'
            + '<stop offset="' + uniPct(bx, W) + '" stop-color="rgb(0,0,0)"/>'
            + '<stop offset="' + uniPct(2 * bx, W) + '" stop-color="rgb(128,0,0)"/>'
            + '<stop offset="' + uniPct(W - 2 * bx, W) + '" stop-color="rgb(128,0,0)"/>'
            + '<stop offset="' + uniPct(W - bx, W) + '" stop-color="rgb(255,0,0)"/>'
            + '<stop offset="1" stop-color="rgb(255,0,0)"/>'
            + '</linearGradient>'
            + '<linearGradient id="v" x1="0" y1="0" x2="0" y2="1">'
            + '<stop offset="0" stop-color="rgb(0,0,0)"/>'
            + '<stop offset="' + uniPct(by, H) + '" stop-color="rgb(0,0,0)"/>'
            + '<stop offset="' + uniPct(2 * by, H) + '" stop-color="rgb(0,128,0)"/>'
            + '<stop offset="' + uniPct(H - 2 * by, H) + '" stop-color="rgb(0,128,0)"/>'
            + '<stop offset="' + uniPct(H - by, H) + '" stop-color="rgb(0,255,0)"/>'
            + '<stop offset="1" stop-color="rgb(0,255,0)"/>'
            + '</linearGradient>'
            + '</defs>'
            + '<rect width="' + W + '" height="' + H + '" fill="url(#h)"/>'
            + '<rect width="' + W + '" height="' + H + '" fill="url(#v)" style="mix-blend-mode:screen"/>'
            + '</svg>'
          return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
        }

        return uniMountDisplacement({
          hostId: 'uni-lg-defs',
          mapName: 'glass-map',
          targets: targets,
          /* glass 的 scale 由目标固定，建立时定一次，之后不随尺寸变。 */
          init: function (state) { state.shift.setAttribute('scale', String(state.target.scale)) },
          key: function (state, w, h) { return w + 'x' + h },
          /* The bevel may not eat more than a third of the element, so a surface
             narrower than three bevels still gets a (proportionally smaller) bend
             instead of a broken map. */
          draw: function (state, w, h) {
            var bx = Math.max(2, Math.min(state.target.bezel, Math.round(w / 3)))
            var by = Math.max(2, Math.min(state.target.bezel, Math.round(h / 3)))
            state.filter.setAttribute('x', uniPct(-bx, w))
            state.filter.setAttribute('y', uniPct(-by, h))
            state.filter.setAttribute('width', uniPct(w + 2 * bx, w))
            state.filter.setAttribute('height', uniPct(h + 2 * by, h))
            state.image.setAttribute('href', glassMap(w, h, bx, by))
          }
        })
    }
