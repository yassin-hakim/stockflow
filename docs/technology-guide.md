# How the required technologies fit StockFlow

This is a project-specific guide, not a general tutorial. The [architecture](architecture.md) defines the boundaries; the linked documents define the implementation contracts. Application manifests, Compose image versions and the NATS setup script are in use. Runtime acceptance evidence is recorded in the [implementation verification report](../implementation/verification.md).

## NATS

NATS JetStream carries committed `StockAdded` and `StockRemoved` integration events from Inventory Service to the audit worker. The Inventory application depends on an `EventPublisher` port; the official NATS JavaScript transport and JetStream packages implement it. `STOCK_EVENTS` uses file storage and WorkQueue retention, with a durable explicit-acknowledgment `stock-audit` consumer. MongoDB outbox records protect the publish gap; event-ID deduplication protects retries. NATS does not handle HTTP stock commands or own stock balances. See [events](events.md), [NATS concepts](https://docs.nats.io/concepts/what-is-nats), and the [official JavaScript client](https://github.com/nats-io/nats.js/).

## Microservices

Product Service owns product data and Inventory Service owns stock data. They run independently and communicate through internal HTTP for the one required product-existence lookup. The BFF is a separate API process; the audit worker is a separate asynchronous component, not a third business bounded context. Database-per-owner prevents a convenient but harmful shared-collection shortcut. Keep the process count small and align it to responsibilities; no service discovery platform or distributed transaction manager is needed. See [architecture](architecture.md) and [backend](backend.md).

## NestJS

NestJS hosts the BFF, Product Service and Inventory Service HTTP applications and the audit worker's application context. Controllers validate transport data and map shared contract types; module providers connect use cases to repository, HTTP-client and NATS adapters. NestJS decorators and exceptions remain outside the domain. The stock rules are plain TypeScript and can be tested without a Nest application. See [backend](backend.md), [NestJS modules](https://docs.nestjs.com/modules), and [providers](https://docs.nestjs.com/providers).

## Angular

Angular renders the dashboard, product form, product detail, stock forms and movement history. Standalone components, Router, reactive forms and typed `HttpClient` calls keep the client small. It targets only `/api` on the BFF and displays status returned by that API. Validation and loading states help the employee, while the service domain remains authoritative for stock rules. See [frontend](frontend.md) and [Angular HTTP](https://angular.dev/guide/http).

## MongoDB

MongoDB persists Product-owned products, Inventory-owned balances/movements/outbox, and audit-owned received events in separate databases on one local server. The official Node.js driver is used only by infrastructure adapters. Inventory transactions atomically commit a balance, movement and pending event; a local replica set is therefore required. Indexes protect unique product balance, idempotency and audit event IDs. MongoDB is not accessed by Angular or BFF. See [persistence](persistence.md) and [MongoDB transactions](https://www.mongodb.com/docs/manual/data-modeling/enforce-consistency/transactions/).

## Domain-driven design

The Product and Inventory bounded contexts have explicit ownership. `InventoryItem` contains the nonnegative-stock invariant and quantity-changing behavior; `StockMovement` and domain events represent successful changes. Use cases orchestrate, but controllers and persistence models do not decide business rules. The BFF's stock status is a presentation projection across contexts, not part of the Inventory aggregate. See [domain design](domain.md).

## Hexagonal architecture

The domain and application point inward and express needed capabilities as service-specific ports: product repository, stock unit of work, product catalog, event publisher, and audit repository. MongoDB, internal HTTP and JetStream are adapters connected by NestJS module composition. This direction permits pure domain and use-case tests and makes technology ownership visible. Avoid a generic shared repository layer or a domain class importing an infrastructure client. See [domain design](domain.md) and [backend](backend.md).

## Backend for Frontend

The NestJS BFF is the only server contacted by Angular. It presents `/api`, validates request shape, forwards commands, maps stable errors and combines Product details with Inventory balances for dashboard and detail views. It treats a known Product with no Inventory row as zero; it never treats an unavailable Inventory Service as zero. The BFF does not enforce add/remove invariants or write MongoDB. See [backend](backend.md) and the [API contract](api.md).

## Source and verification map

Each row points to the production code where the technology or pattern participates in StockFlow, plus the check that exercises it. The runtime and test results below are recorded in the [verification report](../implementation/verification.md).

| Technology or pattern | Implemented in StockFlow | Verification evidence |
| --- | --- | --- |
| NATS JetStream | Inventory's [outbox relay](../apps/inventory-service/src/infrastructure/outbox-relay.ts) and [JetStream publisher](../apps/inventory-service/src/infrastructure/nats-event-publisher.ts); the [audit consumer](../apps/audit-worker/src/audit.ts) acknowledges only after storage. | `setup:nats`, `verify:dedup`, and the broker stop/recovery `verify:nats-outage` drill. |
| Microservices | [Product Service](../apps/product-service/src/main.ts) and [Inventory Service](../apps/inventory-service/src/main.ts) run as separate NestJS processes; [their Mongo adapters](../apps/product-service/src/infrastructure/mongo-product-repository.ts) and [inventory transaction adapter](../apps/inventory-service/src/infrastructure/mongo-stock-store.ts) use owner-specific databases. | `verify:api`, independent health checks, service-restart checks, and the end-to-end demo. |
| NestJS | Each backend process starts through [NestFactory](../apps/bff/src/main.ts); [modules](../apps/inventory-service/src/inventory.module.ts) wire controllers, use cases and adapters through providers. | `npm run build`, backend tests, and live readiness checks. |
| Angular | [Routes](../apps/frontend/src/app/app.routes.ts), [dashboard](../apps/frontend/src/app/inventory/dashboard.ts), [product creation](../apps/frontend/src/app/products/product-create.ts), [detail and stock forms](../apps/frontend/src/app/products/product-detail.ts), and the typed [BFF client](../apps/frontend/src/app/core/bff-api.ts). | Angular component tests and Playwright flow; browser requests were verified to stay under `/api`. |
| MongoDB | Product [repository](../apps/product-service/src/infrastructure/mongo-product-repository.ts), Inventory [transactional store](../apps/inventory-service/src/infrastructure/mongo-stock-store.ts), and audit persistence in the [worker](../apps/audit-worker/src/audit.ts). | Replica-set setup, forced-rollback atomicity, first-insert and removal concurrency, readiness recovery, and volume-restart checks. |
| DDD | [Product domain](../apps/product-service/src/domain/product.ts) and Inventory's [InventoryItem and stock rules](../apps/inventory-service/src/domain/stock.ts) model the bounded contexts and invariants; [use cases](../apps/inventory-service/src/application/stock-use-cases.ts) coordinate commands. | Pure domain and application unit suites plus the boundary check. |
| Hexagonal architecture | Application [repository ports](../apps/product-service/src/application/product-repository.ts), [stock use-case ports](../apps/inventory-service/src/application/stock-use-cases.ts), and [event publisher port](../apps/inventory-service/src/application/publish-pending-events.ts) are implemented by MongoDB, HTTP and NATS [adapters](../apps/inventory-service/src/infrastructure/nats-event-publisher.ts). | `npm run check:boundaries` confirms inward dependency rules; unit tests use fake ports. |
| BFF | [BffModule](../apps/bff/src/bff.module.ts), [internal HTTP client](../apps/bff/src/upstream.ts), and [inventory projection](../apps/bff/src/projection.ts) expose the UI's `/api` contract. | `verify:api` checks joined views and error mapping; Playwright confirms the Angular client calls only `/api`. |
