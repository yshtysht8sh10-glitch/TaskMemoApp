# Architecture

Expo Routerのルートは `src/app` に置き、機能ロジックは `src/features`、外部サービス連携は `src/services` に分離します。

Firebaseを導入する際は、クライアント設定を環境変数から読み込み、秘密鍵や管理者資格情報をアプリへ含めません。認証・Firestore・広告・課金は必要になった段階で個別に設計します。
