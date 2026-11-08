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

## 8. R1: 全永続resourceの移行契約

以下は新設計の規則。account resourceは`(project, uid, generation, resourceType, resourceId)`、端末設定は`(installationId, origin, localScope, settingKey)`で識別する。同名の異なるscopeを統合しない。新targetの物理配置は02節8、成功判定は本節を適用する。単なるraw archiveは保全済みであって機能移行完了ではない。

|種別/保存元|移行先・変換|未同期変更・History|照合条件 / 成功不可条件|
|---|---|---|---|
|Memo/Task/Category/Queue、V1 nodes・V2 domain/nodesV2|`node/<元ID>` baseline/属性head/projection。日時は精度を保つ既知変換、欠落はsourcePresence付き互換解釈。未知field/削除も保持|根拠付きOutboxをintentへ。node Historyは属性補償History、変換不能は実行不可の閲覧可能History|ID/親/順位/全field/未知field/削除状態一致。参照欠損・未分類差分・基点不明の操作は停止|
|Routine定義/日別実績/完了履歴、Node内旧category/rule/history/outcomes/lifecycle等|元node IDのconfig/lifecycleとoccurrence key別head。historyとoutcomes両sourceを対応付け、取消/null/retainedも保持。投影行を新Nodeにしない|日別intent/definition intentを区別。旧History・完了イベントは同ID/日付の履歴へ|全日付/状態/changedAt/期間/retainedと生成条件を比較。両形式の意味不一致、欠落実績は停止|
|常設メモ、旧pinned-note key・Envelope.profile.pinnedNote・profileV2|singleton `pinnedNote/main`、body baselineとbody MV head、常設メモprojection。syncedのbody/revision/opIdを基点候補として保存|localBody≠syncedまたはdirtySince/migrationPendingがあればローカル候補を必ず保持。before/baseと操作対応を証明できればbody intent、できなければ両bodyを競合候補。dirtySinceだけから順序を推定しない。pinnedNote Historyを同resourceへ|各端末のlocalBody/synced/dirty/元op/receiptが新head・pending・候補へ全件対応し新版で閲覧/解決できる。空文字は削除指示でなく有効body。rawにしか本文がない、dirtyをfalseにしただけ、競合未解決なら通常成功不可|
|features、旧features key・Envelope.profile.features・profileV2|singleton `features/main`のideasEnabled bool head。欠落とfalseを区別。旧localとsyncedは別source|未送信features operation/Historyをfeatures intent/補償Historyへ。相違に根拠がなければ両bool候補、時刻勝者にしない|値/明示false/基点/元op/Historyの対応とUI機能切替を照合。常設メモと一緒に消す、未分類local/Cloud差は停止|
|legacy pinned candidates、Envelope/backup候補|`legacyCandidate/<source identity>`の本文/日時/出所/未解決状態。端末間の同文も出所を失わず関連付ける|未確定の採用はcandidateのまま。採用操作はcandidate→pinnedNoteへの明示command。候補採用Historyも原文参照を保持|候補数/本文/来歴と候補UIからの回収可否。rawのみで候補にアクセス不能、無断採用/重複除去は停止|
|ownership ledger・匿名identity・adoption途中の記録|`migrationSources/ownership`とlocal identity registry、対応Node/profile/candidate参照。所有権操作を自動再実行しない|未完了transactionを状態機械として保留。旧History/承認は読取可能な移行履歴へ、承認権限は再利用しない|scope/所有者/全source→target対応/途中状態を照合。ID衝突・未確定ownershipは停止|
|list-display key|端末/origin固有`deviceSettings/listDisplay`。visibleGroupIds/showPinnedNote/todayGranularity/pinnedNoteHeight、initialDefaultsAtと未知fieldも保持|account同期しない。保存待ち設定は最終入力をlocal mutationとして確定。既存Historyがあればdevice-local Historyへ|元rawと互換表示値の両方を比較。勝手なclamp/初期化で一致扱いにしない。異常値は原本付き修正承認まで停止|
|tree-display key|同`deviceSettings/treeDisplay.showCompletedMemos`|端末別、他端末の値で置換しない。設定Historyはlocalへ|bool/欠落/未知fieldを比較。不明型をfalseとみなして成功不可|
|reminders key|同`deviceSettings/reminders`のenabled/sameDay/dayBefore|端末別。OS通知許可は移行できず観測情報として区別。移行中は通知schedule副作用を停止|各flag/OS許可区別を照合。PC値でiPhone設定を上書きしない。新通知二重予約なら停止|
|theme key|同`deviceSettings/theme`のlight/dark/system|端末別。見た目の解決色でなくmodeを保持。Historyがなければ作ったと主張しない|mode/元rawの一致。異なるmodeを同じ色だから統合するのは禁止|
|Journal/Committed/raw CAS用fingerprint・復旧plan/保護原本|旧rawは不変source、新local Envelope/checkpointは別namespace。raw CASは期待raw/Journal/epochを保つ|Journalはintentではない。不明Journalは既存復旧保護で停止。旧History消去を呼ばない|全scope/byte/hash/参照一致。Journal未解決や保護原本不在は停止|
|独立Outbox/Envelope Outbox/通信中操作・receipt|旧operation/ACKを不変source＋新intent mapping/awaiting/applicationResultへ|同一op同payloadは一論理操作。already-represented/provable-unapplied/unresolvedを区別し、ACKで未反映原操作を消さない|全op ID/payload/受領/反映/候補の対応。原本だけ置いて未反映操作を無視するのは停止|
|History past/future（node/pinnedNote/features/旧whole-state）|resource付き新HistoryとlegacyHistory閲覧/export一覧。command順・Undo/Redo方向・元before/after/op参照保持|安全に写像できるものだけ実行可能。実行不可を明記し利用者判断待ち。原本消去/全Node巻戻し不可|全entry/targets/方向/本文を照合。読めないHistoryをarchiveに隠す、受入要件のUndoが未対応なら通常成功不可|
|backup schema1〜4/復旧backup/checkpoint|別sourceとして登録、既にactiveにある内容とidentity照合。新完全checkpointには全resource/local設定/履歴/操作/候補を含む|snapshot復元は明示plan。存在しない過去操作は捏造しない。古いsnapshotの値を新操作として自動投入しない|読戻しとsource対応を検証。重複import、他scope上書き、未収録情報を復元済みとするのは禁止|
|sync control/repairLock/migration manifest/actor seq・診断key|新controlは新epoch/世代として発行、旧control/diagnosticは出所付き監査resourceへ。既存lease/approvalを権限として再使用しない|旧seqとpending identityは保持、新writerは新incarnation。診断は閲覧可能、正本に昇格させない|旧active/repair状態の対応と全keyの分類完了。不明lock/稼働writerは停止|
|externalAiRequestsV2/result等の外部要求・処理結果|`migrationSources/externalRequests`に元request/result/対象op対応を保存し監査ビューへ。旧side effectを再実行しない|実行中要求はAdmin drainで終端/未処理を分類し、未反映のユーザー操作はintent/candidateへ対応。外部要求履歴も元IDで参照可|要求/結果/receipt/Node変更の対応が一致。稼働要求/意味不明な未反映結果があれば停止|
|未列挙永続key/field/collection|inventoryへ追加しopaque resourceで読取/exportを可能にする。意味が必要なら型契約を追加して再レビュー|未知operationを実行しない。入力/ユーザー機能である可能性を勝手に除外しない|未分類は0を要求。単なるarchiveしかない未対応ユーザーデータは移行成功不可|

