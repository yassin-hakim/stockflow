# Inventory dashboard page

## Route and purpose

Implement `/inventory` as the default landing page; `/` redirects here. It lets an employee view every product and its current stock, recognize `OUT`/`LOW`/`OK` status, open a product detail view, and reach product creation. The authoritative frontend behavior is in [docs/frontend.md](../../docs/frontend.md); the response contract is `GET /api/inventory` in [docs/api.md](../../docs/api.md).

## Data and composition

An `InventoryDashboardPage` requests the BFF inventory list on load and on explicit Retry. It renders `InventoryOverview[]` as returned; it does not fetch Product and Inventory services separately or recompute status. The BFF sorts case-insensitively by product name and then ID. Format quantity with up to three decimals and the Product unit (`50 kg`, `1.25 L`), without converting units. Each row/card links to `/products/:id`.

Use a semantic table at widths 768 px and above with Product, Category, Stock and Status headers. Under 768 px, render equivalent cards with all four fields and a clear Details action. A top header contains “Inventory” and a Create Product link to `/products/new`. Status badges include text and cannot rely on color alone. A zero quantity is shown as `0`, not a blank cell.

## View states

| State | Display and action |
| --- | --- |
| Loading | Heading and accessible loading message or skeleton; no stale zero claims |
| Empty success | “No products yet” plus Create Product action |
| Data success | Ordered table/cards with quantity, unit and status |
| Request failure | Error message and Retry button; never show failed inventory as zero |

The request lifecycle should cancel or ignore a stale response when the page is destroyed. The dashboard refreshes on navigation back from product creation or detail; no global state store is required. A 502/503 should display a service-availability message, while unexpected errors get a generic retry prompt.

## Acceptance

- [x] A newly created product appears at `0 <unit>` with `OUT` before an Inventory row exists.
- [x] Quantity and BFF-supplied `LOW`/`OK` status render without frontend threshold calculations.
- [x] Empty data, loading, failure and retry states are distinct.
- [x] Keyboard users can reach create and detail links; table/card content remains readable at 375 px and 1280 px.
- [x] Browser network inspection shows only the BFF `/api/inventory` request for dashboard data.
