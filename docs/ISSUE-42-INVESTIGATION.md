# Issue #42 再調査（2026-09-17）

## 結論と訂正

iPhone Safariの根本原因は未確定。今回、スクロール／focus／CSSの動作修正はしていない。
調査開始時HEADは9a01210、未コミット差分なし。#41/#42本文と全コメント、
3189d0c、d02fc2a、b5b61d4、9a01210、およびインストール済みRN Web実装を確認した。

過去コメントの「原因をコードで確認」「修正前FAILでSafariを再現」は訂正する。
b5b61d4のテストは数値から余白と目標scrollTopを返す関数だけを呼ぶ。
9a01210のinputBoundsAfterRevealも実際のgetBoundingClientRectではなく、
予測座標から要求scroll量を引いた値である。DOM、一覧、focus、イベント、OS keyboardを実行していない。
関数不在でのFAILは新API未実装の証拠であり、旧動作が実機条件で失敗する証拠ではない。

## 履歴の評価

- 3189d0c: focus/viewportイベントからrAFと80/280ms timerで祖先scrollを補正。
  modalにはvisualViewport高さを適用していた。初期のmodal collapseと今回の一覧inline編集は別経路。
- d02fc2a: modal高さ指定撤去、viewport正規化、80pxの縮小判定、内部scroll復元を追加。
- b5b61d4: 余白不足説は可能性として成立するが、実機の最大scroll量・実適用量の証拠なし。
  paddingをscroll要素自体へ加えたときscrollHeight/clientHeightがどう変化するかもテストしていない。
- 9a01210: ページ移動説も未証明。ヘッダーの見え方だけではwindow.scrollY、
  visualViewport.offsetTop、拡大率、レイアウト変化を区別できない。
  b5b61d4にはページ復元処理がないため「復元後に座標が無効になる」がその版の根本原因という説明は成立しない。
  ページ復元処理自体は9a01210で新たに導入した動作。

## コードから絞った候補（実機証拠待ち）

1. 補正未実行: shouldRevealFocusedInputは同時点のmax(innerHeight, clientHeight)と
   正規化visualViewport高さとの差80pxで判定。両者が縮む／正規化が値を捨てる／activeElementが変わるとreturnする。
   旧ログはreturnより後なので、補正が走らない理由を観測できない。
2. 座標・対象の不一致: 最初のoverflowY=auto/scroll祖先を採用するが、実scroll可能性は調べない。
   一覧WebはDraggableFlatListでなくWebSortableScrollList→RN Web ScrollView。
   RN Web ScrollViewにはtranslateZ(0)、flexShrink:1、overflowY:autoがある。
   input/cardがどの祖先でclipされるか、外側paddingが実scroll余地を増やすかは実測が必要。
3. 後からの移動: window.scrollTo、padding変更、scrollTop代入、二回目計測は同じ同期関数内。
   非同期レイアウト／Safariの後続移動を保証しない。resize/scrollのたびrAFとtimerを再予約し、
   keyboard判定falseなら元scrollへ戻すため、アニメーション中の判定変動も観測する必要がある。
4. ズーム・パン: タイトルinputはstyles.titleでfontSize:15。+htmlのinput{font-size:16px}と
   RN生成classの優先順位を含めcomputed fontSizeを確認する。拡大が実際に発生するかは未確定。
   現行計算はscale/width/pageTopを扱わず、旧テストもscale=1相当の固定数値のみ。
5. baseline: pointerdownを全要素で捕捉し次focusまで保存する。キーボード内の移動や
   再focusでは別操作由来baselineを利用し得る。時刻と要素identityで確認する。

## 診断版

?keyboardDiagnostics=1 の時だけ追加観測。スクロール処理・フォーカス処理は変更しない。
window.taskMemoKeyboardDiagnostics.export() でJSONを取得できる。
ログはメモリ内の直近1200件。タイトル・本文・入力値・アカウント情報・DOM idは追加JSONへ保存しない。
要素はWeakMapの番号で同一性を追う。ブラウザ情報はexport時にuserAgentを付与する。
既存consoleログは従来どおり残る。

