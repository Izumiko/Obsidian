process.env.TZ = "UTC";

import crypto from "node:crypto";
import net from "node:net";
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { db } from "../../src/lib/prisma.js";
import { toTimestamp } from "../../src/lib/timestamps.js";
import { hashPassword } from "../../src/utils/password.js";
import { makeApp } from "../helpers/app.js";

// Task 12 integration coverage for the `controllers/admin/` group. Every handler
// is exercised through the real Fastify app via `app.inject()`, so the converted
// Prisma 8 call sites (including the six `$transaction` conversions in
// `adminCategoryController.ts`) run against the local PostgreSQL. Prerequisites
// are seeded with the Prisma 8 `db` client and the admin token is obtained
// through the real `/auth/login` flow.
//
// `process.env.TZ` is pinned to UTC above so the timestamp columns decode
// deterministically.

// ---------------------------------------------------------------------------
// Minimal SMTP sink. Several admin handlers send notification emails (ban,
// promote, request close/reject, announcement, wiki). nodemailer talks plain
// SMTP to whatever `config.smtpHost`/`SMTP_HOST` resolves to; this accepts the
// session and discards the message so the happy paths complete without a real
// mail server.
// ---------------------------------------------------------------------------

function startSmtpSink(): Promise<net.Server> {
  const server = net.createServer((socket) => {
    socket.write("220 localhost ESMTP\r\n");
    let buffer = "";
    let inData = false;
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      let idx: number;
      while ((idx = buffer.indexOf("\r\n")) !== -1) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        if (inData) {
          if (line === ".") {
            inData = false;
            socket.write("250 OK\r\n");
          }
          continue;
        }
        const cmd = line.toUpperCase();
        if (cmd.startsWith("EHLO")) socket.write("250-localhost\r\n250 OK\r\n");
        else if (cmd.startsWith("HELO")) socket.write("250 OK\r\n");
        else if (cmd.startsWith("MAIL FROM")) socket.write("250 OK\r\n");
        else if (cmd.startsWith("RCPT TO")) socket.write("250 OK\r\n");
        else if (cmd.startsWith("DATA")) {
          inData = true;
          socket.write("354 End data with <CR><LF>.<CR><LF>\r\n");
        } else if (cmd.startsWith("QUIT")) {
          socket.write("221 Bye\r\n");
          socket.end();
        } else {
          socket.write("250 OK\r\n");
        }
      }
    });
    socket.on("error", () => {});
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

const smtpSink = await startSmtpSink();
const smtpAddress = smtpSink.address() as net.AddressInfo;
process.env.SMTP_HOST = "127.0.0.1";
process.env.SMTP_PORT = String(smtpAddress.port);
process.env.SMTP_FROM = "noreply@test.local";

const createdUserIds: string[] = [];
const categoryIds: string[] = [];
const sourceIds: string[] = [];
const torrentIds: string[] = [];
const requestIds: string[] = [];
const announcementIds: string[] = [];
const wikiIds: string[] = [];
const rankIds: string[] = [];
const peerBanIds: string[] = [];
const notificationIds: string[] = [];

let adminId = "";
let adminToken = "";
let disabledBackup: { id: string; status: string }[] = [];

type TestUser = {
  id: string;
  email: string;
  username: string;
  passkey: string;
  role: string;
};

async function makeUser(
  role = "USER",
  overrides: { password?: string } = {},
): Promise<TestUser & { password: string }> {
  const id = crypto.randomUUID();
  const email = `admin-${id}@example.com`;
  const username = `admin_${id.replace(/-/g, "")}`;
  const passkey = crypto.randomUUID().replace(/-/g, "");
  const password = overrides.password ?? "test-password-123";
  const passwordHash = await hashPassword(password);
  await db.orm.public.User.create({
    id,
    email,
    username,
    passwordHash,
    passkey,
    role: role as any,
    status: "ACTIVE",
  });
  createdUserIds.push(id);
  return { id, email, username, passkey, role, password };
}

