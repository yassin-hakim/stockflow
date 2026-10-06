# Sales Service implementation

## Responsibility and boundaries

`apps/sales-service` is the third business owner, running on local port 3003. It owns drafts, frozen checkout attempts, completed sales, receipts, refunds, command identities and Sales outbox records in `stockflow_sales`. Product owns menu prices and recipe revisions; Inventory owns balances and allocations. Sales uses HTTP ports and never reads either owner's database. Angular reaches it through the BFF only. See [architecture](../../docs/architecture.md), [API contracts](../../docs/api.md) and [persistence](../../docs/persistence.md).

## Domain and application

[sale.ts](../../apps/sales-service/src/domain/sale.ts) contains plain TypeScript sale states, priced line snapshots, checked sold counts, integer minor-unit totals and refund bounds. [SalesUseCases](../../apps/sales-service/src/application/sales-use-cases.ts) depends on [ports](../../apps/sales-service/src/application/ports.ts): `CatalogPort`, `InventoryPort`, `SalesStore`, `SalesTransaction` and `EventPublisher`. NestJS, MongoDB and NATS remain in adapters/composition.

Draft creation/editing obtains current Product menu snapshots. Checkout validates the reviewed draft version and catalog configuration before freezing intent; changed prices/recipes require review. Prepared lines retain item names, price, currency, recipe revision and per-item ingredient allocations. The browser submits menu IDs and sold counts, never trusted prices or ingredient totals. One configured two-decimal currency is supported; Product and Sales configuration must agree. Cash/card are recorded tender types, without payment-provider processing.

## Checkout and recovery

Sales first commits the pending attempt, operation UUID and immutable Inventory command locally. It then calls `/stock-operations/consume-sale` outside a MongoDB transaction. Inventory atomically commits all ingredient deductions or records a terminal rejection. Sales finalizes a committed outcome in one local transaction with completed sale, unique receipt and `SaleCompleted` outbox intent. A rejection produces no completed receipt.

There is no cross-service transaction. Timeout, missing outcome or process interruption can leave `CHECKOUT_PENDING`; HTTP 202 supplies the persistent status URL. Recovery polls `/stock-operations/:id`, and if no outcome is recorded resends the same frozen command/key. An absent result is not proof that the previous request cannot commit. Finalization and Inventory replay identities prevent an additional deduction or receipt. The background worker revisits up to 25 pending attempts and 25 refunds every second, without overlapping its own polls.

## Corrections

Refunds select original sale-line quantities. Cumulative completed/pending quantities are bounded by the completed sale; one outstanding correction blocks overlap. No-restock corrections change money/history while leaving ingredients consumed. Restock corrections persist a return command referencing the original consumption; Inventory derives original ingredient quantities and enforces cumulative return limits independently. Recipe edits after completion cannot change those returns. Full refund explanations remain in Sales; the internal Inventory reason is bounded to its contract.

An uncertain return remains `REFUND_PENDING` until recovery resolves its frozen command. A terminal result finalizes refund state, sale correction totals and `SaleRefunded` outbox intent locally. Reports count completed sales/refunds by their respective completion instants, preserving original receipt snapshots.

## Persistence, events and configuration

[MongoSalesStore](../../apps/sales-service/src/infrastructure/mongo-sales-store.ts) owns `sales`, `sales_commands`, `checkout_attempts`, `refunds`, `receipts`, `outbox` and schema metadata. Unique indexes protect command/attempt/operation IDs and receipt sale/reference identity. Transactions retry local write conflicts; schema version 1 is initialized on an empty Sales database and unsupported versions fail startup.

[HTTP adapters](../../apps/sales-service/src/infrastructure/http-ports.ts) preserve request IDs and distinguish unavailable owners from business rejections. [Background work](../../apps/sales-service/src/infrastructure/background-work.ts) publishes up to 25 due events per poll to `SALES_EVENTS`, using stable event IDs and checking PubAck stream identity. Failed publications retain outbox records with exponential retry capped at 60 seconds. Audit uses its separate Sales durable consumer and collection; see [events](../../docs/events.md).

Configuration is `PORT`, `MONGO_URI`, `MONGO_DB`, `PRODUCT_URL`, `INVENTORY_URL`, `NATS_URL` and `CURRENCY`; use [operations](../../docs/operations.md) for exact setup. Readiness pings Sales MongoDB. It does not certify owner connectivity, eventual audit delivery or recovery acceptance.

## Verification scope

Run domain/application tests and the isolated [Sales recovery fixture](../../scripts/verify-sales-recovery.ts). Inspect persisted intent, crash after Inventory commit, repeated recovery, unique receipt/event finalization, original-allocation returns and cumulative refund limits. Controlled ports in this fixture do not replace real Product/Inventory HTTP, broker/worker outages or browser refresh/receipt-print checks.

The [expansion tracker](../expansion/phases-and-acceptance.md) and [recorded evidence](../expansion/verification.md) own acceptance status. This service specification describes implemented behavior and does not mark the final release or deployment complete.
