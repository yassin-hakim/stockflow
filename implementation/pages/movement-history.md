# Movement history component

This component is part of the [Product detail page](product-detail.md) and reads `GET /api/inventory/:productId/movements` from the BFF. The Inventory Service owns the records; Angular only presents them.

## Rendering

Show Date, Type, Quantity and Reason in the API's newest-first order, using ID as the server tie-breaker. Format UTC `createdAt` in the browser’s local time while preserving the original timestamp in data. `ADD` is shown with a `+` sign and `REMOVE` with a `−` sign; the API `quantity` is positive for both. Append the Product unit without converting it. Text must convey add/remove even if colors are unavailable.

At widths 768 px and above, use a semantic table with headers. Below 768 px, use a labeled list/card representation with the same information. An empty successful response displays “No stock movements yet.” A failed request displays a retry control and must not look like an empty history. Loading is announced without replacing a valid stock summary elsewhere on the page.

## Refresh and boundaries

Refresh after a confirmed add/remove command and on explicit Retry. The component receives `productId` and Product unit from the page and does not call Product Service itself. It must not derive current balance by summing visible movements; the overview is authoritative. V1 returns the full list for this small demo, with no pagination control.

## Acceptance

## Expanded history

The current page uses cursor-based `/api/stock/:productId/movements` with selected location, optional purpose, and optional UTC half-open date bounds. Date inputs use browser-local wall time and reject invalid or reversed periods before requesting a page. Apply filters resets the displayed page. Cursor requests retain the applied filters while the employee edits the next search. Previous pages stay cached; 10/25/50-row controls paginate the list. Desktop tables and equivalent mobile lists use the shared 700/701 px breakpoint.

- [x] The 50 kg ADD and 10 kg REMOVE demo displays `+50 kg` and `−10 kg` in newest-first order with reasons.
- [x] A rejected removal adds no row.
- [x] Empty, loading and failure states are distinct and keyboard accessible.
- [x] UTC timestamps display in local time without changing stored/API values.