- pointerdown / focusin / focusout / document・window scroll / window resize / visualViewport resize・scroll
- 補正試行（returnより前）、補正直後、focus後rAFおよび80/280/600/1200/2000ms
- input/card/選択container/root/body/html/scrollingElementの矩形・scroll値
- 全input祖先のoverflow、position、transform、font-size、padding、box-sizing、flex、scroll-behavior
- raw visualViewport height/width/offset/pageTop/scaleと正規化後の値、判定結果
- 要求scroll量・実適用量、元inputが接続されているか・focusが残っているか

visualViewport下端はOSキーボードの実測値ではない。旧ログのkeyboardTopという名前を根拠に
本当のキーボード上端と断定しない。見える条件は下端だけでなく、上端、横方向、祖先clip、後続移動も含む。

## iPhoneでの次の観測手順

公開済み診断版を利用する。コピーUIの更新版ではJSON version 3とexport時刻を付与する。

1. Safariで診断版URLへ ?keyboardDiagnostics=1 を付けて開く。
2. 一覧「明日」の下部対象Memoを表示し、タイトルを一度タップする。
3. keyboard表示後、手でscrollせず3秒待つ。症状の有無を記録する。
4. 画面右上の「診断ログをコピー」をタップし、成功表示を確認してChatGPTへそのままペーストする。
   ファイルはダウンロードしない。Web Inspectorでは従来のwindow.taskMemoKeyboardDiagnostics.export()も利用可能。
   キーボードを閉じる前のログもメモリに残るので、閉じてから取得してもよい。再読込はしない。
5. iOS/Safari版、縦横、表示倍率、通常Safari/PWAを添える。

コピーはタップ内から直接Clipboard APIを呼ぶ。失敗時は再タップする。
HTTPSのSafariで利用する。非対応環境では失敗を表示し、入力欄をfocusするfallbackは行わない
（診断対象のfocus・選択・keyboard状態を変えないため）。必要なら従来のconsole exportを利用する。
診断パラメータがない／値が1以外の画面ではUIを生成しない。
新規テストはコピー開始の同期性、export全文の受渡し、表示条件、成功・失敗・再試行、cleanupを検証する。
イベント/DOMアダプタのテストであり、iPhoneの実clipboard権限・タップ・keyboardは保証しない。
追加observerにも測定負荷はあるため、診断ON/OFFで症状が変わる場合はその事実も記録する。

## ログからの判断

- attemptがない／correctionAllowed=false: focus・イベント・高さ判定を調査。
- 要求量あり・実適用量なし: 選択containerと余白/クランプを調査。
- 適用量あり・inputが動かない: 対象/transform/clipを調査。
- 直後は可視・600ms以降に不可視: viewport/scroll時系列から後続移動を特定。
- scale/widthが変化: focus zoom/panとkeyboard縮小を分離。

今回はSafari実機条件の再現FAILを取得できていない。既存算術テストのPASSは修正証拠にしない。
実機ログを固定fixtureにしてから、hookイベントとDOM計測を通る回帰テストを作る。

## 2026-09-18 診断コピーUI

- `?keyboardDiagnostics=1`限定で44px以上のコピーボタンを追加。タップ時に既存exportを呼び、
  同じイベント内でClipboard APIへJSON全文を渡す。成功・失敗を画面表示する。
- version 3はtimestampとexport時の座標スナップショットを追加。既存イベントと匿名要素情報を維持。
  Memo本文・タイトル・認証情報をJSONへ追加しない。ダウンロードは行わない。
- focused: コピーUI/clipboardと既存可視化計算の22 tests PASS。全体: 26 files / 185 tests PASS。
  TypeScript、Lint、git diff --check、Web production exportを確認。
- iPhoneのコピー権限、タッチからの実コピー、キーボード表示中のボタン到達性は実機確認待ち。
  #42のkeyboard回避ロジックは変更しておらず、解決の根拠にはしない。IssueはOPENを維持する。
