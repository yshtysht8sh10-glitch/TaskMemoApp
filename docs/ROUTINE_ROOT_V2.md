# Routineシステム領域のV2準備（#90）

## ユーザー操作と初期化

fresh Local V2 / fresh Account V2では、ツリーの「🔁 ルーティーン追加」を押す。
Applicationが管理領域を準備してからTask編集画面を開く。
「繰り返し設定」で日/週/月/年、間隔、開始日、基本時刻を指定して保存する。
準備後は既存「🔁 ルーティーン」領域の＋ → タスクも利用できる。
名前がRoutineの通常Categoryには特殊な意味はない。

ツリーのテキスト編集を開く時にも同じApplication準備を行い、@routineを利用可能にする。
一覧テキスト編集は所属を変更しないため準備処理を実行しない。
管理領域の準備はユーザーのTask内容と別のシステム初期化。編集を破棄しても領域だけは残る。
テキストsessionは準備後のDomainをbaselineとする。以降の構文エラー/破棄はDomainを変更しない。
無編集serialize→parse→planは変更0件。空の@routineはNode/refではない。

## 遅延準備を採用した理由

起動・ログインだけでNode/Outboxを増やさず、空のシステム領域がownership初回取り込み条件を
変えないよう、Routine入口またはTreeテキスト入口で初めて準備する。
V1原本をnormalize/修復する処理は呼ばない。
Account onboarding callableはgate/receipt専用のまま、Node作成を担当しない。

## Application / History / Outbox

TaskMemoV2ApplicationStore.ensureRoutineRootを既存mutation queueで直列化する。
既存rootが1件ならそのID/全metadata/revisionをそのまま使い、書込み0件。
欠落時だけ固定ID system-routineのCategoryを作る（categoryKind=routineRoot / parentId=null）。
既存の有効root兄弟キーを検証して末尾の新しいfractional sortKeyを割り当て、他Nodeを変更しない。
raw限定patchを既存applyCommandへ渡し、atomic persistence / revision / 普通のcreate Outboxを利用する。
root作成はHistory 0件・Redo保持。Task作成/テキスト保存は従来通り1ユーザー操作=1 History。
rootは新しいHistory targetsから除外し、旧Historyのroot replayでも領域を消さない。
Applicationの通常/import/text/ownership Commandでrootの削除、type変更、移動、改名、重複を拒否する。
large-decrease guard、tombstone/purged、ownershipの確認契約は維持する。

Localでは既存atomic storageに保存し、既存Local Outboxへ保持する。Local Outboxを直接Cloudへ送らない。
後のログインは既存ownership reconcileを利用する。account切替は別scope、generation確認を維持する。
この初期化はV1原本・移行backupを書き換えない。

## Account確認と同時作成

cacheにrootがないAccountは、adapter.connectのcompatibility確認後、readRecoverySnapshotでserverを確認する。
既存server rootとNodeを通常receive経路で受信してからprepareする。
cacheが空という理由だけでrootを作らない。確認不能/切替/ownership復旧中は保存せず停止する。
確認済みcacheにrootがある場合は既存編集同様、offlineでも領域を再利用できる。
初回Account領域の準備には通信が必要。

予約IDのroot createだけはrevision evaluator内でinsert-onlyにする。
同時作成でserverに有効rootがあればsuperseded acknowledgementとして全metadataをそのまま返す。
既存のFirestore transaction / receipt / audit / Outbox acknowledgementを使い、専用同期は追加しない。
clientはその受領rootを採用し、予測candidateの文字列順で上書きしない。
同じcreate以外のV2 winner/revision契約は変更しない。

## 安全停止

複数root、予約IDを使った通常Node、rootのdeleted/purged、不正parent/rankは自動統合・復活・修復しない。
server側の競合で同条件が見つかった場合も書込みを停止し、元データ/Outboxを保持する。
旧rootのIDがsystem-routine以外でも、1件ならそのまま利用する。
異なるscope由来の別ID rootを取り込んで2件になる場合はownership commitが停止する。
rootのID変換/子Nodeの付替えを暗黙に行わず、別途レビューが必要。
通常Memo同士を含む端末間の同時兄弟sortKey衝突は既存V2の順序契約に従い、初期化で自動修復しない。

## 回帰と実機確認

routineRootApplication.test.ts: fresh/restart/同時prepare、既存metadata、ID/tombstone/複数root、
atomic失敗、V1原本保持、通常Routine作成とUndo/Redo、@routine無編集0件、Account server確認、
同時createのreceipt、Local非送信、remote確認失敗/account切替を検証する。

DEV実機でfresh unsigned Local → ツリー「ルーティーン追加」→毎日Task保存→一覧の発生を確認。
Undo/RedoでTaskだけが戻りrootは残ることを確認。
fresh Accountでも同操作、同期済み、再起動/logout/re-login後のrootとTask各1件を確認。
Treeテキストの@routine追加と無編集保存、一覧のOccurrence除外も#59手順で確認する。
既存「Routine」通常Categoryは通常Categoryのままであることを確認。
実機PASSまで#90/#59をCloseしない。production配信は対象外。

## #90 通常UIの繰り返し設定（2026-10-06）

新規Routineは作成画面で「日」を初期選択として表示する。日／週／月／年、間隔、開始日を確認して保存する。未設定を保存可能な選択肢にはしない。既存のrepeatRule=nullは自動で毎日に変換せず、未設定と設定必須の説明を表示し、ユーザーが頻度を明示するまで変更を保存しない。

原因はEditorModalが新規Routineでもnoneを初期値にし、null ruleを許可していたこと。createNode／V2 codec／serializerで有効なruleが消えたのではなく、作成時からnullだった。serializerの「なし」とvalidatorの拒否は保存値に忠実であり、その安全判定は維持する。

`src/utils/routineEditor.ts`が初期選択と保存前のpure validationを担当し、EditorModalの手動保存／autosaveの両方で使用する。通常のApplication Command、History、durable Outbox、永続化経路は変更しない。既存の未設定Routineは通常UIでメニュー→編集→日／週／月／年を選択して保存する。これは同じNodeへの通常更新であり、削除・再作成やstorage初期化は不要。

回帰テストは新規初期値noneとnull保存をそれぞれ失敗確認してから修正。日／週／月／年についてApplication作成、V2 codec、再起動、通常UI用label、無編集Text plan=0、無編集commitで永続化変更なし、Undo/Redo、Outboxを検証する。前回のテストはvalid ruleを直接渡していたため、通常UIの未設定保存を捕捉していなかった。
