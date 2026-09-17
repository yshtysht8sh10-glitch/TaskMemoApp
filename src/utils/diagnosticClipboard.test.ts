import { expect, it, vi } from 'vitest';
import { copyDiagnosticText, mountDiagnosticCopyPanel } from './diagnosticClipboard';

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
  setAttribute = vi.fn();
  append(...elements: TestElement[]) { this.children.push(...elements); }
  remove() { this.removed = true; }
}
function fixture(search: string, writeText = vi.fn(() => Promise.resolve()), exportJson = () => '{"entries":[]}') {
  const body = new TestElement();
  const createElement = vi.fn(() => new TestElement());
  const cleanup = mountDiagnosticCopyPanel(search, exportJson, { writeText }, { body, createElement } as unknown as Document);
  return { body, createElement, cleanup, writeText };
}
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
