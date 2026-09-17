export type VisibleViewport = {
  height: number;
  offsetTop: number;
};

export type ElementBounds = {
  bottom: number;
  top: number;
};

export function focusedInputScrollDirection(
  bounds: ElementBounds,
  viewport: VisibleViewport,
  margin = 16,
): "down" | "up" | null {
  const offset = focusedInputScrollOffset(bounds, viewport, margin);
  if (offset > 0) return "down";
  if (offset < 0) return "up";
  return null;
}

export function focusedInputScrollOffset(
  bounds: ElementBounds,
  viewport: VisibleViewport,
  margin = 16,
): number {
  const visibleTop = viewport.offsetTop + margin;
  const visibleBottom = viewport.offsetTop + viewport.height - margin;
  const availableHeight = visibleBottom - visibleTop;
  if (bounds.bottom - bounds.top > availableHeight) {
    if (bounds.top >= visibleBottom) return bounds.top - visibleTop;
    if (bounds.bottom <= visibleTop) return bounds.bottom - visibleBottom;
    return 0;
  }
  if (bounds.bottom > visibleBottom) return bounds.bottom - visibleBottom;
  if (bounds.top < visibleTop) return bounds.top - visibleTop;
  return 0;
}
