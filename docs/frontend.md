# Angular frontend design

## Purpose and technology

The Angular application is the employee client for restaurant inventory and POS operations. Use standalone components, Angular Router, reactive forms and `HttpClient`. Configure one environment-specific BFF base URL (`/api` through a local dev proxy or same-origin deployment). No component may call Product Service, Inventory Service, MongoDB or NATS directly. Angular's [HTTP guide](https://angular.dev/guide/http), [routing guide](https://angular.dev/guide/routing), and [reactive forms guide](https://angular.dev/guide/forms/reactive-forms) are the implementation references.

## Original routes and preserved UI composition

| Route | View | Main elements |
| --- | --- | --- |
| `/` | Redirect | Navigate to `/inventory` |
| `/inventory` | Dashboard | Header, product/stock table or mobile cards, status badge, create-product action |
| `/products/new` | Product creation | Name, unit, category and low-stock threshold form |
| `/products/:id` | Product detail | Product summary, current stock/status, add/remove forms, movement history |
| Unknown route | Not-found view | Clear return link to dashboard |

The original feature folders are `inventory`, `products`, `shared`, and `core`; the expansion adds `operations`, `menu` and `sales`. `core` owns the single typed `BffApi` client and `describeError` error parsing; feature components own presentation and view state through signals and reactive forms. There is no global store. The dashboard loads `GET /api/inventory`; detail loads product overview and movement history. The creation form calls `POST /api/products` and navigates to the new product detail after success.

## Dashboard

Show product name, category, quantity plus unit, and `OUT`/`LOW`/`OK` status. Desktop uses a semantic table with header cells; narrow screens use accessible cards containing the same fields. A zero balance is shown explicitly (`0 kg`, for example). Sort order follows the BFF response. Provide an empty state with a Create Product action when no products exist. On failure, show a retry control and do not present a failed request as zero inventory.

Status is display data supplied by the BFF. The UI must not recompute threshold logic. `OUT` means zero, `LOW` means a positive balance at or below a positive per-product threshold, and `OK` is any other positive balance. Convey status with text and color, never color alone.

## Forms and stock actions

The Product form requires trimmed name, unit and category and accepts an optional low-stock threshold defaulting to `0`. Labels and inline validation explain the expected lengths and up-to-three-decimal quantity format. After creating a product, its detail view shows zero stock and an empty history. Product unit remains immutable in the expansion.

On the detail page, show separate Add Stock and Remove Stock forms, side by side on wide screens and stacked on narrow screens. Each includes quantity and reason, a clear action label, and a confirmation state. Quantity input supports up to three decimal places; client validation helps the employee but never replaces API/domain validation. Remove does not optimistically decrement stock. Disable both stock submit buttons while one request is pending. For each deliberate submission, generate a UUID `Idempotency-Key`; if the request times out and the employee retries the same input, reuse the key. While the prior outcome is uncertain, changed input is blocked until that original command is resolved. After a confirmed outcome, a new deliberate command receives a new key.

When a stock action succeeds, show the committed result and refetch overview plus movement history. The asynchronous audit event is not used to decide whether the form succeeded. On `INSUFFICIENT_STOCK`, show the server message and refresh the balance; on `IDEMPOTENCY_CONFLICT`, explain that the request identity was reused and require a new submission key. Preserve entered values after a recoverable error.

## Movement history

Display date/time, type, signed display quantity with product unit, and reason. The API stores positive quantities for both movement types; add `+` or `−` only in the view. Present newest first and show a genuine empty state for a valid product without movements. Use a semantic table on desktop and an equivalent list on mobile. Convert UTC timestamps to the browser's local display time while keeping the API contract in UTC.

Product detail includes a paginated named location breakdown, restaurant total, and selected-location actions. Movement history filters by purpose and local date inputs converted to UTC. Operations history filters by type, location and date. Apply filters resets pagination; cursor pages retain the last applied filter set. Select controls preserve their displayed selection when asynchronous options arrive or a loading state reconstructs the controls.

## State, errors and accessibility

Each remote view has explicit loading, success-empty, success-with-data and failure states. A stock action additionally has submitting and committed states. `BffApi` uses shared contract types and Angular `HttpClient`, exposed as promises with `firstValueFrom`; router subscriptions use `takeUntilDestroyed`. The shared `describeError` function translates stable API errors to concise text rendered by the feature components; there is no separate error component. Raw infrastructure messages never appear.

