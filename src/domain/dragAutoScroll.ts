export const DRAG_AUTOSCROLL_THRESHOLD_PX = 88;
export const DRAG_AUTOSCROLL_MAX_STEP_PX = 18;
export const NATIVE_DRAG_AUTOSCROLL_SPEED = 180;

export function edgeAutoScrollDelta(
  pointerY: number,
  top: number,
  bottom: number,
  threshold = DRAG_AUTOSCROLL_THRESHOLD_PX,
  maxStep = DRAG_AUTOSCROLL_MAX_STEP_PX,
) {
  const topDistance = pointerY - top;
  const bottomDistance = bottom - pointerY;
  if (topDistance >= 0 && topDistance < threshold) {
    const proximity = 1 - topDistance / threshold;
    return -maxStep * proximity * proximity;
  }
  if (bottomDistance >= 0 && bottomDistance < threshold) {
    const proximity = 1 - bottomDistance / threshold;
    return maxStep * proximity * proximity;
  }
  return 0;
}

type FrameRequest = (callback: () => void) => number;
type FrameCancel = (id: number) => void;

export function createDragAutoScroller({
  bounds,
  scrollBy,
  requestFrame,
  cancelFrame,
  afterScroll,
}: {
  bounds: () => { top: number; bottom: number } | null;
  scrollBy: (delta: number) => void;
  requestFrame: FrameRequest;
  cancelFrame: FrameCancel;
  afterScroll?: () => void;
}) {
  let frame: number | null = null;
  let pointerY: number | null = null;
  let dragging = false;

  const tick = () => {
    frame = null;
    if (!dragging) return;
    const currentBounds = bounds();
    const delta = pointerY === null || !currentBounds
      ? 0
      : edgeAutoScrollDelta(pointerY, currentBounds.top, currentBounds.bottom);
    if (delta !== 0) {
      scrollBy(delta);
      afterScroll?.();
    }
    frame = requestFrame(tick);
  };

  return {
    start(y: number) {
      pointerY = y;
      dragging = true;
      if (frame === null) frame = requestFrame(tick);
    },
    update(y: number) { pointerY = y; },
    stop() {
      dragging = false;
      pointerY = null;
      if (frame !== null) cancelFrame(frame);
      frame = null;
    },
  };
}
