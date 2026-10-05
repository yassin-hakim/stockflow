# Stock action components

These are two separate forms embedded in the [Product detail page](product-detail.md), not separate routes. They issue the only frontend stock mutations: `POST /api/inventory/:productId/add` and `POST /api/inventory/:productId/remove`.

## Inputs and presentation

Each form has labeled Quantity and Reason fields, action-specific heading and button, inline validation, pending state and result/error region. Quantity must be a positive JSON number with at most three decimal places, between `0.001` and `1,000,000,000.000` product units. Reason is trimmed, required and 1–200 characters. Display the current Product unit next to the quantity input. Client-side validation assists the employee; Inventory domain validation remains authoritative.

Do not make a client-side “enough stock” decision that could race another request. The Remove form may explain the displayed balance, but still relies on the server’s `INSUFFICIENT_STOCK` response. Neither form optimistically updates the balance. Disable both submit buttons while either stock action is pending, and clearly identify which request is running.

## Idempotency and uncertain results

Generate a UUID `Idempotency-Key` when the employee initiates a new intended action and send it as a header. Keep that key paired with the normalized product ID, action, quantity and reason. If the request times out or connectivity fails before the outcome is known, preserve the inputs and key for a manual retry of the same command. Before accepting changed inputs as a new action, refresh overview/history and make the uncertain earlier result visible so the employee can reconcile it; then generate a new key for the new command. After confirmed success, clear that form, retire the key, announce the committed result, and refresh overview/history. A new button click after success is a new action with a new key.

An exact server replay may return the original committed quantity even if a later action changed the current balance. Display the returned movement as confirmation, then refetch the overview to show the latest value. If the API returns `IDEMPOTENCY_CONFLICT`, explain that the key was used for different input, generate a fresh key only for a new intentional submission, and do not auto-resubmit. If the API returns `INSUFFICIENT_STOCK`, retain the remove inputs and refresh balance. Other recoverable errors retain values and permit Retry.

## Acceptance

- [x] Each action uses the correct BFF route, reason/quantity body and UUID key header.
- [x] Two rapid clicks during one pending request cause one HTTP command.
- [x] A timeout followed by Retry uses the same key and creates one movement.
- [x] Changing input after an uncertain result changes the key, with no silent retry of the old command.
- [x] Insufficient removal leaves balance/history unchanged and shows a readable error.
