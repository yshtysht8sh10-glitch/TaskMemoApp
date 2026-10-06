# #59 Phase 7 実機受入手順

2026-10-06: #85 CLOSED、[iPhone最終PASS記録](https://github.com/yshtysht8sh10-glitch/TaskMemoApp/issues/85#issuecomment-6006974347)によりBLOCK解除。#59はOPEN。これは受入計画であり、#59の実機PASS記録ではない。

## 環境・記録

- DEVのみ https://taskmemoapp-dev.web.app 。設定→アプリ情報でHosting、Release、Commit、Display modeを記録。開始時の期待Releaseはissue85-order-input-20261006-0918。後日配信が更新されれば実際の値を記録。
- iPhone Safariと同DEV originのstandalone PWAを区別。production命名projectの旧issue85-iphone previewを試験先にしない。
- 最初は未ログイン。後半は検証用DEV accountのみ。実production snapshotを実Firebaseへimportしない。
- 保存済み状態をデータを書き出すで保護。exportedAtを除き、Node ID/内容/親/sortKey/期限/metadataを比較できるようにする。
- ケースごとに日時、端末/OS、origin/release、local/account、入口View、操作、期待/実際、PASS/FAIL/未実施を記録。エラーは原文・スクリーンショットを残す。失敗をstorage削除で通さない。
- 手動で見えないHistory/Outbox/revision原子性は自動テストとDEV診断で補完。UIが成功しただけで内部metadata維持までPASSにしない。

## 1. 未ログイン入口と無編集保存（最初のゲート）

検証用Node: 無所属Task、Category「仕事」→子Category「開発」→Task、Idea、本文付きMemo、異なる期限、完了Taskを通常UIで用意。Ideaが無効なら設定で有効にする。

1. 未ログインで通常編集・端末保存ができることを確認。
2. 一覧→テキスト編集を開く。クラウドログイン要求なし。短いrefが表示され、期限見出しをCategory扱いしない。
3. 無編集保存後のexportでNode ID/内容/期限/親/並びが不変。
4. ツリー→テキスト編集も無編集保存。@root/@routineはシステム領域でありNode追加されない。
5. reload/PWA再起動で保存済みNodeを保持。未保存draftの復元は非対応で、閉じる際の破棄とは区別。

無編集保存のchanges=0、History/Outbox不変は自動回帰でも必須。

## 2. 基本編集・IME・Undo/Redo

1. 日本語IMEで改名・本文入力。変換確定、改行、カーソル移動、選択、貼り付けを確認。
2. 複数既存行のタイトル/本文を変更。変更セルの赤系文字＋下線、列ラベルを確認。
3. refなしで `Task | Phase7追加 | 今日 | 未完了` を追加。既存refは削除しない。
4. 保存→通常UIに反映。既存ID/createdAt不変、新規行のみ新ID。
5. Domain Undoを1回→この保存全体を戻す。Redoを1回→全体を再適用。
6. reload後にも保存済みDomainと永続HistoryのUndo/Redoが使えることを確認。editor内文字Undoとは区別。
7. 同名Nodeを2件作って片方だけ改名し、refによる対応が維持されることを確認。

## 3. TreeとListの構造

1. TreeでTask行をCategory配下へインデント移動→parent変更。兄弟行を並べ替え→通常ツリー順へ反映。
2. Listで既存行のインデントのみ変更→parentId/Category/Routine所属は不変。
3. Listで期限編集→通常一覧groupに反映。groupや位置をCategoryへ変換しない。
4. Listの並べ替えはdeadlineSortKeyの契約に従い、TreeのsortKeyを無関係に変えない。
5. @root/@routineをCategory名として作らない。Listからシステム領域の所属変更は不可。

## 4. Validation・破棄・削除安全性

1. 期限を `来週くらい`、`2027/2/30`、重複ref、不明ref、Memoを親とする階層へそれぞれ変更。
2. 行/セル/理由を表示。1/10/10/など入力途中の警告が入力を妨げない。エラー中は全件保存不可。
3. 正常な変更とエラーを混在→保存しても正常行だけが部分保存されない。
4. エラーありで閉じる→続ける/破棄で脱出できる。破棄後のexportはbaseline不変。
5. エラーなし変更で閉じる→続ける/保存して閉じる/破棄を確認。
6. 単独の行削除→削除対象確認→soft delete。Undoで復元。purgeにはならない。
7. 複数行削除/大量変更→概要・対象確認。キャンセルでDomain不変。大量ref除去＋新規化を推測して通さない。
8. deleted/purged/非表示groupのNodeを、textにないことだけで削除しない。既存guardを迂回しない。

