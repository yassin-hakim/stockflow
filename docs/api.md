# HTTP API contract

This is the implemented v1 contract, shared through `packages/contracts` and exercised by `verify:api`. Angular calls only the BFF `/api` routes. The BFF uses the corresponding internal Product and Inventory routes over HTTP. JSON uses camelCase fields and UTC ISO 8601 timestamps. IDs and `Idempotency-Key` values are UUIDs. Unknown request fields are rejected. No authentication is included in this local demo.

## Shared types

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

## BFF routes

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

## Internal routes

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
