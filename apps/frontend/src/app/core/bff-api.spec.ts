import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { BffApi, describeError } from './bff-api';
import { HttpErrorResponse } from '@angular/common/http';

describe('BffApi', () => {
  beforeEach(() =>
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }),
  );
  it('uses only /api and forwards the stock idempotency key', async () => {
    const api = TestBed.inject(BffApi);
    const http = TestBed.inject(HttpTestingController);
    const promise = api.changeStock(
      'product-1',
      'add',
      { quantity: 1.25, reason: 'Delivery' },
      'key-1',
    );
    const request = http.expectOne('/api/inventory/product-1/add');
    expect(request.request.method).toBe('POST');
    expect(request.request.headers.get('Idempotency-Key')).toBe('key-1');
    expect(request.request.body).toEqual({ quantity: 1.25, reason: 'Delivery' });
    request.flush({
      productId: 'product-1',
      quantity: 1.25,
      movement: {
        id: 'movement-1',
        productId: 'product-1',
        type: 'ADD',
        quantity: 1.25,
        reason: 'Delivery',
        createdAt: new Date().toISOString(),
      },
    });
    expect((await promise).quantity).toBe(1.25);
    http.verify();
  });
  it('extracts stable API errors without exposing network details', () => {
    const known = new HttpErrorResponse({
      status: 409,
      error: { error: { code: 'INSUFFICIENT_STOCK', message: 'Too much.', requestId: 'id' } },
    });
    expect(describeError(known).code).toBe('INSUFFICIENT_STOCK');
    expect(describeError(new HttpErrorResponse({ status: 0 })).code).toBe('NETWORK_ERROR');
  });
});
