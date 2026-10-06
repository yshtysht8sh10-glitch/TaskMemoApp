# Text Format開発者責務・Phase 1–6

## Phase 1：syntax / IR

`syntax.ts`の定数と型が一次情報。`generate-text-format-docs.ts --check`で文書同期を検証する。
IRの各cellはdecoded valueと1-based start/end columnを持つ。errorはline/cell/code/message。
行の追加・削除・順序とセル単位変更の情報をPhase 5から利用できる。

## Phase 2：pure層

- parser：delimiter、JSON string、escape、列数、ref syntax、tree階層。listではspaceを無視。
- validator：許可値、ref uniqueness、期限、完了、Routine、種別ごとの禁止列。
- deadlines：明示的なsession日時/IANA timezoneから解決。host timezoneを使わない。
- serializer：sessionのbaseline raw valueを表示。Node ID・revisionは出力しない。

期限列の文字列がbaselineの表示と同一なら元のdueAt/duePresetをそのまま使う。
例：古い`today`は絶対日時として表示するが、無編集でcustomへ変わらない。
秒・ミリ秒を必要時に表示する。DST重複時刻は明示offsetのISO表示にする。

## Phase 3：session / planner

- session：scope、入口view、固定日時/timezone、全Domainのbaseline revision/value、
  対象ref、入口のorderedIds/listGroups、新規親を保持。deleted/purgedはbaselineだけに存在する。
- treeOrder：全有効Nodeの階層を検証。孤立/cycleは停止。
- planner：純粋・決定的。構文/意味/競合のerrorがあればchangesは空。
  元のraw Node valueへ限定patch。ID/createdAt/未知field/非編集metadataを保持する。
- 新規IDはsession IDと行indexから決定。削除/purgeを含む全IDと衝突検証する。
- 欠落refと新規行の併存は保守的に拒否。曖昧な改名対応を推測しない。
- 削除は対象scopeの欠落refだけ。親削除で残る子を巻き込まない（階層error）。
- 削除Category subtreeだけを同じdeletionBatchIdでまとめる。独立Memo削除はnullとし、
  ゴミ箱で1件を復元したとき無関係な削除まで復元されないようにする。
- tree rank / list deadline rankは別。順序が不変ならrank生成・normalizationしない。
- baseline全体が変わったら競合停止。入力はplan.documentに保持される。

Routine completionはsessionの日付に対する実績（通常statusではない）。
取消はroutineHistoryのnull tombstone。overrideと他日実績は維持。
拡張ruleを持つNodeのrule変更、実績/期限等を持つTask↔Idea変換は拒否。
`deadlineSortKey`を種別変換で削除しない。

## 代表的テストと誤前提の修正記録

`textFormat.test.ts`：Issue例、同名、改名、新規、移動、順序、削除、ref消失、
期限/DST、Routine、未知field、tombstone、無編集round-trip、production-derived fixture。

最初のテストで `Task |` をsyntax errorとしていたが、ref省略では空タイトルの
正しい列構造なのでsemantic title errorに修正。root移動テストは移動行の直後に
indentされた兄弟を残す誤入力だったため、移動行を最後へ置いて正しい構造に修正。
実装のvalidationを弱めていない。

## Production-derived fixture

`docs/fixtures/text-format-production.json`は2026-10-01の本番recovery snapshot由来。
176 records / 143 active。source SHA、取得日時、匿名化内容はfixtureのprovenanceに記録。
ID/title/bodyの文字/device/operation/batch識別は匿名化。日付、field有無、rank、
revision、Routine実績/override構造は維持。合成fixtureと混同しない。

## Phase 4：Application

`TaskMemoV2ApplicationStore.beginTextEdit/prepareTextEdit/commitTextEdit/discardTextEdit`。
storeがbaselineのprivate copyを保持し、返却plan/sessionを書き換えてもcommitできない。
commitは既存mutation queue内でsession/baseline/plan/fingerprintを再検証する。
1保存の変更Nodeを既存applyCommandへ渡し、operation typeをNodeごとに指定。
確認済みraw patchだけを使用し、未編集Nodeをcodecで再構築・sortKey normalizeしない。
rankを操作するgroupに無効/重複rankがあれば勝手に修復せず停止する。

`TaskMemoV2SyncController.saveTextEdit`はdurable local commit後に既存flushを起動。
ネットワーク失敗はOutbox pendingとして扱い、成功したローカル保存を失敗扱いにしない。
UI/hooksの入口はPhase 5で接続済み。profile（常設メモ等）は対象外。

