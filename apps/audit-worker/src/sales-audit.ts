import { Inject, Injectable, Logger } from '@nestjs/common';
import { connect } from '@nats-io/transport-node';
import { jetstream } from '@nats-io/jetstream';
import { MongoClient, MongoServerError, type Collection } from 'mongodb';
import { isUuid } from '@stockflow/primitives';
import type { SalesEvent } from '@stockflow/contracts';
import { HandleSalesEvent, type SalesAuditRepository } from './application/handle-sales-event';

const fields=['schemaVersion','eventId','eventType','saleId','referenceId','locationId','amountMinor','currency','occurredAt'] as const;
export function parseSalesEvent(data:Uint8Array,subject:string):SalesEvent{
  const value:unknown=JSON.parse(new TextDecoder().decode(data));
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Invalid sales event body.');
  const event=value as Record<string,unknown>;
  if(Object.keys(event).length!==fields.length+(event.receiptReference!==undefined?1:0)||fields.some(key=>!(key in event))||event.schemaVersion!==1)throw new Error('Invalid sales event schema.');
  if(event.receiptReference!==undefined&&(typeof event.receiptReference!=='string'||!event.receiptReference.trim()||event.receiptReference.length>100))throw new Error('Invalid receipt reference.');
  if(['eventId','saleId','referenceId','locationId'].some(key=>!isUuid(event[key])))throw new Error('Invalid sales event ID.');
  if(!Number.isSafeInteger(event.amountMinor)||(event.amountMinor as number)<0||typeof event.currency!=='string'||!/^[A-Z]{3}$/.test(event.currency))throw new Error('Invalid sales event amount/currency.');
  const expected=event.eventType==='SaleCompleted'?'sales.sale.completed':event.eventType==='SaleRefunded'?'sales.sale.refunded':null;
  if(!expected||expected!==subject)throw new Error('Sales event type does not match subject.');
  if(typeof event.occurredAt!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(event.occurredAt)||!Number.isFinite(Date.parse(event.occurredAt))||new Date(event.occurredAt).toISOString()!==event.occurredAt)throw new Error('Invalid sales event time.');
  return event as unknown as SalesEvent;
}
export function sameSalesEvent(left:SalesEvent,right:SalesEvent){return fields.every(key=>left[key]===right[key])&&left.receiptReference===right.receiptReference;}
export class MongoSalesAuditRepository implements SalesAuditRepository{
  private readonly collection:Collection<{_id:string;event:SalesEvent;receivedAt:string}>;
  constructor(client:MongoClient){this.collection=client.db().collection('sales_events');}
  async save(event:SalesEvent){
    try{await this.collection.insertOne({_id:event.eventId,event,receivedAt:new Date().toISOString()});}
    catch(error){if(!(error instanceof MongoServerError)||Number(error.code)!==11000)throw error;const previous=await this.collection.findOne({_id:event.eventId});if(!previous||!sameSalesEvent(previous.event,event))throw new Error('Conflicting sales event payload.');}
  }
}
@Injectable()
export class SalesAuditConsumer{
  private readonly logger=new Logger(SalesAuditConsumer.name);private stopped=false;private running?:Promise<void>;
  constructor(@Inject('HANDLE_SALES_EVENT')private readonly handler:HandleSalesEvent){}
  onModuleInit(){this.running=this.run();}
  async onModuleDestroy(){this.stopped=true;await this.running;}
  private async run(){
    while(!this.stopped){let connection:Awaited<ReturnType<typeof connect>>|undefined;
      try{connection=await connect({servers:process.env.NATS_URL!,timeout:2000,maxReconnectAttempts:3});const consumer=await jetstream(connection).consumers.get('SALES_EVENTS','sales-audit');this.logger.log('Attached to sales-audit durable consumer.');
        while(!this.stopped){const message=await consumer.next({expires:5000});if(!message)continue;try{await this.handler.execute(parseSalesEvent(message.data,message.subject));message.ack();this.logger.log(`Audited ${message.subject}`);}catch(error){this.logger.error(`Sales event left unacknowledged: ${String(error)}`);}}
      }catch(error){if(!this.stopped){this.logger.warn(`Sales consumer reconnect: ${String(error)}`);await new Promise(resolve=>setTimeout(resolve,2000));}}
      finally{try{await connection?.drain();}catch{await connection?.close();}}
    }
  }
}
