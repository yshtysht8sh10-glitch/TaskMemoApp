# Sync V2 cutover materials — 2026-09-20

Status: materials complete; the private Release Manifest may report `READY_FOR_PHASE_0` after final verification. This document does not authorize production cutover or any production change.

## Confirmed materials

- Authoritative repaired iPhone source: SHA-256 `4da5ae29e427831025da485e40f84fc21180591421c40b26e62d3d7817bcae73`, 124 Nodes, `ipa-morning` excluded.
- Production Web App identity was obtained using Firebase CLI read-only app listing/SDK-config commands. No Firestore data was read.
- Production V2 PWA was locally exported from a clean pushed commit with production project `taskmemoapp-eabc3`, environment `production`, V2 enabled and release channel `production-v2-cutover`. It was not deployed.
- The first-write canary is a semantic no-op update of active Task Memo `ddd-book`: content and timestamps remain byte-semantically unchanged while revision advances from 0 to 1 and one immutable receipt is created.
- Canary Emulator rehearsal used all 124 authoritative Nodes and passed winner, receipt, duplicate retry, second-client convergence and restart exact validation.

Private paths, build URLs and hashes live only in the gitignored release manifest/audit artifacts.

Artifact evidence:

- PWA source commit: `f03edd279a82cc2e6eddcf5124dae0e040c7914a`; canonical artifact SHA-256 `10241949e5edc2da9573e9f2df5f2a81cb568d344daf47ee3ff1ff43cd32f9e4`; private ZIP SHA-256 `7e09809e465f7cf9190e59a2cdef74d540c65b43f7bea59428b8ae846849ce5e`.
- Android source commit: `f03edd279a82cc2e6eddcf5124dae0e040c7914a`; EAS Build `6b5f9723-3af4-46ff-bedb-bd959505feee`; private APK SHA-256 `250dd21535f9c2a4768f9e6013876800b5ccb1bc7fbf9b564525cf8e50aee8c3`.
- Canary artifact SHA-256 `f7dbf7d469652c1c5e4bf7542e8b36727168983d356c602d5d224f38b5b497a7`; rehearsal report SHA-256 `f3a73425443cfa08420d6b4572d2a44b1c693f5ad410e5535b6315fb2a84d11a`.

## Functions rollback decision

`FUNCTIONS_ROLLBACK_NOT_APPLICABLE`.

Authenticated read-only checks established that both `cloudfunctions.googleapis.com` and `run.googleapis.com` are disabled, the configured canonical endpoint `https://asia-northeast1-taskmemoapp-eabc3.cloudfunctions.net/taskMemoMcp` returns 404, and the repository records no production Functions deployment. No API was enabled and no production write/deploy occurred. The create-only private evidence artifact records these observations and its SHA-256; there is no deployed revision to restore.

## Immutable backup destination decision

**USER-APPROVED RISK ACCEPTANCE (2026-09-20):** for this personal-development, single-user cutover, Cloud Storage Retention Lock is removed from the mandatory requirements. GCP billing remains disabled and no Cloud Storage bucket is created.

The accepted compensating controls are:

- create-only private artifacts in the repository-local private directory;
- a second create-only copy in the existing OneDrive-synchronized `TaskMemo-Cutover-Backup/2026-09-20-phase0-materials-v1` destination;
- recorded SHA-256 for the authoritative source, both production snapshots and every copied cutover artifact;
- retrieval and SHA-256 re-verification of every second copy;
- the previously passed exact isolated restore evidence.

The private independent-backup evidence artifact records the destination, inventory and verification result. The remaining risk is accepted explicitly by the user; this is not equivalent to provider-enforced immutability and does not weaken any runtime data-safety rule.

## Android artifact

The formal profile is `production-v2-cutover`, internal distribution. It contains the exact production Firebase public config, `EXPO_PUBLIC_SYNC_V2_ENABLED=true`, and release channel `production-v2-cutover`. EAS Build `6b5f9723-3af4-46ff-bedb-bd959505feee` finished successfully. EAS Build did not publish or update the installed production app. Two earlier preparation builds lacked the complete Firebase profile and are explicitly not release artifacts.

## Phase 0 gate

Phase 0 remains prohibited until the private release manifest reports `READY_FOR_PHASE_0`. That status permits Phase 0 preflight only; it does not authorize Phase 1 or any production change.