Use associated labels, keyboard-operable controls, focus management after navigation or errors, and an announced status region for submission results. Place validation beside fields and identify fields in the error summary. The interface should work at mobile width without horizontal form overflow. The project intentionally has no login or authorization screen.

## Frontend verification

Component tests cover form validation, empty and error states, status rendering, button locking during submission and movement signs. HTTP tests verify that requests target only `/api`, include the idempotency key on stock POST, and reuse it for a retry. End-to-end checks cover product creation, stock changes, history, and rejected removal. See [testing.md](testing.md).

## Pending stock request recovery

Before a stock POST, Angular persists its product ID, action, quantity, normalized reason and idempotency key in tab-scoped session storage. Navigation and refresh restore the original form values and require resolving that request before a different action. A successful response or definite rejection clears the saved request; an uncertain network/server failure preserves it. Closing the browser tab ends this recovery scope. If storage is unavailable, corrupt or cannot be written, the UI prevents an unsafe POST instead of sending an action whose retry identity could be lost.

## Expanded routes and tasks

The [route configuration](../apps/frontend/src/app/app.routes.ts) and [BffApi](../apps/frontend/src/app/core/bff-api.ts) are authoritative. Static `new` routes precede dynamic IDs.

| Routes | Task |
| --- | --- |
| `/inventory`, `/locations/:id` | Search/filter stock, select location or restaurant total, inspect quantities/status |
| `/products/new`, `/products/:id/edit`, `/products/:id` | Maintain ingredients/SKU/archive and location stock/history |
| `/locations`, `/locations/new` | Create/rename locations and browse contents |
| `/operations`, `/operations/:id` | Bounded committed operation history and referenced movements |
| `/receipts/new`, `/receipts/:id` | Multi-line receiving and supplier reference |
| `/transfers/new`, `/transfers/:id` | Atomic source/destination transfer |
| `/waste/new`, `/waste/:id` | Categorized loss with explanation |
| `/suppliers` | Create/edit simple name/contact references |
| `/counts`, `/counts/new`, `/counts/:id` | Snapshot, physical entry, server difference review, explicit apply/cancel |
| `/replenishment` | Per-location status, missing-target guidance, versioned target editing and receiving link |
| `/menu`, `/menu/new`, `/menu/:id` | Price and recipe editing/publication/archive, historical revisions |
| `/pos` | Owner-priced cart, consumption location, recorded tender and checkout status |
| `/sales`, `/sales/:id` | Sale lifecycle, receipt/reference search and corrections |
| `/sales/:id/receipt` | Immutable completed receipt and browser printing |
| `/sales/:id/refunds/new` | Eligible sold quantities, original-price amount, explicit stock-return choice |
| `/reports` | Inventory/Sales period/location facts and matching-filter CSV |

Reports are part of the expanded composition; final route/runtime/browser acceptance is tracked in [expansion verification](../implementation/expansion/verification.md), not implied by this route table. No navigation is added for deferred purchase orders, user administration, payment terminals or analytics.

## Presentation constraints

Read [instructions.md](../instructions.md) and the [expansion page specifications](../implementation/expansion/pages.md) before changing a screen. Reuse the warm light background, teal text/actions, restrained borders, compact controls, associated labels, semantic tables and accessible mobile lists. Global responsive table/list breakpoint is 700/701 px. Loading, empty, populated, failure and retry states are explicit; failed source reads never display false zero quantities/totals.

Product archival is confirmed and preserves history. Restaurant total stock is a read projection; stock actions require a selected location. Threshold/status comes from BFF and suggested replenishment from Inventory. Recipes display immutable ingredient base units without a conversion selector. POS displays Sales-priced counts/unit prices/totals; Angular does not compute ingredient consumption or authoritative prices.

## Human-readable records

Visible content uses product/menu/location names, entered delivery references and recorded receipt references. Uncompleted sales use their item names/counts and local creation time; automatic stock operations use their operation type, location and time. A sale consumption detail can read its linked Sale through the BFF to show recorded menu items. Internal UUIDs stay in routes, API bodies, persistence and recovery keys.

The shared `record-labels` helpers and `ReadableText` pipe resolve UUIDs in server feedback against already-loaded catalog/location data and frozen recipe snapshots. Missing names show an explicit unavailable label rather than the technical ID. Generated sale/refund reason prefixes become readable text while employee explanations remain visible. Product history, count views, operations, POS, sales and report tables reuse this presentation behavior. These labels do not invent document identities, prices, quantities or outcomes.

## Automatic POS pricing

