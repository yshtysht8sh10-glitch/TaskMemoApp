# TaskMemo 設計書

## 1. 目的とスコープ

TaskMemo は、OneNote で行っていたタスク・メモ管理を置き換えるためのスマートフォンアプリである。Category と Memo を同じツリー上の Node として扱い、所属関係と期限を分離して管理する。

本書は、初期設計としてデータモデル、ツリー構造、期限、完了、削除、復元、並び替え、移動の仕様を定める。今回のスコープは設計と TypeScript 型定義までとし、Firebase 接続、画面・操作の本格実装、広告、課金、AI 機能は含めない。

想定する技術構成は次のとおり。

- React Native / Expo / TypeScript
- Firebase Authentication（将来導入）
- Cloud Firestore（将来導入）
- iOS / Android
- GitHub

将来は複数端末同期、一般公開、広告、広告非表示の買い切り課金、プレミアム機能またはサブスクリプション、App Store / Google Play での公開を想定する。

## 2. ドメインモデル

### 2.1 Node の種類

すべての要素を `Node` として扱い、`type` で次の 2 種類を判別する。

- `category`: ファイルシステムのフォルダに相当し、子 Node を持てる。
- `memo`: ファイルに相当し、子 Node を持てない。

TypeScript の正本は [`src/models/node.ts`](../src/models/node.ts) とする。

```ts
type NodeType = 'category' | 'memo';

type BaseNode = {
  id: string;
  type: NodeType;
  parentId: string | null;
  sortKey: string;
  title: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
};

type CategoryNode = BaseNode & {
  type: 'category';
};

type MemoNode = BaseNode & {
  type: 'memo';
  body: string;
  dueAt: Date | null;
  duePreset: DuePreset;
  status: MemoStatus;
  completedAt: Date | null;
};

type Node = CategoryNode | MemoNode;
```

`Date` はアプリ内のドメイン型である。Firestore 導入時は永続化境界で `Timestamp` と相互変換し、ドメインモデルへ Firestore 固有型を持ち込まない。

### 2.2 BaseNode

| フィールド | 意味 | 制約 |
| --- | --- | --- |
| `id` | Node の一意識別子 | 空文字列にしない |
| `type` | Node の種類 | `category` または `memo` |
| `parentId` | 親 Category の ID | `null` はルート直下。Memo の ID は指定不可 |
| `sortKey` | 同じ親の中での並び順 | 文字列ランク。同一 `parentId` 内で比較する |
| `title` | 表示タイトル | 入力制約の詳細は未決 |
| `createdAt` | 作成日時 | 保存時は絶対時刻として扱う |
| `updatedAt` | 最終更新日時 | Node の変更時に更新する |
| `deletedAt` | 論理削除日時 | `null` は通常状態、それ以外はゴミ箱状態 |

### 2.3 Memo

Memo はタイトルに加えて、自由記述 `body`、期限、完了状態を持つ。子 Node は持てず、他の Node の `parentId` に Memo の ID を設定してはならない。

`body` は初期段階ではプレーンテキストとする。Markdown などの高度な記法は導入しない。将来は本文中の URL 文字列を自動検出し、タップ時にブラウザなどへ遷移できるようにする。

状態の整合条件は次のとおり。

- `status === 'active'` のとき `completedAt === null`
- `status === 'completed'` のとき `completedAt` は完了日時
- `duePreset === 'none'` のとき `dueAt === null`
- `duePreset !== 'none'` のとき `dueAt` はプリセットまたは日時指定から確定した日時

これらの組み合わせは TypeScript の型だけでは完全に強制しない。作成・更新処理の境界で検証する。

## 3. ツリー構造

Node は `parentId` による隣接リスト方式でツリーを表す。

```text
個人 (Category)
├─ 歯医者予約 (Memo)
├─ 書籍購入 (Category)
│  ├─ 購入予算を確認 (Memo)
│  ├─ 技術書 (Category)
│  │  ├─ ドメイン駆動設計 (Memo)
│  │  ├─ Docker本 (Memo)
│  │  └─ 設計関連 (Category)
│  │     └─ 仕様駆動設計本 (Memo)
│  └─ Amazonセール確認 (Memo)
└─ パスポート確認 (Memo)
```

次の不変条件を守る。

- Category と Memo は同じ階層に混在できる。
- Category は任意の深さでネストできる。
- ルート直下にも Category と Memo の両方を配置できる。
- Category の途中の階層にも Memo を配置できる。
- 未削除 Node の `parentId !== null` の場合、参照先は存在する未削除の Category である。ゴミ箱内では元のツリーを保持するため、削除済み Category を参照できる。
- 祖先をたどって同じ Node に戻る循環を許可しない。