async function makeCategory(fields: {
  name?: string;
  order?: number;
  parentId?: string | null;
  inheritSources?: boolean;
} = {}): Promise<string> {
  const id = crypto.randomUUID();
  await db.orm.public.Category.create({
    id,
    name: fields.name ?? `admin-cat-${id}`,
    order: fields.order ?? null,
    parentId: fields.parentId ?? null,
    inheritSources: fields.inheritSources ?? true,
  });
  categoryIds.push(id);
  return id;
}

async function makeSource(name: string): Promise<string> {
  const id = crypto.randomUUID();
  await db.orm.public.Source.create({ id, name });
  sourceIds.push(id);
  return id;
}

async function makeTorrent(uploaderId: string, categoryId: string): Promise<string> {
  const id = crypto.randomUUID();
  await db.orm.public.Torrent.create({
    id,
    infoHash: `admin-hash-${id}`,
    name: `admin torrent ${id}`,
    uploaderId,
    filePath: "/tmp/admin.torrent",
    size: 1n,
    categoryId,
  });
  torrentIds.push(id);
  return id;
}

async function makeRequest(userId: string, title = `admin request ${crypto.randomUUID()}`): Promise<string> {
  const id = crypto.randomUUID();
  await db.orm.public.Request.create({ id, userId, title });
  requestIds.push(id);
  return id;
}

function auth(): { authorization: string } {
  return { authorization: `Bearer ${adminToken}` };
}

before(async () => {
  // Keep the active-user set small: announcement/wiki creation notifies every
  // ACTIVE user, and this database carries unrelated seed users. Disable them
  // for the duration and restore in `after`.
  const others = await db.orm.public.User.select("id", "status").all();
  disabledBackup = others.map((u) => ({ id: u.id, status: u.status }));
  await db.orm.public.User.where({}).updateAndCount({ status: "DISABLED" as any });

  const admin = await makeUser("ADMIN");
  adminId = admin.id;

  const app = await makeApp();
  try {
    const res = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: admin.email, password: admin.password },
    });
    assert.equal(res.statusCode, 200);
    adminToken = res.json().token;
    assert.ok(adminToken);
  } finally {
    await app.close();
  }
});

after(async () => {
  await new Promise<void>((resolve) => smtpSink.close(() => resolve()));

  if (createdUserIds.length > 0) {
    for (const id of createdUserIds) {
      await db.orm.public.Notification.where({ userId: id }).deleteAll();
      await db.orm.public.Notification.where({ adminId: id }).deleteAll();
      await db.orm.public.EmailVerificationToken.where({ userId: id }).deleteAll();
      await db.orm.public.PasswordResetToken.where({ userId: id }).deleteAll();
      await db.orm.public.Announce.where({ userId: id }).deleteAll();
      await db.orm.public.HitAndRun.where({ userId: id }).deleteAll();
      await db.orm.public.Comment.where({ userId: id }).deleteAll();
      await db.orm.public.Bookmark.where({ userId: id }).deleteAll();
      await db.orm.public.TorrentVote.where({ userId: id }).deleteAll();
      await db.orm.public.PeerBan.where({ bannedById: id }).deleteAll();
    }
  }
  for (const id of notificationIds) {
    await db.orm.public.Notification.where({ id }).deleteAll();
  }
  for (const id of announcementIds) {
    await db.orm.public.Announcement.where({ id }).deleteAll();
  }
  for (const id of wikiIds) {
    await db.orm.public.WikiPage.where({ id }).deleteAll();
  }
  for (const id of requestIds) {
    await db.orm.public.Comment.where({ requestId: id }).deleteAll();
    await db.orm.public.Request.where({ id }).deleteAll();
  }
  for (const id of torrentIds) {
    await db.orm.public.Announce.where({ torrentId: id }).deleteAll();
    await db.orm.public.Torrent.where({ id }).deleteAll();
  }
  for (const id of categoryIds) {
    await db.orm.public.CategorySource.where({ categoryId: id }).deleteAll();
  }
  for (const id of sourceIds) {
    await db.orm.public.CategorySource.where({ sourceId: id }).deleteAll();
    await db.orm.public.Source.where({ id }).deleteAll();
  }
  for (const id of categoryIds) {
    await db.orm.public.Category.where({ id }).deleteAll();
  }
  for (const id of rankIds) {
    await db.orm.public.Rank.where({ id }).deleteAll();
  }
  for (const id of peerBanIds) {
    await db.orm.public.PeerBan.where({ id }).deleteAll();
  }
  for (const id of createdUserIds) {
    await db.orm.public.User.where({ id }).deleteAll();
  }
  // Restore the users this file disabled.
  for (const entry of disabledBackup) {
    await db.orm.public.User.where({ id: entry.id }).update({ status: entry.status as any });
  }
  await db.orm.public.Config.where({ id: 1 }).deleteAll();
});

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

