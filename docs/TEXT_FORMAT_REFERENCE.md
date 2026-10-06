# Text Format許可値（生成物）

一次情報：`src/textFormat/syntax.ts`。再生成：`npx tsx scripts/generate-text-format-docs.ts`。

列：ref | type | title | due | completion | body | routine

種別：Category / Task / Idea

完了：未完了 / 完了

相対期限：今日 / 明日 / 明後日 / 今週 / 来週 / 今月 / 来月 / 今年 / 午前 / 午後 / 期限なし

Routine frequency：day / week / month / year

システム予約語（Nodeではない）：@root / @routine

Routine短縮形：daily / weekly / monthly / yearly

| code | 意味・修正方法 |
|---|---|
| syntax | 列数・escape・ref・インデントを確認してください。 |
| type | 種別はCategory / Task / Ideaです。 |
| title | 空のタイトルは保存できません。 |
| due | 期限は許可された相対表現または実在する絶対日時で指定してください。 |
| completion | 完了状態は未完了 / 完了です。 |
| routine | Routineはday/week/month/year interval=N startsOn=YYYY-MM-DDです。 |
| hierarchy | 親は有効なCategoryでなければなりません。 |
| ref | refはこのsessionの既存Nodeを重複なく参照してください。 |
| identity | ref欠落と新規行が併存しています。既存refを復元するか、削除と追加を別保存にしてください。 |
| protected | システムNode・種別変換・実績・非対応属性の変更は制限されています。 |
| conflict | Domainが編集開始後に変わりました。入力を保持して再確認してください。 |
