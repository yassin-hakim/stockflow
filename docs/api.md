# HTTP API contract

This document preserves the v1 contract exercised by `verify:api` and describes the implemented complete-app additions below. Legacy `/inventory` routes operate only on Main Store after migration. Angular calls only the BFF `/api` routes. The BFF uses the corresponding internal Product, Inventory and Sales routes over HTTP. JSON uses camelCase fields and UTC ISO 8601 timestamps. IDs and `Idempotency-Key` values are UUIDs. Unknown request fields are rejected. No authentication is included in this local demo.

## Legacy shared types

```ts
type StockStatus = 'OUT' | 'LOW' | 'OK';
type MovementType = 'ADD' | 'REMOVE';
type Product = {
  id: string;
  name: string;
  unit: string;
  category: string;
  lowStockThreshold: number;
  createdAt: string;
  updatedAt: string;
};
type InventoryOverview = {
  product: Product;
  quantity: number;
  status: StockStatus;
};
type StockMovement = {
  id: string;
  productId: string;
  type: MovementType;
  quantity: number;
  reason: string;
  createdAt: string;
};
type StockChangeResult = {
  productId: string;
  quantity: number; // balance immediately after this committed command
  movement: StockMovement;
};
```

Every quantity is expressed in its Product `unit` and is a JSON number whose value is an exact multiple of `0.001`. Lexical trailing zeros are irrelevant: `1`, `1.0` and `1.0000` represent the same valid value after JSON parsing. Exponent notation is accepted if its numeric value meets the same rule; strings, `NaN` and infinity are invalid. Stock commands accept `0.001`–`1,000,000,000.000`; the resulting balance may be zero and must not exceed `1,000,000,000.000`. The boundary converts valid values to integer thousandths before arithmetic and verifies safe-integer range. `lowStockThreshold` is `0`–`1,000,000,000.000`; omitted on creation means zero. Display formatting may retain fewer than three trailing decimal places.

## Legacy BFF routes

| Method and route | Input | Success | Owner |
| --- | --- | --- | --- |
| `POST /api/products` | Product creation body | `201 Product` | Product Service |
| `GET /api/products` | None | `200 { items: Product[] }` | Product Service |
| `GET /api/products/:id` | Product UUID | `200 Product` | Product Service |
| `GET /api/inventory` | None | `200 { items: InventoryOverview[] }` | BFF joins both services |
| `GET /api/inventory/:productId` | Product UUID | `200 InventoryOverview` | BFF joins both services |
| `POST /api/inventory/:productId/add` | Stock body and `Idempotency-Key` header | `200 StockChangeResult` | Inventory Service |
| `POST /api/inventory/:productId/remove` | Stock body and `Idempotency-Key` header | `200 StockChangeResult` | Inventory Service |
| `GET /api/inventory/:productId/movements` | Product UUID | `200 { items: StockMovement[] }` | Inventory Service |

`GET /api/inventory` includes every Product, sorted by case-insensitive name then ID. The BFF joins stored Inventory records by `productId`; missing records produce `quantity: 0` and `status: "OUT"`. The detail route first confirms the Product exists. A missing internal Inventory record is zero; an Inventory Service failure is an error, never an empty or zero fallback. Movement history is newest first, with ID as a stable tie-breaker. For this deliberately small demo it returns the full list; pagination is outside v1 scope.

### Product creation

```http
POST /api/products
Content-Type: application/json

{"name":"Arabica Coffee","unit":"kg","category":"Coffee","lowStockThreshold":5}
```

`name`, `unit` and `category` are required nonblank strings (maximum lengths 100, 20 and 80). `lowStockThreshold` is optional, nonnegative and has at most three decimal places. The response adds a UUID, timestamps and an explicit threshold. The BFF does not create Inventory data on this request. Product Service rejects malformed input with `400 INVALID_REQUEST`.

### Stock changes

```http
POST /api/inventory/11111111-1111-4111-8111-111111111111/add
Content-Type: application/json
Idempotency-Key: 22222222-2222-4222-8222-222222222222

{"quantity":50,"reason":"Supplier delivery"}
```

Example success (the first add to a new product):