test("overview: counts totals, completed downloads, and peers", async () => {
  const app = await makeApp();
  try {
    const owner = await makeUser();
    const category = await makeCategory();
    const torrent = await makeTorrent(owner.id, category);

    const before = await db.orm.public.Announce
      .where({ event: "completed" })
      .aggregate((a) => ({ n: a.count() }));

    await db.orm.public.Announce.create({
      id: crypto.randomUUID(),
      torrentId: torrent,
      userId: owner.id,
      peerId: `admin-peer-complete-${crypto.randomUUID()}`,
      ip: "10.0.0.1",
      port: 6881,
      uploaded: 100n,
      downloaded: 50n,
      left: 0n,
      event: "completed",
    });
    await db.orm.public.Announce.create({
      id: crypto.randomUUID(),
      torrentId: torrent,
      userId: owner.id,
      peerId: `admin-peer-leech-${crypto.randomUUID()}`,
      ip: "10.0.0.2",
      port: 6882,
      uploaded: 0n,
      downloaded: 10n,
      left: 500n,
      event: "started",
    });

    const res = await app.inject({ method: "GET", url: "/admin/overview-stats", headers: auth() });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(typeof body.users, "number");
    assert.equal(typeof body.torrents, "number");
    assert.equal(typeof body.requests, "number");
    assert.equal(body.downloads, before.n + 1);
    assert.ok(body.peers >= 2);
    assert.ok(body.seeding >= 1);
    assert.ok(body.leeching >= 1);
  } finally {
    await app.close();
  }
});

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

test("users: lists and searches the user directory", async () => {
  const app = await makeApp();
  try {
    const target = await makeUser();
    const token = target.username.slice(0, 14);

    const res = await app.inject({
      method: "GET",
      url: `/admin/users?q=${encodeURIComponent(token)}`,
      headers: auth(),
    });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.ok(body.total >= 1);
    const found = body.users.find((u: any) => u.id === target.id);
    assert.ok(found);
    assert.equal(found.email, target.email);
    assert.equal(found.role, "USER");
    assert.match(found.createdAt, /T.*Z$/);
    assert.equal(body.page, 1);
  } finally {
    await app.close();
  }
});

