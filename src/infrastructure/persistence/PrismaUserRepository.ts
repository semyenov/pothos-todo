import { PrismaClient, type User as PrismaUser } from '@prisma/client';
import type { UserRepository } from '../../domain/repositories/UserRepository.js';
import { User } from '../../domain/aggregates/User.js';
import { BaseRepository } from '../core/BaseRepository.js';

export class PrismaUserRepository 
  extends BaseRepository<User, PrismaUser>
  implements UserRepository {
  
  constructor(prisma: PrismaClient) {
    super(prisma);
  }

  protected getModelName(): string {
    return 'user';
  }

  protected mapToDomain(userData: PrismaUser): User {
    return new User(
      userData.id,
      userData.email,
      userData.name,
      userData.createdAt,
      userData.updatedAt
    );
  }

  protected mapToCreateInput(user: User): any {
    return {
      email: user.email,
      name: user.name,
    };
  }

  protected mapToUpdateInput(user: User): any {
    return {
      email: user.email,
      name: user.name,
    };
  }

  // Additional method specific to UserRepository
  async findByEmail(email: string): Promise<User | null> {
    const userData = await this.getModel().findUnique({
      where: { email },
    });

    if (!userData) return null;

    return this.mapToDomain(userData);
  }
}