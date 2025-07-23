import { describe, it, expect, beforeEach, mock } from 'bun:test';
import { BaseRepository } from '../BaseRepository';
import { PrismaClient } from '@prisma/client';

// Mock domain entity
interface TestEntity {
  id: string;
  name: string;
  value: number;
  createdAt: Date;
}

// Mock Prisma model
interface TestPrismaModel {
  id: string;
  name: string;
  value: number;
  createdAt: Date;
}

// Test repository implementation
class TestRepository extends BaseRepository<TestEntity, TestPrismaModel> {
  protected getModelName(): string {
    return 'testModel';
  }

  protected mapToDomain(prismaModel: TestPrismaModel): TestEntity {
    return {
      id: prismaModel.id,
      name: prismaModel.name,
      value: prismaModel.value,
      createdAt: prismaModel.createdAt,
    };
  }

  protected mapToCreateInput(entity: TestEntity): any {
    return {
      name: entity.name,
      value: entity.value,
      createdAt: entity.createdAt,
    };
  }

  protected mapToUpdateInput(entity: TestEntity): any {
    return {
      name: entity.name,
      value: entity.value,
    };
  }

  // Expose protected methods for testing
  async testFindByField(field: keyof TestEntity, value: any) {
    return this.findByField(field, value);
  }

  async testDeleteByField(field: keyof TestEntity, value: any) {
    return this.deleteByField(field, value);
  }
}

describe('BaseRepository', () => {
  let prisma: any;
  let repository: TestRepository;
  let mockModel: any;

  beforeEach(() => {
    // Create mock Prisma model methods
    mockModel = {
      findUnique: mock(() => Promise.resolve(null)),
      findMany: mock(() => Promise.resolve([])),
      upsert: mock(() => Promise.resolve()),
      delete: mock(() => Promise.resolve()),
      deleteMany: mock(() => Promise.resolve({ count: 0 })),
      count: mock(() => Promise.resolve(0)),
      createMany: mock(() => Promise.resolve()),
      updateMany: mock(() => Promise.resolve({ count: 0 })),
    };

    // Create mock PrismaClient
    prisma = {
      testModel: mockModel,
      $transaction: mock((fn: any) => fn(prisma)),
    };

    repository = new TestRepository(prisma as any);
  });

  describe('findById', () => {
    it('should return null when entity not found', async () => {
      mockModel.findUnique.mockResolvedValueOnce(null);
      
      const result = await repository.findById('123');
      
      expect(result).toBeNull();
      expect(mockModel.findUnique).toHaveBeenCalledWith({
        where: { id: '123' },
      });
    });

    it('should return mapped domain entity when found', async () => {
      const prismaData = {
        id: '123',
        name: 'Test',
        value: 42,
        createdAt: new Date(),
      };
      mockModel.findUnique.mockResolvedValueOnce(prismaData);
      
      const result = await repository.findById('123');
      
      expect(result).toEqual({
        id: '123',
        name: 'Test',
        value: 42,
        createdAt: prismaData.createdAt,
      });
    });
  });

  describe('save', () => {
    it('should upsert entity', async () => {
      const entity: TestEntity = {
        id: '123',
        name: 'Test',
        value: 42,
        createdAt: new Date(),
      };
      
      await repository.save(entity);
      
      expect(mockModel.upsert).toHaveBeenCalledWith({
        where: { id: '123' },
        update: {
          name: 'Test',
          value: 42,
        },
        create: {
          id: '123',
          name: 'Test',
          value: 42,
          createdAt: entity.createdAt,
        },
      });
    });
  });

  describe('delete', () => {
    it('should delete entity by id', async () => {
      await repository.delete('123');
      
      expect(mockModel.delete).toHaveBeenCalledWith({
        where: { id: '123' },
      });
    });
  });

  describe('findAll', () => {
    it('should return all entities', async () => {
      const prismaData = [
        { id: '1', name: 'One', value: 1, createdAt: new Date() },
        { id: '2', name: 'Two', value: 2, createdAt: new Date() },
      ];
      mockModel.findMany.mockResolvedValueOnce(prismaData);
      
      const result = await repository.findAll();
      
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('1');
      expect(result[1].id).toBe('2');
    });

    it('should accept query options', async () => {
      await repository.findAll({
        where: { value: { gte: 10 } },
        orderBy: { createdAt: 'desc' },
        take: 10,
        skip: 5,
      });
      
      expect(mockModel.findMany).toHaveBeenCalledWith({
        where: { value: { gte: 10 } },
        orderBy: { createdAt: 'desc' },
        take: 10,
        skip: 5,
      });
    });
  });

  describe('count', () => {
    it('should return entity count', async () => {
      mockModel.count.mockResolvedValueOnce(42);
      
      const result = await repository.count({ value: { gte: 10 } });
      
      expect(result).toBe(42);
      expect(mockModel.count).toHaveBeenCalledWith({
        where: { value: { gte: 10 } },
      });
    });
  });

  describe('exists', () => {
    it('should return true when entity exists', async () => {
      mockModel.count.mockResolvedValueOnce(1);
      
      const result = await repository.exists('123');
      
      expect(result).toBe(true);
    });

    it('should return false when entity does not exist', async () => {
      mockModel.count.mockResolvedValueOnce(0);
      
      const result = await repository.exists('123');
      
      expect(result).toBe(false);
    });
  });

  describe('findByField', () => {
    it('should find entities by specific field', async () => {
      const prismaData = [
        { id: '1', name: 'Test', value: 42, createdAt: new Date() },
        { id: '2', name: 'Test', value: 43, createdAt: new Date() },
      ];
      mockModel.findMany.mockResolvedValueOnce(prismaData);
      
      const result = await repository.testFindByField('name', 'Test');
      
      expect(result).toHaveLength(2);
      expect(mockModel.findMany).toHaveBeenCalledWith({
        where: { name: 'Test' },
      });
    });
  });

  describe('deleteByField', () => {
    it('should delete entities by specific field', async () => {
      mockModel.deleteMany.mockResolvedValueOnce({ count: 3 });
      
      const result = await repository.testDeleteByField('value', 42);
      
      expect(result).toBe(3);
      expect(mockModel.deleteMany).toHaveBeenCalledWith({
        where: { value: 42 },
      });
    });
  });

  describe('createMany', () => {
    it('should batch create entities', async () => {
      const entities: TestEntity[] = [
        { id: '1', name: 'One', value: 1, createdAt: new Date() },
        { id: '2', name: 'Two', value: 2, createdAt: new Date() },
      ];
      
      await repository.createMany(entities);
      
      expect(mockModel.createMany).toHaveBeenCalledWith({
        data: [
          { name: 'One', value: 1, createdAt: entities[0].createdAt },
          { name: 'Two', value: 2, createdAt: entities[1].createdAt },
        ],
        skipDuplicates: true,
      });
    });
  });

  describe('updateMany', () => {
    it('should update multiple entities', async () => {
      mockModel.updateMany.mockResolvedValueOnce({ count: 5 });
      
      const result = await repository.updateMany(
        { value: { lt: 10 } },
        { value: 10 }
      );
      
      expect(result).toBe(5);
      expect(mockModel.updateMany).toHaveBeenCalledWith({
        where: { value: { lt: 10 } },
        data: { value: 10 },
      });
    });
  });
});