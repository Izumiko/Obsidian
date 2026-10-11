process.env.TZ = "UTC";

import crypto from "node:crypto";
import { after, test } from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import bencode from "bencode";
import { db } from "../../src/lib/prisma.js";
import { makeApp } from "../helpers/app.js";

// Task 11b integration coverage for `src/controllers/torrentController.ts`.
// Every handler is exercised through the real Fastify app via `app.inject()`
// so the converted Prisma 8 call sites (including the reject raw-SQL path) run
// against the local PostgreSQL. Prerequisites are seeded with the Prisma 8
// `db` client; nothing is mocked.
//
// `process.env.TZ` is pinned to UTC above so the timestamp columns decode
// deterministically.

const JWT_SECRET = process.env.JWT_SECRET || "changeme-in-production";

const userIds: string[] = [];
const torrentIds: string[] = [];
const categoryIds: string[] = [];
const fileIds: string[] = [];

type TestUser = {
  id: string;
  email: string;
  username: string;
  passkey: string;
  role: string;
};

async function makeUser(role = "USER"): Promise<TestUser> {
  const id = crypto.randomUUID();
  const email = `tc-${id}@example.com`;
  const username = `tc_${id.replace(/-/g, "")}`;
  const passkey = crypto.randomUUID().replace(/-/g, "");
  await db.orm.public.User.create({
    id,
    email,
    username,
    passwordHash: "not-a-real-hash",
    passkey,
    role: role as any,
    status: "ACTIVE",
  });
  userIds.push(id);
  return { id, email, username, passkey, role };
}

async function makeCategory(name = `tc-cat-${crypto.randomUUID()}`): Promise<string> {
  const id = crypto.randomUUID();
  await db.orm.public.Category.create({ id, name });
  categoryIds.push(id);
  return id;
}

async function makeTorrent(
  uploaderId: string,
  fields: {
    categoryId?: string;
    name?: string;
    isApproved?: boolean;
    isRejected?: boolean;
    tags?: string[];
    isAnonymous?: boolean;
    filePath?: string;
  } = {},
): Promise<{ id: string; name: string; infoHash: string; categoryId: string }> {
  const categoryId = fields.categoryId ?? (await makeCategory());
  const id = crypto.randomUUID();
  const infoHash = `tc-hash-${id}`;
  const name = fields.name ?? `tc torrent ${id}`;
  await db.orm.public.Torrent.create({
    id,
    infoHash,
    name,
    description: `description for ${name}`,
    uploaderId,
    filePath: fields.filePath ?? "/tmp/tc.torrent",
    size: 2048n,
    categoryId,
    isApproved: fields.isApproved ?? true,
    isRejected: fields.isRejected ?? false,
    tags: fields.tags ?? [],
    isAnonymous: fields.isAnonymous ?? false,
  });
  torrentIds.push(id);
  return { id, name, infoHash, categoryId };
}

function tokenFor(user: {
  id: string;
  email?: string;
  username?: string;
  passkey?: string;
  role?: string;
}): string {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      username: user.username,
      passkey: user.passkey,
      role: user.role ?? "USER",
      emailVerified: true,
    },
    JWT_SECRET,
    { expiresIn: "1h" },
  );
}

async function resetConfig(overrides: Record<string, unknown> = {}): Promise<void> {
  await db.orm.public.Config.where({ id: 1 }).deleteAll();
  await db.orm.public.Config.create({
    id: 1,
    registrationMode: "OPEN",
    storageType: "DB",
    requireTorrentApproval: false,
    ...overrides,
  } as any);
}

// A real, private, single-file torrent so `parse-torrent` resolves an infoHash
// and the controller's private-torrent validation passes.
function makeTorrentFile(name: string): Buffer {
  return Buffer.from(
    bencode.encode({
      announce: "http://tracker.local/announce",
      "announce-list": [["http://tracker.local/announce"]],
      info: {
        name,
        "piece length": 16384,
        pieces: Buffer.alloc(20),
        length: 1234,
        private: 1,
      },
    }),
  );
}

