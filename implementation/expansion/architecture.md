# Expansion architecture and consistency

Status: implemented architectural direction and retained acceptance specification. The [phase tracker](phases-and-acceptance.md) and [requirement evidence map](requirement-evidence.md) distinguish implementation from proven behavior. Read the [current architecture](../../docs/architecture.md), [stock consistency specification](../architecture/stock-consistency.md) and later [cost valuation](../../docs/cost-reporting.md) alongside this document.

## Context ownership

| Process | Owns | Outgoing dependencies |
| --- | --- | --- |
| Angular | View state, forms, recoverable command identity | BFF HTTP only |
| BFF | Transport validation, forwarding, server-provided display projections | Product, Inventory and Sales HTTP |
| Product Service | Ingredient catalog, menu catalog, recipe revisions and price configuration | `stockflow_product` only |
| Inventory Service | Locations, supplier references, location balances, receiving, transfers, waste, counts, replenishment rules, stock-operation results and outbox | Product HTTP, `stockflow_inventory`, NATS |
| Sales Service, new | Sale drafts, frozen checkout snapshots, checkout recovery, receipts, refund/correction records and Sales outbox | Product HTTP, Inventory HTTP, `stockflow_sales`, NATS |
| Audit worker | Validated, deduplicated Inventory and Sales event records | NATS and `stockflow_audit` only |

Product remains the catalog context: a stocked ingredient and a sellable menu item are different entities. Recipes define how a menu item uses ingredients; Product never changes stock. Inventory owns the validity and commit of the ingredient bundle. Sales owns sale lifecycle, price calculation and recovery.

Inventory owns minimal supplier references because they are metadata for receiving, not a new purchasing domain. Reports query their data owners. BFF may combine summaries but must not implement financial totals, stock adjustment rules, checkout orchestration or CSV calculations that belong in the services.

## Process structure and dependency rules

Add `apps/sales-service` with the same `domain`, `application`, `infrastructure`, `presentation` folders, outer NestJS module and bootstrap as the existing business services. Use its own MongoDB database; proposed local port is 3003, configurable and checked for availability. Keep the five existing processes.

Domain objects remain plain TypeScript. Application ports describe capabilities; infrastructure implements them; controllers validate and map transport data. No domain imports NestJS, MongoDB, NATS, Angular or `packages/contracts`. Keep existing transport mapping patterns at the outer/application boundary rather than sharing domain entities between services.

Extend `check:boundaries` to Sales and verify forbidden cross-service imports. Keep `packages/contracts` limited to DTOs and integration-event envelopes. `packages/primitives` may continue to provide pure numeric/UUID utilities; shared executable business policies do not belong there.

| Owner | Planned domain/use cases | Planned ports/adapters |
| --- | --- | --- |
| Product | `EditProduct`, `ArchiveProduct`, `MenuItem`, `RecipeRevision`, `PublishMenuRevision` | Product/menu/recipe repositories; Mongo catalog adapters |
| Inventory | Location, stock-operation planner, `ReceiveDelivery`, `TransferStock`, `RecordWaste`, `ApplyStockCount`, `ConsumeSaleIngredients`, `ReturnSaleIngredients`, replenishment query | Product catalog, stock-operation store/unit of work, location/document repositories, event publisher; Mongo/HTTP/JetStream adapters |
| Sales | Sale and refund state machines, integer-money pricing, `PrepareCheckout`, `ResolveCheckout`, `PrepareRefund`, `ResolveRefund` | Catalog snapshot, inventory operations, sale/refund unit of work, outbox repository/event publisher; HTTP/Mongo/JetStream adapters |
| Audit | Event validation and deduplicated persistence | Existing audit port extended for versioned event families; Mongo/JetStream adapters |

## Inventory: one transaction for the whole operation

Change balance identity from `productId` to `(productId, locationId)`. Preserve integer milliunits, maximum balance checks and nonnegative stock. Each compound command has a stable operation ID, an idempotency key, a normalized payload fingerprint, and a stored terminal result.

Generalized stock-operation sequence:

1. Validate receiving-boundary DTOs and normalize UUIDs, quantities, reasons and duplicate product lines.
2. Replay the stored command before making fresh catalog lookups or checking changed balances. Different input with the same key is `IDEMPOTENCY_CONFLICT`.
3. Resolve required Product data through an application HTTP port before opening the local transaction. Product units stay immutable. Freeze the validated quantities/identities for this operation.
4. Load all affected location balances and relevant document versions. Sort balance identities consistently. Missing balances represent logical zero only for valid products and locations.
5. Run the domain operation over the complete bundle. Verify every withdrawal, addition, maximum and document-state invariant before committing.
6. In one Inventory transaction, conditionally update every balance, insert movement rows, finalize the receiving/transfer/waste/count document where applicable, store the command result, and insert movement event intents.
7. On a write conflict, abort, reload all affected state and rerun the complete domain operation with the existing bounded retry policy. Never retry one line independently.
8. Return only the committed outcome; the relay publishes after commit.

