# D4 明示移行と復旧の追加契約案

## 1 移行の入口

PR123の方式B（明示一度限り移行）を維持する。読み込み時の無断変換、旧形式データの廃止、iPhone/PCの更新だけで完了とする方式は採用しない。PR131のD1/D2に加え、D3・B方式provider・移行実装の個別承認と本人の実行許可が必要。本書に本番raw/個人情報を使用しない。

旧Nodeと新形式が同じ保存領域やbackupに混在し得ることを前提とする。画面の投影形式と保存rawの形式は同一とは限らない。unknown/schema不明/別UID/scopeは正しい隔離領域に原bytesと来歴を保持し、現役領域へ推測変換しない。

## 2 全データの変換と機能的照合

保存先の物理path/format番号は未割当であり、下記は論理resource契約。実mapping版と完全catalogを実装前レビューで固定する。raw退避だけでは「移行成功」に数えない。

|保存元|移行先と変換|未同期/History/照合・停止条件|
|---|---|---|
|IndexedDB/Committed/Firestoreの通常Node、Category、Idea、tombstone|B baselineの同一ID、全field/unknown field/親子/順位/削除の意味を保持|全resourceの意味とraw対応を照合。件数一致だけで成功にしない。競合原本を片方だけ選ばない|
|Routine定義、repeatRule/startsOn/dueAt|定義baseline。現在ruleを書き換えず、旧source catalogを保存|title/body/時刻/rule/旧field含め照合。旧zoneは不明ならunknownのまま、Tokyoを推定しない|
|routineHistory/routineOutcomes|元OccurrenceRefのresult baselineと原値・優先規則の来歴|同日outcomes優先という旧有効表示と両原値を保存。取消pending/nullを欠落へ変換しない。日付/実行日時/実績を照合|
|routineLifecycle/retained、旧rule来歴|閉じた定義とrelease/source catalog、retained原本|close済みでも保持回を落とさない。現ruleで説明不能な回を削除しない。根拠不足は要確認候補で移行成功不可|
|routineDueOverrides|元keyの旧有効予定とreset来歴。anchor baseとは分離|null、未来ISO、旧当日変更の全値を保持。意味/zone確定まで勝手にclampしない。初回move Undoのbeforeに使う|
|routineDeadlineSortKeys/deadlineSortKey|元ref rank baselineと既存通常Task順位|別回を定義IDだけでdedupしない。元順序とbucket文脈を照合|
|旧仮Occurrence ID|保存し直すTaskではなく、検証付き元tupleへの対応表|文字列形式だけで未知keyを正当化しない。元source/実績/retainedとの対応不明なら保留|
|Journal、raw CAS、保存中Committed|原raw/checksum/CAS基準を保全した復旧候補|未確定Journalをclearしない。保存成功/失敗が不明なままbaselineへ昇格しない。独立根拠で整合するまで停止|
|Outbox、receipt、通信中操作|原操作のintake台帳、受領証跡、未反映義務|already-represented / provable-unapplied / unresolvedを証拠で分類。ACKだけで捨てず、receiptを全再生して完了を復活させない|
|Undo/Redo、History command|旧History保全領域と対応可能な補償履歴|古いNode snapshotを新stateへ適用しない。変換不能な補償は無効理由と原Historyを閲覧/退避可能にし、失った扱いで成功にしない。実用的な引継ぎ/本人確認を別審査|
|常設メモ、設定、表示選択、端末固有値|PR123の全永続catalogと同じlogical resource。端末local/syncの所有境界を保持|本文、theme、期限表示、展開、AI同意等の全keyをcatalog照合。#130非対象という理由で消さない。未知keyは未分類で成功不可|
|編集中title/body、Quick Add、Text workspace、debounce/保存待ち|対象ref/基準heads/入力原文付きのdurable draft退避と明示確定|保存済みrawだけでreadyとしない。入力・timer・保存状態変化でready失効|
|旧backup/新完全checkpoint|原backup保全＋別候補realmへ検証復元|Node JSONだけではgroup/receipt/anchor/source/Historyを復元できない。manifest/member/hash/祖先/不変payload/reflectionと全義務を検証|

旧回のbaseScheduledAtやzoneは、保存済みの検証可能なsourceから自動確定できる範囲と、本人が今後の採用を明示確認する範囲を分ける。LegacyConfirmationは対象tuple集合・原source root・表示した旧値・選んだzone/時刻・確認contextを束縛する。本人確認を「歴史的にそのzoneで保存されていた証明」へ変えない。過去未発生回や#118の将来回を追加しない。

