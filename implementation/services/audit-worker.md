# Audit worker implementation

## Responsibility

Build `apps/audit-worker` as a separate NestJS application context, with no public business HTTP API. It proves that another process consumes Inventory integration events asynchronously. It owns `stockflow_audit.stock_events`, not balances or movements. Follow the [event contract](../../docs/events.md) and [persistence ownership](../../docs/persistence.md).

## Startup and consumer

After `setup:nats` has created `STOCK_EVENTS` and the durable pull consumer `stock-audit`, connect the official NATS JavaScript transport/JetStream client and bind the existing consumer. Process one message at a time in the local demo. Use explicit acknowledgment; let JetStream redeliver with the configured 1 s, 5 s, 30 s and 5 min backoff until acknowledgment. A worker restart must resume the same durable consumer rather than create a new ephemeral subscription.

## Event handling

`parseEvent` in `audit.ts` validates UTF-8 JSON, `schemaVersion: 1`, subject/type agreement, UUID IDs, valid positive three-decimal quantity, reason, resulting quantity and UTC occurrence time. `HandleStockEvent.execute` receives the validated envelope and delegates to the `AuditRepository` port. `MongoAuditRepository.save` inserts with `_id = eventId` and stores the full envelope plus `receivedAt`. On duplicate-key failure it compares the previous payload. An identical duplicate is success and may be acknowledged; a reused ID with different payload is a contract violation and remains unacknowledged for investigation.

Acknowledge only after the audit write succeeds. If MongoDB is unavailable, the event is malformed, or the schema version is unsupported, the consumer logs `Event left unacknowledged` with the error and leaves it pending for redelivery. Current failure logs do not include stream sequence metadata. The worker never calls Product Service and never mutates Inventory. Audited data is not exposed through a user-facing reporting API in v1; the demo inspects the collection and worker logs.

## Configuration and observation

Startup validates `MONGO_URI` for `stockflow_audit` and `NATS_URL`. Logs show durable-consumer attachment with initial pending and acknowledgment-pending counts, audited event IDs, duplicate IDs, processing failures and reconnect attempts. `scripts/inspect-nats.ts` reports current consumer counts; the audit collection proves persistence. There is no public business controller or continuous metrics exporter.

## Verification

- [x] A real `StockAdded` and `StockRemoved` event each create one audit row with the documented envelope.
- [x] Worker-offline events arrive after restart through the durable consumer.
- [x] Duplicate identical events leave one row; different payload with the same ID is flagged and not acknowledged.
- [x] MongoDB outage causes no acknowledgment and eventual redelivery after recovery.
- [x] Unsupported or malformed payloads are visible for investigation and never counted as successfully audited.
