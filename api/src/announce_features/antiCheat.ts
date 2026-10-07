import { db } from '../lib/prisma.js';
import { and, or } from '@prisma/orm-postgres/orm-client';
import type { TimestampString } from '@prisma/orm-postgres/target/codec-types';

/** Parse a PostgreSQL `timestamp without time zone` string as UTC milliseconds. */
function parseTimestamp(value: string): number {
  return Date.parse(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`);
}

/**
 * The contract declares `timestamp(3)` columns as `TimestampString(3)`, which
 * is a branded string. Values are plain PostgreSQL text at runtime; the brand
 * only exists at the type level, so an explicit cast is how app code opts in.
 */
function toTimestamp(value: string): TimestampString<3> {
  return value as TimestampString<3>;
}

export async function checkGhostLeeching(config: any, params: any): Promise<string | null> {
  if (!config.enableGhostLeechingCheck) return null;
  const { userId, torrentId } = params;
  if (!userId || !torrentId) return null;
  // Find all announces for this user/torrent
  const announces = await db.orm.public.Announce.where({ userId, torrentId }).all();
  if (announces.length === 0) return null;
  const hasDownloaded = announces.some(a => a.downloaded > BigInt(0));
  const hasUploaded = announces.some(a => a.uploaded > BigInt(0));
  if (hasDownloaded && !hasUploaded) {
    return 'Ghost leeching detected: you must seed after downloading.';
  }
  return null;
}

export async function checkCheatingClient(config: any, params: any): Promise<string | null> {
  if (!config.enableCheatingClientCheck) return null;
  // Detect cheating clients by peer_id prefix or fingerprint
  const peerId = params.peer_id || '';
  const fingerprint = params.fingerprint || '';
  // Configurable list of known cheating client peer_id prefixes or fingerprints
  const cheatingPeerIdPrefixes: string[] = config.cheatingClientPeerIdPrefixes || [];
  const cheatingFingerprints: string[] = config.cheatingClientFingerprints || [];
  // Check peer_id prefix
  if (cheatingPeerIdPrefixes.some(prefix => peerId.startsWith(prefix))) {
    return 'Cheating client detected: your torrent client is not allowed.';
  }
  // Check fingerprint
  if (cheatingFingerprints.some(fp => fingerprint.startsWith(fp))) {
    return 'Cheating client detected: your torrent client version is not allowed.';
  }
  return null;
}

export async function checkIpAbuse(config: any, params: any): Promise<string | null> {
  if (!config.enableIpAbuseCheck) return null;
  const userId = params.userId;
  const ip = params.ip;
  if (!userId || !ip) return null;
  // Configurable thresholds
  const maxIpsPerUser = config.maxIpsPerUser ?? 3;
  const maxUsersPerIp = config.maxUsersPerIp ?? 3;
  const since = toTimestamp(new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()); // last 24h
  // Count unique IPs used by this user in last 24h
  const userIps = await db.orm.public.Announce
    .where({ userId })
    .where((a) => a.lastAnnounceAt.gte(since))
    .select('ip')
    .distinct('ip')
    .all();
  if (userIps.length > maxIpsPerUser) {
    return `IP abuse detected: Too many different IPs used by your account in the last 24h (max ${maxIpsPerUser}).`;
  }
  // Count unique users using this IP in last 24h
  const ipUsers = await db.orm.public.Announce
    .where({ ip })
    .where((a) => a.lastAnnounceAt.gte(since))
    .select('userId')
    .distinct('userId')
    .all();
  // Filter out null userIds (system/anonymous announces)
  const uniqueUserIds = ipUsers.map(u => u.userId).filter(Boolean);
  const uniqueUserCount = new Set(uniqueUserIds).size;
  if (uniqueUserCount > maxUsersPerIp) {
    return `IP abuse detected: Too many different users from this IP in the last 24h (max ${maxUsersPerIp}).`;
  }
  return null;
}

export async function checkAnnounceRate(config: any, params: any): Promise<string | null> {
  if (!config.enableAnnounceRateCheck) return null;
  const userId = params.userId;
  const torrentId = params.torrentId;
  const peerId = params.peerId;
  if (!userId || !torrentId || !peerId) return null;
  const minInterval = config.minAnnounceInterval ?? 300; // seconds
  // Find the last announce for this user/torrent/peer
  const lastAnnounce = await db.orm.public.Announce
    .where({ userId, torrentId, peerId })
    .orderBy((a) => a.lastAnnounceAt.desc())
    .first();
  if (lastAnnounce) {
    const now = Date.now();
    const last = parseTimestamp(lastAnnounce.lastAnnounceAt);
    const diffSeconds = (now - last) / 1000;
    if (diffSeconds < minInterval) {
      return `Announce rate limit: You must wait at least ${minInterval} seconds between announces.`;
    }
  }
  return null;
}

export async function checkInvalidStats(config: any, params: any): Promise<string | null> {
  if (!config.enableInvalidStatsCheck) return null;
  const { userId, torrentId, peerId, uploaded, downloaded, left, event, torrentSize } = params;
  if (!userId || !torrentId || !peerId) return null;
  // 1. No negative values
  if (uploaded < 0n || downloaded < 0n || left < 0n) {
    return 'Invalid stats: Negative values are not allowed.';
  }
  // 2. No rewinding
  const lastAnnounce = await db.orm.public.Announce
    .where({ userId, torrentId, peerId })
    .orderBy((a) => a.lastAnnounceAt.desc())
    .first();
  if (lastAnnounce) {
    if (BigInt(uploaded) < lastAnnounce.uploaded) {
      return 'Invalid stats: Uploaded value decreased.';
    }
    if (BigInt(downloaded) < lastAnnounce.downloaded) {
      return 'Invalid stats: Downloaded value decreased.';
    }
  }
  // 3. No impossible values
  const maxJump = (config.maxStatsJumpMultiplier ?? 10) * (Number(torrentSize) || 0);
  if (Number(uploaded) > maxJump || Number(downloaded) > maxJump || Number(left) > Number(torrentSize) * (config.maxStatsJumpMultiplier ?? 10)) {
    return 'Invalid stats: Value exceeds allowed maximum.';
  }
  // 4. No huge jumps
  if (lastAnnounce) {
    const uploadDelta = BigInt(uploaded) - lastAnnounce.uploaded;
    const downloadDelta = BigInt(downloaded) - lastAnnounce.downloaded;
    if (Number(uploadDelta) > maxJump || Number(downloadDelta) > maxJump) {
      return 'Invalid stats: Unreasonably large upload/download jump.';
    }
  }
  // 5. Event consistency
  if (event === 'completed' && BigInt(left) !== 0n) {
    return 'Invalid stats: Completed event must have left = 0.';
  }
  // (Optional) Protocol compliance checks can be added here
  return null;
}

export async function isPeerBanned(config: any, params: any): Promise<string | null> {
  if (!config.enablePeerBanCheck) return null;
  const { userId, passkey, peerId, ip } = params;
  if (!userId && !passkey && !peerId && !ip) return null;
  const now = toTimestamp(new Date().toISOString());
  // Match any ban selector that is not expired (null expiry means permanent)
  const ban = await db.orm.public.PeerBan
    .where((b) => {
      const conditions = [];
      if (userId) {
        conditions.push(and(b.userId.eq(userId), or(b.expiresAt.isNull(), b.expiresAt.gt(now))));
      }
      if (passkey) {
        conditions.push(and(b.passkey.eq(passkey), or(b.expiresAt.isNull(), b.expiresAt.gt(now))));
      }
      if (peerId) {
        conditions.push(and(b.peerId.eq(peerId), or(b.expiresAt.isNull(), b.expiresAt.gt(now))));
      }
      if (ip) {
        conditions.push(and(b.ip.eq(ip), or(b.expiresAt.isNull(), b.expiresAt.gt(now))));
      }
      return or(...conditions);
    })
    .first();
  if (ban) {
    return `You are banned from the tracker: ${ban.reason}`;
  }
  return null;
}

export async function checkClientWhitelistBlacklist(config: any, params: any): Promise<string | null> {
  const client = params.client || '';
  if (config.whitelistedClients && config.whitelistedClients.length > 0) {
    if (!config.whitelistedClients.includes(client)) {
      return 'Your torrent client is not allowed on this tracker.';
    }
  }
  if (config.blacklistedClients && config.blacklistedClients.length > 0) {
    if (config.blacklistedClients.includes(client)) {
      return 'Your torrent client is banned from this tracker.';
    }
  }
  return null;
}

export async function checkClientFingerprint(config: any, params: any): Promise<string | null> {
  const fingerprint = params.fingerprint || '';
  if (config.allowedFingerprints && config.allowedFingerprints.length > 0) {
    if (!config.allowedFingerprints.includes(fingerprint)) {
      return 'Your torrent client version is not allowed (fingerprint check).';
    }
  }
  return null;
}

export async function checkAnnounceRateLimit(config: any, params: any): Promise<string | null> {
  const userId = params.userId;
  if (!userId) return null;
  const rateLimit = config.announceRateLimit ?? 60;
  const rateWindow = config.announceRateWindow ?? 3600; // seconds
  const cooldown = config.announceCooldown ?? 1800; // seconds
  const now = new Date();
  const nowIso = now.toISOString();
  const nowTs = toTimestamp(nowIso);
  // Find or create AnnounceRateLimit record for this user
  const record = await db.orm.public.AnnounceRateLimit.where({ userId }).first();
  if (!record) {
    await db.orm.public.AnnounceRateLimit.create({
      userId, lastCheckedAt: nowTs, announceCount: 1
    });
    return null;
  }
  // Check if in cooldown
  if (record.cooldownUntil && parseTimestamp(record.cooldownUntil) > now.getTime()) {
    const secondsLeft = Math.ceil((parseTimestamp(record.cooldownUntil) - now.getTime()) / 1000);
    return `Announce rate limit exceeded: You are in cooldown for ${secondsLeft} more seconds.`;
  }
  // If lastCheckedAt is outside the window, reset
  if ((now.getTime() - parseTimestamp(record.lastCheckedAt)) / 1000 > rateWindow) {
    await db.orm.public.AnnounceRateLimit.where({ id: record.id }).update({
      lastCheckedAt: nowTs, announceCount: 1, cooldownUntil: null, reason: null
    });
    return null;
  }
  // Otherwise, increment count
  if (record.announceCount + 1 > rateLimit) {
    const cooldownUntil = toTimestamp(new Date(now.getTime() + cooldown * 1000).toISOString());
    await db.orm.public.AnnounceRateLimit.where({ id: record.id }).update({
      cooldownUntil, reason: 'Too many announces'
    });
    return `Announce rate limit exceeded: You are in cooldown for ${cooldown} seconds.`;
  } else {
    const query = db.raw.sql`UPDATE "AnnounceRateLimit" SET "announceCount" = "announceCount" + ${1} WHERE "id" = ${record.id}`.affectedCount().build();
    await db.runtime().execute(query);
    return null;
  }
}
