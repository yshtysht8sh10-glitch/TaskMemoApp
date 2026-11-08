# 02 新同期契約: 操作・属性版・競合・受領/反映

**設計案。型/関数/collectionの製品実装はない。** 以下をSyncNext/intent-v1と呼び、数値protocolやstorage schemaの割当はレビュー後に固定する。既存Envelope.version=2やbackup.schemaVersion=4と混同しない。

## 1. 正本と所有者

正本は検証済みmigration baseline、immutable intent、属性ごとの因果状態/競合候補、immutable処理結果。Node一覧は正本から作るprojectionで、revision最大のwhole Nodeを正本にしない。新版はそのprojectionと対応manifestを読む。

clientはraw保存済みintentを認証付き受付へ送る。共通backend reducerだけがCloudの新属性状態/projectionを書ける。新clientが各々の旧reducerで直接nodesV2へtransactionする経路を切り離す。二端末だけでも一端末常時稼働やローカル時刻順に依存しない。

物理pathの例（未作成）: `users/{uid}/syncGenerations/{g}/baselines|intents|acceptedReceipts|fieldStates|projections|operationStatus|applicationResults|migrationSources`。★だけの別同期ではなく全属性の一つの契約を複数documentで保存する。Node IDは維持し、原本namespaceは別に残す。

## 2. 操作モデル

概念形（文書用、コードではない）:

```text
Intent {
  protocol, schema, accountScope, generation, nodeId,
  opId, actorId, actorIncarnation, localSeq, commandId,
  intentKind, writes: { attributePath -> explicitValue },
  observed: { attributePath -> { frontierHeads, baselineRef } },
  readSet, dependencies, origin, createdAt,
  undoOf?, redoOf?, resolves?, legacySourceRef?
}
```

- opIdは一意な不変identity。canonicalな不変intentのdigestを受領時に保存。同一opId/同一intentは同一結果を返し、異payloadは衝突として拒否し双方の証拠を保護する。
- actorは端末instanceとincarnationに束縛。localSeqはatomicに採番するが、最大seqだけで既処理を判定しない。restoreで元actorを二台が新規採番に再使用しない。退避済み旧opIdを勝手に再採番もしない。
- writesには変更した属性だけを入れる。値false/null、明示unset、未変更/欠落は別。old Node全体のstatus等を無関係な★/本文命令に含めない。
- createdAtは表示/監査用で、時計ずれによる勝敗順には使わない。Node revisionはprojection整合性の版であり、属性因果版の代わりにしない。
- readSetは、計算結果が依存したが書かなかった属性の版。依存が変われば自動合成せず、再計算/意味競合へ送る。
- 順不同で親intentが未着ならdurableなdependency-pendingへ。親到着前に適用/同期完了としない。期限切れで破棄せず、欠落依存の診断/救済を行う。
- 複数属性を一操作で更新する場合は一つのcommand/write-setとして全件成功/保留。部分適用で元の意味を変えない。必要なmulti-Node操作も同一のacceptance groupと原子適用計画を持つ。

## 3. 属性の粒度・原子group

|属性group|命令/値|不変条件|
|---|---|---|
|Task completion|set-completed / set-active、statusとcompletedAtの組|完了/取消とも明示。常にcompleted優先、bool ORは禁止。完了イベントと取消も履歴に残す|
|list emphasis|set-emphasis true/false|OFFを欠落で表現しない。Nodeの他属性をwriteしない。初期UIは別PR|
|title / body|set-title / set-body|独立register。ただし同じ本文への並行編集は両候補を保持。勝手な文字列自動mergeを初期採用しない|
|placement|parentId+sortKey（必要ならmembership世代）|親とrankを一組で更新。completionは書かない。親削除/循環/Queue解散の依存を検証|
|deadline|dueAt+duePreset、通常一覧順位は別group|duePresetだけ/日時だけの不整合を作らない|
|entity life|create / soft-delete / restore|old editだけで削除を解除しない。restoreは既知deleteを参照。新purgeは本設計初期実装で有効化せず別承認|
|Routine definition config|repeatRuleと生成の定義前提|旧category/startsOn/timezone・期限の意味を保持。配置と生成contextの関連をreadSetで確認|
|Routine lifecycle|complete-definition / resume-definition|periods・retained・完了/再開時刻を一組。日別実績を書き換えない。別端末config更新との依存不一致は保留|
|Routine occurrence result|nodeId+occurrenceKeyごとにcompleted/skipped/pending・changedAt|日付別register、取消pending/null tombstoneを保持。別日更新は合成|
|Routine date override/rank|nodeId+dateごとの明示値/null|keyごと。whole map置換で他日を消さない|
|Queue group|membership/positionの組、completionは独立|解散/再所属世代を区別。遅延完了は所属を戻さない|
|unknown extension|opaque baseline＋version付きpath|unknownは保存/backupで保持し、解釈不能な編集は止める。理解できないことを削除要求にしない|

