import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { BffApi } from '../core/bff-api';
import { ProductDetail } from './product-detail';
import { PendingStockCommands, STOCK_REQUEST_STORAGE } from '../core/pending-stock-commands';

const productId = '11111111-1111-4111-8111-111111111111';
const overview = {
  product: {
    id: productId,
    name: 'Coffee',
    unit: 'kg',
    category: 'Coffee',
    lowStockThreshold: 5,
    createdAt: '',
    updatedAt: '',
  },
  quantity: 40,
  status: 'OK' as const,
};

describe('ProductDetail retry behavior', () => {
  beforeEach(() => sessionStorage.clear());
  afterEach(() => sessionStorage.clear());
  it('reuses the same key after an uncertain failure and blocks a changed command', async () => {
    const keys: string[] = [];
    let calls = 0;
    const api = {
      getInventory: async () => overview,
      getMovements: async () => ({ items: [] }),
      changeStock: async (_id: string, _type: string, _body: unknown, key: string) => {
        keys.push(key);
        calls++;
        if (calls === 1) throw new HttpErrorResponse({ status: 0 });
        return {
          productId,
          quantity: 41,
          movement: {
            id: 'movement-1',
            productId,
            type: 'ADD',
            quantity: 1,
            reason: 'Delivery',
            createdAt: '',
          },
        };
      },
    };
    await TestBed.configureTestingModule({
      imports: [ProductDetail],
      providers: [
        provideRouter([]),
        { provide: BffApi, useValue: api },
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: { get: () => productId } } } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(ProductDetail);
    await fixture.whenStable();
    const component = fixture.componentInstance;
    component.addForm.setValue({ quantity: 1, reason: 'Delivery' });
    await component.submit('add');
    expect(component.uncertain()).toBe(true);
    component.addForm.setValue({ quantity: 2, reason: 'Changed' });
    await component.submit('add');
    expect(keys).toHaveLength(1);
    component.addForm.setValue({ quantity: 1, reason: 'Delivery' });
    await component.submit('add');
    expect(keys).toHaveLength(2);
    expect(keys[1]).toBe(keys[0]);
    expect(component.uncertain()).toBe(false);
  });
  it('marks and focuses an invalid stock quantity without sending a command', async () => {
    let calls = 0;
    const api = {
      getInventory: async () => overview,
      getMovements: async () => ({ items: [] }),
      changeStock: async () => {
        calls++;
      },
    };
    await TestBed.configureTestingModule({
      imports: [ProductDetail],
      providers: [
        provideRouter([]),
        { provide: BffApi, useValue: api },
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: { get: () => productId } } } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(ProductDetail);
    await fixture.whenStable();
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.addForm.setValue({ quantity: 1.0001, reason: 'Delivery' });
    await component.submit('add');
    fixture.detectChanges();
    await Promise.resolve();
    expect(calls).toBe(0);
    expect(component.validation()).toBe('add-quantity');
    expect(fixture.nativeElement.querySelector('#add-quantity').getAttribute('aria-invalid')).toBe(
      'true',
    );
  });
  it('sends one command while a stock submission is pending', async () => {
    let calls = 0;
    let resolve!: (value: unknown) => void;
    const pending = new Promise((resolveResult) => {
      resolve = resolveResult;
    });
    const api = {
      getInventory: async () => overview,
      getMovements: async () => ({ items: [] }),
      changeStock: async () => {
        calls++;
        return pending;
      },
    };
    await TestBed.configureTestingModule({
      imports: [ProductDetail],
      providers: [
        provideRouter([]),
        { provide: BffApi, useValue: api },
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: { get: () => productId } } } },
      ],
    }).compileComponents();
    const component = TestBed.createComponent(ProductDetail).componentInstance;
    await Promise.resolve();
    component.addForm.setValue({ quantity: 1, reason: 'Delivery' });
    const first = component.submit('add');
    await component.submit('add');
    expect(calls).toBe(1);
    resolve({
      productId,
      quantity: 41,
      movement: {
        id: 'movement-1',
        productId,
        type: 'ADD',
        quantity: 1,
        reason: 'Delivery',
        createdAt: '',
      },
    });
    await first;
  });
  it('restores the original command and key after a fresh Angular context', async () => {
    const keys: string[] = [];
    let fail = true;
    const api = {
      getInventory: async () => overview,
      getMovements: async () => ({ items: [] }),
      changeStock: async (_id: string, _type: string, _body: unknown, key: string) => {
        keys.push(key);
        if (fail) throw new HttpErrorResponse({ status: 0 });
        return {
          productId,
          quantity: 41,
          movement: {
            id: 'movement',
            productId,
            type: 'ADD',
            quantity: 1,
            reason: 'Original',
            createdAt: '',
          },
        };
      },
    };
    const configure = () =>
      TestBed.configureTestingModule({
        imports: [ProductDetail],
        providers: [
          provideRouter([]),
          { provide: BffApi, useValue: api },
          {
            provide: ActivatedRoute,
            useValue: { snapshot: { paramMap: { get: () => productId } } },
          },
        ],
      }).compileComponents();
    await configure();
    const first = TestBed.createComponent(ProductDetail);
    await first.whenStable();
    first.componentInstance.addForm.setValue({ quantity: 1, reason: 'Original' });
    await first.componentInstance.submit('add');
    first.destroy();
    TestBed.resetTestingModule();
    await configure();
    const restored = TestBed.createComponent(ProductDetail);
    await restored.whenStable();
    expect(restored.componentInstance.uncertain()).toBe(true);
    expect(restored.componentInstance.addForm.getRawValue()).toEqual({
      quantity: 1,
      reason: 'Original',
    });
    restored.componentInstance.removeForm.setValue({ quantity: 1, reason: 'Different action' });
    await restored.componentInstance.submit('remove');
    expect(keys).toHaveLength(1);
    fail = false;
    await restored.componentInstance.submit('add');
    expect(keys).toEqual([keys[0], keys[0]]);
    expect(TestBed.inject(PendingStockCommands).get(productId)).toBeNull();
  });
  it('persists the command before the HTTP call begins', async () => {
    const api = {
      getInventory: async () => overview,
      getMovements: async () => ({ items: [] }),
      changeStock: async (_id: string, _type: string, _body: unknown, key: string) => {
        expect(TestBed.inject(PendingStockCommands).get(productId)?.key).toBe(key);
        throw new HttpErrorResponse({ status: 0 });
      },
    };
    await TestBed.configureTestingModule({
      imports: [ProductDetail],
      providers: [
        provideRouter([]),
        { provide: BffApi, useValue: api },
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: { get: () => productId } } } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(ProductDetail);
    await fixture.whenStable();
    fixture.componentInstance.addForm.setValue({
      quantity: 134217728.001,
      reason: 'Large valid quantity',
    });
    await fixture.componentInstance.submit('add');
    expect(fixture.componentInstance.validation()).toBe('');
    expect(fixture.componentInstance.uncertain()).toBe(true);
  });
  it('sends no request when durable storage cannot be written', async () => {
    const changeStock = vi.fn();
    const storage = {
      getItem: () => null,
      setItem: () => {
        throw new Error('Storage full');
      },
    };
    const api = {
      getInventory: async () => overview,
      getMovements: async () => ({ items: [] }),
      changeStock,
    };
    await TestBed.configureTestingModule({
      imports: [ProductDetail],
      providers: [
        provideRouter([]),
        { provide: STOCK_REQUEST_STORAGE, useValue: storage },
        { provide: BffApi, useValue: api },
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: { get: () => productId } } } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(ProductDetail);
    await fixture.whenStable();
    fixture.componentInstance.addForm.setValue({ quantity: 1, reason: 'Delivery' });
    await fixture.componentInstance.submit('add');
    expect(changeStock).not.toHaveBeenCalled();
    expect(fixture.componentInstance.actionError()).toContain('no request was sent');
  });
  it('renders distinct add/remove forms and connects native submit events', async () => {
    const changeStock = vi.fn(async () => ({ productId, quantity: 39 }));
    const api = {
      getInventory: async () => overview,
      getMovements: async () => ({ items: [] }),
      changeStock,
    };
    await TestBed.configureTestingModule({
      imports: [ProductDetail],
      providers: [
        provideRouter([]),
        { provide: BffApi, useValue: api },
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: { get: () => productId } } } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(ProductDetail);
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('#add-quantity')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('#remove-quantity')).not.toBeNull();
    fixture.componentInstance.removeForm.setValue({ quantity: 1, reason: 'Order' });
    fixture.nativeElement
      .querySelectorAll('form')[1]
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await fixture.whenStable();
    expect(changeStock).toHaveBeenCalledWith(
      productId,
      'remove',
      { quantity: 1, reason: 'Order' },
      expect.any(String),
    );
  });
});
