# #60 → #71 → #65 調査・回帰記録（2026-10-07）

対象Issue本文と全コメントを読み、#51・#36・#66・#59・#89の契約も確認した。作業開始時のHEADは `72a36ed`、working treeはclean。Issueへの投稿・Close、DEV/production deploy、production Firebase操作は行っていない。

## 原因、既存仕様、修正前FAIL、修正

### #60

原因は期限の優先順が「明日 → 2〜3日 → 今週 → 来週」であるのに、短期期間の終端が今週終端を越えること。OFF時のfallbackがその期間を今週へ流し、表示側のassignedEndが終端の最大値を取って今週のsemantic終端まで延ばしていた。さらに日曜の今週等を今日へ合成すると元のsource groupのlabel/memosも変更していた。

`60-WEEK`を最初に追加して実行し、3 variantsともFAILを確認。2026-10-03では今週に期待した `[1]`（10/4）ではなく `[1,2,3]`（10/4〜10/6）が入った。10/5・10/6は来週、semantic終端は10/11。別の土曜、月跨ぎ、年跨ぎでも同じ回帰を再現した。

最新Issueコメントの月曜〜日曜契約を採用し、2〜3日期間の終端・作成期限を今週終端以内へ制限。forward containmentはsource期間より早い終端の候補を飛ばす（例: 日曜の「明日」をOFFにした時に月曜を今週へ入れない。年末の来週をOFFにして翌年を今年へ入れない）。表示統合はgroupとmemos配列のcopyを使い、semantic終端を変更しない。空の短期期間を週の名前へ合成しない。

新しいプロダクト仕様の追加はない。最新#60に反する旧期待値2件を訂正した: 日曜から2日先は `twoThreeDays` → `nextWeek`、2026-12-27の来週表示開始は12/31 → 12/29（12/28は明日を優先）。今日/明日の優先、明日・今週/今日・今週の表示統合、明示thisWeek preset、月末が来週に包含される表示統合、#51の独立overdue/noneと受け皿なしfuture hidden countは維持。

### #71

元の原因は `routineOccurrenceDueAt` が当日の発生だけを返すこと。翌日には当日分が切り替わり、過去未完了分を投影しない一覧では旧回が消える。履歴を消す更新やRoutine本体の複製が原因ではない。

現在ブランチでは既存commit `e35504f` に `missedRoutineOccurrences` と一覧の投影、仮想IDからsource Nodeへの完了操作が既にある。元症状の追加fixture（翌日・複数日・history・override・再読込）は今回の修正前からPASS。既存修正済みの症状を今回FAILしたと扱わない。`e35504f^`では過去投影がないため `71-PAST` のoverdueキー集合は空になりFAILする。

今回FAILを確認した残存ケースは `71-TOMBSTONE`: `purgedAt`があるsourceでdeletedAtがnullの時、過去2回と当日回の3件が生成され、hidden countにも入った。Domain発生関数と一覧filterで削除/purgedを拒否し、仮想Occurrenceを過去生成のsourceにしない。

仕様変更・モデル変更はない。未完了の過去回は日付keyとsource IDを持つ仮想表示、当日回は既存sourceの表示。historyの真値だけを完了としnullは未完了、overrideを優先し、実dueAtで#60分類を使う。期限超過を自動完了/未達にしない。投影はHistory/Outbox/storageへ書かない。完了操作は既存V2 CommandでsourceのroutineHistoryだけを更新する。

### #65

元のCategory中央nest/通常末尾afterは `e35504f` で既に修正済み。今回の `65-POSITION`、`65-ROOT` と既存treeDrop testsでも修正前PASS。

残る原因は、一覧末尾が展開Categoryのchild行である場合に、行下端の「その行の兄弟へappend」と一覧全体の「root末尾」を区別していなかったこと。Nativeのplaceholder末尾判定も `index >= length` で、最終index `length - 1`を拾わなかった。`65-TAIL`を修正前実行し、parentId=nullの期待に対して `last` となるFAILを確認した。

