import type { MenuItem } from '../domain/menu-item';

/** Publishing the current item and its immutable revision must commit atomically. */
export interface MenuRepository {
  insert(item: MenuItem): Promise<void>;
  findAll(): Promise<MenuItem[]>;
  findById(id: string): Promise<MenuItem | null>;
  findRevision(id: string, revision: number): Promise<MenuItem | null>;
  publish(item: MenuItem, expectedVersion: number): Promise<boolean>;
  archive(item: MenuItem, expectedVersion: number): Promise<boolean>;
}
