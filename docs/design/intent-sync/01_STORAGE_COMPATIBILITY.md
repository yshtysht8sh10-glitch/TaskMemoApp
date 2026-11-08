# 01 現在の保存形式・互換性と残存可能性

## 1. 「旧形式」は一種類ではない

別々に管理する: アプリbuild、sync protocol、Firestore doc schema、ローカルEnvelope版、Node内の任意field、日時表現、Undo形式、backup版。例えばEnvelope.version=2でもNodeのmemoTypeやroutineLifecycleが欠落することがあり、古いwhole-state Undoが入ることもある。

## 2. 現在の保存領域

|領域|形式/内容|読取/変換の実態|
|---|---|---|
|旧Node localStorage/AsyncStorage|`@taskmemo/nodes/v1`、Node配列|旧loaderはDate復元・既定memoType・rank/Routine category正規化。新common-local移行は別のstrict decoderとsource backupを使用。経路を混同しない|
|旧profile/settings|pinned-note、features、表示設定等の複数key|Nodeだけの移行/backupでは漏れる。常設メモ候補・未知keyも分類が必要|
|foundation Envelope|`@taskmemo/sync-v2/application/v1` とjournal|基礎実装用namespace。アプリ実運用での残存は未確認。内容を見ず「テスト用だから消す」としない|
|独立旧Outbox|`@taskmemo/sync-outbox/v1`、version1/deviceId/nextLocalSeq/operations|現在のaccount EnvelopeのOutboxと別。存在・0件を確認するまで無視しない|
|real-Node V2旧領域|`@taskmemo/sync-v2/taskmemo-application/v2/{encodedScope}` とapplication-journal key|version2、domain/history/sync/profile等のJSON文字列。Webでは移行前原本として残り得る。NativeはAsyncStorage adapterを使う|
|IndexedDB|DB `taskmemo-v2-local-application` / store `scopes` / key scope|committed/journal/legacyFingerprintと保護原本・復旧mode/plan等。アカウント、匿名identity/local、V1-backup等が同居し得る|
|Firestore V1|`users/{uid}/nodes/{id}`|旧Nodeそのもの。codecはTimestampへ変換。V2選択時のRules拒否は存在しないことを意味しない|
|Firestore V2 Node|`users/{uid}/nodesV2/{id}`、ownerUid/schemaVersion2/record/serverUpdatedAt|recordはvalue＋revision/lastOpId/device/seq/type。valueは任意追加fieldを含む。現在も旧field構成のNodeを受け取れる|
|profile|profileV2/pinnedNote・features|常設メモ/ideasEnabledとversioned metadata。ローカルdirty/candidatesも別に保持|
|receipt|syncOperationsV2/opId|元operation＋acknowledgementをimmutable保存。supersededも残る。type/Node snapshotは属性intentの完全な記録ではない|
|control|syncMetadataV2/compatibility・repairLock、syncControl|protocol gateと復旧lease。データschemaやclient buildと同一ではない|
|外部writer|Functions/MCPのnodesV2/receipts・externalAiRequestsV2/result等|Admin SDKのサーバーwriterも棚卸し対象。Rules変更だけでは停止できない|
|通常backup|schema1/2のnodes等、schema3/4のcontent/settings|Node/常設メモ/候補/設定。History/Outbox/receipt全体のcheckpointではない|
|復旧backup|`taskmemo-v2-recovery-v2`等|`@taskmemo/`key、IndexedDB全scope、committed/journal/保護原本を含む別形式。多scope・機密内容に注意|

### 現在のV2 Envelope

概念的にversion/deviceId/nextLocalSeq/domain/history.past・future/sync.outbox・seenOpIds/profile。ownership ledger/transaction/recovery seed等の拡張もある。domainはVersionedNode、Historyはresourceごとのbefore/after/forwardOpId/revision等。profileには常設メモのlocal/synced/dirty、legacy候補、featuresがある。

Journalはreceiptではなく未確定/復旧証拠。Committedは保存済みraw。raw CASは期待Committed byte列と現在raw・Journal-nullを確認して一つの候補をatomic保存する。これらは属性intentの合成を保証するものではないが、新契約でも緩めてはいけない。

## 3. 読み込み時に何が起きるか

