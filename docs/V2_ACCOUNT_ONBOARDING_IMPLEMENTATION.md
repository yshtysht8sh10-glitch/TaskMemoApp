# #85 V2 onboarding実装記録

2026-10-04。production Firebase/Functions/Rules/Hostingへの変更・Issue Closeは実施しない。
契約→callable→Rules→receipt→client→Emulatorの順で実装。

追記：同日のBlaze化後、DEV限定配備と実Web App Check/new Account同期まで確認した。
現在の配備・テスト・iPhone手順は [DEV_ONBOARDING_DEPLOYMENT.md](DEV_ONBOARDING_DEPLOYMENT.md) を参照。
Functions runtimeの `fractional-indexing` 依存不足を失敗先行の回帰テストで修正。
最新全体804 PASS、Functions15 PASS、onboarding Emulator13 PASS。
以下の実装完了時点の未確認事項のうち、DEV配備・実Web App Check・新規UID同期は解消済み。
iPhone/Android実機、Native bridge、production配備・統制は引き続き未確認。

## backend

`functions/src/onboarding/decision.ts` はpure判定とrequest契約。
requestはschemaVersion=1/protocol=2だけ。client UID/project/gate値は拒否。
新規作成はserver Auth creationTime、password provider、global、onboarding policy、inventory、lifecycleを検証。
既存valid gateは変更しない。既存V1/非空/未知collection/復旧/不正gate/receipt不整合は停止。

`callable.ts` のensureAccountV2ReadyはAuth UID、revocation、disabled、tenant、実Auth recordを照合。
実環境ではApp Check強制。専用service account設定がない場合も停止する。
最大3 instances、UIDごとに各instanceで10回/分の上限（分散集計ではない）と30秒timeout。
MCP OAuthとは独立。bodyのprotocolはversion真正性の証明ではなく、安全条件はbackend/Rulesで固定。

`repository.ts` はglobal/policy/gate/receipt/lifecycle/親userとinventory queryをtransactionで検査。
create時はgate、accountProvisioningV2/{uid}、accountLifecycleV2/{uid}を同一transactionでcreate-only。
receiptにはproject/default database/null tenant/UID/Auth作成日時/protocol/policy version/準備時刻/fingerprint。
token/email/password/Node本文は保存しない。応答喪失後は同じ記録を照合し、再生成しない。
新規receiptの存在不整合を修復して通さない。Node/profile/sync operation receiptはprovisioningでseedしない。

inventoryはnodes/nodesV2/profileV2/syncOperationsV2/externalAiRequestsV2/externalAiAuditLogs/syncMetadataV2。
未知collectionも停止。listCollectionsはtransaction外なので、Admin writerの統制が公開前提。
policyのwriterFenceVersion=1はその統制を管理者が監査済みと宣言する値で、無条件allowではない。
未対応Admin import/manual writerを自動的に排除できる仕組みとは扱わない。
既存Admin toolingのfreeze/UID限定・専用lifecycle markerの運用をレビューし、統制未確認ならpolicyを有効にしない。
任意Adminがgate不存在scopeへ並行書込みするケースまで保証したとは報告しない。

## policy準備（今回未実行）

server-only syncControl/onboarding:
schemaVersion=1, enabled, protocol=2, policyVersion（非空string）, eligibleCreatedAfter（Timestamp）, writerFenceVersion=1。
未設定・不正・disabledなら停止。production cutoffはまだ指定していない。
TASKMEMO_ONBOARDING_SERVICE_ACCOUNTを同じprojectの専用IAM service accountへ設定し、最小権限をレビューする。
実配備・IAM準備・policy投入は今回行わない。

## Rules artifact

firestore.rulesをstrict V2 artifactへ変更。firestore.dev.rulesもpolicy/receipt/lifecycleをclient read/write拒否。
client compatibility create/update/deleteは禁止、gateなしV1/V2 writerも拒否。
旧広いowner writeはfirestore.legacy.rulesに保存。既定firebase.jsonから選択されない。
これはローカルartifact変更であり、実production Rulesを変更したことではない。
既存ユーザーのcutover前提を満たさず、このartifactを配備しない。

## client

firebaseSyncAdapter.connectはglobal検証後、serverで不存在と分かったgateだけにcallbackを実行し、
完了後にgateをserver再読取して既存validatorで再検証。
不正/停止/newer/dual gateとnetwork/permission errorはmissing扱いしない。
useTaskMemoSyncは認証generationでcallbackをfenceし、準備中を表示する。
未確定journalのCloud audit前にもconnectする。journalをonboardingで昇格しない。
失敗時は正常なAccount Local readyを保持し、Domain/History/Outboxを消さない。
一時的なunavailable/deadline errorは最大3回、250/500msで再試行。安全停止は自動retryしない。
既存controllerのinitial ownership/限定patch/1History/receiptを使用し、anonymous Outboxはコピーしない。

Web/PWAはonboardingAppCheck.web.tsでReCaptcha Enterpriseを初期化。
EXPO_PUBLIC_FIREBASE_APP_CHECK_SITE_KEYがなければfail-closed。
NativeはconfigureNativeOnboardingAppCheckにFirebase App Check tokenを取得するレビュー済みbridgeを設定する。
bridgeがなければfail-closed。実Android attestation bridgeとprovider登録は今回未導入・未検証であり公開条件に残る。
実環境のApp CheckをEmulatorのように無効化して通さない。
Emulatorだけは固定demo projectとFUNCTIONS_EMULATORでattestationを省略する。

## テストと再実行

pure判定11件、client契約/fence/一時retry3件。最小テストの修正前失敗を確認してから実装。
新規integrationはAuth/Functions/Firestoreをdemo-taskmemo-onboardingへ限定し、live fallbackなし。
13件: 新規登録から同期、client自己承認/ungated writer拒否、停止gate、legacy/unknown inventory、
atomic失敗、freeze/古いAuth/復旧、並行実行、応答消失後のcallable再試行、restart、A/B receipt分離。
有効な同一Node payloadがgateありで成功・gateなしで拒否されることも確認。

`npm run test:onboarding:emulator` でFunctions buildと3 Emulatorsを起動する。
Functions discoveryが遅い環境ではFUNCTIONS_DISCOVERY_TIMEOUT=60を環境変数に設定する。
runnerはcallable起動完了を確認してから実行し、transaction競合のbackoffを含む30秒test timeout。
通常Functions checkにもpure/unitと条件付きintegrationが含まれる。

今回確認: 全回帰109 files/803 tests PASS（40条件付きskip）、Functions build/check PASS
（unit14 PASS、integration条件付き20 skip）、onboarding Emulator13 PASS。
TypeScript/lint（0 warning）/Text Format doc check/ローカルproduction Web export PASS。
Emulator統合は別実行し、skipのまま合格とは扱わない。
既存V2 Firestore Emulatorも別実行で19件PASS。git diff --check PASS（改行変換通知のみ）。

## 未確認・公開前条件

- production実配備Rules/hash・self-approval拒否、専用IAMとbackend信頼境界。
- Admin writer inventory/排他・Auth import/deletion/UID再利用の運用。policyを有効にする前の監査。
- 実App Check attestation、Android bridge、password以外のprovider eligibility。
- DEV/実Firebaseへの配備、新規実UIDから手動gate不要の同期、iPhone PWA/Android実機。
- Emulatorでの署名済みApp Check enforcementやproduction quotaは未証明。

上記が残るため一般公開・Issue完了ではない。既存DEV UIDのgateも今回手動作成していない。
