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
|更新|state/changedAt/versionを一体で更新。新commandのchangedAtは実操作時刻をUTC・ミリ秒固定の`YYYY-MM-DDTHH:mm:ss.sssZ`（Date.toISOString）で生成。keyは元対象日。次回rule/startsOn/定義status/他日付を変更しない|
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

独立レビュー対象は、wire値/優先順、過去結果の対象検証、全保存経路、機能別gate/旧writer停止、backup/rollbackの限定拡張。実装や本番有効化は承認しない。以下9節で指摘M139-1/2/3に対する具体的な契約案を定める。設計案の採否・実装・Rules/Functions/IAM配信・有効化は別の承認とし、今回実行しない。

承認後に純粋validator/merge/codec/backupと隔離Application試験から実装し、その後UIと実DEV検証を別段階にする。今回は製品コード・SDK・Rules・実データ・移行・配信・#107/#130・Issue状態を変更せず、レビュー依頼後停止する。

## 9 2026-11-25固定commitレビューへの修正契約案（未実装）

元レビューは`0df71e3`、技術判定CHANGES_REQUESTED。以下はその修正提案で、現行に既に存在するgateと混同しない。新wire状態名は`missed`、優先順は`skipped > pending > missed > completed`を提案として固定して再審査する。既存3状態の相対順、日別versionと安定IDは維持。#140/#141は本契約を取り込まない。

### 9.1 能力と旧V2 writerの拒否点

現在の`minimumSyncProtocol=2 / v1WritesAllowed=false / v2Enabled=true`はV1/V2の区別だけで結果状態の能力を証明しない。build表示・ローカルfeature flag・Auth UIDだけでも証明にならない。

将来の互換gate案は、既存V2 record/schemaVersion=2を維持しつつ、**同期能力の最低protocolを3へ上げる専用cutover**とする。これは#107の新しい同期方式やデータ移行ではないが、Rules/Functions/controlの契約変更を必要とするため今回未実施・別承認必須。全producer対応不能なら本案を採用せずmissedを閉鎖し続ける。

| 将来の識別/制御 | 具体的契約案 |
|---|---|
| account compatibility | minimumSyncProtocol=3、v1WritesAllowed=false、v2Enabled=true。現行旧Rules/protocolSelected(2)と旧Functions.assertGateの`minimumSyncProtocol!==2`が拒否になる。新Rules/Functionsだけがprotocol3を扱う |
| feature control | server管理の`routineResults={contract:'routine-results/1',epoch:N,mode:'closed'|'prepared'|'enabled'}`。欠落/未知/epoch不一致は書込不可。preparedでは未知保全reader/backupだけ、missed発行不可 |
| writer capability | 対応済みbinaryのcompile-time contractとwriterId/deviceId、epochを**各書込の外側envelope**へ必須付与。PWA/Native/UI/バックアップimport/Undo/再送/自己修復も同じ識別。未検証buildをserver管理registryで許可しない |
| 認証/信頼 | registry/feature controlはclientから変更不可。自己申告文字列だけで意味保存能力を保証しない。固定旧binary・更新済みbinary・全server writerの試験/配信証拠を必須にし、未知raw保護の意味検査を併用 |
| Rules拒否点 | nodesV2 create/update、profileV2、syncOperationsV2 receipt create/update、repair lock経由もprotocol3/contract/epoch/writer一致をtransaction内で検査。新APIがない旧書込は別field編集も拒否。単独receiptや旧opIDの受領書だけ通して退役させない |

旧outboxに新metadataが保存されていたケースも、payload/operation内の自己申告を能力証明としない。旧adapterが組み立てる外側record/receiptに必須識別がなく、旧gateもprotocol2なので、古い未送信・Firestore persistence再送はtransaction全体が拒否されることを固定旧SHAで検証する。ノードだけ/receiptだけの部分成功を許容しない。

