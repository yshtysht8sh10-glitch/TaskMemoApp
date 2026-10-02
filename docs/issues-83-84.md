# Issues 83 / 84 implementation and acceptance

## Cause and fix

- #83: QuickTitleEditor rendered its own confirm button in addition to keyboard controls. Removed that button; submit, blur (iOS Web accessory Done), and native keyboard-hide continue to use one confirmed-save path. Extracted that existing path for deferred-save, failure/retry, and cancellation tests.
- #84 editor: the only gesture surface was a 28px grabber inside ScrollView, gated by content scroll offset. Browser scrolling could also take the touch stream. The title area did not accept dismissal.
- #84 settings: Sheet had no dismissal responder at all; scrolling or adjusting the editor threshold could not fix it.
- Both now use SheetDismissHeader outside ScrollView. The handle and title form a persistent touch surface, own the responder from touch start, and use touch-action:none on Web. Content scroll offset cannot disable this independent header. Horizontal/upward/short gestures restore the sheet. Existing release thresholds are unchanged.
- Editor dismissal still goes through save()/onSave; a failed save does not close the sheet. Body selection, editorKeyboardDismissMode, keyboard scroll/visualViewport writers, and lack of automatic editor input focus from #81 remain unchanged. Settings backdrop is a sibling to the sheet, avoiding a parent press action during interaction.

## Verification

Regression before implementation: both missing external headers and the QuickTitleEditor confirm button failed (3 tests).
Focused tests include header placement, Web touch ownership, quick title overlapping confirmations, deferred save, failure/retry and cancel. Related #81 viewport, scroll, diagnostics, focus, and input-visibility tests passed.

## iPhone acceptance (user; not verified on a physical device)

- In Quick Add, check that the app confirm checkmark is gone. Confirm once with each keyboard control; verify one memo is created. Cancel with ×. Verify failed saving retains the input and shows the error.
- Swipe down starting at handle or title in edit and settings. Repeat after scrolling internal content. Short/upward/horizontal gestures should restore the sheet.
- In edit, scroll freely within the body, move the cursor and both selection handles, and check focus/selection remains stable with the keyboard and viewport changes.
- Verify edits are saved when dismissing; failed saving must leave the sheet open.

Keep #83 and #84 open until user iPhone acceptance.
