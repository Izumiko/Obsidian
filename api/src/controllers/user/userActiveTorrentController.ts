import { FastifyRequest, FastifyReply } from 'fastify';
import { db } from '../../lib/prisma.js';
import { parseTimestamp } from '../../lib/timestamps.js';
import { convertBigInts } from '../../lib/serialization.js';

// Returns torrents the user is currently seeding or leeching (live)
export async function getActiveTorrentsHandler(request: FastifyRequest, reply: FastifyReply) {
  const user = (request as any).user;
  if (!user) return reply.status(401).send({ error: 'Unauthorized' });

  // Get the latest announce per (torrentId, peerId) for this user
  const announces = await db.orm.public.Announce
    .where({ userId: user.id })
    .orderBy((a: any) => a.lastAnnounceAt.desc())
    .select('torrentId', 'left', 'event', 'lastAnnounceAt')
    .include('torrent', (t: any) => t.select('id', 'name', 'infoHash', 'size', 'categoryId', 'createdAt'))
    .all();

  // Convert BigInt values to numbers for JSON serialization
  const processedAnnounces = announces.map((a: any) => ({
    ...a,
    left: Number(a.left),
    torrent: {
      ...a.torrent,
      size: Number(a.torrent.size)
    }
  }));

  // Group by torrentId, keep the most recent announce for each
  const latestByTorrent: Record<string, typeof processedAnnounces[0]> = {};
  for (const a of processedAnnounces) {
    if (!latestByTorrent[a.torrentId] || parseTimestamp(a.lastAnnounceAt) > parseTimestamp(latestByTorrent[a.torrentId].lastAnnounceAt)) {
      latestByTorrent[a.torrentId] = a;
    }
  }

  // Separate into seeding and leeching
  const seeding = [];
  const leeching = [];
  for (const a of Object.values(latestByTorrent)) {
    if (a.left === 0) seeding.push(a.torrent);
    else leeching.push(a.torrent);
  }

  return reply.send(convertBigInts({ seeding, leeching }));
}
