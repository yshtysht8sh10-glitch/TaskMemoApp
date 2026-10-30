# Routine定義の完了と再開 (#109)

## データと生成

Memoのstatus/completedAtと日別routineHistory/routineOutcomesは変更しない。
任意のroutineLifecycleにversionとperiodsを保持する。未設定は従来どおり有効。
各periodはcompletedAt/resumedAtと、完了時までに発生していた日付ごとの期限retainedを保持する。
当日分は締切前でも既に生成される現行仕様に従って保持する。
完了前の完了・スキップ済み日付も期限を保持し、実績そのものは既存の日別Outcomeを参照する。
完了期間の新規日付を除外し、再開日も締切が再開時刻より前なら生成しない。
既存の期限上書き・日別手動順位は保持し、明示的な期限変更を引き続き適用する。
周期設定・startsOnは変更しない。完了・再開を繰り返しても前の除外期間を残す。

## 保存・競合・History

新規移行や読み込み時の書き込みはなく、ユーザー操作を単一Commandで保存する。
IndexedDB/V2 codec/バックアップに追加情報を保存する。バックアップおよびV2受信時に不正な期間を拒否する。
Lifecycle全体をversion付きの一つのregisterとしてmergeする。
本文だけの古い更新はLifecycleを消さない。同じversionの同時操作はシリアライズ値で決定的に収束させる。
Undo/Redoは対象の期間全体を復元し、新しいversionを発行する。日別実績は既存のmerge方式を維持する。
この同期処理はWebのFirestore transaction adapterが利用し、Rulesや認証ポリシー変更は不要。
共有コードを使うFunctionsもビルド・テストするが、この作業では配信しない。

## UI

Routine編集の確認付き「Routineを完了」。既存の未完了Taskと実績を残す説明を行う。
定義だけを通常ツリーから隠し、「完了を表示」で元のparentId/sortKey位置に表示する。
完了済み定義のチェックボタンで日々の実績を誤変更しないよう、ツリーではメニューだけを残す。
「完了」タブ→「完了済みRoutine一覧」で定義単位の完了と解除を表示する。
「実施履歴へ戻る」で従来の完了・スキップ履歴を表示する。
親Routineは存在しないモデルのため、対象Memo一件だけを操作し、Categoryや別Memoへ連鎖しない。

## 検証と実機ゲート

issue109Regression / routineLifecycleRegister / issue109Application / RoutineCompletion.testで
停止、既存Task、同日・期限後再開、繰り返し完了、日/週/月/年、設定変更、履歴、UI、
バックアップ、IndexedDB再起動、同時本文更新、Undo/Redoを確認する。
firebaseEmulatorV2.e2eの追加ケースはdemo-taskmemo-v2だけを使用する。
実Firebaseの再ログインとiPhone Safari/PWAはユーザー確認待ち。全端末を新DEV版へ更新して確認する。
Production配信・データ変更、Issue Closeは行わない。
