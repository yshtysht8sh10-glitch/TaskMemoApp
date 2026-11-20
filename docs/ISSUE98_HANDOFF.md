# Issue 98 保存済み期限日時の表示修正

開発担当から独立レビュー担当へ。基点e18c4d1、独立branch `fix/98-concrete-deadline-label`。#132/#107/#130の変更を含めない。

原因はformatDueLabelがduePresetの相対名を優先し、customでも日付しか返さなかったこと。保存済みdueAtの実日付・時刻を `2026/10/31 23:59まで` の形式で表示する。現在時刻から再計算せず、秒/ミリ秒を保存値から変更しない。実日時がある場合はpreset名より実値を表示し、真に期限がないnullは既存の期限なし表示を保つ。

Routine一覧のメタ情報には、既存の当日/過去回判定で得たOccurrence予定日時を同じformatterで加える。定義の古いdueAt日付をそのまま当日回へ表示しない。繰返しラベル、元日付、所属パスは残す。共通formatterを使用する通常Taskのtree表示も具体日時になる。Routine treeの繰返し説明は既存どおり。

## 検証

- 修正前：formatter新規10件FAIL（相対名/時刻欠落/NaN）、実DeadlineViewのmouse/touch回帰に加えた日時表示assertが2件FAIL、他6件PASS。
- 修正後：focused関連79 PASS / 5 files。実DeadlineViewのドラッグと元日付メニューを維持。
- 全体1,294 PASS / 46既存skip（未実施）、164 files PASS / 4 files skip。
- TypeScript、Lint、git diff --check、合成DEV設定＋EXPO_OFFLINEのWeb export/4 static routes検査：成功。

保存・分類・移動・同期・Historyの処理は非変更。formatter試験は入力JSON不変も確認する。iPhone/Androidの長いタイトル・フォルダ・折返し、ライト/ダークの視認性は実機未検証。jsdomのPASSを実機確認とはしない。

実データ操作、SDK通信、Rules/Functions/Auth設定、DEV/Production配信、merge、Issue Closeなし。既存の「Window.alert未実装」は全体テストの診断出力でテスト失敗ではない。レビューは値の表示のみの差分とRoutine当日/過去予定の区別を重点に依頼する。
