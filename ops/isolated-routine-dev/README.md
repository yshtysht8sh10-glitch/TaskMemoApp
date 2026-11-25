# Routine実機受入用・隔離DEV準備／Owner承認資料

作成日: 2026-11-26。状態: **提案・オフライン準備のみ。作成・公開・配信の承認待ち**。

## 1. 固定対象と現在の停止条件

アプリ基点は `c8a7fb858aebb34fd07ef1f8c2bfbd87b805d6c1`（#142）。
`007b2df750e6d9ed831a755a23e3ac279383f0cd`（#140）→
`74aad5f9731056aee01a1063f77f47c58f80ae99`（#141）→#142の祖先関係をGitで確認する。
本ブランチはその基点から作成し、製品コード、root Rules、Functionsを変更しない。
#139の未達保存・同期変更、共有DEVのQueueを取り込まない。

**重要なBLOCKER:** 固定版の `src/services/firebaseConfig.ts` と
`scripts/verify-firebase-environment.js` はdevelopment接続先を `taskmemoapp-dev` に限定している。
新Projectの環境変数だけでは実通信できない。`test`環境も実Firebase接続を拒否する。
したがって「無変更の固定SHA」と「新Projectでの実同期」を同時に満たせない。
新Project IDを明示的に許可する最小限の環境ガード対応を、別承認・別レビューへ出す必要がある。
prefix全許可、既存ガード解除、ビルド後JSの書換えは行わない。
`verify-firebase-web-export.js` がStorageBucketを必須とする点も別途整理する。
アプリはStorageを使用しないため、チェックを通す目的でStorageリソースを作らない。

将来の成果物manifestには applicationBaseSha、環境対応commit、公開Firebase設定hash、Rules hash、
bundle hashを別々に記録する。環境対応を含む版を無変更のc8a7fb8と表示・報告しない。
Ownerが固定版の変更を許可しなければ、ここで停止しローカル検証のみとする。

## 2. 推奨構成

| 項目 | 提案 | 現状 |
|---|---|---|
| Project ID | `taskmemo-routine-qa-20261126` | 未作成・世界一意の空き未確認 |
| 代替ID | `taskmemo-routine-qa-1126a` | 未作成・空き未確認。変更時は再承認 |
| Hosting | `https://taskmemo-routine-qa-20261126.web.app` | 候補。公開していない |
| Auth domain | `taskmemo-routine-qa-20261126.firebaseapp.com` | 候補 |
| Firestore | Native `(default)` / `asia-northeast1` | 未作成。位置は作成前に確認 |
| Auth | 新ProjectのEmail/Password、使い捨てUID最大2件 | 未作成 |
| 料金 | Spark、Billing accountをリンクしない | 課金操作なし |
| Functions / Storage / Analytics | 配備・有効化しない | 不要の想定。実環境検証は未実施 |

同一Project内の別Web AppではAuth／Firestore等を共有するため、既存DEV内のApp追加では隔離しない。
新Project・新Web App・新Authユーザー・新DB・新Hosting site・新originを使用する。
既存の `.firebaserc`、default alias、共有DEV、Production、main/releaseは変更しない。
Project番号・ID・Web App ID・DB位置・Hosting siteを承認記録と照合してから次工程へ進む。

## 3. アクセス制限と残リスク

推奨案は**静的HTML/JSのURLは公開、テストデータはAuth＋UID allowlist＋所有者照合で制限**する。
Firebase Hosting標準の静的配信では、アプリのログイン画面はHTML自体のアクセス制御にならない。
preview channelもURLを知れば閲覧できる。`noindex`や難読URLは認証ではない。

候補Rulesは基点Rulesの所有者判定にテスターUID allowlistとpassword provider条件を追加する。
syncControlの読取りも同条件に限定する。既存protocol 2、repair lock、record validation、
receipt不変性、clientの制御doc書込み禁止を維持する。UID未指定時は拒否する。
allowlist外UIDは、自分の領域でも読み書き不可。別テスターUIDの領域も不可。
Admin権限はRulesを迂回するため、管理者権限・操作ログも新Projectだけで管理する。

