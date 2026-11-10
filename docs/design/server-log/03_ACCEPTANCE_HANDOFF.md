# 03 — 受入試験・判定単位・安全な実装分割・引き継ぎ

## 1. 試験結果と計画を区別する

**以下は全て未実施の受入仕様。製品/実SDKの検証結果ではない。** 今回は文書だけを変更し、diff check・参照先・API宣言・設計の反例を確認した。テスト/型/Lint/buildは実行していない。過去のPhase 1 58件 / 2A 35件 / 2B-1 41件と独立レビューは保存し、今回のPASSに転用しない。既存skipは未実施。

試験実装は承認された次の隔離工程でregression-first。production/実ユーザーDB/SDKを使わず、合成baseline・隔離IDBFactory・耐久server模擬storeとfault injectionを使用する。fixtureは標準modeとE modeを明示し、未知modeを標準へfallbackしない。

共通比較対象を`ALL`と呼ぶ: canonical state、全MV候補、current result/protection、checkpoint/manifest/activation、L/A/C/U、全receipt/result/reflection、ledger（outbox/awaiting）、原操作/全payload variant、inbox、History/source refs、採番とraw byte列。順列試験はALLを比較し、状態値だけの一致で成功にしない。署名nonce/時刻等の通信一回限り値はidentityが違うため、検証済みの事実集合への正規化規則を先に固定する。事実でない未検証応答は除外するが、衝突/拒否証跡は除外しない。

比較の粒度: 最終ClientSnapshot/ledger/候補/受領・反映事実/原操作mapは同集合で厳密一致。配送trace順を記録するevents/rawやnonce付き署名包絡は、配送順の異なる実行同士でbyte一致を要求しない。各traceで原証拠を欠落なく保持し、検証済み事実への射影を同値比較する。raw byte不変は同traceの失敗前後で検査する。差分を無制限に無視する正規化は禁止し、正規化から除いたtransport fieldと原bytes保持を試験結果に列挙する。

## 2. S-CUT受入一覧

|ID|正常/異常/競合/再起動・復旧の入力|必須期待結果|
|---|---|---|
|C01|empty L + genesis P、1件acceptedのみ、その後Pへ含める|最初だけcomplete候補。accepted時U=1でfalse、反映CAS後全条件成立ならtrue|
|C02|baseline body=base、L1でcomplete a受領、source Lp=L1のP1（body=base）を作成。その後L2で独立body変更b（body=later）を受領しK=(L2,P1,U={b})|P1をbaseline+A(L1)={a}で再計算し検証成功、body=baseを保持。bはUに残りcomplete=false。A(L2)={a,b}をP1へ混ぜず、正常cutを恒久protectionにしない|
|C03|正常: Lp=L2でA(Lp)={a:complete,b:emphasis ON}、Pのbody=base。その後L3でc:body=later追加、A(L3)={a,b,c}、C={a,b}、U={c}。異常は同LpなのにC={a}または異payload b|正常はPの意味検証成功、c保持、U非空/complete=false/protection追加なし。異常だけcoverage map不一致として拒否/保護。現在L3のbodyを過去Pへ要求しない|
|C04|同件数だがb欠落/c重複、pageを再利用、最大ordinalだけ一致|全map/inventory検証で拒否/保護。件数/最大seqを成功根拠にしない|
|C05|coverageに未知key、同opId異payload、別baseline/epoch member|拒否/保護、原variant両方保持。正常Pを更新しない|
|C06|CとU重複、Aの一件が両方から欠落、U root偽造|分割/全map比較失敗。status unknown/protected、complete=false|
|C07|Cにあるopのresult欠落/二重/非covered result混入|一対一照合失敗。opId一致だけでapplied証跡を作らない|
|C08|Cが全Aだがconflict/dependency-pending/rejected/protectionあり|coverage完全でもcomplete=false。分類と原操作を保存|
|C09|C09a: cut snapshot取得後、同Realmでbody変更bが新accepted。C09b: 列挙中P/control更新|取得済みK自体は元snapshotとして整合、後発bをKへ混ぜない。新receipt/root通知を観測したらcomplete無効・次cut要求。次cutでbをA/Uまたは後続coverageへ保持。新操作の存在を未観測でも未来不在のleaseとは表示しない|
|C10|取得中に一page消失/timeout/サイズ上限|全件照合未完、空補完禁止。原本を維持しretry/unknown|
|C11|C11a: 署名済み別UID/mode/replica/session/generation/epoch、旧nonce/期限。C11b: control snapshot取得後・cut署名前にAuth失効またはepoch変更|aは真正署名でも拒否。別UID/scopeのrawを宛先Committed/Journal/Domain/Outboxへ混入せず全byte不変。正しいscopeの再検証入口かopaque診断隔離だけに保全。bは再検査でretry/retired、旧Kを現在資格として発行/installせずclient checkpoint/ledger/reflection不変|
|C12|同controlVersion異root、既知pinのancestor、parent欠落/fork|保護停止。bootstrap/backup同梱鍵で解決しない|
|C13|publisher stagingの各chunk前後でkill、同job再開|P pointer不変。完成後全inventory再検証。同manifest activationは一回だけ|
|C14|activation commit直前/直後kill・応答喪失|control/job結果照会で確定。未activationなら同fenceのみretry|
|C15|C15a: 二publisherが同previous、旧leader再開、epoch競合。C15b: 現役publisher・正しいprevious=P2・古いsource=L1の新job（詳細は下記）|aは一つのcurrent pointer/旧fence拒否。bはsource/coverage後退をactivation前に拒否。server control/Pとclient state/checkpoint/ledger/reflection/既存原証拠は不変、拒否候補/jobは別診断へ追加保持|
|C16|receipt/intent/identity/log root各write境界でserver crash|全成立/不成立。partial acceptedを正常照会で返さない|
|C17|同op同payload連続/並行再送、actorseq/command collision|同payloadは元receipt。異payload collisionは双方保全・sticky protection、次正常activation禁止|
|C18|pre-admission reject、accepted後の処理reject|A外AdmissionRejectionとC内Rejectedを混同しない。未解決rejectを成功扱いしない|
|C19|server backup後退/台帳再起動/全喪失、client pin残存|比較可能な後退を検出、原本保護。clientを無条件にserverへ再登録しない|
|C20|C20a: C02のP1(source=L1,body=base)と後発L2 body=later。C20b: source=L1の再計算自体とmanifestが不一致/unknown version。C20c: activation後のmember欠落または改変|aはP1をA(L1)だけで検証成功、bをUに保持しcomplete=false、恒久protectionにしない。bは署名だけで通さず保護。cの欠落は未検証/pending、改変は保護、どちらも空補完/候補適用なし、既存checkpoint/ledger/reflectionを維持|

