export type VisibleViewport = {
  height: number;
  offsetTop: number;
};

export type ElementBounds = {
  bottom: number;
  top: number;
};

export type ScrollContainerMetrics = {
  clientHeight: number;
  scrollHeight: number;
  scrollTop: number;
};

const MIN_USABLE_VIEWPORT_HEIGHT = 160;
const KEYBOARD_HEIGHT_THRESHOLD = 80;

export function normalizeVisibleViewport(
  viewport: VisibleViewport,
  layoutViewport: VisibleViewport,
): VisibleViewport {
  const layoutHeight =
    Number.isFinite(layoutViewport.height) &&
    layoutViewport.height >= MIN_USABLE_VIEWPORT_HEIGHT
      ? layoutViewport.height
      : MIN_USABLE_VIEWPORT_HEIGHT;
  if (
    !Number.isFinite(viewport.height) ||
    viewport.height < MIN_USABLE_VIEWPORT_HEIGHT
  )
    return { height: layoutHeight, offsetTop: 0 };

  const height = Math.min(viewport.height, layoutHeight);
  const maxOffset = Math.max(0, layoutHeight - height);
  const offsetTop =
    Number.isFinite(viewport.offsetTop) &&
    viewport.offsetTop >= 0 &&
    viewport.offsetTop <= maxOffset + 1
      ? viewport.offsetTop
      : 0;
  return { height, offsetTop };
}

export function shouldRevealFocusedInput(
  viewport: VisibleViewport,
  layoutViewport: VisibleViewport,
) {
  const normalized = normalizeVisibleViewport(viewport, layoutViewport);
  return layoutViewport.height - normalized.height >= KEYBOARD_HEIGHT_THRESHOLD;
}

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

export function focusedInputScrollPlan(
  container: ScrollContainerMetrics,
  offset: number,
) {
  const targetScrollTop = Math.max(0, container.scrollTop + offset);
  const maxScrollTop = Math.max(0, container.scrollHeight - container.clientHeight);
  return {
    extraBottomSpace: Math.max(0, targetScrollTop - maxScrollTop),
    targetScrollTop,
  };
}
