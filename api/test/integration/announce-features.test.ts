process.env.TZ = "UTC";

import crypto from "node:crypto";
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { db } from "../../src/lib/prisma.js";
import {
  checkAnnounceRate,
  checkAnnounceRateLimit,
  checkGhostLeeching,
  checkInvalidStats,
  checkIpAbuse,
  isPeerBanned,
} from "../../src/announce_features/antiCheat.js";
import { awardBonusPoints } from "../../src/announce_features/bonusPoints.js";
import {
  checkHitAndRunGracePeriod,
  updateHitAndRun,
} from "../../src/announce_features/hitAndRun.js";
import {
  getActivePeers,
  getCompletedCount,
  getSeederLeecherCounts,
} from "../../src/announce_features/peerList.js";
import {
  isUserBelowMinRatio,
  updateUserRatio,
} from "../../src/announce_features/ratio.js";

// Task 8 integration coverage for the `announce_features/` group. Rows are
// seeded through the Prisma 8 `db` client so the tests prove the converted
// call sites work against real PostgreSQL, not just against the old v7 client.
//
// Timestamps are stored as the contract's `TimestampString(3)`, so they travel
// as PostgreSQL text (`YYYY-MM-DD HH:MM:SS.mmm`). `process.env.TZ` is pinned to
// UTC above, matching the server, so wall-clock arithmetic stays deterministic.

const userIds: string[] = [];
const torrentIds: string[] = [];
const categoryIds: string[] = [];

async function makeUser(): Promise<string> {
  const id = crypto.randomUUID();
  await db.orm.public.User.create({
    id,
    email: `af-${id}@example.com`,
    username: `af_${id.replace(/-/g, "")}`,
    passwordHash: "not-a-real-hash",
    passkey: crypto.randomUUID(),
  });
  userIds.push(id);
  return id;
}

async function makeTorrent(
  uploaderId: string,
  fields: { freeleech?: boolean } = {},
): Promise<string> {
  const categoryId = crypto.randomUUID();
  await db.orm.public.Category.create({
    id: categoryId,
    name: `af-cat-${categoryId}`,
  });
  categoryIds.push(categoryId);

  const id = crypto.randomUUID();
  await db.orm.public.Torrent.create({
    id,
    infoHash: `af-hash-${id}`,
    name: `af torrent ${id}`,
    uploaderId,
    filePath: "/tmp/af.torrent",
    size: 1000n,
    categoryId,
    freeleech: fields.freeleech ?? false,
  });
  torrentIds.push(id);
  return id;
}

async function makeAnnounce(fields: {
  torrentId: string;
  userId?: string | null;
  peerId: string;
  ip?: string;
  port?: number;
  uploaded?: bigint;
  downloaded?: bigint;
  left?: bigint;
  event?: string | null;
  lastAnnounceAt?: string;
}): Promise<string> {
  const id = crypto.randomUUID();
  await db.orm.public.Announce.create({
    id,
    torrentId: fields.torrentId,
    userId: fields.userId ?? null,
    peerId: fields.peerId,
    ip: fields.ip ?? "10.0.0.1",
    port: fields.port ?? 6881,
    uploaded: fields.uploaded ?? 0n,
    downloaded: fields.downloaded ?? 0n,
    left: fields.left ?? 0n,
    event: fields.event ?? null,
    ...(fields.lastAnnounceAt === undefined
      ? {}
      : { lastAnnounceAt: fields.lastAnnounceAt }),
  });
  return id;
}

async function setConfig(fields: Record<string, unknown>): Promise<void> {
  await db.orm.public.Config.upsert({
    create: { id: 1, ...fields } as any,
    update: fields as any,
  });
}

