# #57 Native一覧DnDの挿入位置表現

## 変更前の経路

1. `DeadlineView.tsx` のmemo行の `Pressable.onLongPress` がライブラリの `drag` を呼ぶ。Nativeの長押しは180ms、activationDistanceは8px。選択モードとRoutine過去occurrenceは開始不可。
2. `react-native-draggable-flatlist` のtouch開始、Pan gesture、Reanimatedがactive cellとspacerを管理する。`drag` はactive/spacer indexを設定し `onDragBegin(index)` を呼ぶ。
3. `onDragBegin` は元の `rows[index]` から移動元IDとsourceGroupを保存し、`setCandidate(index)` を呼ぶ。
4. spacer indexが変わると `onPlaceholderIndexChange` → `setCandidate`。元の表示用 `rows[index].groupKey` を `sourceGroups` に照合し、create可能かつ日時入力不要なbucketだけ候補にする。見出し・memo・quickAddの行種別や行内の上下位置は判定に使わない。画面内ピクセル座標やviewability callbackによる判定もない。
5. touch終了後、ライブラリはspring完了時に `onDragEnd({from,to,data})` を呼ぶ。指を動かさなかった場合はtouch終了のreactionからも呼ばれる。`finish` はこの並べ替え済みdata/from/toを使わず、最後の候補refだけを使う。
6. refとhighlightを解除し、移動先がsourceGroupと異なる場合のみ `onDueDrop(id, target)`。beforeIdは未指定、同一bucketは無操作。
7. `src/app/index.tsx` の `apply` → `moveMemoInDeadlineList`。期限と不足するdeadlineSortKeyを補い、移動元を除いた移動先bucketの末尾でfractional keyを生成する。通常のtree sortKeyとparentIdは変更しない。Routineの期限変更制限も既存domain処理に残る。

## Webとの仕様差

- Webは `WebSortableScrollList` がpointer/touchと行内位置からbefore/after/onを判定する。memo行のbefore/afterは `deadlineBeforeIdForDrop` → `beforeIdForInsertion` でbeforeIdに変換する。heading/onはbeforeIdなし。
- Webは同一bucketの前後並べ替えにも対応する。Nativeは別bucketの末尾移動のみで、dropした行の前後へ挿入しない。
- Nativeは期限切れ、日時入力が必要なlater、sourceGroupsに存在しないbucketを候補にしない。WebにはこのNative候補filterを追加しない。
- 表示用bucketを統合してもmemo行は元bucketのgroupKeyを持つ。Nativeの候補判定は表示見出しのbucketへ強制的に揃えず、従来どおりsourceGroupsを参照する。

## 共通化とNative固有処理

`nativeDeadlineDrop.ts` に、placeholder indexからbucketを復元する処理と、移動元・候補から `{groupKey, position: {kind: 'append'}}` を生成する処理を分離した。Nativeのfinishはこの意味表現を既存 `beforeIdForInsertion` でbeforeIdへ変換する。

`insertionPosition.ts` はUI非依存で、そのまま再利用可能。prepend/before/afterはNativeの新機能として使用せず、共通テストで維持する。共通関数とWebのdrop処理、期限変更・key生成domain処理は変更していない。

touch、長押し、placeholder、ライブラリのspring、ScaleDecorator、選択/Routine制限、candidate highlight、ref解除、autoscroll設定とFabric cell translation patchはNative固有のまま維持。#56のWeb側autoscrollも変更なし。ユーザーから見た仕様変更は意図していない。

## 検証

- focused + 共通挿入位置: 2 files / 12 tests PASS。
- Native DnD回帰 + deadline/tree/routine/activation/autoscroll: 7 files / 91 tests PASS。
- 全test: 96 files / 617 tests PASS、既存の環境依存3 files / 25 testsはskip。
- TypeScript、lint、git diff --check: PASS。
- 共有コンポーネントの変更がWeb bundleに含まれるためproduction Web export後にHostingもdeployする。export/deploy結果は作業完了報告に記録する。

## 未実施の実機確認

- iOS/Android Native: 長押し開始、指を動かさず終了、同一bucketへdropして順序が戻ること。
- 別bucketの先頭/末尾/見出し・折り畳みbucket・隣接境界・統合bucketへdropし、従来どおり末尾移動すること。
- 空の期限なしbucketへ移動し、期限と表示順が正しく更新されること。
- 端autoscrollの継続/停止、連続drag後の行位置・highlight解除、Fabricの残留translationがないこと。
- PC Web/iPhone Safari/PWA: 同一bucketのbefore/after、別bucket移動、端autoscrollの操作感。

実機操作は自動テストで確認済みとは扱わない。#57はレビューと必要な実機確認後にユーザーがCloseする。