## 3 iPhone PCの準備と排他

|段階|必須条件と失敗時の扱い|
|---|---|
|INVENTORY|iPhone PWA/Safari、PC全tab/context、実行SHA、UID/scope、全保存領域とproducerを列挙。確認不能な端末があればready不可|
|CAPTURE_INPUT|IME未確定を含む原文と対象/基準を先に非破壊退避。本人の確認後に編集確定。blur/unmountで保存が走る可能性も列挙|
|FREEZE_DRAIN|新入力/操作受付、settings writer、timer/debounce、復元、Admin/外部writerをfenceで停止。既受付commit/通信の結果照会を完了または耐久保留へ。Outbox空化/強制同期は要求しない|
|CAPTURE_READY|全tab停止/協調lock確認後、raw＋draft＋pending＋inbox＋設定＋Cloud fence snapshotを取得し、backupを別媒体へ書出し読戻し。capture後もfence保持|
|BUILD_VERIFY_SEAL|同migrationId、fenceEpoch、leaderEpochとsource rootに固定して候補へ変換。全key/全ref/History/原操作を機能照合し、未分類0・不足0・失敗0。seal後はchunk writerも停止|
|ACTIVATE|同fence/epoch/確認済みmanifest/headの比較と新世代pointer確定を不可分に行う。policy初回採用もD1 T1条件を別途満たす。移行activationの成功をpolicy時間保証の代用にしない|
|VERIFY_CLIENTS|両端末で現役generation/manifest、local-only suffix、同期四状態、保護状態を確認。未確認を同期完了と表示しない|

二度読んで同じhashだっただけでは排他ではない。sourceの照合からactivationまで全writerを継続fenceし、そのepochを全保存/commit/切替/rollbackが検証する。leader leaseが切れても旧writer fenceを自動解除しない。全writer参加が証明できなければ切替不可。

readyには入力revision、全producer idle世代、source catalog root、client capture hashes、fence/leader epochを束縛する。入力/保存/認証/世代/source/新旧headのいずれかが変化したらreadyを取り消し、元退避を保持してCAPTUREから再照合する。通信中acceptedの応答喪失を「idleだから未受領」と推定しない。

## 4 障害復旧とrollback

|窓|復旧と禁止事項|
|---|---|
|入力退避前のcrash|未保存メモリ入力の唯一コピーは回収不能になり得る。保証限界を表示し成功判定を止める。保存済み値で黙って代用しない|
|local CAS前/途中失敗、quota|旧Committed/Journal/原操作を保持。メモリ/採番/退役を確定しない。別領域backupの読戻し前に元を削除しない|
|local CAS成功応答喪失|同requestとraw CAS/Journal照合で結果を再確認。不明rawは保護、未確認headの自動採用なし|
|server accepted応答喪失|同opId/payloadで認証されたログを照会。受領済みでも未反映/競合/awaitingは保持。新opへ自動再採番しない|
|candidate作成中crash|source root/epochに一致する完了chunkだけ検証再利用。部分targetをactiveにしない。元raw/未分類候補は保全|
|seal後activation応答喪失|独立controlとmigrationId結果を取得。結果不明なら停止。二重切替、反対方向rollbackの並走を禁止|
|activation後旧offline端末が復帰|旧writerはserver fenceで拒否する設計。原ローカル/Outbox/入力を旧realmへ退避し、認証intakeで意図を照合。旧値の全置換・初期化はしない|
|新backup復元/古いcheckpoint|別候補領域で現役cutと祖先関係を検証。古いref/証跡/未受領suffixを保全し、現役headを後退させない|
|rollback|新方式を理解する互換client/forward fixを基本とする。旧clientへのpointer戻しは禁止。新世代を閉じる場合もepoch付き一意の決定でactivationと排他、全新操作の回収/照合を先に行う|

復旧は本人が対象と結果を確認する手順として別承認する。保護停止の自動解除、Journal clear、receipt/groupのGC、再インストール/キャッシュ削除/再ログインを救済手順にしない。唯一の未受領コピーがローカル消失した場合、serverから存在を証明・復元できない限界はB方式でも残る。

## 5 未決条件

物理schemaと全key catalog、旧Historyの機能的な引継ぎ/補償可能性、LegacyConfirmationの認証供給、各tab/旧producerを止める実fence、全client backup入出力、providerとrollback実行手順は別レビューが必要。rawがあるだけで未解決を成功へ数えず、実データ読取りやmigration dry-runも今回は行わない。
