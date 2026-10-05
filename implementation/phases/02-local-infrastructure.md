# Phase 2 — Local infrastructure

## Goal and inputs

Make the required local dependencies reproducible before services persist data or publish events. This phase implements [local environment](../infrastructure/local-environment.md) and the infrastructure portions of [docs/operations.md](../../docs/operations.md), [docs/persistence.md](../../docs/persistence.md), and [docs/events.md](../../docs/events.md). It does not claim the application itself runs yet.

## Includes

Create a root Docker Compose file with only MongoDB and NATS. MongoDB runs as a persistent single-node `rs0` replica set reachable by the host-run apps at `localhost:27017`; NATS runs with file-backed JetStream, client port 4222 and local monitoring port 8222. Bind exposed ports to localhost. Add named volumes and health checks. Initialize the replica set once and make subsequent starts safe; do not reset volumes during ordinary startup.

Implement `setup:nats` so it idempotently creates file-backed `STOCK_EVENTS` for `inventory.stock.*` with WorkQueue retention, one replica and no automatic eviction of unacknowledged messages, plus the durable explicit-ack pull consumer `stock-audit` with retry backoff. Add environment examples for the Product, Inventory, BFF and Audit processes and Angular's `/api` proxy; validate required values on app startup as each app becomes functional. Do not put MongoDB or NATS URLs in the browser configuration.

## Implementation progress

- [x] Add pinned MongoDB and NATS images, named volumes, localhost port bindings and health checks to Compose.
- [x] Add and document one-time `rs0` initialization and an idempotent later-start check.
- [x] Implement `npm run setup:nats` with the stream, subjects, retention and durable consumer from [docs/events.md](../../docs/events.md).
- [x] Provide `.env.example` values for all processes and a frontend `/api` proxy, without secrets or user-specific paths.
- [x] Document the non-destructive startup order and a separate explicitly destructive local reset procedure.

## Exit gates

- [x] `docker compose up -d` starts healthy MongoDB and NATS; `rs.status()` reports the expected primary and a Node.js MongoDB transaction can commit on `rs0`.
- [x] JetStream reports `STOCK_EVENTS` with both subjects and the `stock-audit` durable consumer; running `setup:nats` twice leaves one stream and one consumer.
- [x] Restarting Compose without deleting volumes preserves a MongoDB test record and a pending JetStream test message.
- [x] Local ports are bound to `127.0.0.1`, and frontend configuration contains only the BFF target.

**Handoff:** Product and Inventory can use verified connection values and transactions; event publishing can be completed in Phase 5.
