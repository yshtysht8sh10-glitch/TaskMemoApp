# TaskMemo Text Format v1 — Issue #59 Phase 1–6

現在のIssue本文を仕様の一次情報とする。以前のMarkdown風syntaxは採用しない。
一覧・ツリーの「テキスト編集」「テキストView」に対応。Phase 7 / Hosting deployは含まれない。
UI操作とRoutine Occurrenceの扱いは[画面ガイド](TEXT_WORKSPACE.md)を参照。

## 書式・各列

1 Node = 1行。`ref | 種別 | タイトル | 期限 | 完了 | 本文 | Routine`。
後方の列は省略可。既存Nodeでは省略列を保持、新規Nodeではdefaultを使用する。
途中の列を飛ばす場合は空セルを置く。明示的な解除は期限なし、空本文、Routineなし。
refなしの新規行は `Task | 新しいTask | 今日 | 未完了` または ` | Task | ...`。
`@n1`はsession内の参照。実Node IDではない。既存行のrefを消して新規行にしない。

| 列 | 許可値・意味 | 空セル・省略 |
|---|---|---|
| ref | @n1等のsession参照 | 空は新規Node |
| 種別 | Category / Task / Idea | 必須 |
| タイトル | 文字列（JSON引用可） | 空白のみは禁止 |
| 期限 | 許可された相対値・絶対日時 | 空/省略は既存値を保持、解除は期限なし |
| 完了 | 未完了 / 完了 | 空/省略は保持 |
| 本文 | 文字列（JSON改行可） | **列が存在する空セルは本文を消す**。後方列ごと省略なら保持 |
| Routine | frequency interval=N startsOn=YYYY-MM-DD / daily / weekly / monthly / yearly / なし | 原則保持。ツリーでRoutine外への移動と同時に空/省略にした場合は明示解除 |

新規Nodeで省略した期限はなし、完了は未完了、本文は空、Routineはなし。
空の本文を保ちつつRoutineだけ変更したい場合も、現在の本文を本文列へ記載する。

```text
@root
  @n1 | Category | 仕事
    @n2 | Category | 開発
      @n3 | Task | #59を実装 | 今日 | 未完了
      @n4 | Task | TOEIC | 今月 | 未完了
      @n5 | Idea | AI連携を考える
@routine
  @n6 | Task | ゴミ出し | | 未完了 | | daily
```

文字列内の`|`、改行、前後空白はJSON文字列セルで安全に表せる。
例：`Task | "A | B" | 期限なし | 未完了 | "1行目\n2行目"`。
引用しないセルでは `\|`, `\\`, `\n`, `\r`, `\t` を使用できる。
空行は無視する。`@root` / `@routine`以外のグループ見出し、コメント、Markdown文法は受理しない。

## システム領域とRoutineの整合性

`@root`はparentId=null。`@routine`は既存Routine管理領域を参照するシステム予約語。
いずれもNodeではなく、ID/refを持たず、同名Categoryを作らない。行頭に各1回のみ。
領域直下は2スペース。通常Category配下はさらに2スペースずつ増やす。
`@routine`直下は有効なRoutine設定を持つTaskのみ。Category / Idea / 仮想Occurrenceは不可。

通常TaskをRoutine化するには、`@routine`への移動と有効なRoutineセルの両方が必要。
`daily`等はinterval=1。新規設定のstartsOnはsession固定日の現地日付。
同じfrequency/intervalの既存ruleを短縮形にした場合、既存startsOnを保持。
serializerは開始日を明示する完全形を出力する。

Routine解除は`@root`または通常Categoryへの移動と、Routineセルの削除（空/省略/なし）を同時に行う。
移動のみ、rule削除のみはいずれも保存不可。routineHistory / routineDueOverridesは解除時も保持する。
完了済み通常Taskは完了履歴を暗黙に消さず、通常UIで未完了に戻してからRoutine化する。
Routine管理領域がない場合も、ツリーのテキスト編集を開く前にApplicationが安全・冪等に準備する。通常UIの入口はツリーの「ルーティーン追加」。詳細は[Routine領域のV2準備](ROUTINE_ROOT_V2.md)を参照。
テキスト保存は管理領域を勝手に新設しない。

互換性: 本番由来fixtureの`fixture-11`（匿名化ID）はparentId=nullで過去のweekly repeatRuleを持つ。
現DomainではRoutine occurrenceではない。この既存の休眠ruleは、無編集・タイトル等の無関係な編集で
保持する。新たなrule変更や親変更は整合性検証の対象。既存データを推測で補正しない。

## 一覧とツリー

