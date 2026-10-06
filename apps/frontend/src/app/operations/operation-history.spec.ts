import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import type { Sale, StockOperation } from '@stockflow/contracts';
import { BffApi } from '../core/bff-api';
import { OperationHistory } from './operation-history';

const productId = '690f6eea-efa1-4e64-af1c-d39e405ce72d';
const locationId = '68c46fb7-785d-4ba4-9000-1e52b32845c7';
const operationId = 'b830160b-44de-462c-baa6-3b7cfebe51cf';
const saleId = 'ce82a453-fabb-45cd-bbf3-6f22070aae08';
const createdAt = '2026-10-06T14:14:07.000Z';
const operation: StockOperation = {
  id: operationId,
  kind: 'SALE',
  status: 'REJECTED',
  createdAt,
  reference: saleId,
  reason: `Sale ${saleId}`,
  locationId,
  movements: [],
  error: {
    code: 'INSUFFICIENT_STOCK',
    message: `Insufficient stock for product ${productId}. No lines were changed.`,
  },
};
const sale: Sale = {
  id: saleId,
  status: 'REJECTED',
  locationId,
  createdAt,
  updatedAt: createdAt,
  currency: 'USD',
  version: 2,
  totalMinor: 450,
  tender: 'CASH',
  receiptReference: null,
  lines: [
    {
      id: operationId,
      menuItemId: operationId,
      name: 'Latte',
      quantity: 1,
      priceMinor: 450,
      totalMinor: 450,
      recipeRevision: 2,
      ingredients: [{ productId, name: 'Milk', unit: 'l', quantity: 0.3 }],
    },
  ],
};

function apiFixture() {
  return {
    listLocations: vi.fn(async () => ({
      items: [{ id: locationId, name: 'Bar', version: 0, createdAt, updatedAt: createdAt }],
    })),
    listProducts: vi.fn(async () => ({
      items: [
        {
          id: productId,
          name: 'Milk',
          unit: 'l',
          category: 'Dairy',
          lowStockThreshold: 2,
          createdAt,
        },
      ],
    })),
    getOperation: vi.fn(async () => structuredClone(operation)),
    getSale: vi.fn(async () => structuredClone(sale)),
    listOperations: vi.fn(async () => ({ items: [structuredClone(operation)], nextCursor: null })),
    listCounts: vi.fn(async () => ({ items: [], nextCursor: null })),
  };
}

async function page(api = apiFixture(), id: string | null = operationId) {
  await TestBed.configureTestingModule({
    imports: [OperationHistory],
    providers: [
      provideRouter([]),
      { provide: BffApi, useValue: api },
      {
        provide: ActivatedRoute,
        useValue: { snapshot: { paramMap: convertToParamMap(id ? { id } : {}) } },
      },
    ],
  }).compileComponents();
  const fixture = TestBed.createComponent(OperationHistory);
  fixture.detectChanges();
  await vi.waitFor(() => expect(fixture.componentInstance.loading()).toBe(false));
  await fixture.whenStable();
  fixture.detectChanges();
  return { fixture, component: fixture.componentInstance, api };
}

describe('Human-readable stock operation records', () => {
  it('shows menu/location/product names while preserving the real linked sale ID', async () => {
    const { fixture, api } = await page();
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Sale · 1 × Latte');
    expect(text).toContain('Bar');
    expect(text).toContain('Insufficient stock for product Milk. No lines were changed.');
    expect(text).not.toMatch(/[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}/i);
    expect(fixture.nativeElement.querySelector(`a[href="/sales/${saleId}"]`)).not.toBeNull();
    expect(api.getOperation).toHaveBeenCalledWith(operationId);
    expect(api.getSale).toHaveBeenCalledWith(saleId);
  });
  it('uses the frozen ingredient name if the product is missing from the current catalog', async () => {
    const api = apiFixture();
    api.listProducts.mockResolvedValue({ items: [] });
    const { fixture } = await page(api);
    expect(fixture.nativeElement.textContent).toContain('Insufficient stock for product Milk.');
    expect(fixture.nativeElement.textContent).not.toContain(productId);
  });
  it('keeps operations readable when a linked sale is unavailable', async () => {
    const api = apiFixture();
    api.getSale.mockRejectedValue(new Error('Unavailable'));
    const { fixture } = await page(api);
    expect(fixture.nativeElement.textContent).toContain('Sale consumption · Bar');
    expect(fixture.nativeElement.textContent).toContain('No stock movements were committed.');
    expect(fixture.nativeElement.textContent).not.toContain(saleId);
  });
  it('keeps entered references and refund explanations, and hides missing name IDs', async () => {
    const api = apiFixture();
    api.getOperation.mockResolvedValue({
      ...operation,
      kind: 'SALE_RETURN',
      reference: 'Return of receipt SF-102',
      reason: `Refund ${saleId}: Prepared drink was returned`,
      error: { code: 'PRODUCT_NOT_FOUND', message: `Product ${operationId} is unavailable.` },
    });
    const { fixture } = await page(api);
    expect(fixture.nativeElement.textContent).toContain('Return of receipt SF-102');
    expect(fixture.nativeElement.textContent).toContain('Refund: Prepared drink was returned');
    expect(fixture.nativeElement.textContent).toContain(
      'Product (name unavailable) is unavailable.',
    );
    expect(fixture.nativeElement.textContent).not.toContain(operationId);
  });
  it('uses human-readable list labels without changing operation link IDs', async () => {
    const { fixture, api } = await page(apiFixture(), null);
    expect(fixture.nativeElement.textContent).toContain('Sale consumption · Bar');
    expect(fixture.nativeElement.textContent).not.toContain(saleId);
    expect(
      fixture.nativeElement.querySelector(`a[href="/operations/${operationId}"]`),
    ).not.toBeNull();
    expect(api.getSale).not.toHaveBeenCalled();
  });
});
