/* Private factory input; concatenated by CLIENT_FILES, not a public module. */

    /* 品牌行分区（round 79, 2026-10-31 迁出 src/client.js 的延迟回调）

       The sidebar brand row is one button in the official DOM, but it carries three
       surfaces: the mark (ours, which opens the plugin panel), the name (official New
       session), and the CORE chip to its right (opens Settings). The official handler
       treats the whole row as New session, so a click on either end is intercepted in
       the capture phase and routed.

       Every mismatch falls back to the official behaviour rather than to a dead
       click: keyboard activation has no coordinates and is let through, a modified
       click is left to the browser, and anything that is not the mark is not
       intercepted at all. The mark zone is the one exception -- with its button gone
       it presses the command's own shortcut instead, the same command by another
       door (measured: the dispatcher reads the event's keys, not its isTrusted
       flag).

       Zones are measured at click time, never cached: the sidebar can be wide
       (mark + name) or a rail (mark only, no name -- and then no brand button at
       all), and a cached box would route a click to the wrong surface. */
    function mountBrandRowZones(ctx) {
      if (typeof document === 'undefined') return undefined

      var NAME = "[data-slot='sidebar.brand.name']"
      var MARK = "[data-slot='sidebar.brand.mark']"
      var LAUNCHER = "[data-slot='settings.launcher'] > button"
      /* The panel row the sheet hides by its two accessible names (zh 插件 / en
       * Plugins); the same pair of selectors lives in src/theme.css and in the css.10
       * assertion, so the three move together. */
      var PANEL_ROW = "[data-slot='sidebar'] > div > nav[aria-label] > button:has([data-slot='sidebar.panellist'])[aria-label='插件'], [data-slot='sidebar'] > div > nav[aria-label] > button:has([data-slot='sidebar.panellist'])[aria-label='Plugins']"

      /* The settings command by its other door. dsh-client-shortcuts declares a map
         per receiving device and the two maps disagree on this one command: the
         desktop build binds settings.open to Ctrl+, and the web build to Ctrl+Alt+,.
         The host decides which map is in force exactly one way -- detectEnvironment
         reads document.documentElement.dataset.platform and calls it desktop when
         the attribute is there -- so the same test picks the chord here. Only ONE
         event is dispatched: sending both would match twice, and the second match
         lands with modal === 'settings', whose resolve() closes the panel it just
         opened. Reached only when the launcher button is absent from the DOM.

         Why absent covers the account card too (round 64, D101): when
         ui-settings-account is enabled the slot holds a Menu trigger, not a button
         -- the real chain is div[data-slot] > div > span > button -- so the direct-
         child selector above matches nothing and this is the path that runs. That
         is what keeps SYSTEM live while the sheet hides the card's subtree. */
      /* Round 68 (2026-10-20): a synthesised keydown does NOT reach the command
         registry on the desktop build. dsh-client-shortcuts installs the DOM
         listener with native = true there (ShortcutsService: the keyboard bridge
         exists whenever runtime is desktop), and its keydown handler returns
         right after the fixed-input hook -- client.js:813, 'if (native) return'.
         Bindings are resolved only from the native bridge in that build, so the
         synthetic event was silently dropped and SYSTEM became a dead click as
         soon as the account card pushed the button out of LAUNCHER. Web builds
         keep native = false and still dispatch, which is why this reproduced only
         after the account plugin was enabled on the desktop profile.
         The fix is to ask the command registry directly instead of synthesising a
         key press. ctx.shortcuts is the ShortcutsService; the invocable registry is
         service.registry, and registry.invoke(id, context) is the same door the
         native menu uses (dsh-client-shortcuts/lib/client.js:644). The context is
         exactly the facts settings.open's resolve() reads -- the topmost modal and
         the focused region -- probed from the live document with the host's own
         modalSelector expression, so the command behaves as if chosen from the
         menu: closed settings open, open settings close.
         The chord below stays as the second door for a build without the service,
         and is still the only thing that runs if invoke() throws. */
      var modalScopeOf = function () {
        var nodes = document.querySelectorAll('[role="dialog"][aria-modal="true"], [role="menu"]')
        /* The host's selector, read the host's way: the LAST match in the document,
           on screen or not (dsh-client-ui-primitives modalSelector; the keyboard
           path at dsh-client-shortcuts/lib/client.js:1405 reads it identically). A
           popover that collapses by CSS while staying mounted therefore counts as an
           open modal, and a scope other than settings refuses the invoke below.
           Round 69 (2026-10-24): walk back past matches with no layout box, so the
           scope returned is the modal a person could actually see. The composer's two
           picker popovers used to claim role="menu" while closed and are fixed at the
           source (src/model-effort-picker.js, setMenuRole); this guard covers the same
           mistake made by any other mounted popover. Without it, SYSTEM is a dead
           click in a conversation and live everywhere else -- exactly the asymmetry
           that was reported. */
        for (var i = nodes.length - 1; i >= 0; i -= 1) {
          var node = nodes[i]
          if (node.getClientRects().length === 0) continue
          var scope = node.getAttribute('data-shortcut-modal')
          return scope === null || scope === '' ? 'other' : scope
        }
        return null
      }

      var pressSettingsShortcut = function () {
        var service = ctx.get('shortcuts')
        var registry = service === null || service === undefined ? undefined : service.registry
        if (registry !== undefined && registry !== null && typeof registry.invoke === 'function') {
          var modal = modalScopeOf()
          /* invoke() silently drops a command whose modals list excludes the
             current modal, so a foreign dialog is left alone here rather than
             looking like a click that did nothing. */
          if (modal === null || modal === 'settings') {
            var focus = document.activeElement
            var editable = focus !== null && typeof focus.matches === 'function' &&
              focus.matches('input, textarea, select, [contenteditable="true"], [contenteditable=""]')
            try {
              registry.invoke('settings.open', {
                target: focus, region: editable ? 'editable' : 'page', modal: modal, source: 'menu',
              })
              return
            }
            catch (error) { /* fall through to the chord below */ }
          }
        }
        if (typeof KeyboardEvent !== 'function') return
        var desktop = document.documentElement.dataset.platform !== undefined
        document.dispatchEvent(new KeyboardEvent('keydown', {
          key: ',', code: 'Comma', ctrlKey: true, altKey: !desktop, bubbles: true, cancelable: true,
        }))
      }

      var onCapture = function (event) {
        if (event.button !== 0) return
        if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return
        var node = event.target
        /* The target used to be compared against null alone where the code lived in the
           factory, so an event with no node (a dispatch whose target was never set, or
           one retargeted to a window) threw a TypeError out of a capture listener.
           Strictly this module's exported shape; the measured paths always carry a
           node, and any node without closest() is still let through untouched. */
        var button = node !== null && node !== undefined && typeof node.closest === 'function'
          ? node.closest('button')
          : null
        if (button === null) return
        var name = button.querySelector(NAME)
        if (name === null) return
        /* detail 0 is Enter/Space on the focused button (and any programmatic
           click): no coordinates, so no zone -- the official new session stands. */
        if (event.detail === 0) return
        var mark = button.querySelector(MARK)
        var x = event.clientX
        var zone = ''
        /* Three zones, and the middle one is nobody's: left of the mark's right edge
           opens the plugin panel, the name keeps the official New session, and
           anything right of the name -- that is the CORE chip -- opens Settings.
           Every box is read live, so a wider word or a resized chip moves the
           boundary with it. */
        if (mark !== null && x < mark.getBoundingClientRect().right) zone = 'plugins'
        else if (x >= name.getBoundingClientRect().right) zone = 'settings'
        if (zone === '') return
        var hidden = document.querySelector(zone === 'plugins' ? PANEL_ROW : LAUNCHER)
        /* A missing plugin row is not intercepted at all, so the click still falls
           through to the official handler instead of becoming a hole. */
        if (hidden === null && zone === 'plugins') return
        event.stopPropagation()
        event.preventDefault()
        if (hidden !== null) hidden.click()
        else pressSettingsShortcut()
      }

      document.addEventListener('click', onCapture, true)
      return () => { document.removeEventListener('click', onCapture, true) }
    }
