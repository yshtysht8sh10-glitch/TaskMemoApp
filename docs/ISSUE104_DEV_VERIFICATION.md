# Issue #104 フォルダ色変更 DEV確認

- 実装コミット: e1391c713a58698002565e26312687aaeb7ae92b
- DEV: https://taskmemoapp-dev.web.app/
- 配信基点: 870a5e6（配信前DEVの画面SHAと一致）。Routineスキップ等の既存変更を含む。#104の差分は専用コミットへ分離。
- DEV Hostingのみ配信。Rules / Functions / Productionは変更・配信していない。

通常Categoryの「…」→「フォルダの色を変更」から青・黄・緑・赤・紫・グレーを選択できる。
色の意味は固定しない。チェックと色名で選択状態を表示。「標準色に戻す」で従来の絵文字へ戻す。
色付きフォルダはReact Native Viewの図形で描画し、名前・背景・行イベント・階層は変更しない。
categoryKindを持つ特殊Categoryと仮想領域は対象外。

Categoryの任意属性folderColorとして保存。nullが明示的な標準色への復帰、未設定も標準表示。
IDと子Memoは保持。Application Store command → 原子的なIndexedDB保存 / History / Outbox → 既存V2 revision同期を利用。
既存Firebase codecは属性を保持。復旧の既知ユーザーデータ属性にも登録した。DB migrationや独立保存経路は追加していない。

## 自動検証

- TypeScript: PASS
- lint: PASS
- 全体テスト: 136 files PASS、1077 tests PASS、4 files / 43 tests既存skip。
  初回並列実行で既存production-admin.cli.test.tsの5秒timeoutが1件発生。
  単独3件PASS、全体再実行1077件PASS（テストやtimeoutの変更なし）。
- Web export: npm run web:export:v2-rc PASS、環境と公開設定のbundle検証PASS。
- git diff --check: PASS
- folderColorApplication.test.ts: 複数フォルダの独立、子Memo/ID保持、実IndexedDB adapterのfake-indexeddb再起動、
  Undo/Redo、null reset、V2 server modelと別Application Store受信、Firestore codec往復、旧データ、特殊Category拒否を確認。

## DEVブラウザ確認

画面SHA e1391c7を確認。モバイル幅でメニュー・全色パレット・チェック表示・青/黄の独立設定、
Undo/Redo、再読込後の青選択保持、標準絵文字へ復帰を確認。
Routineの🔁/5件と無所属の◇を維持し、Routineのメニューには色変更が出ないことを確認。
検証用フォルダ「Issue104 青フォルダ（検証用）」「Issue104 黄フォルダ（検証用）」をDEVの未ログインLocalへ作成。
実Firebase同期、iPhone実機、ドラッグ実操作、全色のライト/ダーク実機表示は未確認。
自動テストは実Firebase/Auth/Rulesや実タッチ操作の保証には含めない。

## iPhone Safari / PWA確認手順

1. DEVを開き再読込。上部SHA e1391c7を確認する。
2. ツリーで通常フォルダA/Bを用意し、Aの「…」→色変更→青、B→黄を選ぶ。
3. パレットの色名・チェックと、名前/背景が変わらずアイコンだけ変わることを確認。
4. 子Memo追加、開閉、折り畳み時の件数、階層、長押しドラッグ、メニューのタップを確認。
5. Undo→Redo、標準色に戻す→Undo→Redoを確認。再読込・PWAを閉じ再起動して保持を確認。
6. ライト/ダーク両方で6色とチェックが読めることを確認。
7. Routineの🔁と開閉/件数、無所属の◇が維持され、色変更対象外であることを確認。
8. DEVの同じアカウントでiPhoneとPCへログイン。取り込みが必要なら既存の確認画面で対象を確認する。
   A/Bの色変更を両方向に同期し、標準色への復帰、Undo/Redo、再ログイン後の保持も確認。
   Productionでは検証しない。

実機・実Firebaseの確認結果をIssue #104へ記録するまでOPENを維持。
Productionは実機確認とユーザーの明示承認後に別途配信する。
