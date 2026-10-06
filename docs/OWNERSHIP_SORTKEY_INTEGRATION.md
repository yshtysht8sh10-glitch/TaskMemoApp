# Ownership reconcileのsortKey統合

Issue #85の[確定仕様](https://github.com/yshtysht8sh10-glitch/TaskMemoApp/issues/85#issuecomment-5999996180)。原本rankの修復ではなく、正常な独立V2順序空間を統合する。

## account-anchors-v1

- source/accountは個別に厳密検証する。内部active兄弟重複、不正rank、ID対応不一致、親不整合/cycleは保存不可。V1 migration validatorは緩和しない。
- 同IDはlocal/accountの選択に従う。非採用account Nodeとsame Nodeを固定anchorとし、accountのsortKeyを変更しない。
- parentごとに元sortKeyの辞書順で統合。同じキーはaccount anchorを先、local採用を後。tie-breakはlocale非依存のID辞書順。Map挿入順に依存しない。
- 衝突したlocal採用Nodeだけに、直前キーと次の元キーの間のfractional keyを生成する。末尾はgenerateKeyBetween(previous, null)。次の非衝突localキーも境界として保持する。全体normalizeやfallback修復は行わない。
- 双方の相対順序を保持する。shared-IDの採用先や所属変更など、ユーザー選択による変更は選択を優先する。ID/content/Category所属は順序統合で変更しない。
- deleted/purgedはactive順序に参加しない。非表示legacy a..zキーを保持。purged採用/復活は禁止。削除確認・destructive guardは既存契約を維持。
- 結合後も従来の兄弟一意性・親構造チェックを通す。例外時はcommitしない。

実機条件: account root/a0と別IDのlocal root/a0 → accountはa0、取り込み先localはa1。local原本はa0のまま。次の兄弟がある場合はその手前のキーになるため、常にa1ではない。

## Pure projection / preview / fingerprint

`src/sync/ownershipSortKeys.ts` の `integrateOwnershipSortKeys(plan, choices)` はDomain候補と調整一覧を返す。入力変更、Firebase、永続化、時刻、React依存なし。未選択itemはpreviewでaccountとして仮置きする。commitは全itemの採用先指定を要求する。

OwnershipPlanのorderPolicyをsource/target/profile/itemsと共にfingerprintへ含める。UIとcommitは同じpure関数・plan・choicesを使用。UIは調整件数とNodeごとのsortKey before/afterを表示し、検証エラー時は保存を禁止する。

commitはtrusted plan、fresh fingerprintを確認。clientの既存server snapshot/profile/scope generation確認と各operationのexact expectedCurrentを維持。remote変更時は再planする。旧policyのplanは再確認を要求する。

## Application / History / Outbox / 再起動

投影結果を採用Nodeのoperation payloadとHistory afterへ保存。非採用account Node向け追加operationは生成しない。Domain/transaction/outbox/localSeqのatomic commitと既存V2同期を使い、別書き込み経路は作らない。

全ack後にownership保存全体で1 History entryを確定。Undo/Redoは調整後sortKeyを含む取り込み結果を扱う。partial successの再起動/reconfirmはaccepted targetを保持し、未適用Nodeのみ再planする。

Ledger source checkpointは原本snapshotを保持。three-way比較用ancestorsは実際のHistory afterを保持する。これにより原本a0/取り込み先a1の差を、後続local内容編集でremote競合と誤認しない。

## 回帰と未確認

`fixtures/iphoneOwnershipRanks.ts` は実機metadata（別ID/root/a0/active/非deleted/非purged）の匿名化fixture。非提供の本文・日時・deadlineはsyntheticと明記。

修正前に実機条件のテストでV1重複例外を確認。複数衝突、隣接localキー、Category子、複数追加、account anchors、deleted/purged、同ID選択、metadata維持、入力不変、再実行/入力順の決定性、不正source/account拒否、atomic失敗、stale preview、remote precondition、Outbox、再起動、partial replan、1 History、Undo/Redo、後続local編集を検証。

今回Firebase/Hostingへ配備しない。iPhoneでの取り込み→同期済み→Memo保持→logout/re-login→再取り込みなしは未確認。対象PWAはproduction命名projectのpreview originで、production配備による更新は禁止。別のDEV配信作業で更新先/build識別の確認が必要。#85/#59はOPEN。