### destructive guard

`assertSafeTextTransition`は実際の有効Node減少ID集合と確認済み削除集合を完全比較。
物理除去/purge/復元を拒否し、確認済みsoft delete以外には既存guardを適用する。
guardの既存softDelete例外へ保存全体を渡す経路やallow flagは作らない。
すべての削除と、50件以上または20件以上のscopeの30%以上の変更で確認が必要。
confirmationはfingerprintと完全なdeletedIdsを持つ。変更planとの差異はcommit前に停止。
fingerprintはcanonical JSONそのもの（hash衝突なし）。本文を含むためログへ出さない。

### atomic保存失敗・永続化

ApplicationJournalPersistenceのoptional `writeAtomic(expectedCommitted, value)`を使用。
非対応adapterではtext保存を拒否し、WAL fallbackしない。
IndexedDB：既存scope recordを1 readwrite transactionでCASし、committedだけ置換。
別tabのcommitted変更や残留journalがあればabort。migration/recovery fieldは維持。
Native AsyncStorage：単一writerの1 committed keyを全envelopeで置換。準備journalは書かない。
nativeのcheck+setは複数processのCASを保証しない。Webにはこのadapterを使わない。
保存失敗で再起動時に未承認journalを適用する経路を作らない。
通常の既存command/Undo/RedoのWAL方式は変更しない。

### History / Outbox

既存のmulti-target Historyを再利用。1保存=1 entry（上限75）。
Undo/Redoは対象opId/revisionが全件一致する場合のみ適用。remote競合やpurgeで全体停止。
新規NodeのUndoは同じIDのsoft delete。OutboxはNode単位、revision系列を継続。
cloud全体の原子性や他端末ロックは保証しない。

### 追加回帰

`textEditApplication.test.ts`：混在command、1履歴、Undo/Redo、作成Undo、Routine実績、
exact確認、remote競合、plan改変、保存失敗+再起動、raw metadata、Outbox ack、fixture。
`indexedDbApplicationStorage.test.ts`：transaction abort+再起動、同一baselineの競合CAS。
`applicationStorage.test.ts`：native失敗時の旧committed保持、journalなし、stale保存拒否。
`taskMemoV2SyncController.test.ts`：既存同期経路、offline pending、durable local成功。

Routine移動の回帰で、移動元のrankを移動先の未来anchorに使うと、静止Categoryまで
rekeyされることを検出。移動先に元から属するrankだけをanchorに使うよう修正した。
最終reviewでは、一覧の新規親指定を既存root Memoのnull parentにも適用してしまう
ケースを回帰テストで先に再現（FAIL）。新規/既存を明示分岐し、既存parentIdを完全保持した。

## Phase 5前の接続契約・制限

- 一覧入口は実際のorderedIds/listGroupsを渡す。missed-occurrence virtual IDは渡さない。
- ツリーはdefaultでcanonical Domain順。入口のorderedIdsを明示すると、その順序を保持し、
  全有効Nodeの包含と親子関係を検証する。無所属Memoをrootで先に表示する順序も無編集0件。
  折り畳みや無所属virtual行をDomain Nodeとして追加しない。Phase 5で表示順adapterを接続する。
- 保存成功後は新しいsessionを開く。破棄/アカウント変更ではdiscardする。
- 以前のPhase 1–4 sessionは互換性のため完了列空の保守的契約を保持する。
  Phase 5 UIのsystemRegions sessionではIssue追加仕様に従い領域とruleの両方を検証する。
- groupをまたぐ行位置は期限の変更ではない。実際の再group化は期限から行う。
- nativeの単一key原子性とIntl timezoneの実機サポートはPhase 7で確認する。

## Phase 1–4の検証結果（2026-10-02）

- 全体：98 test files PASS、705 tests PASS。既存の環境依存3 files / 25 testsは未実行。
- TypeScript / lint / diff-check / 生成した許可値文書の同期チェック：PASS。
- `npm run web:export:production-v2`：PASS（ローカルartifactのみ、deployなし）。
- 本番由来176 recordsのtree/list serialize→parse→plan：どちらもchanges=0。
  Application保存まで含めてDomain raw value / History / Outbox / committed storageが不変。
- metadata保護、削除、ref消失、remote競合、transaction abort、Undo/Redo、Outbox ack、
  再起動復元の回帰を実施。UI、実Firebase、実機の検証はこのPhaseに含めない。

## Phase 5–6：画面・投影の責務

