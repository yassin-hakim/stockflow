import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { ReportsController, csvCell } from '../src/reports-controller';
import { HttpUpstream, UpstreamError } from '../src/upstream';

const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', location='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const req={headers:{'x-request-id':'report-test'}}, response={setHeader:vi.fn()};
const port=(request:ReturnType<typeof vi.fn>)=>({request}) as unknown as HttpUpstream;
describe('report export presentation',()=>{
  it('escapes leading formulas even after whitespace and doubles embedded quotes',()=>{
    for(const operator of ['=','+','@','-'])expect(csvCell(` \t${operator}"quoted"`)).toBe(`"' \t${operator}""quoted"""`);
    expect(csvCell('Milk "whole"')).toBe('"Milk ""whole"""');
  });
  it('exports every filtered page with readable names, cached references, safe reasons and intact quantities',async()=>{
    const movement={productId:id,locationId:location,operationId:id,cause:'RECEIPT',type:'ADD',quantity:0.001,resultingQuantity:0.002,createdAt:'2026-10-06T10:00:00.000Z',reason:' \t+"reason"'};
    const inventory=vi.fn(async(path:string)=>path==='/locations'?{items:[{id:location,name:' @"Warehouse"'}]}:path.startsWith('/stock-operations/')?{reference:'-"Delivery"'}:{items:[movement],nextCursor:path.includes('cursor=')?null:'next-page'});
    const controller=new ReportsController(port(inventory),port(vi.fn(async()=>({items:[{id,name:' ="Milk"',unit:'L'}]}))),port(vi.fn()));
    const csv=await controller.inventoryCsv({locationId:location,cause:'RECEIPT',from:'2026-10-06T00:00:00Z',to:'2026-10-07T00:00:00Z',limit:'1'},req,response);
    expect(csv).not.toContain(id);expect(csv).not.toContain(location);
    expect(csv).toContain('"\' =""Milk"""');expect(csv).toContain('"\' @""Warehouse"""');expect(csv).toContain('"\'-""Delivery"""');expect(csv).toContain('"\' \t+""reason"""');
    expect(csv.split('\r\n')).toHaveLength(3);expect(csv).toContain(',0.001,0.002,');
    const paths=inventory.mock.calls.map(([path])=>path);
    expect(paths.filter(path=>path.startsWith('/stock-operations/'))).toHaveLength(1);
    for(const path of paths.filter(path=>path.startsWith('/reports/'))){const query=new URL(path,'http://local').searchParams;expect(query.get('locationId')).toBe(location);expect(query.get('cause')).toBe('RECEIPT');expect(query.get('limit')).toBe('100');expect(query.get('from')).toBe('2026-10-06T00:00:00Z');}
  });
  it('humanizes generated sale references without changing upstream records and fails missing location projection',async()=>{
    const row={id,saleId:id,kind:'SALE',reference:`SF-${id.toUpperCase()}`,occurredAt:'2026-10-06T10:00:00.000Z',locationId:location,amountMinor:125,currency:'USD',lines:[{name:'="Latte"',quantity:1}]};
    const sales=vi.fn(async()=>({items:[row],nextCursor:null}));
    const inventory=vi.fn(async()=>({items:[{id:location,name:'-"Store"'}]}));
    const controller=new ReportsController(port(inventory),port(vi.fn()),port(sales));
    const csv=await controller.salesCsv({},req,response);
    expect(csv).not.toMatch(/[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}/i);expect(csv).toContain('Sale · 1 × =""Latte""');expect(csv).toContain('"\'-""Store"""');expect(row.reference).toBe(`SF-${id.toUpperCase()}`);
    inventory.mockResolvedValue({items:[]});await expect(controller.salesCsv({},req,response)).rejects.toBeInstanceOf(UpstreamError);
  });
  it('supports migrated manual movement references but does not mask an unavailable owner',async()=>{
    const movement={productId:id,locationId:location,operationId:id,cause:'MANUAL',type:'ADD',quantity:1,resultingQuantity:1,createdAt:'2026-10-06T10:00:00.000Z',reason:'Migration'};
    const inventory=vi.fn(async(path:string)=>{if(path==='/locations')return {items:[{id:location,name:'Main Store'}]};if(path.startsWith('/stock-operations/'))throw new UpstreamError(404,'OPERATION_NOT_FOUND','Legacy');return {items:[movement],nextCursor:null};});
    const controller=new ReportsController(port(inventory),port(vi.fn(async()=>({items:[{id,name:'Milk',unit:'L'}]}))),port(vi.fn()));
    expect(await controller.inventoryCsv({},req,response)).toContain('Manual stock adjustment · Main Store');
    inventory.mockImplementation(async()=>{throw new UpstreamError(502,'UPSTREAM_UNAVAILABLE','Unavailable');});await expect(controller.inventoryCsv({},req,response)).rejects.toMatchObject({status:502});
  });
});