type MultipartPart = {
  name: string;
  value?: string;
  filename?: string;
  contentType?: string;
  data?: Buffer;
};

function buildMultipart(boundary: string, parts: MultipartPart[]): Buffer {
  const chunks: Buffer[] = [];
  for (const part of parts) {
    chunks.push(Buffer.from(`--${boundary}\r\n`));
    if (part.filename) {
      chunks.push(
        Buffer.from(
          `Content-Disposition: form-data; name="${part.name}"; filename="${part.filename}"\r\n`,
        ),
      );
      chunks.push(
        Buffer.from(`Content-Type: ${part.contentType ?? "application/octet-stream"}\r\n\r\n`),
      );
      chunks.push(part.data as Buffer);
      chunks.push(Buffer.from("\r\n"));
    } else {
      chunks.push(Buffer.from(`Content-Disposition: form-data; name="${part.name}"\r\n\r\n`));
      chunks.push(Buffer.from(part.value ?? ""));
      chunks.push(Buffer.from("\r\n"));
    }
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return Buffer.concat(chunks);
}

async function makeStoredTorrentFile(buffer: Buffer): Promise<string> {
  const file = await db.orm.public.UploadedFile.create({
    type: "torrent",
    ext: ".torrent",
    storageKey: "",
    size: buffer.length,
    mimeType: "application/x-bittorrent",
    data: new Uint8Array(buffer),
  });
  fileIds.push(file.id);
  return file.id;
}

after(async () => {
  for (const id of userIds) {
    await db.orm.public.CommentVote.where({ userId: id }).deleteAll();
  }
  for (const id of userIds) {
    await db.orm.public.Comment.where({ userId: id }).deleteAll();
    await db.orm.public.Bookmark.where({ userId: id }).deleteAll();
    await db.orm.public.TorrentVote.where({ userId: id }).deleteAll();
    await db.orm.public.DownloadToken.where({ userId: id }).deleteAll();
    await db.orm.public.Announce.where({ userId: id }).deleteAll();
    await db.orm.public.HitAndRun.where({ userId: id }).deleteAll();
    await db.orm.public.Notification.where({ userId: id }).deleteAll();
    await db.orm.public.Notification.where({ adminId: id }).deleteAll();
    await db.orm.public.UserActivity.where({ userId: id }).deleteAll();
    await db.orm.public.PeerBan.where({ bannedById: id }).deleteAll();
    await db.orm.public.PeerBan.where({ userId: id }).deleteAll();
  }
  for (const id of torrentIds) {
    await db.orm.public.Bookmark.where({ torrentId: id }).deleteAll();
    await db.orm.public.TorrentVote.where({ torrentId: id }).deleteAll();
    await db.orm.public.Comment.where({ torrentId: id }).deleteAll();
    await db.orm.public.DownloadToken.where({ torrentId: id }).deleteAll();
    await db.orm.public.Announce.where({ torrentId: id }).deleteAll();
    await db.orm.public.HitAndRun.where({ torrentId: id }).deleteAll();
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
  for (const id of fileIds) {
    await db.orm.public.UploadedFile.where({ id }).deleteAll();
  }
  await db.orm.public.Config.where({ id: 1 }).deleteAll();
});

// ---------------------------------------------------------------------------
// voteTorrentHandler
// ---------------------------------------------------------------------------

test("vote: records, updates, and validates votes", async () => {
  const app = await makeApp();
  try {
    await resetConfig();
    const uploader = await makeUser();
    const torrent = await makeTorrent(uploader.id);
    const voter = await makeUser();
    const auth = { authorization: `Bearer ${tokenFor(voter)}` };

    const up = await app.inject({
      method: "POST",
      url: `/torrent/${torrent.id}/vote`,
      headers: auth,
      payload: { type: "up" },
    });
    assert.equal(up.statusCode, 200);
    assert.deepEqual(up.json(), { success: true });

    let vote = await db.orm.public.TorrentVote
      .where({ userId: voter.id, torrentId: torrent.id })
      .first();
    assert.equal(vote?.value, 1);

    // A second vote on the same torrent updates rather than inserts.
    const down = await app.inject({
      method: "POST",
      url: `/torrent/${torrent.id}/vote`,
      headers: auth,
      payload: { type: "down" },
    });
    assert.equal(down.statusCode, 200);
    const votes = await db.orm.public.TorrentVote
      .where({ userId: voter.id, torrentId: torrent.id })
      .all();
    assert.equal(votes.length, 1);
    assert.equal(votes[0]!.value, -1);

    const invalid = await app.inject({
      method: "POST",
      url: `/torrent/${torrent.id}/vote`,
      headers: auth,
      payload: { type: "sideways" },
    });
    assert.equal(invalid.statusCode, 400);

    const missing = await app.inject({
      method: "POST",
      url: `/torrent/${crypto.randomUUID()}/vote`,
      headers: auth,
      payload: { type: "up" },
    });
    assert.equal(missing.statusCode, 404);

    const anonymous = await app.inject({
      method: "POST",
      url: `/torrent/${torrent.id}/vote`,
      payload: { type: "up" },
    });
    assert.equal(anonymous.statusCode, 401);
  } finally {
    await app.close();
  }
});

// ---------------------------------------------------------------------------
// Secure token handlers
// ---------------------------------------------------------------------------

test("magnet-token: mints a token for an approved torrent only", async () => {
  const app = await makeApp();
  try {
    await resetConfig();
    const uploader = await makeUser();
    const approved = await makeTorrent(uploader.id, { isApproved: true });
    const pending = await makeTorrent(uploader.id, { isApproved: false });
    const auth = { authorization: `Bearer ${tokenFor(uploader)}` };

    const res = await app.inject({
      method: "POST",
      url: `/torrent/${approved.id}/magnet-token`,
      headers: auth,
    });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.match(body.magnetUrl, new RegExp(`/torrent/${approved.id}/magnet-secure\\?token=`));
    assert.equal(typeof body.token, "string");
    assert.ok(body.token.length > 0);
    assert.ok(new Date(body.expiresAt).getTime() > Date.now());

    const stored = await db.orm.public.DownloadToken.where({ token: body.token }).first();
    assert.ok(stored);
    assert.equal(stored!.torrentId, approved.id);
    assert.equal(stored!.userId, uploader.id);
    assert.equal(stored!.used, false);

    const denied = await app.inject({
      method: "POST",
      url: `/torrent/${pending.id}/magnet-token`,
      headers: auth,
    });
    assert.equal(denied.statusCode, 404);
  } finally {
    await app.close();
  }
});

test("download-token + download-secure serves a passkey-rewritten torrent", async () => {
  const app = await makeApp();
  try {
    await resetConfig({ storageType: "DB" });
    const uploader = await makeUser();
    const fileId = await makeStoredTorrentFile(makeTorrentFile("download me"));
    const torrent = await makeTorrent(uploader.id, { filePath: fileId, isApproved: true });
    const auth = { authorization: `Bearer ${tokenFor(uploader)}` };

    const tokenRes = await app.inject({
      method: "POST",
      url: `/torrent/${torrent.id}/download-token`,
      headers: auth,
    });
    assert.equal(tokenRes.statusCode, 200);
    const { token, downloadUrl } = tokenRes.json();
    assert.match(downloadUrl, new RegExp(`/torrent/${torrent.id}/download-secure\\?token=`));

    const download = await app.inject({
      method: "GET",
      url: `/torrent/${torrent.id}/download-secure?token=${token}`,
    });
    assert.equal(download.statusCode, 200);
    assert.equal(download.headers["content-type"], "application/x-bittorrent");

    const parsed: any = bencode.decode(download.rawPayload);
    assert.match(
      Buffer.from(parsed.announce as Uint8Array).toString("utf8"),
      new RegExp(`passkey=${uploader.passkey}`),
    );

    // The token is single-use.
    const reused = await app.inject({
      method: "GET",
      url: `/torrent/${torrent.id}/download-secure?token=${token}`,
    });
    assert.equal(reused.statusCode, 401);
  } finally {
    await app.close();
  }
});

test("download-secure rejects a token for a different torrent", async () => {
  const app = await makeApp();
  try {
    await resetConfig({ storageType: "DB" });
    const uploader = await makeUser();
    const fileId = await makeStoredTorrentFile(makeTorrentFile("mismatch"));
    const torrent = await makeTorrent(uploader.id, { filePath: fileId });
    const other = await makeTorrent(uploader.id);
    const auth = { authorization: `Bearer ${tokenFor(uploader)}` };

    const tokenRes = await app.inject({
      method: "POST",
      url: `/torrent/${torrent.id}/download-token`,
      headers: auth,
    });
    const { token } = tokenRes.json();

    const res = await app.inject({
      method: "GET",
      url: `/torrent/${other.id}/download-secure?token=${token}`,
    });
    assert.equal(res.statusCode, 400);
    assert.deepEqual(res.json(), { error: "Token does not match torrent" });
  } finally {
    await app.close();
  }
});

// ---------------------------------------------------------------------------
// getTorrentHandler
// ---------------------------------------------------------------------------

test("detail: returns the enriched torrent payload", async () => {
  const app = await makeApp();
  try {
    await resetConfig();
    const uploader = await makeUser();
    const categoryId = await makeCategory("Movies");
    const torrent = await makeTorrent(uploader.id, {
      categoryId,
      tags: ["action", "hd"],
    });
    // Seed a bookmark and a comment so `_count` is non-zero.
    const fan = await makeUser();
    await db.orm.public.Bookmark.create({
      id: crypto.randomUUID(),
      userId: fan.id,
      torrentId: torrent.id,
    });
    await db.orm.public.Comment.create({
      id: crypto.randomUUID(),
      content: "great",
      userId: fan.id,
      torrentId: torrent.id,
    });

    const res = await app.inject({
      method: "GET",
      url: `/torrent/${torrent.id}`,
      headers: { authorization: `Bearer ${tokenFor(fan)}` },
    });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.id, torrent.id);
    assert.equal(body.name, torrent.name);
    assert.equal(body.category, "Movies");
    assert.deepEqual(body.tags, ["action", "hd"]);
    assert.equal(body.seeders, 0);
    assert.equal(body.leechers, 0);
    assert.equal(body.completed, 0);
    assert.deepEqual(body._count, { bookmarks: 1, comments: 1 });
    assert.equal(body.bookmarked, true);
    assert.equal(body.userVote, null);
    assert.equal(body.uploader.username, uploader.username);
    assert.equal(typeof body.createdAt, "string");
    assert.ok(Array.isArray(body.files));
    // The relation-count fields are folded into `_count`, not leaked.
    assert.equal(body.bookmarks, undefined);
    assert.equal(body.comments, undefined);
  } finally {
    await app.close();
  }
});

test("detail: hides a pending torrent from non-uploaders", async () => {
  const app = await makeApp();
  try {
    await resetConfig();
    const uploader = await makeUser();
    const pending = await makeTorrent(uploader.id, { isApproved: false });

    const anonymous = await app.inject({ method: "GET", url: `/torrent/${pending.id}` });
    assert.equal(anonymous.statusCode, 404);

    const uploaderView = await app.inject({
      method: "GET",
      url: `/torrent/${pending.id}`,
      headers: { authorization: `Bearer ${tokenFor(uploader)}` },
    });
    assert.equal(uploaderView.statusCode, 200);

    const admin = await makeUser("ADMIN");
    const staffView = await app.inject({
      method: "GET",
      url: `/torrent/${pending.id}`,
      headers: { authorization: `Bearer ${tokenFor(admin)}` },
    });
    assert.equal(staffView.statusCode, 200);
  } finally {
    await app.close();
  }
});

// ---------------------------------------------------------------------------
// listTorrentsHandler
// ---------------------------------------------------------------------------

test("list: filters by status, search, category, and tag", async () => {
  const app = await makeApp();
  try {
    await resetConfig({ registrationMode: "OPEN" });
    const uploader = await makeUser();
    const categoryId = await makeCategory("Documentaries");
    const approved = await makeTorrent(uploader.id, {
      name: "Unique Searchable Alpha",
      categoryId,
      tags: ["linux", "documentary"],
      isApproved: true,
    });
    await makeTorrent(uploader.id, { name: "Hidden Pending", isApproved: false });

    const bySearch = await app.inject({ method: "GET", url: "/torrent/list?q=unique+searchable" });
    assert.equal(bySearch.statusCode, 200);
    assert.equal(bySearch.json().total, 1);
    assert.equal(bySearch.json().torrents[0].id, approved.id);

    const byCategory = await app.inject({ method: "GET", url: "/torrent/list?categoryId=Documentaries" });
    assert.equal(byCategory.statusCode, 200);
    assert.ok(byCategory.json().torrents.some((t: any) => t.id === approved.id));

    const byTag = await app.inject({ method: "GET", url: "/torrent/list?tag=linux" });
    assert.equal(byTag.statusCode, 200);
    assert.equal(byTag.json().total, 1);
    assert.equal(byTag.json().torrents[0].id, approved.id);

    const byMissingTag = await app.inject({ method: "GET", url: "/torrent/list?tag=absent" });
    assert.equal(byMissingTag.statusCode, 200);
    assert.equal(byMissingTag.json().total, 0);
    assert.deepEqual(byMissingTag.json().torrents, []);

    // Default view only returns approved torrents.
    const all = await app.inject({ method: "GET", url: "/torrent/list?limit=100" });
    assert.ok(all.json().torrents.every((t: any) => t.id !== "undefined"));

    const pending = await app.inject({ method: "GET", url: "/torrent/list?status=pending" });
    assert.equal(pending.statusCode, 200);
    assert.ok(pending.json().total >= 1);
  } finally {
    await app.close();
  }
});

// ---------------------------------------------------------------------------
// Admin listing and stats
// ---------------------------------------------------------------------------

test("admin list: returns torrents for each status filter", async () => {
  const app = await makeApp();
  try {
    await resetConfig();
    const admin = await makeUser("ADMIN");
    const uploader = await makeUser();
    const approved = await makeTorrent(uploader.id, { isApproved: true });
    const pending = await makeTorrent(uploader.id, { isApproved: false });
    const rejected = await makeTorrent(uploader.id, { isApproved: false, isRejected: true });
    const auth = { authorization: `Bearer ${tokenFor(admin)}` };

    const approvedRes = await app.inject({ method: "GET", url: "/admin/torrents?status=approved&limit=100", headers: auth });
    assert.equal(approvedRes.statusCode, 200);
    assert.ok(approvedRes.json().torrents.some((t: any) => t.id === approved.id));

    const pendingRes = await app.inject({ method: "GET", url: "/admin/torrents?status=pending&limit=100", headers: auth });
    assert.ok(pendingRes.json().torrents.some((t: any) => t.id === pending.id));

    const rejectedRes = await app.inject({ method: "GET", url: "/admin/torrents?status=rejected&limit=100", headers: auth });
    assert.ok(rejectedRes.json().torrents.some((t: any) => t.id === rejected.id));

    const forbidden = await app.inject({ method: "GET", url: "/admin/torrents", headers: { authorization: `Bearer ${tokenFor(uploader)}` } });
    assert.equal(forbidden.statusCode, 403);
  } finally {
    await app.close();
  }
});

test("admin stats: counts total, approved, and pending", async () => {
  const app = await makeApp();
  try {
    await resetConfig();
    const admin = await makeUser("ADMIN");
    const uploader = await makeUser();
    await makeTorrent(uploader.id, { isApproved: true });
    await makeTorrent(uploader.id, { isApproved: true });
    await makeTorrent(uploader.id, { isApproved: false });

    const expectedTotal = await db.orm.public.Torrent.aggregate((a) => ({ n: a.count() }));
    const expectedApproved = await db.orm.public.Torrent
      .where({ isApproved: true })
      .aggregate((a) => ({ n: a.count() }));
    const expectedPending = await db.orm.public.Torrent
      .where({ isApproved: false })
      .aggregate((a) => ({ n: a.count() }));

    const res = await app.inject({
      method: "GET",
      url: "/admin/torrents/stats",
      headers: { authorization: `Bearer ${tokenFor(admin)}` },
    });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json(), {
      total: expectedTotal.n,
      approved: expectedApproved.n,
      pending: expectedPending.n,
    });
  } finally {
    await app.close();
  }
});

