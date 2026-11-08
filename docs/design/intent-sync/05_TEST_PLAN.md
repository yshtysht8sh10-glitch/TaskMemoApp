# 05 テスト計画と既存12ゲートの扱い

**計画のみ。新契約の実装/試験成功を主張しない。** PR #122の原ゲート、既知6/4失敗の証拠を変更/削除しない。

## 1. テスト対象の契約を明示する

旧binaryが直接Nodeを書けるmixed運用を恒久保証する要求は廃止できるが、legacyデータ保全の期待は廃止しない。

- 旧reducerを動かす原12ケースは**歴史的反例として全件維持**。当該旧契約の結果1/7と1/5をそのまま保存し、失敗をPASSやskipへ書き換えない。
- 新版リリースの必須ゲートを変える場合は、writer support policyと以下のnegative/legacy-import/new-intent対応表をレビュー承認する。旧ゲートを実行しないだけでgreenにしない。
- 新active世代ではold live writesは拒否され、旧ローカルに原操作が残ることが期待。これを「従来成功すべき旧書込が成功しないからバグ」と扱わない。
- 同じsource fixtureのデータ意味は移行/復旧ゲートへ引き継ぐ。before/baseの根拠があるfixtureは自動変換して期待どおり合成し、根拠がない別fixtureはraw付き未解決として保全する。元の明確な反例を全部「曖昧だから仕方ない」へ落とさない。

## 2. 原12ケースからの追跡表

全行で原ソースと失敗/成功記録を維持する。「変更」は新契約の統合テスト入口を変えること。「廃止」はold live受理保証のみで、source data/テスト証拠の廃止ではない。

|ID/原ケース|新必須の受入・変更点|
|---|---|
|Q1 legacy completion survives new receive|active後の旧write拒否＋旧Outbox保持。既存旧完了のraw/基点を移行し新版completionとして保全。古いqueue completion registerでactiveへ戻さない|
|Q2 new completion survives legacy round trip without a concurrent edit|恒久legacy往復は廃止。旧データread/exportの保持と、新clientの逐次complete→再送/再起動で完了保持へ変更|
|Q3 legacy completion cancellation survives new receive|旧取消を無視しない。証明可能な取消は新set-activeへ写像。active拒否と原操作退避も検証|
|Q4 offline completion and reorder retained, oldFirst=false|同じ既知基点を持つlegacy sourceのimportと新版別属性intentで所属/順序と完了を両立。old liveは拒否|
|Q5 offline completion and reorder retained, oldFirst=true|Q4の到着逆順で同じ候補集合/確定projection。旧完了だけを曖昧扱いに変えない|
|Q6 unknown-field omission cannot erase completion|旧register欠落は既存値の取消命令ではない。旧rawを保持し、証明可能なintentだけ変換。unknown fieldのbaseline/backup round-trip|
|Q7 late legacy completion retains placement after dissolution and re-creation|旧sourceの遅延完了と新membership世代の配置を分離。再所属を巻き戻さず完了/取消の原本を保持。欠落基点なら明示候補|
|S1 sequential legacy edit retains an already-observed unknown emphasis field|恒久old live受理を外し、旧snapshotの★fieldが存在すれば保持するread/import試験と、新clientの逐次更新で★/本文/完了保持へ変更|
|S2 a stale legacy payload cannot erase a persisted emphasis|旧field欠落をOFFに変換しない。新bodyだけのintentはemphasisを触らない。旧raw自体も捨てない|
|S3 emphasis never cancels concurrent completion, oldFirst=true|新completionとnew emphasisで両方保持。旧未同期completeも根拠あるimport後に同条件で確認|
|S4 emphasis never cancels concurrent completion, oldFirst=false|S3の到着逆順・opIdの辞書順反転でも同じ値/候補集合|
|S5 stale legacy content cannot resurrect emphasis after explicit OFF|ON観測後OFFの因果関係と重複配送でOFF保持。古いtrue snapshotは新ON意図にしない。真の並行ON/OFFは別試験で両候補保持|

