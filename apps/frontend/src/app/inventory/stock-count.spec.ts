import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { of } from 'rxjs';
import { StockCounts } from './stock-count';
import { BffApi } from '../core/bff-api';
import type { StockCount } from '@stockflow/contracts';
const productId = '11111111-1111-4111-8111-111111111111',
  locationId = '22222222-2222-4222-8222-222222222222',
  countId = '33333333-3333-4333-8333-333333333333';
const draft: StockCount = {
  id: countId,
  locationId,
  status: 'DRAFT',
  lines: [
    {
      productId,
      recordedQuantity: 5,
      expectedVersion: 1,
      countedQuantity: null,
      differenceQuantity: null,
    },
  ],
  reason: 'Physical count',
  version: 0,
  createdAt: '2026-10-06T00:00:00.000Z',
  updatedAt: '2026-10-06T00:00:00.000Z',
};
const baseApi = {
  listLocations: async () => ({ items: [{ id: locationId, name: 'Bar' }] }),
  listProducts: async () => ({ items: [{ id: productId, name: 'Coffee', unit: 'kg' }] }),
  getCount: async () => draft,
};
async function setup(api: object, path = 'counts/:id') {
  const params = convertToParamMap(path === 'counts/:id' ? { id: countId } : {});
  await TestBed.configureTestingModule({
    imports: [StockCounts],
    providers: [
      provideRouter([]),
      { provide: BffApi, useValue: { ...baseApi, ...api } },
      {
        provide: ActivatedRoute,
        useValue: { snapshot: { routeConfig: { path }, paramMap: params }, paramMap: of(params) },
      },
    ],
  }).compileComponents();
  const fixture = TestBed.createComponent(StockCounts);
  await fixture.whenStable();
  return fixture;
}
describe('Physical count recovery and review', () => {
  beforeEach(() => sessionStorage.clear());
  afterEach(() => sessionStorage.clear());
  it('preserves unentered quantities as blank, accepts explicit zero and requires reviewed confirmation', async () => {
    const edit = vi.fn(async () => ({
        ...draft,
        version: 1,
        lines: [{ ...draft.lines[0], countedQuantity: 0, differenceQuantity: -5 }],
      })),
      apply = vi.fn();
    const fixture = await setup({ editCount: edit, applyCount: apply }),
      component = fixture.componentInstance;
    expect(component.lines.at(0).controls.countedQuantity.value).toBeNull();
    await component.saveReview();
    expect(edit).not.toHaveBeenCalled();
    component.lines.at(0).controls.countedQuantity.setValue(0);
    await component.saveReview();
    expect(edit).toHaveBeenCalledWith(countId, {
      expectedVersion: 0,
      lines: [{ productId, countedQuantity: 0 }],
    });
    expect(component.reviewed()).toBe(true);
    await component.apply();
    expect(apply).not.toHaveBeenCalled();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('-5');
  });
  it('reuses frozen apply identity after timeout and leaves stale count entries visible', async () => {
    const keys: string[] = [],
      versions: number[] = [];
    const apply = async (_id: string, version: number, key: string) => {
      keys.push(key);
      versions.push(version);
      if (keys.length === 1) throw new HttpErrorResponse({ status: 0 });
      throw new HttpErrorResponse({
        status: 409,
        error: { error: { code: 'COUNT_STALE', message: 'Stock changed after count started.' } },
      });
    };
    const fixture = await setup({ applyCount: apply }),
      component = fixture.componentInstance;
    component.lines.at(0).controls.countedQuantity.setValue(4.9);
    component.reviewed.set(true);
    component.confirmed.set(true);
    await component.apply();
    expect(component.pending()?.kind).toBe('APPLY');
    expect(component.locked()).toBe(true);
    component.count.set({ ...draft, version: 99 });
    await component.apply();
    expect(keys[1]).toBe(keys[0]);
    expect(versions).toEqual([0, 0]);
    expect(component.pending()).toBeNull();
    expect(component.stale()).toBe(true);
    expect(component.lines.at(0).controls.countedQuantity.value).toBe(4.9);
  });
  it('restores uncertain count creation and resends original location/products/reason', async () => {
    const bodies: unknown[] = [],
      keys: string[] = [];
    const create = async (body: unknown, key: string) => {
      bodies.push(body);
      keys.push(key);
      throw new HttpErrorResponse({ status: 0 });
    };
    const fixture = await setup({ createCount: create }, 'counts/new'),
      component = fixture.componentInstance;
    component.createForm.setValue({ locationId, reason: 'Original count' });
    component.chosen.set([productId]);
    await component.create();
    component.createForm.setValue({ locationId, reason: 'Changed input' });
    component.chosen.set([]);
    await component.create();
    expect(bodies[1]).toEqual(bodies[0]);
    expect(keys[1]).toBe(keys[0]);
    expect(component.pending()).not.toBeNull();
  });
});
