import { describe,expect,it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { SalesEvent } from '@stockflow/contracts';
import { parseSalesEvent,sameSalesEvent } from '../src/sales-audit';
const event:SalesEvent={schemaVersion:1,eventId:randomUUID(),eventType:'SaleCompleted',saleId:randomUUID(),referenceId:randomUUID(),locationId:randomUUID(),amountMinor:1200,currency:'USD',occurredAt:'2026-10-06T14:00:00.000Z',receiptReference:'SF-TEST'};
function parse(value:unknown,subject='sales.sale.completed'){return parseSalesEvent(new TextEncoder().encode(JSON.stringify(value)),subject);}
describe('Sales audit envelope',()=>{
  it('accepts current receipt reference and previous v1 envelope without it',()=>{expect(parse(event)).toEqual(event);const {receiptReference,...previous}=event;expect(parse(previous)).toEqual(previous);expect(parse({...event,amountMinor:0})).toMatchObject({amountMinor:0});});
  it('rejects wrong subject, unknown fields, malformed IDs, unsafe money and time',()=>{expect(()=>parse(event,'sales.sale.refunded')).toThrow();for(const modified of [{...event,extra:true},{...event,eventId:'bad'},{...event,amountMinor:1.2},{...event,amountMinor:Number.MAX_SAFE_INTEGER+1},{...event,occurredAt:'2026-02-30T14:00:00.000Z'}])expect(()=>parse(modified)).toThrow();});
  it('deduplicates only identical immutable facts including receipt reference',()=>{expect(sameSalesEvent(event,{...event})).toBe(true);expect(sameSalesEvent(event,{...event,receiptReference:'OTHER'})).toBe(false);expect(sameSalesEvent(event,{...event,amountMinor:800})).toBe(false);});
});
