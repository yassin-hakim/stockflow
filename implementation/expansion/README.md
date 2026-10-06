# StockFlow complete-app implementation plan

Status: execution plan. This document specifies the release; actual implementation and verification status is recorded separately in [verification.md](verification.md).

This plan extends the existing restaurant inventory app into a complete, bounded restaurant operations application. It follows the original [architecture](../../docs/architecture.md), [DDD and hexagonal design](../../docs/domain.md), [implementation sequence](../phases/README.md), and [frontend constraints](../../instructions.md). The original eight phases remain the historical baseline; the phases below describe new work.

## Product outcome

One restaurant can maintain its ingredient catalog, receive deliveries into storage locations, transfer stock to the kitchen or bar, sell recipe-based menu items through a simple POS, record waste, reconcile physical counts, and identify replenishment needs. Every consequential operation has a persistent reference and an inspectable history.

The end-to-end workflow is:

`Catalog → Receive → Store → Transfer → Sell/consume → Record waste → Count → Replenish`

The app remains one Angular application and one public BFF. A warehouse is initially a named storage location within the restaurant, not a separate tenant or application. POS adds one Sales bounded context; stock rules remain exclusively in Inventory.

## Scope and precedence

The expanded brief explicitly brings storage locations, transfers, receiving, stock counts, waste, product management, recipes, POS, order corrections, replenishment, and operational reports into scope. Simple supplier references and recorded tender methods are included where receiving and sales need them.

The original baseline remains preserved in [requirements](../../docs/requirements.md). The approved scope updates in that document and `instructions.md` supersede its older exclusions for X01–X13. Canonical [API contracts](../../docs/api.md) describe the implemented routes; this plan defines the acceptance target. Preserve the existing architecture, restrained visual language, quantity precision, nonnegative stock, idempotency, pending recovery, and explicit view-state requirements. See the [requirement evidence map](requirement-evidence.md) for proven behavior and remaining gates.

### Included in this release scope

| ID | Feature | Release behavior | Owner | Phase |
| --- | --- | --- | --- | --- |
| X01 | Product management | Edit descriptive fields and thresholds; optional unique SKU; archive without deleting history; immutable base unit | Product | E02 |
| X02 | Locations | Create/rename storage locations; browse per-location and restaurant totals | Inventory | E03 |
| X03 | Transfers | Immediately move one or more products between two locations; all lines commit together | Inventory | E04 |
| X04 | Delivery receiving | Receive a multi-line delivery with optional supplier reference and required delivery reference | Inventory | E04 |
| X05 | Waste | Record product, location, quantity, waste category and explanation | Inventory | E05 |
| X06 | Physical counts | Snapshot selected balances, enter counted quantities, review differences, reject stale counts, confirm once | Inventory | E05 |
| X07 | Replenishment | Configure location thresholds/targets; show stock requiring action and server-calculated suggested quantities | Inventory; BFF display projection | E06 |
| X08 | Menu and recipes | Maintain sellable items, prices and versioned ingredient quantities in their product base units | Product | E07 |
| X09 | POS | Cart, integer item counts, chosen consumption location, checkout, recorded cash/card tender label, printable receipt | Sales + Inventory | E08–E09 |
| X10 | Sale history and corrections | Order detail, pre-checkout cancellation, partial/full recorded refunds, explicitly chosen stock return | Sales + Inventory | E10 |
| X11 | Operational reports | Real sales, ingredient consumption, waste, transfers and count differences; date/location filters and CSV export | Owner-service queries + BFF | E11 |
| X12 | Complete handoff | Mobile and keyboard flows, reliable retries, migrations, six-process setup, documentation and evidence | All | E12 |
| X13 | Approved reporting extension | Paginated operational lists, receiving unit costs, historical ingredient costs and gross-profit P&L; no operating expenses | Inventory valuation + Sales reports | E04, E11–E12 |

