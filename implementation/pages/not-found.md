# Redirect and not-found views

## Routes

The root `/` route redirects to `/inventory` without issuing a separate data call. A wildcard route renders a small Not Found page with a clear link back to `/inventory`. Do not add login, admin or reporting routes outside the documented scope.

For a syntactically valid `/products/:id` whose Product Service returns `PRODUCT_NOT_FOUND`, the Product detail page renders a product-not-found state using the same visual language and dashboard link. A malformed route ID or an unavailable upstream has its own error state; neither is labeled as a missing Product.

## Accessibility and acceptance

- [x] Unknown URLs have a meaningful page heading and keyboard-accessible return link.
- [x] `/` lands on the dashboard without a blank intermediate page.
- [x] A valid but unknown Product ID shows product-not-found; an upstream outage shows retry, not not-found.
