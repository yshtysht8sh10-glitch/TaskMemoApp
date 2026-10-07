# V1 legacy Timestamp migration

2026-10-07 Production起動停止の提供原本は120 Node。record 116–119の
system-routine-daily/monthly/weekly/yearlyはpurged tombstoneで、purgedAtが
`{"type":"firestore/timestamp/1.0","seconds":1789569222,"nanoseconds":945000000}`。
SDKのTimestamp JSONと一致し、日時は2026-09-16T14:33:42.945Z。
deletedAt/updatedAtとも一致。個々の原本への歴史的な書込経路は未確認。

## Decoder契約

`src/sync/legacyDateCodec.ts` はpureでSDK・storageに依存しない。
既存の解析可能な日時文字列はそのまま維持し、null/未定義の扱いも維持する。
legacy JSONはplain object、type/seconds/nanosecondsの3キーのみを受理する。
typeは完全一致、secondsは整数[-62135596800, 253402300799]、
nanosecondsは整数[0, 999999999]。型変換・推測はしない。
NaN/Infinity、欠損、追加キー、別形式、配列は拒否する。

現行V2 Domain Date/ISO日時はミリ秒精度。nanosecondsが1000000の倍数でない
入力は意味を保てないため安全停止し、丸め/切り捨てをしない。
秒とミリ秒から安全な整数epochを生成しDateで検証、ISOへ変換する。

createdAt/updatedAt/deletedAt/purgedAt/dueAt/completedAtは同じdecoderを使う。
原本rawは変更しない。Nodeコピーの該当日時セルのみ変換する。
ID/parentId/sortKey/deletionBatchId/未知metadata/Routine属性は維持する。
V1バックアップ・fingerprintは元rawのまま。validation失敗はV2 commit前に停止。

## 回帰証拠

`src/sync/fixtures/productionLegacyTimestamp.json` は提供原本120件から生成。
タイトル/本文のみ匿名化。ID、親構造、順序キー、日時、metadataを保持し、
profile/settingsはfixtureに含めない。
`legacyTimestampMigration.test.ts` は全120件の意味的等価性、4 tombstone、
未知metadata、原本backup、History/Outboxなし、再起動、6日時フィールド、
境界値と不正形式のfail-closed/commitなしを検証する。
修正前は受理すべきTimestampを含む11テストが日時validationで失敗した。

この変更はmigration decodeの互換対応。Productionデータ・ブラウザstorageの
手動修復ではなく、deployも含まない。
