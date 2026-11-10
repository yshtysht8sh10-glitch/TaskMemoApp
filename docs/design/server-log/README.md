# #107 B案 規範仕様案 — レビュー入口

2026-11-10 JST。**設計のみ・独立レビュー待ち。製品実装/実SDK接続の承認ではない。**

方針正本: PR #127 `cd4f992a2fbecafed182c3ccb8be2e4f609a849d`、独立承認[6756787261](https://github.com/yshtysht8sh10-glitch/TaskMemoApp/pull/127#issuecomment-6756787261)。元設計: PR #123 `212461c99d3556e055fb5265cbc6e4c80116f8ac`。基盤: Phase 1 `676b4da` / 2A `b3a8d47` / 2B-1 `9a7150e`。本提案は既存承認文書/APIを上書きしない。

|成果物|文書|
|---|---|
|consistent cut、照合アルゴリズム、信頼境界、四状態、復旧表|[01_CONTRACT.md](01_CONTRACT.md)|
|E2EE/4モードの境界、API対応、未決定・承認単位|[02_BOUNDARIES.md](02_BOUNDARIES.md)|
|正常/異常受入、crash・回帰ゲート、実装分割、引き継ぎ|[03_ACCEPTANCE_HANDOFF.md](03_ACCEPTANCE_HANDOFF.md)|

本書群のMUST/禁止/MUST NOTは**提案規範**。レビュー承認後に該当判定単位の規範になる。未決定事項は黙ってdefaultを選ばず、対応ゲートを閉じる。方針採用済みであることと詳細仕様・実装許可は別。

標準モードの詳細契約をS単位、E2EEの検証モデルをE単位、署名/Auth/耐久providerをP単位として審査する。Sだけの承認をE/P/SDKの承認へ拡張しない。今回のコード・テスト・SDK・Firestore・Rules・データ・配信・移行は全て非変更。#107/#120はCloseしない。
