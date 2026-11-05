# 起動性能改善 — DEV実装・検証（2026-11-04）

比較元: `c4bfaba673cbc0abde900022f1ff1eca126f2108`。変更はローカル作業ツリー内。Production配信・本番データ変更・live DEVのアカウント操作は行っていない。保存形式、sync protocol、履歴の保存先は変更していない。

## 実装

### 1. 復元済みローカル一覧を先に閲覧表示

`startupPresentation`は設定・認証・active account Storeの復元が完了したら、Cloud初回snapshotを待たず`showData=true`とする。表示は「最新状態は未確認・閲覧のみ」。編集解禁は従来どおりserver確認、または既存の遅延/通信失敗と明示的なキャッシュ編集選択による。

`applicationState=ready`に到達するまでの経路は変更していない。#116のJournal検証・二重server snapshot照合・CAS、旧保存領域の照合、local recoveryの証拠確認を迂回しない。Journal不一致は`error`のまま原本保持・表示停止する。認証未確定、設定読込中、account切替中も一覧を隠す。

旧テストの「readyでもCloud待ちの間は一覧を隠す」は今回明示的に変更された仕様なので期待値を更新した。pre-auth/pre-load/errorの非表示、匿名/account隔離、編集禁止、3秒後のキャッシュ編集選択の検証は維持した。

### 2. snapshot単位のserialized受信・atomic保存

`SyncAdapter.subscribe`にoptionalな第4引数`onRecords`を追加。Firebase adapterはsnapshotの`docChanges()`を順序どおりまとめ、durable batch受信の完了をawaitしてから`onSnapshotApplied(cache/server)`を通知する。旧adapterやテスト用adapterの1件ずつの受信も互換維持する。空のmetadata snapshotでもsource確認は可能で、失敗後やunsubscribe後は確認済みとしない。

Storeの`receiveBatch`は既存serialized mutation内で次を行う。

1. 各recordへ既存のself-echo、revision、tombstone、Routine outcomes/lifecycle、queueの競合規則を適用する。
2. 必要なdomain変更、sequence更新、Outboxのself-echo除去、bounded seenOpIds更新をメモリ上の候補へ順次反映する。
3. snapshotにつき一度だけsortKey受動診断を行い、既存`commit` → `writeAtomic(expectedCommittedRaw, envelope)`で全体を保存する。
4. transaction成功後だけメモリ上のenvelope/Committed raw基準が進む。History/profile/未知fieldは同じenvelopeに保持する。

Batch失敗時は全件が未適用で、既存の保護停止へ入る。raw CAS、Journal-nullの保存条件、writer制約は変更しない。Controllerは受信後・flush後にgenerationを再確認し、退役scopeからのUI通知を止める。

Controllerのreceipt audit → listener/upload開始の順序と、upload/receipt/ackの処理は維持した。scopeが一致しないデータをまとめたり、未確定Journalをbatchへ混ぜたりしない。

### 3. 同一データと不要な通知の抑制

競合mergeを計算した後、winnerが全field同一、sequence更新不要、該当Outboxなし、かつincoming全field同一または既知opIdの場合のみno-opとする。revision/opIdだけで受信を捨てない。同一opId・同一revisionでもRoutine結果に差があればmergeする。matching Outboxがある場合は同一データでもack除去を保存する。

Outbox本体は配列のまま保持する。存在確認にSetを使うが、無関係な重複Outboxを黙ってdeduplicateしない。重複は従来のreceipt auditで拒否する。追加レビューでこの回帰を検出し、失敗テストを確認して修正した。

同一batchと同一snapshot sourceの重複通知は抑制する。変更があるsnapshotは1件ごとの通知ではなく、batch受信とsource確認の境界で通知する。status/error/pending件数の変化は通知する。

### 4. 診断fingerprintの再利用

