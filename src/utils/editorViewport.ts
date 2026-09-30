export type EditorViewport = {
  layoutHeight: number;
  visibleHeight: number;
  visibleOffsetTop: number;
  windowScrollY: number;
};

// The modal is positioned in document coordinates while iOS moves the visual
// viewport independently when the keyboard appears.
export function editorVisibleFrame(viewport: EditorViewport) {
  if (!Number.isFinite(viewport.visibleHeight) || viewport.visibleHeight < 160 ||
      viewport.layoutHeight - viewport.visibleHeight < 80) return null;
  return {
    top: viewport.windowScrollY + Math.max(0, viewport.visibleOffsetTop),
    height: viewport.visibleHeight,
  };
}
