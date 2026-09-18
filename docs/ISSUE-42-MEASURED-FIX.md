# #42 実測ログに基づくviewport判定修正（2026-09-18）

## 確認できた原因

入力資料: ユーザー提供log.txt、JSON version 3、timestamp 2026-09-17T22:52:57.048Z。
userAgentはiPhone版Brave。Safari本体で同一挙動とまでは断定しない。
生ログはリポジトリへ複製せず、必要な数値とイベント順序をhookテストへ固定した。

| 項目 | focus直後 seq130 | resize後 seq137 | 安定後 seq159/165 |
| --- | ---: | ---: | ---: |
| innerHeight | 674 | 365 | 365 |
| documentElement.clientHeight | 674 | 390 | 390 |
| visualViewport.height | 674 | 365 | 365 |
| visualViewport.offsetTop | 0 | 0 | 25 |
| scale | 1 | 1.0671641826629639 | 同左 |
| window.scrollY | 0 | 25 | 25 |
| 一覧scrollTop | 499 | 499 | 499 |
| 一覧clientHeight | 530 | 246 | 246 |
| 一覧scrollHeight | 5885 | 5885 | 5885 |
| input.bottom | 639.328125 | 約607.76（遷移中） | 614.328125 |

旧判定はmax(365,390)-365=25<80となり、補正を許可しない。
ログでも3回のcorrection-attemptがすべて早期return、補正結果のイベントはない。
一覧の追加scroll余地は5885-246-499=5140pxあり、今回の原因は末尾余白不足ではない。

## 修正前FAILの証拠

基準commit: 61f871d。製品コードを変える前にuseWebKeyboardVisibility.test.tsを追加。
ReactのuseEffect登録とブラウザのDOM/レイアウト境界だけをアダプタ化し、実hookを呼ぶ。
pointerdown → card focus → input focus → resize → viewport scroll → rAF/80/280msを実行する。
scrollTop代入は範囲でclampし、getBoundingClientRectは現在のwindow/list scrollから再計測する。
期待値の算出に製品のreveal plan関数を呼ばない。

最初の結果: 3 tests中2 FAIL / 1 PASS。

- 実測再現: `expected 499 to be greater than 499`。一覧が全くscrollしない。
- 残差補正: `expected 0 to be greater than or equal to 2`。scroll書込み自体がない。
- keyboardなしのPC focus: PASS。

これらは関数未定義やimport失敗によるFAILではない。
ただし実ブラウザのレイアウトエンジン／OS keyboardを起動したテストでもない。
実測値から作る座標アダプタを使ったhook integration testであり、実機保証とは区別する。

## 修正内容

1. 初期／focus前のviewport基準を保持。layout viewportまで縮む場合も基準を失わない。
   80px閾値は維持し、ブラウザ名による分岐はしない。
2. scaleを掛けた高さで比較し、ズームだけによるvisual viewport縮小をkeyboard扱いしない。
   実測条件では674-(365*1.067164...)=約284.5pxの縮小として検出する。
3. 編集中の小刻みなresizeでは基準を更新しない。入力欄を切り替えてもkeyboard中は基準を保持。
   keyboard終了、非編集中、layout幅変更時に再取得。異常heightの一時値では復元しない。
4. ページscrollをfocus前の位置へ戻した後にinputと一覧を取得する。
   旧hookの「ページ復元前の座標から復元後座標を予測する」経路は使用しない。
5. visual viewportと一覧の矩形の共通部分へ、上下16pxの余白を含めて内部scrollする。
   直後に再計測して残差を補正。既存80/280ms timerでも再計測する。
6. 診断JSON version 4に基準高さ・縮小量・判定理由・skip理由を追加。
   before-correction / before-residual-correction / correction-immediate-resultに
   要求量・実適用量・残差・実表示領域・inputFullyVisibleを記録する。
   window復元前後も区別する。既存export・コピーUI・匿名ログを維持する。

## 過去処理の整理

- b5b61d4の下部余白: 今回は不要で、実測fixtureでも追加しないことを検証。
  真の末尾不足ケース用として残し、必要時だけ追加／keyboard終了時に除去する別テストを追加。
- 9a01210のページ復元: 実測で25px移動しているため維持。ただしinputの座標予測ではなく復元後の再計測を使う。
- 旧shouldRevealFocusedInputをrAF/timerと補正関数で二重適用していた入口: 単一のrunCorrectionへ集約。
- 従来のpure helperテストは削除しない。予測座標helperのPASSをhookや実機の成功証拠にはしない。

## テスト範囲と限界

実測fixtureではscrollTopが499から789.328125となり、input.bottomは349。
最初のresizeはoffsetTop=0なので表示下端365から16px余白を取る。
後続offsetTop=25時点ではすでに可視であり、不必要な追加移動をしない。
window.scrollToは25→0の復元1回だけ。下部余白の追加はなし。

追加hookテスト: 実測再現、即時残差、細かな連続resize、layoutを縮めない環境、keyboard終了復元、
zoom単独、入力切替、異常viewport一時値、診断skip/zero/appliedの区別・入力値非記録、
真の末尾余白と除去、遅延レイアウト再計測、既に可視なら不動、内部containerなしなら不動、cleanup。

補足: 追加した数値assertionの初稿は最終offsetTop=25だけからscrollTop=764.328125と予測していた。
実際のfixture順では先にoffsetTop=0で補正するため789.328125が正しい。期待値をこの順序に訂正。
遅延レイアウトテストも「一覧下端」だけでなく「一覧とvisual viewportの小さい方」が可視下端となるよう訂正。
既存テストの削除・skip・弱体化はしていない。

約1.067倍への変化を無関係と断定しない。判定ではscaleを考慮し、補正後も矩形を再計測するが、
実際のズーム／自動pan／遅延レイアウトの全組合せはこのアダプタで保証できない。
回転時は幅変更で基準を更新するため、keyboardを開いたままの回転も追加実機確認事項とする。

## 実機確認（OPEN維持）

最終検証: focused 4 files / 43 tests、全体27 files / 202 tests、TypeScript、Lint、
git diff --check、Web production export。Functionsの実装変更はなく追加のFunctions専用検証は対象外。
独立した61f871dベースの作業ツリーで検証・exportし、他作業の未コミット変更を公開物へ混ぜない。

まずiPhone Brave、次に必要に応じSafari本体で、一覧下部Memoのタイトル編集を確認する。
keyboard後にinput全体が見える／ページが不自然に跳ばない／一覧が必要量だけ動くことを確認。
診断ON時は3秒待ってコピーし、version 4のJSONを取得する。
補正skip理由、actualOffset、remainingOffset、inputFullyVisibleと遅延probeの座標を比較する。
Issueは実機確認までcloseしない。
