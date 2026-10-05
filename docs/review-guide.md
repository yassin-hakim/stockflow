# Company reviewer setup

This guide runs the repository locally for technical review. The source, npm lockfile, environment examples, Docker service definitions and verification scripts are included. No external account, API key or private npm registry is required.

## Required installations

| Tool | Supported review setup | Purpose |
| --- | --- | --- |
| Git | An installed Git client | Clone the public repository |
| Node.js | Version 22.16 or newer within major 22; 22.16.0 tested | Run all five applications and setup tools |
| npm | Version 10.9.2 or newer within major 10; 10.9.2 tested | Install all workspace dependencies from one lockfile |
| Docker and Compose | Docker Desktop, or Docker Engine with Compose v2 supporting `--wait` | Run MongoDB and NATS |

The root `engines` and `packageManager` fields declare the runtime; `.nvmrc` selects Node 22.16.0 for compatible version managers. Check `node --version`, `npm --version`, `git --version` and `docker compose version`. Docker must be running and reachable by the shell issuing Compose commands. Initial installation needs access to GitHub, the public npm registry and Docker image registries.

MongoDB, its shell and NATS are supplied by the pinned container images. Angular CLI, NestJS, TypeScript, MongoDB/NATS clients, tsx and test tools are supplied by `npm ci`. There is no additional global CLI or separately installed database service to configure.

## Install and initialize

Run from a terminal:

```sh
git clone https://github.com/yassin-hakim/stockflow.git
cd stockflow
npm ci
npm run configure
docker compose up -d --wait
npm run setup:mongo
npm run setup:nats
```

`configure` creates four missing `.env` files and preserves existing ones. Defaults use localhost and service-owned databases. Actual `.env` files are ignored by Git. `setup:mongo` waits for a writable `rs0` primary, required for Inventory transactions. `setup:nats` creates `STOCK_EVENTS` and durable consumer `stock-audit`. Both setup commands can be repeated.

Windows users with Docker only inside WSL should follow the [WSL commands](operations.md#windows-with-docker-in-wsl), then run npm commands from PowerShell. With Docker Desktop available in PowerShell, the commands above apply directly.

## Run all five applications

Open five terminals in the cloned repository root. Keep each running:

| Process | Command | Default address / result |
| --- | --- | --- |
| Product Service | `npm run dev:product` | `http://localhost:3001/health/ready` |
| Inventory Service | `npm run dev:inventory` | `http://localhost:3002/health/ready` |
| BFF | `npm run dev:bff` | `http://localhost:3000/health/ready` |
| Audit worker | `npm run dev:audit` | Logs attachment to `stock-audit`; no web page |
| Angular | `npm run dev:frontend` | Open `http://localhost:4200` |

MongoDB uses port 27017. NATS uses 4222, with monitoring on 8222. These and the four application ports must be free. The HTTP readiness endpoints should return HTTP 200. No seed is required: a fresh database opens with an empty product list.

For compiled backends, run `npm run build`, then replace the four backend `dev:*` commands with `npm run start -w @stockflow/product-service`, `npm run start -w @stockflow/inventory-service`, `npm run start -w @stockflow/bff` and `npm run start -w @stockflow/audit-worker`. These scripts also load `.env`. Keep the Angular development server for the local `/api` proxy.

## Review the workflow

Create **Arabica Coffee**, unit `kg`, category `Coffee`, low-stock threshold `5`. It starts at `0 kg` / `OUT`. Add `50` with a reason, remove `10`, then attempt to remove `50`. The final balance remains `40 kg`, with two movements and a readable insufficient-stock error.

With every application and both containers running, execute:

```sh
npm run verify:demo
```

The verifier creates its own test products. It checks the core scenario, rejection without a movement/event, idempotent replay, concurrent removals, concurrent first additions and eventual MongoDB audit records through NATS. Read the [walkthrough](walkthrough.md) and [technology source map](technology-guide.md#source-and-verification-map) to inspect how all eight required technologies participate.

Optional code checks:

```sh
npm run build
npm test
npm run test -w @stockflow/frontend -- --watch=false
npm run check:boundaries
npm run check:docs
```

The fresh-clone [review verification](review-verification.md) records the executed checks and startup results.

## Stop or troubleshoot

Stop the five terminals with Ctrl+C, then run `docker compose down`. Named volumes preserve data for the next review. The [operations guide](operations.md#recovery-guide) covers port conflicts, Docker access, missing consumer, replica-set setup and dependency failures. On Windows, use `npm.cmd` when passing extra CLI flags through npm if PowerShell strips them.

This is a local architectural demonstration with no authentication. Cross-platform instructions are provided; the executed clean-clone verification used Windows host processes and Docker in WSL. Hosting the app publicly, production credentials and clustering are outside the review setup.