### C15b — 現役publisherでも拒否すべき完了ON→OFF→旧ON

1. 同RealmのL1でcomplete a（completed/T1）、L2でaを観測したcancel b（active/null）を受領する。P1(source=L1,C={a})→P2(source=L2,C={a,b})を正常activate/検証保存する。clientはactive/null。
2. 現役publisher/fence・正しいprevious=P2で**新job J3**を作り、P3のsourceだけL1へ戻す。C(P3)={a}、P3の意味値completed/T1はL1に対して正しい。current L=L2なのでancestor-of-currentだけなら通る反例。
3. S4のP2.source=L2≼P3.source=L1とC(P2)⊆C(P3)が不成立でactivation拒否。server L/P2/controlVersion/checkpointを更新しない。clientへ同候補を直接配送してもS6 chain検査と既存`operation-coverage-regression`で拒否、active/null・checkpoint P2・ledger・reflection・既存原証拠が厳密不変。P1/P2/J3の原payload/job/候補を失わず、J3拒否診断だけ別追記可能。
4. 追加独立変種: source比較不能、同source ID異hash、coverage同key異payload、source同一no-opを試す。前3者は通常activation/apply禁止。no-opはCと全意味roots完全一致の場合だけ成功し新checkpointを一度だけ作る。同job再送は元結果、同sourceで意味stateを変えた候補は拒否。既存sticky protectionは解除しない。

## 3. S-REPLICA受入一覧

