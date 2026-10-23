# #99 起動時のデータ取得元と表示

## 確認済みの経路

- `HomeScreen`は初期HistoryにmockNodesを持ち、V2の表示設定ロードで空配列へ置換していた。静的Web exportにもサンプル一覧が含まれていた。
- `useTaskMemoSync`は認証listener登録前にanonymous Local Applicationを開き、Historyを画面へ公開していた。認証済みの起動でも、独立した古いLocalが一時表示され得た。
- 認証後はAccountのIndexedDB（NativeはAsyncStorage journal）の確定データを公開し、その後Firestore listenerのcache/serverレコードをrevision契約で受信していた。
- controllerの`state.phase=synced`は未送信操作がない意味であり、初回Node snapshotの反映完了ではなかった。SDK listenerは受信Promiseを待たず、初回全件反映／空のserver snapshotを判別する通知もなかった。

これらはコードとsynthetic再現で確認した経路。報告された特定のiPhone起動で「古いメモ」がmock・anonymous・Account保存・Firestore cacheのどれだったかは、当該端末の診断と実機確認待ち。Service Worker起因とは断定していない。

## 最小修正

- 初期Historyは空にし、設定・認証・Application復元前には一覧を描画しない。
- Auth確定前のLocalを利用可能と扱わない。scope変更時に以前の編集画面・選択対象を解除する。
- Node snapshotのレコードを順に既存の永続`receive`へ渡す。全件完了後にcache/serverを通知する。metadataだけの空server snapshotも完了として扱う。保存失敗後や購読停止後は完了通知しない。
- 接続状態とsnapshot確認を区別する。3秒経過または通信失敗で端末データを「最新未確認・閲覧のみ」と表示する。オフライン編集は「最新未確認の端末データを使って編集する」の明示選択後に既存Application/Outboxで行う。
- 初期化中・未確認状態では通常編集、Undo/Redo、テキスト編集の入口をguardする。取り込み操作は既存のserver再確認・fingerprint契約を維持する。
- `taskmemo-startup-diagnostics-v1`をsessionStorageへ最大80イベント記録。取得元・時刻・件数・データとrevisionの診断用hash・History深さ・未送信件数のみ。本文やタイトル、UID、Node IDは出力しない。hashは同一性の調査用で、安全性判断や同期の比較には使わない。
- 既存`/storage-diagnostics`の読取JSONにallowlistでstartupObservationを含める。診断失敗時にデータ保存を妨げない。

Node ID、schema、revision winner、History、Outbox、receipt、IndexedDBのatomic保存、reconcile、バックアップの既存契約は維持する。旧データを消去・初期化・無条件採用しない。

## 検証

- 修正前：snapshot確認状態がないcontrollerテスト、永続反映完了を通知しない実SDK adapter境界テストが想定どおりFAIL。
- 実React/jsdom hook：認証前の別Local非表示、Account切替、3秒の待機上限、未確認時の編集拒否、server受信、低いrevisionでの巻き戻りなし、History非生成、logoutで元Localへ戻る。
- Adapter：cache→serverの順序、保存完了待ち、metadata-only／空snapshot、保存失敗時の確認済み誤判定防止。
- Controller：接続済みでもchecking、server完了、停止後callback無効化、Outbox非生成。
- Firestore Emulator：demo-taskmemo-v2のみ。実SDK/Rulesで最新値を永続化後にserver確認、再起動後の保持、古いrevision拒否、History/Outbox非生成。既存Routine/Undo/Redo/同期ケースも検証。
- 全体test・Functions test、TypeScript、lint、diff check、DEV設定のWeb exportを実施。確定件数と配信SHAはIssueコメントに記録する。
- 診断exportの既存機密情報除外テストでraw JSON追加の不備を検出し、型・source・hash・件数のallowlistへ修正。有効テストは削除・skip・弱体化していない。
- 既存Native hookテストのSDK mockは、実SDK同様に初回Auth通知とsnapshot完了通知を発火するよう補完した。

## DEV実機確認（Productionで試験しない）

1. https://taskmemoapp-dev.web.app/ を再読込し、DEVとIssueコメントのSHAを確認する。
2. 未ログインで起動／再読込。復元中→元のLocal一覧になり、サンプルや誤った0件を挟まないか確認する。
3. DEVテストアカウントでログインした状態でPWAを終了→起動／再読込。別のLocal一覧が混入せず、確認中→最新一覧となるか確認する。
4. 通信が遅い状態では3秒程度で「最新未確認・閲覧のみ」になること、誤って削除／完了／Undoが実行されないことを確認する。
5. オフラインで既存端末データを確認。編集を明示選択し、テストMemoだけを変更。オンライン復帰後の同期、再読込、別DEV端末、Undo/Redoを確認する。
6. 別DEV端末で変更後、古い端末を起動。古い状態を最新確定と表示しないこと、最終的な内容・件数・履歴・同期状態が一致することを確認する。
7. 問題が残る場合、同じタブ／PWA内から設定→保存診断へ進み、読み取りJSONのstartupObservationを確認する。保存領域を消去しない。

iPhone Safari/PWA、Android実機、実DEVアカウント間の同期はユーザー確認待ち。自動テストを実機PASSとしない。IssueはOpen／In progressを維持し、実機確認までは#101へ進まない。Production配信は禁止。
