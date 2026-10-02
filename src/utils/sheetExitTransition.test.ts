import { expect, it, vi } from 'vitest';
import { createSheetExitTransition } from './sheetExitTransition';

function setup(onDismiss = vi.fn(async (): Promise<boolean | void> => undefined)) {
  let complete!: (finished: boolean) => void;
  const animate = vi.fn((_target: number, _duration: number, callback: (finished: boolean) => void) => { complete = callback; });
  const restore = vi.fn();
  const stop = vi.fn();
  const transition = createSheetExitTransition({ animate, restore, stop });
  return { transition, animate, restore, stop, onDismiss, complete: (finished: boolean) => complete(finished) };
}
it('continues from release position and dismisses only after finishing offscreen', async () => {
  const s = setup();
  s.transition.exit({ distance: 160, velocity: 1, viewportHeight: 800 }, s.onDismiss);
  expect(s.animate).toHaveBeenCalledWith(800, expect.any(Number), expect.any(Function));
  expect(s.restore).not.toHaveBeenCalled();
  expect(s.onDismiss).not.toHaveBeenCalled();
  s.complete(true);
  await Promise.resolve();
  expect(s.onDismiss).toHaveBeenCalledOnce();
});
it('interrupted animation restores and does not dismiss', () => {
  const s = setup();
  s.transition.exit({ distance: 160, velocity: 1, viewportHeight: 800 }, s.onDismiss);
  s.complete(false);
  expect(s.onDismiss).not.toHaveBeenCalled();
  expect(s.restore).toHaveBeenCalledOnce();
});
it('ignores repeated releases during animation and pending save', async () => {
  let resolve!: (saved: boolean) => void;
  const s = setup(vi.fn(() => new Promise<boolean>(r => { resolve = r; })));
  const release = { distance: 160, velocity: 1, viewportHeight: 800 };
  s.transition.exit(release, s.onDismiss);
  s.transition.exit(release, s.onDismiss);
  s.complete(true);
  s.transition.exit(release, s.onDismiss);
  expect(s.animate).toHaveBeenCalledOnce();
  expect(s.onDismiss).toHaveBeenCalledOnce();
  resolve(true);
  await Promise.resolve();
  expect(s.restore).not.toHaveBeenCalled();
});
it.each(['false', 'throw'])('restores on rejected dismissal (%s) and permits retry', async mode => {
  const s = setup(vi.fn(async () => { if (mode === 'throw') throw Error('offline'); return false; }));
  const release = { distance: 160, velocity: 1, viewportHeight: 800 };
  s.transition.exit(release, s.onDismiss);
  s.complete(true);
  await Promise.resolve();
  expect(s.restore).toHaveBeenCalledOnce();
  s.transition.exit(release, s.onDismiss);
  expect(s.animate).toHaveBeenCalledTimes(2);
});
it('cleanup cancels late animation completion without dismissing or restoring', () => {
  const s = setup();
  s.transition.exit({ distance: 160, velocity: 1, viewportHeight: 800 }, s.onDismiss);
  s.transition.cancel();
  s.complete(true);
  expect(s.stop).toHaveBeenCalledOnce();
  expect(s.onDismiss).not.toHaveBeenCalled();
  expect(s.restore).not.toHaveBeenCalled();
});
it('cleanup also ignores a pending save failure after unmount', async () => {
  let finish!: (saved: boolean) => void;
  const s = setup(vi.fn(() => new Promise<boolean>(resolve => { finish = resolve; })));
  s.transition.exit({ distance: 160, velocity: 1, viewportHeight: 800 }, s.onDismiss);
  s.complete(true);
  s.transition.cancel();
  finish(false);
  await Promise.resolve();
  expect(s.restore).not.toHaveBeenCalled();
});
