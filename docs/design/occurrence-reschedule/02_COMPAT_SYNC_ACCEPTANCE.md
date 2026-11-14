# 02 — 互換性・同期依存・受入計画・レビュー引き継ぎ

## 1. 保存/復元/移行の互換性調査

現行e18c4d1のコードから分かる事実と、提案を区別する。本番データの残存量/不正key/実際のzone/各端末の未同期量は調べていない。今回それらを読み取る必要はなく、実行時の事前診断を将来の別承認にする。

|現行保存対象/経路|コード上の事実|新機能で必要な対応案|
|---|---|---|
|Memo本体/RepeatRule|旧Nodeを直接表示する|既存field/unknown fieldを保持。schedule移動で本体rule/startsOn/dueAt/statusを上書きしない|
|routineDueOverrides|日付→ISO/null、旧codecはmapをwinner順で合成|既存値はそのまま互換baselineへ保存。新scheduleがないkeyだけ旧値を使う。明示baseで旧値へfallbackしない|
|routineHistory/routineOutcomes|outcomes優先、pendingは明示取消。日付別mergeはversion/time/stateによる旧register|元日付keyを維持。新result正本から投影し、旧registerと二重勝者選択しない。全旧History/旧outcome/ACK/原操作は保存|
|routineLifecycle/retained|期間snapshotと元日付を保持|close前に発生し延期した回を保持するmappingを全件照合。新anchorと旧retainedが同keyで矛盾すれば隔離候補|
|routineDeadlineSortKeys|元日付別のrank|初回baselineで元refへ対応。移動先でrankを再計算するときだけ対象refを更新。元mapを全削除/全初期化しない|
|`nodeV2Codec`|既知DateのみISO変換しunknown fieldを保持|新projectionの検証/roundtripを追加する必要。unknownを透過保存するだけで正しい同期とは判定できない|
|`firebaseNodeCodec`/`revisionModel`|whole Node勝者選択＋一部日別fieldの特別merge。新scheduleの因果判定はない|新fieldを追加するだけの旧同期公開を禁止。#107側の共通intentへ明示接続する別承認が必要|
|Journal/Committed/raw CAS/Outbox/receipt|既存atomic保存・期待raw・保護復旧の契約|anchor、schedule、rank、History、送信義務と証跡を同一候補へ束縛。CAS前に採番/メモリ/Outbox退役を確定しない|
|NodeHistory/V2 History|Node snapshot/旧revision基準、日別outcome取消を特別処理|新schedule/rank/resultに対する属性補償intentへ接続。古い全Nodeを戻して他端末の変更を消さない|
|`nodeBackup` schemaVersion=4|通常Node/設定等をexportし、既知Routine fieldを検証。任意新field/新intent/因果証跡の完全復元保証はない|通常export（閲覧/可搬データ）と完全checkpointを区別。新schema/capabilityの確認を要する。version番号は未割当|

### 1.1 旧形式を捨てない読み込み

新fieldがない定義は旧readerの互換adapterで同じ意味に表示する。起動時に全Routineへ空map/全Occurrence Nodeを作らない。延期機能を使わない既存データへ日時や履歴を無断移行しない。

初回の対象回操作で必要なanchor/新属性baselineを作る**論理的な取込み**は要るが、旧形式を読み込むだけの全面rewriteは不要という提案。ただしCloudの旧writer停止/新同期世代への切替は別問題で、#107の承認済み「明示的な一度限りの移行」を迂回しない。#107基点のbaselineを既に持つ場合も、Routine属性の新version導入/enrollment手順は独立レビューする。

旧overrideが有効な同日ISOなら互換schedule値として保持。旧nullは取消の由来を保持し、単なるfield欠落へ戻さない。既存の未来ISOが見つかっても削除/日付clampしない。生成根拠/zone/元keyが検証できればそのまま候補取込み、できなければ原値付き要確認候補。旧keyが不正/定義の現在ruleで説明できない場合も、履歴や未同期操作ごと捨てない。

旧outcomesとHistoryの矛盾は旧仕様による有効表示と原両値を保存する。過去receiptを一括再生して完了を復活させず、#107のalready-represented/provable-unapplied/unresolved分類へ接続する。未知形式/不正日付/欠けたanchorは空一覧扱いにせず、該当scopeの原本を保護して診断する。

### 1.2 全永続データの照合とrollback

取込み/backup復元はID/countだけでなく、定義全field、元ref集合、旧override/null、元日別outcome/History、retained、並べ順、local-only操作、History/Undo/Redo、Outbox/receipt、全原intent/競合候補/反映証跡、unknown fieldを意味照合する。端末固有設定/常設メモ等は#107移行台帳のまま保持し、#130の対象外という理由で落とさない。raw backupに存在するだけでは成功にしない。

完全checkpointは新projectionだけでなくanchor原本、属性因果、操作/receipt/結果来歴、scope/世代/manifest/保護、未受領義務を含む。通常のNode JSON exportをその代わりとしない。復元は別候補領域で検証し、元データ/未送信操作をserver値で全置換しない。

