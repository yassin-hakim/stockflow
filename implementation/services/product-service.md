# Product Service implementation

The checked verification list below records the original baseline. Expanded Product/Menu behavior is described in the current [API](../../docs/api.md), [domain](../../docs/domain.md) and [expansion acceptance](../expansion/phases-and-acceptance.md); baseline evidence does not establish those new gates.

## Responsibility and boundary

Build `apps/product-service` as an independent NestJS HTTP process on local port 3001. It owns the Product bounded context and `stockflow_product.products`; it does not create Inventory rows, adjust stock or publish stock events. Its internal HTTP contract is specified in [docs/api.md](../../docs/api.md), and its domain model in [docs/domain.md](../../docs/domain.md).

## Implementation slices

1. Define a plain TypeScript `Product` entity with UUID ID, trimmed name/unit/category, threshold in milliunits, and UTC creation/update times. Factory validation applies the lengths and default threshold from the API contract. There is no update/delete behavior in v1.
2. Define `CreateProduct`, `ListProducts`, and `GetProduct` use cases and a Product-owned `ProductRepository` port with `insert`, `findAll`, and `findById`. `GetProduct` maps absence to `PRODUCT_NOT_FOUND`; list returns an empty array when no products exist.
3. Implement `MongoProductRepository` with the official MongoDB Node.js driver, mapping `_id` and `lowStockThresholdMillis` to the domain model. Use only `stockflow_product`. Keep driver documents in infrastructure and define the primary ID index. Do not share a repository with Inventory Service.
4. Add a NestJS Product module that wires the repository token to the adapter and registers controller/use-case providers. The controller exposes `POST /products`, `GET /products`, and `GET /products/:id`; request DTOs reject unknown fields, blank strings, excessive lengths, invalid threshold and malformed UUIDs. Convert threshold from API units to integer milliunits before the use case.
5. Add `GET /health/live` and `GET /health/ready`; readiness checks the Product MongoDB connection. Validate `PORT` and `MONGO_URI` on startup. Keep the service reachable from the BFF and Inventory Service, not from Angular.

## Publicly observable behavior

`POST /products` returns `201 Product` with explicit `lowStockThreshold`, ID and timestamps. Repeated product names are allowed; identity is UUID, not name. `GET /products` returns `{ items: Product[] }`; `GET /products/:id` returns Product or `404 PRODUCT_NOT_FOUND`. The service does not query or manufacture a stock balance. A newly created Product appears at zero only after BFF composition with Inventory results.

When Inventory Service calls `GET /products/:id` before a first stock addition, a 404 stops that command. Connection failure is an upstream failure, not evidence that the product is absent. Keep error responses in the shared [error envelope](../../docs/api.md).

## Verification

These checks refer to the original three-route baseline.

- [x] Pure domain/use-case tests cover trimmed names, threshold default/precision/range, required fields and unknown IDs.
- [x] HTTP tests cover all three routes, status codes, DTO rejection and error envelope.
- [x] MongoDB integration test persists and reloads every Product field, including milliunit threshold.
- [x] A Product creation test proves no Inventory database write or event publication occurs.
- [x] `GET /health/ready` distinguishes a running process from an unavailable Product database.

## Implemented expansion

Product now owns conditional editable-field updates, immutable base units, normalized unique optional SKU and archive state. Menu items own checked minor-unit prices and immutable ingredient recipe revisions; publishing/archive uses expected versions. Archived records remain readable for historical receipts and movements. MongoDB indexes and schema setup are owner-local. New recipes require active ingredients; new receiving cannot add archived Product stock. Sales consumes versioned menu snapshots over HTTP, never Product persistence.

See [Product application](../../apps/product-service/src/application/product-use-cases.ts) and [menu application](../../apps/product-service/src/application/menu-use-cases.ts) for current use cases. The v1 no-update sentence above describes the historical baseline only; the approved expansion adds edit/archive without product deletion or unit changes.