API key・公開Firebase設定は秘密鍵ではない。パスワード、管理者token、service account鍵、
実ユーザーのバックアップやタイトルはbundle・Git・Issue・ログに入れない。
テスト用パスワードは秘密管理手段で受渡し、UIDと作成日・用途・廃止日だけを台帳へ記録する。
Authの新規登録悪用・クォータ消費はRulesだけでは防げない。短期公開、利用状況確認を行う。

**HTML/JS自体の非公開が必須なら、このHosting案は採用しない。** VPN／認証gateway等を別設計し、
費用・PWA origin・Auth遷移への影響を独立レビューする。IAP等が今回準備済みとは扱わない。

## 4. Functionsなしの初期化案

`firebaseSyncAdapter.connect` は有効な既存compatibility gateがあればonboarding callableを呼ばない。
既存 `firebaseOnboardingConnect.test.ts` の対応ケースを回帰確認した。
新Projectの管理者が、承認後に以下だけを事前登録する案とする。

```json
{"path":"syncControl/current","value":{"schemaVersion":1,"writesEnabled":true}}
```

各使い捨てUIDについて:

```json
{"path":"users/<disposable-uid>/syncMetadataV2/compatibility","value":{"schemaVersion":1,"minimumSyncProtocol":2,"v1WritesAllowed":false,"v2Enabled":true}}
```

これは既存protocol 2。#117のmissed／新capability／protocol変更は行わない。
gateが不足・不正、またはFunctionsが必要になった場合は停止する。
Functionsを勝手に配備したり、Blazeへ変更したり、ゲートを迂回しない。
既存FunctionsにもProject allowlistがあるため、そのまま新Projectへ流用できるとは扱わない。
新環境の実SDKでこの経路が成立することは、作成承認後の受入項目である。

## 5. ローカル準備物と事前チェック

`plan.json` は未承認案。`prepare.mjs` はネットワーク・Firebase SDK・認証情報を使わず、
固定祖先と製品差分を検査し、候補設定とhashを生成する。配信コマンドは実行しない。
`ownerApproved:true` に変えると拒否する。承認は別のOwner記録として残す。

```powershell
node ops/isolated-routine-dev/prepare.mjs --check
node ops/isolated-routine-dev/prepare.mjs --render D:/working/TaskMemo/artifacts/isolated-routine-dev-plan/generated
node node_modules/vitest/vitest.mjs run ops/isolated-routine-dev/prepare.test.mjs src/services/firebaseConfig.test.ts src/sync/firebaseOnboardingConnect.test.ts --maxWorkers 2
```

render先は新規ディレクトリ。既存ファイルは上書きしない。生成物:
`firebase.isolated.json`、`firestore.isolated.rules`、`firestore.closed.rules`、
`.env.isolated.example`、`bootstrap-spec.json`、`fixture-spec.json`。
生成configは同じディレクトリの `dist` を参照する。承認後の検証済みexportをそこへ置く。
envはPENDINGを含む非実用テンプレートであり、既存環境の設定をコピーしない。

今回結果: **3ファイル・31テストPASS、skip 0**。候補生成、固定祖先、製品差分なしを確認。
生成Rulesの文字列契約チェックは実施したが、Rules Emulatorコンパイル・実Rules権限試験は未実施。
新Project実SDK、Auth、端末間同期、iPhone、実配信、実機性能は未実施。
製品変更がないため本準備で全体製品テスト／Webビルドは再実行していない。
過去のPR142の合成性能結果を実iPhoneの測定値として扱わない。

## 6. 承認後の作成・配信手順（今回は実行しない）

