import { FastifyRequest, FastifyReply } from 'fastify';
import { db } from '../../lib/prisma.js';
import { toTimestamp } from '../../lib/timestamps.js';

function isAdminOrOwner(user: any) {
  return user && (user.role === 'ADMIN' || user.role === 'OWNER' || user.role === 'FOUNDER');
}

export async function getOverviewStatsHandler(request: FastifyRequest, reply: FastifyReply) {
  const user = (request as any).user;
  if (!isAdminOrOwner(user)) return reply.status(403).send({ error: 'Forbidden' });
  const thirtyMinutesAgo = toTimestamp(new Date(Date.now() - 30 * 60 * 1000).toISOString());
  const [users, torrents, requests, downloads, peers] = await Promise.all([
    db.orm.public.User.aggregate((a) => ({ n: a.count() })).then((r) => r.n),
    db.orm.public.Torrent.aggregate((a) => ({ n: a.count() })).then((r) => r.n),
    db.orm.public.Request.aggregate((a) => ({ n: a.count() })).then((r) => r.n),
    db.orm.public.Announce
      .where({ event: 'completed' })
      .aggregate((a) => ({ n: a.count() }))
      .then((r) => r.n),
    db.orm.public.Announce
      .where((a) => a.lastAnnounceAt.gte(thirtyMinutesAgo))
      .where((a) => a.event.neq('stopped'))
      .select('left')
      .all()
  ]);
  const seeding = peers.filter(p => p.left === BigInt(0)).length;
  const leeching = peers.length - seeding;
  return reply.send({
    users,
    torrents,
    requests,
    downloads,
    peers: peers.length,
    seeding,
    leeching
  });
} 