after(async () => {
  for (const torrentId of torrentIds) {
    await db.orm.public.Announce.where({ torrentId }).deleteAll();
    await db.orm.public.HitAndRun.where({ torrentId }).deleteAll();
  }
  for (const userId of userIds) {
    await db.orm.public.Announce.where({ userId }).deleteAll();
    await db.orm.public.HitAndRun.where({ userId }).deleteAll();
    await db.orm.public.AnnounceRateLimit.where({ userId }).deleteAll();
    await db.orm.public.PeerBan.where({ userId }).deleteAll();
    await db.orm.public.PeerBan.where({ bannedById: userId }).deleteAll();
  }
  for (const id of torrentIds) {
    await db.orm.public.Torrent.where({ id }).deleteAll();
  }
  for (const id of categoryIds) {
    await db.orm.public.Category.where({ id }).deleteAll();
  }
  for (const id of userIds) {
    await db.orm.public.User.where({ id }).deleteAll();
  }
  await db.orm.public.Config.where({ id: 1 }).deleteAll();
});

test("checkGhostLeeching: detects a download with no upload", async () => {
  const user = await makeUser();
  const torrent = await makeTorrent(user);
  await makeAnnounce({
    torrentId: torrent,
    userId: user,
    peerId: "ghost",
    downloaded: 500n,
    left: 0n,
  });

  const result = await checkGhostLeeching(
    { enableGhostLeechingCheck: true },
    { userId: user, torrentId: torrent },
  );
  assert.match(result ?? "", /Ghost leeching/);
});

test("checkGhostLeeching: returns null once the user has uploaded", async () => {
  const user = await makeUser();
  const torrent = await makeTorrent(user);
  await makeAnnounce({
    torrentId: torrent,
    userId: user,
    peerId: "seed",
    uploaded: 500n,
    downloaded: 500n,
  });

  const result = await checkGhostLeeching(
    { enableGhostLeechingCheck: true },
    { userId: user, torrentId: torrent },
  );
  assert.equal(result, null);
});

test("checkGhostLeeching: disabled or missing ids returns null", async () => {
  assert.equal(
    await checkGhostLeeching(
      { enableGhostLeechingCheck: false },
      { userId: "u", torrentId: "t" },
    ),
    null,
  );
  assert.equal(
    await checkGhostLeeching(
      { enableGhostLeechingCheck: true },
      { userId: null, torrentId: null },
    ),
    null,
  );
});

test("checkIpAbuse: detects too many distinct IPs for one user", async () => {
  const user = await makeUser();
  const torrent = await makeTorrent(user);
  for (let i = 0; i < 4; i++) {
    await makeAnnounce({
      torrentId: torrent,
      userId: user,
      peerId: `ip-${i}`,
      ip: `10.0.0.${i + 1}`,
    });
  }

  const result = await checkIpAbuse(
    { enableIpAbuseCheck: true, maxIpsPerUser: 3 },
    { userId: user, ip: "10.0.0.1" },
  );
  assert.match(result ?? "", /Too many different IPs/);
});

test("checkIpAbuse: detects too many distinct users on one IP", async () => {
  const uploader = await makeUser();
  const torrent = await makeTorrent(uploader);
  const sharers = await Promise.all([makeUser(), makeUser(), makeUser(), makeUser()]);
  for (let i = 0; i < sharers.length; i++) {
    await makeAnnounce({
      torrentId: torrent,
      userId: sharers[i],
      peerId: `shared-${i}`,
      ip: "10.9.9.9",
    });
  }

  const result = await checkIpAbuse(
    { enableIpAbuseCheck: true, maxIpsPerUser: 3, maxUsersPerIp: 3 },
    { userId: sharers[0], ip: "10.9.9.9" },
  );
  assert.match(result ?? "", /Too many different users/);
});

test("checkIpAbuse: returns null within the configured limits", async () => {
  const user = await makeUser();
  const torrent = await makeTorrent(user);
  await makeAnnounce({
    torrentId: torrent,
    userId: user,
    peerId: "only",
    ip: "10.0.0.7",
  });

  const result = await checkIpAbuse(
    { enableIpAbuseCheck: true, maxIpsPerUser: 3, maxUsersPerIp: 3 },
    { userId: user, ip: "10.0.0.7" },
  );
  assert.equal(result, null);
});

