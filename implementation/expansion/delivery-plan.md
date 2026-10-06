# Complete-app delivery plan

This is the execution guide for the warehouse and POS expansion. Read the [detailed phase tracker](phases-and-acceptance.md) for implementation and acceptance checklists. Implementation progress and observed results belong in [verification.md](verification.md); this plan does not certify a finished release.

## Product direction

Build one restaurant operations app with a simple warehouse workflow and recipe-based POS. An employee should be able to receive ingredients, move them to the bar or kitchen, sell menu items, record waste, reconcile physical counts, and see what needs replenishment. Each action leaves a persistent reference and understandable history.

Keep the existing app and extend its boundaries:

| Existing boundary | Expansion responsibility |
| --- | --- |
| Angular frontend | Inventory, warehouse operation forms, menu editor, POS, receipts, history and reports |
| NestJS BFF | One public `/api` surface, request validation, forwarding and display projections |
| Product Service | Ingredient catalog, SKU/archive/edit, menu items, prices and immutable recipe revisions |
| Inventory Service | Locations, balances, receiving, transfers, waste, counts, replenishment and atomic ingredient deductions/returns |
| New Sales Service | Sale drafts, reviewed totals, checkout recovery, receipts and refunds |
| Audit Worker | Deduplicated committed Inventory and Sales events |

Use the same Angular, NestJS, MongoDB, NATS JetStream, npm workspace, DDD and hexagonal patterns. Each service owns its database. Angular calls only the BFF; the BFF does not orchestrate checkout or decide stock validity.

## Delivery sequence

### 1. Establish compatibility and improve the catalog — E01–E02

Agree on the expanded contracts and preserve the original stock scenario. Add product edits, unique optional SKU, search/filter behavior and archival. Keep product units immutable and keep archived history readable.

Deliver through the existing Product domain, application repository ports, Mongo adapter and HTTP controller, then BFF and Angular product pages. Add conditional version checks for edits.

Acceptance: original APIs still work; an edit cannot change the unit or balance; conflicting SKUs and stale edits fail clearly; archival preserves movements and prevents new operational selection.

### 2. Add storage locations safely — E03

Introduce Main Store, Kitchen and Bar as locations within one restaurant. Change balance identity to `(productId, locationId)`. Add per-location inventory and an explicitly labeled restaurant total view.

Before new writes, migrate existing balances and movements into Main Store without changing quantities, identifiers, historical times or replay results. Add a command registry so one idempotent command can create several movements. Extend Audit for versioned stock events.

Acceptance: migration is repeatable; old saved commands still resolve; aggregate stock equals the location sums; concurrent writes cannot overdraw or lose additions.

### 3. Deliver receiving and transfers — E04

Receive multi-line deliveries with a delivery reference and optional simple supplier reference. Transfer several ingredients between locations with a reason. Supply operation history/detail and recovery after an uncertain response.

Inventory owns the complete transaction: all affected balances, movements, operation result and outbox records commit together. A transfer debits its source and credits its destination in the same transaction.

Acceptance: receipt replay adds stock once; transfer totals are conserved; one insufficient line or failed write leaves every line unchanged; refresh/retry retains the original command key.

### 4. Deliver waste, counts and replenishment — E05–E06

Record categorized waste separately from sales and transfers. Snapshot a physical count, enter quantities, review differences and apply once. Configure per-location low thresholds and target quantities, then show actionable replenishment quantities.

Counts compare the snapshot balance versions before applying adjustments. An untouched count field is unentered; an explicit zero is valid. Inventory calculates differences and replenishment suggestions; BFF supplies stock status projections.

Acceptance: intervening stock movement rejects a stale count; all count adjustments commit together; waste cannot overdraw; missing targets prompt configuration; stock in another location cannot hide a local shortage.

Milestone demo: receive → transfer → waste → count → replenish, entirely through Angular.

### 5. Deliver menu items and recipes — E07

Extend Product with sellable menu items and immutable recipe revisions. Store ingredient quantities in their existing base units and prices in integer minor units with one configured currency. Add menu list/editor/archive flows.

