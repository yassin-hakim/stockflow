import { Component, input, output, signal } from '@angular/core';

/** Cached cursor pages remain navigable without repeating writes or report calculations. */
export class Paging {
  readonly page = signal(1);
  readonly size = signal(10);
  readonly busy = signal(false);
  reset() { this.page.set(1); }
  resize(value:number) { this.size.set(value); this.reset(); }
  current(total:number) { return Math.min(this.page(), Math.max(1, Math.ceil(total / this.size()))); }
  slice<T>(rows:readonly T[]):T[] { const start=(this.current(rows.length)-1)*this.size(); return rows.slice(start,start+this.size()); }
  async go(target:number, count:()=>number, more:()=>boolean=()=>false, fetch?:()=>Promise<void>) {
    if(this.busy() || target<1) return;
    this.busy.set(true);
    try {
      while(fetch && more() && count()<target*this.size()) {
        const before=count(); await fetch();
        if(count()<=before) return;
      }
      this.page.set(Math.min(target,Math.max(1,Math.ceil(count()/this.size()))));
    } finally { this.busy.set(false); }
  }
}

@Component({
  selector:'app-pagination',
  template:`<nav class="pagination" [attr.aria-label]="label()" [attr.aria-busy]="busy()">
    <p role="status">@if(total()){ Showing {{ (page()-1)*size()+1 }}–{{ end() }} @if(!hasMore()){ of {{total()}} } } @else { No records } · Page {{page()}} @if(hasMore()){ · More available }</p>
    <div class="pagination-actions">
      <label>Rows per page <select aria-label="Rows per page" [value]="size()" [disabled]="busy()" (change)="sizeChange.emit(+$any($event.target).value)"><option value="10">10</option><option value="25">25</option><option value="50">50</option></select></label>
      <button type="button" class="secondary" [disabled]="busy() || page()<=1" (click)="pageChange.emit(page()-1)">Previous</button>
      <button type="button" class="secondary" [disabled]="busy() || (!hasMore() && end()>=total())" (click)="pageChange.emit(page()+1)">Next</button>
    </div>
  </nav>`,
})
export class Pagination {
  readonly total=input.required<number>();
  readonly page=input(1);
  readonly size=input(10);
  readonly hasMore=input(false);
  readonly busy=input(false);
  readonly label=input('Record pages');
  readonly pageChange=output<number>();
  readonly sizeChange=output<number>();
  end(){return Math.min(this.page()*this.size(),this.total());}
}
