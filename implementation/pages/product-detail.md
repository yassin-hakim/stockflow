# Product detail page

## Route and purpose

Implement `/products/:id` as the focused view for one product. It shows product identity and current stock, hosts separate add/remove forms, and displays movement history. See the dedicated [stock actions](stock-actions.md) and [movement history](movement-history.md) component specs.

## Data loading

On entry, validate the route ID and request `GET /api/inventory/:productId` and `GET /api/inventory/:productId/movements`. The first response includes Product, quantity and status; the second contains ordered movements. Both calls go to the BFF. A known Product with no Inventory row shows zero stock and an empty history. An unknown Product ID shows a not-found state with a link back to the dashboard. Do not infer “not found” from a timeout or service outage.

Show the product name as the page heading, category and unit as supporting information, then an explicit `quantity + unit` and text status. The threshold can be displayed as reference information from Product but is not recalculated in Angular. On wide screens, place add/remove forms in two columns and history below; on narrow screens stack all sections without horizontal overflow.

The overview and movement requests have independent loading/error presentation: if movement history fails, the current stock can remain visible with a retry control in the history section; if the overview fails, disable stock forms until a valid Product and balance are known. Do not present a failed overview as zero. A Back to Inventory link is always available.

## Post-action refresh

After a confirmed stock command, announce the committed quantity from `StockChangeResult`, then refetch overview and movements. These reads may observe a later concurrent command; the overview is the latest displayed balance. The UI does not wait for the audit worker before reporting the command success. On `INSUFFICIENT_STOCK`, refresh overview, leave the user’s amount and reason in the remove form, and show the API error beside it.

## Acceptance

- [x] Direct navigation to a known new Product shows zero, OUT and empty history.
- [x] An unknown UUID gets a not-found state; malformed UUID gets a request error state; service failure gets retry, never false zero.
- [x] Add/remove results refresh overview and movements without optimistic balance changes.
- [x] Both forms and history work at 375 px and 1280 px, with keyboard focus and clear section headings.
