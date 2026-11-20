# Issue 132 タスク検索MVP レビュー引き継ぎ

## 変更範囲と基点

開発担当から独立レビュー担当へ。Production相当のソース `e18c4d1d88589103e6ad4d77241aead8d213f1bd` を基点とする。mainの未配信Queue変更、#107同期改修、#130延期設計は取り込まない。PRのbaseは差分を限定するため `release/issue114-production-candidate` とするが、このPRをreleaseへマージする許可を意味しない。

タスク名の部分一致検索を一覧画面から開ける。検索結果はフォルダを横断し、タイトル・フォルダパス・実期限を表示する。同名でもIDで選択し、既存の詳細編集へ渡す。検索はModalで重ね、通常一覧をアンマウントせず、閉じると元のフィルター・展開状態・画面へ戻る。検索文字と結果はメモリ内だけに存在する。

## 対象データ

|対象|MVPの扱い|
|---|---|
|通常Task|未完了・非削除・非purge。期限なし、将来期限、旧memoType欠落も対象|
|フォルダ|全フォルダ横断。期限グループの表示設定によらず検索。削除祖先の配下は除外|
|Routine|既存routineOccurrenceDueAt/missedRoutineOccurrencesの当日・過去未完了投影を使用。元発生日を区別し、編集先は保存済み定義。未来回は生成しない|
|完了・スキップ履歴、Idea、ゴミ箱|対象外。履歴やRoutine定義を編集して検索用Taskを作成しない|
|アーカイブ|現モデルに独立したarchive種別はない。既存のstatus/deletedAt/purgedAtを尊重。将来の履歴検索は別仕様|

検索はタイトルのみ、前後空白を除いて大小文字を区別しない部分一致。本文・タグ・あいまい検索・高度なフィルターは対象外。検索順序は独立した投影で、元配列・通常一覧の並び順を変更しない。

## 読み取り専用の境界

TaskSearch/taskSearchにはStorage、sync、Application commandへの依存がない。入力・クリア・閉じるはReact stateだけを変更する。結果のタップだけが既存openMemoEditorへ元Nodeを渡す。編集可能でないstartup状態では検索結果を読めるが編集ボタンは無効。編集画面で本人が変更する操作は既存の保存契約に従い、検索操作とは区別する。

IME入力にEnter/Escapeによる確定・画面遷移を割り当てていない。変換中の文字を保持し、入力ノードを差し替えない。PC/スマホ共通の幅100%、最大760、44px以上の操作領域、FlatListの仮想化を使用する。配色は既存ライト・ダークthemeに従う。

## 検証

|検証|結果|
|---|---|
|新規domain/UI|14 PASS。日本語composition、Enter、0件、クリア、同名ID、元定義への選択、startup編集禁止、5,000件、元データ不変|
|関連focused|79 PASS / 5 files。検索14＋Routine/期限/実DeadlineViewドラッグ既存回帰|
|全体|1,298 PASS / 46既存skip、165 files PASS / 4 files skip。skipは未実施|
|TypeScript|PASS|
|Lint|PASS|
|Web export|PASS、4 static routes、公開設定bundle検査成功。合成DEV設定・EXPO_OFFLINEでbuildのみ。通信・配信ではない|

最初の検索受入テストは未実装module importでFAIL、その後14件PASS。これは新機能の未実装確認であり、既存製品の安全性反例ではない。全体ログに既存jsdom Window.alert未実装の診断出力があるが、テスト失敗はない。

合成通常Task、同名部分一致、50回、PC Node実行の検索関数のみの参考値：

|件数|中央値ms|p95 ms|
|---|---:|---:|
|100|0.033|0.164|
|500|0.062|0.165|
|1,000|0.108|0.185|
|5,000|0.656|0.939|

描画・実機・Routine長期履歴の測定ではない。Routine過去回は既存の日別走査を再利用するため、長期履歴でのコストは残る。取得上限で結果を黙って切り捨てない。

## レビューと残存確認

1. 検索操作から保存/同期/History/Outboxの入口へ到達しないこと、Routine結果の原IDと日付表示の対応を確認する。
2. Modal終了時に元一覧が維持される構造、既存編集への導線、startup gateを確認する。
3. iPhone PWA・Android・PCの実入力、キーボード表示、横幅、スクリーンリーダー、実スクロール位置は実機未検証。jsdomでRNをDOMへ置換した試験を実機PASSとは扱わない。
4. DEV配信は禁止されているためIssue本文のDEV確認条件は未実施。ローカル自動検証とbuildまで。独立レビュー・実機確認・リリース判断は別段階。

本番データ・認証・Rules・Functions・Journal/Outbox・main/releaseへのマージ・配信・Issue Closeは実施しない。
