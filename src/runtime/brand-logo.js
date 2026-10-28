/* Raster brand mark for sidebar.brand.mark only. This project concatenates private
 * JavaScript factory inputs; no JSX compiler or new runtime is needed.
 *
 * The artwork is the user's ink-brush black hole, shipped as a PNG data URL in
 * --cp-brand-mark (built from build/brand-mark-black-hole.png). This file owns the
 * box and nothing else: the sheet (src/brand-logo.css) uses that image as a MASK and
 * paints it with currentColor, so one white-on-black asset reads white in the dark
 * theme, black in the light one, and never needs a second copy. */
var UniverseBrandLogo = (function () {
  var react

  /** @param {{size?: number, className?: string, title?: string}} [props] */
  function BlackHoleLogo(props) {
    if (!react) react = require('react')
    var h = react.createElement
    var value = Number(props && props.size)
    var size = Number.isFinite(value) && value > 0 ? value : 28
    var label = props && props.title
    return h('span', {
      className: 'uni-blist' + (props && props.className ? ' ' + props.className : ''),
      style: { width: size, height: size },
      role: label ? 'img' : undefined,
      'aria-hidden': label ? undefined : true,
      'aria-label': label || undefined,
      'data-uni-brand-logo': '',
    })
  }

  function mount(ctx) {
    ctx.inject(['slots'], function (scope) {
      scope.slots.inject('sidebar.brand.mark', function () {
        // Single slots render the lowest priority; disposal restores the official mark.
        return scope.slots.register({ name: 'sidebar.brand.mark', priority: -1 }, BlackHoleLogo)
      })
    })
  }
  return { mount: mount, component: BlackHoleLogo }
})()
