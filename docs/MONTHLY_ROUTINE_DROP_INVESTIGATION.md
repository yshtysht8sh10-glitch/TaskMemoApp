# 毎月Routineの翌日DnD調査 — #130

2026-11-13 JST。調査基点はProduction表示SHAと一致するGit commit `e18c4d1d88589103e6ad4d77241aead8d213f1bd`。実Hostingや本番Firestoreの現在状態を再取得したものではない。今回の報告「1ヶ月集合写真」の実データ/端末保存/通信ログは読んでいない。

## 結論

**Routineを当日以外の期限へ移すとDomainが変更なしで拒否する既存制約と、UIがそのドロップを許し説明しない不一致を再現した。** 月次のみの計算不具合や同期巻戻りを必要としない。

対象iPhoneのその操作が実際にこの経路を通ったことや、同時に他の保存/同期障害が発生したかはログ未取得のため断定しない。ただし同じ日付・見出し・月次条件でmouse/touch両方が再現し、最も有力な原因である。本番データを追加確認しなくても改善設計を検討できる段階と判断する。

## 処理経路と通常Taskとの差

1. `DeadlineView.tsx:867`以降のWebSortableScrollListで見出しをdrop対象にし、`onDrop`（890–908）が`onDueDrop(id,target.groupKey,beforeId)`を通知。iPhone PWAはWebのtouch経路（native draggable-flatlistではない）。jsdomでmouse/touchの両イベントを実コンポーネントへ流し、callbackがtomorrowへ届くことを確認。
2. `src/app/index.tsx:894`はlater/nextMonth/nextYearのRoutineだけ「当日内のみ」と説明してreturn。tomorrow/thisWeekはその分岐外でApplication commandへ渡る。
3. `moveMemoInDeadlineList`（deadlineView.ts:610–635）は過去投影の別bucket移動を632で拒否。当日の実Routine定義IDは`updateMemoDeadline`へ進む。
4. `updateMemoDeadline`（同592–596）はRoutineならターゲット日時が当日と同じlocalDateKeyか検査。翌日/今週末は594で元のNode配列を返す。毎月/毎週/毎日の違いで分岐しない。
5. 通常Taskは同601以降でduePreset/dueAtを変更する。当日Routineの時間帯移動なら日付別`routineDueOverrides[操作当日]`を書き、本体の基本dueAt/repeatRule/履歴を維持する。
6. Domainが変更なしで返すと`TaskMemoV2ApplicationStore.commandSerialized`（392）はbefore/after同値で`[]`を返す。保存・History・Outbox生成へ進まない。再描画した一覧は元の期限のままなので「戻る」と見える。

11/13（金）では明日と今週末が共に11/14（土）。`deadlineDisplayGroups`が表示見出しを「明日・今週（11/14）」へ統合することを合成テストで確認。内部tomorrowまたはthisWeekのどちらでも同じ日付制限により拒否される。見出しの誤分類がないと説明できる例である。

## 切り分け

|候補|調査結果|
|---|---|
|ドロップ先が判定されない|合成UIのmouse/touchではtomorrow callbackへ到達。今回の再現の原因ではない|
|Domainが拒否|当日内制約でno-op。新規8件のDomain/Applicationテストで再現|
|保存失敗|再現ケースは保存前に終了。隔離fake-indexeddbのCommitted、History、Outboxが操作前後で同一。quota等を原因にしなくても再現|
|一覧再計算|変更なしの定義から今日・夜へ再配置される。保存済み新期限が失われた再計算ではない|
|Cloudによる巻戻り|Cloud通信なしで再現。対象iPhoneの実通信障害の有無は未確認|
|月次固有|日次/週次も同制約。月末計算・周期変更を使わず再現|

## 過去IssueとGit

