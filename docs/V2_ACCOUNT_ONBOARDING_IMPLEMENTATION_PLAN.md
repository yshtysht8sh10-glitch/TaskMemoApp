# #85 production onboarding実装計画

2026-10-04。設計/計画のみ。production Firebase/Functions/Rules/Hostingは変更しない。
ローカル実装・Emulator検証の到達点と未確認条件は[実装記録](V2_ACCOUNT_ONBOARDING_IMPLEMENTATION.md)を参照。
[最新コメント](https://github.com/yshtysht8sh10-glitch/TaskMemoApp/issues/85#issuecomment-5970632604)と
[設計案](V2_ACCOUNT_ONBOARDING_DESIGN.md)を基準とする。以下の新規ファイル名は予定であり未実装。

## 1. 契約・pure判定（最初のレビュー単位）

予定: `functions/src/onboarding/contracts.ts`, `decision.ts`, `decision.test.ts`。
React/SDKから独立した判定を作り、入力は検証済みAuth identity/server policy/gate/receipt/inventory。
返り値は `existing-ready / create / blocked`。blocked理由を有限のcodeで定義する。

callable名: `ensureAccountV2Ready`。requestは `{ schemaVersion: 1, protocol: 2 }` のみ。
未知field/UID/project/gate値を拒否。protocolは契約値であってclientの真正性証明ではない。
responseは `{ schemaVersion:1, state:'ready', result:'created'|'existing', protocol:2 }`。
これは同期許可の最終証拠ではなく、clientは既存connectでgateを再読取する。

| 判定code | SDK error方針 | client動作 |
|---|---|---|
| auth-required/auth-invalid | unauthenticated | 再認証案内、送信なし |
| request-invalid | invalid-argument | 自動retryしない |
| maintenance/onboarding-disabled | failed-precondition | Local継続、再試行可能と明示 |
| legacy-account/nonempty-account/recovery-active | failed-precondition | 移行/復旧案内、推測移行なし |
| incompatible-gate/receipt-inconsistent/policy-invalid | failed-precondition | 安全停止、具体理由 |
| rate-limited | resource-exhausted | bounded backoff |
| network/backend-temporary | unavailable | bounded backoff、手動retry可能 |

既存valid gateにはreceiptがなくてもexisting-readyを返す（既存管理者cutoverとの互換）。
receiptがある場合は必ず整合性を確認。gateなし/receiptあり、Auth creationTime違い等はSTOP。
disabled/dual/V1/newer/malformed gateは、同じUIDでも自動更新・修復・降格しない。

## 2. policy / provisioning receipt / writer排他

server policy: `syncControl/onboarding`。
`schemaVersion=1`, `enabled`, `protocol=2`, `policyVersion`, `eligibleCreatedAfter`（Timestamp）。
必須field欠落/不正はfail-closed。DEV/PRODのpolicy境界を別々にレビューし、日付をコードで推測しない。
global maintenanceは従来 `syncControl/current`。自動準備はglobalを変更しない。

receipt: `accountProvisioningV2/{uid}`（server-only、read/writeともclient拒否）。
固定1 UID/1文書で、schemaVersion/projectId/databaseId/tenantId/uid/authCreatedAt/protocol/
policyVersion/provisionedAt/gate仕様fingerprintを保存。token/email/passwordを含めない。
gate: `users/{uid}/syncMetadataV2/compatibility`、既存4fieldのみ。
gateとreceiptを同一transactionでcreate。Node/profile/operation receipt/Historyは生成しない。

`functions/src/onboarding/inventory.ts` でDATA_MANAGEMENT_MATRIXからCloud collection一覧を固定する。
nodes/nodesV2/profileV2/syncOperationsV2/externalAiRequestsV2/externalAiAuditLogs、syncMetadataV2の
repair/migration/recovery marker、親user文書と未知collectionを検査。1件でも存在すればfresh createを拒否。
既存valid gateの通常accountには、この空判定を要求しない。
listCollectionsとAuth照合はFirestore transactionと一体ではない。そのraceを空queryだけで安全と主張しない。

実装着手前に、Admin tooling/migration/repairのwriter一覧と排他方式を確定する。
server-only `accountLifecycleV2/{uid}` のlease/fencing tokenを共通化する候補をレビュー。
既存client repairLockとの併用・取得順・失効・解放を定義し、未対応Admin writerが存在する間は
onboarding policyを有効にしない。通常clientはgate不存在時の全writer拒否、既存trusted V2 writerは
transaction内gate検証により保護。Auth削除/UID再利用とAdmin importも排他対象として明示する。
このwriter統制は公開条件であり、「後で対応する」としてauto-createを先行公開しない。

## 3. Functions/callable（backend実装単位）

予定: `authIdentity.ts`, `firestoreProvisioningRepository.ts`, `service.ts`, `callable.ts` と各test。

- wrapperは2nd gen onCall、regionは既存asia-northeast1を候補にlatency/database locationを確認。
- 専用service account、project/database/tenant固定、timeout/maxInstances/rate limitを設定。
- request.authからUID。Admin Authで存在/disabled/creationTime/provider/tenantを確認。
  ID tokenのrevocationチェックも明示実装。匿名Auth/custom-token/管理者importを誤認しないeligibilityを確定。
- App Checkは公開前にenforce。本番のdebug tokenを認めない。App Check失敗を成功扱いしない。
- repositoryはglobal/policy/gate/receipt/状態queryをtransactionで読み、pure判定後にcreateだけを行う。
- transaction callbackには外部APIやログ送信などの副作用を入れない。commit後に非公開監査を記録。
- concurrent retryではcreate成功済みのgate/receiptを照合してexistingへ。receiptを毎回増やさない。
- Admin SDKはRulesを迂回するのでbackend自身の全安全チェックが必須。
- `functions/src/index.ts` に専用export追加。MCP appのinitializeAppを整理し二重初期化を避ける。
  MCP/OAuthの既存認証経路をonboardingへ流用しない。
- `functions/package.json` の固定test列挙に新規unit/integrationを含め、buildで契約importを確認。

## 4. Firestore Rules（backendと並行設計、client接続前にテスト）

`firestore.dev.rules` のstrict artifactを基準とする。
syncControl/onboarding、accountProvisioningV2、accountLifecycleV2はclient read/writeを明示拒否。
compatibilityのcreate/update/delete拒否を維持。repairLockの既存限定権限を壊さない。
gateなしV1/V2 Node/profile/receipt writerは拒否。V1選択/V2選択/global freezeの既存テストを維持。

`firestore.rules` の広いowner writeとstrict artifactの扱いを別レビュー単位で決める。
deny matchの追加だけでは広いallowを打ち消せない。既定deployment経路を誤使用してもgateの
自己承認を再導入しない構成を用意する。legacy維持が必要な場合は明確な別configへ分離する案をレビュー。
production Rulesを今回その場でstrictへ配備しない。既存ユーザーcutover条件を守る。

## 5. client導線（Application境界を維持）

予定: `src/services/accountOnboarding.ts` とtest、Firebase web/native clientのFunctions接続。
App CheckのWeb/PWA/Android provider、site/app登録、token更新、offline動作を別taskとして実装。
Platform設定や外部サービス準備が必要なら、DEV検証とproduction準備の手順を分ける。

hookではAuth成功後にAccount Localの状態を読み、Cloud利用前に専用readiness serviceを通す。
有効gateは既存導線、serverで確認できたmissing gateだけがprovisioning対象。
network/permission/malformed gateをmissing扱いしない。callable成功後もadapter.connectを必ず実行。
重複connect/queryはreadiness serviceへ集約しても、upload transaction内のgate再確認は省略しない。

`recoverV2ApplicationAfterAudit` はcontroller.start前にもCloud receipt照会を行うため、readinessを
その前に適用。Local committed stateをreadyにする処理と未確定journalの扱いを分離し、
未確定journalは既存recoveryで停止、onboardingで昇格させない。
診断/自己修復/manual recovery経路もCloud I/O開始前の同じ条件を確認し、fresh扱いに変更しない。

状態: Local opening/ready/error と Cloud preparing/ready/blocked/offlineを別管理。
pending ownership/outboxがあるときLocal編集可否は既存store制約に従う。
Auth generation/UID/scopeをawaitの前後で照合。旧Aへのcallableが完了してもBへ結果を適用しない。
再試行は同じUIDへbounded backoff、手動再試行とrestartで再開。Auth account再登録やstorage削除なし。
gate確認後は現begin/prepare/commit、initialOwnership、Domain/History/Outboxをそのまま使用。

## 6. Emulator計画・合格条件

新しい `firebase.onboarding.emulator.json` を予定。Auth/Firestore/Functionsだけ、projectは
`demo-taskmemo-onboarding` 等の固定demo名。既存demo-taskmemo-v2 testsと同時衝突しないportを選ぶ。
Admin/client/Functionsが全て同じdemo projectへ接続したことをassertする。live API fallbackは禁止。
Functionsを事前buildし、専用test taskをpackageへ追加。既存Emulator suiteは残す。

| test層 | 必須ケース |
|---|---|
| pure/unit | cutoff境界、policy不正、provider/tenant、全gate種別、receipt整合、未知データ |
| backend integration | empty create、同UID多重実行、rollback、commit後応答喪失、再起動、freeze/policy/lease race |
| Rules authenticated client | 自分/他UID gateのcreate/update/delete、receipt/policy/lease write拒否、gateなしV1/V2拒否 |
| Callable HTTP/SDK | unauth拒否、body偽UID/project拒否、Auth作成日時server照合、応答contract、error分類 |
| Application integration | anonymous有/無/profile-only、1History、revision/Outbox維持、response loss後重複なし |
| hook/client | Account A/B切替、offline/retry、existing再login、Local編集継続、recoveryへの誤接続なし |

全integrationでbefore/afterのgate/receipt/Node/profile/operationsを比較し、失敗時write=0をassert。
例外はcommit済み応答喪失で、その場合createが1回だけ成立しretryで同じ結果になることをassert。
valid gate既存accountは内容/updateTimeが不変。nonempty/blocked accountの無断変更は0件。
Emulatorが証明できないproduction IAM/App Check実attestation・実Rules配備状態はDEV/実環境確認へ残す。
EmulatorのApp Check代替・debug手段をproduction configへ持ち込まない。

regression-firstで最小失敗を確認→fix→focused/related/full→Functions build/tests、tsc/lint/docs/diff/export。
依存条件付きskip数を記録し、backendを直呼びしただけでcallable境界が検証済みとは報告しない。

## 7. 実装順と停止条件

| 順 | レビュー可能な成果物 | 完了条件 |
|---|---|---|
| A | contract/pure decision/inventory/writer排他仕様 | 曖昧状態は全てSTOP、cutoff/receipt規約が確定 |
| B | callable/service/repository＋unit/backend Emulator | atomic/create-only/多重・失敗・restart PASS |
| C | strict Rulesとdeployment config整理＋Rules tests | client自己承認とgateなしwriter拒否を実証 |
| D | Functions/App Check client＋readiness/hook | Cloud全入口のfencing/recovery/Local保護 PASS |
| E | Auth→callable→gate→ownership→sync統合 | demo project full regressionとquality PASS |
| F | DEV限定配備と実機 | 新規登録から手動gateなし、欠落/重複なし |
| G | production read-only監査と配備レビュー | 実Rules/hash、IAM、policy、App Check、writer統制の証拠 |

今回は計画まで。A以降のruntime実装、DEV配備、Gのproduction監査/配備も未実施。
production変更は後の別承認段階。Rules/IAM/lease/provider eligibility未確定ならpolicyをenabledにしない。
#85/#59はOPEN。設計・Emulatorだけで実機完了にしない。