|ID|入力/障害|必須期待結果|
|---|---|---|
|R01|draft/debounce/save待ち→CAS→server送信|保存済み同intentだけ送る。draft/保存待ち中は全体complete=false|
|R02|CAS前abort/quota、transaction中crash、request成功後tx abort|seq/メモリ/Outbox退役先行なし。旧Committed/Journal原本保持|
|R03|local CAS成功/complete応答喪失、旧raw/target/未知rawの三種類で再起動|同op回収または同要求明示retry。未知rawは保護、新ID先行送信なし|
|R04|server受付応答喪失、receiptのlocal CAS失敗|Outbox残存、opId/payload照会で元receipt。二重適用/再採番なし|
|R05|R/P1/P2（applied→conflict）全配送順、各重複、各段階JSON保存/復元|ALLの検証済み事実集合一致。過去reflection保持、現在conflict未解決、別未送信opが残る|
|R06|completionのT1/T2、body/body並行、最初からconflict/dep-pending|候補/日時両方を保全。coverage/opIdだけでhistorical appliedとしない|
|R07|applied→protected、同op/actorseq/command衝突、遅れてreceipt|F1/F2/R-F2の保護・原variant・reflectionを維持。awaitingだけを正常化し保護解除しない|
|R08|conflict→明示resolve→未知並行候補到着|全観測候補参照resolveのみ有効。未観測候補を消さず再conflict|
|R09|ON観測後OFFに古ON配送、完了観測後取消に古完了配送|因果後続のOFF/取消を維持。真に並行ならMV候補、時刻勝者なし|
|R10|本文+完了、本文+placement、完了+★、Undo/Redo、Routine config/close/日別/履歴|独立属性は合成、意味依存は保留/候補保全。完成日時組/Routine履歴の原子性と全来歴維持|
|R11|server P先着、receipt後着、local未受領mapに別actor/穴あり|server確認部分とlocal-onlyをkey+payloadで分離。配列suffix/最大localSeqで消さない|
|R12|unknown raw/Journal非null、偽checksum、欠落member/reflection、異世代backup|原byte列不変で保護停止。新guard自己生成/Journal clearで通さない|
|R13|offline再起動→local保存→再接続、初回enrollment offline|既enrollのみ条件付き編集、鮮度unknown。初回は停止。fresh K照合後のみ同期完了候補|
|R14|offline中のAuth失効/epoch切替、同UID再認証、別UIDへ切替中response|旧handle retire、旧scope保全、server拒否された操作を新bindingへ自動再送しない|
|R15|同store二tabの同expected raw、別device actor、clone actorから採番|CASの一方のみ成功、別actor独立。clone/newincarnationはenrollment前に使用禁止|
|R16|旧backupを別workspaceへ復元、serverが先行、未受領/History/設定/unknown fieldあり|server値で全置換しない。全永続種別の保持と対応照合、actor再利用なし|
|R17|server accepted後local全消失、未受領唯一copy全消失を別fixture化|前者のserver分再構築を検証。後者は復元/存在検出不能な場合を明記し、成功表示しない|
|R18|全server/client pin同時rollback、server未受領suffix全消失|検出保証外を正しく記録。online再接続で必ず検出できるというassertを置かない|
|R19|K保存直後に入力/notice/失効/期限、U非空でもlocal Outbox空|completeAtは時点限定。未照合で失効しfalse/unknown。旧status DTO注入でもtrueにならない|
|R19a|全件照合の途中でK期限到来|新しいstate/checkpoint/ledger/reflectionへ適用しない。既存原証拠保持、fresh K再取得。expiryだけの恒久protectionなし、complete=false/unknown|
|R19b|全検証後・local CAS開始直前にK期限到来|CAS前再検査で当該fresh確認のcommitを開始しない。既存durable raw/checkpoint/ledger/reflection不変。隔離受信証拠は保持可|
|R19c|CAS開始時は有効、transaction complete前にK期限到来|成立したatomic保存を巻き戻したとしない。保存事実/過去reflection保持、完了後期限検査でfreshness unknown・complete=false、次cutを要求|
|R20|backup/export/JSON roundtrip、migration中断/rollback候補|原intent/receipt/results/reflections/conflicts/History/local-only全保持。旧Node全再生・旧P再公開をしない|

## 4. E/P/Mの負のゲート・追加受入

