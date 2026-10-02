import { quickTitleExit } from './memoTap';

export async function confirmedQuickTitleExit({ lock, draft, save, target, onSave, onClose, onError, clearPending }: {
  lock: { current: boolean };
  draft: string;
  save: boolean;
  target: { id: string; title: string } | null;
  onSave: (id: string, title: string) => Promise<boolean | void> | boolean | void;
  onClose: (confirmed: boolean) => void;
  onError: () => void;
  clearPending: () => void;
}) {
  if (lock.current || !target) return;
  const result = quickTitleExit(draft, save);
  if (result.kind === 'invalid') { onError(); return; }
  lock.current = true;
  clearPending();
  if (result.kind === 'save' && result.title !== target.title) {
    try {
      if (await onSave(target.id, result.title) === false) {
        lock.current = false;
        onError();
        return;
      }
    } catch {
      lock.current = false;
      onError();
      return;
    }
  }
  onClose(result.kind === 'save');
}