- ツリー：2半角spaceで1階層。親は直前の1段浅いCategory。Memoを親にしない。
- 一覧：spaceインデントは階層に影響しない。sessionが入口の並びとgroupを保持する。
  既存NodeのparentIdとsortKeyは維持し、group内の並び変更はdeadlineSortKeyだけを変更する。
  新規Memoはsession指定のnewParentId（default root）に追加する。新規Categoryは一覧では非対応。
  `@root` / `@routine`見出しは一覧では入力エラー。Routine構造は変更不可。
  当日・過去分を含むRoutine投影行は初期版の一覧編集対象外（Viewでは読み取り可能）。
- 読み取り専用テキストViewは別機能。編集syntaxをそのままそのUIへ表示しない。

## 保存・破棄・Undo

全件parse/validation → plan → 必要な確認 → Application store内で再検証 → 1 commit。
エラー1件でも全件保存禁止。部分保存はない。破棄は未commitのsessionを捨てるだけ。
1保存=1 History entry。Domain Undo/Redoは保存単位。editor内の文字Undoとは別。
無編集保存はHistory / Outboxを生成しない。

## 期限の入力値

相対値は[生成した許可値一覧](TEXT_FORMAT_REFERENCE.md)を参照。
今日/明日/明後日は当該日の23:59、今週/来週は日曜23:59、
今月/来月は月末23:59、今年は12/31 23:59、午前は12:00、午後は17:00。
既存Domainのpresetと対応しない明後日/来週/来月はcustomとして保存する。

絶対値：`4/25`、`2027/4/25`、`4/25 17:00`、`2027/4/25 17:00:12.345`、
offset/Z付きISO日時。年省略はsessionの年。時刻省略は23:59:00。
すべてsessionの固定日時/timezoneで解決。存在しない日付・DSTで存在しない/曖昧な
ローカル時刻はerror。曖昧な時刻はoffset付きISOで修正する。
「来週くらい」「月末あたり」等を推測しない。
無編集の期限セルは元のdueAt/duePresetを完全に保持する。

## Task / Idea / 完了 / Routine

Taskの完了列は未完了/完了。通常Taskはstatusを変更する。
Routine root直下ではsession日付のroutineHistory実績を変更し、通常statusを変えない。
Routine列例：`day interval=1 startsOn=2026-10-02`。日/週/月/年に対応する。
解除は領域外への移動とRoutine設定削除の両方。intervalは1以上の安全な整数、startsOnは実在するYYYY-MM-DD。
Ideaに期限・完了・Routineは設定しない。実績/期限等を持つTask↔Idea変換は非対応。
Routineの完了列は当日の実績、領域外の完了列は通常statusとして解釈する。過去実績は保持する。
実績全体、発生回期限override、deadlineSortKey、未知metadataは本文やタイトルの編集で消えない。

## 大量変更・削除

全削除を含むすべての削除は対象の確認が必要。Routine rootは削除不可。
50件以上、または20件以上の編集scopeの30%以上を変更するときも確認する。
確認したplan/fingerprintがcommit対象と一致しなければ保存を停止する。
編集開始後のDomain変更（他端末を含む）は競合停止し、入力を保持して再確認する。
無編集ではrevision/History/Outboxも変化しない。

## 正常例・errorの直し方

```text
Task | 買い物 | 4/25 17:00 | 未完了 | "人参\n玉ねぎ"
Idea | AI連携 | 期限なし | 未完了 | 自由入力 | なし
```

`Task | 買い物 | 月末あたり` → due error。`今月`または絶対日付にする。
`Task | 買い物 | 2/30` → due error。実在する日付にする。
`@n1`の重複 → ref error。コピーの新規行だけrefを外す。
既存ref消失＋新規行 → identity error。既存refを復元する。
Memoの下にindentしたMemo → hierarchy error。Categoryの下またはrootへ移す。
error code一覧は[生成した参照表](TEXT_FORMAT_REFERENCE.md)。

## 一次情報と開発者責務

`src/textFormat/syntax.ts`が列、許可値、IR、error codeの一次情報。
parser/validatorはReact、storage、Firebaseへ依存しない。
serializer/session/planner/Applicationの詳細・代表例は実装各Phaseで本書と
`TEXT_FORMAT_DEVELOPMENT.md`へ追加する。許可値一覧は生成スクリプトから再生成する。

## 非対応

Divider、Category↔Memo変換、purge/ゴミ箱復元、旧Routine category編集、
Routine実績一覧/override一覧の直接編集、曖昧な自然言語、独立dayPart。
非表示metadataと未知fieldは元Nodeに保持する。
