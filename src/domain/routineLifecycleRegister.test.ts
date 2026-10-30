import { expect, it } from 'vitest';
import { mergeRoutineLifecycle, replayRoutineLifecycle } from './routineLifecycleRegister';

it('converges regardless of delivery order and preserves lifecycle across content-only writes', () => {
  const a = { version: 1, periods: [{ completedAt: '2026-10-01T00:00:00.000Z', resumedAt: null, retained: {} }] };
  const b = { version: 1, periods: [{ completedAt: '2026-10-02T00:00:00.000Z', resumedAt: null, retained: {} }] };
  expect(mergeRoutineLifecycle(a, b)).toEqual(mergeRoutineLifecycle(b, a));
  expect(mergeRoutineLifecycle(a, undefined)).toEqual(a);
  const undo = replayRoutineLifecycle(a, undefined)!;
  expect(undo).toEqual({ version: 2, periods: [] });
  expect(mergeRoutineLifecycle(undo, a)).toEqual(undo);
  const redo = replayRoutineLifecycle(undo, a)!;
  expect(redo.version).toBe(3);
  expect(mergeRoutineLifecycle(a, redo)).toEqual(redo);
});

it('fails closed on corrupt lifecycle rather than resuming generation', () => {
  expect(() => mergeRoutineLifecycle({ version: 1, periods: [{ completedAt: 'bad', resumedAt: null, retained: {} }] })).toThrow(/原本を保持/);
});
