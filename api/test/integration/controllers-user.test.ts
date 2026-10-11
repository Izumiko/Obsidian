process.env.TZ = "UTC";

import crypto from "node:crypto";
import net from "node:net";
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { db } from "../../src/lib/prisma.js";
import { hashPassword } from "../../src/utils/password.js";
import { makeApp } from "../helpers/app.js";

// Task 13 integration coverage for the `controllers/user/` group. Every handler
// is exercised through the real Fastify app via `app.inject()`, so the converted
// Prisma 8 call sites run against the local PostgreSQL. Prerequisites are seeded
// with the Prisma 8 `db` client; the primary user token is obtained through the
// real `/auth/login` flow.
//
// `process.env.TZ` is pinned to UTC above so the timestamp columns decode
// deterministically. Several handlers (request fill, and the notification that
// accompanies it) send email, so a minimal SMTP sink is started below.

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

const userIds: string[] = [];
const categoryIds: string[] = [];
const sourceIds: string[] = [];
const torrentIds: string[] = [];
const requestIds: string[] = [];
const announcementIds: string[] = [];
const wikiIds: string[] = [];
const inviteIds: string[] = [];

let mainId = "";
let mainUsername = "";
let mainToken = "";

type TestUser = {
  id: string;
  email: string;
  username: string;
  passkey: string;
  password: string;
  role: string;
};

async function makeUser(
  role = "USER",
  overrides: { publicProfile?: boolean; password?: string; rssToken?: string } = {},
): Promise<TestUser> {
  const id = crypto.randomUUID();
  const email = `user-${id}@example.com`;
  const username = `user_${id.replace(/-/g, "")}`;
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
    publicProfile: overrides.publicProfile ?? false,
    rssToken: overrides.rssToken ?? null,
  });
  userIds.push(id);
  return { id, email, username, passkey, password, role };
}

async function makeCategory(
  fields: { name?: string; parentId?: string | null; order?: number } = {},
): Promise<string> {
  const id = crypto.randomUUID();
  await db.orm.public.Category.create({
    id,
    name: fields.name ?? `user-cat-${id}`,
    parentId: fields.parentId ?? null,
    order: fields.order ?? null,
    inheritSources: true,
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

async function makeTorrent(
  uploaderId: string,
  fields: {
    categoryId?: string;
    name?: string;
    tags?: string[];
    isApproved?: boolean;
    isAnonymous?: boolean;
    size?: bigint;
  } = {},
): Promise<{ id: string; name: string; infoHash: string; categoryId: string }> {
  const categoryId = fields.categoryId ?? (await makeCategory());
  const id = crypto.randomUUID();
  const name = fields.name ?? `user torrent ${id}`;
  const infoHash = `user-hash-${id}`;
  await db.orm.public.Torrent.create({
    id,
    infoHash,
    name,
    uploaderId,
    filePath: "/tmp/user.torrent",
    size: fields.size ?? 1024n,
    categoryId,
    isApproved: fields.isApproved ?? true,
    isAnonymous: fields.isAnonymous ?? false,
    tags: fields.tags ?? [],
  });
  torrentIds.push(id);
  return { id, name, infoHash, categoryId };
}

async function makeRequest(
  userId: string,
  fields: { title?: string; categoryId?: string } = {},
): Promise<string> {
  const id = crypto.randomUUID();
  await db.orm.public.Request.create({
    id,
    userId,
    title: fields.title ?? `user request ${id}`,
    categoryId: fields.categoryId ?? null,
  });
  requestIds.push(id);
  return id;
}

async function makeAnnouncement(
  createdById: string,
  fields: { title?: string; body?: string; visible?: boolean; pinned?: boolean } = {},
): Promise<string> {
  const id = crypto.randomUUID();
  await db.orm.public.Announcement.create({
    id,
    title: fields.title ?? `announcement ${id}`,
    body: fields.body ?? "body",
    createdById,
    visible: fields.visible ?? true,
    pinned: fields.pinned ?? false,
  });
  announcementIds.push(id);
  return id;
}

async function makeWiki(
  createdById: string,
  fields: { slug?: string; visible?: boolean } = {},
): Promise<{ id: string; slug: string }> {
  const id = crypto.randomUUID();
  const slug = fields.slug ?? `user-wiki-${id}`;
  await db.orm.public.WikiPage.create({
    id,
    slug,
    title: `wiki ${id}`,
    content: "hello wiki",
    createdById,
    updatedById: createdById,
    visible: fields.visible ?? true,
  });
  wikiIds.push(id);
  return { id, slug };
}

async function setConfig(fields: Record<string, unknown> = {}): Promise<void> {
  await db.orm.public.Config.where({ id: 1 }).deleteAll();
  await db.orm.public.Config.create({
    id: 1,
    registrationMode: "OPEN",
    smtpHost: "127.0.0.1",
    smtpPort: smtpAddress.port,
    smtpFrom: "noreply@test.local",
    rssDefaultCount: 20,
    ...fields,
  } as any);
}

function auth(): { authorization: string } {
  return { authorization: `Bearer ${mainToken}` };
}

before(async () => {
  await setConfig();
  const main = await makeUser();
  mainId = main.id;
  mainUsername = main.username;

  const app = await makeApp();
  try {
    const res = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: main.email, password: main.password },
    });
    assert.equal(res.statusCode, 200);
    mainToken = res.json().token;
    assert.ok(mainToken);
  } finally {
    await app.close();
  }
});

