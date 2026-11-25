# Routine周期変更後の保存済み実績表示

開発担当から独立レビュー担当へ。Production相当ソースe18c4d1基点の独立差分。#132/#130/#107や未配信main Queueは含めない。

## 原因

完了一覧completionHistoryGroupsはroutineHistory/routineOutcomesの保存済み対象日キーを列挙する。一方、旧routineHistoryDaysは現在repeatRuleのstartsOnから直近7周期の日付を逆算し、現在の周期に合わない保存済み実績を表示しなかった。さらに編集画面は未保存の周期フォーム値を渡していた。コードと合成データで確認した表示不一致であり、実ユーザーのデータ消失を確認したものではない。本番データは読取り/変更していない。

## 実装と境界

- routine.tsのrecordedRoutineResultsを両画面の共通正規化にする。outcomes優先、pending取消を除外、同じ元日付をdedupし、記録対象日と実操作changedAtを区別する。
- routineHistoryDaysは保存済み実績を対象日降順で返す。過去日を現在ruleから生成しない。未来対象日を表示せず、現在生成対象の本日未処理回だけpending行を加える。既定7件を維持。
- 編集画面へ保存済みmemoを渡し、未保存の周期入力で過去実績や今日行を作らない。完了/スキップ/-を文字で表示する。
- 既存完了取消と本日完了ボタンを維持。スキップ行を完了トグルに誤接続せず、表示のみとする。スキップ取消は既存完了一覧から利用できる。ただし周期変更後の過去スキップ取消は現行Domainが現在ruleを検査するため、#117の結果操作設計へ残す。
- 予定生成、保存データ、同期、Journal/CAS/Outbox/receipt、バックアップ形式は非変更。未達stateの新設は#117設計レビュー待ちで、今回未実装。

変更ファイルはsrc/domain/routine.ts、completionHistory.ts、routine.test.ts、新routineRecordedHistory.test.ts、src/app/index.tsxと本書。

## 検証

修正前の新規10件FAILをartifacts/routine-priority/137-red.logに記録。初回修正後、fixtureがroutineOccurrenceDueAtへmemo引数を渡していなかった1箇所を修正した。製品の予定生成をfixtureへ合わせて変更していない。

関連88 PASS / 7 files。全体1,294 PASS / 46既存skip（未実施）、164 files PASS / 4 files skip。型チェック、Lint、Web export（合成DEV公開設定・EXPO_OFFLINE、4 routesとbundle環境検査）、diff check成功。

旧#77の「未記録でも直近周期日を表示」3件は、#137の明示的な仕様改訂により「本日以外の未記録日は生成しない」期待値へ変更。削除/skip化ではない。他のRoutine生成/期限/完了一覧/同期の回帰は維持する。

新規試験は日/週/月/年への変更、旧日次実績、取消pending優先、0件、未来、同名別ID、実操作日との区別、IndexedDB再起動、周期変更Undo/Redo、InMemoryRevisionServerの2端末、バックアップ復元を含む。閲覧前後でCommitted bytesとOutboxが不変なことも確認した。合成同期を実Firebase/実機確認とはしない。

## 独立レビューとDEV準備

取得元共通化で完了一覧の元対象日・実操作日時・取消の意味が変わらないこと、現在の周期が過去実績を除外しないこと、今日行が一つであることを重点にレビューする。#138は本PRをbaseに全件展開を追加する別PR、#117は同期互換性の別設計PRとする。

DEV配信/実SDK通信は未実施。承認後の使い捨てDEVデータで、毎日→毎週→毎月/年と変更して旧実績の日付が残ること、今日-と完了後の重複なし、取消、完了一覧との対応をiPhone/PCで確認する。本人確認までIssueをCloseしない。Production配信/実データ変更は禁止のまま。
