# Receiving costs, pagination and gross profit

The receiving form records a required cost per product base unit, in the configured currency. For example, receiving 2 kg at USD 10/kg records quantity `2` and `unitCostMinor: 1000`. Decimal currency inputs support two places; quantities retain the existing three-place precision. An explicit zero means free stock. Saved uncertain requests retain their original cost and request key.

Inventory owns costing. Receipts increase the carrying value of the product/location balance; consumption removes the proportional moving-average value. Integer arithmetic rounds half up to minor units. Transfers carry the source value to the destination without changing restaurant value. Depleting a balance resets its carrying value to zero. Count adjustments use the current average when available. Unpriced additions make the remaining balance's value unknown.

Weighted-average costing and recognizing inventory cost alongside the related sale follow the concepts described in [IAS 2's official summary](https://www.ifrs.org/issued-standards/list-of-standards/ias-2-inventories/). This application implements operational gross-profit reporting, not a complete accounting ledger or an IFRS compliance claim.

Each Inventory movement records its cost alongside the quantity, operation, command identity and outbox event in the same transaction. Completed Sales records retain the ingredient-cost snapshot. Later purchases or recipe changes cannot reprice completed sales. Restocked refunds restore the original sale's cost; cumulative rounding ensures splitting returns does not create or lose cents. Refunds without returned stock reverse revenue without reversing consumed ingredient cost.

Reports → **Profit & loss (gross profit)** shows gross sales, refunds, net sales, ingredient costs and gross profit. Filters use the existing included-from/excluded-until period and optional location. Records follow completed sales/refund timestamps. Draft, pending and rejected transactions are excluded. Operating expenses and waste expense are outside this requested gross-profit report. Gross profit = net sales − consumed ingredient costs, with actual stock-return costs reversed. Transfers and purchases are not expensed immediately.

Historical stock without receiving costs stays unknown. Such records show **Unrecorded**, ingredient totals show **Incomplete**, and gross profit shows **Unavailable**, with a separate known-cost subtotal and missing-record count. An old missing price is never treated as zero. Costs become known again when unknown stock is completely depleted and new stock is received with prices. No historical values are backfilled or guessed.

`CURRENCY` must match across Product, Inventory and Sales (default `USD`). New inventory operations retain their currency. Valued balances reject incompatible currency changes; no currency conversion is attempted. Legacy costs predating the currency field use USD.

## API

- `GET /api/receiving-config` returns Inventory's configured currency.
- `POST /api/receipts` accepts optional `unitCostMinor` on each line for backward compatibility; the new form requires a cost. Cost is a nonnegative safe integer and part of idempotency identity. Duplicate product lines must use the same cost.
- Stock-operation responses include `currency`, `costMinor`, movement `costMinor`, and receipt `receivedLines` with quantities and base-unit costs.
- `GET /api/reports/profit-loss?from=...&to=...&locationId=...&limit=...&cursor=...` returns full-period totals plus a cursor page. Missing cost totals are null rather than invented.
- `GET /api/reports/profit-loss/export` exports the applied period, location, all matching records, and full-period totals. Location and ingredient names are human readable; numeric negative amounts remain numeric CSV cells. Text cells are protected from spreadsheet formula interpretation.

P&L and CSV are limited to 10,000 matching completed sales/refund records; narrow the period or location if exceeded. Mongo provides a bounded full-period read. New cost snapshots need no per-row Inventory call; legacy rows use their immutable Inventory operation. Unavailable legacy source records fail the report explicitly.

## Pagination

Shared accessible Previous/Next controls and 10/25/50 row sizes cover inventory, locations, suppliers, menu, POS catalog, replenishment, operations, physical counts, count ingredient selection, sales, refund history, product movements, and reports. Desktop tables and mobile records use the same slice. Catalog lists paginate the existing complete lookup arrays; histories fetch additional owner cursor pages as needed and cache them for Previous. Changing page size fills the requested page across cursor boundaries. Searches, filters and scope reloads reset pagination. Sales cursor requests remain tied to the applied filters, even when input fields have unsubmitted edits. Transaction entry lines and the active POS cart remain visible together.

Report summaries always cover the complete applied period; changing the displayed page does not change totals or CSV scope. Product totals in Inventory reports have independent pagination.

## Verification

`npm test` exercises moving-average costs, source-before-destination transfer valuation, unknown costs, original-cost split returns, precision rejection, cost-sensitive retry identity, and paged gross-profit/refund calculations. Frontend tests cover cursor-boundary navigation, failed fetches, filtering, and incomplete-cost report rendering.

Run `npx tsx scripts/verify-cost-reporting.ts` against the local services for isolated receiving → transfer → sale → later receiving → both refund choices → P&L pages → CSV checks. It creates clearly named verification records and writes their details to `output/verification/cost-reporting.json`.

The browser checks exercised all main paginated screens at 1440px and 375px, required receiving costs, persisted costs in operation history, gross-profit values and CSV download. Screenshots are in `output/playwright/pagination-inventory-*.png`, `receiving-cost-*.png`, and `profit-loss-*.png`.
