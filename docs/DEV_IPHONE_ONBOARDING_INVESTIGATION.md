# #85 DEV iPhone PWA onboarding調査（2026-10-05）

対象：最新 [Issueコメント](https://github.com/yshtysht8sh10-glitch/TaskMemoApp/issues/85#issuecomment-5995855752)。
調査はDEV Cloud read-only。gate手動作成、policy/Rules/IAM変更、データ削除、Cloud deploy、production変更なし。
#85/#59をCloseしない。原因未確定のため、推測によるruntime修正・安全条件の緩和は行わない。

## 一次情報で確認したこと

Auth一覧に10月5日22:47:23.670 JST作成（UID末尾`wgY62`）、22:49:56.871 JST作成（末尾`pAJ2`）のpassword accountがある。
どちらもgate・accountProvisioningV2 receipt・accountLifecycleV2がない。
users配下のcollection一覧も空で、nodes/nodesV2/syncOperationsV2は0。
どちらがコメント対象の端末に対応するかはAuth情報だけでは断定しない。両方を保護して調査した。
全UID等の原本はgitignoredの `artifacts/private/dev-onboarding/iphone-20261005.json` に保存。

追加スクリーンショットの表示アカウントをDEV Auth一覧と完全一致で照合し、対象はUID末尾`pAJ2`と確認。
Auth作成/最終loginはともに22:49:56.871 JST。gate/receipt不在を再確認。
22:45〜23:00 JSTのcallableログ0件（nextPageTokenなし）。この画像がSafariの再確認結果か、元のPWA画面かは画像だけでは判別できない。
原本はprivateの `iphone-screenshot-account.json` に保存し、メールアドレスを文書へ転記しない。

Cloud Logging `resource.type=cloud_run_revision`、service=`ensureaccountv2ready`、
2026-10-05T13:40:00Z〜14:00:00Zのqueryにentries/nextPageTokenなし。
対象2回のsignupを含む時間帯に、このserviceへの到達・App Check拒否・handler実行ログは観測されなかった。
ログなしだけで端末から通信を試みなかったと断定はしない。
正の対照として10月4日のログを読み、06:27:34Z/06:35:00ZのHTTP200、Auth VALID/App VALID、
テストによるHTTP401/App MISSINGを確認した。ログ自体が取得不能という状態ではない。
時間範囲queryと対照ログはprivate artifactsへ保存。
一度Logging API共有quotaの429が発生したため、即時連打せず時間を置いて狭いqueryで取得。

DEV Function ACTIVE。Cloud Run IAMはroles/run.invoker:allUsers（callable transport用）。
App Check reCAPTCHA Enterprise configは既存DEV key、tokenTtl=3600s、minValidScore=0.5。
strict Rulesは10月4日配備ruleset `fa76f5bf-0d57-48b1-bb4b-9c48c6fe2ccc` のまま。
policy enabled=true/protocol=2/writerFenceVersion=1、cutoff=2026-10-04T06:25:46.793Z、global writesEnabled=true。
今回の2 Authはcutoff以後。legacy-account/nonempty-accountとして拒否された証拠はない。
App Checkの実機token取得結果は端末側の情報がないため未確認。設定があるだけで実機attestation成功とは扱わない。

## Hostingと実機コードの区別

Hosting最新releaseは10月4日の `1791095158267000`。
現在のDEV GET `/` は `entry-d6c136d525af041e62a67dab33a4434e.js` を参照。
実配信bundleには `ensureAccountReady`、`ensureAccountV2Ready`、DEV App Check public keyが含まれる。
前の9月18日releaseのentryは `entry-45584350fed7ce8963da15b0e73b7218.js`。
ただしiPhoneが実際に実行したscript URL/bytesは未取得。現在の配信内容で端末の実行内容を代用しない。

service-workerは同origin GETをnetwork-first、network失敗時のみCache Storageへfallbackする。
cache名はtaskmemo-shell-v1。既に開いているPWAをforegroundへ戻すことはnavigation/reloadとは限らない。
現在HTMLはHosting標準cache-control:max-age=3600。cache/resumeは候補だが実機証跡なしに原因と確定しない。
Build表示はGit SHA由来。未commitの変更を識別できず、同じSHA表示だけではbundleの一致を証明できない。
storage/Service Workerを消して検証を通すことはしない。

## signup・race・エラー経路

createUserWithEmailAndPassword → onAuthStateChanged → authChanged → adapter生成。
通常hookはensureAccountReady callbackを渡し、UID/generationを確認してprepareFirebaseAccountへ進む。
adapter.connectはglobal server read → gate server read → 不在時await callback → gate server re-read → strict validation。
controllerはconnect完了後にOutbox audit/ownership/import/subscribeへ進む。
callableのready応答はprovisionAccount transactionの完了後。
gate/receipt/lifecycleは同一transactionのcreate-only作成。

報告された文言は `validateCompatibilityGate(undefined)` が発生源。
現在のコードでは、callbackなしで不在gateを検証する場合、またはcallback正常終了後もserver gateが不在の場合に出る。
App Check/callable失敗は別エラーとして伝播し、通常この文言へ置き換えられない。
今回のgate/receipt欠落・service到達ログなしは、正常onboardingが完了した後のgate読取raceを支持しない。
旧bundle/実機でcallbackが有効でない経路が有力候補だが、端末の実行コードは未確定。

## 検証

追加 `src/sync/firebaseOnboardingConnect.test.ts`：
1. callback待機中にgate再読取を先行しない。
2. callback完了後serverから再取得して検証。
3. App Check/callable失敗をgate不在エラーへ置き換えない。
4. callback後も不在ならfail-closed。
5. callbackなしで報告文言を再現。
6. 既存gateで不要なprovisioningを行わず、Firestore read failureを不在として扱わない。

この調査テストは現在実装の経路を確認するもので、端末未再現のbugを修正済みとは扱わない。
focused 9 PASS（client契約3を含む）。全体111 files/810 PASS（40条件付きskip）、TypeScript/lint/diff-check成功。
runtime変更なし。

## 次の切り分け

ユーザーよりSafariで同期成功との報告を受領。その後DEV readbackでは、23:28:33.797 JSTに
UID末尾`wgY62`のlogin更新・gate作成を確認。一方、画像で特定した末尾`pAJ2`は
最終login22:49:56.871のまま、gate不在。SafariとPWAは別UIDであり、同一account比較が成立したとは扱わない。
両者は当日に作成されたpassword account。Safari成功のreceipt/log原本をprivate artifactsへ保存。

同じiPhoneでSafariにDEV URLを開き、**失敗した既存アカウント**でログインした場合を比較する。
新規Auth追加や手動gate準備は不要。backendの安全判定を通して正常準備される場合だけ同期する。
Safari成功/PWA失敗なら実機PWAのscript/resume/cache情報を確認。
Safariでも失敗なら、実行bundle URLとonboarding到達段階、App Check/codeを端末から取得し、
同時刻Functions logsと照合する。新規callback診断を追加する場合もUID/title/body/tokenを外部ログへ流さない。
未取得情報を推測で補ってApp Checkを緩和・gate自己承認・部分同期してはいけない。