Storeがimmutable domainの参照単位で`diagnosticSnapshot`を返す。startup診断はその参照が変わったときだけ全件のsort/canonical/hashを再計算する。sourceやpending/History等の診断evidence自体は引き続き記録する。同じdomainでCloud状態が変わるだけなら全件hashを再計算しない。

診断snapshot/fingerprintはCAS基準、Cloudの同一性判定、復旧可否の根拠に使わない。診断キャッシュは永続化しない。UI用のNodeやHistoryの保存構造は変更していない。

### 5. Routine投影の不要なコピーを削減

`deadlineGroups`の関数内で新規作成する`ties`と`grouped`の配列追記をspreadコピーからpushへ変更した。入力Node・Store・履歴を直接変更する処理ではない。group順・Memo順・dueAt・deadlineSortKeyは修正前後で一致した。

## 計測方法

Windows / Intel Core i7-14700F / Chromium 156.0.8078.4、CPU制限なし。100・500・1,000件、それぞれ同一Cloud値/全件更新値の2条件を3回測り、中央値を比較した。全件active Task、本文約150文字、History/Outbox/Journalは空。実データ・認証情報は使用していない。

実React hook、Store、IndexedDB adapter、Controllerをbundleし、隔離browser contextをlocalhostへnavigationする。Seedはnavigation前に済ませる。匿名scopeの初期化は小さな合成migration、設定readyと認証callbackは合成、Cloud adapterは接続待ち100msとsnapshot通知を制御するstub。localhost以外の通信を遮断した。同じharnessで比較元は`git show`から、修正後は作業ツリーからbundleした。

- **初回一覧DOM表示**: navigation開始を0とし、実hookの`showData`に従うTask `li`がReact commitされた時点を`useLayoutEffect`で計測。
- **描画機会**: commit後の二重requestAnimationFrame。実paint完了を直接測定するものではない。
- **Cloud確認完了**: durable受信とserver source通知後、hookがCloud確認済みになったReact commit。
- **受信処理**: adapterが最初のrecord/batch受信を開始してから、server source通知直前まで。

この比較は実Firebase RTT、Firebase認証復元、Expo Routerと全UI component、PWA/Service Worker、iPhoneの実機起動時間を含まない。実hookの起動→一覧DOM表示を測る合成browser計測であり、Productionの体感時間の保証ではない。p95を評価できるサンプル数ではない。

## 修正前後の結果

### 同一Cloud値を受信（ms、3回の中央値）

|件数|初回一覧DOM: 前→後|描画機会: 前→後|Cloud確認完了: 前→後|受信処理: 前→後|全体atomic保存回数: 前→後|
|---:|---:|---:|---:|---:|---:|
|100|282.3 → 52.2|313.3 → 80.7|282.3 → 166.4|121.7 → 0.6|100 → 0|
|500|2,513.5 → 56.2|2,532.6 → 79.1|2,513.5 → 167.2|2,333.4 → 1.6|500 → 0|
|1,000|3,073.4 → 65.2|3,103.6 → 84.1|9,545.0 → 174.4|9,349.3 → 3.2|1,000 → 0|

1,000件の修正前は3秒経過の閲覧fallbackで先に表示されており、Cloud受信はさらに継続していた。修正後は復元済み一覧がCloud接続前に表示される。大きな差は反復した全体保存・診断・React通知を取り除いた合成条件によるもので、全ユーザーに同率の改善を約束しない。

### 全件が新revisionへ更新される場合（ms）

|件数|初回一覧DOM: 前→後|Cloud確認完了: 前→後|受信処理: 前→後|全体atomic保存回数: 前→後|
|---:|---:|---:|---:|---:|
|100|287.1 → 50.1|287.2 → 158.2|129.6 → 2.7|100 → 1|
|500|2,711.4 → 59.1|2,711.4 → 170.5|2,533.6 → 8.7|500 → 1|
|1,000|3,074.2 → 69.7|10,750.1 → 194.6|10,548.7 → 18.0|1,000 → 1|

same-data no-opだけでなく、実際に保存が必要なsnapshotも1回の全体保存に集約できた。

