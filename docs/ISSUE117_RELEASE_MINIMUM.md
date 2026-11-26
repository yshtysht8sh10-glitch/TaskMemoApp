# #117 今週の最小リリース契約

Ownerの2026-11-26優先順位変更を適用。A2完全復旧、registry、複雑なcapabilityは再開しない。
本番抽出版は97ce5fbを基点とし、QueueのUI/model/検証は導入しない。
Production固有のcommittedRawによるraw CAS、保存失敗ラッチ、初回receiveBatchを保持する。
R06のDEV試験は同Storeでの自動再試行を期待していたため、本番では失敗後の再操作も拒否し、
原本不変を確認して再起動したStoreだけで同じ未使用seqを使うよう強化した。
CAS直前失効試験はloadCommittedを呼ぶことを前提にせず、権限再検査の2回目で失効させる。
未知Journal拒否は本番既存の厳格なguardを残し、原本保持のメッセージを追記した。
PR145/559a59bの結果モデル/取消/Undo/Redo/未知raw保護を再利用する。
DEVはPR147/0b408a1基点（Queue保持）。本番抽出時はProduction候補97ce5fb基点へ今回差分だけ移す。

## 簡潔なVer契約

- アプリ対応データVerは2/3のみ。既存compatibility.minimumSyncProtocolを使用し未知Verを拒否。
- Ver2では未達発行不可。Ver3のみ今回の結果メニュー、保存、同期を有効にする。
- 新規Cloud書込は外側dataVersion=3を必須とし、Rulesはgate3で旧形式のNode/profile/receipt/repair lockを拒否。
  各SDK transactionでcontrol/gateを再読し、receipt再利用分岐でも原操作とVerを検査する。
- 既存Cloud Ver2 record/receiptは明示baselineとして読める。未知Verは受信・反映を停止する。
  同UIDの古い実行binaryそのものをRulesが認証する保証ではない。切替前に旧アプリ/タブを閉じる。
  旧版の新規起動はgate3を拒否。旧localだけにある変更は自動再送/廃棄しない。
- ローカルenvelopeのdataVersion省略は2。3は別scope `<project>/<uid>/data-v3`へ一度だけコピーする。
  旧scopeは保持。新scopeの存在確認/元IDB raw読取/新scope作成は同じtransactionで行う。
  Journal/Outbox/dirty pinned note/ownership中は停止。保存済みDomain/ProfileとCloud baseline不一致も停止。
  Profileの受信済みsynced値だけでなくlocalBody/localIdeasEnabledを照合し、migrationPendingも拒否する。
  コピーが確定しStore検査が成功する前に通常同期/編集を起動しない。既存新scopeは上書きしない。
  新scopeが存在した後のgate2降格は拒否する。Native切替とVer3自己修復は未検証のため停止。
  起動後のVer変更はadapter/controllerを失効させ、キャッシュ編集選択でも読書停止を迂回させない。
  各Store commitとCAS直前でもVer/認証の有効性を確認し、未送信操作を退役しない。
- 通常backupはschema5/dataVersion3。旧parserはschema5を拒否。新版は旧schema1–4も読む。
  未知/不一致Verを拒否し、Ver2 Storeへmissedをimportすることも内容検査で拒否する。
- 外部AI Functionsは現行assertGateのgate3拒否を維持し、今回は対応させない。
  Admin/Console/旧運用scriptは切替中・切替後の実行停止を運用条件とする。Rulesで遮断できたとは主張しない。

## 切替前提とOwner承認対象

実環境変更は未実行。次を具体的なUID・固定SHA・Rules hashと共にOwnerへ提示し承認を得る。

1. 対象iPhone/PCと全タブを列挙。編集を保存し、debounce/通信/保存待ちがなく同期済みを確認。
2. 各端末の通常backupを保存。Outbox/Journal/未回収draftが残れば停止。backupだけで保全済みとしない。
3. Ver2の保存済みNode・Routine結果・profileとCloudを照合。不一致/不明は切替しない。
4. DEVは使い捨てUIDだけで検証。実Rules配信とそのUIDのgate3設定は別途具体的なOwner承認が必要。
5. ProductionはQueue/#107/未承認DEVを除いた候補を独立レビューし、Rules/Hosting/対象UIDのgate変更を承認対象へ明示。
6. 新RulesのVer2回帰確認→全旧端末停止→対象gate3→対応アプリ起動/別scopeコピー→全端末受信完了後に利用開始。
7. 途中不一致なら原本保持で停止。新scope未作成は再試行可、作成済みは再コピーしない。
   missed導入後はgate2/旧binaryへ戻さず、Ver3対応版でforward fixする。

## 最小試験・延期

必須: 旧writer拒否、未知Ver/不一致の読書停止、未達/取消/同期/Undo/Redo、通常backup往復、
主要Routine回帰、型、Lint、Web build、独立レビュー、DEV実通信、OwnerのiPhone利用確認。
最初のVer/backup/未知Journal試験は3 FAILを確認してから実装。
既存backup回帰2失敗はschema5の設定/常設メモ読取漏れを修正。
旧compatibility試験の「3を拒否」は新仕様に合わせ「3許可/4拒否」へ改訂（不明Ver拒否は維持）。
詳細性能、全異常系の再網羅、重複全体試験、A2/registry、資産整備Phase2/3は延期。
結果はPRでPASS/skip/未実施を区別する。実DEV/実機/本番をローカル試験で代替しない。

既知制約: account起動時にgateを先に取得するため、通信不能の再起動ではローカル先行編集へ進めない。
起動性能最適化は今回行わない。通常起動後のオフライン編集は保存し、再送時は最新gateを確認する。
新端末で切替元rawがない場合も空初期化せず停止し、Owner判断で別途安全な導入手順を用意する。

## PR #152 M152-1: Production physical storage scope

The account scope remains `<project>/<uid>`. The Journal startup helper now receives
`versionedScope(scope, version)`, matching the physical IndexedDB scope selected by
`openVersion3`. Ver2 is unchanged. No scope check, Journal validation, raw CAS,
storage-failure latch, receiveBatch, or persisted envelope format is relaxed.

Regression: `productionVersionScope.test.ts` first ran 4 PASS / 1 FAIL against the
old hook; the hook wiring assertion failed as expected. After the one-call fix,
all 5 PASS and the related combined run has 90 PASS. The independent reviewer
also retains the original first-copy/restart 2 FAIL / 2 PASS evidence and reports
6 PASS after the fix, including pending Outbox preservation without upload.
Local reports: `artifacts/117-m152-before.json`, `117-m152-after.json`, and
`artifacts/pr152-independent-takeover/results-after.json` (outside this worktree).
Full suite, type/lint and the fixed-SHA build results are recorded in PR #152.
These tests are synthetic; iPhone PWA cutover/acceptance is still unverified.
Production Hosting, Rules, data version and user data have not been changed.
