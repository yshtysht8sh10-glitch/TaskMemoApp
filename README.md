# TaskMemoApp

OneNoteで行っていたタスク・メモ管理を置き換えることを目的としたスマートフォンアプリ。

## Tech Stack

- React Native
- Expo
- TypeScript
- Firebase Authentication / Cloud Firestore

## Target Platforms

- iOS
- Android

## Future Plans

- タスク管理
- メモ管理
- 設定項目の端末間同期
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

## Web / PWA

開発サーバーは `npm run web`、配布用の静的ファイルは `npm run web:export` で生成します。成果物は `dist` に出力され、HTTPS対応の静的ホスティングへそのまま配置できます。データはブラウザ内に保存されるため、ブラウザのサイトデータを消す前や端末移行前には「設定 > データを書き出す」でバックアップしてください。

iPhoneでは公開先をSafariで開き、共有ボタンから「ホーム画面に追加」を選択します。追加後はホーム画面の `TaskMemo` アイコンからstandalone表示で起動できます。初回表示後はアプリ本体がキャッシュされ、オフラインでも再起動できます（更新反映には再読み込みが必要な場合があります）。Safariとホーム画面版は同じ公開URLを使い、プライベートブラウズは日常データの保存先として使用しないでください。

Web版では短冊を上下にスワイプしてスクロールします。MemoやCategoryを移動するときは、短冊を少し長めに押してつかみ、そのまま移動先までドラッグしてください。

実機確認では、縦向きの狭い画面で以下を確認してください。

- Memo/Categoryの作成・編集・完了・移動・削除・復元
- 期限一覧とツリーのスクロール、長押しドラッグ
- 入力中のキーボード表示と、保存/キャンセルボタンへの到達
- 設定変更、JSONバックアップの書き出し/読み込み
- Safari再読み込み、ホーム画面版の終了・再起動後のデータ保持
- 機内モードでホーム画面版を再起動できること

## iPhone単体で使う（EAS Build）

`preview` はJavaScriptをアプリに同梱する内部配布ビルドです。Expo GoやMetroを起動せずに、登録済みのiPhone単体で利用できます。`development` は開発クライアント用であり、通常の開発時はMetroへ接続します。

初回のみ、Expoアカウントへのログイン、EASプロジェクトの作成、iPhoneのUDID登録を行います。

```powershell
npx eas-cli@latest login
npx eas-cli@latest init
npx eas-cli@latest device:create
npx eas-cli@latest build --platform ios --profile preview
```

Apple Developer Programへ加入したApple Accountが必要です。初回ビルド時はEAS CLIの案内に従ってApple Accountへログインし、Distribution CertificateとAd Hoc Provisioning ProfileをEASに自動管理させます。ビルド完了後、EASのビルドページをiPhoneで開き、Installからインストールしてください。iOS 16以降では、インストール後に「設定 > プライバシーとセキュリティ > デベロッパモード」を有効にする必要があります。

新しいiPhoneを追加した場合は `device:create` 後に再度 `preview` をビルドしてください。既存ビルドを再署名する場合は `npx eas-cli@latest build:resign` も利用できます。

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

詳細なドメイン仕様は [TaskMemo 設計書](docs/DESIGN.md) を参照してください。

## Environment Variables

ローカル設定は `.env.example` を `.env.local` にコピーして使用します。`.env` および `.env.*` はGit管理対象外です。クライアントから参照する値は `EXPO_PUBLIC_` 接頭辞が必要ですが、これは秘密を保護する仕組みではありません。秘密鍵や管理者用認証情報はアプリへ含めず、サーバー側で管理してください。

## Firebase同期

Web/Android/iOSで同じメールアドレスとパスワードを使うと、MemoとCategory（作成、編集、完了、削除、復元、移動、並び順）がリアルタイム同期されます。未ログイン時や通信不能時も端末内保存を継続します。設定画面の「クラウド同期」から新規登録またはログインしてください。

初回ログインではローカルとクラウドをNode単位でマージします。同じIDは `updatedAt` が新しい側を採用し、片方だけに存在するNodeは保持するため、既存ローカルデータを一括上書きしません。通常削除は `deletedAt` を含むNodeとして同期され、完全削除も他端末へ伝播します。現段階ではテーマなどのアプリ設定は端末ごとに保持します。

### Firebaseプロジェクトの準備

1. Firebase ConsoleでプロジェクトとWebアプリを作成する。
2. Authenticationの「Sign-in method」で「メール/パスワード」を有効にする。
3. Cloud Firestoreを作成する（本番モードを推奨）。
4. `.env.example` を `.env.local` にコピーし、Webアプリ設定の値を入力する。
5. Firebase CLIでログインして対象プロジェクトを選び、ルールを配布する。

```powershell
Copy-Item .env.example .env.local
npx firebase-tools login
npx firebase-tools use --add
npx firebase-tools deploy --only firestore:rules
```

`firestore.rules` は `users/{uid}` 以下を本人だけが読み書きできる構成です。FirebaseのWeb設定値は公開識別子であり、アクセス制御はSecurity Rulesで行います。サービスアカウント鍵などの秘密情報は `.env.local` にも入れないでください。

### 利用量と運用

同期対象はNodeのみで、各Nodeを個別ドキュメントとして差分書き込みします。画面を開いている間はログインユーザーのNodeコレクションにリスナーを1本だけ張ります。想定外の課金を避けるため、Firebase Consoleで予算アラートとFirestore使用量を確認し、不要なテストアカウントや大量データを放置しないでください。

### 端末間テスト

1. Webでアカウントを新規登録し、MemoとCategoryを作成する。
2. Xperiaで同じアカウントへログインし、作成内容と並び順を確認する。
3. Xperiaで編集・完了・移動し、Webへ反映されることを確認する。
4. Webで削除・復元・完全削除し、Xperiaへ反映されることを確認する。
5. 一方をオフラインにして編集し、再接続後に同期されることを確認する。
6. 別アカウントでログインし、他ユーザーのデータが見えないことを確認する。
