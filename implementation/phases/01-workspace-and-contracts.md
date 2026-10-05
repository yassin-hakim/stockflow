# Phase 1 — Workspace and contracts

## Goal and inputs

Create a buildable skeleton for all five processes and one pure DTO package before domain code is added. Establish the dependency direction that subsequent phases must follow. Use [workspace and boundaries](../architecture/workspace-and-boundaries.md), [contracts](../architecture/contracts.md), [docs/api.md](../../docs/api.md), and [docs/domain.md](../../docs/domain.md) as the source material.

## Includes

Set up root npm workspaces for `apps/*` and `packages/*`, TypeScript configuration, a lockfile, and the planned script names: `dev:product`, `dev:inventory`, `dev:bff`, `dev:audit`, `dev:frontend`, `setup:nats`. Create the five app entrypoints with their appropriate NestJS or Angular bootstrap structure. App entrypoints may be minimal here, but each must compile independently. Put only HTTP DTO types, stable error codes and stock-event v1 envelope types in `packages/contracts`; service domain models and MongoDB schemas stay local to their owners.

Establish `domain`, `application`, `infrastructure`, `presentation` folders for Product and Inventory, service-specific port tokens, and a check that domain/application code does not import NestJS, MongoDB, NATS, Angular or another service's internals. Define one convention for UUIDs, UTC timestamps, milliunit conversion, `Idempotency-Key` and `X-Request-ID` so later routes cannot drift. The exact compatible dependency versions are pinned when manifests are created; do not label uninstalled packages as present.

## Implementation progress

- [x] Create npm workspaces and a lockfile with independently buildable Angular, BFF, Product, Inventory and Audit app projects.
- [x] Add the required root script names and per-app build/test commands; reserve `setup:nats` for the real idempotent setup in Phase 2.
- [x] Add a pure `packages/contracts` package for API DTOs, error codes and event v1 types without runtime business behavior.
- [x] Lay out Product and Inventory layers and define injection-token conventions without shared repositories or entities.
- [x] Add a boundary check that fails on forbidden domain/application imports and on frontend imports of internal service clients.
- [x] Link the implemented code layout and verification status from the root README.

## Exit gates

- [x] `npm ci` from a clean source copy resolves the pinned workspace dependencies from the lockfile.
- [x] Each of the five app projects and `packages/contracts` compiles independently; an import-boundary check passes and fails for a deliberate forbidden-import fixture.
- [x] The contracts package contains every public DTO and error code in [docs/api.md](../../docs/api.md) and the v1 event envelope in [docs/events.md](../../docs/events.md), with no domain or infrastructure imports.
- [x] A repository scan confirms one Product context, one Inventory context, no shared Mongo repository, and no MongoDB/NATS dependency in Angular or BFF.

**Handoff:** Phase 2 can add real infrastructure without having to choose new paths, script names or contract shapes.
