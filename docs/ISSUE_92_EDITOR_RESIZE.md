# Issue 92: Web text editor vertical resize

Text Workspace編集入力はFormTextInput→React Native Web TextInput→textarea。
入力欄とは別に、下部の横ScrollViewでsyntax/changed-cell/errorを表示している。
入力欄へのoverlayや入力スクロールとの同期は実装されていない。

Webの編集textareaのみresize: vertical / overflow: scrollを指定する。
既存minHeight 260pxを維持し、height/maxHeightを制御しない。
ブラウザ標準の右下handleが提供される環境では縦方向へ拡張・縮小できる。
高さはブラウザが保持し、React state/独自pointer/touch処理を追加しない。
Text Viewとnative入力は変更しない。共通FormTextInputのWeb 16px最小値も維持。
parser/save/History仕様は変更しない。

TextWorkspace.spec.test.tsxのIssue 92テストでWeb style、min-height/上限なし、
validation再描画後の同じtextarea/content/focus/caret/選択範囲/ユーザー高さ維持、
native style非変更を確認。jsdomはブラウザresize gestureやIMEを実行できない。
PCブラウザでhandle drag、縦横スクロール、IME、iPhone Safari/PWAのレイアウトを
手動確認する。標準resize handleの提供・操作方法はブラウザ依存であり、
未提供環境のための独自UIは今回の範囲に含めない。

deploy/Issue Closeは行わない。
