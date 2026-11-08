# 03 旧writer終了・移行A/B比較・iPhone/PC切替runbook

**将来の実行計画であり、今回の操作指示/実行承認ではない。** 本番データ読取/Rules/Functions配備/移行/配信はそれぞれ別途承認。旧アプリ終了と旧データ放棄を厳密に分離する。

## 1. 二案の比較と推奨

|観点|A 通常読込時に逐次変換|B 明示的な一度限り移行|
|---|---|---|
|データ消失|loaderの既定値/旧History消去、複数readerの暗黙writeに紛れやすい|source不変・対象一覧・copy/verifyで監査しやすい|
|iPhone/PC|一見更新だけで済むが、一台の進み方でmixed writerが発生|二台を準備する時間は要るが切替境界を管理できる|
|offline local|後で現れた旧操作を通常更新と混同しやすい|端末ごとinventoryと後発退避経路を定義できる|
|Firestore整合|Nodeごとの逐次変換と旧receipt/Nodeの分岐が並存|freezeしたsourceを全件照合しactive generationを最後に切替|
|実装複雑さ|単体converterは小さくても、毎回の再開/互換/競合が恒久化|移行制御/バックアップは重いが、通常新同期から分離できる|
|rollback|どこまで変換したか分かりにくく旧版への戻しが危険|sourceとtargetを別世代に残し、切替前後の復旧を分ける|
|保守|多世代mixed writeの状態空間が増える|旧read/import adapterは維持し、old writeは終了できる|

**Bを選ぶ。** 新intentが必要とする属性因果版を、旧Node全体revisionから毎回正しく推定できないため。Bでも旧backupや後発localを読むadapterは残す。旧rawは旧形式のまま保持し、変換したbaseline/intentと来歴で結ぶ。小さなメモリ内のDate/default補完は互換readerの責務で、暗黙のCloud移行ではない。

## 2. 保存/変更の境界

そのまま保持: 全元Node raw、profile、旧Committed/Journal、保護原本、全Outbox/History/receipt、旧backup、scope/ID/opId/復旧plan、unknown fieldと検証不能raw。既存sourceを新形式で上書きしない。

変換して新世代へ追加: 読めるstateをbaseline、属性初期headとsourcePresence、確認済み旧intent、実行可能Historyの属性補償情報、projection、source→target mapping。旧形式由来でも元ID/日付/期限/retained/取消状態を保持。確定できない操作はraw付きlegacy-unresolvedで、勝手にOFF/activeへ解釈しない。

数値baseRevisionの一致だけ、値がたまたま同じことだけでは、旧操作が観測した因果基点の証明にならない。履歴のA→B→Aを区別する。

## 3. 必要なcontrol plane（提案のみ）

移行manifestにUID/project、migrationId、source世代、target世代、参加端末/actor/origin、各source hash/件数、lease epoch、copy/verify進捗、端末ready、未解決分類数、承認記録を持つ。内容を含むraw/diffは公開logへ出さない。

`PREPARE → FROZEN → COPYING → VERIFIED → ACTIVE → LEGACY_READ_ONLY`。各遷移は前状態/manifest版をserver CASし、途中失敗から同じmigrationIdで再開できる。二端末が同時migrationを開始してもlease epochの勝者だけがcopy/switchできる。

lease失効は移行leaderの権限だけを失効させる。FROZENのwriter fenceは永続し、タイムアウトで旧writerを自動再開しない。新leaderは同じmanifest/source hashを検証してepochを取得する。

一つの巨大transactionで全件移行しない。byte/件数上限付きcreate-only chunk、各source identity/hashで冪等化、target存在時は内容検証。最終control pointerだけを小さいtransactionで切替。古いleaderの後続writeはlease epochで拒否。

## 4. 旧writerの拒否

