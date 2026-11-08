# 05 テスト計画と既存12ゲートの扱い

**計画のみ。新契約の実装/試験成功を主張しない。** PR #122の原ゲート、既知6/4失敗の証拠を変更/削除しない。

## 1. テスト対象の契約を明示する

旧binaryが直接Nodeを書けるmixed運用を恒久保証する要求は廃止できるが、legacyデータ保全の期待は廃止しない。

- 旧reducerを動かす原12ケースは**歴史的反例として全件維持**。当該旧契約の結果1/7と1/5をそのまま保存し、失敗をPASSやskipへ書き換えない。
- 新版リリースの必須ゲートを変える場合は、writer support policyと以下のnegative/legacy-import/new-intent対応表をレビュー承認する。旧ゲートを実行しないだけでgreenにしない。
- 新active世代ではold live writesは拒否され、旧ローカルに原操作が残ることが期待。これを「従来成功すべき旧書込が成功しないからバグ」と扱わない。
- 同じsource fixtureのデータ意味は移行/復旧ゲートへ引き継ぐ。before/baseの根拠があるfixtureは自動変換して期待どおり合成し、根拠がない別fixtureはraw付き未解決として保全する。元の明確な反例を全部「曖昧だから仕方ない」へ落とさない。

## 2. 原12ケースからの追跡表

全行で原ソースと失敗/成功記録を維持する。「変更」は新契約の統合テスト入口を変えること。「廃止」はold live受理保証のみで、source data/テスト証拠の廃止ではない。

|ID/原ケース|新必須の受入・変更点|
|---|---|
|Q1 legacy completion survives new receive|active後の旧write拒否＋旧Outbox保持。既存旧完了のraw/基点を移行し新版completionとして保全。古いqueue completion registerでactiveへ戻さない|
|Q2 new completion survives legacy round trip without a concurrent edit|恒久legacy往復は廃止。旧データread/exportの保持と、新clientの逐次complete→再送/再起動で完了保持へ変更|
|Q3 legacy completion cancellation survives new receive|旧取消を無視しない。証明可能な取消は新set-activeへ写像。active拒否と原操作退避も検証|
|Q4 offline completion and reorder retained, oldFirst=false|同じ既知基点を持つlegacy sourceのimportと新版別属性intentで所属/順序と完了を両立。old liveは拒否|
|Q5 offline completion and reorder retained, oldFirst=true|Q4の到着逆順で同じ候補集合/確定projection。旧完了だけを曖昧扱いに変えない|
|Q6 unknown-field omission cannot erase completion|旧register欠落は既存値の取消命令ではない。旧rawを保持し、証明可能なintentだけ変換。unknown fieldのbaseline/backup round-trip|
|Q7 late legacy completion retains placement after dissolution and re-creation|旧sourceの遅延完了と新membership世代の配置を分離。再所属を巻き戻さず完了/取消の原本を保持。欠落基点なら明示候補|
|S1 sequential legacy edit retains an already-observed unknown emphasis field|恒久old live受理を外し、旧snapshotの★fieldが存在すれば保持するread/import試験と、新clientの逐次更新で★/本文/完了保持へ変更|
|S2 a stale legacy payload cannot erase a persisted emphasis|旧field欠落をOFFに変換しない。新bodyだけのintentはemphasisを触らない。旧raw自体も捨てない|
|S3 emphasis never cancels concurrent completion, oldFirst=true|新completionとnew emphasisで両方保持。旧未同期completeも根拠あるimport後に同条件で確認|
|S4 emphasis never cancels concurrent completion, oldFirst=false|S3の到着逆順・opIdの辞書順反転でも同じ値/候補集合|
|S5 stale legacy content cannot resurrect emphasis after explicit OFF|ON観測後OFFの因果関係と重複配送でOFF保持。古いtrue snapshotは新ON意図にしない。真の並行ON/OFFは別試験で両候補保持|

