import { BadRequestException, Body, Controller, Get, HttpCode, Inject, Param, Patch, Post, Req } from '@nestjs/common';
import { HttpUpstream } from './upstream';
import { archiveBody, identifier, object, requestId, stockLines, text, version } from './validation';
type Request={headers:Record<string,string|undefined>};
function menuBody(input:unknown,editing=false) {
  const body=object(input,['name','category','priceMinor','currency','ingredients',...(editing?['expectedVersion']:[])]);
  if(!Number.isSafeInteger(body.priceMinor) || (body.priceMinor as number)<0) throw new BadRequestException('Invalid menu price.');
  return {name:text(body.name,'name',100),category:text(body.category,'category',80),priceMinor:body.priceMinor,
    ...(body.currency!==undefined?{currency:text(body.currency,'currency',3)}:{}),ingredients:stockLines(body.ingredients),...(editing?{expectedVersion:version(body.expectedVersion)}:{})};
}
@Controller('api/menu-items')
export class CatalogController {
  constructor(@Inject('PRODUCT_HTTP') private readonly products:HttpUpstream) {}
  @Get() list(@Req() req:Request) {return this.products.request('/menu-items',{requestId:requestId(req)});}
  @Post() create(@Body() body:unknown,@Req() req:Request) {return this.products.request('/menu-items',{method:'POST',body:menuBody(body),requestId:requestId(req)});}
  @Get(':id') detail(@Param('id') id:string,@Req() req:Request) {return this.products.request(`/menu-items/${identifier(id)}`,{requestId:requestId(req)});}
  @Get(':id/revisions/:revision') revision(@Param('id') id:string,@Param('revision') revision:string,@Req() req:Request) {return this.products.request(`/menu-items/${identifier(id)}/revisions/${version(Number(revision))}`,{requestId:requestId(req)});}
  @Patch(':id') edit(@Param('id') id:string,@Body() body:unknown,@Req() req:Request) {return this.publish(id,body,req);}
  @Post(':id/publish') @HttpCode(200) publish(@Param('id') id:string,@Body() body:unknown,@Req() req:Request) {return this.products.request(`/menu-items/${identifier(id)}/publish`,{method:'POST',body:menuBody(body,true),requestId:requestId(req)});}
  @Post(':id/archive') @HttpCode(200) archive(@Param('id') id:string,@Body() body:unknown,@Req() req:Request) {return this.products.request(`/menu-items/${identifier(id)}/archive`,{method:'POST',body:archiveBody(body),requestId:requestId(req)});}
}
