import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { BffApi } from '../core/bff-api';
import { Dashboard } from './dashboard';

describe('Dashboard states', () => {
  it('shows an error and retry instead of false zero stock when the BFF fails', async () => {
    await TestBed.configureTestingModule({ imports: [Dashboard], providers: [provideRouter([]), { provide: BffApi, useValue: { listInventory: async () => { throw new Error('offline'); } } }] }).compileComponents();
    const fixture = TestBed.createComponent(Dashboard);
    await fixture.whenStable(); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[role=alert]')?.textContent).toContain('request could not be completed');
    expect(fixture.nativeElement.querySelector('button')?.textContent).toContain('Retry');
    expect(fixture.nativeElement.querySelector('.status.OUT')).toBeNull();
  });
});