選択肢のうちV2のままUIだけgateを開く案は採らない。protocol3は提案値であり現配信の番号を今変更するものではない。切替前はglobal write fenceでquiesce→原本/未送信を保全→新Rules/全server writerの拒否証拠→対応端末確認→account gate切替→整合再取得→feature開放の順。各段階の応答不明は再開しない。旧端末を一括clear/強制同期して条件を満たした扱いにしない。

### 9.2 全producer・Functions/Admin

| writerと実コード | 将来必要な対応/拒否点 |
|---|---|
| PWA/Native通常編集・Routine操作・外部入力 | `TaskMemoV2ApplicationStore` command/hydrate/receive/replay、`revisionModel`、`firebaseSyncAdapter` transaction直前。titleだけの変更も最新日別registerとunknown rawを失わない |
| 同期再送・Undo/Redo・自己修復 | controller/Outbox、repair transaction、journal/backup importの全経路。旧世代の全snapshotを新capabilityへ単に付け替えない |
| Functions外部AI | `functions/src/firestoreNodeRepository.ts`の`assertGate`をread/transactionの両方でprotocol3/feature contract/epochへ対応。Nodeとoperation/receipt/request/auditを同一transactionで検査。旧FunctionsはminProtocol=3を拒否し、古いactive revisionも撤去/ルーティング停止を確認 |
| Onboarding/provision | Functions onboarding decision/repositoryが新規accountを勝手にenabledにしない。closed/preparedと対応protocolを明示。旧onboardingがprotocol2を再作成する競合を防ぐ |
| Admin/移行/復旧/運用script | `scripts/production-admin.ts`とlib、その他Admin SDK/REST commit主体を棚卸し。各write transactionに同じepoch/precondition/原本検査と監査。raw Admin SDKはRulesを迂回するので、旧principal/旧credentials/未対応revisionの書込IAMを停止・証明できるまで有効化不可 |

gateを読む実装がない旧Adminは、compatibility docだけでは拒否できない。IAM/実行主体/配備revisionの変更は別実行承認とする。未確認主体が一つでもあれば「全writer停止済み」とせずclosedのまま。Functions/AdminをUI feature flagで止めたと主張しない。今回この一覧の実配信主体・実IAMは未確認で、コード上の必要拒否点を列挙した段階。

### 9.3 offline再送・unknown raw・再開条件

受信rawをDomain merge/正規化へ渡す**前**に、未知state/未知contract/不正register/非対応changedAtを検査する。unknownがあるRoutineはタイトル編集も含め書込保護し、原rawと出所/hashを消さず保持する。未知をcompleted/pendingへ変換したり、空mapで保存したりしない。新しい保護領域はopaque原本であり、第二の結果正本ではない。表示は「未対応の結果あり・編集保留」とし、unsupportedを新しい未処理回として生成しない。

準備版backupはopaque raw/保護理由/Journal/Committed/Outbox/History/receiptを損失なく保全できる必要がある。通常Node importへ無理に通さず、未知を含む復元は対応版以外で保護/拒否する。旧readerの欠落を「読めた」と数えない。実際の保護領域やbackup codecの変更は今回未実装。

offline旧操作はFENCE_OLD/permission拒否で保留し、ローカルの未同期・draft・元raw・opIdを退役しない。upgrade後はserver gate/epochを再取得しauthoritative結果と原本を比較して、対応済みcommandだけを新しい操作として再評価する。旧snapshotへcontract番号を足して自動再送しない。応答喪失は同opId/receipt/反映結果を照合し、receipt受領だけで原本一致とみなさない。

再開条件は対応実行SHA/全capability、server gate/epoch、unknown原本の保持と解釈可能性、未送信/Journal照合、必要なユーザー判断がすべて揃うこと。ローカル保護を時刻だけで自動解除しない。protocol3導入後の旧PWA/Nativeへのrollbackは不可、対応済み互換版へのrollback/forward fixだけ。古いbinaryのオフラインlocal挙動までserver fenceが修正すると主張せず、旧artifactへ戻さない運用と更新前原本保全を別に必須とする。

### 9.4 未達と「過去未処理」の区別・取消後の復帰

