# Domain-driven and hexagonal design

## Bounded contexts

**Product** defines what can be stocked. It owns product identity and descriptive data. **Inventory** defines stock balance, movements and stock business rules. Product has no method that changes inventory; Inventory never edits product details. The BFF assembles a read model for the dashboard but owns neither context.

### Product model

`Product`: `id`, `name`, `unit`, `category`, `lowStockThresholdMillis`, `createdAt`, `updatedAt`. Creation requires nonblank name, unit and category. Names and categories are trimmed; name is at most 100 characters, category at most 80, unit at most 20. Threshold is nonnegative, at most `1,000,000,000.000` units, and defaults to zero. Product identifiers are opaque UUIDs. There is no update or delete use case in the initial scope.

Use cases: `CreateProduct`, `ListProducts`, `GetProduct`. `ProductRepository` provides `insert`, `findAll`, and `findById`. The MongoDB implementation is private to Product Service. The BFF calls Product Service through HTTP; it does not share the repository.

### Inventory model

`InventoryItem`: `productId`, `quantityMillis`, `version`, `createdAt`, `updatedAt`. Domain methods `addStock(quantityMillis)` and `removeStock(quantityMillis)` return a new valid balance and a domain event. They reject amounts ≤ 0, resulting balance > `1,000,000,000,000` milliunits, and removals larger than the current balance. `StockMovement`: `id`, `productId`, `type` (`ADD`/`REMOVE`), `quantityMillis`, `reason`, `resultingQuantityMillis`, `idempotencyKey`, `createdAt`. `StockAdded` and `StockRemoved` are domain events created only for successful changes.

The value object `Quantity` converts a JSON numeric value into integer milliunits before invoking domain behavior. It accepts values that are multiples of `0.001` and range `0.001`–`1,000,000,000.000` for a change. JSON numeric spelling and trailing zeros do not matter; the conversion checks the scaled value against an integer within a small tolerance for binary number representation, then stores only the verified integer. The same maximum applies to a balance. API responses convert milliunits back to unit quantities with at most three decimal places. This keeps stock arithmetic exact without relying on binary floating-point addition.

Reasons are required, trimmed, and 1–200 characters. Duplicate `Idempotency-Key` with the same product, action, quantity and reason returns the originally committed movement and balance; a different command using the key fails with `IDEMPOTENCY_CONFLICT`. The key is checked at the application/persistence boundary, not in the InventoryItem entity.

## Invariants and error ownership

| Invariant or condition | Owner | Error/result |
| --- | --- | --- |
| Quantity is positive with at most three decimal places | `Quantity` value object; API also checks shape | `INVALID_QUANTITY` |
| Stock never becomes negative | `InventoryItem.removeStock` | `INSUFFICIENT_STOCK` |
| Balance never exceeds maximum | `InventoryItem.addStock` | `STOCK_LIMIT_EXCEEDED` |
| A valid change has one movement and one event intent | Stock use case transaction | Commit all three records or none |
| Product exists for first stock addition | Inventory application via `ProductCatalog` port | `PRODUCT_NOT_FOUND` |
| Repeated command does not change stock again | Application plus unique MongoDB index | Original result or `IDEMPOTENCY_CONFLICT` |

The HTTP layer translates these domain/application errors to the [API error envelope](api.md). MongoDB write conflicts and NATS transport details do not become domain errors.

## Application use cases and ports

| Use case | Reads/writes | Ports |
| --- | --- | --- |
| `AddStock` | Validate product when no inventory exists; load/retry current balance; commit inventory, movement and pending event | `ProductCatalog`, `StockUnitOfWork` |
| `RemoveStock` | Load/retry balance; reject overdraw; commit inventory, movement and pending event | `StockUnitOfWork` |
| `GetInventory` / `ListInventory` | Read stored balances; absence means logical zero to BFF | `InventoryRepository` |
| `GetStockMovements` | Read a product's movements newest first | `StockMovementRepository` |
| `PublishPendingEvents` | Publish outbox messages and mark acknowledged rows | `OutboxRepository`, `EventPublisher` |

`StockUnitOfWork` is an application port representing the atomic write of balance, movement and outbox intent. Its MongoDB adapter owns sessions, transactions and version-checked updates. `InventoryRepository` and `StockMovementRepository` are read ports. `ProductCatalog` is an HTTP adapter to Product Service. `EventPublisher` is implemented with the official NATS JavaScript client and JetStream publish acknowledgments. The audit worker has its own `AuditRepository` port and MongoDB adapter. Keep ports specific to each service; do not build a generic repository framework.

## Dependency direction

```text
HTTP controller / NATS handler (presentation)
                 ↓
Application use case → service-specific port
                 ↓                 ↑
           Domain model      MongoDB / HTTP / NATS adapter
```

Domain code may import other domain code and language utilities only. Application code may import domain and its own port interfaces, never NestJS, MongoDB or NATS packages. Infrastructure adapters may import the application ports and infrastructure libraries. NestJS modules wire concrete adapters to tokens. Test fakes implement ports without starting infrastructure.

## Cross-context and transaction boundaries

Product creation commits only Product Service data. On the first add, Inventory checks Product Service before starting its local MongoDB transaction; a product lookup failure aborts the command. No distributed transaction spans Product and Inventory. During inventory reads, the BFF joins products with existing balances; an absent balance displays as zero. Inventory transactions cover only Inventory-owned collections. The outbox turns a committed domain event into an eventual integration event; it does not make NATS part of the MongoDB transaction.

Read [architecture](architecture.md) for process placement, [persistence](persistence.md) for transaction mechanics, and [events](events.md) for the integration-event envelope.
