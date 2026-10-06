import { Paging } from './pagination';
describe('record pagination',()=>{
  it('fills a page across cursor boundaries without skipping records and supports Previous',async()=>{
    const paging=new Paging();let rows=Array.from({length:25},(_,i)=>i),cursor=true;
    await paging.go(3,()=>rows.length,()=>cursor,async()=>{rows.push(...Array.from({length:25},(_,i)=>i+25));cursor=false;});
    expect(paging.slice(rows)).toEqual([20,21,22,23,24,25,26,27,28,29]);
    await paging.go(2,()=>rows.length);expect(paging.slice(rows)[0]).toBe(10);
    paging.resize(25);expect(paging.page()).toBe(1);expect(paging.slice(rows)).toHaveLength(25);
  });
  it('does not advance on a failed fetch and clamps after filtering',async()=>{
    const paging=new Paging();await paging.go(2,()=>10,()=>true,async()=>{});
    expect(paging.page()).toBe(1);paging.page.set(5);expect(paging.current(3)).toBe(1);
    expect(paging.slice([1,2,3])).toEqual([1,2,3]);
  });
});
