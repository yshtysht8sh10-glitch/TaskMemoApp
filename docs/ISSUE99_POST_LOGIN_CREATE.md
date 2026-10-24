# #99 ログイン後の追加が無反応：DEV 5194823追試

## 実機証拠と原因

ユーザー提供画像では、一覧が「最新状態は未確認（通信・同期を確認してください）・閲覧のみ」、
同期画面が「再送中」、赤字は「既存アカウントには管理者による移行確認が必要です。」だった。
認証とAccount Local復元は成功し、onboardingのサーバー判断でクラウド準備が拒否されている。
このconnect経路はcompatibility gateの確認／準備を先に行うため、Node listenerの購読開始と
初回server snapshotの受信・永続反映へは進まない。正常同期完了後に編集禁止が残った証拠ではない。

理由`legacy-account`は`functions/src/onboarding/decision.ts`で認証作成時刻が
policyの`eligibleCreatedAfter`より古い（または不正）場合の安全停止。
実アカウントのV1/V2データの有無をこの文言だけで断定しない。
自動準備の既存安全条件を変更したり、clientからgateを作成して回避したりしない。

二つのclient側問題を確認した。

1. Functionsのfailed-preconditionがadapterでtemporaryに分類され、再試行が条件を解消しない拒否にも
   「再送中」と表示されていた。実adapter境界テストでtemporary→期待permanentのFAILを確認した。
2. #99の新しい追加ボタンは`disabled={!startup.editable}`でonPress自体を止めていた。
   原因は同期Sheetのみに表示され、追加ボタンから理由へ到達できなかった。
   常時表示の追加ボタンをdisabledにする変更はc8b85a5導入で、親commitは`disabled={!ready}`。
   **無反応に見える追加操作は#99の回帰**。一方、既存アカウントの準備拒否は既存の安全仕様。

## 修正

- failed-preconditionをpermanentとして伝え、「同期エラー」で停止する。temporaryの表示も「同期の再試行待ち」とし、実行していない再送を進行中と表示しない。
- 拒否理由を一覧上部にも表示する。
- 実`MemoCreateButton`を分離。編集可なら従来の新規画面を開き、編集不可なら同期状態・拒否理由のSheetを開く。作成処理へは進まない。ガードは維持。
- 同期Sheetへ「クラウド同期を再確認する」を追加。既存controller.startを使い、同じAccountのgateを再確認する。Account切替後の旧結果は公開せず、取り込み・復旧中は再開しない。
- 3秒の待機上限、未確認時の閲覧、明示的な端末データ編集選択は維持。未確認のデータを最新と表示しない。
- 認証policy、eligibleCreatedAfter、gate、Rules、Functions、Node、既存データの移行／初期化は変更しない。

## 検証

- 実SDK adapter境界：legacy-accountのfailed-preconditionは修正前temporaryでFAIL→permanentでPASS。拒否時gateを生成しない。
- 実Reactボタン：拒否時は理由callbackのみ、編集許可後は追加callbackのみを実行。
- 実React hook＋ボタン＋Application/History/永続journal＋revision server：
  未ログイン追加、ログイン直後／同期遅延時の拒否、server完了後の追加、オフライン明示許可後の追加、
  再確認でのOutbox送信、再起動、logout/login、Undo/Redo、Account以外へ送信しないこと、既存Memo保持。
- 修正前5194823の実画面をlocalhost限定でAuth/Firestore Emulatorへ接続。
  Emulator専用accountに既存valid gateを用意し、ログイン→クラウド確認済み→＋→Editor→保存を確認。
  synthetic MemoのFirestore反映をEmulator上で確認。実DEV／Productionのユーザーデータを試験に使用しない。
- TypeScript、lint、全体テスト、Functions検査、diff check、DEV設定Web exportを実施。確定件数と配信SHAはIssueへ記録する。

## iPhone確認

1. DEVを再読込し、Issueコメントの新SHAを確認する。サイトデータは消去しない。
2. 管理者確認が必要な既存Accountでは理由が一覧に表示され、＋で同じ理由を確認できること。
   「クラウド同期を再確認する」だけで移行制約が解消されたとは扱わない。
3. 正常なDEV Accountではログイン・クラウド確認済みの後、＋で追加・保存・再読込できること。
4. 通信遅延／オフラインでは、理由表示と明示選択を経て対象Account Localだけに保存されること。
5. logout/login、オンライン復帰、別DEV端末反映、Undo/Redoと既存Memoの保持を確認する。

当該既存DEV Accountをクラウド利用可能にするには、別途管理者によるデータ状態・移行可否の確認が必要。
この作業でユーザーのAccountを自動provision／migrationしていない。
#99はOpen、#101には進まない。Production deploy禁止を維持する。
