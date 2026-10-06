# #85 iPhone ownership preview調査（2026-10-06）

最新Issueコメントの `[object Object]` / `permanent` とpreview失敗を対象にする。
元storageを消さず、対象Account/anonymous原本を変更しない。production変更・Issue Closeなし。

## 対象の照合

ユーザー回答で現在の対象はメール先頭syyyのAccount、UID末尾`Y4Ri2`。
以前の画像で確認したUID末尾`pAJ2`とは異なる。以前の「同じ」という回答だけでUIDを引き継がず再照合した。
Auth作成は10月5日23:49:06.078 JST。
DEV Admin readbackで対象のgate/receiptは404、nodesV2/profileV2/syncOperationsV2は0。
該当時間帯23:47〜翌00:20のensureaccountv2ready logsはentriesなし、nextPageTokenなし。
Auth登録済みとV2 onboarding済みは別。compatibilityが成立していると推測してpreviewを許可しない。
原本はgitignoredの `artifacts/private/dev-onboarding/ownership-remote.json` / `ownership-target-logs.json`。

## 現行コードとの差

現在のDEV配信bundle（entry-d6c136d525af041e62a67dab33a4434e）には、
missing gate → trusted callable → await → server再取得の処理がある。
controllerはconnect後に初期ownership snapshotを読む。connect失敗時はassessment未確認のためreviewカードを出さない。
structured errorはkindを分類用に用い、messageがあればそのmessageを使う。`permanent`自体を表示文言にしない。
それにもかかわらず対象実機ではgate未作成・reviewカード・permanentが併存している。
現在配信しているコードと端末実行コード/経路の一致を確認する必要がある。
旧/別originのPWAと断定する前に、実機の読み取り専用ストレージ診断のoriginを依頼した。

## 実Firebase SDK対照

`scripts/dev-ownership-readonly.ts` はDEV環境を厳密に確認し、作業専用検証Accountで
adapter.connect → readRecoverySnapshotを実行。Nodes1/receipts1/profileなしで成功。
Node/profile/receiptの書き込みを行わない（検証AccountのAuth login時刻は更新される）。
ユーザーのpassword/tokenを要求したり対象UIDをimpersonateしたりしない。
initialOwnershipの既存回帰は、connect/gate拒否時にsnapshot取得0、upload0、原本保持と実エラー維持を確認している。

初回の診断runnerはstdin ESMとtsxでSDKインスタンスが混在しdoc()型エラーになった。
static importsの.ts runnerで解消。これは診断runner固有で、iPhoneの一次原因と混同しない。

## 未確定・停止条件

追記：ユーザーからPWA起動先として `https://taskmemoapp-eabc3.web.app/` を受領。
これはproduction Hostingであり、今回配備したDEV originと異なる。
公開HTTPの読み取りのみでproduction entry-43855b582ba3676b8b3fa1699615faa3.jsを確認。
現在の配信Firebase設定はproduction/taskmemoapp-eabc3、onboarding callable/callbackを含まない。
DEV entry-d6c136d525af041e62a67dab33a4434e.jsはdevelopment/taskmemoapp-devでonboardingを含む。
public bundleの原本のみprivate artifactsへ保存。production Cloud/Auth/Firestoreの変更・私有データ取得なし。
このPWA originへDEV deployが反映されないことが確認できた。
ただし実機のDEV表示と現在のproduction配信設定は食い違うため、PWA内のcached実行bundleは依然未確定。
既存PWAの削除/再追加やstorage削除で証跡を消さない。先に元PWAのデータを保護する。
production PWAを直すためにproductionへDEV buildを配備してはいけない。
SafariのDEV originで検証を継続し、元PWAからのデータ移動/importはバックアップと環境境界確認後に別途扱う。

実機の例外原本と実行origin/bundleは未取得。対象Cloudデータだけでは押下時の例外の発生箇所を確定できない。
表示のみ変更して「修正済み」とはしない。storage削除やgate手動seedで診断材料を消さない。
まず同じPWA内のストレージ診断でoriginを確認し、その配信/実行コードと押下時の例外code・段階を照合する。
