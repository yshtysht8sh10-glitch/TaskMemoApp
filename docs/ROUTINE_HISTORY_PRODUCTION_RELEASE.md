# リリース① Production抽出版・承認資料

2026-11-26 / 開発担当。**準備のみ。Production配信はOwnerの別承認まで実行しない。**

## 基点・抽出

公開ProductionのJSをGETし、`e18c4d1d88589103e6ad4d77241aead8d213f1bd`を確認。
Hosting release: `sites/taskmemoapp-eabc3/releases/1794144167969000`
Hosting version: `sites/taskmemoapp-eabc3/versions/b4d2e3ccf6995ce1`
公開JS SHA256: `70ecee5f9e30e805e5ed8a3655d5870380f3694f34fcd5ab8300ad57b2002925`。
Firestoreのユーザー文書は読んでいない。Production設定やデータは変更していない。

候補ブランチはe18c4d1から作成し、#140/007b2df→#141/74aad5f→#142/c8a7fb8→UI/69c30c3だけを
cherry-pickした。実装先端66fc0faに手順書/Hosting限定configを追加した最終PR headを凍結する。
最終固定SHAはPRとbuild manifestへ記録する。
共有DEVのmain/Queue全体や#145/#146はmergeしない。
履歴共通取得、パネル、結果iconの製品sourceはDEVのUI版と一致することをGitで比較する。
models、保存、sync、Services、Functions、Rulesはe18基点から非変更。#114の本体完了UIを保持する。

## 検証と対象

候補の全体・型・Lint・Web export・diff checkを実行し、件数とskipをPRへ記録する。
125/5000履歴の再描画抑制は合成試験。Ownerは旧DEVの実機を概ねOKと確認し、軽微UI再確認を不要とした。
新UIは独立レビューで確認する。実機の新p95や大量DOMメモリを測定済みとはしない。
Production抽出版の差分についても独立レビューを受ける。

配信対象はFirebase Hosting site `taskmemoapp-eabc3` の凍結済み`dist`だけ。
`firebase.routine-production.json`はHosting以外のsectionを持たない。
現役HostingのcleanUrls/SPA rewriteと、診断/復旧backupの6つのno-store headerを維持する。
repositoryのroot firebase.jsonのglobal cache headerをそのまま配信しない。
この実環境差をmetadata GETで確認し、専用configへ正確に転記した。

ビルドは既存の `npm run web:export:production-v2` でローカルexportのみ行う。
production.envは新作成せず既存の正規公開設定を使用し、project検査・V2/guarded recovery・SHA stamp・manifestを維持する。
manifest自身以外の全ファイルcanonical hashと、各ファイルhashを凍結する。
ignoreにより配信されないnode_modules内画像やdotfileと、実配信対象を別リストにする。
Queue source/依存を追加していないこと、公開buildのproject/SHA、未達機能を含まないことを確認する。

## 承認後の配信手順（今回は実行しない）

1. Ownerが最終候補SHAとHosting限定配信を明示承認する。
2. 公開Production SHA、release/version、cache/rewritesが上記から変わっていないかGET再照合。
   不一致なら停止して再レビュー。新しいreleaseを無断で上書きしない。
3. worktree clean・最終SHA・全artifact hash・Hosting対象・環境埋込み・独立承認を確認。
4. 明示project/config/only hostingで配信。deploy --only firestore/functions等を使わない。

```powershell
firebase deploy --project taskmemoapp-eabc3 --config firebase.routine-production.json --only hosting --non-interactive
```

5. 公開build SHA、manifest、Service Worker、配信対象全ファイルhash、Hosting release/versionと設定をGETで照合。
6. 想定外の差異/失敗があれば停止して報告する。データ修復・同期・キャッシュ初期化は行わない。

## ロールバック（Ownerの明示指示後）

旧version `b4d2e3ccf6995ce1`を保管し、削除・cleanupを行わない。
最小手順はHosting Consoleのlive release historyから該当versionへRollback。
CLIの場合も作り直した古いbuildではなく、保存済みのversionそのものをliveへcloneする。
使用中CLIのhosting:clone --helpでversion source構文を確認した。

```powershell
firebase hosting:clone taskmemoapp-eabc3@b4d2e3ccf6995ce1 taskmemoapp-eabc3:live --project taskmemoapp-eabc3 --non-interactive
```

これはHosting releaseを新たに作る操作であり、今回は実行しない。
実行直前に対象project/site/versionを確認し、完了後は公開e18c4d1/hash/manifest/SW/設定をGET照合する。
Hosting rollbackはIndexedDB/Outbox/JournalやFirestoreを巻き戻さない。今回は保存schema非変更なので
データrollback/移行/初期化は不要。PWAの開いた旧画面まで遠隔で強制更新する保証はない。
Ownerに通常起動で表示SHAを確認してもらい、再インストール・強制同期・キャッシュ削除を指示しない。

## 承認対象と非対象

承認を求めるのは、このPR最終headの凍結成果物をProduction Hostingへ配信することだけ。
main/release merge、Issue Close、実データ変更、Rules/Functions/IAM、protocol変更、
Queue、#117 missed/実capability/完全復旧、旧データ移行は含まない。
