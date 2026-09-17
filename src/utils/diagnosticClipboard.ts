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
  const fallback = doc.createElement('button');
  fallback.type = 'button';
  fallback.textContent = 'ログを表示してコピー';
  fallback.style.cssText = button.style.cssText;
  let snapshot: string | undefined;
  let field: HTMLTextAreaElement | undefined;
  let attempt = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const invalidate = () => {
    attempt++;
    clearTimeout(timer);
    timer = undefined;
  };
  fallback.addEventListener('click', () => {
    invalidate();
    try {
      // Freeze evidence before moving focus. Reuse the unsuccessful copy's JSON.
      snapshot ??= exportJson();
      if (!field) {
        field = doc.createElement('textarea');
        field.readOnly = true;
        field.setAttribute('aria-label', '診断JSON全文');
        field.style.cssText = 'display:block;width:100%;height:120px;font-size:16px;box-sizing:border-box;user-select:text;-webkit-user-select:text';
        panel.append(field);
      }
      field.value = snapshot;
      // Explicit fallback only: this may close the Memo keyboard / move focus.
      field.focus({ preventScroll: true });
      field.select();
      field.setSelectionRange(0, snapshot.length);
      let copied = false;
      try { copied = doc.execCommand('copy'); } catch { /* Keep selectable JSON. */ }
      status.textContent = copied ? '診断ログをコピーしました'
        : '下のJSONを長押し→すべて選択→コピーしてください';
    } catch {
      status.textContent = 'ログを表示できませんでした。もう一度タップしてください';
    }
  });
  // Avoid blurring/committing the title just to collect evidence.
  button.addEventListener('pointerdown', (event) => event.preventDefault());
  button.addEventListener('click', () => {
    invalidate();
    const currentAttempt = attempt;
    const finish = (message: string) => {
      if (currentAttempt !== attempt) return;
      invalidate();
      status.textContent = message;
    };
    const fail = () => finish('コピーに失敗しました。再試行するか「ログを表示してコピー」をタップしてください');
    try {
      // No await or timer before writeText: Safari requires user activation.
      snapshot = exportJson();
      const pending = copyDiagnosticText(snapshot, clipboard);
      status.textContent = 'コピー中…';
      timer = setTimeout(() => finish('コピーの応答がありません。「ログを表示してコピー」をタップしてください'), 5000);
      pending.then(() => finish('診断ログをコピーしました')).catch(fail);
    } catch {
      fail();
    }
  });
  panel.append(button, status, fallback);
  doc.body.append(panel);
  return () => { invalidate(); panel.remove(); };
}
