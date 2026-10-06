# #85 実装記録

production新規登録のローカル実装については[V2 onboarding実装記録](V2_ACCOUNT_ONBOARDING_IMPLEMENTATION.md)を参照。
Firebase/Hostingへの配備は未実施。

通常account V2同期とanonymous → account ownership reconcileは別責務。
**Account Local != CloudだけでConflictやreconcile確認を出さない。**
対象はaccount別ledgerで未処理のanonymous変更のみ。

## Phase A

`ownership.ts`: environmentを含むlocal/account論理scope、deviceと分離した所有者識別、
scope generation ticket、認証と独立したApplicationReadiness。
旧account物理storage keyは既存復旧のため維持する。論理scopeから対応付ける。
単一ブラウザprofileのlocalデータは共有され、別の人間を自動識別するものではない。

## Phase B

`localApplication.ts`: raw V1 JSONを検証し、ID/未知field/Routine/rankを保持した初期baselineを
atomicに保存。元JSONとprofile、fingerprint、verified移行ledgerを同一envelopeへ保持する。
初期revisionはlocal所有の0、初期History/Outboxは空。二度目はbackupを再importしない。
未確定local journalは昇格せず拒否。以後local所有の全store mutationはatomic CASとし、
失敗時に再起動で適用されるWALを残さない。accountの既存WAL/recoveryは維持する。
backupは自動削除しない。原V1キーも変更しない。

rank拒否テストの`bad`はfractional-indexingで有効なrankだったため`-`へ訂正。
実装の許可値をテスト都合で変更していない。

## Phase C

`ownershipReconcile.ts`: account別ledgerは最後に処理したanonymous snapshotと採用ancestorを保持。
処理済み判定にはcloud値を渡さない。変更anonymous Nodeだけplan対象にし、cloud-onlyは触らない。
未取り込みを選択した場合もskipped checkpointを残し原本を保持。再編集で新しい対象となる。
同一値は操作0、初回同ID差分はNode単位conflict、共通ancestorがある一方変更だけapply候補。
purgedを復活させず、profileは明示確認対象。field/timestamp/revision推測mergeなし。

## Phase D

storeのprivate plan照合とatomic ownership transactionにより、確認したaccount baselineから
新しいaccount操作を生成する。匿名Outbox/revision/Historyはコピーしない。
選択したNode全valueを採用しfieldを推測で混ぜない。構造/rank/削除集合の検証を通す。
profileも独立したresourceで採用可能。cloud-onlyは保持する。
既存Firebase adapterのtransactionでownership operationのexpectedCurrentを照合する。
通常操作にはこの条件を付けず、既存同期を維持する。
partial receiptをatomic ledgerに保存し、全受領までHistoryに載せず通常編集/Undoを停止する。
全受領で1Historyとaccount別checkpointを確定。元source/plan/receipt backupは削除しない。
送信失敗はconflict/recovery状態で保持し、正常完了と表示しない。

## Phase E — common Application / login / logout

`services/localV2Application.ts`がenvironment別の安定installation/localProfile/device識別子を
`expo-crypto.randomUUID`で生成・永続化し、プロセス内で同じstoreを返す。
`useTaskMemoSync`は未ログイン・Firebase未設定でもcommon Local V2をopenする。
通常CRUD、常設メモ、Idea設定、text begin/prepare/commit、Undo/Redoは同じstore/controllerを使う。
旧V1へのNode/profile書戻しは行わない。fresh Localは空でありmock seedを保存しない。

Application状態は`opening / ready / error`、cloud認証・通信状態は別。
text利用の最低条件はstore初期化・復旧が完了し、ownership recovery中でないこと。
Firebase login・V2同期feature flag・即時送信可能性は編集の条件ではない。
既存production cutover、receipt audit、journal preflight、self-repair停止条件は維持する。

Local OutboxはLocal envelopeのdurable履歴として残り、disconnected/localOnly controllerは送信しない。
login時に匿名OutboxをコピーしたりrevisionをUIDへ付替えたりしない。
Account scopeの既存Outboxは通常V2同期で送信する。未処理匿名変更は別の明示取り込みで
確認したAccount baselineから新しいopId/sequence/revisionを発行する。

auth変更は旧controller停止→旧store idle→Native lease解放→generation照合→新scope open。
Accountのcache、Domain、History、Outbox、ledger、pending recoveryを別UIDへ渡さない。
処理待ち中も通常UIをV1 fallbackで更新しない。旧text sessionは新storeのprivate登録に存在せず拒否。
logoutは元のLocal identity/storeへ戻る。AccountデータをLocalへ逆importしない。
取り込みasync確認後にもgenerationを照合し、切替後に旧controllerをresumeしない。
すでに送信開始したtransactionの完了は旧UIDのreceiptとして回収する。新UIDへ送り直さない。

