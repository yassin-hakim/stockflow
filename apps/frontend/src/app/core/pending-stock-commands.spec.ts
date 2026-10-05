import { TestBed } from '@angular/core/testing';
import { PendingStockCommands, STOCK_REQUEST_STORAGE } from './pending-stock-commands';

const productId = '11111111-1111-4111-8111-111111111111';
const key = '22222222-2222-4222-8222-222222222222';
describe('PendingStockCommands', () => {
  beforeEach(() => {
    sessionStorage.clear();
    TestBed.configureTestingModule({});
  });
  afterEach(() => sessionStorage.clear());
  it('retains a command for a new service instance and clears only its own key', () => {
    const command = { productId, type: 'add' as const, quantity: 1.001, reason: 'Delivery', key };
    const store = TestBed.inject(PendingStockCommands);
    store.save(command);
    const recreated = TestBed.runInInjectionContext(() => new PendingStockCommands());
    expect(recreated.get(productId)).toEqual(command);
    recreated.clear(productId, crypto.randomUUID());
    expect(recreated.get(productId)).toEqual(command);
    recreated.clear(productId, key);
    expect(store.get(productId)).toBeNull();
  });
  it('refuses to overwrite an unresolved command with a new key', () => {
    const store = TestBed.inject(PendingStockCommands);
    store.save({ productId, type: 'remove', quantity: 1, reason: 'Order', key });
    expect(() =>
      store.save({
        productId,
        type: 'add',
        quantity: 1,
        reason: 'Delivery',
        key: crypto.randomUUID(),
      }),
    ).toThrow('earlier');
  });
  it('fails closed on malformed saved data', () => {
    sessionStorage.setItem(`stockflow:pending-stock:v1:${productId}`, '{bad json');
    expect(() => TestBed.inject(PendingStockCommands).get(productId)).toThrow();
  });
  it('fails closed when browser storage is unavailable', () => {
    TestBed.overrideProvider(STOCK_REQUEST_STORAGE, { useValue: null });
    expect(() => TestBed.inject(PendingStockCommands).get(productId)).toThrow('unavailable');
  });
});
