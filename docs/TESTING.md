# TaskMemo testing guide

この文書は、テスト数を増やすこと自体ではなく、実際の操作で起きた回帰を再発させないための開発手順を定めます。自動テストで保証できる範囲と、Web / Android実機で確認すべき範囲を分けて扱います。

## 必須の開発順序

### バグ修正

1. 報告された操作を、可能な限り小さい再現テストにする。
2. 修正前にそのテストだけを実行し、想定した理由で失敗することを確認する。
3. 現象ではなく原因を特定し、その原因に対する最小の修正を行う。
4. 再現テストを再実行して成功を確認する。
5. 同じ責務を持つ関連テストを実行する。
6. 全テスト、TypeScript、Lint、`git diff --check` を実行する。
7. Webへ影響し得る変更ではproduction exportを実行する。
8. 自動化できない項目をWeb / Androidの手動確認項目として残す。

再現テストがプロダクト仕様ではなく誤った前提で失敗した場合は、実装をテストへ合わせません。前提を調査し、テストを直した理由を作業記録に残してから続行します。

### 新機能

受け入れ条件を、実装前または実装と同時にテストケースへ対応付けます。正常系だけでなく、旧データ、空状態、境界値、失敗時の状態保持、Undo/Redo、同期後の状態も検討します。

既存の有効なテストを、変更を通す目的で削除・skip・期待値の弱体化をしてはいけません。仕様変更により期待値を変える場合は、変更理由がIssueまたはコミット差分から追跡できる状態にします。

## テストの層

Ownership sortKey統合: `src/sync/ownershipSortKeys.test.ts` と `ownershipApplication.test.ts` は
独立scopeの正常rank衝突、最小キー変更、metadata/原本保持、1 History、atomic失敗、remote競合、partial再開を検証。
匿名化実機条件は `src/sync/fixtures/iphoneOwnershipRanks.ts` に置き、非提供contentはsyntheticと明記。
契約は `docs/OWNERSHIP_SORTKEY_INTEGRATION.md`。
診断scriptのテストは `npx vitest run scripts/analyze-ownership-ranks.test.mjs`（全体npm testにも含む）。

`src/sync/firebaseOnboardingConnect.test.ts` は実SDK adapterのconnect境界をmock server readで確認する。
trusted callbackのawait/server再取得、callable失敗の伝播、callbackなしのgate不在再現、read failure時の非provisioningを検証。
iPhone実機の実行bundle/attestationをこのunit testで証明したとは扱わない。

Functions Cloud配備時の回帰：`functions/src/onboarding/deploymentDependencies.test.ts` は、
Functions entrypointが共通Domainから読み込む `fractional-indexing` をruntime dependencyとして含むことを確認する。
親workspaceのnode_modulesで隠れていた不足は、2026-10-04 DEV Cloud Run起動失敗で判明した。
このテストの失敗→dependency追加→Functions check/全体/Emulator成功→DEV再配備を確認。
実FirebaseのAuth/App Check/Rules/IAM疎通はunit testの代替ではなく、DEV配備記録に結果を残す。

- Domain unit: Node操作、期限判定、Routine、選択集合など、UIに依存しない規則。
- State transition: ドラッグ、インライン編集、入力欄可視化などの状態遷移を純粋関数へ分離して検証。
- Regression scenario: ユーザーの連続操作や複数端末同期を、複数モジュールをまたぐシナリオとして検証。
- Persistence round-trip: 保存・読込、Firebase codec、JSON export/importで意味が維持されることを検証。
- Manual smoke: ブラウザのレイアウト、タッチ、キーボード、実Firebaseなど、自動テストだけでは保証できない挙動。

## 現在のテスト配置