1. Ownerが下記承認表を確定する。新Project IDの空きを確認し、違うIDなら再確認する。
2. Firebase Consoleで新ProjectをSpark／Analyticsなし／Billingリンクなしで作成。
   Project IDと番号を台帳へ保存し、既存DEV／Productionと違うことを二人で照合する。
3. 新Web Appを登録し、新Projectの公開設定だけを取得。秘密鍵ファイルを発行・保存しない。
4. FirestoreをNative/Tokyoで作成。最初はtest modeではなくdeny-all Rulesにする。
   AuthはEmail/Passwordだけ有効化し、使い捨てUIDを管理者が作成する。
   同期確認にはiPhone/PCで同じテストUIDを使用し、別UIDを権限否定試験に使う。
5. 新Project Consoleで前節のcontrol/gateだけを作成し、読み戻して照合する。
   誤ったProject、既存ユーザーのUID、未知のdocがあれば停止する。
6. 別承認・レビュー済み環境ガード版を用意する。公開設定とコードの接続先が一致することを確認。
   新環境向けの型チェック・Lint・focused／関連回帰・ビルド・export検査を実行する。
   manifestと全配信ファイルhashを凍結する。
7. Rules Emulatorで構文、未認証、allowlist外、別UID、不正provider、control/gate書込み、
   receipt上書き拒否、正常protocol2操作、writesEnabled=falseを検証する。
   新UIDを反映したRulesを再生成し、元Rulesとの差分が制限追加だけであることをレビューする。
8. OwnerがRules適用・静的公開を承認した後のみ、新Projectを明示して個別に実行する。
   以下は将来のコマンド例。既存rootのfirebase.json/default aliasは使わない。

```powershell
# 生成ディレクトリに検証済みdistがあることを先に確認する。
firebase deploy --project taskmemo-routine-qa-20261126 --config <absolute-generated-dir>/firebase.isolated.json --only firestore:rules
# 新Projectで許可/拒否、設定、配信hashを確認後:
firebase deploy --project taskmemo-routine-qa-20261126 --config <absolute-generated-dir>/firebase.isolated.json --only hosting
```

9. 新URLのbuild SHA／manifest／Service Worker／Hosting releaseを読取り確認する。
   bundleの接続先・Auth UID・DB Projectを確認し、既存Projectへの通信があれば即停止する。
   新Project内だけで合成データを投入し、以下の受入を実施する。
10. 全チェックを記録し、OwnerのiPhone確認を待つ。Production配信／merge／Closeは行わない。

## 7. 合成データと実機受入

本番・共有DEVのexport／backup／IndexedDBを一切持ち込まない。新Project由来の空状態から、
合成Routineと完了／スキップ実績を既存モデルで用意する。missedの製品保存はしない。
保存済み実績の対象日と操作日時をずらしたケース、同名別Routine、周期変更前後を含める。
件数は0/1/7/8/50/51/125。5,000件は別の負荷確認ケースとして日常規模と分ける。
投入前にNode/receiptの実シリアライズサイズがFirestoreのdoc制限内か確認する。
実績件数はdoc件数と同義ではない。巨大データを通常受入へ混ぜない。

| 実機確認 | 合格条件 |
|---|---|
| 毎日→毎週（逆方向・月/年も別ケース） | 旧日次実績が保存済みの日付で残り、完了一覧と一致 |
| 今日・未来・空の過去 | 今日の未処理だけ「-」。未来予定／未記録過去日は増えない |
| 7→50→全件→7 | 降順、欠落・重複なし、縮小可能 |
| 閲覧のみ | 正規化した対象Node/実績内容が前後一致し、新規操作/receipt/Outboxが発生しない |
| 展開中の本文編集 | キーボード・カーソル・保存・スクロール・モーダルが操作可能 |
| 大量データ | 展開後に操作不能にならず、縮小後も応答。実機時刻/端末/件数と測定を記録 |
| 再起動・別端末 | 同じテストUIDで履歴保持。新Project以外への通信なし |

