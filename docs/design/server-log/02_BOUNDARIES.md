# 02 — E2EE・4モード・既存API・承認境界

## 1. 4モードの規範分離

要件正本は[Issue #119冒頭の2026-11-06更新](https://github.com/yshtysht8sh10-glitch/TaskMemoApp/issues/119)。本書群は全利用者E2EE強制移行を提案しない。modeを認証Realm/namespace/protocol/controlへ束縛し、UI表示だけで分離しない。

|モード|正本・経路|本設計との境界|
|---|---|---|
|ローカルのみ|端末atomic保存/backup|server accepted/ServerAnchorBは存在しない。server同期完了と表示しない。Firebaseへの本文送信を追加しない|
|Google Drive|利用者Drive内のデータ。clientが直接API使用する別設計|開発者Firestore/サーバーへ本文・Drive tokenを中継しない。Driveの変更検知/競合/移行fenceは本書で実装可能と扱わない|
|Firebase標準|01のserver intent/accepted log正本、client検証replica|認可MCPも同じintent受付/fenceを通る。既存MCPを全mode向けに停止しない。標準の平文をE2EE namespaceへ書かない|
|Firebase E2EE|serverは暗号wire logを耐久保存、clientが鍵を保有|現行平文server MCPを当該modeでfail-closed。鍵/平文をserverへ渡して標準reducerを動かす迂回禁止。E判定単位は別承認|

mode変更は移行元を残す別領域/別generationへの全件変換・検証・明示active切替。12方向の共通移行と保存先固有のfenceは#119/PR #123の別承認対象。mode名を書換えるだけの切替、同じopの暗黙再binding、自動旧データ削除はしない。

## 2. E2EE境界（E単位の提案規範・未完成部分を含む）

### E1 公開headerと暗号payload

次は検討する**最小公開header案**。E承認前に漏えい同意・実際のfield inventoryを確定する。標準modeのplain Intentをこの型へ無検査castしない。

|情報|配置案/検証者|漏えい・制限|
|---|---|---|
|project/UID、mode、generation、epoch、protocol/schema、activation/baseline参照|公開header。server認証/realm検証|利用者・mode・世代活動が見える。client自由指定の認可には使わない|
|opId、actor/incarnation/localSeq、command/group ID、retry identity|公開header。server dedup/衝突保護|端末数・操作頻度・同一操作/複数entityの関連が見える。単なる匿名化ではない|
|opaque resource ID/type、attribute group ID、observed heads/readSet/dependencies/resolves/undo参照|公開header案。server構造DAG/identityのみ検証|グラフ・関係・編集/完了groupの発生・Undo頻度を推測できる。groupから完了日時やON/OFF値が直接漏れない構成を要求。漏えい許容未決ならE停止|
|cipher suite/version、keyVersion、nonce、ciphertext/tag、wire digest、暗号文長|公開wire。認証と凍結identity|鍵世代/長さ/更新を観測可能。padding未導入の長さ秘匿を保証しない。wire digestは平文hashでない|
|title/body、常設メモ、settings/featuresの機密値、Routine config/lifecycle/日別結果、completion+completedAt、emphasis値、配置/親/日時等の値、unknown機密field|認証付き暗号payload。鍵保有clientが検証|Nodeだけでなくreceipt/result/競合/History/backup内のコピーも保護。completionと日時の組を分割して部分適用しない|
|receipt/resultの内容、semantic rejection理由、候補値/履歴|機密部分は暗号化、公開はidentity/structural dispositionだけ|公開reason/logに本文や機密値を出さない。serverは復号済みと主張しない|

公開attribute groupまで隠すとserver側の属性DAG検査はできなくなる。metadataをさらに秘匿する方式は別E設計であり、現表と同等に実装可能とは推測しない。ID/長さ/traffic/padding/parent関係の漏えいを、E2EEという語だけで解消済みにしない。

### E2 AAD・凍結ciphertext・鍵version

暗号wrapperのAADはdomain/schema + **全公開immutable header（ciphertext/tag/wire digest自体を除く）**の一意なcanonical bytesにする案。少なくともmode/Realm/activation/baseline/resource/group/opId/actor/command/observed/readSet/dependencies/keyVersion/suite/nonceへ束縛し、暗号payloadのheader mirrorと照合する。曖昧なconcat、header書換え、別field/世代へのciphertext移植を拒否する。

提案suiteはAES-256-GCM、256-bit DEK、96-bit nonce、128-bit tag。鍵ごとnonce重複を禁止し、安全な生成/検出/複数端末/restore時の扱いをEテストで固定する。nonce生成にlocalSeqだけを使わない。暗号suiteの採用・KDF/wrapping/復旧キー/端末共有/鍵rotation/root供給は独立暗号レビューを要し、この設計レビューだけでproduction cryptography承認にしない。

opIdはlocal candidateで一度決め、生成したnonce/AAD/ciphertext/tag/keyVersion/headerを**全wire一体で凍結してlocal CAS保存後だけ**送信する。CAS失敗/応答喪失ではserver送信/新ID採番を先行しない。retry/再起動/receipt照合は同一wire bytes。receiptは当該wire identityへ束縛し、同opIdの再暗号化を「同じ本文だから同じop」と扱わない。

keyVersionは鍵選択のidentityであり、新しい番号を因果優先にしない。古い鍵の操作が遅れて来ても参照/key許可を検証し、古さだけで消さない。rotationで既存immutable intentを書換えず、新しい暗号世代やmappingを明示設計する。誤鍵、鍵未解放、非対応suite/未知schemaを空値/未完了/★OFFへ変換しない。

### E3 検証責任・収束・保護

|段階|serverの責任|鍵保有clientの責任|
|---|---|---|
|受付|認証/realm、wire shape/identity、公開DAG参照とdurable accepted。内容正当性を証明しない|保存済みwireとpayload/AADを照合。受領は復号成功を意味しない|
|構造publication|accepted map/coverage/root/member/祖先、公開metadataの構造整合性|全wire取得、AEAD、header/payload一致、全依存closureの復号、同一validator/reducer versionによる意味検証|
|意味状態|鍵なしserverはcompletion/日時/Routine/group/readSetの意味を検証できない|atomic groupを全件検証し、baseline+全復号intentの同集合から候補/結果を決定的計算。arrival order/時計/端末言語で変えない|
|同期完了|server受領/構造headまでの証明|意味publicationの真正性/一致を検証・local保存する契約が確定するまでE2EE completeを発行しない|

鍵未解放/当該keyVersionなしは`key-unavailable`（ローカル可用性）で、操作の意味rejectではない。tag/AAD不一致・unknown format・header mirror不一致・認証済みpayloadの意味不正は原wire/receipt/関連候補を保全し保護停止。clientがserver logから削除したり、復号不能候補を無視して残りだけで正常projectionを公開してはいけない。保護範囲は少なくとも該当replicaの当該Realm全体とし、部分編集許可は別レビュー。

同じvalidator versionと鍵・同じbaseline/全操作closureを持つclientは、同じMV候補/意味結果へ収束しなければならない。鍵がないclientは推測結果を配信しない。依存が未取得ならdependency-pending、取得済みで意味不正なら保護と区別する。semantic validator version差、鍵集合差を決定的な勝敗材料にしない。未知versionは停止する。

**未決定E4:** 鍵を持たないserverのTransportPublicationEと、clientが検証するSemanticPublicationEの対応/証明方式。全client再計算を正本確認とするか、認可されたvalidator端末の署名と再検算を併用するか、opaque payload上のatomic group/semantic protectionをどの永続objectに束縛するかを別Eレビューで決定する。device署名だけで全端末が同意/永続化した証明にはしない。未決定の間は標準Pを暗号化だけしてEのsemantic appliedへ流用しない。

serverが不正/不完全wireを受領した事実と、意味不正を拒否する判断は両立する。accepted原操作を消さず、候補/保護原因を保持する。不正候補を明示隔離/解決する操作、複数端末の検証不一致、管理者omission/rollback/equivocationの検出限界、key revoke後の遅延操作はE4と合わせて承認が必要。

Authは鍵の所有を証明しない。鍵共有/復旧は#119の利用者秘密/復旧キーを用いる別手順。server logがあっても全鍵喪失なら内容復元不可。バックアップには全wire/操作/候補/evidence/keyVersion参照を保持し、鍵材料を無保護で同梱しない。配信元が悪意あるJSを配れば解放鍵/平文を扱い得るため、Firebase管理権限だけでは復号不可という目的を「運営者は絶対読めない」へ拡張しない。

## 3. 既存APIとの対応（全公開入口の分類）

対象は`src/sync/intent`の公開基盤入口。helper/test fixtureは変更せず、製品既存Node/Firebase保存経路にも接続しない。ここでの「廃止」は**Bの実provider契約として採用しない**意味で、承認済みコード/模擬証拠の削除ではない。

|既存API/型/ファイル|分類|Bにおける責任・禁止事項|
|---|---|---|
|Phase 1 `Scope/Resource/Intent/Observation/Write/Completion/Baseline/Head/FieldState/ApplicationResult/ReducedState` (`types.ts`)|維持|属性因果/MV・atomic completion・明示OFF/readSet/deps/resolve。新Realmとの明示adapterを追加し、既存意味を変更しない|
|`canonical/compare/same` (`canonical.ts`)、validationの`resourceKey/fieldKey/validResource/validWrite/validateBaseline/intentError`|維持|標準pureデータの検証。新wrapperのencodingはdomain付き別schemaで固定、未知型をcastしない|
|`reduceIntents` (`reducer.ts`)|維持|標準S6再計算。E2EE serverへ平文鍵を供給しない。F1/F2/R-F2の意味を維持|
|`AcceptanceDecision/evaluateAcceptance`|維持＋新設|pure判断は利用可。`ServerAdmissionB`が認証/epoch/identity全検査とatomic log root更新を新設。pure receiptをserver commitと呼ばない|
|`AcceptedReceipt/DeliveryLedger/recordAccepted`|維持|全不変payload照合、durable awaiting移動。B用真正receipt wrapperは別型で検証後だけunwrap|
|`Checkpoint/Binding/Publication/makePublication/initialClient`|維持＋新設|pure候補と既存chainは維持。`ActivatedPublicationB/CutCertificateB/ReplicaBindingB`でsource log/coverage/activation真正性を追加。bindingを省略しない|
|`ClientSnapshot/ClientEvidence/recordClientAccepted/applyPublication/PublicationDecision/Digest`|維持|歴史的reflectionと現在競合分離、衝突保護、原intent/receipt/result全来歴。B wrapperを検証する前にapplyしない|
|Phase 2A `AtomicStorage/RawPair`、`openIsolatedStorage` (`isolatedIndexedDb.ts`)|維持|expected raw CASとJournal-nullを一transaction、完了前確定なし。synthetic専用制約を勝手に外さない。実storage adapterは別承認|
|`LocalContext/LocalInput/Event/Notice/InboxEntry/Derived/Envelope`|維持＋新設|既存Phase 2A formatを維持。新`ReplicaEnvelopeB/ContextB/VerifiedNoticeB`でserver認証部分/local-only/Kを束縛。旧formatへ推測変換しない|
|`hash/build/guardFor/hydrate` (`local/hydration.ts`)|維持|既存`hydrate(raw, context, exactFloor)`を自己guardで迂回禁止。`verifyReplicaEnvelopeB/openReplicaB`を別入口として新設|
|`RecoveryGuard`、`LocalIntentStore.open/view/guard/local/receive/drain`|維持＋新設|旧APIの保証はそのまま。B新storeはatomic保存/replay/inbox設計を再利用しても旧open/guardの意味を弱めない|
|`localIntent/replay` (`local/replay.ts`)|維持|採番候補/全event再構築を維持。B追加eventには別versionのreplayが必要。旧eventを無断読み替えしない|
|`ServerObservation`、`LocalIntentStore.status(server)`|置換（B利用時）|旧binding+checkpointのDTO一致ではBのaccepted穴を証明できない。新`VerifiedCutB/ReplicaStatusB/completeAt`だけをBの同期判定に使用|
|Phase 2B-1 `AuthPrincipal/SignatureIssuer/PinnedVerifier`|維持＋新設|抽象の認証/署名検証責任は再利用可。B wrapperはformat/purposeを分離し、別protocolとしてscope/nonce/期限を検証|
|`Command/Request/Head/Plan/Value/Claims/SignedReply/AuthorityChannel`|廃止（B実provider契約）|per-replica raw prepare→witness→finalizeを使用しない。mockと試験は残す。新`ServerLogChannelB`は受付/identity照会/cut/member取得/activation結果照会のみを定義|
|`NoticeTicket`、`AuthorityBridge.notice/receive`|置換|private verified capabilityの意図を維持しB用検証済み通知ticketを新設。JSON DTO/同型copyは検証済み資格にならない。永続化は原署名証拠を保存して再検証|
|`AuthorityBridge.initialize/open/recover/retryPrepared/local/drain/status/state/view/retire`|置換|別`ReplicaCoordinatorB`で01規範を実装する将来案。旧bridgeへACKをwitnessとして注入しない。Auth retire/原本保持/明示復旧は維持|
|`MockAuthority/MockIdentity`とmock provision/activate/publisher/clock/署名供給|維持（過去ハーネス）|独立witnessの模擬証拠を保存。B用durable-log模擬providerを新設し、実運用成立性の試験と混同しない|

新設型の最小分離: `LocalIntegrityB`はローカルraw consistency専用、`ServerAnchorB`は認証されたserver基点専用、`CutCertificateB`は署名応答、`VerifiedCutB`は全件検査済み資格。どの型も別型へ暗黙castしない。backupのLocalIntegrityBをServerAnchorBにしない。新入口から旧RecoveryGuard自己承認へ流れる抜け道がないことを接続監査する。

## 4. 独立レビュー判定単位と未解決事項

|単位|このPRで判断を依頼する内容|未決定/閉じるゲート|
|---|---|---|
|S-CUT|01 S1–S6: 全map照合、累積coverage、原子的control root/activation、collision sticky protection|canonical test vectors、serverサイズ上限/chunk上限/取得予算・性能は後続隔離モデルの仕様固定が必要。取得不能は成功にしない|
|S-REPLICA|01 S7–S10: 四状態、exact完了条件、別入口、原本保護/復旧|AdmissionRejectionの明示処置/現在阻害からの退役、保護解除の権限・手順は未定。未定義なら阻害/保護を維持。UI実装なし|
|E-METADATA|02 E1/E2: 公開範囲・AAD・凍結wire/鍵versionの候補仕様|漏えい許容、suite/nonce/key共有/rotation/root/復旧を暗号レビューで確定。E mode受付は閉じる|
|E-SEMANTIC|02 E3/E4: 構造受領と意味反映を分離、全client決定性/候補保護|TransportPublicationE↔SemanticPublicationE証明方式、validator identity/version、invalid/quarantine/resolve、鍵差/欠損の規則が未確定。Eのsemantic applied/complete/SDKは閉じる|
|P-PROVIDER|Auth subject/audience/revocation、root配布/rotation/失効、clock/skew、nonce cold start、durable server/IAM/backup/fenceの実供給|具体署名suite/鍵保管/運用主体、初回bootstrap、provider信頼時刻、復旧権限、保存/サイズ制限、費用・可用性が未確定。SDKは閉じる|
|M-MIGRATION|PR #123/#119の全永続種別、draft回収、排他freeze、移行・rollback維持の対応確認|実行runbookと両端末/全外部producer照合は別承認。旧Node/Journal/Outbox/receiptの自動変換は禁止|

S承認のみをE2EE機能の承認にしない。標準modeの隔離pure/harness実装計画を将来分割することは可能だが、E namespaceを明示拒否する負の受入が必須。P未承認なら標準modeであっても実SDK接続不可。レビュー未決を「合理的default」で製品実装へ埋めない。
