# Stock transaction, outbox and event delivery

Implement the command path described in [domain](../../docs/domain.md), [persistence](../../docs/persistence.md), and [events](../../docs/events.md). This is the most important architecture demonstration in StockFlow.

## Command sequence

1. Inventory presentation validates request shape, converts quantity with `toMillis` and passes a normalized command plus idempotency key to `StockUseCases.change` with type `ADD` or `REMOVE`.
2. The use case looks up an existing movement by key. The same product/action/amount/normalized reason returns its original `StockChangeResult`; different input returns `IDEMPOTENCY_CONFLICT`.
3. Load current InventoryItem. If absent, an add verifies Product through `ProductCatalog` and starts from zero; a remove rejects as `INSUFFICIENT_STOCK` without writing.
4. Call `InventoryItem.addStock` or `.removeStock`. Only a valid change yields a new balance and `StockAdded` or `StockRemoved` domain event.
5. Build one movement and one event envelope with stable UUIDs and identical occurrence time. `StockUnitOfWork` uses one MongoDB transaction to insert/update Inventory, insert movement and insert pending outbox row.
6. Version-check the balance update. On a write conflict or first-insert race, abort, reload and rerun the domain rule, at most three attempts. A duplicate idempotency key race resolves by reading the committed movement. Report failure after exhausted retries; never accept a negative balance.
7. Return the committed result. The response does not wait for NATS or audit processing.

No cross-service transaction is attempted. Product existence is checked before opening the Inventory transaction. The Inventory MongoDB replica set is required for this multi-collection commit.

## Relay and consumer sequence

The Inventory relay is one process instance in the local design. It polls due pending outbox rows every 500 ms, at most 100 per batch. It publishes the stored v1 event envelope to `inventory.stock.added` or `inventory.stock.removed` with JetStream message ID equal to `eventId`. After `PubAck`, it marks the row published. On failure, the row remains pending with attempt count and retry delay (1 s, 5 s, 30 s, then 5 min). A crash after publish but before marking may publish twice.

`setup:nats` creates `STOCK_EVENTS` with file storage, one replica, WorkQueue retention and subjects `inventory.stock.*`, plus one durable explicit-acknowledgment pull consumer `stock-audit`. It does not automatically evict unacknowledged events by age or count; if disk fills, the outbox continues to retry. The audit worker validates the v1 envelope, inserts with `_id = eventId`, compares payloads after duplicate-key failures, and acknowledges only after a successful identical stored result. Different payload under the same event ID or malformed/unsupported events stay unacknowledged and are logged for investigation.

## Failure outcomes

| Failure | Inventory balance/movement | Outbox | Audit |
| --- | --- | --- | --- |
| Invalid or insufficient command | Unchanged; no movement | No row | No event |
| MongoDB transaction aborts | Unchanged; no movement | No row | No event |
| NATS unavailable after commit | Committed | Pending and retrying | Arrives after recovery |
| Worker offline | Committed | Published after PubAck | JetStream retains until worker returns |
| Worker MongoDB unavailable | Committed | Published | Unacknowledged and redelivered |
| Relay duplicate | One committed change | At most one event intent | One audit row by event ID |

## Required proof

- [x] Domain tests show positive addition/removal and zero, negative, over-precision, overdraw and upper-bound rejection.
- [x] Transaction integration test proves all-or-none writes across inventory, movement and outbox.
- [x] Concurrent removals cannot both spend the same balance; first insert races also resolve.
- [x] Idempotent replay returns original result and different-payload reuse fails without an extra movement.
- [x] NATS and worker outages recover with one persisted audit row per event ID.
- [x] The demo can trace Angular → BFF → Inventory use case → domain → MongoDB → outbox → JetStream → audit worker.
