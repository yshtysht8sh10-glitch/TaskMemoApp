# TaskMemoApp

外部AI向けRemote MCPの構成とローカル検証方法は [docs/external-ai-mcp.md](docs/external-ai-mcp.md) を参照してください。

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

## 起動・ビルド手順早見表

コマンドはすべて、このREADMEがある `TaskMemoApp` ディレクトリで実行します。Firebase同期を使う場合は、先に後述の手順で `.env.local` を設定してください。

### 初回準備

```powershell
npm install
npx eas-cli@latest login
```

EAS Buildを初めて使う場合は、続けてプロジェクトを初期設定します。

```powershell
npx eas-cli@latest init
```

### PCブラウザーでWeb版をデバッグする

```powershell
npm run web
```

ブラウザーが自動的に開きます。`w` キーでWeb版を開く操作は、PCで `npm start` を実行しているターミナル上の操作です。

### XperiaでExpo Goを使ってデバッグする

PCとXperiaを同じWi-Fiへ接続し、PCで次を実行します。

```powershell
npm start
```

XperiaでExpo Goを起動し、表示されたQRコードを読み取ります。接続できない場合は、PCのファイアウォール設定を確認するか、トンネル接続を使用します。

```powershell
npx expo start --tunnel
```

この方法は開発用なので、利用中はPCと開発サーバーが必要です。

### Xperiaの日常利用版APKを作る

```powershell
npx eas-cli@latest build --platform android --profile preview
```

ビルド完了後、表示されたURLをXperiaで開いてAPKをダウンロードし、インストールします。`preview` はJavaScriptをアプリ内に含むため、インストール後はPCやMetroを起動しなくても使用できます。Androidから警告された場合は、ダウンロードに使ったブラウザーに対して「不明なアプリのインストール」を一時的に許可します。

### Android開発クライアントを作る

```powershell
npx eas-cli@latest build --platform android --profile development
```

完成した開発クライアントをXperiaへインストールした後、PCでMetroを起動します。

```powershell
npx expo start --dev-client
```

これはネイティブ機能を含むデバッグ向けです。日常利用には `preview` を使用してください。

### iPhone Safari/PWAの日常利用版を作る

```powershell
npm run web:export
```

公開用ファイルが `dist` に生成されます。Firebase HostingなどのHTTPS対応ホスティングへ公開し、iPhone Safariで公開URLを開きます。その後、Safariの共有ボタンから「ホーム画面に追加」を選びます。ローカル開発サーバーのURLは日常利用には適しません。

Firebase Hostingを設定済みの場合の公開コマンドは次のとおりです。

```powershell
npx firebase-tools deploy --only hosting
```

### iPhoneのインストール型日常利用版を作る

初回または新しいiPhoneを追加するときは、端末を登録します。

```powershell
npx eas-cli@latest device:create
```

続いて内部配布ビルドを作成します。

```powershell
npx eas-cli@latest build --platform ios --profile preview
```

Apple Developer Programへの加入が必要です。ビルド完了後、EASのURLをiPhoneで開いてインストールします。

### コード変更後の確認

```powershell
npm test
npx tsc --noEmit
npm run lint
npm run web:export
npx expo-doctor
```

| 目的 | コマンド | PC/Metro |
| --- | --- | --- |
| PCでWebデバッグ | `npm run web` | 必要 |
| XperiaでExpo Goデバッグ | `npm start` | 必要 |
| Xperiaの日常利用APK | `npx eas-cli@latest build --platform android --profile preview` | インストール後は不要 |
| Android開発クライアント | `npx eas-cli@latest build --platform android --profile development` | 実行時に必要 |
| iPhone Safari/PWA | `npm run web:export` → HTTPSで公開 | 公開後は不要 |
| iPhoneインストール版 | `npx eas-cli@latest build --platform ios --profile preview` | インストール後は不要 |

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

### 全体の流れ

初回だけ次の順序で設定します。

