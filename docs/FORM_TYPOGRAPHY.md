# 共通フォームtypography（#59 / #85）

Webのフォーカス可能な文字入力は最低16px。16px以上の指定は維持する。
`src/theme/formTypography.ts` が共通定義、`FormTextInput` がReact Native Webの適用境界。
呼出側styleをflattenした後、Webだけ末尾でfontSizeをclampする。Nativeはstyle自体を保持する。
ref、入力イベント、IME、selection、autoFocus、read-only等は元のTextInputへ渡す。

対象: タイトル/本文/Category/Routine interval、常設メモ、Quick Add、inline edit、
ログインemail/password、テキスト編集・選択可能なText View（計14入力）。
Date/TimeのDOM入力はwebFormTypography、コピー診断textareaは共通minimum tokenを使う。
独立storage-diagnostics.htmlとアプリHTMLはpublic/form-typography.cssを共有する。
ラベル、通常表示、構文ハイライト、file input、Native pickerは対象外。

## 新しいフォーム

RNの入力にはFormTextInputを使用する。WebでもPlatform.OSはwebでありios判定にしない。
DOM入力のinline styleはwebFormTypographyを最後に適用する。
contenteditableを追加する際もCSSを読み込み、独自font-sizeを直接上書きせず、
大きいサイズには--taskmemo-form-font-sizeを指定する（CSSのmaxで16px以上）。
CSS単独で任意のinline font-sizeを防げるわけではないため、独自小文字styleは禁止。
CSSの16pxとTS tokenの一致は回帰テスト対象。zoom禁止、transform縮小は使用しない。
手動zoom、OSの文字サイズ、Nativeの元サイズは維持する。

## 検証

回帰先行: TextWorkspaceが共通入力を使わない状態でテストが失敗することを確認。
既存#85テストは16px以上と2つのアカウント入力を検証したまま、共有コンポーネント名へ更新。
pure clamp、14入力とdate/timeの網羅、caller override、larger size、Native style identity、
ref/events/value/read-onlyの受渡し、診断CSSとviewportを検証する。
renderテストのRNモックはprops境界のみを検証し、WebKitのフォーカスzoomやIMEは実機確認が必要。

## iPhone受入（Safariとstandalone PWA双方）

DEV URLとアプリ情報のReleaseを確認。古いReleaseなら再読込/終了して再起動し、
データ削除やPWA再追加は不要。新Releaseを確認できなければ試験を止める。

1. ログインemail/password、通常タイトル/本文/Routine、常設メモ、Quick Add、inline edit、日付/時刻をフォーカスする。
2. 一覧/ツリーのテキスト編集とText View、ストレージ診断の選択欄も確認する。
3. フォーカスで倍率が変わらないこと、保存/破棄ボタン、keyboard表示中scrollを確認する。
4. 日本語IME、caret移動、selection/copy、長行折返し/横scroll/表示行数を確認する。
5. 手動pinch zoomが可能なこと、Light/Dark表示を確認する。

実機PASSがPhase 7の残りの受入へ進む条件。自動テストのみで実機PASSとはしない。

既存editorOpenFocus回帰テストも入力名をFormTextInputへ変更し、
全Editor入力でautoFocusを要求しない元の安全条件を保持する。
