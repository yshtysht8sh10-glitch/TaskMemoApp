# #130 Routineの今回分だけ日付移動 — 設計レビュー案

2026-11-14 JST。**設計のみ・独立レビュー待ち。実装/移行/配信の承認ではない。**

ユーザー方針: 毎日・毎週・毎月に共通するOccurrence単位の延期。Routine定義のrepeatRule/startsOnを変えず、元の発生日を保持する。「移動を禁止して説明する」だけの対応へ置換しない。

基点はProductionソース`e18c4d1d88589103e6ad4d77241aead8d213f1bd`。前回の調査/再現資料は[0b88719](https://github.com/yshtysht8sh10-glitch/TaskMemoApp/blob/0b887192f40c5f17980146eabc35eefaf7362fb4/docs/MONTHLY_ROUTINE_DROP_INVESTIGATION.md)。実Hosting/本番データを再取得したものではない。本PRはe18c4d1直下の独立branchで新規文書のみを加え、#107のコード/設計/作業ブランチを変更しない。

|成果物|参照|
|---|---|
|現行構造・推奨モデル・生成/操作・戻し/競合/履歴の設計|[01_MODEL_BEHAVIOR.md](01_MODEL_BEHAVIOR.md)|
|旧データ互換/移行、#107依存、#113/#118境界、合成受入、独立判定/引き継ぎ|[02_COMPAT_SYNC_ACCEPTANCE.md](02_COMPAT_SYNC_ACCEPTANCE.md)|

**推奨**: 不変な`(Routine定義ID, 元発生日)`をOccurrence identityとし、生成由来の不変anchorと、今回の予定日時を持つ明示的な属性操作を追加する。表示上の日付が変わってもidentityは変えない。保存Taskの複製・定義周期の書換え・単なる同日ガード削除は採用しない。

移動先に同じRoutineの次回分がある場合も別identityの二件として表示し、まとめて完了しない。完了/スキップは元発生日へ記録し、実操作日時/移動先日時を別表示する。過去のpending回も延期可能とする案。済みの回は直接移動せず、明示取消後に扱う。

現在のwhole-Node同期へ新fieldを足すだけでは安全な複数端末保証を満たさない。#107のintent/属性因果/receipt/反映分離とRoutine対応の**必要部分**の独立承認が公開前提。本PRはその実装変更を行わず、#107/N1の完成/承認や実運用有効化を主張しない。

## 独立レビューで決める項目（REQUEST CHANGES修正版）

1. identity/anchor・同日二件共存・日跨ぎ生成・延期/原日復帰の仕様。
2. outcomeとscheduleの合成、同属性MV競合、Undo/Redo・定義変更/closeとの意味依存。
3. Routine単位の不変CalendarPolicy、将来区間だけのzone変更、source closure/明示LegacyConfirmation、初回anchor許可条件とDST規範の採否。
4. #107の必須ゲート、#113/#118との未決境界、移行/backup/rollbackの完了条件。

推奨案と未決条件を本文で区別する。未承認事項を推測で実装可能とせず、レビュー後も明示実装指示まで停止する。製品コード、SDK、Rules、実データ、既存テスト、DEV/Production、#107の変更はない。

レビュー[R131-1・D1 BLOCKED](https://github.com/yshtysht8sh10-glitch/TaskMemoApp/pull/131#issuecomment-6858422424)への対応は01§2.3–2.5（zone/根拠）と§4.1（History atomic group）、02§4.1（具体反例）/§7（対応表）を参照。D1/D2の提案を具体化する文書修正であり、D3/D4 BLOCKED・D5未審査の解除を申請したものではない。
