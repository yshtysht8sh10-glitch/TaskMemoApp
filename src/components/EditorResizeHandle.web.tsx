import type { EditorResizeProps } from './EditorResizeHandle';
import { VerticalResizeHandle } from './VerticalResizeHandle.web';

export function EditorResizeHandle({ editor, disabled }: EditorResizeProps) {
  const input = () => editor.current as unknown as HTMLTextAreaElement | null;
  return <VerticalResizeHandle disabled={disabled} label="編集領域の高さを変更（上下にドラッグ、矢印キーでも変更）" minimum={260}
    getHeight={() => input()?.getBoundingClientRect().height ?? null}
    setHeight={height => { const target = input(); if (target) target.style.height = height + 'px'; }} />;
}
