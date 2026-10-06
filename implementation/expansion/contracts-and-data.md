# Expansion contracts and data plan

Status: acceptance design retained from the expansion plan. The routes are implemented; [docs/api.md](../../docs/api.md), [shared transport types](../../packages/contracts/src/operations.ts) and owner boundary validators describe their current exact shapes. This document does not certify runtime acceptance. Use the [architecture](architecture.md) for ownership and consistency, [cost reporting](../../docs/cost-reporting.md) for the later X13 extension, and the [requirement evidence map](requirement-evidence.md) for verification status.

## Shared transport types

Extend `packages/contracts` with transport DTOs only. Keep receiving-boundary runtime validation in each service and BFF. Domain objects never implement/import these DTOs.

| DTO family | Required fields and behavior |
| --- | --- |
| Product v2 | Existing fields, optional SKU, `archivedAt`, revision/version for conditional edit; unit remains immutable |
| Location | UUID, unique normalized name, creation/update times and version |
| Stock balance view | Product summary, location ID/name, quantity, effective threshold, optional target, server-provided `OUT/LOW/OK` |
| Aggregate stock view | Product summary, summed quantity, explicit `ALL_LOCATIONS` scope, server-provided status using product-wide threshold |
| Movement v2 | Existing positive quantity and ADD/REMOVE fields, location, operation ID, cause, optional source reference; display sign remains a presentation concern |
| Stock operation | UUID, kind, normalized lines, fingerprint, terminal status, result/error, timestamps, related receipt/transfer/count/sale reference |
| Receipt document | Receiving ID/reference, optional supplier ID/reference, location, immutable committed product lines, time and explanation |
| Transfer document | Transfer ID, distinct source/destination locations, positive product lines, reason, time and resulting movements |
| Waste document | Waste ID, location/product, positive quantity, enumerated category, required explanation and movement reference |
| Count session | ID, location, selected products, baseline quantities and expected versions/absence, counted quantities, reason, state and applied differences |
| Replenishment rule | Product/location, nonnegative low threshold and target, target greater than or equal to threshold; version for edits |
| Menu item / recipe | Menu UUID, name/category, active/archive state, price in minor units, currency, recipe revision, positive ingredient quantities in base units |
| Sale | ID, state, consumption location, immutable menu/ingredient/price snapshots, integer counts, totals, tender label, checkout attempts, receipt reference and UTC times |
| Refund | ID/sale, sold-line quantities, original-price-derived amount, reason, restock choice, state, Inventory return operation reference and times |
| Report result | Owner-calculated facts, applied filters, scope, time bounds, pagination and optional aggregates |

All dates are UTC ISO timestamps on the wire. Angular displays browser-local time; report filters send explicit instants. Quantities have at most three decimals; prices/totals use integer minor-unit fields with an explicit currency code. Do not mix stock precision with money precision.

## API map

Every public route below goes through BFF. Internal routes remove `/api` and map to the named owner unless an explicit internal stock operation is shown. New stock reads use `/stock`; legacy `/inventory` remains the Main Store compatibility surface.

| Public route family | Owner | Planned operations |
| --- | --- | --- |
| `/api/products` | Product | Keep create/list/detail; add PATCH detail with expected version and POST archive |
| `/api/locations` | Inventory | Create/list/detail/rename; no location archival in this release |
| `/api/stock` | Inventory + BFF | List location-specific or aggregate product views; detail by product with location breakdown; filters and cursor paging |
| `/api/stock/:productId/movements` | Inventory + BFF | Cursor-paged history; optional location/cause/date filters |
| `/api/stock/:productId/add`, `/remove` | Inventory | Explicit location-aware manual commands, separate from legacy routes |
| `/api/stock-operations/:operationId` | Inventory | Read committed/rejected operation outcome for UI recovery where applicable |
| `/api/suppliers` | Inventory | Optional simple reference catalog: name/contact note, list/create/edit; no purchasing/accounting behavior |
| `/api/receipts` | Inventory | List/detail and POST a complete delivery in one command |
| `/api/transfers` | Inventory | List/detail and POST a complete immediate transfer |
| `/api/waste` | Inventory | List/detail and POST categorized waste |
| `/api/counts` | Inventory | Create baseline session; detail; PATCH draft counted quantities; POST apply or cancel |
| `/api/replenishment-rules` | Inventory | Read/upsert versioned product/location policies |
| `/api/replenishment` | Inventory + BFF | Owner-calculated actionable quantities enriched with product/location labels |
| `/api/menu-items` | Product | Create/list/detail/update/archive; publish immutable recipe revisions |
| `/api/sales` | Sales | Create draft, list/detail; PATCH draft with expected version; POST checkout or draft cancellation |
| `/api/sales/:saleId/receipt` | Sales | Immutable receipt DTO for completed sale; Angular supplies browser print layout |
| `/api/sales/:saleId/refunds` | Sales | List/detail and POST partial/full recorded refund with explicit restock choice |
| `/api/reports/inventory` | Inventory + BFF | Movement, waste, transfer and count-difference facts; location/date/cause filters |
| `/api/reports/sales` | Sales | Completed sales, refunds and net recorded sales, sold item quantities, date/location filters |
| `/api/reports/inventory/export`, `/sales/export` | Owning query + BFF | CSV with matching filters and clearly labeled columns |

