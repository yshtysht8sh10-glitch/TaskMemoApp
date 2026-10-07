# Issue 93 ownership conflict display

OwnershipReconcilePanelのlocal/account表示値を変えず、JSON全文の上下表示を
ConflictComparisonに置き換える。採用ボタン、disabled条件、choices、commit、
plan/fingerprint、同期判定、Firestoreデータ構造は変更しない。
Productionの未解決競合を自動採用・削除・再importしない。

pure conflictPresentationはトップレベルフィールドをcanonicalで比較し、
差分と同一項目を分離。未知フィールドも表示する。項目欠損/null/空文字、
boolean、配列、オブジェクトを区別し、入れ子値はキー順に依存せず比較する。
日時文字列は元の値を表示し、時間補正や意味の推測による正規化はしない。
表示対象が同じ場合は実質差分0件と明示するが、競合判定は変更しない。

長文比較はUnicode code point単位の共通prefix/suffixと変更区間を求める。
下線＋theme背景で変更区間を表示。同一の長い周辺部分は省略し全文展開可能。
複数箇所の変更では最初から最後までの区間を強調する（最小編集列/LCSではない）。
計算は線形で、長文の二乗計算を避ける。内容や改行を保持する。
狭い画面では各フィールドのローカル/アカウントを上下配置し、長い単語も折り返す。
色だけでなくΔ/＝、ラベル、下線を使う。同一項目は件数付きbuttonで展開する。

tests: conflictPresentation.test.ts / ConflictComparison.test.tsx。
body変更、全文/同一項目展開、zero diff、null/欠損/boolean/配列/object、
Unicode、挿入/削除、元値不変、ownership境界の既存処理保持を確認する。
実際のProduction競合とiPhone PWAの視認性・採用操作はユーザーの実機確認待ち。
Issueは実機確認前にCloseしない。