同じuser actionが依存する複数groupの意味検証を省略しない。例: Routine closeでretainedを計算するときはconfig/lifecycleの観測版が必要。body編集とcompletionは独立なので合成できるが、周期変更と古いconfigに基づくcloseは無条件には可換でない。

## 4. 因果版と競合ルール

各属性はbaseline由来のheadとintent由来のheadを持つ。headはイベントidentity、観測frontierは参照したheadの集合。実装はdotted version vectorまたは同等の依存DAGを用い、文字列revision比較だけで因果を推定しない。

属性fへの新intentは、そのobserved frontierの祖先にある候補だけを上書き対象にできる。未観測のheadは並行候補として残す。サーバーは参照headの実在/generation/対象属性と依存関係を検証し、clientが適当な最大版を名乗って競合を消せないようにする。依存未着は保留。

|関係|処理|
|---|---|
|別の独立属性|両方適用。completion+body、completion+emphasis、placement+bodyなど|
|同属性・観測済みの因果後続|新headへ進む。観測したONの後のOFF、完了後の取消を尊重|
|同一opの再送|idempotent受領/結果照会。再適用しない|
|同属性・真の並行|候補を両方保存してconflict。UIは確認待ちと表示し完全同期を名乗らない|
|不明な基点/前提違反|dependency-pendingまたはsemantic-conflict。Node全体で上書きしない|

並行候補の表示順/暫定代表はstableなactor/incarnation/seq/opIdのtupleで決定的にするが、意味上の解決ではない。全端末は同じ候補集合から同じ表示となる。既に表示していた値を暗黙に確定値として変えず、候補と不確定状態を示す。候補が同じ値でもoperation identity/来歴を保存する。

ユーザーの解決操作は、対象属性の**全候補head**を参照したresolve intent。確認後に候補集合が変われば再確認し、未観測headを消さない。解決後も負けたintent/完了時刻の監査情報は残す。

例:

- C=complete(completion head C0)、B=body(body head B0) → 到着順どちらでもcompleted＋新body。
- ON=emphasis true(E0)、OFF=falseをON観測後に発行 → ONの再送/遅延投影でもOFFを維持。
- ONとOFFが真に並行 → 「古いON」と決めつけず候補両方。clockやopIdで業務上の勝敗を勝手に決めない。
- 完了取消はcompleteのheadを基点にset-active。無関係な★/並べ替えではcompletion版を進めない。

### 到着順と意味依存の収束条件

readSetの検査を「受信時の現在値との一致」だけで済ませると到着順で結果が変わる。reducerはbaselineと検証済み依存closureに対して因果関係を判定する。同じ入力イベント集合から同じhead集合・意味競合集合を生成することを必須とする。移動と親削除、Routine configとcloseのような並行する非可換命令は、先着した側を確定勝者にせず関連command全体を意味競合として保全する。多属性commandは候補としても一体で扱い、片方の属性だけ確定させない。

後着イベントで競合が判明し得るため、appliedは「指定した処理checkpointで反映を確認した」の意味であり、将来の並行操作が存在しない保証ではない。後続のimmutable applicationResultは先行結果を参照し、競合化/解決とcheckpointを記録する。clientは結果とprojectionのcheckpointが揃うまで確定表示を進めない。実装時に依存closureの取得上限/保留、multi-Node原子性、削除との競合表示を固定し、順列テストを満たすまでこの契約を有効化しない。

## 5. 受領・反映・Outbox

