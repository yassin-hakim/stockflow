# BFF implementation

The original eight-route baseline remains documented below; its checked verification does not establish expanded runtime/browser acceptance. Current route contracts and new gates are in [API](../../docs/api.md) and [expansion acceptance](../expansion/phases-and-acceptance.md).

## Responsibility

Build `apps/bff` as a NestJS HTTP application on local port 3000. It is the **only** API used by Angular. It validates public request shape, calls Product, Inventory and Sales services, composes frontend views and translates stable errors. It contains no stock domain entity, MongoDB repository, NATS connection or stock mutation rule. See [docs/backend.md](../../docs/backend.md) and [docs/api.md](../../docs/api.md).

## Modules and clients

Typed internal HTTP clients call Product, Inventory and Sales owner routes. Common infrastructure provides configuration, request-ID middleware, validation, error mapping and health endpoints. The local timeout is 5 seconds. The BFF does not automatically retry requests. Forward `Idempotency-Key` unchanged and propagate `X-Request-ID` to internal services.

## Routes and composition

Expose all eight `/api` routes in the [API contract](../../docs/api.md). `POST /api/products` passes the validated creation DTO to Product Service and returns `201 Product`. Product list and detail calls forward their owner results. The stock POST routes forward to Inventory Service and return its committed result without waiting for audit delivery.

For `GET /api/inventory`, call Product and Inventory list endpoints, join by `productId`, and emit one `InventoryOverview` for **every** product, sorted by case-insensitive name then ID. Inventory records without a matching Product are omitted from this frontend projection; automatic integrity-anomaly logging is not implemented. A product without a stored balance gets `quantity: 0`. Derive status: `OUT` when zero, `LOW` when positive and at or below a positive `lowStockThreshold`, otherwise `OK`. Compute only this display projection; do not apply add/remove rules.

For `GET /api/inventory/:productId`, fetch Product first. Its 404 becomes `PRODUCT_NOT_FOUND`; an internal `INVENTORY_NOT_FOUND` for that known product becomes zero. For movement history, verify Product existence first and return an empty list when that valid product has no movements. A timeout or 5xx from Inventory is never treated as a zero balance or empty history.

## Error handling and health

Use one public error filter producing `{ error: { code, message, requestId } }`. Preserve known domain/application codes and statuses from internal services. Translate upstream connection errors to `502 UPSTREAM_UNAVAILABLE`, local unexpected failures to `500 INTERNAL_ERROR`, and do not leak infrastructure details. Validate UUID paths, creation fields, quantity and reason; reject extra fields. The `requestId` is a UUID assigned at BFF entry, forwarded upstream and returned in headers/errors; automatic per-request logging is not implemented.

`GET /health/live` checks the process and `GET /health/ready` checks Product, Inventory and Sales readiness. Angular has one `/api` proxy target to this process. Owner ports remain private to the host development setup.

## Verification

- [x] Contract tests cover every `/api` route and exact success/error DTOs.
- [x] Dashboard tests cover zero-stock left join, LOW threshold boundary, stable sorting and no false zero on Inventory failure.
- [x] Detail/history tests distinguish unknown Product, missing Inventory row and upstream outage.
- [x] Stock tests prove key and request-ID forwarding and no BFF retry or business-rule implementation.
- [x] Browser network checks show Angular calls only the BFF.

## Implemented expansion

Expanded controllers forward catalog/menu edits, warehouse documents, suppliers, counts, rules and Sales workflow commands. Location/total stock and replenishment views join owner results, adding successful-read zero projections and explicit null missing targets. Histories validate known query fields and preserve owner cursors/periods. Reports compose owner groups and export matching filtered pages with a 10,000-record bound and spreadsheet-formula protection.

Sales pending responses preserve HTTP 202 and public status URLs. BFF never decides recipe consumption, monetary totals, count differences or refund limits. Required source failures stay errors; they do not become empty pages or zero totals. See [frontend behavior](../../docs/frontend.md) for review, retry and refresh workflows.
