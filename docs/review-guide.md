# Company reviewer setup

Use the delivered complete-app revision. The historical [fresh-clone report](review-verification.md) verifies the smaller baseline; final expanded setup/runtime/browser evidence belongs in [expansion verification](../implementation/expansion/verification.md).

## Required installations

Git, Node >=22.16.0 <23, npm >=10.9.2 <11 and Docker Compose v2 supporting `--wait`. Locked npm supplies framework/tooling/driver clients; Docker supplies MongoDB and NATS. No external account/API key/private registry/global Angular or Nest CLI is required. Public registry access is needed for initial installation.

## Install and initialize

From the delivered expansion checkout:

```sh
npm ci
npm run configure
docker compose up -d --wait
npm run setup:mongo
npm run migrate:inventory
npm run setup:nats
```

Configure creates five missing backend `.env` files and preserves existing ones. Inspect preserved Sales/BFF settings and match Product/Inventory/Sales currency, default USD. Migration is required before Inventory startup. Existing data requires stopped writers and the [migration procedure](operations.md#inventory-migration-procedure). Windows/WSL has [specific commands](operations.md#windows-with-docker-in-wsl).

## Run all six applications

Open six terminals at repository root:

| Process | Command | Address |
| --- | --- | --- |
| Product | `npm run dev:product` | `http://localhost:3001/health/ready` |
| Inventory | `npm run dev:inventory` | `http://localhost:3002/health/ready` |
| Sales | `npm run dev:sales` | `http://localhost:3003/health/ready` |
| BFF | `npm run dev:bff` | `http://localhost:3000/health/ready` |
| Audit | `npm run dev:audit` | Both durable-consumer attachment logs |
| Angular | `npm run dev:frontend` | `http://localhost:4200` |

Ports 3000–3003, 4200, 27017, 4222 and 8222 must be free. Fresh schema supplies Main Store without a business seed. Inspect owner readiness and connected flow separately. Compiled backends use `npm run build` and each workspace's `start` script; keep Angular dev server for local proxy.

## Review the workflow

[Walkthrough](walkthrough.md) covers receiving 20 kg coffee/10 L milk, transferring 5 kg/2 L to Bar, latte recipe, three sales, waste/count/replenishment, rejected bundle and no-restock correction. Inspect documents/operations/receipts and eventual Audit. Legacy Main Store compatibility remains 0 → 50 → 40 → rejected 50 via `npm run verify:demo`.

```sh
npm run build
npm test
npm run test -w @stockflow/frontend -- --watch=false
npm run check:boundaries
npm run check:docs
npm run verify:inventory-expansion
```

The isolated Inventory fixture proves real transactions/controlled invariants, not complete HTTP/Sales/broker/browser acceptance. See [testing](testing.md) and [source map](technology-guide.md#source-and-verification-map).

## Stop or troubleshoot

Stop terminals with Ctrl+C and `docker compose down`; named volumes preserve data. `down -v` is destructive. [Recovery guide](operations.md#recovery-guide) covers startup, pending outcomes and notification backlog. Use `npm.cmd` if PowerShell strips extra flags.

These commands support trusted unauthenticated local review. Expanded fresh-clone success, public hosting and deployment need separate evidence.
