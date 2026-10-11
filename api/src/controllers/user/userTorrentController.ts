import { FastifyRequest, FastifyReply } from 'fastify';
import { getSeederLeecherCounts, getCompletedCount } from '../../announce_features/peerList.js';
import { db } from '../../lib/prisma.js';
import { convertBigInts } from '../../lib/serialization.js';

/**
 * Get all torrents uploaded by the current user
 * Returns torrents in a format similar to The Pirate Bay listing
 */
export async function getUserTorrentsHandler(request: FastifyRequest, reply: FastifyReply) {
  const user = (request as any).user;
  if (!user) return reply.status(401).send({ error: 'Unauthorized' });

  const { page = 1, limit = 20 } = (request.query as any) || {};
  const take = Math.min(Number(limit) || 20, 100);
  const skip = (Number(page) - 1) * take;

  try {
    // Get user's torrents with basic info
    const [torrents, totalResult] = await Promise.all([
      db.orm.public.Torrent
        .where({ uploaderId: user.id })
        .offset(skip)
        .limit(take)
        .orderBy((t: any) => t.createdAt.desc())
        .select('id', 'name', 'size', 'createdAt', 'isApproved', 'isRejected', 'isAnonymous', 'freeleech', 'rejectionReason')
        .include('category', (c: any) => c.select('id', 'name'))
        .all(),
      db.orm.public.Torrent
        .where({ uploaderId: user.id })
        .aggregate((a: any) => ({ n: a.count() }))
    ]);
    const total = totalResult.n;

    // Calculate stats for each torrent (seeders, leechers, downloads)
    const torrentsWithStats = await Promise.all(
      torrents.map(async (torrent: any) => {
        const [seederLeecherCounts, completedCount] = await Promise.all([
          getSeederLeecherCounts(torrent.id),
          getCompletedCount(torrent.id)
        ]);

        return {
          ...torrent,
          size: torrent.size?.toString?.() ?? "0",
          seeders: seederLeecherCounts.complete,
          leechers: seederLeecherCounts.incomplete,
          downloads: completedCount,
          status: torrent.isApproved ? 'approved' : torrent.isRejected ? 'rejected' : 'pending'
        };
      })
    );

    return reply.send(convertBigInts({
      torrents: torrentsWithStats,
      total,
      page: Number(page),
      limit: take
    }));
  } catch (error) {
    console.error('[getUserTorrentsHandler] Error:', error);
    return reply.status(500).send({ error: 'Failed to fetch user torrents' });
  }
}
