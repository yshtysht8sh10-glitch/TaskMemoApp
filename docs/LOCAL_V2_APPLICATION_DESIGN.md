# Issue #85 — 共通ローカルV2 Application設計

2026-10-02。[Issue #85](https://github.com/yshtysht8sh10-glitch/TaskMemoApp/issues/85)本文（追加コメントなし）と今回の依頼を仕様一次情報とする。
**承認前の設計履歴。現行runtime/検証結果は[実装記録](LOCAL_V2_IMPLEMENTATION.md)を参照。** #59の[既存調査](TEXT_LOCAL_READINESS.md)、
[UI契約](TEXT_WORKSPACE.md)、[Application契約](TEXT_FORMAT_DEVELOPMENT.md)を再利用した。

## 現在と不足している境界

現在: protocol 1はReact Domain/History + V1 Node cache、protocol 2は認証後のaccount store。
認証callbackがcontroller/storeを破棄し、account scopeの復旧後に再生成する。
V2 coreの認証なし保存、History、revision、Outbox、復元は既存734件のテストのうち
`textEditApplication.test.ts`の追加ケースで確認済み。今回それを再実装しない。

不足部分だけ追加確認した:

| 実装 | 既存責務 / #85で不足するもの |
|---|---|
| `services/nodeStorage.ts` | load時にrank正規化・Routine root補完。raw移行入力にはそのまま使えない |
| `sync/migrationDryRun.ts` | 重複/孤立/field-lossのpure検査。rank正規化を含むためlossless local移行へそのまま適用不可 |
| `sync/taskMemoApplicationStore.ts` | envelope/History/Outbox/WAL。初期Nodeは正規化される。raw初期取り込みAPI、scope所有情報、移行ledgerが不足 |
| `sync/applicationStorage.ts` | scope別単一envelope保存。native CASは単一writer前提 |
| `sync/indexedDbApplicationStorage.ts` | scope record、CAS、既存V2 AsyncStorage移行/復旧記録。V1 Node cache移行とは別手順 |
| `sync/recovery.ts` | account journalはreceipt audit、productionはfinal preflight。匿名local WALの独立復旧規則が不足 |
| `sync/firebaseSyncAdapter.ts` / `revisionModel.ts` | transactionとreceipt、復旧用expectedCurrent/expected acknowledgement照合はある。通常Node送信はwinner規則。reconcile ledgerと結び付いた厳密送信契約は不足 |
| `hooks/useTaskMemoSync.ts` | auth generationはある。Application readinessと認証、共通scope coordinatorが未分離 |

## 1. LifecycleとApplication readiness

Application coordinator（React非依存）が唯一のactive storeを管理する。
起動: identity読込 → scope永続化検査 → 必要なV1移行 → local recovery → local store ready。
Firebase設定欠落や未ログインでもこの経路は動く。fresh installは空Domainを推奨し、mockNodesを本データにしない。
認証復元済みaccountがある起動では、localを別途安全に開いたうえでaccount復旧を行う。
account gate未解決中はlocalを利用可能とし、画面に「ローカル」の所属を明示する。

状態は独立させる: `applicationState`（opening/ready/recovery-required/error）、
`activeScope`、`authState`、`cloudState`、`reconcileState`。
全CRUD・本文・Category・完了・削除・profile・Undo/Redo・#59が同じactive storeへCommandを渡す。
全Commandにscopeとgenerationの受付条件を付け、切替中の旧callbackを拒否する。
storage不調時にV1へfallbackせず、元データを保持して復旧案内を出す。
同期設定flagはCloud側のcapabilityだけを制御するよう段階移行する。既存accountのcutover gateは残す。

## 2. Ownership scope

local scopeはinstallation/profile内に永続化した乱数IDで識別する。
論理キー案: `local:v2:<installationId>:<localProfileId>`。
deviceId（操作発行者）とscopeId（保存所有者）は別物。再起動でscope/device sequenceを継続する。
environment/backend identityをrouting情報に含め、development localをproductionへ自動転送しない。
account論理所有者はenvironment + Firebase projectId + UID。既存 `${projectId}/${uid}`
物理キーを勝手に変更せず、registryで既存保存へ対応付ける。
registry/envelope双方の所有情報が一致しなければ停止。復元したバックアップも所有者を検証する。

複数tabの初回identity生成はIndexedDBの同一transaction/unique recordで一意化。
nativeは単一writerとgenerationを必須にし、多process保証が必要ならtransaction storage導入が先。
未ログインで人間の別ユーザーを自動識別することはできない。同じbrowser/OS profileを共有すれば
localデータも共有される。scope隔離はOS認可/暗号化の代替ではない。複数local profile UIは別途判断。

## 3. V1 → anonymous V2 migration

1. 通常V1 writerを停止しexclusive migration権を取得。別tabの旧writerが残る場合は中止。
2. V1キーの**raw bytes**、本文/profile関連キー、source fingerprintを保存。既存V2 account保存は触らない。
   V1 cacheの過去の所有者は証明できないため、localとして保全しaccountへ自動採用しない。
3. backupのread-back検証後、pure lossless decoderで日時だけを型境界へ変換。
   ID/未知field/欠落とnull/期限/Routine実績/override/削除/purge/rankを維持する。
   重複ID・不正日時・孤立/cycle・不正rankは黙って修正せず診断で停止。
4. migrationId = source fingerprint + destination scope + schema versionから決定する。
   raw保存とcandidateの全field対応を検証。revision系列がV1にはないため、local所有の初期baseline
   revision 0を新設する（account系列の付替えではない）。V1に実際のV2 envelopeがあれば別検査で停止。
   local初期baselineはOutboxなし、History空。V1のメモリHistoryは復元不能と文書化する。
5. destination envelopeとmigration ledger（source/backup hash、migrationId、verified状態）を
   同じatomic commitへ保存する。WebはIndexedDB transaction、nativeは単一自己完結envelopeを置換。
   任意の別キーの完了markerに依存しない。書込み後の再読込・完全一致確認でreadyにする。
6. V1元データ/backupを残す。V1キーへの継続書込みを止め、削除は今回のmigrationから分離する。
   再起動時、ledgerが同sourceなら再importしない。sourceが違えば診断し上書きしない。

途中失敗: backup前はV1のみ、backup後commit前はV1+backupから再試行、commit後応答前は
destination ledgerから成功を判定する。破損candidateは採用しない。V1へ戻す場合は現在V2を
さらにbackupし、移行後編集の無言破棄を防ぐ。容量不足時もV1を削って空きを作らない。
既存planner/codecの検証を再利用するが、正規化/補完を無効化したraw入口を別途設計・テストする。

## 4. Login reconcile: sourceを移動せず明示的に適用

ログインは認証取得とscopeへのデータ採用を分離する。
localを不変snapshotとして確保し、accountの既存journal/Outboxは従来のaudit/preflightで復旧する。
その後accountのpending操作を通常の仕組みで照合・収束させ、authoritative remote snapshotを取得。
offline/receipt未確認ならreconcileは待機し、localを使い続けられる。
既存accountキャッシュを未送信のまま捨てたりremoteで置換してはならない。

pure planner入力: source scope/envelope fingerprint、target scope/snapshot fingerprint、
過去の成功reconcile対応表（存在する場合だけ共通ancestor）、明示したユーザー選択。
出力: per-ID分類、依存関係、保持/適用patch、conflict、削除集合、guard結果、immutable fingerprint。
Node IDの一致だけで同じ系譜とみなさない。初回には真のancestorがなく、二者比較になる。

| ケース | 推奨判定 |
|---|---|
| 同ID・全value同一 | account値を保持、操作0。revisionは比較/転記しない |
| cloud only | accountに保持。localにないことは削除意思ではない |
| local only active | 追加候補として明示確認。親/ID不在・tombstone・rank検証後に同ID追加 |
| 同ID・異なる値、ancestorなし | conflict。タイトル一致/updatedAtで推測しない |
| ancestorあり、一方のみ変更 | 変更候補を提示。source/target各baselineとの三者比較 |
| 両方変更 | 初期版はNode単位conflict。field自動mergeは行わない |
| soft delete / 片側のみtombstone | 削除候補として明示確認。欠落をdeleteにしない |
| target purged | 同ID復活禁止。local値をbackup/previewで保持し、通常Nodeとして再送しない |
| source purged、target active | purgeを自動移送しない。競合として別判断、破棄しない |
| 不正構造、未知field差分 | 保持・停止/明示conflict。category subtreeを部分採用しない |

Routineはroot/親/rule/history/overridesを一緒に検証。仮想Occurrenceは入力不可。
rankを無関係に正規化しない。同rank衝突、新規親、Routine system root ID差異は初期版では
構造conflictとして停止する。system rootを独立した重複Categoryとしてimportしない。
profile本文/Idea設定もscope資産として別resourceの確認対象にし、Nodeだけ移して失わない。

ユーザーはlocal/cloud値・変更/削除件数・競合・未採用項目を確認できる。
推奨初期UX: 「クラウドのみを開く（localは保持）」「選択項目を取り込む」「後で行う」。
同IDconflictはcloudを保持/明示local patchの選択。purgeは復活選択を出さない。
新ID複製やfield mergeを初期版へ暗黙導入しない。削除/大量変更は独立した確認が必須。
account切替前に未保存text sessionを保存/破棄/継続の既存契約で扱い、勝手に消さない。

## 5. Remote race、revisionとOutbox

local Outboxはlocal scopeの履歴として保持し、accountへのコピー/ack捏造をしない。
local Historyもaccountへ移さない。localのrevisionはlocalにのみ意味を持つ。
accountへの適用は**account baselineからの新しいApplication Command**で、既存account device/sequence、
revision系列とOutboxを使う。reconcileIdとsource/target fingerprintを永続receiptに関連付ける。
取り込み1確認を1 account Historyとするが、複数Nodeのremote全体atomicityとは別。

重要: 既存winner規則だけでは確認後raceを拒否できない。reconcile操作に限る厳密な
expected-record（不在も含むrevision/opId/value digest）を送信transaction内で検証する契約が必要。
同revision異opId/purge/新規衝突も拒否し、通常LWWへfallbackしない。
これは新しいFirebase直書き経路ではなく既存adapter/protocol/rulesの拡張として設計する。
既存復旧用の`expectedCurrent`と予測ack照合をtransaction内で行う部品は再利用候補。
復旧承認を偽装して呼ばず、reconcile専用の承認状態/receipt契約として接続する。
remoteでの検証がruleで強制可能か、trusted serviceが必要かは実装前に確定する。
クライアントのread→通常Commandだけでは代用不可。

大きなreconcileは対象ごとにremote受領を追跡し、全体atomic uploadを約束しない。
raceで途中conflictになったら残り送信停止。適用済み分をremoteで勝手にrollbackしない。
local原本とaccountのbefore snapshot/receiptを保持し、適用済み・未適用・競合をpreviewして
新しいbaselineから残りを再計画する。Undoは既存競合検査を通る場合のみ一操作で成立する。
strict guardはUndo/Redoにも維持し、競合による安全な停止を利用者に表示する必要がある。

## 6. Durable reconcile stateとfailure recovery

状態: captured → reviewed → locally-committed → uploading → verified / conflict / paused。
reconcile ledger、account envelope、History、Outbox、review fingerprintを同じatomic保存へ入れる。
source側markerとの二相commitを要求せず、account側ledgerを適用の正本にする。
sourceは変えないため、cross-store atomicityに依存しない。account別reconcileIdで冪等化する。
完了後sourceの「引継ぎ済み」表示を更新できなくてもaccount ledgerから再構成できる。
新source編集は別fingerprint/新planとなり、成功対応表で前回値をancestorに使用する。
Outbox pendingのsource値だけでなく、snapshot全体の関係を残す。

| Failure point | 再起動時の処理 |
|---|---|
| 認証成功、target準備前 | local原本を開く。account復旧を再試行、採用は未実行 |
| preview後commit前 | ledgerなしなら適用なし。現在baselineで再確認、古い承認を再利用しない |
| local atomic commit応答喪失 | account ledgerとreconcileIdを読んで二重Commandを防ぐ |
| remote送信応答喪失 | 同opIdをreceipt照合し、再発行しない |
| 部分remote適用/race | receiptに基づき停止状態を復元、再preview。原本保持 |
| logout/account変更 | scope+generation確認で送信停止。in-flightが完了しても旧accountにのみ記録 |
| 破損/容量不足/backup検証不一致 | readinessをerror/recovery-required、元snapshot保持 |

匿名local WALはremote receipt不要。ただしscope/schema/source/commit意思を検証してから
ローカル確定済み操作だけ復旧する。現在の`open`の無条件journal昇格を新用途へ流用しない。
通常Commandのfailure/commit pointを明文化し、未成功と報告した操作を再起動後に適用しない
atomic契約を推奨する。accountの既存production復旧/preflightはこの変更で緩めない。
backup/reconcile ledgerはraw本文を含むためログへ出さない。checksumは認証/暗号化ではない。

## 7. Logoutと隔離

推奨: 常に元のlocal scopeへ戻る。account Domain/History/Outboxをlocalへコピーしない。
localは前回のまま保持し、accountごとの取り込み済み/未取り込み状態を表示する。
account A → logout → local edit → account Bでは、BがAのstore/ledger/Outboxを参照しない。
localをBへ取り込む場合もB専用previewと明示選択が必要。Aへの採用をBへの同意とみなさない。
旧session/command/非同期callbackはgeneration fenceで拒否。scope切替前のdurable処理を完了/停止確認する。
アカウントデータの端末削除はlogoutとは別操作。未送信変更を持つcacheの自動削除はしない。
共有端末ではaccount cacheの保持がプライバシー課題となるため、閲覧認可とcache削除UXを別途決定する。

## 8. Destructive guard

移行はrecord/有効Node数/削除/purge数とraw field preservationを検証し、減少を自動承認しない。
reconcileは全targetを保持したpatchを原則とし、cloud-only除去は禁止。
明示soft delete集合と実減少集合の完全一致を確認し、#59のexact確認と同じ思想の
専用Application transition検証を行う。`allow`や全体をsoftDelete扱いにしてguardを避けない。
purge/復元はそれぞれ既存の専用Command契約が必要。reconcileにpurgeを含めない初期案を推奨。
確認後baselineが変われば再計画。local persistence CASとremote expected-record検証の双方が必要。

## 9. 実装順・#59への復帰

1. shared identity/coordinator/persistence metadataとreadinessを実装。cloudなしの全通常CommandをV2へ。
2. raw V1 backup/冪等移行とlocal recoveryを実装・故障注入で検証。
3. account既存復旧を維持したswitch/logout/generation隔離を実装。
4. pure reconcile planner/preview/ledger、remote strict期待値契約、receipt recoveryを実装。
5. #59入口をApplication readinessへ接続（authとは分離）。未ログイン一覧/ツリーで実機確認。

移行/同意UXの確定前に自動移行をproductionへ投入しない。#59専用store/Outboxは作らない。

## 10. 必要テストと受入条件

- Pure migration: 同ID/同名、未知field、missing/null、全日時、Routine、deadlineSortKey、sortKey、
  deleted/purged、本番由来176 records。無意味な変更0、invalid停止、raw backup完全一致。
- Migration fault injection: 全read/write境界、quota、破損、commit応答喪失、再起動/再試行、
  source変化、旧tab writer、identity生成競合、二重migrationなし。
- Scope/coordinator: fresh/no Firebase config、全CRUD/profile、History永続化、Undo/Redo、
  offline再起動、multi-tab CAS、generation、通常編集とtext編集のDomain一致。
- Reconcile table全分岐: 初回ancestorなし/前回ancestorあり、両側変更、同revision別opId、
  高remote revision、親/Category/Routine root/rank衝突、tombstone/purge、未知field差分、
  cloud-only保持、local-only追加、profile、全件競合ならcommitなし。
- Remote integration: review直後変更/不在ID出現/purge、厳密拒否、receipt再送冪等、部分成功、
  server拒否、offline/login失敗、auth失効、account A/B、reconcile中再起動。
- Guard: migration count減少拒否、exact削除確認、不正confirmation、Undo/Redo競合時無変更。
- #59: 未ログイン両入口、View、無編集0変更、save1History、invalid/破棄無変更、再起動、
  auth切替中session拒否、通常編集回帰なし。
- Web IndexedDB/複数tab、Android AsyncStorage、iPhone PWAのstorage eviction/再起動/容量不足を実機確認。
  storage自体の消去は復元保証できないのでbackupの端末外保存手順も整備する。
- 実装時: focused→related→full、TypeScript/lint/docs/diff、production export、実Firebase。
  今回は文書設計のみで追加prototype/test/runtimeはなし。既存成功734/skip25は前回結果であり再実行結果ではない。

## 11. 実装前の未確定事項

推奨案はあるが次を確定する必要がある:

1. 初回loginを「local保持・cloudだけ開く」既定にするか、毎回previewするか。
2. V1 cacheの所有者が不明な場合の取り込み同意文言、backup保存期間/削除/端末外export。
3. 同ID競合の明示local patchを許可する範囲。初期版はfield merge/new-ID複製/purgeなしを推奨。
4. remote strict契約のrules/trusted executorとtransaction上限。全体atomicityを要件にするなら別設計が必要。
5. account Historyは移さず、取り込み1操作のみとする仕様と、partial remote conflict時のUndo UX。
6. anonymous共有端末のprofile、logout時account cache閲覧/削除、native複数writerのサポート範囲。
7. account offline復旧待ちでもlocalを表示するUXと、active scopeを常に明示する表示。

今回は設計レビューで停止。移行/認証/store切替のruntime変更、Hosting deploy、#85/#59 Closeは行わない。
文書変更の`git diff --check`は成功。両IssueのOPENを読み取りで確認した。
