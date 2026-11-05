# Startup performance: Production Hosting preparation

Prepared locally on 2026-11-05. No Production deployment or Production data change is authorized by this record.

## Source boundary

- Production baseline: `5890894948e77a9e6c4f3ad35abc2cf1c7aea3bf`.
- Live Hosting release: `1793706864826000`, version `2ed666de96cece70` (2026-11-03).
- DEV implementation branch: `perf/startup-local-first`; initial implementation `a52f1ffbd409c8059ca9f90ef2b25f5fa34eaf01`, SDK field-order regression fix `44623f899d8fc830f4f68e34d0098332bd78e71a`.
- Production-only branch: `release/startup-performance`; baseline plus the performance changes. Runtime adaptations preserve the Production self-echo rules without importing DEV queue registers.

The cherry-pick conflicts were resolved by keeping only the new initial-snapshot SDK test and the batch receiver. No Queue UI/model/register changes, Routine action redesign, Rules, Functions, Firebase configuration, data schema or migration change is included. `scripts/verify-startup-release.mjs` checks the explicit changed-file allowlist against the deployed baseline.

## Live DEV validation boundary

The disposable account and synthetic 1,000-Node fixture are in `taskmemoapp-dev` only. Account provisioning uses a create-only account-specific compatibility gate; global policy is read and never modified. This does not claim to validate the normal new-user App Check/onboarding callable. Browser tests use the Production-only runtime exported with DEV configuration, real Firebase Auth/Firestore SDKs, an isolated localhost origin and disabled Service Workers. No existing user account/profile or Production app is opened.

The live tests cover cache-first read-only display, server-confirmed editing transition, Cloud blocking and injected Firestore delay, pending Outbox after offline edit/restart, server receipt/acknowledgement, Undo/Redo, history after context restart, mismatching Journal preservation and raw-equal redundant Journal cleanup. The final numeric evidence and commit/asset hashes are sealed outside the repository in `../artifacts/startup-release-20261105/REPORT.md` and JSON evidence files. Credentials and browser auth state are private test artifacts and are never part of the Hosting public directory.

During live verification, object field order from SDK/cache decoding caused one unnecessary unchanged snapshot write. The follow-up keeps every per-record merge, Outbox acknowledgement and sequence update, then skips persistence only when the domain reference, sequence, Outbox and bounded seen window all remain unchanged. A 600-record field-order regression was confirmed failing before the fix. This does not replace raw CAS with a fingerprint.

## Artifact preparation

1. Build the clean Production-only commit using `npm run web:export:production-v2` locally.
2. Freeze it into the dedicated `hosting-candidate` directory in the artifact folder. Keep the current deployed SW, web manifest, diagnostic/recovery JS, CSS/icons and prior hashed entry bundles byte-for-byte. Preserve all previous paths; generated runtime/build-marker HTML may change.
3. Recompute the manifest canonical artifact hash after packaging. Only that frozen directory is a deployment input; neither a DEV export nor mutable `dist` is a release input.
4. Use the dedicated config with a single `hosting` key, exact Production site, and existing live headers/rewrites. It has no Rules/Functions deployment sections. `ignore: []` preserves the reviewed complete file set.
5. Run the read-only release gate from this checkout against the artifact, baseline proof and Hosting config. The gate verifies source scope, clean HEAD, manifest/hash, old asset retention, unchanged SW, and Hosting-only configuration.

Hosting API inventory hashes are SHA-256 of gzip(level 9) content. The baseline proof records those separately from SHA-256 of HTTP response bytes. Do not compare these two hash types directly.

## Approval boundary and future deployment

Do not deploy under this preparation task. A future separately authorized Hosting-only deployment must first re-read live release/version and abort if they differ from the sealed baseline. Verify all frozen file hashes and current HEAD again, then use the exact config and project with `--only hosting`. After activation, verify static manifest/build markers, all published byte hashes, Hosting headers and SW using read-only HTTP/API requests. Do not launch/reload an incident Production PWA as a static verification step.

## Rollback (prepared, not executed)

If an approved future deployment activates invalid content, use the captured old Hosting version within separately authorized rollback scope:

```powershell
npx firebase-tools hosting:clone taskmemoapp-eabc3@2ed666de96cece70 taskmemoapp-eabc3:live --project taskmemoapp-eabc3
```

Verify static manifest commit `5890894948e77a9e6c4f3ad35abc2cf1c7aea3bf`, old byte hashes and SW after rollback. No Rules/Functions/Auth/Firestore command is part of rollback. Hosting rollback cannot undo already committed local or Cloud operations. Do not clear browser data, reconstruct Journal, overwrite old snapshots, force sync, or force client reload.

## Residual risks

- Device PWA/Service Worker/offline shell updates and iOS/Android remain unqualified. Existing SW behavior is intentionally unchanged, including the previously documented offline caching limitations.
- Live network/Firestore startup latency varies; cache-first display does not promise faster authentication or server responses. Injected per-request latency can trigger SDK backoff and much longer total Cloud completion times.
- The localhost browser timings include real UI and SDKs but not Production CDN asset transfer or physical display paint. DOM commit and double-rAF observations are reported separately from server confirmation.
- A very large snapshot still uses one synchronous candidate merge and envelope. Mobile memory/long-task limits require separate device verification.
- Journal-present startup still requires its existing Cloud verification. Offline cache-first display never bypasses that protection.
