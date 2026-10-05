import { BadRequestException, Body, Controller, Get, Headers, HttpCode, Inject, Module, Param, Post, Req } from '@nestjs/common';
import type { InventoryOverview, InventoryRecord, Items, Product, StockChangeResult, StockMovement } from '@stockflow/contracts';
import { HttpUpstream, UpstreamError } from './upstream';
import { overview, projectInventory } from './projection';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function requiredHttpUrl(name: 'PRODUCT_SERVICE_URL' | 'INVENTORY_SERVICE_URL'): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required.`);
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error(`Invalid ${name}.`);
  return value.replace(/\/$/, '');
}
function uuid(value: string, label: string): string { if (!UUID.test(value)) throw new BadRequestException(`Invalid ${label}.`); return value; }
function requestId(req: { headers: Record<string, string | undefined> }): string { return req.headers['x-request-id'] ?? crypto.randomUUID(); }
function object(value: unknown, allowed: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BadRequestException('Invalid request body.');
  const body = value as Record<string, unknown>;
  if (Object.keys(body).some(key => !allowed.includes(key))) throw new BadRequestException('Unknown request field.');
  return body;
}
function decimal(value: unknown, allowZero: boolean): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1_000_000_000 || (!allowZero && value === 0) || Math.abs(value * 1000 - Math.round(value * 1000)) > 0.00001) throw new UpstreamError(422, 'INVALID_QUANTITY', 'Quantity must be positive and use at most three decimal places.');
  return value;
}
function productBody(value: unknown): object {
  const body = object(value, ['name', 'unit', 'category', 'lowStockThreshold']);
  for (const [key, max] of [['name', 100], ['unit', 20], ['category', 80]] as const) if (typeof body[key] !== 'string' || !(body[key] as string).trim() || (body[key] as string).trim().length > max) throw new BadRequestException(`Invalid ${key}.`);
  if (body.lowStockThreshold !== undefined) {
    try { decimal(body.lowStockThreshold, true); } catch { throw new BadRequestException('Invalid lowStockThreshold.'); }
  }
  return body;
}
function stockBody(value: unknown): object {
  const body = object(value, ['quantity', 'reason']);
  decimal(body.quantity, false);
  if (typeof body.reason !== 'string' || !body.reason.trim() || body.reason.trim().length > 200) throw new BadRequestException('Invalid reason.');
  return body;
}
@Controller('api/products')
class ProductsController {
  constructor(@Inject('PRODUCT_HTTP') private readonly product: HttpUpstream) {}
  @Post() create(@Body() body: unknown, @Req() req: { headers: Record<string, string | undefined> }): Promise<Product> { return this.product.request('/products', { method: 'POST', body: productBody(body), requestId: requestId(req) }); }
  @Get() list(@Req() req: { headers: Record<string, string | undefined> }): Promise<Items<Product>> { return this.product.request('/products', { requestId: requestId(req) }); }
  @Get(':id') get(@Param('id') id: string, @Req() req: { headers: Record<string, string | undefined> }): Promise<Product> { return this.product.request(`/products/${uuid(id, 'product ID')}`, { requestId: requestId(req) }); }
}

@Controller('api/inventory')
class InventoryController {
  constructor(@Inject('PRODUCT_HTTP') private readonly product: HttpUpstream, @Inject('INVENTORY_HTTP') private readonly inventory: HttpUpstream) {}
  @Get() async list(@Req() req: { headers: Record<string, string | undefined> }): Promise<Items<InventoryOverview>> {
    const id = requestId(req);
    const [products, balances] = await Promise.all([this.product.request<Items<Product>>('/products', { requestId: id }), this.inventory.request<Items<InventoryRecord>>('/inventory', { requestId: id })]);
    return { items: projectInventory(products.items, balances.items) };
  }
  @Get(':productId') async get(@Param('productId') rawId: string, @Req() req: { headers: Record<string, string | undefined> }): Promise<InventoryOverview> {
    const productId = uuid(rawId, 'product ID'), id = requestId(req);
    const product = await this.product.request<Product>(`/products/${productId}`, { requestId: id });
    try { const record = await this.inventory.request<InventoryRecord>(`/inventory/${productId}`, { requestId: id }); return overview(product, record.quantity); }
    catch (error) { if (error instanceof UpstreamError && error.code === 'INVENTORY_NOT_FOUND') return overview(product, 0); throw error; }
  }
  @Get(':productId/movements') async movements(@Param('productId') rawId: string, @Req() req: { headers: Record<string, string | undefined> }): Promise<Items<StockMovement>> {
    const productId = uuid(rawId, 'product ID'), id = requestId(req);
    await this.product.request<Product>(`/products/${productId}`, { requestId: id });
    return this.inventory.request(`/inventory/${productId}/movements`, { requestId: id });
  }
  @Post(':productId/add') @HttpCode(200) add(@Param('productId') rawId: string, @Body() body: unknown, @Headers('idempotency-key') key: string | undefined, @Req() req: { headers: Record<string, string | undefined> }): Promise<StockChangeResult> { return this.command(rawId, 'add', body, key, req); }
  @Post(':productId/remove') @HttpCode(200) remove(@Param('productId') rawId: string, @Body() body: unknown, @Headers('idempotency-key') key: string | undefined, @Req() req: { headers: Record<string, string | undefined> }): Promise<StockChangeResult> { return this.command(rawId, 'remove', body, key, req); }
  private command(rawId: string, action: 'add' | 'remove', body: unknown, key: string | undefined, req: { headers: Record<string, string | undefined> }): Promise<StockChangeResult> {
    const productId = uuid(rawId, 'product ID'); uuid(key ?? '', 'Idempotency-Key');
    return this.inventory.request(`/inventory/${productId}/${action}`, { method: 'POST', body: stockBody(body), idempotencyKey: key, requestId: requestId(req) });
  }
}

@Controller('health')
class HealthController {
  constructor(@Inject('PRODUCT_HTTP') private readonly product: HttpUpstream, @Inject('INVENTORY_HTTP') private readonly inventory: HttpUpstream) {}
  @Get('live') live() { return { status: 'ok' }; }
  @Get('ready') async ready() { await Promise.all([this.product.health(), this.inventory.health()]); return { status: 'ready' }; }
}

@Module({ controllers: [ProductsController, InventoryController, HealthController], providers: [
  { provide: 'PRODUCT_HTTP', useFactory: () => new HttpUpstream(requiredHttpUrl('PRODUCT_SERVICE_URL')) },
  { provide: 'INVENTORY_HTTP', useFactory: () => new HttpUpstream(requiredHttpUrl('INVENTORY_SERVICE_URL')) },
] })
export class BffModule {}
