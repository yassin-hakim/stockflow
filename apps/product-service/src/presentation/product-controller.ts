import { isUuid, quantityMillis } from "@stockflow/primitives";
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Patch,
  Post,
} from "@nestjs/common";
import type { Product as ProductDto } from "@stockflow/contracts";
import {
  CreateProduct,
  GetProduct,
  ListProducts,
  ManageProduct,
} from "../application/product-use-cases";
import type { Product } from "../domain/product";

export function parseThreshold(value: unknown): number {
  const millis = quantityMillis(value, true);
  if (millis === null)
    throw new BadRequestException("Invalid low-stock threshold.");
  return millis;
}

function parseCreate(body: unknown): {
  name: string;
  unit: string;
  category: string;
  lowStockThresholdMillis: number;
  sku?: string | null;
} {
  if (!body || typeof body !== "object" || Array.isArray(body))
    throw new BadRequestException("Invalid product body.");
  const input = body as Record<string, unknown>;
  if (
    Object.keys(input).some(
      (key) => !["name", "unit", "category", "lowStockThreshold", "sku"].includes(key),
    )
  )
    throw new BadRequestException("Unknown product field.");
  if (input.sku !== undefined && input.sku !== null && typeof input.sku !== 'string') throw new BadRequestException('Invalid SKU.');
  for (const [field, max] of [
    ["name", 100],
    ["unit", 20],
    ["category", 80],
  ] as const) {
    if (
      typeof input[field] !== "string" ||
      !input[field].trim() ||
      input[field].trim().length > max
    )
      throw new BadRequestException(`Invalid ${field}.`);
  }
  return {
    name: input.name as string,
    unit: input.unit as string,
    category: input.category as string,
    ...(input.sku === undefined ? {} : { sku: input.sku as string | null }),
    lowStockThresholdMillis: parseThreshold(
      input.lowStockThreshold === undefined ? 0 : input.lowStockThreshold,
    ),
  };
}

export function productDto(product: Product): ProductDto {
  return {
    id: product.id,
    name: product.name,
    unit: product.unit,
    category: product.category,
    lowStockThreshold: product.lowStockThresholdMillis / 1000,
    createdAt: product.createdAt,
    updatedAt: product.updatedAt,
    sku: product.sku,
    version: product.version,
    archivedAt: product.archivedAt,
  };
}

@Controller("products")
export class ProductController {
  constructor(
    @Inject("CREATE_PRODUCT") private readonly createProduct: CreateProduct,
    @Inject("LIST_PRODUCTS") private readonly listProducts: ListProducts,
    @Inject("GET_PRODUCT") private readonly getProduct: GetProduct,
    @Inject("MANAGE_PRODUCT") private readonly manageProduct: ManageProduct,
  ) {}

  @Post()
  async create(@Body() body: unknown): Promise<ProductDto> {
    return productDto(await this.createProduct.execute(parseCreate(body)));
  }

  @Patch(':id')
  async edit(@Param('id') id: string, @Body() body: unknown): Promise<ProductDto> {
    if (!isUuid(id)) throw new BadRequestException('Invalid product ID.');
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new BadRequestException('Invalid product body.');
    const input = body as Record<string, unknown>;
    if (Object.keys(input).some(key => !['name', 'category', 'lowStockThreshold', 'sku', 'expectedVersion'].includes(key))) throw new BadRequestException('Unit is immutable; unknown product field.');
    for (const [field, max] of [['name',100], ['category',80]] as const) {
      if (typeof input[field] !== 'string' || !input[field].trim() || input[field].trim().length > max) throw new BadRequestException(`Invalid ${field}.`);
    }
    if (input.sku !== undefined && input.sku !== null && typeof input.sku !== 'string') throw new BadRequestException('Invalid SKU.');
    return productDto(await this.manageProduct.edit(id, { name: input.name as string, category: input.category as string, sku: input.sku as string | null | undefined, lowStockThresholdMillis: parseThreshold(input.lowStockThreshold) }, parseVersion(input.expectedVersion)));
  }

  @Post(':id/archive')
  async archive(@Param('id') id: string, @Body() body: unknown): Promise<ProductDto> {
    if (!isUuid(id)) throw new BadRequestException('Invalid product ID.');
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => key !== 'expectedVersion')) throw new BadRequestException('Invalid archive body.');
    return productDto(await this.manageProduct.archive(id, parseVersion((body as Record<string, unknown>).expectedVersion)));
  }

  @Get()
  async list(): Promise<{ items: ProductDto[] }> {
    return { items: (await this.listProducts.execute()).map(productDto) };
  }

  @Get(":id")
  async get(@Param("id") id: string): Promise<ProductDto> {
    if (!isUuid(id)) throw new BadRequestException("Invalid product ID.");
    return productDto(await this.getProduct.execute(id));
  }
}

export function parseVersion(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new BadRequestException('Invalid expectedVersion.');
  return value as number;
}
