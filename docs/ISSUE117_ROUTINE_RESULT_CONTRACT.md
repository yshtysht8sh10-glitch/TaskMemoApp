# Routine実績3状態と同期互換性の設計レビュー

開発担当から独立レビュー担当へ。今回の優先範囲はRoutineの元Occurrenceに対する完了・スキップ・未達と取消。一般Task、履歴フィルター、再利用は後続に分離する。製品コード・保存schema・同期実装は変更しない。#137/#138の読取表示は独立して進める。

## 1 現在確認できた互換性問題

基点はProduction相当ソースe18c4d1。models/node.tsのRoutineOutcomeはcompleted/skipped/pendingだけ。domain/routineOutcomeMerge.tsのvalidRoutineOutcomeも同じ3値で、未知stateをmergeから除外する。services/nodeBackup.tsも同じvalidatorを使い未知stateのbackupを拒否する。

合成`{state: missed, changedAt: ISO, version:2}`を既存関数に渡し、validator=false、merge結果から当該日消失、backup読込拒否を再現した。実ユーザーデータや本番被害の確認ではない。artifact `artifacts/routine-priority/117-compatibility.ts` の実行結果は上記3点と入力raw不変の確認。初回実行は新worktreeの依存junction不足で起動失敗し、junctionを用意して再実行した。これは製品修正ではない。

したがってUIとNode型だけを足してmissedを保存する実装は行わない。本件は小さなenum追加でも同期契約の変更であり、独立レビューと段階導入が必要。#107の未承認大規模改修を取り込んで解決した扱いにしない。

## 2 提案する最小契約

|項目|提案|
|---|---|
|identity|安定definition ID＋元日付YYYY-MM-DD。名称/実操作日/現在の周期から対象を決めない|
|明示状態|completed=完了、skipped=スキップ、missed=未達、pending=取消。状態名missedは新規wire値案で、このPRで割当確定しない|
|保存先|既存routineOutcomes[元日付]の同日registerを拡張。新正本mapを二重に作らない。routineHistoryは#100のlegacy互換規則を維持|
|更新|state/changedAt/versionを一体で更新。changedAtは実操作時刻、keyは元対象日。次回rule/startsOn/定義status/他日付を変更しない|
|取消|どの終了状態も明示pending＋増分version。map/key削除による取消は禁止。元履歴に完了値があれば対象日だけnullにして古完了へのfallback復活を防ぐ|
|競合|既存version→changedAt→stateの決定規則を維持する案。新値追加後の同version/同時刻優先はskipped>pending>missed>completed。旧3状態間の順は変えない。因果競合を完全解決した保証へ拡大しない|
|版上限|正の安全整数、次版が範囲外なら保護/失敗。自動0再開/時計優先へ切替しない|
|結果表示|文字で完了/スキップ/未達を明示。pendingは過去実績に表示しない。本日生成未処理のみ「-」。自動未達はない|

routineHistoryとoutcomesが同日にある場合は引き続きoutcomes優先。既存key/value/unknown fieldを全件変換したり、表示を契機に保存しない。新missedを知る旧形式Nodeはそのまま読める設計を必要とし、旧データの廃止と旧writer停止を混同しない。

## 3 操作対象と現在ruleの分離

既存setRoutineOutcomeはisRoutineDueOnによって現在ruleを再検査する。このため、周期変更前の保存済みスキップを取り消せない場合がある。#137は表示だけを直し、この書込契約を無断で変えない。

合成で11/18の保存済みskipを持つ定義を毎月11/25開始へ変更した場合、clearRoutineSkip(11/18)が現在rule検査で対象日エラーとなることも再現した（artifact 117-old-skip-cancel.ts）。これを解消済みとはせず、過去結果を根拠とした対象検証を下記のレビュー対象とする。

新結果commandは対象のRoutine IDと元日付を固定し、次のいずれかの根拠を必要とする。

1. 現行生成処理がその日に生成している本日/過去未処理回。
2. 現在ruleに一致しなくても、そのRoutineに保存された検証可能な既存結果/日別registerがあり、その対象日への変更・取消であること。

単なる日付文字列、名称一致、nullだけの未知旧History、未来候補からは過去回を作らない。保存済み結果を根拠とする範囲と、根拠不足の旧取消記録からの再操作は実装前テストで固定し、不明なら原本を保持して操作を保留する。これは#130 anchor/延期の導入ではない。

UIは一覧の既存ワンタップ完了を維持し、Occurrenceメニューへスキップ・未達を追加。終了結果のある履歴には各状態の取消を提示する。Routine本体close/削除メニューと文言/commandを分離する。編集画面は#137/#138の共通正規化へmissedを追加するだけで、現周期から履歴を作らない。

## 4 保存 同期 Undo Redo

local commandは既存atomic保存/raw CAS/Journal契約のまま、対象日の更新とHistory/Outboxを一単位で確定する。保存成功前のUI確定・採番消費・Outbox退役は禁止。server receiptは受領であって状態反映の独立証明ではない。既存の保護停止を緩めない。

