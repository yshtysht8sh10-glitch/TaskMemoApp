import { useEffect, useRef } from 'react';
import type { EditorResizeProps } from './EditorResizeHandle';
import { useAppTheme } from '../theme/theme';

export function EditorResizeHandle({ editor, disabled }: EditorResizeProps) {
  const { colors } = useAppTheme();
  const drag = useRef<{ id: number; y: number; height: number; input: HTMLTextAreaElement } | null>(null);
  useEffect(() => { if (disabled) drag.current = null; return () => { drag.current = null; }; }, [disabled]);
  const input = () => editor.current as unknown as HTMLTextAreaElement | null;
  const resize = (target: HTMLTextAreaElement, height: number) => { target.style.height = `${Math.max(260, height)}px`; };
  return <button type="button" disabled={disabled} aria-label="編集領域の高さを変更（上下にドラッグ、矢印キーでも変更）"
    style={{ width: '100%', minHeight: 44, flexShrink: 0, border: `1px solid ${colors.border}`, borderRadius: 8, background: colors.surfaceAlt, color: colors.text, cursor: disabled ? 'default' : 'ns-resize', touchAction: 'none', userSelect: 'none', opacity: disabled ? .45 : 1 }}
    onMouseDown={event => event.preventDefault()}
    onPointerDown={event => {
      if (disabled || !event.isPrimary || event.button !== 0 || drag.current) return;
      const target = input(); if (!target) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      drag.current = { id: event.pointerId, y: event.clientY, height: target.getBoundingClientRect().height, input: target };
    }}
    onPointerMove={event => {
      const active = drag.current;
      if (disabled || !active || active.id !== event.pointerId) return;
      event.preventDefault(); resize(active.input, active.height + event.clientY - active.y);
    }}
    onPointerUp={event => {
      if (drag.current?.id !== event.pointerId) return;
      drag.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    }}
    onPointerCancel={() => { drag.current = null; }} onLostPointerCapture={() => { drag.current = null; }}
    onKeyDown={event => {
      if (disabled || !['ArrowUp', 'ArrowDown', 'Home'].includes(event.key)) return;
      const target = input(); if (!target) return;
      event.preventDefault(); resize(target, event.key === 'Home' ? 260 : target.getBoundingClientRect().height + (event.key === 'ArrowDown' ? 40 : -40));
    }}>
    <span aria-hidden="true">↕ ━━━ </span>上下にドラッグして高さを変更
  </button>;
}
