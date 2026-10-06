# Domain-driven and hexagonal design

## Bounded contexts

Product defines ingredients and sellable recipe configurations. Inventory owns every stock-changing decision. Sales owns priced orders and corrections. BFF composes frontend read models; Audit stores notifications without replacing owner histories.

### Product model

Product has UUID identity, trimmed name/category/unit, default threshold in milliunits, optional normalized SKU, version, archive timestamp and creation/update timestamps. Name/category/unit limits are 100/80/20 characters. SKU is uppercase, at most 50 characters, beginning with a letter or digit and containing letters, digits, dots, underscores or hyphens. An absent SKU has no uniqueness obligation. `ManageProduct` applies conditional edits/archive; base unit cannot change and archived ingredients retain historical reads.

`MenuCatalog` owns menu identity, nonnegative safe-integer minor-unit price, configured two-decimal currency, archive state and recipe revision. Recipes contain 1–100 positive base-unit ingredient lines. Product validates ingredient existence/active state, combines repeated ingredients with checked integer arithmetic, and stores name/unit snapshots. Creation stores revision 1; publishing conditionally replaces the current item and inserts an immutable revision in one Product transaction. Archived items cannot be republished. Historical revisions remain readable.

### Inventory model

Legacy `InventoryItem` and `StockUseCases` preserve add/remove behavior in Main Store. `OperationCommand`/`planOperation` handle `MANUAL`, `RECEIPT`, `TRANSFER`, `WASTE`, `COUNT`, `SALE` and `SALE_RETURN` across location balances. Quantity arithmetic uses integer thousandths; maximum quantity is 1,000,000,000 units (1,000,000,000,000 milliunits). Commands are positive except counts and thresholds/targets, which allow explicit zero.

Commands contain location(s), normalized lines, explanation, reference and immutable operation identity. Lines combine/sort before fingerprinting. A reused key with changed kind/location/input fails. Transfer decreases source and increases destination together, preserving totals. Receiving/manual addition rejects archived products. Waste requires category and explanation.

Count creation captures quantity and version/absence per selected product. Blank counted fields remain null; zero means physically none. Draft edits use expected count version. Apply requires every entry, verifies each captured balance version/absence and commits count state with all balances. A newly-created zero record differs from an absent record. Stale counts retain draft comparisons and require a fresh snapshot/recount. Unchanged count lines create no zero-quantity movements/events.

Location replenishment rules have nonnegative low threshold and target with target >= threshold. Inventory computes `max(0,target-current)` in milliunits when current <= threshold; otherwise suggestion is zero. Missing policy/target remains null. BFF supplies Product threshold fallback and labels; Angular never calculates the policy.

### Sales model

`SalesUseCases` prices drafts from Product snapshots. Counts are positive safe integers; price/count/ingredient multiplication is checked. A draft can be conditionally edited, cancelled before checkout, or prepared using reviewed version and `CASH`/`CARD` label. Tender records a choice; it does not process a payment.

Frozen attempts store original menu/recipe/price/ingredient snapshots, sale-line IDs and Inventory operation UUID. Catalog changes before prepare require review. Prepared retry/recovery uses the same snapshots. Completed receipts preserve original items, counts, prices, currency and total.

Refund quantities and money derive from original sold-line prices, bounded by cumulative completed corrections. No-restock refunds leave ingredients consumed. Chosen restock is a pending workflow; Inventory derives exact amounts from original per-item allocations and serializes cumulative returned counts on the original consumption record. Later recipes never reinterpret old returns.

## Invariants and error ownership

| Invariant | Owner | Result |
| --- | --- | --- |
| Immutable unit, unique SKU, conditional edit | Product | Rejection / `SKU_CONFLICT` / `VERSION_CONFLICT` |
| Published ingredients exist and are usable | Product | `INVALID_RECIPE` / ingredient/catalog errors |
| Nonnegative bounded stock and atomic bundle | Inventory | `INSUFFICIENT_STOCK` / `STOCK_LIMIT_EXCEEDED`; no partial stock write |
| Immutable global stock command identity | Inventory | Stored replay / `IDEMPOTENCY_CONFLICT` |
| Count snapshot still current, including absence | Inventory | `COUNT_STALE` |
| Suggested quantity or absent target | Inventory | Integer-derived value or null |
| Reviewed draft and frozen snapshots | Sales | Review/version conflict or recoverable pending |
| Bounded refund counts/money | Sales | `REFUND_LIMIT_EXCEEDED` |
| Bounded original stock allocations | Inventory | Return commit / `REFUND_LIMIT_EXCEEDED` |
| Immutable event UUID payload | Audit | Identical duplicate accepted; conflict unacknowledged |

## Application use cases and ports

| Context | Use cases | Service-owned ports |
| --- | --- | --- |
| Product | Create/List/Get/ManageProduct, MenuCatalog | ProductRepository, MenuRepository |
| Inventory | StockUseCases, StockOperations, Warehouses, InventoryManagement, PublishPendingEvents | StockStore/StockUnitOfWork, OperationStore, WarehouseRepository, InventoryManagementRepository, OperationCatalog, EventPublisher |
| Sales | SalesUseCases: draft, checkout/resolve, refund/resolve, recover | SalesStore/transaction, CatalogPort, InventoryPort |
| Audit | HandleStockEvent and Sales handling | AuditRepository |

## Dependency direction

Presentation invokes application use cases, which use domain behavior and service-specific ports. Infrastructure implements ports; NestJS modules compose them. Domain/application import no NestJS, MongoDB, NATS or frontend types. [Boundary checks](../scripts/check-boundaries.ts) cover all three business contexts. Shared transport DTOs do not become domain entities.

## Cross-context and transaction boundaries

Product lookups happen through HTTP. Each database transaction covers only its owner collections. Persisted intent precedes remote checkout/return dispatch, with explicit pending states and bounded recovery scans. MongoDB commits precede asynchronous outbox publication. See [persistence](persistence.md), [events](events.md), [architecture](architecture.md).
