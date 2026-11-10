# #107 N1 — Firebase標準モードpure cut verifier

設計正本: PR #128 `cd36f499cd514218434c19d687f4b4ae4af69e87`（S-CUT/S-REPLICA承認）。本実装はそのcommit直下の独立branch `feature/107-n1-cut-verifier`。Production基点`e18c4d1`のancestryと#114を維持する。PR #124–128をmainへmergeしていない。

## 1. 実装と境界

新規`src/sync/serverCut/types.ts`と`verify.ts`、同ディレクトリの`cut.test.ts`のみ。既存Phase 1/2A/2B-1のAPI/テスト、製品保存・同期・UI経路、依存は非変更。アプリから本モジュールをimportする経路はない。

|入口|責任|
|---|---|
|`Realm/Log/Published/Cut/Bundle`|N1専用version付きwrapper。Realmをmode/project/UID/generation/baseline/epoch/activationへ束縛。logは不変parent chain＋累積accepted全map、publicationは固有source＋previous＋既存pure publication全member、cutは全inventory/roots/partition/nonce/session/期限|
|`encode/hashRecord`|新wrapperのJSON canonical bytesとdomain分離SHA-256依存。key整列・UTF-8 digest契約・安全整数・null/false/欠落区分・Unicode非正規化。hidden/symbol/accessor/sparse/非JSON値を拒否。既存canonicalIntentは改変しない|
|`verifyCut(unknown, expected, deps)`|plain JSONをdetached検査し、信頼された署名verifier依存/期待binding/時刻を使うpure判定。全log/inventory/原payload/coverage/U/結果を比較し、各Pのsourceのみで意味再計算。結果はverified/pending/protected/expired|
|`syncStatus(bundle, expected, deps, localFacts)`|毎回verifyCutを再実行。署名風DTO/verified booleanを信用せず、K時点の阻害要因とlocal state/checkpoint/evidence/ledger、保存/dirty/inbox/通信/recovery事実を照合。候補/原入力を変更しない|

`verified`はpure入力の検証成功であり、local persisted/CAS成功/server実運用の真正性の証明ではない。localFactsとexpected（時刻・現役session等）の正しい供給はN3/P-provider側の責任で、今回は供給しない。依存のverifySignatureをtrue固定にして本番へ接続することを承認しない。testsの署名は明示したsynthetic-authハッシュによる境界ハーネスで、実暗号署名/KMS/実Authの証明ではない。

## 2. 規範への対応

|PR #128規範|N1対応|未実装境界|
|---|---|---|
|S1/S2 immutable accepted、全payload、encoding|同op/actor-seq/command衝突、log後退、scope/世代/schemaを検査。固定encoding/hash vectors。真正cutにbaseline内容hashも束縛し、seal文字列の自己申告だけで信用しない|server受付transaction、durable receipt writer、Auth/epochの発行前再検査はN2/P|
|S3/S6 R128-1|各Pをbaseline+A(P.source)でmakePublication再計算。現在A(L)はU照合へ使用。全history Pを順に検証し、後発body操作を過去Pへ混入しない|実fetch/配信キューなし。完全なinline inventoryを入力する|
|S4/S6 R128-2|log sourceの順序と前coverageの全payload包含を両方検査。正しいpreviousでも古いsourceを拒否。同source no-opは同意味stateのみ許可。既存applyPublicationのcoverage-regressionを維持|server activation transaction、jobId重複排除/leader fence/atomic pointer更新はN2|
|S5/S6完全cut|署名対象にL/P/inventory/基点hash/partition/U/現在control阻害要因を束縛。全map集合分割、全result一対一、既保持receiptのadmission包含、pin/fork/ancestry検査|Rootの実供給・時刻/skew・nonceの生成/失効はP。ネットワークpagination/照会なし|
|S7/F1/F2/R-F2|既存Phase 1のmake/applyを再利用。source時点の結果と現在control保護/rejectを分離。過去reflection・原操作を保持、最初からconflict/pendingをappliedへ昇格しない|receipt/publication inboxの耐久化・Outbox退役・新RecoveryGuard/hydrate入口はN3|
|S8/R19|U/現在conflict/dependency/reject/protection、local未受領/awaiting/inbox/dirty等を別判定。期限境界ではcomplete=false、過去保存事実を消さない|実CAS直前/直後に再度pure関数へ最新nowを渡すcoordinatorはN3。関数内部で時計を読み進めず、一回のnow snapshotだけを扱う|
|S9/S10原本保護|unknown/異scope/改変で成功にせず、全入力は不変。純粋判定なので異UID rawを別領域へ書く入口がない|Journal/Committed/raw CAS/backup/世代移行の実store検査はN3/M。旧RecoveryGuardの意味/入口は変えない|
|4モード/Eゲート|Firebase標準以外、unknown wrapper/schemaを明示拒否。E/P/Mの未決仕様を推測実装しない|E2EE、Drive、localモード実装、AdmissionRejectionの処置/保護解除なし|

