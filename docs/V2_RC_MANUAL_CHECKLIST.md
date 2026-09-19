# V2 release-candidate manual checklist

RC identity: `v2-rc-20260919`. Test only these three clients with the dedicated RC account:

- Windows PC: PWA RC
- iPhone: SafariでPWA RC（iOS native buildは今回の対象外）
- Android: EAS internal RC APK

## 1. Safety check（各端末）

- Settings → Cloud syncを開く。
- `DEV環境 · 本番データには接続しません` と `同期プロトコル: V2` を確認する。
- 表示が違う場合は直ちに中止する。production accountは使用しない。

## 2. 基本操作（いずれか1端末）

- CategoryとMemoを作成し、タイトル・本文・期限・所属・並び順を変更する。
- 完了 → 完了取消を行う。
- Routineを作成・編集・完了・完了取消する。
- Memoを削除し、ゴミ箱から復元する。
- 同期表示が処理中から同期済みに戻ることを確認する。

## 3. 端末間同期

- PC PWAで作成 → iPhone PWAで反映を確認。
- iPhone PWAで編集 → PC PWAで反映を確認。
- PWAで編集 → Androidで反映を確認。
- Androidで編集 → PWAで反映を確認。

## 4. Offline

- 1端末をofflineにし、Memoを編集する。
- onlineへ戻し、同期済みになることと他端末へ反映されることを確認する。

## 5. 必須 #45 回帰

1. 端末AでMemoを編集する。
2. Undoする。
3. 他端末への同期を待ち、同期済み後さらに5秒待つ。
4. Redoが有効なままであることを確認する。
5. Redoする。
6. 同期済み後さらに5秒待つ。
7. 変更後状態が全端末で維持され、勝手に戻らないことを確認する。

端末・OS・ブラウザ版、PASS/FAIL、失敗時の画面と操作順を記録する。完了報告まではIssue #45をOPENのままにする。
