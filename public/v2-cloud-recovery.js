// Standalone one-time recovery. No Firebase import, network request, or legacy write.
(function () {
  'use strict';
  const status = document.getElementById('status');
  const button = document.getElementById('apply');
  const input = document.getElementById('plan');
  let prepared = null;
  const digest = async raw => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw))),
    byte => byte.toString(16).padStart(2, '0')).join('');
  const canonical = value => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
  const expectedCloudHash = 'aa7fc236950c77b160ff893599761a4bf7e7a25fd3f6d729851c29c6cf46e69c';
  function decode(value) {
    if ('nullValue' in value) return null;
    if ('booleanValue' in value) return value.booleanValue;
    if ('integerValue' in value) return Number(value.integerValue);
    if ('doubleValue' in value) return Number(value.doubleValue);
    if ('timestampValue' in value) return value.timestampValue;
    if ('stringValue' in value) return value.stringValue;
    if ('arrayValue' in value) return (value.arrayValue.values ?? []).map(decode);
    if ('mapValue' in value) return Object.fromEntries(Object.entries(value.mapValue.fields ?? {}).map(([key, entry]) => [key, decode(entry)]));
    throw new Error('Cloudに未対応の値形式があります。');
  }
  const fields = document => Object.fromEntries(Object.entries(document.fields ?? {}).map(([key, value]) => [key, decode(value)]));
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
  async function authSession(scope) {
    if (!(await indexedDB.databases()).some(db => db.name === 'firebaseLocalStorageDb'))
      throw new Error('Firebaseログイン情報を確認できません。JSON計画を選択してください。');
    const request = indexedDB.open('firebaseLocalStorageDb');
    request.onupgradeneeded = () => request.transaction.abort();
    const db = await new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    try {
      if (!db.objectStoreNames.contains('firebaseLocalStorage')) throw new Error('Firebaseログイン情報の形式が違います。');
      const entries = await new Promise((resolve, reject) => {
        const tx = db.transaction('firebaseLocalStorage', 'readonly');
        const read = tx.objectStore('firebaseLocalStorage').getAll();
        read.onsuccess = () => resolve(read.result);
        read.onerror = () => reject(read.error);
      });
      const uid = scope.slice('taskmemoapp-eabc3/'.length);
      const user = entries.map(item => item.value ?? item).find(item => item.uid === uid);
      if (!user?.stsTokenManager?.accessToken) throw new Error('同じアカウントの有効なログイン情報がありません。JSON計画を選択してください。');
      return { uid, token: user.stsTokenManager.accessToken };
    } finally { db.close(); }
  }
  async function cloudCollection(uid, token, name) {
    const documents = [];
    let pageToken;
    do {
      const url = new URL(`https://firestore.googleapis.com/v1/projects/taskmemoapp-eabc3/databases/(default)/documents/users/${encodeURIComponent(uid)}/${name}`);
      url.searchParams.set('pageSize', '300');
      if (pageToken) url.searchParams.set('pageToken', pageToken);
      const response = await fetch(url, { method: 'GET', headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) throw new Error(`Cloud読み取りに失敗しました（HTTP ${response.status}）。保存データは変更していません。`);
      const page = await response.json();
      documents.push(...(page.documents ?? []));
      pageToken = page.nextPageToken;
    } while (pageToken);
    return documents;
  }
  document.getElementById('cloud').addEventListener('click', async () => {
    button.disabled = true; prepared = null;
    let db;
    try {
      db = await openExisting();
      const scopes = await new Promise((resolve, reject) => {
        const tx = db.transaction('scopes', 'readonly');
        const read = tx.objectStore('scopes').getAll();
        read.onsuccess = () => resolve(read.result);
        read.onerror = () => reject(read.error);
      });
      if (scopes.length !== 1 || !scopes[0].scope.startsWith('taskmemoapp-eabc3/')) throw new Error('復旧対象のアカウントを一意に確認できません。');
      const stored = scopes[0];
      const { uid, token } = await authSession(stored.scope);
      const [nodes, profile] = await Promise.all([cloudCollection(uid, token, 'nodesV2'), cloudCollection(uid, token, 'profileV2')]);
      const domain = Object.fromEntries(nodes.map(document => {
        const data = fields(document);
        if (data.schemaVersion !== 2 || !data.record?.value?.id) throw new Error('Cloud schemaが不正です。');
        return [data.record.value.id, data.record];
      }));
      const observedHash = await digest(canonical(domain));
      if (Object.keys(domain).length !== 175 || observedHash !== expectedCloudHash)
        throw new Error(`Cloudが保存済みバックアップから変化しました。新しい比較が必要です。件数: ${Object.keys(domain).length} / SHA-256: ${observedHash}`);
      const legacy = localStorage.getItem(getKeys(stored.scope).committed);
      const legacyJournal = localStorage.getItem(getKeys(stored.scope).journal);
      if (!legacy || legacyJournal !== null || stored.journal !== null) throw new Error('ローカル保存状態が想定と違います。');
      const current = JSON.parse(stored.committed), old = JSON.parse(legacy);
      if (current.sync?.outbox?.length || old.sync?.outbox?.length) throw new Error('送信待ちの変更があるため停止しました。');
      for (const source of [current.domain, old.domain]) for (const [id, local] of Object.entries(source)) {
        const remote = domain[id];
        if (!remote || remote.revision < local.revision ||
            (remote.revision === local.revision && canonical(remote.value) !== canonical(local.value)))
          throw new Error('Cloudにない、またはCloudより新しいローカルNodeがあります。');
      }
      const cloudProfile = Object.fromEntries(profile.map(document => [document.name.split('/').at(-1), fields(document).record]));
      if (current.profile.pinnedNote.dirtySince || current.profile.pinnedNote.migrationPending || current.profile.features.migrationPending ||
          current.profile.pinnedNote.synced?.revision !== cloudProfile.pinnedNote?.revision ||
          current.profile.features.synced?.revision !== cloudProfile.features?.revision)
        throw new Error('プロフィールに未解決差分があります。');
      const recovered = { ...current, domain, history: { past: [], future: [] }, sync: { ...current.sync, outbox: [] } };
      const plan = { format: 'taskmemo-cloud-recovery-plan-v1', scope: stored.scope, nodeCount: nodes.length,
        expected: { committedSha256: await digest(stored.committed), journal: null,
          legacyCommittedSha256: await digest(legacy), legacyJournal: null, legacyFingerprint: stored.legacyFingerprint },
        newLegacyFingerprint: await digest(JSON.stringify([legacy, null])), recoveredCommitted: JSON.stringify(recovered) };
      await verify(plan, db);
      prepared = plan; button.disabled = false;
      status.textContent = `Cloudを読み取り専用で照合しました。Local Legacy: ${Object.keys(old.domain).length}件 / Local Current: ${Object.keys(current.domain).length}件 / Cloud: ${nodes.length}件。復旧を実行できます。`;
    } catch (error) { status.textContent = error.message || String(error); }
    finally { db?.close(); }
  });
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
