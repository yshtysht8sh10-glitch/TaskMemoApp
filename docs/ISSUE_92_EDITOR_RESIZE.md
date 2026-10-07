# Issue 92: Web text editor vertical resize (review revision)

Text Workspace編集入力はFormTextInput→React Native Web TextInput→textarea。
入力欄とは別に、下部の横ScrollViewでsyntax/changed-cell/errorを表示している。
入力欄へのoverlayや入力スクロールとの同期は実装されていない。

2026-10-07実機レビューで標準resizeは不採用。Web編集textareaは
resize: none / overflow: autoに変更し、常時scrollbarを除去する。
最終レビューに従い、常設メモと共通のresizeHandleAppearanceで
高さ20px・細い上境界線・12pxの控えめな↕のみ表示する。
常設メモのWeb表示styleも同じ関数を利用し、既存interactionは維持する。
Text Workspaceのbuttonは透明背景・borderなし、44pxの操作領域を
上下に12pxずつ広げる。可視の20px領域以外に説明文/パネル/grabberは表示しない。
accessibility labelとkeyboard操作は維持する。
EditorResizeHandle.web.tsxはPointer Eventsとcaptureでmouse/touchを処理する。
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
jsdomは実ブラウザgestureやIMEを実行できない。
PCブラウザでhandle drag、縦横スクロール、IME、iPhone Safari/PWAのレイアウトを
手動確認する。実機受入はユーザー確認待ち。

ユーザーの再実装・deploy指示に従ってDEV Hostingのみ配信する。
Production deploy/Issue Closeは行わない。
