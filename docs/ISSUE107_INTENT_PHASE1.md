# #107 Phase 1: intent同期の純粋基盤

状態: **実装レビュー用、保存/通信経路へ未接続、配信不可**。正本は[PR #123の承認済み設計212461c](https://github.com/yshtysht8sh10-glitch/TaskMemoApp/tree/212461c99d3556e055fb5265cbc6e4c80116f8ac/docs/design/intent-sync)。その文書を変更しない。今回のPhase 1は設計工程P1を中心とした独立関数であり、P0の原本保護なしにユーザーデータを開く手順ではない。

## 基点と差分

- 基点: `e18c4d1d88589103e6ad4d77241aead8d213f1bd`、公開branch `release/issue114-production-candidate`。ユーザー指定のProduction sourceをGit上で確認した。本番Hosting/Firestoreへ照会していない。
- `0c4ac60..e18c4d1`は#114の5ファイルだけ。Routineツリー操作整理を保持する。
- 既存DEV `44623f8`と公開main `f3c8253`には未配信Queue等があり、Production基点には混ぜない。`e18c4d1..44623f8`の差分29ファイルを確認し、そこからcherry-pickしない。
- 独立branch `feature/107-intent-core-phase1`。PRのbaseもProduction branchとし、mainとの差分に起動性能/Queue履歴が混ざることを避ける。
- 新規`src/sync/intent/`と本資料/引き継ぎだけ。既存Store/Nodeモデル/Rules/Functions/UI/テスト/承認設計を編集しない。package/lockfileの変更なし。

## 実装APIと境界

|ファイル|責務|承認設計の対応|
|---|---|---|
|`types.ts`|typed resource、明示write-set、観測head/readSet/依存、原子的completion/placement、受領と反映の別型|02節2〜5・8|
|`validation.ts`|scope/generation/baseline/attribute参照、明示値/原子group、日時/identityを検証。未知writeは拒否|02節2〜4・9.3|
|`reducer.ts`|全イベント集合から依存DAG/属性MV候補を決定的に再計算。別属性合成、同属性/意味依存競合、衝突原本と未着依存を保持|02節3〜4・9.3、05節3|
|`acceptance.ts`|受領判断とOutbox→awaitingの**純粋候補**。payload同一性確認、受領で反映済みにしない|02節5・9.2〜9.3|
|`publication.ts`|完全manifest候補/根の計算、祖先連続性/全member再検証、単調checkpoint/state/ledger候補。古い結果・世代・分岐を適用しない|02節9.1〜9.4、04節8|
|`canonical.ts`|plain JSONの不変payload同一性/locale非依存順。hash関数は注入|02節2・4・9.1|

### 具体的な意味

- 新型は`intent-v1`/`schema: phase1`という**隔離された内部表現**。既存protocol/schema番号を割り当てず、旧Envelope/Firestoreへserializeするadapterもない。
- nodeのcompletion（status+completedAt）、emphasis bool、title/body、placement（parentId+sortKey+membershipEpoch）をgroupとして扱う。常設メモbodyとfeatures.ideasEnabledも同じresource identity/競合規則を使う。create/delete/Routine/candidateの実行は対象外。
- false/null/空bodyは明示値。emphasis欠落をOFFにしない。activeのcompletedAtは必ずnull、completedはcanonical ISO日時を必須にする。旧日時をこのvalidatorへ直接投入しない（互換readerは後続）。
- `observed`は書込属性のbaseline sealと観測head集合、readSetは書かなかった依存属性のhead。属性DAGと操作依存DAGを区別する。localSeq/作成時刻は勝者・既処理watermarkにしない。
- 依存先未着/循環はdependency-pending。誤属性参照/不正基点/衝突はrejectedで原JSONを残す。因果後続は祖先headを退役できるが、真の並行候補は両方保持する。候補はactor/incarnation/seq/opIdのtuple順で並び、勝者を確定しない。
- 同属性候補が複数なら`FieldState.value`を出さず、全candidatesとconflict結果を返す。同じ値同士もidentityを保持。resolveは観測した複数headを対象にし、未観測の後着headは消さない。
- 同一resourceの複数属性commandは一intent内のwrite-set。競合属性があれば他属性の確定投影も止め、未解決commandに依存する後続も保護する。複数eventに分割した同commandIdはPhase 1では拒否する。
- readSetへの並行writeは関係command双方を意味競合として保持。到着時の現在値だけで決めず、依存closureに対して判定する。staleなwrite観測も自動上書きしない。
- `applied`はこのイベント集合/checkpointでの反映判断。後着並行操作によって新publicationでconflictになり得る。受領receiptにappliedを混ぜない。

### publicationの適用

`makePublication`はstate/projection/results/全操作coverage/conflicts/command groupのhashを束縛した完全manifestを作る。SHA-256は呼出側から決定的関数として注入し、テストではNode cryptoを使う。実行コードはNode/Expo/Firebase/暗号I/Oをimportしない。canonical JSON文字列はpayload同一性用で、暗号hashとは呼ばない。

`applyPublication`は呼出時binding（account/generation/activation/incarnation/epoch）、同世代publicationSeqとprevious hash、全memberを再計算して確認する。旧seqはstale、同seq同hashはno-op、同seq異hash/分岐はrejected。先行checkpoint欠落はpendingで、Phase 1では飛び越し適用しない。新seqでも以前の操作coverageを減らすsnapshotは拒否する（GCなし）。

適用成功時はwatermark/state/ledgerを**一つの戻り値**にする。awaiting退役は同じ不変payloadがapplied結果に含まれる場合だけ。pending/conflict/衝突は保持し、原intentはstate.intentsにも残す。古い一致checkpointから新しい値/候補/awaitingを戻さない。実際のraw CAS/Journal保存は未実装なので、戻り値だけでUI/永続状態を成功にしてはいけない。

## 単体テストと既存12反例の追跡

`src/sync/intent/contract.test.ts` 26件、`publication.test.ts` 10件、計36件。各入力はsynthetic-only。24通り/120通りの配送順列、重複、child-first、JSON再構築でも全証拠/候補/結果が同一になることを比較する。

|旧ゲート|Phase 1で引き継ぐ意味/試験|まだ証明しないこと|
|---|---|---|
|Q1 legacy completion survives new receive|completion+body、completion+placementの独立合成|legacy raw import/実Node受信|
|Q2 new completion survives legacy round trip|同op再送とJSON再構築で完了保持、取消は明示後続のみ|旧binaryとの永久往復同期|
|Q3 legacy completion cancellation|complete→cancel→遅延completeでactive/null保持|旧Historyから取消intentへの変換|
|Q4/Q5 offline completion and reorder、両到着順|membership/rankとcompletionを分離し順列で保持|旧Queue UI/現Storeへ接続|
|Q6 unknown-field omission|新本文/★intentがcompletionを書かない、欠落★値は拒否|未知旧Node field/Routine原本の移行保全|
|Q7 delayed completion after dissolution/re-creation|placement世代を新値にしたままcompletion合成|解散/再所属の実commandと旧操作写像|
|S1 observed emphasis survives content edit|ON/OFFとbodyの順列でもemphasis保持|旧clientで未知fieldを書き戻す継続運用|
|S2 stale payload cannot erase emphasis|新操作の明示write-setに無関係属性を含めない|旧full snapshotを安全にintent変換|
|S3/S4 emphasis vs completion、両到着順|独立合成と全結果一致|実SDKの順不同配送|
|S5 OFF vs stale ON|観測ON→OFF後の重複/遅延ONとC1古いpublicationを拒否|旧receipt救出/移行の実行|

元診断は**変更せず再実行**: Queue 1/7 PASS・6 FAIL（DEV44623f8の元script）、★1/5 PASS・4 FAIL（PR #122の50bb60a）。本番の実被害は未確認。新純粋層の36 PASSで元ゲートが修正済みになったとは扱わない。

## 追加32計画ケースのPhase 1範囲

「部分」は記載したpure側だけ実行した意味。計画ID全体をPASS/完了としない。移行/実機/保存を伴う試験は今回は未実施。

|計画ID|実施した部分|未実施|
|---|---|---|
|R1-01|typed node/pinnedNote/featuresの値・group検証|全resource移行、Routine/設定/History/UI読戻し|
|R1-02|常設メモ別body/空文字のMV候補|dirty/Outbox/receiptの実移行・回復UI|
|R1-03|features boolを同じregister契約で処理|実features History/移行/表示|
|R1-04|なし|rawのみで成功不可の移行gate|
|R1-05|イベントJSON再構築、同属性resolveで証拠保持|旧profile History/Undo/Redo/staging再開|
|R1-06|なし|設定保存容量不足/完全checkpoint復旧|
|R1-07|未知write・誤binding/head・不正completionは拒否|未知永続source/ownership/旧日時分類|
|R1-08|なし|全source/schema1〜4/復旧backup読戻し|
|R2-01|OFF後の古い一致C1は値/候補/ledger/watermarkを変えない|実listener/永続CAS|
|R2-02|mixed/欠member候補拒否、逆順C2を保留してC1後に適用|実通信でのmember収集/再取得|
|R2-03|JSON再構築後も高watermarkと新pendingを保持|CAS abort/ブラウザcrash耐久性|
|R2-04|完了取消、祖先/重複と真の並行候補の区別|実機送受信|
|R2-05|小さいseqを捨てない、未着親保留、別属性合成|offline端末接続/再送scheduler|
|R2-06|異世代/account/epoch/incarnation/token/分岐拒否|実認証切替と隔離の永続保存|
|R2-07|旧checkpointを既存high-watermarkへ適用しない|古い完全backup復元、全媒体が古いoffline writer停止|
|R2-08|重複/collision、受領→awaiting、欠member/coverage後退拒否|実server transaction/受付durability|
|R3-01〜08|なし（8件すべて未実施）|PREPARE/drain/fence/source catalog/seal/ready/activate/rollback/権限停止|
|R4-01〜08|なし（8件すべて未実施）|draft/IME/timer/全context/capture/backup/静止/ready失効|

加えて05節3のreadSet並行/古い観測、属性候補resolve、atomic command保留をpureで確認。Routine/削除/未知field/移行/保存/Undo/Redo/backupの実受入は未実施。これらをskipして達成扱いにしない。

## 検証結果

|確認|結果|
|---|---|
|対象単体|2 files / 36 PASS|
|全体`vitest run --maxWorkers=2`|165 files PASS、4既存skip / 1,320 PASS、46既存skip。skipは未実施|
|`tsc --noEmit`|PASS|
|`npm run lint`|PASS、warning/error 0|
|`npm run web:export`（EXPO_OFFLINE=1、development環境）|PASS、4 static routes、Firebase公開設定の静的照合PASS。配信/通信テストではない|
|`git diff --check`|PASS|

最初に単体を追加し、モジュール未実装で失敗したことを記録（既存reducerの赤を新ロジックで直した証拠とはしない）。実装中のcoverage欠落反例も、失敗→適用ガード追加→成功を確認した。常設メモ候補の順序期待は承認されたactor tuple順に修正（pc→phone、候補数/値は維持）。

初回全体実行は新worktreeのFunctions依存junction不足で3ファイルがimport失敗。既存Functions依存へのjunctionを作成後、同じ全suiteを成功確認。最初の型実行は生成済みexpo-env.d.ts不足による既存touchAction型エラーと、新validatorの明示型不足を検出。Expo参照型の生成ファイルを揃え、新型の記述を修正して成功。依存packageや既存UIを変更していない。

ログ: repository外`D:/working/TaskMemo/artifacts/issue107-phase1/`の`red.log`、`checkpoint-red.log`、`coverage-red.log`、`focused.log`、`full-tests.log`、`typecheck.log`、`lint.log`、`web-build.log`、`legacy-queue.*`、`legacy-star.*`。CI/レビューで上記コマンドを再実行可能。実Firebase/Emulator/本番データへは接続していない。

## 未実装・既知の制約と確認事項

1. **本番の不具合修正は未接続**。既存Node勝者選択/ACK/Outbox/Journal/CASはそのまま。実保存・受付・受領証明・publisher/crypto/認証・Rules/fence・migration・P0保護・UIは後続工程。Phase 1関数の戻り値はcommit成功を意味しない。
2. baseline/active bindingは将来の検証済み入口から受け取る前提。`initialClient`を古いbackupに対して呼ぶだけでは安全な復元にならない。全媒体のwatermark喪失やoffline復元は04/02の既定どおりread-onlyとする実装が必要。
3. 全イベント再計算の参照実装で、履歴/操作GC・incremental snapshot・checkpoint飛び越しはない。大件数の性能/保存容量は未測定。既存起動経路へimportしない。
4. plain JSONの型付き入力が境界。非JSON/循環データはthrowし、呼出側は原本保持で停止する必要がある。旧形式parserやraw保全の代わりではない。新completionのISO制約で旧日時サポートを終了しない。
5. placementは原子group/因果版のモデルのみ。親存在/循環/Queue lifecycleのDomain検証、Routine config/日別/削除/unknown extension、legacyCandidate採用、複数resource commandは未実装。未知属性を推定実行しない。
6. 意味競合の検出/保全は実装したが、**意味競合を解決するDomain command/readSet再計算とmulti-resource acceptance groupの具体的APIは未実装**。承認設計の不変条件を満たす詳細を後続レビューへ提出し、勝手な自動解決を追加しない。同属性MV resolveと別扱い。
7. 現段階で意図的に保留しているwire schema番号、actor登録/権限検証、移行基点の付与、親/削除を含む意味依存、永続checkpoint/原文/Historyの取り込みは、本PRで決定/既存実装を流用しない。仕様追加が必要になれば設計確認事項として再レビューする。

Phase 1レビュー後も、実データに触れる前にP0/移行安全性ゲートを満たす。Phase 2、DEV/Production配信、本番データ読書き/Rules変更/移行は本PRの承認対象外。

## 2026-11-09 レビューF1/F2の修正（再承認待ち）

対象の指摘は[PR #124レビュー](https://github.com/yshtysht8sh10-glitch/TaskMemoApp/pull/124#issuecomment-6729071976)。Phase 2へは進まず、既存の純粋intent層だけを修正した。承認設計212461cのidentity衝突時の原本保護/停止、受領と反映の分離、単調checkpoint契約を具体化する修正であり、新しい競合勝者規則や自動復旧契約を導入しない。

まずsafetyRegression.test.tsへ3件を追加し、修正前に3 FAILを確認した。F1のopId異payloadとsplit commandは、期待protectedに対しappliedを返して完了がbaseline activeへ戻った。F2はpublication先着でawaiting=[A]、accepted先着でawaiting=[]となった。修正前ログはrepository外`artifacts/pr124-fix-red.log`。

F1: reducerはopId/commandId/actor sequenceのidentity不整合を`ReducedState.protection`へ列挙する。全intent/不正variant/結果を残し、保護状態では通常の確定field.valueを出さない。manifestはprotectionHashも束縛する。applyPublicationは検証した新candidateと既存state/隔離証拠の和集合を再評価し、`kind=protected`と隔離stateを返す。最後に検証したstate/checkpoint/ledgerは維持する。保護中の通常通知や再起動では解除しない。隔離解除/衝突解決APIは今回設けず、別途レビューが必要。

最後に検証したstateは診断用のread-only値であり、保護停止後の新しい正常projectionではない。衝突を最初に受けた端末と先に完了を見た端末で過去の表示値が異なることはあるが、同じ証拠集合から同じprotection理由/隔離stateを生成し、どちらも正常適用を停止する。最初に届いたpayloadを意味上の勝者にせず、baselineへの巻戻しで帳尻を合わせない。

F2: 新しい純粋遷移`recordClientAccepted(current, receipt, callbackBinding)`を追加した。現scope/世代/activation bindingとpendingの不変payloadを照合し、既適用の検証済みcurrent.stateに同一payloadのapplied結果があればawaitingを残さない。publication側の適用時も同じsettleAwaitingを使うため、acceptedとpublicationのどちらが先でも同じledgerになる。receiptだけで反映済みを主張せず、conflict/dependency-pending/rejected/保護停止では原操作を残す。異payloadや退役通知は何も退役させない。

低レベルrecordAcceptedは引き続きtransport Outbox→awaitingの候補であり、逆配送の完了判定には単独で使わない。将来の接続時はrecordClientAcceptedのsnapshot全体を原子的に保存する必要がある。既存アプリのJournal/Outbox/receipt処理や保存adapterは変更していない。

追加10テストには元の3回帰、identity3種の逆順/衝突先着/後着/JSON再起動/証拠保持、120逐次順列（完了/取消/ON/OFF/本文と重複）、accepted/publicationの全24配送順と再起動/新pending共存、異世代/異payload拒否、候補/依存待ち/保護中の原操作保持を含む。既存36件は変更/skip/弱化していない。

不変条件: identity衝突を正常なbaselineへ投影しない。checkpointを保護停止で進めない。隔離証拠を単調保持する。通知順でstate/checkpoint/ledgerを変えない。反映の確認は現検証済みstateと同一payloadだけに基づく。完了取消と★OFFの正当な因果後続、真の並行候補は元契約のまま。

残存リスク: 全て純粋な候補で、実CAS/耐久化/認証/受付/publisher/capture/移行は未接続。hydrationではsnapshot/binding/high-watermarkの検証が必要で、未検証backupをrecordClientAcceptedへ渡してはいけない。保護停止は自動解除しないため可用性より保全を優先する。全イベント再計算と証拠保持の容量/性能、Domain意味競合の解決は後続の別レビュー対象。★表示UI、Phase 2、Rules、Firestore、配信、データ移行は未着手。

修正後検証（今回実行）: 元3回帰PASS、既存36件＋追加10件＝Phase 1 **46 PASS**。全体 **1,330 PASS / 46既存skip**（166 files PASS / 4 skip）。skipは未実施で、変更していない。TypeScript、Lint、git diff --check成功。EXPO_OFFLINE=1・development設定のWeb production export成功（4 routes、公開Firebase設定の静的照合成功）、配信なし。最終通知ガード追加後に全体/型/Lint/buildを確認した。

ログはrepository外`artifacts/pr124-fix-{red,focused,full,types,lint,web}.log`。途中、sandbox一時ファイルENOENTでsuite起動に失敗した実行は成功扱いにせず、制限外で再実行した。追加テスト変数のreadonly指定不足を型チェックで修正し、再実行成功。既存36件や既存skipの条件を変更していない。既知のjsdom alert未実装表示とbuildのNO_COLOR通知は出たが、各検証exit 0。
