# Inventory Service implementation

## Responsibility and boundary

Build `apps/inventory-service` as the sole owner of balances, movements and pending stock events. It runs as a NestJS HTTP process on local port 3002, with an outbox relay provider in the same process. It may call Product Service over HTTP to confirm a product on its first addition; it never reads Product MongoDB or stores product name/unit. Read [docs/domain.md](../../docs/domain.md), [docs/persistence.md](../../docs/persistence.md), and the [stock consistency path](../architecture/stock-consistency.md) first.

## Domain and application

Implement plain TypeScript `Quantity`, `InventoryItem`, `StockMovement`, `StockAdded`, `StockRemoved`, and domain errors. `InventoryItem.addStock` and `.removeStock` enforce positive milliunit amounts, maximum balance and nonnegative stock. Application use cases are `AddStock`, `RemoveStock`, `GetInventory`, `ListInventory`, `GetStockMovements`, and `PublishPendingEvents`. Define service-specific `StockUnitOfWork`, `InventoryRepository`, `StockMovementRepository`, `OutboxRepository`, `ProductCatalog`, and `EventPublisher` ports. The domain imports none of these adapters or NestJS APIs.

The stock use cases check idempotency before attempting a new change. Same key and same normalized command return the committed movement and resulting balance; changed product/action/quantity/reason with that key returns `IDEMPOTENCY_CONFLICT`. On first add, call `ProductCatalog` before the Inventory MongoDB transaction. Missing record on first remove is logical zero and yields `INSUFFICIENT_STOCK`. Every valid new change produces one movement and one domain event intent; rejected changes produce neither.

## Infrastructure and transaction

Use the official MongoDB Node.js driver against `stockflow_inventory`. `MongoStockUnitOfWork` runs one transaction that inserts or version-updates the Inventory record and inserts both movement and outbox event. Create the unique `productId` and `idempotencyKey` indexes plus movement-history and outbox-due indexes in [docs/persistence.md](../../docs/persistence.md). Handle transaction conflicts and unique first-insert races by reloading and rerunning the domain behavior up to three times. Never publish to NATS within the transaction.

Implement `HttpProductCatalog` against Product Service `GET /products/:id`, with a 5-second timeout and distinct not-found vs unavailable mapping. Implement `NatsEventPublisher` against JetStream and the outbox relay exactly as [docs/events.md](../../docs/events.md) specifies. Use a stable `eventId` and stored envelope on retries. If NATS is down after commit, return stock-command success and retain the outbox row. Only one Inventory Service instance runs in the local design, so the relay needs no distributed claim mechanism.

## HTTP and health

Expose `GET /inventory` for physically stored balances, `GET /inventory/:productId` for a stored balance or internal `INVENTORY_NOT_FOUND`, `POST /inventory/:productId/add`, `POST /inventory/:productId/remove`, and `GET /inventory/:productId/movements`. The POST response is the committed [StockChangeResult](../../docs/api.md), including the original result on exact idempotency replay. History returns `{ items: StockMovement[] }` newest first; a product with no movement rows returns an empty array.

DTO validation checks UUIDs, quantity precision/range and reason. Use the stable API errors, without exposing MongoDB or NATS exceptions. `GET /health/live` checks process liveness; `GET /health/ready` checks MongoDB. NATS connectivity and pending-outbox count are separate diagnostics because commands can commit while NATS is unavailable. Validate `PORT`, `MONGO_URI`, `PRODUCT_SERVICE_URL` and `NATS_URL` on startup.

## Verification

- [x] Pure domain tests cover exact milliunit arithmetic, insufficient stock, overflow and invalid quantities.
- [x] Use-case tests prove first-add Product lookup, no write on invalid commands, one movement/event intent on valid commands, and safe idempotency replay.
- [x] HTTP tests cover list/detail, add/remove, movements, error codes and request validation.
- [x] Replica-set tests prove transaction atomicity, first-insert race handling and concurrent-removal safety.
- [x] Outbox relay tests prove PubAck handling, pending retry when NATS fails and stable event ID on duplicate publish.