|ID|対象|必須期待結果|
|---|---|---|
|E01|標準modeの新入口へE2EE/Drive/local/unknown mode入力|未対応mode拒否。標準S承認がE可否を変えない|
|E02|凍結wireのJSON復元/同op再送/同op再暗号化|同bytesだけ重複。異ciphertext/nonce/keyVersion/headerは同identity衝突として保全|
|E03|AADの各field改変、別resource/group/世代へciphertext移植|tag/header一致検査失敗。原wire保護、空値化/通常projection更新なし|
|E04|鍵なし/誤鍵/未知keyVersion/壊れtag/意味不正を別fixture化|key-unavailableと意味rejectを分離。候補保持・保護停止、server acceptedを意味成功にしない|
|E05|同集合/異到着順/異端末locale/時計、atomic completion/Routine readSet|同validator/key/closureなら同候補/結果。欠けた依存を推測しない|
|E06|一端末だけ鍵/validator不足、serverの構造Pだけ届く|SemanticPublicationE未検証、complete禁止。不一致/不足をserver勝者選択で隠さない|
|E07|header/log/receipt/result/backup/MCP/外部cacheを静的監査|公開許可field以外の機密/平文hash/key/値漏えいなし。長さ/グラフ漏えいは記録|
|E08|rotation/遅延旧鍵操作/復旧キー/追加端末/nonce衝突注入|E詳細承認後に期待値固定。未定義をPASSにしない。同op wire書換え禁止|
|P01|署名root bootstrap/rotation/revoke、nonce冷起動、clock後退/skew|独立root/時刻根拠、誤purpose/旧鍵/再生拒否。具体供給未定ならSDKゲート閉鎖|
|P02|失効・並行control/publisher、server耐久backup復元|Auth/realm同fence、rollback検出、原本保護。mock RAMだけで耐久性を実証したとしない|
|M01|iPhone/PC draft開放中・debounce/保存/送信/遅延Adminありの移行準備|PR #123の静止・両端末freeze/drain/入力変化時準備取消・全件検証を維持。二回read一致だけで排他にしない|
|M02|pinnedNote/features/settings/History/unknown field/旧Journal/Outbox/receipt混在|raw backupにあるだけで移行成功としない。実行可能な移行先/未処理候補/履歴引継先を照合。推測変換・消失禁止|
|M03|切替/rollback競合、旧client遅延write、移行失敗再開|明示epoch fence/安全再実行。旧snapshotで新世代変更を消さない。旧ローカル変更を隔離回収|

**E02–E08/P01–P02/M01–M03は未決設計を含むplaceholder**で、実行可能な完成受入やPASS条件の分母へ数えない。表の期待結果は保持すべき方向・不変条件であり、全詳細の承認/試験可能性を意味しない。02§4の各独立レビューで入力・手順・oracleを固定して初めて受入ケースへ昇格する。E01だけは標準modeの未対応mode拒否という負のゲートをN1候補にするが、今回未実施。旧「53件」は提案行数の履歴であり53実行可能試験/53 PASSではない。今回追加した枝番も未実施計画で、件数を成功実績にしない。

## 5. 既存ゲートの保持方針

- Phase 1 58件: そのまま回帰。F1（identity衝突保護）/F2/R-F2（反映履歴とreceipt順序）、OFF/取消/古checkpoint/MV/順列を削除・緩和しない。
- Phase 2A 35件: 既存exact RecoveryGuard/atomic hydrationの旧APIはその保証で維持。Bの新入口に旧期待値を緩めて当てはめず、新規R系を追加する。既存隔離DB名制約を外さない。
- Phase 2B-1 41件と独立不変条件: 旧mock witnessの履歴試験として保持。実witnessの成立性が証明された扱いにしない。B新providerのC/P系試験へ単にrenameしない。
- PR #122の旧12件再現証拠: 削除しない。旧版常時混在syncは将来サポート対象外でも、受領/反映/候補保全に関する反例は新版回帰へ写像し、旧形式データは移行/restoreの受入として保持する。写像したIDと未実施を実装PRで報告する。

## 6. 次の実装を分割する提案（全て別途許可が必要）

|工程|隔離した成果物|入口条件/exit条件|
|---|---|---|
|N1 標準pure cut検証|新wrapper型、全map/inventory/root照合、状態判定pure、encoding test vectors|S-CUT/S-REPLICAの該当節承認と独立実装指示。C01–12/C20/R19/E01。既存API非変更、SDKなし|
|N2 耐久server模擬authority|合成durable log/admission/activation/job/fence/recovery、fault injection|N1レビュー承認、C13–19/P模擬、全件再起動/応答喪失。実Auth/Firestoreなし|
|N3 B用隔離local replica|ServerAnchorB/LocalIntegrityB/新open、atomic K/inbox/evidence、offline/hydration|N1/N2承認、R01–20、旧134回帰。実ユーザーstore/移行なし|
|N4 provider実供給設計|Auth/root/clock/nonces/IAM/backup/limits/料金/停止手順|P判定単位の未決を全て解決。実SDK前の独立レビューと接続範囲承認が必要|
|N5 許可済みSDK/実機隔離試験|使い捨てアカウント/専用scopeでreal provider crash・quota・tab/device|N1–4承認と明示実SDK接続指示。本PRは許可しない。製品有効化・Rules/移行/配信は別|
|E系並行設計|公開metadata/暗号suite/鍵運用/semantic publication/validator仕様とPoC計画|E-METADATA/E-SEMANTIC別承認。標準N系へ自動混入しない|

