# Routine全履歴展開のレビュー引き継ぎ

開発担当から独立レビュー担当へ。基点は#137修正007b2df750e6d9ed831a755a23e3ac279383f0cd（PR140）。本PRはPR140依存の追加UIで、merge順は#137→#138。#117の未達保存契約PR139の実装を取り込まない。

## 実装

RoutineHistoryPanelへ既存実績表示を抽出し、通常7件を維持。「すべての履歴を表示」で全履歴閲覧モードに入り、最初50件、以後「さらに履歴を表示」で50件ずつ追加する。表示件数/全件数を明示し、上限による切捨てはしない。「直近の履歴に戻す」で7件へ戻る。0件/7件以下は不要な展開ボタンを出さない。

正本は#137のroutineHistoryDaysであり、current ruleで過去日を生成しない。元対象日降順、取消/未来除外、当日未処理-、今日完了後の一行を維持。outcomeの文字表示は現在対応済みの完了/スキップだけで、未達はPR139承認・実装後の拡張待ち。

状態はReactのlimitだけ。Storage/同期commandを呼ばず、展開/縮小でonToggleも呼ばない。結果行の明示「完了/完了を取り消す」だけが既存callbackへ安定ID＋元日付を渡す。スキップの不正な完了toggleは作らない。別Routine/再オープン時はkey=memo.idでコンパクトに戻る。

既存編集ScrollView内に通常Viewとして配置し、入れ子のFlatList/ScrollViewは追加しない。操作領域44以上、文字折返し、既存theme配色を利用。段階展開で初期DOMを抑えるが、全展開後は全件分の行が存在する。5,000行のスマホ実測は未実施で、必要ならレビュー後に仮想化/ページ切替を検討する。保存を別ストア化する変更ではない。

## 変更ファイル

src/components/RoutineHistoryPanel.tsx、新UI test、src/domain/routineHistoryExpansion.test.ts、src/app/index.tsx、本書、DEV検証手順書。#137の取得正規化/APIを変更しない。

## 検証

- 最初の試験は未実装moduleのimport FAIL。続いて展開前と同等の7行コンポーネントで行動試験を実行し、展開/復帰3件FAIL・既存表示5件PASSを確認。
- 実装後のUI8件PASS。125実績で7→50→100→125→7、欠落/重複なし、0/1/7、skip/取消/今日、同名別ID、受信更新を検証。
- 新domain2件PASS。5,000件の順序/全件到達可能なprefix、元JSON不変、未来/不正/取消除外を確認。
- 統合関連102 PASS / 9 files。#137の10件、既存Routine/周期変更/skip/完了一覧/期限/実DeadlineViewドラッグを含む。
- 全体1,304 PASS / 46既存skip（未実施）、166 files PASS / 4 files skip。型チェック、Lint、Web export（合成DEV設定・EXPO_OFFLINE、4 routesとbundle検査）、diff check成功。
- Asia/TokyoとAmerica/New_Yorkで新規20件を各PASS。実端末の時計/zone切替試験ではない。

IndexedDB再起動・2端末合成同期・Undo/Redo・backup復元は継承した#137/既存skip回帰で確認。missed/実Firebase/実機を試験済みとはしない。Window.alert未実装は既存jsdom診断出力でテスト失敗ではない。#77の期待値変更は#137で説明済みで、追加skip/テスト削除なし。

## レビューと残課題

全件到達の上限なし、受信時の再計算、元ID/元日付とcallback、閲覧専用の境界、親ScrollViewへの非干渉を独立レビューする。D3/D4未承認の#130延期、同期基盤、status schema/backup codecは変更しない。

DEV配信・実SDK・実機は未実施。[DEV確認手順](DEV_ROUTINE_HISTORY_VALIDATION.md)は承認後に使う準備資料で、実行結果ではない。本人の実機確認までIssueをCloseしない。Production/実ユーザーデータ/設定変更、main/releaseマージは行わない。