1. FirebaseプロジェクトとWebアプリを作る。
2. メール/パスワード認証とCloud Firestoreを有効にする。
3. Firebaseの6個の接続値を取得する。
4. PCの `.env.local` とEASの `preview` 環境へ同じ値を登録する。
5. Firestore Security Rulesを配布する。
6. Web/PWAを公開し、Android APKをビルドする。
7. iPhoneとXperiaで同じTaskMemoアカウントへログインする。

Firebase JS SDKを共通利用しているため、Android用の `google-services.json` はこの構成では不要です。

### 1. Firebaseプロジェクトを作る

1. [Firebase Console](https://console.firebase.google.com/)で「プロジェクトを追加」を選ぶ。
2. プロジェクト内の「アプリを追加」からWebアイコン `</>` を選ぶ。
3. アプリ名に `TaskMemoApp` などを入力して登録する。
4. 表示された `firebaseConfig` を手元に控える。

必要なのは次の対応関係です。

| Firebaseの項目 | TaskMemoの環境変数 |
| --- | --- |
| `apiKey` | `EXPO_PUBLIC_FIREBASE_API_KEY` |
| `authDomain` | `EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN` |
| `projectId` | `EXPO_PUBLIC_FIREBASE_PROJECT_ID` |
| `storageBucket` | `EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET` |
| `messagingSenderId` | `EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` |
| `appId` | `EXPO_PUBLIC_FIREBASE_APP_ID` |

これらはクライアントアプリへ埋め込まれる公開設定値です。サービスアカウント秘密鍵などは使用しません。

### 2. AuthenticationとFirestoreを有効にする

Firebase Consoleで次を設定します。

1. 「Authentication」→「始める」→「Sign-in method」を開く。
2. 「メール/パスワード」を有効にして保存する。
3. 「Firestore Database」→「データベースの作成」を選ぶ。
4. 利用者に近いリージョンを選び、本番モードで作成する。

Web公開後は「Authentication」→「Settings」→「Authorized domains」を開き、実際に使用するHostingドメインが登録されていることも確認します。

### 3. PCへFirebase設定を入れる

テンプレートをコピーします。

```powershell
Copy-Item .env.example .env.local
```

`.env.local` を開き、手順1で控えた値を入力します。値を囲む引用符は不要です。

```dotenv
EXPO_PUBLIC_FIREBASE_API_KEY=取得したapiKey
EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN=取得したauthDomain
EXPO_PUBLIC_FIREBASE_PROJECT_ID=取得したprojectId
EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET=取得したstorageBucket
EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=取得したmessagingSenderId
EXPO_PUBLIC_FIREBASE_APP_ID=取得したappId
```

`.env.local` はGit管理対象外です。設定後に開発サーバーを再起動してください。

```powershell
npm run web
```

アプリの「設定」→「クラウド同期」を開き、「未設定」ではなくログイン欄が表示されれば読み込み成功です。

### 4. EASへAndroidビルド用の設定を入れる

`.env.local` はGitへ送られないため、EASのクラウドビルドには別途登録が必要です。次の6コマンドを実行し、各 `VALUE` をFirebaseの値へ置き換えます。

```powershell
npx eas-cli@latest env:set --environment preview --visibility plaintext --name EXPO_PUBLIC_FIREBASE_API_KEY --value "VALUE"
npx eas-cli@latest env:set --environment preview --visibility plaintext --name EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN --value "VALUE"
npx eas-cli@latest env:set --environment preview --visibility plaintext --name EXPO_PUBLIC_FIREBASE_PROJECT_ID --value "VALUE"
npx eas-cli@latest env:set --environment preview --visibility plaintext --name EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET --value "VALUE"
npx eas-cli@latest env:set --environment preview --visibility plaintext --name EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID --value "VALUE"
npx eas-cli@latest env:set --environment preview --visibility plaintext --name EXPO_PUBLIC_FIREBASE_APP_ID --value "VALUE"
```

登録内容を確認します。

```powershell
npx eas-cli@latest env:list --environment preview
```

`EXPO_PUBLIC_` の値は完成したアプリから閲覧可能なので、Secret指定にしても秘密にはできません。データ保護は後述のFirestore Security Rulesで行います。

開発クライアントも使う場合は、同じ6項目を `--environment development` にも登録してください。ローカルのExpo Goは `.env.local` を使用します。

### 5. Firestore Security Rulesを配布する

Firebase CLIへログインし、このリポジトリを手順1のFirebaseプロジェクトへ関連付けます。

```powershell
npx firebase-tools login
npx firebase-tools use --add
npx firebase-tools deploy --only firestore:rules
```

`use --add` では対象プロジェクトを選び、エイリアス名は `default` で構いません。生成される `.firebaserc` に正しいプロジェクトIDが入っていることを確認します。

`firestore.rules` は `users/{uid}` 以下をログイン中の本人だけが読み書きできる構成です。Rulesを配布する前に実データを保存しないでください。

### 6. Web/PWAとAndroidを作る

Web/PWAは `.env.local` の値をJavaScriptへ埋め込んでから公開します。

```powershell
npm run web:export
npx firebase-tools deploy --only hosting
```

完了時に表示されたHosting URLをiPhone Safariで開き、「共有」→「ホーム画面に追加」を選びます。Firebase設定値を変更したときは、必ず再度exportして公開してください。

Xperiaの日常利用用APKは、EASの `preview` 環境に登録した値を使ってビルドします。

```powershell
npx eas-cli@latest build --platform android --profile preview
```

ビルド完了後に表示されるURLをXperiaで開き、APKをインストールします。Firebase設定値を変更した場合はAPKの再ビルドが必要です。

### 7. 初回ログインとローカルデータ移行

1. 念のため、両端末で「設定」→「データを書き出す」を実行する。
2. データをクラウドへ上げたい側の端末で「設定」→「クラウド同期」を開く。
3. メールアドレスと6文字以上のパスワードを入力し、「新規登録」を選ぶ。
4. 画面に「クラウド同期: 同期済み」と表示されることを確認する。
5. もう一方の端末で、同じメールアドレスとパスワードを使って「ログイン」する。

既存ローカルデータとクラウドデータはNode単位で統合されます。初回同期中はアプリやブラウザーを閉じず、両端末で「同期済み」になるまで待ってください。

### 普段の更新コマンド

初回設定後、コードを更新してXperiaとiPhoneへ反映するときは次の3コマンドです。

```powershell
npx eas-cli@latest build --platform android --profile preview
npm run web:export
npx firebase-tools deploy --only hosting
```

Androidは新しいAPKをXperiaへインストールします。iPhone PWAは公開後にSafariまたはホーム画面版を再読み込みします。

### 利用量と運用

同期対象はNodeのみで、各Nodeを個別ドキュメントとして差分書き込みします。画面を開いている間はログインユーザーのNodeコレクションにリスナーを1本だけ張ります。想定外の課金を避けるため、Firebase Consoleで予算アラートとFirestore使用量を確認し、不要なテストアカウントや大量データを放置しないでください。

### 端末間テスト

1. Webでアカウントを新規登録し、MemoとCategoryを作成する。
2. Xperiaで同じアカウントへログインし、作成内容と並び順を確認する。
3. Xperiaで編集・完了・移動し、Webへ反映されることを確認する。
4. Webで削除・復元・完全削除し、Xperiaへ反映されることを確認する。
5. 一方をオフラインにして編集し、再接続後に同期されることを確認する。
6. 別アカウントでログインし、他ユーザーのデータが見えないことを確認する。

すべて確認できるまでGitHub Issue #21はcloseしません。

### 問題が起きたとき

- 「クラウド同期: 未設定」: `.env.local` またはEAS環境変数の6項目を確認し、再起動・再ビルドする。
- `auth/operation-not-allowed`: Firebase Authenticationでメール/パスワードを有効にする。
- `permission-denied`: ログイン状態と `firestore.rules` の配布先プロジェクトを確認する。
- Webだけログインできない: AuthenticationのAuthorized domainsと、公開中のドメインを確認する。
- Androidだけ未設定になる: `eas env:list --environment preview` を確認してAPKを再ビルドする。
- 同期できないときもローカルデータは消さず、先にJSONを書き出してから設定を見直す。
