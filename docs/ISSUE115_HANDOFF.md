# Issue 115 期限プリセットの実値ハイライト

開発担当から独立レビュー担当へ。Production相当e18c4d1からの独立branch `fix/115-deadline-choice-highlight`。#98/#132の変更やmainのQueue/同期基盤は混入しない。

## 原因と変更

MemoDeadlineFieldはnone以外なら常に「日時指定」をselectedにしていた。表示中の選択肢を生成する同じnow/粒度を使い、それぞれのchooseMemoDeadlineが設定する実日時と現在値を比較する。期間内所属やクリック履歴では判断しない。

同じ期限になる候補は表示順の最初の一つを選ぶ。期限グループの統合ラベルは既存規則のまま。OFFの選択肢を増やさず、値に一致する表示候補がなければ日時指定。preset=noneは期限なしを選択し、そのボタン自体がOFFなら他ボタンを誤選択しない。入力中不正文字列は日時指定のまま、保存検証は従来に任せる。

比較は保存される実instantとの完全一致。編集文字列が元値の分表示と同じなら、既存memoDeadlineDraftが保持する元秒/ミリ秒も判定に使う。例えば旧23:59:59.999は23:59:00.000を設定するボタンと同一視せず日時指定になる。時刻を丸めて保存し直す変更はしない。本人がプリセット押下しても既存の「元値と分表示が同じなら秒を保持」という保存契約は変更しないため、秒差がある旧値では選択が日時指定に残る場合がある。秒まで同値扱いする仕様変更は別判断とする。

DateTimeFieldの表示とselected判定は独立しており、プリセットに一致しても既存の入力欄を勝手に隠さない。accessibilityState.selectedと既存chipOn/テキスト配色でライト/ダーク双方へ対応する。Routine専用のrule/time編集導線は変更しない。

## 検証と範囲

- 修正前：新規7件FAIL（6件は未実装helper、1件は実コンポーネントの誤ったselected）、既存8件PASS。
- 最終focused関連86 PASS / 5 files。新規14件（helper13＋UI1）。今日/週末/月末/閏日/年末/日跨ぎ、表示粒度4種、OFF候補、直接入力/reopen、元秒msを検証。
- Asia/TokyoとAmerica/New_Yorkを別process環境で各22件PASS。DST切替日を含む。実端末のzone変更や時計供給の証明ではない。
- 全体1,298 PASS / 46既存skip（未実施）、164 files PASS / 4 files skip。
- TypeScript、Lint、Web export（合成DEV公開設定、EXPO_OFFLINE、4 static routes）、diff check成功。

選択状態の計算や画面を開くだけでonChangeを呼ばないことをUI試験で確認。保存・同期・移行・認証処理は非変更。iPhone/Android実機の視認性と操作は未確認。DEV/Production配信、実データ操作、Rules/Functions/Auth変更、merge、Issue Closeは実施しない。

レビューでは実値判定と元秒保持、同一値の優先順位、OFF候補と入力欄表示の非干渉を重点に確認する。未実施の実機項目は承認後の別工程へ引き継ぐ。
