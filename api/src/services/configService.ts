import { PrismaClient, Config } from '../generated/prisma/client.js';
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL,
});
const prisma = new PrismaClient({ adapter });

export async function getConfig(): Promise<Config> {
  // Always fetch the config row with id=1
  let config = await prisma.config.findUnique({ where: { id: 1 } });
  if (!config) {
    // If not found, create with defaults
    config = await prisma.config.create({
      data: {},
    });
  }
  return config;
}

export async function updateConfig(data: Partial<Config>): Promise<Config> {
  // Only allow updating known fields
  return prisma.config.update({
    where: { id: 1 },
    data,
  });
}

export async function isFirstUser(): Promise<boolean> {
  const prisma = new PrismaClient({ adapter });
  const count = await prisma.user.count();
  return count === 0;
}

export async function requireTorrentApproval(): Promise<boolean> {
  const config = await getConfig();
  return config.requireTorrentApproval;
} 