### 永続化とwriter

- Web: IndexedDB `taskmemo-v2-local-application` / object store `scopes`。
  envelope全体のtransactional CASで同時tabの古い保存を拒否する。
- Local logical/physical scope: `local:v2:<environment>:<installation>:<localProfile>`（各要素encode）。
- identity row: `local-identity:v2:<environment>`。backup row: `<local scope>:v1-backup`。
- Account logical scope: `account:v2:<environment>:<project>:<uid>`。
  既存Account physical scope `<project>/<uid>`は既存journalの復旧互換性のため保持。
  Firebase projectは既存environment境界で検証する。
- Native committed key: `@taskmemo/sync-v2/taskmemo-application/v2/<encodeURIComponent(scope)>`。
  journal keyは`@taskmemo/sync-v2/taskmemo-application-journal/v2/<encoded scope>`。
  Localは1 envelopeのAsyncStorage置換とCAS照合、アプリ内scope writer tokenで排他。
  **Nativeは単一JS process writerを前提とする。複数process間のatomic lockは提供しない。**
  別process/background writerを追加する場合は先にstorage排他設計が必要。
- 同じbrowser/OS profileを共有する人間を匿名scopeで自動識別しない。

## Phase F — reconcile / conflict UX

表示条件はsigned Accountが開かれ、server確認が完了し、当該Accountのcheckpointに対して匿名snapshotの変更IDまたは
profile変更が存在し、安全な初回自動取り込みの条件に該当しない場合。uploading中は確認UIを出さず、
conflict transaction/recovery seedが残る場合は復旧案内を表示する。
同じ匿名内容をcompleted/skipped checkpointで処理済みなら、remoteだけ変わっても非表示。
Account Local != Cloud、Account Outbox待ち、offline、別端末更新だけではownership UIを出さない。

「取り込み内容を確認」「アカウント側のみを使用する」を選ぶ。
確認は通常Outboxを先に収束させ、server由来の全snapshot/profileを取得して行う。
各Nodeのローカル/Account全valueを比較し、Node単位で採用先を選ぶ。全fieldを推測mergeしない。
purged、sourceから欠落したNodeのLocal採用は禁止。構造/rankの矛盾も保存しない。
既存Account tombstoneの復元も取り込みでは行わず、通常のゴミ箱復元後に再確認する。
匿名にのみ存在するsoft-deleted Nodeは非表示のまま採用可能で、active Node減少として数えない。
追加/一方変更候補は一括選択可能。削除はfingerprintと正確なID集合の明示確認が必要。
plan/account切替時は選択と削除確認をresetする。
「後で行う」はcheckpointを確定しない。「Accountのみ」はskipped checkpointを残し原本を保持。
あとで匿名を編集すれば、その新しい変更だけが再候補となる。AのcheckpointでBを処理済みにしない。

### strict remote / partial success

commit直前に全server snapshotを再比較し、変更があれば再確認へ戻す。
さらに各Firebase upload transaction内でownershipの`expectedCurrent`（不在も含む）を完全照合する。
receiptが既にある同じ操作は冪等に返す。通常V2操作へこのownership条件を追加しない。
SDKへundefined optional fieldを渡さない。Rules/cutoverを迂回せず既存adapterで送信する。

部分成功はpending ledgerとaccepted opIdをatomic保存し、全受領まではHistoryを追加しない。
通常編集/Undo/Redoを止め、送信エラーをcompleted扱いしない。再起動でもpendingを検出する。
復旧はreceipt audit→最新server snapshot→再plan。accepted Node/resourceは再送しない。
未受領のoptimistic projectionは最新Account snapshotへ戻す前に、元transaction/Outboxを
`ownershipRecoveryBackups`へ保存する。pending seed、source、plan、receipt、完了backupは自動削除しない。
新planで残りを確認し、全受領後に取り込み全体を1History/checkpointへ確定する。
remoteが再変更されたHistoryは既存revision照合でUndo拒否となり得る。無条件rollbackしない。
部分成功の「破棄」はremote rollbackを意味しないため禁止し、再確認による明示選択を行う。

## V1 migration recovery

1. 移行前にraw Node文字列、profile値とraw profile文字列を独立backup rowへatomic保存・再読込検証。
2. `legacyLocalCodec.ts`でID、型、rank、日時、Memo、親/循環、active兄弟rankを検証。
   不正入力ならdestinationを作らず、原V1とbackupを保持する。