設定の同期区分は固定する: **account同期は常設メモとideasEnabled、list/tree/reminders/themeは端末・origin固有**。features keyはsettings backupにもあるが、二重の別設定を作らずaccount resourceへのsourceとして照合する。同一端末内のkey/Envelope/backup差も明示する。初回欠落は互換readerの既定解釈と欠落事実を残し、明示値への変更命令としない。

境界: Firebase Authのtoken/SDK sessionはユーザー内容の移行対象にせず、認証主体を照合するだけでexport/初期化しない。SW/Cache Storageのアプリ実行資材はbuild/origin/版を棚卸しし、データ移行の成功根拠にしない。もしcacheにユーザー内容が見つかれば未列挙永続sourceとして追加する。許可なしにcache削除/旧アプリ更新を行わない。

全行でraw保全に加え、利用中の機能は新projection/設定/候補/History経路から利用可能であることを要求する。既存設計のarchive分類は保存の必要条件であり完了の十分条件ではない。未解決データが残ればready/通常成功を止める。例外は項目ごとの本人承認で部分移行と表示し、全件成功とは呼ばない。

## 9. R4: 揮発中の入力もsourceに含める

|画面/処理|保存前source|回収先と条件|
|---|---|---|
|通常Memo/Task/Routine編集画面|タイトル/本文/期限/周期等のReact draft、IME composition、600ms autosave待ち|入力そのままのdraft bundle＋resource/base参照。本人確認のlocal確定後に永続resourceへ。未検証入力は回復可能draftへ、readyは止める|
|inline title / QuickTitleEditor|draftRef/sourceRef、遅延blur、saving中、追加した文字|blur/画面終了の前に原文字列を退避。trim後の保存値だけで未確定文字を消さない。確定値とraw draft双方の対応を記録|
|Quick Add|未作成タイトル、target group/親/期限context|未作成draftとして保持、本人確認で一度だけcreateへ。再開で二重作成しない|
|Text workspace|text/validatedText/session.baseline、未実行plan、確認dialog、inFlight|textを正本draftとして回収。180ms検証待ちのvalidatedTextだけは不可。無効構文/確認前削除を勝手にcommitしない|
|常設メモ|入力body、debounce、localBody、synced、dirtySince|未確定bodyを回収しlocal確定/候補へ。dirty/outbox/receiptとは別項目として照合|
|設定UI/復元/採用dialog|選択済み未保存値、開いたplan/候補/確認状態|設定draft/command draftとして保持。未確認planは実行せず回復UIへ。破棄確認を移行承認で代用しない|
|保存queue/ネットワーク|受付済みlocal command、未実行timer、Outbox、送信中op/ACK callback|受付identityと処理状態をcapture manifestへ。Cloud強制送信をせず、保存の完了かdurable pendingへの隔離を確認|