| 領域 | 主なテスト | 保証する内容 |
| --- | --- | --- |
| Undo / Redo | `src/domain/nodeHistory.test.ts`, `src/domain/regressionScenarios.test.ts` | 履歴上限、redo破棄、連続した追加・編集・移動・期限・完了、Category subtree削除、Routine occurrence完了 |
| Node / Tree | `src/domain/nodeOperations.test.ts`, `treeDrop.test.ts`, `treeView.test.ts`, `nodeSelection.test.ts` | CRUD、親子関係、sortKey、cycle防止、drop先、選択集合の正規化 |
| 期限・一覧 | `src/utils/dueDates.test.ts`, `deadlineView.test.ts`, `viewPreferences.test.ts`, `countBadge.test.ts` | 期限グループ、表示粒度、グループ設定、件数バッジの発火条件 |
| Routine | `src/domain/routine.test.ts`, `completionHistory.test.ts` | 日・週・月・年の発生、月末等の境界、Occurrence完了・取消、旧データ移行 |
| Firebase同期 | `src/services/firebaseNodeCodec.test.ts` | 更新時刻の競合解決、tombstone、欠落Node、A→cloud→B→cloud→Aの往復 |
| 端末保存 | `src/storage/nodeStorage.test.ts` | AsyncStorage形式、Date復元、旧データ互換性 |
| import / export | `src/services/nodeBackup.test.ts` | 全フィールド、Task / Idea、Routine、tombstoneを含むJSON round-tripと入力検証 |
| 入力・操作 | `src/utils/inlineTitleEdit.test.ts`, `focusedInputVisibility.test.ts`, `dragActivation.test.ts` | 確定/取消、keyboard viewport補正、ドラッグ開始条件 |
| 外部AI | `src/services/taskMemoApplicationService.test.ts` | tool入力検証、Node操作への変換、失敗時の扱い |
| Text Format #59 | `src/textFormat/textFormat.test.ts`, `src/sync/textEditApplication.test.ts` | pipe syntax、pure validation、session/ref、tree/list差分、metadata保護、1保存History、Outbox、原子的保存失敗、production-derived fixture |
| Text UI #59 Phase 5–6 | `src/textFormat/textWorkspace.test.ts` | @root/@routine、Routine整合性、Occurrence除外、読取Viewのcheckbox/投影、セル変更、新規/削除、invalid dirty editの破棄 |

テストを追加するときは、UIコンポーネント内へ複雑な判定を閉じ込めず、既存設計に自然なら純粋な状態遷移へ切り出します。ただし、表示崩れや実ブラウザ固有動作までunit testで保証したことにはしません。

## 重点回帰シナリオ

### Undo / Redo

`regressionScenarios.test.ts`では、次の主要操作が一続きの履歴として元へ戻り、同じ状態へ進み直せることを保証します。

- Memo追加
- タイトル・本文編集
- Category移動とsortKey保持
- 期限変更
- 通常Memo完了
- Categoryと子孫の一括削除・復元
- RoutineDefinitionを完了扱いにせず、当日のOccurrence履歴だけを完了・取消

新しい操作をUndo対象にした場合は、単独テストだけでなく、前後に別操作がある連続シナリオへ追加できないか検討します。

### Firebase競合

codecテストでは、同一NodeをA端末で更新してcloudへ送り、B端末が受信・更新・再送し、A端末が最新状態を受信する流れを固定時刻で検証します。削除・purge・Routine履歴ではtombstoneが古いデータに負けないことを個別に検証します。

Firestore SDK、認証、ネットワーク切断、実端末の購読タイミングはcodecテストの範囲外なので、リリース前に実Firebaseを使った複数端末確認を行います。

### 日付とRoutine

テスト内では現在時刻に依存せず、ローカル日時を固定します。少なくとも開始日の0時直前/直後、月末、うるう日、週や月をまたぐケースを維持します。timezone依存の仕様を追加した場合は、CIのtimezoneに偶然依存しない入力と期待値にします。

### import / export

round-tripは `export → JSON文字列 → import` 後に、Node種別、日時、親子関係、sortKey、Task/Idea、Routine、削除tombstoneの意味が失われないことを確認します。旧バックアップ互換を変える場合は、旧fixtureを消さずに追加します。

## コマンド

変更中は対象だけを短く実行します。

```powershell
npx vitest run src/domain/regressionScenarios.test.ts
npx vitest run src/services/firebaseNodeCodec.test.ts src/domain/routine.test.ts
```

完了前はリポジトリルートで以下を実行します。

```powershell
npm test
npx tsc --noEmit
npm run lint
git diff --check
npm run web:export
```

Text Format変更時は追加で `npx tsx scripts/generate-text-format-docs.ts --check` を実行し、
syntax定義と `docs/TEXT_FORMAT_REFERENCE.md` の同期を確認する。

Cloud Functionsへ影響する場合は追加で実行します。

```powershell
npm run functions:build
npm run functions:test
```

## 手動スモークテスト

変更領域に応じて、最低限次を確認します。

- PC Web: 一覧/ツリー/完了/ゴミ箱、マウスドラッグ、欄外クリック、Enter/Escape。
- iPhone Safari/PWA: ソフトウェアキーボード表示中の入力欄、viewport復帰、タッチ操作、下部固定UI。
- Android: 長押しとドラッグ、戻る操作、キーボード回避、実機のスクロール。
- Firebase: オフライン復帰、同一Nodeの2端末更新、削除・復元・purge、再ログイン後の再同期。
- Backup: 現在データのexport/importと、旧バックアップの読込。

自動テストが成功しても、該当する手動項目を未確認のまま「実機確認済み」と記載しません。

## #85 common Local V2

