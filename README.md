# TaskMemoApp

OneNoteで行っていたタスク・メモ管理を置き換えることを目的としたスマートフォンアプリ。

## Tech Stack

- React Native
- Expo
- TypeScript
- Firebase（予定）

## Target Platforms

- iOS
- Android

## Future Plans

- タスク管理
- メモ管理
- Firebase Authentication
- Cloud Firestoreによる複数端末同期
- 広告
- 広告非表示の買い切り課金
- プレミアム機能 / サブスクリプション
- App Store / Google Play公開

## Development Environment

- Windows
- VS Code
- Node.js
- Expo

## Getting Started

```powershell
npm install
npm start
```

起動後、ターミナルに表示される案内に従って Expo Go、Android Emulator、またはWebブラウザーで確認できます。

```powershell
npm run android
npm run web
```

Windows上でiOSネイティブビルドはできません。iPhone実機のExpo GoまたはEAS Buildを利用してください。

## Project Structure

- `src/app`: Expo Routerの画面とレイアウト
- `src/components`: 再利用可能なUIコンポーネント
- `src/features`: 機能単位のコード
- `src/services`: Firebaseなど外部サービスとの連携
- `src/models`: ドメインモデルと型
- `src/hooks`: 共通React Hooks
- `src/utils`: 汎用ユーティリティ
- `src/constants`: 共通定数
- `docs`: 設計・運用ドキュメント

## Environment Variables

ローカル設定は `.env.example` を `.env.local` にコピーして使用します。`.env` および `.env.*` はGit管理対象外です。クライアントから参照する値は `EXPO_PUBLIC_` 接頭辞が必要ですが、これは秘密を保護する仕組みではありません。秘密鍵や管理者用認証情報はアプリへ含めず、サーバー側で管理してください。

Firebase SDKとFirebaseプロジェクトへの接続はまだ追加していません。
