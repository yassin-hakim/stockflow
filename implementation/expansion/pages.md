# Expansion pages and interaction plan

Status: implemented page family with acceptance still under audit. These specifications define required interactions alongside the existing [page specifications](../pages/inventory-dashboard.md), [current frontend design](../../docs/frontend.md), [shared redesign](frontend-redesign.md) and later [cost reporting/pagination](../../docs/cost-reporting.md). Before changing a page, inspect the existing components/styles and follow [instructions.md](../../instructions.md). Rendered evidence and unproven states are identified in the [requirement evidence map](requirement-evidence.md).

## Shell and visual language

Keep one Angular application, standalone components, Router, signals, reactive forms and `BffApi`. Extend its existing navigation to Inventory, Operations, Menu, POS, Sales and Reports as those features ship. Locations and replenishment are accessible from Inventory; receiving, transfers, waste and counts from Operations. Keep the navigation usable at mobile width without introducing an elaborate dashboard shell.

Preserve Inter/system typography, warm light background, dark teal text/actions, white surfaces, subtle borders, compact controls, existing radii and visible focus. Page titles identify tasks. Tables carry operational data; cards are grouping tools and mobile table equivalents. Do not add decorative KPI cards, gradient heroes, fake activity feeds, or navigation for deferred features.

Reuse existing status/error/field/control styles and `describeError`; extract a shared component only when more than one actual feature needs its behavior. A product selector, location selector, line editor and pending-result region are likely reusable; do not create a speculative component library first.

## Routes and user tasks

Static routes must be ordered before `:id` routes. Keep `/`, existing product routes and not-found behavior.

| Route | User task and necessary information | Primary action |
| --- | --- | --- |
| `/inventory` | Search stock by product/SKU, category and status; select a location or explicit restaurant total view | Open product / receive delivery |
| `/products/new`, `/products/:id/edit` | Create/edit ingredient identity, category, SKU and default threshold; show immutable unit on edit | Save product |
| `/products/:id` | Product identity, total and per-location stock, selected-location actions, filtered movements | Add/remove stock in selected location |
| `/locations`, `/locations/new`, `/locations/:id` | Create/rename location; browse contents and link to operations | Save location / view stock |
| `/operations` | Browse real receiving, transfer, waste and count records by type/date/location | Start a clearly named operation |
| `/receipts/new`, `/receipts/:id` | Enter destination, delivery reference, optional supplier, product quantities; inspect committed receipt | Receive delivery |
| `/transfers/new`, `/transfers/:id` | Choose source/destination, product lines, quantities and reason; show available source stock | Transfer stock |
| `/waste/new`, `/waste/:id` | Select location/product, positive quantity, waste category and reason | Record waste |
| `/counts/new`, `/counts/:id` | Select location/products, enter physical counts, review recorded/count/difference, inspect stale state | Start count / apply count |
| `/replenishment` | Location-specific low/out stock, thresholds/targets, suggested quantities; distinguish missing configuration | Configure target / receive stock |
| `/menu`, `/menu/new`, `/menu/:id` | Menu identity, price/currency, recipe ingredients/base units/revision, active state | Save or publish menu item |
| `/pos` | Search menu, choose consumption location, enter integer item counts, see automatically updated prices/total and tender label | Complete sale |
| `/sales`, `/sales/:id` | Search receipt/reference; inspect frozen sold items, total, tender, lifecycle, linked stock operations and corrections | Open receipt / record refund |
| `/sales/:id/receipt` | Read completed receipt with original item/price snapshots | Print receipt |
| `/sales/:id/refunds/new` | Select eligible sold-line quantities, review amount, choose explicit restock behavior, enter reason | Record refund |
| `/reports` | Choose sales or inventory facts, period/location, view labeled totals and detailed rows | Apply filters / export CSV |

## Page specifications

### Inventory and product detail

Use the existing desktop table and mobile list patterns. Show product/category/quantity/unit/status, plus location scope. The location selection must be visible before a mutation. Restaurant totals are read-only summary values; manual add/remove requires an explicit location. Show genuine zero only after successful reads for a known product/location.

Keep history subordinate to identity/current stock/actions. Add cause, reference and location filters with bounded pagination. Link movements to receiving/transfer/count/sale detail. Archiving a product is explained and confirmed; history remains navigable. Distinguish archived catalog items from OUT stock.

### Receiving and transfers

Use a normal form with an editable line table on desktop and stacked labeled lines on mobile. Each line has product, unit and quantity; show inline validation and a form-level summary. Add/remove-line controls need accessible labels. Retain line identities while editing so errors remain attached to the correct row.

Receiving displays delivery reference and destination prominently. Transfers put source and destination first, show available source stock for guidance, and make the direction textual. Never show a partial-success interface: the backend accepts the whole document or rejects it. On success show a persistent reference and resulting movements. A timeout preserves the full form/key and offers resolution of the same operation.

