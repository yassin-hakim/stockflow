import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import type { InventoryReport, SalesReport, StockMovementV2 } from '@stockflow/contracts';
import { BffApi } from '../core/bff-api';
import { localInstant, defaultPeriod } from './report-period';
import { Reports } from './reports';

const from = '2026-10-06T00:00:00.000Z',
  to = '2026-10-07T00:00:00.000Z';
const saleRow: SalesReport['items'][number] = {
  id: 'sale-1',
  saleId: 'sale-1',
  kind: 'SALE',
  occurredAt: from,
  locationId: 'bar',
  reference: 'SALE-0001',
  amountMinor: 1200,
  currency: 'USD',
  lines: [{ name: 'Latte', quantity: 3, priceMinor: 400 }],
};
const refundRow: SalesReport['items'][number] = {
  ...saleRow,
  id: 'refund-1',
  kind: 'REFUND',
  amountMinor: 400,
  lines: [{ name: 'Latte', quantity: 1, priceMinor: 400 }],
};
const sales: SalesReport = {
  items: [saleRow, refundRow],
  nextCursor: null,
  from,
  to,
  locationId: null,
  currency: 'USD',
  grossMinor: 1200,
  refundMinor: 400,
  netMinor: 800,
  completedSales: 1,
  refundedItems: 1,
  soldItems: 3,
};
const movement: StockMovementV2 = {
  id: 'movement-1',
  productId: 'coffee',
  type: 'REMOVE',
  quantity: 0.054,
  resultingQuantity: 4.946,
  cause: 'SALE',
  reason: 'Three lattes',
  createdAt: from,
  locationId: 'bar',
  operationId: 'operation-1',
};
const inventory: InventoryReport = {
  items: [movement],
  nextCursor: null,
  filters: { from, to },
  products: [
    {
      productId: 'coffee',
      name: 'Arabica Coffee',
      unit: 'kg',
      addedQuantity: 5,
      removedQuantity: 0.054,
      consumedQuantity: 0.054,
      wasteQuantity: 0,
      transferInQuantity: 5,
      transferOutQuantity: 0,
      countVariance: -0.046,
    },
    {
      productId: 'milk',
      name: 'Milk',
      unit: 'L',
      addedQuantity: 2,
      removedQuantity: 0.7,
      consumedQuantity: 0.6,
      wasteQuantity: 0.1,
      transferInQuantity: 2,
      transferOutQuantity: 0,
      countVariance: -0.05,
    },
  ],
};
function apiFixture() {
  return {
    listLocations: vi.fn(async () => ({
      items: [{ id: 'bar', name: 'Bar', version: 0, createdAt: from, updatedAt: from }],
    })),
    getProfitLossReport: vi.fn(async()=>({from,to,locationId:null,currency:'USD',grossSalesMinor:1200,refundMinor:400,netRevenueMinor:800,ingredientCostMinor:null,knownCostMinor:100,missingCostRecords:1,grossProfitMinor:null,items:[{...saleRow,revenueMinor:1200,costMinor:null,grossProfitMinor:null}],nextCursor:null})),
    getSalesReport: vi.fn(async (_params: Record<string, string>) => structuredClone(sales)),
    getInventoryReport: vi.fn(async (_params: Record<string, string>) =>
      structuredClone(inventory),
    ),
    exportReport: vi.fn(
      async (_kind: string, _params: Record<string, string>) =>
        new Blob(['Kind,Receipt\nSALE,SALE-0001'], { type: 'text/csv' }),
    ),
  };
}
async function setup(api = apiFixture()) {
  await TestBed.configureTestingModule({
    imports: [Reports],
    providers: [provideRouter([]), { provide: BffApi, useValue: api }],
  }).compileComponents();
  const fixture = TestBed.createComponent(Reports);
  fixture.detectChanges();
  const component = fixture.componentInstance;
  await vi.waitFor(() => expect(component.loading()).toBe(false));
  fixture.detectChanges();
  return { fixture, component, api };
}