通常のツリー画面は `deletedAt === null` の Node を対象とし、基本的に未完了 Memo のみ表示する。完了 Memo は完了一覧で確認する。

## 4. Category と期限の役割分離

Category は「何に属するか」、期限は「いつまでに行うか」を表す。この 2 つを混ぜない。

たとえば「書籍購入 > 技術書 > ドメイン駆動設計」という所属を保ったまま、対象 Memo の `dueAt` を今日の 23:59 に設定できる。「今日まで一覧」は同じ Memo を期限条件で参照し、別 Node として複製しない。

## 5. 期限

### 5.1 保存する値

Memo は次の 2 つを保存する。

- `dueAt`: 期限判定に使う確定済みの日時。期限判定の正とする。
- `duePreset`: ユーザーが UI で選択したプリセット。設定意図の表示に使う。

プリセットは次のとおり。

| `duePreset` | UI 表示 | `dueAt` への変換 |
| --- | --- | --- |
| `none` | 期限なし | `null` |
| `today` | 今日中 | 選択日の 23:59 |
| `morning` | 午前中 | 選択日の午前締切時刻（未決） |
| `afternoon` | 午後まで | 選択日の午後締切時刻（未決） |
| `thisWeek` | 今週中 | 選択時点の週最終日の 23:59 |
| `thisMonth` | 今月中 | 選択月の最終日の 23:59 |
| `thisYear` | 今年中 | 選択年の 12 月 31 日 23:59 |
| `custom` | 日時指定 | ユーザーが指定した日時 |

プリセットは選択した時点で具体的な `dueAt` に変換し、その値を固定する。たとえば `thisWeek` は翌週になっても自動延長しない。

### 5.2 タイムゾーン

プリセットから期限を計算するときは、選択時点におけるユーザーのローカルタイムゾーンを使う。保存時は Firestore `Timestamp` などの絶対時刻として扱い、表示時はユーザーのローカルタイムゾーンへ変換する。

タイムゾーンをまたぐ移動後も保存済みの `dueAt` 自体は変更しない。プリセットの再計算も自動では行わない。

## 6. 完了

完了と削除は別の概念とし、一方の操作で他方の状態を暗黙に変更しない。

完了時は次を同時に設定する。

```ts
status = 'completed';
completedAt = 完了日時;
```

未完了へ戻すときは次を同時に設定する。

```ts
status = 'active';
completedAt = null;
```

通常画面では基本的に未完了 Memo を表示する。完了一覧は未削除かつ `status === 'completed'` の Memo を対象とし、既定では `completedAt` 降順で表示する。完了一覧から未完了へ戻せるようにする。

## 7. 並び順

表示順は `parentId + sortKey` で決める。同じ `parentId` を持つ Category と Memo を一つの一覧として `sortKey` の文字列順に並べる。

`sortKey` には LexoRank または fractional indexing に類する文字列ランクを採用する。要件は次のとおり。

- 文字列比較で安定した順序になる。
- 先頭、末尾、および 2 つの既存ランクの間に新しいランクを生成できる。
- 原則として移動した Node のみを書き換える。
- ランクの密集や長大化に対するリバランス手段を持つ。
- Firestore の書き込み回数を抑え、複数端末同期で扱いやすい。

実装時は要件を満たす信頼できる既存ライブラリを優先する。ライブラリ選定と、同時編集で同一ランクが生成された場合の決定的なタイブレーク規則は未決とする。

Category のみを削除して子を展開する場合は例外的に複数 Node の `parentId` と `sortKey` を更新する。削除された Category の位置に直下の子を元の相対順序で挿入し、前後の Node の間に必要数のランクを発行する。

## 8. 移動とドラッグ＆ドロップ

Category と Memo はともにドラッグ可能とする予定である。

| 操作 | 更新内容 |
| --- | --- |
| 同じ階層内で並び替え | 対象 Node の `sortKey` を変更 |
| Memo を Category へ移動 | Memo の `parentId` と移動先での `sortKey` を変更 |
| Category を Category へ移動 | Category 自身の `parentId` と移動先での `sortKey` を変更 |
| ルートへ移動 | `parentId = null` とし、ルート用の `sortKey` を設定 |

Category を移動しても子孫の `parentId` は変更しない。Category 自身の親を変えることでサブツリー全体を追従させる。

Category の移動前には、移動先が自身または自身の子孫でないことを検証する。たとえば `A > B > C` のとき、A を A または C の配下へ移動する操作を拒否する。Memo を親にはできない。

## 9. 削除とゴミ箱

