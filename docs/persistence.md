# MongoDB persistence design

## Ownership and local topology

The MongoDB `rs0` replica set hosts four databases: Product `stockflow_product`, Inventory `stockflow_inventory`, Sales `stockflow_sales` and Audit `stockflow_audit`. Application code accesses only its owner database; BFF and Angular have no database credentials. A local single-node replica set enables transactions and is not a high-availability deployment.

## Collections and indexes

| Owner | Collections | Critical guards |
| --- | --- | --- |
| Product | `products` | UUID primary key, normalized non-null SKU uniqueness, archive/catalog fields |
| Product | `menu_items`, `recipe_revisions` | Current version; unique `(menuItemId,revision)` immutable snapshot; publication transaction |
| Inventory | `locations`, `inventory` | Unique normalized location name; unique `(productId,locationId)` and conditional balance version |
| Inventory | `stock_commands`, `stock_movements` | Global command-key identity and unique operation ID; unique `(operationId,lineId)`; product/location/cause/time indexes |
| Inventory | `receipts`, `transfers`, `waste_records`, `count_sessions`, `suppliers`, `replenishment_rules` | Command-linked IDs; count version/state; supplier normalized name; unique product/location policy |
| Inventory | `outbox`, `schema_metadata`, `migration_v1_inventory`, `migration_v1_movements` | Due-pending index; schema readiness; legacy migration copies |
| Sales | `sales`, `sales_commands`, `checkout_attempts`, `refunds`, `receipts`, `outbox`, `schema_versions` | Unique command/attempt/return IDs; unique receipt sale/reference; recovery and due-outbox indexes |
| Audit | `stock_events`, `sales_events` | Permanent event-UUID uniqueness; full-payload duplicate comparison |

Wire DTOs map `_id`/milliunits to named IDs/product quantities. Conditional catalog/count/rule versions are public for safe edits; driver/outbox details remain internal. Legacy movements and saved original results remain readable.

## Quantity representation

One unit is 1000 milliunits. Parsed numbers round-trip through integer scaling, allowing at most three decimals and at most 1,000,000,000 units per balance or command product total. No unit conversion occurs. Money uses separate safe-integer minor units; sold quantities are whole counts. Product and Sales use the same configured two-decimal currency.

## Atomic stock transaction

Inventory checks immutable key identity, plans every line, then atomically writes conditional balances, document/count state, nonzero movements, outbox rows and terminal command result. A conflict aborts the whole transaction; application reloads/replans up to three times. Transfers have paired movements. New business rejections may persist a rejected command result without a balance/movement/event mutation. Count apply commits count state and all affected balances together.

Returns read the original committed `SALE` operation in the transaction, validate derived quantities/location, and update cumulative returned sold-line counts there. That write serializes concurrent returns even for disjoint stock products. Excess return aborts all balance writes. Replay reads the original result without incrementing counts again.

## Sales local transactions and distributed recovery

Sales stores draft/command identity and frozen checkout attempt locally. Preparation writes `CHECKOUT_PENDING` before Inventory dispatch. Finalization records terminal attempt, sale, unique immutable receipt and event intent together. Refund preparation stores correction identity/intent; no-restock completion records cumulative counts and event intent locally. Chosen restock finalizes after Inventory outcome.

A crash between owner commits leaves a persistent pending attempt/refund. Restart recovery checks its original operation UUID, resends immutable input when needed, and finalizes once. Pending correction intent blocks overlap. MongoDB and NATS provide no cross-owner transaction.

## Inventory schema migration

Inventory requires `schema_metadata` Inventory version 2 in state `READY` before startup. Run the [operator migration](../scripts/migrate-inventory.ts) while Inventory/Sales writers are stopped:

```sh
npm run migrate:inventory
```

It creates Main Store ID `00000000-0000-4000-8000-000000000001`, copies legacy balances/movements into backup collections, assigns legacy balances to Main Store, backfills command replay and movement operation/line/location/cause metadata, replaces product-only and movement-key unique indexes with location/compound indexes, and marks schema ready. Existing IDs, timestamps, quantities, saved results and pending v1 outbox payloads are preserved. Repeating a ready migration does not duplicate data.

`MONGO_URI` selects the intended database; the script defaults to local `stockflow_inventory`. Test on a copy and inspect sums/IDs/replay first. Backup collections assist investigation; there is no automatic rollback command. After multi-location writes, restoring v1 cannot preserve the expanded state, so an in-place downgrade is unsupported. Fresh databases also require migration before Inventory startup. See [setup](operations.md).

## Read behavior

Legacy `/inventory` reads Main Store. New balances use location identity; the BFF location-free view sums locations. History pages sort by `(createdAt desc,id desc)` with opaque cursors. Reports group quantities per product/unit. Sales totals include committed completions/corrections in their own occurrence-time period and exclude pending/rejected states. Cross-owner reports are independent snapshots, not an atomic reporting instant.

## Failure and recovery

Product outage before validation leaves stock untouched. MongoDB abort rolls back balances/documents/movements/outbox together. Broker outage leaves committed HTTP outcomes intact and notifications pending. Audit failure leaves messages unacknowledged. Restore dependencies and resolve the original key/state; never replace an uncertain write's identity. See [operations](operations.md), [events](events.md), [testing](testing.md).


## Inventory and Sales cost snapshots

Inventory balances store `valueMinor` and `valueCurrency`; operation movements store `costMinor`, and new operation results retain currency. Completed sales and restocked refunds retain `ingredientCostMinor`. Undefined legacy values remain unknown. These fields are additive; existing quantities and records are preserved. See [cost reporting](cost-reporting.md).
