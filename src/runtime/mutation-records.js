/* Private factory input; concatenated by CLIENT_FILES, not a public module. */

    /* Does a MutationObserver batch touch a selector?

       glass.js and lens.js each own a childList observer over the same root and each
       asks the same question of every batch: could something this observer watches
       have just mounted or unmounted? Testing the handful of nodes the batch actually
       added or removed is exact rather than a guess -- both observers watch childList
       only, so nothing but an addition or a removal can change which elements match a
       selector. Without this test every batch paid a document-wide query for each
       target. One of glass's targets, [data-sidebar-right-guide-entry], is not
       rendered at all on a plain new-Session page: there the query could never find
       anything, and it still ran once per batch -- under a streaming reply, once per
       coalesced frame, for nothing.

       Short-circuit order is part of the contract: the node's own matches first, then
       its descendants. A record's two bags are both read -- a removal can be the
       unmount that frees the slot the next surface mounts into. */
    var uniMutationTouches = function (records, selector) {
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

    /* Can this whole batch be PROVED unrelated to a selector? True means "sync". Only a
       non-empty batch of pure additions -- every record childList with a node bag, no
       removal, and every added node's own match and subtree both checked -- may answer
       false. Anything undecidable stays related: an attribute or other record, any
       removal (an unmount frees the slot the next surface mounts into), a missing bag or
       type, an empty childList, a null node, and any node that is not an Element, Text or
       Comment. The last four are fixture shapes, not browser ones.
       ponytail: the reasoning assumes a plain tag / attribute / ancestor selector, which
       both callers use. A :has, sibling or positional selector -- one that moving
       unrelated nodes can void or satisfy without adding a matching node -- needs it
       re-derived. Do not grow a general selector analyser. */
    var uniStatusMutationTouches = function (records, selector) {
      if (records === null || records === undefined || records.length === 0) return true
      for (var r = 0; r < records.length; r += 1) {
        var record = records[r]
        if (record === null || record === undefined || record.type !== 'childList') return true
        /* Both bags are read: a removal can be the unmount that frees the slot the next
           surface mounts into, so any removal answers related. */
        var removed = record.removedNodes
        if (removed === undefined || removed === null || removed.length !== 0) return true
        var added = record.addedNodes
        if (added === undefined || added === null || added.length === 0) return true
        /* A real bag indexes its nodes and answers item(); either one answering null is an
           undecided node, never a clean batch. */
        var probe = function (nodes, i) {
          return nodes.item(i) ?? nodes[i] ?? null
        }
        for (var d = 0; d < removed.length; d += 1) {
          if (probe(removed, d) === null) return true
        }
        for (var n = 0; n < added.length; n += 1) {
          var node = probe(added, n)
          if (node === null) return true
          /* Text and Comment cannot match or contain a match; an Element is asked both its
             own match and its subtree. Any other type is not proved unrelated. */
          if (node.nodeType === 1) {
            /* 一个没有 matches 的 Element 无法回答自身是否命中；querySelector 仍能让「后代
               命中」这一半成立，所以两个方法各自按「有没有、说了什么」判断。 */
            if ((typeof node.matches === 'function' && node.matches(selector)) ||
                (typeof node.querySelector === 'function' && node.querySelector(selector) !== null)) return true
          } else if (node.nodeType !== 3 && node.nodeType !== 8) return true
        }
      }
      return false
    }
