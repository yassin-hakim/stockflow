# Frontend visual redesign — 6 October 2026

Implemented against [instructions.md](../../instructions.md), [frontend architecture](../../docs/frontend.md), the original [page specifications](../pages/inventory-dashboard.md), and [expanded page requirements](pages.md).

## Design decisions

The existing warm neutral and teal identity is refined into one restaurant operations interface. The reading order is task context, page title and primary action, filters or location, then records. Tables carry data directly; white panels group editable documents and the POS order. No decorative charts, invented metrics, remote font dependency or new product capabilities were added.

[Shared tokens and controls](../../apps/frontend/src/styles.css) define the palette, typography, 8 px surfaces, fields, numeric alignment, status labels, feedback, focus, and responsive lists. [The shell](../../apps/frontend/src/app/app.html) uses a compact product mark, six actual feature destinations, an accessible mobile menu and a skip link. [Section navigation](../../apps/frontend/src/app/shared/section-nav.ts) is shared by inventory and warehouse pages. All [routes](../../apps/frontend/src/app/app.routes.ts) load their page components on demand.

| Area | Composition |
| --- | --- |
| Inventory and locations | Location scope and filters before a compact desktop table or equivalent mobile list; receiving and product creation are explicit actions |
| Product creation/editing | Product identity, fixed base unit and stock settings in a normal form; archival remains separate |
| Product stock | Quantity, textual status and selected location together; distinct Add/Remove forms, then movement history |
| Receiving, transfers and waste | Location/reference first, editable ingredient lines, reason and explicit operation action |
| Counts and replenishment | Readable snapshot comparisons, review/confirmation and stale-state feedback; per-location target editing |
| Suppliers and menu | Consistent forms, restrained catalog rows, ingredient base units and recipe revisions |
| POS | Menu selection beside an order on desktop; item count and cart shortcut on mobile; automatically confirmed server prices before checkout |
| Sales, refunds and receipts | Persistent reference and state, original item/pricing facts, explicit correction choice, separate printable receipt |
| Reports and not-found | Filters and applied scope before real records; clear navigation recovery |

API contracts, command identities, authoritative status/pricing, stock precision and recovery logic retain their existing roles. The Locations list now links to its existing location inventory route. The refund page links to the original consumption location instead of displaying its raw ID.

## Verification

- Production frontend build passed without budget warnings. Initial bundle: approximately 295 kB, versus 556.16 kB before route splitting.
- All 62 frontend tests passed, including an added mobile-menu Escape/focus regression.
- Architecture import-boundary check passed; frontend diff whitespace check passed.
- Browser route audit: 27 real routes at 1440 and 375 px, plus 320, 700 and 701 px (135 rendered views). No runtime errors, page-level horizontal overflow, or unlabeled visible text/select controls were found. The wide replenishment table scrolls within its own keyboard-focusable region at 701 px; below 701 px it has the equivalent mobile list.
- Desktop/mobile screenshots were inspected across inventory, products, locations, operations, counts, replenishment, suppliers, menu, POS, sales, refund, receipt, reports and not-found views.
- Keyboard check: the mobile menu opens with an announced expanded state; Escape closes it and returns focus to its trigger.
- Product validation retained inline errors and focused the error summary.
- Network-intercepted loading, empty and failure states were rendered without changing backend records. A restored operation fixture retained its values and disabled editable controls; Check status read its existing committed result.
- POS price review displayed the server's USD 4.50 cart and recipe revision. Its test draft was cancelled without checkout or stock consumption.
- Receipt print media hid navigation, footer and action controls while retaining receipt reference, date, items, total and tender. A browser PDF was generated.

Local screenshots and JSON results are under `output/playwright/redesign-*` (git-ignored). This verifies the frontend redesign; it does not substitute for unfinished expansion recovery, migration or release acceptance gates in [verification.md](verification.md).

## Automatic POS pricing follow-up

Removed the normal price-review action. Cart/count/location changes debounce for 250 ms and automatically create or update the Sales-priced draft. Continued input is preserved during pricing; requests serialize against returned draft versions, and checkout waits for the latest confirmed total. Tender changes do not reprice. Empty carts cancel their uncompleted saved draft. Uncertain creation retains its original key; catalog checkout conflicts refresh the price and require another deliberate checkout attempt.

All 68 frontend tests passed, covering rapid edits during slow creation/PATCH, stale response protection, invalid counts, empty-draft cancellation, timed-out creation recovery, version-conflict recovery, checkout locking and automatic catalog repricing. The production build passed without budget warnings (approximately 298 kB initial bundle).

A real browser flow held the creation response while a second item was added, then confirmed totals of USD 9.00 and 13.50, serialized draft versions 0–3, and location/tender behavior. Desktop 1440 px and mobile 375/320 px screenshots were inspected without horizontal overflow or runtime errors. The test draft `bd2d8a80-9f7b-4202-a0e5-cd6408184c4c` was cancelled by removing its last item; no checkout or stock consumption was dispatched. Evidence: `output/playwright/pos-auto-pricing-{1440,375,320}.png`.

## Human-readable records follow-up

Replaced visible UUID references and name fallbacks across operations, sales/POS, counts, product movement history and report tables. Known product/location names and frozen ingredient names resolve server error messages. Sale-linked operation details show their recorded items; normal delivery/receipt references and employee refund explanations are preserved. Missing records have explicit unavailable labels. Route/API/storage identities retain their original values.

All 73 frontend tests and the production build passed. Five new operation regressions verify visible names, retained link IDs, missing catalog/sale behavior, entered references and refund reasons. A read-only browser audit covered 29 routes plus the inventory report at 1440/375 px (60 rendered views), with no visible UUIDs, page overflow or runtime errors. Inspected evidence: `output/playwright/readable-{operation,sales}-{1440,375}.png`.