```json
{
  "productId": "11111111-1111-4111-8111-111111111111",
  "quantity": 50,
  "movement": {
    "id": "33333333-3333-4333-8333-333333333333",
    "productId": "11111111-1111-4111-8111-111111111111",
    "type": "ADD",
    "quantity": 50,
    "reason": "Supplier delivery",
    "createdAt": "2026-10-04T18:00:00.000Z"
  }
}
```

`reason` is required, trimmed and 1–200 characters. The caller creates a fresh UUID idempotency key for each intended stock action and reuses that key only when retrying the same action. The BFF forwards it unchanged. Inventory Service compares product ID, action, quantity and normalized reason; an exact replay returns the original `StockChangeResult` and creates no new movement or event. A different command with an existing key returns `409 IDEMPOTENCY_CONFLICT`. The returned balance belongs to that original commit; Angular refetches the overview after any successful command to show the latest balance.

### Reading movements

`GET /api/inventory/:productId/movements` first verifies that the Product exists so an unknown ID returns `PRODUCT_NOT_FOUND`. A valid product with no stock history returns `{ "items": [] }`. The BFF forwards the Inventory Service's records without altering quantities or movement order.

## Legacy internal routes

Product Service owns `POST /products`, `GET /products`, and `GET /products/:id`; their DTOs match the public Product contract. Inventory Service owns `GET /inventory` (stored `{ productId, quantity }` records only), `GET /inventory/:productId` (`{ productId, quantity }` or `404 INVENTORY_NOT_FOUND`), the two stock POST routes, and `GET /inventory/:productId/movements` (`{ items: StockMovement[] }`). It does not provide product names or status. Inventory Service calls Product Service `GET /products/:id` before creating a balance for a new product. Internal ports are private to the local deployment, not browser-facing.

## Errors and timeouts

```json
{
  "error": {
    "code": "INSUFFICIENT_STOCK",
    "message": "Cannot remove more stock than is available.",
    "requestId": "44444444-4444-4444-8444-444444444444"
  }
}
```

| HTTP status | Code | Meaning |
| --- | --- | --- |
| 400 | `INVALID_REQUEST` | Malformed JSON, missing/extra field, invalid UUID or reason, missing idempotency key |
| 422 | `INVALID_QUANTITY` | Nonpositive amount, more than three decimal places, or amount above limit |
| 404 | `PRODUCT_NOT_FOUND` | Product ID does not exist |
| 404 internal only | `INVENTORY_NOT_FOUND` | No persisted balance exists for a known/unchecked product ID |
| 409 | `INSUFFICIENT_STOCK` | Removal exceeds current stock |
| 409 | `STOCK_LIMIT_EXCEEDED` | Addition would exceed maximum balance |
| 409 | `IDEMPOTENCY_CONFLICT` | Existing key used for different command |
| 502 | `UPSTREAM_UNAVAILABLE` | Required internal HTTP service unavailable or timed out |
| 503 | `SERVICE_UNAVAILABLE` | Required local MongoDB dependency unavailable before commit |
| 500 | `INTERNAL_ERROR` | Unexpected server failure |

`requestId` is assigned by the BFF as a UUID and passed to internal services in `X-Request-ID`. HTTP error envelopes and response headers carry it; automatic per-request service logging is not implemented. Relay and worker logs use event IDs. The public response contains no MongoDB, NATS or stack-trace details. Stock HTTP success means the MongoDB transaction committed; asynchronous audit processing may finish later. On an uncertain client timeout, retry with the same `Idempotency-Key`. No automatic retry of stock POST occurs in BFF or Angular.

## Expansion DTOs and response conventions

[Shared contracts](../packages/contracts/src/operations.ts) define `Location`, `StockView`, `StockMovementV2`, `StockOperation`, `Supplier`, `StockCount`, `ReplenishmentRule/Item`, `MenuItem`, `Sale`, `Refund`, and report DTOs. Product adds `sku`, `version`, `archivedAt` while retaining all original fields. Catalog reads retain archived records; frontend operational selectors restrict new active configurations.