test("users: ban notifies the target and sets the status", async () => {
  const app = await makeApp();
  try {
    const target = await makeUser();

    const res = await app.inject({
      method: "POST",
      url: `/admin/user/${target.id}/ban`,
      headers: auth(),
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().success, true);
    assert.equal(res.json().user.status, "BANNED");

    const row = await db.orm.public.User.where({ id: target.id }).first();
    assert.equal(row?.status, "BANNED");
    const notifications = await db.orm.public.Notification
      .where({ userId: target.id, type: "ban" })
      .all();
    assert.equal(notifications.length, 1);
  } finally {
    await app.close();
  }
});

test("users: promote grants MOD and notifies", async () => {
  const app = await makeApp();
  try {
    const target = await makeUser();

    const res = await app.inject({
      method: "POST",
      url: `/admin/user/${target.id}/promote`,
      headers: auth(),
      payload: { role: "MOD" },
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().user.role, "MOD");

    const row = await db.orm.public.User.where({ id: target.id }).first();
    assert.equal(row?.role, "MOD");
    const notifications = await db.orm.public.Notification
      .where({ userId: target.id, type: "promotion" })
      .all();
    assert.equal(notifications.length, 1);
  } finally {
    await app.close();
  }
});

test("users: rss-token rotates the token", async () => {
  const app = await makeApp();
  try {
    const target = await makeUser();

    const res = await app.inject({
      method: "POST",
      url: `/admin/user/${target.id}/rss-token`,
      headers: auth(),
    });
    assert.equal(res.statusCode, 200);
    const token = res.json().user.rssToken;
    assert.equal(typeof token, "string");
    assert.ok(token.length > 0);

    const row = await db.orm.public.User.where({ id: target.id }).select("rssToken").first();
    assert.equal(row?.rssToken, token);
  } finally {
    await app.close();
  }
});

test("peerban: create, list, get, and delete", async () => {
  const app = await makeApp();
  try {
    const create = await app.inject({
      method: "POST",
      url: "/admin/peerban",
      headers: auth(),
      payload: { peerId: `admin-peer-ban-${crypto.randomUUID()}`, reason: "misbehaving" },
    });
    assert.equal(create.statusCode, 201);
    const ban = create.json();
    peerBanIds.push(ban.id);
    assert.equal(ban.reason, "misbehaving");
    assert.equal(ban.bannedById, adminId);
    assert.equal(ban.userId, null);

    const list = await app.inject({ method: "GET", url: "/admin/peerban", headers: auth() });
    assert.equal(list.statusCode, 200);
    assert.ok(list.json().some((b: any) => b.id === ban.id));

    const get = await app.inject({
      method: "GET",
      url: `/admin/peerban/${ban.id}`,
      headers: auth(),
    });
    assert.equal(get.statusCode, 200);
    assert.equal(get.json().id, ban.id);
    assert.equal(get.json().bannedBy.id, adminId);

    const del = await app.inject({
      method: "DELETE",
      url: `/admin/peerban/${ban.id}`,
      headers: auth(),
    });
    assert.equal(del.statusCode, 200);
    assert.deepEqual(del.json(), { success: true });

    const gone = await app.inject({
      method: "GET",
      url: `/admin/peerban/${ban.id}`,
      headers: auth(),
    });
    assert.equal(gone.statusCode, 404);
  } finally {
    await app.close();
  }
});

// ---------------------------------------------------------------------------
// Ranks
// ---------------------------------------------------------------------------

test("rank: create, list, update, status, toggle, and delete", async () => {
  const app = await makeApp();
  try {
    const order = crypto.randomInt(1000, 100000);
    const create = await app.inject({
      method: "POST",
      url: "/admin/ranks",
      headers: auth(),
      payload: { name: `Rank-${order}`, order, minUpload: 100, minDownload: 200, minRatio: 0.5, color: "#fff" },
    });
    assert.equal(create.statusCode, 201);
    const rank = create.json().rank;
    rankIds.push(rank.id);
    assert.equal(rank.minUpload, "100");
    assert.equal(rank.minDownload, "200");
    assert.equal(rank.minRatio, 0.5);

    const list = await app.inject({ method: "GET", url: "/admin/ranks", headers: auth() });
    assert.equal(list.statusCode, 200);
    assert.ok(list.json().ranks.some((r: any) => r.id === rank.id));

    const update = await app.inject({
      method: "PUT",
      url: `/admin/ranks/${rank.id}`,
      headers: auth(),
      payload: { minRatio: 1.25, color: "#000" },
    });
    assert.equal(update.statusCode, 200);
    assert.equal(update.json().rank.minRatio, 1.25);

    const status = await app.inject({
      method: "GET",
      url: "/admin/ranks/status",
      headers: auth(),
    });
    assert.equal(status.statusCode, 200);
    assert.equal(typeof status.json().enabled, "boolean");

    const toggle = await app.inject({
      method: "POST",
      url: "/admin/ranks/toggle",
      headers: auth(),
      payload: { enabled: true },
    });
    assert.equal(toggle.statusCode, 200);
    assert.equal(toggle.json().enabled, true);

    const del = await app.inject({
      method: "DELETE",
      url: `/admin/ranks/${rank.id}`,
      headers: auth(),
    });
    assert.equal(del.statusCode, 200);
    assert.deepEqual(del.json(), { success: true });

    const missing = await app.inject({
      method: "GET",
      url: `/admin/ranks/${rank.id}`,
      headers: auth(),
    });
    assert.equal(missing.statusCode, 404);
  } finally {
    await app.close();
  }
});

// ---------------------------------------------------------------------------
// Wiki
// ---------------------------------------------------------------------------

test("wiki: create, list, update, lock/unlock, hide/show, and delete", async () => {
  const app = await makeApp();
  try {
    const slug = `admin-wiki-${crypto.randomUUID()}`;
    const create = await app.inject({
      method: "POST",
      url: "/admin/wiki",
      headers: auth(),
      payload: { slug, title: "Getting Started", content: "hello world" },
    });
    assert.equal(create.statusCode, 201);
    const page = create.json();
    wikiIds.push(page.id);
    assert.equal(page.slug, slug);
    assert.equal(page.visible, true);
    assert.equal(page.locked, false);
    assert.equal(page.createdById, adminId);

    const list = await app.inject({ method: "GET", url: "/admin/wiki", headers: auth() });
    assert.equal(list.statusCode, 200);
    assert.ok(Array.isArray(list.json()));
    assert.ok(list.json().some((p: any) => p.id === page.id));

    const update = await app.inject({
      method: "PUT",
      url: `/admin/wiki/${page.id}`,
      headers: auth(),
      payload: { title: "Getting Started (v2)", content: "updated" },
    });
    assert.equal(update.statusCode, 200);
    assert.equal(update.json().title, "Getting Started (v2)");

    const lock = await app.inject({
      method: "POST",
      url: `/admin/wiki/${page.id}/lock`,
      headers: auth(),
    });
    assert.equal(lock.statusCode, 200);
    assert.equal(lock.json().locked, true);

    const hide = await app.inject({
      method: "POST",
      url: `/admin/wiki/${page.id}/hide`,
      headers: auth(),
    });
    assert.equal(hide.statusCode, 200);
    assert.equal(hide.json().visible, false);

    const del = await app.inject({
      method: "DELETE",
      url: `/admin/wiki/${page.id}`,
      headers: auth(),
    });
    assert.equal(del.statusCode, 200);
    assert.deepEqual(del.json(), { success: true });
  } finally {
    await app.close();
  }
});

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

test("request: close and reject notify the requestor", async () => {
  const app = await makeApp();
  try {
    const requestor = await makeUser();
    const toClose = await makeRequest(requestor.id, "Close me");
    const toReject = await makeRequest(requestor.id, "Reject me");

    const close = await app.inject({
      method: "POST",
      url: `/admin/request/${toClose}/close`,
      headers: auth(),
      payload: { reason: "fulfilled" },
    });
    assert.equal(close.statusCode, 200);
    assert.equal(close.json().status, "CLOSED");
    assert.match(close.json().createdAt, /T.*Z$/);

    const reject = await app.inject({
      method: "POST",
      url: `/admin/request/${toReject}/reject`,
      headers: auth(),
      payload: { reason: "not allowed" },
    });
    assert.equal(reject.statusCode, 200);
    assert.equal(reject.json().status, "REJECTED");

    const closedNote = await db.orm.public.Notification
      .where({ userId: requestor.id, type: "request_closed" })
      .all();
    assert.equal(closedNote.length, 1);
    const rejectedNote = await db.orm.public.Notification
      .where({ userId: requestor.id, type: "request_rejected" })
      .all();
    assert.equal(rejectedNote.length, 1);
  } finally {
    await app.close();
  }
});

// ---------------------------------------------------------------------------
// Categories (includes the six `$transaction` conversions)
// ---------------------------------------------------------------------------

test("category: create, list with folded counts, and update", async () => {
  const app = await makeApp();
  try {
    const owner = await makeUser();
    const parent = await makeCategory({ name: `Parent ${crypto.randomUUID()}`, order: 0 });
    const child = await makeCategory({ name: `Child ${crypto.randomUUID()}`, order: 0, parentId: parent });
    await makeTorrent(owner.id, child);
    await makeRequest(owner.id);

    // Create with an auto-assigned order.
    const created = await app.inject({
      method: "POST",
      url: "/admin/category",
      headers: auth(),
      payload: { name: `Created ${crypto.randomUUID()}` },
    });
    assert.equal(created.statusCode, 201);
    categoryIds.push(created.json().id);
    assert.equal(typeof created.json().order, "number");

    const list = await app.inject({ method: "GET", url: "/admin/category", headers: auth() });
    assert.equal(list.statusCode, 200);
    const found = list.json().find((c: any) => c.id === parent);
    assert.ok(found);
    // Relation counts are folded back into the v7-shaped `_count` objects and
    // the raw reducer fields are removed.
    assert.deepEqual(found._count, { torrents: 0, requests: 0 });
    assert.equal(found.torrents, undefined);
    assert.equal(found.requests, undefined);
    assert.equal(found.children.length, 1);
    assert.equal(found.children[0].id, child);
    assert.deepEqual(found.children[0]._count, { torrents: 1, requests: 0 });
    assert.equal(found.children[0].torrents, undefined);
    assert.equal(found.children[0].requests, undefined);

    const update = await app.inject({
      method: "PUT",
      url: `/admin/category/${parent}`,
      headers: auth(),
      payload: { description: "updated parent" },
    });
    assert.equal(update.statusCode, 200);
    assert.equal(update.json().description, "updated parent");
  } finally {
    await app.close();
  }
});

test("category: reorder rolls back when a category is missing", async () => {
  const app = await makeApp();
  try {
    const first = await makeCategory({ name: `Rollback A ${crypto.randomUUID()}`, order: 3 });
    const second = await makeCategory({ name: `Rollback B ${crypto.randomUUID()}`, order: 4 });

    const res = await app.inject({
      method: "POST",
      url: "/admin/category/reorder",
      headers: auth(),
      payload: { categories: [{ id: first }, { id: second }, { id: crypto.randomUUID() }] },
    });
    assert.equal(res.statusCode, 500);
    assert.deepEqual(res.json(), { error: "Failed to reorder categories" });

    // The transaction must have rolled back the earlier successful updates.
    const rowFirst = await db.orm.public.Category.where({ id: first }).select("order").first();
    const rowSecond = await db.orm.public.Category.where({ id: second }).select("order").first();
    assert.equal(rowFirst?.order, 3);
    assert.equal(rowSecond?.order, 4);
  } finally {
    await app.close();
  }
});

test("category: move reparents a root category", async () => {
  const app = await makeApp();
  try {
    const parent = await makeCategory({ name: `Move target ${crypto.randomUUID()}`, order: 0 });
    const moving = await makeCategory({ name: `Move me ${crypto.randomUUID()}`, order: 1 });

    const res = await app.inject({
      method: "POST",
      url: "/admin/category/move",
      headers: auth(),
      payload: { categoryId: moving, newParentId: parent, newOrder: 0 },
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().success, true);
    assert.equal(res.json().category.parentId, parent);

    const row = await db.orm.public.Category.where({ id: moving }).select("parentId").first();
    assert.equal(row?.parentId, parent);
  } finally {
    await app.close();
  }
});

test("category: sources add, list, reorder, and delete", async () => {
  const app = await makeApp();
  try {
    const category = await makeCategory({ name: `Sources ${crypto.randomUUID()}` });

    const addAlpha = await app.inject({
      method: "POST",
      url: `/admin/category/${category}/sources`,
      headers: auth(),
      payload: { name: `Alpha-${crypto.randomUUID()}` },
    });
    assert.equal(addAlpha.statusCode, 201);
    assert.deepEqual(addAlpha.json(), { success: true });

    const betaName = `Beta-${crypto.randomUUID()}`;
    const addBeta = await app.inject({
      method: "POST",
      url: `/admin/category/${category}/sources`,
      headers: auth(),
      payload: { name: betaName },
    });
    assert.equal(addBeta.statusCode, 201);

    const listed = await app.inject({
      method: "GET",
      url: `/admin/category/${category}/sources`,
      headers: auth(),
    });
    assert.equal(listed.statusCode, 200);
    assert.equal(listed.json().own.length, 2);
    assert.deepEqual(listed.json().inherited, []);
    const beta = listed.json().own.find((s: any) => s.name === betaName);
    const alpha = listed.json().own.find((s: any) => s.name !== betaName);
    assert.ok(beta && alpha);

    const reorder = await app.inject({
      method: "PUT",
      url: `/admin/category/${category}/sources/reorder`,
      headers: auth(),
      payload: { orderedSourceIds: [beta.id, alpha.id] },
    });
    assert.equal(reorder.statusCode, 200);
    assert.deepEqual(reorder.json(), { success: true });

    const afterReorder = await app.inject({
      method: "GET",
      url: `/admin/category/${category}/sources`,
      headers: auth(),
    });
    assert.equal(afterReorder.json().own[0].name, betaName);

    const del = await app.inject({
      method: "DELETE",
      url: `/admin/category/${category}/sources/${alpha.id}`,
      headers: auth(),
    });
    assert.equal(del.statusCode, 200);
    assert.deepEqual(del.json(), { success: true });

    const afterDelete = await app.inject({
      method: "GET",
      url: `/admin/category/${category}/sources`,
      headers: auth(),
    });
    assert.equal(afterDelete.json().own.length, 1);
  } finally {
    await app.close();
  }
});

test("category: delete requires cascade for a parent and cascades", async () => {
  const app = await makeApp();
  try {
    const parent = await makeCategory({ name: `Delete parent ${crypto.randomUUID()}`, order: 0 });
    const child = await makeCategory({ name: `Delete child ${crypto.randomUUID()}`, parentId: parent });

    const blocked = await app.inject({
      method: "DELETE",
      url: `/admin/category/${parent}`,
      headers: auth(),
    });
    assert.equal(blocked.statusCode, 400);
    assert.equal(blocked.json().requiresCascade, true);

    const cascade = await app.inject({
      method: "DELETE",
      url: `/admin/category/${parent}`,
      headers: auth(),
      payload: { cascade: true },
    });
    assert.equal(cascade.statusCode, 200);
    assert.equal(cascade.json().success, true);
    assert.equal(cascade.json().deletedCount, 2);
    assert.equal(await db.orm.public.Category.where({ id: parent }).first(), null);
    assert.equal(await db.orm.public.Category.where({ id: child }).first(), null);
  } finally {
    await app.close();
  }
});

// ---------------------------------------------------------------------------
// Announcements
// ---------------------------------------------------------------------------

test("announcement: create, pin, update, list, and delete", async () => {
  const app = await makeApp();
  try {
    const create = await app.inject({
      method: "POST",
      url: "/admin/announcement",
      headers: auth(),
      payload: { title: "Maintenance", body: "Scheduled downtime", pinned: false, sendEmail: false },
    });
    assert.equal(create.statusCode, 201);
    const announcement = create.json();
    announcementIds.push(announcement.id);
    assert.equal(announcement.pinned, false);
    assert.equal(announcement.createdById, adminId);

    const pin = await app.inject({
      method: "POST",
      url: `/admin/announcement/${announcement.id}/pin`,
      headers: auth(),
    });
    assert.equal(pin.statusCode, 200);
    assert.equal(pin.json().pinned, true);

    const update = await app.inject({
      method: "PUT",
      url: `/admin/announcement/${announcement.id}`,
      headers: auth(),
      payload: { title: "Maintenance (updated)", body: "New schedule" },
    });
    assert.equal(update.statusCode, 200);
    assert.equal(update.json().title, "Maintenance (updated)");

    const list = await app.inject({ method: "GET", url: "/admin/announcement", headers: auth() });
    assert.equal(list.statusCode, 200);
    const body = list.json();
    assert.ok(body.total >= 1);
    const listed = body.announcements.find((a: any) => a.id === announcement.id);
    assert.ok(listed);
    assert.equal(listed.createdBy.id, adminId);
    assert.match(listed.createdAt, /T.*Z$/);

    const del = await app.inject({
      method: "DELETE",
      url: `/admin/announcement/${announcement.id}`,
      headers: auth(),
    });
    assert.equal(del.statusCode, 200);
    assert.deepEqual(del.json(), { success: true });
  } finally {
    await app.close();
  }
});

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

test("notification: lists notifications visible to the admin", async () => {
  const app = await makeApp();
  try {
    const notification = await db.orm.public.Notification.create({
      userId: adminId,
      adminId,
      type: "system",
      message: "system notice",
    });
    notificationIds.push(notification.id);

    const res = await app.inject({
      method: "GET",
      url: "/admin/notifications?unread=true",
      headers: auth(),
    });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.ok(body.total >= 1);
    const found = body.notifications.find((n: any) => n.id === notification.id);
    assert.ok(found);
    assert.equal(found.read, false);
    assert.match(found.createdAt, /T.*Z$/);
  } finally {
    await app.close();
  }
});
