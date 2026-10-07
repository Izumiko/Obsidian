import { PrismaClient } from '../generated/prisma/client.js';
import { PrismaPg } from "@prisma/adapter-pg";
import postgres from "@prisma/orm-postgres/runtime";
import type { Contract } from "../generated/prisma8/contract.js";
import contractJson from "../generated/prisma8/contract.json" with { type: "json" };

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL,
});
export const prisma = new PrismaClient({
  adapter,
  log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error']
});

export const db = postgres<Contract>({
  url: process.env.DATABASE_URL!,
  contractJson,
});

process.on('beforeExit', async () => {
  await prisma.$disconnect();
  await db.close();
});
