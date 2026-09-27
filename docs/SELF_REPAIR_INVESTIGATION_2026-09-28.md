# 同期自己修復の停止原因調査（2026-09-28）

## 確定した判定条件

`firebaseSyncAdapter.convergeRecoveryTarget` は、事前server readの `observed.value` とtransaction readの `current.value` を `canonicalSyncValue` で比較する。desiredと一致していれば既完了とみなす。それ以外で両者が異なると `concurrent-user-change` を投げる。変更主体を識別する条件はないため、従来の「他端末」という表示は根拠がなかった。

比較範囲はvalue内の全フィールド（title/body、sortKey、updatedAt等）。outerのrevision、lastOpId、lastDeviceId、lastLocalSeq、operationTypeは含まない。オブジェクトのキー順は正規化、配列順は保持、missing/nullは区別する。before/afterの実値と対象Nodeは既存ログに記録されなかったため、今回のiPhone停止の具体値と書込主体はまだ断定できない。画面の0/0はcatch後にprogressを消すため、書込0件の証拠ではない。

## 仮説A–Iとコード上の結果

| 仮説 | 結果 |
| --- | --- |
| A 自己修復自身の先行書込 | 現行planはNode IDを一意化し、各transactionは自分のNodeだけを書く。通常のケースでは後続Nodeのbaselineを変えない。 |
| B 通常uploader並行 | 同一hookのlocal recovery controllerはuploadしない。ただし既に開始した別の通常controllerのflushはstop後もwhileループを続行できる。テストで再現済み。別タブとの共有ロックもない。今回動いたかは未確認。 |
| C listener feedback | 通常controllerのlistener→receiveSerialized→sortKey修復→Outbox→flush経路が存在。通常モードのテストにもこの自動送信がある。local recovery controllerにはlistenerがないので、今回起きるには別／古いcontrollerが必要。 |
| D background補正 | 通常store.openのsortKey修復と受信時修復はOutboxを生成し得る。local recoveryではpreserveSortKeysを指定。Routine画面の日付更新自体はNodeを書かない。 |
| E remote反映でOutbox生成 | 通常のremote受信時にsortKey修復が起これば生成する。全remote反映が無条件でOutbox化するわけではない。 |
| F metadata | outer同期metadataのみの差では現行条件は停止しない。value内updatedAtの差では停止し得る。 |
| G 表現差 | JSON正規化はkey順を吸収するが、missing/null、配列順、値の型は区別。Firestore TimestampとJSON化planの不一致は旧Recoveryの`predicted-base-mismatch`としてemulatorで再現した。現行自己修復は同条件では停止しなかった。 |
| H 前回4件 | 今回は現remoteを読み直すため、前回成功4件は初期状態に含まれる。保存済み64件planやそのReceiptは再送しない。 |
| I 二重起動 | hook内runningRefとcontroller generationはあるが、同一アカウントの別タブ／PWAコンテキスト間の排他はない。stop後の進行中flushについても世代確認がない。 |

旧1024 Outboxについては、旧sortKey正規化が兄弟群全体を再採番し、remote listenerからOutboxを作る経路があった。53/55件単位の時間クラスタと整合するが、全1024件の生成原因・Receipt欠落理由の完全な証明ではない。

## 書込可能経路

- V2 client `firebaseSyncAdapter.upload`（通常Outbox、旧Recovery呼出元）と `convergeRecoveryTarget`（自己修復）: nodesV2/profileV2、syncOperationsV2。
- V1 client `useFirebaseSync`: users/{uid}/nodes。V2有効時のhookはV1を停止。
- Cloud Functions `firestoreNodeRepository.transact`: 外部AI HTTP経由のV2 Node/Receipt。Firestore event/scheduled triggerは見当たらない。
- 管理・移行スクリプトには別の明示的な書込経路があるが、アプリ起動だけでは実行しない。

## 今回追加した実機診断

通常画面の「読取専用診断」はserver snapshot後に全candidate Nodeとprofileをtransactionで読み直し、差分を確認してsetを呼ばない。self repairは実行しない。診断ページのJSONに、Node ID、時刻、差分フィールド、before/after値のSHA-256と型、sync metadata、最終自己修復operation、当該lastOpIdのReceiptとの照合、snapshotのcache/pending flags、通常upload/listener/Outbox生成回数を保存する。生のtitle/bodyは出力しない。カウンタは同一JavaScriptコンテキストだけの観測であり、他タブや旧buildを網羅しない。

次の実機確認では同期自己修復ボタンを押さず、まず「読取専用診断」を1回実行し、診断JSONを共有する。これは再実行中だけ起こる競合を必ず再現するものではない。将来の自己修復停止時にも同じ診断を保存する実装にしている。
