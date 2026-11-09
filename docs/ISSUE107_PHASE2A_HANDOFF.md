# #107 Phase 2A レビュー引き継ぎ

正本は設計212461c、Phase 1 pure基盤676b4da。詳細・遷移表・障害注入・差分・残存リスクは[保存復元レポート](ISSUE107_PHASE2A_LOCAL_DURABILITY.md)。本PRはPhase 1 branchから独立し、main/Productionへマージしていない。

レビュー重点:

1. `local/isolatedIndexedDb.ts`: exact raw CAS/Journal-null、scope限定、get/put同transaction、oncomplete成功、quota/abortの全体rollback。旧DB/keyへの参照がないこと。
2. `local/store.ts`: snapshot全体・原通知・counter・inboxの一括確定。失敗前に戻り値/採番/メモリ/Outboxを進めないこと。未処理inboxと保護下の編集禁止。
3. `local/replay.ts`: Phase 1公開APIだけで再生し、P2先着の耐久pendingをP1後に再配送。反映事実と現在conflict、受領を混同しないこと。
4. `local/hydration.ts`: raw/期待context/全manifest・member・祖先・payload・reflectionを再検証。snapshot自身から復旧authorityを発明せず、現在headの独立guard不一致では停止すること。
5. `status`: 未受領/awaiting/current conflict/依存/rejected/保護/inboxとserver確認を分解。server確認値は今回合成注入だけで、実確認取得を実装済みにしていないこと。
6. 35障害/永続ケース＋承認済み58回帰。Journalの自動clear、証跡GC、保護解除、旧形式推測変換がないこと。

特に判断が必要な実運用境界: 信頼済みRecoveryGuardの保管/確認は今回のtest harnessからの注入に限定する。commit応答喪失でguardを失えば原本を残して停止し、未確認successorを自動採用しない。将来のguard authority/実server確認/実Auth切替をどの工程で接続するかは後続レビュー対象で、本PRの承認をその実装承認としない。

再実行（appとfunctions依存・Expo生成参照型が揃った環境）:

```powershell
npx vitest run src/sync/intent --maxWorkers=2
npx vitest run --maxWorkers=2
npx tsc --noEmit
npm run lint
git diff --check
npm run web:export
```

Web exportはdevelopment設定でEXPO_OFFLINE=1。重い720順列の既存テストとbuildは同時に走らせない（元の5秒timeoutを変更しない）。ユーザーDB/Firestore/Emulatorへ接続するコマンドは含まない。

今回の結果: focused **93 PASS**（既存58＋新規35）、全体 **1,377 PASS / 46既存skip**（168 files PASS / 4 skip）。型、Lint（warning/error 0）、Web export、diff check成功。初回全体の既存順列timeoutは保存し、条件を弱めず単独再実行で成功した。詳細ログと障害別対応はレポート末尾を参照。

開発はcommit/push・レビューPR・#107記録で停止。Phase 2A承認前に実通信経路へ接続せず、Phase 2B・配信・Rules変更・実データ移行へ進まない。#107/#120を機能完成としてCloseしない。
