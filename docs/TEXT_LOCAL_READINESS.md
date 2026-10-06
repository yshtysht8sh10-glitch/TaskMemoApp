# テキスト編集のローカル利用条件と未接続部分

#85の解消設計・移行/reconcile/復旧/テスト計画は[共通ローカルV2設計案](LOCAL_V2_APPLICATION_DESIGN.md)。
設計段階であり、以下の現在実装の制限はまだ解消されていない。

2026-10-02、Issue #59の未ログインDEV調査を残した履歴文書。
**以下の「現在」は#85実装前の状態。現行仕様は[共通V2実装記録](LOCAL_V2_IMPLEMENTATION.md)。**
#85により未ログインのLocal V2 Applicationを通常編集と共通で初期化し、クラウドログインを不要とした。
安全性に関する依頼の例外条件に従い、今回の入口制限解除は停止した。実行コードは変更していない。

## 実機で確認した直接原因

localhost:8081の設定画面はEnvironment: development、Sync: V1、クラウド同期: 未ログイン。
一覧・ツリーのテキスト編集はともに「テキスト編集はV2同期で利用できます。」で拒否。
両方の読み取り専用テキストViewは開ける。既存データへの保存操作は行っていない。

`useTaskMemoSync.ts`のprotocol 1 bridgeがこのメッセージを投げる。
V2選択はFirebase設定、environment、`EXPO_PUBLIC_SYNC_V2_ENABLED === 'true'`による。
今回のDEV設定にはそのフラグがない。これはログイン状態そのものの判定ではない。
フラグを有効にするだけでも、未ログイン時のApplication storeは生成されない。

## 現在の通常編集とApplicationの関係

protocol 1の通常編集は`src/app/index.tsx`のDomain操作とReact NodeHistoryを通る。
`sync.command`がfalseを返すとローカルHistoryへcommitし、`nodeStorage.ts`の
`@taskmemo/nodes/v1`へNode配列を保存する。再読み込みでNodeを復元するが、Historyはメモリのみ。
V2のrevision、操作ID、durable History、Outboxをこの保存から生成する経路はない。

V2 UIでは認証変化時にcontroller/store参照とHistoryをリセットし、ログイン済みの
`${projectId}/${uid}`単位の永続化を開く。未ログインなら初期化を終了する。
復旧audit後にaccount storeを空の初期配列から開き、V1キャッシュや前アカウントを暗黙importしない。
V2通常Commandもcontrollerがない場合はローカルV1処理にfallbackしない。

一方、`TaskMemoV2ApplicationStore`自体はFirebase認証に依存しない。
正しいDomain baselineとatomic永続化が渡されたstoreなら、begin/prepare/commit、
1保存1History、revision、Outbox、再起動復元、Undo/Redoがローカルで成立する。
UI bridgeの認証チェックだけを消しても、このauthoritative storeは用意されない。

## Outboxと後からログインする場合

現在の未ログインprotocol 1編集にはV2 Outboxはない。V1同期のupdatedAt mergeと
V2 revision同期は別経路。V2 account storeにはローカルV1変更を引き継ぐ仕組みがない。
アカウントを切り替えても別scopeの保存は削除されないが、現在Domainとして自動採用されない。

初期化済みのV2 account storeで通信不能になった場合は、既存のatomic journalに
Domain / History / revision / Outboxを保存し、同じaccountの既存controllerで再送できる。
この「所有者が確定したoffline」と、所有者未確定の未ログインは区別する必要がある。
local-recovery用controllerの`localOnly`も、匿名データをaccountへ移す仕様にはならない。

匿名storeを作りOutboxだけ後から送る方法は安全でない。テストで、revision 0から作った
ローカル編集を既存accountのrevision 20へ送るとsupersededとなり、ack後はremote値が
現在Domainを占め、Outboxは消えることを確認した。競合したHistoryのUndoは空操作となる。
これは既存同期の安全なwinner判定であり、不正なbaseline移送を補償するmergeではない。
逆に古い全Node snapshotが高いrevisionを持てばremoteを上書きし得る（revision規則からの推論）。
単純なflag解除・匿名Outbox転送ではcutover、account隔離、revision安全性を保証できない。

## 本当に必要な最低条件と必要な対応

利用条件はクラウドへの即時送信可否ではなく、以下を満たすApplication readinessとする。

- 通常編集と同じauthoritative Domain / V2 Application storeが初期化済み。
- atomic journal、durable History、revision、既存Outboxを同一scopeで管理できる。
- recovery audit、destructive guard、競合検証を通せる。
- sessionの所有scopeが安定し、切替時に旧sessionをcommitできない。

目標仕様を実現するにはテキスト入口だけでなく、共通Application lifecycleの対応が必要。
未ログイン用の安定したローカルscopeを通常編集でも使用し、既存V1ローカルデータの
未知metadataを壊さない取り込みを設計する。ログイン時にはremote baselineの取得、
同一ID衝突、操作意図、所有者、revisionの照合を行う明示的な引継ぎが必要。
別accountへの漏出を防ぎ、既存cutover/recovery gateを保持する。
テキスト専用storeや別Outbox、Firebase直接書込み、DEV特例は作らない。
既存V1通常編集も含む共有基盤の変更となるため、今回は実装していない。

## 検証と未達条件

`textEditApplication.test.ts`にauth不要のcoreについてtree/listの保存・再起動・
1History・Undo/Redo・revision chain・invalid拒否・discard無変更を追加した。
別scopeがローカルOutboxを暗黙採用しないこと、誤ったrevision baselineの送信が
lossless adoptionにならないことも追加。別永続化instanceによるscope境界検証であり、
実FirebaseログインのE2Eではない。

競合後Undoはthrowと誤認した初回テストを、実装の安全な空操作に修正した。
同期規則や競合保護は変更していない。
未ログインUIの編集開始・保存・ログイン後引継ぎは未実現。
実Firebaseでのログイン後転送確認は行っていない。
Phase 7、Hosting deploy、Issue Closeは行わない。

調査時の全体検証: 99 test files / 734 tests成功、環境依存3 files / 25 testsはskip。
TypeScript、Expo lint、syntax文書生成同期、git diff --check成功。
今回の変更はテストと文書のみ。runtime変更がないためWeb exportは再実行していない。