### オフライン・遅延（500件、各1回）

|条件|初回一覧DOM: 前→後|Cloud確認完了: 前→後|
|---|---:|---:|
|100ms後に接続失敗|175.6 → 60.3ms|未完了 → 未完了|
|接続100ms + snapshot通知2秒遅延|3,064.2 → 59.2ms|4,466.5 → 2,164.5ms|

通信失敗が判明する前でもlocal readyなら閲覧できる。Cloud未確認時に自動的に編集可能にはしない。Journalがある場合のoffline保護停止は変えていない。

### Routine一覧生成（501 Node、100 daily Routine）

completed/pending/skippedを日ごとに交互に保持した合成データ。各条件3回、生成関数だけの中央値。未達はpendingから生成する。

|期間|展開行数|前|後|
|---:|---:|---:|---:|
|365日|12,700|285.1ms|195.8ms|
|1,825日|61,300|5,908.2ms|569.5ms|

全サンプルでgroup/Memo順・dueAt・deadlineSortKeyのsignature hashが修正前後一致し、入力JSONも不変だった。長期履歴での効果であり、通常規模のデータで秒単位の短縮があるとは限らない。日付走査・全未達の生成自体は残る。

## 検証

変更前に新しいローカル即時表示、snapshot batch、1回保存のテストが期待した理由で失敗することを確認した。追加した不正Outbox保持テストも失敗→修正→成功を確認した。queued local editのfixtureは当初sortKey衝突により2操作生成されていたため、有効で異なるsortKeyに修正し、1操作の期待値を維持した。

|検証|最終結果|
|---|---|
|全体Vitest|1,300 passed / 47 environment-gated skipped（167 files passed / 4 skipped）|
|Firestore Emulator実SDK|26 passed（demo-taskmemo-v2、Firestoreのみ）|
|TypeScript|PASS|
|Lint|PASS|
|Web export|PASS（development → taskmemoapp-dev、production-mode最適化）|
|git diff --check|PASS|
|DEV exportの実画面|隔離Chromiumで合成local Task表示、pageerrorなし。外部通信遮断、SW無効|

47 skipを合格とは扱っていない。そのうちFirestore E2E 26件は別途Emulatorで実行済み。live Firebase/PWA/Android/iPhoneの未実行項目は残る。Functionsソースは変更していない。

### 重点シナリオ

- online/Cloud遅延: 復元済みWeb accountのTaskが接続待ち中に表示され、server通知前の編集は禁止。
- offline/Outbox残存: 一覧を閲覧でき、Outboxが保持される。再接続時にreceipt audit完了前のuploadなし。
- Journal不一致: Committed/Journalを保持し、account cacheの表示とuploadを停止。
- 認証切替: AからBへ切替後のAのbatch/server通知を無視し、Bのcacheだけ表示。Aの保存データも変わらない。
- 原子的失敗: IDB transaction abortで全batchのdisk/memory変更なし、writerは保護停止しupload不可。
- CAS競合: 別writerの保存を上書きせず失敗。
- 受信とlocal commandの並行: batch完了後にcommandが直列化され、両方の結果とHistory/Outboxを保持。
- no-op: 600件でseen上限を超えた再受信でも不要保存なし。matching Outboxのack、sequence、Routineの同revision mergeは省略しない。
- ordered scalar受信とbatchのDomain/History/profile/sequence/Outboxが一致。
- 実SDK初回50件を1回保存し、同一の再購読は0回保存。既存SDK E2Eの競合・双方向編集・再起動・receipt・Undo/Redo・backlog drainも通過。
- backup/import/export/recovery、scope/ownership、atomic/Journalsの既存回帰は全体suiteで確認。

## 変更ファイル

### 本体（8ファイル）