Adding/removing menu items, changing whole item counts or switching the consumption location immediately invalidates checkout and schedules a Sales-priced draft update after a 250 ms pause. There is no price-review button. Tender/search changes do not trigger pricing. The order shows the confirmed server total; while pricing is queued or in flight it announces Updating total and prevents checkout.

Pricing requests run one at a time. Cashiers can keep editing during pricing; an older response updates the saved draft version but never replaces newer cart input or authorizes its checkout. The latest input is priced next. Removing the last line cancels the uncompleted persistent draft and clears its saved reference. Invalid counts never dispatch. Restored editable drafts refresh prices automatically.

Creation saves its immutable command/key before dispatch. An uncertain creation locks further edits and retains that key for status recovery; after resolution, any newer local input is priced against the recorded draft. Failed draft edits preserve cart input and offer Retry price update; a version conflict reads the current draft before retrying once. Checkout catalog conflicts automatically refresh the total and require another deliberate Complete sale action. They never automatically charge, consume stock or complete a sale.

## Count review and stale-state behavior

`StockCounts` preserves a blank entry as null and accepts explicit zero. Save-and-review fetches server-calculated signed differences from the saved snapshot. Apply requires deliberate confirmation and uses the reviewed count version. An intervening stock write produces stale feedback while retaining entered comparison data; the employee starts a fresh count/recounts. A retry does not silently replace the snapshot or apply entered data to a new baseline.

## Expanded pending recovery

Receiving/transfer/waste forms save the complete normalized input and UUID before dispatch through `PendingOperations`. Count creation/application similarly saves document identity/version/key in tab storage. Uncertain requests lock changed input and offer status lookup or deliberate retry of the same request. Storage unavailable/corrupt/write failure blocks unsafe dispatch. Old `PendingStockCommands` records continue resolving against Main Store with their original key.

POS/correction pages preserve persistent Sale/Refund identity and original checkout/refund key across navigation/refresh. `CHECKOUT_PENDING`/`REFUND_PENDING` remain distinct from completed or rejected. The server also scans pending workflows after restart, independent of browser participation. The UI shows no optimistic stock deduction, premature receipt or success based solely on timeout. Stock outcome lookup 404 means unresolved, not definite failure.

## Receipt and report rendering

Receipt routes use immutable Sales DTOs with reference/time/items/counts/prices/total/currency and print styles that remove app navigation/actions. Browser printing is supported; printer hardware integration is deferred. Reports convert browser-local date boundaries to UTC instants, show the applied period/location, preserve separate ingredient units and currency, and export the same filters. Required source failures are visible.

## Expanded frontend verification

Component tests cover count blank/zero and review gates, saved identity after timeout, stale input preservation, menu/base-unit behavior, POS/correction lifecycle and existing stock recovery. Build/tests verify code behavior; final desktop/mobile populated/error/pending states, keyboard/focus behavior and receipt print layout still require the rendered evidence recorded in the expansion acceptance tracker. Earlier stock-only browser evidence remains in [baseline verification](../implementation/verification.md).

The [requirement evidence audit](../implementation/expansion/requirement-evidence.md) identifies which current browser artifacts prove a route/state and which clauses remain open. The retained `completion-browser.json` establishes post-filter named location/history behavior and actual pre-migration browser-command recovery at 1440/375 px. That scoped proof does not certify the entire final frontend or later code edits.

## Shared visual system and responsive shell

The [October frontend redesign](../implementation/expansion/frontend-redesign.md) applies the constraints in `instructions.md` across the original and expanded pages. Shared CSS variables own the warm neutral/teal palette, typography, borders, fields, feedback and compact status labels. Page headings remain task-focused; white surfaces group editable documents, stock actions and the POS order. Dense desktop tables have readable mobile list equivalents at 700 px and below.

The main navigation marks the active feature even on detail routes. Mobile uses a native button with `aria-expanded`/`aria-controls`; Escape closes its menu and restores trigger focus. A skip link reaches the main content. Inventory and stock operations reuse one section-navigation component rather than page-specific copies. Page components load through Angular Router on demand to keep the initial bundle below its configured warning budget.

Quantity, status, pricing, pending identities and API ownership continue following the contracts above. Rendered desktop/mobile, breakpoint, keyboard, feedback and receipt-print evidence for this redesign is recorded separately from full expansion release acceptance.


## Shared pagination and gross-profit reporting

Record lists now use shared Previous/Next controls with 10/25/50 rows, matching desktop/mobile slices and filter resets. Receiving includes cost per base unit; Reports includes gross P&L and CSV. Owner services calculate stock values and profit. See [cost reporting](cost-reporting.md).
