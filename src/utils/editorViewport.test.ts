import { describe, expect, it } from 'vitest';

import { editorVisibleFrame } from './editorViewport';

describe('editor visual viewport frame', () => {
  it('anchors the sheet before and after the iOS page pan in the captured trace', () => {
    expect(editorVisibleFrame({ layoutHeight: 812, visibleHeight: 408, visibleOffsetTop: 0, windowScrollY: 0 }))
      .toEqual({ top: 0, height: 408 });
    expect(editorVisibleFrame({ layoutHeight: 812, visibleHeight: 408, visibleOffsetTop: 204.65625, windowScrollY: 205 }))
      .toEqual({ top: 409.65625, height: 408 });
  });

  it.each([
    ['top', 0], ['middle', 81], ['bottom', 160],
  ])('keeps normal caret and both selection-handle positions in view at %s', (_position, internalScroll) => {
    const frame = editorVisibleFrame({ layoutHeight: 812, visibleHeight: 408, visibleOffsetTop: 0, windowScrollY: 0 })!;
    // Measured before keyboard: sheet top 97.453, textarea top 343.453.
    const inputTopWithinSheet = 246 - internalScroll;
    if (internalScroll === 0) expect(97.453125 + inputTopWithinSheet + 115).toBeGreaterThan(408);
    for (const localY of [65, 95, 115]) {
      const pointY = frame.top + inputTopWithinSheet + localY;
      expect(pointY).toBeGreaterThanOrEqual(frame.top);
      expect(pointY).toBeLessThanOrEqual(frame.top + frame.height);
    }
  });

  it('leaves the normal sheet size unchanged without a keyboard', () => {
    expect(editorVisibleFrame({ layoutHeight: 812, visibleHeight: 812, visibleOffsetTop: 0, windowScrollY: 0 })).toBeNull();
  });
});