New durable compound commands also record definite business rejection outcomes without balance/movement/outbox effects. This lets a pending Sales workflow resolve `REJECTED` consistently after a restart. Transient infrastructure failures never become durable business rejections. The original v1 rejected add/remove contract remains unchanged.

### Operation invariants

- **Receiving:** every line adds to the chosen location. One invalid line means no line is received. A committed delivery is immutable; corrections are new referenced operations.
- **Transfer:** source and destination differ. Each product has one source removal and one destination addition under the same operation ID. All lines commit together, preserving restaurant-wide totals.
- **Waste:** a categorized removal; quantity remains positive in storage/API and reason is required. Reports distinguish waste from sales and transfers.
- **Count:** capture all selected quantities/versions and persist the count session in a short Inventory snapshot transaction at session creation. Application compares submitted expected versions to current state. Any changed counted balance rejects the entire apply as `COUNT_STALE`; the employee refreshes and recounts. Never silently overwrite intervening sales. Missing zero balances have an explicit expected-absence marker.
- **Count adjustment:** compute `counted − recorded` on the server. Positive difference creates ADD, negative difference REMOVE, zero difference creates no movement. The count is still finalized and replayable when every difference is zero.
- **Sale consumption:** combine repeated ingredients across menu items, then remove the complete bundle in one Inventory transaction. Insufficient stock for any ingredient rejects all ingredient removals.
- **Sale stock return:** explicitly restock selected sold item quantities using the original recipe snapshot. Enforce cumulative returned quantities against the original consumption allocation, including rounding-free milliunit totals. Return to the original consumption location in this release.

Add `cause` and `operationId` to movement metadata while retaining `type = ADD | REMOVE`. Causes include `MANUAL`, `RECEIPT`, `TRANSFER`, `WASTE`, `COUNT`, `SALE`, `SALE_RETURN`. Never infer cause from human-entered reason text. Transfers are excluded from restaurant-wide consumption and purchasing totals.

## Catalog and numeric semantics

- Existing ingredient base-unit strings remain immutable. Recipe inputs use those exact units, e.g. `0.018 kg` coffee and `0.200 L` milk; do not invent conversions for arbitrary unit strings.
- Sold menu-item counts are positive integers. Recipe ingredient quantities are positive integer milliunits per item. Multiplication and aggregation use checked integer arithmetic; reject overflow or balance-limit violations.
- Publish immutable recipe revisions. Editing produces a new revision; old sale snapshots retain the original recipe, item name, ingredient labels/units, price and revision ID.
- Choose one configured currency for the release with two fractional digits; store price/total/refund amounts as checked integer minor units. Sales calculates totals and returns them to the UI. No float currency arithmetic or client-authoritative totals.
- Archive rather than hard-delete. Archived products remain readable for history, stock depletion, count reconciliation and explicit returns; exclude them from new receipts and new menu configurations. Existing prepared checkouts retain their frozen catalog snapshot. New checkouts validate active menu/ingredient configuration.
- Locations can be renamed, but remain available in this release. Location archival is deferred because pending checkout/counts and later returns require a separate lifecycle contract.

## Checkout: recoverable local transactions, HTTP between owners

Do not move Sales rules into BFF or claim a MongoDB transaction spans Sales and Inventory. Use a small persistent application coordinator inside Sales, not an additional workflow framework.

States: `DRAFT → CHECKOUT_PENDING → COMPLETED | REJECTED`; `DRAFT → CANCELLED`. A rejected attempt can return to an editable draft only through a deliberate new attempt with a fresh command identity. The previous attempt remains recorded.

1. Draft create/edit obtains a server-priced Product catalog snapshot and returns the reviewed total, recipe/catalog revisions and draft version. Angular submits checkout with that expected reviewed draft version, location and tender label under a stable checkout idempotency key. Sales checks current menu availability/revisions through Product HTTP; a changed recipe/price requires renewed review rather than silently charging a different total. Client prices and ingredient lists are never trusted. Once preparation persists the approved snapshot, later catalog changes cannot alter that attempt.
2. In a Sales transaction, persist the immutable priced cart, combined ingredient allocation, inventory operation ID, command fingerprint, tender label and `CHECKOUT_PENDING` attempt before contacting Inventory.
3. Sales calls Inventory's internal consume operation using that exact stored ingredient bundle and operation identity. Inventory alone validates stock and atomically commits its local bundle.
4. On confirmed commit, a Sales transaction marks the attempt/sale `COMPLETED`, allocates an immutable unique receipt reference, stores the original response for replay and inserts a `SaleCompleted` outbox event.
5. On a definite recorded Inventory rejection, mark the Sales attempt `REJECTED`; no completed sale or receipt is created. Return an actionable error with the relevant ingredient shortages.
6. On timeout or uncertain result, keep `CHECKOUT_PENDING` and return an accepted/pending response. Angular follows the sale status rather than creating a new checkout.
7. A Sales recovery provider scans persisted pending attempts after startup and at a bounded interval. It checks Inventory operation status and, if unresolved, retries the exact command with its original key. Absence of an operation is not proof that an in-flight request failed; safe retry uses the same key.
8. If Inventory committed but Sales crashed before finalizing, recovery retrieves the committed operation and finalizes the sale once. Receipt uniqueness, state/version checks and idempotency prevent duplicate completion events.