正確な名前/入力は[原Queue gate](https://github.com/yshtysht8sh10-glitch/TaskMemoApp/blob/f3c8253650657b66ac30edd6861ccd5903391ffa/scripts/check-queue-legacy-compat.mjs)、[★gate](https://github.com/yshtysht8sh10-glitch/TaskMemoApp/blob/50bb60a7c5d7a1a3586c1c8c335db4717d452f01/scripts/check-list-emphasis-legacy-compat.mjs)を参照。新テストはこれらの成功を偽装するpatchではない。

## 3. 新版同士の必須ケース

|試験群|期待/保全不変条件|
|---|---|
|completion × body|両方適用。status/completedAtの組を保持、どちらの到着順でも同一|
|completion × emphasis ON|両方適用。emphasis操作のwrite-setにcompletionがない|
|emphasis OFF × old ON|観測済みONの再送/遅延投影でOFF維持。古いbackup値を新ONとして発明しない|
|completion cancel|観測したcompleteをset-activeで取消。completed常勝を排除。双方のイベント時刻/原本保持|
|placement × body|parentId/sortKeyとbodyを両立。親削除/循環/Queue世代違いは意味競合で保全|
|同field並行|ON/OFF、本文/本文、完了/取消の候補を両方保持。全headを見たresolveだけが候補を退役|
|順不同/重複|全イベント順列、opId大小/clockずれ、未知親先着、gap後着で欠落なし。最大seqで飛ばさない|
|offline/reconnect|二台の独立属性更新、conflict、受領済み未反映、依存待ちを再接続して収束/候補保全|
|restart|採番直前/保存後/送信後/accepted受信前後/反映前後crashで原操作と意味を保持|
|保存失敗|IDB transaction abort/raw CAS不一致/容量不足/別writerでmemoryを進めずOutbox/Journal保持|
|Undo/Redo|属性補償intent、History coalesce/command単位、同属性remote変更時は保護。無関係fieldを戻さない|
|backup/restore|full checkpointの全集合一致、旧schema1〜4読取、別世代import、操作重複と古いtrueの上書き防止|
|Routine|旧category/日週月年、実績cancel/skip、日付key/期限/順位、lifecycle/retained/再開、投影Taskの非永続性|
|旧データreader|Date/ISO/Timestamp JSON、欠落memoType、null/pending、未知field、legacy rank/tombstone、raw保持|
|migration failures|copy各chunk、verify、gate切替前後、二台の準備差、lease失効/競合、source変更、未知Historyで保護停止|
|rollback|active前/後・新操作なし/ありを分け、旧snapshot復元で新intent/競合を失わない|
|old client拒否|旧SDK create/update/deleteと旧receipt書込拒否、permission-deniedでraw Outboxが残る|
|外部writer|旧MCP/Admin/job停止、server gateとIAM、拒否後にデータを書かない|
|scope|匿名/本人・DEV/Prod・origin・generation・actor incarnationの混線なし|
|意味依存|Routine config同時更新とclose、親削除と移動等のreadSet不一致を黙ってmergeしない|

「過去履歴が保持」は行数だけでなく、dateKey/state/changedAt/null、lifecycle期間/retained、通常完了/取消の元イベント/来歴まで比較する。すでにsourceにない履歴をテストで生成して保全できたように見せない。

## 4. 検証レベルとリリース条件

1. pure reducer/adapterのtable・property試験: 可換性（独立属性）、冪等性、順序入替、因果/並行、dependencyの全数/生成fixture。
2. local storage: fake IndexedDBだけでなくSafari実transaction境界、raw CAS、旧raw保存、Nativeが対象になる場合はそのwriter制約も別検証。
3. 使い捨てFirestore Emulator: 実SDK/Rules/新backend transaction、受領/反映分離、旧SDK拒否、重複/逆順workerとcrash、lease/activationのfault injection。
4. 使い捨てDEV: 新iPhone PWAとPC、別tab/origin、offline、失敗/再起動、実行SHA/manifest/原本整合、旧snapshotの退避と後発import。
5. 移行リハーサル: synthetic source全形式と、承認された観測から匿名化した形のfixtureでconservation ledgerを全件検証。Productionを実験台にしない。
6. 全体test/TypeScript/lint/Web export/関連Functions testsは実装PRごと。設計だけの本PRではアプリbuildを再実行して設計の正しさを装わない。

最新版buildの確認とwriter fence、新正本反映の確認は別合否。新通常suiteがgreenでもデータimport/rollbackゲート不合格なら切替禁止。ゲートmanifestはprotocolとデータadapter対応表に束縛し、旧診断12件からの対応をレビュー承認する。

## 5. 性能/容量の回帰計画

100/500/1,000/5,000 Node＋独立した操作/receipt数・競合数・History容量を増やす。server read、Node投影作成、復元/検証、local raw CAS、初回一覧、操作受領、反映済みの時刻を分ける。baselineからの再起動は全receipt全走査を毎回必須にせず、検証済みsnapshot＋厳密な未処理集合/差分取得を使う。snapshotは参照した操作/候補/clockを保持し、最適化でgapやrawを削らない。compact/GCは別承認まで行わない。

## 6. REQUEST CHANGES対応の具体的受入ケース

以下は**追加するテストの仕様**であり、未実装/未実行。正常・異常・競合・再起動・失敗復旧を4項目それぞれで検証する。全ケースでsource raw不変、元identity/原文保全、ready/状態/ledgerの期待をassertし、件数だけでは合格にしない。

### R1: 全resourceの機能移行

|ID/分類|fixture・順序|期待値/停止・再開条件|
|---|---|---|
|R1-01 正常|node/Routine実績、pinned body=A、features=true、端末別4種設定、候補、3型Historyを移行→読戻し|全resourceが対応UIで利用可。ID/日別取消/retained/本文/flag/History方向/未知field一致。iPhone dark・PC lightは別々保持|
|R1-02 競合|Cloud body=A、iPhone localBody=B/dirty、PC localBody=C/dirty、双方Outbox/receiptを用意|基点が共通ならB/C候補両方。receivedとappliedを区別。dirtyをclearしただけではready不可。本人解決後の新head/Historyまで照合|
|R1-03 競合|ideasEnabledの共通falseから片方true、もう片方明示false、後者にHistory/未送信op|並行true/falseを候補保持。偽値/欠落を同一にせず、同期設定の別localコピーを作らない|
|R1-04 異常|body/候補/旧whole-state Historyはraw archiveにあるが新resource/回復UIから参照不能|conservationだけでは合格不可。機能照合失敗でseal/ready停止。対応reader/写像修正後に再照合|
|R1-05 再起動|profile History/dirty/候補をstaging後crash→再開→Undo/Redo確認|同resource/command/方向/原文を保持し二重intentなし。変換不能Historyは閲覧可だが実行不可を明示、通常成功は止める|
|R1-06 失敗復旧|settings復元途中容量不足→再起動→checkpoint再読込|元設定/原文不変。部分設定を移行成功としない。再試行で元端末scopeの全設定を検証してからready|
|R1-07 異常|未知永続key、無効theme、未知features型、ownership途中、日時精度超過を各fixtureへ注入|defaultに落として成功不可。未分類/意味不明を表示し停止。修正承認/reader追加後に新attemptで照合|
|R1-08 正常/復旧|全列挙種別とschema1〜4/復旧backupを同時に含むcheckpointを独立環境へ復元|01節8全行にsource→target/状態/照合結果あり。重複backupで二重createせず、OS許可を設定flagと混同しない|

### R2: 操作因果とpublication配送を分ける

|ID/分類|fixture・順序|期待値/停止・再開条件|
|---|---|---|
|R2-01 正常/逆順|C1=★ON、C2=ON観測後OFFを適用→C1の一致した結果＋投影をまとめて再配送|OFF/heads/conflicts/awaiting/appliedPublication=C2が不変。旧証拠保存だけ可。C1へCASしない|
|R2-02 正常/逆順|C2結果だけ先着、C1投影、C2投影、最後にC1結果|C2全member検証まで現在状態維持、C2を一括適用。後続C1一致ペアもno-op。部分結果でledger退役不可|
|R2-03 再起動|C2保存後crash→C1イベント/worker復帰|watermarkとstate/ledgerが同CASで復元されOFF保持。C2保存CASがabortした別fixtureではC2を再取得して検証|
|R2-04 競合|complete→取消を観測発行→complete原op再送、別opIdの真の並行completeも配送|重複/祖先はactiveを戻さず再適用なし。並行completeは新publicationで候補保全、activeへ黙って確定しない|
|R2-05 遅延正当操作|offline端末の小さいlocalSeqの未受領body操作、同時completion、依存親を後着|body/完了を合成。親未着はdurable pending、親到着後に処理。最大seq/時刻で破棄しない|
|R2-06 異常/世代|G2切替後にG1応答、同seq異hash、祖先不明新seq、別scope callback|旧世代/別scopeを隔離、分岐は保護停止、参照不足は保留。現在state/ledgerを置換しない|
|R2-07 失敗復旧|古い完全checkpoint C1を復元、端末/serverはC2、offline起動→online|offline read-only/未検証表示。C1のOutbox=0でC2 pendingを消さず、C2照合後に未反映原opだけ再開|
|R2-08 重複/破損|同opId同payloadを再配送、同opId異payload、multi-resource manifestの一chunk欠落|同payloadは同receipt/no二重適用。異payloadは衝突保全。欠chunk中はcommand全体保留、補完後のみ一括CAS|

### R3: fence・seal・activate/rollback競合

|ID/分類|fixture・順序|期待値/停止・再開条件|
|---|---|---|
|R3-01 正常|PREPAREで入力/受付停止→全writer drain→source列挙→chunk→seal→二台fresh ready→activate|固定source/target rootsの同一性、phase/epoch/seal一致、pointerと新能力が同transactionで有効化|
|R3-02 競合/Admin|Adminが旧controlを読んで停止→freeze commit→Admin write再開|同transaction対応writerはretryで拒否。不対応Adminは権限停止/終端未証明ならFROZEN不可。二回read一致を合格理由にしない|
|R3-03 競合/chunk|最終chunkとsealを競合、VERIFIED後に同epoch chunk、さらに旧epoch leaderを再開|先行chunkでcatalogが変わればseal再検証。seal先行なら同epochも拒否。旧leaderは常に拒否。sealed root不変|
|R3-04 異常/列挙|page取得途中失敗、receipt page欠落、scope追加、sourceに未知field追加|全catalog終端証明なしでseal不可。source変更はbarrier破れとしてready失効、新attempt。単なるcount一致は不可|
|R3-05 再起動|seal直前/直後/activation直後それぞれcrash、lease失効→別端末leader取得|FROZEN維持。新epochでchunk検証再利用、sealを変更しない。ready再取得。既activeを二重activeにしない|
|R3-06 競合/切替|activateと通常受付を同時開始、二台別migration開始、activateとrollback競合|controlで直列化。境界前新受付拒否、後は正しい能力のみ受理。一migration/遷移だけ成功、他は保護停止|
|R3-07 競合/rollback|R2候補の確認直前/直後に新intent受付、accepted未反映/reducer中/端末draftを各々注入|ROLLBACK_FROZEN前受領は固定集合へ含みR3扱い。後受領は拒否しlocal保持。なし判定後に新操作が紛れ込まない|
|R3-08 失敗復旧|COPYING容量不足/通信切断、ready後source変更、rollback transaction成功後応答消失|ready取消/epoch更新、原本不変で再照合。transition ID照会で二重rollback/旧writer再許可なし|

### R4: 入力・保存・通信のcapture

|ID/分類|fixture・順序|期待値/停止・再開条件|
|---|---|---|
|R4-01 正常|iPhone/PCでtitle/body/常設メモ/設定を編集中→原文退避→本人local確定→静止→backup|原文と保存revisionの対応、全timer/queue/callbackの停止またはdurable隔離、draftを含む読戻し確認後だけready|
|R4-02 異常/入力|inline title未確定＋IME中、600ms debounce、QuickTitle100ms blur、Quick Add未作成|composition終了/原文回収前に更新・離脱・cancel禁止。勝手なtrim/新規createをしない。取得不能ならready不可|
|R4-03 競合/保存|保存revision D1進行中にD2追加入力→D1成功callback→capture|D2は残りD1成功でclear不可。ready取消、D2をlocal確定/回復draftへ写像して再capture|
|R4-04 競合/callback|snapshot直後にdebounce/ACK/受信callback、ready後に新入力|旧epoch保存は拒否/原command保持。callbackは隔離inbox、capture hash変更でready失効。再ドレイン/再backup必須|
|R4-05 異常/context|PC別windowの旧tab、iPhone PWA/Safari別storage contextを一つ未確認のまま準備|inspector/協調lockだけでは旧tab停止済みとしない。全context回収/終了後raw照合までready不可|
|R4-06 再起動|draft bundle永続後crash、未送信Outbox/送信中結果不明を保持して再開|ready失効read-only。原文を回復UIで再編集可、原opIdを維持しreceipt照合。空draft/空Outboxを保存しない|
|R4-07 失敗復旧|原文export/backup読戻し/保存に容量不足、旧tab終了時unmount保存失敗|旧画面/退避原文を維持し停止。終了確認だけで成功不可。終了後raw再取得/再検証に成功してからready|
|R4-08 競合/Text|text≠validatedText、未確認削除plan、保存中にtext変更、通知/設定callback|text原文/session/base/確認状態を回収し自動plan実行不可。変更でready失効、設定/通知副作用も静止条件に含む|

上記32ケースはpure/local/Emulatorで決定的race injectionを行い、draft/タブ/IME/Safari境界は使い捨てDEVの実機でも検証する。全ケースを実装PRの受入manifestへ対応付けるまで切替不可。性能測定は同じ保護を有効にした状態で行う。既存12反例を置き換えたり、今回の文書修正でPASSになったと主張したりしない。
