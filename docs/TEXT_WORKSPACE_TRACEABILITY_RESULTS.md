# Text Workspace traceability suite results — 2026-10-06

## Summary

- Latest specification: Issue #59 comment `6016399255`; matrix/catalog has 180 atomic Spec IDs.
- 175 automated specifications: all directly mapped test registrations and every executed parameter variant PASS. No automated Spec ID is missing, skipped, or unexecuted.
- Initial inventory: 74 existing mappings / 84 gaps / 5 device-only. 17 further direct contracts were added during review, yielding 101 new tests.
- Final full suite: 121 files PASS / 4 files SKIP; 967 tests PASS / 41 SKIP. Environment-dependent SKIPs outside the mapped automatic specifications are not counted as PASS.
- Emulator (demo-taskmemo-v2 only): V2 20 PASS; Functions 10 PASS. This does not establish iPhone/real Firebase acceptance.
- TypeScript, lint, diff-check, syntax reference check, generated matrix check, DEV-target optimized Web export PASS. Export remained a local artifact; no deploy.

## Cross-feature invariant

TW-INV-001/002/003: ordinary create/update/complete/duplicate/move/softDelete commands and the same initialRoutineFrequency/routineRuleForSave used by EditorModal generate the fixture. It includes nested Category, same-name Task, Idea, old relative duePreset values, absolute seconds/milliseconds, multiline/delimiter body, completed Task, day/week/month/year Routine and completion history. The real tree rows adapter/list deadline projection feed Text sessions. No-edit strict prepare has 0 errors / 0 changes / 0 deleted IDs. Local/account-scope API restart and no-edit commit preserve storage/History/Outbox. TW-INV-004 separately checks that real EditorModal remains wired to the tested recurrence boundaries. Actual phone create/login is not simulated by this API fixture.

Component tests mount the actual Text Workspace with React DOM/jsdom and mocked React Native primitives, palette provider and Clipboard. They exercise draft/debounce, strict save, commit failures, destructive confirmation, continue/discard/save-close, candidate replacement, copy success/failure, read-only checkboxes and theme palettes. Source-contract levels in the matrix test wiring/dependencies; they do not certify rendered mobile UI.

## Initial failures and their handling

- Extra rank-collision test initially appended the new row under @routine instead of the intended Category. It failed with a Routine error. Corrected the test indentation/location; did not weaken validator or rank safety.
- First full run alongside Emulator/export timed out in the existing production-derived local migration test at 5000 ms. Re-ran the suite alone and obtained PASS. No assertion, test skip or timeout change.
- Test compile/lint found an invalid operation label, wrong softDeleteNode argument position, mock children-prop and unused imports. Corrected test code; no production runtime change.

## Direct executed evidence

Commands: `npx vitest run --reporter=default --reporter=json --outputFile.json=artifacts/private/issue59-trace-full.json` then `npx tsx scripts/text-workspace-traceability.ts --results artifacts/private/issue59-trace-full.json`. The results guard also has negative tests for missing, skipped and failed IDs.