test("checkAnnounceRate: rejects an announce inside the minimum interval", async () => {
  const user = await makeUser();
  const torrent = await makeTorrent(user);
  await makeAnnounce({
    torrentId: torrent,
    userId: user,
    peerId: "rate",
    lastAnnounceAt: new Date().toISOString(),
  });

  const result = await checkAnnounceRate(
    { enableAnnounceRateCheck: true, minAnnounceInterval: 300 },
    { userId: user, torrentId: torrent, peerId: "rate" },
  );
  assert.match(result ?? "", /Announce rate limit/);
});

test("checkAnnounceRate: allows an announce outside the minimum interval", async () => {
  const user = await makeUser();
  const torrent = await makeTorrent(user);
  await makeAnnounce({
    torrentId: torrent,
    userId: user,
    peerId: "rate",
    lastAnnounceAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
  });

  const result = await checkAnnounceRate(
    { enableAnnounceRateCheck: true, minAnnounceInterval: 300 },
    { userId: user, torrentId: torrent, peerId: "rate" },
  );
  assert.equal(result, null);
});

test("checkInvalidStats: rejects negative values", async () => {
  const user = await makeUser();
  const torrent = await makeTorrent(user);

  const result = await checkInvalidStats(
    { enableInvalidStatsCheck: true, maxStatsJumpMultiplier: 10 },
    {
      userId: user,
      torrentId: torrent,
      peerId: "neg",
      uploaded: -1n,
      downloaded: 0n,
      left: 0n,
      event: "started",
      torrentSize: 1000n,
    },
  );
  assert.match(result ?? "", /Negative values/);
});

test("checkInvalidStats: rejects a decreasing upload", async () => {
  const user = await makeUser();
  const torrent = await makeTorrent(user);
  await makeAnnounce({
    torrentId: torrent,
    userId: user,
    peerId: "dec",
    uploaded: 100n,
    downloaded: 100n,
  });

  const result = await checkInvalidStats(
    { enableInvalidStatsCheck: true, maxStatsJumpMultiplier: 10 },
    {
      userId: user,
      torrentId: torrent,
      peerId: "dec",
      uploaded: 50n,
      downloaded: 100n,
      left: 0n,
      event: "started",
      torrentSize: 1000n,
    },
  );
  assert.match(result ?? "", /Uploaded value decreased/);
});

test("checkInvalidStats: rejects a completed event with left > 0", async () => {
  const user = await makeUser();
  const torrent = await makeTorrent(user);

  const result = await checkInvalidStats(
    { enableInvalidStatsCheck: true, maxStatsJumpMultiplier: 10 },
    {
      userId: user,
      torrentId: torrent,
      peerId: "left",
      uploaded: 0n,
      downloaded: 0n,
      left: 5n,
      event: "completed",
      torrentSize: 1000n,
    },
  );
  assert.match(result ?? "", /Completed event must have left = 0/);
});

test("checkInvalidStats: returns null for consistent stats", async () => {
  const user = await makeUser();
  const torrent = await makeTorrent(user);

  const result = await checkInvalidStats(
    { enableInvalidStatsCheck: true, maxStatsJumpMultiplier: 10 },
    {
      userId: user,
      torrentId: torrent,
      peerId: "ok",
      uploaded: 100n,
      downloaded: 100n,
      left: 0n,
      event: "started",
      torrentSize: 1000n,
    },
  );
  assert.equal(result, null);
});

test("isPeerBanned: matches an active ban by userId", async () => {
  const user = await makeUser();
  await db.orm.public.PeerBan.create({
    userId: user,
    reason: "cheating",
    bannedById: user,
  });

  const result = await isPeerBanned(
    { enablePeerBanCheck: true },
    { userId: user },
  );
  assert.match(result ?? "", /cheating/);
});