The BFF must not expose a generic endpoint accepting caller-authored ingredient consumption for checkout. Sales obtains and freezes the recipe itself. Manual add/remove remains an explicitly labeled employee operation.

### Additional internal HTTP contracts

- Product supplies active menu/recipe snapshots for Sales and immutable historical revisions for detail/history. Snapshot DTO contains every required product unit and immutable price/recipe reference.
- Inventory accepts `POST /stock-operations/consume-sale` from Sales: operation ID, sale/attempt references, location, aggregated product quantities, item-to-ingredient allocations, and normalized reason.
- Inventory accepts `POST /stock-operations/return-sale` from Sales: return operation ID, original consumption operation ID, selected sold-line quantities and reason. It derives/validates returned ingredient amounts against the original allocation; do not trust arbitrary caller-supplied return totals.
- Inventory exposes `GET /stock-operations/:operationId`: `COMMITTED`, `REJECTED`, or 404 for not recorded. A timeout/404 never alone establishes that a dispatched command cannot still commit.
- Service HTTP clients preserve `X-Request-ID`; Sales uses the stored stock-operation UUID as its Inventory idempotency key.

## Request identity, response and error rules

- Require UUID `Idempotency-Key` for stock mutation, checkout and refund commands. Also apply it to creation of durable receiving/transfer/count/sale documents so an uncertain create cannot duplicate them.
- For new Inventory mutations, use the submitted key as the operation ID so the caller can resolve an uncertain result even if the first response is lost. Compound documents retain their own document IDs when needed. Legacy operations retain deterministic backfilled IDs and unchanged legacy result DTOs.
- PATCH draft/catalog operations use `expectedVersion` and a conditional update. Replayed edits must not duplicate operation side effects; a stale version returns `VERSION_CONFLICT` for explicit refresh.
- Checkout requires the reviewed Sales draft version. Draft responses include owner-priced totals and catalog/recipe revisions; changed configuration before prepare returns a documented review-required conflict. Add `PRICE_REVIEW_REQUIRED` to the error union. The server freezes snapshots only after the reviewed version/configuration is accepted.
- Immutable command fingerprints include operation kind, location(s), normalized lines, reason, references and relevant snapshot IDs. Canonicalize line order and combined ingredient quantities; retain source line allocation separately.
- A key cannot be reused with altered input. Inventory's command-key uniqueness stays global across its mutation kinds, preserving the old invariant. Each other service owns its own registry/uniqueness.
- Synchronously committed stock operations return their stored result. An uncertain Sales checkout/refund returns HTTP 202 with persistent sale/correction ID, pending state and status URL. A terminal completed outcome returns HTTP 200; repeated calls return the same outcome.
- Public stable errors retain `{ error: { code, message, requestId } }`. Planned additions: `LOCATION_NOT_FOUND`, `PRODUCT_ARCHIVED`, `SKU_CONFLICT`, `VERSION_CONFLICT`, `COUNT_STALE`, `OPERATION_PENDING`, `INVALID_RECIPE`, `MENU_ITEM_UNAVAILABLE`, `SALE_NOT_FOUND`, `INVALID_SALE_STATE`, `REFUND_LIMIT_EXCEEDED`, `CURRENCY_MISMATCH`, plus `PRICE_REVIEW_REQUIRED` above.
- Map stale state, insufficient stock, changed-key reuse and refund limits to conflicts; malformed input to 400; invalid numeric/domain format to 422; unavailable dependencies to safe availability errors. Shortage details may be a documented typed extension, not raw driver output.
- BFF never automatically retries a mutation. Sales recovery may repeat only an already persisted immutable operation with its original key. Angular recovery may resend the same deliberate command; it must not manufacture a replacement key after timeout.

