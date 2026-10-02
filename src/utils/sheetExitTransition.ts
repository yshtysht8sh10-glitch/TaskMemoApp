import type { SheetDismissRelease } from './sheetDismissGesture';

type Dismiss = () => boolean | void | Promise<boolean | void>;

// The animation adapter never resets the release position. Visibility changes
// belong exclusively to onDismiss, after a successful animation completion.
export function createSheetExitTransition({ animate, restore, stop }: {
  animate: (destination: number, duration: number, complete: (finished: boolean) => void) => void;
  restore: () => void;
  stop: () => void;
}) {
  let phase: 'idle' | 'exiting' | 'saving' | 'hidden' = 'idle';
  let generation = 0;
  return {
    busy: () => phase !== 'idle',
    exit(release: SheetDismissRelease, onDismiss: Dismiss) {
      if (phase !== 'idle') return;
      phase = 'exiting';
      const token = ++generation;
      const destination = Math.max(release.distance, release.viewportHeight);
      const duration = Math.min(320, Math.max(160, (destination - release.distance) / Math.max(1.5, release.velocity)));
      animate(destination, duration, async finished => {
        if (token !== generation || phase !== 'exiting') return;
        if (!finished) { phase = 'idle'; restore(); return; }
        phase = 'saving';
        let accepted = false;
        try { accepted = await onDismiss() !== false; } catch { /* restore the still-open sheet */ }
        if (token !== generation) return;
        phase = accepted ? 'hidden' : 'idle';
        if (!accepted) restore();
      });
    },
    cancel() {
      ++generation;
      phase = 'idle';
      stop();
    },
  };
}
