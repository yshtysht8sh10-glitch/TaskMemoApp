# 既存DEVへのRoutine履歴改善統合

2026-11-26 / 開発担当。Owner方針変更に従い#143は参考資料として凍結し、新Projectは作らない。

## 基点と差分

公開DEV `https://taskmemoapp-dev.web.app` のJSを読み取り、表示SHA
`24d4b46ad9c4f2df26aa49ac78acf03ae86af5b7`、Queue信号ありを確認。
Hosting release `sites/taskmemoapp-dev/releases/1793432284326000`、
version `sites/taskmemoapp-dev/versions/1fb0ce74bc1d2db0`。
Project `taskmemoapp-dev` / `1045397314197`、Auth同Project、Firestore Native/Tokyo。
アカウント文書や実ユーザーの保存データは読んでいない。

対応系統はorigin/main。統合基点 `f3c8253650657b66ac30edd6861ccd5903391ffa` は公開版に
テスト・調査文書だけを追加したcommitで、アプリコードは公開版と同じ。
ここへ#140 `007b2df`→#141 `74aad5f`→#142 `c8a7fb8`を順にcherry-pick。
index.tsxのimport競合1か所はTaskQueuesとRoutineHistoryPanelを両方維持した。
作業中の置換がCRLFへ一致せず競合markerが一度commitに残ったため、配信前チェックで検出し
`03f0aa9`で除去。最終treeの型チェック・ビルド・diff checkは成功。
既存ブランチ・未push作業を上書きしていない。

保存形式、Node型、同期、Journal、CAS、Outbox、receipt、Rules、Functions、Auth設定は差分なし。
Queueの生成・並び・状態register・UIコードも差分なし。#139/#117のmissed保存・gate変更なし。
新しい実績を生成せず、保存済み結果と本日の未処理だけを読み取り表示する。

## 検証

| 項目 | 結果 |
|---|---|
| 履歴表示・展開・性能＋Queue focused | 7ファイル40 PASS |
| 全体 | 167ファイルPASS、4ファイルskip / 1277 PASS、46 skip |
| TypeScript / Lint / git diff --check | PASS |
| development Web export / Firebase設定埋込み検査 | PASS |
| 独立レビュー | 依頼待ち。過去の3PR承認と統合版承認を区別する |
| DEV配信・実Auth・iPhone | 未実施。統合版の独立レビュー後に配信する |

最初の全体実行は新worktreeのFunctions依存junction不足で3suiteロード失敗。
既存の同lock依存を接続して再実行し上記結果となった。既存skipは成功扱いしない。
ログは `D:/working/TaskMemo/artifacts/routine-dev-integration`。

## 配信ゲート・手順

独立レビューが本統合treeを承認した後、配信直前にDEV release/公開SHAを再取得する。
上記公開版から更新されていれば止めて再統合する。
main/releaseへmergeせず統合ブランチからDEV専用Hostingのみ配信する。
`firebase.dev-rc.json` のsite=taskmemoapp-devとpublic=distを確認し、
`--project taskmemoapp-dev --config firebase.dev-rc.json --only hosting` を明示する。
root firebase.jsonはProduction siteを指すので使わない。Rules/Functionsは配信しない。
凍結対象は配信SHAを埋めたexport全ファイルとhash一覧。
公開後、SHA、manifest/SW、接続先、Hosting releaseを読み取り確認する。
本人の既存保存領域を操作せず、実データの書換え・初期化・強制同期はしない。

## 本人のiPhone確認

DEVの既存originを使用する。Production PWAと混同しないこと。
毎日→毎週前の実績保持、完了一覧との日付一致、今日の「-」、未来/架空過去なし、
7→50→全件→7、閲覧のみで変更なし、展開中の本文入力・スクロール・キーボード、
再読み込みと別端末受信を確認する。Queueの表示・先頭完了・次Task遷移も確認する。
変更を伴う検証は本人が許可した合成データに限定する。
5,000件は負荷ケースで日常規模やiPhone実測済みとは扱わない。
本番反映は本人の実機確認後に別承認を求める。
