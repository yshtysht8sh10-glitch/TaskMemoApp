# #107 Phase 2B-1 独立レビュー引き継ぎ

正本: PR #123 / 212461c、Phase 1 / 676b4da、Phase 2A / b3a8d47。新branch `feature/107-phase2b1-authority`はb3a8d47から分岐し、Production e18c4d1/#114を保持。既存コード/テストを変更せず、新authority層と文書のみ追加する。

[信頼境界図・状態遷移・実装対応・復旧手順・実供給課題](ISSUE107_PHASE2B1_AUTHORITY.md)をレビューしてください。設計7項目は実装前に同文書へ固定した。

レビュー重点:

- guard/current headは外部registryから取得し、snapshot/backupの自己guardを採用する入口がないこと。
- claimsがpurpose/nonce/session/replica/完全binding/期限へ束縛され、pinned root・trusted clock/nonceをデータから取得しないこと。
- prepareはcandidate許可だけで、witnessのtarget一致・現在Auth再検査前にはheadを進めないこと。unknown raw/Journalは保存したまま停止。
- Auth切替・期限・epoch・複数device/tab・clone actorでscope混線/二重writeを起こさないこと。Realm activationとpendingをfenceすること。
- receipt/publicationは別権限publisherから登録された不変通知だけを処理し、ServerObservationをlocal checkpointから自作しないこと。
- Phase 2Aで原payload/祖先/member/reflectionを再検証し、historical appliedとcurrent conflictを別に扱うこと。保護状態をauthority回復の副作用で解除しないこと。

mockのAuth/token/issuer/registryとstorage witnessは隔離ハーネスの論理的独立性であり、実運用の物理隔離/耐久性/authenticityではありません。実PWA witness、鍵root供給、実Auth/署名/KMS、台帳耐久化、offline方針、本文の外部送信可否は後続レビューへ残す。これらの実供給を決めずにPhase 2B-2へ接続する承認ではない。

再実行:

```powershell
npx vitest run src/sync/intent --maxWorkers=2
npx vitest run --maxWorkers=2
npx tsc --noEmit
npm run lint
git diff --check
npm run web:export
```

Web exportはdevelopment設定・EXPO_OFFLINE=1。全体テストと同時に実行して既存720順列へCPU競合を起こさない。ログはrepository外`artifacts/issue107-phase2b1/`。filtered regressionのskipと、全体suiteの既存skipを成功扱いにしない。

実行結果: focused **134 PASS**（既存93＋authority41）、全体 **1,418 PASS / 46既存skip**、型/Lint warning 0/Web export/diff check成功。post-CAS Auth失効、receipt identity別名、RPC共有参照の3反例を各1 FAIL→PASSで記録し、全体で再検証した。署名テストは実Ed25519鍵ペアを別々に生成するが、root供給/保管や実運用の真正性を検証したという意味ではない。

review承認まで停止。main/Productionへのmerge、Rules変更、DEV/Production配信、実Firestore/Auth SDK、ユーザー保存領域、旧データ移行/修復、★UI、GC/Journal clear/保護解除、Phase 2B-2は未実施。#107/#120を機能完成としてCloseしない。
