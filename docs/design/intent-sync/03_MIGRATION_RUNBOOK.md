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
|1 ローカル作業を静止|編集中draftを安全に保全。勝手に画面を閉じない|双方で編集を止める。旧アプリを診断目的で起動して同期を走らせず、独立read-only inspector/保存境界を準備|
|2 原本退避|各scopeのCommitted/Journal/Outbox/History/旧key/保護原本と版をraw export|PCも同じ。通常schema4 backupだけでは不足。二回readのhash/世代が違えばsnapshot安定まで再調査。端末内だけでなく別媒体へ保存し復元検証|
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
