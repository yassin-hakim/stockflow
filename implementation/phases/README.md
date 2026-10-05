# StockFlow implementation phases

These eight phases cover the application described in [the implementation guide](../README.md) and [the design docs](../../docs/README.md). All eight phases are implemented and have local acceptance evidence, including the pinned Docker Compose startup and volume-restart scenario run through WSL. A separate second-machine installation and a human screen-reader session were not performed. Detailed evidence is in [verification](../verification.md).

## How to use this tracker

Work through the phases in order. A phase may start with mocks for an upstream service, but it exits only with the real behavior and evidence named in its gates. Check a progress box after the code exists; check an exit gate only after its test, command output, response, database state or browser observation has been inspected. Record the evidence in the implementing PR or task. Do not treat a document, green build, or unit test as proof of a later end-to-end gate.

| Phase | Outcome | Status |
| --- | --- | --- |
| [1. Workspace and contracts](01-workspace-and-contracts.md) | Five app projects, pure DTO package, dependency rules | Complete; clean source-copy install/build and boundaries verified |
| [2. Local infrastructure](02-local-infrastructure.md) | MongoDB replica set, NATS JetStream, config and setup scripts | Complete; Compose health and persistent-volume restart verified |
| [3. Product Service](03-product-service.md) | Product domain, Mongo adapter and internal HTTP API | Complete; domain, API and persisted reload verified |
| [4. Inventory core](04-inventory-core.md) | Stock domain, commands, Mongo transaction, movements and outbox | Complete; atomicity, idempotency and concurrent removals verified |
| [5. Event delivery and audit](05-event-delivery-and-audit.md) | Outbox relay, durable JetStream consumer and audit persistence | Complete; PubAck, deduplication and outage recovery verified |
| [6. BFF](06-bff.md) | Complete frontend-facing HTTP API and aggregation | Complete; route contracts, projection and failure mapping verified |
| [7. Angular frontend](07-angular-frontend.md) | Every route, form, dashboard state and movement view | Complete; Playwright, axe and keyboard checks passed |
| [8. Integration and acceptance](08-integration-and-acceptance.md) | Full scenario, failure recovery and original definition of done | Complete; Compose, full-flow, persisted state and recovery evidence recorded |

## Coverage of the implementation folder

Every implementation spec has a primary build phase and a final verification phase. Shared architecture specs intentionally span more than one phase.

| Existing implementation file | Build phase |
| --- | --- |
| [Workspace and boundaries](../architecture/workspace-and-boundaries.md) | 1; verify again in 8 |
| [HTTP and type contracts](../architecture/contracts.md) | 1 foundation, 3–7 receiving boundaries; verify in 8 |
| [Stock consistency](../architecture/stock-consistency.md) | 4 transaction, 5 delivery; verify in 8 |
| [Local environment](../infrastructure/local-environment.md) | 2; verify restart/recovery in 8 |
| [Product Service](../services/product-service.md) | 3 |
| [Inventory Service](../services/inventory-service.md) | 4 and 5 |
| [Audit worker](../services/audit-worker.md) | 5 |
| [BFF](../services/bff.md) | 6 |
| [Inventory dashboard](../pages/inventory-dashboard.md) | 7 |
| [Create Product](../pages/create-product.md) | 7 |
| [Product detail](../pages/product-detail.md) | 7 |
| [Stock actions](../pages/stock-actions.md) | 7 |
| [Movement history](../pages/movement-history.md) | 7 |
| [Redirect and not found](../pages/not-found.md) | 7 |
| [Implementation verification](../verification.md) | 8 |
| [Implementation guide](../README.md) | Navigation and progress summary across 1–8 |

## Requirement coverage

The required technologies and patterns also have an implementation home: **microservices/NestJS** in phases 1 and 3–6; **DDD/hexagonal architecture** in phases 1, 3–5; **MongoDB** in phases 2–5; **NATS** in phases 2 and 5; **BFF** in phase 6; and **Angular** in phase 7. Phase 8 verifies their actual interaction.

| Requirement group | Phase that provides it | Final proof |
| --- | --- | --- |
| F01 product creation/retrieval | 3, 6, 7 | 8 |
| F02 product and inventory views; F07 status | 3, 4, 6, 7 | 8 |
| F03 add, F04 remove, F05 movements | 4, 6, 7 | 8 |
| F06 published and consumed events | 4, 5 | 8 |
| F08 interview scenario | 3–7 | 8 |
| A01–A06 service and dependency boundaries | 1–7 | 8 |
| A07 atomic change and eventual delivery | 4–5 | 8 |
| A08 reproducible local startup | 2 plus application phases | 8 |
| A09 domain/application tests | 3–5 | 8 |

Phase 8 also checks every item in the original [27-item definition of done](../../docs/testing.md). No phase adds authentication, suppliers, reporting, Kubernetes, CI/CD, Redis, Kafka or other [non-goal](../../docs/requirements.md).
