# Routine履歴の入力性能とDEV配信判断

開発担当から独立レビュー/リリース担当へ。基点は承認済みPR141 `74aad5f9731056aee01a1063f77f47c58f80ae99`、PR140 `007b2df`を包含する。今回の性能差分は別commit/別PRで再レビューを依頼し、元の承認済みSHAを更新しない。#117/missed/gate/Rules/Functions/IAMは非変更。

## 1 DEV preflightと配信中止

公開HostingとFirebase管理APIのGETだけで確認した。AuthユーザーやFirestoreのユーザー文書は列挙/取得していない。

|確認対象|確認値|
|---|---|
|公開DEV URL|https://taskmemoapp-dev.web.app|
|公開build SHA|24d4b46ad9c4f2df26aa49ac78acf03ae86af5b7（対象74aad5fではない）|
|Hosting release|sites/taskmemoapp-dev/releases/1793432284326000|
|Hosting version|sites/taskmemoapp-dev/versions/1fb0ce74bc1d2db0|
|release時刻|2026-10-31 16:38:04 JST|
|Firebase project|taskmemoapp-dev / projectNumber 1045397314197|
|Auth|project1045397314197、email/password有効。authorizedDomainsはlocalhost、taskmemoapp-dev.firebaseapp.com、taskmemoapp-dev.web.app|
|Firestore|projects/taskmemoapp-dev/databases/(default)、FIRESTORE_NATIVE、asia-northeast1|
|公開bundle|entry-8d56595ff7149e4e716d20edce15ca0a.js。DEV authDomain/bucket/projectNumber、上記SHAとtaskQueueを含む|

**共有DEVへの配信は中止した。** 公開24d4b46にはQueue機能があり、Production e18c4d1基点の対象74aad5fにはその変更がない。モデル・codec・backup・同期の差分もある。既存DEV利用者/既存保存データが存在しないという根拠はなく、上書き配信が既存データを安全に扱うと証明できない。実被害や既存ユーザーの利用件数を確認したという意味ではない。

本指示の「DEVでも既存利用への影響があり得る場合は配信しない」に従い、deploy/account作成/Firestore書込は実行していない。上記URLを本人の今回版確認URLとして案内しない。対象版のDEV URLは未発行。

## 2 隔離の代替案

推奨は専用テストFirebase projectのHosting/Auth/Firestoreと、使い捨てUID・新origin・合成fixtureだけで検証する方式。project準備、必要な認証/接続、配信対象と実行承認は別に確定する。新project/課金/Rules/Functions/IAMは今回変更しない。

既存DEVのHosting previewだけを分けてもAuth/Firestoreは同じprojectのままで、データ隔離を証明しない。採用するなら専用UID、全アクセスpath、Auth domain、同origin IndexedDB/backupを含む隔離証拠が必要。現DEVへのQueue関連変更の無断取込みや既存保存領域の初期化で対処しない。

当面の安全な代替として、Firebase SDKを含まないlocalhost合成component hostで性能を比較した。実Firebase DEV検証完了の代わりとはしない。

## 3 修正前profile

実RoutineHistoryPanelをReact Profiler＋jsdomの同一ハーネスで計測。125件/5,000件を全展開し、本文だけの親更新5回と、保存後を模したbody/履歴map複製＋callback変更5回を比較した。

- 5,000件：各条件で正規化5回、行を含むView呼出25,005回、ハーネスDOM20,004要素。
- 125件：各条件で正規化5回、View呼出630回、DOM504要素。
- 修正前の回帰2件は、親本文入力で正規化/行描画が不要に走るためFAIL。
- EditorModalは本文をlocal stateに持つため入力時に再描画する。保存済みmemo参照は入力中に変わらなくてもPanelの関数本体が毎回実行され、正規化/sort、slice、全行のReact要素生成/照合が走っていた。autosave/受信ではmemoやcallbackも変わり得る。

このprofileは実EditorModal全体の自動保存を実行したものではなく、同じ親更新/props条件を再現するcomponent hostとコード追跡である。ユーザー提示の旧p95約311msは既存Edge測定として別保持する。

## 4 小規模修正

RoutineHistoryPanel内だけで次を変更する。

1. memoと日付/zone/offset contextを基準に履歴正規化をuseMemoで再利用する。本文だけの親入力では再計算しない。日跨ぎ/zone変更ではローカルDateの操作対象も再作成する。
2. 表示sliceと行描画を分離。memo化した行群はkey/outcome/completed/対象Date/idで比較し、同じ表示意味ならDOMを再構築しない。同一arrayは即一致とする。decodeで同じ内容のmapが再作成された場合も比較できる。
3. onToggleはlayout effectで最新callbackへ接続する安定したevent入口を渡す。親callback更新を無視せず、古いAuth/command closureを保持しないことを試験する。

