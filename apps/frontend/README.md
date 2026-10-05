# StockFlow Angular frontend

This workspace is the employee interface for StockFlow: an inventory dashboard, product creation, stock add/remove forms and movement history. It uses Angular 21.2, standalone components, Router, signals, reactive forms and `HttpClient`.

## Start locally

Complete the repository [setup instructions](../../docs/operations.md) to install root workspace dependencies and start MongoDB, NATS, Product Service, Inventory Service, BFF and audit worker. From the repository root, run:

```sh
npm run dev:frontend
```

Open `http://localhost:4200`. The checked-in [proxy configuration](proxy.conf.json) sends `/api` requests to the BFF at `http://localhost:3000`. There are no frontend MongoDB/NATS credentials or direct Product/Inventory URLs. The root install provides the local Angular CLI.

## Source map

| Path | Responsibility |
| --- | --- |
| [app.routes.ts](src/app/app.routes.ts) | Inventory, creation, detail, root redirect and wildcard routes |
| [dashboard.ts](src/app/inventory/dashboard.ts) | Joined stock view, statuses and remote view states |
| [product-create.ts](src/app/products/product-create.ts) | Product form and navigation after creation |
| [product-detail.ts](src/app/products/product-detail.ts) | Stock forms, safe idempotency-key retry and history |
| [bff-api.ts](src/app/core/bff-api.ts) | Single typed BFF client and readable API error mapping |

The server supplies `OUT`/`LOW`/`OK` status and enforces stock rules. Forms support three-decimal quantities, require reasons and preserve the original stock request identity while its outcome is uncertain. Views include keyboard focus handling, validation relationships, announced results and responsive table/card layouts.

## Build and test

Run from the repository root:

```sh
npm run build -w @stockflow/frontend
npm run test -w @stockflow/frontend -- --watch=false
```

The production build is written under `apps/frontend/dist/frontend`. Component tests use Angular's Vitest-based unit-test builder. Browser acceptance evidence and manual demo instructions are in [testing](../../docs/testing.md) and the [verification report](../../implementation/verification.md); this workspace has no configured `ng e2e` target.

Read the [frontend design](../../docs/frontend.md), [API contract](../../docs/api.md), and [app/code walkthrough](../../docs/walkthrough.md) for behavior and the complete request path.
