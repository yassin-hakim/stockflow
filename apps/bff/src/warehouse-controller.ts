import { BadRequestException, Body, Controller, Get, Headers, HttpCode, Inject, Param, Patch, Post, Query, Req } from '@nestjs/common';
import type { Items, Product, ReplenishmentItem } from '@stockflow/contracts';
import { HttpUpstream } from './upstream';
import { archiveBody, decimal, identifier, object, requestId, text, validatedQuery, version } from './validation';
import { queryString } from './operations-controller';
import { overview } from './projection';
type Request={headers:Record<string,string|undefined>};
@Controller('api')
export class WarehouseController {
  constructor(@Inject('INVENTORY_HTTP') private readonly inventory:HttpUpstream,@Inject('PRODUCT_HTTP') private readonly products:HttpUpstream) {}
  @Get('suppliers') suppliers(@Req() req:Request) {return this.read('/suppliers',req);}
  @Post('suppliers') createSupplier(@Body() input:unknown,@Req() req:Request) {const body=object(input,['name','note']);return this.write('/suppliers',{name:text(body.name,'name',100),note:text(body.note,'note',300,true)},req);}
  @Patch('suppliers/:id') editSupplier(@Param('id') id:string,@Body() input:unknown,@Req() req:Request) {const body=object(input,['name','note','expectedVersion']);return this.write(`/suppliers/${identifier(id)}`,{name:text(body.name,'name',100),note:text(body.note,'note',300,true),expectedVersion:version(body.expectedVersion)},req,undefined,'PATCH');}
  @Get('counts') counts(@Query() query:Record<string,string>,@Req() req:Request) {return this.read(`/counts${queryString(validatedQuery(query,['locationId','cursor','limit']))}`,req);}
  @Get('counts/:id') count(@Param('id') id:string,@Req() req:Request) {return this.read(`/counts/${identifier(id)}`,req);}
  @Post('counts') @HttpCode(200) createCount(@Body() input:unknown,@Headers('idempotency-key') key:string|undefined,@Req() req:Request) {
    const body=object(input,['locationId','productIds','reason']);
    if(!Array.isArray(body.productIds) || !body.productIds.length || body.productIds.length>100) throw new BadRequestException('Choose 1–100 products.');
    return this.write('/counts',{locationId:identifier(body.locationId),productIds:body.productIds.map(id=>identifier(id)),reason:text(body.reason,'reason')},req,identifier(key,'Idempotency-Key'));
  }
  @Patch('counts/:id') editCount(@Param('id') id:string,@Body() input:unknown,@Req() req:Request) {
    const body=object(input,['expectedVersion','lines','reason']);
    if(!Array.isArray(body.lines) || !body.lines.length || body.lines.length>100) throw new BadRequestException('Choose 1–100 count lines.');
    return this.write(`/counts/${identifier(id)}`,{expectedVersion:version(body.expectedVersion),lines:body.lines.map(input=>{const line=object(input,['productId','countedQuantity']);return {productId:identifier(line.productId),countedQuantity:line.countedQuantity===null?null:decimal(line.countedQuantity,true)};}),...(body.reason!==undefined?{reason:text(body.reason,'reason')}:{})},req,undefined,'PATCH');
  }
  @Post('counts/:id/apply') @HttpCode(200) apply(@Param('id') id:string,@Body() body:unknown,@Headers('idempotency-key') key:string|undefined,@Req() req:Request) {return this.write(`/counts/${identifier(id)}/apply`,archiveBody(body),req,identifier(key,'Idempotency-Key'));}
  @Post('counts/:id/cancel') @HttpCode(200) cancel(@Param('id') id:string,@Body() body:unknown,@Req() req:Request) {return this.write(`/counts/${identifier(id)}/cancel`,archiveBody(body),req);}
  @Get('replenishment-rules') rules(@Query() query:Record<string,string>,@Req() req:Request) {return this.read(`/replenishment-rules${queryString(validatedQuery(query,['locationId']))}`,req);}
  @Post('replenishment-rules') @HttpCode(200) saveRule(@Body() input:unknown,@Req() req:Request) {const body=object(input,['productId','locationId','lowStockThreshold','targetQuantity','expectedVersion']);return this.write('/replenishment-rules',{productId:identifier(body.productId),locationId:identifier(body.locationId),lowStockThreshold:decimal(body.lowStockThreshold,true),targetQuantity:decimal(body.targetQuantity,true),expectedVersion:body.expectedVersion===null?null:version(body.expectedVersion)},req);}
  @Get('replenishment') async replenishment(@Query('locationId') locationId:string,@Req() req:Request):Promise<Items<ReplenishmentItem>> {
    const request=requestId(req),location=identifier(locationId,'location ID');
    const [catalog,rows]=await Promise.all([this.products.request<Items<Product>>('/products',{requestId:request}),this.inventory.request<Items<{productId:string;quantity:number;lowStockThreshold:number|null;targetQuantity:number|null;suggestedQuantity:number|null;version:number|null}>>(`/replenishment?locationId=${location}`,{requestId:request})]);
    return {items:catalog.items.filter(product=>!product.archivedAt).map(product=>{const row=rows.items.find(row=>row.productId===product.id),threshold=row?.lowStockThreshold??product.lowStockThreshold,quantity=row?.quantity??0;return {...overview({...product,lowStockThreshold:threshold},quantity),product,locationId:location,lowStockThreshold:threshold,targetQuantity:row?.targetQuantity??null,suggestedQuantity:row?.suggestedQuantity??null,version:row?.version??null};})};
  }
  private read(path:string,req:Request){return this.inventory.request(path,{requestId:requestId(req)});}
  private write(path:string,body:unknown,req:Request,key?:string,method:'POST'|'PATCH'='POST'){return this.inventory.request(path,{method,body,idempotencyKey:key,requestId:requestId(req)});}
}
