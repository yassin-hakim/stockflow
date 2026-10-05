# MongoDB persistence design

## Ownership and local topology

One MongoDB server hosts three databases: `stockflow_product` (Product Service), `stockflow_inventory` (Inventory Service), and `stockflow_audit` (audit worker). Database-per-owner is a logical boundary, not an invitation for cross-service queries. BFF and Angular have no MongoDB credentials. The local Docker Compose deployment uses a **single-node replica set** named `rs0`; MongoDB multi-document transactions require a replica set or sharded cluster, even when running locally. See the [MongoDB transaction guide](https://www.mongodb.com/docs/manual/data-modeling/enforce-consistency/transactions/) and [Node.js transaction API](https://www.mongodb.com/docs/drivers/node/current/crud/transactions/transaction-conv/).

Use the official MongoDB Node.js driver 7.7.0 inside repository adapters. The driver client and transaction session stay in infrastructure; domain entities are plain TypeScript objects. The workspace lockfile and Compose file pin the driver and MongoDB server (`mongo:8.0.20`), and transaction behavior was verified against the local replica set.

## Collections and indexes

| Owner | Collection | Stored fields | Indexes |
| --- | --- | --- | --- |
| Product | `products` | `_id` UUID, `name`, `unit`, `category`, `lowStockThresholdMillis`, timestamps | Primary `_id` |
| Inventory | `inventory` | `_id` UUID, `productId`, `quantityMillis`, `version`, timestamps | Unique `{ productId: 1 }` |
| Inventory | `stock_movements` | `_id` UUID, `productId`, `type`, `quantityMillis`, `reason`, `resultingQuantityMillis`, `idempotencyKey`, normalized `command`, original public `result`, `createdAt` | Unique `{ idempotencyKey: 1 }`; `{ productId: 1, createdAt: -1, _id: -1 }` |
| Inventory | `outbox` | `_id` event UUID, `subject`, `payload`, `status`, `attempts`, `nextAttemptAt`, `createdAt`, `publishedAt` | `{ status: 1, nextAttemptAt: 1 }` |
| Audit | `stock_events` | `_id` event UUID, event envelope, `receivedAt` | Primary `_id` provides event-ID deduplication |

These collection shapes are infrastructure records, not domain entities. Timestamps are UTC. The API never exposes `quantityMillis`, MongoDB `_id`, `version`, or outbox state; adapters map them to domain and API types. The Product unit is immutable in v1, so existing movements retain their meaning.

## Quantity representation

One product unit equals 1,000 stored milliunits. Thus `1.25 kg` is stored as `1250`, and a maximum balance of `1,000,000,000.000` units is `1,000,000,000,000` milliunits, safely below JavaScript's maximum safe integer. Product low-stock thresholds use the same scale. Validate the parsed JSON number's value as a multiple of `0.001`, convert it to a safe integer, then do all balance arithmetic on integers. Domain tests must cover `0.001`, three-place fractions, zero, negatives, a value such as `1.0001` that needs four nonzero decimal places, equivalent trailing-zero spellings and the maximum.

## Atomic stock transaction

1. Normalize and validate the request; check for an existing `idempotencyKey`. If found, compare its stored command details and return the original result or `IDEMPOTENCY_CONFLICT`.
2. For a first addition, confirm Product Service has the product before opening the MongoDB transaction. The initial logical balance is zero. For removal with no Inventory record, return `INSUFFICIENT_STOCK` without writing.
3. Load InventoryItem, run the domain method, and create one StockMovement and one outbox event envelope with stable UUIDs.
4. In one Inventory database transaction, conditionally insert or update the balance using its `version`, insert the movement, and insert the pending outbox row. A write conflict or first-insert unique-key race aborts the whole transaction; reload and rerun the domain rule, at most three attempts.
5. Return success only after commit. A known duplicate idempotency key found after a race resolves to the original result. If the commit outcome is uncertain, a client retry with the same key resolves safely.

The conditional version check is a persistence guard against two simultaneous removals reading the same balance. The domain rule remains authoritative; a retry re-evaluates it against the latest value. No partial balance, movement or event-intent state is allowed. Do not publish to NATS inside the MongoDB transaction. The [outbox relay](events.md) runs after commit.

## Read behavior

`GET /inventory` returns only physically stored balances. The BFF joins those with all Products and displays missing records as zero. `GET /inventory/:productId` returns `INVENTORY_NOT_FOUND` if no row exists; the BFF converts that one condition to a zero projection after confirming Product exists. Movement history uses the compound index and sorts by `(createdAt desc, _id desc)`. The audit worker inserts with `_id = eventId`; on duplicate-key error it verifies the previously stored event is identical. JetStream delivery is acknowledged only after that persistence operation succeeds.

## Failure and recovery

- Transaction abort, validation failure or overdraw: no balance, movement or outbox row changes.
- Product Service unavailable during first addition: no Inventory transaction starts; return `UPSTREAM_UNAVAILABLE`.
- MongoDB unavailable: return `SERVICE_UNAVAILABLE` before success is reported.
- NATS unavailable after commit: outbox stays pending; reads and future commands can proceed, and relay resumes publication later.
- Audit MongoDB unavailable: JetStream message stays unacknowledged for redelivery. A unique event ID makes repeat delivery safe.

The single-node replica set enables transactions but is **not** a high-availability production design. The system is a local architectural demonstration; production clustering, backups and credentials are outside scope. [Operations](operations.md) defines the intended local configuration.