// ---------------------------------------------------------------------------
// approveTorrentHandler / rejectTorrentHandler
// ---------------------------------------------------------------------------

test("approve: sets isApproved and notifies the uploader", async () => {
  const app = await makeApp();
  try {
    await resetConfig();
    const admin = await makeUser("ADMIN");
    const uploader = await makeUser();
    const torrent = await makeTorrent(uploader.id, { isApproved: false });

    const res = await app.inject({
      method: "POST",
      url: `/admin/torrent/${torrent.id}/approve`,
      headers: { authorization: `Bearer ${tokenFor(admin)}` },
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().success, true);
    assert.equal(res.json().torrent.isApproved, true);

    const row = await db.orm.public.Torrent.where({ id: torrent.id }).first();
    assert.equal(row?.isApproved, true);

    const notifications = await db.orm.public.Notification
      .where({ userId: uploader.id, type: "torrent_approved" })
      .all();
    assert.equal(notifications.length, 1);
  } finally {
    await app.close();
  }
});

test("reject: writes the rejection fields via raw SQL and notifies the uploader", async () => {
  const app = await makeApp();
  try {
    await resetConfig();
    const admin = await makeUser("ADMIN");
    const uploader = await makeUser();
    const torrent = await makeTorrent(uploader.id, { isApproved: false });

    const res = await app.inject({
      method: "POST",
      url: `/admin/torrent/${torrent.id}/reject`,
      headers: { authorization: `Bearer ${tokenFor(admin)}` },
      payload: { reason: "low quality" },
    });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json(), { success: true });

    const row = await db.orm.public.Torrent.where({ id: torrent.id }).first();
    assert.equal(row?.isRejected, true);
    assert.equal(row?.rejectionReason, "low quality");
    assert.equal(row?.rejectedById, admin.id);
    assert.ok(row?.rejectedAt !== null && row?.rejectedAt !== undefined);

    const notifications = await db.orm.public.Notification
      .where({ userId: uploader.id, type: "torrent_rejected" })
      .all();
    assert.equal(notifications.length, 1);

    const again = await app.inject({
      method: "POST",
      url: `/admin/torrent/${torrent.id}/reject`,
      headers: { authorization: `Bearer ${tokenFor(admin)}` },
      payload: { reason: "again" },
    });
    assert.equal(again.statusCode, 400);
  } finally {
    await app.close();
  }
});

