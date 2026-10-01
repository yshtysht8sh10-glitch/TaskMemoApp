// Standalone one-time recovery. No Firebase import, network request, or legacy write.
(function () {
  'use strict';
  const status = document.getElementById('status');
  const button = document.getElementById('apply');
  const input = document.getElementById('plan');
  let prepared = null;
  const digest = async raw => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw))),
    byte => byte.toString(16).padStart(2, '0')).join('');
  function getKeys(scope) {
    const encoded = encodeURIComponent(scope);
    return { committed: `@taskmemo/sync-v2/taskmemo-application/v2/${encoded}`,
      journal: `@taskmemo/sync-v2/taskmemo-application-journal/v2/${encoded}` };
  }
  async function openExisting() {
    if (typeof indexedDB.databases !== 'function' || !(await indexedDB.databases()).some(db => db.name === 'taskmemo-v2-local-application'))
      throw new Error('既存IndexedDBを確認できません。何も変更していません。');
    const request = indexedDB.open('taskmemo-v2-local-application');
    request.onupgradeneeded = () => request.transaction.abort();
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('IndexedDBを開けません。'));
    });
  }
  function getScope(db, scope) {
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('scopes', 'readonly');
      const request = transaction.objectStore('scopes').get(scope);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      transaction.onabort = () => reject(transaction.error);
    });
  }
  async function verify(plan, db) {
    if (plan.format !== 'taskmemo-cloud-recovery-plan-v1' || !plan.scope?.startsWith('taskmemoapp-eabc3/') ||
        !Number.isSafeInteger(plan.nodeCount) || plan.nodeCount <= 0 ||
        plan.expected?.journal !== null || plan.expected?.legacyJournal !== null)
      throw new Error('復旧計画の形式または対象が違います。');
    const keys = getKeys(plan.scope);
    const legacy = localStorage.getItem(keys.committed);
    const legacyJournal = localStorage.getItem(keys.journal);
    const stored = await getScope(db, plan.scope);
    if (!legacy || legacyJournal !== null || !stored || stored.journal !== null ||
        stored.legacyFingerprint !== plan.expected.legacyFingerprint ||
        await digest(legacy) !== plan.expected.legacyCommittedSha256 ||
        await digest(stored.committed) !== plan.expected.committedSha256 ||
        await digest(JSON.stringify([legacy, legacyJournal])) !== plan.newLegacyFingerprint)
      throw new Error('保存状態が計画作成時から変化しました。復旧を停止しました。');
    const recovered = JSON.parse(plan.recoveredCommitted);
    if (recovered.version !== 2 || Object.keys(recovered.domain ?? {}).length !== plan.nodeCount ||
        recovered.sync?.outbox?.length !== 0 || recovered.deviceId !== JSON.parse(stored.committed).deviceId)
      throw new Error('復旧データの形式が不正です。');
    return stored;
  }
  document.getElementById('inspect').addEventListener('click', async () => {
    button.disabled = true; prepared = null;
    let db;
    try {
      const file = input.files?.[0];
      if (!file) throw new Error('復旧計画JSONを選択してください。');
      const plan = JSON.parse(await file.text());
      db = await openExisting();
      const stored = await verify(plan, db);
      prepared = plan;
      button.disabled = false;
      const legacyCount = Object.keys(JSON.parse(localStorage.getItem(getKeys(plan.scope).committed)).domain).length;
      const currentCount = Object.keys(JSON.parse(stored.committed).domain).length;
      status.textContent = `確認成功。Local Legacy: ${legacyCount}件 / Local Current: ${currentCount}件 / Cloud復旧計画: ${plan.nodeCount}件。\n旧IndexedDB原本を保持して復旧できます。復旧前バックアップが保存済みであることを確認してください。`;
    } catch (error) { status.textContent = error.message || String(error); }
    finally { db?.close(); }
  });
  button.addEventListener('click', async () => {
    button.disabled = true;
    let db;
    try {
      if (!prepared) throw new Error('先に保存状態を確認してください。');
      db = await openExisting();
      const old = await verify(prepared, db);
      await new Promise((resolve, reject) => {
        const transaction = db.transaction('scopes', 'readwrite');
        const store = transaction.objectStore('scopes');
        const request = store.get(prepared.scope);
        request.onsuccess = () => {
          const current = request.result;
          if (!current || current.committed !== old.committed || current.journal !== old.journal ||
              current.legacyFingerprint !== old.legacyFingerprint) { transaction.abort(); return; }
          store.put({ ...current, committed: prepared.recoveredCommitted,
            legacyFingerprint: prepared.newLegacyFingerprint,
            preservedCloudRecoveryCommitted: current.committed,
            preservedCloudRecoveryFingerprint: current.legacyFingerprint,
            cloudRecoveryAt: new Date().toISOString(), cloudRecoveryNodeCount: prepared.nodeCount });
        };
        request.onerror = () => reject(request.error);
        transaction.oncomplete = resolve;
        transaction.onabort = () => reject(transaction.error || new Error('保存状態が変化したため中止しました。'));
      });
      const after = await getScope(db, prepared.scope);
      if (after.committed !== prepared.recoveredCommitted || after.legacyFingerprint !== prepared.newLegacyFingerprint ||
          after.preservedCloudRecoveryCommitted !== old.committed)
        throw new Error('復旧後の再読み取り検証に失敗しました。バックアップを保持してください。');
      status.textContent = `Webローカルを${prepared.nodeCount}件で復旧し、旧IndexedDB原本を保持しました。TaskMemo本体のタブを再読み込みして確認してください。`;
    } catch (error) { status.textContent = error.message || String(error); }
    finally { db?.close(); }
  });
}());
