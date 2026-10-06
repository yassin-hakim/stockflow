import { BadRequestException, Body, Controller, Get, Headers, HttpCode, Inject, Param, Patch, Post, Query, Req, Res } from '@nestjs/common';
import type { Refund, Sale } from '@stockflow/contracts';
import { HttpUpstream } from './upstream';
import { archiveBody, identifier, object, requestId, text, validatedQuery, version } from './validation';
import { queryString } from './operations-controller';
type Request={headers:Record<string,string|undefined>};
type Response={status:(code:number)=>void;setHeader:(key:string,value:string)=>void};
function lines(value:unknown,key:'menuItemId'|'saleLineId'){
  if(!Array.isArray(value)||!value.length||value.length>100)throw new BadRequestException('Provide 1–100 sale lines.');
  return value.map(input=>{const row=object(input,[key,'quantity']);if(!Number.isSafeInteger(row.quantity)||(row.quantity as number)<1)throw new BadRequestException('Item count must be a positive integer.');return {[key]:identifier(row[key]),quantity:row.quantity};});
}
function cart(input:unknown,editing=false){const body=object(input,['locationId','lines',...(editing?['expectedVersion']:[])]);return {locationId:identifier(body.locationId),lines:lines(body.lines,'menuItemId'),...(editing?{expectedVersion:version(body.expectedVersion)}:{})};}
@Controller('api/sales')
export class SalesController{
  constructor(@Inject('SALES_HTTP')private readonly sales:HttpUpstream){}
  @Get() list(@Query()query:Record<string,string>,@Req()req:Request){return this.sales.request(`/sales${queryString(validatedQuery(query,['locationId','cursor','limit','status','search']))}`,{requestId:requestId(req)});}
  @Post() @HttpCode(200) create(@Body()body:unknown,@Headers('idempotency-key')key:string|undefined,@Req()req:Request){return this.write('/sales',cart(body),key,req);}
  @Get(':id') detail(@Param('id')id:string,@Req()req:Request){return this.read(`/sales/${identifier(id)}`,req);}
  @Patch(':id') edit(@Param('id')id:string,@Body()body:unknown,@Req()req:Request){return this.sales.request(`/sales/${identifier(id)}`,{method:'PATCH',body:cart(body,true),requestId:requestId(req)});}
  @Post(':id/checkout') @HttpCode(200) async checkout(@Param('id')id:string,@Body()input:unknown,@Headers('idempotency-key')key:string|undefined,@Req()req:Request,@Res({passthrough:true})response:Response){
    const body=object(input,['expectedVersion','tender','locationId']);if(!['CASH','CARD'].includes(body.tender as string))throw new BadRequestException('Choose cash or card tender.');
    const sale=await this.write<Sale>(`/sales/${identifier(id)}/checkout`,{expectedVersion:version(body.expectedVersion),tender:body.tender,...(body.locationId!==undefined?{locationId:identifier(body.locationId)}:{})},key,req);
    if(sale.status==='CHECKOUT_PENDING'){response.status(202);response.setHeader('Location',`/api/sales/${sale.id}`);}return sale;
  }
  @Post(':id/cancel') @HttpCode(200) cancel(@Param('id')id:string,@Body()body:unknown,@Req()req:Request){return this.sales.request(`/sales/${identifier(id)}/cancel`,{method:'POST',body:archiveBody(body),requestId:requestId(req)});}
  @Get(':id/receipt') receipt(@Param('id')id:string,@Req()req:Request){return this.read(`/sales/${identifier(id)}/receipt`,req);}
  @Get(':id/refunds') refunds(@Param('id')id:string,@Req()req:Request){return this.read(`/sales/${identifier(id)}/refunds`,req);}
  @Get(':id/refunds/:refundId') refund(@Param('id')id:string,@Param('refundId')refundId:string,@Req()req:Request){return this.read(`/sales/${identifier(id)}/refunds/${identifier(refundId)}`,req);}
  @Post(':id/refunds') @HttpCode(200) async createRefund(@Param('id')id:string,@Body()input:unknown,@Headers('idempotency-key')key:string|undefined,@Req()req:Request,@Res({passthrough:true})response:Response){
    const body=object(input,['lines','reason','restock','expectedVersion']);if(typeof body.restock!=='boolean')throw new BadRequestException('Choose stock return behavior.');
    const result=await this.write<Refund>(`/sales/${identifier(id)}/refunds`,{lines:lines(body.lines,'saleLineId'),reason:text(body.reason,'reason',500),restock:body.restock,...(body.expectedVersion!==undefined?{expectedVersion:version(body.expectedVersion)}:{})},key,req);
    if(result.status==='REFUND_PENDING'){response.status(202);response.setHeader('Location',`/api/sales/${result.saleId}/refunds/${result.id}`);}return result;
  }
  private read(path:string,req:Request){return this.sales.request(path,{requestId:requestId(req)});}
  private write<T=unknown>(path:string,body:unknown,key:string|undefined,req:Request){return this.sales.request<T>(path,{method:'POST',body,idempotencyKey:identifier(key,'Idempotency-Key'),requestId:requestId(req)});}
}