独立raw inspectorでは別tabのReact stateを取得できない。旧画面で本人が内容確認して非破壊exportまたはlocal確定するまで更新/離脱しない。安全に取得不能ならその端末はready不可。iPhone PWA、Safari、PCの各tab/windowと各originを個別に扱う。OSが既に破棄した未保存メモリを回収できるとは保証しない。

静止条件と再入力によるready失効は03節9・10、draftを含むbackupは04節7、具体的試験は05節6を参照。

追加調査の固定版根拠: 公開`f3c8253650657b66ac30edd6861ccd5903391ffa`の`src/services/viewPreferences.ts`（list/treeとinitialDefaultsAt）、`reminderPreferences.ts`、`featurePreferences.ts`、`backupSettingsStorage.ts`、`src/theme/theme.tsx`、`src/sync/types.ts`（targetType）、`taskMemoApplicationStore.ts`（dirty/History）。揮発入力は`src/hooks/useInlineTitleEdit.ts`（draftRef/遅延blur/unmount保存）、`useEditorAutosave.ts`（600ms）、`src/components/QuickTitleEditor.tsx`（100ms）、`DeadlineView.tsx`（Quick Add）、`TextWorkspace.tsx`（text/validatedText/180ms/plan）を静的照合した。将来のcapture/barrier実装が既にあるという意味ではない。

## 根拠コード（固定版）

公開de5bd08の以下は現在調査版とも共通する主要契約:

- [Node codec](https://github.com/yshtysht8sh10-glitch/TaskMemoApp/blob/de5bd087f7603831216b4d10a38a7fb41aa76b43/src/sync/nodeV2Codec.ts)、[旧日時](https://github.com/yshtysht8sh10-glitch/TaskMemoApp/blob/de5bd087f7603831216b4d10a38a7fb41aa76b43/src/sync/legacyDateCodec.ts)、[local移行](https://github.com/yshtysht8sh10-glitch/TaskMemoApp/blob/de5bd087f7603831216b4d10a38a7fb41aa76b43/src/sync/localApplication.ts)
- [Envelope open/History/ACK](https://github.com/yshtysht8sh10-glitch/TaskMemoApp/blob/de5bd087f7603831216b4d10a38a7fb41aa76b43/src/sync/taskMemoApplicationStore.ts)、[backup](https://github.com/yshtysht8sh10-glitch/TaskMemoApp/blob/de5bd087f7603831216b4d10a38a7fb41aa76b43/src/services/nodeBackup.ts)、[profile loss旧policy](https://github.com/yshtysht8sh10-glitch/TaskMemoApp/blob/de5bd087f7603831216b4d10a38a7fb41aa76b43/src/sync/v1ExportMigration.ts)
- [公開DEVのQueue差分](https://github.com/yshtysht8sh10-glitch/TaskMemoApp/blob/f3c8253650657b66ac30edd6861ccd5903391ffa/src/domain/queueRegisters.ts)。Production参照0c4ac60はこのQueue mergeを含まない。

#116保護の現調査sourceはローカル0c4ac60。特にwriteAtomicは期待Committed rawの一致とjournal===nullを要求し、clearRedundantJournalはscope/raw一致・空Outbox・Cloud検証・再CASを要求する。これは共有型名だけでなく実装版に依存する。設計branch基点f3c8253へその製品コードを取り込んだという意味ではない。
