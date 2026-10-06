import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import { of } from 'rxjs';
import type { MenuItem, Product } from '@stockflow/contracts';
import { BffApi } from '../core/bff-api';
import { MenuList } from './menu-list';
import { MenuItemPage } from './menu-item-page';
import { priceMinor, priceText } from './menu-money';

const coffee: Product = { id: '00000000-0000-4000-8000-000000000001', name: 'Arabica Coffee', unit: 'kg', category: 'Coffee', lowStockThreshold: 0, createdAt: '2026-10-06T10:00:00.000Z', updatedAt: '2026-10-06T10:00:00.000Z', version: 0, archivedAt: null };
const milk: Product = { ...coffee, id: '00000000-0000-4000-8000-000000000002', name: 'Milk', unit: 'L', category: 'Dairy' };
const item: MenuItem = { id: '00000000-0000-4000-8000-000000000003', name: 'Latte', category: 'Coffee', priceMinor: 400, currency: 'USD', version: 0, recipeRevision: 1, archivedAt: null, createdAt: coffee.createdAt, updatedAt: coffee.createdAt, ingredients: [{ productId: coffee.id, name: coffee.name, unit: coffee.unit, quantity: 0.018 }, { productId: milk.id, name: milk.name, unit: milk.unit, quantity: 0.2 }] };
function apiFixture() {
  return {
    listMenuItems: vi.fn(async () => ({ items: [item], currency: 'USD' })),
    listProducts: vi.fn(async () => ({ items: [coffee, milk] })),
    getMenuItem: vi.fn(async () => structuredClone(item)),
    getMenuRevision: vi.fn(async () => structuredClone(item)),
    createMenuItem: vi.fn(async () => structuredClone(item)),
    publishMenuItem: vi.fn(async () => ({ ...structuredClone(item), priceMinor: 450, version: 1, recipeRevision: 2 })),
    archiveMenuItem: vi.fn(async () => ({ ...structuredClone(item), version: 1, archivedAt: coffee.createdAt })),
  };
}
async function page(api = apiFixture(), id: string | null = null) {
  await TestBed.configureTestingModule({ imports: [MenuItemPage], providers: [provideRouter([]), { provide: BffApi, useValue: api }, { provide: ActivatedRoute, useValue: { paramMap: of(convertToParamMap(id ? { id } : {})) } }] }).compileComponents();
  const fixture = TestBed.createComponent(MenuItemPage);
  fixture.detectChanges(); await fixture.componentInstance.load(); await fixture.whenStable(); fixture.detectChanges();
  return { fixture, component: fixture.componentInstance, api };
}
function validForm(component: MenuItemPage, price = '4.00') {
  component.form.patchValue({ name: ' Latte ', category: ' Coffee ', price });
  component.lines.at(0).setValue({ productId: coffee.id, quantity: 0.018 });
  if (component.lines.length === 1) component.addLine();
  component.lines.at(1).setValue({ productId: milk.id, quantity: 0.2 });
}

describe('menu integer price presentation', () => {
  it('round-trips minor units without rounding binary floating-point amounts', () => {
    expect(priceMinor('0.29')).toBe(29);
    expect(priceMinor('4.5')).toBe(450);
    expect(priceMinor('90071992547409.91')).toBe(Number.MAX_SAFE_INTEGER);
    expect(priceText(Number.MAX_SAFE_INTEGER)).toBe('90071992547409.91');
    expect(priceMinor('90071992547409.92')).toBeNull();
    expect(priceMinor('4.001')).toBeNull();
    expect(priceMinor('-4')).toBeNull();
    expect(priceMinor('1e3')).toBeNull();
  });
});

describe('MenuList', () => {
  it('shows genuine empty state and keeps failures separate from empty data', async () => {
    const api = apiFixture(); api.listMenuItems.mockResolvedValue({ items: [], currency: 'USD' });
    await TestBed.configureTestingModule({ imports: [MenuList], providers: [provideRouter([]), { provide: BffApi, useValue: api }] }).compileComponents();
    const fixture = TestBed.createComponent(MenuList); fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('No menu items yet');
    api.listMenuItems.mockRejectedValue(new HttpErrorResponse({ status: 0 }));
    await fixture.componentInstance.load(); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[role="alert"]')).toBeTruthy();
    expect(fixture.nativeElement.textContent).not.toContain('No menu items yet');
  });
  it('filters menu search/category/archive state and shows accessible desktop/mobile equivalents', async () => {
    const api = apiFixture(); api.listMenuItems.mockResolvedValue({ items: [item, { ...item, id: 'archived', name: 'Espresso', archivedAt: coffee.createdAt }], currency: 'USD' });
    await TestBed.configureTestingModule({ imports: [MenuList], providers: [provideRouter([]), { provide: BffApi, useValue: api }] }).compileComponents();
    const fixture = TestBed.createComponent(MenuList); fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    expect(fixture.componentInstance.filtered()).toHaveLength(1);
    expect(fixture.nativeElement.querySelectorAll('th[scope="col"]')).toHaveLength(5);
    expect(fixture.nativeElement.querySelector('.mobile-list').textContent).toContain('USD 4.00');
    fixture.componentInstance.status.set('ARCHIVED'); expect(fixture.componentInstance.filtered()[0].name).toBe('Espresso');
    fixture.componentInstance.query.set('latte'); expect(fixture.componentInstance.filtered()).toHaveLength(0);
  });
});