公開切替時はiPhone/PCの実行version、編集中入力/debounce、遅延commit/外部producer、未受領/awaiting、Journal/Committedの状態を照合し、write freeze/drainとfenceを維持する。アプリの「最新版です」表示だけで旧writerを止めたとはみなさない。Rules/controlを変える必要があれば別設計/実行承認とする。

新scheduleを書いた後に旧client/旧backupへ単純rollbackすると延期/取消/候補を失い得る。新formatを理解する互換clientへのrollback/forward fixと、原本を残す明示復旧を基本とする。旧PWAの再インストール・初期化・強制同期を救済策にしない。後から復帰した旧端末の未同期変更は旧scopeへ退避し、receipt/元refを照合して明示取込みする。

## 2. #107の新同期との依存（開発非干渉）

参照のみ: PR #123 `212461c`、B案規範PR #128 `cd36f49`、N1提出PR #129 `98aa972`。今回これらのファイル/ブランチ/Issue状態を変更しない。N1の現行Write unionはcompletion/emphasis/title/body/placement/ideasEnabledまでで、Routine date scheduleを受け付ける製品経路ではない。設計にRoutine date overrideの概念があることと実装済みであることを混同しない。

|接続対象|#130から求める契約案|公開前に必要な別承認|
|---|---|---|
|属性モデル|OccurrenceRefを対象とするschedule/result/rank、immutable anchor、観測head/source、reset/resolve/undo intent|新resource/属性groupのschema/validator/reducer拡張。既存属性へcastして入れない|
|属性間合成|別ref/本文は合成。同ref schedule並行はMV。schedule+resultは元ref上で合成しresultを巻き戻さない|因果closureに基づくreadSet/atomic group/意味guardの試験。到着時current値だけの判定禁止|
|安全保存|anchor+move+必要rank+History/送信義務を一atomic候補、raw CAS/Journal保護|#107のB用local保存/復元入口と実adapterの承認。旧RecoveryGuard自己生成を使わない|
|server正本|immutable意図/accepted、result/publication、完全coverage/U、scope/世代fence|B server durable log/activation/真正providerの必要部分。N1pure verifierだけでは足りない|
|受領/反映/競合|server accepted/local persisted/publication applied/current conflict resolvedを別表示|ACK後でも未反映/競合候補を保持するledger/receipt/reflection接続|
|旧writer/移行|旧Nodeの保存と新schedule原本を別世代/capabilityで守り、後発local回収|明示一度限りmigration/旧writerのserver側拒否。iPhoneとPCの更新だけで完了扱いしない|
|4モード/#119|Firebase標準の最初の公開案。E2EEではschedule値/zone/anchor/履歴等の機密を分類|Eのmetadata/AAD/semantic publicationは別未承認。標準承認をE/Drive/local通信へ流用しない|

**推奨公開順**は、#130純粋Domain/表示の合成PoC計画を先に独立レビュー可能にし、その後#107の必要なRoutine属性・耐久保存・server/provider・移行のゲートと接続してから実機/公開へ進むこと。本PRはどの実装にも着手しない。#107全機能やQueue/#120 UIの完成まで一律依存させる意図ではなく、上表のデータ保護に必要な最小能力を依存として列挙している。

現行V2へ一時的な`version/changedAt`付きmapを追加して先行公開する案は非推奨。Node競合負け/ACK退役を含む既知問題を回避したことにならない。先行公開が必要なら独立の安全protocolを設計・審査する必要があり、このPRで暗黙許可しない。

## 3. #113/#118との整合

|Issue|確認した未実装要件|#130の扱い|
|---|---|---|
|#113|周期と「期間内に1回/指定日に実施」を分ける。既存意味/周期変更/過去実績の移行は未決|今回のoriginKindは既存日付回を明示。延期を「その月ならいつでも達成」へ変えない。月跨ぎ延期でも元月の元回の完了。将来period identityが必要なら別mapping/sourceKindで設計し、日付keyを無断再利用しない|
|#118|毎月は2–3日前から表示し、前倒し完了でも予定日に再出現しない。既存表示の初期値は変更しない|将来の事前表示も同じ元OccurrenceRefを渡す。実行日/操作日でkeyを作らない。#130は未来回の事前生成/前倒し完了を有効化しない。lookahead候補と延期anchorの集合和で将来重複させない|
|#58/#96/#102|当日内時刻変更、元日付別rank、範囲日時の確認|既存同日操作を維持し、今回の明示ref移動だけを過去回にも拡張。editable範囲を勝手な日付に即確定しない|
|#109/#114|定義close/再開と保持済み過去回、管理treeの完了button整理|延期予定がclose後でも元回がclose前に発生済みなら保持。tree操作を日別完了へ混同しない|

期間内方式や将来回で「元の発生日」の意味を確定できない場合、その方式に#130を自動適用しない。未対応を表示して原データを保持し、#113/#118側の設計承認へ戻す。

## 4. 合成データ受入計画（全て未実施）

以下は将来実装のoracle案で、今回のPASS報告ではない。実ユーザーのタイトル/本文/保存値はfixtureに使わない。全ケースでrepeatRule/startsOn/定義dueAt/他回の結果・順位・unknown field、元ref、原操作/receipt/競合/Historyを比較する。

