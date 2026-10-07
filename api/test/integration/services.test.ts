process.env.TZ = "UTC";

import crypto from "node:crypto";
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { db } from "../../src/lib/prisma.js";
import {
  getConfig,
  updateConfig,
  isFirstUser,
  requireTorrentApproval,
} from "../../src/services/configService.js";
import {
  saveFile,
  getFile,
  deleteFile,
} from "../../src/services/fileStorageService.js";
import {
  createNotification,
  getUserNotifications,
  markNotificationRead,
  markAllNotificationsRead,
} from "../../src/services/notificationService.js";
import {
  calculateUserRank,
  getAllRanks,
  createRank,
  updateRank,
  deleteRank,
  getRankById,
  areRanksEnabled,
  setRanksEnabled,
} from "../../src/services/rankService.js";

// Task 9 integration coverage for the `services/` group. Prerequisites are
// seeded through the Prisma 8 `db` client so the tests prove the converted call
// sites work against real PostgreSQL, not just against the old v7 client.
//
// `process.env.TZ` is pinned to UTC above, matching the server, so the
// timestamp columns decode deterministically.

const userIds: string[] = [];
const rankIds: string[] = [];
const notificationIds: string[] = [];
const peerBanIds: string[] = [];
const fileIds: string[] = [];

async function makeUser(): Promise<string> {
  const id = crypto.randomUUID();
  await db.orm.public.User.create({
    id,
    email: `svc-${id}@example.com`,
    username: `svc_${id.replace(/-/g, "")}`,
    passwordHash: "not-a-real-hash",
    passkey: crypto.randomUUID(),
  });
  userIds.push(id);
  return id;
}

async function makePeerBan(bannedById: string): Promise<string> {
  const id = crypto.randomUUID();
  await db.orm.public.PeerBan.create({ id, reason: "svc-ban", bannedById });
  peerBanIds.push(id);
  return id;
}

async function makeRank(fields: {
  name?: string;
  description?: string | null;
  order: number;
  minUpload?: bigint;
  minDownload?: bigint;
  minRatio?: number;
  color?: string | null;
}) {
  const rank = await createRank({
    name: fields.name ?? `svc-rank-${crypto.randomUUID()}`,
    description: fields.description ?? null,
    order: fields.order,
    minUpload: fields.minUpload ?? 0n,
    minDownload: fields.minDownload ?? 0n,
    minRatio: fields.minRatio ?? 0,
    color: fields.color ?? null,
  });
  rankIds.push(rank.id);
  return rank;
}

async function setRanksEnabledConfig(enabled: boolean): Promise<void> {
  await db.orm.public.Config.where({ id: 1 }).deleteAll();
  await db.orm.public.Config.create({ id: 1, ranksEnabled: enabled });
}

async function clearRanks(): Promise<void> {
  for (const id of rankIds) {
    await db.orm.public.Rank.where({ id }).deleteAll();
  }
  rankIds.length = 0;
}

after(async () => {
  for (const id of notificationIds) {
    await db.orm.public.Notification.where({ id }).deleteAll();
  }
  for (const id of peerBanIds) {
    await db.orm.public.PeerBan.where({ id }).deleteAll();
  }
  for (const id of fileIds) {
    await db.orm.public.UploadedFile.where({ id }).deleteAll();
  }
  await clearRanks();
  for (const id of userIds) {
    await db.orm.public.User.where({ id }).deleteAll();
  }
  await db.orm.public.Config.where({ id: 1 }).deleteAll();
});

// ---------------------------------------------------------------------------
// configService
// ---------------------------------------------------------------------------

test("configService.getConfig creates the id=1 singleton with defaults", async () => {
  await db.orm.public.Config.where({ id: 1 }).deleteAll();

  const config = await getConfig();

  assert.equal(config.id, 1);
  assert.equal(config.registrationMode, "OPEN");
  assert.equal(config.storageType, "DB");
  assert.equal(config.requireTorrentApproval, false);

  const row = await db.orm.public.Config.where({ id: 1 }).first();
  assert.ok(row);
  assert.equal(row.id, 1);
});

test("configService.getConfig returns the existing singleton", async () => {
  await db.orm.public.Config.where({ id: 1 }).deleteAll();
  await db.orm.public.Config.create({
    id: 1,
    requireTorrentApproval: true,
    minRatio: 1.25,
  });

  const config = await getConfig();

  assert.equal(config.requireTorrentApproval, true);
  assert.equal(config.minRatio, 1.25);
});

test("configService.updateConfig updates known fields", async () => {
  await db.orm.public.Config.where({ id: 1 }).deleteAll();
  await getConfig();

  const updated = await updateConfig({
    requireTorrentApproval: true,
    minRatio: 2,
  });

  assert.equal(updated.requireTorrentApproval, true);
  assert.equal(updated.minRatio, 2);

  const row = await db.orm.public.Config.where({ id: 1 }).first();
  assert.ok(row);
  assert.equal(row.requireTorrentApproval, true);
  assert.equal(row.minRatio, 2);
});