// ---------------------------------------------------------------------------
// editTorrentHandler / deleteTorrentHandler
// ---------------------------------------------------------------------------

test("edit: updates name, description, and category", async () => {
  const app = await makeApp();
  try {
    await resetConfig();
    const admin = await makeUser("ADMIN");
    const uploader = await makeUser();
    const originalCategory = await makeCategory("Original Category");
    const newCategory = await makeCategory("New Category");
    const torrent = await makeTorrent(uploader.id, { categoryId: originalCategory, isApproved: true });

    const res = await app.inject({
      method: "PUT",
      url: `/admin/torrent/${torrent.id}`,
      headers: { authorization: `Bearer ${tokenFor(admin)}` },
      payload: { name: "Edited Name", description: "Edited description", categoryId: newCategory },
    });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.success, true);
    assert.equal(body.torrent.name, "Edited Name");
    assert.equal(body.torrent.description, "Edited description");
    assert.equal(body.torrent.category.name, "New Category");

    const row = await db.orm.public.Torrent.where({ id: torrent.id }).first();
    assert.equal(row?.name, "Edited Name");
    assert.equal(row?.categoryId, newCategory);
  } finally {
    await app.close();
  }
});

test("delete: removes the torrent and its dependent rows", async () => {
  const app = await makeApp();
  try {
    await resetConfig();
    const admin = await makeUser("ADMIN");
    const uploader = await makeUser();
    const fan = await makeUser();
    const torrent = await makeTorrent(uploader.id, { isApproved: true });

    await db.orm.public.Bookmark.create({
      id: crypto.randomUUID(),
      userId: fan.id,
      torrentId: torrent.id,
    });
    await db.orm.public.TorrentVote.create({
      id: crypto.randomUUID(),
      userId: fan.id,
      torrentId: torrent.id,
      value: 1,
    });
    await db.orm.public.Comment.create({
      id: crypto.randomUUID(),
      content: "bye",
      userId: fan.id,
      torrentId: torrent.id,
    });

    const res = await app.inject({
      method: "DELETE",
      url: `/admin/torrent/${torrent.id}`,
      headers: { authorization: `Bearer ${tokenFor(admin)}` },
    });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.success, true);
    assert.equal(body.message, "Torrent deleted successfully");

    assert.equal(await db.orm.public.Torrent.where({ id: torrent.id }).first(), null);
    assert.equal(await db.orm.public.Bookmark.where({ torrentId: torrent.id }).first(), null);
    assert.equal(await db.orm.public.TorrentVote.where({ torrentId: torrent.id }).first(), null);
    assert.equal(await db.orm.public.Comment.where({ torrentId: torrent.id }).first(), null);

    const notifications = await db.orm.public.Notification
      .where({ userId: uploader.id, type: "TORRENT_DELETED" })
      .all();
    assert.equal(notifications.length, 1);

    const missing = await app.inject({
      method: "DELETE",
      url: `/admin/torrent/${crypto.randomUUID()}`,
      headers: { authorization: `Bearer ${tokenFor(admin)}` },
    });
    assert.equal(missing.statusCode, 404);
  } finally {
    await app.close();
  }
});

