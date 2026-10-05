# Phase 7 — Angular frontend

## Goal and inputs

Implement every planned user-facing route and component against the real BFF, completing the employee workflow. Use [docs/frontend.md](../../docs/frontend.md), [docs/api.md](../../docs/api.md), and all six page/component specs: [dashboard](../pages/inventory-dashboard.md), [create product](../pages/create-product.md), [product detail](../pages/product-detail.md), [stock actions](../pages/stock-actions.md), [movement history](../pages/movement-history.md), and [not found](../pages/not-found.md).

## Includes

Build Angular standalone components with Router, typed `HttpClient` and reactive forms. `/` redirects to `/inventory`; `/inventory` shows the sorted Product/stock dashboard; `/products/new` creates a Product; `/products/:id` shows the overview, two separate stock forms and movement history; wildcard routes show Not Found. Use one `/api` BFF base URL through the local proxy. No frontend client may call Product/Inventory ports, MongoDB or NATS.

Implement loading, empty, data, failure and retry states per view. Show Product name/category/unit, exact formatted quantity and BFF-provided OUT/LOW/OK text. Use a semantic table above 768 px and equivalent labeled cards below 768 px. Product form validates name/unit/category and optional threshold. Stock forms validate positive up-to-three-decimal quantity and required reason, disable duplicate submissions, and generate one UUID idempotency key per intended action. Keep the same key on a manual retry after an uncertain timeout; before changed input becomes a new action, refresh/reconcile the previous result. Do not optimistically change balance. After success, announce the committed result and refetch overview/history.

History shows newest-first timestamp, ADD/REMOVE, signed display quantity with Product unit and reason. Convert UTC time to local display time without changing API values. An unknown Product renders not found; a BFF outage is a retryable error, never an empty list or false zero. Provide labels, keyboard access, announced result/error regions, focus management and readable 375 px and 1280 px layouts. There is no login, administration or reporting page in v1.

## Implementation progress

- [x] Configure Angular standalone bootstrap, Router, reactive forms, typed BFF clients and `/api` proxy.
- [x] Build dashboard with Product/stock rows, responsive cards, status text and loading/empty/error/retry states.
- [x] Build Product creation form, validation, pending/error handling and redirect to the new detail route.
- [x] Build Product detail overview, two stock action forms, idempotency/retry behavior and refresh after commands.
- [x] Build movement history, UTC-to-local display, signed quantities and independent history error/empty states.
- [x] Build `/` redirect, wildcard Not Found and unknown-product versus unavailable-service states.
- [x] Add component/HTTP/browser tests for forms, state transitions, responsive layout and accessibility.

## Exit gates

- [x] The complete create → zero-stock → add → remove → history → rejected-removal workflow works through Angular and BFF with no direct internal-service request in a browser network trace or production bundle.
- [x] Product and stock forms enforce documented input rules; a double click sends one command, and a timeout retry reuses its idempotency key.
- [x] Dashboard and detail distinguish loading, empty, error and data states; a service failure never appears as zero stock or empty history.
- [x] ADD/REMOVE history displays correct signs, units, reasons and local times in newest-first order.
- [x] Keyboard navigation and automated screen-reader semantics checks cover labels, errors, status announcements and navigation; 375 px and 1280 px views have no clipped essential controls.

**Handoff:** The entire employee workflow is ready for the system-wide evidence and failure tests in Phase 8.