|ID|合成入力/操作|期待結果|
|---|---|---|
|A01|日次11/13分を11/14夜へDnD|元key=13を保持、14予定へ一件。本体不変、14分は別途通常生成|
|A02|週次/月次の発生日を翌日（非発生日）へ延期|移動先の周期適合を要求せず表示/完了可。次週/翌月の通常日程不変|
|A03|月次11/13→11/14、13→14の日跨ぎ/再起動|安定ref/UI keyで一件、定義ID行と旧過去投影の重複なし|
|A04|月末1/31→2/1、短月2/28、閏日2/29|元回の同一性と次回clamp規則を維持、31日分の履歴を2/1へ付替えない|
|A05|12/31→翌年1/2|scope/元年key不変、予定年と完了年を別保持|
|A06|予定日が既に過ぎたまま起動|有効plannedAt基準で期限切れ。元日だけで早く期限切れ扱いしない|
|A07|同日朝/昼/夜変更を新UIで操作|従来と同様に当回だけ変更し、翌回へ引継がない|
|A08|同じRoutineの14日分がある14日へ13日分を延期|二つの元refを別表示、片方完了で他方を消さず自動mergeしない|
|A09|月次を翌月の発生日まで延期|元月/新月の二回を共存、元月の完了を新月へ流用しない|
|A10|過去pending回→今日/未来へ移動|当日回と共通ref経路で成功。元日/outcomesは維持|
|A11|schedule＋rank移動、rank-only、片側保存失敗（A11a–c）|移動Undo/Redoは両属性、rank-onlyはrankだけ。§4.1のhead/group/History規範を検査し、他ref不変|
|A12|base復帰、再移動後base、古いat再配送|元日時へ明示復帰。因果後続baseを古いatが上書きしない|
|A13|旧override昼＋元rankからの初回移動、完了/取消後の補償（A13a/b）|元有効scheduleとrankを両方明示復帰。anchor消去/旧map削除なし。結果/完了snapshotは補償対象外|
|A14|元日復帰が過去日/予定なしbucketへdrop|前者は期限切れ確認、後者は理由/日時選択。不明日時へ勝手に保存しない|
|A15|延期回を予定日/別日に完了/skip|元keyへresult、実日時は別記録。元日/予定日にも二重出現しない|
|A16|完了/skip取消、結果をUndo/Redo|延期先のscheduleへpending表示、別回と定義完了状態は不変|
|A17|二回を同時選択して片方だけ完了/延期|定義IDで選択dedupせず、選択したrefだけ更新|
|A18|completed/skipped回を直接DnD|取消を案内、履歴の予定snapshotを無断変更しない|
|A19|drag開始後の深夜跨ぎ、確認中の日跨ぎ|元ref不変、具体target日時を再確認。「明日」の意味を黙って変えない|
|A20|Routine policy採用/変更、account default/表示zone変更、長期offline（A20a/b）|Routine単位の不変policy区間で生成。表示zoneではidentityを変えず、旧policyの未検証候補を再bindしない|
|A21|DST gap/fold、旧回zone不明（A21a/b）|規範の固定入力で候補offset/証拠を検査。自動検証とLegacyConfirmationを区別|
|A22|延期後にrepeatRule/startsOn/基本時刻を変更|固定anchorの既発生回は保持。新周期の将来生成へ延期値を引継がない|
|A23|延期後に定義close（予定はclose後）/再開|保持済み元回は残り、新しい将来回だけ停止。再開でも重複なし|
|A24|初回anchorとrule/startsOn変更/closeの因果順/並行（A24a–c）。所属/削除の境界はD3/D4|先行anchor保持、新contextで再検証、真の並行は関連group双方保全と未解決表示。先着勝者なし|
|A25|soft-delete/restoreの前後に未完了延期回あり|非表示中も原本を保持し、restoreで同schedule/refを回復|
|A26|二端末が同refを別日へ同時移動/到着順逆転|MV候補両方・同じ候補集合へ収束、時計/Node revision勝者なし|
|A27|異ref/本文とmoveを並行、同ref move+完了を並行|独立属性を合成、結果を未完了へ戻さず予定候補/観測snapshotを保持|
|A28|remote rank-only、schedule-only、真の並行/二重resolve（A28a–c）|両属性headを検証しUndo/Redo全groupを保留。片側補償や値一致によるhead検査省略は禁止|
|A29|duplicate op/receipt/publication、ACK先着/後着、applied→conflict|原intent/receipt/reflection/現在競合を別保存、Outbox誤退役なし|
|A30|offline発行→再起動→再接続、別UID/旧epoch応答|未受領copy保持、現役scopeで再検証、旧scope操作を新scopeへ書換えない|
|A31|atomic保存前abort/quota、CAS応答喪失、Journal不一致|seq/メモリ/Outbox先行なし、原本保持/明示復旧。新refへ再採番して隠さない|
|A32|旧Node/旧override null/旧History/旧outcome/retained混在|非破壊readerで同じ意味。初回対象回だけ根拠付きbaseline対応、全履歴不変|
|A33|不正旧date/未来override/unknown fields、同ref並行anchor（A33a/b）|不明原本を保持。同anchorは冪等、異なるanchorは双方候補＋初回move group保護|
|A34|通常export/完全checkpoint、JSON往復/別端末restore|互換性を区別。完全形式では全原操作/候補/証跡/local-only/rank/Historyを照合|
|A35|旧PWAが残る/後発offline旧端末/外部producer|旧writer fenceを検証、未同期原本を退避回収。新fieldが残るだけで安全としない|
|A36|世代切替途中失敗/rollback/再実行|元source保持、全件意味照合、明示fence切替、新予定を失う旧snapshot再公開禁止|
|A37|#113期間型/#118未来表示が未対応の入力|勝手に日付型へ変換しない。既存データ保全、未対応ゲートを明示|
|A38|将来#118承認後、事前表示と延期anchorが重なる|同元refでdedup、前倒し完了は元予定日に再出現しない。現scopeでは未実施|
|A39|大量の過去/延期回（100/500/1,000/5,000）|候補数/走査時間/起動一覧時間/同期完了を別計測、性能劣化で全件を黙って打切らない|
|A40|iPhone PWA touch、PC mouse、深夜・月末のUI操作|移動前後の元日/予定/結果の表示が一致。jsdom/pure PASSを実機PASSとしない|

