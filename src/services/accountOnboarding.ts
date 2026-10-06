/** SDK-independent contract/fence validation. Never writes local or Cloud data. */
export async function ensureOnboarding(call: (value: { schemaVersion: 1; protocol: 2 }) => Promise<unknown>, current: () => boolean,
  wait: (ms: number) => Promise<void> = ms => new Promise(resolve => setTimeout(resolve, ms))) {
  if (!current()) throw new Error('アカウントが切り替わりました。');
  let response: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (!current()) throw new Error('アカウントが切り替わりました。');
    try { response = await call({ schemaVersion: 1, protocol: 2 }); break; }
    catch (error) {
      const code = (error as { code?: string })?.code;
      if (attempt === 2 || !['functions/unavailable', 'functions/deadline-exceeded'].includes(code ?? '')) throw error;
      await wait(250 * (attempt + 1));
    }
  }
  const value = response as Record<string, unknown> | null;
  if (!current()) throw new Error('アカウントが切り替わりました。');
  if (!value || value.schemaVersion !== 1 || value.state !== 'ready' || value.protocol !== 2 || !['created', 'existing'].includes(String(value.result)))
    throw new Error('クラウド利用の準備結果を確認できません。');
}
