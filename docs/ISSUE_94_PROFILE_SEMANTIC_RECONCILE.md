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

## Production release / final verification — 2026-10-07 JST

- Production baseline: fed7f2b818e16f08fc7f9f4590f0a93c4fa9c904.
- Deployed commit: 7b8cfc5e959c95f3c356a8f7fd4235436daa9838.
- Release: issue94-profile-20261007-7b8cfc5.
- URL: https://taskmemoapp-eabc3.web.app/.
- Dedicated release/issue94-production branch contains only the seven #94 files above relative to the existing Production baseline. DEV-only #92 changes were excluded.
- Target checked immediately before `firebase deploy --project taskmemoapp-eabc3 --config firebase.json --only hosting --non-interactive`. Only Hosting was deployed; Functions, Rules, Auth, Billing, Firebase configuration and Firestore content were not deployed or administratively modified.
- Published manifest commit and bundle SHA-256 verified against the local Production export. Bundle SHA-256: 12f9e0f55693b4a76fde8f3f97b64adcefbcbbfb9d57f5fc5ad0ecbeb5efd065. Canonical artifact SHA-256: d1408f84b5dbb68f6e8a90a65fb56dbac6da93bec46033e57f7dc883d13ae462.

### Automatic verification of the exact release

- Focused planner/Application/UI: 29 passed; expanded ownership/initial-onboarding/presentation/UI: 47 passed.
- Full suite: 1050 passed, 41 skipped. Count differs from the combined DEV tree because DEV-only #92 cases were intentionally excluded.
- TypeScript, lint, diff check and Production Web export passed.
- Isolated worktree initially lacked Functions dependencies and Expo's generated type reference. Restored the existing dependency junction and generated Expo type reference, then repeated checks successfully; no runtime patch or test weakening was needed.
- Real differences in body / ideasEnabled, normal Node conflicts, ledger presence/absence, revision-only differences, freshness/fingerprint races, atomic failure, metadata/History/Outbox preservation and post-commit restart are covered by regression tests. No artificial conflicts or remote race were injected into Production.

### Actual Production application and real data

- Existing signed-in Chrome Production account, existing Local V2 source and Account V2 data were used. Before release: profile classified as individual review despite displayed difference count 0; total pending/review 121.
- After release: pending/review 120, profile row absent, real normal Node conflicts still displayed and commit disabled until choices are supplied.
- Downloaded the existing read-only recovery backup before starting the new release runtime and after prepare. A local pure probe against that exported data confirmed 120 source Nodes / 218 Account Nodes, no applicable ownership ledger and `$profile.kind = same`.
- All four IndexedDB records (including complete Domain, profiles, History, Outbox, ownership and metadata where present) were byte-for-byte equal between snapshots. All other TaskMemo localStorage values were equal except the existing sort-key diagnostic log, which recorded hydration with changedNodeCount=0 and generatedOperationCount=0. Outbox stayed empty.
- Reloaded the Production application; the pending count remained 120 and the existing account/UI loaded successfully. This is restart after read/prepare, not a Production ownership commit test.
- User independently restarted iPhone PWA and reported: “iPhoneでも確認が消えた”. This verifies the original actual-app symptom on the affected device.
- No adoption, ownership commit, skip, import, deletion, profile edit or ledger checkpoint was performed merely to test same. Existing real normal Node conflicts were preserved for the user's own decisions. Cloud writes were not requested; no generated operation was observed in the compared local records. A whole-Firestore before/after audit was not performed, so unrelated concurrent changes by other devices are not claimed absent.
- Production completion/commit restart and forced remote races were not exercised against valuable live data; automatic tests cover these unchanged safety contracts. The original #94 no-difference profile review failure is verified resolved using both real Chrome application data and the user's iPhone PWA result.
