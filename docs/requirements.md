# Requirements and traceability

## Goal

Build a small restaurant inventory demonstration in which an employee can create and view products, view current stock, add stock, remove stock, and inspect stock movements. The architecture must make Angular, a thin NestJS BFF, separate Product and Inventory services, MongoDB ownership, DDD behavior, hexagonal ports and adapters, and actual NATS event consumption visible. Architectural clarity takes priority over feature count.

This document preserves the intent of the supplied 32-section StockFlow specification and the decisions used in the implementation. The host-process end-to-end flow passed against local executables and the pinned Docker Compose stack; the MongoDB and JetStream volumes preserved data across a container restart. See [verification evidence](../implementation/verification.md).

## Functional requirements

| ID | Required behavior | Design and verification |
| --- | --- | --- |
| F01 | Create and retrieve products | Angular product form → BFF → Product Service; [API](api.md), [frontend](frontend.md) |
| F02 | View all products and inventory | BFF joins Product and Inventory responses, treating a product without an inventory record as zero; [API](api.md) |
| F03 | Add positive stock | Inventory domain validates and commits balance, movement and event; [domain](domain.md) |
| F04 | Remove positive stock without going below zero | Domain rejects insufficient stock; conditional persistence prevents concurrent overdraw; [domain](domain.md), [persistence](persistence.md) |
| F05 | View a product's movement history | Inventory Service owns `stock_movements`; BFF exposes ordered history; [API](api.md) |
| F06 | Publish and consume every committed stock event | Transactional outbox → JetStream → durable audit worker; [events](events.md) |
| F07 | Show stock status | BFF derives `OUT`, `LOW` or `OK` from balance and product threshold; [frontend](frontend.md) |
| F08 | Demonstrate the full scenario | Create Arabica Coffee, add 50 kg, remove 10 kg, show 40 kg and two events, reject a 50 kg removal; [testing](testing.md) |

## Architectural requirements

| ID | Required property | Design and verification |
| --- | --- | --- |
| A01 | Angular calls only the BFF | One configured `/api` base URL; frontend contract test; [frontend](frontend.md) |
| A02 | Product and Inventory are independently owned contexts | Separate services, ports and MongoDB databases; [architecture](architecture.md) |
| A03 | BFF contains presentation and aggregation, not stock rules | BFF delegates mutations and maps responses; [backend](backend.md) |
| A04 | Domain is framework independent | No NestJS, HTTP, MongoDB or NATS imports in domain; [domain](domain.md) |
| A05 | Application depends on ports | Repository and publisher abstractions injected through NestJS composition; [domain](domain.md) |
| A06 | MongoDB and NATS are adapters | Service-owned data and JetStream publisher are infrastructure; [persistence](persistence.md), [events](events.md) |
| A07 | Stock balance, movement and event intent remain consistent | One MongoDB transaction, outbox relay, duplicate-safe consumer; [persistence](persistence.md), [events](events.md) |
| A08 | Local development is reproducible | Docker Compose MongoDB replica set and NATS JetStream, documented service startup; [operations](operations.md) |
| A09 | Domain and application behavior is tested | Targeted unit, integration and end-to-end tests; [testing](testing.md) |

## Deliberate decisions beyond the source specification

- Quantities have at most three decimal places. The API displays product units; domain and persistence use integer thousandths. Balance and action quantity are limited to `1,000,000,000.000` units so conversion remains within JavaScript's safe integer range.
- Product `lowStockThreshold` defaults to zero. `OUT` means quantity zero; `LOW` means a positive quantity at or below a positive threshold; `OK` covers all other positive balances.
- A product with no inventory record has a logical zero balance. The Inventory Service creates its record on first addition after checking the product through the Product Service API. An attempted first removal fails with `INSUFFICIENT_STOCK`.
- Stock POST requests require a caller-generated `Idempotency-Key` UUID. Repeating the same request returns its original result; reusing its key for different input fails.
- A dedicated audit worker persists deduplicated stock events in its own MongoDB database. This fifth process is the one asynchronous consumer needed to demonstrate NATS clearly.

