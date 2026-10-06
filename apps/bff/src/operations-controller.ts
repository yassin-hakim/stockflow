import { Body, Controller, Get, Headers, HttpCode, Inject, Param, Patch, Post, Query, Req } from '@nestjs/common';
import type { Items, Product, Location, LocationBalance, StockView, ReplenishmentRule } from '@stockflow/contracts';
import { HttpUpstream } from './upstream';
import { identifier, object, operationBody, requestId, stockBody, uuid, validatedQuery } from './validation';
import { overview } from './projection';

type Request = { headers: Record<string,string | undefined> };
@Controller('api')
export class OperationsController {
  constructor(@Inject('PRODUCT_HTTP') private readonly products: HttpUpstream, @Inject('INVENTORY_HTTP') private readonly inventory: HttpUpstream) {}
  @Get('receiving-config') receivingConfig(@Req()req:Request){return this.inventory.request('/receiving-config',{requestId:requestId(req)});}
  @Get('locations') locations(@Req() req: Request) { return this.inventory.request('/locations',{requestId:requestId(req)}); }
  @Post('locations') create(@Body() body: unknown,@Req() req: Request) { return this.inventory.request('/locations',{method:'POST',body,requestId:requestId(req)}); }
  @Get('locations/:id') location(@Param('id') id: string,@Req() req: Request) { return this.inventory.request(`/locations/${uuid(id,'location ID')}`,{requestId:requestId(req)}); }
  @Patch('locations/:id') rename(@Param('id') id: string,@Body() body: unknown,@Req() req: Request) { return this.inventory.request(`/locations/${uuid(id,'location ID')}`,{method:'PATCH',body,requestId:requestId(req)}); }
  @Get('stock') async stock(@Query('locationId') locationId: string | undefined,@Req() req: Request): Promise<Items<StockView>> {
    const location = locationId ? uuid(locationId,'location ID') : undefined, request = requestId(req);
    const [products,balances,rules] = await Promise.all([
      this.products.request<Items<Product>>('/products',{requestId:request}),
      this.inventory.request<Items<LocationBalance>>(`/stock${location ? `?locationId=${location}` : ''}`,{requestId:request}),
      location?this.inventory.request<Items<ReplenishmentRule>>(`/replenishment-rules?locationId=${location}`,{requestId:request}):Promise.resolve({items:[] as ReplenishmentRule[]}),
    ]);
    return { items: products.items.sort((a,b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)).map(product => {
      const quantity = balances.items.filter(row => row.productId === product.id).reduce((sum,row) => sum + Math.round(row.quantity * 1000),0) / 1000;
      const rule=rules.items.find(row=>row.productId===product.id),threshold=rule?.lowStockThreshold ?? product.lowStockThreshold;
      return { ...overview({...product,lowStockThreshold:threshold},quantity),product,locationId:location ?? null,lowStockThreshold:threshold,targetQuantity:rule?.targetQuantity ?? null };
    }) };
  }
  @Get('stock/:productId') async productStock(@Param('productId') id:string,@Query('locationId') locationId:string|undefined,@Req() req:Request) {
    uuid(id,'product ID');const data=await this.stock(locationId,req),row=data.items.find(item=>item.product.id===id);if(!row){await this.products.request(`/products/${id}`,{requestId:requestId(req)});throw new Error('Stock projection unavailable.');}
    if (!locationId) {
      const request = requestId(req);
      const [locations, balances, rules] = await Promise.all([
        this.inventory.request<Items<Location>>('/locations', {requestId:request}),
        this.inventory.request<Items<LocationBalance>>('/stock', {requestId:request}),
        this.inventory.request<Items<ReplenishmentRule>>('/replenishment-rules', {requestId:request}),
      ]);
      row.locations = locations.items.map(location => {
        const quantity = balances.items.find(balance => balance.productId === id && balance.locationId === location.id)?.quantity ?? 0;
        const rule = rules.items.find(rule => rule.productId === id && rule.locationId === location.id);
        const threshold = rule?.lowStockThreshold ?? row.product.lowStockThreshold;
        return {locationId:location.id, name:location.name, quantity, status:overview({...row.product,lowStockThreshold:threshold},quantity).status, lowStockThreshold:threshold, targetQuantity:rule?.targetQuantity ?? null};
      });
    }
    return row;
  }
  @Post('stock/:productId/add') @HttpCode(200) add(@Param('productId') id:string,@Body() input:unknown,@Headers('idempotency-key') key:string|undefined,@Req() req:Request){return this.manual(id,'add',input,key,req);}
  @Post('stock/:productId/remove') @HttpCode(200) remove(@Param('productId') id:string,@Body() input:unknown,@Headers('idempotency-key') key:string|undefined,@Req() req:Request){return this.manual(id,'remove',input,key,req);}
  private manual(id:string,action:string,input:unknown,key:string|undefined,req:Request){const body=object(input,['locationId','quantity','reason','reference']);stockBody({quantity:body.quantity,reason:body.reason});identifier(body.locationId,'location ID');return this.inventory.request(`/stock/${uuid(id,'product ID')}/${action}`,{method:'POST',body,idempotencyKey:uuid(key??'','Idempotency-Key'),requestId:requestId(req)});}
  @Get('stock/:productId/movements') movements(@Param('productId') id: string,@Query() query: Record<string,string>,@Req() req: Request) { return this.inventory.request(`/stock/${uuid(id,'product ID')}/movements${queryString(validatedQuery(query,['locationId','cause','from','to','cursor','limit']))}`,{requestId:requestId(req)}); }
  @Get('stock-operations/:id') operation(@Param('id') id: string,@Req() req: Request) { return this.inventory.request(`/stock-operations/${uuid(id,'operation ID')}`,{requestId:requestId(req)}); }
  @Get('operations') operations(@Query() query: Record<string,string>,@Req() req: Request) { return this.inventory.request(`/operations${queryString(validatedQuery(query,['locationId','kind','from','to','cursor','limit']))}`,{requestId:requestId(req)}); }
  @Get('receipts/:id') receipt(@Param('id') id: string,@Req() req: Request) { return this.inventory.request(`/receipts/${uuid(id,'receipt ID')}`,{requestId:requestId(req)}); }
  @Get('transfers/:id') transfer(@Param('id') id: string,@Req() req: Request) { return this.inventory.request(`/transfers/${uuid(id,'transfer ID')}`,{requestId:requestId(req)}); }
  @Get('waste/:id') waste(@Param('id') id: string,@Req() req: Request) { return this.inventory.request(`/waste/${uuid(id,'waste ID')}`,{requestId:requestId(req)}); }
  @Post('receipts') @HttpCode(200) receive(@Body() body: unknown,@Headers('idempotency-key') key: string | undefined,@Req() req: Request) { return this.command('receipts',body,key,req); }
  @Post('transfers') @HttpCode(200) transferStock(@Body() body: unknown,@Headers('idempotency-key') key: string | undefined,@Req() req: Request) { return this.command('transfers',body,key,req); }
  @Post('waste') @HttpCode(200) recordWaste(@Body() body: unknown,@Headers('idempotency-key') key: string | undefined,@Req() req: Request) { return this.command('waste',body,key,req); }
  private command(path: string,body: unknown,key: string | undefined,req: Request) { return this.inventory.request(`/${path}`,{method:'POST',body:operationBody(body,path),idempotencyKey:uuid(key ?? '','Idempotency-Key'),requestId:requestId(req)}); }
}
export function queryString(query: Record<string,string>): string { const parameters = new URLSearchParams(query); return parameters.size ? `?${parameters}` : ''; }
