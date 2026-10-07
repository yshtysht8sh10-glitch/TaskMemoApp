import { useEffect, useRef } from 'react';
import type { VerticalResizeProps } from './VerticalResizeHandle';
import { useAppTheme } from '../theme/theme';

/** Pinned-note resize UI is the single source of truth for both editors. */
export function VerticalResizeHandle({ disabled = false, label, getHeight, setHeight, finish, minimum }: VerticalResizeProps) {
  const { colors } = useAppTheme();
  const drag = useRef<{ id: number; y: number; height: number } | null>(null);
  useEffect(() => { if (disabled) drag.current = null; return () => { drag.current = null; }; }, [disabled]);
  const update = (height: number) => setHeight(Math.max(minimum, height));
  return <div style={{ position: 'absolute', height: 20, left: 0, right: 0, bottom: 0 }}>
    <button type="button" disabled={disabled} aria-label={label}
      style={{ position: 'absolute', top: -12, left: 0, width: '100%', height: 44, boxSizing: 'border-box', padding: '12px 0', border: 0, background: 'transparent', cursor: disabled ? 'default' : 'ns-resize', touchAction: 'none', userSelect: 'none', opacity: disabled ? .45 : 1 }}
      onMouseDown={event => event.preventDefault()}
      onPointerDown={event => {
        if (disabled || !event.isPrimary || event.button !== 0 || drag.current) return;
        const height = getHeight(); if (height === null) return;
        event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { id: event.pointerId, y: event.clientY, height };
      }}
      onPointerMove={event => {
        const active = drag.current; if (disabled || !active || active.id !== event.pointerId) return;
        event.preventDefault(); update(active.height + event.clientY - active.y);
      }}
      onPointerUp={event => {
        if (drag.current?.id !== event.pointerId) return;
        drag.current = null;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
        finish?.();
      }}
      onPointerCancel={event => { if (drag.current?.id === event.pointerId) { drag.current = null; finish?.(); } }}
      onLostPointerCapture={() => { drag.current = null; }}
      onKeyDown={event => {
        if (disabled || !['ArrowUp', 'ArrowDown', 'Home'].includes(event.key)) return;
        const height = getHeight(); if (height === null) return;
        event.preventDefault(); update(event.key === 'Home' ? minimum : height + (event.key === 'ArrowDown' ? 40 : -40)); finish?.();
      }}>
      <span aria-hidden="true" style={{ height: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', borderTop: `1px solid ${colors.border}`, background: 'transparent', color: colors.textSecondary, fontSize: 12, fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif', fontWeight: 400, lineHeight: 'normal', letterSpacing: 'normal', padding: 0, margin: 0 }}>↕</span>
    </button>
  </div>;
}