test("isPeerBanned: ignores an expired ban", async () => {
  const user = await makeUser();
  await db.orm.public.PeerBan.create({
    userId: user,
    reason: "expired",
    bannedById: user,
    expiresAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
  });

  const result = await isPeerBanned(
    { enablePeerBanCheck: true },
    { userId: user },
  );
  assert.equal(result, null);
});

test("isPeerBanned: matches an active ban by IP", async () => {
  const user = await makeUser();
  await db.orm.public.PeerBan.create({
    ip: "8.8.8.8",
    reason: "bad ip",
    bannedById: user,
  });

  const result = await isPeerBanned(
    { enablePeerBanCheck: true },
    { ip: "8.8.8.8" },
  );
  assert.match(result ?? "", /bad ip/);
});

test("checkAnnounceRateLimit: creates a record on the first announce", async () => {
  const user = await makeUser();

  const result = await checkAnnounceRateLimit(
    { announceRateLimit: 60, announceRateWindow: 3600, announceCooldown: 1800 },
    { userId: user },
  );
  assert.equal(result, null);

  const record = await db.orm.public.AnnounceRateLimit.where({ userId: user }).first();
  assert.ok(record);
  assert.equal(record.announceCount, 1);
});

test("checkAnnounceRateLimit: reports an active cooldown", async () => {
  const user = await makeUser();
  await db.orm.public.AnnounceRateLimit.create({
    userId: user,
    lastCheckedAt: new Date().toISOString(),
    announceCount: 1,
    cooldownUntil: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
  });

  const result = await checkAnnounceRateLimit(
    { announceRateLimit: 60, announceRateWindow: 3600, announceCooldown: 1800 },
    { userId: user },
  );
  assert.match(result ?? "", /cooldown/);
});

test("checkAnnounceRateLimit: resets the count once the window elapses", async () => {
  const user = await makeUser();
  await db.orm.public.AnnounceRateLimit.create({
    userId: user,
    lastCheckedAt: new Date(Date.now() - 4000 * 1000).toISOString(),
    announceCount: 50,
  });

  const result = await checkAnnounceRateLimit(
    { announceRateLimit: 60, announceRateWindow: 3600, announceCooldown: 1800 },
    { userId: user },
  );
  assert.equal(result, null);

  const record = await db.orm.public.AnnounceRateLimit.where({ userId: user }).first();
  assert.ok(record);
  assert.equal(record.announceCount, 1);
  assert.equal(record.cooldownUntil, null);
});

test("checkAnnounceRateLimit: sets a cooldown when the limit is exceeded", async () => {
  const user = await makeUser();
  await db.orm.public.AnnounceRateLimit.create({
    userId: user,
    lastCheckedAt: new Date().toISOString(),
    announceCount: 2,
  });

  const result = await checkAnnounceRateLimit(
    { announceRateLimit: 2, announceRateWindow: 3600, announceCooldown: 1800 },
    { userId: user },
  );
  assert.match(result ?? "", /cooldown/);

  const record = await db.orm.public.AnnounceRateLimit.where({ userId: user }).first();
  assert.ok(record);
  assert.equal(record.reason, "Too many announces");
  assert.ok(record.cooldownUntil);
});

test("checkAnnounceRateLimit: increments the count below the limit", async () => {
  const user = await makeUser();
  await db.orm.public.AnnounceRateLimit.create({
    userId: user,
    lastCheckedAt: new Date().toISOString(),
    announceCount: 1,
  });

  const result = await checkAnnounceRateLimit(
    { announceRateLimit: 60, announceRateWindow: 3600, announceCooldown: 1800 },
    { userId: user },
  );
  assert.equal(result, null);

  const record = await db.orm.public.AnnounceRateLimit.where({ userId: user }).first();
  assert.ok(record);
  assert.equal(record.announceCount, 2);
});

test("awardBonusPoints: adds floor(minutes / 60) * pointsPerHour", async () => {
  const user = await makeUser();
  await setConfig({ bonusPointsPerHour: 5 });

  await awardBonusPoints(user, 150);

  const row = await db.orm.public.User.select("bonusPoints").first({ id: user });
  assert.ok(row);
  assert.equal(row.bonusPoints, 10);
});

