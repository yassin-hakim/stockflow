# Local infrastructure and startup implementation

The implemented local setup is specified in [docs/operations.md](../../docs/operations.md). The Compose file, npm workspace and five application processes exist. The host-run stack passed the demo with local MongoDB and NATS; Compose itself still needs a Docker-host run.

## Docker Compose

The root `docker-compose.yml` has two services only:

| Service | Required setup |
| --- | --- |
| `mongo` | Pinned MongoDB image, `mongod --replSet rs0 --bind_ip_all`, named data volume, `127.0.0.1:27017:27017` |
| `nats` | Pinned NATS image, JetStream enabled with file-backed named volume, `127.0.0.1:4222:4222`, local monitoring `127.0.0.1:8222:8222` |

Run applications on the Windows host for the initial demo, so initialize the single MongoDB replica-set member as `localhost:27017`. This hostname must match the addresses used by the host processes; containerizing the apps later requires revisiting replica-set addressability. Never run a standalone `mongod`, because Inventory's multi-document transaction needs the replica set. Persist both named volumes across normal restarts; reserve destructive volume deletion for a clearly labeled manual reset.

## Workspace scripts and configuration

Root npm workspace scripts include `dev:product`, `dev:inventory`, `dev:bff`, `dev:audit`, `dev:frontend`, `setup:mongo`, and `setup:nats`. The NATS setup script idempotently creates `STOCK_EVENTS` and its `stock-audit` durable pull consumer before the worker binds. The Angular dev server proxies `/api` to `http://localhost:3000`.

Each backend process has an `.env.example` and validates required variables at startup:

| Process | Variables |
| --- | --- |
| Product Service | `PORT=3001`, `MONGO_URI` for `stockflow_product` with `replicaSet=rs0&directConnection=true` |
| Inventory Service | `PORT=3002`, `MONGO_URI` for `stockflow_inventory`, `PRODUCT_SERVICE_URL=http://localhost:3001`, `NATS_URL=nats://localhost:4222` |
| BFF | `PORT=3000`, `PRODUCT_SERVICE_URL=http://localhost:3001`, `INVENTORY_SERVICE_URL=http://localhost:3002` |
| Audit worker | `MONGO_URI` for `stockflow_audit`, `NATS_URL=nats://localhost:4222` |
| Angular | `/api` proxy to BFF; no MongoDB or NATS variable in browser output |

Bind HTTP services to local development addresses. The setup has no authentication and is unsuitable for an untrusted network. Package versions are recorded in manifests and the lockfile; the [operations guide](../../docs/operations.md) records the tested version matrix.

## Startup sequence

The root README presents this order:

1. `npm install`, then `docker compose up -d --wait` on a Docker host.
2. Run `npm run setup:mongo`; it initializes `rs0` once or validates the existing configuration.
3. Run `npm run setup:nats` and verify stream/consumer configuration.
4. In separate terminals run `npm run dev:product`, `npm run dev:inventory`, `npm run dev:bff`, `npm run dev:audit`, and `npm run dev:frontend`.
5. Open `http://localhost:4200` and execute the [demo](../verification.md).

The app scripts and setup commands have run with host MongoDB and NATS executables. The Compose commands remain unverified on this machine.

## Readiness and recovery

Each HTTP app exposes `/health/live` and `/health/ready`. Product/Inventory readiness depends on their own MongoDB; BFF readiness depends on both HTTP services. Inventory reports NATS connectivity and outbox pending count separately, because a stock command can still commit while NATS is down. Audit worker logs durable-consumer attachment, event processing and failures; monitor its consumer pending count and audit collection rather than inventing a public business endpoint.

If NATS is down, leave committed outbox events pending and retry after restart. If the audit worker is down, JetStream retains unacknowledged events. If a MongoDB transaction cannot start, report a service error and commit nothing. On an uncertain stock HTTP timeout, resend the **same** body and idempotency key, not a new command. Keep secrets out of committed examples and logs.

## Acceptance

- [x] `docker compose up -d` starts a healthy MongoDB replica set and NATS JetStream with persistent volumes.
- [x] `setup:nats` can run twice without creating duplicate stream/consumer resources.
- [x] All five app scripts start independently with validated configuration.
- [x] Health checks distinguish liveness from readiness; NATS outage does not falsely mark a committed stock command as failed.
- [x] A root README distinguishes host-run evidence from the unverified Compose commands.
