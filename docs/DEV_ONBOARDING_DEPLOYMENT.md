# #85 DEV onboarding deployment

10月5日のiPhone PWA回帰は [DEV_IPHONE_ONBOARDING_INVESTIGATION.md](DEV_IPHONE_ONBOARDING_INVESTIGATION.md) を参照。
Cloud配備成功と実機経路の確認は区別する。現在iPhoneのgate不在原因は端末実行情報の追加確認が必要。

## 現在の状態：2026-10-04 Blaze化後のDEV配備完了

対象は `taskmemoapp-dev` のみ。本番 `taskmemoapp-eabc3` への変更は0。#85/#59はOPEN。
以下のBilling停止の記録は再開前の履歴として保持する。

### 配備・設定

- `ensureAccountV2Ready`：asia-northeast1、Node.js 22、2nd gen、ACTIVE。
  revision `ensureaccountv2ready-00001-wus`。MCPは配備していない。
- 専用SA `taskmemo-onboarding@taskmemoapp-dev.iam.gserviceaccount.com`：
  roles/datastore.user、roles/firebaseauth.viewer。credential key発行なし。
- strict DEV Rules：ruleset `fa76f5bf-0d57-48b1-bb4b-9c48c6fe2ccc`。
  実source hashと `firestore.dev.rules` が一致。
- DEV Web AppへreCAPTCHA Enterprise/App Checkを設定。許可domainは
  `taskmemoapp-dev.web.app` / `taskmemoapp-dev.firebaseapp.com`。callableのenforcementを維持。
- `syncControl/onboarding` をexists=false条件付きcommitで新規作成。
  schemaVersion=1、enabled=true、protocol=2、policyVersion=dev-onboarding-20261004、writerFenceVersion=1、
  eligibleCreatedAfter=`2026-10-04T06:25:46.793Z`（15:25:46.793 JST）。既存policy上書きなし。
- DEV Hosting `https://taskmemoapp-dev.web.app`、release `1791095158267000`。
  DEV専用exportの環境名・6設定をbundleで確認。App Check public keyをDEV buildへ反映。
- 必要API有効化、DEV gcf-artifactsの7日cleanup policy。

DEV writer確認：Functionsはこのcallableのみ。既存Admin SDK SAのUSER_MANAGED keyは0。
strict Rulesがungated client/V1 writerを拒否する。人間のOwner/Admin権限を剥奪したものではない。
検証UIDへ並行してAdmin移行・Auth import/削除・復旧を実行しないこと。
このDEV限定確認をproduction writer統制の証明に転用しない。

### 配備中に解決した問題

最初のFunction起動は `Cannot find module 'fractional-indexing'` で失敗。
entrypointが読み込む共通Domainのruntime依存がfunctions/package.jsonに不足していた。
最小回帰テストの失敗を確認し、dependency/lockfileを追加して再配備した。

初回失敗後、Cloud Runのinvoker IAMが空でbrowser通信が拒否された。
このDEV serviceだけに標準callable用 `roles/run.invoker: allUsers` を設定。
公開transportとcallable内部のAuth/revocation/App Check/safety検証を区別する。
Auth/App Checkを省略してprovisioningできるようにはしていない。

### 実Firebase確認

検証専用の新規password accountで、Auth登録 → 実App Check → callable → gate/receipt/lifecycle →
client再検証 → 登録前の匿名Memo取り込み → V2「同期済み」を確認。gate手動作成なし。
readbackでMemo1件、revision=1、sync operation receipt1件。
logout/login後もMemo1件・receipt1件で重複なし。
再loginの一度目はauth/network-request-failed、再試行で成功。永続データは保持。

設定完了後、許可済み `taskmemoapp-dev.firebaseapp.com` の別originで空のanonymous状態を確認し、
もう1つの新規検証accountをUI登録した。再読込や手動設定なしで「同期済み」。
gate/receiptの自動作成とnodesV2=0をCloud readbackで確認。空データにNodeをseedしていない。
実検証用2 accountは削除せず保持している。最初のweb.app originのanonymous原本も消していない。

実User tokenによるgate同値PATCHは403、server receipt読取は403。
Authあり/App Checkなしcallableは401。拒否前後のgate/updateTimeは同一。
既存4 UIDのnodes/nodesV2/profileV2/syncOperationsV2/syncMetadataV2、global controlは変更前後で一致。
既存UIDへのseed・gate修復・削除なし。

### テストと証跡

全体110 files/804 PASS（40条件付きskip）、Functions build/check15 PASS（20条件付きskip）、
別実行onboarding Auth/Functions/Firestore Emulator13 PASS。
TypeScript/lint/Text Format doc check/git diff --check/DEV Web export成功。
今回はFunctions依存修正でclient動作変更なし。
Function ACTIVE/専用SA、Rules source、App Check config、Hosting releaseをCloud再読取で確認。

DEV限定scripts：`dev-onboarding-admin.mjs`、`dev-onboarding-verification.mjs`、`dev-onboarding-live-check.mjs`。
project引数は `taskmemoapp-dev` のみ。`TASKMEMO_FIREBASE_TOOLS_LIB`はFirebase CLIのlib絶対パス。
baseline/policyはcreate-onlyで再実行上書きせず停止。live-checkはこの作業専用検証アカウントを対象にする。
baseline/IAM/Rules原本、配備状態、検証credentials、画面証跡はgitignoredの
`artifacts/private/dev-onboarding/` に保存。secretを文書・Gitへ含めない。

### iPhoneで次に確認する手順

