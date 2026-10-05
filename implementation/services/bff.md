# BFF implementation

## Responsibility

Build `apps/bff` as a NestJS HTTP application on local port 3000. It is the **only** API used by Angular. It validates public request shape, calls Product and Inventory services, composes a frontend inventory view and translates stable errors. It contains no stock domain entity, MongoDB repository, NATS connection or stock mutation rule. See [docs/backend.md](../../docs/backend.md) and [docs/api.md](../../docs/api.md).

## Modules and clients

Create Products and Inventory feature modules with typed internal HTTP clients. Product client supports create/list/get; Inventory client supports list/get/add/remove/movements. A common module provides configuration, request-ID middleware, validation, error mapping, and health endpoints. Set a 5-second local timeout. Retry an idempotent GET once for a transient connection failure; never automatically retry stock POST. Forward stock `Idempotency-Key` unchanged and propagate `X-Request-ID` to internal services.

## Routes and composition

Expose all eight `/api` routes in the [API contract](../../docs/api.md). `POST /api/products` passes the validated creation DTO to Product Service and returns `201 Product`. Product list and detail calls forward their owner results. The stock POST routes forward to Inventory Service and return its committed result without waiting for audit delivery.

For `GET /api/inventory`, call Product and Inventory list endpoints, join by `productId`, and emit one `InventoryOverview` for **every** product, sorted by case-insensitive name then ID. Inventory records without a matching Product are ignored in this frontend list and logged as an integrity anomaly. A product without a stored balance gets `quantity: 0`. Derive status: `OUT` when zero, `LOW` when positive and at or below a positive `lowStockThreshold`, otherwise `OK`. Compute only this display projection; do not apply add/remove rules.

For `GET /api/inventory/:productId`, fetch Product first. Its 404 becomes `PRODUCT_NOT_FOUND`; an internal `INVENTORY_NOT_FOUND` for that known product becomes zero. For movement history, verify Product existence first and return an empty list when that valid product has no movements. A timeout or 5xx from Inventory is never treated as a zero balance or empty history.

## Error handling and health

Use one public error filter producing `{ error: { code, message, requestId } }`. Preserve known domain/application codes and statuses from internal services. Translate upstream connection errors to `502 UPSTREAM_UNAVAILABLE`, local unexpected failures to `500 INTERNAL_ERROR`, and do not leak infrastructure details. Validate UUID paths, creation fields, quantity and reason; reject extra fields. The `requestId` is a UUID assigned at BFF entry and logged with upstream call context.

`GET /health/live` checks the process and `GET /health/ready` checks Product and Inventory readiness. Angular has one `/api` proxy target to this process. Product and Inventory ports remain private to the host development setup.

## Verification

- [x] Contract tests cover every `/api` route and exact success/error DTOs.
- [x] Dashboard tests cover zero-stock left join, LOW threshold boundary, stable sorting and no false zero on Inventory failure.
- [x] Detail/history tests distinguish unknown Product, missing Inventory row and upstream outage.
- [x] Stock tests prove key and request-ID forwarding and no BFF retry or business-rule implementation.
- [x] Browser network checks show Angular calls only the BFF.
