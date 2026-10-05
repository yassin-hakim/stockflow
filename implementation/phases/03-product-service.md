# Phase 3 — Product Service

## Goal and inputs

Deliver the first complete business bounded context with its own NestJS process, domain/use cases, MongoDB adapter and internal HTTP routes. Follow the [Product Service spec](../services/product-service.md), [domain design](../../docs/domain.md), [API contract](../../docs/api.md), and [persistence design](../../docs/persistence.md). This phase provides the product-existence endpoint required by first stock addition.

## Includes

Implement Product as a plain TypeScript model with UUID ID, trimmed name/unit/category, nonnegative low-stock threshold stored in milliunits, and UTC timestamps. Add `CreateProduct`, `ListProducts` and `GetProduct` use cases behind a Product-owned repository port. The MongoDB adapter uses only `stockflow_product.products` and maps persistence documents to domain objects. NestJS module wiring and controller DTO validation stay outside the domain. No Product code writes an Inventory record, movement, outbox or NATS event.

Expose internal `POST /products`, `GET /products`, `GET /products/:id`, `GET /health/live`, and `GET /health/ready`. Creation defaults the threshold to zero and returns `201 Product`; list returns `{ items: Product[] }`; an unknown ID returns `PRODUCT_NOT_FOUND`. Reject malformed UUIDs, blank strings, excess lengths, invalid threshold precision and unknown request fields using the documented envelope. Product unit remains immutable in v1 because movement quantities depend on it.

## Implementation progress

- [x] Implement Product model/factory validation and `CreateProduct`, `ListProducts`, `GetProduct` use cases.
- [x] Define ProductRepository port and wire `MongoProductRepository` through an injection token.
- [x] Create the Product MongoDB collection mapping, primary ID behavior and UTC timestamp serialization.
- [x] Implement three internal HTTP routes with validation and stable errors.
- [x] Implement liveness/readiness and validate Product `PORT` and `MONGO_URI` at startup.
- [x] Add pure use-case, HTTP and real-MongoDB tests.

## Exit gates

- [x] Product Service starts independently and readiness changes appropriately when its MongoDB dependency is unavailable.
- [x] HTTP tests prove create/list/get response shapes, threshold default/precision/range, input rejection and `PRODUCT_NOT_FOUND` according to [docs/api.md](../../docs/api.md).
- [x] A persisted Product reloads with the same ID, name, unit, category, threshold and timestamps after a service restart.
- [x] Tests or inspected database state prove creation makes no Inventory, movement, outbox or audit write and publishes no stock event.
- [x] Domain/application import checks remain green: Product logic has no NestJS or MongoDB dependency.

**Handoff:** Inventory Service can validate a new product by calling Product Service over HTTP; the frontend form is not built until Phase 7.