- `src/sync/startupPresentation.ts`: early read-only表示。
- `src/sync/types.ts`: optional batch受信interface。
- `src/sync/firebaseSyncAdapter.ts`: snapshot収集・durable完了後のsource通知。
- `src/sync/taskMemoApplicationStore.ts`: serialized batch、no-op、診断snapshot identity。
- `src/sync/taskMemoV2SyncController.ts`: batch配線・通知集約・generation再確認。
- `src/sync/startupDiagnostics.ts`: domain fingerprint再利用。
- `src/hooks/useTaskMemoSync.ts`: 診断snapshotの利用。
- `src/domain/deadlineView.ts`: 一時配列コピー削減。

### テスト（7ファイル）

- 新規: `src/hooks/useTaskMemoSync.webStartup.test.tsx`、`src/sync/startupBatch.test.ts`、`src/sync/startupDiagnostics.test.ts`。
- 更新: `src/hooks/useTaskMemoSync.startup.test.tsx`、`src/sync/startupPresentation.test.ts`、`src/sync/startupListener.test.ts`、`src/sync/firebaseEmulatorV2.e2e.test.ts`。

`indexedDbApplicationStorage.ts`、`redundantJournalRecovery.ts`、復旧/CAS executor、backup codec、永続Envelope schemaは変更していない。

## 残存リスク・次の確認

1. iPhone Safari/PWA、Android、実Auth復元、実Cloud RTT、Service Worker更新は未計測。実機DEV確認が必要。
2. snapshot単位で候補envelopeを一度に生成するため、極端に大きなsnapshotでは一時メモリとmain-thread占有が増える。1,000件全更新の受信処理は今回18msだが低速端末の保証にはならない。
3. Journalあり起動は引き続きserver照合が必要。offlineでは今回のearly表示を適用せず保護停止する。
4. CASは書込時に検査する。同一データで書込不要な受信はdiskを再検査する処理ではなく、別writerの以後の変更は次のCAS等で検出する。診断キャッシュでCAS検査を代用しない。
5. 診断の参照再利用はStore内domainをimmutableとして扱う契約に依存する。既存のNode境界と同様、取得したrecordの外部からの直接変更は避ける。
6. Routineの長期未達展開はまだ全期間を走査する。さらに必要なら表示ページング等を検討するが、履歴の別ストア化は今回行わない。

## 生データ・再現手順

リポジトリ外の `D:/working/TaskMemo/artifacts/startup-implementation-20261104/` に保存。

- `summary.json`: 採用した中央値。
- `before-results.json` / `after-results.json`: browser起動の全サンプル。
- `before-routine.json` / `after-routine.json`: Routine比較とsignature。
- `build.mjs` / `entry.tsx` / `adapter.ts` / `run.mjs` / `routine.mjs`: 合成計測harness。
- `tests.log` / `typescript.log` / `lint.log` / `emulator.log` / `web-export.log`: 最終検証ログ。
- `dev-web-smoke.json` / `dev-web-smoke.png` / `smoke.mjs`: export実画面確認。
- `manifest.json`: baseline commitとbundle/計測ファイルのSHA-256。

```powershell
# app checkoutから。すべてlocalhostの隔離context、Productionデータなし。
node ../artifacts/startup-implementation-20261104/build.mjs before
node ../artifacts/startup-implementation-20261104/build.mjs after
node ../artifacts/startup-implementation-20261104/run.mjs before
node ../artifacts/startup-implementation-20261104/run.mjs after
node ../artifacts/startup-implementation-20261104/build.mjs before routine
node ../artifacts/startup-implementation-20261104/build.mjs after routine
node ../artifacts/startup-implementation-20261104/routine.mjs before
node ../artifacts/startup-implementation-20261104/routine.mjs after
```

Emulatorは `TASKMEMO_EMULATOR_E2E=1` を設定し、`firebase.emulator.json` / `--project demo-taskmemo-v2 --only firestore` で `src/sync/firebaseEmulatorV2.e2e.test.ts` を実行する。Live DEV integrationを有効化する変数とは異なる。今回のEmulatorは停止済み。
