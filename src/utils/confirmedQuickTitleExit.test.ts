import { expect, it, vi } from 'vitest';
import { confirmedQuickTitleExit } from './confirmedQuickTitleExit';

function setup(onSave = vi.fn(async () => true)) {
  return { lock: { current: false }, draft: ' new memo ', save: true,
    target: { id: 'create-today', title: '' }, onSave,
    onClose: vi.fn(), onError: vi.fn(), clearPending: vi.fn() };
}
it('overlapping submit, blur, and keyboard-hide confirm only once', async () => {
  let finish!: (saved: boolean) => void;
  const options = setup(vi.fn(() => new Promise<boolean>(resolve => { finish = resolve; })));
  const pending = confirmedQuickTitleExit(options);
  await confirmedQuickTitleExit(options);
  await confirmedQuickTitleExit(options);
  expect(options.onSave).toHaveBeenCalledTimes(1);
  expect(options.onClose).not.toHaveBeenCalled();
  finish(true);
  await pending;
  await confirmedQuickTitleExit(options);
  expect(options.onClose).toHaveBeenCalledExactlyOnceWith(true);
});
it.each(['false', 'throw'])('failed save (%s) retains input and allows explicit retry', async mode => {
  const onSave = vi.fn(async () => { if (mode === 'throw') throw Error('offline'); return false; });
  const options = setup(onSave);
  await confirmedQuickTitleExit(options);
  expect(options.onClose).not.toHaveBeenCalled();
  expect(options.onError).toHaveBeenCalledOnce();
  expect(options.draft).toBe(' new memo ');
  onSave.mockImplementation(async () => true);
  await confirmedQuickTitleExit(options);
  expect(options.onClose).toHaveBeenCalledExactlyOnceWith(true);
});
it('cancel beats the later blur confirmation without saving', async () => {
  const options = setup();
  await confirmedQuickTitleExit({ ...options, save: false });
  await confirmedQuickTitleExit(options);
  expect(options.onSave).not.toHaveBeenCalled();
  expect(options.onClose).toHaveBeenCalledExactlyOnceWith(false);
});