- nodeFromV2Valueは元objectをspreadし、既知日時をDateへ復元、memoType欠落等をtaskとして解釈。routineLifecycleは任意、欠落は有効なRoutine。未知fieldは原則保持し、不正lifecycleは拒否する。
- これは**メモリ上の読取表現の変換**で、全件のrawを必ず書換えるmigrationではない。UIでは既定値が見えていてもsource fieldは欠落したままのことがある。明示Commandで保存するとその後の表現が変わることはある。
- IndexedDB初回copyは旧V2のCommitted/Journalをrawのまま一括コピーし旧rawのfingerprintを保持。既存scopesがあればそれを検証して使用し、旧sourceが変われば停止。通常起動で全領域を正規化/削除する設計ではない。
- 匿名V1→common-localには明示的な変換処理がある。バックアップとsourceFingerprintを確認して新Envelopeをatomic生成し、V1原本を残す。これはCloud全データ・旧Outbox・全旧Historyを完全変換する汎用手段ではない。
- decodeLegacyDateは既存stringを保持し、認識済みFirestore timestamp JSONだけをISOへ変換。未認識形/ミリ秒未満を黙って切り捨てず拒否する。別codecのtoDate対応やBackupのISO限定と対応集合は一致しない。
- 通常backup parserはschema1〜4を受理するが、宣言したNode/date/構造を検証する。古ければ何でも読めるわけではない。失敗時に空配列へ置き換えてはいけない。

### 重大な注意: 現行互換処理を無条件で移行に使えない

`TaskMemoV2ApplicationStore.open`はtargets形式でない旧whole-state Historyを検出すると、past/futureを空にする経路がある。その後Envelope補完としてcommitされ得る。profile/features/legacyUpdatedAt補完もある。**今回の「旧ローカル操作を全保護」要件では、この消去経路を互換サポートとして流用不可**。新移行readerはStore.openを先に呼ばずrawを取得・退避し、旧Historyを変換または読み取り専用で保全する。安全なUndoに変換不能でも削除せず、旧snapshotと操作内容を閲覧/exportできる保留記録にする。

`v1ExportMigration.ts`には歴史的な`USER-APPROVED DATA LOSS` profile policyがある。過去の限定承認を今回へ持ち越さない。常設メモ/設定/候補を空にするポリシーは今回不採用。`journalAuthoritativeRecovery`等の特定復旧用のfield allowlist/標識title変換も新契約の汎用importerではない。

未知fieldをspreadするcodecでも、すべての過去復旧/export経路が完全losslessとは限らない。読取adapter単体ではなく、入口からcommit/exportまでの全経路をfixtureで検証する必要がある。

## 4. 表示と保存は同一か

同じではない。日時/既定値が復元され、Routineの日別Taskは定義から投影される。Routineの同名行が複数でも、その数の独立Nodeが保存されているとは限らない。通常の完了一覧はNode.status/completedAt等から、Routine実績はroutineHistory/routineOutcomesから投影される。現在の通常Task表示は全過去の完了/取消イベント台帳ではない。History getterのUI表現と、保存されたbefore/after/metadataも別物である。

Routine保存は旧CategoryKind/曜日等、repeatRule、routineHistory、routineOutcomes、routineLifecycle、日別期限/順位等の組合せ。完了定義のretainedと停止/再開期間も保存対象。旧データにないlifecycleを「完了解除」の命令とみなさない。完了取消nullやpending tombstoneを空として捨てない。

## 5. 質問1〜9への回答

|問い|コード上の回答|本番で未確認の部分|
|---|---|---|
|1 新版で旧Nodeを読むか|Yes。任意field欠落を既定解釈し、旧backupも受理する経路あり|対象端末の各Nodeの由来/実形式|
|2 同一領域に混在か|Yes。同じV2 domain/collectionで任意fieldの有無が異なり得る。scopesにも旧copy/backup/保護原本が共存|実際のnamespace/件数|
|3 自動変換か保持か|経路依存。in-memory変換、raw copy、初回移行、Envelope補完が混在。全件一律変換ではない|どの経路がいつ走ったか|
|4 表示と保存形式一致か|No。Date/default/投影とraw表現を区別|表示中sourceがlocal/Cloud/未送信か|
|5 旧Journal/Outbox/receipt残存か|Yes、保持設計/別namespace/immutable receiptがある|実在・未反映・不一致件数|
|6 Routine/実績欠落リスクか|新importerが最新fieldだけ抽出すると欠落する。raw/unknown/旧kind/日別register/retainedを保護する設計が必要|既に欠落した情報の有無|
|7 二端末の更新だけで十分か|No。旧local未同期・history・writer fence・世代合意が別途必要|現在の二端末の準備状況|
|8 明示移行が必要か|推奨Yes。契約正本とreceipt意味、属性版が変わるためBを選ぶ|実行承認/棚卸しはまだない|
|9 変換/保持対象|下表。意味を推定できないものは原本＋未解決として保持|自動変換可能率は未計測|

## 6. 旧形式の残存可能性・移行処理一覧

