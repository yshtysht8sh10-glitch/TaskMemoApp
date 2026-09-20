export const WEB_DRAG_ACTIVATION_DELAY_MS = 120;
export const NATIVE_DRAG_ACTIVATION_DELAY_MS = 180;
export const NATIVE_DRAG_ACTIVATION_DISTANCE_PX = 8;
export const WEB_TOUCH_DRAG_SCROLL_TOLERANCE_PX = 8;

export const dragActivationDelay = (isWeb: boolean) => isWeb ? WEB_DRAG_ACTIVATION_DELAY_MS : NATIVE_DRAG_ACTIVATION_DELAY_MS;

export const exceedsWebTouchDragTolerance = (startX: number, startY: number, x: number, y: number) =>
  Math.hypot(x - startX, y - startY) > WEB_TOUCH_DRAG_SCROLL_TOLERANCE_PX;

export const webTouchDragOverlayPosition = (clientX: number, clientY: number, offsetX: number, offsetY: number) => ({
  left: clientX - offsetX,
  top: clientY - offsetY,
});