### wrapperの隔離形式と未決上限

`n1-log/1` / `n1-publication/1` / `n1-cut/1`は**ハーネス内形式**。数値本番protocol、Firestore path、既存backup schemaを割り当てない。cutの`baselineHash`は不変inventoryの基点内容を署名対象へ含める具体化であり、既存baselineSeal/旧APIの意味変更ではない。

初版は全ancestor・全累積accepted・全publication memberをinlineで検証する。部分取得/重複page/欠落inventoryは成功にしない。missing member/sourceはpending、hash/意味/identity不一致はprotected。現在control保護/rejectの不透明IDは阻害として保持し、処置/解除を定義しない。

callerは`limits={logs, publications, intents}`を必須で指定する。intentsはlog全snapshot＋publication coverage＋Uに列挙されたslot総数。testsの50/50/1000は合成budgetであり製品上限ではない。超過はpending/budget-exceededで、切捨て成功にしない。byte/query/ネットワークtimeout/paginationの製品上限は未決。入力は既にメモリにあるJSONであり、parse/encoding前の資源上限や巨大payload攻撃まで解決したとはしない。full replayの容量/性能は次工程で評価が必要。

## 3. 必須受入との対応・未実施の区別

|規範の試験|今回のpure検証|今回扱わない部分|
|---|---|---|
|C01–C08|genesis、acceptedのみ、source後のbody増加、Uの正常/欠落/重複/異payload、result欠落/二重/異ID、conflict/dependency/rejected/control保護|server耐久化/原本store自体はない|
|C09/C09a|古Kへ新acceptedを混ぜない、通知観測でchangedSinceCut、次KでU保持、異root inventory拒否|live listener/照会coordinatorは未実装|
|C10|member欠落、budget超過、全取得不能はpending|実timeout/ページ取得なし|
|C11/C11a/C11b|scope/UID/mode/session/replica/epoch/activation/nonce/署名不一致拒否、入力byte不変|発行前Auth/epochをserverで再検査することはN2/P。書込隔離の実証はN3で行う|
|C12/C20枝番|pin後退/fork、固有source意味検証、未知schema、activation済みmember欠落/改変|実control/activationの正常性を模擬成功から主張しない|
|C15b（追加必須反例）|完了ON→取消OFF→現役Realm/正しいprevious/旧source候補の拒否。coverageだけ後退/同source意味改変/未知source拒否、no-op検証|拒否後のserver control/job原本保持はN2。pure関数は入力を変更しない|
|R19/R19a–c|dirty/inbox/通信/ledger/未保存/保護/鮮度変更を別判定、期限100/101でfalse、既保存client/reflectionのbyte不変|CAS中の実crash/commit/期限変化はN3。latest nowで繰返し呼ぶ責任を残す|
|F1/F2/R-F2・順序逆転等|既存134件をそのまま回帰。新モジュールでもpast reflection/current conflict、JSON roundtrip、別未送信op保持を試験|旧134件を新authority/実SDKの証明へ読み替えない|

E/P/M placeholderは実行可能な完成受入の分母にしない。N2/N3/C13–19の耐久server/実CAS/実機、未承認E、実migration/rollbackは未実施。C15bはN1の不正候補検出だけを対象とし、server activation処理を実装していない。

## 4. regression-firstと検証記録

ログはrepository外`D:/working/TaskMemo/artifacts/issue107-n1/`へ保存。

