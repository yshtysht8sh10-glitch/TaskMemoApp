# #117 B0: 全writerの棚卸しと拒否契約

状態: 独立レビュー用提案。製品コード/Rules/Functions/IAM/protocol/実データは変更しない。
基点 PR #145 559a59b。正本はPR #139 e422fbf §9.1–9.3。
A2a PR #149は局所候補検査であり、完全復旧条件の充足とは扱わない。

## 調査範囲と限界

リポジトリ内の`src`、`functions/src`、`scripts`、`public`に対し、Firestore SDK、
Admin SDK、REST commit/PATCH/DELETE、ローカルreadwrite、gate定義を静的検索した。
Map.setやファイル出力とDB書込みを区別して追跡した。以下はコード上の経路であり、
実際の配備revision・IAM principal・Console経由の権限保有者を確認済みではない。
本番の追加読取・認証設定調査・実probeは実行していない。

## writer一覧

| 経路 | 保存対象・現行拒否境界 | protocol3で必要な保護 |
|---|---|---|
| PWA/Native通常同期 `src/sync/firebaseSyncAdapter.ts` upload | nodesV2/profileV2/syncOperationsV2。同一transactionでNodeとreceipt。connect時にcompatibility検査、Rulesはprotocol2 | 各transaction/retry開始で最新server control/epoch/registryを読む。既存receipt分岐も同じ能力確認を先行。全変更対象を同一transactionで拒否 |
| 完了/取消/Undo/Redo/import/Queue/ownership | `taskMemoApplicationStore.ts`等で生成→上記upload | UIだけのgateでは不可。未知rawを失わず保存/再送停止。既存opへcapabilityを後付けして自動再送しない |
| 自己修復 convergeRecoveryTarget | adapterの別transactionがNode/receiptを直接保存 | 通常uploadと同じ拒否契約。repair lock保有は能力の代替にならない。desired/observed原本・全結果を検証 |
| repair lock create/renew/release | adapterの別transaction。**現RulesのrepairLock節にはprotocolWritable判定がない** | lease取得/更新もprotocol3/epoch/registry確認。旧lease解放の扱いは下記B0-2。期限切れを待つ経路を常に残す |
| Functions外部AI `functions/src/firestoreNodeRepository.ts` | assertGateは現在minProtocol===2。Node/receipt/request/auditをAdmin transactionで保存 | server側でgate/epoch/writer registryをread/transaction両方で再確認。old revisionを稼働/呼出不能とする証跡が必要 |
| Functionsオンボーディング `functions/src/onboarding/{decision,repository}.ts` | protocol2 GATEを作成。既存の異gateは拒否 | protocol3既存gateをprotocol2へ戻さない。作成可否はserver policy/epochと同transaction。未知accountはclosed |
| 運用Admin `scripts/production-admin.ts` | REST :commitでcontrol/migrate/canary。canaryはgate2とNode updateTimeを事前検査 | Rules迂回。gateの事前読取だけではTOCTOUを閉じない。transaction/更新preconditionと実行主体fenceの両方が必要。古い資格情報停止未証明ならclosed |
| 古い単発Admin `scripts/delete-approved-production-orphan.mjs` | 固定対象のbackup後REST DELETE | 固定ID/Owner承認文字列はprotocol3能力ではない。実行禁止台帳へ入れ、権限fence/対応済み運用経路まで使用しない |
| DEV初期化/修復 `scripts/provision-v2-rc-dev.mjs`, `repair-v2-rc-sort-key.mjs` | Auth signup、Admin control PATCH、ID token Node PATCH | 環境限定でもsharedDEVの制御を巻き戻せる。protocol3開放後は旧script停止。使い捨てEmulator fixtureのみ別扱い |
| DEVオンボーディング `dev-onboarding-{admin,live-check,verification}.mjs` | 設定/アカウント/疎通probeを扱う運用script | Auth/AppCheck等の実環境変更は今回実行不可。データwriterとは別の管理権限台帳にも記載 |
| Emulator/rehearsal `prepare-v2-ui-emulator.ts`, `rehearse-v2-cutover.ts`, `rehearse-cutover-canary.ts` | fixture作成/隔離repositoryの書込み | demo project +loopbackを二重検証し、実projectへfallbackさせない。テスト成功は実IAM fenceの証明ではない |
| ローカル復旧 `public/v2-cloud-recovery.js` | server GET後、IndexedDB CASでCommitted置換・原本保存 | server writerではないが後続uploadの入力を変える。protocol3未知/新結果を旧復旧器へ通さず、raw退避と停止。既存planへ番号を足して再利用しない |
| ローカル通常保存/backup restore | ApplicationJournal、raw CAS、Node backup/import | Journal/History/Outbox/profileを含め未知状態を保護。通常backupを完全復旧archiveとして使わない |
| OAuth store `functions/src/firestoreOAuthStore.ts` | clients/requests/codes/tokens。Routine Nodeへ直接書かない | token発行が未対応Functionsを起動可能にしないことを別検証。資格情報/実Auth設定は本PRで触らない |
| read-only diagnostics/backup | readOnlyFirestoreSnapshot、capture-recovery-cloud-readonly、standalone raw export | GET/入力ファイル検査のみ。backupの取得成功はwriterを開ける根拠にしない |

一覧にない新writerや未知principalを発見したら、一覧完了/開放準備完了を撤回する。
リポジトリ内検索だけで全principal不存在と主張しない。

## 拒否契約（既承認方針の具体化、配線前レビュー）

