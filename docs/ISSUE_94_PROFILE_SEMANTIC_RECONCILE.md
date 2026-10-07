# Issue 94 profile semantic reconcile

原因: pendingAnonymousChangesがprofileを候補にするとplannerが無条件conflictを返した。
通常Nodeのsame判定とは別の分岐で、revision/fingerprint差による競合ではなかった。

sameOwnershipProfileはsourceのbody/ideasEnabledとaccountの各valueを厳密比較する。
account recordなしは既存Domain/UIと同じbody=''、ideasEnabled=falseと解釈する。
空白/改行を削除せず、内容の推測・丸め・自然言語正規化はしない。
revision/lastOpId/device/seqはsemantic比較に含めず、plan fingerprintとcommit freshness
には従来どおり含める。remote変更で古いplanは引き続き拒否する。

同一profileはplan上sameとしneedsReviewを要求しない。same item自体は残し、
既存commit/checkpoint経路を保持する。unreconciledIdsの表示件数から同一profileを
除外し、確認画面からも除外する。通常Nodeの分類/件数/採用処理は変更しない。
raw pendingAnonymousChangesのledger判定は維持する。

比較/表示だけではledger、History、Outbox、revision、Domainを変更しない。
ユーザーが既存ownership commitを行った場合、same profileはskipされる。
内容を変更する操作は生成せず、既存原子的ledger保存を通る。
再起動でも同一profileは確認対象にならない。
本当に違うprofileは従来どおり明示的local/account選択を要求する。
同一Nodeとprofileが混在する場合も、必要なNode選択だけを要求する。

回帰: ledger有無、revision差、body/Idea/空白差、recordなしの既定値、
remote revision race、再起動、no-op ownership commit/checkpoint、
本当のNode競合との混在、原本/metadata/History/Outbox保持、UI除外/採用引数。
初回取り込みとownership同期の既存テストも実行する。

Productionの残存実例は操作しない。今回の修正はローカルコードと自動検証のみ。
deploy/Issue Closeは行わない。
