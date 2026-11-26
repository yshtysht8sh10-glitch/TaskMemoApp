# #117 後続分割・A1原本退避

2026-11-26 / 開発担当。設計正本PR139/e422fbf、ローカル実装PR145/6224b19。
本ブランチはPR145の後続で、PR144のDEV配信には含めない。
PR145のM145-1修正`fcfd1f3`へ再基底し、通信閉鎖の修正も前提として保持する。
その後M145-2/M145-3修正版`559a59b`を依存ブランチから合流した。
main/releaseへのmergeではなく、後続A1へ最新の前提を保持するためのfeature間mergeである。

## 分割と依存

| 差分 | 具体的な成果物 | 依存・停止条件 |
|---|---|---|
| A1（本差分） | 既存standalone backupのIDB-only/未知raw退避。ローカル原本と復旧保証を区別 | PR145の後続。自動復元や通信は接続しない |
| A2 | 原本archiveの検証・隔離復元候補、scope/binding照合、取消/History/Outbox/receipt参照の完全性、draft確定/静止条件 | A1＋PR145修正承認。未知rawを通常Node importへ通さず保護。実データ復元は別承認 |
| B | writer台帳・server fence契約と実装。PWA/Native/再送/Undo/import/repair/Functions/Adminを列挙 | PR139§9.1–9.3。AdminはRulesを迂回する。未確認principalがあればclosed。実IAM変更は別承認 |
| C | protocol3/feature contract/epoch/writer registryの製品判定、各transactionの再検査、同一transactionのNode/receipt拒否 | Bの拒否契約とA2保全。field/path/registry発行責任の詳細をレビューし、自己申告で開かない。実protocol切替は別承認 |
| D | 実capabilityへ連動したOccurrenceメニュー・履歴選択、取消、ワンタップ維持 | Cのserver供給が必要。不明・期限切れ・Auth/epoch変更なら閉鎖。UI flagだけで有効化しない |
| E | R01–R18の不足分を固定旧SHA/複数actor/障害/再起動/backup/rollbackで総合受入 | A2/B/C/D。各試験をlocal/Emulator/実SDK/実機へ分類。未実施をPASSとしない |

B/Cは境界設計と合成試験を先に分け、実環境のRules/Functions/IAM変更、protocol切替、
移行、missed書込み開放は後続Owner承認まで実行しない。PR145が修正要求になれば先に修正し、
それと無関係なA1のstatic原本退避を別差分で保持する。PR144の受入を待たせない。

## A1で確認した問題

`public/v2-recovery-backup.js` はlocalStorageキーが0件だとIndexedDBを読む前に中断していた。
また、件数表示のためのJSON.parse/既知version検査が、壊れたJSONや未知schemaを含む原本の
ファイル退避まで拒否していた。例外停止でsourceが削除されるわけではないが、復旧用の救出経路がない。

8試験のうち追加4ケースを先に実行し、3 FAIL/5 PASSを確認。
IDB-only/破損JSON/未知versionの3失敗を原本救出の再現として使用した。

## A1の変更

- localStorageが空でも既存IndexedDBを読む。両方空なら空backupを成功扱いしない。
- 件数表示は任意の観測へ変更。解釈不能でもrawを一字も変えずarchiveへ入れ、未検証と表示。
- 既存IndexedDBのreadonly transactionで全scope recordを取得し、Journal/Committedだけでなく
  preservedRecoveryJournal、preservedSelfRepairCommitted、authoritativeRecoveryPlan、未知metadataも保持。
- 物理保存形式（scope/fingerprint、rawがstring/null）を検証不能なら安全に中断。
  未知の物理DB/store/schemaを推測して開設・変換しない。
- 未知metadataがDate/Map/undefined/非有限数等でJSON化に損失が出る場合は、ファイル準備を中断し原本を保持。
  異種型・疎配列・参照共有/循環を別の意味へ変換して成功扱いしない。JSON値の未知metadataだけをそのまま保持する。
- archiveにcaptureメタデータを追加し、local-raw、consistentCut=false、automaticRestoreAllowed=false、
  serverReceipts/drafts=not-collectedを明示する。
- JSON parseや集計が失敗してもユーザー内容・UID・rawを画面/ログへ表示しない。
- Firebase/本体の起動、migration、保存領域の書込み・削除、復元入口は追加しない。

通常Node backupへ未知rawを押し込まず、復旧用のopaque原本に留める。
archive全体のSHA-256は既存どおりファイル保存前に提示する。これは破損確認であり、真正性の証明ではない。
snapshot二回一致は静止や排他の証明ではない。書込み/入力が続いている状況のconsistent cutとして使わない。
capture情報は状態の説明であり、旧復元ツールがこの新情報を検証する保証ではない。
復元候補生成と復元禁止条件の実際の強制はA2の別差分で審査する。

## A1の試験

- focused: 8 PASS、skip 0。
- 初回の全体（6224b19基点）: 1299 PASS / 46 skip（169 files PASS / 4 skip）。
- fcfd1f3再基底後の関連backup/Store/Controller: 49 PASS。新headの全体/build結果はPRへ記録する。
- TypeScript、Lint、node --check、git diff --check PASS。
- public変更を含むため、Web exportも固定commitで実施しPRへ結果を追記する。
- すべて合成localStorage/fake-indexeddb/VM。実保存領域・実ユーザーデータにはアクセスしていない。

追加で非JSON metadata4件の4 FAILを確認し、損失検出後はbackup focused12 PASS。
Date/Map/undefined/Infinityが元IndexedDBに残り、共有・書込みが発生しないことを確認した。

## A2以降に残る重大条件

このarchiveだけで完全復旧可能とは判断しない。
ACKでOutboxから消え、serverだけにあるreceipt原操作はローカル全copyにも存在しない場合がある。
実serverからの必要証拠取得・束縛・照合は新たな許可と設計が必要で、捏造/推測補完しない。
編集中の未確定タイトル/本文、debounce、通信中操作、別端末・別タブの未送信copyも別途回収する。
通常backupと完全復旧snapshotを区別し、未回収一覧と停止理由をmanifestへ持つ方針とする。
復旧・rollbackは原本を保護し、自動Journal clear、未送信退役、旧writerへの戻しを行わない。
未知rawの安全な解釈ができない場合、退避成功と操作再開許可を分離して停止を維持する。

## M146-1 物理DB構成の照合

c9df15aの独立レビューで、out-of-line keyや追加storeを持つ同名DBでも、値だけを集めて
ファイル準備成功となる欠落が見つかった。原DBを変更していないことと、完全に取得したことは別である。
既知構成をversion=1、store一覧はscopesのみ、keyPath='scope'、autoIncrement=false、索引なしに限定する。
これは現ApplicationJournalの作成定義と一致する。未知構成の汎用dump/移行は推測実装しない。

5負ケース（外部キー、追加store、未知version、autoIncrement、追加index）を先に実行し5 FAILを確認。
構成照合をgetAll前へ追加してから、backup17 PASS。共有/downloadを有効化せず、元storage keyと
DB version/storeを維持することを検証した。新SHAの独立再レビューまでA1承認とは扱わない。