正確な名前/入力は[原Queue gate](https://github.com/yshtysht8sh10-glitch/TaskMemoApp/blob/f3c8253650657b66ac30edd6861ccd5903391ffa/scripts/check-queue-legacy-compat.mjs)、[★gate](https://github.com/yshtysht8sh10-glitch/TaskMemoApp/blob/50bb60a7c5d7a1a3586c1c8c335db4717d452f01/scripts/check-list-emphasis-legacy-compat.mjs)を参照。新テストはこれらの成功を偽装するpatchではない。

## 3. 新版同士の必須ケース

|試験群|期待/保全不変条件|
|---|---|
|completion × body|両方適用。status/completedAtの組を保持、どちらの到着順でも同一|
|completion × emphasis ON|両方適用。emphasis操作のwrite-setにcompletionがない|
|emphasis OFF × old ON|観測済みONの再送/遅延投影でOFF維持。古いbackup値を新ONとして発明しない|
|completion cancel|観測したcompleteをset-activeで取消。completed常勝を排除。双方のイベント時刻/原本保持|
|placement × body|parentId/sortKeyとbodyを両立。親削除/循環/Queue世代違いは意味競合で保全|
|同field並行|ON/OFF、本文/本文、完了/取消の候補を両方保持。全headを見たresolveだけが候補を退役|
|順不同/重複|全イベント順列、opId大小/clockずれ、未知親先着、gap後着で欠落なし。最大seqで飛ばさない|
|offline/reconnect|二台の独立属性更新、conflict、受領済み未反映、依存待ちを再接続して収束/候補保全|
|restart|採番直前/保存後/送信後/accepted受信前後/反映前後crashで原操作と意味を保持|
|保存失敗|IDB transaction abort/raw CAS不一致/容量不足/別writerでmemoryを進めずOutbox/Journal保持|
|Undo/Redo|属性補償intent、History coalesce/command単位、同属性remote変更時は保護。無関係fieldを戻さない|
|backup/restore|full checkpointの全集合一致、旧schema1〜4読取、別世代import、操作重複と古いtrueの上書き防止|
|Routine|旧category/日週月年、実績cancel/skip、日付key/期限/順位、lifecycle/retained/再開、投影Taskの非永続性|
|旧データreader|Date/ISO/Timestamp JSON、欠落memoType、null/pending、未知field、legacy rank/tombstone、raw保持|
|migration failures|copy各chunk、verify、gate切替前後、二台の準備差、lease失効/競合、source変更、未知Historyで保護停止|
|rollback|active前/後・新操作なし/ありを分け、旧snapshot復元で新intent/競合を失わない|
|old client拒否|旧SDK create/update/deleteと旧receipt書込拒否、permission-deniedでraw Outboxが残る|
|外部writer|旧MCP/Admin/job停止、server gateとIAM、拒否後にデータを書かない|
|scope|匿名/本人・DEV/Prod・origin・generation・actor incarnationの混線なし|
|意味依存|Routine config同時更新とclose、親削除と移動等のreadSet不一致を黙ってmergeしない|

「過去履歴が保持」は行数だけでなく、dateKey/state/changedAt/null、lifecycle期間/retained、通常完了/取消の元イベント/来歴まで比較する。すでにsourceにない履歴をテストで生成して保全できたように見せない。

## 4. 検証レベルとリリース条件

1. pure reducer/adapterのtable・property試験: 可換性（独立属性）、冪等性、順序入替、因果/並行、dependencyの全数/生成fixture。
2. local storage: fake IndexedDBだけでなくSafari実transaction境界、raw CAS、旧raw保存、Nativeが対象になる場合はそのwriter制約も別検証。
3. 使い捨てFirestore Emulator: 実SDK/Rules/新backend transaction、受領/反映分離、旧SDK拒否、重複/逆順workerとcrash、lease/activationのfault injection。
4. 使い捨てDEV: 新iPhone PWAとPC、別tab/origin、offline、失敗/再起動、実行SHA/manifest/原本整合、旧snapshotの退避と後発import。
5. 移行リハーサル: synthetic source全形式と、承認された観測から匿名化した形のfixtureでconservation ledgerを全件検証。Productionを実験台にしない。
6. 全体test/TypeScript/lint/Web export/関連Functions testsは実装PRごと。設計だけの本PRではアプリbuildを再実行して設計の正しさを装わない。

最新版buildの確認とwriter fence、新正本反映の確認は別合否。新通常suiteがgreenでもデータimport/rollbackゲート不合格なら切替禁止。ゲートmanifestはprotocolとデータadapter対応表に束縛し、旧診断12件からの対応をレビュー承認する。

## 5. 性能/容量の回帰計画

100/500/1,000/5,000 Node＋独立した操作/receipt数・競合数・History容量を増やす。server read、Node投影作成、復元/検証、local raw CAS、初回一覧、操作受領、反映済みの時刻を分ける。baselineからの再起動は全receipt全走査を毎回必須にせず、検証済みsnapshot＋厳密な未処理集合/差分取得を使う。snapshotは参照した操作/候補/clockを保持し、最適化でgapやrawを削らない。compact/GCは別承認まで行わない。