`missedRoutineOccurrences`は未記録の期限超過候補を作る既存関数名で、保存済み`state=missed`の別名ではない。生成側へ共通の`isFinalRoutineOutcome`判定（completed/skipped/missed）を適用する契約とし、`routineOccurrenceDueAt`、過去未処理生成、deadline投影、操作可否、完了一覧、共通履歴取得を照合する。

| 保存済み元回の状態 | 本日/過去未処理投影 | 実績/取消 |
|---|---|---|
| completed/skipped/missed | 同じID＋元日付を生成しない（当日missedも過去missedも除外） | 各結果を文字表示、対応する取消commandだけ許可 |
| pendingが有効な勝者 | 現在の生成規則・startsOn・定義lifecycle・既存の対象期間が**その元日付を生成する場合だけ**復帰 | 過去実績には非表示。本日生成なら「-」1行 |
| 周期変更前の旧結果を取消し現rule非該当 | 架空の未処理を作らない。旧日付を新ruleへ移し替えない | pending/来歴を保持し実績から除外 |
| 根拠のないnullだけの旧取消/unknown | 操作で新しい過去回を生成しない。解釈不足は保護表示 | 日付だけで再操作不可、別の救済判断まで保留 |

対象day registerのpending取消は旧routineHistory同日完了へのfallbackを遮断する。次回発生/rule/startsOn/他日付/定義close状態は変更しない。取消しただけで定義resumeや全履歴再生成を行わない。Undo/Redo/同期受信/再起動でも同じ最終状態→生成可否を再評価する。#140/#141ではこの新終端判定を無断追加しない。

### 9.5 changedAtと互換性限界

新commandはUTCミリ秒固定ISOを生成し、versionは正の安全整数、次versionが上限なら保護停止。Date.parse可能な任意文字列を新commandから書かない。新対応経路の同version/同canonical changedAtは上記state順。既存mergeはchangedAtの**文字列比較**であり実時刻比較ではない。

旧offset ISOはraw/backupにそのまま保持し、受信/表示を契機に全件正規化しない。既存データ全体の比較規則をDate.parseへ変更することも本件に便乗させない。対象registerに非canonical旧時刻があり新結果との比較の意味を保証できない場合、その結果操作を保護/保留し、別の互換対応承認へ送る。旧3状態の比較fixtureを残す。UIの表示用Date.parseと競合winnerの比較を混同しない。

### 9.6 追加受入条件（すべて未実施）

| ID | 必須試験 |
|---|---|
| R12 | 固定旧V2 PWA/Nativeからmissedを含むRoutineのtitleだけを編集、古い全snapshot/receipt単独再送も拒否。原server raw/元Outbox保持 |
| R13 | 新metadataを含むOutboxを旧adapterで再送、gate切替中のoffline復帰・応答喪失・Firestore再送。部分commit/誤退役なし |
| R14 | 旧FunctionsのminProtocol=3拒否、新Functions transactionのepoch変更拒否、旧Admin/IAMと未対応writer不在の実証。AdminはRules試験だけで成功扱いしない |
| R15 | unknown state/fields/壊れたchangedAtを含むrawのhydrate/receive/別field編集/backup/再起動。byte/hash原本保全、空mapやpendingへ変換しない |
| R16 | 当日missed→通常一覧なし、過去missed→期限超過再生成なし、pending取消→現rule/対象期間が一致する回だけ復帰。同期/Undo/Redo/再起動/次回不変 |
| R17 | 同versionのoffset時刻09:00+09:00と01:00Z、canonical新値/非canonical旧値、同時刻state tie/版上限。時刻順と文字列順の限界を隠さない |
| R18 | 未対応オンボーディング/復旧script/配備revision/旧端末が残ればfeature closed、gate不明/取得失敗も自動開放しない |

設計レビューの7人工反例や既存Emulator成功はR12–R18の新gate実装成功ではない。全server/Rules/IAM条件は設計の受入条件であり、今回のDEV表示検証から能力確認済みへ昇格させない。修正文書を固定SHAで再レビューし、製品実装・missed有効化・同期schema変更・実配信へ進まず停止する。
