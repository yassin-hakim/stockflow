# Phase 4 — Inventory core and atomic stock commands

## Goal and inputs

Deliver Inventory's business behavior, internal HTTP API, MongoDB persistence and pending event intent. This phase stops at a committed outbox row; Phase 5 connects the relay and audit worker. Use the [Inventory Service spec](../services/inventory-service.md), [stock consistency path](../architecture/stock-consistency.md), [domain rules](../../docs/domain.md), [API](../../docs/api.md), and [persistence](../../docs/persistence.md).

## Includes

Implement `Quantity` in integer thousandths, `InventoryItem.addStock` and `.removeStock`, StockMovement, `StockAdded` and `StockRemoved`, and errors for invalid quantity, overdraw and maximum balance. Build `AddStock`, `RemoveStock`, `ListInventory`, `GetInventory`, and `GetStockMovements` use cases. Ports include Inventory and movement reads, `ProductCatalog`, and `StockUnitOfWork`. The first add verifies Product through its API and creates Inventory from logical zero. First remove from an absent record returns `INSUFFICIENT_STOCK`; rejected commands produce no movement or event intent.

Use Inventory-owned `inventory`, `stock_movements` and `outbox` collections and all indexes in [docs/persistence.md](../../docs/persistence.md). A single MongoDB transaction inserts or version-updates the balance, inserts exactly one movement and inserts exactly one pending outbox row with stable event ID/envelope. The movement's unique idempotency key guards replay; exact replays return the original result, changed payloads fail, and concurrent first-insert or version conflicts reload and rerun the domain rule up to three attempts. Never publish to NATS inside the transaction.

Expose internal Inventory list/detail, add/remove and movement-history routes, plus health endpoints. List only physical balances; detail returns internal `INVENTORY_NOT_FOUND` for an absent row. History is newest first, with ID tie-breaker. Use the stable HTTP error envelope and `X-Request-ID`; keep `Idempotency-Key` unchanged. Readiness checks MongoDB, while NATS availability is a separate diagnostic so commands can commit during a broker outage.

## Implementation progress

- [x] Implement framework-independent Quantity, InventoryItem, Movement and domain event types with their invariants.
- [x] Implement Inventory use cases and service-specific ports; add `HttpProductCatalog` with not-found versus unavailable mapping.
- [x] Create indexes and MongoDB adapters for reads and the transactional `StockUnitOfWork`.
- [x] Add idempotency-key lookup/fingerprint comparison and original-result replay.
- [x] Add conditional version updates, first-insert race handling and bounded transaction retries.
- [x] Implement all five internal Inventory routes, validation, error mapping, liveness/readiness and diagnostics.
- [x] Add pure domain/use-case, HTTP and replica-set integration tests.

## Exit gates

- [x] Domain tests prove positive add/remove, `0.001` precision, rejection of zero/negative/over-precision amounts, insufficient stock and maximum balance.
- [x] First add to a known Product creates a balance; first remove from an absent balance rejects; unknown Product and unavailable Product Service remain distinct errors.
- [x] A valid command commits balance, one movement and one **pending** outbox event atomically; a forced transaction failure or rejected command leaves all three unchanged.
- [x] Replaying the same key/body returns the original result with no extra write; key reuse with changed input returns `IDEMPOTENCY_CONFLICT`.
- [x] Two concurrent 30 kg removals from 40 kg yield one success, one `INSUFFICIENT_STOCK`, final 10 kg, one new movement and one new pending event for those removal attempts.
- [x] Two concurrent additions to a Product with no Inventory row both commit, preserving the combined balance, two movements and two event intents.
- [x] Internal HTTP tests verify list/detail/history order, status/error contracts and no direct access to Product MongoDB.

**Handoff:** Phase 5 can publish committed outbox events without altering stock-command transaction semantics.
