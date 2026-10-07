// @vitest-environment jsdom
import React, { act, createRef } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import type { TextInput } from 'react-native';
import { EditorResizeHandle } from './EditorResizeHandle.web';
vi.mock('../theme/theme', () => ({ useAppTheme: () => ({ colors: { border: '#aaa', surfaceAlt: '#eee', text: '#111' } }) }));
it.each(['mouse', 'touch'])('resizes vertically with %s, preserves editor state, handles cancel and ignores other pointers', async pointerType => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const editor = document.createElement('textarea'); editor.value = '編集中\nIME'; editor.style.height = '260px';
  editor.getBoundingClientRect = () => ({ height: Number.parseFloat(editor.style.height) }) as DOMRect;
  document.body.append(editor); editor.focus(); editor.setSelectionRange(2, 4); editor.scrollLeft = 25;
  const ref = createRef<TextInput>(); ref.current = editor as unknown as TextInput;
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(<EditorResizeHandle editor={ref} disabled={false} />));
    const handle = host.querySelector('button')!;
    expect(handle.textContent).toBe('↕');
    expect(handle.style.height).toBe('44px');
    expect(handle.querySelector('span')!.style.height).toBe('20px');
    expect(handle.querySelector('span')!.style.fontSize).toBe('12px');
    expect(handle.querySelector('span')!.style.borderTopWidth).toBe('1px');
    handle.setPointerCapture = vi.fn(); handle.releasePointerCapture = vi.fn(); handle.hasPointerCapture = () => true;
    const send = async (name: string, y: number, id = 1) => {
      const event = new Event(name, { bubbles: true, cancelable: true });
      Object.assign(event, { clientY: y, pointerId: id, pointerType, button: 0, isPrimary: true });
      await act(async () => handle.dispatchEvent(event));
    };
    await send('pointerdown', 100); expect(handle.setPointerCapture).toHaveBeenCalledWith(1);
    await send('pointermove', 1000, 2); expect(editor.style.height).toBe('260px');
    await send('pointermove', 1040); expect(editor.style.height).toBe('1200px');
    await send('pointermove', -500); expect(editor.style.height).toBe('260px');
    await send('pointermove', 1040); await send('pointercancel', 1040); await send('pointermove', 2000);
    expect(editor.style.height).toBe('1200px'); expect(editor.value).toBe('編集中\nIME');
    expect(document.activeElement).toBe(editor); expect([editor.selectionStart, editor.selectionEnd]).toEqual([2, 4]);
    expect(editor.scrollLeft).toBe(25); expect(handle.style.touchAction).toBe('none');
    await act(async () => handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })));
    expect(editor.style.height).toBe('1240px');
    await act(async () => root.render(<EditorResizeHandle editor={ref} disabled />));
    await send('pointerdown', 0); await send('pointermove', 500); expect(editor.style.height).toBe('1240px');
  } finally { await act(async () => root.unmount()); host.remove(); editor.remove(); }
});