- clientの表示SHAだけでなく、server制御のactive generation/protocol/capabilityで受付を限定する。user-agent/自己申告device ID/build文字列は権限証明ではない。
- 旧V1/V2 pathsへのcreate/update/deleteを本人アカウントのfreeze以降はRulesで拒否する設計。新generationのprojection/field state/結果はclient read-only、intentも認証付きserver受付経由。現Rulesはprotocol1/2の固定分岐なので将来の変更が必要。**今は変更しない**。
- Rulesが拒否しても、古いPWAのlocal edit自体は発生し得る。permission-deniedでOutboxを消さず、rawと未同期状態を残す。旧writerが新pathへ通常書込できるような互換の抜け道を設けない。
- Functions/MCP、管理script/運用job等のAdmin writerにも同じfreeze/generation検証を実装・配備する必要がある。RulesはAdmin SDKを制限しない。[Firebase公式](https://firebase.google.com/docs/firestore/security/rules-conditions)。既存コードを更新しないままgateを変えて完了とはしない。
- Auth再ログイン/全token失効だけで移行したことにしない。基本案で本人のログイン方法変更は不要だが、必要性が後で判明した場合は別の認証変更設計として承認を取る。
- 旧Node/receiptは通常編集を止めても、承認されたsource読取/import用に残す。old appの継続利用/同期は保証しないが、データの救出経路は保証対象。

## 5. iPhoneとPCの切替順序

以下の「確認」は将来の承認された観測/実装工程で行う。今回、ユーザーに再ログイン/初期化/強制同期を要求しない。

|順|iPhone|PC/サーバー/共通の確認と停止条件|
|---|---|---|
|0 許可と準備|通常PWA/Safari/起動originと表示版を記録|PC全tab/window/originを列挙。二台でも複数writerあり。本人UID/environmentを照合。収集目的/範囲/保管先を承認|
|1 ローカル作業を静止|更新/離脱前に開いている旧画面のdraftを非破壊退避、本人確認でlocal確定。勝手に画面を閉じない|節10に従い全tabの入力/IME/timer/保存/通信を回収する。安全取得不能なら停止。read-only inspectorだけで画面内draftを回収できたとしない|
|2 初期原本退避|各scopeのCommitted/Journal/Outbox/History/旧key/保護原本とdraft bundleをexport|通常schema4 backupだけでは不足。別媒体へ保存し復元検証。これは準備用copyで、二回read一致を排他証明にしない。最終captureは節9・10のbarrier後|
|3 compatibility準備版|原本退避前に旧Store.openのHistory消去経路を実行しない準備版へ|startupの前段でrawを保護しmigration read-onlyにするbuildが必要。PCも実行entry/commitを確認。未更新/不明端末なら進めない|
|4 server freeze|旧Outboxは送信を強要せず保持|旧write拒否＋Admin writer停止/ドレイン。freeze境界前に受理されたreceiptを含むserver snapshotを確定。二台のrawを再採取/照合し、変更があればinventoryへ戻る|
|5 source突合|旧localのみのNode/操作も対象|Cloud+二台localの全source inventoryを固定。匿名scope・同名別ID・旧backupを別sourceとして保存。updatedAtやNode全体LWWだけで勝者選択しない|
|6 shadow生成|新ローカル世代は旧DB/keyを上書きせずstaging|baselineと新intent/競合/保留Historyをtargetへcreate-only。旧rawとのmappingと件数/hash/意味検証。receiptはapplied/supersededとも保存|
|7 全件検証/ready|新read-only projectionを確認|Node/実績/履歴/操作/候補の保全、両端末のmanifest一致、処理失敗0。曖昧な未同期操作は原則切替を止める。保留のまま切替は利用者の別明示承認が必要で「完全同期」と呼ばない|
|8 active切替|新contractのwriter開始許可を受けるまで旧sourceを書かない|同一gate transactionでactive generationを切替、旧write禁止は維持。両端末はpointer/manifestを照合して新writerへ。片端末失敗時は未準備writerを起動せずread-only復旧|
|9 検証と保持|表示版/既存Node/実績/同期statusを通常操作で確認|操作受領・反映・候補を別確認。旧source/raw/旧receiptはread-onlyに保持し、今回の移行に削除工程を含めない|

Outbox=0を強制的な事前条件にはしない。旧契約で送るとsupersededで消える操作があり得るため、**全原操作が退避・分類・写像されたこと**を条件にする。Outboxが空でも、receiptだけにある未反映intentがないことの証明にはならない。

端末がoffline/紛失/更新不能なら、その端末の未同期情報を見ずに「二台確認済み」としない。基本は切替を止める。例外運用が必要なら、その端末source未取得のリスクと後発保全手順を別途承認し、全データ保全完了と宣言しない。

## 6. legacy sourceの分類と二重適用防止

- `sourceRef={project, uid/localScope, origin, sourceKind, sourceIdentity, rawHash}`を保存。Nodeとreceiptのsource対応、複数端末で複製された同一opIdの出所も記録する。
- 同一account/opId/同一不変payloadは一つの論理操作に対応させ、複数source参照は消さない。同じopId異payloadはcollisionとして両原本を保護し停止する。
- current Node baselineは全stateの検証済み断面であり、過去全intentを表すものではない。古いapplied receiptを全部再適用すると既に取り消された完了等を復活させる。already-represented / provable-unapplied / unresolvedへ分類する。
- exact before/baseがHistory.target等から証明できる場合のみ属性intentに変換。旧type=updateのfull payloadだけでbody/完了/配置の変更意図を全部発明しない。type=complete/uncompleteでも対象・日時・基点の検証が必要。
- 新intent IDはmigrationId＋元論理op identityから安定写像し、元opId/ACKは不変rawのまま保持する。対応表なしの新UUIDで再送して二重適用しない。
- localにだけあるNode/別scopeのNodeを同名だから一つにまとめない。ID衝突や匿名→account取り込み途中は来歴/ownership ledgerと利用者確認で扱う。
- legacy DTOはaccepted receiptではなくsource factとして保管する。受領済み旧操作を新受付へ無条件再送しない。新acceptedとold receiptの意味を区別する。

## 7. 後で旧PWAが開いた場合

旧writeは拒否されるがデータは消さない。新しい観測専用入口で追加rawを退避し、既migration manifestと差分検出、未同期操作の意味と既受領/重複を照合して限定importする。新baseline/actorを初期化して上書きしない。ユーザーへcache削除/再インストール/全体復元を案内して未同期情報を失わせない。旧データを読む機能はold app support終了後も維持する。

## 8. 実データ確認と停止条件

本番の件数、Journal状態、二台の版、旧receipt completenessは未確認。実行段階では承認された範囲だけ読む。原本不在/不一致、未分類raw、historyの黙示消去、未知schema、profile欠落、missing base、端末未確認、対象外writer稼働、容量不足、mapping不整合は停止条件。保全できなかったデータを件数の辻褄合わせで除外しない。

## 9. R3: 不可分fence・freeze barrier・seal

本節は節3〜5の抽象手順を強化する規範。照合のための二度読みは変更検知の補助であり、排他成立の根拠ではない。account controlは`{activeGeneration, phase, fenceEpoch, migrationId, leaderLease, acceptedHead, publicationHead, sealedManifestHash, readySetVersion}`を持ち、activation/rollbackも同じcontrolのtransactionで直列化する。

### 9.1 PREPARE開始からFROZEN成立まで

1. 本人の準備開始後、二台の対応版で新入力/commandの受付を閉じる（既存draftの回収専用local保存はcapture前だけ許可）。同時にserver controlを`PREPARE`、fenceEpochを更新し、旧/新の通常受付を止める。旧path direct SDK書込も拒否する。ローカル未取得/旧tabがある間はFROZEN/readyに進めない。
2. 全writerを列挙: 旧SDK、通常受付/reducer、Functions trigger/queue/retry、MCP/Admin script、復元/backup import、profile/settingsとlocal writer。新しい仕事の投入を止め、既受理/実行中の仕事をoperation identity単位で列挙する。ネットワーク中止だけをcommit中止の証拠にしない。
3. serverの全対応writerは**書込と同じtransactionでcontrol/phase/generation/epochを読み検証**する。gateを一度読んでから別transactionで書くのは禁止。freeze transactionと競合した旧transactionはretry時にphase不一致で書込不可。freezeより先にcommitしたものはsource集合に含める。triggerは配送されても停止phaseを見て正本へ書かず、durable未処理として記録する。
4. controlを参照しないAdminはRulesを迂回する。該当credential/workerの実書込権限を停止し、キュー再試行/定期jobも停止、全進行中処理の終端と権限停止の有効化を監査証跡で確認する。確認不能なら移行停止。先行commitが後で到着する可能性を二回readで打ち消さない。
5. 準備対象端末のcapture barrier（節10）とserver drainが揃ったらFROZENへCAS。server receiptの受領集合と未処理集合を固定し、accepted済み未反映もsourceとして取り込む。旧reducerを無理に走らせてドレイン完了にしない。書込権限/workerの停止が維持される限りsourceは不変。

移行処理自身にも旧source書込権限を与えず読取専用とする。sourceの全collection/key/scopeを固定catalogに列挙し、安定したdocument ID順に終端までpage scanする。固定集合のID/hash/件数/tree rootとpage境界を記録し、取りこぼし/重複/途中page失敗なら未完了。receipt/非表示/削除/profile等をNode一覧だけで代用しない。全source集合の登録終了まではCOPYING/VERIFIED不可。

### 9.2 targetをsealする

migration chunkは`migrationId/targetGeneration/leaderEpoch/phase=COPYING`を**target書込と同じtransaction**で確認しcreate-onlyにする。sourceはfrozen catalogに限定し、target membership catalogと同transactionで登録する。巨大データはchunk化するが各chunkでfenceを外さない。

全chunk完了・01節8の機能的照合・失敗0・未分類0・通常成功を妨げる未解決0を満たして、immutable検証証明を作る。証明はsource catalog root、target全resource/操作/履歴/設定/候補のrootと件数、変換規則版、意味照合結果、完了chunk集合、server fenceEpoch、各端末capture hash、migrationIdを束縛する。

seal transactionはcurrent control/leaderEpoch/phase、catalog headと全chunk完了証明を検査し`VERIFIED`と`sealedManifestHash`を設定する。同transactionを読む全chunk writerは、その後同じepochでも書込不可。seal直前にchunkがcommitしていたらcatalog headが変わるためsealが失敗し再照合へ戻る。seal後のsnapshot/member/rootは不変で、新intent用のmutable projectionとは分離する。

target変更が必要ならsealを修正しない。control CASでreadyを全失効させ、新attempt/target snapshotを発行してCOPYING→再照合→新sealへ進む。旧snapshotは証拠として保持する。epochはlease再取得、attempt変更、freeze/activate/rollbackで更新し、古い処理はすべて拒否する。

### 9.3 readyとactivate

各端末readyは`{installation, tab/origin roster, scope, captureEpoch, localMutationSeq, draftRoot, sourceCatalogHash, targetSealHash, controlEpoch, readySetVersion}`に束縛する。入力/保存/ネットワークcallback/新origin発見/端末再起動/lease喪失で失効する。serverへ失効通知できないoffline状態では端末をread-onlyのままとし、過去readyを再使用しない。

activation前の最終handshakeで双方のlocal barrierを維持したfresh readyを得る。activate transactionは現phase=VERIFIED、epoch/leaderLease/manifest hash、必要二台全originのfresh readyとreadySetVersion、失敗/未分類/未解決条件、source freeze証明を再検査し、active pointerと新writer capability/phase=ACTIVEを同時更新する。新clientはcapture lockが生きており自分のreadyと同じsealのactivationを確認して初めて編集可能になる。オフライン旧端末は能力を得ない。

activateと通常受付は同じcontrol docで直列化し、境界前は新操作拒否、境界後はactive generation/epochの能力を検証した新操作のみ受理する。新publicationはsealed baselineを祖先に持つ。移行snapshotへの後続書込は引き続き禁止。

serverのreadyとlocal入力の間に分散atomic transactionはない。保証条件は、参加済みの全local writerでbarrierが維持され、旧tab終了/原本退避が確認でき、非参加旧writerはCloudへ書けないこと。未知tab/ローカルwriter停止を証明できない場合は通常成功に進めない。誤って切替が先行しても、local epoch不一致端末は編集権を得ず、その後発sourceを保護して限定importし、全件移行成功の判定を取り消す。

### 9.4 rollbackと失敗再開も同じfence

rollback要求はactive controlをCASして`ROLLBACK_FROZEN`へ進めepochを更新し、新受付/reducerを停止する。9.1と同じbarrierで、freeze前に受領した全intent、未処理/実行中/retry、二端末のdraft/pending/awaitingを固定する。その後にのみ「新操作なし」を判定する（04節8）。判定後の新受付はphaseで拒否されるため、判定とpointer戻しの間に操作が入らない。

activate/rollback/resumeは同じphase/epochのCASを競う。一方の遷移だけが成功し、負けたleaderは観測専用に戻る。rollbackで旧writerを再許可しない。旧世代を復旧表示するときも新しいcontrol epoch/activation証明でread-onlyに選択し、過去のcapability/publicationを再有効化しない。

crash時は永続phase/epoch/catalog/receiptを読み、同migrationIdの新epochを取得する。freezeを自動解除せず、完了chunkのhashを検証して再利用する。seal済みなら書込再開せずverify/readyを再取得、activation済みなら二重移行せず02節9のcheckpoint照合へ。source変更やseal不整合は新attemptで全ready失効・再照合。時刻/lease期限切れのみで成功扱いにしない。

## 10. R4: 二端末の編集確定・静止・最終capture

### 10.1 更新前の旧画面で行う回収

本人に各画面の未確定タイトル/本文/IME、Quick Add、Text workspace、常設メモ、設定選択を確認してもらう。更新・閉じる・blurより前に、**入力の原文と編集対象/基点を非破壊退避**する。既存の安全なlocal保存を選ぶ場合も、原文退避後に保存結果を照合する。Cloud強制flush/Outbox空化はしない。旧画面で安全な回収手段がなく、保存先も確認不能ならその場で停止する。

保存成功後にも入力が増え得るため、saving中の原文とその後の原文は別revisionのdraftとして回収する。Quick AddやText planの未確認内容は勝手に実行しない。本人が回復可能draftとして残すことを選んだ場合、両端末で読める回復UI/原文照合と個別承認が必要で、通常の全件移行完了とは区別する。

旧tabは協調lockを実装していない。準備版のlockやinspectorで停止したとみなさず、回収/初期raw退避後に本人が全該当tab/windowの終了を確認する。unmount時保存もあり得るので、その終了後の永続rawを再取得する。iPhoneのPWAとSafariは、同じorigin表記でも別storage contextの場合を区別する。存在未確認contextがあればready不可。閉じる/更新を自動実行する手順ではない。

### 10.2 準備版のcapture barrier

各installation/storage contextでは全tab協調の排他lockとdurable `captureEpoch/phase/localMutationSeq`を持つ。Web Locks等を使用できても、全writerが協調していなければ十分でない。非対応環境は単独tabのwriter停止を確認できる別手段を設計/検証し、できなければ停止する。

1. input受付を閉じ、composition完了を確認し、全editorにdraft captureを要求。timerを列挙してautosave/blurを一度だけlocal確定するか、原文付きdurable pendingとして隔離する。単なるtimer cancelで入力を捨てない。
2. local command queueは新規受付を閉じて既受付分を完了/永続保留へ。`Store.whenIdle`だけでは将来timerや画面draftを待てない。settings writer/復元/候補採用/通知副作用も対象にする。
3. sync send/retry/subscriptionを止め、進行中op IDと送信payloadを記録する。受理有無が不明でも再採番/削除せずpendingに保持。callbackはepoch付き隔離inboxへ耐久保存し、freeze中のDomain/Historyを変更させない。
4. すべてのlocal書込は直前にcapture phase/epochを同じ保存transactionで検査する。旧phaseの遅延commitは失敗して原commandを保持する。AsyncStorage等で多key atomic fenceを保証できないwriterが残るなら、新保護層で直列化・ドレインするまでready不可。
5. lockを保持して全key/DB/scope/source集合を列挙し、最終raw＋draft＋pending＋隔離inbox＋設定のsnapshotとhashを生成。外部媒体へ退避して読戻す。Cloudは9.1 barrier後のsnapshotを束ねる。capture後もlockを保持する。

### 10.3 静止条件とready取消

readyには、入力/IME未回収0、未登録timer0、未処理local保存0（durable隔離済みを除く）、正本変更可能callback0、未分類送信0、未観測storage context0、capture後localMutationSeq不変、全source列挙完了とbackup読戻し成功を要求する。Outbox/awaitingは0でなくてよいが、全件のidentity/意味/移行先が照合済みであることが必要。

入力再開/追加入力、timer発火、保存/ACK/受信callback、storage更新、scope/認証切替、tab追加、再起動のどれかを検出したら**readyを即座に失効**しcaptureEpochを更新する。callbackが原本不変でも隔離集合が変わればcapture hashを更新する。旧snapshotは消さず、queue再ドレイン→全source再列挙→backup更新/読戻し→新seal対応→fresh readyを取り直す。silentに同じready tokenを延命しない。

再起動後は失効readyのままread-onlyでraw/draftを復旧し、未確認draftを初期化しない。安全に回収不能なmemory-only入力があった場合は欠落の事実を明示して停止し、「rawは同じだったから成功」としない。
