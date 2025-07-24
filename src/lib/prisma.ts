import {
  PrismaService,
  defaultPoolConfig,
} from "@/infrastructure/database/PrismaService.js";
import { env } from "@/config/env.validation.js";

// Create PrismaService with optimized pooling configuration
const prismaService = PrismaService.getInstance();
const prisma = prismaService.getClient();

export { prisma, prismaService };
export default prisma;