行群は自身でtheme contextを参照するのでtheme更新を止めない。新しい結果/同件数の状態変更、日付context、ID、表示数は再描画する。保存/同期/Undo/Outbox/結果状態/7→50→全件→7の動作は非変更。

保存後のmemo複製時は正規化自体が引き続き走るが、同じ行の大規模なReact再描画を避ける。全DOMを減らした修正ではない。

## 5 ブラウザ入力応答

同じin-app Chromium、visible 390×844 viewport、production React Native WebのPanel/FormTextInput/親ScrollView、20文字の実input event→次requestAnimationFrame。localhostの合成データのみで、Firebase SDK/自動保存/IME/実iPhoneは含まない。5,000件は負荷fixtureであり、実利用件数は調べていない。125件も比較用の合成条件である。

|条件|修正前p95 ms|最終修正後p95 ms|
|---|---:|---:|
|125件全表示・本文入力|9.1|1.3|
|5,000件全表示・本文入力|325.4|10.1|
|5,000件全表示・毎入力でmap/callback複製|318.7|18.9|
|5,000保存件数から7行へ縮小・複製あり|今回未計測|7.6|

ハーネス込みDOMは両版とも5,000行時20,026要素、修正後7行へ縮小時54要素。既存の20,004という値とは外側ハーネスの差である。描画省略で入力は改善したが、メモリ/大量DOM/展開自体のコストを解消したとはしない。

20サンプルの局所測定であり端末保証ではない。初回candidateでは5,000件p95=10.6ms/複製19.8msを観測、その後zone invalidation/同array fast path追加後に上表で再確認した。125件の初回candidate p95=11.2msも生ログに保持し、都合のよい結果だけを同一試験に上書きしない。hidden tab測定と背景展開のtimeoutは比較から除外した。

## 6 ページ表示と仮想化の比較

|案|効果|影響/判断|
|---|---|---|
|今回の計算/行描画分離|本文入力の大規模再描画を抑え、既存展開UXと全件到達を維持|小規模差分として再レビュー依頼。全件DOM/メモリは残る|
|50件単位で置換するページ表示|DOMを常に約50行に抑制|前後ページ/スクロール位置/「展開」の意味が変わる。別のUI仕様・受入判断が必要|
|仮想化|全件の連続閲覧感を維持し表示周辺だけ描画|既存EditorModal ScrollViewとの統合、行高/keyboard/アクセシビリティ/復帰位置を再設計。大規模変更として今回は実装しない|

今回の入力改善を確認できたため最小差分を採用した。実iPhoneでメモリ/全展開/scrollが問題なら、上記の別案を設計レビューへ戻す。

## 7 検証と引き継ぎ

既存#137/#138の表示・期限・Routine・バックアップ/合成同期回帰を維持する。追加試験は親入力/保存後複製、最新callback、同件数の状態変更、日跨ぎ、zone-contextのcache失効。performance試験は時間の閾値でPASSにせず不要描画/計算の回数を検証する。

最終全体は1,309 PASS、46既存skip（未実施）、167 files PASS/4 files skip。追加はperformance3件＋UI2件。性能回帰の修正前2 FAIL→修正後PASS、関連104件と性能/UI13件を確認した（重複を含むため合算しない）。TypeScript/Lint/diff check成功。固定commitでの最終Web exportはPRコメントへ記録する。

新性能差分は独立レビュー前でDEV配信の承認対象ではない。最終件数/型/Lint/build/commitはPRに記録する。実DEV確認/iPhone PWA/実Firebase2端末は未実施。旧skip取消制限とmissed未実装は#117に残す。

## 8 本人確認の準備

安全な配信先が準備できた段階で、対象SHAとURLを明示し、次を合成テストデータだけで確認する。

1. 毎日→毎週でも元の日次実績の日付が残る。
2. 本日生成未処理の-が一行で、完了/スキップが元対象日順に並ぶ。
3. 7→50→全件の展開、本文入力、スクロール、シート操作、縮小後の応答性。
4. 閲覧だけでは実績/Committed/History/Outboxを変更しない。

現公開DEV旧版へ本人を誘導しない。Production配信、main/releaseマージ、Issue Close、#117 gate/Rules/Functions/IAM/移行は実施していない。
