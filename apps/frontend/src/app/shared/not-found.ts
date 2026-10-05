import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
@Component({ selector: 'app-not-found', imports: [RouterLink], template: '<section class="panel"><h1>Page not found</h1><p>This page does not exist.</p><a routerLink="/inventory">Return to inventory</a></section>' })
export class NotFound {}
