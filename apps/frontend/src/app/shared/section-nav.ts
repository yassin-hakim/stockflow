import { Component, input } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';

@Component({
  selector: 'app-section-nav',
  imports: [RouterLink, RouterLinkActive],
  template: `<nav class="section-nav" [attr.aria-label]="area() === 'inventory' ? 'Inventory navigation' : 'Operations navigation'">
    @for (link of area() === 'inventory' ? inventory : operations; track link.path) {
      <a [routerLink]="link.path" routerLinkActive="current" #active="routerLinkActive"
        [routerLinkActiveOptions]="{exact: link.path === '/inventory' || link.path === '/operations'}"
        [attr.aria-current]="active.isActive ? 'page' : null">{{link.label}}</a>
    }
  </nav>`,
})
export class SectionNav {
  readonly area = input.required<'inventory' | 'operations'>();
  readonly inventory = [
    {path: '/inventory', label: 'Stock on hand'},
    {path: '/locations', label: 'Locations'},
    {path: '/replenishment', label: 'Replenishment'},
  ];
  readonly operations = [
    {path: '/operations', label: 'History'},
    {path: '/receipts/new', label: 'Receiving'},
    {path: '/transfers/new', label: 'Transfers'},
    {path: '/waste/new', label: 'Waste'},
    {path: '/counts', label: 'Physical counts'},
    {path: '/suppliers', label: 'Suppliers'},
  ];
}
