# #107 Phase 2A 保存・復元基盤（レビュー用）

**隔離テストストアのみ。実ユーザー保存領域・Firestore・既存同期へ未接続。Phase 2B/配信/移行の承認対象ではない。**

正本: [設計212461c / PR #123](https://github.com/yshtysht8sh10-glitch/TaskMemoApp/tree/212461c99d3556e055fb5265cbc6e4c80116f8ac/docs/design/intent-sync)、[Phase 1承認676b4da / PR #124](https://github.com/yshtysht8sh10-glitch/TaskMemoApp/commit/676b4da1089fe11c0c42b2d4ce10496c4ee2c30b)。Phase 1/設計の内容を変更しない。

## 基点と安全上の選択

branch `feature/107-phase2a-local-durability`は676b4daから分岐。Production source `e18c4d1`と#114・起動性能改善を祖先として保持し、無関係なDEV/Queueを取り込まない。PR baseは公開Phase 1 branchに固定し、main/Productionへマージしない。

既存`IndexedDbTaskMemoApplicationJournal`はEnvelope.version=2を検証し、旧AsyncStorage/localStorageも読み込む。そのまま新snapshotへ流用すると旧データ接触/移行に繋がるため、今回**既存adapterへは接続しない**。`ApplicationJournalPersistence.writeAtomic`のraw CAS・Journal-null・transaction complete後の確定という契約を、小さな必須interfaceで再現する。

実装は`src/sync/intent/local/`のみ。実行コードの依存はPhase 1の純粋層だけ。IndexedDB factoryは必須注入、DB名は`taskmemo-intent-phase2a-isolated-test`、storeは`synthetic-scopes`、scopeは`synthetic:`限定。global indexedDB/AsyncStorage/Firebaseを暗黙選択しない。試験はfake-indexeddbの新規factoryと合成値のみ使用した。

## 原子的な保存単位

`Envelope`の全内容を一つのCommitted rawへ保存する。

|内容|保存する意味|
|---|---|
|context|format、storageScope、actor、binding、検証対象baseline。外部から与えられた期待contextと完全一致が必要|
|snapshot|Phase 1のbinding/checkpoint/state/ledger/protection/evidenceを丸ごと含む|
|events|原local intentと、binding付きreceipt/publication通知。元payload/原操作/結果来歴を消さない|
|processed/inbox|どこまで処理したか、通知ごとのqueued/pending/accepted/applied/protected/stale/noop/rejected|
|nextLocalSeq|成功したlocal保存だけから再計算する次の採番。最大受信seqをwatermarkにしない|
|halt|検証済みだが適用不能なfork等での保護停止。自動解除なし|
|revision/history/checksum|保存版・過去commit guard・整合検知hash。raw CASはhashで代用しない|

local操作の採番値は候補内で計算するが、公開counter、戻り値、メモリ、Outbox退役はtransaction complete後にのみ確定する。入力/取得snapshot/contextはコピーし、呼出元の変更でin-flight候補が変化しない。各handle内は直列queue、別handleはraw CASで競合を拒否する。

## 保存・復元の状態遷移

|開始/入力|処理|原子的な確定/失敗|
|---|---|---|
|空の隔離store＋復旧guardなし|初期context/baselineを検証、初期Envelopeを構築|expectedRaw=nullかつJournal=nullで初回CAS。既存rawがあれば初期化しない|
|local操作|観測基点/型を検証し、原intentをevents/outboxへ追加した候補を再生検証|CAS成功後だけ次seq/メモリを進め操作を返す。quota/abort/CAS負けでは元rawとメモリを保持|
|`receive(notice)`|binding・manifest/member/hash/receipt payloadを検証し、原通知をqueuedとして保存|CAS完了が耐久受領の境界。反映成功ではない。完全同一通知は重複保存しない|
|保存済みinbox＋`drain()`|Phase 1の公開APIで処理し、pendingも固定点まで再配送|state/ledger/evidenceとinbox状態を同じCASで確定。親未着P2はpending、P1後にP2を自動再試行|
|再起動|原本read、Journal確認、全event replay、snapshot/evidence照合、外部guard照合|成功時のみhandleを返す。未処理通知は残し`drain()`で再開。open自体は既存rawを書換えない|
|正常applied→conflict/protected|過去reflectionを残し現在結果/候補・隔離状態を別保存|Rの時点に依らず正規化。awaitingが空でも現在conflict/protectionを解決済みにしない|
|整合不明/Journals/未知schema|rawをそのまま返し保護停止|clear/replay/空初期化/推測変換をしない|
|I/O失敗・commit応答不明|当該handleを停止し、成功したと主張しない|再openで再検証。dataの保護停止を解除するAPIではない|

`kind=ready`は「検証済みデータをロードできた」の意味で、編集可能/同期完了ではない。Phase 1 protectionやlocal haltがあればlocal編集は拒否する。純粋protectionでは、過去証跡に対する後着receiptを追記できるが、通常projectionへの復帰/保護解除はない。fork等のlocal haltでは受信/処理も停止する。

## hydrationの再検証

1. 期待するstorage scope、binding/account/generation/activation/incarnation/epoch、baselineの完全一致。format/key/型/Journalも検査。
2. 完全原通知を再検証する。receiptのcanonicalIntentをparseし、scope/世代/型とpayload全体の一致をPhase 1で検査。publicationは全member/manifest/hash/原intentから再生成して一致させる。
3. `initialClient`から原local操作と処理済み通知を再生し、Phase 1の祖先/単調checkpoint/coverage/衝突保護を再適用。親未着は通常のpendingとして適用を止め、既反映の証跡に必要な原本不足とは区別する。
4. 保存されたsnapshot/ledger/evidence/reflection/inbox/nextSeq/haltが再生結果と**全体一致**するか検査。reflectionは元publicationとそのapplied結果からしか生成しない。保存されたfact.bindingだけを信用しない。
5. 外側のchecksumを再計算し、さらに外部から供給された**現在headのRecoveryGuard**へ完全一致するか確認する。古いsnapshot、他世代、未確認の後続headは拒否する。

個別証跡を壊してchecksumだけ再作成したfixtureも停止する。反映事実の欠落、別bindingのreflection、manifest/hash/member/祖先、receipt payload、ledger、counter、未知fieldを検査している。旧形式データをこのschemaへ読み替える処理はない。

## 復旧guardの信頼境界と重要な可用性制約

RecoveryGuardはrevision/raw hash/event数/処理位置/log hash/client hashを束縛する。**成功したcommit後の`guard()`でのみ発行し、検査対象のbackup/raw自身から推定してはいけない。** この依頼ではtest harnessが別変数で保持する。実ユーザー向けの信頼済みguard保管・再取得・承認サービスは未実装で、実データ接続前のレビュー必須条件。

hashはすべて注入されたSHA-256へcanonical JSONを渡して計算する。rawHashも`SHA256(canonical(rawString))`であり、異なるraw文字列を同一視しない。storageのCAS自体はraw文字列の完全一致で行う。

guardが古く、現rawが自己整合した後続に見えても自動採用しない。悪意ある整合した追記と、応答を失った正当なcommitは、snapshot自身のhashだけでは区別できない。保存直後crashで成功通知/guardを失った場合は、**新しいCommittedを削除せず原本を返して停止**する。別の権限経路でheadを確認する手順は今回実装しない。可用性より保全を優先する明示的制約であり、phase2B/旧データ移行の抜け道にしない。

guard/checksumは認証署名でもAuth tokenでもない。JSON再構築は意味/整合の確認であり、通知のserver起源やprivileged attackerへ対する真正性を証明しない。将来のauthenticity/active control確認を省略して本番有効化できる実装ではない。

## 同期完了判定

`status()`はunreceived、awaiting、current conflict、dependencyPending、rejected、protection、inboxPending、inboxRejected、unprocessed、serverConfirmedを別々に返す。completeには全blocking要素0・protectionなし・現在bindingとcheckpointに一致するserver確認をすべて要求する。

server確認は引数の**信頼済みServerObservation**にのみ依存し、receipt/過去appliedから発明しない。省略時は必ずfalse。今回のtrue試験は合成の確認値を注入した論理試験だけであり、認証された実server確認取得機構はない。reboot後に自動的なserver確認を引き継がない。現在conflict/依存待ち/保護はhistorical appliedで打ち消せない。

## 既存CAS・Journal契約との差分

|既存契約|Phase 2A|
|---|---|
|#116期待Committed raw完全一致|同じ。semantic hash一致でCASしない|
|Journal-nullまたは検証済み復旧|同じ。今回は復旧/Cloud検証を実装しないため、raw一致の冗長Journalも常に停止|
|IDB transaction内CAS/短いcallback|同じ。暗号/再生/JSON検証はtransaction外、get callbackでCAS/put、oncompleteでのみ成功|
|既存interfaceのwriteAtomicはoptional、古いfallbackあり|新interfaceでは必須。非atomicのwriteJournal→writeCommitted→clearJournalへfallbackしない|
|既存DB/key/Envelope version2/legacy copy|一切使わない。synthetic隔離DBと新prototype schemaのみ|
|scope/世代隔離|immutable期待contextとadapter.scopeを一致させる。実Auth切替/世代移行や旧writer制御は未接続|
|失敗時の原本保持|同じ。既存raw/Journalを自動削除しない。失敗した未耐久入力は成功ACKせず、呼出側が元入力を保持して再配送する必要がある|

## 障害注入・受入対応

`local/durability.test.ts`の35ケースと、承認済みPhase 1の58ケースを実行する。Phase 1のテスト/期待値は変更しない。

|要求|注入/確認|
|---|---|
|atomic成功/失敗|実fake-IDB transaction、同時handle CAS負け、直列local採番|
|Journal途中crash|隔離DBに部分JSON WALを残し再起動。冗長Journalも含め原raw保持・open/CAS拒否|
|quota/abort|putでQuotaExceededError、保存前signal abort、put後transaction abort。Committed/メモリ/採番/Outbox不変|
|保存直後再起動|成功guardで全snapshot復元。commit後応答喪失は旧guardで止まり、新原本を保持して採番再利用をしない|
|古い/他世代|旧raw復元、別generation/context/scope、guard未取得、未知schemaを拒否|
|欠落/改ざん|reflection削除/別binding、manifest/hash/member/祖先、payload、ledger、seq、未知fieldをchecksum再作成しても拒否|
|inbox耐久化|receive後・drain前の再起動。processing保存abortでもreceiptと旧Outboxが残り再試行可能|
|通知逆転/重複|R/P1/P2の3時点＋P2先着、全段階保存/再open、重複受信。body/完了T1/T2/保護で全client snapshotと正規化inbox一致|
|初回conflict/依存待ち/protected|反映を発明せずawaiting保持。raw source/受領/来歴保持|
|未送信の別操作|applied済みのAを退役しても別title操作はOutboxへ残る|
|同期完了誤判定|server未確認/古い確認、queued通知、current conflict/依存/保護を別評価|
|原本/alias保護|呼出元inputとviewの変更がin-flight候補を変えない。scope間書込分離|

独立レビューで発見されたF1/F2/R-F2、原操作/受領/過去反映/現在競合分離、720ラベル通知・6操作720逐次順列の回帰は、変更していないPhase 1の58ケースに含む。独立レビューscript自体を改変/上書きしていない。実Firestore/Emulator/実ブラウザ/端末ストレージ耐久性/実機quotaの試験は未実施。

## 未実装・残存リスク

- 実ユーザーDB、旧データreader/移行、P0原本回収、Auth/Firestore/publisher/Rules/control/fence、ネットワークACK/再送scheduler、UI/★/Routine等のDomain操作は未接続。
- Safari/Android実トランザクションの実機検証、Native adapter、信頼済みguardの実運用供給、server確認取得は未実装。今回のtest-store APIだけで本番へ接続してはいけない。
- 全event/全publication/全履歴guardを保持し毎回再生する参照実装。容量/CPU/起動性能は未評価で、GC/compactなし。性能改善で証跡を削らない。
- Journal/未知形式/欠落/改ざん/未確認headはread-only停止。解除・修復・正当なheadの再承認を自動化しない。
- current snapshot・事実の整合は検証するが、署名されていない通知の真正性は別の信頼境界。実通信接続/production capabilityを与えない。

レビュー承認前にPhase 2Bへ進まない。保存・復元基盤としての成立性と、この停止境界をレビュー担当へ判断依頼する。

## 実行結果（2026-11-09）

|項目|結果|
|---|---|
|テスト先行|最初の5受入を追加し、未実装moduleのimport失敗を記録→実装後成功。既存保存バグを修正した赤とは混同しない|
|focused|Phase 1 **58 PASS**＋Phase 2A **35 PASS**＝**93 PASS**、5 files|
|全体|**1,377 PASS / 46既存skip**、168 files PASS / 4 skip。skipは未実施|
|型/Lint|`tsc --noEmit`、Lint warning/error 0|
|Web export|development設定、EXPO_OFFLINE=1。4 routesと公開設定の静的照合。配信ではない|
|差分/参照|diff check、Phase 1ファイル非変更、Production e18c4d1 ancestry、文書内部リンクを確認|

全体初回はWeb buildとの同時実行中に既存720ラベル順列が5秒timeoutへ達し、1 FAILとなった。`full-concurrent-timeout.log`に残し、成功扱いにしない。既存テストのtimeout/期待値/skipは変更せず、build終了後の全体再実行で成功した。最終のhead pin厳格化後にもfull/focused/型/Lint/buildの成功を確認した。

repository外ログ: `D:/working/TaskMemo/artifacts/issue107-phase2a/{red,first,focused-first,focused,full,full-concurrent-timeout,full-before-head-pin,types,types-first,lint,web}.log`。snapshotは全て合成値で、実Firestore/端末データを収集していない。独立レビューscript/PR #122証拠と承認設計を変更していない。
