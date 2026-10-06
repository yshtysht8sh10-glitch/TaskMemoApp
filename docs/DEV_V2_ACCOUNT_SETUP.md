# DEV / Preview 実FirebaseのV2 account準備

対象は `taskmemoapp-dev` のみ。本番 `taskmemoapp-eabc3` の設定・gate・データ・Hostingは変更しない。
一次情報: [#85 gate不足の実機報告](https://github.com/yshtysht8sh10-glitch/TaskMemoApp/issues/85#issuecomment-5970021026)。

## 2026-10-03 read-only調査

管理者認証でDEV Auth/FirestoreをGETだけで確認。token/email/実UID/Node本文は出力・保存していない。

| 対象 | server状態 |
|---|---|
| `syncControl/current` | schemaVersion=1, writesEnabled=true |
| 本日新規作成されたAuth account数 | 2（DEV全体4） |
| 22:40:34.818 JST作成、UID SHA-256先頭 c0e57953fb04 | gate不存在、nodes/nodesV2/profileV2/syncOperationsV2全て0件 |
| 23:18:02.367 JST作成、UID SHA-256先頭 714ef67d0054 | gate不存在、nodes/nodesV2/profileV2/syncOperationsV2全て0件 |

後者の作成時刻は23:18の実機報告と整合する。ただし実機UIDそのものは未提供のため、本人との対応は未確定。
本日新規accountは双方ともgate未準備である。Firebase書込み・Auth登録・削除・Hosting操作は行っていない。

`signUp`はAuth登録だけ。現在のFunctionsにAuth新規登録時のgate provisioningはない。
既存 `scripts/provision-v2-rc-dev.mjs` は、そのscriptで作った専用RC UIDだけを準備し、PWAで作った別UIDは対象外。
同scriptはglobal設定のPATCHとRoutine root seedも行うため、brand-new empty Account検証にはそのまま使わない。
原因はDEV onboarding/provisioning不足であり、gateを要求するclientの誤判定ではない。
一般公開時の自動account準備には別途server側の設計が必要。

## 責務

- global `syncControl/current`: 環境全体のmaintenance/write制御。
- per-user `users/{uid}/syncMetadataV2/compatibility`: UIDごとのV1/V2切替と最低protocol管理。
- client: server検証だけ。Auth成功やLocal readyを理由に生成・緩和しない。
- 管理者: DEV fresh accountは下記、本番は既存cutover/admin手順。backup/freeze/recovery要件は維持。

## fresh DEV UIDの個別準備（今回未実行）

Firebase Consoleで管理者が一つの確認済みDEV UIDだけを対象に行う。

1. project IDが **taskmemoapp-dev** と確認。CLI default aliasは使わない。
2. Authenticationの登録時刻と本人のログイン先を照合し、UIDを確定。時刻だけで選ばない。
3. 検証clientを閉じ、他のclient/writerがないことを確認。
4. globalがschemaVersion=1/writesEnabled=trueとread-only確認。異なる場合はSTOPし、書き換えない。
5. gate不存在、nodes/nodesV2/profileV2/syncOperationsV2が全て空、旧V1 writerや移行/復旧途中でないと確認。
   確認できない・既存データあり・既存gateありならSTOPし、既存cutover/復旧手順へ。gateは上書きしない。
6. 直前に状態を再確認し、下記1文書だけを新規作成。Node/profile/receipt/globalのseed・変更はしない。

文書: `users/{確認済みDEV UID}/syncMetadataV2/compatibility`

| field | Firestore型 | 値 |
|---|---|---|
| schemaVersion | number（整数） | 1 |
| minimumSyncProtocol | number（整数） | 2 |
| v1WritesAllowed | boolean | false |
| v2Enabled | boolean | true |

7. project/UID/値/時刻を管理者の非公開auditへ記録し、server再読取で確認。
   書込み結果が不明なら再読取し、盲目的な再作成・上書きをしない。
8. 同じDEV PWA/accountでreloadまたはログアウト→ログイン。端末storageは消さない。

client/Rulesの例外、全新規UIDの自動provisioning、本番変更は含まない。

## 状態遷移・実機受入

Auth成功 → Account Local open/ready → global/per-user gateをserver検証 → 既存Outbox audit →
server空/anonymous/Account baseline確認 → 条件適合時にAccount Command初回取り込み →
既存Outbox送信 → 全receipt受領 → 1History/checkpoint → 通常同期。

**compatibility確認はCloud初回取り込みより前。** gate不足ではCloud取り込み/送信を開始せず、
Account Local/anonymous原本を保持。gate確認後も非空/曖昧な状態は明示確認する。

準備後のiPhoneで、同期エラーなし・不要な確認なし・Node欠落/重複なし・cloud/端末一致・
再ログインで同じ匿名変更の再取り込みなしを確認。pending transactionは既存recoveryへ。
今回gate作成は未実行のため、この実機受入は未実施。

回帰証拠: `compatibilityGate.test.ts`（不正gate fail-closed）、`initialOwnership.test.ts`
（connect失敗で取り込み/送信なし）、`firebaseEmulatorV2.e2e.test.ts`
（未準備UID拒否と準備済みUIDのreceipt冪等）。runtime/Rules/Functionsは今回変更しない。
