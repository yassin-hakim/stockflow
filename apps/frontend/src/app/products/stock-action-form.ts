import { Component, input, output } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';

export type StockActionForm = FormGroup<{
  quantity: FormControl<number>;
  reason: FormControl<string>;
}>;

@Component({
  selector: 'app-stock-action-form',
  imports: [ReactiveFormsModule],
  templateUrl: './stock-action-form.html',
  styles: ':host { display: block; } form { height: 100%; }',
})
export class StockActionFormComponent {
  readonly type = input.required<'add' | 'remove'>();
  readonly unit = input.required<string>();
  readonly form = input.required<StockActionForm>();
  readonly submitting = input(false);
  readonly disabled = input(false);
  readonly validation = input('');
  readonly submitted = output<void>();
}
