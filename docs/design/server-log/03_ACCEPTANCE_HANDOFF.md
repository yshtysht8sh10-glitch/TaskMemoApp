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
|C02|source Lp後に別acceptedが増加する間のP activation/cut照会|A(Lp)=C、差分がU。old sourceを書換えずnew acceptedを隠さない|
|C03|A={a,b,c}、coverage={a,b}、U={c}|map同値・分割一致。ただしU非空なのでcomplete=false|
|C04|同件数だがb欠落/c重複、pageを再利用、最大ordinalだけ一致|全map/inventory検証で拒否/保護。件数/最大seqを成功根拠にしない|
|C05|coverageに未知key、同opId異payload、別baseline/epoch member|拒否/保護、原variant両方保持。正常Pを更新しない|
|C06|CとU重複、Aの一件が両方から欠落、U root偽造|分割/全map比較失敗。status unknown/protected、complete=false|
|C07|Cにあるopのresult欠落/二重/非covered result混入|一対一照合失敗。opId一致だけでapplied証跡を作らない|
|C08|Cが全Aだがconflict/dependency-pending/rejected/protectionあり|coverage完全でもcomplete=false。分類と原操作を保存|
|C09|ページ列挙中accepted/P/controlが変化|不変K配下だけ取得し混ぜない。新root通知が来れば完了判定失効し次cutを要求|
|C10|取得中に一page消失/timeout/サイズ上限|全件照合未完、空補完禁止。原本を維持しretry/unknown|
|C11|署名済み別UID/mode/replica/session/generation/epoch、旧nonce/期限|真正署名でもexpected binding不一致で拒否。旧handleへだけ保全|
|C12|同controlVersion異root、既知pinのancestor、parent欠落/fork|保護停止。bootstrap/backup同梱鍵で解決しない|
|C13|publisher stagingの各chunk前後でkill、同job再開|P pointer不変。完成後全inventory再検証。同manifest activationは一回だけ|
|C14|activation commit直前/直後kill・応答喪失|control/job結果照会で確定。未activationなら同fenceのみretry|
|C15|二publisherが同previous、旧leader再開、epoch切替とactivation競合|一つのcurrent pointer、旧fence拒否。旧候補を新checkpointに再利用しない|
|C16|receipt/intent/identity/log root各write境界でserver crash|全成立/不成立。partial acceptedを正常照会で返さない|
|C17|同op同payload連続/並行再送、actorseq/command collision|同payloadは元receipt。異payload collisionは双方保全・sticky protection、次正常activation禁止|
|C18|pre-admission reject、accepted後の処理reject|A外AdmissionRejectionとC内Rejectedを混同しない。未解決rejectを成功扱いしない|
|C19|server backup後退/台帳再起動/全喪失、client pin残存|比較可能な後退を検出、原本保護。clientを無条件にserverへ再登録しない|
|C20|標準modeの全reducer再計算とmanifestが不一致、unknown version|署名だけで通さず保護。未来schemaの推測補完禁止|

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

E02–E08/P01–P02/M01–M03は計画であり、本PRで方式の全詳細が承認済みとはしない。未決定箇所は02§4の単位別にレビュー/期待値を固定してから実装する。

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
