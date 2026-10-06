# #59 共通フォーム DEV配信

2026-10-06。Issue #59最新コメントの共通フォーム方針に基づく。
URL: https://taskmemoapp-dev.web.app
Release: `issue59-form-20261006-1951`
Base commit: `dded687a72f462cddd1ebab41b701ad1fdab932c`（現在の未commit作業を含むためReleaseで識別）。

## 配信と確認

Firebase API GETでprojectId=taskmemoapp-dev / projectNumber=1045397314197を照合。
firebase.dev-rc.jsonのHosting siteとdistを確認し、明示的に
`--project taskmemoapp-dev --config firebase.dev-rc.json --only hosting --non-interactive` で配信。
Hosting upload/finalize/release成功。Functions/Rules/Auth/Firestoreは今回配信・変更していない。
production taskmemoapp-eabc3への操作なし。#59はOPEN。

公開HTMLが共通CSSを参照していること、公開JSとlocal distのSHA256一致、
公開JSに新Releaseが含まれること、公開CSS/診断HTMLがdistと一致することを確認。
Bundle: `entry-51f4879aaa834a79b6b0d23e82f81677.js`
SHA256: `6949f166d5ee2d1d9e1353d19f397bd5ac69e5ea125870b64774ccdc8ef8c110`
証跡はgitignored artifacts/private/form-typography-{tests,export,deploy}.log / form-typography-live.json。

## 変更

- 共通token: src/theme/formTypography.ts
- 最終style適用: src/components/FormTextInput.tsx
- 14 RN入力: index / DeadlineView / MemoRow / QuickTitleEditor / SyncAccountPanel / TextWorkspace
- DOM: DateField / DateTimeField / TimeField / diagnosticClipboard
- 独立HTML: public/form-typography.css、storage-diagnostics.html、app/+html.tsx
- 回帰: formTypography.test.ts、FormTextInput.render.test.tsx、SyncAccountPanel.input.test.ts、editorOpenFocus.test.ts
- renderテスト型定義のみ @types/react-dom ~19.2.0をdevDependencyへ追加（runtime変更なし）。
- Documentation: FORM_TYPOGRAPHY.md、TEXT_PHASE7_ACCEPTANCE.md、TESTING.md、本書。

## テスト結果

Focused 11 PASS。Full 832 PASS / 40 SKIP（116 PASS files / 4 SKIP files）。
TypeScript、lint（警告なし）、git diff --check、DEV Web export PASS。
既存skipは維持。Firebase Emulatorを今回新たに実行していない（UI typography変更）。

## 次の実機操作

Safariとstandalone PWAそれぞれで上記DEV URL / Releaseを設定のアプリ情報から確認。
新Releaseを確認できなければ再読込・終了/再起動し、違うoriginのPWAで試験しない。
ストレージ削除・PWA削除は不要。
FORM_TYPOGRAPHY.mdのiPhone受入を実施。自動zoomなし、主要ボタン、IME/caret/selection/copy、
keyboard scroll、editor折返し/横scroll、手動zoomを確認する。
実機結果は未確認。両モードPASS後にPhase 7残りの受入へ進む。