3. 全Nodeをrawのままrevision 0 baselineへatomic保存。未知field/null/省略を保持。
   migration ledgerのsource fingerprintを再確認してstoreをopen。二度目は再importしない。
4. 保存境界の失敗では不完全journalを残さない。再起動・retryで二重適用しない。
   移行後に旧V1 writerがNode/profile原本を変えた場合は次の保存を拒否し、両方の値を残す。
   再open時も独立backupのscope/source/profile/fingerprintを検証し、欠落を作り直して通さない。

本当に破損した入力は画面にrecord番号、ID/type/kind/parentId/sortKey/rank、deleted/purged状態と
失敗条件を表示する。初期化失敗を反復blocking alertで表示しない。
画面の「V1原本を書き出す」はAsyncStorageをread-onlyで二重読取検証し、raw文字列をJSONへ退避。
JSON不正でも加工せず書き出す。Domain/History/Outbox/identityを初期化・変更しない。
このファイルは移行原本の復旧用で、通常Node importファイルとして自動処理しない。

手動復旧は原本・backup・既存destinationを先に端末外へ退避し、診断された対象だけの修正候補を
ユーザーが確認する。現実装はraw破損の自動修復・原本上書き・backup消去を提供しない。
source/backup不一致、destination所有者不一致、未確定journalは停止し、削除してretryしない。
Web backup原本は上記IndexedDB rowの`committed.backup`、移行済みsourceは
`committed.ownership.migration.source`。Nativeは上記encoded scopeのcommitted key。
profile rawキーは`@taskmemo/profile/pinned-note/v1`、`@taskmemo/settings/features/v1`。
原Nodeキー`@taskmemo/nodes/v1`は移行後も保持する。backup保持は端末storage消去への耐性ではない。

### 2026-10-03 DEV実データのlegacy不整合

19件目 `hidden-deleted-memo`: type=`memo`、kindなし、parentId=null、sortKey=`c`、rankなし。
旧seedにも同じ削除済みMemoが存在。V1の`normalizeNodeSortKeys`（6c05de3）はactiveだけを
正規化するため、削除済みの旧lexical rankを意図的に保持していた。破損ではなく移行validatorの未対応。
新validatorが全Nodeへfractional rankを要求したため起動を止めていた。
正式互換性としてdeleted/purged Nodeに限り旧a..zの1文字rankを無変更で保持する。
active Nodeには適用しない。空/数値/未知の不正rank、ID/type不正等は引き続き拒否。
これは再採番・ID/type変換ではなく、非表示metadataのlossless保持。
通常restoreは既存`restoreNode`が有効なrankを新規付与し、text保存でrestore/purgeは行わない。
匿名化した形を`docs/fixtures/local-v1-inactive-legacy.json`へ追加し、backup/restart/0変更を検証。

## 検証範囲と停止位置

176 recordsの既存本番由来fixtureを再利用し、全raw valueを保持、無編集text plan/saveは0変更。
migration保存失敗、backup失敗、旧writer、CAS競合、reconcile保存失敗、receipt保存失敗、応答喪失、
部分成功のrestart/replan/1History、未知/Routine metadata、厳密削除、purge拒否を回帰テストで確認。
Account A→logout→元Local→Bのhook経路でNode/History/旧session/送信先分離を確認。
Firestore Emulator（demo-taskmemo-v2）でstrict race拒否とreceipt再送冪等を含む18件PASS。
本番Firebaseへmigration/reconcileは実行しない。

DEV localhost:8081の実V1原本を保持して起動・Local ready・Cloud未ログインを確認。
通常一覧/ツリー、両text編集入口、1セル保存、reload、Undo/Redo、通常完了/Undo、
不正期限のstrict拒否、errorあり破棄、両read-only Viewを確認。検証編集はUndoで戻した。
initial timeoutはserver再起動で解消。blocking migration alertも診断表示へ変更。

Android/iPhone実機、実Firebaseログイン・2端末race・認証失効・ストレージ容量不足/evictionは未確認。
Native複数processは非対応。多数のraw backup/planは容量を使用し、無断で自動削除しない。
Firestore transactionは各resource単位であり全件remote atomicではないため、partial recoveryが必須。
Phase 7 / Hosting deploy / Issue #85・#59 Closeは行わない。

### 最終quality結果（2026-10-03）