describe('report local period conversion', () => {
  it('sends explicit UTC instants for valid local wall-clock filters', () => {
    const date = new Date(2026, 9, 6, 9, 30, 0, 0);
    expect(localInstant('2026-10-06T09:30')).toBe(date.toISOString());
    expect(defaultPeriod(new Date(2026, 9, 6, 12))).toEqual({
      from: '2026-10-06T00:00',
      to: '2026-10-07T00:00',
    });
  });
  it.each([
    '2026-02-31T10:00',
    '2026-13-01T10:00',
    '2026-10-06T25:00',
    '2026-10-06T10:61',
    '2026-10-06',
    'bad-date',
    '0000-01-01T10:00',
  ])('rejects normalized or malformed date %s', (date) => {
    expect(localInstant(date)).toBeNull();
  });
});

describe('Reports', () => {
  it('renders owner P&L and flags incomplete costs instead of inventing profit',async()=>{
    const {component,fixture,api}=await setup();component.form.controls.kind.setValue('profit-loss');await component.apply();fixture.detectChanges();
    expect(api.getProfitLossReport).toHaveBeenCalled();expect(fixture.nativeElement.textContent).toContain('Gross profit');expect(fixture.nativeElement.textContent).toContain('Unavailable');expect(fixture.nativeElement.textContent).toContain('Known costs: USD 1.00');expect(fixture.nativeElement.querySelector('.mobile-list').textContent).toContain('Unrecorded');
  });
  it('renders actual owner totals, linked records and desktop/mobile equivalents', async () => {
    const { fixture, component } = await setup();
    expect(fixture.nativeElement.querySelector('.report-totals').textContent).toContain('USD 8.00');
    expect(fixture.nativeElement.querySelector('.mobile-list').textContent).toContain('SALE-0001');
    expect(fixture.nativeElement.querySelectorAll('th[scope="col"]')).toHaveLength(6);
    expect(component.money(-1, 'USD')).toBe('USD −0.01');
    expect(component.money(Number.MAX_SAFE_INTEGER, 'USD')).toBe('USD 90071992547409.91');
  });
  it('converts local period and forwards cause only for the requested inventory report', async () => {
    const { component, api } = await setup();
    component.form.setValue({
      kind: 'inventory',
      from: '2026-10-06T09:30',
      to: '2026-10-06T10:00',
      locationId: 'bar',
      cause: 'WASTE',
    });
    await component.apply();
    expect(api.getInventoryReport).toHaveBeenCalledWith({
      from: localInstant('2026-10-06T09:30'),
      to: localInstant('2026-10-06T10:00'),
      locationId: 'bar',
      cause: 'WASTE',
      limit: '25',
    });
    component.form.controls.kind.setValue('sales');
    await component.apply();
    expect(api.getSalesReport).toHaveBeenLastCalledWith({
      from: localInstant('2026-10-06T09:30'),
      to: localInstant('2026-10-06T10:00'),
      locationId: 'bar',
      limit: '25',
    });
  });
  it('rejects invalid or reversed periods locally without another request', async () => {
    const { component, api, fixture } = await setup();
    component.form.patchValue({ from: '2026-10-07T00:00', to: '2026-10-06T00:00' });
    await component.apply();
    fixture.detectChanges();
    expect(component.validation()).toContain('later than From');
    expect(api.getSalesReport).toHaveBeenCalledTimes(1);
    expect(fixture.nativeElement.querySelector('#report-from').getAttribute('aria-invalid')).toBe(
      'true',
    );
  });
  it('never displays failed reports as zero totals and retries the original failed scope', async () => {
    const { component, api, fixture } = await setup();
    api.getSalesReport.mockRejectedValueOnce(
      new HttpErrorResponse({
        status: 503,
        error: { error: { code: 'SERVICE_UNAVAILABLE', message: 'Sales database unavailable.' } },
      }),
    );
    component.form.patchValue({ locationId: 'bar' });
    await component.apply();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Report could not be loaded');
    expect(fixture.nativeElement.querySelector('.report-totals')).toBeNull();
    component.form.patchValue({ locationId: '' });
    await component.retry();
    expect(api.getSalesReport).toHaveBeenLastCalledWith(
      expect.objectContaining({ locationId: 'bar' }),
    );
    expect(component.applied()?.form.locationId).toBe('bar');
  });
  it('distinguishes successful empty reports from source failure', async () => {
    const api = apiFixture();
    api.getSalesReport.mockResolvedValue({
      ...sales,
      items: [],
      grossMinor: 0,
      refundMinor: 0,
      netMinor: 0,
      completedSales: 0,
      soldItems: 0,
      refundedItems: 0,
    });
    const { fixture } = await setup(api);
    expect(fixture.nativeElement.textContent).toContain(
      'No completed sales or refunds in this period',
    );
    expect(fixture.nativeElement.querySelector('.report-totals').textContent).toContain('USD 0.00');
  });
  it('retains applied filters across pagination even when the form contains unapplied changes', async () => {
    const api = apiFixture();
    api.getSalesReport.mockResolvedValueOnce({
      ...sales,
      items: [saleRow],
      nextCursor: 'next-page',
    });
    const { component } = await setup(api);
    const applied = { ...component.applied()!.params };
    api.getSalesReport.mockResolvedValue({ ...sales, items: [refundRow], nextCursor: null });
    component.form.patchValue({
      kind: 'inventory',
      locationId: 'bar',
      cause: 'TRANSFER',
      from: '2026-01-01T00:00',
    });
    expect(component.filtersChanged()).toBe(true);
    await component.loadMore();
    expect(api.getSalesReport).toHaveBeenLastCalledWith({ ...applied, cursor: 'next-page' });
    expect(api.getInventoryReport).not.toHaveBeenCalled();
    expect(component.sales()?.items).toHaveLength(2);
    expect(component.sales()?.netMinor).toBe(800);
  });
  it('preserves loaded data and cursor when a later page fails', async () => {
    const api = apiFixture();
    api.getSalesReport.mockResolvedValueOnce({ ...sales, nextCursor: 'next-page' });
    const { component } = await setup(api);
    api.getSalesReport.mockRejectedValue(new HttpErrorResponse({ status: 0 }));
    await component.loadMore();
    expect(component.moreError()).toBeTruthy();
    expect(component.sales()?.items).toEqual(sales.items);
    expect(component.nextCursor()).toBe('next-page');
  });
  it('shows per-product units without adding unlike quantities or treating transfers as consumption', async () => {
    const { component, fixture } = await setup();
    component.form.controls.kind.setValue('inventory');
    await component.apply();
    fixture.detectChanges();
    expect(component.inventory()?.products).toEqual(inventory.products);
    expect(component.movementQuantity(movement)).toBe('−0.054 kg');
    expect(fixture.nativeElement.querySelector('.product-facts').textContent).toContain('5 kg');
    expect(fixture.nativeElement.querySelector('.product-facts').textContent).toContain('0.6 L');
    expect(fixture.nativeElement.textContent).toContain('Quantities use each ingredient');
    expect(fixture.nativeElement.textContent).toContain('−0.046');
  });
  it('exports the applied report scope rather than edited filters or pagination cursor', async () => {
    const { component, api } = await setup();
    const applied = { ...component.applied()!.params };
    const create = vi.fn(() => 'blob:report-download'),
      revoke = vi.fn();
    vi.useFakeTimers();
    vi.stubGlobal(
      'URL',
      class extends URL {
        static override createObjectURL = create;
        static override revokeObjectURL = revoke;
      },
    );
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    component.form.patchValue({
      kind: 'inventory',
      cause: 'WASTE',
      locationId: 'bar',
      from: '2026-01-01T00:00',
    });
    await component.exportCsv();
    expect(api.exportReport).toHaveBeenCalledWith('sales', applied);
    expect(click).toHaveBeenCalledOnce();
    expect(component.success()).toContain('displayed report filters');
    vi.advanceTimersByTime(1000);
    expect(revoke).toHaveBeenCalledWith('blob:report-download');
    click.mockRestore();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });
  it('retains valid reports when CSV fails and exposes a recoverable export error', async () => {
    const { component, api, fixture } = await setup();
    api.exportReport.mockRejectedValue(
      new HttpErrorResponse({
        status: 422,
        error: { error: { code: 'INVALID_REQUEST', message: 'Narrow the export period.' } },
      }),
    );
    await component.exportCsv();
    fixture.detectChanges();
    expect(component.exportError()).toBe('Narrow the export period.');
    expect(fixture.nativeElement.querySelector('.report-totals')).toBeTruthy();
    expect(component.exporting()).toBe(false);
  });
});
