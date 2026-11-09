# #107 Phase 1 レビュー担当への引き継ぎ

正本: [承認設計212461c](https://github.com/yshtysht8sh10-glitch/TaskMemoApp/tree/212461c99d3556e055fb5265cbc6e4c80116f8ac/docs/design/intent-sync)。実装/試験/32計画ケースの範囲表/既知の制約は[Phase 1レポート](ISSUE107_INTENT_PHASE1.md)。承認設計の変更はない。

**第2回修正R-F2の再レビュー対象は同レポート末尾。** 前回7c27dc0の46 PASSでもapplied→conflictをまたぐreceiptが順序依存だったため、Phase 1は未承認・未完了のまま。

今回の確認重点: `ClientSnapshot.evidence`でaccepted、検証済みpublication来歴、checkpoint時点のapplied確認を現在state/protectionから分離。後着Rは過去P1の原payloadに照合し、現在MV競合を残したままledger正規化。初回conflict/依存待ち・保護候補のcoverageでは反映確認を作らない。原intent/receipt/結果を失わず、重複/JSON再構築もsnapshot全体で比較する。

既存46件中、保護停止後にP1反映を忘れる期待1か所だけをR-F2の要件に合わせ更新し、受領/反映/保護来歴のassertを追加。テスト/skipの削除なし。変更理由・追加12件・各要求対応はレポートに記録。R/P1/P2 3順序、720ラベル通知順列、6操作720逐次順列を再レビューしてください。awaitingが空でも現在conflict/protectionを同期成功としないことが必須です。

第2回修正の実行結果: 新規3 FAIL→PASS、focused **58 PASS**、全体 **1,342 PASS / 46既存skip**、型/Lint/diff check/Web export成功。4既存skipファイル/46skipケースは未実施。結果ログはrepository外`artifacts/pr124-rf2-*`。以下の36/46件の記述は過去の実行記録であり、今回の承認状態を意味しません。Phase 1は再承認待ち、Phase 2へは進みません。

## 変更の目的とレビュー範囲

全Nodeのrevision勝者だけで完了・★が巻き戻ることを避けるため、属性intent・因果frontier・MV候補、受領と反映、単調publicationを隔離した純粋関数として追加した。Production source `e18c4d1`の#114と起動高速化を保持し、未配信Queue等を基点へ取り込まない。既存production保存・同期経路は一切変更していない。

レビュー対象:

1. `types/validation`: 明示OFF/取消、completionの原子性、resource identity、観測基点と依存の妥当性。wire protocolを誤って本番へ割り当てていないこと。
2. `reducer`: 配送全順列で証拠/候補/結果が一致すること。未着親/衝突/意味依存/atomic commandを失わず、因果祖先と真の並行を区別すること。
3. `acceptance`: 受領だけでappliedにしないこと、Outboxからawaitingへの戻り値が原操作を残し、既存CASへ未接続であること。
4. `publication`: 古い一致pair・異世代・分岐・欠member・coverage減少を適用せず、checkpoint/state/ledgerを一括候補にすること。hash一致だけで誤projectionを通さないこと。
5. 36件のpure試験と既存12件/追加32計画の追跡。実未実装の移行・永続・Emulator・実機をPASSと数えていないこと。
6. 複数resource command/意味競合解決/Domain制約等の未実装を、後続への接続条件として明示していること。設計の曖昧さを暗黙のLWW等で補っていないこと。

## 再実行

通常の依存install（appとfunctions）とExpoの生成参照型を揃えた作業環境で:

```powershell
npx vitest run src/sync/intent --maxWorkers=2
npx vitest run --maxWorkers=2
npx tsc --noEmit
npm run lint
git diff --check
npm run web:export
```

実施結果: focused 36 PASS、全体1,320 PASS/46既存skip、型/Lint/Web export/diff check PASS。旧版診断はQueue1/7、★1/5の既知失敗を再確認。PR #122や元診断を修正/削除していない。公開設定の静的検証を含むDEV向けローカルbuildのみで、Firebaseへの通信テストや配信ではない。

## 停止境界

2026-11-09: F1/F2修正版の再レビュー待ち。詳細はPhase 1レポート末尾。新pure APIは`recordClientAccepted`、保護状態は`ReducedState.protection`と`ClientSnapshot.protection`。`kind=protected`ではstateは最後の検証済みread-only表示であり、新しい正常状態ではない。低レベルrecordAcceptedだけで逆通知順を処理しない。保護解除APIは今回追加していない。既存の保存/Outbox/receipt adapterへの接続はせずPhase 2も開始しない。

開発担当はcommit/push・レビューPR・#107記録まで。レビュー担当のPhase 1承認前にPhase 2へ進まない。APPROVEされても実データ読取、データ移行、Rules/Functions配備、DEV/Production配信の許可にはならない。#107/#120を機能完成としてCloseしない。#120は操作モデルだけで★表示UIを実装していない。