### 9.1 共通仕様

通常削除は物理削除せず、対象 Node の `deletedAt` に削除日時を設定する。通常画面では `deletedAt !== null` の Node を表示しない。

ゴミ箱は `deletedAt !== null` の Node を対象とし、次の操作を提供する。

- 復元: `deletedAt = null`
- 完全削除: 永続ストアから物理削除

完全削除は将来、確認ダイアログを経て実行する。物理削除後はアプリから復元できない。

### 9.2 Memo の削除

Memo は自身の `deletedAt` のみを更新する。完了状態、期限、本文、親、並び順は保持し、復元時に元の状態へ戻せるようにする。

### 9.3 Category を子ごと削除

対象 Category とその全子孫の `deletedAt` に削除日時を設定し、サブツリー全体をゴミ箱へ移す。各 Node の `parentId` と `sortKey` は保持する。

復元は原則としてサブツリー単位で行い、元の親子関係と順序を戻す。MVP で削除操作単位を識別する追加フィールドを導入するかは未決であり、復元方式の確定までは過剰な仕組みを実装しない。

### 9.4 Category のみ削除

対象 Category のみを論理削除し、直下の子 Node を対象 Category の親へ昇格させる。

```text
変更前: A, B(B1, B2), C
変更後: A, B1, B2, C
```

処理内容は次のとおり。

1. B の直下の子を現在の `sortKey` 順で取得する。
2. 各子の `parentId` を B の `parentId` に変更する。B がルート直下なら `null` にする。
3. B が存在した位置へ子を同じ相対順序で挿入できる `sortKey` を発行する。
4. B の `deletedAt` に削除日時を設定する。

将来 Firestore へ接続する際は、部分更新による不整合を避けるため、この複数 Node 更新をトランザクションまたはバッチ書き込みで行う。

この方式では削除時に子が昇格する。Category 単体を復元した際に、昇格済みの子を再び配下へ戻すかは未決とする。

### 9.5 完全削除と参照整合性

Category の完全削除時に未削除の子が残っていてはならない。「Category のみ削除」では子が昇格済みであること、「子ごと削除」では対象サブツリーを一括で完全削除することを確認してから物理削除する。

## 10. Firestore 想定

Category と Memo を別コレクションに分けず、ユーザー配下の `nodes` コレクションへ統一する。

```text
users
└─ {userId}
   └─ nodes
      └─ {nodeId}
```

ドキュメントは `type` で Category と Memo を判別する。具体的な Converter、インデックス、クエリ、オフライン競合解決、バッチ上限を考慮した大規模サブツリー処理は Firebase 導入時に設計する。

## 11. セキュリティ

将来 Firebase Authentication を導入し、各ユーザーは自身の `users/{userId}/nodes` 以下だけを操作可能とする。Security Rules では少なくとも `request.auth != null && request.auth.uid == userId` を前提に、フィールドとデータ整合性の検証も追加する。

API キー、秘密鍵、管理者用資格情報、トークンはコミットしない。特に秘密鍵や管理者資格情報はクライアントアプリへ含めない。Firebase 接続と具体的な Security Rules は今回実装しない。

## 12. ローカル MVP 実装（2026-09）

- ローカル永続化には AsyncStorage を使用し、保存境界で `Date` と ISO 文字列を変換する。
- 並び順は `fractional-indexing` の文字列ランクで管理する。旧モックの単純な文字キーは初回読み込み時に親単位で一度だけ移行する。
- 子ごと削除では任意の `deletionBatchId` を同一サブツリーへ付け、ゴミ箱からサブツリー単位で復元する。
- Category のみ削除後に Category 単体を復元しても、既に昇格した子は再収容しない。
- 復元時に元の親が存在しない、または削除状態で同時復元対象でもない場合はルートへ復元する。
- 期限プリセットは午前中を 12:00、午後までを 17:00、今週中を日曜 23:59 とする。

## 13. 今回実装しないもの

- Firebase / Firebase Authentication / Cloud Firestore 接続
- 本格的なツリー UI とドラッグ＆ドロップ
- Memo の追加・編集画面
- ゴミ箱画面と完了一覧画面
- URL 自動リンク機能
- 広告、課金、AI 機能

## 14. 未決事項（TODO）

- 締切時刻と週最終日をユーザー設定で変更可能にする範囲
- タイトルや本文の必須・最大長などの入力制約
- 同一ランクが複数端末で同時生成された場合のタイブレーク規則
- 複数端末での同時移動・削除・復元の競合解決方針
- Firestore の必要インデックスと、大規模サブツリーをバッチ上限内で処理する方式
