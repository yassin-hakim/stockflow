# Verification and interview demo

## Status

The host-process implementation passed the full browser and database-backed scenario with local MongoDB/NATS and again with the pinned Docker Compose containers. Compose startup and named-volume restart passed. Browser keyboard and accessibility-tree checks plus axe checks covered routes, validation states and responsive widths; a human screen-reader session was not performed. See [recorded evidence](../implementation/verification.md).

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
| End to end | Product creation → stock changes → history → audit; rejected removal leaves all state unchanged | Running five processes, MongoDB and NATS |

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

## Original definition-of-done checklist

The 27 items below have runtime or source evidence. Compose and automated accessibility checks are recorded in [implementation verification](../implementation/verification.md).

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
