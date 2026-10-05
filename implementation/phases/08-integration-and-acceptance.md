# Phase 8 — Integration, failure recovery and acceptance

## Goal and inputs

Prove the *entire* StockFlow implementation, then update project documentation to show only commands and behavior that work. This phase runs [implementation verification](../verification.md) and the canonical [testing/demo guide](../../docs/testing.md) against the five processes, MongoDB and NATS. It closes every F01–F08 and A01–A09 requirement in [docs/requirements.md](../../docs/requirements.md) and all 27 original definition-of-done items; a phase-specific unit test alone cannot satisfy this gate.

## Includes

From a clean source copy, install dependencies, start Compose, initialize/check `rs0`, run idempotent `setup:nats`, start Product Service, Inventory Service, BFF, audit worker and Angular, and inspect liveness/readiness. Run pure domain/application tests, HTTP contract checks, MongoDB transaction/concurrency checks, JetStream/audit recovery checks, Angular component/HTTP tests and a browser end-to-end flow. Check source imports and browser network output for boundary violations.

Execute the interview scenario through the UI: create Arabica Coffee (`kg`, category Coffee, threshold 5); observe zero/OUT without a physical Inventory row; add 50 kg and observe an ADD movement and StockAdded audit event; remove 10 kg and observe 40 kg, a REMOVE movement and StockRemoved audit event; attempt to remove 50 kg and observe `409 INSUFFICIENT_STOCK`, still 40 kg, and no third movement/outbox/audit event. Correlate IDs and timestamps across HTTP result, MongoDB records, outbox, JetStream PubAck and audit row.

Exercise the important failure paths: concurrent first additions, concurrent removals, exact and conflicting idempotency replays, transaction abort, Product/Inventory outage, NATS outage and catch-up, worker restart, duplicate delivery and audit MongoDB outage. Verify that a successful stock HTTP response means a MongoDB commit but can precede audit arrival. Update root README startup and demo instructions from commands actually run, and keep design/implementation docs aligned with observed behavior.

## Implementation progress

- [x] Run every test layer and resolve mismatches in code or the documented contract deliberately.
- [x] Start all five apps and infrastructure from a clean checkout using documented scripts; repeat after a non-destructive restart.
- [x] Capture public/internal HTTP responses, browser network trace, MongoDB state, outbox state, JetStream publish/consumer state and audit rows for the demo.
- [x] Run the full success scenario and rejected removal through the Angular UI.
- [x] Run outage, duplicate, idempotency, concurrent-removal and transaction-abort scenarios with persisted-state checks.
- [x] Update root README and operations guide with verified startup/health/demo commands and exact pinned version matrix.
- [x] Review all 27 original definition-of-done boxes and all F/A requirement rows against evidence.

## Exit gates

- [x] A fresh setup reaches healthy MongoDB `rs0`, NATS JetStream and all five application processes using only the documented commands; normal restart preserves data/events.
- [x] Domain/application, HTTP, persistence, messaging, Angular and browser end-to-end suites all pass with no skipped required scenario.
- [x] The 50 → 40 kg demo produces exactly two movements and two audited stock events; rejected 50 kg removal changes none of balance, movement, outbox or audit counts.
- [x] Concurrent and repeated commands cannot make stock negative or double-apply a stock change; broker/worker/database outages recover as specified without silently losing committed event intent.
- [x] Browser calls only `/api`; BFF has no business mutation rule; services never query each other's database; domain/application imports obey hexagonal boundaries.
- [x] Every F01–F08, A01–A09 and original 27-item definition-of-done entry has direct inspected evidence, and the README architecture diagram/rationale match the running system.

**Completion rule:** mark Phase 8 and the phase index complete only after all gates above and the original definition of done are checked from authoritative runtime evidence. The presence of these Markdown files does not complete the application.
