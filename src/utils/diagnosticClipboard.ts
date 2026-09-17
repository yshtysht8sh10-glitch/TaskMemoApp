/** Called synchronously by a user click; do not await before writeText. */
export function copyDiagnosticText(text: string, clipboard?: Pick<Clipboard, 'writeText'>): Promise<void> {
  if (!clipboard) return Promise.reject(new Error('Clipboard unavailable'));
  try { return clipboard.writeText(text); }
  catch (error) { return Promise.reject(error); }
}

export function keyboardDiagnosticsEnabled(search: string) {
  return new URLSearchParams(search).get('keyboardDiagnostics') === '1';
}

export function mountDiagnosticCopyPanel(
  search: string,
  exportJson: () => string,
  clipboard: Pick<Clipboard, 'writeText'> | undefined,
  doc: Document,
) {
  if (!keyboardDiagnosticsEnabled(search)) return () => {};
  const panel = doc.createElement('div');
  panel.style.cssText = 'position:fixed;top:env(safe-area-inset-top,0px);right:8px;z-index:2147483647;background:white;color:black;padding:6px;border:1px solid #777;border-radius:8px;max-width:260px;font:14px sans-serif';
  const button = doc.createElement('button');
  button.type = 'button';
  button.textContent = '診断ログをコピー';
  button.style.cssText = 'min-height:44px;padding:8px 14px;font-size:16px;touch-action:manipulation';
  const status = doc.createElement('div');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  // Avoid blurring/committing the title just to collect evidence.
  button.addEventListener('pointerdown', (event) => event.preventDefault());
  button.addEventListener('click', () => {
    const fail = () => { status.textContent = 'コピーに失敗しました。もう一度タップしてください'; };
    try {
      // No await or timer before writeText: Safari requires user activation.
      const pending = copyDiagnosticText(exportJson(), clipboard);
      status.textContent = 'コピー中…';
      pending.then(() => { status.textContent = '診断ログをコピーしました'; }).catch(fail);
    } catch {
      fail();
    }
  });
  panel.append(button, status);
  doc.body.append(panel);
  return () => panel.remove();
}
