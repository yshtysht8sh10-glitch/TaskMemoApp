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

  document.getElementById('prepare').addEventListener('click', async function () {
    prepared = null;
    shareButton.disabled = true;
    downloadButton.disabled = true;
    status.textContent = '読み取り中…';
    try {
      const entries = readSnapshot(window.localStorage);
      const pairs = summary(entries);
      const archive = JSON.stringify({
        format: 'taskmemo-raw-localstorage-recovery-v1',
        capturedAt: new Date().toISOString(),
        origin: location.origin,
        appCommit: document.querySelector('meta[name="taskmemo-commit"]').content,
        entries,
      });
      const sha256 = await digest(archive);
      if (JSON.stringify(readSnapshot(window.localStorage)) !== JSON.stringify(entries))
        throw new Error('バックアップ準備中に保存内容が変わりました。再度準備してください。');
      const file = new File([archive], `taskmemo-v2-recovery-${new Date().toISOString().replace(/[:.]/g, '-')}.json`, { type: 'application/json' });
      prepared = { file, sha256 };
      shareButton.disabled = false;
      downloadButton.disabled = false;
      const pairSummary = pairs.map((pair, index) => `組${index + 1}: application ${pair.application.nodes} Node / ${pair.application.outbox} outbox、journal ${pair.journal.nodes} Node / ${pair.journal.outbox} outbox`).join('\n');
      status.textContent = `準備完了（まだファイルへ保存していません）。\nキー: ${entries.length}、同一アカウントの組: ${pairs.length}\n${pairSummary}\nファイル: ${file.name}\nサイズ: ${file.size} bytes\nSHA-256: ${sha256}\n保存後、ファイルの存在とサイズを確認してください。`;
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
