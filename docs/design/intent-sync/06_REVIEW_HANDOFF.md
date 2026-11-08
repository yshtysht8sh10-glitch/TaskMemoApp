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

## 6. REQUEST CHANGES対応表（再レビュー対象）

レビュー原文: [PR #123 REQUEST CHANGES](https://github.com/yshtysht8sh10-glitch/TaskMemoApp/pull/123#issuecomment-6722175833)。方式Bと共通intent同期の基本方針は維持する。以下は設計修正の対応であり、製品での解決済み判定ではない。

|レビュー指摘|修正文書・節|追加仕様|対応テスト（05節6）|残存リスク|
|---|---|---|---|---|
|R1 常設メモ/features/settings/Historyの移行先不足|01節8、02節2・8、04節2・7|全永続種別のsource→typed resource/local設定→History/候補→機能照合。dirty/false/空bodyを保護。account同期と端末固有を列挙。rawだけでは成功不可|R1-01〜08（正常/競合/異常/再起動/失敗復旧）|実sourceの未知型・元基点不明は未計測。安全変換不能は停止/部分移行の個別承認であり自動解決しない|
|R2 古い一致checkpointで巻戻り|02節9、04節8|active UUIDとaccount単調publication、immutable manifest/祖先/root検証、watermark/state/ledger同CAS。遅延intentと遅延projectionを区別。旧seq/旧世代で退役させない|R2-01〜08|単調publisher/closure/manifestの容量と実装は未検証。全媒体が古いoffline復元は新writer不可となる可用性制約|
|R3 freeze後Admin/seal後chunk/rollbackのTOCTOU|03節9、04節5・8|全writer実書込と同transaction fence、不対応Admin権限停止＋drain、source catalog固定、immutable seal、fresh readyとactivation、rollback前の同barrier|R3-01〜08|全writer/権限停止の実査未実施。非協調writerが停止確認不能なら切替不可。将来Rules/Functions/IAM変更は別承認|
|R4 memory-only/保存待ちdraftの回収不足|01節9、03節5・10、04節7|更新/離脱前原文回収、全contextの入力/IME/timer/queue/通信静止、capture epochとready取消、再capture/backup。旧tabはlockだけで停止としない|R4-01〜08|旧画面の安全取得可否は実機未検証。OSで既に失われた入力は復元保証不可。未確認context/取得不能入力があれば停止|

### P0〜P5 exit条件への追加（節3の条件と両方必須）

|工程|追加exit条件|
|---|---|
|P0|01節8の全source分類と節9の全画面draft回収、原文/全設定/全Historyの独立読戻し。旧open前保護と全context roster。R1-04/07/08、R4-01/02/05/07が停止条件を含め合格|
|P1|typed resource全種、因果intentとpublicationを独立モデル化。R1-02/03/05、R2-01〜08のpure順列で現在値/候補/ledger不変条件を確認|
|P2|capture epoch付きlocal fence、watermark/state/ledger同raw CAS、原文revisionと保存revision分離。R1-06、R2-03/07、R4-03/04/06/08のcrash/失敗合格|
|P3|全writerの同transaction control検査、不対応Admin停止証明、単調manifest公開、seal後同epoch拒否。R3-01〜08をEmulator/DEVで再現し、旧SDK拒否でlocal原操作保持|
|P4|全resourceの機能照合/History/UI回収先、source catalog/page完全性、sealとfresh ready、R2/R3 rollback証明。R1全件、R2-07、R3-04/05/07/08の完全checkpoint独立復旧|
|P5|iPhone PWA/Safari/PC全context、IME/旧tab/ネットワークcallbackの静止とready取消。古いcheckpoint/世代応答の隔離、候補/未完全同期/回復draftのUI確認。R4全件とR2全件の実機対象分|

既存のREQUEST CHANGESを開発担当が解除/解決済みにせず、修正版commitに対するレビュー判断を待つ。部分移行/未知データ例外、Rules/IAM/実データ読取・配信の承認はこの再レビューに含めない。

## 7. この設計PRの検証

製品コード/Rules/既存テストのdiffがないこと、Markdown内部リンク/固定版コード参照の存在、10成果物と12ゲートの対応、commit ancestry/未push混入なしを確認する。設計レビュー前にprototypeや新テスト実装を追加しない。設計の整合確認と将来の実行テストのPASSを混同しない。

**承認前に実装へ進まず、ここで停止する。**
