# Local setup and operation

## Verified local topology

[Baseline evidence](../implementation/verification.md) records the original five-process app. The expansion adds Sales. Final expanded fresh-setup/restart/browser acceptance belongs in [expansion verification](../implementation/expansion/verification.md), separate from implementation and deployment claims.

Compose runs MongoDB `rs0` (localhost:27017) and JetStream-enabled NATS (4222, monitoring 8222) with named volumes. Six applications run as host processes:

| Process | Start command | Address/database |
| --- | --- | --- |
| Product | `npm run dev:product` | 3001 / `stockflow_product` |
| Inventory | `npm run dev:inventory` | 3002 / `stockflow_inventory` |
| Sales | `npm run dev:sales` | 3003 / `stockflow_sales` |
| BFF | `npm run dev:bff` | 3000; HTTP owners only |
| Audit | `npm run dev:audit` | Both durable consumers / `stockflow_audit` |
| Angular | `npm run dev:frontend` | `http://localhost:4200`; `/api` proxy |

Internal HTTP/monitoring ports bind locally. This unauthenticated setup is for trusted review, not public hosting. Each business owner accesses only its own database.

## Configuration contract

`npm run configure` creates five missing backend `.env` files and preserves existing ones. Inspect preserved files for new settings after upgrade.

| Process | Variables |
| --- | --- |
| Product | `PORT=3001`, owner `MONGO_URI`; optional `PRODUCT_CURRENCY` (fallback `CURRENCY`, then USD) |
| Inventory | `PORT=3002`, owner `MONGO_URI`, `PRODUCT_SERVICE_URL=http://localhost:3001`, `NATS_URL=nats://localhost:4222` |
| Sales | `PORT=3003`, owner `MONGO_URI`, `MONGO_DB=stockflow_sales`, `PRODUCT_URL=http://127.0.0.1:3001`, `INVENTORY_URL=http://127.0.0.1:3002`, `NATS_URL`, `CURRENCY=USD` |
| BFF | `PORT=3000`, `PRODUCT_SERVICE_URL`, `INVENTORY_SERVICE_URL`, `SALES_SERVICE_URL=http://localhost:3003` |
| Audit | owner `MONGO_URI`, `NATS_URL` |

Product/Inventory/Audit example URIs are `mongodb://localhost:27017/<owner_db>?replicaSet=rs0&directConnection=true`. Sales explicitly selects `MONGO_DB`. Product and Sales need the same supported two-decimal currency. Configuration changes do not convert old prices/receipts. Angular uses only its checked-in BFF proxy.

## Startup sequence

Use the delivered expansion checkout, Node >=22.16.0 <23, npm >=10.9.2 <11 and Docker Compose v2 supporting `--wait`. Historical clone success does not prove the expansion revision is published or freshly verified.

```sh
npm ci
npm run configure
docker compose up -d --wait
npm run setup:mongo
npm run migrate:inventory
npm run setup:nats
```

Mongo setup waits for writable `rs0`. Inventory migration is required for fresh and legacy databases before startup. NATS setup validates both `STOCK_EVENTS`/`stock-audit` and `SALES_EVENTS`/`sales-audit` while retaining messages. Start six terminals using the table. Fresh initialization supplies Main Store but no business seed. Follow [walkthrough](walkthrough.md).

## Complete setup commands

### Prerequisites and installation

Check Node/npm/Git/Compose versions; ports 3000–3003, 4200, 27017, 4222, 8222 must be free. `npm ci` supplies Angular/Nest/TypeScript/tsx/tests and driver clients; no global framework CLI or private account is needed. Obtain the explicitly delivered Git revision before these commands; the historical [review report](review-verification.md) concerns the smaller baseline.

### Infrastructure initialization

After startup commands, `docker compose exec -T mongo mongosh --quiet --eval 'db.hello().isWritablePrimary'` should print `true`. Setup can be repeated. Incompatible broker resources require investigation, not automatic recreation. The optional stock discard-policy upgrade is `node --import tsx scripts/setup-nats.ts --upgrade-discard-policy`; it validates other settings and preserves retained messages.

