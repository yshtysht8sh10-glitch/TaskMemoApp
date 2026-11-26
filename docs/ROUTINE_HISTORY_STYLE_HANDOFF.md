# Routine履歴の色・アイコン（リリース①）

2026-11-26 / 開発担当。PR144/6329c54基点のUIのみ。
完了=緑の丸付きチェック、スキップ=黒のskip形状（darkは通常文字色）、未処理=灰色の空円と「-」。
日付は通常文字色のまま、結果文字とアイコンを同色にする。18×18の固定枠で揃える。
Native View/Textの形状で描き、絵文字の色差や新しいフォント/ライブラリを導入しない。
装飾iconは読み上げ対象外。結果文字を読み上げる。

missedの型/表示/保存/機能は含まない。未達の赤い丸付きバツは#117のDへ分離する。
Domain、保存、同期、History生成、Queueは変更しない。既存のRows memo化とcallback参照は維持する。

先にlight/darkの2ケースを追加して2 FAILを確認した。日付色/結果色/実形状色/枠寸法/未処理文字/
raw不変/操作非発火を検証し、既存UI/125・5000件の描画抑制試験を回帰した。
focused 15 PASS、全体1279 PASS/46 skip、型/Lint/diff check PASS。
性能試験は合成React/jsdomの再計算・再描画検査で、実iPhoneの入力p95を新たに測った結果ではない。
大規模DOMは増えるため、全件展開時の実機メモリ/scrollは解消済みとしない。
Ownerは軽微UIの本人再確認を不要としたが、独立レビューは必要。未実施をPASSへ数えない。

DEVはQueueを含むこの系統を用い、独立承認後にHostingのみ配信する。
Productionは現公開e18c4d1から#140/#141/#142と本UIだけを抽出する。Queueや#117は取り込まない。
現Productionの公開JSとHosting releaseをGETで確認済み。ユーザー文書の読取りなし。
Productionは本番候補SHA/検証/対象/rollbackを提示してOwnerの別承認を待つ。