after(async () => {
  await new Promise<void>((resolve) => smtpSink.close(() => resolve()));

  for (const id of userIds) {
    await db.orm.public.CommentVote.where({ userId: id }).deleteAll();
    await db.orm.public.Comment.where({ userId: id }).deleteAll();
    await db.orm.public.Bookmark.where({ userId: id }).deleteAll();
    await db.orm.public.UserActivity.where({ userId: id }).deleteAll();
    await db.orm.public.Notification.where({ userId: id }).deleteAll();
    await db.orm.public.DownloadToken.where({ userId: id }).deleteAll();
    await db.orm.public.Invite.where({ createdById: id }).deleteAll();
  }
  for (const id of requestIds) {
    await db.orm.public.Comment.where({ requestId: id }).deleteAll();
    await db.orm.public.Request.where({ id }).deleteAll();
  }
  for (const id of announcementIds) {
    await db.orm.public.Announcement.where({ id }).deleteAll();
  }
  for (const id of wikiIds) {
    await db.orm.public.WikiPage.where({ id }).deleteAll();
  }
  for (const id of torrentIds) {
    await db.orm.public.Announce.where({ torrentId: id }).deleteAll();
    await db.orm.public.Bookmark.where({ torrentId: id }).deleteAll();
    await db.orm.public.DownloadToken.where({ torrentId: id }).deleteAll();
    await db.orm.public.HitAndRun.where({ torrentId: id }).deleteAll();
    await db.orm.public.Comment.where({ torrentId: id }).deleteAll();
    await db.orm.public.TorrentVote.where({ torrentId: id }).deleteAll();
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
  for (const id of userIds) {
    await db.orm.public.User.where({ id }).deleteAll();
  }
  await db.orm.public.Config.where({ id: 1 }).deleteAll();
});

// ---------------------------------------------------------------------------
// Announcements
// ---------------------------------------------------------------------------

test("announcements: lists visible, hides hidden, and fetches by id", async () => {
  const app = await makeApp();
  try {
    const pinned = await makeAnnouncement(mainId, { title: "Pinned notice", pinned: true });
    const visible = await makeAnnouncement(mainId, { title: "Visible notice" });
    const hidden = await makeAnnouncement(mainId, { title: "Secret notice", visible: false });

    const list = await app.inject({ method: "GET", url: "/announcements?limit=100" });
    assert.equal(list.statusCode, 200);
    const body = list.json();
    assert.ok(body.total >= 1);
    assert.ok(body.announcements.some((a: any) => a.id === pinned));
    const found = body.announcements.find((a: any) => a.id === visible);
    assert.ok(found);
    assert.equal(found.createdBy.id, mainId);
    assert.equal(typeof found.createdBy.username, "string");
    assert.match(found.createdAt, /T.*Z$/);
    assert.equal(body.announcements.some((a: any) => a.id === hidden), false);
    // A pinned announcement always sorts ahead of a non-pinned one.
    assert.ok(
      body.announcements.findIndex((a: any) => a.id === pinned) <
        body.announcements.findIndex((a: any) => a.id === visible),
    );

    const one = await app.inject({ method: "GET", url: `/announcements/${visible}` });
    assert.equal(one.statusCode, 200);
    assert.equal(one.json().id, visible);

    const gone = await app.inject({ method: "GET", url: `/announcements/${hidden}` });
    assert.equal(gone.statusCode, 404);
  } finally {
    await app.close();
  }
});

// ---------------------------------------------------------------------------
// Bookmarks
// ---------------------------------------------------------------------------

test("bookmarks: add, list, update the note, and remove", async () => {
  const app = await makeApp();
  try {
    const torrent = await makeTorrent(mainId);

    const add = await app.inject({
      method: "POST",
      url: "/bookmarks",
      headers: auth(),
      payload: { torrentId: torrent.id, note: "first note" },
    });
    assert.equal(add.statusCode, 201);
    assert.equal(add.json().torrentId, torrent.id);
    assert.equal(add.json().note, "first note");
    assert.match(add.json().createdAt, /T.*Z$/);

    const list = await app.inject({ method: "GET", url: "/bookmarks", headers: auth() });
    assert.equal(list.statusCode, 200);
    const body = list.json();
    assert.equal(body.total, 1);
    assert.equal(body.bookmarks[0].id, torrent.id);
    assert.equal(body.bookmarks[0].note, "first note");
    assert.equal(typeof body.bookmarks[0].size, "string");
    assert.match(body.bookmarks[0].createdAt, /T.*Z$/);

    // A fresh bookmark should record an activity.
    const activity = await db.orm.public.UserActivity
      .where({ userId: mainId, entityId: torrent.id, type: "bookmark_added" })
      .first();
    assert.ok(activity);

    const update = await app.inject({
      method: "PUT",
      url: `/bookmarks/${torrent.id}`,
      headers: auth(),
      payload: { note: "updated note" },
    });
    assert.equal(update.statusCode, 200);
    const afterUpdate = await app.inject({ method: "GET", url: "/bookmarks", headers: auth() });
    assert.equal(afterUpdate.json().bookmarks[0].note, "updated note");

    const remove = await app.inject({
      method: "DELETE",
      url: `/bookmarks/${torrent.id}`,
      headers: auth(),
    });
    assert.equal(remove.statusCode, 200);
    const afterRemove = await app.inject({ method: "GET", url: "/bookmarks", headers: auth() });
    assert.equal(afterRemove.json().total, 0);
  } finally {
    await app.close();
  }
});

test("bookmarks: reject bookmarking an unapproved torrent for a non-uploader", async () => {
  const app = await makeApp();
  try {
    const uploader = await makeUser();
    const torrent = await makeTorrent(uploader.id, { isApproved: false });

    const res = await app.inject({
      method: "POST",
      url: "/bookmarks",
      headers: auth(),
      payload: { torrentId: torrent.id },
    });
    assert.equal(res.statusCode, 403);
    assert.deepEqual(res.json(), { error: "Forbidden" });
  } finally {
    await app.close();
  }
});

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

test("categories: lists the tree, torrents by title, and public sources", async () => {
  const app = await makeApp();
  try {
    const parentName = `parent-${crypto.randomUUID()}`;
    const parent = await makeCategory({ name: parentName, order: 0 });
    const child = await makeCategory({ name: `child-${crypto.randomUUID()}`, parentId: parent, order: 0 });
    const torrent = await makeTorrent(mainId, { categoryId: child });
    const source = await makeSource(`Source-${crypto.randomUUID()}`);
    await db.orm.public.CategorySource.create({
      categoryId: parent,
      sourceId: source,
      isInherited: false,
      order: 0,
    });

    const tree = await app.inject({ method: "GET", url: "/categories" });
    assert.equal(tree.statusCode, 200);
    const parentNode = tree.json().find((c: any) => c.id === parent);
    assert.ok(parentNode);
    assert.ok(parentNode.children.some((c: any) => c.id === child));

    const byTitle = await app.inject({
      method: "GET",
      url: `/category/${encodeURIComponent(parentName)}/torrents`,
    });
    assert.equal(byTitle.statusCode, 200);

    const childTree = await app.inject({ method: "GET", url: "/categories" });
    const childNode = childTree.json().find((c: any) => c.id === parent);
    assert.equal(childNode.children[0].id, child);

    // Public sources: parent exposes its own, child inherits the parent's.
    const parentSources = await app.inject({ method: "GET", url: `/category/${parent}/sources` });
    assert.equal(parentSources.statusCode, 200);
    assert.ok(parentSources.json().own.some((s: any) => s.id === source));
    assert.deepEqual(parentSources.json().inherited, []);

    const childSources = await app.inject({ method: "GET", url: `/category/${child}/sources` });
    assert.equal(childSources.statusCode, 200);
    assert.ok(childSources.json().inherited.some((s: any) => s.id === source));

    const missing = await app.inject({
      method: "GET",
      url: `/category/${crypto.randomUUID()}/sources`,
    });
    assert.equal(missing.statusCode, 404);

    assert.ok(torrent.id);
  } finally {
    await app.close();
  }
});

// ---------------------------------------------------------------------------
// Invites
// ---------------------------------------------------------------------------

test("invites: create requires INVITE mode, lookup by code, and cancel", async () => {
  const app = await makeApp();
  try {
    // OPEN mode disables invitations.
    await setConfig({ registrationMode: "OPEN" });
    const blocked = await app.inject({ method: "POST", url: "/user/invites", headers: auth() });
    assert.equal(blocked.statusCode, 403);

    await setConfig({ registrationMode: "INVITE" });
    const created = await app.inject({ method: "POST", url: "/user/invites", headers: auth() });
    assert.equal(created.statusCode, 200);
    const { invite, inviteLink } = created.json();
    inviteIds.push(invite.id);
    assert.equal(invite.createdById, mainId);
    assert.match(inviteLink, new RegExp(`/auth/signup/${invite.code}$`));

    const listing = await app.inject({ method: "GET", url: "/user/invites", headers: auth() });
    assert.equal(listing.statusCode, 200);
    const listBody = listing.json();
    assert.equal(listBody.registrationMode, "INVITE");
    assert.ok(listBody.invites.some((i: any) => i.id === invite.id));
    assert.equal(typeof listBody.availableInvites, "number");
    assert.match(listBody.invites[0].createdAt, /T.*Z$/);

    const publicLookup = await app.inject({ method: "GET", url: `/invite/${invite.code}` });
    assert.equal(publicLookup.statusCode, 200);
    assert.equal(publicLookup.json().valid, true);
    assert.equal(publicLookup.json().createdBy.id, mainId);
    assert.equal(publicLookup.json().usedById, null);

    const cancel = await app.inject({
      method: "DELETE",
      url: `/user/invites?id=${invite.id}`,
      headers: auth(),
    });
    assert.equal(cancel.statusCode, 200);
    assert.deepEqual(cancel.json(), { success: true });

    const gone = await app.inject({ method: "GET", url: `/invite/${invite.code}` });
    assert.equal(gone.statusCode, 404);
    assert.equal(gone.json().valid, false);
  } finally {
    await app.close();
  }
});

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

test("notifications: list, mark one, mark all, and clear", async () => {
  const app = await makeApp();
  try {
    const first = await db.orm.public.Notification.create({
      userId: mainId,
      type: "system",
      message: "first notice",
    });
    const second = await db.orm.public.Notification.create({
      userId: mainId,
      type: "system",
      message: "second notice",
    });

    const list = await app.inject({
      method: "GET",
      url: "/notifications?unread=true&limit=50",
      headers: auth(),
    });
    assert.equal(list.statusCode, 200);
    const body = list.json();
    assert.ok(body.total >= 2);
    const found = body.notifications.find((n: any) => n.id === first.id);
    assert.ok(found);
    assert.equal(found.read, false);
    assert.match(found.createdAt, /T.*Z$/);

    const one = await app.inject({
      method: "POST",
      url: `/notifications/${first.id}/read`,
      headers: auth(),
    });
    assert.equal(one.statusCode, 200);
    const firstRow = await db.orm.public.Notification.where({ id: first.id }).first();
    assert.equal(firstRow?.read, true);

    const all = await app.inject({
      method: "POST",
      url: "/notifications/read-all",
      headers: auth(),
    });
    assert.equal(all.statusCode, 200);
    const secondRow = await db.orm.public.Notification.where({ id: second.id }).first();
    assert.equal(secondRow?.read, true);

    const clear = await app.inject({
      method: "DELETE",
      url: "/notifications/clear",
      headers: auth(),
    });
    assert.equal(clear.statusCode, 200);
    const remaining = await db.orm.public.Notification.where({ userId: mainId }).all();
    assert.equal(remaining.length, 0);
  } finally {
    await app.close();
  }
});

// ---------------------------------------------------------------------------
// Preferences and public profile
// ---------------------------------------------------------------------------

test("preferences: get, update, and public profile access", async () => {
  const app = await makeApp();
  try {
    const initial = await app.inject({
      method: "GET",
      url: "/user/preferences",
      headers: auth(),
    });
    assert.equal(initial.statusCode, 200);
    assert.equal(typeof initial.json().allowEmailNotifications, "boolean");

    const update = await app.inject({
      method: "PUT",
      url: "/user/preferences",
      headers: auth(),
      payload: { preferredLanguage: "en", allowEmailNotifications: false, publicProfile: true },
    });
    assert.equal(update.statusCode, 200);
    assert.deepEqual(update.json(), {
      preferredLanguage: "en",
      allowEmailNotifications: false,
      publicProfile: true,
    });

    const profile = await app.inject({ method: "GET", url: `/user/${mainUsername}` });
    assert.equal(profile.statusCode, 200);
    const profileBody = profile.json();
    assert.equal(profileBody.id, mainId);
    assert.equal(typeof profileBody.upload, "string");
    assert.equal(typeof profileBody.download, "string");
    assert.equal(typeof profileBody.ratio, "string");
    assert.ok(Array.isArray(profileBody.publicTorrents));

    // A private profile is not exposed.
    const privateUser = await makeUser();
    const privateProfile = await app.inject({ method: "GET", url: `/user/${privateUser.username}` });
    assert.equal(privateProfile.statusCode, 403);

    const missing = await app.inject({
      method: "GET",
      url: `/user/missing-${crypto.randomUUID()}`,
    });
    assert.equal(missing.statusCode, 404);
  } finally {
    await app.close();
  }
});

// ---------------------------------------------------------------------------
// Requests and request comments
// ---------------------------------------------------------------------------

test("requests: create, list, get, fill with notification, and comment", async () => {
  const app = await makeApp();
  try {
    const unique = crypto.randomUUID();
    const create = await app.inject({
      method: "POST",
      url: "/requests",
      headers: auth(),
      payload: { title: `Need ${unique}`, description: "please" },
    });
    assert.equal(create.statusCode, 201);
    const requestId = create.json().id;
    requestIds.push(requestId);
    assert.equal(create.json().userId, mainId);
    assert.equal(create.json().status, "OPEN");

    const list = await app.inject({
      method: "GET",
      url: `/requests?q=${encodeURIComponent(unique)}`,
    });
    assert.equal(list.statusCode, 200);
    const listBody = list.json();
    assert.ok(listBody.total >= 1);
    const listed = listBody.requests.find((r: any) => r.id === requestId);
    assert.ok(listed);
    assert.equal(listed.user.id, mainId);
    assert.match(listed.createdAt, /T.*Z$/);

    const one = await app.inject({ method: "GET", url: `/requests/${requestId}` });
    assert.equal(one.statusCode, 200);
    assert.equal(one.json().id, requestId);

    const torrent = await makeTorrent(mainId);
    const fill = await app.inject({
      method: "POST",
      url: `/requests/${requestId}/fill`,
      headers: auth(),
      payload: { torrentId: torrent.id },
    });
    assert.equal(fill.statusCode, 200);
    assert.equal(fill.json().status, "FILLED");
    assert.equal(fill.json().filledById, mainId);
    assert.equal(fill.json().notificationSent, true);

    const notification = await db.orm.public.Notification
      .where({ userId: mainId, type: "request_filled" })
      .first();
    assert.ok(notification);

    // A request can no longer be filled once it is not open.
    const refill = await app.inject({
      method: "POST",
      url: `/requests/${requestId}/fill`,
      headers: auth(),
      payload: { torrentId: torrent.id },
    });
    assert.equal(refill.statusCode, 400);

    // Comments on the request.
    const comment = await app.inject({
      method: "POST",
      url: `/requests/${requestId}/comments`,
      headers: auth(),
      payload: { content: "root comment" },
    });
    assert.equal(comment.statusCode, 201);
    const commentId = comment.json().id;
    assert.equal(comment.json().user.id, mainId);

    const reply = await app.inject({
      method: "POST",
      url: `/requests/${requestId}/comments`,
      headers: auth(),
      payload: { content: "reply", parentId: commentId },
    });
    assert.equal(reply.statusCode, 201);

    const comments = await app.inject({ method: "GET", url: `/requests/${requestId}/comments` });
    assert.equal(comments.statusCode, 200);
    const threaded = comments.json();
    assert.equal(threaded.length, 1);
    assert.equal(threaded[0].id, commentId);
    assert.equal(threaded[0].replies.length, 1);
    assert.equal(threaded[0].replies[0].content, "reply");
    assert.equal(threaded[0].upvotes, 0);
    assert.equal(threaded[0].score, 0);
  } finally {
    await app.close();
  }
});

// ---------------------------------------------------------------------------
// Tags and text search
// ---------------------------------------------------------------------------

test("tags: popular list, search by tag, and search by text", async () => {
  const app = await makeApp();
  try {
    const tag = `tag-${crypto.randomUUID().replace(/-/g, "")}`;
    const first = await makeTorrent(mainId, { tags: [tag, "shared"], name: `Alpha ${tag}` });
    const second = await makeTorrent(mainId, { tags: [tag], name: `Beta ${tag}` });

    const popular = await app.inject({ method: "GET", url: "/tags/popular" });
    assert.equal(popular.statusCode, 200);
    const entry = popular.json().find((t: any) => t.name === tag);
    assert.ok(entry);
    assert.ok(entry.count >= 2);

    const byTag = await app.inject({ method: "GET", url: `/tags/${tag}/torrents` });
    assert.equal(byTag.statusCode, 200);
    const byTagBody = byTag.json();
    assert.equal(byTagBody.tag, tag);
    assert.equal(byTagBody.total, 2);
    const ids = byTagBody.torrents.map((t: any) => t.id).sort();
    assert.deepEqual(ids, [first.id, second.id].sort());
    assert.equal(typeof byTagBody.torrents[0].size, "string");
    assert.equal(typeof byTagBody.torrents[0].seeders, "number");

    const byText = await app.inject({
      method: "GET",
      url: `/search?q=${encodeURIComponent(`Alpha ${tag}`)}`,
    });
    assert.equal(byText.statusCode, 200);
    const byTextBody = byText.json();
    assert.ok(byTextBody.torrents.some((t: any) => t.id === first.id));

    const missing = await app.inject({ method: "GET", url: "/search?q=" });
    assert.equal(missing.statusCode, 400);
  } finally {
    await app.close();
  }
});

// ---------------------------------------------------------------------------
// User torrents and management
// ---------------------------------------------------------------------------

test("user torrents: list, update flags, and delete", async () => {
  const app = await makeApp();
  try {
    const torrent = await makeTorrent(mainId, { size: 4096n });

    const list = await app.inject({ method: "GET", url: "/user/torrents", headers: auth() });
    assert.equal(list.statusCode, 200);
    const body = list.json();
    assert.ok(body.total >= 1);
    const listed = body.torrents.find((t: any) => t.id === torrent.id);
    assert.ok(listed);
    assert.equal(listed.status, "approved");
    assert.equal(listed.size, "4096");
    assert.equal(typeof listed.downloads, "number");
    assert.equal(typeof listed.seeders, "number");
    assert.match(listed.createdAt, /T.*Z$/);

    const update = await app.inject({
      method: "PUT",
      url: `/user/torrents/${torrent.id}`,
      headers: auth(),
      payload: { isAnonymous: true, freeleech: true },
    });
    assert.equal(update.statusCode, 200);
    assert.equal(update.json().success, true);
    assert.equal(update.json().torrent.isAnonymous, true);
    assert.equal(update.json().torrent.freeleech, true);
    const row = await db.orm.public.Torrent.where({ id: torrent.id }).first();
    assert.equal(row?.isAnonymous, true);
    assert.equal(row?.freeleech, true);

    // A torrent owned by someone else is not manageable.
    const other = await makeTorrent((await makeUser()).id);
    const forbidden = await app.inject({
      method: "PUT",
      url: `/user/torrents/${other.id}`,
      headers: auth(),
      payload: { freeleech: true },
    });
    assert.equal(forbidden.statusCode, 404);

    const del = await app.inject({
      method: "DELETE",
      url: `/user/torrents/${torrent.id}`,
      headers: auth(),
    });
    assert.equal(del.statusCode, 200);
    assert.equal(del.json().success, true);
    assert.equal(await db.orm.public.Torrent.where({ id: torrent.id }).first(), null);
  } finally {
    await app.close();
  }
});

// ---------------------------------------------------------------------------
// Active torrents and activity
// ---------------------------------------------------------------------------

test("active torrents: separates seeding from leeching", async () => {
  const app = await makeApp();
  try {
    const seeding = await makeTorrent(mainId);
    const leeching = await makeTorrent(mainId);
    await db.orm.public.Announce.create({
      id: crypto.randomUUID(),
      torrentId: seeding.id,
      userId: mainId,
      peerId: `peer-seed-${crypto.randomUUID()}`,
      ip: "10.1.0.1",
      port: 6881,
      uploaded: 0n,
      downloaded: 0n,
      left: 0n,
      event: "started",
    });
    await db.orm.public.Announce.create({
      id: crypto.randomUUID(),
      torrentId: leeching.id,
      userId: mainId,
      peerId: `peer-leech-${crypto.randomUUID()}`,
      ip: "10.1.0.2",
      port: 6882,
      uploaded: 0n,
      downloaded: 0n,
      left: 500n,
      event: "started",
    });

    const res = await app.inject({ method: "GET", url: "/user/active-torrents", headers: auth() });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.ok(body.seeding.some((t: any) => t.id === seeding.id));
    assert.ok(body.leeching.some((t: any) => t.id === leeching.id));
    assert.equal(body.seeding.some((t: any) => t.id === leeching.id), false);
    const seedRow = body.seeding.find((t: any) => t.id === seeding.id);
    assert.equal(typeof seedRow.size, "number");
    assert.match(seedRow.createdAt, /T.*Z$/);
  } finally {
    await app.close();
  }
});

test("activities: lists user activity with a type filter", async () => {
  const app = await makeApp();
  try {
    await db.orm.public.UserActivity.create({
      userId: mainId,
      type: "torrent_uploaded",
      entityType: "torrent",
      entityId: crypto.randomUUID(),
      title: "activities.torrent_uploaded.title",
      subtitle: "activities.torrent_uploaded.subtitle",
    });

    const all = await app.inject({ method: "GET", url: "/user/activities", headers: auth() });
    assert.equal(all.statusCode, 200);
    const allBody = all.json();
    assert.ok(allBody.total >= 1);
    assert.equal(allBody.totalPages, Math.ceil(allBody.total / allBody.limit));
    assert.match(allBody.activities[0].createdAt, /T.*Z$/);

    const filtered = await app.inject({
      method: "GET",
      url: "/user/activities?type=torrent_uploaded",
      headers: auth(),
    });
    assert.equal(filtered.statusCode, 200);
    assert.ok(filtered.json().activities.length >= 1);
    assert.ok(
      filtered.json().activities.every((a: any) => a.type === "torrent_uploaded"),
    );
  } finally {
    await app.close();
  }
});

// ---------------------------------------------------------------------------
// RSS
// ---------------------------------------------------------------------------

test("rss: issues a token, regenerates it, and serves a feed", async () => {
  const app = await makeApp();
  try {
    const torrent = await makeTorrent(mainId);

    const tokenRes = await app.inject({ method: "GET", url: "/user/rss-token", headers: auth() });
    assert.equal(tokenRes.statusCode, 200);
    const token = tokenRes.json().rssToken;
    assert.equal(typeof token, "string");
    assert.ok(token.length > 0);

    const feed = await app.inject({ method: "GET", url: `/rss/${token}` });
    assert.equal(feed.statusCode, 200);
    assert.match(feed.headers["content-type"] as string, /application\/rss\+xml/);
    assert.match(feed.body, new RegExp(torrent.name));
    assert.match(feed.body, /download-secure\?token=/);
    // A download token row is created for the feed entry.
    const downloadToken = await db.orm.public.DownloadToken.where({ userId: mainId }).first();
    assert.ok(downloadToken);

    const regenerate = await app.inject({
      method: "POST",
      url: "/user/rss-token",
      headers: auth(),
    });
    assert.equal(regenerate.statusCode, 200);
    assert.notEqual(regenerate.json().rssToken, token);

    const stale = await app.inject({ method: "GET", url: `/rss/${token}` });
    assert.equal(stale.statusCode, 401);
  } finally {
    await app.close();
  }
});

// ---------------------------------------------------------------------------
// Wiki
// ---------------------------------------------------------------------------

test("wiki: lists visible pages and fetches by slug", async () => {
  const app = await makeApp();
  try {
    const page = await makeWiki(mainId, { slug: `user-wiki-${crypto.randomUUID()}` });
    const hidden = await makeWiki(mainId, {
      slug: `user-hidden-${crypto.randomUUID()}`,
      visible: false,
    });

    const list = await app.inject({ method: "GET", url: "/wiki?limit=100" });
    assert.equal(list.statusCode, 200);
    const body = list.json();
    assert.ok(body.pages.some((p: any) => p.id === page.id));
    assert.equal(body.pages.some((p: any) => p.id === hidden.id), false);
    const listed = body.pages.find((p: any) => p.id === page.id);
    assert.equal(listed.createdBy.id, mainId);
    assert.match(listed.createdAt, /T.*Z$/);

    const one = await app.inject({ method: "GET", url: `/wiki/${page.slug}` });
    assert.equal(one.statusCode, 200);
    assert.equal(one.json().id, page.id);

    const gone = await app.inject({ method: "GET", url: `/wiki/${hidden.slug}` });
    assert.equal(gone.statusCode, 404);

    // Search finds the page by title/content.
    const search = await app.inject({ method: "GET", url: "/wiki?q=hello" });
    assert.equal(search.statusCode, 200);
    assert.ok(search.json().pages.some((p: any) => p.id === page.id));
  } finally {
    await app.close();
  }
});