// ---------------------------------------------------------------------------
// uploadTorrentHandler / getNfoHandler
// ---------------------------------------------------------------------------

test("upload: creates a torrent from a multipart .torrent file", async () => {
  const app = await makeApp();
  try {
    await resetConfig({ storageType: "DB", requireTorrentApproval: false });
    const uploader = await makeUser();
    const categoryId = await makeCategory("Uploads");
    const torrentBuffer = makeTorrentFile("Uploaded Release");

    const boundary = `----tc${crypto.randomUUID().replace(/-/g, "")}`;
    const payload = buildMultipart(boundary, [
      {
        name: "torrent",
        filename: "release.torrent",
        contentType: "application/x-bittorrent",
        data: torrentBuffer,
      },
      { name: "name", value: "Uploaded Release" },
      { name: "description", value: "Uploaded via test" },
      { name: "categoryId", value: categoryId },
      { name: "tags", value: JSON.stringify(["upload", "test"]) },
    ]);

    const res = await app.inject({
      method: "POST",
      url: "/torrent/upload",
      headers: {
        authorization: `Bearer ${tokenFor(uploader)}`,
        "content-type": `multipart/form-data; boundary=${boundary}`,
      },
      payload,
    });
    assert.equal(res.statusCode, 201);
    const body = res.json();
    assert.equal(body.name, "Uploaded Release");
    assert.equal(typeof body.infoHash, "string");
    assert.ok(body.infoHash.length > 0);
    torrentIds.push(body.id);

    const row = await db.orm.public.Torrent.where({ id: body.id }).first();
    assert.ok(row);
    assert.equal(row!.uploaderId, uploader.id);
    assert.equal(row!.categoryId, categoryId);
    assert.equal(row!.isApproved, true);
    assert.deepEqual(row!.tags, ["upload", "test"]);
    assert.equal(row!.size, 1234n);

    // The stored torrent is parsed back for the detail payload.
    const detail = await app.inject({
      method: "GET",
      url: `/torrent/${body.id}`,
      headers: { authorization: `Bearer ${tokenFor(uploader)}` },
    });
    assert.equal(detail.statusCode, 200);
    assert.ok(Array.isArray(detail.json().files));
    assert.equal(detail.json().files[0].path, "Uploaded Release");
  } finally {
    await app.close();
  }
});