N1–N3はPhase 2B-2へ自動的に着手する宣言ではない。今回の停止条件を優先し、レビュー結果と次の指示を待つ。各工程でfocused→関連→全体→型/Lint/build（影響範囲に応じ必要なもの）を実行し、skip/未実施と実行結果を分ける。

## 7. 独立レビュー担当への引き継ぎ

読む順: README → 01§3–5（accepted/coverage/activation）→ 01§6–7（状態/復旧）→ 02§2/§4（Eゲート）→ 02§3 API対応 → 本書試験。

重点判定: (1)A/C/U map同値がholes/異payloadを隠さないか、(2)不変pointer＋atomic activationでcutが一貫するか、(3)署名/coverageだけで意味appliedにしないか、(4)過去reflectionとcurrent conflict/protectionが分離するか、(5)旧RecoveryGuardが自己認証へ迂回されないか、(6)E未解決を標準SDK承認へ含めていないか。

レビューはS-CUT/S-REPLICA/E-METADATA/E-SEMANTIC/P-PROVIDER/M-MIGRATIONの各単位についてAPPROVE/REQUEST CHANGES/未審査を明記する。文書のSが承認されても未決P/Eや製品実装の許可を得たとはしない。未決定項目への黙示承認は禁止。

変更範囲は本ディレクトリの新規Markdownのみ。独立ブランチは承認済みPR #127のcommit直下を基点にし、既存未push/無関係DEVを含めない。既存製品コード/設計/テスト/Rules/データ/配信状態は変更していない。Issue #107へPRと対象commitを記録し、レビュー担当へ依頼後停止。#107/#120はCloseしない。

## 8. REQUEST CHANGES対応表（R128、2026-11-10）

修正前対象`0c52fac`、指摘正本は[レビューコメント6766456424](https://github.com/yshtysht8sh10-glitch/TaskMemoApp/pull/128#issuecomment-6766456424)。以下は文書の反例修正と未実施受入の追加であり、製品バグ修正試験のFAIL→PASSを実行した報告ではない。

|指摘|修正箇所|反例・期待結果|残存リスク/未実施|
|---|---|---|---|
|R128-1 source固有の意味再計算|01 S3/S5の時点区分、S6手順6、C02/C03/C20a|source=L1でcomplete a/P1 body=base、後発L2 body=laterのbをA(L)で混ぜる誤りを排除。P1はA(L1)で検証成功、U={b}保持、complete=false、恒久protectionなし。各履歴Piも固有Lpiを使う|新verifier未実装/試験未実施。現在control保護/rejectは同期阻害として別途保持|
|R128-2 source/coverage後退禁止|01 S4条件3・no-op/拒否規則、S6手順2、C15b|完了ON→取消OFF後、現役publisher/正しいpreviousでも古L1によるON復活候補をactivation前に拒否。server control/Pとclient state/checkpoint/ledger/reflection/既存原証拠不変。拒否jobだけ別追記|server/clientの将来実装で両検査必須。既存Phase 1 coverage-regressionを維持。no-opは同source/coverage/意味roots完全一致のみ|
|cut取得後のaccepted追加/署名前Auth・epoch変更|C09a/C11b、01 S5|前者はKのsnapshotを汚さず次cutで追加op照合、後者は古資格を署名/installしない|provider実供給は未承認、ここでは合成試験計画のみ|
|照合中/CAS直前/開始後の期限切れ|01 S6期限規則、R19a–c|前二者はfresh適用開始せず既存raw等保持。開始後の成立保存は保持するがfreshness unknown/complete=false|clock/skewの実供給はPゲート未決|
|activated memberの欠落/改変・誤UID raw混入|01 S6追加規則、C20c/C11a|欠落pending/改変protected、候補非適用。別利用者のDomain/Committed/Journal/Outboxは不変。隔離保全を混入の口実にしない|実store接続なし。診断保存も原scope/opaque隔離の別境界|
|E/P/M未決試験を完成PASS条件へ数えない|本書§4のplaceholder規則|未定義oracleをPASS/実行可能な分母にしない。独立詳細承認後にケース昇格|E/P/M未審査・未承認を維持。S-REPLICAはS-CUT再レビュー待ち|

再レビューではR128-1/R128-2の規範とC02/C03/C15/C20を対照し、追加境界ケースも判定する。N1/N2/N3・実SDK・移行・配信を許可する修正ではない。
