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
|A11|再移動/同bucket順位変更|同refのschedule/rankだけ変更、一操作一History、他回の順位不変|
|A12|base復帰、再移動後base、古いat再配送|元日時へ明示復帰。因果後続baseを古いatが上書きしない|
|A13|初回前に旧当日override昼→翌日移動→Undo/Redo|Undoで昼へ復帰、Redoで延期。field削除や原anchor消去なし|
|A14|元日復帰が過去日/予定なしbucketへdrop|前者は期限切れ確認、後者は理由/日時選択。不明日時へ勝手に保存しない|
|A15|延期回を予定日/別日に完了/skip|元keyへresult、実日時は別記録。元日/予定日にも二重出現しない|
|A16|完了/skip取消、結果をUndo/Redo|延期先のscheduleへpending表示、別回と定義完了状態は不変|
|A17|二回を同時選択して片方だけ完了/延期|定義IDで選択dedupせず、選択したrefだけ更新|
|A18|completed/skipped回を直接DnD|取消を案内、履歴の予定snapshotを無断変更しない|
|A19|drag開始後の深夜跨ぎ、確認中の日跨ぎ|元ref不変、具体target日時を再確認。「明日」の意味を黙って変えない|
|A20|calendar zone共有、PC表示zoneだけ変更|元ref/予定instantは不変。表示zone差で新しい元回を作らない|
|A21|DSTの欠落/二重時刻、旧回zone不明|不明をclampせず確認/保護。明示offset/根拠確定後だけ予定を保存|
|A22|延期後にrepeatRule/startsOn/基本時刻を変更|固定anchorの既発生回は保持。新周期の将来生成へ延期値を引継がない|
|A23|延期後に定義close（予定はclose後）/再開|保持済み元回は残り、新しい将来回だけ停止。再開でも重複なし|
|A24|moveとclose/rule/所属/削除を並行発行|因果依存の意味検査、不能なら双方保全/保護。移動で削除を解除しない|
|A25|soft-delete/restoreの前後に未完了延期回あり|非表示中も原本を保持し、restoreで同schedule/refを回復|
|A26|二端末が同refを別日へ同時移動/到着順逆転|MV候補両方・同じ候補集合へ収束、時計/Node revision勝者なし|
|A27|異ref/本文とmoveを並行、同ref move+完了を並行|独立属性を合成、結果を未完了へ戻さず予定候補/観測snapshotを保持|
|A28|別端末move後に旧headのUndo、二重resolve|最新変更を消さず確認/競合。全候補参照のresolveのみ有効|
|A29|duplicate op/receipt/publication、ACK先着/後着、applied→conflict|原intent/receipt/reflection/現在競合を別保存、Outbox誤退役なし|
|A30|offline発行→再起動→再接続、別UID/旧epoch応答|未受領copy保持、現役scopeで再検証、旧scope操作を新scopeへ書換えない|
|A31|atomic保存前abort/quota、CAS応答喪失、Journal不一致|seq/メモリ/Outbox先行なし、原本保持/明示復旧。新refへ再採番して隠さない|
|A32|旧Node/旧override null/旧History/旧outcome/retained混在|非破壊readerで同じ意味。初回対象回だけ根拠付きbaseline対応、全履歴不変|
|A33|不正旧date/未来override/unknown fields/anchor矛盾|推測初期化/削除しない。原本付き候補/保護、診断後の明示取込|
|A34|通常export/完全checkpoint、JSON往復/別端末restore|互換性を区別。完全形式では全原操作/候補/証跡/local-only/rank/Historyを照合|
|A35|旧PWAが残る/後発offline旧端末/外部producer|旧writer fenceを検証、未同期原本を退避回収。新fieldが残るだけで安全としない|
|A36|世代切替途中失敗/rollback/再実行|元source保持、全件意味照合、明示fence切替、新予定を失う旧snapshot再公開禁止|
|A37|#113期間型/#118未来表示が未対応の入力|勝手に日付型へ変換しない。既存データ保全、未対応ゲートを明示|
|A38|将来#118承認後、事前表示と延期anchorが重なる|同元refでdedup、前倒し完了は元予定日に再出現しない。現scopeでは未実施|
|A39|大量の過去/延期回（100/500/1,000/5,000）|候補数/走査時間/起動一覧時間/同期完了を別計測、性能劣化で全件を黙って打切らない|
|A40|iPhone PWA touch、PC mouse、深夜・月末のUI操作|移動前後の元日/予定/結果の表示が一致。jsdom/pure PASSを実機PASSとしない|

A20/A21の暦policy、A24の意味依存、A28のUndo/resolve、A34–36の完全schema/運用、A38の#118部分は未決ゲートを含む。具体protocol/入力/oracleを該当独立レビューで確定してから実装試験へ昇格する。今回40行を40実行可能PASSと扱わない。全体/focused/型/Lint/build/実機試験は設計のみのため今回未実施。

## 5. 実装分割案・独立レビューの判定単位

|単位/将来工程|判断依頼|実装への条件|
|---|---|---|
|D1 Domainモデル|元identity/anchor/schedule、戻し/再移動、二回共存、生成/完了対象|本設計の承認と明示実装指示後に合成pure PoCだけ。zone/旧回根拠の未決を先に固定|
|D2 UI/履歴|安定ref、当日/過去DnD、範囲確認、一括対象、結果時snapshot、Undo|D1と各oracle承認、製品store未接続のハーネスから。#107へ無断接続しない|
|D3 同期拡張|新属性/schemaと因果/MV・atomic group/readSet/result合成|#107担当の別設計レビューと必要基盤承認。現N1への属性追加やN2/N3進行を本PRで許可しない|
|D4 互換/移行/復旧|旧field対応、完全checkpoint、旧writer停止、後発端末回収、rollback|明示移行計画/全永続種別照合/両端末静止を別承認。実データは別許可|
|D5 DEV/実機・リリース|A40等の実UI、save/restart/sync、性能/旧client|D1–4の該当承認と接続scope/使い捨てアカウント/停止手順を固定。DEV/Production配信はリリース担当の別承認|

実装を始める前に未決を列挙したまま推測補完しない。特にzoneの確定、現行date方式と#113/#118の境界、同時schedule/resultの因果判定、完全形式/codecのversionをレビューで判断する。初期公開をFirebase標準に限定する案の可否も判断対象。E2EE/Drive/localの新同期実装を抱き合わせない。

## 6. レビュー担当への引き継ぎ

読む順: README → 01§1の現行事実 → §2 identity/anchor → §3集合和生成 → §4操作 → §5 lifecycle/履歴 → §6競合 → 本書互換/#107依存/受入。

重点は「延期で次回をずらさない」「元日付が操作日へ変わらない」「同じ予定日に二件を保つ」「旧scheduleへ巻き戻らない」「延期後のrule変更/closeで消えない」「未対応旧形式を落とさない」「#107の新属性対応/実運用を実装済みと誤認しない」。D1–D5と未決ゲートごとにAPPROVE/REQUEST CHANGES/未審査を区別してほしい。

今回の変更はこの設計ディレクトリのMarkdownだけ。e18c4d1基点で調査結果を参照し、#107/既存API/再現テスト/製品コードは非変更。GitHub #130/#113/#118本文と追跡済みソース、#107の承認設計/提出APIを読んだ。実データ/端末DB/SDK/Rules/配信は操作していない。

文書のリンク/表/fence、製品基点/差分範囲、#107 worktree非変更、diff checkを確認し、commit/push・独立PR・Issue #130への記録後に停止する。レビュー結果前に実装しない。