通常Node/profile/receipt/request/audit/修復の書込みは、認証された同scope/UID、
minimumSyncProtocol=3、server管理feature contract='routine-results/1'、enabled、同epoch、
失効していないregistry登録writer、既知保存形式、対象の原本保全条件がすべて揃った場合だけ候補とする。
prepared/closed/欠落/未知/期限切れ/Auth切替は閉鎖する。各書込み開始とtransaction retryで再検査し、
読取後のepoch/control/registry変更は同transaction競合として拒否/再試行する。
検査とwriteを別リクエストに分離して開放しない。保護停止を自動解除しない。

新しい外側writer envelopeは原操作payloadを上書きしない。opId/原操作/旧receipt不変性を維持し、
新metadataによって同じopIdを別操作へ変えない。既存receiptの受領事実と現在の反映状態を分離する。
receipt単独でunknownデータのOutboxを退役させず、ローカル原本照合と既存ACK契約を維持する。
拒否/期限切れ/応答喪失は元raw/Journal/History/Outboxを残す。permission-deniedを成功扱いしない。

registryはクライアントから作成/更新できないserver管理情報とする。ただしPWAでは、
自己申告build SHAやwriterIdをregistryと照合するだけでは実行binaryの真正性を証明できない。
一般のFirebase Authも、同UIDを持つ旧binaryと新版binaryの意味保存能力を認証しない。
したがって承認済み方針の「未検証buildを許可しない」を満たすため、配信/更新証跡、
古い実行主体の停止、意味検証、通常利用者を想定する脅威モデルの限界を明記する。
改変clientまで含む保証を追加する場合は別設計レビューが必要。registry文字列だけで証明済みとはしない。

AdminはRulesを迂回する。共通helperを旧scriptが呼ばない問題はhelper追加だけでは解決しない。
全principal/Cloud revision/長期資格情報の停止または制約を確認できるまで実環境enabledへ進まない。
EmulatorはIAM/配備revisionの実在を証明しない。実環境IAM変更は別Owner承認が必要。

## 実装前の判定単位・未決事項

| ID | 推奨する次差分 | 必須判定 |
|---|---|---|
| B0-1 | 純粋判定型とserver管理情報のprovider境界 | registryの正確なpath/schema、writer登録/失効責任、期限とserver時刻の供給を固定して独立レビュー。自己生成authority不可 |
| B0-2 | repair lease契約 | 旧writerの取得/更新は禁止。解放は同所有者の削除だけを限定許可するか、protocol3必須で失効待ちとするかをレビュー。後者を安全側推奨。自動clearなし |
| B1 | 隔離Emulator Rules＋固定旧writer | clientでのprotocol3拒否・新writer transaction・receipt/repair/profileを検査。実Rulesファイルへの配線/配備と分離 |
| B2 | Functions/Admin共通server検査 | server transaction内でepoch等を固定。未対応既存Functionsはgate3を拒否することを回帰化。helper未使用旧principalの停止は別証拠 |
| C | capability供給と全書込み境界の配線 | B0/B1/B2とA2の完全回収条件が必要。closedを既定、実protocol切替はOwner別承認 |
| D/E | UIと総合受入 | 実capabilityなしの通常アプリからmissedを発行不可。R01–R18全てを層別判定 |

これは#107の新同期方式を実装する差分ではない。新authority/全面ログ方式を混入しない。
上記の未決schema/登録責任を推測で製品APIに固定せず、独立レビューへ明示する。

## 具体的な受入計画（全件未実施）

| 試験 | 入力/障害 | 期待結果 |
|---|---|---|
| B01 | 固定旧PWA/Nativeのtitle編集、古い全snapshot、receipt単独 | server Node/profile/receipt不変。元Outbox保持。未達情報欠落なし |
| B02 | 未対応/別UID/別scope/別epoch/期限切れwriter | transaction前およびretryで拒否、部分receiptなし。原本/別未送信op不変 |
| B03 | gate取得後～write間でepoch/registry/controlを変更 | transaction失敗/再検査。過去の確認値でwriteしない |
| B04 | repair lock旧取得/更新、期限切れ、同/別owner | B0-2承認規則に一致。lock成功をNode権限へ昇格しない |
| B05 | 新capabilityメタ付きOutboxを旧adapterで再送 | 旧schemaのまま拒否。opId/原payload保持、単独ACK退役なし |
| B06 | 旧Functions gate3、遅延callable、Admin旧資格情報 | 旧Functions拒否、原本不変。旧Admin停止は実IAM証拠がなければ未合格 |
| B07 | onboardingで既存gate3/未知feature/既存accountへ接続 | gate2を再作成/上書きしない。closed/原本保持 |
| B08 | offline旧端末→再接続、server commit後応答喪失 | 最新fence再検査、元opIdとreceipt照合。自動cap後付け・二重操作なし |
| B09 | Node/receipt/profile/request/auditの片側保存障害 | 全transaction不成立。quota/local CAS失敗なら採番/メモリ確定/退役なし |
| B10 |未知routine結果/未知raw・旧backup/local復旧経路 | 原本hash維持、保護停止。未知をpendingへ変換しない |
| B11 |registry自己作成、偽build文字列、scope取り違え | server管理値をclientから変更不可。偽buildの意味保証は限界として検出/評価し、真正性証明と呼ばない |
| B12 | 未棚卸しwriter/principal、旧revision残存 | feature閉鎖を維持、E完了/配信承認を出さない |

R08/R11/R12/R13/R14/R15/R18へ対応。他のR試験の代わりにはしない。
ローカルpure/Emulator/実SDK/実機/IAM運用を分け、未実施・skipをPASSに数えない。
本PRは文書のみであり、上表のserver拒否やEmulator試験を実装済みとは扱わない。
