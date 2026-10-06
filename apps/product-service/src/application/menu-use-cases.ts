import { archiveMenuItem, configuredCurrency, createMenuItem, MenuError, publishMenuItem, validateMenuInput, type MenuInput, type MenuItem } from '../domain/menu-item';
import type { MenuRepository } from './menu-repository';
import type { ProductRepository } from './product-repository';

export class MenuCatalog {
  readonly currency: string;
  constructor(private readonly repository: MenuRepository, private readonly products: ProductRepository, currency = 'USD') { this.currency = configuredCurrency(currency); }

  async create(input: MenuInput): Promise<MenuItem> {
    const validated = validateMenuInput(input, this.currency);
    const item = createMenuItem(validated, await this.ingredients(validated), this.currency);
    await this.repository.insert(item);
    return item;
  }
  list(): Promise<MenuItem[]> { return this.repository.findAll(); }
  async get(id: string): Promise<MenuItem> {
    const item = await this.repository.findById(id);
    if (!item) throw new MenuError('MENU_ITEM_NOT_FOUND', 'Menu item not found.', 404);
    return item;
  }
  async revision(id: string, revision: number): Promise<MenuItem> {
    const item = await this.repository.findRevision(id, revision);
    if (!item) throw new MenuError('RECIPE_REVISION_NOT_FOUND', 'Recipe revision not found.', 404);
    return item;
  }
  async publish(id: string, input: MenuInput, expectedVersion: number): Promise<MenuItem> {
    const current = await this.get(id);
    const validated = validateMenuInput(input, this.currency);
    const item = publishMenuItem(current, validated, await this.ingredients(validated), this.currency, expectedVersion);
    if (!(await this.repository.publish(item, expectedVersion))) throw new MenuError('VERSION_CONFLICT', 'This menu item changed. Refresh before saving.', 409);
    return item;
  }
  async archive(id: string, expectedVersion: number): Promise<MenuItem> {
    const current = await this.get(id);
    const item = archiveMenuItem(current, expectedVersion);
    if (item === current) return current;
    if (!(await this.repository.archive(item, expectedVersion))) throw new MenuError('VERSION_CONFLICT', 'This menu item changed. Refresh before archiving.', 409);
    return item;
  }
  private async ingredients(input: MenuInput) {
    const ids = [...new Set(input.ingredients.map(line => line.productId))];
    const products = await Promise.all(ids.map(id => this.products.findById(id)));
    return products.filter(product => product !== null);
  }
}
