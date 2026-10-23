# #99 DEV追試：ログインのパスワード欄がfocusを失う

対象報告：iPhone PWA、DEV c8b85a5。パスワードをタップすると一瞬画面が動き、キーボード入力できない。

## 原因と再現

共通`Sheet`のScrollViewがWebにも`keyboardDismissMode="on-drag"`を渡していた。
使用中のreact-native-web 0.21.0の`ScrollView._handleScroll`はこのモードで
**任意のscrollイベントからdismissKeyboard → focused input.blur()**を呼ぶ。
Safariのキーボード表示に伴う入力欄の自動revealや既存viewport補正もscrollを発生させ得るため、
タップ→focus→表示位置の補正→scroll→blur→キーボードが閉じる経路となる。
実機の全イベント時系列そのものは代理取得していないが、このblur経路は使用中のrendererで再現した。

修正前の本物の共通Sheetのprop式をASTから取得し、使用中のWeb ScrollViewへ渡す回帰テストが
想定どおりblurを検出してFAIL。scroll位置0・18・136で確認した。テストは別のpolicyを複製していない。

## 他の調査対象

- SyncAccountPanelはmodule scopeの同じコンポーネント。認証前のpassword欄に動的keyはない。
  実React DOMテストで入力、初期化状態／同期状態の再描画後も同じinput・focus・入力値を保持し、blurがないことを確認した。
- #99で追加したpointerEventsはメイン一覧のViewに限定され、ログインSheetの祖先ではない。
  scope変更時のリセットにもsyncOpenは含まれない。入力そのものはNode編集guardを通らない。
- 配信中c8b85a5のブラウザでpassword inputはtype=password、disabled=false、font-size=16px、
  祖先のpointer-eventsはauto、タップ後activeElementが当該inputになることを確認。
  iPhoneキーボードのないデスクトップでは報告のキーボード開閉自体を実機再現したとは扱わない。
- #99前の親commitにも共通Sheetの同じon-drag指定がある。#99がこの指定を導入した回帰ではない。
  通常メモEditorには既に同じrenderer挙動への対策があり、共通Sheetのみ未適用だった。
- viewport高さの変化はSheetの再描画を起こし得るが、同一type／同一keyのフォームを再マウントする条件ではない。
  今回はviewport補正・透明backdrop・認証・ローディングの挙動を変更しない。

## 最小修正と検証

共通Sheetも既存`editorKeyboardDismissMode(Platform.OS)`を使う。
Webはnone、iOS Nativeはinteractive、Android Nativeはon-drag。
Webの自動scrollでblurさせず、Nativeの既存policyを維持する。
SyncAccountPanelのtheme importは既存のcomponentテストと同じrelative pathに揃え、直接mountしてfocusを検証可能にした。参照先・実行動作は同一。

- 共通Sheetの実prop＋インストール済みWeb renderer：修正前FAIL→修正後PASS。
- 実SyncAccountPanel＋FormTextInput：入力／状態変更時のinput identity、focus、値、16px、Auth呼出なしを確認。
- 既存Editor scroll、viewport/keyboard補正、form typography、#99初期化の関連テストを実行。
- 全体テスト、TypeScript、lint、Functions検査、git diff --check、DEV設定Web exportを実行。確定件数・SHA・配信結果はIssueへ記録。
- 認証処理・Node・IndexedDB・Firebase同期・History/Outboxの変更なし。Production配信なし。

## iPhoneでの再確認

1. DEV https://taskmemoapp-dev.web.app/ を再読込し、Issueコメントの新SHAを確認する。サイトデータは削除しない。
2. 設定→クラウド同期で、メール欄を経由せずパスワード欄を直接タップし、キーボードが保持され入力できるか確認する。
3. メール欄→パスワード欄を往復し、入力途中の文字とfocusが保持されるか確認する。
4. キーボード表示中のフォームscroll、キーボードを閉じる→再タップ、画面回転、PWA終了→起動で再確認する。
5. 必要ならDEVテストアカウントでログインして#99の起動表示も確認する。

未解消の場合は既存の`?keyboardDiagnostics=1`によるfocusout／scroll／visualViewport診断で実機の別経路を確認する。
診断は入力値・パスワードを記録しない。iPhoneでの確認結果まで#99はOpenを維持し、#101には進まない。