replayRoutineDates、revisionModel、firebaseNodeCodec、backup/storage/hydration、全producerのvalidator/codecを同じ契約へ対応させる。Undo/Redoは対象日の新versionを作り、他日付の最新寄与を保持する。旧Node全snapshotでremote結果を消す実装は禁止。remote変更で既存Undo identity条件が合わなければ既存同様に失敗/保留し、無条件上書きしない。

missedをUndoするとbeforeのcompleted/skipped/pendingへ新操作として戻し、Redoはmissedへ新操作。完了からmissedへ変更する場合も旧完了の現在表示を復活させず、元操作/History/receiptの来歴を保持する。古missedや古completed再配送、応答喪失、保存失敗で取消を巻き戻さない。

## 5 導入順と旧writer

|候補|評価|
|---|---|
|UI/typeだけ先行|旧mergeで消失、旧backup拒否となるので禁止|
|別mapへmissedだけ保存|旧結果との二重正本/競合/取消を新たに作るため非推奨|
|既存日別registerの明示拡張＋機能別能力gate|推奨。ただし全読取/書込/backup経路と旧writer停止の実供給を確認するまでmissed書込は閉じる|
|#107新同期へ全面依存|今回の限定改善を大規模未承認実装へ拡大するため採用しない。将来契約へのmappingは別レビュー|

推奨導入は、合成試験と互換schemaレビュー→未知stateを消さず保護する準備版reader/backup→全server producer対応→iPhone/PCの実行SHAと未同期/draft/backup確認→旧writerのserver側fence確認→機能gate開放、の順。実行順は実provider/現配信構成の別調査後に確定する。

アプリのversion表示だけで旧PWA writerが止まったとはみなさない。Admin/Functionsを含む全writer一覧とserver制約が未確認なら有効化不可。Rules/control変更が必要なら別設計/実行承認で、今回は実施しない。feature gateはローカル設定だけを信用しない。

準備版も旧readerへmissedを流さないことが必要。既存の未知state原本を見つけた場合に削除/初期化/勝手なcompleted変換をしない。現存する未知stateの有無は実データ未確認であり、今回の合成結果から本番に存在すると断定しない。

## 6 backupとrollback

新形式の完全backupは3終了状態、pending取消、対象日/操作日時、全日別register、History/Undo/Redo/未同期/receiptと原本を保持する。通常Node JSONと完全復旧snapshotを区別する。未知値を落として読めたことを成功にしない。旧backupのcompleted/skipped/pendingは移行書換えなしで読めることを固定fixtureで確認する。

missed書込後に旧reader/writerへ戻すrollbackは禁止。対応済み互換版へのrollback/forward fixを基本とし、原本/未受領操作を残す。再インストール、Journal/Outbox削除、強制同期による回避はしない。

## 7 実装前ゲートと受入計画

|ID|試験|必須期待結果|
|---|---|---|
|R01|完了/スキップ/未達を日/週/月/年Routineの元回へ選択|各文字表示、元ref不変、次回発生/rule/他回不変、定義close/削除なし|
|R02|日次→週次後の過去結果変更/3状態の取消|保存済み元日付が対象、現在ruleで失われず、新pending版、過去取消は実績から除外|
|R03|同日3状態混在の複数actor、完全同時刻/版、逆配送|同じ最終register/原操作、旧3状態の結果不変。旧revision契約の限界は別記|
|R04|未達→取消後に古未達/古完了、重複ACK/再起動|取消が復活せず、原操作/receipt保持、別未送信操作退役なし|
|R05|3状態それぞれUndo/Redo、別日remote更新|対象日だけ新version、他日の寄与保持、remote identity不一致は保護/失敗|
|R06|local CAS/Journal失敗、quota、保存/accepted応答喪失|元raw/Journal/Outbox保持、保存前確定なし、同ID照合で二重適用なし|
|R07|旧backup/newbackup、JSON/IndexedDB再起動|全状態/日時/取消/Historyの意味保存。未知を落とした成功なし|
|R08|旧writer/準備reader/未対応server混在|missed受付/書込gate閉鎖、旧原本保全。validator通過だけで安全とはしない|
|R09|同名別Routine、今日未処理、今日完了、未来/未記録過去|ID/元日付一致、今日一行、未来/架空回なし、#137/#138共通取得と一致|
|R10|#137/#138との統合、0/少数/大量、全件展開|降順・欠落重複なし。閲覧による保存/同期変更なし|
|R11|新状態後のrollback、長期offline旧端末復帰|旧版へ全置換しない。未同期/draft退避、fence照合、保護自動解除なし|

R01–R11は全件未実施の受入計画でありPASSへ数えない。#137の完了/スキップ表示回帰のPASSはmissed保存の成功ではない。

## 8 レビュー依頼と残存判断

独立レビュー対象は、wire値/優先順、過去結果の対象検証、全保存経路、機能別gate/旧writer停止、backup/rollbackの限定拡張。実装や本番有効化は承認しない。全writer能力確認と実server fence、未知形式の保護方式、旧取消だけの回の再操作条件は未決であり、判断せず実装停止する。

承認後に純粋validator/merge/codec/backupと隔離Application試験から実装し、その後UIと実DEV検証を別段階にする。今回は製品コード・SDK・Rules・実データ・移行・配信・#107/#130・Issue状態を変更せず、レビュー依頼後停止する。