test("awardBonusPoints: leaves the balance unchanged below one hour", async () => {
  const user = await makeUser();
  await setConfig({ bonusPointsPerHour: 5 });

  await awardBonusPoints(user, 30);

  const row = await db.orm.public.User.select("bonusPoints").first({ id: user });
  assert.ok(row);
  assert.equal(row.bonusPoints, 0);
});

test("awardBonusPoints: refreshes the user's updatedAt", async () => {
  const user = await makeUser();
  await setConfig({ bonusPointsPerHour: 5 });
  const before = await db.orm.public.User.select("updatedAt").first({ id: user });
  assert.ok(before);

  await new Promise((resolve) => setTimeout(resolve, 10));
  await awardBonusPoints(user, 60);

  const after = await db.orm.public.User.select("updatedAt").first({ id: user });
  assert.ok(after);
  assert.notEqual(after.updatedAt, before.updatedAt);
});

test("updateHitAndRun: creates a record when a download completes", async () => {
  const user = await makeUser();
  const torrent = await makeTorrent(user);
  await setConfig({ requiredSeedingMinutes: 10 });

  await updateHitAndRun(user, torrent, 0, "completed");

  const record = await db.orm.public.HitAndRun.where({ userId: user, torrentId: torrent }).first();
  assert.ok(record);
  assert.equal(record.isHitAndRun, false);
  assert.ok(record.lastSeededAt);
});

test("updateHitAndRun: ignores a non-completed announce with no record", async () => {
  const user = await makeUser();
  const torrent = await makeTorrent(user);
  await setConfig({ requiredSeedingMinutes: 10 });

  await updateHitAndRun(user, torrent, 5, "started");

  const record = await db.orm.public.HitAndRun.where({ userId: user, torrentId: torrent }).first();
  assert.equal(record, null);
});

test("updateHitAndRun: accumulates seeding time while left is zero", async () => {
  const user = await makeUser();
  const torrent = await makeTorrent(user);
  await setConfig({ requiredSeedingMinutes: 10 });
  await db.orm.public.HitAndRun.create({
    userId: user,
    torrentId: torrent,
    lastSeededAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
    totalSeedingTime: 0,
    isHitAndRun: false,
  });

  await updateHitAndRun(user, torrent, 0, "started");

  const record = await db.orm.public.HitAndRun.where({ userId: user, torrentId: torrent }).first();
  assert.ok(record);
  assert.equal(record.totalSeedingTime, 10);
  assert.equal(record.isHitAndRun, false);
});

test("updateHitAndRun: flags a stopped peer below the required seeding time", async () => {
  const user = await makeUser();
  const torrent = await makeTorrent(user);
  await setConfig({ requiredSeedingMinutes: 10 });
  await db.orm.public.HitAndRun.create({
    userId: user,
    torrentId: torrent,
    lastSeededAt: null,
    totalSeedingTime: 0,
    isHitAndRun: false,
  });

  await updateHitAndRun(user, torrent, 5, "stopped");

  const record = await db.orm.public.HitAndRun.where({ userId: user, torrentId: torrent }).first();
  assert.ok(record);
  assert.equal(record.isHitAndRun, true);
});

test("updateHitAndRun: leaves a peer with enough seeding time unflagged", async () => {
  const user = await makeUser();
  const torrent = await makeTorrent(user);
  await setConfig({ requiredSeedingMinutes: 10 });
  await db.orm.public.HitAndRun.create({
    userId: user,
    torrentId: torrent,
    lastSeededAt: null,
    totalSeedingTime: 20,
    isHitAndRun: false,
  });

  await updateHitAndRun(user, torrent, 5, "stopped");

  const record = await db.orm.public.HitAndRun.where({ userId: user, torrentId: torrent }).first();
  assert.ok(record);
  assert.equal(record.isHitAndRun, false);
});

