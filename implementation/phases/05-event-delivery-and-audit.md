# Phase 5 — Event delivery and audit worker

## Goal and inputs

Complete the required asynchronous path from a committed Inventory change to an independent persisted audit record. Inventory already writes outbox rows in Phase 4; Phase 2 created JetStream resources. Implement the [stock consistency path](../architecture/stock-consistency.md), [Inventory relay](../services/inventory-service.md), [audit worker](../services/audit-worker.md), and [event contract](../../docs/events.md).

## Includes

Add `PublishPendingEvents` and an Inventory infrastructure relay that polls up to 100 due pending rows every 500 ms. Publish the stored version-1 payload on `inventory.stock.added` or `inventory.stock.removed`, set JetStream message ID to the stable `eventId`, await `PubAck`, then mark the row published. On failure, leave it pending and record the retry schedule of 1 s, 5 s, 30 s, then 5 min. Run one relay instance in the local design. A crash after PubAck may republish, so do not promise exactly-once transport.

Build `apps/audit-worker` as a separate NestJS application context. Bind the existing `stock-audit` durable pull consumer on the file-backed WorkQueue `STOCK_EVENTS` stream. Validate subject/type, schema version, IDs, quantities, reason and UTC time. Persist the full envelope plus receive time in `stockflow_audit.stock_events`, keyed by event ID. Acknowledge only after a successful insert or an identical duplicate. Different content under the same ID, malformed payloads and unsupported versions are logged and left unacknowledged for investigation. No audit reporting API or new business context is added.

## Implementation progress

- [x] Implement NatsEventPublisher behind the EventPublisher port and a relay with pending-row polling, PubAck, published marking and retry metadata.
- [x] Start relay as an Inventory Service infrastructure provider without moving publish calls into the domain or MongoDB transaction.
- [x] Implement the audit worker's HandleStockEvent use case, AuditRepository port and MongoDB adapter.
- [x] Bind durable consumer `stock-audit`, validate v1 envelopes and acknowledge only after audit persistence.
- [x] Add logs/diagnostics for event ID, subject, outbox pending count, consumer lag, duplicate and processing failure.
- [x] Add real JetStream/MongoDB verifiers; document and execute the outage/restart scenarios against the running infrastructure.

## Exit gates

- [x] An ADD and a REMOVE each produce one JetStream PubAck and one audit row with correct v1 event fields and distinct stable IDs.
- [x] With NATS stopped, stock HTTP still succeeds after MongoDB commit and outbox rows remain pending; restarting NATS drains them into audit.
- [x] With the audit worker stopped, JetStream holds the event; restarting the **same durable consumer** processes it.
- [x] Duplicate delivery leaves one identical audit row; different payload under an existing event ID is flagged and not acknowledged.
- [x] With audit MongoDB unavailable, the worker does not acknowledge; after recovery, redelivery persists the event once.
- [x] Inventory domain/application import checks prove no direct NATS dependency, and invalid/insufficient commands emit no successful stock event.

**Handoff:** The backend has independently owned Product, Inventory and Audit data with both synchronous and asynchronous communication ready for the BFF.
