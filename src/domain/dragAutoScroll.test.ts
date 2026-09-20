import { describe, expect, it, vi } from 'vitest';
import { createDragAutoScroller, edgeAutoScrollDelta } from './dragAutoScroll';

describe('edgeAutoScrollDelta', () => {
  it('端領域外ではscrollしない', () => {
    expect(edgeAutoScrollDelta(150, 0, 300)).toBe(0);
  });

  it('上端と下端へ正しい方向にscrollする', () => {
    expect(edgeAutoScrollDelta(30, 0, 300)).toBeLessThan(0);
    expect(edgeAutoScrollDelta(270, 0, 300)).toBeGreaterThan(0);
  });

  it('端へ近づくほど速度が上がる', () => {
    expect(Math.abs(edgeAutoScrollDelta(10, 0, 300))).toBeGreaterThan(Math.abs(edgeAutoScrollDelta(60, 0, 300)));
    expect(edgeAutoScrollDelta(290, 0, 300)).toBeGreaterThan(edgeAutoScrollDelta(240, 0, 300));
  });
});

describe('createDragAutoScroller', () => {
  it('pointerが静止していてもdrag中は継続し、端を離れるとscrollを止める', () => {
    const frames: (() => void)[] = [];
    const scrollBy = vi.fn();
    const afterScroll = vi.fn();
    const scroller = createDragAutoScroller({
      bounds: () => ({ top: 0, bottom: 300 }),
      scrollBy,
      requestFrame: (callback) => { frames.push(callback); return frames.length; },
      cancelFrame: vi.fn(),
      afterScroll,
    });
    scroller.start(295);
    frames.shift()?.();
    frames.shift()?.();
    expect(scrollBy).toHaveBeenCalledTimes(2);
    expect(afterScroll).toHaveBeenCalledTimes(2);
    scroller.update(150);
    frames.shift()?.();
    expect(scrollBy).toHaveBeenCalledTimes(2);
  });

  it('drag終了時に予約frameをcancelする', () => {
    const cancelFrame = vi.fn();
    const scroller = createDragAutoScroller({
      bounds: () => ({ top: 0, bottom: 300 }),
      scrollBy: vi.fn(),
      requestFrame: () => 42,
      cancelFrame,
    });
    scroller.start(295);
    scroller.stop();
    expect(cancelFrame).toHaveBeenCalledWith(42);
  });
});
