# Verification and interview demo

## Status

The original five-process inventory baseline passed the browser and database-backed scenario with local MongoDB/NATS and again with the pinned Docker Compose containers. Compose startup and named-volume restart passed. Browser keyboard and accessibility-tree checks plus axe checks covered routes, validation states and responsive widths; a human screen-reader session was not performed. See [recorded evidence](../implementation/verification.md).

## Test layers

| Layer | Cases | Evidence |
| --- | --- | --- |
| Domain unit | Add increases balance; remove decreases; zero/negative/over-precision amount rejected; insufficient stock rejected; maximum balance enforced | Pure TypeScript tests with no NestJS, MongoDB or NATS |
| Application unit | Add/remove call expected ports; first add checks Product; rejected operation performs no commit; exact idempotency replay returns original result | Fake ports and call assertions |
| Product API | Create/list/get; trimmed required fields; threshold default and limits; unknown ID | Controller/integration tests |
| Inventory API | First add creates balance; initial remove rejects; movement order; error codes; same and conflicting idempotency keys | HTTP integration tests |
| MongoDB integration | Transaction atomicity, unique indexes, concurrent removals, outbox pending state and uncertain retry | Local replica-set database |
| NATS integration | Publish acknowledgment, worker persistence and acknowledgment, outage/restart catch-up, duplicate-safe audit | Real JetStream and audit database |
| Angular | Product/stock forms, loading/empty/error states, accessible status, responsive layout, no internal-service calls | Component tests and browser flow |
| End to end | Product creation → stock changes → history → audit; rejected removal leaves all state unchanged | Original baseline: five processes; expansion: six including Sales; MongoDB and NATS |

## Critical failure scenarios