### 4.1 D1/D2再レビュー用の具体反例・oracle（未実施）

共通ref O=(R,2026-11-13)、別ref X=(R,2026-11-14)、本文B、result pendingを用意する。S0=13日夜、S1=14日夜、S2=15日夜、元rank r0、移動先rank r1、remote rank r2。frontierを属性別hS0/hR0と表す。MはS1/r1へatomic移動しhS(M)/hR(M)を作る。全ケースで値だけでなく、両head/frontier、全候補group、History原command/補償refs/stage、origin/source証拠、result/本文/Xの値・head不変性を比較する。

|枝番|反例/手順|固定する期待結果|
|---|---|---|
|A11a|S0/r0→M→Undo U→Redo V、外部変更なし|S1/r1→S0/r0→S1/r1。U/Vは両属性へ新headを作り過去headを復活させない。Historyは原Mを一件のユーザー操作として保ち、U/V来歴を追記。候補競合なし、B/result/X不変|
|A11b|同bucket Qがrank r0→r1のみ変更、Undo/Redo|r0→r1→r0→r1、rankだけ新head。schedule S0/hS0は不変。schedule contextが後から変わればQ補償全体を保留。History対象集合はrank一つ|
|A11c|M/U/Vのいずれかでrank memberだけ検証/保存失敗、abort/quota、片側publication欠落|group全体が未適用/保留。既存S/r・両head・確定History stage不変。両方の候補/送信義務/原証拠を保持し、片側反映/Outbox退役なし。commit応答喪失は全targetか旧rawを確定するまでunknown。実adapter試験はD3/D4未実施|
|A13a|旧override=13日昼、rank=r0。初回anchor＋Mで14日夜/r1へ、Undo/Redo|Undoは明示at(13日昼)/r0、Redoは14日夜/r1。anchorと旧override原ISO/旧null由来は保持。base(13日夜)へ誤復帰しない。両headは補償ごと更新、他ref不変|
|A13b|M後に遠隔complete、またはcomplete→cancel。その後MのUndo/Redoを指定|schedule/rankだけA11aと同じ補償、現在result/headは維持。completedなら行は非表示、取消後は補償後S/rへ一件。完了時actor snapshotは元の観測値のまま。通常stack上位の自分の完了をskipして黙って移動Undoしない|
|A28a|M後、remote rank-only QでS1/r2/hS(M),hR(Q)。旧MをUndo要求|両frontier検査でgroup全体保留。現在S1/r2・両headを維持、S0/r0の未適用要求を保全。HistoryをUndo済みにしない。scheduleだけS0へ戻さない。Undo成功後のremote rank変更に対するRedoも同様|
|A28b|M後、remote schedule-only ZでS2/r1/hS(Z),hR(M)。旧MをUndo要求|現在S2/r1を維持、補償全体保留。rankだけr0へ戻さず候補/原M/Zを保持。同値S1でも新hS(Z)なら無条件補償禁止。Redoも両head検査|
|A28c|Mを基点にU(S0/r0)とQ(rank=r2)を並行発行、順逆/重複/各段階JSON復元。別組ではZ(schedule=S2)|最終group候補はU組(S0,r0)とQ組(S1,r2)、またはZ組(S2,r1)を同集合で保持。正常projectionのS0/r2を作らない。過去U applied reflectionは残し、現在競合/History blockedを別計上。明示resolveは全group候補/両属性を観測|
|A20a|表示zone/default変更の非干渉に加え、T0確認→旧zone release進行→T1切替を検査（§4.2）|表示変更だけでは生成不変。区間確定はT1のF/条件と不可分。未anchor/anchor済みを共に保全し、無効Bは通常activationしない。正例も§4.2で固定|
|A20b|policy切替前/後/並行のanchor、長期offline、初回policy適用、失敗/重複/応答喪失（§4.2）|元日付の区間で再照合。旧ref/元instant/原intentを保全、未確認将来要求はdraft/隔離。T0条件の再利用/B自動補正/二重activationなし|
|A21a|固定tzRulesでAmerica/New_York、2026-03-08 02:30（gap）、2026-11-01 01:30（fold）を入力|gap候補を自動03:30にしない。foldはoffset -04:00（05:30Z）/-05:00（06:30Z）の二候補を提示し選択を記録。未選択はanchor/schedule head不変、選択後は指定instantでのみ再検証。規則版差で候補が違えば保留|
|A21b|旧dueAt ISOだけでzone不明、retained instantと基本wall timeの由来も不足|raw/元key/retained/overrideを保持し自動verifiedへ昇格しない。LegacyConfirmationで採用zone/wall time/offset/対象範囲を記録後のみconfirmed-legacy候補として再検証。未確認別日へ波及なし、未来Dは確認だけでanchor新設不可|
|A24a|初回anchor＋Mが因果先行、その後rule/startsOn変更またはclose。予定日経過後に完了|元anchor/予定を保持しcloseならretainedに含む。現rule非適合でも元refを完了でき、結果key不変。次回生成とXへ延期値を引継がない|
|A24b|rule変更/closeが因果先行、旧viewから初回anchor要求|新contextへ再検証。認証過去release根拠が完全（close後はretainedあり）なら同元回を固定可。不足なら要求/原本をunresolvedに保持し新anchor未確定。旧current rule/receiptだけで許可を作らない|
|A24c|初回anchor＋move groupと、eligibility/base/retainedを変えるrule/startsOn変更またはcloseが真に並行。両順序/重複/JSON復元|双方のgroup/anchor候補/原closureを保持し当該Routine未解決表示。通常projectionを先着選択せず、新anchor/両head/Historyを成功確定しない。他Routine/B不変。先に検証したapplied履歴は消さず現在競合と分離|
|A33a|二端末が同Oへ同semantic anchorを初回生成、証明取得順/cutだけ異なる|anchor一つへ正規化、両source証拠/op/History要求を保存。schedule/rankが異なるなら移動の並行競合を別検査。Task二重生成なし|
|A33b|二端末が同Oへ異なるrule版/zone/baseScheduledAt/LegacyConfirmationのanchorを提示|両anchor＋初回move groupを保全しRoutine保護。値/headを任意選択せず、元refを二つに分割しない。欠落closureはpending、改ざんは保護と区別|
|A04+09|2026-01-31月次回を2026-02-28へ延期し、時計/cutを2/28のrelease後へ進めて通常clamp回も生成。1/31分だけcomplete→cancel、2/28分だけskip|2/28前に未発生回を作らず、release後に二つの元refで共存。1/31結果だけ完了/取消、2/28結果だけskip。各schedule/head/History/証拠を相互に上書きせず、次の3/31生成不変|
|A27追加|二端末別日moveと第三端末complete→cancelを順逆/重複/JSON復元|同schedule候補集合、resultは因果後続pending、観測snapshot/原receipt/反映履歴を保全。他ref不変。到着時current outcomeを使ってmoveを消さない|
|A25+30|延期後soft-delete/restoreと旧offline端末move再配送|元intent/未受領コピーとanchorを保持。moveだけで削除/所属を復活させない。restore後の採否/意味競合はD3/D4の別oracle確定前にPASSへしない|

