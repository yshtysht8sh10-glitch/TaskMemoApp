# 04 バックアップ・復旧・ロールバック

## 1. 保存対象と完全性

新backup/checkpointには、format/protocol/generation、全Nodeのbaseline/属性状態/投影、全intent・accepted・適用結果・未解決競合・依存待ち、Outbox/awaiting ledger、History/Undo来歴、profile/settings、未知field、legacy raw/Journal/保護原本とsource mapping、migration進捗、actor/seqの復旧情報を含める。

端末local rawの退避と、account server sourceの退避は別に取り、manifestで束ねる。source path/hash/件数/版、field分類・演算可能/保留分類、保存時点/起源を記録する。ハッシュは内容破損検知であり、正しい意味を証明しない。内容を含むchecksum/diffを公開Issue/logへ出さない。Auth tokenや秘密認証情報を丸ごとexportしない。

**通常backup schema1〜4は完全checkpointではない。** 既存ファイルは読めることを維持し、Node/profile/settingsのsnapshot importとして扱う。存在しないOutbox/receipt/Historyを復元したと説明しない。raw復旧backupは全scope/保護情報を保つ別の形式として扱う。

## 2. 原本を失わないためのconservation規則

全source itemを次のいずれかへ必ず写像する: unchanged archived raw、verified baseline/intent、説明付きlegacy-unresolved。分類除外や「不要だから削除」の暗黙branchを禁止。各itemはsourceRef/targetRefと検証hash/field意味差分を持つ。

Node数だけ一致しても十分ではない。Node ID集合、全field/unknown、tombstone、各Routine日付/状態/changedAt/取消、lifecycle期間/retained、profile候補、操作/receipt identity、History項目、raw archive数、競合集合/依存を照合する。変換でDate表現等が変わる場合は承認した正規化規則と原文字列を一緒に残す。

取得可能な現存データを保護する設計であり、以前のアプリが既に削除したHistoryやbackupに入っていない情報を無から再生できる保証ではない。不足が分かればその事実を記録し、別sourceからの照合/復旧承認を待つ。

## 3. 復元は置換ではなく検証された処理

- restore planを先に作り、現在状態とbackupの世代/source/ID/操作の関係を比較。古いsnapshotを現アカウントへ無条件setしない。
- 完全checkpointを同じgenerationの障害復旧に使う場合も、serverのaccepted/opId/結果をread-only auditしてから未受領だけ再送。原操作を消して新opIdへ作り直さない。
- 別account/新generationへのimportは来歴付きの明示新操作/初期baselineとする。同じopIdの再利用、source UIDの偽装、古いtrueで新OFFを黙って上書きしない。
- actor incarnationを新規writer用に再発行し、復旧前actorのpending操作は元identityの再送/映射として保持する。二端末が同じnextLocalSeqで新操作を採番しない。
- 古いHistory全Node snapshotを今のDomainへそのまま適用しない。属性対象のUndoへ変換できないものはread-only保留。失ったことにしてclearしない。
- 不正JSON、未知format、欠落参照/parent、誤世代、hash不一致、衝突opId、容量超過は現Committedを変更せず停止。parser errorを空データとして保存しない。

## 4. ローカル原子性と失敗点

|失敗箇所|残すもの/復旧|
|---|---|
|退避中にsource変更|前後raw両方を識別し、安定した再採取計画へ。どちらかを消して一致させない|
|staging生成/容量不足|旧Committed/Journal不変、失敗したtargetは未active。完了済みchunkを検証して再開|
|server受領済み・client ACK保存失敗|Outbox/旧rawを保持。再送で同じacceptedを取得してledgerと同時CAS|
|結果反映後・UI更新前crash|永続field state/ledgerを再読込。memoryの成功有無を正本にしない|
|migration pointer CAS失敗|active世代を読み直しmanifest一致を確認。二重activeにせず保護停止|
|未確定Journal|clear/overwrite/replayで移行を進めない。raw一致・scope・Outbox・server照合等の既存保護手順を維持し、解消不能なら保留|

大きいarchiveは先に不変保存し再読込verify、最後にmanifest/pointerをCASする。dangling archiveは証拠として残せるが、存在しないarchiveへのactive pointerを作らない。意図なく原本clean-upを始めない。

## 5. ロールバックの三つの境界

### R1 active前

sourceは旧raw/旧Cloudのまま。target stagingだけ未使用にする。再開/中止のmanifestを保存する。freeze解除はユーザー/リリース担当の承認操作で、未検証のold writerを自動再開しない。中止しても原本・checkpoint・staging証跡を削除しない。

### R2 active後・新操作なし

新旧source照合と両端末のlocal変更なしを確認できた場合に限り、control pointerを戻す計画を別承認できる。単なる「操作した記憶がない」は証明ではない。切替中に片端末だけ新操作があればR3。

### R3 active後・新intentあり

**旧V2 snapshotへの上書き復元や古いPWAへのHosting rollbackでは戻さない。** 新generationをfreezeして全intent/候補/Outboxを追加退避。新正本を読める互換build/forward fixを優先する。必要なdowngradeは新操作を旧形式へlosslessに変換できるか別計画し、できなければread-onlyで保持。旧形式へ表せない競合/因果履歴を捨ててのdowngradeは禁止。

Hosting artifactのrollback、制御pointer、ユーザーデータ復旧を別操作として承認する。配信を戻しても旧writer拒否を勝手に解除しない。Rules/Functionsを新世代のまま保持することがデータ保全に必要な場合がある。

## 6. 手元の二端末で守ること

iPhone/PCの片方を「クラウドにあるから不要」と初期化しない。片方のみの未送信操作/旧History/draftがあり得る。旧PWA/cacheからしか参照できないrawを、更新・サイトデータ消去・再インストールより先に独立退避する手順を準備する。今回その端末操作は行わない。

完全backupが独立環境へ読み戻せ、全分類/件数/意味を復元できたことを移行許可の条件とする。試験は使い捨てDEV/ローカルで行い、本番復元で試さない。
