import { TestBed } from '@angular/core/testing';
import { FormControl, FormGroup } from '@angular/forms';
import { StockActionFormComponent } from './stock-action-form';

describe('Stock action feedback', () => {
  for (const type of ['add', 'remove'] as const) {
    it(`preserves the ${type} action label when blocked and shows saving only during submission`, async () => {
      await TestBed.configureTestingModule({ imports: [StockActionFormComponent] }).compileComponents();
      const fixture = TestBed.createComponent(StockActionFormComponent);
      fixture.componentRef.setInput('type', type);
      fixture.componentRef.setInput('unit', 'kg');
      fixture.componentRef.setInput('form', new FormGroup({
        quantity: new FormControl(1, { nonNullable: true }),
        reason: new FormControl('Delivery', { nonNullable: true }),
      }));
      fixture.componentRef.setInput('disabled', true);
      fixture.detectChanges();
      const button: HTMLButtonElement = fixture.nativeElement.querySelector('button');
      expect(button.disabled).toBe(true);
      expect(button.textContent?.trim()).toBe(type === 'add' ? 'Add stock' : 'Remove stock');
      fixture.componentRef.setInput('disabled', false);
      fixture.componentRef.setInput('submitting', true);
      fixture.detectChanges();
      expect(button.disabled).toBe(true);
      expect(button.textContent?.trim()).toBe('Saving…');
      fixture.componentRef.setInput('submitting', false);
      fixture.detectChanges();
      expect(button.disabled).toBe(false);
      expect(button.textContent?.trim()).toBe(type === 'add' ? 'Add stock' : 'Remove stock');
    });
  }
});