- 最初にR128-1/R128-2の自動テストを追加し、未実装importによる失敗を`red.log`へ記録（実装ロジックの反例FAILとは区別）。初fixtureの完了日時を既存validator必須のcanonical ISO（ミリ秒付き）へ修正。既存validatorは非変更。
- `source-input-red.log`: 新verifierの再計算入力を一時的にcurrent Lへ戻すとC02/C20aがFAIL。復元後PASS。
- `source-guard-red.log`: 新source単調性検査だけを一時的に外すとC15bが期待するsource-regressionで拒否できずFAIL（coverage-regressionの別保護は残る）。復元後PASS。後者を実データ巻き戻りの再現とは主張しない。
- 一時変更は全て復元してから全検証/commit。filtered実行の他74件はskipであり、そのログを75 PASSとはしない。`regressions-green.log`は75件全実行。
- canonicalのSHA-256定数はPython hashlibでも照合。最初の誤った手入力定数を修正した記録は`focused-first.log`、正しい固定値はtest sourceに保存。意味規則を期待値へ合わせた修正ではない。

検証最終結果はPR/Issueコメントと本書末尾の表を照合する。初回環境失敗/timeoutを成功ログで隠さず、skipと分離する。

|最終チェック|結果|ログ|
|---|---|---|
|N1 focused|**75 PASS**、skipなし|`focused-final.log` / `regressions-green.log`|
|関連回帰|**209 PASS** = N1 75 + 既存134、7 files、skipなし|`related-final.log`|
|全体|**1,493 PASS / 46既存skip**、170 files PASS / 4 skip。skipは未実施|`full-direct.log`|
|TypeScript|PASS（exit 0）|`types-final.log`|
|Lint|PASS、warning/errorなし|`lint-final.log`|
|Web export|PASS、4 static routes、公開設定の静的照合PASS。EXPO_OFFLINE=1、合成API値/DEV project名のbuild-only設定、配信なし|`web-final.log`|
|文書/差分|リンク/表/fence、diff check、新規4ファイル限定、旧API/テスト不変、Production ancestryを確認|PR scopeを照合|

全体の最終実行は`node node_modules/vitest/vitest.mjs run --testTimeout 30000 --maxWorkers 2`。最初の`npm test -- ...`実行ではこの環境でtimeout指定が反映されず既存720順列が5秒でtimeoutしたため、直接CLIへ同じ全スイートを渡した。既存テストのtimeout/期待値/skipは変更していない。

初回`full.log`は新worktreeのFunctions依存リンク不足で3 suites起動失敗＋既存順列timeout（1,487 PASS / 26 skip）。Functionsの既存node_modulesをjunction接続後の`full-final.log`/`full-serial.log`は起動失敗を解消したが5秒timeoutが残った。最終`full-direct.log`は全実行可能ケース成功。jsdom alert未実装の表示は既知診断として残る。

初回型チェックの`SheetDismissHeader.tsx`/touchActionエラーは、新worktreeにignored `expo-env.d.ts`（標準expo/types参照）がなかったため。既承認worktreeと同じ参照ファイルを検証環境へ用意し、tracked UI/型設定を変更せず再実行PASS。初回固定hashの誤記も含め、初回結果を最終PASSへ書き換えずrepository外ログに残した。

環境準備のnode_modules junction、Functions依存junction、expo-env.d.ts、build-only .env.local、distは全てignored。利用者保存領域・鍵・本番/DEV Firestoreにはアクセスせず、実SDK通信も行っていない。

## 5. レビュー担当への依頼と残存リスク

重点: 署名を検証済みとするcaller DTOを信用しないこと、全map/全payload/全history、source固有再計算、sourceとcoverage両検査、no-op、current reject/protectionと過去reflection、root/nonce/期限/bindingの完全束縛、未知/部分入力の非成功、同期statusとlocal保存証明の分離。

N1は既存pure APIを再利用するがlive appへ接続しない。prototype形式・trusted dependencies・full inline inventoryの前提を独立に審査し、N1の承認をN2/N3や実運用真正性へ拡張しない。実署名root/IAM/Auth/clock、server transaction/activation、real CAS/Journal、PWA/複数tab、E2EE、移行は全て次の別承認。

未受領の唯一copy喪失は復旧/存在検出不能な場合がある。N1がこの限界や既存Journal保護を変更したものではない。データの自動GC/初期化/修復/保護解除/AdmissionRejection退役は一切ない。

独立レビュー用PRとIssue #107へ対象SHA/結果を記録して停止。#107/#120をCloseせず、承認前にN2/N3/実Firebase/配信へ進まない。
