import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { parseEvent } from '../src/audit';

const event = { schemaVersion: 1, eventId: randomUUID(), eventType: 'StockAdded', movementId: randomUUID(), productId: randomUUID(), quantity: 1.25, resultingQuantity: 1.25, reason: 'Supplier delivery', occurredAt: new Date().toISOString() };
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));

describe('audit event boundary', () => {
  it('accepts a valid v1 event on its subject', () => expect(parseEvent(bytes(event), 'inventory.stock.added')).toEqual(event));
  it('rejects mismatched subject, unsupported version and invalid quantity', () => {
    expect(() => parseEvent(bytes(event), 'inventory.stock.removed')).toThrow();
    expect(() => parseEvent(bytes({ ...event, schemaVersion: 2 }), 'inventory.stock.added')).toThrow();
    expect(() => parseEvent(bytes({ ...event, quantity: 0 }), 'inventory.stock.added')).toThrow();
  });
});
