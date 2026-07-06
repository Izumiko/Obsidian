import { PrismaClient } from '../generated/prisma/client.js';
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL,
});
const prisma = new PrismaClient({ adapter });

export async function getActivePeers(torrentId: string, excludePeerId: string, limit = 50) {
  const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);
  const peers = await prisma.announce.findMany({
    where: {
      torrentId,
      peerId: { not: excludePeerId },
      lastAnnounceAt: { gte: thirtyMinutesAgo },
      event: { not: 'stopped' },
    },
    orderBy: { lastAnnounceAt: 'desc' },
    take: limit,
    select: { ip: true, port: true, peerId: true }
  });
  return peers;
}

export async function getSeederLeecherCounts(torrentId: string) {
  const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);
  const peers = await prisma.announce.findMany({
    where: {
      torrentId,
      lastAnnounceAt: { gte: thirtyMinutesAgo },
      event: { not: 'stopped' },
    },
    select: { left: true }
  });
  let complete = 0, incomplete = 0;
  for (const p of peers) {
    if (typeof p.left === 'bigint' ? p.left === BigInt(0) : Number(p.left) === 0) complete++;
    else incomplete++;
  }
  return { complete, incomplete };
}

export async function getCompletedCount(torrentId: string) {
  const count = await prisma.announce.count({ where: { torrentId, event: 'completed' } });
  return count;
} 