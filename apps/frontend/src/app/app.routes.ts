import { Routes } from '@angular/router';
import { Dashboard } from './inventory/dashboard';
import { ProductCreate } from './products/product-create';
import { ProductDetail } from './products/product-detail';
import { NotFound } from './shared/not-found';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'inventory' },
  { path: 'inventory', component: Dashboard, title: 'Inventory | StockFlow' },
  { path: 'products/new', component: ProductCreate, title: 'New product | StockFlow' },
  { path: 'products/:id', component: ProductDetail, title: 'Product | StockFlow' },
  { path: '**', component: NotFound, title: 'Page not found | StockFlow' },
];