```text
local draft
  -> atomic committed intent + Outbox + History
  -> sent/retry
  -> accepted (server immutable receipt)
  -> dependency-pending | applied | conflict
  -> resolved (new explicit intent)
```

acceptedは配達の事実、appliedは検証した属性正本/投影への反映。既存のsuperseded ACKを「意図実現済み」の意味で再利用しない。

- 初回受付はUID/schema/世代/operation identityを検証し、immutable intentとaccepted receiptを同一server transactionで耐久化。受理前のvalidation拒否はOutbox failedとして原操作を保持。
- accepted receiptは後からstatusを上書きしない。処理結果はversion付きのimmutable applicationResultsへ追加し、operationStatusはその派生index。旧syncOperationsV2のreceiptも変更/初期化しない。
- reducerはfield state、競合集合、projection、処理済みidentity/結果を同一transactionで更新。再送/triggerの重複・順不同・途中crashで二重適用しない。未処理集合を最大watermarkだけで飛ばさない。
- ローカルではaccepted原操作をdurable awaiting-application ledgerへ移すことと、transport Outboxから外すことを同じraw CASで行う。CAS失敗ならOutboxを外さない。原操作が保護領域から消える瞬間を作らない。
- applied結果とそのprojection版を検証してローカルfield stateへ反映。conflict/dependency-pendingは原操作と候補を残し、未反映件数に数える。新UIの「同期完了」はこの件数0かつserver確認済みのときだけ。
- Node listenerだけからaccepted/appliedを推定しない。同一Node値であっても自分のintent受領/反映を確認する。

Firestore triggerは順序保証がなく重複配信があるため、trigger自体のexactly-onceに依存しない。[公式仕様](https://firebase.google.com/docs/functions/firestore-events#limitations)。同一transactionで処理できる通常intentは即時適用可能だが、それでも受領/反映の意味を分ける。

## 6. 既存保存保護・再起動・Undo

ローカル新Envelopeにはbaseline、field state、projection、Outbox、awaiting結果、conflicts、operation log/History、legacySource対応とcheckpointを一つのatomic候補として持つ。大容量原本は不変source archiveへ置き、参照＋hashを同じ確定候補で束縛する。archiveの永続/再読込検証前にpointerを進めない。

- #116の期待raw一致、Journal-nullまたは検証済み復旧、scope/writer検査を維持。semantic hash一致をraw CASに置換しない。
- 非同期JSON/crypto/ネットワーク/worker処理は短いIDB transactionの外。最後のCAS前にscope/actor/generationが現役か確認。
- memory state/seq/Outbox退役はCAS成功後だけ進める。transaction abort、容量不足、再起動後も旧Committed/Journalとretry可能intentを保持。
- Journalが不一致/不明ならfail-closed。空Domainや同期完了にしない。新契約移行がJournal解消の抜け道になってはいけない。
- Undo/Redoは対象属性の補償intentと新しい観測基点を持つ。古いNode全体を戻して他属性を消さない。対象属性に別端末の変更があれば確認/競合へ。移行前Historyは変換可能なものだけ実行可能、残りは原本付き保留履歴。
- 起動は検証済みローカルprojectionを先に閲覧表示できる。Cloud待ち/依存待ち/競合を表示し、バックグラウンド受信はbatchで一回の保存/通知へ集約。新設計のために起動性能改善を元へ戻さない。

## 7. 旧形式との境界

新clientは旧raw/Node/backupを読める入口を持つが、旧型snapshotを新intentと偽って自動送信しない。baseline stateとorigin factsとして取り込む。未同期/旧receipt由来の操作は、根拠あるbefore/base/明示type/History対応を検証したものだけintentへ写像する。数値baseRevisionだけではbranch上の一意な基点にならない。

旧appliedも既にbaselineへ含まれるか不明な場合がある。superseded completeも後に取消済みかもしれない。**全receiptを一律に再生して完了を復活させない**。分類はalready-represented / provable-unapplied / unresolved。全原操作/ACK/候補基点は保存し、unknownを削除/黙認でなく確認待ちとして表に出す。legacy provenanceと新op identityの対応はimmutable mappingにする。

恒久的なold live bridgeは要件から外れたが、移行時の旧操作取込みと後発local退避は必須。旧writer停止の前後でどちらのpathが許されるかはrunbookで固定する。
