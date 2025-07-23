import { describe, it, expect, beforeEach, mock } from 'bun:test';
import {
  createBatchLoader,
  createRelationLoader,
  createStandardLoaders,
  clearDataLoaderCaches,
  primeLoader,
  createCustomLoader,
} from '../createDataLoader';
import type { PrismaClient } from '@prisma/client';

// Mock Prisma models
const createMockModel = () => ({
  findMany: mock(async () => []),
  findUnique: mock(async () => null),
});

// Mock PrismaClient
const mockPrisma = {
  user: createMockModel(),
  todo: createMockModel(),
  todoList: createMockModel(),
} as unknown as PrismaClient;

// Mock entities
interface User {
  id: string;
  name: string;
  email: string;
}

interface Todo {
  id: string;
  title: string;
  userId: string;
  todoListId?: string;
}

describe('DataLoader Factory', () => {
  beforeEach(() => {
    // Reset all mocks
    Object.values(mockPrisma).forEach((model: any) => {
      model.findMany.mockClear();
      model.findUnique.mockClear();
    });
  });

  describe('createBatchLoader', () => {
    it('should create a DataLoader that batches requests', async () => {
      const users: User[] = [
        { id: '1', name: 'User 1', email: 'user1@example.com' },
        { id: '2', name: 'User 2', email: 'user2@example.com' },
      ];
      
      (mockPrisma.user.findMany as any).mockResolvedValueOnce(users);

      const loader = createBatchLoader<User>(mockPrisma, {
        modelName: 'user',
      });

      // Load multiple items
      const [user1, user2, user3] = await Promise.all([
        loader.load('1'),
        loader.load('2'),
        loader.load('3'),
      ]);

      expect(user1).toEqual(users[0]);
      expect(user2).toEqual(users[1]);
      expect(user3).toBeNull();

      // Should batch into a single query
      expect(mockPrisma.user.findMany).toHaveBeenCalledTimes(1);
      expect(mockPrisma.user.findMany).toHaveBeenCalledWith({
        where: { id: { in: ['1', '2', '3'] } },
      });
    });

    it('should support custom batch field', async () => {
      const todos: Todo[] = [
        { id: '1', title: 'Todo 1', userId: 'user1' },
        { id: '2', title: 'Todo 2', userId: 'user1' },
      ];
      
      (mockPrisma.todo.findMany as any).mockResolvedValueOnce(todos);

      const loader = createBatchLoader<Todo>(mockPrisma, {
        modelName: 'todo',
        batchField: 'userId',
      });

      const result = await loader.load('user1');

      expect(result).toEqual(todos[0]); // First matching item
      expect(mockPrisma.todo.findMany).toHaveBeenCalledWith({
        where: { userId: { in: ['user1'] } },
      });
    });

    it('should support additional where conditions', async () => {
      (mockPrisma.todo.findMany as any).mockResolvedValueOnce([]);

      const loader = createBatchLoader<Todo>(mockPrisma, {
        modelName: 'todo',
        where: { completed: false },
      });

      await loader.load('1');

      expect(mockPrisma.todo.findMany).toHaveBeenCalledWith({
        where: { 
          completed: false,
          id: { in: ['1'] } 
        },
      });
    });

    it('should support include relations', async () => {
      (mockPrisma.todo.findMany as any).mockResolvedValueOnce([]);

      const loader = createBatchLoader<Todo>(mockPrisma, {
        modelName: 'todo',
        include: { tags: true, user: true },
      });

      await loader.load('1');

      expect(mockPrisma.todo.findMany).toHaveBeenCalledWith({
        where: { id: { in: ['1'] } },
        include: { tags: true, user: true },
      });
    });

    it('should cache results by default', async () => {
      const user: User = { id: '1', name: 'User 1', email: 'user1@example.com' };
      (mockPrisma.user.findMany as any).mockResolvedValueOnce([user]);

      const loader = createBatchLoader<User>(mockPrisma, {
        modelName: 'user',
      });

      const result1 = await loader.load('1');
      const result2 = await loader.load('1');

      expect(result1).toBe(result2); // Same reference
      expect(mockPrisma.user.findMany).toHaveBeenCalledTimes(1); // Only one query
    });

    it('should handle errors gracefully', async () => {
      const error = new Error('Database error');
      (mockPrisma.user.findMany as any).mockRejectedValueOnce(error);

      const loader = createBatchLoader<User>(mockPrisma, {
        modelName: 'user',
      });

      await expect(loader.load('1')).rejects.toThrow('Database error');
    });
  });

  describe('createRelationLoader', () => {
    it('should load multiple items by relation field', async () => {
      const todos: Todo[] = [
        { id: '1', title: 'Todo 1', userId: 'user1' },
        { id: '2', title: 'Todo 2', userId: 'user1' },
        { id: '3', title: 'Todo 3', userId: 'user2' },
      ];
      
      (mockPrisma.todo.findMany as any).mockResolvedValueOnce(todos);

      const loader = createRelationLoader<Todo>(mockPrisma, {
        modelName: 'todo',
        relationField: 'userId',
      });

      const [user1Todos, user2Todos, user3Todos] = await Promise.all([
        loader.load('user1'),
        loader.load('user2'),
        loader.load('user3'),
      ]);

      expect(user1Todos).toHaveLength(2);
      expect(user1Todos).toEqual([todos[0], todos[1]]);
      expect(user2Todos).toHaveLength(1);
      expect(user2Todos).toEqual([todos[2]]);
      expect(user3Todos).toHaveLength(0);

      expect(mockPrisma.todo.findMany).toHaveBeenCalledTimes(1);
    });

    it('should support orderBy', async () => {
      (mockPrisma.todo.findMany as any).mockResolvedValueOnce([]);

      const loader = createRelationLoader<Todo>(mockPrisma, {
        modelName: 'todo',
        relationField: 'userId',
        orderBy: { createdAt: 'desc' },
      });

      await loader.load('user1');

      expect(mockPrisma.todo.findMany).toHaveBeenCalledWith({
        where: { userId: { in: ['user1'] } },
        orderBy: { createdAt: 'desc' },
      });
    });

    it('should support take limit', async () => {
      (mockPrisma.todo.findMany as any).mockResolvedValueOnce([]);

      const loader = createRelationLoader<Todo>(mockPrisma, {
        modelName: 'todo',
        relationField: 'userId',
        take: 10,
      });

      await loader.load('user1');

      expect(mockPrisma.todo.findMany).toHaveBeenCalledWith({
        where: { userId: { in: ['user1'] } },
        take: 10,
      });
    });
  });

  describe('createStandardLoaders', () => {
    it('should create byId loader', async () => {
      const loaders = createStandardLoaders<User>(mockPrisma, {
        modelName: 'user',
      });

      expect(loaders.byId).toBeDefined();
      expect(loaders.byUserId).toBeUndefined();
    });

    it('should create both byId and byUserId loaders when userField is provided', async () => {
      const loaders = createStandardLoaders<Todo>(mockPrisma, {
        modelName: 'todo',
        userField: 'userId',
      });

      expect(loaders.byId).toBeDefined();
      expect(loaders.byUserId).toBeDefined();
    });

    it('should pass options to both loaders', async () => {
      const todos: Todo[] = [
        { id: '1', title: 'Todo 1', userId: 'user1' },
      ];
      
      (mockPrisma.todo.findMany as any)
        .mockResolvedValueOnce([todos[0]]) // byId
        .mockResolvedValueOnce(todos); // byUserId

      const loaders = createStandardLoaders<Todo>(mockPrisma, {
        modelName: 'todo',
        userField: 'userId',
        include: { tags: true },
        where: { completed: false },
      });

      await loaders.byId.load('1');
      expect(mockPrisma.todo.findMany).toHaveBeenCalledWith({
        where: { completed: false, id: { in: ['1'] } },
        include: { tags: true },
      });

      await loaders.byUserId!.load('user1');
      expect(mockPrisma.todo.findMany).toHaveBeenCalledWith({
        where: { completed: false, userId: { in: ['user1'] } },
        include: { tags: true },
        orderBy: { createdAt: 'desc' },
      });
    });
  });

  describe('clearDataLoaderCaches', () => {
    it('should clear all loader caches', async () => {
      const user: User = { id: '1', name: 'User 1', email: 'user1@example.com' };
      (mockPrisma.user.findMany as any).mockResolvedValue([user]);

      const loaders = createStandardLoaders<User>(mockPrisma, {
        modelName: 'user',
      });

      // Load and cache
      await loaders.byId.load('1');
      expect(mockPrisma.user.findMany).toHaveBeenCalledTimes(1);

      // Clear caches
      clearDataLoaderCaches(loaders);

      // Load again - should query again
      await loaders.byId.load('1');
      expect(mockPrisma.user.findMany).toHaveBeenCalledTimes(2);
    });
  });

  describe('primeLoader', () => {
    it('should prime loader with known data', async () => {
      const loader = createBatchLoader<User>(mockPrisma, {
        modelName: 'user',
      });

      const users: User[] = [
        { id: '1', name: 'User 1', email: 'user1@example.com' },
        { id: '2', name: 'User 2', email: 'user2@example.com' },
      ];

      primeLoader(loader, users);

      // Should return primed data without querying
      const result1 = await loader.load('1');
      const result2 = await loader.load('2');

      expect(result1).toEqual(users[0]);
      expect(result2).toEqual(users[1]);
      expect(mockPrisma.user.findMany).not.toHaveBeenCalled();
    });

    it('should support custom key field', async () => {
      const loader = createBatchLoader<User>(mockPrisma, {
        modelName: 'user',
        batchField: 'email',
      });

      const users: User[] = [
        { id: '1', name: 'User 1', email: 'user1@example.com' },
      ];

      primeLoader(loader, users, 'email');

      const result = await loader.load('user1@example.com');
      expect(result).toEqual(users[0]);
      expect(mockPrisma.user.findMany).not.toHaveBeenCalled();
    });
  });

  describe('createCustomLoader', () => {
    it('should create a loader with custom batch function', async () => {
      const customBatchFn = mock(async (keys: readonly string[]) => {
        return keys.map(key => ({ id: key, custom: true }));
      });

      const loader = createCustomLoader(customBatchFn, {
        maxBatchSize: 50,
      });

      const results = await Promise.all([
        loader.load('1'),
        loader.load('2'),
      ]);

      expect(results).toEqual([
        { id: '1', custom: true },
        { id: '2', custom: true },
      ]);
      expect(customBatchFn).toHaveBeenCalledTimes(1);
      expect(customBatchFn).toHaveBeenCalledWith(['1', '2']);
    });
  });
});