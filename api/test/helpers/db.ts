import { prisma } from '../../src/lib/prisma.js';

export async function resetDb() {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "User","Torrent","Category","Source","Config" RESTART IDENTITY CASCADE'
  );
}

export { prisma };
