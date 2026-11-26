# #117 Routine実績・隔離ローカル実装の引き継ぎ

2026-11-26 / 開発担当。設計正本はPR139 / `e422fbfa40d2ebecd245123a2f827040a3974dae`。
実装開始のOwner承認に基づく。**機能全体の完成、DEV有効化、旧writer停止の完了ではない。**

## 分離と実装範囲

PR144の統合ブランチ `6329c547162dbbb16018c23b11613381ecb04a63` を基点とする別ブランチ。
リリース①へ本差分を取り込まず、履歴改善を本件の完成待ちにしない。
製品入口から`isolatedRoutineResults`を渡す箇所、`onResult`を有効化する箇所は追加していない。
新しいProject・接続ガード対応・#107新同期・#130延期モデルを導入しない。

実装したもの:

- routineOutcomesの日別registerにmissedを追加。既存version→changedAt文字列→stateの比較を維持し、
  同条件ではskipped > pending > missed > completed。旧3状態の相対順は不変。
- 共通のsetRoutineResult/clearRoutineResult。保存済みregister/有効な旧完了、または現行の発生根拠を検査。
  元Routine ID＋元対象日を保持。未来・根拠のない過去回を作らない。
- 完了・スキップ・未達を終了結果として未処理生成から除外。取消は増分pending。
  周期変更前の結果も操作可能。旧rule外の取消から架空の未処理を作らない。
- 旧完了取消でもpendingを作り、同日の古完了fallbackを遮断する。
- 本日/過去結果の表示、完了一覧、通常Node backup、V2/Firestore codecでmissedを識別。
  対象日と実操作日時は別。通常Node backupと完全復旧snapshotは別である。
- 未達を含む隔離ApplicationStoreで既存raw CASを用いた保存、Undo/Redo、Outbox、History、再起動を検証。
  既存replayRoutineDatesを利用し、remote identity不一致のUndo拒否を維持する。
- 非canonical旧changedAtの対象操作と版上限は保留。旧offset値を読取り時に変換しない。
- 未知/不正registerをmergeで黙って落とさず例外停止。hydrate時はJournalの書戻し/clearより前に
  Journal/Committed/History/Outbox内の結果を検査し、原rawをその場に残す。
- 制御された選択UI部品RoutineResultActionsと履歴パネルの任意callback。文字で3結果と取消を提示。
  本番入口にcallbackを配線しないため、現在のワンタップ完了は維持される。

## 有効化しないための境界

通常ApplicationStoreは、missedを含む新payload、またはmissedを含む既存対象の新操作を保存前に拒否する。
隔離テストだけがopen option `isolatedRoutineResults:true` を渡す。
この値はテスト注入であり、認証・server capability・旧writer fenceの証明ではない。
missedのあるdomain/Outbox、または隔離optionのあるstoreはSyncControllerのstart/flushを拒否し、
listener停止・error表示・未送信操作保持とする。再起動してoptionを省いてもmissedを検出して遮断する。
実SDKやserver gateへ新方式を接続しない。Functions/Rules/IAM/実環境protocolは変更していない。
共有domainは将来Functions buildにも含まれるため、その配備時の影響レビューは別途必須。

これは**この対応版のローカル安全弁**であり、既存の旧PWA、直接SDK、Admin、Functionsを
サーバー側で拒否した保証ではない。protocol3/能力registry/epoch/全writer停止は未実装で、
実環境のmissed書込みは引き続き閉鎖する。これらを省いてDEVへ配信しない。

## 試験の証跡

`src/domain/routineResults117.test.ts` を実装前に追加: 10 FAILを記録。
選択UIは実装前にmodule未存在のsuite FAIL。
旧完了取消のpending回帰は追加後に1 FAIL（15件は名前filter対象外）を確認してから修正。
filter対象外をskip実施済みと数えない。
初期の新backup試験は戻り値を誤って`.nodes`として参照していたため修正し、
fixtureに既存backupが補完するmemoType=taskを明示した。既存テストの期待値は弱めていない。