固定zone例は合成fixtureであり、旧ユーザーデータをTokyo/LAへ推定する指示ではない。DSTの具体offsetは固定tzRules fixtureに束縛し、実装時のOS最新ルールへ依存させない。

D1/D2の本改訂は上表のpure状態遷移oracleを**提案**する。A11cの実保存、A20bの実control/通信、A24c/A28c/A27の実reducer、A25+30/A34–36の完全schema/運用、A38の#118はD3/D4/D5や別Issueの未承認条件を含む。UI候補/Historyの論理oracleと実adapterの実証を分け、具体protocol/入力/上限/validatorを該当レビューで固定するまで完成受入やPASSの分母へ数えない。今回全て未実施で、全体/focused/型/Lint/build/実機試験も設計のみのため未実施。

### 4.2 D1-F1 — A20a/A20bの線形化境界反例（全て未実施）

固定offsetの合成daily Routine Rを使う（実ユーザーzoneを推定する例ではない）。旧policy P9はUTC+09、新policy候補P0はUTC、基本wall time=23:00、元ref O15=(R,2026-11-15)。旧zoneの11/15 releaseは`2026-11-14T15:00:00Z`、O15の旧base instantは`2026-11-15T14:00:00Z`。新zoneでO15を再解釈した`2026-11-15T23:00:00Z`へ変更してはならない。

共通T0=`2026-11-14T14:59:00Z`にB=11/15を確認する。F(T0)=11/14、新zoneのB開始=`2026-11-15T00:00:00Z`。共通T1=`2026-11-14T15:01:00Z`ではF(T1)=11/15であり、新zone B開始>T1だけは成立する。初期に他のref/本文/result/Historyは変えず、保存証拠には原requestId/payload・B・T0と、実判断T1/cut・F・head/区間・結果を含める。

