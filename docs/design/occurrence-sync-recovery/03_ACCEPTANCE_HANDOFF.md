# 合成受入計画とレビュー引き継ぎ

## 1 共通oracle

以下は全件未実施の計画。模擬時計/隔離ストア、日次/週次/月次、複数actor/tabの合成原本を使用する。実ユーザーデータは使わない。各配送順列、各段階のJSON保存復元、重複配送で、state/heads/candidates/checkpoint/History/ledger/receipt/reflection/anchor/source原本を比較する。失敗ケースでは拒否診断の追記以外の既存原本不変を確認する。

|ID|入力・反例|具体的期待結果|
|---|---|---|
|D301|月次O=(R,11/13)、base13日09時、move14日夜＋rank r1|元ref/base/rule不変、schedule14夜/r1の一group。14日は非発生日でも表示可。翌月13日回は不変|
|D302|日次O13を14へ、O14が既存|元ref二つが一件ずつ。O13完了でO14を消さずHistoryも別key|
|D303|1/31→2/1、2/28/閏年2/29、12/31→翌年|元日付/元instant維持、次回clamp不変。別回のheads/results/ranks不変|
|D304|M(S1,r1)→Undo→Redo|両属性(S0,r0)→(S1,r1)、各段階新heads、元group/補償来歴保持。anchorを削除しない|
|D305|M後に別端末rankだけr2→旧Undo|両head照合不成立。S1/r2を無条件S0/r0へ戻さずUndo全体保留、原History保持|
|D306|M後にscheduleだけS2→旧Undo|同様に片側適用なし。S2と元rank、候補と補償要求を保持|
|D307|rank-only r0→r1→Undo/Redo|rankのみ新head、scheduleの値/head不変。context不一致なら保留|
|D308|anchor/schedule/rank/Historyの片側保存失敗、quota、abort|全member未確定。元Committed/Journal/Outbox/採番不変、候補原本を失わない|
|D309|並行M1/M2、Undoとrank-onlyの並行|group代替候補を保全、混ぜたschedule/rankを解決済みへしない。全到着順で同じ候補/ledger|
|D310|同refへ同semantic anchor並行/異semantic anchor並行|前者一identity＋両証拠、後者一ref内の保護候補。別Taskへ分裂/先着上書きなし|
|D311|first anchor前/後/並行にrule変更・close|因果sourceに応じて正当な旧回保全、先行変更無視なし、意味矛盾並行は候補。未release将来回を作らない|
|D312|moveとcomplete(T1)/skip/cancelの並行|元ref上で合成、outcomeの日時一体。完了時観測予定保持。移動Undoで結果を巻き戻さない|
|D313|旧override昼→初move夜→Undo、完了/取消後Undo|before昼＋旧rankへ補償。base夜へ誤復帰せず、結果/他回/旧履歴不変|
|D314|base後に古いat、pending取消後に古いcomplete|祖先の再適用なし。並行なら未解決候補、原操作と旧反映証跡保持|
|D315|R/P1/P2逆転、applied→conflict/protected、別未送信操作|F1/F2/R-F2を維持。受領/過去reflection/現在競合分離、別Outboxを退役しない|
|D316|source後に本文追加、古いsourceでpublication再activation|Pは固有sourceで成功しU残存・complete=false。source/coverage後退activationは拒否|
|D317|member欠落/改変、同ID異payload、未知mode/schema、別UID/scope|成功判定なし、正しい原本領域に保全。group片側state更新なし、別realmへ書込なし|
|D318|local CAS前crash/成功応答喪失、accepted応答喪失、再起動|同ID結果を照合し二重適用なし。不明headは停止、Journal自動clearなし|
|D319|長期offlineでzone変更/DST gap-foldを跨ぐ|既存anchor不変、新releaseは認証source待ち。表示zoneで元ref変更なし。不明instant候補を捏造しない|
|D320|T0=11/14 14:59Z、T1=15:01Z、旧+09→新UTC、B15、未anchor O15|F14→15、activation拒否。旧区間不変、O15 base=11/15 14:00Zを保持する根拠、request B15/T0/T1/F/拒否証拠を保全|
|D321|D320で旧O15 anchorあり/anchor要求が前・後・並行|全順序でB15拒否。元ref/base/anchor不変、未適用request残存。anchor件数をF根拠にしない|
|D322|B16を別途確認して同T1、またはB15を14:59:30Zで確定|前者F15<B16、区間旧D<16/新D>=16、O15旧anchor/base保持。後者は未releaseのO15旧anchorがない正常入力でF14<B15、旧D<15/新D>=15、O14原本保持、O15を先行anchor生成しない。両者request結果/T1/F/Bを一回だけ確定|
|D323|Tread境界前、commit境界ちょうど/不確実幅が境界跨ぎ|B>Fが確定点で偽なら拒否。transaction内先読みだけを成功にしない|
|D324|cut後config/close/policy/Auth/epoch変更、期限切れ|旧確認を使わず保留/拒否。現役の正当変更は保持、本人が新context/Bを確認|
|D325|切替成功応答喪失→後続policy変更→旧成功照会/重複|旧成功事実のみ回収。現役区間/frontierを戻さず二重activationなし。同ID異Bは拒否|
|D326|切替前abort/失敗→時間経過後再送、旧Routine初回採用|新判断点のF再検証。旧成功結果なしなら古T0で成功にしない。zone不明/F不明は保留|
|D401|旧/新Node混在、outcome/History/null/retained/未来override/unknown fields|全rawと有効意味をtargetへ対応。未知は要確認、削除/clamp/現在ruleでの作直しなし|
|D402|旧Outbox＋receipt、競合負け操作、同値再送|3分類を根拠で照合。ACKだけの退役なし、正当未反映はintake、旧完了再生なし|
|D403|iPhone/PC入力中IME/debounce/通信中でready要求|原文退避→確定→freeze/drain→最終backup読戻し前はready不可。後発入力でready失効|
|D404|source照合後の遅延commit/Admin、leader失効、二leader、rollback並行|同fence/epochで書込拒否または再照合。二回read一致で成功としない。切替決定は一つ|
|D405|途中chunk失敗/再起動、seal後応答喪失、古backup/異世代/改変|原本保持、検証済み同root chunkのみ再利用。別候補領域で復元、現役head後退なし|
|D406|常設メモ/設定/Historyの一種類だけ欠落、raw backupには存在|機能的引継ぎ未完了で移行成功不可。全catalog/履歴/可用性の照合を要求|
|D407|activation後旧offline端末復帰、新操作後rollback|旧writerを拒否する実fence待ち。旧local操作を退避intake、新世代を理解する復旧のみ。旧client全置換なし|