Pages have `{items,nextCursor}`. New history/report limits are 1–100; Inventory default is 50 and Sales default is 25. Ordering is descending UTC time and ID, with an opaque cursor; Sales mixed report rows additionally use kind as tie-breaker. Catalog and stock projection lists are small catalog lists, not paginated histories.

`StockView.locationId:null` explicitly means restaurant total. Supplying `locationId` means that location, including a known product's zero quantity after a successful source read. The effective location threshold comes from its Inventory rule or Product default; aggregate status uses Product default. Status remains `OUT`/`LOW`/`OK`. `targetQuantity:null` and `suggestedQuantity:null` mean unconfigured, not zero.

`StockOperation` includes ID, kind, `COMMITTED`/`REJECTED`, location(s), reference/reason, committed movement DTOs and optional typed error. Each movement has operation/location/cause, positive quantity, resulting quantity and time. UI supplies the display sign. New business rejections may be recorded in `stock_commands` without stock/movement/outbox changes. Public stock commands throw the stable conflict envelope; their recorded outcome is readable by operation ID. Internal consume/return commands return the terminal operation DTO, including rejection.

## Product management and menu routes

| Public method/route | Input | Success |
| --- | --- | --- |
| `PATCH /api/products/:id` | `name,category,lowStockThreshold,sku?,expectedVersion`; unit forbidden | `200 Product` |
| `POST /api/products/:id/archive` | `expectedVersion` | `200 Product`, history retained |
| `POST /api/menu-items` | `name,category,priceMinor,currency?,ingredients:[{productId,quantity}]` | `201 MenuItem` revision 1 |
| `GET /api/menu-items` | None | `{items,currency}` |
| `GET /api/menu-items/:id` | UUID | Current item |
| `GET /api/menu-items/:id/revisions/:revision` | Positive revision | Immutable snapshot |
| `POST /api/menu-items/:id/publish` | Complete menu fields plus `expectedVersion` | New immutable revision |
| `PATCH /api/menu-items/:id` | Same publish body | Same publication behavior |
| `POST /api/menu-items/:id/archive` | `expectedVersion` | Archived item |

SKU normalizes to uppercase and accepts at most 50 letters/digits/dots/underscores/hyphens, beginning with a letter/digit. Blank/null/omitted means no SKU. Product PATCH is a complete editable-field submission; preserve/send the intended SKU. Menu recipes require 1–100 positive three-decimal ingredient quantities in immutable product base units. Price is a nonnegative safe integer in minor units; currency must match configured Product currency and Sales currency. This release supports one two-decimal currency, default USD. `400` USD minor units displays `$4.00`.

## Inventory operations routes

Internal Inventory routes remove `/api`. Public document history uses `/api/operations?kind=RECEIPT|TRANSFER|WASTE|COUNT|MANUAL|SALE|SALE_RETURN`; Inventory also offers owner-local receipt/transfer/waste lists.

| Public method/route | Body/query | Success |
| --- | --- | --- |
| `GET/POST /api/locations` | POST `{name}` (1–80 characters) | List / `201 Location` |
| `GET/PATCH /api/locations/:id` | PATCH `{name,expectedVersion}` | Location |
| `GET /api/stock` | Optional `locationId` | `{items:StockView[]}` |
| `GET /api/stock/:productId` | Optional `locationId` | `StockView` |
| `POST /api/stock/:productId/add` or `/remove` | `{locationId,quantity,reason,reference?}` and UUID key | `200 StockOperation` |
| `GET /api/stock/:productId/movements` | `locationId,cause,from,to,cursor,limit` | Movement page |
| `GET /api/stock-operations/:operationId` | Submitted operation UUID | Recorded terminal result or 404 |
| `GET /api/operations` | `kind,locationId,from,to,cursor,limit` | Committed operation page |
| `POST /api/receipts` | `{locationId,lines,reason,reference,supplierId?}` and key | Committed receiving operation |
| `POST /api/transfers` | `{locationId,destinationLocationId,lines,reason,reference}` and key | Atomic paired operation |
| `POST /api/waste` | `{locationId,lines,reason,reference,wasteCategory}` and key | Waste operation |
| `GET /api/receipts/:id`, `/transfers/:id`, `/waste/:id` | Corresponding operation UUID | Matching operation document |
| `GET/POST /api/suppliers` | POST `{name,note?}` | List / `201 Supplier` |
| `PATCH /api/suppliers/:id` | `{name,note?,expectedVersion}` | Supplier |
| `GET /api/counts` | `locationId,cursor,limit` | Count page |
| `POST /api/counts` | `{locationId,productIds,reason}` and key | `200 StockCount`, ID equals key |
| `GET/PATCH /api/counts/:id` | PATCH `{expectedVersion,lines:[{productId,countedQuantity}],reason?}` | Count |
| `POST /api/counts/:id/apply` | `{expectedVersion}` and operation key | `StockOperation` |
| `POST /api/counts/:id/cancel` | `{expectedVersion}` | Cancelled count |
| `GET/POST /api/replenishment-rules` | GET `locationId?`; POST `{productId,locationId,lowStockThreshold,targetQuantity,expectedVersion}` | Rule list / saved rule |
| `GET /api/replenishment` | Required selected `locationId` in Angular | Enriched server suggestions |