test("configService.requireTorrentApproval reads the singleton flag", async () => {
  await db.orm.public.Config.where({ id: 1 }).deleteAll();
  await db.orm.public.Config.create({ id: 1, requireTorrentApproval: true });

  assert.equal(await requireTorrentApproval(), true);
});

test("configService.isFirstUser reflects the user count", async () => {
  const before = (await db.orm.public.User.aggregate((a) => ({ n: a.count() }))).n;
  if (before === 0) {
    assert.equal(await isFirstUser(), true);
  }

  await makeUser();

  assert.equal(await isFirstUser(), false);
});

// ---------------------------------------------------------------------------
// notificationService
// ---------------------------------------------------------------------------

test("notificationService.createNotification persists the notification fields", async () => {
  const user = await makeUser();
  const admin = await makeUser();
  const banId = await makePeerBan(admin);

  const notification = await createNotification({
    userId: user,
    type: "BAN",
    message: "you are banned",
    adminId: admin,
    relatedBanId: banId,
  });
  notificationIds.push(notification.id);

  const row = await db.orm.public.Notification.where({
    id: notification.id,
  }).first();
  assert.ok(row);
  assert.equal(row.userId, user);
  assert.equal(row.type, "BAN");
  assert.equal(row.message, "you are banned");
  assert.equal(row.adminId, admin);
  assert.equal(row.relatedBanId, banId);
  assert.equal(row.read, false);
});

test("notificationService.getUserNotifications is newest-first and filters unread", async () => {
  const user = await makeUser();

  const older = await createNotification({
    userId: user,
    type: "A",
    message: "first",
  });
  notificationIds.push(older.id);
  await new Promise((resolve) => setTimeout(resolve, 10));
  const newer = await createNotification({
    userId: user,
    type: "B",
    message: "second",
  });
  notificationIds.push(newer.id);

  await markNotificationRead(older.id, user);

  const all = await getUserNotifications(user);
  assert.deepEqual(
    all.map((n) => n.id),
    [newer.id, older.id],
  );

  const unread = await getUserNotifications(user, true);
  assert.deepEqual(
    unread.map((n) => n.id),
    [newer.id],
  );
});

test("notificationService.markNotificationRead only touches the matching user", async () => {
  const userA = await makeUser();
  const userB = await makeUser();

  const noteA = await createNotification({
    userId: userA,
    type: "X",
    message: "a",
  });
  notificationIds.push(noteA.id);
  const noteB = await createNotification({
    userId: userB,
    type: "X",
    message: "b",
  });
  notificationIds.push(noteB.id);

  const mismatch = await markNotificationRead(noteA.id, userB);
  assert.equal(mismatch.count, 0);
  let row = await db.orm.public.Notification.where({ id: noteA.id }).first();
  assert.equal(row?.read, false);

  const match = await markNotificationRead(noteA.id, userA);
  assert.equal(match.count, 1);
  row = await db.orm.public.Notification.where({ id: noteA.id }).first();
  assert.equal(row?.read, true);
  const untouched = await db.orm.public.Notification.where({
    id: noteB.id,
  }).first();
  assert.equal(untouched?.read, false);
});

test("notificationService.markAllNotificationsRead marks every unread row", async () => {
  const user = await makeUser();

  const first = await createNotification({
    userId: user,
    type: "X",
    message: "a",
  });
  notificationIds.push(first.id);
  const second = await createNotification({
    userId: user,
    type: "X",
    message: "b",
  });
  notificationIds.push(second.id);

  await markNotificationRead(first.id, user);

  const result = await markAllNotificationsRead(user);
  assert.equal(result.count, 1);

  const unread = await getUserNotifications(user, true);
  assert.equal(unread.length, 0);
});

// ---------------------------------------------------------------------------
// rankService
// ---------------------------------------------------------------------------

test("rankService.createRank persists and stringifies bigint fields", async () => {
  await clearRanks();

  const rank = await makeRank({
    order: 1,
    minUpload: 100n,
    minDownload: 200n,
    minRatio: 0.5,
    color: "#fff",
  });

  assert.equal(rank.minUpload, "100");
  assert.equal(rank.minDownload, "200");

  const row = await db.orm.public.Rank.where({ id: rank.id }).first();
  assert.ok(row);
  assert.equal(row.minUpload, 100n);
  assert.equal(row.minDownload, 200n);
});

test("rankService.getAllRanks returns ranks ordered ascending", async () => {
  await clearRanks();

  const a = await makeRank({ order: 30 });
  const b = await makeRank({ order: 10 });
  const c = await makeRank({ order: 20 });
  const myIds = new Set([a.id, b.id, c.id]);

  const all = await getAllRanks();
  const mine = all.filter((r) => myIds.has(r.id));

  assert.deepEqual(
    mine.map((r) => r.order),
    [10, 20, 30],
  );
});

