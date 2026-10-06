# Inventory Service implementation

The original add/remove baseline and its checked evidence are preserved below. Current location operations, counts, replenishment and sale allocations extend this service; their acceptance status belongs to the [expansion tracker](../expansion/phases-and-acceptance.md), not the historical checklist.

## Responsibility and boundary

Build `apps/inventory-service` as the sole owner of balances, movements and pending stock events. It runs as a NestJS HTTP process on local port 3002, with an outbox relay provider in the same process. It may call Product Service over HTTP to confirm a product on its first addition; it never reads Product MongoDB or stores product name/unit. Read [docs/domain.md](../../docs/domain.md), [docs/persistence.md](../../docs/persistence.md), and the [stock consistency path](../architecture/stock-consistency.md) first.

## Domain and application

The implemented domain has plain TypeScript `toMillis`, `InventoryItem`, `DomainStockMovement`, `DomainStockEvent` and domain errors. `InventoryItem.addStock` and `.removeStock` accept a normalized command and enforce positive milliunit amounts, maximum balance and nonnegative stock. `StockUseCases` exposes `change`, `get`, `list` and `movements`; `PublishPendingEvents.execute` handles outbox publication. Service-specific ports are `StockUnitOfWork`, `InventoryRepository`, `StockMovementRepository`, `OutboxRepository`, `ProductCatalog` and `EventPublisher`. `StockStore` combines stock reads and commit capabilities. The domain imports no adapters or NestJS APIs.

The stock use cases check idempotency before attempting a new change. Same key and same normalized command return the committed movement and resulting balance; changed product/action/quantity/reason with that key returns `IDEMPOTENCY_CONFLICT`. On first add, call `ProductCatalog` before the Inventory MongoDB transaction. Missing record on first remove is logical zero and yields `INSUFFICIENT_STOCK`. Every valid new change produces one movement and one domain event intent; rejected changes produce neither.

## Infrastructure and transaction

The official MongoDB Node.js driver connects to `stockflow_inventory`. `MongoStockStore` implements `StockStore` and `OutboxRepository`; its `commit` method runs one transaction that inserts or version-updates the Inventory record and inserts both movement and outbox event. The original unique-product index is replaced by unique `(productId,locationId)` during migration, with global command identities and movement/outbox indexes specified in [docs/persistence.md](../../docs/persistence.md). The application handles transaction conflicts and unique first-insert races by reloading and rerunning domain behavior up to three times. It never publishes to NATS within the transaction.

Implement `HttpProductCatalog` against Product Service `GET /products/:id`, with a 5-second timeout and distinct not-found vs unavailable mapping. Implement `NatsEventPublisher` against JetStream and the outbox relay exactly as [docs/events.md](../../docs/events.md) specifies. Use a stable `eventId` and stored envelope on retries. If NATS is down after commit, return stock-command success and retain the outbox row. Only one Inventory Service instance runs in the local design, so the relay needs no distributed claim mechanism.

## HTTP and health

Expose `GET /inventory` for physically stored balances, `GET /inventory/:productId` for a stored balance or internal `INVENTORY_NOT_FOUND`, `POST /inventory/:productId/add`, `POST /inventory/:productId/remove`, and `GET /inventory/:productId/movements`. The POST response is the committed [StockChangeResult](../../docs/api.md), including the original result on exact idempotency replay. History returns `{ items: StockMovement[] }` newest first; a product with no movement rows returns an empty array.

Controller validation checks UUIDs, quantity precision/range and reason. Stable API errors conceal MongoDB or NATS exceptions. `GET /health/live` checks process liveness; `GET /health/ready` checks MongoDB. NATS connectivity and pending-outbox count are separate diagnostics because commands can commit while NATS is unavailable. Startup validates `PORT`, `MONGO_URI`, `PRODUCT_SERVICE_URL` and `NATS_URL`.

## Verification

- [x] Pure domain tests cover exact milliunit arithmetic, insufficient stock, overflow and invalid quantities.
- [x] Use-case tests prove first-add Product lookup, no write on invalid commands, one movement/event intent on valid commands, and safe idempotency replay.
- [x] HTTP tests cover list/detail, add/remove, movements, error codes and request validation.
- [x] Replica-set tests prove transaction atomicity, first-insert race handling and concurrent-removal safety.
- [x] Outbox relay tests prove PubAck handling, pending retry when NATS fails and stable event ID on duplicate publish.

## Implemented expansion

Legacy `/inventory` routes operate on Main Store, preserve v1 response/replay identity and do not represent restaurant totals. New `/stock` reads are location-aware; the BFF composes restaurant totals. [StockOperations](../../apps/inventory-service/src/application/operations.ts), [InventoryManagement](../../apps/inventory-service/src/application/inventory-management.ts) and [Warehouses](../../apps/inventory-service/src/application/warehouse.ts) use framework-free ports. [MongoOperationsStore](../../apps/inventory-service/src/infrastructure/mongo-operations-store.ts) implements local transactions for multi-line receiving, paired transfers, waste, count application and sale consume/return.

Commands commit all balances, movement/event intents and replay results together. New recorded business rejections contain no stock effects. Counts snapshot balance versions and row absence; null is uncounted and zero is explicit. Apply rejects stale snapshots, updates count state atomically, and emits no movements/events for unchanged entries. Suppliers validate receiving references; rules store per-location threshold/target and server-derived suggestions. Filtered histories/report queries preserve period/cursor constraints and do not sum unlike units.

Sale consumption records per-sale-line original allocations and validates aggregate ingredients. Return accepts original operation ID and sold-line counts; it derives ingredients/location from that consumption and serializes cumulative return limits independently of Sales. It cannot add caller-supplied ingredient totals. Stock v2 extends events without rewriting pending v1 envelopes. Existing data requires the writer-stopped operator migration in [operations](../../docs/operations.md).

[Inventory expansion verification](../../scripts/verify-inventory-expansion.ts) exercises actual replica-set transaction rollback/concurrency and management/return semantics in an isolated database. Real HTTP, broker, restart and browser gates remain separate.
