# #85 production新規AccountのV2 onboarding設計案

設計調査のみ。runtime/Rules/Functions実装、Firebase設定・gate作成、Hosting deployは未実施。
[最新Issue仕様](https://github.com/yshtysht8sh10-glitch/TaskMemoApp/issues/85#issuecomment-5970275167)を優先。
DEVの一時的な[管理者準備手順](DEV_V2_ACCOUNT_SETUP.md)は一般公開時の代替にしない。
直前のDEV gate準備依頼は対象メール/UID未確認のまま中断されており、gate書込みは実行していない。

## 現状と公開前の必須条件

- `useTaskMemoSync.signUp` はAuth登録だけ。現在のFunctions exportはMCP HTTP endpointのみ。
- Account Local readyはクラウド準備完了を意味しない。
- Controllerはconnect/global/user gate検証後にinitial ownershipを行う。順序は維持する。
- `firebase.cutover.json` は厳格な `firestore.dev.rules` を選ぶ。同Rulesはclientのgate書込みを拒否し、
  gate不存在ではV1/V2 Node/profile/receipt書込みを許可しない。
- 一方 `firebase.json` の `firestore.rules` は広いowner writeでcompatibilityまで書込み可能。
  denyを別matchに足すだけでは他matchのallowを取り消せない。厳格なRules artifactと配備経路を
  確認・レビューし、owner gate書込みとgateなしV1/V2書込みを全経路で拒否することが前提。
  今回productionの配備済みRulesは取得しておらず、現状の実Cloud挙動とは断定しない。

## 推奨方式と候補比較

| 方式 | 判断 |
|---|---|
| clientからgate作成 | 不採用。clientによる自己承認になりcutover境界を壊す |
| Rulesで空ならgate createを許可 | 不採用。Auth登録履歴・全legacy/recovery状態を十分検証できない |
| Auth作成イベントだけで準備 | 補助候補。非同期の競合/遅延/失敗に対してclientの待機・再試行も必要 |
| Auth blocking function | 非推奨。Identity Platform前提、AuthとFirestore間の分散atomicは成立しない |
| 認証済みcallable backendから限定準備 | 推奨。明示的応答、再試行、再ログインでの再開が扱いやすい |

専用 `ensureAccountV2Ready`（仮称、2nd gen callable）を設ける。MCP OAuth scopeからは利用させない。
clientは準備を要求するだけで、UID/project/空判定/既存gate/切替許可はbackendが決定する。
当初はcallable一つを主経路とする。Auth作成triggerを併用する場合も同一service/transactionへ集約し、
二つの独立したgate生成方式を作らない。公式の2nd gen Auth作成triggerは調査時点でPreview表記のため、
導入時はSDK実装・配備サポートを再確認する。

## 信頼境界

1. callableのAuth tokenからUIDを取得。bodyのUID/project/gate値は受け付けない。
   backendのproject/database/tenantをdeployment設定で固定し、一致しない認証は拒否。
2. Admin Authで現UIDの存在、disabled、作成日時、tenant/providerを確認。初期対象は現在の登録方式。
   Auth匿名UID/custom-token/imported user等を推測でfresh扱いしない。
3. server-managed onboarding policyを用意し、enabled/protocol=2/policyVersion/eligibleCreatedAfterを管理。
   createdAfterはレビュー済み公開開始境界。client時刻・signupフラグ・lastSignInTimeは根拠にしない。
   既存のgateなしユーザーを自動移行しないための境界であり、既存DEV検証UIDは手動準備側に残る。
4. App Check、rate limit、timeout、最小権限service account、非公開auditを利用。
   Admin SDKはRulesを迂回するため、global/cutover/repair条件をbackend内でも検証する。
5. clientのprotocol/build番号は認証証明ではない。古いclientでも偽装可能とみなす。
   gateの任意更新は一切許さず、fresh UIDの安全な固定V2設定以外を生成できないことを保証する。
   V1書込みはserver Rulesで拒否。App Checkだけで特定client versionを証明できるとは扱わない。

## 判定とatomic操作

Auth情報の検証後、Firestore transactionでglobal/policy、既存gate、server-only provisioning receipt、
repair/migration/recovery markerと対象UIDのlegacy/current resourceを読む。全読取をwrite前に行う。

| 状態 | 処理 |
|---|---|
| 有効な既存V2 gate | unchanged。Nodeやreceipt/profileを空にしない。通常syncへ |
| disabled/dual-write/V1/newer/malformed gate | STOP。自動上書き・再有効化・降格なし |
| gateなし、公開開始前のAuth account | migration-required。空でも既存accountを推測移行しない |
| gateなし、新規対象、V1/V2/receipt/profile/recovery存在 | review-required。削除・seed・移行はしない |
| global停止/policy無効・不正/repair中/UID不明 | STOPまたは再試行可能な準備待ち |
| gateなし、新規対象、完全に空、全条件合致 | 固定V2 gateとserver-only receiptを同一transactionでcreate |

固定gateはschemaVersion=1/minimumSyncProtocol=2/v1WritesAllowed=false/v2Enabled=true。
receiptはUID/Auth creationTime/project/policyVersion/protocol/準備時刻を保持し、client write/readを拒否。
親user document不存在だけで空と判断しない。少なくともnodes/nodesV2/profileV2/syncOperationsV2、
external-AI operation/request履歴、syncMetadataの移行/復旧状態と既存inventoryを検査する。
削除済みNode/purged/空本文profileも「存在」。未知の所有データやmarkerがあればSTOP。
実装時には `DATA_MANAGEMENT_MATRIX.md` のinventoryをもとに検査対象を固定し、listCollections等で
未知collectionを検出する。Firestore空queryだけで全scopeのraceが解決するとは扱わない。

raceの成立条件は「gateなしclient writerは厳格なRulesで全拒否」「他のtrusted writerはgate/policyを検証」
「admin migration/repairとonboardingがUIDの排他管理を共用」である。
未知collectionの列挙はtransaction外にもなるため、上記writer統制が成立しない環境では自動準備を有効にしない。
手動Adminが並行で書くことまで無条件安全とは主張しない。

gateをcreate-onlyで作り、同時呼出しはtransaction競合後に既存結果を読んで返す。
自動retryでは既存gateを更新しない。receiptあり/gateなし等の不整合はSTOPし、勝手に再作成しない。
Auth作成とFirestoreは一つのtransactionではない。Firestore準備失敗時もAuth accountを削除せず、
次回同じ認証UIDで再試行。Auth再作成/同メール新UIDでは以前のreceiptを再利用しない。

## client Applicationへの接続

Auth成功 → Account Local open/ready → authenticated provisioning → gateをserver再読取してconnect検証 →
Outbox audit → ownership判定 → 必要時のみAccount Command初回取り込み → 既存V2送信/receipt/1History。

既存recoveryのreceipt auditが通常controller.start以前にもあるため、通常loginだけでなくrecovery再開経路の
Cloud I/O境界を確認して接続する。既存journal復旧をfresh onboardingへ置き換えない。
通常既存V2 accountは有効gateなら準備なしで続行可能。missingの場合だけ専用backendへ問い合わせてもよいが、
offline/権限拒否/壊れたgateをmissing扱いしない。responseだけを信じてgate検証を省略しない。

新規anonymousなし: gate準備後に通常同期。anonymousあり: 現initial ownershipの空確認・限定patch・receiptを使用。
既存Account: 従来sync/ownership確認。別Account: Auth generation/activeScope fencingを保持し、
旧呼出しの応答で新Accountをreadyにしない。anonymous Outboxのコピーやデータのserver provisioningは行わない。

UI: 一時失敗は「クラウド利用の準備中／再試行」。Local編集を維持し、gate成立前は送信禁止。
permanentな安全停止は具体的理由を残す。バックグラウンド無限retryやAuth再登録を要求しない。
restart/response lossは同じUID/同じserviceへ再問い合わせし、既存結果確認後に再開。

## 実装前に固定する回帰条件

- fresh Auth＋空Cloud＋anonymous有/無、profile-only、first-login完了まで。
- old Auth gateなし、既存V1/V2、deleted/purged、profile/receipt/unknown collection、repair/migration中は拒否。
- 有効gate再loginは無変更。disabled/dual/newer/malformed gateとglobal freeze/policy停止は維持。
- unauthenticated/他UID/project/tenant/disabled/revoked/Auth再作成、偽UID・偽protocol、App Check拒否。
- client gate create/update/deleteとgateなしV1/V2 writeが全てRulesで拒否されること。
- transaction失敗、同UID同時実行、応答消失、restart、policy/freeze/remote/admin race、receipt不整合。
- A/B切替中の応答、anonymous原本・metadata・History・Outbox・revision維持、重複初回取り込みなし。
- Web/Android/iPhone PWAのApp Check・Auth・Functions接続、offline復帰、実機の手動準備不要。

## 推奨導入Phase

1. server policy/eligibility/pure decision/receipt契約とinventory・writer排他仕様をレビュー。
2. regression-firstでbackend serviceとAuth/Firestore Emulatorテスト。gate任意更新APIを作らない。
3. 厳格Rulesとclient readiness接続、Application/recovery全経路の回帰。
4. DEVへ限定配備して新規AuthからiPhone/Android/Webで実Firebase検証。
5. 本番配備済みRules/IAM/App Check/課金・region/既存ユーザーinventoryをread-only監査。
   reviewed policy境界、strict Rules配備とwriter統制を証拠化し、production変更は別途承認後。

本件は設計案であり、回帰テスト追加・機能完了・production配備済みを意味しない。#85/#59はOPEN維持。

## Firebase一次資料

- [Callable Functions](https://firebase.google.com/docs/functions/callable): Auth情報とApp Checkを扱う専用endpoint。
- [Auth作成イベント](https://firebase.google.com/docs/auth/extend-with-functions): 非同期補助trigger候補、調査時Preview表記。
- [Auth blocking functions](https://firebase.google.com/docs/auth/extend-with-blocking-functions): Identity PlatformとAuth導線への影響。
- [Server SDKとRules](https://firebase.google.com/docs/firestore/security/rules-fields): Admin/server側はRulesを迂回。
- [Firestore transactions](https://firebase.google.com/docs/firestore/manage-data/transactions): retry/atomic commitと副作用分離。
