import { describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { PublishPendingEvents, type EventPublisher, type OutboxRepository, type PendingEvent } from '../src/application/publish-pending-events';

const eventId = randomUUID();
const event: PendingEvent = { eventId, subject: 'inventory.stock.added', attempts: 0, payload: { schemaVersion: 1, eventId, eventType: 'StockAdded', movementId: randomUUID(), productId: randomUUID(), quantity: 1, resultingQuantity: 1, reason: 'Test', occurredAt: new Date().toISOString() } };
function store(): OutboxRepository {
  return { findDue: vi.fn(async () => [event]), markPublished: vi.fn(async () => {}), markFailed: vi.fn(async () => {}) };
}

describe('outbox publication use case', () => {
  it('marks an event published only after publisher resolution', async () => {
    const outbox = store();
    const publisher: EventPublisher = { publish: vi.fn(async () => ({ stream: 'STOCK_EVENTS', sequence: 1 })) };
    const result = await new PublishPendingEvents(outbox, publisher).execute();
    expect(result.failures).toEqual([]);
    expect(result.published).toEqual([{ eventId: event.eventId, subject: event.subject, receipt: { stream: 'STOCK_EVENTS', sequence: 1 } }]);
    expect(publisher.publish).toHaveBeenCalledWith(event);
    expect(outbox.markPublished).toHaveBeenCalledWith(event.eventId);
    expect(outbox.markFailed).not.toHaveBeenCalled();
  });
  it('leaves failed publication pending and schedules a retry', async () => {
    const outbox = store();
    const publisher: EventPublisher = { publish: vi.fn(async () => { throw new Error('NATS unavailable'); }) };
    const before = Date.now();
    const result = await new PublishPendingEvents(outbox, publisher).execute();
    expect(result.failures).toHaveLength(1);
    expect(outbox.markPublished).not.toHaveBeenCalled();
    expect(outbox.markFailed).toHaveBeenCalledOnce();
    const next = vi.mocked(outbox.markFailed).mock.calls[0][1];
    expect(next.getTime()).toBeGreaterThanOrEqual(before + 1000);
  });
});
