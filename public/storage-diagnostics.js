// Standalone static page: do not import TaskMemo, Firebase, AsyncStorage or service-worker registration.
(function () {
  'use strict';
  const known = new Map([
    ['@taskmemo/nodes/v1', 'legacy-nodes'],
    ['@taskmemo/profile/pinned-note/v1', 'legacy-pinned-note'],
    ['@taskmemo/view/list-display/v1', 'list-display'],
    ['@taskmemo/view/tree-display/v1', 'tree-display'],
    ['@taskmemo/settings/reminders/v1', 'reminders'],
    ['@taskmemo/settings/features/v1', 'features'],
    ['@taskmemo/settings/theme/v1', 'theme'],
    ['@taskmemo/sync-v2/application/v1', 'foundation-committed'],
    ['@taskmemo/sync-v2/application-journal/v1', 'foundation-journal'],
    ['@taskmemo/sync-outbox/v1', 'foundation-outbox'],
  ]);
  const scoped = [
    ['@taskmemo/sync-v2/taskmemo-application/v2/', 'v2-committed'],
    ['@taskmemo/sync-v2/taskmemo-application-journal/v2/', 'v2-journal'],
  ];
  const bytes = (value) => value.length * 2; // UTF-16 estimate, not physical browser allocation.
  const object = (value) => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const array = (value) => Array.isArray(value) ? value : [];
  function envelopeMetrics(raw) {
    try {
      const root = object(JSON.parse(raw));
      if (root.version !== 2) return { parse: 'not-v2' };
      const domain = object(root.domain);
      const history = object(root.history);
      const sync = object(root.sync);
      const profile = object(root.profile);
      const entries = [...array(history.past), ...array(history.future)];
      return {
        parse: 'ok', nodes: Object.keys(domain).length,
        undoCount: array(history.past).length, redoCount: array(history.future).length,
        historyUtf16Bytes: bytes(JSON.stringify(history)),
        averageHistoryEntryUtf16Bytes: entries.length ? Math.round(entries.reduce((sum, entry) => sum + bytes(JSON.stringify(entry)), 0) / entries.length) : 0,
        domainUtf16Bytes: bytes(JSON.stringify(domain)),
        outboxCount: array(sync.outbox).length,
        outboxUtf16Bytes: bytes(JSON.stringify(array(sync.outbox))),
        seenOpIdsCount: array(sync.seenOpIds).length,
        profileUtf16Bytes: bytes(JSON.stringify(profile)),
        pinnedNoteDirty: Boolean(object(profile.pinnedNote).dirtySince),
      };
    } catch { return { parse: 'invalid-json' }; }
  }
  function collect(storage, metadata) {
    const entries = [];
    let taskMemoTotalUtf16Bytes = 0;
    let otherTotalUtf16Bytes = 0;
    let otherKeyCount = 0;
    let unknownTaskMemoKeyCount = 0;
    let unknownTaskMemoUtf16Bytes = 0;
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key === null) continue;
      const value = storage.getItem(key);
      if (value === null) continue;
      const size = bytes(key) + bytes(value);
      if (!key.startsWith('@taskmemo/')) {
        otherKeyCount++;
        otherTotalUtf16Bytes += size;
        continue;
      }
      taskMemoTotalUtf16Bytes += size;
      const match = scoped.find(([prefix]) => key.startsWith(prefix));
      const kind = known.get(key) || (match && match[1]);
      if (!kind) {
        unknownTaskMemoKeyCount++;
        unknownTaskMemoUtf16Bytes += size;
        continue;
      }
      const entry = {
        keyName: match ? match[0] + '<account-scope-redacted>' : key,
        keyUtf16Bytes: bytes(key), valueUtf16Bytes: bytes(value), totalUtf16Bytes: size,
      };
      if (match) Object.assign(entry, envelopeMetrics(value));
      entries.push(entry);
    }
    entries.sort((a, b) => a.keyName.localeCompare(b.keyName));
    return JSON.stringify({
      diagnosticVersion: 1,
      appVersion: metadata.version,
      appCommit: metadata.commit,
      origin: metadata.origin,
      displayMode: metadata.displayMode,
      sizeUnit: 'estimated UTF-16 bytes; not physical disk usage',
      taskMemoTotalUtf16Bytes,
      otherTotalUtf16Bytes,
      allLocalStorageTotalUtf16Bytes: taskMemoTotalUtf16Bytes + otherTotalUtf16Bytes,
      otherKeyCount,
      unknownTaskMemoKeyCount,
      unknownTaskMemoUtf16Bytes,
      entries,
    }, null, 2);
  }
  const result = document.getElementById('result');
  const status = document.getElementById('status');
  document.getElementById('measure').addEventListener('click', function () {
    try {
      const metadata = {
        version: document.querySelector('meta[name="taskmemo-version"]').content,
        commit: document.querySelector('meta[name="taskmemo-commit"]').content,
        origin: location.origin,
        displayMode: navigator.standalone === true || (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ? 'standalone' : 'browser-or-unknown',
      };
      result.value = collect(window.localStorage, metadata);
      status.textContent = metadata.displayMode === 'standalone'
        ? '読み取り完了。結果を確認してからコピーしてください。'
        : '読み取り完了。ただしSafari側の保存領域かもしれません。問題のPWA内で開いたか確認してください。';
    } catch {
      result.value = '';
      status.textContent = '診断に失敗しました。保存領域は変更していません。';
    }
  });
  document.getElementById('copy').addEventListener('click', function () {
    if (!result.value) { status.textContent = '先に診断を実行してください。'; return; }
    if (!navigator.clipboard || !navigator.clipboard.writeText) {
      result.focus(); result.select();
      status.textContent = '結果を選択しました。コピー操作を行ってください。';
      return;
    }
    // Call directly within the user gesture for iPhone Safari.
    navigator.clipboard.writeText(result.value).then(
      () => { status.textContent = '診断結果をコピーしました。'; },
      () => { result.focus(); result.select(); status.textContent = 'コピーできませんでした。選択した結果を手動でコピーしてください。'; },
    );
  });
}());
