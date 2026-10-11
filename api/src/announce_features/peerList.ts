import { db } from '../lib/prisma.js';
import { toTimestamp } from '../lib/timestamps.js';

export async function getActivePeers(torrentId: string, excludePeerId: string, limit = 50) {
  const thirtyMinutesAgo = toTimestamp(new Date(Date.now() - 30 * 60 * 1000).toISOString());
  const peers = await db.orm.public.Announce
    .where({ torrentId })
    .where((a) => a.peerId.neq(excludePeerId))
    .where((a) => a.lastAnnounceAt.gte(thirtyMinutesAgo))
    .where((a) => a.event.neq('stopped'))
    .orderBy((a) => a.lastAnnounceAt.desc())
    .limit(limit)
    .select('ip', 'port', 'peerId')
    .all();
  return peers;
}

export async function getSeederLeecherCounts(torrentId: string) {
  const thirtyMinutesAgo = toTimestamp(new Date(Date.now() - 30 * 60 * 1000).toISOString());
  const peers = await db.orm.public.Announce
    .where({ torrentId })
    .where((a) => a.lastAnnounceAt.gte(thirtyMinutesAgo))
    .where((a) => a.event.neq('stopped'))
    .select('left')
    .all();
  let complete = 0, incomplete = 0;
  for (const p of peers) {
    if (typeof p.left === 'bigint' ? p.left === BigInt(0) : Number(p.left) === 0) complete++;
    else incomplete++;
  }
  return { complete, incomplete };
}

export async function getCompletedCount(torrentId: string) {
  const result = await db.orm.public.Announce
    .where({ torrentId, event: 'completed' })
    .aggregate((a) => ({ n: a.count() }));
  return result.n;
}
