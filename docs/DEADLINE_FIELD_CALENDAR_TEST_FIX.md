# Production candidate: deterministic Memo deadline field test (2026-10-31)

## Failure and cause

Base candidate: `b1b32b01a7f47ad53484d1b74e5a9d96e682fa7d`.
Failing test: `src/components/MemoDeadlineField.test.tsx` →
`changes today granularity in the actual field without rewriting a legacy hidden deadline`.

The original test failed again before modification on 2026-10-31:

```text
AssertionError: expected [ '今日-午前（～12:00）', …(9) ] to include '今日-午後（～24:00）'
 ❯ src/components/MemoDeadlineField.test.tsx:41:63
```

The actual `pm` choice is `今日-午後・今週・今月（～24:00）` on October 31,
2026 (Saturday and month end). The other labels were:
`今日-午前（～12:00）`, `明日（11/1）`, `来週（11/2〜11/7）`,
`来月（11/8〜11/30）`, `今年（12/1〜12/31）`,
`来年（2027/1/1〜2027/12/31）`, `それ以降（2028/1/1〜）`,
`期限なし`, `日時指定`.

`MemoDeadlineField` calls `memoDeadlineChoices`, which defaults to the current
date and uses `deadlineDisplayGroups`. This intentionally merges empty calendar
intervals into their containing group. The same group labels are used by the
list and editor, as specified in `ISSUE103_NEXT_MONTH_YEAR.md`. On October 13
the unmerged expected label is correct; on October 17 it contains `・今週`;
on October 31 it contains `・今週・今月`. The test did not fix its clock and
incorrectly assumed every execution day had unmerged labels. This is a test
calendar dependency, not evidence of a production implementation defect.

## Change and validation

Only the component test changes: fix local calendar dates at 08:00 for October
13/17/31, assert exact normal/week-end/month-end labels for both amPm and
threePart, and restore real timers. Existing exact date/time preservation and
no-change-callback assertions remain. No product code, persistence, sync,
Routine generation, Firebase configuration, or dependency changes.

- Original focused run: 5 PASS / 1 FAIL, expected label mismatch above.
- Corrected focused file: 8 PASS, three consecutive runs.
- Related deadline helper/list tests: 62 PASS.
- `npm run verify`: TypeScript, lint, app 1231 PASS / 45 conditional SKIP,
  Functions build, Functions unit 15 PASS / 20 conditional SKIP.
- Firestore Emulator (`demo-taskmemo-v2` only): app 24 PASS, Functions 10 PASS.
- The earlier production-admin CLI timeout also passed in the full verify run;
  its implementation and timeout were not changed.

Production build result and final candidate SHA are recorded in Issue #109
after committing this test and note. Production deployment requires user
approval of the new candidate. No Hosting deploy or cloud-data writes are
part of this fix. Routine tree UI work and #107 remain behind that approval
and the Production release verification gate.