|枝番|順序/障害|最終policy区間、F/B、元回/anchor/要求/証拠の期待結果|
|---|---|---|
|A20a-F1|T0でB=15確認、T1まで待つ。O15は未anchor|F1=15、B=15なので通常activation拒否/再確認待ち。P9区間は切れずP0はactiveにならない。O15は旧policyでrelease済みのまま、anchorは未作成でも元base=11/15 14:00Zの根拠を保持。元B=15の未適用requestとT0/T1/F1/拒否証拠を保存|
|A20a-F2|T0後の`11/14 15:00:30Z`にP9でO15のanchor＋初回moveを正当に作成。その後T1で切替要求|F1=15/B=15で切替拒否。P9/O15/旧base 14:00Z/既存anchor/source・move・Historyは不変。anchorを新zoneへrebaseせず、拒否request/根拠だけ追記する|
|A20b-F1|切替をT1で拒否した後、`15:02Z`にP9でO15の初回anchor要求|active区間はP9のまま。新cut/sourceと既存許可条件が満たされれば同O15/旧base 14:00Zで作成できる。失敗したP0候補の存在で旧回を消さない。B=15の要求は再確認待ちのまま保持|
|A20b-F2|O15のP9 anchor要求と、B=15切替がT1で並行（anchor先/切替先の二順）|両順ともF1=15で切替不可。anchorが許可条件を満たせばP9/O15/14:00Zで一つ、重複要求は証拠だけ保持。未anchorでも拒否条件は同じ。policy/anchorの配送順でP0版のO15を作らない|
|A20a-OK1|別の正例でT0に本人が初めからB=16を確認し、共通T1まで遅れる|F1=15<B=16、新zoneの16日開始=11/16 00:00Z>T1なので、他条件不変なら成功。P9はD<16、P0はD>=16。O15/14:00Zは旧回として不変、未anchorでも後で固定可。B16の成功request/T1/F15/区間証拠を不可分保存。失敗B15を自動補正した事例ではない|
|A20a-OK2|B=15をT0確認、別正例T1early=`11/14 14:59:30Z`で確定|F=14<B15、新開始>T1earlyで成功。P9はD<15/P0はD>=15。以後15日のreleaseはP0の11/15 00:00Zで、P9の将来15日回を追加しない。元々既releaseの14日回/証拠は不変。成功点T1earlyを後刻の再送で書換えない|
|A20b-OK1|OK1のB16切替に対し、O15のP9 anchor作成が前/後/真に並行（三順）|切替のF1はanchor有無によらず15、区間P9:D<16/P0:D>=16で一致。各source/時刻が正当ならO15/14:00Zの同anchor一つへ収束。後着も元日付区間P9で検証。全要求/証拠を保持し他ref不変。binding/他前提が不明なら保留で消さない|
|A20b-OK2|OK1成功後、offline端末が旧P9だけを使いO16を未確認で要求|新policy区間は維持（O16はP0、release=11/16 00:00Z、基本23:00Z）。旧P9のO16 anchorを通常作成せずdraft/隔離原本保持。現在のcut/元区間で本人再確認まで新baseへ自動変換しない。O15/既存anchorも不変|
|A20b-C1|T0後・共通T1前（`15:00:45Z`）にconfigの基本時刻を23→22へ変更|既release O15を含めF1=15、B15。確認config head不一致でも切替拒否/再確認。P9区間維持、config変更そのものは戻さない。既存O15 anchorがあればbase14:00Z不変。requestは古い確認値のまま保存し、新head/Fと拒否根拠を追記|
|A20b-C2|同時刻にclose（O15は既releaseでretainedへ）|F1=15/B15、lifecycle head変更/closed条件により切替不可。P9とclose/retained/O15/既存anchorは保持。closeをT0のopenへ戻さず、旧request/両cut/理由を保存|
|A20b-C3|同時刻に別requestでB16の正当policy切替が先に成功|現役区間はP9:D<16/P0:D>=16、F1=15。元B15 requestはpolicy head不一致で拒否/再確認。先に成功した区間/成功証拠とO15を維持し、旧P9全域へ戻さない|
|A20b-C4|OK1のB16要求とconfig/close/別policy更新が並行|時点fenceで順序を決める。外部変更が先ならそのheadで再確認となり当該要求は未適用。切替が先ならT1/F15/B16の成功区間・証拠を保持し、後続変更は新contextで別検証。古いT0 headで両方を確定しない。D2のHistory規則を変更しない|
|A20b-E1|B15確認後、T1確定前にabort/通信失敗。再試行判断点が共通T1となる|元P9区間、未適用request、原B15/T0証拠を保持。再試行はF1=15を再計算して再確認待ち、旧成功条件を再利用しない。B16を自動選択しない|
|A20b-E2|OK1のB16でT1のcommit応答だけ喪失、同requestId/payloadで再照会・重複送信|確定済みならP9:D<16/P0:D>=16と当時T1/F15/B16結果を回収、anchor/元instant不変。再activation/新B/新request採番なし。結果未確認ならunknown、旧rawまたは全targetの確定まで切替成功を表示しない|
|A20b-E3|A20a-F1の境界拒否が確定後、同じ要求を翌日/長期offline復帰時に再送|同じB15の拒否結果と証拠を返し未適用要求を保持。未受領原本も消さない。新Bの本人再確認と別requestIdなしに成功へ変更しない。新requestは旧request参照を残し、その新T1で再評価|
|A20b-E4|旧Routineの初回policy適用。旧zoneは明示確認/原本照合済みP9相当、T0でB15確認、共通T1で適用|未anchor O15もF1=15へ含め初回適用拒否。従来の生成/旧元ref/旧instant/原anchor/旧原本はそのまま。共有policyなしの状態を勝手にP0へ変えず、初回要求/確認/拒否証拠を保持。正例は再確認済みB16でOK1と同じ境界検査|
|A20b-E5|初回適用で旧zone/来歴/未同期原本が未確認のまま時間経過|F=unknownで保留。Tokyo/端末時刻/空anchor mapからF14/F15と推定しない。Bは本人が選んだ値のまま、全旧データ/要求/不足証拠を保存。D4照合前に初回適用成功としない|
|A20b-E6|T1相当の時刻確認後、確定がさらに遅れ旧release境界を越え得る実provider案|その古い読取点をT1と呼ばない。確定点の再条件評価または同等の不可分な時間fenceを立証できなければ通常activation不可。F/B/旧区間/anchorを保全。D3の実transaction試験は本PR未実施|

