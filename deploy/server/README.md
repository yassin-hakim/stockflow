# StockFlow IP deployment

Public app: http://52.1.135.53

This deployment uses the server's existing Nginx and Node.js 22 runtime. MongoDB
8.0.20 and NATS 2.15.0 were installed as private binaries under `/opt/stockflow`;
their official download checksums were verified. No Docker installation or
global Node/npm changes were needed.

The existing `devutils.click` Nginx configuration is unchanged. Its checksum,
the original listening ports and running service inventory are saved in
`/opt/stockflow/baseline`. Only Nginx was gracefully reloaded. Existing PM2
applications, MySQL and PostgreSQL were not stopped or replaced.

| Component | Service | Address |
| --- | --- | --- |
| Angular frontend and API proxy | Existing Nginx, additional `stockflow-ip.conf` | `http://52.1.135.53` |
| BFF | `stockflow-bff` | `127.0.0.1:3100` |
| Product Service | `stockflow-product` | `127.0.0.1:3101` |
| Inventory Service | `stockflow-inventory` | `127.0.0.1:3102` |
| Sales Service | `stockflow-sales` | `127.0.0.1:3103` |
| Audit worker | `stockflow-audit` | No HTTP listener |
| MongoDB replica set `rs0` | `stockflow-mongo` | `127.0.0.1:27117` |
| NATS JetStream | `stockflow-nats` | `127.0.0.1:4322` |
| NATS monitoring | `stockflow-nats` | `127.0.0.1:8322` |

Application files: `/opt/stockflow/app`. Persistent data:
`/opt/stockflow/data/mongo` and `/opt/stockflow/data/nats`. Each application has
its own protected `.env`. All seven application and infrastructure systemd services are enabled on boot, restart
on failure, and run as the dedicated `stockflow` user with memory limits.

## Checks performed

- Production build, 90 backend tests and 20 Angular tests passed locally.
- Public-IP integration checks passed: 0 → 50 → 40, overdraft rejection,
  idempotent replay, conflicting replay, concurrent removal and concurrent first
  stock additions. Movements, outbox events and audit records were checked in MongoDB.
- A real browser created Arabica Coffee, added 50 kg, removed 10 kg and rejected
  removing another 50 kg. Final balance remained 40 kg with two movements.
- The public HTTP address lacks `crypto.randomUUID`. A tested
  `crypto.getRandomValues` UUID v4 fallback enables stock submissions while
  retaining their saved idempotency keys.
- Stock commits and pending outbox records survived NATS downtime. Reconnection
  and audit delivery recovered automatically.
- MongoDB stock and an unconsumed JetStream event survived restarting the new
  infrastructure. The event was audited once after starting the audit worker.
- Only StockFlow services were restarted for recovery testing. The whole server
  was not rebooted, to preserve existing applications.

Server recovery report: `/opt/stockflow/data/verification-report.json`.
Verification products remain in the new StockFlow database alongside the browser
demo product. The deployment retains the application's existing demo access
model: HTTP on the IP address with no application login.

## Operations

Run on the server:

```sh
sudo systemctl status stockflow-{mongo,nats,product,inventory,bff,audit} --no-pager
curl -fsS http://52.1.135.53/health/ready
sudo journalctl -u stockflow-inventory -u stockflow-audit -n 100 --no-pager
```

`/health/ready` checks BFF upstream readiness. Inventory's internal readiness
response also shows `pendingOutbox` and `natsConnected`; the publisher connects
lazily, so `natsConnected` can be false immediately after startup before any
stock event needs publication.

The deployment installer is for a **first installation only**. It aborts if
the deployment directory, service user, IP site configuration or required ports
already exist. Do not rerun it to update this server. The archive includes
precompiled application assets, and npm is installed under StockFlow's own
tooling directory to preserve the host's existing npm version.

For a new server with a compatible Node 22 runtime and existing Nginx:

```sh
# Locally, from the repository root:
npm ci
npm run build
node deploy/server/package.cjs
# Upload the generated archive, then run install.sh as root on that new server.
```

`verify-recovery.cjs` creates test products and briefly restarts only StockFlow
services. Run it only during a maintenance window when repeat recovery testing
is intended; it never controls other server applications.

For this already-installed server, build a new archive and use the update
script. It preserves the existing application environment files, records the
pre-update service and port inventory, runs the inventory migration while
StockFlow writers are stopped, configures the Sales service on port 3103, and
checks that the existing `devutils.click` Nginx checksum is unchanged:

```sh
# Locally, from the repository root:
npm ci
npm run build
node deploy/server/package.cjs
# Upload stockflow.tar.gz and deploy/server/update.sh to /home/ubuntu.
# On the server:
sudo bash /home/ubuntu/update.sh /home/ubuntu/stockflow.tar.gz
```