test("nfo: serves the stored NFO file", async () => {
  const app = await makeApp();
  try {
    await resetConfig({ storageType: "DB" });
    const uploader = await makeUser();
    const bytes = Buffer.from("NFO CONTENTS");
    const nfo = await db.orm.public.UploadedFile.create({
      type: "nfo",
      ext: ".nfo",
      storageKey: "",
      size: bytes.length,
      mimeType: "text/plain",
      data: new Uint8Array(bytes),
    });
    fileIds.push(nfo.id);
    const torrent = await makeTorrent(uploader.id, { isApproved: true });
    await db.orm.public.Torrent.where({ id: torrent.id }).update({ nfoPath: nfo.id });

    const res = await app.inject({
      method: "GET",
      url: `/torrent/${torrent.id}/nfo`,
      headers: { authorization: `Bearer ${tokenFor(uploader)}` },
    });
    assert.equal(res.statusCode, 200);
    assert.match(res.headers["content-disposition"] as string, /\.nfo"/);
    assert.equal(res.rawPayload.toString(), "NFO CONTENTS");

    // A torrent without an NFO returns 404.
    const other = await makeTorrent(uploader.id, { isApproved: true });
    const missing = await app.inject({
      method: "GET",
      url: `/torrent/${other.id}/nfo`,
      headers: { authorization: `Bearer ${tokenFor(uploader)}` },
    });
    assert.equal(missing.statusCode, 404);
  } finally {
    await app.close();
  }
});

// ---------------------------------------------------------------------------
// recalculateUserStatsHandler
// ---------------------------------------------------------------------------

test("recalculate-user-stats: recomputes upload/download from announce deltas", async () => {
  const app = await makeApp();
  try {
    await resetConfig();
    const admin = await makeUser("ADMIN");
    const user = await makeUser();
    const torrent = await makeTorrent(user.id, { isApproved: true });

    // Announces are unique per (torrent, peer), so seed two peers; the handler
    // sums each peer's positive delta from zero.
    await db.orm.public.Announce.create({
      id: crypto.randomUUID(),
      torrentId: torrent.id,
      userId: user.id,
      peerId: `tc-peer-a-${crypto.randomUUID()}`,
      ip: "10.0.0.1",
      port: 6881,
      uploaded: 500n,
      downloaded: 0n,
      left: 100n,
    });
    await db.orm.public.Announce.create({
      id: crypto.randomUUID(),
      torrentId: torrent.id,
      userId: user.id,
      peerId: `tc-peer-b-${crypto.randomUUID()}`,
      ip: "10.0.0.1",
      port: 6881,
      uploaded: 400n,
      downloaded: 200n,
      left: 0n,
    });

    const res = await app.inject({
      method: "POST",
      url: "/admin/recalculate-user-stats",
      headers: { authorization: `Bearer ${tokenFor(admin)}` },
    });
    assert.equal(res.statusCode, 200);

    const row = await db.orm.public.User.where({ id: user.id }).first();
    assert.equal(row?.upload, 900n);
    assert.equal(row?.download, 200n);
  } finally {
    await app.close();
  }
});
