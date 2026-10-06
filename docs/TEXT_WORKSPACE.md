# テキスト編集 / テキストView — Phase 5–6

仕様一次情報: [Issue #59](https://github.com/yshtysht8sh10-glitch/TaskMemoApp/issues/59)の本文と
[システム領域・Routine追加仕様](https://github.com/yshtysht8sh10-glitch/TaskMemoApp/issues/59#issuecomment-5952680668)。
書式・escape・許可値は[Text Format](TEXT_FORMAT.md)と[生成した定義一覧](TEXT_FORMAT_REFERENCE.md)。

## 編集する

クラウドログインは不要。共通V2 Applicationの初期化・復旧が完了していることが必要。
未ログインでは通常編集と同じ端末Local scopeへ、Domain/History/Outboxをatomic保存する。
匿名Outboxをログイン先へ自動送信しない。server確認済みの空Accountには、安全条件を満たす初回変更を
Accountの新操作として取り込む。既存データ・競合・曖昧な変更がある場合は確認画面を表示する。
保存先、再ログイン、復旧は[共通V2実装仕様](LOCAL_V2_IMPLEMENTATION.md)を参照。

一覧・ツリーのツールバーから「テキスト編集」を開く。入口はsessionで固定される。

- ツリー: 折り畳みにかかわらず全有効Node。無所属を先頭とする既存ツリー順・Category階層を維持し、
  Routine定義を`@routine`へまとめる。完了を非表示にしていても含める。削除済み・purgedは含めない。
- 一覧: 現在の表示設定のgroupと順序を使用（折り畳みgroupも含める）。非表示groupは対象外。
  Routine投影は除外し件数を案内する。期限見出しはCategoryとして編集syntaxへ出さない。
  既存parentIdとRoutine所属を保持し、並び変更はdeadlineSortKeyのみ。

入力は通常の複数行テキスト欄。下の「構文・変更表示」は入力を180ms後に検証・反映する。
入力欄と強調表示を分け、日本語IME・カーソル・文字Undoの標準動作を保つ。
各セルには列名を付ける。システム領域は太枠・▣・「システム領域」というラベルで区別する。
色だけに意味を依存せず、Light/Darkの既存themeを使う。

- 既存セル変更: 赤系文字＋下線（syntax色より優先）。
- 新規行: 「＋新規」。refを付けず`Task | タイトル ...`等で追加。
- 所属・行順の変更: 「↕ 所属・並び変更」。
- 削除行: 「−削除予定」に元refとタイトルを表示。保存前はDomain未変更。
- エラー: ⚠、背景と枠、行/列/理由。セル変更とは別の表現。

許可値セルにカーソルを置くと候補ボタンを表示する。選択した**セル全体**を置き換える。
期限の絶対入力は`4/25`、`2027/4/25`、`4/25 17:00`等。
`1`、`10/`など入力途中は警告するだけで入力を妨げない。自然言語を推測しない。

## 保存・閉じる

「保存」は現在の入力をstrictにprepareし、1件でもエラーがあれば全件保存しない。
削除・大量変更では件数・削除対象・変更項目を確認してから保存する。
確認後にDomainが変わった場合はcommit側で拒否され、入力は保持される。
確認中は入力を固定する。「編集を続ける」で戻る。確認した文書と現在の入力が異なる場合も保存を止める。
期限の解決時刻/timezoneはsession開始時に固定し、確認後も再計算しない。
保存エラー・容量不足・remote競合でも入力は消さず再試行または破棄できる。
保存成功後は画面を閉じる。ローカル永続化が成功してから閉じ、Outbox送信は既存同期経路に任せる。

閉じる/Android戻る:

| 状態 | 選択肢 |
|---|---|
| 変更なし | そのまま閉じる |
| 未保存変更あり・エラーなし | 続ける / 保存して閉じる / 破棄して閉じる |
| 未保存変更あり・エラーあり | 続ける / 破棄して閉じる |

破棄は未commitのsessionを捨てるだけ。Domain rollbackではない。
ブラウザの再読み込みには未保存の警告を表示する。未保存draftの再起動復元は初期版対象外。
端末保存後のDomain / History / Outbox復元は既存Application永続化を使う。
Domain側のUndo/Redoは1保存全体を1操作で戻す/再適用する。入力欄Ctrl+Zとは別。

## Routine仮想Occurrenceの調査と採用方針

実装元: `domain/routine.ts`、`deadlineView.ts`、`completionHistory.ts`。
永続化されたTaskのrepeatRuleから当日の発生を判定し、routineHistoryの日付キーが完了を抑制する。
routineDueOverridesは日付別の期限上書き/取消。基本dueAtは定義側の時刻テンプレートとして使われる。
過去の未完了日は`routine-overdue:<sourceID>:<date>`という仮想IDとroutineSourceId /
routineOccurrenceKeyを持つコピーを組み立てる。今日はsource IDでも期限が導出値なので、実Nodeの
dueAtとは異なる。完了ViewのRoutine履歴もroutineHistoryから構成される表示項目で別Nodeではない。

**初期版は一覧のRoutine表示行をすべて編集対象外とする。** 過去分だけでなく当日source-ID行も除外する。
当日行だけ実Node扱いすると、定義の期限とOccurrenceの期限が混ざるため。
一覧projection関数でsource-ID行/仮想ID行を除き、対象外Nodeはsession.refに含めず削除対象にもならない。
不正なrefや仮想IDの貼り付けはparse/ref検証で拒否。仮想属性を持つbaseline自体もsession作成を拒否する。
Routine定義はツリーで実Nodeのみを編集する。履歴・overrideは限定patchで保持する。
一覧テキストViewは読取専用で全Occurrenceを表示し、締め切りON時は導出期限を出す。
この選択は、仮想Occurrenceを新規Node化する推測処理を作らないためのもの。

## テキストView（読み取り専用）

「テキストView」は編集とは独立。開いた時点の表示snapshotを読み、コピーする。
基本はタイトルだけ。ref/内部ID/sortKey/revision/編集syntaxは生成しない。
一覧は現在の表示group・順序（折り畳みを含む）、ツリーは現在見えている階層・順序を反映する。
無所属/Routineは人間向けの見出し。入力欄は編集不可。

以下のcheckboxは全て初期OFF。ONにした項目をタイトル直下の箇条書きに出す。

- 締め切り
- 自由入力（本文）
- Task / Idea
- 完了状態
- カテゴリ
- Routine

「項目名を表示」も初期OFF。コピーは現在のcheckbox設定の出力全文。
clipboard失敗時は成功表示をせず、選択コピーの案内を表示する。Expo Clipboardを利用する。
本文にユーザー自身が書いた記号・内部ID等がある場合は、内容を勝手に改変しない。

## 非対応事項

Routine Occurrenceのテキスト書込、履歴/overrideの直接編集、曖昧な期限解釈、一覧からの所属変更、
Category↔Memo変換、非対応repeatRule selectorの変更、保存前draftの永続化、Phase 7の総合受入作業。
入力の強調は別表示領域で行う。文字単位diff・埋込rich editor・Occurrence編集は含めない。

## Routine管理領域の準備（#90）

ツリー入口ではsession開始前にApplicationが管理領域を準備する。
通常UIはツリーの「ルーティーン追加」から開始できる。
[初期化・安全停止・History仕様](ROUTINE_ROOT_V2.md)を参照。

### Routineの作成前提（#90）
通常UIの新規Routineは日を初期選択として表示し、有効な繰り返し設定を必須とする。旧UIで作成された未設定Routineは推測変換せず、通常UIで頻度を明示して保存する。これを修正するまで@routine直下の「なし」はvalidation errorのまま。正常な既存ruleを無編集serialize/parse/planしても変更は0件。