新テストは、4周期×3結果、古周期の結果変更・取消、16通りstate tie、取消後の古配送、
Node backup、版上限・旧時刻、IndexedDB再起動/Undo/Redo/Outbox、標準store拒否、
quota/abort/CAS失敗注入、実raw CASの並行writer拒否、未知Journalの原本保持、
実通信adapterのconnect/upload未呼出し、error状態と未送信保持を含む。
既存Routine/Queue/保存/同期/Undo/Redo/backupテストも回帰ゲートとする。
ログ: `D:/working/TaskMemo/artifacts/routine117-local`。

最終コードの全体試験は169ファイルPASS/4ファイルskip、**1295 PASS/46 skip**。
関連focusedは7ファイル71 PASS。型チェック・Lint（warningなし）・diff checkはPASS。
Web/Functionsコンパイルの結果は固定commitのPRへ記録する。実環境試験は実行していない。
一度、Web buildと全体試験の同時実行中に別チェックプロセスの起動がWindowsのpaging不足で失敗した。
負荷の高いビルドとの同時実行を避けて再実行し、上記型/Lint/全体結果を確認した。

## R01〜R18 対応表（個別部分試験のPASSを全受入PASSにしない）

| ID | 今回の対応・実施範囲 | 残り／判定 |
|---|---|---|
| R01 | 全周期3結果のdomain、結果選択UI単体 | 一覧メニュー/実アプリ配線・実機は未実施。部分実施 |
| R02 | 古周期結果変更、完了/skip取消、新pending、生成不変 | 実UI＋全状態組合せの受入は残る。部分実施 |
| R03 | 全state同版同時刻の逆順merge、既存revision回帰 | 実server複数actorは未実施 |
| R04 | pending対古missed、再起動、既存skipの配送/ACK試験 | missedの全ACK/応答喪失順列は未実施 |
| R05 | missed Undo/Redo、既存他日remoteでのUndo失敗閉鎖 | 新状態で他日remoteの全組合せは未実施 |
| R06 | quota/abort/CAS失敗注入、実stale-writer CAS拒否 | Journal途中crash、commit/accepted応答喪失は未実施 |
| R07 | Node JSON backup、IndexedDB、History/Outbox再起動 | receipt/unknown opaqueを含む完全復旧backupの新契約は未実装 |
| R08 | 通常store書込拒否・隔離storeの実通信拒否 | server capability/旧writer拒否は未実装 |
| R09 | 共通履歴＋既存同名/未来/空過去/本日回帰 | 新状態を含む全UI組合せは残る |
| R10 | #137/#138、展開/性能回帰 | missed大量展開・実機は未実施 |
| R11 | 旧版へのrollbackを禁止する方針維持 | 実fence/draft退避/rollback運用は未実施 |
| R12 | なし | 固定旧writerの実server拒否は未実装・別承認待ち |
| R13 | なし | metadata付き旧再送/切替/Firestore persistenceは未実施 |
| R14 | なし | Rules/Functions/Admin/IAMは変更・試験していない |
| R15 | 未知Journal保持・merge/codec/backup拒否 | opaque完全backup、全経路、未知を含む実UI保護表示は未実装 |
| R16 | 本日/過去final除外、古周期pending取消の非生成 | 新状態の実端末同期は未実施 |
| R17 | 非canonical時刻・版上限保留、全state tie | 旧offsetの実データ確認や全旧fixture拡張は未実施 |
| R18 | 接続不可・書込閉鎖の負ゲート | server全producer/実配備revision/epoch供給は未実装 |

R01〜R18のいずれも、設計の全条件を満たした最終受入PASSとはしない。
実データは読取りも書込みもしていない。未知データが実在すると断定しない。

## 次工程と残リスク

