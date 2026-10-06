import type { Collection, MongoClient } from 'mongodb';
import type { MenuRepository } from '../application/menu-repository';
import type { MenuItem } from '../domain/menu-item';

interface MenuDocument extends Omit<MenuItem, 'id'> { _id: string }
interface RevisionDocument { _id: string; menuItemId: string; revision: number; snapshot: MenuItem }

export class MongoMenuRepository implements MenuRepository {
  private readonly items: Collection<MenuDocument>;
  private readonly revisions: Collection<RevisionDocument>;
  constructor(private readonly client: MongoClient) {
    this.items = client.db().collection<MenuDocument>('menu_items');
    this.revisions = client.db().collection<RevisionDocument>('recipe_revisions');
  }
  async setup(): Promise<void> {
    await this.items.createIndex({ archivedAt: 1, name: 1, _id: 1 });
    await this.revisions.createIndex({ menuItemId: 1, revision: 1 }, { unique: true });
  }
  async insert(item: MenuItem): Promise<void> {
    const session = this.client.startSession();
    try {
      await session.withTransaction(async () => {
        await this.items.insertOne(document(item), { session });
        await this.revisions.insertOne(revision(item), { session });
      });
    } finally { await session.endSession(); }
  }
  async findAll(): Promise<MenuItem[]> {
    return (await this.items.find().sort({ name: 1, _id: 1 }).toArray()).map(item);
  }
  async findById(id: string): Promise<MenuItem | null> {
    const record = await this.items.findOne({ _id: id });
    return record ? item(record) : null;
  }
  async findRevision(id: string, recipeRevision: number): Promise<MenuItem | null> {
    return (await this.revisions.findOne({ menuItemId: id, revision: recipeRevision }))?.snapshot ?? null;
  }
  async publish(value: MenuItem, expectedVersion: number): Promise<boolean> {
    const session = this.client.startSession();
    try {
      // Return the callback result rather than a mutable flag: driver retries may
      // discard a previous attempt after a concurrent catalog edit.
      return await session.withTransaction(async () => {
        const result = await this.items.replaceOne({ _id: value.id, version: expectedVersion, archivedAt: null }, document(value), { session });
        if (!result.matchedCount) return false;
        await this.revisions.insertOne(revision(value), { session });
        return true;
      }) ?? false;
    } finally { await session.endSession(); }
  }
  async archive(value: MenuItem, expectedVersion: number): Promise<boolean> {
    const result = await this.items.replaceOne({ _id: value.id, version: expectedVersion, archivedAt: null }, document(value));
    return result.matchedCount === 1;
  }
}
function document(value: MenuItem): MenuDocument { const { id, ...fields } = value; return { _id: id, ...fields }; }
function item(value: MenuDocument): MenuItem { const { _id, ...fields } = value; return { id: _id, ...fields }; }
function revision(value: MenuItem): RevisionDocument { return { _id: `${value.id}:${value.recipeRevision}`, menuItemId: value.id, revision: value.recipeRevision, snapshot: value }; }
