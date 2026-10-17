# Routineの今回だけスキップ

一覧のRoutine表示はDefinitionの参照であり、独立した保存Taskではない。一覧の削除操作を本体削除へ渡さず、対象の発生日を指定したDomain操作にする。#71（過去回）、#90（管理領域）、#96（日付別順位）、#89（通常Taskの未達案）を参照。通常Taskの未達状態は今回の対象外。

## 保存と互換性

Memoの任意field `routineOutcomes[YYYY-MM-DD]` に `{state: completed | skipped | pending, changedAt: ISO UTC, version: 正整数}` を保持する。Node IDと日付の組で一意。フィールド欠落日は既存のroutineHistoryから判定し、旧履歴の移行・消去・再生成はしない。対象日を完了へ変更するときだけroutineHistoryにも完了日時を書き、完了取消/スキップへの変更時は対象日の既存完了日時をnullにする。他日付は変更しない。

pendingは同期可能な取消記録で、field削除を取消として使わない。新旧両方に状態がある日はroutineOutcomesを正とする。IndexedDB/Nativeの共通Application journal、既存V2 Node payload、Outbox、receiptを使う。バックアップの入出力、旧codecのmerge、復旧時の既知fieldにも対応する。

既存データは変更なしで読める。旧クライアントは未知fieldを保持できてもスキップの表示・操作を理解しないため、スキップ利用端末では新しいbundleを読み込む必要がある。旧bundleや既存Cloud Functionsで新状態を編集できるという保証ではない。Production/Functions/Rulesは今回配備しない。

## 競合と履歴

Node本体の競合解決は既存revision契約を維持し、日付別状態だけを独立registerとして統合する。同日競合はversion、changedAt、state文字列の順で決定し、到着順に依存しない。versionが同じ完全同時刻ならskipped > pending > completed。異なる日付の寄与は両方保持する。

Firestore transactionでは、Node全体で負けた操作にも新しい日付の寄与がある場合、統合値に新revisionと当該operationのidentityを付けて保存する。receiptは既存の冪等性境界を維持する。ACK/self-echoにも統合値を反映する。listener受信のみではOutboxを生成しない。

Undo/Redoは対象日のversionを進めた取消/再適用を保存する。別の日付の状態を現在値から保持する。既存のoperation ID/revisionの一致条件は維持し、remote変更や以前の同一Node操作のUndoが現在のidentityと一致しない場合は実行しない。古い全Node snapshotを強制適用しない。

## UIと安全性

- 一覧の当日分/過去分のメニューで対象日を保持し、見出しにも表示する。「削除」は「今回だけスキップ」に置き換える。
- 過去回のメニュー完了も同じ対象日を使う。タイトル/本文の編集などはDefinitionを参照する。
- 一覧の一括削除もRoutineだけ日付単位でスキップ。ApplicationはRoutineの更新をsoftDelete operationとして送らない。
- ツリーから本体を削除する場合は「このルーティーン自体を削除します。今後の繰り返しも停止します。」と警告する。
- 完了一覧は対象日と「スキップ」、↷アイコンを表示し、完了と区別する。「スキップを取り消す」でpendingへ戻す。
- 当日生成と過去未完了生成の双方でスキップを除外する。翌日の新しい発生日には影響しない。

## 自動検証

`routineSkip.test.ts`：本日ランニングのスキップ/翌日発生、過去回、Definition全field保持、既存完了履歴保持、履歴表示、取消、正しい過去日のメニュー完了、通常Task削除、IndexedDB再起動/Undo/Redo、revision同期、別日付と同日競合、古い状態による復活防止、バックアップ、混在一括削除を検証。

`DeadlineView.drag.test.tsx`：実DeadlineViewの過去回メニューがsource IDと発生日を渡すことをmouse/touchの既存ドラッグ回帰と一緒に検証。

`firebaseEmulatorV2.e2e.test.ts`：demo-taskmemo-v2限定。実SDK/Rules/receiptでスキップ、再起動、Undo/Redo、offline別日付統合、翌日発生、取消、過去回完了、Definitionと旧履歴維持、削除operation不在を確認する。Productionデータをfixtureにしない。

既存のRoutine完了Undoテストは、空mapの代わりに対象日nullを期待する。取消を永続registerとして維持する仕様への変更であり、完了が復活しないことを強化するための変更。

## DEV実機手順

1. https://taskmemoapp-dev.web.app を再読込し、新しいcommit表記とDEV表示を確認する。
2. テスト用の毎日Routine「ランニング」を作成。ツリーの本体、設定、過去の完了履歴を確認。
3. 一覧の本日分「…」に「削除」がなく「今回だけスキップ」があることを確認し実行する。
4. 本日分だけ消え、ツリーの本体が残り、完了一覧に日付付き「スキップ」と↷が出ることを確認。
5. 再読込と同じDEVアカウントの別端末で履歴を確認。Undo/Redo、スキップ取消で対象回だけ戻ることを確認。
6. 過去回のメニューからスキップ/完了し、操作当日ではなく選択した過去日が履歴に出ることを確認。
7. 次の発生日に新しいランニングが表示され、スキップした過去回が期限切れに戻らないことを確認。
8. 通常Taskの削除/復元、ツリーのRoutine本体削除警告を確認。本体削除の実験はテスト用Routineだけで行う。

iPhone Safari/PWA、Android実機、実DEVアカウントの複数端末同期は別の手動確認項目。Emulator/jsdomのPASSを実機PASSと呼ばない。DEV Hostingのみを配信し、Productionのデータ/Hosting/Functions/Rulesは変更しない。