production onboarding: `npm run test:onboarding:emulator` は固定demo projectのAuth/Functions/Firestoreで
登録からgate/receipt/initial ownership/V2送信を実行する。live projectで実行しない。
通常testのskipとは別に13統合ケースを実行済み。client自己承認拒否、atomic failure、response loss/retry、
restart、A/B分離、停止gate/legacy/非空/未知inventoryの拒否を検証する。

新規Account初回ownershipの回帰は `src/sync/initialOwnership.test.ts`、UI判定は
`src/sync/ownershipPresentation.test.ts`、login/logout接続は `useTaskMemoSync.native.test.ts`。
空の判定にはserver由来の全Node/profile/receiptとAccount Localの双方を用いる。
profile-only、Account-only選択後の変更、source変更、最後の確認後の同ID remote race、
atomic失敗、response loss/restartを検証する。Firestore Emulatorでは新規取り込みreceipt冪等と
未設定compatibility gate拒否を確認する。gateのclient補完や本番deployをテスト手順に含めない。

`ownership* / localApplication / localV2Application / legacyMigrationRecovery / useTaskMemoSync.native`
が所有者分離・移行・atomic失敗・部分成功・logout・未ログインtextを検証する。
`docs/fixtures/local-v1-inactive-legacy.json`はDEVで実際に拒否された削除済みlexical rankの匿名化例。
有効Nodeのrank条件を変更せず、原本・未知field・非表示Nodeを保持することを検証する。
Firestoreのstrict race/receipt冪等は`firebaseEmulatorV2.e2e.test.ts`。
実Firebaseを使わず、`demo-taskmemo-v2` / Firestore port 8180へ限定する。
PowerShellで`TASKMEMO_EMULATOR_E2E=1`を子プロセス環境へ設定し、
`firebase-tools emulators:exec --config firebase.emulator.json --project demo-taskmemo-v2 --only firestore`
から`node node_modules/vitest/vitest.mjs run src/sync/firebaseEmulatorV2.e2e.test.ts`を実行する。
実装仕様、保存key、復旧経路、手動確認範囲は`docs/LOCAL_V2_IMPLEMENTATION.md`。

## #59 共通フォームtypography（2026-10-06）

[FORM_TYPOGRAPHY.md](FORM_TYPOGRAPHY.md) が適用境界と実機条件、
[DEV_FORM_TYPOGRAPHY_RELEASE.md](DEV_FORM_TYPOGRAPHY_RELEASE.md) がDEV配信証跡。
RN Webのcaller override、ref/event保持、Native非変更を回帰確認する。
WebKitのfocus zoom/IMEはSafari・standalone PWAの実機ゲートとして別途確認する。

## #90 Routine管理領域

[ROUTINE_ROOT_V2.md](ROUTINE_ROOT_V2.md) に責務と実機手順を記載。
routineRootApplication.test.ts は初期化/metadata/atomic失敗/History/ownership/再起動/scope切替を検証。
firebaseEmulatorV2.e2e.test.ts は2端末同時prepare、root1件、applied/superseded receipt各1件、gate不変を検証する。
Emulatorは demo-taskmemo-v2 のみ。実機PASSまでIssueをCloseしない。

## #59 Spec ID traceability（2026-10-06）

[原子的仕様matrix](TEXT_WORKSPACE_TRACEABILITY.md)と`text-workspace-specs.json`をテストの対応台帳とする。仕様追加・変更はSpec IDを先に登録し、各IDに専用test registrationを1つ割り当てる。既存IDを再利用・改番しない。parameterized入力variantsは同一仕様の例として記録する。

`traceability.test.ts`はfull suiteに含まれ、未対応/欠落/重複/skip登録、生成matrixのstale状態を失敗させる。`npx tsx scripts/text-workspace-traceability.ts --check`を独立に実行できる。full suiteのJSON reportは`--results <path>`で照合し、実行されていないIDやskipをPASSとしない。

`textWorkspaceSpec.test.ts`のcross-feature fixtureは通常UIと同じDomain CommandとRoutineフォーム初期値・rule builderから作成する。手書きvalid repeatRule fixtureだけに依存しない。Tree/Listの実adapterを通し、strict prepareの0 errors / 0 changesを検証する。Local/Account再起動と無編集commit後もstorage/History/Outbox不変を確認する。

`TextWorkspace.spec.test.tsx`はReact DOM/jsdomで実コンポーネントをmountし、保存/破棄/確認/候補/コピー/エラーイベントを実行する。React Native primitive、theme、Clipboardはmock。OS keyboard/IME/viewport/clipboard permission、実Firebaseはmatrixの実機のみ行を確認する。jsdomとその型はdevDependenciesのみ。

実行例: `npx vitest run --reporter=default --reporter=json --outputFile.json=artifacts/private/text-workspace-full.json` → `npx tsx scripts/text-workspace-traceability.ts --results artifacts/private/text-workspace-full.json`。