- `TextWorkspace.tsx`: commit前の文字buffer、180ms validation、セル強調、候補、厳密保存、
  破棄/保存確認、読取専用Viewとコピー。直接Domain/storage/Firebaseを変更しない。
- `presentation.ts`: React非依存。実際のViewから受けたordered groups/rowsを編集projectionと
  human-readable snapshotへ変換。checkbox表示、cell変更、閉じる選択肢、候補定義をpureに提供。
- `NodeTree` / `DeadlineView`: 現在のrows/groupsをcallbackへ渡す。parentIdを期限groupから生成しない。
- `useTaskMemoSync`: begin/prepare/commit/discardをV2 controllerへ渡し、durable local保存後にpublish。
  未ログインも通常編集と同じ共通Local V2 storeを使う。初期化未完了/復旧中は拒否し、auth状態を利用条件にしない。
  Local/Account切替と匿名Outboxの扱いは[共通V2実装仕様](LOCAL_V2_IMPLEMENTATION.md)。
  アカウント変更で旧sessionは新storeで検証に失敗する。
- UIのtree sessionは`systemRegions=true`。Routine root実Nodeをrefから除外し、baselineに保持。
  予約語はIR.regions、行はregionとparentRowを持つ。plannerだけが既存root IDへ解決する。
  parserは以前のheaderなし文書もpure API互換性のため受理するが、UI sessionでheader欠落は拒否。
- Routine領域は既存root直下のTaskのみ。解除は領域移動+rule削除、実績/override保持。
  aliasはshared syntax定義から候補と生成文書にも使う。既存anchorを無意味に更新しない。
- rootに存在する非表示のRoutine backing Nodeのrankも、新規rank生成時の境界に含める。
  system Nodeのrank/revisionを画面編集で変更しない。

Routine仮想Occurrenceの調査・除外理由、互換性例外、UI操作は[画面ガイド](TEXT_WORKSPACE.md)。
production fixtureに領域外休眠repeatRuleが1件あり、最初のreserved-regionテストでvalidation FAILを確認。
無編集/無関係編集だけは既存値を保持し、rule変更/親変更は検証するよう修正した。fixture期待値は弱めていない。

`textWorkspace.test.ts`にシステム領域、Routine化/解除、拒否、空Domain、fixture、
当日/overdue Routine投影除外、読取View、変更セル、新規/削除、エラーからの脱出、候補を追加。
`textEditApplication.test.ts`に予約語UI sessionの1履歴/Undo/Redo/Outbox/再起動、
system Node不変、本番fixtureの予約語付き無編集saveを追加。

追加reviewでは、Routine aliasのobject prototype名を許可値として扱うケースと、
Routine backing root不在時にparentId=nullのTaskをRoutine領域へ分類するケースを
それぞれ小さい回帰テストで先にFAILさせた。許可値はown propertyだけを参照し、
領域分類には実際のroot IDの存在も要求するよう修正。
新規rankの検証は数値matcherではなく文字列の辞書順比較を使用する（fractional-indexingのrankは文字列）。

## Phase 5–6の検証結果（2026-10-02）

- 全体: 99 test files / 730 tests PASS。既存の環境依存3 files / 25 testsは未実行。
- TypeScript / lint / diff-check / 許可値文書の同期チェック: PASS。
- 最終コードのproduction Web export: PASS。ローカルdistのみ、deployなし。一時検証routeは含まれない。
- 本番由来176 records / 143 active: 予約語付きtreeと現在の一覧projectionの無編集planは
  changes=0 / deletedIds=0。予約語付きApplication保存もHistory/Outbox/永続化envelope不変。
- ローカルの模擬Domainと実際のTextWorkspace UIでLight/Dark、システム領域、入力途中の期限エラー、
  エラーありの破棄、有効変更の保存して閉じる（History=1）、6項目checkbox、項目名、コピー内容を確認。
  検証用の一時route/server/tabは削除/停止。実Firebaseへの書込は行っていない。
- Phase 7（実機キーボード/IME、複数端末・実同期、大規模編集の総合受入）は未実施。
  保留事項: native AsyncStorageの単一writer前提、draft非永続化、別領域でのsyntax強調の操作性。
  Issue #59はOPENのまま。

## Spec IDと自動テスト
仕様・直接対応テスト・自動化levelは[traceability matrix](TEXT_WORKSPACE_TRACEABILITY.md)。台帳から文書を生成し、full suiteで対応欠落/重複/staleを検出する。実機のみの項目は理由と最小手順を別記し、自動成功と混同しない。通常UI由来の有効Domainを両入口で無編集round-tripするcross-feature invariantも必須。
