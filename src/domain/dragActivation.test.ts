import { describe, expect, it } from 'vitest';
import { dragActivationDelay, exceedsWebTouchDragTolerance, NATIVE_DRAG_ACTIVATION_DISTANCE_PX, WEB_TOUCH_DRAG_SCROLL_TOLERANCE_PX } from './dragActivation';

describe('dragActivationDelay', () => {
  it('Webは短い待ち、Nativeは誤操作を抑えつつ従来より短い待ちにする', () => {
    expect(dragActivationDelay(true)).toBe(120);
    expect(dragActivationDelay(false)).toBe(180);
    expect(NATIVE_DRAG_ACTIVATION_DISTANCE_PX).toBe(8);
  });

  it('Web touchは短い待機中の指ぶれを許容し、明確な縦スワイプはdragにしない', () => {
    expect(WEB_TOUCH_DRAG_SCROLL_TOLERANCE_PX).toBe(8);
    expect(exceedsWebTouchDragTolerance(10, 20, 14, 24)).toBe(false);
    expect(exceedsWebTouchDragTolerance(10, 20, 10, 29)).toBe(true);
  });
});
