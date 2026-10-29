/* Which page the shell is showing.
 *
 * The theme draws one backdrop now: the ASCII black hole (src/runtime/black-hole.js).
 * It is mounted for the whole session and only changes its framing, so all that is
 * left here is the part that belongs to the SHELL rather than to the artwork --
 * whether the new-session page is up.
 *
 * The signal is the hero slot. It exists only while the new-session page is showing,
 * so its presence in the slot index is the cheapest possible probe and needs no
 * route or session state. A mutation-driven watcher is used because the shell swaps
 * the hero out inside a React commit that emits no event of its own.
 *
 * 这里以前还带着整个星野（deep-space）渲染器。用户要求对话页只留黑洞
 * （2026-10-29 原话 m02133「对话页的星野先全部删除，只保留黑洞」），星野连同它的
 * 画布、预览、测试一起删掉了；页面判定是对外契约里唯一还被 client.js 用到的一截，
 * 所以单独留成这个文件。 */
var UniversePageMode = (function () {
  var HERO = "[data-slot='conversation.hero.brand.mark'],[data-slot='conversation.hero.workspace']"

  function isHome() {
    if (typeof document === 'undefined') return false
    return document.querySelector(HERO) !== null
  }

  /* Mutations on a streaming transcript are frequent, so the check is collapsed into
     one wake-up per 180ms. The page flip itself is exempt: the hero slot leaving the
     DOM is the only signal for "the reader left the home page", and the backdrop move
     that follows it has to start with the layout, not 180ms after it. A flip is also
     the cheapest possible probe -- one selector against the slot index -- so it can
     run on every mutation batch, and the flip test comes BEFORE the window guard: a
     pending timer must not delay a page change that is already readable from the tree. */
  function watchPageMode(callback) {
    if (typeof document === 'undefined' || typeof callback !== 'function') {
      return function noop() {}
    }
    var stopped = false
    var timer = 0
    var lastHome = null

    function check() {
      timer = 0
      if (stopped) return
      var home = isHome()
      if (home === lastHome) return
      lastHome = home
      callback(home)
    }

    function wake() {
      if (stopped) return
      if (isHome() !== lastHome) {
        if (timer !== 0) { clearTimeout(timer); timer = 0 }
        check()
        return
      }
      if (timer !== 0) return
      timer = setTimeout(check, 180)
    }

    var observer = null
    if (typeof MutationObserver === 'function') {
      observer = new MutationObserver(wake)
      var root = document.body || document.documentElement
      if (root) observer.observe(root, { childList: true, subtree: true })
    }
    check()

    return function stop() {
      if (stopped) return
      stopped = true
      if (timer !== 0) clearTimeout(timer)
      timer = 0
      if (observer !== null) observer.disconnect()
    }
  }

  return {
    isHome: isHome,
    watchPageMode: watchPageMode,
  }
})()
