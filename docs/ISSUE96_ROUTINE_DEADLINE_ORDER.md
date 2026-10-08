# #96 Routine期限一覧の並び替え

2026-10-09。Issue: https://github.com/yshtysht8sh10-glitch/TaskMemoApp/issues/96

## 原因と調査

- 通常Taskは保存済みNode IDでドラッグ・並び替えする。過去の未完了Routineは `missedRoutineOccurrences` が生成する `routine-overdue:<sourceId>:<date>` の表示行で、Nodeとして保存されない。
- DeadlineViewのWeb canDrag、Nativeの行/タイトル長押しとonDragBeginがroutineOccurrenceKeyを除外していた。期限切れだけを特別に禁止するフラグではなく、過去分の表示行の禁止が原因。
- moveMemoInDeadlineListは実Node IDだけを検索していたため、制限を外しても表示行IDの並び替えは保存できなかった。
- 従来の表示順は、双方にdeadlineSortKeyがあればそのキーとID、そうでなければ発生期限、ツリーsortKey、IDに基づく。Routine過去分も定義のdeadlineSortKeyを継承するため、今日分の並び替えが過去分へ影響する問題も再現した。
- 今日分のRoutine定義はWebではドラッグ可能だった。NativeはTask/Routineとも同一bucketのdropを無視していた。ツリーは保存済み定義のsortKeyを扱うため、過去分の表示行に起因する同じ問題はない。

## 修正

- 過去分も通常行と同様にWeb/Nativeでドラッグ開始できる。複数選択中は従来どおり無効。
- Routine定義の任意field `routineDeadlineSortKeys: Record<YYYY-MM-DD, fractional key>` に日付ごとの一覧順位を保存する。従来のdeadlineSortKeyをfallbackにし、通常Taskは引き続きdeadlineSortKeyを使う。表示行を実Nodeとして作成しない。
- 対象bucketの欠損/重複/不正順位だけを現在の表示順で初期化し、移動行に隣接キー間のfractional keyを設定する。他bucketとツリーの順位は変更しない。bucket内で独立して表示順を計算する。
- 過去分の別bucketへのdropはno-op。繰り返し、期限、完了・取消履歴を変更しない。今日分の既存期限移動仕様は保持する。
- Nativeは最終drop行順から同一bucket内の挿入先を決定する。別bucketの通常期限移動は既存の末尾append仕様を保持。
- V2の既存の原子的command/History/Outbox/codecを使い保存・同期する。Backupの順位検証、Idea変換時の除去、復旧時の既知field認識も対応。
- DeadlineViewのruntime importを相対pathに統一し、既存のalias設定を持たないVitestで実コンポーネントを検証可能にした。

## 検証

- 修正前: 過去分の並び替えと今日分から過去分への順序干渉で回帰テスト2件が期待どおりFAIL。Native期限切れbucketの候補判定もFAILを確認。
- Domain: Taskとの混在、同一定義の複数過去分、今日分/他bucket/treeの保持、既存重複キー、履歴/期限override保持、別bucket拒否、no-op、Backup再読込を確認。
- 実DeadlineView + WebSortableScrollList（React DOM/jsdom、RN primitivesをmock）: マウスdragとタッチ長押し→drop→Domain command、選択中の無効化を確認。
- Application: 原子的保存失敗、1 History/定義NodeへのOutbox、再起動、V2 revision同期、Undo/Redoを確認。
- Firestore Emulator: demo-taskmemo-v2のみ。新規の実SDK/Rules/receiptケースで2端末反映、Cloud順位field、設定保持、再起動、Undo/Redoを確認。全21件PASS。
- 全体: 1,065 PASS / 42 conditional SKIP。Emulatorの21件は別実行でPASS。
- TypeScript / lint / diff check / Web exportはリリース時に実行。証跡はgitignored artifacts/private/issue96-*.log。
- iPhone Safari/PWA、Android実機、DEV実アカウントの複数端末操作は未確認。自動UIとEmulatorの成功を実機確認とは扱わない。

## DEV配信

配信先: https://taskmemoapp-dev.web.app

`firebase.dev-rc.json` のsite=taskmemoapp-dev / public=distを使用し、projectとconfigを明示してHostingのみ配信する。Production、Functions、Rulesへのdeployは行わない。commit、公開bundle照合、最終配信結果はIssue #96と完了報告に記録する。

実機確認手順: 過去未完了が複数あるRoutineと通常Taskの「期限切れ」を開き、先頭/途中/末尾へ並び替える。今日分・ツリーの順序と繰り返し/期限/履歴を確認し、再読込・別端末同期後の順序を確認する。