describe('MenuItemPage', () => {
  it('retrieves any older immutable revision beyond the latest100 selector without an unbounded list',async()=>{
    const api=apiFixture();api.getMenuItem.mockResolvedValue({...item,recipeRevision:150});const{component,fixture}=await page(api,item.id);expect(component.revisionNumbers()).toHaveLength(100);fixture.detectChanges();expect(fixture.nativeElement.querySelector('#older-recipe-revision')).toBeTruthy();await component.showRevision('1');expect(api.getMenuRevision).toHaveBeenCalledWith(item.id,1);expect(component.historical()?.recipeRevision).toBe(1);expect(component.revisionNumbers()).toContain(1);expect(component.revisionNumbers()).toHaveLength(101);await component.showRevision('1.5');expect(api.getMenuRevision).toHaveBeenCalledTimes(1);expect(component.revisionError()).toContain('whole revision');
  });
  it('uses configured currency on a fresh empty catalog and publishes a validated recipe', async () => {
    const api = apiFixture(); api.listMenuItems.mockResolvedValue({ items: [], currency: 'EUR' });
    const { component } = await page(api);
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    expect(component.currency()).toBe('EUR'); validForm(component);
    await component.submit();
    expect(api.createMenuItem).toHaveBeenCalledWith({ name: 'Latte', category: 'Coffee', priceMinor: 400, currency: 'EUR', ingredients: [{ productId: coffee.id, quantity: 0.018 }, { productId: milk.id, quantity: 0.2 }] });
    expect(navigate).toHaveBeenCalledWith(['/menu', item.id]);
  });
  it('keeps invalid ingredient precision, archived products and money input local', async () => {
    const { component, api, fixture } = await page(); validForm(component, '4.001');
    component.lines.at(0).controls.quantity.setValue(0.0181);
    await component.submit(); fixture.detectChanges();
    expect(component.validation()).toContain('three decimals');
    expect(api.createMenuItem).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('#menu-price').getAttribute('aria-invalid')).toBe('true');
    validForm(component);
    component.products.set([coffee, { ...milk, archivedAt: coffee.createdAt }]);
    await component.submit(); expect(api.createMenuItem).not.toHaveBeenCalled();
  });
  it('publishes against the reviewed catalog version while immutable history remains accessible', async () => {
    const { component, api } = await page(apiFixture(), item.id);
    component.startEditing(); validForm(component, '4.50');
    await component.submit();
    expect(api.publishMenuItem).toHaveBeenCalledWith(item.id, expect.objectContaining({ priceMinor: 450, expectedVersion: 0 }));
    expect(component.item()?.recipeRevision).toBe(2);
    await component.showRevision('1');
    expect(api.getMenuRevision).toHaveBeenCalledWith(item.id, 1);
    expect(component.historical()?.priceMinor).toBe(400);
  });
  it('locks duplicate publish calls while the first request is in flight', async () => {
    const api = apiFixture(); let resolve!: (value: MenuItem) => void;
    api.publishMenuItem.mockImplementation(() => new Promise(resolvePromise => { resolve = resolvePromise; }));
    const { component, fixture } = await page(api, item.id); component.startEditing(); validForm(component);
    const pending = component.submit(); fixture.detectChanges();
    expect(component.submitting()).toBe(true);
    expect(component.form.disabled).toBe(true);
    expect(fixture.nativeElement.querySelector('button[type="submit"]').disabled).toBe(true);
    await component.submit(); expect(api.publishMenuItem).toHaveBeenCalledTimes(1);
    resolve({ ...item, version: 1, recipeRevision: 2 }); await pending;
    expect(component.submitting()).toBe(false);
  });
  it('preserves uncertain publication input until the original committed outcome is found', async () => {
    const api = apiFixture(); api.publishMenuItem.mockRejectedValue(new HttpErrorResponse({ status: 0 }));
    const { component } = await page(api, item.id); component.startEditing(); validForm(component, '4.50');
    await component.submit(); expect(component.uncertain()).toBe('save'); expect(component.form.disabled).toBe(true);
    await component.submit(); expect(api.publishMenuItem).toHaveBeenCalledTimes(1);
    await component.checkOutcome(); expect(component.uncertain()).toBe('save');
    api.getMenuItem.mockResolvedValue({ ...item, priceMinor: 450, version: 1, recipeRevision: 2 });
    await component.checkOutcome(); expect(component.uncertain()).toBeNull(); expect(component.editing()).toBe(false); expect(component.success()).toContain('revision 2');
  });
  it('retains entered fields through stale-version recovery and requires deliberate review', async () => {
    const api = apiFixture(); api.publishMenuItem.mockRejectedValue(new HttpErrorResponse({ status: 409, error: { error: { code: 'VERSION_CONFLICT', message: 'Refresh before saving.' } } }));
    const { component } = await page(api, item.id); component.startEditing(); validForm(component, '5.00');
    await component.submit(); expect(component.refreshNeeded()).toBe(true);
    expect(component.form.getRawValue().price).toBe('5.00');
    api.getMenuItem.mockResolvedValue({ ...item, priceMinor: 450, version: 1, recipeRevision: 2 });
    await component.refreshCurrent();
    expect(component.item()?.version).toBe(1); expect(component.form.getRawValue().price).toBe('5.00'); expect(component.refreshNeeded()).toBe(false);
  });
  it('archives with confirmation/version semantics and keeps ingredient/history detail readable', async () => {
    const { component, api, fixture } = await page(apiFixture(), item.id);
    component.confirmingArchive.set(true); await component.archive(); fixture.detectChanges();
    expect(api.archiveMenuItem).toHaveBeenCalledWith(item.id, 0);
    expect(component.item()?.archivedAt).toBeTruthy();
    expect(fixture.nativeElement.textContent).toContain('Existing receipts and recipe history remain available');
    expect(fixture.nativeElement.querySelector('.ingredient-summary').textContent).toContain('Arabica Coffee');
  });
});