一覧末尾の候補を `treeEndDropCandidate` としてDomainへ分離。Categoryはroot末尾へ、Memoは既存のafterルールへ。Webのmouse/touch tail経路は専用hover/drop callbackで同じ候補を使用し、末尾gapにindicatorを出す。Nativeも最終placeholder indexを同じ候補へ解決する。通常の行中央はinside、上/下端は兄弟before/afterのまま。

`65-DELETED`の削除anchor、purged source、削除/purged祖先と `65-RANK`のdestination rank衝突も修正前FAILを確認。最新のDomain Nodeでanchorを検証し、canMoveNodeでsource/destination ancestryの削除・purged・非Category/cycleを拒否。moveNodeでは移動先の不正/重複rankを変更前に拒否する。ownership sortKey統合は流用せず、修復/統合とは別の移動操作のpreconditionとして実装した。

新しい階層モデルの導入はない。parentId + fractional sortKeyが正。children、createdAt等metadataは保持し、移動は既存V2 Application Command/安全validator/History/Outbox経由。#36はindicatorと結果の一致を確認する範囲、#66の移動先選択UIは変更しない。

## 仕様と回帰テストの対応

パラメータvariantsは同じ仕様の入力例。IDはtest名に直接記載。新規追加26件。

| ID | fixture / 保証する仕様 | test file | 修正前 |
|---|---|---|---|
| 60-WEEK | 10/3(土): 今日10/3、今週10/4、来週10/5・10/6・10/11。9/26・12/26も実行 | src/domain/issue60Regression.test.ts | 3 FAIL |
| 60-FILTERS | 土曜・日曜・年末×未来bucket128通り。semantic終端、ラベルの実範囲、表示+hiddenの保存、source不変 | src/domain/issue60Regression.test.ts | 日曜/年末のsource label mutation FAIL（clone fixture修正後） |
| 71-PAST | 翌日/4日後、backup読込、旧未完了と当日同時、overdue OFF件数、Node非変更 | src/domain/issue71Regression.test.ts | 現HEAD PASS / 過去投影なしならFAIL |
| 71-HISTORY | 真値履歴は当回のみ除外、null履歴は未完了、旧override期限保持 | src/domain/issue71Regression.test.ts | PASS |
| 71-BOUNDARY | local 23:59:59.999 → 00:00で旧仮想回+新当日回、source非複製 | src/domain/issue71Regression.test.ts | PASS |
| 71-TOMBSTONE | purged sourceを発生/一覧/hiddenに含めない | src/domain/issue71Regression.test.ts | FAIL: 3件生成 |
| 71-OVERRIDE-FUTURE | 旧回のoverrideが未来でもkey/sourceを保持し#60の実期限分類、未達/完了にしない | src/domain/issue71Regression.test.ts | 既存契約を追加確認 |
| 71-APPLICATION | 仮想旧回完了はsource historyのみ、1 History/1 Outbox、Undo/Redo/restart、表示の保存不変 | src/sync/issueRegressionApplication.test.ts | PASS |
| 65-POSITION | before/on/after（中間・空Category nest・最下部）、children/metadata保持 | src/domain/issue65Regression.test.ts | PASS |
| 65-ROOT | nested Categoryをroot先頭へ、子孫保持 | src/domain/issue65Regression.test.ts | PASS |
| 65-CYCLE | self/descendant/pre-existing cycle拒否 | src/domain/issue65Regression.test.ts | PASS |
| 65-DELETED | deleted/purged source・anchor・destination ancestry拒否 | src/domain/issue65Regression.test.ts | 2 FAIL |
| 65-RANK | appendでもdestination rank衝突を状態変更前に拒否 | src/domain/issue65Regression.test.ts | FAIL |
| 65-TAIL | 展開childrenの下の最終gapはroot append | src/domain/issue65Regression.test.ts | FAIL: child parentへ移動 |
| 65-UI-TAIL | 実WebSortableScrollListのmouse/touch events、末尾indicatorとDomain結果一致 | src/components/CategoryDropRegression.test.tsx | 修正後イベント検証 |
| 65-UI-INSIDE | 実component中央nest、existing childの先頭挿入 | src/components/CategoryDropRegression.test.tsx | 既存経路検証 |
| 65-APPLICATION | V2 Command保存失敗の状態保持、1 History/Outbox、Undo/Redo/restart、subtree metadata | src/sync/issueRegressionApplication.test.ts | 既存境界検証 |

