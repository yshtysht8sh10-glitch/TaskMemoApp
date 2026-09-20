import { describe, expect, it } from 'vitest';
import { dragActivationDelay, NATIVE_DRAG_ACTIVATION_DISTANCE_PX } from './dragActivation';

describe('dragActivationDelay', () => {
  it('Webは短い待ち、Nativeは誤操作を抑えつつ従来より短い待ちにする', () => {
    expect(dragActivationDelay(true)).toBe(120);
    expect(dragActivationDelay(false)).toBe(180);
    expect(NATIVE_DRAG_ACTIVATION_DISTANCE_PX).toBe(8);
  });
});
