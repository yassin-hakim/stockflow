# Create Product page

## Route and purpose

Implement `/products/new` as the small product form needed for the first demo step. It calls `POST /api/products` through the BFF and navigates to `/products/:id` after a confirmed `201` response. Product Service is the only data owner; this page does not create a physical Inventory record.

## Form fields and behavior

| Field | Input and validation |
| --- | --- |
| Name | Required, trim whitespace, 1–100 characters; demo value `Arabica Coffee` |
| Unit | Required, trim whitespace, 1–20 characters; e.g. `kg`, `L`, `pcs` |
| Category | Required, trim whitespace, 1–80 characters; demo value `Coffee` |
| Low-stock threshold | Optional numeric input, default `0`, 0–`1,000,000,000.000`, at most three decimals |

Use a typed Angular reactive form. Labels remain visible; helper text explains that the threshold marks positive stock as LOW at or below its value and zero stock is OUT. A zero threshold disables the LOW state for positive balances. Inline validation runs before submit, but the BFF/Product Service still validate and return the authoritative response. Reject extra fields rather than sending view-only data.

Disable Save while the request is pending and show an announced success/error message. On validation response errors, preserve all entered values and focus the error summary or first invalid field. On a network timeout, do not automatically issue a second `POST /api/products`; show a retry choice after checking the product list or explaining that the previous result is uncertain. The initial design does not provide product-create idempotency, so avoid a blind automatic retry. A Cancel link returns to `/inventory` without mutation.

## Resulting state

After success, navigate to the new product detail route. Its overview shows `0 <unit>` and `OUT`, and movement history is empty. This zero is a BFF projection of a valid Product with no Inventory row, not a Product Service stock field. No event is published for product creation in v1.

## Acceptance

- [x] A valid product posts only to `/api/products`, receives `201`, and opens its detail page.
- [x] Required fields, lengths and threshold precision/range are enforced and accessible.
- [x] Omitted threshold becomes zero in the response and dashboard behavior.
- [x] Pending state blocks duplicate clicks; errors preserve form values.
- [x] Product creation leaves Inventory and audit collections unchanged.
