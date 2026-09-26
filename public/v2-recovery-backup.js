// Standalone source snapshot: do not initialize TaskMemo, Firebase, sync, or storage migrations.
(function () {
  'use strict';
  const committedPrefix = '@taskmemo/sync-v2/taskmemo-application/v2/';
  const journalPrefix = '@taskmemo/sync-v2/taskmemo-application-journal/v2/';
  const status = document.getElementById('status');
  const shareButton = document.getElementById('share');
  const downloadButton = document.getElementById('download');
  let prepared = null;

  function readSnapshot(storage) {
    const entries = [];
    for (let index = 0; index < storage.length; index++) {
      const key = storage.key(index);
      if (key && key.startsWith('@taskmemo/')) {
        const value = storage.getItem(key);
        if (value === null) throw new Error('読み取り中にキーが消えました。再度準備してください。');
        entries.push({ key, value });
      }
    }
    entries.sort((a, b) => a.key.localeCompare(b.key));
    if (!entries.length) throw new Error('TaskMemoのlocalStorageキーが見つかりません。PWA内で開いたか確認してください。');
    for (const entry of entries)
      if (storage.getItem(entry.key) !== entry.value) throw new Error('読み取り中に保存内容が変わりました。再度準備してください。');
    return entries;
  }

  function summary(entries) {
    const committed = new Map();
    const journals = new Map();
    for (const entry of entries) {
      const kind = entry.key.startsWith(committedPrefix) ? 'committed' : entry.key.startsWith(journalPrefix) ? 'journal' : null;
      if (!kind) continue;
      const scope = entry.key.slice((kind === 'committed' ? committedPrefix : journalPrefix).length);
      const root = JSON.parse(entry.value);
      if (!root || root.version !== 2 || !root.domain || !root.sync || !Array.isArray(root.sync.outbox))
        throw new Error('V2データを検証できません。元データは変更していません。');
      (kind === 'committed' ? committed : journals).set(scope, {
        nodes: Object.keys(root.domain).length, outbox: root.sync.outbox.length,
      });
    }
    const pairs = [];
    for (const [scope, application] of committed)
      if (journals.has(scope)) pairs.push({ application, journal: journals.get(scope) });
    if (!pairs.length) throw new Error('同じアカウントのV2 applicationとjournalの両方を確認できません。元データは変更していません。');
    return pairs;
  }

  async function digest(value) {
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
    return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('');
  }

  async function readIndexedDbSnapshot() {
    const factory = window.indexedDB;
    if (!factory) return { available: false, records: [] };
    if (typeof factory.databases !== 'function')
      throw new Error('IndexedDBの存在確認に対応していないため、完全バックアップを保証できません。元データは変更していません。');
    const known = await factory.databases();
    if (!known.some((database) => database.name === 'taskmemo-v2-local-application'))
      return { available: true, records: [] };
    const database = await new Promise((resolve, reject) => {
      const request = factory.open('taskmemo-v2-local-application');
      request.onupgradeneeded = () => {
        request.transaction.abort();
        reject(new Error('IndexedDBが変化しました。バックアップを中止しました。'));
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('IndexedDBを開けません。'));
    });
    try {
      if (!database.objectStoreNames.contains('scopes')) throw new Error('IndexedDBのV2保存領域が見つかりません。');
      const transaction = database.transaction('scopes', 'readonly');
      const done = new Promise((resolve, reject) => {
        transaction.oncomplete = resolve;
        transaction.onabort = () => reject(transaction.error || new Error('IndexedDBの読み取りが中断されました。'));
        transaction.onerror = () => reject(transaction.error || new Error('IndexedDBの読み取りに失敗しました。'));
      });
      const records = await new Promise((resolve, reject) => {
        const request = transaction.objectStore('scopes').getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error('IndexedDBを読み取れません。'));
      });
      await done;
      for (const record of records) {
        if (typeof record.scope !== 'string' || typeof record.legacyFingerprint !== 'string')
          throw new Error('IndexedDBのV2データを検証できません。');
        for (const raw of [record.committed, record.journal]) {
          if (raw !== null && raw !== undefined) {
            const root = JSON.parse(raw);
            if (root.version !== 2 || !root.domain || !Array.isArray(root.sync?.outbox))
              throw new Error('IndexedDBのV2データを検証できません。');
          }
        }
      }
      return { available: true, records };
    } finally { database.close(); }
  }

  document.getElementById('prepare').addEventListener('click', async function () {
    prepared = null;
    shareButton.disabled = true;
    downloadButton.disabled = true;
    status.textContent = '読み取り中…';
    try {
      const entries = readSnapshot(window.localStorage);
      const pairs = summary(entries);
      const indexedDb = await readIndexedDbSnapshot();
      const archive = JSON.stringify({
        format: 'taskmemo-v2-recovery-v2',
        capturedAt: new Date().toISOString(),
        origin: location.origin,
        appCommit: document.querySelector('meta[name="taskmemo-commit"]').content,
        entries,
        indexedDb,
      });
      const sha256 = await digest(archive);
      if (JSON.stringify(readSnapshot(window.localStorage)) !== JSON.stringify(entries))
        throw new Error('バックアップ準備中に保存内容が変わりました。再度準備してください。');
      if (JSON.stringify(await readIndexedDbSnapshot()) !== JSON.stringify(indexedDb))
        throw new Error('バックアップ準備中にIndexedDBが変わりました。再度準備してください。');
      const file = new File([archive], `taskmemo-v2-recovery-${new Date().toISOString().replace(/[:.]/g, '-')}.json`, { type: 'application/json' });
      prepared = { file, sha256 };
      shareButton.disabled = false;
      downloadButton.disabled = false;
      const pairSummary = pairs.map((pair, index) => `組${index + 1}: application ${pair.application.nodes} Node / ${pair.application.outbox} outbox、journal ${pair.journal.nodes} Node / ${pair.journal.outbox} outbox`).join('\n');
      const idbSummary = indexedDb.records.map((record, index) => {
        const committed = record.committed ? JSON.parse(record.committed) : null;
        const journal = record.journal ? JSON.parse(record.journal) : null;
        return `IndexedDB組${index + 1}: application ${committed ? Object.keys(committed.domain).length : 0} Node / ${committed ? committed.sync.outbox.length : 0} outbox、journal ${journal ? Object.keys(journal.domain).length : 0} Node / ${journal ? journal.sync.outbox.length : 0} outbox`;
      }).join('\n');
      status.textContent = `準備完了（まだファイルへ保存していません）。\nキー: ${entries.length}、同一アカウントの組: ${pairs.length}\n${pairSummary}\nIndexedDB: ${indexedDb.available ? indexedDb.records.length + '組' : '未対応'}${idbSummary ? '\n' + idbSummary : ''}\nファイル: ${file.name}\nサイズ: ${file.size} bytes\nSHA-256: ${sha256}\n保存後、ファイルの存在とサイズを確認してください。`;
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : 'バックアップの準備に失敗しました。';
    }
  });

  shareButton.addEventListener('click', function () {
    if (!prepared) return;
    if (!navigator.share || (navigator.canShare && !navigator.canShare({ files: [prepared.file] }))) {
      status.textContent = 'ファイル共有が利用できません。「ブラウザでダウンロード」を試してください。';
      return;
    }
    navigator.share({ files: [prepared.file] }).then(
      () => { status.textContent = `共有操作が終了しました。保存先のファイルを確認してください。SHA-256: ${prepared.sha256}`; },
      () => { status.textContent = '共有は完了していません。バックアップは保存済みと見なしません。'; },
    );
  });

  downloadButton.addEventListener('click', function () {
    if (!prepared) return;
    const url = URL.createObjectURL(prepared.file);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = prepared.file.name;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    status.textContent = `ダウンロードを要求しました。保存先のファイルを確認してください。SHA-256: ${prepared.sha256}`;
  });
}());
