# #95 ownership一括選択

競合一覧上部の「すべてローカルを採用」「すべてアカウントを採用」は
OwnershipReconcilePanelのReact choicesのみ変更する。commit/skip/reviewや
Domain/History/Outbox/ledger/metadata/IndexedDBへの書き込みを呼ばない。
既存最終確定のfingerprint、remote revision、atomic保存、削除確認は変更しない。

対象: conflictとpurged（本当に異なるprofileを含む）。same、add、applyは対象外。
追加・変更候補は既存の「衝突のない追加・変更候補をまとめて選択」で扱う。
local採用不可（purged、localなし、account削除済みからの復元）は個別ボタンと
同じ判定を共有し、「すべてローカル」でも選択しない。対象外件数を表示する。
account一括はこれらの確認項目も選択可能。既存選択を保ち、対象だけ上書きする。
一括後の個別変更と同一planの再renderは選択を保持する。
一括操作時は削除確認checkboxを解除し、既存の明示的削除確認を改めて要求する。
ボタンは縦に配置し、48px以上のtouch targetを確保する。

## 回帰

OwnershipBulkSelection.test.tsx:
- 120競合をlocal/accountへ一括選択 → 1件だけ逆へ → 再render → 既存commit引数を確認。
- same/add/apply対象外、purged local禁止、本当のprofile対象。
- 選択だけではcallbackなし、plan不変。実Application storeの永続化内容、History、Outbox不変。
- 選択後remote revision変更 → 古いplanのcommit拒否、部分保存なし。
既存ownershipApplication / ownershipReconcile / initialOwnership / presentationも実行する。

## DEV確認

DEV限定 `/dev-ownership-bulk` は同じ本番用componentへ120件のfixtureを渡す。
Application store/Firebaseを開かない。データは保存せず、最終確定もfixture説明で停止する。
「すべてアカウント」→数件だけlocal→各選択表示を確認する。
これは実componentの大量表示確認であり、実Firebase取り込み試験ではない。
実際のクラウド同期画面にも同じボタンが表示され、既存最終確定を利用する。
Production配信は行わない。IssueはDEV実機確認待ちでOpenを維持する。