### Windows with Docker in WSL

```powershell
wsl --user root --exec docker compose -f /mnt/c/Projects/interview/docker-compose.yml up -d --wait
npm run setup:mongo
npm run migrate:inventory
npm run setup:nats
```

Use your checkout's WSL path and a user with Docker access. npm/applications run in PowerShell and must reach published localhost ports. Docker Desktop users can use normal Compose commands. Replica-set hostnames must resolve for host clients.

### Start the applications

Product/Inventory/Sales expose database readiness at `/health/ready`. Inventory additionally reports pending outbox/NATS connection. BFF readiness checks all three owners. Audit logs both consumer attachments. Readiness alone does not prove the connected workflow or event delivery.

For compiled backends run `npm run build`, then `npm run start -w @stockflow/<name>` in each backend terminal (`product-service`, `inventory-service`, `sales-service`, `bff`, `audit-worker`). Workspace scripts load `.env`; retain Angular dev server for the `/api` proxy. A build is not a startup/deployment.

### Stop and restart

Stop host processes with Ctrl+C. Ordinary `docker compose down` retains named volumes; repeat startup/setup validation and start six apps. Sales scans persisted pending workflows without browser participation; outbox relays and durable consumers catch up. `docker compose down -v` is a destructive reset deleting all local owner/broker data, not a normal stop.

## Inventory migration procedure

1. Stop Inventory writes and Sales dispatch/recovery; preserve a backup/copy and test legacy upgrade there first.
2. Confirm writable `rs0` and intended `MONGO_URI`. The CLI defaults to local Inventory; it does not read another workspace's `.env` override.
3. Run `npm run migrate:inventory`. Inspect sums/IDs/timestamps, old replay and pending v1 payloads; rerun without duplicates.
4. Start Inventory only with schema version 2 state `READY`, then Sales/clients. Check legacy Main Store and new location APIs.

For a custom PowerShell target set `$env:MONGO_URI` first. [Persistence](persistence.md) defines backups/index transitions and rollback limits. No automatic downgrade exists; v1 cannot preserve new multi-location data.

## Tested version matrix

Historical evidence used Node 22.16.0, npm 10.9.2, Compose 2.40.3 in WSL, MongoDB 8.0.20 and NATS 2.15.0. Current manifests use Angular 21.2, NestJS 12.1.2, driver 7.7.0, NATS JS 3.4.0 and Vitest 4.1.11. Current acceptance results are separate.

## NATS outage drill

Use original `verify:nats-outage -- prepare`, stop NATS, `-- offline <productId>`, restore NATS, then `-- recover <productId>`. This checks stock-only commit/publication/audit. Expanded acceptance also checks completed Sales/refund outcomes, both outboxes/streams and audit without duplicate business effects. Record controlled process/container interruption separately.

## Health and observation

`node --import tsx scripts/inspect-nats.ts` reads broker state. Local monitoring is `http://localhost:8222/varz` and `/jsz`. Owner operations/Sale/Refund DTOs prove business outcome; outbox/Audit proves notification delivery. Request IDs correlate BFF/internal HTTP and errors, while relay/worker logs carry event IDs. Automatic request logging is not implemented.

## Recovery guide

| Symptom | Recovery |
| --- | --- |
| Inventory schema refusal | Stop writers, verify migration/URI/state |
| Port/Docker/replica-set failure | Restore access/writable primary and align URLs |
| Uncertain stock command | Look up or deliberately resend original body/key |
| Stale count | Keep comparison; fresh snapshot and physical recount |
| Pending checkout/restock | Restore owner dependency; persisted recovery uses original key |
| Outbox/Audit backlog | Restore broker/capacity/worker/database; retain pending intent |
| Malformed/conflicting event | Investigate immutable payload; do not discard retained notification |
| Report source failure | Restore owner; show error without false zero |
| Currency mismatch | Match supported Product/Sales configuration without converting old records |

See [API](api.md), [events](events.md), [testing](testing.md) and [review guide](review-guide.md). Deployment remains separate work.
