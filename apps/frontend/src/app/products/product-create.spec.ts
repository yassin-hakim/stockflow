import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import { BffApi } from '../core/bff-api';
import { HttpErrorResponse } from '@angular/common/http';
import { ProductCreate } from './product-create';

describe('ProductCreate', () => {
  it('retains stale edit input while loading the latest saved version and requires deliberate review',async()=>{
    const product={id:'11111111-1111-4111-8111-111111111111',name:'Coffee',unit:'kg',category:'Coffee',lowStockThreshold:0,sku:'COFFEE',version:0,archivedAt:null,createdAt:'2026-10-06T10:00:00.000Z',updatedAt:'2026-10-06T10:00:00.000Z'};
    const api={getProduct:vi.fn(async()=>({...product})),editProduct:vi.fn(async()=>({...product,version:2}))};api.editProduct.mockRejectedValueOnce(new HttpErrorResponse({status:409,error:{error:{code:'VERSION_CONFLICT',message:'Product changed.'}}}));
    await TestBed.configureTestingModule({imports:[ProductCreate],providers:[provideRouter([]),{provide:BffApi,useValue:api},{provide:ActivatedRoute,useValue:{snapshot:{paramMap:convertToParamMap({id:product.id})}}}]}).compileComponents();
    const fixture=TestBed.createComponent(ProductCreate);fixture.detectChanges();await fixture.whenStable();const component=fixture.componentInstance;const navigate=vi.spyOn(TestBed.inject(Router),'navigate').mockResolvedValue(true);
    component.form.patchValue({name:'My Coffee',category:'My Category',sku:'MY-CODE',lowStockThreshold:5});await component.submit();expect(component.refreshNeeded()).toBe(true);await component.submit();expect(api.editProduct).toHaveBeenCalledTimes(1);
    api.getProduct.mockResolvedValue({...product,name:'Coworker Coffee',version:1});await component.refreshCurrent();fixture.detectChanges();expect(component.product()?.version).toBe(1);expect(component.form.getRawValue()).toMatchObject({name:'My Coffee',category:'My Category',sku:'MY-CODE',lowStockThreshold:5});expect(component.reviewRequired()).toBe(true);expect(fixture.nativeElement.querySelector('button[type="submit"]').disabled).toBe(true);expect(fixture.nativeElement.textContent).toContain('Coworker Coffee');await component.submit();expect(api.editProduct).toHaveBeenCalledTimes(1);component.reviewRequired.set(false);await component.submit();expect(api.editProduct).toHaveBeenLastCalledWith(product.id,expect.objectContaining({name:'My Coffee',expectedVersion:1}));expect(navigate).toHaveBeenCalled();
  });
  it('keeps invalid input local and navigates only after a successful create', async () => {
    let calls = 0;
    const api = {
      createProduct: async () => {
        calls++;
        return { id: 'product-1' };
      },
    };
    await TestBed.configureTestingModule({
      imports: [ProductCreate],
      providers: [provideRouter([]), { provide: BffApi, useValue: api }],
    }).compileComponents();
    const fixture = TestBed.createComponent(ProductCreate);
    const component = fixture.componentInstance;
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    component.form.setValue({
      name: 'Coffee',
      unit: 'kg',
      category: 'Coffee',
      lowStockThreshold: 1.0001,
      sku: '',
    });
    await component.submit();
    expect(calls).toBe(0);
    expect(component.validation()).toContain('three decimal places');
    component.form.setValue({
      name: ' Coffee ',
      unit: ' kg ',
      category: ' Coffee ',
      lowStockThreshold: 5,
      sku: '',
    });
    await component.submit();
    expect(calls).toBe(1);
    expect(navigate).toHaveBeenCalledWith(['/products', 'product-1']);
  });
  it('does not blindly resubmit when creation outcome is uncertain', async () => {
    let calls = 0;
    const api = {
      createProduct: async () => {
        calls++;
        throw new HttpErrorResponse({ status: 0 });
      },
    };
    await TestBed.configureTestingModule({
      imports: [ProductCreate],
      providers: [provideRouter([]), { provide: BffApi, useValue: api }],
    }).compileComponents();
    const fixture = TestBed.createComponent(ProductCreate);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.form.setValue({
      name: 'Coffee',
      unit: 'kg',
      category: 'Coffee',
      lowStockThreshold: 0,
      sku: '',
    });
    await component.submit();
    fixture.detectChanges();
    expect(component.uncertain()).toBe(true);
    expect(fixture.nativeElement.querySelector('button[type="submit"]').disabled).toBe(true);
    await component.submit();
    expect(calls).toBe(1);
  });
});
