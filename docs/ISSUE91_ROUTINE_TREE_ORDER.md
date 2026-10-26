# #91 同一締切Routineの一覧順序

2026-10-26。Productionへの操作・配信は行わない。

## 原因と承認された順序

未操作の同一root直下では元々sortKey順になる。一方、複製は元のdeadlineSortKeyも継承し、同じ保存順位ではID順となっていた。
また、順位付き同士だけ順位比較し、それ以外は期限比較する旧comparatorは循環し、新規発生分が混在するとsnapshotの配列順で結果が変わった。

- 保存順位のある行を先に表示し、その相対順位を維持する。
- 順位なしの新規行は後ろへ置く。Routine同士は期限日時→ツリー順。
- 未操作グループも期限日時→同一締切Routineのツリー順。通常Taskの相対順・表示slotは維持。
- 同じ保存順位のRoutineは期限日時→ツリー順。明確に異なる手動順位は期限・ツリー変更より優先。
- ツリー順は既存flattenVisibleNodesの全Category展開時のparentId/sortKeyによる走査順。タイトルやOccurrence IDはRoutineのtie-breakに使わない。
- 現行RoutineはroutineRoot直下のMemoだけ。通常Category配下を新たにRoutine化しない。階層テストでもこの契約を保持する。

## グループ全体への影響

rankはbucket ID付きではない既存fieldであり、現在の所属bucket内だけで比較する。
通常TaskはdeadlineSortKey、RoutineはroutineDeadlineSortKeys[発生日]（旧deadlineSortKeyへfallback）。
初回DnD／欠損・重複rankのあるDnDでは、対象bucketの全行を表示順に採番してから移動行のrankを設定する。
全rankが正常な場合は移動行だけ更新。他bucketに自動採番せず、表示・同期受信による書込みも追加しない。
日付別rankは翌日の発生分へ継承しない。ただし旧deadlineSortKeyは既存互換性のため継承する。
通常Taskが別bucketへ移動した際の既存rank保存仕様は変更しない。
新規分を含めDnDすれば、新しい保存順位を優先する。保存順位が異なる行にはツリー変更を反映しない。

## 検証

修正前、重複rank／新規分の混在／DnD後の新規分／V2同期後の4テストが期待順の不一致で失敗。
初回テスト作成時のIndexedDB constructor誤用は既存static open APIに修正し、製品コード変更前に再実行した。
回帰テストは複製command、日週月年、期限差、親Category階層、通常Task混在、tree変更、日付境界、保存順位を検証。
IndexedDB再起動・V2別端末同期・Undo/Redoと履歴・override・周期・期限不変を確認。
#96/#102の既存DnD回帰を含む全体検証の結果とDEV SHAはIssueに記録する。
実Firebase端末同期とiPhoneタッチ操作はユーザー確認待ち。IssueはOpenを維持する。