- [#58](https://github.com/yshtysht8sh10-glitch/TaskMemoApp/issues/58): 当日分の昼/夜移動が対象、日付変更は将来拡張。`git blame`で594–596のガードは`e35504f`（2026-09-30）由来。既存仕様の制約であり、今回初めて壊れたことまでは示さない。
- [#102](https://github.com/yshtysht8sh10-glitch/TaskMemoApp/issues/102): laterのeditable期限確認不足が原因。`538420b`＋`08e7347`はe18c4d1に含まれ、修正コメントもRoutine当日内/過去回別bucket拒否を明示維持。症状は似るが直接の拒否条件は別。未配信/修正消失とは結論しない。
- [#96](https://github.com/yshtysht8sh10-glitch/TaskMemoApp/issues/96): 過去回の同bucket内並べ替えを日付別rankに保存する修正`7f2123c`も基点に含まれる。日付移動機能とは別。
- #113（期間内1回/指定日）、#118（月次前倒し）は関連仕様。今回の無説明DnD拒否と完全重複するIssueは見つからず、[#130](https://github.com/yshtysht8sh10-glitch/TaskMemoApp/issues/130)を新規作成。既存IssueのClose/再Openはしていない。

## 再現テスト

専用branch `investigate/monthly-routine-cross-day-drop`をe18c4d1直下に作成。#107ブランチ/ファイルは非変更。新規ファイルは`monthlyRoutineDrop.investigation.test.ts`（8件）と`MonthlyRoutineDrop.investigation.test.tsx`（2件）。実ユーザーのタイトル/本文/保存値はfixtureへコピーせず、合成名・合成データのみ。

- 当日の月次表示が今日・夜、移動先見出しが11/14に統合されること。
- Domain/updateとmoveの両方がtomorrow/thisWeekを拒否し元配列を維持すること。
- 同じ入力条件で通常Taskは明日へ移動できること。
- 月次の当日内の時間帯移動ではrepeatRule、基本dueAt、過去historyを保持すること。
- 日次/週次も翌日への移動を拒否すること。
- `new IDBFactory()`でのみ開いた隔離ApplicationのCommitted/History/Outboxが不変で空操作結果になること。
- 実DeadlineViewとWebSortableScrollListのmouse/touchでdrop先通知が届き、Domain no-op後も元bucketに残ること。

新規10件と既存#96/#102/Routine/UI dragを合わせ**49 PASS**（6 files、skipなし）。ログはrepository外`D:/working/TaskMemo/artifacts/monthly-routine-drop/related.log`。これは現象の再現/切り分け成功であって、移動不具合を修正済みという意味ではない。初期fixtureの内部bucket名、戻り値、display関数入力、DOM selectorの誤記はテスト側だけ修正し、製品ロジックは非変更。

TypeScript（プロジェクト全体）と新規2テストファイルのLintもPASS。新worktreeのignored expo-env.d.tsは既存と同じexpo/types参照を検証環境へ用意しただけで、tracked設定は非変更。

iPhone実機・実SDK/Cloud・実ユーザーデータによる検証は未実施。製品コード非変更の調査のため全体テスト/Webビルド/DEV配信は行わない。

## 推奨修正順（未実装）

1. **小さいUI整合修正**: DomainとUIでRoutine移動可否を共通判定し、拒否時に理由を表示し、不許可targetの案内/ハイライトも整合させる。現行仕様を保つ最小修正。ただし翌日へ移動可能にする機能ではない。
2. **翌日へ延期を求める場合の機能設計**: 元Occurrence日付と実行期限を区別し、その回だけの延期として保存/表示する。repeatRule/startsOn/定義完了/実績を変更しない。月次は翌日が発生日とは限らず、日跨ぎ後に過去投影IDへ変わること、過去回の別bucket禁止、完了/取消/スキップの対象日、Undo/Redo・同期・再起動・月末/年末を一緒に検証する。ガード削除だけを修正としない。

今回の結果で修正方針をレビュー可能にした段階で停止する。本番/DEVデータ・設定・配信、実端末のIndexedDB/Journal/Outbox/キャッシュ/認証は操作していない。