Acceptance: a latte recipe of `0.018 kg` coffee and `0.200 L` milk preserves that precision; changing the recipe leaves historical revisions intact; invalid or archived ingredient configuration cannot be published for new sales.

### 6. Deliver recoverable checkout and POS — E08–E09

Add one Sales workspace using the existing four-layer service structure and a Sales-owned MongoDB database. Implement owner-priced sale drafts, expected-version review, frozen checkout snapshots, persistent workflow state and receipts. Add the Angular POS with menu selection, integer item counts, consumption location, cash/card tender label and browser-print receipt.

Checkout sequence:

1. Sales validates the reviewed draft and freezes its prices and recipe quantities.
2. Sales persists a checkout intent with a stable Inventory operation ID before dispatch.
3. Inventory atomically consumes the complete ingredient bundle using that ID.
4. Sales records the terminal result and creates one receipt/completion event after confirmed consumption.
5. A recovery worker resolves persisted pending attempts after timeout or restart using the same operation ID.

There is no cross-database transaction. Expose `CHECKOUT_PENDING` until the outcome is known. NATS audit delivery is asynchronous and does not determine checkout success.

Acceptance: three lattes consume exactly `0.054 kg` coffee and `0.600 L` milk; insufficient milk deducts neither ingredient; duplicate checkout cannot duplicate consumption; a restart after Inventory commit produces one completed sale and one receipt.

### 7. Deliver sale history and corrections — E10

Add sale list/detail, draft cancellation, partial/full recorded refunds and correction history. Default refunds to no stock return; offer deliberate restock only for ingredients actually returned.

Sales derives the refund amount from original sold prices. Inventory derives returned ingredients from the original consumption allocation. Both contexts prevent cumulative quantities from exceeding the original sale, including concurrent requests.

Acceptance: recipe edits do not change historical refund/restock amounts; refunds never exceed sold quantities; retry/restart does not duplicate a correction or return.

Milestone demo: menu → reviewed sale → ingredient deduction → receipt → history → refund.

### 8. Deliver reports and complete the handoff — E11–E12

Provide date/location-filtered sales, refunds/net sales, ingredient consumption, waste, transfers and count differences. Add bounded pagination and CSV export using the same applied filters. Keep quantity totals separated by product and unit.

Update setup/configuration, service scripts, API/event documentation and the reviewer walkthrough. Verify existing-data migration and fresh setup separately. Inspect real persistence, concurrency, broker recovery, pending command recovery, mobile/keyboard flows and receipt printing.

Acceptance: every release feature has a working UI, owner API, persistence, useful error/recovery behavior and recorded end-to-end evidence. All original stock guarantees still pass.

## Work each slice the same way as the existing build

For every feature, follow:

`Contract and page specification → pure domain rules → application use cases and ports → infrastructure adapters → NestJS controller → thin BFF → Angular → real acceptance scenario → documentation/evidence`

Domain code stays framework-free. Application code uses service-owned ports. MongoDB, HTTP and NATS remain infrastructure adapters. Shared packages contain transport contracts and pure primitives, rather than shared business entities. Extend existing components and styles before introducing a new UI pattern.

Run tests that verify the feature's risks: stock transaction rollback, concurrent consumption, immutable snapshots, stale edits/counts and uncertain outcomes. A build alone does not complete a phase. Finish each usable slice before moving to the next milestone.

## Interview walkthrough

The [full acceptance scenario](phases-and-acceptance.md#final-interview-acceptance-scenario) connects every module: receive `20 kg` coffee / `10 L` milk, transfer to Bar, sell three lattes, record waste, reconcile counts, show replenishment, reject an insufficient-stock sale, and record a refund. Show the linked documents, movements and audit trail while explaining service ownership and recovery.

## Release boundary

Include simple supplier references and recorded tender labels. Defer payment gateways, tills, authentication/permissions, purchase orders, expiry batches, cost accounting, offline checkout, printer hardware and multiple restaurants. Avoid placeholder routes for deferred features. Production migration and deployment require a separate execution decision.