## Non-goals

Authentication, authorization, user management, multi-restaurant administration, payments, suppliers, purchase orders, recipes, complex reports, advanced analytics, Kubernetes, CI/CD, Kafka, Redis, GraphQL and production-scale deployment are outside the demonstration. No frontend or backend endpoint should quietly introduce these capabilities. The local setup is intended for trusted development only.

## Definition-of-done trace

The runtime items from the supplied definition of done have been checked against process, browser, database and broker evidence in [testing](testing.md). The following groups identify where implementation and proof belong:

| Source checklist items | Proof location |
| --- | --- |
| Angular, BFF, Product Service, Inventory Service, MongoDB and NATS run | Startup and health checks in [operations](operations.md) |
| Angular→BFF→services; each service owns its data | Network and contract tests in [testing](testing.md) |
| Mongo persistence; add/remove; nonnegative balance; movements | Domain, API and MongoDB tests in [testing](testing.md) |
| Stock events published and consumed | Outbox, JetStream and audit-worker integration checks in [testing](testing.md) |
| Framework-independent domain; repository and publisher ports with adapters | Import-boundary checks and use-case tests in [testing](testing.md) |
| README explains architecture, diagram and decisions | Root README and [architecture](architecture.md); documentation review in [testing](testing.md) |

This table maps the full supplied checklist, including the distinct Product and Inventory repository responsibilities. Passing a documentation review does **not** mark the runtime checklist complete.

## Source specification coverage

The supplied 32 sections map to the design as follows. The mapping records documentation coverage; runtime evidence is tracked separately.

| Source section | Design location |
| --- | --- |
| 1. Product Overview | This goal and [frontend](frontend.md) |
| 2. Core Architectural Principle | [Architecture](architecture.md), [domain design](domain.md) |
| 3. Business Domain | [Domain design](domain.md) |
| 4. Bounded Contexts | [Domain design](domain.md), [architecture](architecture.md) |
| 5. Services | [Architecture](architecture.md), [backend](backend.md) |
| 6. Product Service | [Backend](backend.md), [API](api.md) |
| 7. Inventory Service | [Backend](backend.md), [API](api.md) |
| 8. Inventory Business Rules | [Domain design](domain.md), [testing](testing.md) |
| 9. Domain Model | [Domain design](domain.md) |
| 10. Domain Events | [Events](events.md) |
| 11. NATS | [Events](events.md), [operations](operations.md) |
| 12. NATS Adapter | [Domain design](domain.md), [events](events.md) |
| 13. Hexagonal Architecture | [Domain design](domain.md), [backend](backend.md) |
| 14. Repository Pattern | [Domain design](domain.md), [persistence](persistence.md) |
| 15. MongoDB | [Persistence](persistence.md) |
| 16. Suggested MongoDB Collections | [Persistence](persistence.md) |
| 17. Angular Application | [Frontend](frontend.md) |
| 18. BFF API | [API](api.md), [backend](backend.md) |
| 19. Add Stock Flow | [Architecture](architecture.md), [events](events.md) |
| 20. Remove Stock Flow | [Architecture](architecture.md), [domain design](domain.md) |
| 21. Technology Requirements | [Documentation technology map](README.md) |
| 22. Docker | [Operations](operations.md) |
| 23. Testing | [Testing](testing.md) |
| 24. Error Handling | [API](api.md), [backend](backend.md) |
| 25. Dependency Rules | [Domain design](domain.md), [architecture](architecture.md) |
| 26. Project Structure | [Architecture](architecture.md), [backend](backend.md) |
| 27. Architectural Demonstration Goals | [Architecture](architecture.md), [testing](testing.md) |
| 28. Non-Goals | This document's non-goals |
| 29. Quality Expectations | [Domain design](domain.md), [testing](testing.md) |
| 30. Demonstration Scenario | [Testing](testing.md) |
| 31. Definition of Done | [Testing](testing.md) checklist |
| 32. Guiding Principle for AI Implementation | [Architecture](architecture.md) rationale |