上記は固定traceに対するD1の論理oracleで、製品CalendarPolicy/認証時刻/transaction/排他/実zone DBの試験結果ではない。D3/D4はBLOCKED、D5未審査を維持する。D2承認済みのA11/A13/A28・History/補償規範は本修正の対象外であり、内容を変更しない。

## 5. 実装分割案・独立レビューの判定単位

|単位/将来工程|判断依頼|実装への条件|
|---|---|---|
|D1 Domainモデル|元identity/anchor/schedule、Routine CalendarPolicy/zone変更区間、source closure/旧回確認、初回作成・生成/完了対象|01§2.3–2.5とA20/A21/A24/A33の提案を独立承認し、明示指示後に合成pure PoCだけ。実policy/認証baseline供給はD3/D4未承認|
|D2 UI/履歴|安定ref、当日/過去DnD、範囲確認、一括対象、結果時snapshot、write-set全体のUndo/Redo|01§4.1とA11/A13/A28の具体oracleを独立承認。製品store未接続のハーネスから。#107へ無断接続しない|
|D3 同期拡張|新属性/schemaと因果/MV・atomic group/readSet/result合成|#107担当の別設計レビューと必要基盤承認。現N1への属性追加やN2/N3進行を本PRで許可しない|
|D4 互換/移行/復旧|旧field対応、完全checkpoint、旧writer停止、後発端末回収、rollback|明示移行計画/全永続種別照合/両端末静止を別承認。実データは別許可|
|D5 DEV/実機・リリース|A40等の実UI、save/restart/sync、性能/旧client|D1–4の該当承認と接続scope/使い捨てアカウント/停止手順を固定。DEV/Production配信はリリース担当の別承認|

本改訂はzoneの管理単位/適用区間/旧回確認とHistory補償oracleを提案規範として固定したが、承認済みとはしない。実装を始める前に採否をレビューし、現行date方式と#113/#118の境界、同時schedule/result/groupの実reducer、zoneルール実体/認証cut供給、完全形式/codecのversion等を推測補完しない。初期公開をFirebase標準に限定する案の可否も判断対象。E2EE/Drive/localの新同期実装を抱き合わせない。

## 6. レビュー担当への引き継ぎ

読む順: README → 01§1の現行事実 → §2 identity/anchor → §3集合和生成 → §4操作 → §5 lifecycle/履歴 → §6競合 → 本書互換/#107依存/受入。

重点は「延期で次回をずらさない」「元日付が操作日へ変わらない」「同じ予定日に二件を保つ」「旧scheduleへ巻き戻らない」「延期後のrule変更/closeで消えない」「未対応旧形式を落とさない」「#107の新属性対応/実運用を実装済みと誤認しない」。D1–D5と未決ゲートごとにAPPROVE/REQUEST CHANGES/未審査を区別してほしい。

今回の変更はこの設計ディレクトリのMarkdownだけ。e18c4d1基点で調査結果を参照し、#107/既存API/再現テスト/製品コードは非変更。GitHub #130/#113/#118本文と追跡済みソース、#107の承認設計/提出APIを読んだ。実データ/端末DB/SDK/Rules/配信は操作していない。

文書のリンク/表/fence、製品基点/差分範囲、#107 worktree非変更、diff checkを確認し、commit/push・独立PR・Issue #130への記録後に停止する。レビュー結果前に実装しない。

## 7. 独立レビュー指摘への対応（2026-11-14、再レビュー待ち）