### Waste and counts

Waste is a focused form, not a generic removal with an arbitrary reason string. Waste category and explanation are both visible.

Count detail presents recorded quantity, physically counted quantity and signed difference for each ingredient. An untouched counted field is not zero; explicit zero is valid. Show the snapshot time and explain that stock changes after the snapshot require refresh/recount. Before apply, summarize changes and require a deliberate confirmation. If stale, retain entered values for comparison while clearly marking them as needing recount; do not automatically reapply them against a newer baseline.

### Menu and recipe editor

Show item name/category and selling price above recipe lines. Each ingredient selector reveals its immutable base unit. Use supporting examples such as `0.018 kg per latte`; do not allow a unit selector that implies unsupported conversion. Preview ingredient consumption for one item from the server's validated recipe.

Editing/publishing creates a new immutable revision. Historical recipes remain visible through sale details. Missing or archived ingredients prevent publishing a new usable configuration and produce field-specific feedback.

### POS and receipt

On desktop, use menu selection beside a narrower cart region. On mobile, expose the cart count/total and a clear way to review it; do not compress the desktop composition. Every cart row shows item, count, unit price and line total. Show the consumption location and currency consistently.

The visible total is returned/calculated by Sales for the submitted draft. Automatically refresh it after cart/count/location changes with a short debounce; no separate price-review button is required. Keep checkout disabled until the latest input has a confirmed total. Allow continued editing during pricing, serialize updates and never overwrite newer input with an older response. A price change is shown before the employee deliberately completes checkout. Freeze a reviewed sale draft/catalog snapshot with an expected draft version for checkout. If the catalog revision changed before prepare, return a review-required conflict rather than silently charge a different total. The POS then automatically refreshes pricing and requires another deliberate checkout click. All authoritative pricing/recipe validation stays in Sales/Product.

While checkout is pending, lock cart edits/location changes/duplicate submission, show the persistent sale reference and offer Check status. Do not show a completed receipt until Sales reports `COMPLETED`. Confirmed shortages identify affected ingredients, preserve the cart, and require a new deliberate checkout attempt after correction.

Receipt printing uses a dedicated print stylesheet and browser printing. Show immutable receipt reference, time, sold items/counts/prices, total, currency and recorded tender. Exclude application navigation and action buttons from print. Printer hardware integration is outside this release.

### Sales corrections and reports

Sale history distinguishes DRAFT, CHECKOUT_PENDING, COMPLETED, REJECTED and CANCELLED with text. Refund history shows pending/completed correction status independently; retain the original sale state and totals alongside cumulative refunds.

Refund form defaults to no stock return and explains the difference in ordinary restaurant terms. Restock is a deliberate choice for ingredients actually returned to stock. Show original consumption location and amounts that would return before submission. Pending corrections have the same status/recovery interface as checkout.

Reports lead with filters and operational tables. Use only owner-calculated actual data. Display product units separately, gross sales/refunds/net values with currency, and a visible applied period/location. Errors in one required source do not become zero totals. Export must reflect the same selected scope and filters.

## State and accessibility requirements

Every remote view intentionally implements loading, populated, empty, failure and retry states. Mutations also implement validation, submitting, confirmed success, definite rejection and uncertain/pending outcome. Empty states lead to the next useful action; e.g. no menu items leads to menu creation.

Maintain associated labels, keyboard-operable controls, semantic tables, focus management, visible focus, adequate touch targets, announced error/status feedback and text-based statuses. Verify no horizontal form overflow at narrow widths. Use real domain examples and quantities, never lorem ipsum or invented analytics.

## Pending-request identity

Generalize the existing tab-scoped pending stock record to an operation envelope: command kind, normalized input, idempotency key, expected revision, persistent document/sale ID when available, and known state. Store it before dispatch; block an unsafe mutation if recovery state cannot be saved.

Legacy pending records still resolve against Main Store with their original key. New receiving/transfer/count/waste commands restore their input/reference on refresh. Sales checkout/refund additionally has server-side recovery, so closing a tab does not cancel an unresolved server workflow. Lists/details expose pending Sales records for later recovery.

Never infer failure from an expired UI timer, generate a replacement key for an uncertain command, auto-resubmit changed input, or optimistically alter stock. Clear client recovery only after a definite recorded result; refetch authoritative views after commit.

## Browser acceptance

For each shipped slice capture realistic populated and error/pending states at desktop and mobile widths; verify keyboard navigation, focus, status announcements and accessible equivalent table content. Check screen widths around the actual shared CSS breakpoint (currently 700/701 px) and reconcile the older dashboard specification's 768 px wording before implementation. Use rendered evidence rather than a build alone to sign off layout.
