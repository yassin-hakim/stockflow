import { Component, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  readonly menuOpen = signal(false);
  readonly section = signal('inventory');
  closeMenu(): void {
    this.menuOpen.set(false);
    document.querySelector<HTMLButtonElement>('.nav-toggle')?.focus();
  }
  constructor() {
    const router = inject(Router);
    router
      .events.pipe(
        filter((event) => event instanceof NavigationEnd),
        takeUntilDestroyed(),
      )
      .subscribe(() => {
        const path = router.url.split('/')[1]?.split('?')[0];
        this.section.set(['menu', 'pos', 'sales', 'reports'].includes(path) ? path :
          ['operations', 'receipts', 'transfers', 'waste', 'counts', 'suppliers'].includes(path) ? 'operations' :
          ['inventory', 'products', 'locations', 'replenishment'].includes(path) ? 'inventory' : '');
        this.menuOpen.set(false);
        setTimeout(() => {
          const heading = document.querySelector<HTMLElement>('.shell-main h1');
          heading?.setAttribute('tabindex', '-1');
          heading?.focus();
        }, 0);
      });
  }
}
