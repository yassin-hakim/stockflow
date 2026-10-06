# NestJS backend, microservices and BFF

## Application boundaries

The four HTTP apps are independent NestJS processes: BFF, Product, Inventory and Sales. The audit worker is a separate NestJS application context without public business endpoints. Sharing TypeScript build tooling or pure contract types is acceptable; sharing repositories, database models, controllers or domain entities across contexts is not.

```text
apps/bff/src/
├── bff.module.ts    provider wiring and controller registration
├── products-controller.ts / inventory-controller.ts  frontend HTTP routes
├── health-controller.ts   liveness and upstream readiness
├── validation.ts / configuration.ts  boundary validation and settings
├── upstream.ts      typed internal HTTP client
├── projection.ts    product/balance dashboard join and status
├── http-filter.ts   public error mapping
└── main.ts          bootstrap, request IDs and localhost binding

apps/product-service/src/
├── domain/
├── application/
├── infrastructure/  MongoProductRepository
└── presentation/    internal ProductController and transport validation

apps/inventory-service/src/
├── domain/
├── application/
├── infrastructure/  Mongo repositories, Product HTTP client, JetStream publisher, outbox relay
└── presentation/    internal InventoryController and transport validation

apps/audit-worker/src/
├── application/     HandleStockEvent use case and AuditRepository port
├── audit.ts         event validation, JetStream consumer and MongoAuditRepository
├── audit.module.ts  provider wiring
└── main.ts          application-context bootstrap
```

The three business services follow DDD and hexagonal boundaries in [domain.md](domain.md). NestJS `@Module` composition registers controllers, use cases and adapter providers. Use injection tokens for interfaces because TypeScript interfaces have no runtime identity. MongoDB adapters use the official Node.js driver; controllers validate transport data and invoke one use case, never touching driver collections or publishing directly.

## BFF contract and responsibilities

Angular calls only the BFF under `/api`. The BFF forwards product creation and stock commands to their owners, preserving `Idempotency-Key` on stock requests. It maps internal errors to the stable public [API contract](api.md). It does not decide whether an amount is allowed or whether stock is sufficient.

For `GET /api/inventory`, the BFF fetches Product and Inventory lists, joins by `productId`, includes every product, and projects missing balances as zero. For `GET /api/inventory/:productId`, it fetches Product first and returns `PRODUCT_NOT_FOUND` if absent; an Inventory Service `INVENTORY_NOT_FOUND` means zero, while timeouts or other errors propagate as upstream failures. The BFF computes the display status from product `lowStockThreshold` and quantity: `OUT` at zero, `LOW` when positive and at or below a positive threshold, otherwise `OK`. This is frontend read-model composition, not a stock mutation rule.

The BFF uses `HttpUpstream.request<T>` with one overall 5-second timeout and structured error translation. It performs no automatic retries for GET or POST requests. Angular provides an explicit retry action; stock retries preserve the original idempotency key when the outcome is uncertain. The BFF propagates Inventory failures rather than substituting an empty inventory list. Its health endpoint distinguishes process liveness from dependency readiness.

## Product Service and menu

Product retains create/list/detail and adds conditional PATCH/archive. `/menu-items` adds create/list/detail/publish/archive and immutable revision reads. `CreateProduct` creates a UUID, timestamps and default threshold, then calls its own `ProductRepository`. Get/list map persisted records to API DTOs. Product Service exposes no stock endpoint and never accesses Inventory data. The unit is a short display string such as `kg`, `L` or `pcs`; existing product unit is immutable in the initial scope so stock history keeps the same interpretation.

## Inventory Service and legacy adapters

Legacy Main Store internal routes: `GET /inventory`, `GET /inventory/:productId`, `POST /inventory/:productId/add`, `POST /inventory/:productId/remove`, `GET /inventory/:productId/movements`. On first addition, `ProductCatalog` calls Product Service `GET /products/:id`; a 404 becomes `PRODUCT_NOT_FOUND`, while network errors become `UPSTREAM_UNAVAILABLE`. A missing inventory record on a removal is treated as zero and rejected as insufficient stock. The service does not query Product MongoDB.