test("checkHitAndRunGracePeriod: flags stale under-seeded records", async () => {
  const user = await makeUser();
  const torrent = await makeTorrent(user);
  await setConfig({ requiredSeedingMinutes: 10, defaultAnnounceInterval: 1800 });
  const stale = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  await db.orm.public.HitAndRun.create({
    userId: user,
    torrentId: torrent,
    lastSeededAt: stale,
    totalSeedingTime: 5,
    isHitAndRun: false,
  });

  await checkHitAndRunGracePeriod();

  const record = await db.orm.public.HitAndRun.where({ userId: user, torrentId: torrent }).first();
  assert.ok(record);
  assert.equal(record.isHitAndRun, true);
});

test("checkHitAndRunGracePeriod: leaves completed seeders alone", async () => {
  const user = await makeUser();
  const torrent = await makeTorrent(user);
  await setConfig({ requiredSeedingMinutes: 10, defaultAnnounceInterval: 1800 });
  const stale = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  await db.orm.public.HitAndRun.create({
    userId: user,
    torrentId: torrent,
    lastSeededAt: stale,
    totalSeedingTime: 20,
    isHitAndRun: false,
  });

  await checkHitAndRunGracePeriod();

  const record = await db.orm.public.HitAndRun.where({ userId: user, torrentId: torrent }).first();
  assert.ok(record);
  assert.equal(record.isHitAndRun, false);
});

test("getActivePeers: excludes stopped, stale, and the requesting peer", async () => {
  const user = await makeUser();
  const torrent = await makeTorrent(user);
  const now = Date.now();
  await makeAnnounce({
    torrentId: torrent,
    peerId: "keep-1",
    ip: "1.1.1.1",
    port: 1001,
    event: "started",
    lastAnnounceAt: new Date(now).toISOString(),
  });
  await makeAnnounce({
    torrentId: torrent,
    peerId: "keep-2",
    ip: "2.2.2.2",
    port: 1002,
    event: "started",
    lastAnnounceAt: new Date(now - 5 * 60 * 1000).toISOString(),
  });
  await makeAnnounce({
    torrentId: torrent,
    peerId: "stale",
    ip: "3.3.3.3",
    port: 1003,
    event: "started",
    lastAnnounceAt: new Date(now - 40 * 60 * 1000).toISOString(),
  });
  await makeAnnounce({
    torrentId: torrent,
    peerId: "stopped",
    ip: "4.4.4.4",
    port: 1004,
    event: "stopped",
    lastAnnounceAt: new Date(now).toISOString(),
  });
  await makeAnnounce({
    torrentId: torrent,
    peerId: "requester",
    ip: "5.5.5.5",
    port: 1005,
    event: "started",
    lastAnnounceAt: new Date(now).toISOString(),
  });

  const peers = await getActivePeers(torrent, "requester", 10);
  assert.deepEqual(
    peers.map((p) => p.peerId),
    ["keep-1", "keep-2"],
  );
  assert.deepEqual(Object.keys(peers[0]).sort(), ["ip", "peerId", "port"]);
});

test("getActivePeers: honours the row limit", async () => {
  const user = await makeUser();
  const torrent = await makeTorrent(user);
  const now = Date.now();
  for (let i = 0; i < 3; i++) {
    await makeAnnounce({
      torrentId: torrent,
      peerId: `limited-${i}`,
      event: "started",
      lastAnnounceAt: new Date(now - i * 1000).toISOString(),
    });
  }

  const peers = await getActivePeers(torrent, "nobody", 2);
  assert.equal(peers.length, 2);
});

