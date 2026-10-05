# Code review fixes and verification

Requested on 2026-10-05. Check an item only after its implementation and relevant verification pass. Preserve the existing local demo behavior and service boundaries.

## Correctness fixes

- [x] Validate the complete NATS retention/discard and consumer-filter configuration; reject incompatible resources without deleting retained events.
- [x] Use a consistent quantity codec that accepts valid thousandths across the full supported range and rejects finer precision.
- [x] Resolve concurrently committed idempotent commands before returning balance-dependent rejections.
- [x] Preserve unresolved stock commands and their original keys across navigation and refresh.
- [x] Compare duplicate audit events by their validated field values, independent of JSON property order.
- [x] Require string UUID fields at the event boundary.
- [x] Preserve framework HTTP exception statuses in all three services.

## Code improvements

- [x] Format compressed code and separate BFF controllers, validation, configuration, and module wiring.
- [x] Extract frontend templates and share the add/remove stock form component.
- [x] Consolidate stock movement and result DTO mapping.
- [x] Replace nested error-status ternaries with a typed mapping.
- [x] Explicitly await in-flight background work and close MongoDB/NATS resources during shutdown.

## Verification gates

- [x] Full workspace production build.
- [x] Backend regression suite, including each backend correctness fix and shutdown behavior.
- [x] Angular regression suite, including restored requests and reusable form behavior.
- [x] Architecture boundary and documentation link checks.
- [x] Live HTTP, MongoDB transaction/concurrency, JetStream deduplication, and end-to-end demo checks.
- [x] Browser verification of product creation, both stock forms, validation, navigation, and refresh recovery.
- [x] Final diff review and requirement-by-requirement completion audit.

## Evidence

All 19 checklist items are implemented and verified. The reviewed changes are included in the repository alongside the company reviewer setup fixes.

### Implementation evidence

- Shared pure quantity and UUID helpers: `packages/primitives/src/index.ts`; HTTP body-parser errors are normalized without exposing request bodies.
- Replay resolution and shared DTO mapping: Inventory application; unit cases cover concurrent empty/max balance replays and the final retry.
- NATS configuration validators reject byte/per-subject limits, unsafe discard, filtered/push consumers and inactive durable consumers. Existing old discard policy was rejected live, then upgraded with the explicit safe option; repeated setup passed without deleting retained messages.
- Pending commands are persisted before POST and restored in a fresh Angular context. Tests cover changed-command blocking, unavailable/full/corrupt storage, distinct form inputs and native submit events.
- Audit tests cover reordered duplicates, actual conflicts, UUID arrays and valid large resulting balances.
- Shutdown tests prove active outbox/audit work completes before resource closure. `verify-service-shutdown.ts` additionally confirmed all three real Nest application contexts close MongoDB and Inventory awaits an active publication.
- Production build passed. Final backend suite passed 90 tests across 12 files; Angular suite passed 18 tests across 6 files (108 tests total). The final Audit and frontend edits also passed their production builds.
- Live `verify:api`, `verify:atomicity`, `verify:dedup`, `verify:demo` passed against MongoDB 8.0.20 and NATS 2.15.0 Compose containers.
- `verify:review` passed for product `258aa3f9-c50e-4610-bc82-a184d2171c2e`: valid large threshold, audited fractional balance, eight same-key removals with one movement, reordered audit replay and real HTTP 404/413 responses in all services.
- On this Windows/WSL host, temporary loopback forwarders used MongoDB port 37017 and NATS port 4422 for verification; application defaults remain unchanged.

### Browser and final audit evidence

- Created product `2515b50d-057d-4416-aee8-59903ba7998d` through the UI, added 50 kg, and removed 10 kg.
- Deliberately dropped the response after the server committed a 1 kg addition. The original command key `ddff16a9-5f9f-4073-ada5-13f34ba5ea5d` and values survived refresh and navigation. Changing the quantity was blocked; restoring and retrying the original request succeeded.
- Independently inspected MongoDB after recovery: 41,000 milliunits and exactly 3 movements, 3 outbox entries, and 3 audit records. The replay did not duplicate the addition.
- Invalid four-decimal input was rejected locally with an associated error, `aria-invalid`, and focus on the quantity field. Desktop (1280 px) and mobile (375 px) rendered without horizontal overflow; both forms remained available and desktop panels retained equal heights.
- Inspected screenshots at `output/playwright/review-desktop.png` and `output/playwright/review-mobile.png` (local verification artifacts, ignored by Git).
- Architecture boundary checks and all 368 documentation links passed. The new verification/setup scripts passed strict TypeScript checks; `git diff --check` passed.
- Dependency installation ran the shared package's `prepare` build successfully; the package is ready for development from a fresh checkout.
- Final source audit distinguished 24 formatting-only TypeScript files from the intended behavior changes. Each correctness and cleanup item above was matched to implementation and regression/live evidence; no requested item remains open.

### Publication verification

After merging the fresh-install and company reviewer setup commit, the full workspace build passed, as did 90 backend tests across 12 files and 18 Angular tests across 6 files. Architecture boundary and documentation-link checks passed. The merge preserved `npm run configure`, runtime-version declarations, automatic MongoDB-primary waiting and `.env` loading in all four compiled backend start scripts.
