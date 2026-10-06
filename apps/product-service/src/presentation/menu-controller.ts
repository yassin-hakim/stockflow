import { BadRequestException, Body, Controller, Get, Inject, Param, Patch, Post } from '@nestjs/common';
import { isUuid, quantityMillis } from '@stockflow/primitives';
import type { MenuItem as MenuItemDto } from '@stockflow/contracts';
import { MenuCatalog } from '../application/menu-use-cases';
import type { MenuInput, MenuItem } from '../domain/menu-item';
import { parseVersion } from './product-controller';

export function menuDto(item: MenuItem): MenuItemDto {
  return { ...item, ingredients: item.ingredients.map(({ quantityMillis, ...fields }) => ({ ...fields, quantity: quantityMillis / 1000 })) };
}
function id(value: string): string { if (!isUuid(value)) throw new BadRequestException('Invalid menu item ID.'); return value; }
function record(body: unknown, allowed: string[]): Record<string, unknown> {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !allowed.includes(key))) throw new BadRequestException('Invalid menu item body or unknown field.');
  return body as Record<string, unknown>;
}
export function parseMenu(body: unknown, currency: string, editing = false): { input: MenuInput; expectedVersion?: number } {
  const fields = ['name', 'category', 'priceMinor', 'currency', 'ingredients', ...(editing ? ['expectedVersion'] : [])];
  const value = record(body, fields);
  if (typeof value.name !== 'string' || typeof value.category !== 'string' || (value.currency !== undefined && typeof value.currency !== 'string') || !Number.isSafeInteger(value.priceMinor) || (value.priceMinor as number) < 0) throw new BadRequestException('Invalid menu identity, currency or minor-unit price.');
  if (!Array.isArray(value.ingredients) || !value.ingredients.length || value.ingredients.length > 100) throw new BadRequestException('Recipes require 1–100 ingredients.');
  const ingredients = value.ingredients.map(line => {
    const ingredient = record(line, ['productId', 'quantity']);
    const millis = quantityMillis(ingredient.quantity);
    if (!isUuid(ingredient.productId) || millis === null) throw new BadRequestException('Ingredient quantity must be positive with at most three decimals in its product base unit.');
    return { productId: ingredient.productId, quantityMillis: millis };
  });
  return { input: { name: value.name, category: value.category, priceMinor: value.priceMinor as number, currency: value.currency as string | undefined ?? currency, ingredients }, ...(editing ? { expectedVersion: parseVersion(value.expectedVersion) } : {}) };
}

@Controller('menu-items')
export class MenuController {
  constructor(@Inject('MENU_CATALOG') private readonly catalog: MenuCatalog) {}
  @Post() async create(@Body() body: unknown): Promise<MenuItemDto> { return menuDto(await this.catalog.create(parseMenu(body, this.catalog.currency).input)); }
  @Get() async list(): Promise<{ items: MenuItemDto[]; currency: string }> { return { items: (await this.catalog.list()).map(menuDto), currency: this.catalog.currency }; }
  @Get(':id') async get(@Param('id') menuId: string): Promise<MenuItemDto> { return menuDto(await this.catalog.get(id(menuId))); }
  @Get(':id/revisions/:revision') async revision(@Param('id') menuId: string, @Param('revision') revision: string): Promise<MenuItemDto> {
    const parsed = Number(revision);
    if (!/^[1-9][0-9]*$/.test(revision) || !Number.isSafeInteger(parsed)) throw new BadRequestException('Invalid recipe revision.');
    return menuDto(await this.catalog.revision(id(menuId), parsed));
  }
  @Patch(':id') async edit(@Param('id') menuId: string, @Body() body: unknown): Promise<MenuItemDto> { return this.publish(menuId, body); }
  @Post(':id/publish') async publish(@Param('id') menuId: string, @Body() body: unknown): Promise<MenuItemDto> {
    const parsed = parseMenu(body, this.catalog.currency, true);
    return menuDto(await this.catalog.publish(id(menuId), parsed.input, parsed.expectedVersion!));
  }
  @Post(':id/archive') async archive(@Param('id') menuId: string, @Body() body: unknown): Promise<MenuItemDto> {
    const value = record(body, ['expectedVersion']);
    return menuDto(await this.catalog.archive(id(menuId), parseVersion(value.expectedVersion)));
  }
}