`StockUseCases.change` receives an `ADD` or `REMOVE` command, calls the corresponding `InventoryItem` domain method, then asks `StockUnitOfWork` to atomically save the balance, one movement and one outbox event. It reloads and reruns the domain rule after write conflicts, with a bounded three-attempt limit. It never retries a known validation failure. `StockUseCases.list`, `.get` and `.movements` handle reads. The outbox relay invokes `PublishPendingEvents.execute`, publishes through the `EventPublisher` port, waits for `PubAck`, and marks rows published. A failed publish leaves the row pending for retry. See [persistence](persistence.md) and [events](events.md).

## Audit worker

The worker binds `stock-audit` and `sales-audit` durable JetStream consumers created by `setup:nats` and receives one event at a time. `parseEvent` validates the envelope before invoking `HandleStockEvent.execute`. `MongoAuditRepository.save` inserts into `stockflow_audit.stock_events` with `_id = eventId`; on a duplicate-key error it reads and compares the existing event. An identical duplicate succeeds without creating another record; conflicting payloads fail. The consumer acknowledges after successful persistence. If MongoDB is unavailable or payload processing fails, the message remains unacknowledged and JetStream redelivers. The worker has no public business API.

## Error and boundary behavior

- Controller validation rejects missing/extra fields, invalid UUID paths or idempotency keys, malformed decimals and blank reasons before use cases run. Quantity range or precision errors map to `422 INVALID_QUANTITY`; other malformed request fields map to `400 INVALID_REQUEST`. Validation is handwritten in the HTTP boundary rather than decorator-based DTO classes.
- HTTP exception filters map domain/application errors to stable status codes and error codes, carrying the request ID in the response header and error envelope. Infrastructure exceptions become safe public errors; automatic request logging is not implemented.
- A committed stock action returns success even if NATS is down; the pending outbox record is the recovery path. If commit outcome is unknown to the caller, the same idempotency key makes a retry safe.
- There is no authentication or authorization in this local architectural demo. Do not claim the endpoints are suitable for an untrusted network.

Official references: [NestJS modules](https://docs.nestjs.com/modules), [providers](https://docs.nestjs.com/providers), [controllers](https://docs.nestjs.com/controllers), and the [NATS JavaScript client](https://github.com/nats-io/nats.js/).

## Expanded Inventory and Sales composition

Inventory adds `OperationsController`/`ManagementController`, `StockOperations`, `Warehouses` and `InventoryManagement` with service-owned ports. `MongoOperationsStore` persists multi-location/multi-line balance changes, documents, command results and movement/outbox rows in one transaction. Counts are version/absence protected; return commands derive original allocation and serialize cumulative bounds. Legacy `MongoStockStore` remains the Main Store adapter. Schema version 2 is required before startup; [migration](persistence.md#inventory-schema-migration) is an operator command, not an automatic startup mutation.

Sales has the same four inward layers in `apps/sales-service`. Its controller validates draft/checkout/refund/report boundaries; `SalesUseCases` owns pricing/frozen intent/lifecycle and uses Catalog/Inventory/SalesStore ports. `MongoSalesStore` owns Sales-only local transactions. HTTP adapters obtain Product snapshots and Inventory consume/return/status; background work scans persisted pending workflows and publishes Sales outbox. An intermediate pending state is required because checkout spans owners without a distributed transaction.

BFF adds catalog/operation/warehouse/Sales/report controllers, forwards immutable identities/request IDs and emits 202 pending response/status URLs. It joins Product labels with owner quantities/rules/reports and streams matching CSV text. It never writes MongoDB or calculates checkout/refund/stock mutation rules. Detailed new routes and limits are in [API](api.md), with process/config/recovery in [operations](operations.md).