## Query contracts and reports

Use bounded page sizes, maximum 100, and stable opaque cursors. Movement/document histories order by `(createdAt desc, id desc)`; stock lists use a documented stable product sort. Do not fetch an unbounded history for UI/reporting.

Date ranges use UTC instants `[from, to)`; record location and scope in results. UI converts local range boundaries to instants and shows the applied period. Pending/rejected checkout attempts are not completed sales. Reports distinguish gross completed sale totals, recorded refunds and net recorded sales. Transfers do not count as sales consumption or received deliveries.

An inventory report may summarize quantities by product/base unit; never add kilograms, liters and pieces into one quantity metric. CSV exports apply the same filters/calculations, enforce a documented row limit, and neutralize spreadsheet-formula prefixes in user-entered text fields. Cross-service report views are read projections with independent service snapshots; do not claim an atomic cross-service reporting instant.

For location-specific stock, BFF uses configured Inventory low threshold when present, otherwise the Product threshold. Aggregate stock uses Product threshold against total quantity. Replenishment requires a configured Inventory target; missing target displays configuration guidance, not an invented recommended order. Inventory computes `max(0, target − quantity)` in integer milliunits for balances at/below the configured replenishment threshold.

## Persistence and index plan

| Database | Collections / critical indexes |
| --- | --- |
| `stockflow_product` | Existing `products`; unique partial normalized SKU when supplied; archived/name filters. `menu_items`; `recipe_revisions` with unique `(menuItemId, revision)` and immutable ingredient snapshots |
| `stockflow_inventory` | `locations` with unique normalized name; `inventory` unique `(productId, locationId)` and versioned updates; `stock_commands` unique idempotency key and operation ID; `stock_movements` unique `(operationId, lineId)` plus location/product/time/cause indexes |
| `stockflow_inventory` | `receipts`, `transfers`, `waste_records`, `count_sessions`, optional `suppliers`, `replenishment_rules` unique `(productId, locationId)`; command-linked document IDs and time/filter indexes; existing `outbox` due-work index |
| `stockflow_sales` | `sales` and `checkout_attempts`; unique checkout key/Inventory operation ID; version/state recovery indexes; unique receipt reference; `refunds` with unique refund key/return operation ID; sale-scoped correction queries; `outbox` due-work index |
| `stockflow_audit` | Existing `stock_events` accepting v1/v2, deduplicated by event ID; new `sales_events` with same immutable-payload deduplication policy |

Do not retain a unique movement-level idempotency key for multi-line commands. The command registry supplies uniqueness and original-result replay. Movement IDs remain globally unique. Transactionally persist document/command state alongside every related balance write; history cannot claim completion before stock commits.

## Event envelopes

- Stock v1 stays readable and unchanged. Stock v2 adds location/operation/cause to the existing committed movement envelope.
- Each stock movement has one immutable event ID and outbox intent. A one-product transfer has two movement events; their operation ID links them.
- `SaleCompleted` / `SaleRefunded` use a Sales event schema v1 with event ID, sale ID, checkout/refund reference, receipt reference where applicable, integer amount/currency, location, and occurrence time. Do not reuse `StockEventV1` for this event family.
- Business snapshots are stored by owners; audit payloads carry the documented facts needed for tracing. Audit records do not replace Sales/Inventory operational queries.
- Ensure parser support, subject/type agreement, strict schema validation, UTC validation, identical-payload replay and PubAck/ack handling for each version/family.

## Compatibility gates

- Keep original Product fields and legacy default-location stock routes valid.
- Map older browser pending-command records to Main Store without changing the saved key or original response shape.
- Keep old pending outbox payloads and audit rows readable; never rewrite their event IDs or timestamps.
- Prove migrations on existing data and rerun them; verify IDs, sums and replay results before/after.
- Add new internal configuration/env examples, build scripts and schema version guards without exposing internal URLs/credentials in Angular.
