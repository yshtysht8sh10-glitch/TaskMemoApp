# 06 実装分割・レビュー担当への引き継ぎ

## 1. 状態

- 設計のみ。新intent/reducer/loader/Rules/★UIは未実装。
- 旧診断ゲートは1/7、1/5のまま。新契約が解決済みというテスト結果はない。
- #107/#120/PR #122の証拠を維持し、PR #122を機能PRへ上書きしない。
- 本PRは公開origin/main=f3c8253から新設しMarkdownのみ追加。元DEV44623f8とProduction0c4ac60の未push履歴は継承/公開しない。
- 本番/DEVアプリ、Firestore、Auth、Hosting API、端末IndexedDB/localStorage/cacheへ今回接続していない。

## 2. レビューで決める仕様

1. 新版専用の共通intent＋server正本、属性MV候補/明示解決を採用するか。
2. 完了・取消、★ON/OFF、placement、Routine lifecycle/日別実績のgroup/readSet粒度と、同属性並行時のUX。
3. 旧形式readerとraw archive、特に旧History clearを避ける入口保護を必須にするか（推奨: 必須）。
4. Bの明示migration、二台/全origin準備、source不変とnew generation切替を採用するか。
5. 不明base/未解決旧操作を残したactive化は原則禁止とするか。例外は本人の個別承認・未完全同期表示とする案。
6. 通常backupと完全checkpointを分け、原操作/候補を含まない旧fileの復元能力を誇張しないこと。
7. 旧writer拒否には将来Rules/Functions/外部writer対応が必要なこと。現在の禁止を守り設計だけに留めたこと。
8. 新旧12ケースのgate対応表を承認し、証拠削除/skipで成功にしないこと。
9. 既配信Production sourceの未push状態をリリース担当が別途整理し、実装基点を監査可能にすること。
10. 本人/二端末という条件は機能的な運用境界であって、未確認local/unknown rawを捨てる根拠にしないこと。

## 3. 後続実装PRの分割案

各段階は今回未着手。設計レビュー承認後に、DEVで段階的に進める。実装基点はその時点の承認済み公開基点から固定する。

|PR群|対象|必須のexit条件|
|---|---|---|
|P0 原本保護/観測|起動前read-only raw inventory、全形式の読取/退避、保全manifest。旧Store.openを先に呼ばない|fixtureの旧History/Outbox/Journal/未知fieldが一件も黙って消えず復元可能。まだCloud切替しない|
|P1 protocol純粋層|intent/schema、属性frontier、readSet、MV競合/resolve、補償Undo/Redo|独立属性/同属性/因果/順序逆転のpure受入全件。Node LWWを新正本にしない|
|P2 local durability|新Envelope/atomic commit、Outbox→awaiting移管、再起動/容量不足/actor再発行|raw CAS/Journal保護、crash matrix、retry identity保持|
|P3 server/control（別設定承認）|認証受付/immutable受領、reducer/結果/投影、Rules/旧writer拒否、MCP等のgate|使い捨てEmulator/DEVで旧SDK拒否＋local保全、新順不同/重複/transaction試験|
|P4 migration/backup|legacy分類/source mapping、二台ready/lease、shadow copy/verify、checkpoint/restore|全legacy fixtureのconservation、12ゲート新契約対応、fail途中の再開/rollback|
|P5 client接続/競合UX|既存表示モデルへのprojection、受領/反映/候補状態、旧データ保留/解決UI|先行表示/未完全同期を正しく区別、iPhone/PC/複数originの実機DEV検証|
|P6 #120独立UI|通常Memo/Taskの★intent、濃赤表示/menu。Routine projectionは初期対象外|新同期基盤承認後、既存#120の全受入と回帰。今回は実装しない|
|P7 release/migration実行|release担当の独立preflight/backup/二台切替/監視/復旧|別途の本番読取・設定・配信・移行実行承認。開発/レビュー承認だけでは実行不可|

順序依存を満たす範囲でP3とP4のfixtureを並行に設計できるが、原本保護P0以前にユーザーデータを新loaderで開かない。新機能優先でprototypeを本番へ先に出さない。

## 4. 担当の境界

- 開発担当（今回）: ソース調査、設計文書、旧データ互換性の事実/不明点、移行と試験案、docs-only commit/push/Draft PRとIssueへの記録で停止。
- レビュー担当: 上記仕様と12ケース対応、losslessなsource分類、完全backup/rollback、権限/新writer境界を検証し、承認か具体的な設計変更を返す。
- リリース担当: 承認済み実装候補を固定し、二端末の状態確認・backup・旧writer停止・配信・切替・復旧をそれぞれの承認範囲内で担当。本PRでは配信物/実行コマンドを準備していない。

## 5. 未確認事項と将来の限定読取の提案条件

本番の全source件数、旧Historyの実在、Journal/Outbox残存、二台各originのraw、旧receiptと現在表示の対応、実Cloud被害、実行中buildは不明。調査コードだけからデータ不存在/全件変換済みを断定しない。

レビューだけには本番読取は不要。移行計画の現物化で必要になった時点で、本人UID・対象source/field・件数上限・目的・保管先・共有時の秘匿を提示し承認を待つ。今の依頼を将来の無制限読取権限としない。

## 6. この設計PRの検証

製品コード/Rules/既存テストのdiffがないこと、Markdown内部リンク/固定版コード参照の存在、10成果物と12ゲートの対応、commit ancestry/未push混入なしを確認する。設計レビュー前にprototypeや新テスト実装を追加しない。設計の整合確認と将来の実行テストのPASSを混同しない。

**承認前に実装へ進まず、ここで停止する。**