X13 records the user's later approval and supersedes the original cost-valuation exclusion. [Cost reporting](../../docs/cost-reporting.md) specifies weighted average valuation, unknown historical costs, integer rounding and original-cost stock returns.

### Follow-up candidates, outside this release

- Batch/lot expiry tracking and earliest-expiry stock selection: requires balances by batch as well as location.
- Barcode scanner input: build on SKU first; scanner hardware integration is separate.
- Purchase orders and partial supplier fulfillment: receiving initially records deliveries that already arrived.
- Staff login and permissions: add a dedicated identity/access design before a shared operational deployment.
- Location archival: requires rules for outstanding sales, counts and later stock returns; locations remain available in this release.
- Till sessions, cash reconciliation, payment terminals and gateway integration: recorded tender labels do not implement these capabilities.
- Operating expenses, net-profit accounting, unit conversion, offline checkout, kitchen printers, table plans, modifiers, discounts, tax engines and multiple restaurants.

These are intentionally separate extensions. Do not add placeholder navigation or endpoints for them.

## Architecture package

- [Delivery plan](delivery-plan.md): practical build order, service responsibilities, workflow milestones and acceptance outcomes.
- [Architecture and consistency](architecture.md): ownership, ports, multi-line stock transactions, checkout/refund recovery, NATS and migration strategy.
- [Contracts and data](contracts-and-data.md): public/internal API map, DTO requirements, indexes, errors, pagination and compatibility.
- [Pages and interaction states](pages.md): routes, task hierarchy, responsive behavior and pending-request recovery.
- [Phases and acceptance](phases-and-acceptance.md): dependency order, implementation deliverables, exit gates and final demo.

## Work in the same way as the original build

For each feature slice, use this sequence:

1. Reconcile requirements, invariants, transport contracts and page specification.
2. Implement plain TypeScript domain behavior and meaningful domain tests.
3. Implement application use cases and service-owned ports, tested with fakes.
4. Implement MongoDB/HTTP/NATS adapters and real persistence/transaction checks.
5. Implement the owning NestJS controller, receiving-boundary validation and error mapping.
6. Add thin BFF forwarding/read-model composition and public contract checks.
7. Add Angular through `BffApi`, standalone components, signals and reactive forms; verify rendered desktop/mobile states.
8. Run the real end-to-end scenario, inspect persisted records and eventual audit delivery, update docs and record evidence.

Do not finish all backend work and leave frontend/acceptance to the end. Each phase delivers a usable vertical slice, except the explicitly backend-focused compatibility foundation and checkout recovery foundation.

## Dependency order and milestone exits

| Milestone | Phases | Demonstrable result |
| --- | --- | --- |
| Foundation | E01–E03 | Agreed contracts, safe migration, editable catalog and location-aware inventory with the original demo preserved |
| Inventory operations | E04–E06 | Receive → transfer → waste → count → replenishment, through Angular and audited movements |
| Sales operations | E07–E10 | Recipe menu → recoverable checkout → receipt → sale history → explicit correction |
| Complete release | E11–E12 | Accurate reports, reproducible setup, browser/persistence/recovery evidence and reviewer walkthrough |

All phases start unchecked. A phase exits only when its inspected evidence exists. A specification or passing build does not prove stock correctness, migration safety, broker recovery, or mobile usability.

## Architectural limits

- Keep Angular, NestJS, MongoDB, NATS JetStream, BFF, DDD and hexagonal architecture.
- Keep npm workspaces and the current frameworks/libraries; the expansion does not require a replacement stack.
- Add one Sales process and one Sales-owned database. Do not create a service per screen, warehouse, report or stock operation.
- All browser requests use `/api`; the BFF never reads databases or contains checkout/stock rules.
- HTTP owns synchronous commands; NATS owns asynchronous audit notifications. Audit arrival never determines checkout success.
- A distributed workflow must expose and recover an intermediate state; do not promise one transaction across Sales and Inventory.
- Plan-only work does not authorize application implementation, production migration, deployment or restart.
