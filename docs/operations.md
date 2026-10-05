# Local setup and operation

> The five host-run applications and the full workflow passed against the pinned Docker Compose containers. A MongoDB marker and pending JetStream delivery survived `docker compose down` followed by `docker compose up -d --wait`; the audit worker then consumed the retained event.

## Verified local topology

Docker Compose runs MongoDB and NATS only. MongoDB is a single-node `rs0` replica set, with a persistent volume, published to `127.0.0.1:27017`. NATS has JetStream enabled with a persistent volume, client port `127.0.0.1:4222`, and local monitoring port `127.0.0.1:8222`. Run Angular, BFF, Product Service, Inventory Service and audit worker as separate host processes during development. A local single-node replica set supports transactions but does not provide high availability.

| Process | Local address | Dependency |
| --- | --- | --- |
| Angular frontend | `http://localhost:4200` | BFF `/api` proxy |
| BFF | `http://localhost:3000` | Product and Inventory HTTP |
| Product Service | `http://localhost:3001` | `stockflow_product` database |
| Inventory Service | `http://localhost:3002` | Product HTTP, `stockflow_inventory`, NATS |
| Audit worker | No business HTTP port | JetStream, `stockflow_audit` |
| MongoDB | `localhost:27017` | Persistent volume; replica set `rs0` |
| NATS | `localhost:4222` | JetStream file store |

The BFF is the only backend address configured in Angular. Keep internal service ports bound to localhost in the host-process development setup. This demo has no authentication; do not expose these addresses to an untrusted network.

## Configuration contract

The implementation provides `.env.example` files and validates required values on startup. Never commit secrets or user-specific connection strings. Variables:

| Process | Required configuration |
| --- | --- |
| Product Service | `PORT=3001`, `MONGO_URI=mongodb://localhost:27017/stockflow_product?replicaSet=rs0&directConnection=true` |
| Inventory Service | `PORT=3002`, Inventory `MONGO_URI`, `PRODUCT_SERVICE_URL=http://localhost:3001`, `NATS_URL=nats://localhost:4222` |
| BFF | `PORT=3000`, `PRODUCT_SERVICE_URL=http://localhost:3001`, `INVENTORY_SERVICE_URL=http://localhost:3002` |
| Audit worker | Audit `MONGO_URI`, `NATS_URL=nats://localhost:4222` |
| Angular | `/api` development proxy target `http://localhost:3000` |

The Inventory and Audit Mongo URIs use their respective database names `stockflow_inventory` and `stockflow_audit` with the same replica-set query. If applications later move inside Compose, change the replica-set member hostname and URIs together so all processes can resolve it; the host-process design assumes `localhost:27017`.

## Startup sequence

The root npm workspace declares `dev:product`, `dev:inventory`, `dev:bff`, `dev:audit`, `dev:frontend`, `setup:mongo`, and `setup:nats`. Copy each backend `.env.example` to `.env` before starting its `dev:*` script. The sequence below was verified using Docker Compose through WSL with host-run applications.

1. Install locked Node dependencies with `npm ci`.
2. Start infrastructure with `docker compose up -d --wait`.
3. Run `npm run setup:mongo`. It initializes `rs0` on the first run and validates the existing replica set on later runs. Wait for a primary before starting the services.
4. Run `npm run setup:nats` to idempotently create the file-backed `STOCK_EVENTS` stream and `stock-audit` durable consumer as specified in [events.md](events.md).
5. Start Product Service, Inventory Service, BFF, audit worker and Angular in separate terminals using their `dev:*` scripts. The audit worker may start before or after stock commands because JetStream stores events.
6. Open `http://localhost:4200` and follow the [demo](testing.md).

Use the named `mongo-data` and `nats-data` Docker volumes so ordinary restarts preserve the demo state. `docker compose down` stops containers without deleting these volumes. **Destructive local reset:** `docker compose down -v` deletes both volumes and all local Product, Inventory, Audit and JetStream data. Run it only when a clean demo database is explicitly wanted.

## Complete setup commands

### Prerequisites and installation

Use Git, Node.js 22 with npm 10, and Docker with the Compose plugin. Verification used Node 22.16.0 and npm 10.9.2. Check `node --version`, `npm --version`, `git --version` and `docker compose version`. MongoDB and NATS run in containers; the root install supplies the Angular CLI. Ports 3000, 3001, 3002, 4200, 27017, 4222 and 8222 must be free.

```sh
git clone https://github.com/yassin-hakim/stockflow.git
cd stockflow
npm ci
```

Create environment files on first setup. In PowerShell:

