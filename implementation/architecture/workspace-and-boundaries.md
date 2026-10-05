# Workspace and dependency boundaries

## Outcome

Create a small npm workspace that starts five applications independently and lets an interviewer trace an operation through explicit layers. This is a source-layout specification, not a request to generate placeholder abstractions before a use case needs them. Follow the [architecture](../../docs/architecture.md), [backend design](../../docs/backend.md), and [domain rules](../../docs/domain.md).

## Target workspace

```text
apps/
├── frontend/                 Angular standalone application
├── bff/                      NestJS public HTTP API
├── product-service/          NestJS Product context
├── inventory-service/        NestJS Inventory context and outbox relay
└── audit-worker/             NestJS application context, JetStream consumer
packages/
└── contracts/                Pure HTTP DTO and event-envelope types only
docker-compose.yml            MongoDB and NATS only
package.json                  npm workspaces and documented scripts
```

Use `apps/*` and `packages/*` as npm workspaces. The root scripts required by [operations](../../docs/operations.md) are `dev:frontend`, `dev:bff`, `dev:product`, `dev:inventory`, `dev:audit`, and `setup:nats`. Add build and test scripts per app, with one root check command that runs the domain/application and contract suites. Pin exact dependency and container image versions in manifests when code is introduced; the design docs intentionally do not claim installed versions.

`packages/contracts` may contain the public `Product`, `InventoryOverview`, `StockMovement`, `StockChangeResult`, error envelope, stock event v1 shape, and route-independent value types. It must contain **no** NestJS decorators, Angular services, MongoDB models, domain entities, repositories, or executable business rules. Each service owns runtime input validation and maps between transport DTOs and its domain. Shared contracts prevent field-name drift without merging bounded contexts.

## Service layering

Product and Inventory each use `src/domain`, `src/application`, `src/infrastructure`, and `src/presentation`. A concrete feature should follow this path:

```text
NestJS controller → use case → domain behavior
                          ↓
                  service-specific port
                          ↑
                  MongoDB / HTTP / NATS adapter
```

Application port interfaces and domain types import inward only. `domain` imports no framework, HTTP, MongoDB, NATS or shared transport DTO package. `application` imports domain and its own ports, never concrete adapters. `infrastructure` implements ports; `presentation` validates and maps HTTP. A NestJS module at the edge composes tokens, use cases and adapters. Product and Inventory do not import each other's repositories or domain entities.

BFF has feature modules for Products and Inventory plus a small common module for validation, error mapping and health. It has no domain repository and no MongoDB or NATS client. Audit worker has a `HandleStockEvent` application use case, its `AuditRepository` port, and JetStream/MongoDB adapters. It has no public business controller.

## Process and network boundaries

Angular calls only the BFF `/api` origin. BFF calls Product and Inventory over HTTP. Inventory calls Product over HTTP only to validate the first addition to a product. Product writes only `stockflow_product`; Inventory writes only `stockflow_inventory`; Audit writes only `stockflow_audit`. Inventory publishes stock events through JetStream, and Audit consumes them. No process reads another owner's MongoDB collection.

Use `X-Request-ID` on internal HTTP, keep stock `Idempotency-Key` unchanged end to end, and log product/movement/event IDs at their owning process. Keep all unprotected ports on localhost for the local demo.

## Work checklist

- [x] Create npm workspaces and five runnable app entrypoints without shared domain or repository code.
- [x] Add a pure contracts package and configure its imports from frontend/BFF/presentation layers only.
- [x] Add module wiring with explicit injection tokens for each service port.
- [x] Add an import-boundary check or equivalent test proving domain and application never import infrastructure or framework packages.
- [x] Confirm the browser network trace contains `/api` calls only, and backend dependency credentials stay out of frontend output.
