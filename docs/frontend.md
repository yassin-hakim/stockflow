# Angular frontend design

## Purpose and technology

The Angular application is the user-facing client for the inventory demo. Use standalone components, Angular Router, reactive forms and `HttpClient`. Configure one environment-specific BFF base URL (`/api` through a local dev proxy or same-origin deployment). No component may call Product Service, Inventory Service, MongoDB or NATS directly. Angular's [HTTP guide](https://angular.dev/guide/http), [routing guide](https://angular.dev/guide/routing), and [reactive forms guide](https://angular.dev/guide/forms/reactive-forms) are the implementation references.

## Routes and UI composition

| Route | View | Main elements |
| --- | --- | --- |
| `/` | Redirect | Navigate to `/inventory` |
| `/inventory` | Dashboard | Header, product/stock table or mobile cards, status badge, create-product action |
| `/products/new` | Product creation | Name, unit, category and low-stock threshold form |
| `/products/:id` | Product detail | Product summary, current stock/status, add/remove forms, movement history |
| Unknown route | Not-found view | Clear return link to dashboard |

Suggested feature folders are `inventory`, `products`, `shared`, and `core`. `core` owns the typed BFF client and API error parsing; feature components own only presentation and view state. Keep this app small: no global store is needed. The dashboard loads `GET /api/inventory`; detail loads product overview and movement history. The creation form calls `POST /api/products` and navigates to the new product detail after success.

## Dashboard

Show product name, category, quantity plus unit, and `OUT`/`LOW`/`OK` status. Desktop uses a semantic table with header cells; narrow screens use accessible cards containing the same fields. A zero balance is shown explicitly (`0 kg`, for example). Sort order follows the BFF response. Provide an empty state with a Create Product action when no products exist. On failure, show a retry control and do not present a failed request as zero inventory.

Status is display data supplied by the BFF. The UI must not recompute threshold logic. `OUT` means zero, `LOW` means a positive balance at or below a positive per-product threshold, and `OK` is any other positive balance. Convey status with text and color, never color alone.

## Forms and stock actions

The Product form requires trimmed name, unit and category and accepts an optional low-stock threshold defaulting to `0`. Labels and inline validation explain the expected lengths and up-to-three-decimal quantity format. After creating a product, its detail view shows zero stock and an empty history. Product unit cannot be edited in v1.

On the detail page, show separate Add Stock and Remove Stock forms, side by side on wide screens and stacked on narrow screens. Each includes quantity and reason, a clear action label, and a confirmation state. Quantity input supports up to three decimal places; client validation helps the employee but never replaces API/domain validation. Remove does not optimistically decrement stock. Disable both stock submit buttons while one request is pending. For each deliberate submission, generate a UUID `Idempotency-Key`; if the request times out and the employee retries the same input, reuse the key. Generate a new key after a confirmed success or changed input.

When a stock action succeeds, show the committed result and refetch overview plus movement history. The asynchronous audit event is not used to decide whether the form succeeded. On `INSUFFICIENT_STOCK`, show the server message and refresh the balance; on `IDEMPOTENCY_CONFLICT`, explain that the request identity was reused and require a new submission key. Preserve entered values after a recoverable error.

## Movement history

Display date/time, type, signed display quantity with product unit, and reason. The API stores positive quantities for both movement types; add `+` or `−` only in the view. Present newest first and show a genuine empty state for a valid product without movements. Use a semantic table on desktop and an equivalent list on mobile. Convert UTC timestamps to the browser's local display time while keeping the API contract in UTC.

## State, errors and accessibility

Each remote view has explicit loading, success-empty, success-with-data and failure states. A stock action additionally has submitting and committed states. Use typed interfaces from [API](api.md), keep `HttpClient` calls in one feature client per route group, and unsubscribe or use Angular's lifecycle-aware utilities. A shared error component translates the stable API code to concise text; raw infrastructure messages never appear.

Use associated labels, keyboard-operable controls, focus management after navigation or errors, and an announced status region for submission results. Place validation beside fields and identify fields in the error summary. The interface should work at mobile width without horizontal form overflow. The project intentionally has no login or authorization screen.

## Frontend verification

Component tests cover form validation, empty and error states, status rendering, button locking during submission and movement signs. HTTP tests verify that requests target only `/api`, include the idempotency key on stock POST, and reuse it for a retry. End-to-end checks cover product creation, stock changes, history, and rejected removal. See [testing.md](testing.md).