```powershell
Copy-Item apps/product-service/.env.example apps/product-service/.env
Copy-Item apps/inventory-service/.env.example apps/inventory-service/.env
Copy-Item apps/bff/.env.example apps/bff/.env
Copy-Item apps/audit-worker/.env.example apps/audit-worker/.env
```

In a POSIX shell:

```sh
cp apps/product-service/.env.example apps/product-service/.env
cp apps/inventory-service/.env.example apps/inventory-service/.env
cp apps/bff/.env.example apps/bff/.env
cp apps/audit-worker/.env.example apps/audit-worker/.env
```

The defaults match the local topology above. Preserve edited `.env` files on later startups. The frontend uses its checked-in `/api` proxy and needs no `.env` file.

### Infrastructure initialization

```sh
docker compose up -d --wait
npm run setup:mongo
docker compose exec -T mongo mongosh --quiet --eval 'db.hello().isWritablePrimary'
npm run setup:nats
docker compose ps
```

The MongoDB check must print `true`. `setup:mongo` initializes or validates the replica-set configuration; it does not wait for election, so repeat the primary check if it initially prints `false`. Both containers should be healthy. `setup:nats` confirms the stream and durable consumer are ready and refuses incompatible existing settings. Both setup commands are safe to repeat against the intended local resources.

### Windows with Docker in WSL

Docker Desktop users with Docker available in PowerShell can use the commands above. On the verified workstation Docker was available in WSL Ubuntu while Node and the application processes ran in Windows. From PowerShell, this checkout used:

```powershell
wsl --user root --exec docker compose -f /mnt/c/Projects/interview/docker-compose.yml up -d --wait
npm run setup:mongo
wsl --user root --exec docker compose -f /mnt/c/Projects/interview/docker-compose.yml exec -T mongo mongosh --quiet --eval 'db.hello().isWritablePrimary'
npm run setup:nats
```

Replace `/mnt/c/Projects/interview/docker-compose.yml` with the WSL path to your checkout. `--user root` reflects the verified workstation's Docker permissions; use your WSL user if it already has access. Run npm commands in PowerShell from the Windows repository root. Windows must reach the published ports through `localhost`; if that fails, check WSL localhost forwarding and Docker's published ports before changing database hostnames. Keep replica-set member `localhost:27017` consistent with the host-run MongoDB URIs.

### Start the applications

Open five terminals in the repository root and run one process in each:

| Terminal | Command | Ready indication |
| --- | --- | --- |
| Product | `npm run dev:product` | HTTP 200 at port 3001 `/health/ready` |
| Inventory | `npm run dev:inventory` | HTTP 200 at port 3002 `/health/ready` |
| BFF | `npm run dev:bff` | HTTP 200 at port 3000 `/health/ready` |
| Audit | `npm run dev:audit` | `Attached to stock-audit durable consumer` log |
| Frontend | `npm run dev:frontend` | Open `http://localhost:4200` |

Product and Inventory must be ready before BFF readiness succeeds. The frontend displays a retry state if APIs are unavailable. The audit worker can start after stock operations because the durable consumer retains pending events.

Check readiness in PowerShell:

```powershell
Invoke-RestMethod http://localhost:3001/health/ready
Invoke-RestMethod http://localhost:3002/health/ready
Invoke-RestMethod http://localhost:3000/health/ready
```

Readiness returns `status: ready`; Inventory readiness also includes `pendingOutbox` and `natsConnected`. NATS being disconnected does not make stock commands unavailable when MongoDB is healthy. Create a product and follow the [walkthrough](walkthrough.md). No seed step is required; the initial database is empty. Subsequent starts retain products and movements.

### Stop and restart

Stop host applications with Ctrl+C. `docker compose down` stops infrastructure while retaining volumes. With WSL-only Docker, use:

```powershell
wsl --user root --exec docker compose -f /mnt/c/Projects/interview/docker-compose.yml down
```

To resume, start Compose, repeat setup and the primary check, then start the five processes. `npm run build` creates artifacts; it does not start servers or publish a hosted app. GitHub contains the source and runbook, while the running demo is local.

## Tested version matrix

| Component | Version / source |
| --- | --- |
| Node.js and npm used for verification | Node.js 22.16.0, npm 10.9.2 |
| Angular | 21.2 (`apps/frontend/package.json`) |
| NestJS | 12.1.2 |
| MongoDB Node driver | 7.7.0 |
| NATS JavaScript clients | 3.4.0 |
| Vitest and worker pool | Vitest 4.1.11; `piscina` 5.3.2 override for Angular build tooling |
| Compose MongoDB image | `mongo:8.0.20` (container verified) |
| Compose NATS image | `nats:2.15.0-alpine` (container verified) |
| Compose CLI used for verification | Docker Compose 2.40.3 in WSL Ubuntu |