指摘正本は[6858422424](https://github.com/yshtysht8sh10-glitch/TaskMemoApp/pull/131#issuecomment-6858422424)、修正前commitは`106bcf9078f472698e17103b6ae4d5a784eaefb5`。以下は文書上の反例検討/提案修正であり、製品実装のFAIL→PASSや利用者データの確認ではない。

|指摘|修正した文書/節|反例と修正規範|対応受入|残存条件|
|---|---|---|---|---|
|D1 管理単位/表示zone/変更|01§2.3|account可変zoneによる全過去再解釈を避け、Routine単位の不変policyをgenerationへ束縛。既release上限Fより後・新暦日開始がcutより後のBで切り、旧区間/anchor/keyは不変|A20a/b、A21a/b|zoneルール実体/初期採用UI/control供給、実writer fenceはD3/D4|
|D1 旧回根拠/初回anchor|01§2.4|当日/過去/retained/override別に自動検証と本人採用を分離。有限baseline→定義/lifecycle/policy closure、releaseAt<=cut、旧原本対応を要求。未知zoneをTokyo等に推定せず、確認はconfirmed-legacyと明示|A21b、A24a–c、A32/A33|旧原本の認証baseline対応/完全schemaはD4未承認。future/#118を確認だけで作れない|
|D1 DST/短月/並行anchor|01§2.5|gap推測シフト禁止、fold offset選択、clampの版を固定。同semantic anchorは冪等、異anchorは初回moveごと保護。rule/closeとの因果順/並行を分ける|A21a、A24a–c、A33a/b、A04+09|候補/保護解除と意味reducerの実装はD3/D4。D1案の採否自体が再レビュー対象|
|R131-1 正常Undo/Redo|01§4操作表/§4.1、§6末尾|M:S0/r0→S1/r1のUndoをS0/r1にせず、同write-set全体をS0/r0へ補償。before/after/両head/group/原opをHistoryに保持し新U/V headを発行|A11a、A13a/b|History/local pending/確定cursorの実adapterはD3/D4。旧Node snapshot再生は禁止|
|R131-1 remote片属性/rank-only|01§4.1|remote r2やS2をschedule headだけで上書きしない。両head検査で補償全体保留。rank-onlyはrankだけ補償しschedule contextを検査。真の並行は整合する組の候補で保持|A11b、A28a–c|group意味競合/明示resolveのwire/実reducerはD3未承認|
|R131-1 片側失敗/結果との境界|01§4.1|片属性失敗で両head/確定History不変。完了/取消は補償write-set外、元result/headとactor観測snapshotを保持|A11c、A13b、A27追加|実CAS/Journal/receipt/Publicationと保存障害注入はD3/D4未実施|

再レビュー依頼はD1/D2の提案規範と反例への整合性に限定する。D3/D4のBLOCKED、D5未審査、#113/#118の未承認境界を維持。製品コード/SDK/Rules/実データ/配信/#107の実装を変更しない。修正を同じPR branchへpushし、PR #131とIssue #130へ対象SHA/差分を記録して停止する。

## 8. D1-F1限定修正・再レビュー引き継ぎ

修正前`f2490ef881ab402993cb27487ae4bc92442c9a46`、指摘正本は[6859122823](https://github.com/yshtysht8sh10-glitch/TaskMemoApp/pull/131#issuecomment-6859122823)。D2は同レビューで**設計仕様限定APPROVE**であり、今回は変更しない。以下は設計上の固定trace/期待結果で、製品実装やtransactionのFAIL→PASSを実施した報告ではない。

|D1-F1の論点|規範修正|反例/受入対応|
|---|---|---|
|T0確認とT1確定の混同|01§2.3と§2.3.1: T0は予約でなく、activationCutRefは実確定T1。新しいBは新確認/新request|A20a-F1/F2、A20a-OK1/OK2|
|時間だけで進む未anchor release|F(T1)を全旧policy/config/lifecycle来歴から再計算。既release事実をanchor mapやT0/F0で代用しない|T0=11/14 14:59Z、T1=15:01ZでF14→15、B15拒否。未anchor/anchor済み双方で同結果|
|検証と区間確定のTOCTOU|現役Auth/policy/config/lifecycleとF/B/時刻条件を同線形化点で検証・確定。古いTread+通常commitだけでは不足|A20b-C1–C4/E6。実temporal transaction/時刻/排他の供給立証はD3未承認|
|旧policy anchorの前/後/並行|元日付の確定区間で判定。正当旧回は保全、旧policyの未確認将来要求はdraft/隔離、rebase禁止|A20b-F1/F2/OK1/OK2。O15=(R,11/15)と旧base=11/15 14:00Zを保持|
|失敗・再送・初回適用|未成立は新T1で再評価、既成立は当時結果を回収。失効Bは自動補正しない。初回も時間経過とD4照合を検査|A20b-E1–E5。request/原B/両cut/F/anchor/区間/拒否・成功証拠を保持|

D1-F1だけを独立再レビュー依頼する。D2本文（01§4.1を含む§3以降）とA11/A13/A28の値・head・History oracleは前commitと同一であることを差分で確認する。D3/D4 BLOCKED・D5未審査、#113/#118と実provider/実データの未承認条件を維持する。

今回のチェックはMarkdownリンク/表/fence、D2不変、文書限定差分、git diff --checkとGit状態のみ。focused/全体テスト/型/Lint/build/実機/固定trace実行は行わず、受入表は全て未実施。修正commit/pushとPR #131・Issue #130への記録後に停止する。#130/#107をCloseしない。