`lines` is 1–100 `{productId,quantity}` entries. Product repetitions combine, with checked totals. Reasons are trimmed 1–200 characters; references 1–100. Transfer locations must differ. Waste category is `SPOILAGE`, `DAMAGE`, `PREPARATION`, `EXPIRED` or `OTHER`. Optional suppliers must exist; contact notes are at most 200 characters. Receiving cannot add new archived-product stock.

Count creation snapshots 1–100 distinct products and balance version/absence. Lines return `recordedQuantity,expectedVersion,countedQuantity,differenceQuantity`; untouched quantities/differences are null. PATCH can clear an entry with null, and zero is valid. Apply requires all entries and a current count version; any intervening balance write returns `COUNT_STALE`, preserving the draft without overwriting stock. Application state and balances commit together. Cancel changes no stock.

Rule creation uses `expectedVersion:null`; updates use current integer version. Threshold/target allow zero and at most three decimals, with target >= threshold. Inventory computes suggestions using integer milliunits; a missing rule has null target/suggestion/version. BFF adds active catalog products even without a balance/rule.

## Sales and correction routes

| Public method/route | Input | Result |
| --- | --- | --- |
| `POST /api/sales` | `{locationId,lines:[{menuItemId,quantity}]}` and key | `200` owner-priced draft |
| `GET /api/sales` | `status,search,locationId,cursor,limit` | Sale page; search <=100 characters |
| `GET /api/sales/:id` | Sale UUID | Sale with correction history |
| `PATCH /api/sales/:id` | `{expectedVersion,locationId,lines}` | Repriced draft |
| `POST /api/sales/:id/checkout` | `{expectedVersion,tender,locationId?}` and key | `200` terminal Sale or `202 CHECKOUT_PENDING` |
| `POST /api/sales/:id/cancel` | `{expectedVersion}` | Cancelled pre-checkout draft |
| `GET /api/sales/:id/receipt` | Completed sale UUID | Immutable Sale receipt plus `issuedAt` |
| `GET /api/sales/:id/refunds` | Sale UUID | `{items:Refund[]}` |
| `GET /api/sales/:id/refunds/:refundId` | Matching correction UUID | Correction status |
| `POST /api/sales/:id/refunds` | `{lines:[{saleLineId,quantity}],reason,restock,expectedVersion?}` and key | `200` terminal Refund or `202 REFUND_PENDING` |

Sale state is `DRAFT`, `CHECKOUT_PENDING`, `COMPLETED`, `REJECTED` or `CANCELLED`. Refund state is `REFUND_PENDING`, `COMPLETED` or `REJECTED`. `CASH`/`CARD` are recorded tender labels only. Quantities are positive integer sold counts, never ingredient quantities supplied by the browser. Reviewed draft/catalog changes before preparation require explicit review (`PRICE_REVIEW_REQUIRED`); prepared snapshots stay frozen across retry/restart.