| Spec ID | Executed input variants | Result |
|---|---:|---|
| TW-FMT-001 | 1 | PASS |
| TW-ERR-001 | 1 | PASS |
| TW-FMT-002 | 1 | PASS |
| TW-FMT-003 | 7 | PASS |
| TW-VAL-001 | 1 | PASS |
| TW-DUE-001 | 8 | PASS |
| TW-DUE-002 | 11 | PASS |
| TW-DUE-003 | 1 | PASS |
| TW-DUE-004 | 1 | PASS |
| TW-SER-001 | 2 | PASS |
| TW-TREE-001 | 1 | PASS |
| TW-SER-002 | 1 | PASS |
| TW-ID-001 | 1 | PASS |
| TW-ID-002 | 1 | PASS |
| TW-TREE-002 | 1 | PASS |
| TW-TREE-003 | 1 | PASS |
| TW-LIST-001 | 1 | PASS |
| TW-DEL-001 | 1 | PASS |
| TW-LIST-002 | 1 | PASS |
| TW-LIST-003 | 1 | PASS |
| TW-LIST-004 | 1 | PASS |
| TW-DEL-002 | 1 | PASS |
| TW-TREE-004 | 1 | PASS |
| TW-DEL-003 | 1 | PASS |
| TW-REF-001 | 3 | PASS |
| TW-CON-001 | 1 | PASS |
| TW-VAL-002 | 1 | PASS |
| TW-RTN-001 | 1 | PASS |
| TW-RTN-002 | 1 | PASS |
| TW-RTN-003 | 1 | PASS |
| TW-RTN-004 | 1 | PASS |
| TW-TYPE-001 | 1 | PASS |
| TW-TYPE-002 | 1 | PASS |
| TW-FMT-004 | 1 | PASS |
| TW-ID-003 | 1 | PASS |
| TW-RANK-001 | 1 | PASS |
| TW-GUARD-001 | 1 | PASS |
| TW-FIX-001 | 2 | PASS |
| TW-SYS-001 | 1 | PASS |
| TW-RTN-005 | 1 | PASS |
| TW-RTN-006 | 1 | PASS |
| TW-RTN-007 | 1 | PASS |
| TW-SYS-002 | 5 | PASS |
| TW-LIST-005 | 1 | PASS |
| TW-SYS-003 | 1 | PASS |
| TW-SYS-004 | 1 | PASS |
| TW-RTN-008 | 3 | PASS |
| TW-FIX-002 | 1 | PASS |
| TW-RTN-009 | 1 | PASS |
| TW-RANK-002 | 1 | PASS |
| TW-FIX-003 | 1 | PASS |
| TW-OCC-001 | 1 | PASS |
| TW-VIEW-001 | 1 | PASS |
| TW-HL-001 | 1 | PASS |
| TW-CLOSE-001 | 1 | PASS |
| TW-LOCAL-001 | 2 | PASS |
| TW-SCOPE-001 | 1 | PASS |
| TW-SYS-005 | 1 | PASS |
| TW-HIST-001 | 1 | PASS |
| TW-HIST-002 | 1 | PASS |
| TW-HIST-003 | 1 | PASS |
| TW-HIST-004 | 1 | PASS |
| TW-GUARD-002 | 1 | PASS |
| TW-ATOMIC-001 | 1 | PASS |
| TW-CON-002 | 1 | PASS |
| TW-CON-003 | 1 | PASS |
| TW-DUE-005 | 1 | PASS |
| TW-ATOMIC-002 | 1 | PASS |
| TW-ATOMIC-003 | 1 | PASS |
| TW-ATOMIC-004 | 1 | PASS |
| TW-META-001 | 1 | PASS |
| TW-SYNC-001 | 1 | PASS |
| TW-HIST-005 | 1 | PASS |
| TW-FIX-004 | 3 | PASS |
| TW-FMT-005 | 1 | PASS |
| TW-FMT-006 | 1 | PASS |
| TW-FMT-007 | 1 | PASS |
| TW-FMT-008 | 1 | PASS |
| TW-FMT-009 | 1 | PASS |
| TW-VAL-003 | 1 | PASS |
| TW-VAL-004 | 1 | PASS |
| TW-VAL-005 | 1 | PASS |
| TW-VAL-006 | 1 | PASS |
| TW-REF-002 | 1 | PASS |
| TW-REF-003 | 1 | PASS |
| TW-REF-004 | 1 | PASS |
| TW-TREE-005 | 1 | PASS |
| TW-TREE-006 | 1 | PASS |
| TW-TREE-007 | 1 | PASS |
| TW-TREE-008 | 1 | PASS |
| TW-LIST-006 | 1 | PASS |
| TW-LIST-007 | 1 | PASS |
| TW-LIST-008 | 1 | PASS |
| TW-LIST-009 | 1 | PASS |
| TW-DUE-006 | 1 | PASS |
| TW-DUE-007 | 1 | PASS |
| TW-DUE-008 | 1 | PASS |
| TW-OCC-002 | 1 | PASS |
| TW-OCC-003 | 1 | PASS |
| TW-OCC-004 | 1 | PASS |
| TW-HL-002 | 1 | PASS |
| TW-HL-003 | 1 | PASS |
| TW-HL-004 | 1 | PASS |
| TW-HL-005 | 1 | PASS |
| TW-CLOSE-002 | 1 | PASS |
| TW-CLOSE-003 | 1 | PASS |
| TW-CLOSE-004 | 1 | PASS |
| TW-GUARD-003 | 1 | PASS |
| TW-GUARD-004 | 1 | PASS |
| TW-GUARD-005 | 1 | PASS |
| TW-GUARD-006 | 1 | PASS |
| TW-META-002 | 1 | PASS |
| TW-META-003 | 1 | PASS |
| TW-META-004 | 1 | PASS |
| TW-META-005 | 1 | PASS |
| TW-META-006 | 1 | PASS |
| TW-META-007 | 1 | PASS |
| TW-CON-004 | 1 | PASS |
| TW-CON-005 | 1 | PASS |
| TW-RTN-010 | 1 | PASS |
| TW-RTN-011 | 1 | PASS |
| TW-RTN-012 | 1 | PASS |
| TW-VIEW-002 | 1 | PASS |
| TW-VIEW-003 | 1 | PASS |
| TW-VIEW-004 | 1 | PASS |
| TW-VIEW-005 | 1 | PASS |
| TW-VIEW-006 | 1 | PASS |
| TW-VIEW-007 | 1 | PASS |
| TW-VIEW-008 | 1 | PASS |
| TW-VIEW-009 | 1 | PASS |
| TW-VIEW-010 | 1 | PASS |
| TW-VIEW-011 | 1 | PASS |
| TW-VIEW-012 | 1 | PASS |
| TW-VIEW-013 | 1 | PASS |
| TW-VIEW-014 | 1 | PASS |
| TW-INV-001 | 1 | PASS |
| TW-INV-002 | 1 | PASS |
| TW-INV-003 | 1 | PASS |
| TW-UI-001 | 1 | PASS |
| TW-UI-002 | 1 | PASS |
| TW-UI-003 | 1 | PASS |
| TW-UI-004 | 1 | PASS |
| TW-UI-005 | 1 | PASS |
| TW-UI-006 | 1 | PASS |
| TW-UI-007 | 1 | PASS |
| TW-UI-008 | 1 | PASS |
| TW-UI-009 | 1 | PASS |
| TW-UI-010 | 1 | PASS |
| TW-UI-011 | 1 | PASS |
| TW-UI-012 | 1 | PASS |
| TW-UI-013 | 1 | PASS |
| TW-UI-014 | 1 | PASS |
| TW-UI-015 | 1 | PASS |
| TW-UI-016 | 1 | PASS |
| TW-UI-017 | 1 | PASS |
| TW-UI-018 | 1 | PASS |
| TW-UI-019 | 1 | PASS |
| TW-UI-020 | 1 | PASS |
| TW-TRACE-001 | 1 | PASS |
| TW-TRACE-002 | 1 | PASS |
| TW-TRACE-003 | 1 | PASS |
| TW-TRACE-004 | 1 | PASS |
| TW-UI-021 | 1 | PASS |
| TW-UI-022 | 1 | PASS |
| TW-UI-023 | 1 | PASS |
| TW-UI-024 | 1 | PASS |
| TW-UI-025 | 1 | PASS |
| TW-SCOPE-002 | 1 | PASS |
| TW-CON-006 | 1 | PASS |
| TW-RANK-003 | 1 | PASS |
| TW-META-008 | 1 | PASS |
| TW-SER-003 | 1 | PASS |
| TW-INV-004 | 1 | PASS |
| TW-ARCH-001 | 1 | PASS |
| TW-UI-026 | 1 | PASS |

## Remaining device boundaries

The five TW-DEVICE IDs retain their reasons and minimum steps in the matrix. Earlier Issue comments record iPhone Safari/PWA form typography PASS and non-Routine Phase 7 checks complete. Those reports are not replaced by the new automated suite. Routine phone verification and OS/Firebase boundaries retain their own acceptance status; Android native acceptance is not inferred from iPhone.

No production Firebase/Functions/Rules/Hosting operations, no DEV deploy, no Issue #59 Close. Existing working-tree changes are preserved.