既存 `deadlineView.test.ts` は通常週、土曜の明日・今週、日曜の今日・今週、月跨ぎ/年跨ぎ、月末が来週内に収まる合成、overdue/no-due/future hidden内訳、deleted/completed/Idea除外、追加/dropの期限契約を直接確認する。`routine.test.ts` は日/隔日/週/月/年、月末/うるう日、当日override、完了取消を確認する。`treeDrop.test.ts` はroot/同一parent/別parentと実placeholderの解決を確認する。

## 実行結果

- #60 focused: 45 PASS（issue60Regression / deadlineView / dueDates）。
- #71 focused: 70 PASS（issue71Regression / routine / completionHistory / routineRootApplication / nodeStorage / firebaseNodeCodec / issueRegressionApplication）。
- #65 focused: 65 PASS（issue65Regression / CategoryDropRegression / treeDrop / nodeOperations / regressionScenarios / moveDestinations / issueRegressionApplication）。
- Asia/Tokyoで実行。America/New_Yorkでも60/71の境界fixture 11件PASS（その後追加のfuture override以外）。DST時もlocal calendar keyを使う既存設計を維持。
- 最初の全体run: 972 PASS / 41 SKIP / 1 FAIL。唯一のFAILは既存Text Workspace matrixのCRLF対LFの一致検査。内容差ではないことを確認し、検査入力のCRLFだけLFへ正規化した。Spec IDや本文一致の検査は維持。
- #71後の全体run: 978 PASS / 41 SKIP。
- 最終全体run: **993 PASS / 41 SKIP**（126 files PASS / 4 files SKIP）。TypeScript / lint / git diff --check / Web production exportすべてPASS。exportはdevelopment設定のローカルbundle生成のみ、deployなし。
- Functions build PASS / tests 15 PASS・20 SKIP。
- demo-taskmemo-v2 Firestore Emulator: Application 20 PASS + Functions 10 PASS = 30 PASS。production/DEV deployなし。

## 実機で確認する最小項目と残存リスク

| Issue | 最小実機確認 | 残存リスク |
|---|---|---|
| #60 | 10/3基準で明日/2〜3日OFF→10/4今週・10/5/6来週・終端10/11、ON復帰、日曜/年末、狭いiPhone幅でlabelと＋の期限一致、hidden内訳 | narrow layout、実機時計/復帰タイミングはunitの保証外。短期bucketは最新週境界契約に従い週末に空/合成される |
| #71 | 未完了Routineを翌日まで残す→旧期限切れ+当日、旧回を完了→その回のみ消える、Undo、PWA再起動、override後も同じ旧回 | 長期間開始日のRoutineは既存の日別走査で多くの仮想回を作る。性能上限/表示paginationは別scope。rule開始日編集時の過去再解釈は既存仕様で今回変更なし |
| #65 | PC mouseとiPhone PWA touch各1回、Category中央nest→root先頭/中間/一覧最下部、最後のCategoryを開いた状態でchildren下のgap、empty target、children保持とUndo/restart | jsdomはWebKitのhit-test/scroll/gestureをmock。Native FlatListの実gesture/placeholder位置は実機未確認。rank不正データは移動を拒否し自動reconcileしない |

未実施の実機項目と通常suiteの41 SKIPはPASS扱いにしない。今回必須でない別Issueへの機能拡張は行わない。
