# Audit worker implementation

## Responsibility

Build `apps/audit-worker` as a separate NestJS application context, with no public business HTTP API. It proves that another process consumes Inventory integration events asynchronously. It owns `stockflow_audit.stock_events`, not balances or movements. Follow the [event contract](../../docs/events.md) and [persistence ownership](../../docs/persistence.md).

## Startup and consumer

After `setup:nats` has created `STOCK_EVENTS` and the durable pull consumer `stock-audit`, connect the official NATS JavaScript transport/JetStream client and bind the existing consumer. Process one message at a time in the local demo. Use explicit acknowledgment; let JetStream redeliver with the configured 1 s, 5 s, 30 s and 5 min backoff until acknowledgment. A worker restart must resume the same durable consumer rather than create a new ephemeral subscription.

## Event handling

`HandleStockEvent` validates UTF-8 JSON, `schemaVersion: 1`, subject/type agreement, UUID IDs, valid positive three-decimal quantity, reason, resulting quantity and UTC occurrence time. Map it to an AuditRepository port. The MongoDB adapter upserts by event ID and stores the full envelope plus `receivedAt`. An identical duplicate is success and may be acknowledged; a reused ID with different payload is a contract violation and must remain unacknowledged for investigation.

Acknowledge only after the audit write commits. If MongoDB is unavailable, the event is malformed, or the schema version is unsupported, log the stream sequence and event ID when available, leave it unacknowledged, and surface a clear worker failure signal. Do not silently discard poison messages. The worker never calls Product Service and never mutates Inventory. Audited data is not exposed through a new user-facing reporting API in v1; the demo inspects the collection and worker logs.

## Configuration and observation

Validate `MONGO_URI` for `stockflow_audit` and `NATS_URL` at startup. Log consumer attachment, event ID, subject, insert-versus-duplicate outcome, acknowledgment and processing failure. Keep credentials out of logs. Provide a lightweight process status log or local diagnostic command in the runbook, rather than a public business controller. NATS consumer pending count and the audit collection are the authoritative delivery evidence.

## Verification

- [x] A real `StockAdded` and `StockRemoved` event each create one audit row with the documented envelope.
- [x] Worker-offline events arrive after restart through the durable consumer.
- [x] Duplicate identical events leave one row; different payload with the same ID is flagged and not acknowledged.
- [x] MongoDB outage causes no acknowledgment and eventual redelivery after recovery.
- [x] Unsupported or malformed payloads are visible for investigation and never counted as successfully audited.