1. Start at 40 kg and send two concurrent 30 kg removals with different keys. Exactly one may commit; the other must return `INSUFFICIENT_STOCK`. The final balance is 10 kg with one new movement and event.
2. Start two concurrent adds of 30 kg and 20 kg for a Product with no Inventory row, using different keys. Both commands should succeed, leave 50 kg, and create two movements and event intents.
3. Send the same add command twice with one key, including after a simulated response timeout. Both responses describe the original commit; balance changes only once, with one movement and one outbox event.
4. Reuse an existing key with a different quantity or reason. Return `IDEMPOTENCY_CONFLICT` and make no change.
5. Use the repeatable [NATS outage drill](operations.md#nats-outage-drill): stop NATS between `prepare` and `offline`, confirm stock still commits with a pending outbox event, restart NATS, then confirm one PubAck-backed published row and one matching audit record.
6. Stop the audit worker, add stock, restart it, and verify JetStream delivers the retained event. Repeat delivery and verify the audit collection still has one row.
7. Force MongoDB transaction failure before commit. Confirm no changed balance, movement or outbox row. Force audit MongoDB failure; confirm the JetStream event is not acknowledged and is retried.
8. Make Inventory Service unavailable during a dashboard request. Angular displays an error and retry action, not zero balances.

## Interview walkthrough

1. Show that the frontend calls only `/api`, and the BFF calls the owning services. Create **Arabica Coffee**, unit `kg`, category `Coffee`, low-stock threshold `5` through the Angular form.
2. Show the new product at `0 kg`, status `OUT`, with no persisted Inventory row or movements.
3. Add `50 kg`, reason `Supplier delivery`. Observe `50 kg`, `OK`, one `ADD` movement, a committed outbox event, a JetStream publish acknowledgment for `StockAdded` and one audit row.
4. Remove `10 kg`, reason `Restaurant order`. Observe `40 kg`, `OK`, a second `REMOVE` movement, a JetStream publish acknowledgment for `StockRemoved` and a second audit row.
5. Attempt to remove `50 kg`. Observe HTTP `409 INSUFFICIENT_STOCK`; stock remains `40 kg`, with no third movement, outbox row or audit event.
6. Point to the `InventoryItem` domain method, `StockUnitOfWork` port, MongoDB adapter, outbox relay, NATS adapter and audit consumer to trace the full path.

The test is complete only when the UI, database state and audit evidence agree. “HTTP 200” alone does not prove that an event was consumed.

## Historical original definition-of-done checklist

The 27 baseline items below have historical runtime or source evidence; they do not establish expansion completion. Compose and automated accessibility checks are recorded in [implementation verification](../implementation/verification.md).

- [x] Angular application runs.
- [x] BFF runs.
- [x] Product Service runs.
- [x] Inventory Service runs.
- [x] MongoDB runs.
- [x] NATS runs with JetStream enabled.
- [x] Angular communicates only with the BFF.
- [x] BFF communicates with internal services.
- [x] Product Service owns product data.
- [x] Inventory Service owns inventory data.
- [x] MongoDB persistence works.
- [x] Add stock works.
- [x] Remove stock works.
- [x] Stock cannot become negative, including concurrent removals.
- [x] Stock movements are recorded.
- [x] Stock events are published to NATS.
- [x] NATS events are consumed and persisted by the audit worker.
- [x] Domain logic is framework-independent.
- [x] Repository ports are defined.
- [x] MongoDB repositories implement those ports.
- [x] Event publisher port is defined.
- [x] NATS publisher implements the event publisher port.
- [x] Domain tests exist and pass.
- [x] Application/use-case tests exist and pass.
- [x] README contains architecture documentation.
- [x] README contains an architecture diagram.
- [x] README explains why each architectural decision was made.

The last three documentation items are satisfied by the root README: it explains the architecture, contains a Mermaid diagram, and states the reasons for the chosen technologies and boundaries. Runtime evidence is linked above.

## Expansion verification scope

The original checklist is preserved above. New X01–X13 requirements and E01–E12 exits are tracked in the [expansion acceptance tracker](../implementation/expansion/phases-and-acceptance.md), [expansion evidence](../implementation/expansion/verification.md) and [requirement-to-evidence audit](../implementation/expansion/requirement-evidence.md). Implemented source/builds or the old verified baseline never substitute for the expanded runtime/browser gates. Later source changes need affected checks even when an earlier clean source copy passed.

| Layer | Expanded coverage target |
| --- | --- |
| Product domain/application | Immutable units, unique SKU, conditional edit/archive, active ingredients, immutable recipe revisions, checked quantity/money totals |
| Inventory domain/application | Atomic bundles, paired transfers, categorized waste, count version/absence/zero semantics, rule boundaries, original-allocation cumulative returns |
| Sales domain/application | Owner pricing, reviewed version/configuration, frozen attempt keys, refund bounds, no-restock versus return, pending recovery |
| Mongo replica-set integration | Forced transaction rollback, concurrent overdraw/returns, count stale/replay, receipt/attempt/event uniqueness, persisted intent/finalization crashes |
| HTTP/BFF | Public-only browser contract, validation/errors/request IDs, terminal/pending/status semantics, period/cursor filters, exports |
| JetStream/Audit | Existing v1/new v2 stock coexistence, Sales events, broker/worker outages, immutable event-ID deduplication |
| Angular/browser | Every new route, desktop/mobile around 700/701 px, forms and retained input, keyboard/focus, pending refresh/retry, print rendering |
| Setup/migration | Fresh empty initialization and migrated legacy data separately; process restart, schema guards, retained data and setup reruns |

Run from repository root:

```sh
npm run build
npm test
npm run test -w @stockflow/frontend -- --watch=false
npm run check:boundaries
npm run check:docs
npm run verify:inventory-expansion
```

`verify:inventory-expansion` creates and drops its own uniquely named database, using real replica-set transactions and a fake Product port. It exercises atomic bundles/replay, forced rollback, concurrent transfers, original-allocation/cumulative return bounds, supplier validation, count create/edit/apply/replay/stale/absence/unchanged zero, rules, report/cursor/date boundaries and movement/outbox cardinality. It does not prove real HTTP, JetStream or browser acceptance.

Additional executable fixtures are [inventory migration](../scripts/verify-inventory-migration.ts), [warehouse operations](../scripts/verify-warehouse-operations.ts) and [Sales recovery](../scripts/verify-sales-recovery.ts). Inspect their environment targets and assertions before running. Migration and Sales recovery use isolated databases; warehouse verification uses running BFF services and creates distinct fixture products/locations in their configured local databases. The Sales recovery fixture exercises real Sales persistence with controlled ports/faults; it must be complemented by the real Product/Inventory workflow and broker audit checks.

Product recipe Mongo tests require `PRODUCT_TEST_MONGO_URI`; Sales Mongo tests require `SALES_TEST_MONGO_URI`. Both create their own guarded disposable databases. A backend run with these absent skips those tests and must report the skip count. The retained clean-copy setup artifact records a run with both set and zero skips; no successful unit count alone proves real HTTP or Audit behavior.

The [fresh runtime verifier](../scripts/verify-expansion-runtime.ts) uses the already-built `.tools/expansion-review-20261006` copy, new owner database names, unused ports 3100–3104/4300 and a separate broker. It refuses occupied ports and stops only its spawned processes. Its actual crash/lost-response/broker/Audit assertions are retained in `output/verification/fresh-expansion-runtime.json`. It does not run the entire interview scenario, all database outages or every browser state. The live [expanded demo](../scripts/verify-expansion-demo.ts), [cost scenario](../scripts/verify-cost-reporting.ts) and final rendered matrix provide complementary evidence. Read target configuration before running any live scenario; these create fixture records in their configured local services.

## Expanded interview acceptance scenario

1. Create coffee (kg), milk (L), Main Store and Bar; receive 20 kg/10 L in one delivery.
2. Transfer 5 kg/2 L to Bar. Main Store becomes 15 kg/8 L; restaurant total stays 20 kg/10 L.
3. Publish a latte at 400 USD minor units with 0.018 kg coffee + 0.200 L milk.
4. Complete three lattes from Bar: total 1200, stock 4.946 kg/1.400 L, one receipt and two consumption movements.
5. Record 0.100 L waste, then count 4.900 kg/1.250 L; review -0.046 kg/-0.050 L and apply once.
6. Set Bar milk threshold 1.500 L/target 3.000 L: server suggests 1.750 L.
7. Seven further lattes require 1.400 L milk and reject the entire bundle; coffee and completed-sale count stay unchanged.
8. Refund one original latte with no restock: gross 1200/refund 400/net 800; ingredients stay consumed.
9. Use separate fixtures to prove edited recipes cannot alter old returns, stale counts reject, concurrent transfers/returns respect limits, and unchanged counts create no events.
10. Inspect owner documents, operation IDs, movements, outbox and eventual audit. Repeat uncertain checkout with the same key and restart around Inventory commit/finalization to prove one sale/consumption/receipt.

Also inspect report/export reconciliation, half-open period boundaries, source-outage errors, spreadsheet-formula protection, receipt print layout and saved browser state. Stop/restart drills mutate local process/infrastructure state and belong in the controlled acceptance session. Record exact observed commands/responses/fixtures/captures; final expansion acceptance remains pending until every required exit is inspected.