観察前に初回同期を静止させ、独立したテスト操作やlistener再接続と履歴閲覧を混同しない。
閲覧前後の比較用exportも新Projectの合成データだけを取得する。
iPhoneのProduction PWAの初期化・再ログイン・強制同期は行わない。
新originのテストをProduction PWA更新と混同しないようラベルとURLを記録する。

## 8. 費用と運用上限

推奨はSpark・Billing未リンク。無料枠内を想定した支出見積りは**0円**。
実利用量は未計測であり、無制限利用を保証しない。BillingリンクはBlazeへの変更になるため別承認。
公式料金表ではHostingの無料枠は保存10GB・転送360MB/日。
Firestoreは保存1GiB、読取り50,000/日、書込み20,000/日、削除20,000/日、外向き10GiB/月。
listener・Rules依存読取り・再接続を含めて確認する。
Functions、Phone Auth、Storage、Cloud Run、TTL、PITR、managed backup等は今回使わない。

仮にJSのみ3.9MBならキャッシュなし50回で約195MB、100回で約390MBとなり他assets前に枠を超える。
これは計算例であり今回bundleの確定測定ではない。まず2端末・計20回程度を上限目安にし、
実bundle量とConsole使用量から再評価する。no-storeにより再取得量が増える点にも注意する。
クォータ到達で止まった場合、勝手に課金へ切替えない。将来Blazeでも予算通知は支出上限ではない。

公式根拠（2026-11-26調査）:
[料金表](https://firebase.google.com/pricing)、
[Firestore quota](https://firebase.google.com/docs/firestore/quotas)、
[料金プラン](https://firebase.google.com/docs/projects/billing/firebase-pricing-plans)、
[Project内の共有資源](https://firebase.google.com/docs/projects/learn-more)、
[preview URLの公開性](https://firebase.google.com/docs/hosting/test-preview-deploy)。

## 9. 停止・後片付け（将来の別承認操作）

異常時はテストを停止し、新ProjectのwritesEnabledをfalse、deny-all Rules適用、
テストUIDの無効化／session失効、Hosting停止を新Projectだけに行う計画とする。
実行時のCLI helpでsite/projectの指定を確認し、既存aliasを使わない。
AdminはRulesを迂回するため管理操作・実行中処理も止める。
既存DEV/ProductionのUID、権限、API key、保存領域は触れない。

受入終了後7日を保持目安とし、合成テスト結果とmanifestだけを保存する。
OwnerがProject ID・番号を再照合し、削除を明示承認した後、新ProjectをConsoleから削除する。
削除の即時完了・即時全消去は保証せず、Consoleで状態を追跡する。
Hosting停止／Project削除で、端末に残るオフラインPWAを遠隔消去できるとは扱わない。
端末のテストorigin片付けもOwner確認後に別手順とし、実ユーザーデータの初期化は行わない。

## 10. Ownerの判断・承認事項

| ID | 具体的な判断 | 現状 |
|---|---|---|
| A | 第一候補Project、Spark/Billing未リンク、Tokyo、Password Auth、使い捨てUID最大2、deny-allから作成 | 未承認・未実行 |
| B | c8基点を保ち、新IDの明示許可／export検査だけを別commit・別レビューする | 未承認・製品変更なし |
| C | HTML/JSの公開を許容するか。許容時のみUID限定RulesとHostingへ配信 | 未承認・未公開 |
| D | 新Project内の合成データ投入・読取りとiPhone/PC受入 | 未承認・未実施 |
| E | 受入後の停止、UID失効、7日目安のProject削除をいつ承認するか | 後続承認 |
| F | Blaze/Functions/非公開gatewayが必要になった場合 | 今回案に含めず再設計 |

今はA〜Dの対象確認までで停止する。作成と配信を一括で既承認扱いにしない。
#117は設計承認と実装承認を区別し、R01〜R18、旧writer保護、能力gate製品実装は未実施のまま。
Production配信、main/release merge、Issue Closeは本資料の承認範囲に含めない。
