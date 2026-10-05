import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { BffApi } from '../core/bff-api';
import { HttpErrorResponse } from '@angular/common/http';
import { ProductCreate } from './product-create';

describe('ProductCreate', () => {
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
    });
    await component.submit();
    expect(calls).toBe(0);
    expect(component.validation()).toContain('three decimal places');
    component.form.setValue({
      name: ' Coffee ',
      unit: ' kg ',
      category: ' Coffee ',
      lowStockThreshold: 5,
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
    });
    await component.submit();
    fixture.detectChanges();
    expect(component.uncertain()).toBe(true);
    expect(fixture.nativeElement.querySelector('button[type="submit"]').disabled).toBe(true);
    await component.submit();
    expect(calls).toBe(1);
  });
});