## 2 判定単位と未解決事項

|単位|今回依頼する審査|実装前に残る条件|
|---|---|---|
|D3論理契約|resource/anchor/group/read-set、競合候補、Undo/証跡、B cut対応|exact wire/schema/codec/reducer/coverage/resultの追加設計固定、PR129 N1-F1/F2の是正と再承認|
|D3 temporal provider|T1での時間とstate条件の不可分性、全writer参加、応答喪失|実provider成立性は未実証。供給不能ならactivationを閉じる。mock PASSだけで公開不可|
|D4 mapping/runbook|全データ機能的照合、freeze/drain/入力退避、原本/backup/rollback|全key inventory、旧Historyの補償方針、旧writer停止の実供給、未同期端末の回収と本人の実行許可|
|D5|今回未審査|実SDK/隔離DEV/実機、配信・移行の別指示|

## 3 安全な実装分割の提案

1. 設計レビュー後、合成のみのOccurrence resource/anchor/source validatorとatomic group reducerを隔離実装し、D301–317を回帰にする。既存pure APIや保存経路へ直接差し込まない。
2. B方式保存入口が別途承認された後、group/source/Historyを含む完全snapshotのCAS/Journal/inbox復元を隔離検証する。
3. temporal providerの供給可能性を独立に審査する。証明できるまでpolicy/初回採用activationは閉じる。保証を弱める代替は別設計へ戻す。
4. D4の完全catalog・変換・機能照合・入力退避・再実行・rollbackを合成dry-runで検証する。既存データには接続しない。
5. 以上の個別承認後にのみ、実SDK/DEV/実機・UI・リリースの別計画を審査する。

今回の確認は文書差分・リンク・計画との整合とgit diff --check。製品テスト/型/Lint/buildや33ケースの実行はしていない。PR131の承認済み文書・#107実装を変更せず、レビュー依頼後停止する。
