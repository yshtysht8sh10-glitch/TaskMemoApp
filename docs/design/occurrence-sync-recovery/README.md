# Routine延期 D3同期保存 D4移行復旧の設計レビュー

開発担当から独立レビュー担当へ。今回分だけの延期を安全に実装するための追加設計案であり、製品実装・pure PoC・SDK・移行・配信の承認ではない。D3/D4はこのPRのレビュー待ちでBLOCKED、D5は未審査。D1/D2の正本を書き換えない。

## 正本と現在の依存

GitHubのPR本文・レビューコメントを確認した時点の状態を以下に固定する。承認は記載された対象commitと範囲だけに適用する。

|対象|commitと確認できた範囲|
|---|---|
|[PR131 D1/D2](https://github.com/yshtysht8sh10-glitch/TaskMemoApp/pull/131)|`b8d49943f7fa682d43467a66c3301821752d048e`。D1論理規範APPROVE [再レビュー](https://github.com/yshtysht8sh10-glitch/TaskMemoApp/pull/131#issuecomment-6877609080)。D2は先行の設計仕様限定承認を維持。実provider未承認|
|[PR123 移行設計](https://github.com/yshtysht8sh10-glitch/TaskMemoApp/pull/123)|`212461c99d3556e055fb5265cbc6e4c80116f8ac`。全永続データ、明示一度限り移行、freeze/drain/照合の設計正本|
|[PR124 Phase1](https://github.com/yshtysht8sh10-glitch/TaskMemoApp/pull/124)|`676b4da1089fe11c0c42b2d4ce10496c4ee2c30b`。既存属性のpure intent/反映証跡。Routine拡張やatomic groupは未供給|
|[PR125 Phase2A](https://github.com/yshtysht8sh10-glitch/TaskMemoApp/pull/125)|`b3a8d478d5c64a381378d22be1a01444958c00a7`。隔離CAS/Journal復元。実用B方式接続の承認ではない|
|[PR126 Phase2B-1](https://github.com/yshtysht8sh10-glitch/TaskMemoApp/pull/126)|`9a7150e9339fa1353f77e4f9853d5b7ce797c859`。[模擬基盤限定APPROVE](https://github.com/yshtysht8sh10-glitch/TaskMemoApp/pull/126#issuecomment-6752939045)。端末保存の独立証明は供給しない|
|[PR127 B方針](https://github.com/yshtysht8sh10-glitch/TaskMemoApp/pull/127)|`cd4f992a2fbecafed182c3ccb8be2e4f609a849d`。server耐久ログ正本・local replica方針|
|[PR128 B規範](https://github.com/yshtysht8sh10-glitch/TaskMemoApp/pull/128)|`cd36f499cd514218434c19d687f4b4ae4af69e87`。[S-CUT/S-REPLICA設計APPROVE](https://github.com/yshtysht8sh10-glitch/TaskMemoApp/pull/128#issuecomment-6768436549)。E/P/Mは未承認|
|[PR129 N1](https://github.com/yshtysht8sh10-glitch/TaskMemoApp/pull/129)|`98aa972d1c1f9e8b7c977470f6cf1ae9549c1a18`。[REQUEST CHANGES](https://github.com/yshtysht8sh10-glitch/TaskMemoApp/pull/129#issuecomment-6772131742)。runtime pin/ledger shape検証のN1-F1/F2が残存。実SDK接続不可|

同期基盤の追跡は現時点で#107の会話とPR123–129にある。一方、#107のIssue本文の題名は「キュー型タスクグループ」で、同期専用Issueという題名ではない。番号だけから別の同期実装が承認済みとは推定しない。#120は同期安全性に依存する別UIであり、#130の前提機能ではない。今回#107のコード・ブランチ・Issue状態は変更しない。

## レビュー順序と判定単位

1. [D3 同期保存契約](01_D3_CONTRACT.md)：resource/意図/atomic group、証跡、server source、T1供給条件。
2. [D4 移行復旧契約](02_D4_MIGRATION_RECOVERY.md)：旧データ/原本/未同期/入力回収、成功条件とrollback。
3. [受入計画](03_ACCEPTANCE_HANDOFF.md)：全件未実施。D3論理規範、D3 temporal provider、D4 mapping/runbookを別々に判定する。

基点はProductionソースe18c4d1。追加文書だけの独立ブランチとし、PR131や#107の未承認実装を取り込まない。設計承認・合成試験・実SDK成立性・実機確認・本番反映は別の段階である。