1. 本ローカル差分を独立レビュー。read protection、取消根拠、CAS、閉鎖境界を重点確認する。
2. 製品入口/Occurrenceメニューへの配線は、既定閉鎖を維持できる実capability供給契約と合わせて追加。
   通常のローカルfeature flagだけで開放しない。
3. protocol3 writer/epoch/registry、旧writer・Admin/Functionsの拒否、全producer対応、完全backup/
   unknown原本保護の残りを限定した後続差分へ分ける。server側の実行は別Owner承認。
4. R01〜R18の不足分と旧writer試験を完了してからDEV有効化の承認を求める。

通常Node backupだけでJournal/receipt/未送信全体を保存したと主張しない。
既存Node revision winner/receiptの限界を本enum拡張で解消したとは扱わない。
unknown時の全体停止は厳しいため、利用者向けの保護表示と完全backupは後続実装・レビューが必要。
旧reader/writerへのrollbackは禁止。原本保持、対応版へのforward fixを基本とする。
リリース①はPR144単独で独立レビュー後に先行できる。

## M145-1 修正・再レビュー

独立レビュー対象6224b19はCHANGES_REQUESTED（Major 1）となった。
最初のACKでmissedのあるwinnerを受信するとrestrictedになっても、既に動いているdrainは
次の操作を送ってしまう。start/flush入口の検査だけでは不十分だった。

修正前にACK後の残数1/0、開始待ち中のmayStartを試験し、3 FAILを確認した。
同じファイルの17件は名前filter対象外であり、成功や受入skipとして加算しない。
各drain反復の送信前、ACK反映直後、upload例外処理で制限を再確認し、
adapterへ渡すmayStartも現在のrestricted状態を見るよう修正した。
保護停止をpermanent failureとして維持し、offline再試行やownership競合へ読み替えない。

開始済みuploadの正当なACKは照合・永続化し、まだ受領されていない別操作は変更せず残す。
最後のACKでOutboxが0になっても、missedのある状態をsyncedへ変えずerror/停止とする。
既に開始した実サーバーtransactionを撤回できるという保証ではなく、新しいuploadの禁止である。
server側のfenceは引き続き未実装で、これを代替したとは扱わない。

回帰試験5件: ACKでmissed（元操作1件/2件）、adapter開始待ち中の受信、listener受信中の
開始済みACK、localOnlyとresume。原Outbox payload/History/再起動後の保持、追加uploadなし、
error状態、購読停止を確認する。関連Store/Controllerは41 PASS。
レビュー担当の外部8件も開発側の別artifactで再実行してPASSした。
これは開発側の反例再実行であり、独立再承認ではない。新SHAの独立再レビューを必須とする。

## M145-2 並行profile通知と保護表示

fcfd1f3の独立再レビューではM145-1は解消したが、停止前から処理待ちだった常設メモ/設定の
callbackがawait後にrefreshしてerrorをsyncedへ上書きする反例が2件見つかった。
書込みの再開ではなく保護状態の誤表示であり、同じMajorとして再レビューが必要になった。

常設メモ/設定それぞれの再現2 FAILを先に確認してから修正。
Node/常設メモ/設定のcallbackはawait後とerror通知時にgenerationを再照合する。
加えて保護表示を通常のstate更新より優先する投影へ集約し、当該controller内で一度成立した
保護は遅着ack/connected/profile/transport error/ownership pauseで解除しない。
このcontrollerには保護解除APIを追加しない。正当に保存されたprofile/rawを巻き戻さない。

追加8ケースは常設メモ/設定×Node先/逆順×単発/重複。profile保存成功、元結果とOutbox保持、
error理由、stale error、pause/resume、後着の有効pending結果でも当該controllerが自動再開しない
ことを検証する。localOnlyとM145-1の送信停止/開始済みACK照合も回帰する。
これはclient controller内の保護表示契約で、server fenceや完全復旧の実装承認ではない。
