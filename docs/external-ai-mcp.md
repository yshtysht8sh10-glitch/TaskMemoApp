# External AI / Remote MCP

Issue #24の外部AI連携は、Claude専用のデータ操作を作らず、次の境界で実装する。

```text
Claude / other MCP client
        ↓ OAuth 2.1 + Remote MCP
functions/src/app.ts, mcpServer.ts
        ↓ authenticated UID only
ExternalAiUsageQuotaGate
        ↓
src/external-ai/taskMemoApplicationService.ts
        ↓
TaskMemoNodeRepository
        ↓
users/{uid}/nodes
```

## Tool contract

- `list_memos`
- `get_memo`
- `create_memo`
- `update_memo`
- `complete_memo`
- `delete_memo`（論理削除のみ）
- `restore_memo`
- `list_categories`

`memoId`が分かる場合は常にIDを優先する。title検索で複数候補が見つかった場合は`conflict`と候補IDを返し、変更しない。`purgedAt`を持つNodeは公開も復元もしない。

## Authentication boundary

- MCP tool inputにUIDフィールドは存在しない。
- UIDはOAuth access tokenを検証して得た認証コンテキストだけから渡す。
- OAuth Authorization Code + PKCE、Dynamic Client Registration、refresh token rotation、revocationを提供する。
- access/refresh tokenは平文保存せずSHA-256 hashだけをFirestoreへ保存する。
- OAuth承認時は既存FirebaseユーザーのID tokenをAdmin SDKで検証する。
- FunctionsのAdmin SDKはFirestore Rulesを迂回するため、Repositoryは常に`users/{verifiedUid}`だけを参照する。
- Firestore文書の物理削除は行わず、既存の`deletedAt`/`purgedAt`同期方式を維持する。
- 変更ログには操作名とNode IDだけを残し、Memo本文やtokenを記録しない。

## Usage / quota extension point

全MCP toolはApplication Serviceを呼ぶ前に`ExternalAiUsageQuotaGate`を必ず通る。渡す情報は認証済みUID、OAuth client ID、tool名、read/write区分だけで、Memo本文やtokenは含まない。

現在は`AllowAllExternalAiUsageQuotaGate`を使用し、全操作を許可する。料金プラン、決済、Free/Pro判定、具体的な上限、課金用DBは実装しない。将来コスト管理が必要になった場合は、この実装を日次/月次カウンターやquota判定を行う実装へ差し替えられる。MCP AdapterやApplication Serviceの業務ロジックを変更する必要はない。

書込み操作については、既存の診断ログとして操作名と変更Node IDをユーザー配下へ保存する。全read/write回数の恒久的な集計は、追加のFirestoreコストを発生させないため現段階では保存せず、必要になった時点でUsage gate側へ追加する。

## Local verification

```text
npm run verify
```

Functionsだけを検証する場合:

```text
npm --prefix functions run check
```

Firebase EmulatorでHTTP/OAuthを通す場合は、`functions/.env.example`を参考にローカル用`functions/.env`を作成する。秘密鍵ファイルは使用せず、エミュレーターまたはApplication Default Credentialsを利用する。

## Environment variables

Functions:

- `TASKMEMO_MCP_BASE_URL`: 公開Functions URL。末尾`/`なし
- `TASKMEMO_WEB_ORIGIN`: OAuth承認画面を表示するTaskMemo Webのorigin

Web/Android client:

- `EXPO_PUBLIC_TASKMEMO_MCP_BASE_URL`: 同じ公開Functions URL

公開URLは設定値であり秘密情報ではない。サービスアカウント鍵、OAuth token、token署名秘密鍵はクライアント環境変数へ入れない。

## Production deployment status

Functionsの本番デプロイは未実施。Firebase Blaze / Cloud Billingが必要になる可能性があるため、ユーザーが料金条件を確認して明示的に完了するまで実行しない。
