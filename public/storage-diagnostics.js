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
  const operationTypes = new Set(['create', 'update', 'complete', 'uncomplete', 'softDelete', 'restore', 'purge', 'undo', 'redo', 'import']);
  function operationTimestamp(operation) {
    const rawDate = operation.createdAt;
    return typeof rawDate === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(rawDate)
      ? Date.parse(rawDate) : NaN;
  }
  function timeClusters(timestamps) {
    const sorted = timestamps.sort((a, b) => a - b);
    const exact = new Map();
    for (const timestamp of sorted) exact.set(timestamp, (exact.get(timestamp) || 0) + 1);
    let maxOneSecondCount = 0;
    let maxOneSecondStart = null;
    let left = 0;
    for (let right = 0; right < sorted.length; right++) {
      while (sorted[right] - sorted[left] > 1000) left++;
      if (right - left + 1 > maxOneSecondCount) {
        maxOneSecondCount = right - left + 1;
        maxOneSecondStart = sorted[left];
      }
    }
    return {
      maxExactTimestampCount: [...exact.values()].reduce((max, count) => Math.max(max, count), 0),
      maxOneSecondWindowCount: maxOneSecondCount,
      maxOneSecondWindowStart: maxOneSecondStart === null ? null : new Date(maxOneSecondStart).toISOString(),
      topExactTimestampGroups: [...exact.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, 10)
        .map(([timestamp, count]) => ({ at: new Date(timestamp).toISOString(), count })),
    };
  }
  function outboxMetrics(operations) {
    const outboxTypeCounts = {};
    const seenIds = new Set();
    let duplicateOperationIdCount = 0;
    let missingOperationIdCount = 0;
    let invalidOperationDateCount = 0;
    let oldest = null;
    let newest = null;
    const updateTargetTypeCounts = { node: 0, pinnedNote: 0, features: 0, other: 0 };
    const updateNodeCounts = new Map();
    const createNodeIds = new Set();
    const updateTimestamps = [];
    const createTimestamps = [];
    for (const item of operations) {
      const operation = object(item);
      const type = operationTypes.has(operation.type) ? operation.type : 'unknown';
      outboxTypeCounts[type] = (outboxTypeCounts[type] || 0) + 1;
      if (typeof operation.opId !== 'string' || !operation.opId) missingOperationIdCount++;
      else if (seenIds.has(operation.opId)) duplicateOperationIdCount++;
      else seenIds.add(operation.opId);
      if (type === 'update') {
        const target = operation.targetType === undefined || operation.targetType === 'node'
          ? 'node' : Object.prototype.hasOwnProperty.call(updateTargetTypeCounts, operation.targetType) && operation.targetType !== 'other'
            ? operation.targetType : 'other';
        updateTargetTypeCounts[target]++;
        if (target === 'node' && typeof operation.targetNodeId === 'string' && operation.targetNodeId)
          updateNodeCounts.set(operation.targetNodeId, (updateNodeCounts.get(operation.targetNodeId) || 0) + 1);
      }
      if (type === 'create' && (operation.targetType === undefined || operation.targetType === 'node')
        && typeof operation.targetNodeId === 'string' && operation.targetNodeId) createNodeIds.add(operation.targetNodeId);
      // Never output a raw stored string: only a validated, normalized timestamp.
      const timestamp = operationTimestamp(operation);
      if (!Number.isFinite(timestamp)) { invalidOperationDateCount++; continue; }
      if (oldest === null || timestamp < oldest) oldest = timestamp;
      if (newest === null || timestamp > newest) newest = timestamp;
      if (type === 'update') updateTimestamps.push(timestamp);
      if (type === 'create') createTimestamps.push(timestamp);
    }
    return {
      outboxTypeCounts,
      uniqueOperationIdCount: seenIds.size,
      duplicateOperationIdCount,
      missingOperationIdCount,
      oldestOperationAt: oldest === null ? null : new Date(oldest).toISOString(),
      newestOperationAt: newest === null ? null : new Date(newest).toISOString(),
      invalidOperationDateCount,
      updateTargetTypeCounts,
      updateUniqueNodeCount: updateNodeCounts.size,
      updateMaxPerNodeCount: [...updateNodeCounts.values()].reduce((max, count) => Math.max(max, count), 0),
      updateTimeClusters: timeClusters(updateTimestamps),
      createUniqueNodeCount: createNodeIds.size,
      createTimeClusters: timeClusters(createTimestamps),
      sortKeyOnlyOperationCount: 'not-determinable-from-outbox-payload',
    };
  }
  function envelopeMetrics(raw) {
    try {
      const root = object(JSON.parse(raw));
      if (root.version !== 2) return { parse: 'not-v2' };
      const domain = object(root.domain);
      const history = object(root.history);
      const sync = object(root.sync);
      const profile = object(root.profile);
      const entries = [...array(history.past), ...array(history.future)];
      const outbox = array(sync.outbox);
      return {
        parse: 'ok', nodes: Object.keys(domain).length,
        undoCount: array(history.past).length, redoCount: array(history.future).length,
        historyUtf16Bytes: bytes(JSON.stringify(history)),
        averageHistoryEntryUtf16Bytes: entries.length ? Math.round(entries.reduce((sum, entry) => sum + bytes(JSON.stringify(entry)), 0) / entries.length) : 0,
        domainUtf16Bytes: bytes(JSON.stringify(domain)),
        outboxCount: outbox.length,
        outboxUtf16Bytes: bytes(JSON.stringify(outbox)),
        ...outboxMetrics(outbox),
        seenOpIdsCount: array(sync.seenOpIds).length,
        profileUtf16Bytes: bytes(JSON.stringify(profile)),
        pinnedNoteDirty: Boolean(object(profile.pinnedNote).dirtySince),
      };
    } catch { return { parse: 'invalid-json' }; }
  }
  function collect(storage, metadata) {
    const entries = [];
    const scopedOutboxes = new Map();
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
      if (match && entry.parse === 'ok') {
        const root = JSON.parse(value);
        const scope = key.slice(match[0].length);
        const pair = scopedOutboxes.get(scope) || {};
        pair[kind] = new Set(array(object(root.sync).outbox).map((item) => object(item).opId).filter((id) => typeof id === 'string' && id));
        scopedOutboxes.set(scope, pair);
      }
      entries.push(entry);
    }
    entries.sort((a, b) => a.keyName.localeCompare(b.keyName));
    const outboxIdComparison = { comparedScopeCount: 0, commonCount: 0, applicationOnlyCount: 0, journalOnlyCount: 0 };
    for (const pair of scopedOutboxes.values()) {
      if (!pair['v2-committed'] || !pair['v2-journal']) continue;
      outboxIdComparison.comparedScopeCount++;
      for (const id of pair['v2-committed']) {
        if (pair['v2-journal'].has(id)) outboxIdComparison.commonCount++;
        else outboxIdComparison.applicationOnlyCount++;
      }
      for (const id of pair['v2-journal']) if (!pair['v2-committed'].has(id)) outboxIdComparison.journalOnlyCount++;
    }
    return JSON.stringify({
      diagnosticVersion: 2,
      appVersion: metadata.version,
      appCommit: metadata.commit,
      origin: metadata.origin,
      displayMode: metadata.displayMode,
      firebaseReceiptComparison: 'not-performed',
      sizeUnit: 'estimated UTF-16 bytes; not physical disk usage',
      taskMemoTotalUtf16Bytes,
      otherTotalUtf16Bytes,
      allLocalStorageTotalUtf16Bytes: taskMemoTotalUtf16Bytes + otherTotalUtf16Bytes,
      otherKeyCount,
      unknownTaskMemoKeyCount,
      unknownTaskMemoUtf16Bytes,
      outboxIdComparison,
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
