# Issue 92: Web text editor vertical resize (review revision)

Text Workspace編集入力はFormTextInput→React Native Web TextInput→textarea。
入力欄とは別に、下部の横ScrollViewでsyntax/changed-cell/errorを表示している。
入力欄へのoverlayや入力スクロールとの同期は実装されていない。

2026-10-07実機レビューで標準resizeは不採用。Web編集textareaは
resize: none / overflow: autoに変更し、常時scrollbarを除去する。
第3回レビューに従い、両方でVerticalResizeHandle.web.tsxそのものを利用する。
style共有だけのresizeHandleAppearanceは削除。常設メモ由来の高さ20px・細い
上境界線・12pxの控えめな↕、中央位置、背景、余白、cursor、opacity、
同一system font、44px操作領域を単一component内で定義する。
Text Workspace adapterにはstyle/文字/glyphもpointer処理も置かない。
同じcomponentがmouse/touch/capture/keyboardを処理する。
可視20px以外の操作領域は上下12pxずつ広げ、両方で同じにする。
accessibility labelとkeyboard操作は維持する。
VerticalResizeHandle.web.tsxはPointer Eventsとcaptureでmouse/touchを処理する。
touch-action: noneはhandleだけに適用する。pointerdownのdefaultを防ぎ、
editorのfocusや選択を取り直さない。pointerup/cancel/lost captureで終了する。
副pointer/非primary/右クリック、busy/dialog中の操作は開始しない。
keyboard ArrowUp/Downで40px、Homeで最小高さに戻せる。
既存minHeight 260pxを維持し、height/maxHeightを制御しない。
高さはDOM styleで保持し、React state/textarea valueに手を入れない。
Text Viewとnative入力は変更しない。共通FormTextInputのWeb 16px最小値も維持。
parser/save/History仕様は変更しない。

TextWorkspace.spec.test.tsxのIssue 92テストでWeb style、min-height/上限なし、
validation再描画後の同じtextarea/content/focus/caret/選択範囲/ユーザー高さ維持、
native style非変更を確認。EditorResizeHandle.web.test.tsxではmouse/touch両方の
pointer、capture、最小高さ、大幅拡張、cancel、他pointer、busy、keyboardと
content/focus/caret/selection/scrollLeft維持を確認する。
両呼び出しでbutton styleとinnerHTMLが完全一致すること、adapterにstyle/glyphが
ないことを検証。常設メモは既存の72–280px clamp、RAF更新・完了時の高さ保存を
維持し、Text Workspaceは260px以上でDOM高さを管理する。
jsdomは実ブラウザgestureやIMEを実行できない。
PCブラウザでhandle drag、縦横スクロール、IME、iPhone Safari/PWAのレイアウトを
手動確認する。実機受入はユーザー確認待ち。

ユーザーの再実装・deploy指示に従ってDEV Hostingのみ配信する。
Production deploy/Issue Closeは行わない。
