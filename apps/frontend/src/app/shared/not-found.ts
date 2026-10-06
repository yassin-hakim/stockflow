import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
@Component({
  selector: 'app-not-found',
  imports: [RouterLink],
  template:
    '<section class="empty-state"><span class="eyebrow">Navigation</span><h1>Page not found</h1><p>This page could not be found. Return to inventory to continue working.</p><a routerLink="/inventory">Return to inventory</a></section>',
})
export class NotFound {}
