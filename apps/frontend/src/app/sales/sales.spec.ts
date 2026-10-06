import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import type { MenuItem, Sale, Refund } from '@stockflow/contracts';
import { BffApi } from '../core/bff-api';
import { STOCK_REQUEST_STORAGE } from '../core/pending-stock-commands';
import { Pos } from './pos';
import { SaleRefund } from './sale-refund';
import { PendingSales } from './pending-sales';
const locationId = '11111111-1111-4111-8111-111111111111',
  menuId = '22222222-2222-4222-8222-222222222222',
  saleId = '33333333-3333-4333-8333-333333333333',
  lineId = '44444444-4444-4444-8444-444444444444';
const menu: MenuItem = {
  id: menuId,
  name: 'Latte',
  category: 'Coffee',
  priceMinor: 400,
  currency: 'USD',
  version: 0,
  recipeRevision: 1,
  archivedAt: null,
  createdAt: '2026-10-06T10:00:00.000Z',
  updatedAt: '2026-10-06T10:00:00.000Z',
  ingredients: [{ productId: locationId, name: 'Coffee', unit: 'kg', quantity: 0.018 }],
};
const sale: Sale = {
  id: saleId,
  status: 'DRAFT',
  locationId,
  lines: [
    {
      id: lineId,
      menuItemId: menuId,
      name: 'Latte',
      quantity: 3,
      priceMinor: 400,
      totalMinor: 1200,
      recipeRevision: 1,
      ingredients: menu.ingredients,
    },
  ],
  totalMinor: 1200,
  currency: 'USD',
  version: 0,
  tender: null,
  receiptReference: null,
  createdAt: menu.createdAt,
  updatedAt: menu.updatedAt,
};
function pricedSale(
  body: { locationId: string; lines: { menuItemId: string; quantity: number }[] },
  version = 0,
): Sale {
  return {
    ...structuredClone(sale),
    locationId: body.locationId,
    version,
    lines: body.lines.map((line, index) => ({
      ...structuredClone(sale.lines[0]),
      id: index === 0 ? lineId : '55555555-5555-4555-8555-555555555555',
      menuItemId: line.menuItemId,
      quantity: line.quantity,
      totalMinor: line.quantity * 400,
    })),
    totalMinor: body.lines.reduce((sum, line) => sum + line.quantity * 400, 0),
  };
}
function apiFixture() {
  return {
    listMenuItems: vi.fn(async () => ({ items: [menu], currency: 'USD' })),
    listLocations: vi.fn(async () => ({
      items: [
        {
          id: locationId,
          name: 'Bar',
          version: 0,
          createdAt: menu.createdAt,
          updatedAt: menu.updatedAt,
        },
      ],
    })),
    createSale: vi.fn(
      async (
        body: { locationId: string; lines: { menuItemId: string; quantity: number }[] },
        _key: string,
      ): Promise<Sale> => pricedSale(body),
    ),
    getSale: vi.fn(async () => structuredClone(sale)),
    editSale: vi.fn(
      async (
        _id: string,
        body: {
          expectedVersion: number;
          locationId: string;
          lines: { menuItemId: string; quantity: number }[];
        },
      ): Promise<Sale> => pricedSale(body, body.expectedVersion + 1),
    ),
    checkoutSale: vi.fn(async (_id: string, _body: unknown, _key: string): Promise<Sale> => ({
      ...structuredClone(sale),
      status: 'CHECKOUT_PENDING' as const,
      version: 1,
      tender: 'CASH' as const,
    })),
    cancelSale: vi.fn(async () => ({ ...structuredClone(sale), status: 'CANCELLED' as const })),
    refundSale: vi.fn(
      async () =>
        ({
          id: crypto.randomUUID(),
          saleId,
          status: 'COMPLETED',
          lines: [{ saleLineId: lineId, quantity: 1 }],
          amountMinor: 400,
          currency: 'USD',
          reason: 'Prepared drink',
          restock: false,
          createdAt: menu.createdAt,
          updatedAt: menu.updatedAt,
        }) as Refund,
    ),
    getRefund: vi.fn(),
  };
}
async function pos(api = apiFixture()) {
  await TestBed.configureTestingModule({
    imports: [Pos],
    providers: [provideRouter([]), { provide: BffApi, useValue: api }],
  }).compileComponents();
  const fixture = TestBed.createComponent(Pos);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return { component: fixture.componentInstance, fixture, api };
}
async function refund(api = apiFixture()) {
  api.getSale.mockResolvedValue({
    ...structuredClone(sale),
    status: 'COMPLETED',
    version: 2,
    tender: 'CASH',
    receiptReference: 'SF-test',
    refunds: [],
  });
  await TestBed.configureTestingModule({
    imports: [SaleRefund],
    providers: [
      provideRouter([]),
      { provide: BffApi, useValue: api },
      { provide: ActivatedRoute, useValue: { paramMap: of(convertToParamMap({ id: saleId })) } },
    ],
  }).compileComponents();
  const fixture = TestBed.createComponent(SaleRefund);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return { component: fixture.componentInstance, fixture, api };
}
describe('POS and corrections', () => {
  beforeEach(() => sessionStorage.clear());
  afterEach(() => sessionStorage.clear());
  it('prices additions and quantity/location changes automatically, batches rapid input and ignores tender changes', async () => {
    const { component, fixture, api } = await pos();
    component.add(menu);
    component.add(menu);
    await component.checkout();
    expect(api.checkoutSale).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(component.reviewed()).toBe(true));
    expect(api.createSale).toHaveBeenCalledTimes(1);
    expect(component.draft()?.totalMinor).toBe(800);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).not.toContain('Review current price');
    component.form.controls.tender.setValue('CARD');
    expect(component.reviewed()).toBe(true);
    expect(component.priceQueued()).toBe(false);
    component.lines.at(0).controls.quantity.setValue(4);
    component.form.controls.locationId.setValue('66666666-6666-4666-8666-666666666666');
    expect(component.reviewed()).toBe(false);
    await component.checkout();
    expect(api.checkoutSale).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(component.reviewed()).toBe(true));
    expect(api.editSale).toHaveBeenCalledTimes(1);
    expect(api.editSale).toHaveBeenCalledWith(saleId, {
      expectedVersion: 0,
      locationId: '66666666-6666-4666-8666-666666666666',
      lines: [{ menuItemId: menuId, quantity: 4 }],
    });
    expect(component.draft()?.totalMinor).toBe(1600);
    expect(component.form.controls.tender.value).toBe('CARD');
  });
  it('keeps newer cart input when creation is slow and serializes the next versioned price update', async () => {
    const { component, api } = await pos();
    let finish!: (value: Sale) => void;
    api.createSale.mockImplementationOnce(
      () =>
        new Promise((done) => {
          finish = done;
        }),
    );
    component.add(menu);
    await vi.waitFor(() => expect(api.createSale).toHaveBeenCalledTimes(1));
    expect(component.locked()).toBe(false);
    component.add(menu);
    await new Promise((done) => setTimeout(done, 300));
    expect(api.editSale).not.toHaveBeenCalled();
    await component.checkout();
    expect(api.checkoutSale).not.toHaveBeenCalled();
    finish(pricedSale({ locationId, lines: [{ menuItemId: menuId, quantity: 1 }] }));
    await vi.waitFor(() => expect(component.pricing()).toBe(false));
    expect(component.lines.at(0).controls.quantity.value).toBe(2);
    expect(component.reviewed()).toBe(false);
    await vi.waitFor(() => expect(component.reviewed()).toBe(true));
    expect(api.createSale).toHaveBeenCalledTimes(1);
    expect(api.editSale).toHaveBeenCalledTimes(1);
    expect(component.draft()?.totalMinor).toBe(800);
  });
  it('preserves newer quantity input during a slow PATCH and uses the returned version for the next update', async () => {
    const { component, api } = await pos();
    component.add(menu);
    await vi.waitFor(() => expect(component.reviewed()).toBe(true));
    let finish!: (value: Sale) => void;
    api.editSale.mockImplementationOnce(
      () =>
        new Promise((done) => {
          finish = done;
        }),
    );
    component.lines.at(0).controls.quantity.setValue(2);
    await vi.waitFor(() => expect(api.editSale).toHaveBeenCalledTimes(1));
    component.lines.at(0).controls.quantity.setValue(5);
    finish(pricedSale({ locationId, lines: [{ menuItemId: menuId, quantity: 2 }] }, 1));
    await vi.waitFor(() => expect(component.pricing()).toBe(false));
    expect(component.lines.at(0).controls.quantity.value).toBe(5);
    expect(component.reviewed()).toBe(false);
    await vi.waitFor(() => expect(component.reviewed()).toBe(true));
    expect(api.editSale.mock.calls[1][1].expectedVersion).toBe(1);
    expect(component.draft()?.totalMinor).toBe(2000);
  });
  it('never sends invalid quantities and cancels the persistent draft when the last item is removed', async () => {
    const { component, api } = await pos();
    component.add(menu);
    await vi.waitFor(() => expect(component.reviewed()).toBe(true));
    component.lines.at(0).controls.quantity.setValue(1.5);
    await vi.waitFor(() => expect(component.priceQueued()).toBe(false));
    await component.checkout();
    expect(component.reviewed()).toBe(false);
    expect(api.editSale).not.toHaveBeenCalled();
    expect(api.checkoutSale).not.toHaveBeenCalled();
    component.remove(0);
    await vi.waitFor(() => expect(api.cancelSale).toHaveBeenCalledWith(saleId, 0));
    expect(component.draft()).toBeNull();
    expect(TestBed.inject(PendingSales).draft()).toBeNull();
    expect(component.lines.length).toBe(0);
  });
  it('reads the latest draft version after a lost PATCH response before retrying without losing input', async () => {
    const { component, api } = await pos();
    component.add(menu);
    await vi.waitFor(() => expect(component.reviewed()).toBe(true));
    api.editSale.mockRejectedValueOnce(new HttpErrorResponse({ status: 0 }));
    component.lines.at(0).controls.quantity.setValue(2);
    await vi.waitFor(() => expect(component.error()).not.toBe(''));
    expect(component.lines.at(0).controls.quantity.value).toBe(2);
    expect(component.reviewed()).toBe(false);
    api.editSale.mockRejectedValueOnce(
      new HttpErrorResponse({
        status: 409,
        error: { error: { code: 'VERSION_CONFLICT', message: 'Draft changed.' } },
      }),
    );
    api.getSale.mockResolvedValue(
      pricedSale({ locationId, lines: [{ menuItemId: menuId, quantity: 2 }] }, 1),
    );
    await component.refreshPrices();
    expect(api.getSale).toHaveBeenCalledWith(saleId);
    expect(api.editSale.mock.calls[2][1].expectedVersion).toBe(1);
    expect(component.reviewed()).toBe(true);
    expect(component.draft()?.version).toBe(2);
  });
  it('stops scheduled pricing when the cashier leaves the POS', async () => {
    const { component, fixture, api } = await pos();
    component.add(menu);
    fixture.destroy();
    await new Promise((done) => setTimeout(done, 300));
    expect(api.createSale).not.toHaveBeenCalled();
  });
  it('retains a timed-out creation and retries its original key before another cart change', async () => {
    const api = apiFixture();
    api.createSale.mockRejectedValueOnce(new HttpErrorResponse({ status: 0 }));
    const { component } = await pos(api);
    component.add(menu);
    await vi.waitFor(() => expect(component.pending()?.kind).toBe('CREATE'));
    await vi.waitFor(() => expect(component.pricing()).toBe(false));
    const key = component.pending()!.key;
    expect(component.locked()).toBe(true);
    component.add(menu);
    expect(component.lines.at(0).controls.quantity.value).toBe(1);
    await component.resolve();
    expect(api.createSale.mock.calls[1][1]).toBe(key);
    expect(component.pending()).toBeNull();
    expect(component.draft()?.id).toBe(saleId);
  });
  it('locks double checkout, preserves pending identity and resolves completed status without a new checkout', async () => {
    const { component, fixture, api } = await pos();
    component.add(menu);
    await vi.waitFor(() => expect(component.reviewed()).toBe(true));
    let resolve!: (value: Sale) => void;
    api.checkoutSale.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const working = component.checkout();
    await component.checkout();
    expect(api.checkoutSale).toHaveBeenCalledTimes(1);
    expect(component.locked()).toBe(true);
    resolve({ ...sale, status: 'CHECKOUT_PENDING', version: 1 });
    await working;
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Sale outcome needs confirmation');
    expect(fixture.nativeElement.textContent).not.toContain('Open receipt');
    api.getSale.mockResolvedValue({
      ...sale,
      status: 'COMPLETED',
      version: 2,
      receiptReference: 'SF-test',
    });
    await component.resolve();
    expect(api.checkoutSale).toHaveBeenCalledTimes(1);
    expect(component.pending()).toBeNull();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Open receipt');
  });
  it('automatically reprices a catalog conflict without automatically checking out', async () => {
    const { component, api } = await pos();
    component.add(menu);
    await vi.waitFor(() => expect(component.reviewed()).toBe(true));
    api.checkoutSale.mockRejectedValue(
      new HttpErrorResponse({
        status: 409,
        error: { error: { code: 'PRICE_REVIEW_REQUIRED', message: 'Review changed prices.' } },
      }),
    );
    await component.checkout();
    expect(component.reviewed()).toBe(false);
    expect(component.pending()).toBeNull();
    expect(component.lines.length).toBe(1);
    expect(component.error()).toBe('Review changed prices.');
    await vi.waitFor(() => expect(component.reviewed()).toBe(true));
    expect(api.editSale).toHaveBeenCalledTimes(1);
    expect(api.checkoutSale).toHaveBeenCalledTimes(1);
    expect(component.message()).toContain('Prices changed');
  });
  it('does not send an unsafe create when recovery storage cannot be written', async () => {
    TestBed.overrideProvider(STOCK_REQUEST_STORAGE, {
      useValue: {
        getItem: () => null,
        setItem: () => {
          throw new Error('storage full');
        },
      },
    });
    const { component, api } = await pos();
    component.add(menu);
    await vi.waitFor(() => expect(component.storageError()).toContain('storage full'));
    expect(api.createSale).not.toHaveBeenCalled();
    expect(component.storageError()).toContain('storage full');
  });
  it('defaults to no restock and confirms a versioned original-price correction', async () => {
    const { component, api } = await refund();
    expect(component.form.controls.restock.value).toBe(false);
    component.change(lineId, '1');
    component.form.patchValue({ reason: 'Prepared drink', confirmed: true });
    await component.submit();
    expect(api.refundSale).toHaveBeenCalledWith(
      saleId,
      expect.objectContaining({
        lines: [{ saleLineId: lineId, quantity: 1 }],
        reason: 'Prepared drink',
        restock: false,
        expectedVersion: 2,
      }),
      expect.any(String),
    );
    expect(component.result()?.amountMinor).toBe(400);
  });
  it('retains pending stock-return correction across loss and blocks overlapping input', async () => {
    const api = apiFixture();
    api.refundSale.mockResolvedValue({
      id: lineId,
      saleId,
      status: 'REFUND_PENDING',
      lines: [{ saleLineId: lineId, quantity: 1 }],
      amountMinor: 400,
      currency: 'USD',
      reason: 'Returned ingredients',
      restock: true,
      createdAt: menu.createdAt,
      updatedAt: menu.updatedAt,
    });
    const { component } = await refund(api);
    component.change(lineId, '1');
    component.form.patchValue({ reason: 'Returned ingredients', restock: true, confirmed: true });
    await component.submit();
    expect(component.pending()?.kind).toBe('REFUND');
    expect(component.blocked()).toBe(true);
    await component.submit();
    expect(api.refundSale).toHaveBeenCalledTimes(1);
    expect(TestBed.inject(PendingSales).get()?.key).toBe(component.pending()?.key);
  });
});
