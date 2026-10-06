import { TestBed } from '@angular/core/testing';
import { PendingSales } from './pending-sales';
import { STOCK_REQUEST_STORAGE } from '../core/pending-stock-commands';
describe('PendingSales recovery', () => {
  beforeEach(() => {
    sessionStorage.clear();
    TestBed.configureTestingModule({});
  });
  afterEach(() => sessionStorage.clear());
  const saleId = '11111111-1111-4111-8111-111111111111',
    key = '22222222-2222-4222-8222-222222222222';
  it('retains checkout body/key across instances and cannot overwrite unresolved input', () => {
    const command = {
      kind: 'CHECKOUT' as const,
      key,
      saleId,
      body: { expectedVersion: 2, tender: 'CASH' },
    };
    const store = TestBed.inject(PendingSales);
    store.save(command);
    expect(TestBed.runInInjectionContext(() => new PendingSales()).get()).toEqual(command);
    expect(() => store.save({ ...command, key: crypto.randomUUID() })).toThrow('Resolve');
    store.clear(crypto.randomUUID());
    expect(store.get()).toEqual(command);
    store.clear(key);
    expect(store.get()).toBeNull();
  });
  it('blocks corrupt saved payload and cannot fabricate a replacement identity', () => {
    sessionStorage.setItem(
      'stockflow:pending-sales:v1',
      JSON.stringify({ kind: 'CHECKOUT', key, saleId, body: { expectedVersion: 2 } }),
    );
    const store = TestBed.inject(PendingSales);
    expect(() => store.get()).toThrow('recovered');
    expect(() =>
      store.save({ kind: 'CHECKOUT', key, saleId, body: { expectedVersion: 2, tender: 'CASH' } }),
    ).toThrow('recovered');
  });
  it('refuses invalid refund selections and unavailable storage', () => {
    const store = TestBed.inject(PendingSales);
    expect(() =>
      store.save({
        kind: 'REFUND',
        key,
        saleId,
        body: { reason: 'Test', restock: false, lines: [{ saleLineId: saleId, quantity: 0 }] },
      }),
    ).toThrow('recovered');
    TestBed.resetTestingModule();
    TestBed.overrideProvider(STOCK_REQUEST_STORAGE, { useValue: null });
    expect(() => TestBed.inject(PendingSales).get()).toThrow('unavailable');
  });
  it('blocks dispatch when recovery identity cannot be written', () => {
    TestBed.overrideProvider(STOCK_REQUEST_STORAGE, {
      useValue: {
        getItem: () => null,
        setItem: () => {
          throw new Error('storage full');
        },
      },
    });
    expect(() =>
      TestBed.inject(PendingSales).save({
        kind: 'CHECKOUT',
        key,
        saleId,
        body: { expectedVersion: 2, tender: 'CASH' },
      }),
    ).toThrow('storage full');
  });
});
