# Phase 6 — Backend for Frontend

## Goal and inputs

Expose the entire Angular-facing API through one thin NestJS BFF. Product, Inventory and Audit already exist; this phase adds synchronous composition and stable public errors without moving business rules out of the owning services. Follow the [BFF spec](../services/bff.md), [HTTP contract implementation](../architecture/contracts.md), [docs/api.md](../../docs/api.md), and [docs/backend.md](../../docs/backend.md).

## Includes

Implement typed Product and Inventory HTTP clients with 5-second local timeouts, request-ID forwarding and one optional transient retry for GET only. Add public `POST/GET /api/products`, product detail, inventory list/detail, stock add/remove and movement history routes. Validate request shape, UUID paths, product fields, quantity/reason, and the required stock `Idempotency-Key`; forward a stock key unchanged. Never automatically retry stock POST and never access MongoDB or NATS from BFF.

For the dashboard, call both service lists and left-join Inventory balances onto **all** Products, sorting by case-insensitive product name then ID. A missing physical balance for a known Product is zero; classify status as `OUT` at zero, `LOW` for positive quantity at or below a positive Product threshold, and `OK` otherwise. Detail fetches Product first and interprets internal `INVENTORY_NOT_FOUND` as zero only for that known Product. A 5xx or timeout from Inventory must remain an error. Movement history verifies Product existence, then returns Inventory's newest-first records. The BFF owns this read projection, not add/remove invariants.

Centralize public error mapping to `{ error: { code, message, requestId } }`, propagating `X-Request-ID` to internal services. Keep MongoDB/NATS stack details out of public responses. Add liveness and readiness; readiness checks Product and Inventory upstream health.

## Implementation progress

- [x] Implement Product and Inventory internal HTTP clients, configuration validation and 5-second timeouts.
- [x] Add all eight `/api` routes with transport validation, typed DTO mapping and unchanged stock key forwarding.
- [x] Implement product/inventory left join, zero projection, status classification and stable sorting.
- [x] Handle known-product missing balance differently from unknown product or unavailable Inventory Service.
- [x] Add one error filter, request-ID propagation, liveness and readiness endpoints.
- [x] Add route contract, projection, timeout and error-mapping tests using real service responses where practical.

## Exit gates

- [x] All eight public routes match [docs/api.md](../../docs/api.md) for request/response shape, success status, documented errors and `X-Request-ID` behavior.
- [x] A Product created in Phase 3 but never stocked appears at zero/OUT; threshold boundaries produce correct LOW/OK status.
- [x] Unknown Product returns `PRODUCT_NOT_FOUND`; a known Product with no Inventory row returns zero; an Inventory outage produces `UPSTREAM_UNAVAILABLE`, never false zero.
- [x] Repeated stock POST with one key is forwarded unchanged and returns Inventory's original result; BFF does not automatically retry or enforce stock sufficiency.
- [x] Source and runtime checks confirm BFF has no MongoDB/NATS connection and no Inventory domain rules.

**Handoff:** Angular can be implemented against a complete `/api` origin without calling internal service ports.
