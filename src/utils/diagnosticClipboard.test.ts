import { afterEach, expect, it, vi } from 'vitest';
import { copyDiagnosticText, mountDiagnosticCopyPanel } from './diagnosticClipboard';

afterEach(() => vi.useRealTimers());

it('stops waiting when the clipboard promise never settles', async () => {
  vi.useFakeTimers();
  const f = fixture('?keyboardDiagnostics=1', vi.fn(() => new Promise<void>(() => {})));
  const [button, status] = f.body.children[0].children;
  button.dispatchEvent(new Event('click'));
  expect(status.textContent).toBe('コピー中…');
  await vi.advanceTimersByTimeAsync(5000);
  expect(status.textContent).toContain('応答がありません');
  expect(f.body.children[0].children.some((child) => child.textContent === 'ログを表示してコピー')).toBe(true);
  f.cleanup();
});

it('starts copying the complete JSON in the click call stack', async () => {
  const text = JSON.stringify({ version: 3, entries: [{ stage: 'focus', value: '日本語' }] });
  const writeText = vi.fn(() => Promise.resolve());
  const result = copyDiagnosticText(text, { writeText });
  expect(writeText).toHaveBeenCalledExactlyOnceWith(text);
  await result;
});
it('reports denial and missing clipboard as failure', async () => {
  await expect(copyDiagnosticText('{}')).rejects.toThrow();
  await expect(copyDiagnosticText('{}', { writeText: () => Promise.reject(new Error('denied')) })).rejects.toThrow('denied');
});

// Event/DOM adapter only: this does not simulate Safari clipboard permissions,
// touch-generated clicks, focus defaults, or keyboard layout.
class TestElement extends EventTarget {
  style = { cssText: '' };
  textContent = '';
  children: TestElement[] = [];
  removed = false;
  value = '';
  readOnly = false;
  focus = vi.fn();
  select = vi.fn();
  setSelectionRange = vi.fn();
  setAttribute = vi.fn();
  append(...elements: TestElement[]) { this.children.push(...elements); }
  remove() { this.removed = true; }
}
function fixture(search: string, writeText = vi.fn(() => Promise.resolve()), exportJson = () => '{"entries":[]}') {
  const body = new TestElement();
  const createElement = vi.fn(() => new TestElement());
  const execCommand = vi.fn(() => false);
  const cleanup = mountDiagnosticCopyPanel(search, exportJson, { writeText }, { body, createElement, execCommand } as unknown as Document);
  return { body, createElement, cleanup, writeText, execCommand };
}

it('offers the captured full JSON for selection without exporting after focus changes', async () => {
  vi.useFakeTimers();
  const text = JSON.stringify({ entries: ['測定値'.repeat(10000)] });
  const exportJson = vi.fn(() => text);
  const f = fixture('?keyboardDiagnostics=1', vi.fn(() => new Promise<void>(() => {})), exportJson);
  const panel = f.body.children[0];
  panel.children[0].dispatchEvent(new Event('click'));
  await vi.advanceTimersByTimeAsync(5000);
  const fallback = panel.children.find((child) => child.textContent === 'ログを表示してコピー');
  expect(fallback).toBeDefined();
  fallback!.dispatchEvent(new Event('click'));
  const field = panel.children.find((child) => child.readOnly);
  expect(field?.value).toBe(text);
  expect(field?.select).toHaveBeenCalledOnce();
  expect(f.execCommand).toHaveBeenCalledExactlyOnceWith('copy');
  expect(exportJson).toHaveBeenCalledOnce();
  expect(panel.children[1].textContent).toContain('長押し');
  f.execCommand.mockReturnValue(true);
  fallback!.dispatchEvent(new Event('click'));
  expect(panel.children[1].textContent).toBe('診断ログをコピーしました');
  f.cleanup();
});

it('ignores late completion after timeout and clears pending timers on cleanup', async () => {
  vi.useFakeTimers();
  let resolve!: () => void;
  const f = fixture('?keyboardDiagnostics=1', vi.fn(() => new Promise<void>((done) => { resolve = done; })));
  const [button, status] = f.body.children[0].children;
  button.dispatchEvent(new Event('click'));
  await vi.advanceTimersByTimeAsync(5000);
  resolve();
  await Promise.resolve();
  expect(status.textContent).toContain('応答がありません');
  button.dispatchEvent(new Event('click'));
  f.cleanup();
  expect(vi.getTimerCount()).toBe(0);
});
it.each(['', '?keyboardDiagnostics=0', '?keyboardDiagnostics', '?other=1'])('adds no UI or clipboard work for %s', (search) => {
  const f = fixture(search);
  expect(f.createElement).not.toHaveBeenCalled();
  expect(f.writeText).not.toHaveBeenCalled();
  expect(f.body.children).toHaveLength(0);
  f.cleanup();
});
it('copies the existing export on click, announces success, and removes the panel on cleanup', async () => {
  const exportJson = vi.fn(() => '{"version":3,"entries":[{"stage":"focus"}]}');
  const f = fixture('?keyboardDiagnostics=1', vi.fn(() => Promise.resolve()), exportJson);
  const panel = f.body.children[0];
  const [button, status] = panel.children;
  expect(button.textContent).toBe('診断ログをコピー');
  expect(button.style.cssText).toContain('min-height:44px');
  expect(exportJson).not.toHaveBeenCalled();
  const pointer = new Event('pointerdown', { cancelable: true });
  button.dispatchEvent(pointer);
  expect(pointer.defaultPrevented).toBe(true);
  button.dispatchEvent(new Event('click'));
  expect(f.writeText).toHaveBeenCalledExactlyOnceWith(exportJson.mock.results[0].value);
  expect(status.textContent).toBe('コピー中…');
  await Promise.resolve();
  expect(status.textContent).toBe('診断ログをコピーしました');
  f.cleanup();
  expect(panel.removed).toBe(true);
});
it('announces clipboard denial and supports retry', async () => {
  const writeText = vi.fn().mockRejectedValueOnce(new Error('denied')).mockResolvedValue(undefined);
  const f = fixture('?keyboardDiagnostics=1', writeText);
  const [button, status] = f.body.children[0].children;
  button.dispatchEvent(new Event('click'));
  await Promise.resolve();
  await Promise.resolve();
  expect(status.textContent).toContain('コピーに失敗しました');
  button.dispatchEvent(new Event('click'));
  await Promise.resolve();
  expect(status.textContent).toBe('診断ログをコピーしました');
});
it('announces synchronous export errors without copying', () => {
  const f = fixture('?keyboardDiagnostics=1', vi.fn(), () => { throw new Error('export failed'); });
  const [button, status] = f.body.children[0].children;
  button.dispatchEvent(new Event('click'));
  expect(status.textContent).toContain('コピーに失敗しました');
  expect(f.writeText).not.toHaveBeenCalled();
});
