export type SheetDismissMove = { scrollOffset: number; dx: number; dy: number };
export type SheetDismissRelease = { distance: number; velocity: number; viewportHeight: number };

const MIN_DRAG_DISTANCE = 6;
const DISMISS_VIEWPORT_RATIO = 0.2;
const DISMISS_VELOCITY = 1;

export function canStartSheetDismiss({ scrollOffset, dx, dy }: SheetDismissMove) {
  return scrollOffset <= 0 && dy >= MIN_DRAG_DISTANCE && dy > Math.abs(dx);
}

export function sheetDismissRelease({ distance, velocity, viewportHeight }: SheetDismissRelease): 'restore' | 'commit-close' {
  const threshold = Math.max(64, viewportHeight * DISMISS_VIEWPORT_RATIO);
  return distance >= threshold || velocity >= DISMISS_VELOCITY ? 'commit-close' : 'restore';
}