test("getSeederLeecherCounts: counts complete and incomplete peers", async () => {
  const user = await makeUser();
  const torrent = await makeTorrent(user);
  await makeAnnounce({ torrentId: torrent, peerId: "seed", left: 0n, event: "started" });
  await makeAnnounce({ torrentId: torrent, peerId: "leech", left: 10n, event: "started" });
  await makeAnnounce({
    torrentId: torrent,
    peerId: "stopped",
    left: 0n,
    event: "stopped",
  });
  await makeAnnounce({
    torrentId: torrent,
    peerId: "stale",
    left: 0n,
    event: "started",
    lastAnnounceAt: new Date(Date.now() - 40 * 60 * 1000).toISOString(),
  });

  const counts = await getSeederLeecherCounts(torrent);
  assert.deepEqual(counts, { complete: 1, incomplete: 1 });
});

test("getCompletedCount: counts completed announces for a torrent", async () => {
  const user = await makeUser();
  const torrent = await makeTorrent(user);
  await makeAnnounce({ torrentId: torrent, peerId: "c1", event: "completed" });
  await makeAnnounce({ torrentId: torrent, peerId: "c2", event: "completed" });
  await makeAnnounce({ torrentId: torrent, peerId: "s1", event: "started" });

  assert.equal(await getCompletedCount(torrent), 2);
});

test("updateUserRatio: applies the delta since the last announce", async () => {
  const user = await makeUser();
  const torrent = await makeTorrent(user, { freeleech: false });
  await makeAnnounce({
    torrentId: torrent,
    userId: user,
    peerId: "peer",
    uploaded: 100n,
    downloaded: 200n,
  });

  await updateUserRatio(user, 150n, 260n, "peer", torrent);

  const row = await db.orm.public.User.select("upload", "download").first({ id: user });
  assert.ok(row);
  assert.equal(row.upload, 50n);
  assert.equal(row.download, 60n);
});

test("updateUserRatio: does not count download traffic for freeleech torrents", async () => {
  const user = await makeUser();
  const torrent = await makeTorrent(user, { freeleech: true });
  await makeAnnounce({
    torrentId: torrent,
    userId: user,
    peerId: "peer",
    uploaded: 100n,
    downloaded: 200n,
  });

  await updateUserRatio(user, 150n, 260n, "peer", torrent);

  const row = await db.orm.public.User.select("upload", "download").first({ id: user });
  assert.ok(row);
  assert.equal(row.upload, 50n);
  assert.equal(row.download, 0n);
});

test("updateUserRatio: clamps a counter that appears to go backwards", async () => {
  const user = await makeUser();
  const torrent = await makeTorrent(user, { freeleech: false });
  await makeAnnounce({
    torrentId: torrent,
    userId: user,
    peerId: "peer",
    uploaded: 100n,
    downloaded: 200n,
  });

  await updateUserRatio(user, 90n, 180n, "peer", torrent);

  const row = await db.orm.public.User.select("upload", "download").first({ id: user });
  assert.ok(row);
  assert.equal(row.upload, 0n);
  assert.equal(row.download, 0n);
});

test("updateUserRatio: refreshes the user's updatedAt", async () => {
  const user = await makeUser();
  const torrent = await makeTorrent(user, { freeleech: false });
  const before = await db.orm.public.User.select("updatedAt").first({ id: user });
  assert.ok(before);

  await new Promise((resolve) => setTimeout(resolve, 10));
  await updateUserRatio(user, 10n, 20n, "peer", torrent);

  const after = await db.orm.public.User.select("updatedAt").first({ id: user });
  assert.ok(after);
  assert.notEqual(after.updatedAt, before.updatedAt);
});

test("isUserBelowMinRatio: compares the user ratio against the config", async () => {
  const user = await makeUser();
  await setConfig({ minRatio: 0.5 });
  await db.orm.public.User.where({ id: user }).update({ upload: 10n, download: 100n });

  assert.equal(await isUserBelowMinRatio(user), true);
});

test("isUserBelowMinRatio: a user with no downloads is never below", async () => {
  const user = await makeUser();
  await setConfig({ minRatio: 0.5 });
  await db.orm.public.User.where({ id: user }).update({ upload: 0n, download: 0n });

  assert.equal(await isUserBelowMinRatio(user), false);
});