1. Safariで `https://taskmemoapp-dev.web.app` を更新しDEV/V2表示を確認。PWAも終了して再起動。
   storageや既存Nodeは消さない。別preview-channel originは今回App Check未検証。
2. 未ログインで検証Memoを作り、設定 → クラウド同期 → **新しいDEVアカウント**を登録。
   cutoff以前の既存UIDをfresh onboardingの確認に使わない。
3. gate不足なしで「同期済み」になり、匿名Memoが一度だけ取り込まれることを確認。
   remote既存データ等がある場合の正当な安全停止を回避しない。
4. 通常編集と一覧/ツリーのテキスト編集、保存・Undo/Redo・再起動復元を確認。
5. 同一accountへ再loginし重複・消失がないことを確認。
   error時は全文・DEV URL・操作を記録し、storage削除や手動gateで隠さない。

未確認：iPhone実機PWA、複数実機同期、Android attestation bridge、production実配備/IAM/Rules/writer統制。
DEV Web App Check成功をNative attestationやproduction公開承認として扱わない。

## 履歴：Blaze化前の停止地点

2026-10-04。要求された対象は `taskmemoapp-dev` のみ。productionへの書込みは禁止。
今回preflightは読み取り専用で実施し、外部環境への変更は実行していない。

## 実Cloudの確認結果

| 項目 | 結果 |
|---|---|
| Firebase project | taskmemoapp-dev / ACTIVE |
| Project number | 1045397314197 |
| Hosting site | taskmemoapp-dev |
| Web App | 1:1045397314197:web:4306f8798dde332d7c599c |
| .env.local | development / taskmemoapp-dev |
| billingEnabled | false |
| billingAccountName | 空（紐づけなし） |
| Cloud Functions API | 未有効、list APIはSERVICE_DISABLED |
| reCAPTCHA Enterprise API | 未有効、list APIはSERVICE_DISABLED |
| 専用onboarding service account | 未準備 |
| Firestore Rules release | 既存release、最終更新2026-09-19T07:28:52.970179Z |

停止理由はBilling未設定。Firebase Functionsの実DeployにはBlazeが必要。
課金アカウント紐づけを今回のDeploy指示だけで勝手に行わない。
Functions/Rules/Hostingの部分Deploy、policy有効化、App Check設定、既存UID gate作成は行わなかった。
データ削除・移行・既存gate更新もなし。変更がないためCloud rollbackは不要。

## 再開に必要なユーザー操作

Firebase Consoleで **taskmemoapp-dev** の使用量/請求を確認し、利用する課金アカウントを決めて
Blazeへ変更する。productionの課金・Firebase設定を操作しない。
費用と予算通知を確認してから行う。無償枠内の利用でもBilling紐づけがDeploy前提。

## Billing準備後の配備順（今回未実行）

1. project/billingEnabledを再読取。DEVの既存Rules/control/policy/IAM/App Checkを非公開backupし、
   updateTime/etagを持って並行変更を検出する。対象を明示しCLI defaultは使わない。
2. DEV専用service accountを作成し、Auth user read/Firestore transaction等の最小権限を設定。
   Admin writer統制と専用IAMを確認するまでpolicyをenabledにしない。
3. Functions/Cloud Run/Cloud Build/Artifact Registry/App Check/reCAPTCHA等の必要APIをDEVだけ有効化。
4. score-based reCAPTCHA Enterprise keyをDEV Web Appへ登録。
   DEV Hosting/iPhone PWAで実際に使うoriginを許可し、production originのキーを再利用しない。
   App Check enforcementを解除して通さない。site keyをDEV buildへ反映する。
5. DEV専用Firebase configにfunctions source/runtimeを追加し、専用service accountのenvを準備。
   project=taskmemoapp-dev/config=DEVを再確認して、`functions:ensureAccountV2Ready`だけDeploy。
   MCPやproduction Functionsを対象に含めない。
6. strict DEV RulesをDeploy。gate/policy/receiptのclient create/update/delete拒否を疎通で確認。
   既存DEV gate/global/Node/profileを不用意に変更せず、既存accountの回帰を確認する。
7. cutoff/policy version/writer統制を確認してDEV server policyを新規準備。
   既存policyがあれば上書きせず差分をレビュー。eligibleCreatedAfterは新規検証UIDより前、
   既存UIDをfreshと誤認しない境界にする。
8. DEV専用Web exportのproject/App Checkキーを検証してDEV HostingへDeploy。
   現在のdistはproduction export由来の可能性があるため、そのままDEVへDeployしない。
9. 検証専用の新規DEV Auth accountで実App Check→callable→gate/receipt→初回同期を確認。
   検証UIDのデータだけを扱い、既存UIDをseed・修復・削除しない。
10. Functions state/IAM、Rules source hash、App Check config、policy、gate/receipt/同期状態を再読取して記録。

## iPhoneの次の確認

現時点では新しい配備はない。Billing準備とDeploy完了の報告を待ち、storageは消さない。
配備完了後はDEV PWAを更新し、**新しいDEVアカウント**を作成する。
既存UIDはcutoff対象外になり得るため、新規自動onboardingの証明に使わない。
gate不足エラーなし、初回取り込みの欠落/重複なし、再loginで再取り込みなしを確認。

## 未確認事項

実App Check、DEV callable/Rules/IAM配備、実Firebase新規登録から同期、iPhone PWAは未検証。
Android attestation bridge、production実Rules/IAMは引き続き公開前条件。
#85/#59はOPEN。今回Cloud書込みはDEV/PRODとも0。

一次資料: [Functions DeployにはBlazeが必要](https://firebase.google.com/docs/functions/get-started)。