| 検証 | 結果 |
|---|---|
| focused 9 files | 62 tests PASS |
| full regression | 105 files / 770 tests PASS、26 tests skip（外部統合の明示条件付き） |
| Firestore Emulator別実行 | 18 tests PASS、demo projectのみ |
| `npx tsc --noEmit` | PASS |
| `npm run lint` | PASS、0 error / 0 warning |
| Text Format定義文書 `--check` | PASS |
| `git diff --check` | PASS（Git改行変換の通知のみ） |
| `npm run web:export:production-v2` | PASS、ローカルartifact出力のみ |

DEVの最終コードでも原本を保持したreload→ツリー編集→無編集保存を確認。
検証画像はworkspace `D:/working/TaskMemo/artifacts/issue85/unsigned-tree-editor.jpg`、
`unsigned-text-view.jpg`。localhost:8081 serverは実機確認継続用に起動したままとする。
#85/#59はOPENを確認。ユーザーの既存差分と無関係なreadonly scriptは保持した。

## 2026-10-03 新規アカウント直後のownership表示修正

一次仕様: [iPhone PWA実機コメント](https://github.com/yshtysht8sh10-glitch/TaskMemoApp/issues/85#issuecomment-5969736111)。
旧実装は匿名変更が1件でもあれば一律確認を出し、adapterのplain objectエラーのmessageを捨てて
内部分類`permanent`を表示していた。両方を修正。signup/re-loginの種別では判定しない。

`TaskMemoV2SyncController`はcompatibility接続・既存Outbox audit後、次の条件を全て満たすときだけ
既存`prepareOwnership → commitOwnership`を自動実行する。

- Account LocalのNode/History/Outbox/pending取り込み/profile/candidateが空。
- このanonymous→Accountのcompleted/skipped checkpointがない。Accountのみの意思を上書きしない。
- server由来の全Node（deleted/purgedを含む）・profileが不存在、receipt件数も0。
- そのserver状態とAccount baselineが一致し、2回目のserver読取とanonymous snapshotも一致。
- 追加する実Nodeとprofileだけ。deleted/purged/仮想Occurrence/欠落/曖昧な変更を含まない。

profile-only（例: Idea設定）も1匿名変更として安全な空Accountへ取り込める。
元anonymous Domain/Outbox/backupは保持。Account新opId/revision、atomic transaction、strict
expectedCurrent、receipt、全件受領後1History/checkpoint、partial recoveryを共用し、別同期方式を作らない。
既存Account、logout後の再編集、A/B切替、競合、削除等は従来の明示確認へ残す。
2回目読取後の同resource変更も既存transactionのexpectedCurrentで拒否する。
remoteは全Node一括atomicではない。途中成功は保存済みtransactionを再確認し、受領済みを重複適用しない。

UIは「ローカル変更の取り込み確認待ち」「ローカル変更を取り込み中…」を同期成功/失敗と区別する。
server未確認時に未処理件数だけで確認UIを出さない。実際の同期失敗は隠さず理由を表示。
手動確認のための通信停止をDEV network simulationエラーとして表示しない。

Auth signupはUIDを作るだけで、現在はV2 compatibility gateを作成しない。
gateはRulesでclient書込不可。gateがない新UIDは従来どおり同期を安全停止し、
Account Localのreadyとは別に「compatibility gateがありません」と案内する。
実機の当該UIDのgate/Cloud状態は取得していないため、報告された同期失敗がgate不足とは未確定。
clientでgateを補完・cutoverを迂回する変更はしない。gate未設定なら承認された管理者側準備が必要。

その後のDEV実Firebase read-only調査で、本日新規作成された2 UIDともgate不存在を確認。
globalは有効、両UIDのV1/V2 Node/profile/receiptは空。DEV個別account provisioning不足だった。
正式なfresh DEV UIDの準備手順と状態遷移は[DEV V2 accountセットアップ](DEV_V2_ACCOUNT_SETUP.md)を参照。
今回gate作成は未実行。gate関連focused 3 files / 22 tests PASS、runtime変更なし。

回帰: 空Account自動取り込み、profile-only、非空Cloud、Cloud profile/receipt、途中remote/source変更、
削除/purge/Occurrence、Account-only選択、原anonymous保持、保存失敗・retry、応答消失・restart・冪等を確認。
最小回帰は修正前に失敗を確認済み。実iPhone PWAの再登録・2端末操作は今回未実施。
本番Hosting deploy、Issue Closeは行わない。

今回のquality結果: focused 3 files / 23 tests PASS、full regression 107 files / 789 tests PASS
（27 tests条件付きskip）、Firestore Emulator 19 tests PASS、TypeScript/lint（0 warning）/
Text Format docs check/diff check PASS。production設定のWeb exportもローカル出力のみPASS。
Emulatorはdemo projectだけで実行し、実Firebase/Hostingには書き込んでいない。
