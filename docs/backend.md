# NestJS backend, microservices and BFF

## Application boundaries

The three HTTP apps are independent NestJS processes: BFF, Product Service and Inventory Service. The audit worker is a separate NestJS application context without public business endpoints. Sharing TypeScript build tooling or pure contract types is acceptable; sharing repositories, database models, controllers or domain entities across contexts is not.

```text
apps/bff/src/
├── products/        frontend routes, Product HTTP client
├── inventory/       frontend routes, Inventory HTTP client, dashboard projection
└── common/          error filter, validation, configuration, health

apps/product-service/src/
├── domain/
├── application/
├── infrastructure/  MongoProductRepository
└── presentation/    internal ProductController and DTOs

apps/inventory-service/src/
├── domain/
├── application/
├── infrastructure/  Mongo repositories, Product HTTP client, JetStream publisher, outbox relay
└── presentation/    internal InventoryController and DTOs

apps/audit-worker/src/
├── application/     HandleStockEvent use case and AuditRepository port
└── infrastructure/  JetStream durable consumer and MongoAuditRepository
```

The two business services follow DDD and hexagonal boundaries in [domain.md](domain.md). NestJS `@Module` composition registers controllers, use cases and adapter providers. Use injection tokens for interfaces because TypeScript interfaces have no runtime identity. MongoDB adapters use the official Node.js driver; controllers validate transport data and invoke one use case, never touching driver collections or publishing directly.

## BFF contract and responsibilities

Angular calls only the BFF under `/api`. The BFF forwards product creation and stock commands to their owners, preserving `Idempotency-Key` on stock requests. It maps internal errors to the stable public [API contract](api.md). It does not decide whether an amount is allowed or whether stock is sufficient.

For `GET /api/inventory`, the BFF fetches Product and Inventory lists, joins by `productId`, includes every product, and projects missing balances as zero. For `GET /api/inventory/:productId`, it fetches Product first and returns `PRODUCT_NOT_FOUND` if absent; an Inventory Service `INVENTORY_NOT_FOUND` means zero, while timeouts or other errors propagate as upstream failures. The BFF computes the display status from product `lowStockThreshold` and quantity: `OUT` at zero, `LOW` when positive and at or below a positive threshold, otherwise `OK`. This is frontend read-model composition, not a stock mutation rule.

The BFF uses typed HTTP clients with explicit connection and response timeouts (5 seconds locally), no automatic retry for stock POST requests, and structured error translation. Read-only GET requests may be retried once for a transient connection failure. The BFF must not silently substitute an empty inventory list when Inventory Service is unavailable: that would report false zero balances. Its health endpoint distinguishes process liveness from dependency readiness.

## Product Service

Internal HTTP routes: `POST /products`, `GET /products`, `GET /products/:id`. `CreateProduct` creates a UUID, timestamps and default threshold, then calls its own `ProductRepository`. Get/list map persisted records to API DTOs. Product Service exposes no stock endpoint and never accesses Inventory data. The unit is a short display string such as `kg`, `L` or `pcs`; existing product unit is immutable in the initial scope so stock history keeps the same interpretation.

## Inventory Service

Internal HTTP routes: `GET /inventory`, `GET /inventory/:productId`, `POST /inventory/:productId/add`, `POST /inventory/:productId/remove`, `GET /inventory/:productId/movements`. On first addition, `ProductCatalog` calls Product Service `GET /products/:id`; a 404 becomes `PRODUCT_NOT_FOUND`, while network errors become `UPSTREAM_UNAVAILABLE`. A missing inventory record on a removal is treated as zero and rejected as insufficient stock. The service does not query Product MongoDB.

`AddStock` and `RemoveStock` use domain methods, then ask `StockUnitOfWork` to atomically save the balance, one movement and one outbox event. Retry write conflicts by reloading and rerunning the domain rule, with a bounded three-attempt limit. Never retry a known validation failure. The outbox relay runs as an Inventory Service infrastructure provider; it polls pending rows, publishes to JetStream, waits for `PubAck`, and marks them published. A failed publish leaves the row pending for retry. See [persistence](persistence.md) and [events](events.md).

## Audit worker

The worker binds the `stock-audit` durable JetStream consumer created by `setup:nats`, receives one event at a time, validates the schema version, upserts a record by `eventId` into `stockflow_audit`, then acknowledges. A duplicate event succeeds without creating another record. If MongoDB is unavailable or payload processing fails, do not acknowledge; JetStream redelivers. An unsupported version is logged as an actionable failure and remains unacknowledged until the worker is updated or an operator resolves it. The worker has no public business API.

## Error and boundary behavior

- NestJS request DTOs reject missing/extra fields, invalid UUID paths or idempotency keys, malformed decimals and blank reasons before use cases run. Quantity range or precision errors map to `422 INVALID_QUANTITY`; other malformed request fields map to `400 INVALID_REQUEST`.
- Domain/application errors are mapped centrally to stable status codes and error codes. Infrastructure messages are logged internally with a request ID and returned as `UPSTREAM_UNAVAILABLE` or `INTERNAL_ERROR` without implementation details.
- A committed stock action returns success even if NATS is down; the pending outbox record is the recovery path. If commit outcome is unknown to the caller, the same idempotency key makes a retry safe.
- There is no authentication or authorization in this local architectural demo. Do not claim the endpoints are suitable for an untrusted network.

Official references: [NestJS modules](https://docs.nestjs.com/modules), [providers](https://docs.nestjs.com/providers), [controllers](https://docs.nestjs.com/controllers), and the [NATS JavaScript client](https://github.com/nats-io/nats.js/).
