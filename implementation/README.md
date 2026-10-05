# StockFlow implementation guide

This folder records the completed build sequence for the [design documentation](../docs/README.md). The [eight-phase tracker](phases/README.md) gives each stage its deliverables and inspected evidence. The five applications, Compose file, scripts and tests are implemented; all phases passed their local acceptance gates, including Compose startup and volume-restart verification through WSL. See [verification evidence](verification.md).

The files in `docs/` define product behavior and wire contracts. Use the implementation files to locate work and order it. If an implementation note and a design contract conflict, reconcile them in both places before writing code; do not silently invent a third behavior.

## Build order

| Stage | Deliverable | Detailed instructions |
| --- | --- | --- |
| [1](phases/01-workspace-and-contracts.md) | npm workspace, pure contracts, dependency rules | [Workspace and boundaries](architecture/workspace-and-boundaries.md), [HTTP and types](architecture/contracts.md) |
| [2](phases/02-local-infrastructure.md) | MongoDB replica set, NATS JetStream, configuration | [Local infrastructure](infrastructure/local-environment.md), [consistency path](architecture/stock-consistency.md) |
| [3](phases/03-product-service.md) | Product Service | [Product Service](services/product-service.md) |
| [4](phases/04-inventory-core.md) | Inventory domain, transactions and HTTP service | [Inventory Service](services/inventory-service.md) |
| [5](phases/05-event-delivery-and-audit.md) | Outbox relay and audit worker | [Consistency path](architecture/stock-consistency.md), [audit worker](services/audit-worker.md) |
| [6](phases/06-bff.md) | BFF and complete public API | [BFF](services/bff.md) |
| [7](phases/07-angular-frontend.md) | Angular pages and detail components | [Dashboard](pages/inventory-dashboard.md), [create product](pages/create-product.md), [product detail](pages/product-detail.md), [stock actions](pages/stock-actions.md), [movement history](pages/movement-history.md), [not found](pages/not-found.md) |
| [8](phases/08-integration-and-acceptance.md) | Full demo and failure verification | [Verification](verification.md) |

Stages 3–6 may be developed incrementally, but keep the database/outbox transaction and public API contracts intact. The browser must never call internal service ports. Use one Product and one Inventory bounded context; the audit worker is an event consumer, not another domain owner.

## Required deliverables

- [x] `apps/frontend`, `apps/bff`, `apps/product-service`, `apps/inventory-service`, and `apps/audit-worker` start as separate processes.
- [x] Root npm workspaces, pure contract types, environment examples, Docker Compose, and idempotent NATS setup exist.
- [x] Product creation, inventory dashboard, stock add/remove, movement history and the core UI workflow work through the BFF.
- [x] Inventory commits balance, movement and outbox together, with idempotent commands and concurrent-removal protection.
- [x] JetStream receives both event types and the audit worker persists each event once.
- [x] Domain, application, HTTP, persistence, messaging, frontend and end-to-end checks pass against the stated local scenarios.

The recorded clean source-copy install and WSL-backed Compose checks prove local reproducibility and volume persistence. A separate physical machine setup was not performed.

The canonical [definition of done](../docs/testing.md) is more detailed and must be checked against running code. These notes do not replace it.

## Requirement coverage

| Requirement | Implementation owner |
| --- | --- |
| Product creation and retrieval (F01) | Product Service, BFF, Create Product page |
| Product and inventory views (F02, F07) | Product/Inventory services, BFF projection, Dashboard and Product detail |
| Add and remove stock (F03, F04) | Inventory domain/transaction, BFF, Stock action components |
| Movement history (F05) | Inventory Service, BFF, Movement history component |
| Published and consumed events (F06) | Inventory outbox/relay, JetStream, Audit worker |
| Interview scenario (F08) | [Verification](verification.md) |
