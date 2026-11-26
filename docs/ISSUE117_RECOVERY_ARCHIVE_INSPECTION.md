# #117 A2a: 原本archiveの隔離候補検査

## 範囲と依存

A1 PR #146 b869e43を基点とする。PR #145のローカル結果モデルを含むが、
本差分は通常アプリ、standalone backup、保存・同期・復元入口に接続しない。
`inspectRecoveryArchive` は渡された合成バイト列だけを検査し、SDK/IndexedDB/localStorageへアクセスしない。
A2全体の完成・完全復旧・実環境の未達有効化とは扱わない。

## 状態と禁止条件

| 入力・遷移 | 出力 | 原本・復元 |
|---|---|---|
| 入力受付 | 呼出元から独立したUint8Arrayコピー | 非同期hash中の入力変更でも保全 |
| 外部提示SHA-256、origin、scope、呼出元generation一致 | 検査開始 | SHAは真正性証明ではない |
| hash待機中のAuth/scope/generation変更、hash取得失敗、不一致 | protected、候補0 | コピー保持、復元禁止 |
| 不正UTF-8/JSON/未知形式、対象scope未回収 | protected、候補0 | 置換decode・推測補完しない |
| Committed/Journal/旧localStorageコピー | 個別のlocal-shape-only候補 | 勝者選択・自動Journal clear・head採用なし |
| 不正な局所構造、History対象不一致、同一opId異payload | protected、全候補破棄 | 元archiveバイト列を保持 |
| 局所検査成功 | candidate-only | **restoreAllowedは常にfalse** |

bindingのgenerationは呼出元の作業セッション失効確認であり、archiveの世代真正性や
current server headを証明しない。外部SHAも利用者が別途保有する値との比較であり、
同梱の自己申告値をauthorityへ昇格させない。別scopeを候補へ混入しない。

## 局所検査

- V2 envelope/device/nextLocalSeq、domainのID/revision、既知Nodeデコード可否。
- Outboxの操作ID、対象、型、局所seq、baseRevision、日時、配送状態、Routine結果の読取可否。
- Committed/Journal間の同一opIdは不変payload全体をcanonical比較する。
  retry状態/試行回数/次回試行/エラーだけを比較から除外する。原操作はraw内に保持する。
- HistoryのresourceType/ID、before/after、forward/undo版、Outboxに現存する参照先の対象一致。
  完了取消等で版が再採番されるため、History snapshotと現在op payloadの全面一致を要求しない。
- 退役済み操作のHistory参照は欠落証拠として明示する。seenOpIdsをreceiptや反映証明にしない。
- profile/設定/ownership/preservedRecoveryJournal等の全情報は原本rawに保持するが、
  この検査だけで全フィールドの意味整合性を保証しない。未知rawの復元/変換は実装しない。

## A2b以降の必須条件

固定して返す未回収条件はserver receipt、編集中入力、consistent cut、復元authority、reflection照合。
archiveのcaptureがcomplete/automaticRestoreAllowedを自己申告しても解除しない。
別端末/タブ、debounce、通信中操作、未確定タイトル/本文、ACK済み原操作の回収は未実装。
二回の読み取り一致を静止・排他の証明にはしない。

今後、アプリ入力確定→新規操作停止→遅延commit/通信の静止→全copy採取→server証拠照合→
明示された復元先への別承認、を独立した契約と試験にする。準備後に入力・binding・保存状態が
変われば失効させる。実server読取やユーザー領域の復元は本PRの対象外。

## テストと残存リスク

合成archiveと純粋関数のみ。局所History/Outbox検証の追加6例は修正前5 FAIL/14 PASS、
修正後19 PASS。その後、呼出元バイト改変と別History対象の例を追加し21 PASS。
A1原本退避17件を含むfocused 38 PASS。全体・型・Lint・Web結果はPRへ固定SHAと共に記録する。
未検証: 実SDK、実端末、完全復旧、サーバーreceipt真正性、暗号化archive、巨大ファイルの上限。
JSメモリに載る範囲の検査であり、大規模archiveへのストリーミング/上限設計は別途必要。
unknown/privateデータをログへ出力しない。検査失敗から自動復元・保護解除へ進む経路は存在しない。

## M149-1 正当なHistory snapshotの検証責務

独立レビューで、同じNodeのbefore/afterを一つの一覧decoderへ渡すとID重複で拒否し、
子Nodeのsnapshot単体も親不在で拒否する問題が見つかった。Domainは同時点の全体集合として検査するが、
Historyの各imageは別時点の部分情報である。image専用の形状検査でID/種別/rank/日時/本文/結果を検査し、
当時の親グラフを現在Domainから推測して埋めない。親IDの型・自分自身参照は検証する。
親を持つimageはHISTORY_GRAPH_UNVERIFIEDを明示し、candidate-only/restoreAllowed=falseを維持する。

修正前は単一更新例1 FAIL/21 PASS、公開Storeのupdate/Undo/Redo追加後4 FAIL/21 PASS。
独立レビューも公開Store由来の更新/子作成2 FAILを記録した。修正後は、公開Storeからの
update/Undo/Redo、子作成/移動/削除、完了/スキップ/未達/取消を含む36 PASS。
不正title/parent型/自己親/日時は引き続き拒否し、原本bytes/raw/History/Outboxを維持する。
テストfixture作成中の7失敗（atomic persistenceの欠落、引数とRoutine親種別）はfixtureを
公開APIへ合わせて修正したもので、製品の修正前FAILへ算入していない。
