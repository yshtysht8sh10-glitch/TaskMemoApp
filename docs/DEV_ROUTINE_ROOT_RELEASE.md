# #90 DEV Routine管理領域リリース

2026-10-06。Issue本文を確認（追加コメントなし）。#90 / #59はOPEN。
URL: https://taskmemoapp-dev.web.app
Release: `issue90-routine-20261006-2117`
Base commit: `dded687a72f462cddd1ebab41b701ad1fdab932c`（未commit作業を含むためReleaseで識別）。

## 実装・確認

[ROUTINE_ROOT_V2.md](ROUTINE_ROOT_V2.md) に遅延準備・責務・安全停止・History契約を記載。
主な変更: domain/routineRoot、TaskMemoV2ApplicationStore、TaskMemoV2SyncController、
revisionModel、useTaskMemoSync、NodeTree、index、textFormat/validator。
新規テスト: routineRootApplication.test.ts（20件）、Firestore Emulator同時初期化ケース（1件）。
既存Text Format/Workspace/Phase7/TESTINGドキュメントも更新。

- focused: 20 PASS
- full: 852 PASS / 41 SKIP、117 PASS files / 4 SKIP files
- Emulator: V2 Firestore 20 PASS / Functions側10 PASS（demo-taskmemo-v2のみ）
- Functions通常unit: 15 PASS / 20 SKIP、Functions build PASS
- TypeScript、lint（警告なし）、git diff --check、DEV Web export PASS

全体runのconditional Emulator skipは別実行で検証。iPhone実機結果は未確認。

## DEV配信証跡

Firebase APIで projectId=taskmemoapp-dev / projectNumber=1045397314197 を照合。
Hosting site=taskmemoapp-dev / public=dist を確認。
`--project taskmemoapp-dev --config firebase.dev-rc.json --only hosting --non-interactive` で成功。
公開HTMLが指すJSと検証済みdistのSHA256一致、Release/ensureRoutineRoot/追加ラベルの収録を確認。
Bundle: `entry-7d5d85e0cf8b3a417b8c487c6b39d387.js`
SHA256: `0909e56d15e594886df47460f0536bdaf413326c3aad3624b7996c35e30d42a7`
証跡はgitignored artifacts/private/issue90-{tests,emulator,functions-tests,export,deploy}.log / issue90-live.json。
Functions / Rules / Auth / FirestoreのDEV実データは今回変更していない。
production Firebase / Hostingへの操作なし。Functionsはローカルbuild/testのみ。

## iPhone最短確認

Safari / standalone PWAそれぞれでHostingと新Releaseをアプリ情報から確認する。
旧Releaseなら再読込・終了/再起動。PWA/ストレージ削除は不要。

1. ツリーの「🔁 ルーティーン追加」を押す。
2. タイトルを入力し、繰り返し設定で「日」、間隔1、開始日今日、基本時刻を指定して保存。
3. ツリーに専用🔁領域とTaskが表示され、一覧に当日分が出ることを確認。
4. UndoはTaskだけを戻し、rootは残る。RedoでTaskが戻る。
5. 再起動/再ログイン後に領域とTaskが各1件。Accountでは同期済みを確認。
6. ツリーのテキスト編集を開き@routineを確認。無編集保存はHistoryを増やさない。
7. 一覧のテキスト編集はRoutine投影を除外し、ツリーから定義を編集できる。

既存データで領域が欠けている場合にも同手順で対応する。
fresh Local／fresh Accountをそれぞれ検証する場合は別の検証用環境/アカウントを用いる。
未設定の繰り返しでは一覧発生がないため、手順2で日/週/月/年を明示する。
名前だけRoutineの通常Categoryはそのまま保持される。
複数root / deleted・purged root / 予約ID衝突は復旧対象。データ削除で試験を通さない。
実機確認前に#90をCloseしない。#59 Phase 7は実機結果を待つ。

## 繰り返し未設定保存の修正Release（2026-10-06）

- Release: `issue90-rule-20261006-2145`
- Hosting: https://taskmemoapp-dev.web.app
- 対象確認: Firebase API projectId=taskmemoapp-dev / projectNumber=1045397314197 / ACTIVE。configのsiteもtaskmemoapp-dev。
- Hostingのみdeploy成功。Functions/Rules/Auth/productionは変更しない。
- Web bundle: `entry-1423c6eceb4f04773c1790045e971c8f.js`
- TypeScript/Lint/diffチェック/Web export成功。全体866 PASS/41 SKIP、関連80 PASS。Emulator V2 20 PASS/Functions 10 PASS（demo-taskmemo-v2）。
- 最新DEVの未ログインブラウザで修正前のnone保存→未設定表示→初回Text errorを再現。修正後、新規作成で毎日表示、reload後も毎日、Tree Text初回errorなし、無編集保存成功。再現用Nodeは同じIDのまま通常UIで日を明示して更新できた。
- 実ブラウザの設定画面でRelease/Hostingを確認。既存Nodeとstorageは削除しない。検証用2Nodeは未ログインブラウザのLocal V2に保持。
- AccountについてV2 revision server ack/Outbox drain/再起動/無編集plan=0をテスト。iPhoneの実Firebase Accountでの新規作成はユーザー再試験待ち。ユーザーのRが未設定のまま作成されたかは直接未確認だが、同じ症状を現在DEVの通常UIで再現できた。
- iPhoneは上記Releaseを確認後、ルーティーン追加→タイトル入力→日選択表示を確認→保存→毎日表示→reload→Treeテキスト編集を無編集で開く。既存Rは編集で頻度を選択して修正する（storage削除不要）。
- #90/#59はCloseしない。