Pending checkout cannot be edited, cancelled, refunded or submitted with different content. Do not automatically release ingredient stock because an HTTP response timed out. A draft does not reserve stock, so shortages are checked at commit. Server recovery persists beyond the browser tab; UI session storage retains the command/sale identity across refresh and navigation.

The application may temporarily have committed ingredient consumption with a pending sale; this is an explicit recoverable state. It must never display that state as completed or failed without resolving the owner-service outcome.

## Refunds and stock corrections

Sales owns partial/full refund records, required explanation, refund item quantities and amount calculated from the original price snapshot. A refund records a manual cash/card adjustment; it does not contact a payment processor.

- Serialize corrections against the sale version. Total refunded item quantities/money cannot exceed the completed sale, including pending corrections.
- Default prepared-food refunds to `restock = false`. Refunding a spilled or consumed drink does not restore coffee/milk.
- A no-restock refund commits refund record, updated refundable quantities and `SaleRefunded` outbox in one Sales transaction.
- A restock refund first persists a frozen `REFUND_PENDING` record and stable Inventory return operation identity. Call Inventory with the original allocation, then finalize after confirmed return. Uncertain outcomes use the same recovery mechanism as checkout.
- Refund states are `REFUND_PENDING → COMPLETED | REJECTED`. A definite Inventory return rejection marks the correction rejected and releases its pending refundable-quantity allocation in a Sales transaction; it does not record a completed refund. Transient failures retain the allocation and original operation identity until resolved.
- In this release, each correction declares sold item quantities and a single restock choice. Do not mix monetary goodwill adjustments, ingredient substitutions or arbitrary return locations into this contract.
- Pending corrections block overlapping sale corrections until resolved. Never edit/delete the original sale or movement.

## Messaging and audit compatibility

Keep synchronous commands on HTTP. Extend Inventory's transactional outbox and stable event ID mechanism for every new stock movement. Inventory events retain subjects `inventory.stock.added` / `inventory.stock.removed` and the existing `STOCK_EVENTS` WorkQueue stream and `stock-audit` durable consumer.

Introduce stock event schema v2 containing the v1 fields plus `locationId`, `operationId` and `cause`. Deploy the audit parser supporting both v1 and v2 before producing v2. The current parser rejects extra fields and unknown versions, so adding fields without this step would strand messages. Keep already stored pending v1 outbox payloads unchanged, and continue reading stored v1 audit records.

Sales uses its own transactional outbox, `SALES_EVENTS` WorkQueue stream with `sales.sale.*` subjects, and one `sales-audit` durable consumer processed by the existing audit worker. Audit persists the new Sales event family separately from stock records. Each publisher waits for PubAck before marking published; each consumer acknowledges only after an identical event has been durably recorded. A repeated ID with changed payload remains a contract violation.

Do not attach a second overlapping consumer to `STOCK_EVENTS`: WorkQueue retention is not a general broadcast subscription. Reports query owning services; Sales checkout recovery queries Inventory HTTP. Resource setup must preserve retained messages and refuse incompatible configuration without deleting streams.

No zero-quantity stock event is emitted for an unchanged physical count. The immutable count document is its operation record. Sale/refund events represent terminal Sales commits; pending or rejected checkouts do not emit `SaleCompleted`.

## Migration and compatibility strategy

The actual implementation currently has a unique inventory `productId` index and a unique movement `idempotencyKey` index. Both need deliberate evolution for locations and multi-line operations.

1. Record baseline quantities, movements, command replay results, pending outbox and audit counts. Verify a recoverable backup on a copy before cutover.
2. Upgrade Audit for both stock versions. Pause mutating entrypoints and stop old Inventory writers before migrating; the old adapter cannot safely run against the new schema/indexes.
3. Create one stable default location, `Main Store`, and assign every legacy balance/movement to it. Persist migration version and mapping; rerunning must preserve IDs, quantities and historical timestamps.
4. Backfill `stock_commands` from legacy movements, retaining each exact original command/result for legacy replay. Preserve legacy pending browser commands and map missing location to the default.
5. Add the unique compound balance index and command-key index. Replace the movement-level globally unique command-key index only after command-record coverage is proved; add unique `(operationId, lineId)` instead. Generate deterministic legacy operation/line mappings.
6. Keep legacy add/remove/list/detail routes pointing to Main Store and preserving v1 response shapes. New `/api/stock` routes expose explicit location/aggregate views. The updated UI uses the new routes after migration.
7. Rerun the original 0 → 50 → 40 → rejected 50 scenario and original successful idempotency replay checks, including a command saved before migration. Verify pending v1 audit events drain without conversion.
8. Resume writers only after migration/version guards and all compatibility checks pass. Before new writes, rollback can restore the baseline with the old binaries. After new location/sales writes, require a forward repair or a coordinated restore of all affected databases; never silently discard new operations or run the old adapter against the expanded schema.

Every service owns its migration and schema guard. No normal application process reads another owner's database. The operator migration/check scripts follow the same explicit setup/verification role as the existing project scripts.
