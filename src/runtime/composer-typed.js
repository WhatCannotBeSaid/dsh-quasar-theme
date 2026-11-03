/* Private factory input; concatenated by CLIENT_FILES, not a public module. */

    /* The composer's typed state (round 79, 2026-10-31)

       The hero page draws its ghost fill ("输入一句话，宇宙会回应") from the composer's
       EMPTY state, and the card only knows it has a value through this attribute. There is
       no official hook for "has text": the card's own state lives in Lexical's editor, a
       contenteditable whose emptiness is spelled in ways a selector cannot see -- see
       composerHasText. */

    /* Reads the card's editor and decides whether it holds any visible character. The
       editor node is [data-composer-input] first, [role='textbox'] as the fallback --
       both spellings exist in this shell across plugin versions, and neither has a
       width to measure: textContent is the only thing to read. Zero-width marks
       (a zero-width space, a placeholder node, a stray br) are exactly what a
       selector would get subtly wrong.

       Why these three events and no MutationObserver. 'input' fires on typing,
       paste and undo -- every path that changes text. 'focusin'/'focusout' re-check
       at the two moments text can change with no 'input' in between (Lexical
       normalising on blur, a draft landing as the card takes focus). An observer
       would be the complete answer, but it would fire on every streamed token of
       every conversation, while this state is only ever read by a rule already gated
       on the hero page -- a cost with no reader.

       Reads are batched into one animation frame: Lexical mutates its DOM during
       the 'input' handler's own turn, and the frame after is when those mutations
       have landed. Nothing is written when the answer has not changed, so a card
       that is not being typed into produces no attribute writes at all.

       Known bound: a card prefilled by something that fires none of the three events
       (a restored draft landing while the page is already unfocused) keeps the ghost
       fill until the reader touches it. Every user-driven path hits one of the
       three. */
    function mountComposerTyped() {
      function composerHasText(card) {
        var editor = card.querySelector("[data-composer-input]")
        if (editor === null) editor = card.querySelector("[role='textbox']")
        if (editor === null) return false
        /* Character codes, not a regex with escapes: this file is interpolated verbatim
           into the bundle, and U+200B..U+200D / U+FEFF are the ways an editor spells
           "empty" inside a string. Whitespace counts as empty too. */
        var text = editor.textContent || ''
        for (var i = 0; i < text.length; i += 1) {
          var code = text.charCodeAt(i)
          if (code === 0x200b || code === 0x200c || code === 0x200d || code === 0xfeff) continue
          if (code === 32 || code === 9 || code === 10 || code === 13) continue
          return true
        }
        return false
      }

      function syncComposerTyped() {
        var cards = document.querySelectorAll('[data-composer-card]')
        for (var i = 0; i < cards.length; i += 1) {
          var card = cards[i]
          var typed = composerHasText(card)
          if (typed === (card.getAttribute('data-uni-composer-typed') === 'true')) continue
          if (typed) card.setAttribute('data-uni-composer-typed', 'true')
          else card.removeAttribute('data-uni-composer-typed')
        }
      }

      var frame = null
      function flush() {
        frame = null
        syncComposerTyped()
      }
      function schedule() {
        if (frame !== null) return
        frame = typeof requestAnimationFrame === 'function'
          ? requestAnimationFrame(flush)
          : setTimeout(flush, 16)
      }
      syncComposerTyped()
      document.addEventListener('input', schedule, true)
      document.addEventListener('focusin', schedule, true)
      document.addEventListener('focusout', schedule, true)
      return function () {
        document.removeEventListener('input', schedule, true)
        document.removeEventListener('focusin', schedule, true)
        document.removeEventListener('focusout', schedule, true)
        if (frame !== null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame)
      }
    }
