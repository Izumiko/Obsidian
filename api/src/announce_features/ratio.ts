import { db } from '../lib/prisma.js';
import { getConfig } from '../services/configService.js';

export async function updateUserRatio(userId: string, uploaded: bigint, downloaded: bigint, peerId: string, torrentId: string) {
  // Find last announce for this user/peer combination (not including torrentId)
  const lastAnnounce = await db.orm.public.Announce
    .where({ userId, peerId })
    .orderBy((a) => a.lastAnnounceAt.desc())
    .first();

  // Check if torrent is freeleech
  const torrent = await db.orm.public.Torrent
    .where({ id: torrentId })
    .select('freeleech')
    .first();

  const isFreeleech = torrent?.freeleech || false;

  let uploadDelta = uploaded;
  let downloadDelta = downloaded;

  if (lastAnnounce) {
    uploadDelta = uploaded - lastAnnounce.uploaded;
    downloadDelta = downloaded - lastAnnounce.downloaded;
    if (uploadDelta < BigInt(0)) uploadDelta = BigInt(0);
    if (downloadDelta < BigInt(0)) downloadDelta = BigInt(0);
  }

  // If torrent is freeleech, don't count download traffic
  if (isFreeleech) {
    downloadDelta = BigInt(0);
  }

  console.log(`[updateUserRatio] User: ${userId}, Peer: ${peerId}, Upload Delta: ${uploadDelta}, Download Delta: ${downloadDelta}, Freeleech: ${isFreeleech}`);

  // Update user totals. Prisma 8 has no `{ increment }` on PostgreSQL, so add
  // in place with raw SQL to keep the update atomic. The statement also refreshes
  // `updatedAt`, which raw SQL would otherwise skip (`.update()` applies the
  // contract's `onUpdate` generator automatically).
  const query = db.raw.sql`UPDATE "User" SET "upload" = "upload" + ${uploadDelta}, "download" = "download" + ${downloadDelta}, "updatedAt" = now() WHERE "id" = ${userId}`.affectedCount().build();
  await db.runtime().execute(query);
}

export async function isUserBelowMinRatio(userId: string): Promise<boolean> {
  const config = await getConfig();
  const minRatio = config.minRatio;
  const user = await db.orm.public.User.where({ id: userId }).first();
  if (!user) return false;
  if (user.download === BigInt(0)) return false;
  const ratio = Number(user.upload) / Number(user.download);
  return ratio < minRatio;
}