## 5. 期限・Routine

1. 今日/明日/今週/今月/期限なし、絶対日付、年付き日付、時刻付き日付を正式許可値で編集。
2. 過去のduePreset=today Nodeを無編集保存→dueAt/duePreset不変。
3. 保存確認中に時間が経過しても相対期限はsession固定日時/timezoneで解決した値のまま。日跨ぎ/他timezoneは境界検証として別記録。
4. Treeで通常Taskを@routine配下へ移しdailyを明示→Routine化。
5. 移動だけ、rule削除だけ、ruleを残したまま領域外移動はエラー。領域外移動＋rule明示削除で解除。
6. Routine実績/期限overrideを持つNodeに無関係な改名→metadata保持。
7. 一覧の当日/overdue Routine表示は編集対象外・案内あり。除外行が削除されない。仮想Occurrenceを実Node化しない。

## 6. Read OnlyテキストView

1. 一覧/ツリー双方から開く。入口のgroup/階層/順序を反映。
2. 初期はタイトルのみ。締め切り/本文/Task・Idea/完了/カテゴリ/Routineの6項目を個別ON/OFF。
3. 項目名ON/OFF。追加情報はタイトル直下の箇条書き。
4. コピー→別のメモへ貼付し全文一致。ref/内部ID/sortKey/revision/編集syntaxの自動露出なし。
5. Read Onlyの操作でDomain/History/Outbox不変。

## 7. ログイン・実同期・競合

1. 未ログインのテキスト保存→再起動保持→DEV login。#85のownership確認経路を通し、匿名Outboxを直接送信しない。
2. 取り込み後に同期済み、対象Node/ID保持を確認。logout/re-login後に重複/不要な再取り込みなし。
3. login済みで複数行をテキスト保存→同期済み→別DEV端末/Webに反映。
4. Aでeditorを開き、Bから対象Domainを変更・同期。Aの保存は競合停止し入力を保持。破棄/再読込後に再編集。
5. 同accountで通信断→テキスト保存・端末保持→再接続→既存Outboxで同期。
6. editor中logout/別account切替で旧sessionを別scopeへcommitしない。
7. native Androidを対象に含める場合は、戻る操作、IME、キーボード、AsyncStorage復元も実機で確認。未実施をiPhone結果で代用しない。

## 8. 自動回帰・文書完成・終了条件

- 本番由来fixtureをローカルのpure/APIテストで使用。tree/list無編集parse→plan→saveが差分0、History/Outbox不変。
- ID/未知field/deadlineSortKey/routineHistory/overrides/tombstone/purged/revision維持、remote競合、atomic失敗、History/Outbox/再起動を回帰。
- 全test、TypeScript、Lint、diff-check、Web export、syntax/reference文書同期を実行。環境依存skipを実施済みと扱わない。
- TEXT_FORMAT.md、TEXT_FORMAT_REFERENCE.md、TEXT_WORKSPACE.md、TEXT_FORMAT_DEVELOPMENT.mdと実機挙動を照合し、その都度更新。
- Phase 7結果を#59へ報告してユーザー確認を待つ。自動Closeしない。production deployは別途指示が必要。

現在: BLOCK解除、上記Phase 7は未実施。#85のPASSを#59のPASSへ流用しない。

## 共通フォームUXゲート

実機受入の前に [FORM_TYPOGRAPHY.md](FORM_TYPOGRAPHY.md) のSafari/PWA確認を行う。
#85ログインを含む共通入力をDEVで確認し、PASS後に残りの受入を進める。

## #90 Routine入口の前提確認

fresh Local／fresh Account双方でツリー「ルーティーン追加」→繰り返しTask保存を確認する。
空の管理領域が準備されるが、Task保存だけが1 Historyとなる。
[ROUTINE_ROOT_V2.md](ROUTINE_ROOT_V2.md)の実機チェック後にRoutine受入を実施する。

## Phase 7のtraceability化
[Spec ID matrix](TEXT_WORKSPACE_TRACEABILITY.md)の自動項目はsuiteで検証し、ユーザーが全件を再度目視する必要はない。実機ではTW-DEVICE-001〜005の境界に集中する。iPhone共通typographyはIssue最新コメントでPASS済み、Routine以外の動作確認も報告済み。古い「Phase 7未実施」は履歴であり、現在の残りはRoutine実機確認と今回suite結果の受入。自動成功を実機成功の代用にはしない。#59はOPEN。