|対象|残存可能性|新契約での処理|
|---|---|---|
|memoType/任意field欠落|あり|defaultの意味は読取で補完し、sourcePresenceとrawを記録。欠落をOFF/削除命令にしない|
|日時string/Timestamp JSON/Date由来|あり|認識済み形だけlosslessに内部正規形へ。原文字列も保存。精度喪失/未知形は保留|
|旧Routine category/旧周期|あり|元ID/親/旧fieldを保持したbaselineと互換projection。勝手にroutineRootを再作成/重複化しない|
|routineHistoryのみ|あり|既存日付/実績をbaselineに保持。新outcomeとの優先規則を明示してsource両方保存|
|outcomes pending/null、lifecycle/retained|あり|取消と期間も保持。新規発生を止める意味を維持|
|Queue stateの欠落/古いregister|DEV由来等で可能|statusとの不一致を保存し、履歴に根拠なく片方へ統一しない|
|古いwhole-state Undo|あり|immutable archive＋変換可能な対象別History。変換不能は閲覧/export可能な保留History|
|未確定Journal/復旧plan|あり|raw完全保存・既存保護。移行で消去/自動リプレイしない。先に別の検証済み復旧か保留判断|
|legacy独立Outbox/Envelope Outbox|あり|全原操作を採番し原opIdを保持。受領/反映/意図不明を分類して一度だけ写像|
|旧receipt applied/superseded|あり|いずれも原本保持。Nodeにないintentを無視しないが、過去の全操作を無差別再生しない|
|legacy pinned candidates/ownership ledger|あり|scope対応と候補・取り込み途中を保持。再度の自動ownership adoption禁止|
|deleted/purged/非表示Node|あり|移行対象数に含む。title/bodyがすでに消去済みなら復元可能と約束しない|
|保護原本/旧localStorage backup|あり|activeデータと別sourceとしてchecksum/来歴を保持。同じNodeと見ても重複排除で証拠を捨てない|
|旧backup schema1〜4|あり|安全な読取継続。含まれないOutbox等を存在したと捏造しない。snapshot importと完全復旧を分離|
|未知field/未知schema|あり|opaqueに原本保全。理解できない命令は実行せず保留一覧。読み取れないことを空/0件としない|

## 7. 追加の実データ確認が必要になったら

今回は読取不要・未承認として停止。実行計画の前に、対象は本人UIDの各データ領域、目的は移行manifestのcounts/schema/未同期分類、範囲は二端末各scopeと当該アカウントのNodes/profile/receipts/controlに限る案を提示して承認を得る。本文値や全receiptをいきなり収集しない。最初は件数/版/原本hash/型・状態分布から始め、意味照合に必要な内容読取は対象/保持先/共有先まで別途提示する。iPhone/PCの読取も、migrationを始めない観測専用経路が必要。

## 根拠コード（固定版）

公開de5bd08の以下は現在調査版とも共通する主要契約:

- [Node codec](https://github.com/yshtysht8sh10-glitch/TaskMemoApp/blob/de5bd087f7603831216b4d10a38a7fb41aa76b43/src/sync/nodeV2Codec.ts)、[旧日時](https://github.com/yshtysht8sh10-glitch/TaskMemoApp/blob/de5bd087f7603831216b4d10a38a7fb41aa76b43/src/sync/legacyDateCodec.ts)、[local移行](https://github.com/yshtysht8sh10-glitch/TaskMemoApp/blob/de5bd087f7603831216b4d10a38a7fb41aa76b43/src/sync/localApplication.ts)
- [Envelope open/History/ACK](https://github.com/yshtysht8sh10-glitch/TaskMemoApp/blob/de5bd087f7603831216b4d10a38a7fb41aa76b43/src/sync/taskMemoApplicationStore.ts)、[backup](https://github.com/yshtysht8sh10-glitch/TaskMemoApp/blob/de5bd087f7603831216b4d10a38a7fb41aa76b43/src/services/nodeBackup.ts)、[profile loss旧policy](https://github.com/yshtysht8sh10-glitch/TaskMemoApp/blob/de5bd087f7603831216b4d10a38a7fb41aa76b43/src/sync/v1ExportMigration.ts)
- [公開DEVのQueue差分](https://github.com/yshtysht8sh10-glitch/TaskMemoApp/blob/f3c8253650657b66ac30edd6861ccd5903391ffa/src/domain/queueRegisters.ts)。Production参照0c4ac60はこのQueue mergeを含まない。

#116保護の現調査sourceはローカル0c4ac60。特にwriteAtomicは期待Committed rawの一致とjournal===nullを要求し、clearRedundantJournalはscope/raw一致・空Outbox・Cloud検証・再CASを要求する。これは共有型名だけでなく実装版に依存する。設計branch基点f3c8253へその製品コードを取り込んだという意味ではない。
