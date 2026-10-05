# NATS stock-event design

## Role of NATS

Stock changes are synchronous HTTP commands, but their audit notification is asynchronous. Inventory domain code creates `StockAdded` or `StockRemoved` after a valid change; the Inventory Service persists the event intent in its MongoDB outbox. An infrastructure relay publishes it to **NATS JetStream**. A separate audit worker consumes and stores it. Domain code produces plain event data; the application use case `PublishPendingEvents` depends on an `EventPublisher` port without importing NATS types.

Core NATS delivers only to connected subscribers and is at-most-once. JetStream stores events for a durable consumer and supports acknowledgments and redelivery. The MongoDB outbox closes the gap between committing stock and attempting to publish. JetStream still permits duplicates after retries, so the consumer is idempotent. See [Core NATS](https://docs.nats.io/learn/core-nats/) and [JetStream](https://docs.nats.io/learn/jetstream/).

## Subjects, stream and consumer

| Domain event | JetStream subject | Meaning |
| --- | --- | --- |
| `StockAdded` | `inventory.stock.added` | A positive quantity was added. |
| `StockRemoved` | `inventory.stock.removed` | A positive quantity was removed. |

The file-backed stream `STOCK_EVENTS` captures `inventory.stock.*` with **WorkQueue retention**, one replica, and no automatic age or message-count eviction. Its only consumer is the durable pull consumer `stock-audit`, with explicit acknowledgments, delivery from the earliest pending event on first creation, and redelivery backoff of 1 s, 5 s, 30 s, then 5 min until acknowledged. The local worker processes one message at a time. An acknowledged message leaves the work queue; the audit database is the durable application record. If storage fills, publication fails and the Inventory outbox remains pending until capacity is restored.

`setup:nats` must create these resources idempotently and compare existing resource settings with this contract. An incompatible existing stream or consumer is a startup/configuration error to report, not a reason to delete retained messages. Configure unlimited delivery attempts and no age-based eviction; available disk capacity remains an operational limit. Set a finite JetStream duplicate window for `eventId` message IDs, while retaining audit-store deduplication as the correctness guarantee beyond that window. See the [JetStream stream and consumer concepts](https://docs.nats.io/learn/jetstream/).

## Integration-event contract, version 1

Publish UTF-8 JSON. `eventId` is created once with the movement and remains stable across outbox retries. `schemaVersion` allows a future consumer to reject an unknown format. `quantity` and `resultingQuantity` are expressed in the Product unit, with at most three decimal places.

```json
{
  "schemaVersion": 1,
  "eventId": "55555555-5555-4555-8555-555555555555",
  "eventType": "StockAdded",
  "movementId": "33333333-3333-4333-8333-333333333333",
  "productId": "11111111-1111-4111-8111-111111111111",
  "quantity": 50,
  "resultingQuantity": 50,
  "reason": "Supplier delivery",
  "occurredAt": "2026-10-04T18:00:00.000Z"
}
```

`eventType` must match the subject; `quantity` is positive for both types. `occurredAt` is the same instant as the movement's `createdAt`. The event describes the committed stock change without exposing MongoDB records or internal domain objects. The audit worker stores the whole validated envelope plus `receivedAt`; it need not call Product Service merely to record an event. No `StockRemoved` message is created for a rejected removal.

## Transactional outbox and relay

The stock use case atomically writes InventoryItem, StockMovement and a `PENDING` outbox row in one Inventory MongoDB transaction. The outbox `_id` equals `eventId`; it stores the subject and serialized version-1 payload. The HTTP response is successful after this commit, even if the relay has not published yet.

The Inventory Service relay polls due `PENDING` rows every 500 ms in batches of at most 100. In this local design there is one Inventory Service instance and one relay, so no distributed lease is required. For each row it publishes through the official NATS JavaScript transport and JetStream packages, sets the NATS message ID to `eventId`, waits for `PubAck`, then marks the row `PUBLISHED` with `publishedAt`. On failure it increments `attempts`, records the next due time using the bounded schedule (1 s, 5 s, 30 s, then 5 min for later attempts), and logs the event ID and cause. An outage must leave the record pending, never silently discard it.

If the process crashes after `PubAck` but before marking the row published, it may publish again. NATS message-ID deduplication is useful within its configured duplicate window but is not the application's only safeguard; the audit database has a unique event ID. No exactly-once transport claim is made.

## Audit consumer

The worker's `parseEvent` validates JSON, version, subject/type agreement, UUIDs, positive three-decimal quantity, reason, resulting quantity and UTC time. `HandleStockEvent` delegates persistence to `AuditRepository`. `MongoAuditRepository` inserts into `stockflow_audit.stock_events` with `_id = eventId`. On duplicate-key failure, it reads the existing event and compares the full payload. It acknowledges only after a successful write or an identical previously stored payload. The same ID with different payload is a contract violation: log it and leave the message unacknowledged for investigation. If persistence fails it also leaves the message unacknowledged; JetStream redelivers according to consumer backoff. Unsupported versions or malformed messages produce an `Event left unacknowledged` error log and remain pending for operator resolution. Current failure logs do not include stream sequence metadata; successful and duplicate-processing logs include event IDs.

## Observable states and failure tests

| Situation | Expected observation |
| --- | --- |
| Add or remove commits | One movement and one pending outbox row, then one audit row eventually |
| Invalid or insufficient removal | No changed balance, movement, outbox row or event |
| NATS down during command | HTTP success after MongoDB commit; pending outbox count rises; audit catches up after restart |
| Audit worker down | JetStream retains event; worker consumes after restart |
| Relay repeats publish | Audit row count remains one for the event ID |
| Audit MongoDB down | Message is not acknowledged; redelivery later inserts it |

The operations guide defines pending-outbox and consumer-lag checks. The [testing guide](testing.md) makes these cases acceptance tests. NATS server and JetStream are the required messaging technology; Kafka, Redis and a second broker are not part of this design.
