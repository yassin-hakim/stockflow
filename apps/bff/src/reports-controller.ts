import { Controller, Get, Inject, Query, Req, Res } from '@nestjs/common';
import type { InventoryReport, Items, Product, Location, ProfitLossReport, SalesReport, StockOperation, MovementCause } from '@stockflow/contracts';
import { HttpUpstream, UpstreamError } from './upstream';
import { requestId, validatedQuery } from './validation';
import { queryString } from './operations-controller';
type Request={headers:Record<string,string|undefined>};
type Response={setHeader:(name:string,value:string)=>void};
export function csvCell(value:unknown):string{let text=String(value??'');if(/^[\s]*[=+@-]/.test(text))text=`'${text}`;return `"${text.replace(/"/g,'""')}"`;}
const UUID=/\b[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}\b/gi;
function readable(text:string,names:Map<string,string>=new Map()):string{return text.replace(UUID,id=>names.get(id.toLowerCase())??'(name unavailable)');}
function reference(text:string,fallback:string):string{return text&&!new RegExp(UUID).test(text)?text:fallback;}
const operationNames:Record<MovementCause,string>={MANUAL:'Manual stock adjustment',RECEIPT:'Delivery',TRANSFER:'Stock transfer',WASTE:'Waste',COUNT:'Physical count adjustment',SALE:'Sale consumption',SALE_RETURN:'Sale stock return'};
@Controller('api/reports')
export class ReportsController{
  constructor(@Inject('INVENTORY_HTTP')private readonly inventory:HttpUpstream,@Inject('PRODUCT_HTTP')private readonly products:HttpUpstream,@Inject('SALES_HTTP')private readonly sales:HttpUpstream){}
  @Get('inventory') async inventoryReport(@Query()query:Record<string,string>,@Req()req:Request):Promise<InventoryReport>{
    const filters=validatedQuery(query,['locationId','productId','cause','from','to','cursor','limit']);
    const [report,catalog]=await Promise.all([this.inventory.request<InventoryReport>(`/reports/inventory${queryString(filters)}`,{requestId:requestId(req)}),this.products.request<Items<Product>>('/products',{requestId:requestId(req)})]);
    return {...report,products:report.products.map(row=>{const product=catalog.items.find(item=>item.id===row.productId);if(!product)throw new UpstreamError(502,'UPSTREAM_UNAVAILABLE','Report product reference is unavailable.');return {...row,name:product.name,unit:product.unit};})};
  }
  @Get('profit-loss') profitLoss(@Query()query:Record<string,string>,@Req()req:Request){return this.sales.request(`/reports/profit-loss${queryString(validatedQuery(query,['locationId','from','to','cursor','limit']))}`,{requestId:requestId(req)});}
  @Get('sales') salesReport(@Query()query:Record<string,string>,@Req()req:Request){return this.sales.request(`/reports/sales${queryString(validatedQuery(query,['locationId','from','to','cursor','limit']))}`,{requestId:requestId(req)});}
  @Get('profit-loss/export') async profitLossCsv(@Query()query:Record<string,string>,@Req()req:Request,@Res({passthrough:true})response:Response){
    const filters=validatedQuery(query,['locationId','from','to','limit']);
    const [report,locations]=await Promise.all([this.sales.request<ProfitLossReport>(`/reports/profit-loss/export-data${queryString(filters)}`,{requestId:requestId(req)}),this.inventory.request<Items<Location>>('/locations',{requestId:requestId(req)})]);
    const name=(id:string)=>this.locationName(locations,id);
    const rows:unknown[][]=[['Period from (UTC)',report.from],['Period until (UTC)',report.to],['Location',report.locationId?name(report.locationId):'All locations'],[],['Metric','Amount (minor units)','Currency'],['Gross sales',report.grossSalesMinor,report.currency],['Refunds',report.refundMinor,report.currency],['Net sales',report.netRevenueMinor,report.currency],['Ingredient costs',report.ingredientCostMinor??'Incomplete',report.currency],['Known ingredient costs',report.knownCostMinor,report.currency],['Missing cost records',report.missingCostRecords],['Gross profit',report.grossProfitMinor??'Unavailable',report.currency],[],['Kind','Receipt / items','Occurred at (UTC)','Location','Revenue (minor units)','Ingredient cost (minor units)','Gross profit (minor units)','Currency']];
    for(const row of report.items){const items=row.lines.map(line=>`${line.quantity} × ${readable(line.name)}`).join('; ');rows.push([row.kind,items,row.occurredAt,name(row.locationId),row.revenueMinor,row.costMinor??'Unrecorded',row.grossProfitMinor??'Unavailable',row.currency]);}
    this.headers(response,'profit-loss');return '\uFEFF'+rows.map(row=>row.map(value=>typeof value==='number'?String(value):csvCell(value)).join(',')).join('\r\n');
  }
  @Get('sales/export')async salesCsv(@Query()query:Record<string,string>,@Req()req:Request,@Res({passthrough:true})response:Response){
    const filters=validatedQuery(query,['locationId','from','to','limit']);
    const locations=await this.inventory.request<Items<Location>>('/locations',{requestId:requestId(req)});
    const rows:unknown[][]=[['Kind','Receipt / reference','Occurred at (UTC)','Location','Amount (minor units)','Currency','Items']];
    let cursor:string|null=null,count=0;
    do{const page:SalesReport=await this.sales.request< SalesReport>(`/reports/sales${queryString({...filters,limit:'100',...(cursor?{cursor}:{})})}`,{requestId:requestId(req)});
      for(const row of page.items){if(++count>10000)throw new UpstreamError(422,'INVALID_REQUEST','Export exceeds 10,000 records; narrow the filters.');const items=row.lines.map(line=>`${line.quantity} × ${readable(line.name)}`).join('; ');rows.push([row.kind,reference(row.reference,`${row.kind==='REFUND'?'Refund':'Sale'} · ${items} · ${row.occurredAt}`),row.occurredAt,this.locationName(locations,row.locationId),row.amountMinor,row.currency,items]);}cursor=page.nextCursor;
    }while(cursor);
    this.headers(response,'sales');return '\uFEFF'+rows.map(row=>row.map(value=>typeof value==='number'?String(value):csvCell(value)).join(',')).join('\r\n');
  }
  @Get('inventory/export')async inventoryCsv(@Query()query:Record<string,string>,@Req()req:Request,@Res({passthrough:true})response:Response){
    const filters=validatedQuery(query,['locationId','productId','cause','from','to','limit']);
    const [catalog,locations]=await Promise.all([this.products.request<Items<Product>>('/products',{requestId:requestId(req)}),this.inventory.request<Items<Location>>('/locations',{requestId:requestId(req)})]);
    const names=new Map([...catalog.items,...locations.items].map(row=>[row.id.toLowerCase(),row.name]));
    const references=new Map<string,Promise<string>>();
    const operationReference=(id:string,cause:MovementCause,createdAt:string,location:string)=>{
      if(!references.has(id))references.set(id,this.inventory.request<StockOperation>(`/stock-operations/${id}`,{requestId:requestId(req)}).then(operation=>reference(operation.reference,`${operationNames[cause]} · ${location} · ${createdAt}`)).catch(error=>{
        // Migrated v1 manual movements have no compound-operation document.
        if(cause==='MANUAL'&&error instanceof UpstreamError&&error.status===404)return `${operationNames[cause]} · ${location} · ${createdAt}`;
        throw error;
      }));
      return references.get(id)!;
    };
    const rows=[['Occurred at (UTC)','Product','Unit','Location','Reference','Cause','Type','Quantity','Resulting stock','Reason'].map(csvCell).join(',')];
    let cursor:string|null=null,count=0;
    do{const page:InventoryReport=await this.inventory.request<InventoryReport>(`/reports/inventory${queryString({...filters,limit:'100',...(cursor?{cursor}:{})})}`,{requestId:requestId(req)});
      for(const movement of page.items){if(++count>10000)throw new UpstreamError(422,'INVALID_REQUEST','Export exceeds 10,000 movements; narrow the filters.');const product=catalog.items.find(row=>row.id===movement.productId);if(!product)throw new UpstreamError(502,'UPSTREAM_UNAVAILABLE','Report product reference is unavailable.');const location=this.locationName(locations,movement.locationId),ref=await operationReference(movement.operationId,movement.cause,movement.createdAt,location);
        const reason=readable(movement.reason.replace(/^Sale [\da-f-]{36}$/i,'Sale consumption').replace(/^Refund [\da-f-]{36}:\s*/i,'Refund: '),names);
        rows.push([movement.createdAt,readable(product.name,names),readable(product.unit,names),location,ref,movement.cause,movement.type,movement.quantity,movement.resultingQuantity,reason].map(value=>typeof value==='number'?String(value):csvCell(value)).join(','));}cursor=page.nextCursor;
    }while(cursor);
    this.headers(response,'inventory');return '\uFEFF'+rows.join('\r\n');
  }
  private locationName(locations:Items<Location>,id:string){const location=locations.items.find(row=>row.id===id);if(!location)throw new UpstreamError(502,'UPSTREAM_UNAVAILABLE','Report location names are unavailable.');return readable(location.name);}
  private headers(response:Response,name:string){response.setHeader('Content-Type','text/csv; charset=utf-8');response.setHeader('Content-Disposition',`attachment; filename="${name}-report.csv"`);}
}
