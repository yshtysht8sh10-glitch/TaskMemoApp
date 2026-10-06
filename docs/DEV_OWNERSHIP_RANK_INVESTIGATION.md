# DEV ownership commit: sibling sortKey investigation (2026-10-06)

対象: [Issue #85 最新コメント](https://github.com/yshtysht8sh10-glitch/TaskMemoApp/issues/85#issuecomment-5999245378)。production変更、原本変更、rank修復、validator緩和、deploy、Issue Closeを行わない。

## 確認できた経路

`TaskMemoV2ApplicationStore.commitOwnership` は選択されたlocal Nodeをaccount Domainのコピーへ追加し、その **結合候補** に `decodeLegacyNodes` を実行する。V1からの初回移行だけではない。`reconfirmOwnership` も受信V2 snapshotへ同じdecoderを使う。

`legacyLocalCodec.ts` の兄弟重複チェックは `!deletedAt && !purgedAt` のNodeを対象とし、`[parentId ?? null, sortKey]` の一致を拒否する。旧 `rank` field自体は参照しない。completed Nodeも対象。したがってエラー文言だけで「V1原本内が破損」とは判定できない。

commitのこのチェックは永続化より前。例外時はDomain候補・operation候補を破棄し、History/Outbox/nextLocalSeq/ownership transactionを保存しない。

## 合成再現（実機fixtureではない）

anonymous: `anonymous-example / parentId=null / sortKey=a0`

account: `account-example / parentId=null / sortKey=a0`

双方単独ではdecoderを通過。previewはanonymous Nodeをadd、account counterpartはnullとする。commitでは報告と同じ「V1兄弟rankが重複しています。原本を保持しました。」で停止。停止後のpersisted envelope一致、journal=null、History=0、Outbox=0、pending ownershipなしを確認。

通常Domainの `compareNodes` はsortKey一致時にIDをtie-breakする。ただし、それだけを根拠にmigrationの重複禁止を削除してはいけない。独立scope間の合法衝突と原本内部の破損を実データで区別し、ownership用契約を決める必要がある。

## DEV実Firebaseの読み取り

2026-10-05以降に作成されたDEVアカウント5件を読み取り。Node数は1/1/1/0/0、各非空Domainはactive Memo1件、parentId=null、sortKey=a0、deletedAt/purgedAt=null。Cloud領域内の兄弟重複は確認されなかった。対象iPhoneの現在のUIDとの対応、およびanonymous snapshotは未取得。

これは対象account確定や実機localとの衝突ペアの証明ではない。Auth account一覧とnodesV2の読み取りのみ、Cloud書き込みなし。Node title/bodyは診断出力しない。対象の私有metadataはgitignored artifacts/privateへ保存。

### 指定アカウント・時刻との照合

ユーザー指定accountをDEV Authで一意に照合（UIDとメールの対応はprivate artifactにのみ保存）。日本時間2026-10-06 02:00/02:04はUTC2026-10-05 17:00/17:04。

- Auth作成: JST01:54:42、最終login: JST01:59:03。
- gateおよびprovisioning receipt: JST01:54:43に作成、更新なし。v2Enabled=true、minimumSyncProtocol=2、v1WritesAllowed=false。
- Cloud nodesV2: active Memo1件。parentId=null、sortKey=a0、rankなし、deletedAt/purgedAt=null、revision=1。JST01:54:44作成・更新後、変更なし。
- syncOperationsV2: 同Nodeのcreate1件、ownership preconditionあり、baseRevision=0、acknowledgement applied。JST01:54:44の初回取り込みはCloud到達済み。
- 旧nodes collection: 空。Cloud兄弟重複なし。
- callable logsはUTC16:50–17:10（JST01:50–02:10）のDEVサービスを取得。対象gate作成時刻と対応するHTTP200、Auth/App Check VALIDを確認。UTC17:04付近のcallable呼び出しは記録なし。ただしcallableはownership commitそのものではないため、この不在だけでclient実行状態は断定しない。
- 現在のCloud Node/receiptのserver時刻から、JST02:04の停止した取り込みによる新規record/operationはこのaccountに存在しない。

今回のpreviewでaccount counterpart=nullだったNodeが、初回取り込み済みMemoとは別IDなら、既存root/a0 Memoとのscope間衝突が成立し得る。account counterpart=nullはaccount全体が空であることを意味しない。実機anonymousのID/parentId/sortKeyを未取得なので、実際の衝突ペア・原本内部重複の有無はまだ確定しない。

Firestore documentのNodeはtop-levelではなくrecord.valueに格納される。最初の診断抽出のnull値はdecoderの参照位置違いであり、同じdocumentを正しく再読取し、private artifactを上記metadataで更新した。null出力を実データ破損として扱わない。

## 原本を変えずに実機ペアを特定するための材料

必要: 現在の対象UID、実行origin/build、anonymousおよびaccountのcommitted/journalにあるNodeのID/type/kind/parentId/sortKey/rank/deletedAt/purgedAt、選択されたownership候補。Functions logsだけでは、送信前にclient内でthrowしたこの候補を取得できない。

既存 `public/v2-recovery-backup.js` はTaskMemo/Firebaseを起動せず、localStorageと既存IndexedDBをreadonlyで読む。バックアップ全体には本文・History等が含まれるため、チャットへ貼らず私有場所へ保存する。必ず問題のPWAの保存領域から取得する。別Safari領域からの取得を実機原本として扱わない。現在のUIのバックアップ入口はwindow.openを使うので、iPhoneでSafariへ移った場合は対象領域が違う可能性があり、そこで止める。

取得済みファイルを手元PCで次のように解析する:

```powershell
node scripts/analyze-ownership-ranks.mjs 'C:\private\taskmemo-v2-recovery.json'
```

scriptはinputを読み取るだけ。Firebase依存なし、ファイル書き込みなし、title/body/profile/outbox/historyは出力しない。metadataは上記fieldのみ。scope内重複とscope間衝突候補を分ける。scope間候補は選択planと照合するまで確定衝突とは扱わない。結果はUID/Node IDを含む診断情報として扱う。

## 検証・停止位置

`npx vitest run scripts/analyze-ownership-ranks.test.mjs`: 3 pass。独立scopeの衝突、completedを含むactive条件、deleted/purged除外、同一scope journalを合流しないこと、内容非露出、入力不変、旧localStorage形式、異なるarchive format拒否を確認。

アプリの動作・validator契約は変更していない。rank互換修正、実機reconcile再開は未完了。

## 実機metadata取得後の確定事項

ユーザー提供のoffline analyzer出力（2026-10-05T17:42:05Zバックアップ）を照合。私有Node ID/UIDは添付原本・private artifactへ保持し、ここでは匿名化する。

- local:v2:developmentのcommitted Domainはactive Memo1件（local-A）。parentId=null、sortKey=a0、旧rankなし、deletedAt/purgedAt=null。
- 指定accountのcommitted Domainもactive Memo1件（account-B）。IDはlocal-Aと異なり、parentId=null、sortKey=a0、旧rankなし、deletedAt/purgedAt=null。
- account-BのIDは先に取得した実Firebase nodesV2およびapplied receiptのIDと一致。
- 各DomainのduplicateActiveSiblingsは空。今回のrank停止は原本内部重複ではなく、local-Aを既存account-Bへ追加する **結合候補内の衝突** と確定できる。全文fieldの合法性まではmetadata-only診断で保証しない。
- 他account間のcrossScopeCollisionsは候補一覧であり、今回のtargetへ合流する対象ではない。他accountを修正しない。
- archiveOriginはproduction命名projectのHosting preview channel（issue85-iphone）だが、対象account scopeはtaskmemoapp-dev。origin名だけでproduction Firebase接続と断定しない。productionへのdeployやCloud操作は行わない。
- archiveBuildが未置換placeholderであるため、バックアップ出力から実行app commitは確定できない。

このケースは初回V1移行の「壊れた兄弟rankを推測修復」するケースではない。独立V2 scopeで同じ初期sortKeyが合法に発行され、ownership結合時にV1移行用の一意制約が適用されている。修正候補はownership専用の検証契約（source/account個別の整合性と結合後の親・cycle・purged等の保護、既存sortKeyとID tie-breakの扱い）であり、V1 validator全体の緩和・原本rank書換えではない。

## 実装後の状態

最新Issueコメントに従い、結合後もsortKey一意性を維持する [正式統合契約](OWNERSHIP_SORTKEY_INTEGRATION.md) を実装。単純なID tie-breakによる重複許容は採用せず、衝突したlocal採用Nodeだけの取り込み先キーを決定的に生成する。原本と非採用accountキーは保持。UIとcommitで同じpure projectionを使用。

全体回帰822 pass / 40 conditional skip、TypeScript・Lint・diff check・Web exportを検証。診断scriptのテストは全体Vitestと整合させた。新テストの後続local編集判定はUndo/Redo前で確認する（Undo/Redo後は更新日時変更が正当なaccount編集として扱われるため、applyを期待しない）。Firebase/Hosting配備とiPhone再検証は未実施。