Run `npm run build`, `npm test`, `npm run test -w @stockflow/frontend -- --watch=false`, `npm run check:boundaries`, `npm run check:docs`, `npm run verify:api`, `npm run verify:atomicity`, `npm run verify:dedup`, and `npm run verify:demo` after startup. Run the separate [NATS outage drill](#nats-outage-drill) when you need to exercise broker recovery. For a volume-restart proof, stop the audit worker, run `npm run verify:infrastructure-restart -- prepare`, record the event ID, run `docker compose down` then `docker compose up -d --wait`, run `npm run verify:infrastructure-restart -- check <eventId>`, restart the audit worker, and run `npm run verify:infrastructure-restart -- audit <eventId>`. See [verification evidence](../implementation/verification.md) for observed results.

## NATS outage drill

The repeatable NATS outage verifier proves stock commits independently of broker availability, then checks relay recovery and audit persistence:

1. Run `npm run verify:nats-outage -- prepare` and copy the Product ID it prints.
2. Stop only the NATS container with `docker compose stop nats`.
3. Run `npm run verify:nats-outage -- offline <productId>`. It must report a successful stock commit and one pending outbox event.
4. Restore NATS with `docker compose up -d --wait nats`.
5. Run `npm run verify:nats-outage -- recover <productId>`. It waits for the outbox PubAck and one matching audit record, then checks the balance, movement and event counts.

## Health and observation

Each HTTP service exposes `GET /health/live` for process liveness and `GET /health/ready` for required dependency readiness. BFF readiness checks its two upstream services; Product and Inventory check MongoDB. Inventory reports NATS connectivity and pending-outbox count separately because stock commands remain valid while NATS is temporarily down. The audit worker logs startup, JetStream consumer attachment, processed event IDs and failures. NATS monitoring and the `nats` CLI can show stream and consumer state; MongoDB queries can show pending outbox count and deduplicated audit rows.

The BFF propagates `X-Request-ID` to internal HTTP calls; response headers and error envelopes carry it. Automatic request logging is not implemented. The relay logs event ID, subject and PubAck stream/sequence; the worker logs attachment counts, audited and duplicate event IDs, errors and reconnect attempts. Public errors exclude credentials and raw stack traces. Stock HTTP success proves the MongoDB commit; audit completion is observed separately.

Run `npx tsx scripts/inspect-nats.ts` from the root for current stream-message, pending, acknowledgment-pending and redelivery counts. Inventory's `GET /health/ready` includes `pendingOutbox` and the publisher's `natsConnected` state. NATS monitoring is available at `http://localhost:8222/varz` and `http://localhost:8222/jsz`, bound to localhost by Compose. Worker attachment counts are a startup snapshot rather than continuous lag monitoring.

## Recovery guide

| Symptom | Check | Expected recovery |
| --- | --- | --- |
| `docker` is not recognized in PowerShell | Docker installation and WSL `docker compose version` | Use the WSL commands above if Docker is installed there |
| Port is already in use | Compose port errors or app `EADDRINUSE`; existing processes | Stop the conflicting process or update the app port and corresponding client/proxy URLs together |
| `npm ci` fails | Node/npm versions and lockfile installation error | Use the tested Node/npm versions and retry the locked install |
| `stock-audit` consumer is missing | Whether `setup:nats` completed | Run `npm run setup:nats`; the worker reconnects to the existing durable consumer |
| MongoDB transaction error | `rs.status()`, service URI and readiness | Ensure `rs0` is initialized and reachable; retry after dependency recovery |
| Product creation fails | Product Service readiness and `stockflow_product` connection | Restore Product Service or MongoDB, then resubmit |
| Inventory view fails | BFF and Inventory readiness | Show UI error; never display missing service data as zero |
| Stock action times out | Query by original idempotency key through retry of the same command | Return original result if committed; otherwise apply once |
| Outbox pending count grows | Inventory relay logs, NATS connectivity and JetStream stream | Restore NATS; relay republishes pending events |
| Audit lag grows | Durable consumer state, worker logs and audit MongoDB | Restore worker/database; unacknowledged messages redeliver |
| Duplicate event observed | Audit unique `eventId` index | A single stored audit row remains; investigate relay retries |

Official references: [MongoDB replica sets and transactions](https://www.mongodb.com/docs/manual/data-modeling/enforce-consistency/transactions/), [NATS JetStream](https://docs.nats.io/learn/jetstream/), and [Docker Compose](https://docs.docker.com/compose/).
