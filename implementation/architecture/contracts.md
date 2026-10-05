# HTTP, value and error contract implementation

The authoritative routes and JSON types are in [docs/api.md](../../docs/api.md). This file states where to implement them and how to prevent drift between the three HTTP applications and Angular.

## Transport type placement

Put compile-time DTO types in `packages/contracts` and runtime validators at each receiving boundary. Angular uses the DTO types for its BFF client; BFF validates incoming public requests and converts upstream DTOs into public responses; Product and Inventory each validate their internal HTTP requests. Domain objects do not implement transport DTOs or import the contracts package.

Implement these public routes in BFF exactly: `POST /api/products`, `GET /api/products`, `GET /api/products/:id`, `GET /api/inventory`, `GET /api/inventory/:productId`, `POST /api/inventory/:productId/add`, `POST /api/inventory/:productId/remove`, and `GET /api/inventory/:productId/movements`. Product internal routes use `/products`; Inventory internal routes use `/inventory`. Keep stock status out of Inventory's internal DTO; it is a BFF display projection.

## Decimal conversion

The API uses JSON numbers with at most three fractional decimal places. Validate finite numbers, range and decimal precision before converting to integer milliunits. Treat `0.001` as the minimum valid stock action, `0` as valid only for balance or threshold, and `1,000,000,000.000` as the maximum displayed quantity. Reject negative zero for an action. Never perform stock addition/subtraction on floating-point API values. Convert milliunits back to a JSON number only at response/event boundaries and test the round trip at `0.001`, `1.25` and the maximum.

Product creation accepts trimmed `name` (1–100 chars), `unit` (1–20), `category` (1–80), and optional nonnegative `lowStockThreshold` defaulting to zero. Stock commands require positive `quantity`, trimmed `reason` (1–200), path UUID and header UUID. Reject extra request fields. Preserve the exact `Idempotency-Key` when BFF forwards a command; do not generate a replacement inside BFF.

## Stable errors and timeouts

Use the public envelope `{ "error": { "code": string, "message": string, "requestId": string } }`. BFF generates a UUID request ID, returns it on errors and forwards it as `X-Request-ID`. Map `INVALID_REQUEST` to 400; `INVALID_QUANTITY` to 422; `PRODUCT_NOT_FOUND` to 404; `INSUFFICIENT_STOCK`, `STOCK_LIMIT_EXCEEDED` and `IDEMPOTENCY_CONFLICT` to 409; unavailable upstream to 502; unavailable local MongoDB to 503; and unexpected failures to 500. Internal `INVENTORY_NOT_FOUND` becomes a zero projection only when Product exists. Never return driver errors to Angular.

Set a 5-second internal HTTP timeout in the local BFF and Inventory Product client. A transient GET can be retried once. Do not automatically retry stock POST at Angular or BFF; the employee may retry with the same idempotency key after an uncertain timeout. A successful stock POST indicates MongoDB commit, while audit arrival is checked separately.

## Contract checks

- [x] Keep request and response examples in [docs/api.md](../../docs/api.md) valid against runtime DTO validation.
- [x] Assert every public route returns the specified status and envelope for success and each relevant error.
- [x] Assert an unknown product returns `PRODUCT_NOT_FOUND`, while a known product with no Inventory row appears at quantity zero.
- [x] Assert Inventory outages never become false zero balances.
- [x] Assert the BFF passes `Idempotency-Key` and `X-Request-ID` correctly and never queries MongoDB directly.