202 responses include a `Location` status URL under `/api/sales/...`; pending sale/refund ID and state are persistent. A completed sale allocates one unique receipt and consumes its ingredients once. A terminal rejected checkout has no completed receipt. Refund reason is 1–500 characters; Sales preserves it and sends Inventory a bounded explanation containing the refund ID. No-restock leaves ingredients consumed. Chosen restock uses the original ingredient allocations, bounded alongside Sales cumulative refund quantities/money. Overlapping pending corrections are blocked.

## Additional internal HTTP contracts

Sales obtains menu snapshots from Product and uses these Inventory-only routes; BFF exposes no caller-authored sale ingredient-consumption command:

```text
POST /stock-operations/consume-sale
{ operationId,locationId,reference,reason,
  lines:[{productId,quantity}],
  allocations:[{saleLineId,quantity,ingredients:[{productId,quantity}]}] }

POST /stock-operations/return-sale
{ operationId,originalOperationId,returnedItems:[{saleLineId,quantity}],reason }

GET /stock-operations/:operationId
```

The Inventory UUID idempotency header must equal `operationId`. Allocation ingredient quantities are **per sold item**; Inventory verifies aggregated lines against allocation count multiplication. Return derives ingredient quantities/location from the original committed consumption, never caller totals. Internal responses are terminal `StockOperation` DTOs. Missing outcome is 404; timeout/404 is not proof that the old command cannot later commit.

## Reports and CSV

`GET /api/reports/inventory` accepts `locationId,productId,cause,from,to,cursor,limit`. It returns movement page, applied `filters`, and product/unit groups (`addedQuantity,removedQuantity,consumedQuantity,wasteQuantity,transferInQuantity,transferOutQuantity,countVariance`). Group totals cover the whole filter, not just the visible page. Transfers never become sale consumption; unlike units stay separate.

`GET /api/reports/sales` requires UTC ISO `from,to` with from < to, and accepts `locationId,cursor,limit`. It returns committed sale/refund rows, currency, gross/refund/net minor-unit totals and counts. Sales use completion time and corrections use correction completion time. A period may contain refunds for sales outside that period; totals describe recorded activity in the selected period.

Periods are half-open `[from,to)`; Angular converts browser-local date boundaries to explicit UTC instants and always sends a period. Inventory owner history permits either/both bounds. Histories/reports reject unknown/repeated query parameters. Export routes `/api/reports/inventory/export` and `/sales/export` apply the same filters, omit page cursor and read all matching pages up to **10,000 records**. CSV quotes/escapes text, includes unit/currency labels, and prefixes spreadsheet-formula text with an apostrophe. A required source outage is an error, never zero totals. Concurrent writes may make owner snapshots differ between calls; no cross-service atomic report is claimed.

## Expansion errors and identity

The stable `{error:{code,message,requestId}}` envelope remains. Added conditions include missing location/supplier/count/menu/sale/operation (404), archived products/menu, SKU/location/supplier conflicts, `VERSION_CONFLICT`, `COUNT_STALE`, `PRICE_REVIEW_REQUIRED`, `INVALID_SALE_STATE`, `OPERATION_PENDING`, `REFUND_LIMIT_EXCEEDED` and `CURRENCY_MISMATCH`. Business conflicts generally use 409; malformed shape uses 400; numeric/domain format uses 422 where the owner defines it. A Sales terminal business outcome is represented by its Sale/Refund state, rather than treating every rejection as an HTTP transport failure.

Inventory keys are globally unique across legacy, manual, document, count creation/application, sale consumption and return mutations. Receiving/transfer/waste operation IDs equal submitted keys. Sales owns a separate command registry for create/checkout/refund. A key with altered input conflicts. PATCH uses expected version rather than a new mutation retry identity. BFF never automatically retries mutations. Explicit browser retry preserves normalized input/key; Sales recovery resends only stored frozen intent. `X-Request-ID` is propagated for correlation and does not participate in command fingerprints.


## Receiving cost and P&L extension

Receipt lines accept `unitCostMinor`. `GET /api/receiving-config` supplies the currency. `GET /api/reports/profit-loss` and `/api/reports/profit-loss/export` expose full-period gross profit with cursor-paged records. See [cost reporting](cost-reporting.md).