test("rankService.getRankById returns the rank or null", async () => {
  await clearRanks();

  const rank = await makeRank({ order: 5, minUpload: 42n });

  const found = await getRankById(rank.id);
  assert.equal(found?.id, rank.id);
  assert.equal(found?.minUpload, "42");
  assert.equal(await getRankById(crypto.randomUUID()), null);
});

test("rankService.updateRank updates fields and deleteRank removes the row", async () => {
  await clearRanks();

  const rank = await makeRank({ order: 7, minRatio: 0 });

  const updated = await updateRank(rank.id, { minRatio: 0.75, color: "#abc" });
  assert.equal(updated.minRatio, 0.75);
  assert.equal(updated.color, "#abc");

  await deleteRank(rank.id);
  assert.equal(await getRankById(rank.id), null);
});

test("rankService.areRanksEnabled and setRanksEnabled toggle the config", async () => {
  await setRanksEnabledConfig(false);
  assert.equal(await areRanksEnabled(), false);

  await setRanksEnabled(true);
  assert.equal(await areRanksEnabled(), true);
});

test("rankService.calculateUserRank returns an empty result when ranks are disabled", async () => {
  await setRanksEnabledConfig(false);
  const user = await makeUser();

  const result = await calculateUserRank(user);

  assert.deepEqual(result, {
    rank: null,
    nextRank: null,
    progress: { upload: 0, download: 0, ratio: 0 },
  });
});

test("rankService.calculateUserRank returns an empty result when no ranks exist", async () => {
  await clearRanks();
  await setRanksEnabledConfig(true);
  const user = await makeUser();

  const result = await calculateUserRank(user);

  assert.equal(result.rank, null);
  assert.equal(result.nextRank, null);
});

test("rankService.calculateUserRank picks the highest qualifying rank and the next one up", async () => {
  await clearRanks();
  await setRanksEnabledConfig(true);

  const top = await makeRank({ order: 100, minUpload: 100000n });
  const mid = await makeRank({ order: 101, minUpload: 100n });
  await makeRank({ order: 102, minUpload: 0n });

  const user = await makeUser();
  await db.orm.public.User.where({ id: user }).update({
    upload: 500n,
    download: 100n,
  });

  const result = await calculateUserRank(user);

  assert.equal(result.rank?.id, mid.id);
  assert.equal(result.nextRank?.id, top.id);
  assert.equal(result.progress.upload, 0.5);
  assert.equal(result.progress.download, 100);
  assert.equal(result.progress.ratio, 100);
});

test("rankService.calculateUserRank has no next rank at the top", async () => {
  await clearRanks();
  await setRanksEnabledConfig(true);

  const only = await makeRank({ order: 200, minUpload: 0n });
  const user = await makeUser();

  const result = await calculateUserRank(user);

  assert.equal(result.rank?.id, only.id);
  assert.equal(result.nextRank, null);
});

test("rankService.calculateUserRank throws for an unknown user", async () => {
  await clearRanks();
  await setRanksEnabledConfig(true);
  await makeRank({ order: 300 });

  await assert.rejects(calculateUserRank(crypto.randomUUID()), /User not found/);
});

// ---------------------------------------------------------------------------
// fileStorageService
// ---------------------------------------------------------------------------

test("fileStorageService.saveFile creates a DB record whose storageKey is its id", async () => {
  const config = await getConfig();
  const buffer = Buffer.from("hello world");

  const file = await saveFile({
    type: "image",
    buffer,
    ext: ".txt",
    mimeType: "text/plain",
    config,
  });
  fileIds.push(file.id);

  assert.equal(file.storageKey, file.id);
  assert.equal(file.size, buffer.length);
  assert.equal(file.ext, ".txt");
  assert.equal(file.mimeType, "text/plain");
  assert.equal(file.type, "image");

  const row = await db.orm.public.UploadedFile.where({ id: file.id }).first();
  assert.ok(row);
  assert.equal(row.storageKey, file.id);
  assert.ok(row.data);
});

test("fileStorageService.getFile returns the stored bytes", async () => {
  const config = await getConfig();

  const file = await saveFile({
    type: "nfo",
    buffer: Buffer.from("nfo-body"),
    ext: ".nfo",
    mimeType: "text/plain",
    config,
  });
  fileIds.push(file.id);

  const bytes = await getFile({ file, config });

  assert.equal(bytes.toString(), "nfo-body");
});

test("fileStorageService.deleteFile removes the DB record", async () => {
  const config = await getConfig();

  const file = await saveFile({
    type: "torrent",
    buffer: Buffer.from("torrent-bytes"),
    ext: ".torrent",
    mimeType: "application/x-bittorrent",
    config,
  });

  await deleteFile({ file, config });

  assert.equal(
    await db.orm.public.UploadedFile.where({ id: file.id }).first(),
    null,
  );
});
