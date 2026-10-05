# Local operation and deployment design

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

Use a propagated `requestId` for the Angular→BFF→service HTTP path and log product ID, movement ID, event ID and idempotency key at appropriate boundaries. Do not log full database credentials or raw stack traces to the browser. A successful stock HTTP response proves the MongoDB commit; audit completion is observed separately.

## Recovery guide

| Symptom | Check | Expected recovery |
| --- | --- | --- |
| MongoDB transaction error | `rs.status()`, service URI and readiness | Ensure `rs0` is initialized and reachable; retry after dependency recovery |
| Product creation fails | Product Service readiness and `stockflow_product` connection | Restore Product Service or MongoDB, then resubmit |
| Inventory view fails | BFF and Inventory readiness | Show UI error; never display missing service data as zero |
| Stock action times out | Query by original idempotency key through retry of the same command | Return original result if committed; otherwise apply once |
| Outbox pending count grows | Inventory relay logs, NATS connectivity and JetStream stream | Restore NATS; relay republishes pending events |
| Audit lag grows | Durable consumer state, worker logs and audit MongoDB | Restore worker/database; unacknowledged messages redeliver |
| Duplicate event observed | Audit unique `eventId` index | A single stored audit row remains; investigate relay retries |

Official references: [MongoDB replica sets and transactions](https://www.mongodb.com/docs/manual/data-modeling/enforce-consistency/transactions/), [NATS JetStream](https://docs.nats.io/learn/jetstream/), and [Docker Compose](https://docs.docker.com/compose/).
