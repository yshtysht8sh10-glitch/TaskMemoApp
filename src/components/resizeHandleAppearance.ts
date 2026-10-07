import type { CSSProperties } from 'react';
import type { ThemeColors } from '../theme/theme';
/** Shared existing pinned-note appearance; interaction/height ownership stays with callers. */
export const RESIZE_HANDLE_VISUAL_HEIGHT = 20;
export function resizeHandleAppearance(colors: Pick<ThemeColors, 'border' | 'textSecondary'>): CSSProperties {
  return { height: RESIZE_HANDLE_VISUAL_HEIGHT, display: 'flex', alignItems: 'center', justifyContent: 'center',
    borderTop: `1px solid ${colors.border}`, color: colors.textSecondary, fontSize: 12,
    cursor: 'ns-resize', touchAction: 'none', userSelect: 'none' };
}
