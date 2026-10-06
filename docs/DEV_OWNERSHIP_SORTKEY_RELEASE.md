# DEV ownership sortKey release: 2026-10-06

[Issue #85最新コメント](https://github.com/yshtysht8sh10-glitch/TaskMemoApp/issues/85#issuecomment-6000193313)に従うDEV限定配信。

## 実際の配信

- Firebase project APIでprojectId=taskmemoapp-dev / projectNumber=1045397314197を確認。
- config=firebase.dev-rc.json、hosting.site=taskmemoapp-devを確認。
- build-v2-rc-web.mjsでdevelopment/taskmemoapp-dev、V2を明示しexport。環境/bundle検証成功。
- releaseId=issue85-order-20261006-0305。
- base Git commit=dded687a72f462cddd1ebab41b701ad1fdab932c。未commitの作業ツリーを含むため、commit単独では成果物を識別しない。
- command: `npx firebase-tools deploy --project taskmemoapp-dev --config firebase.dev-rc.json --only hosting --non-interactive`。
- 配信URL: https://taskmemoapp-dev.web.app 。CLI release complete。
- live entry: entry-db9f6917627bbce90f7248e5f3beafc2.js。
- live/local bundle SHA256一致: 15824ac03b872843f0f741faaccde06ce3a14da8bb39df966460995d306571c8。
- live bundleにreleaseId、account-anchors-v1、runtime identity表示を確認。
- live storage-diagnostics / v2-recovery-backupのcommit placeholder置換済み。

Firebase/Hostingの変更対象はDEV Hostingのみ。Functions、Rules、Auth/Firestoreのデータ変更なし。production project taskmemoapp-eabc3とそのpreview channelへdeployしない。#85/#59はOPEN。

## 実行build識別

設定→アプリ情報にHosting（実行中window.location.origin）、Commit、Release、Display modeを表示。Commit/Releaseは読み込んだappのembedded Expo configであり、後からserver manifestを取得して現在実行buildと誤認しない。

同commitから異なる作業ツリーを配信し得るためreleaseIdも確認。diagnosticページのstampはそのページのbuildであり、cached app実行buildの代わりにしない。

同commitの別releaseを区別するbuildInfo regression追加。修正前undefinedで失敗→修正後成功。全体823 pass / 40 conditional skip、TypeScript/Lint/diff check、DEV export成功。

## iPhone再試験の停止条件

前回archiveOriginはtaskmemoapp-eabc3--issue85-iphone-mavpih0e.web.app。Firebase scopeがDEVでもHostingはproduction project配下のpreview。今回このoriginを更新していない。DEV live配信でこのPWAが更新されたとは扱わない。

ユーザーには元PWAの設定→アプリ情報のBuild/Hosting/Releaseを依頼。古いコードで項目がなければ不明と記録し、ストレージ削除/再追加で識別を強行しない。元PWA・私有バックアップを保持。

別originのDEVを開いても元PWAのlocalStorage/IndexedDBは移らない。空のDEV originで試して元原本からのreconcile成功と宣言しない。同じ原本の試験には、DEV originへの原本コピーを正式な安全経路で準備するか、元previewのHosting変更を許可する別仕様が必要。後者は今回のproduction変更禁止に抵触するため実行しない。コピー/移行は今回行っていない。

DEV実行コードを確認するだけなら別SafariタブでDEV liveを開き、設定のHosting=taskmemoapp-dev.web.app / Release=issue85-order-20261006-0305を確認できる。元PWAを置き換えない。

原本・配信先の対応確認後の実機ゲート: sortKey調整preview→local採用成功→同期済み→両Memo保持→兄弟sortKey一意→logout/re-loginで再取り込み/重複なし。現時点でiPhone PASSとはしない。

## 2026-10-06 iPhone Safari最小試験と入力zoom対応

ユーザーから最新releaseのアプリ情報画像、および通常exportを受領。Account-85=root/a0、Local-85=root/a1、別IDのactive Memoが各1件。logout/re-login後も各1件保持と報告された。取り込み前localのa0と、sortKey調整preview表示は証跡がなく未確認（ユーザーは表示されなかったと報告）。後状態a1だけを根拠に実機で衝突解消が走ったと断定しない。「同期済み」の明示的確認も別途必要。

ログイン入力focusで画面倍率が上がる報告に対応。SyncAccountPanelのメール/パスワード入力はfontSize未指定だったため、共通input styleへfontSize=16を追加。viewport設定やユーザーの手動zoomを制限せず、入力文字サイズを明示する。

回帰テストは両TextInputが共通の16以上のfontSizeを使用することを検証。修正前NaNで失敗→修正後成功。これはiPhoneの実際のvisual viewport倍率を測定するテストではない。実機でメール→パスワード→キーボード終了時の倍率を確認する。

新DEV releaseId=issue85-order-input-20261006-0918。bundle=entry-f6e185c9087c1537d519205b407f0e43.js。全体824 pass / 40 conditional skip、TypeScript/Lint/diff check、DEV export成功。HostingのみDEVへ配信、Functions/Rules/Auth/Firestore/productionは対象外。入力zoomの実機確認とownership preview実機確認は未完了。
