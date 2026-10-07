process.env.TZ = "UTC";

import crypto from "node:crypto";
import { after, test } from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import bencode from "bencode";
import { db } from "../../src/lib/prisma.js";
import { toTimestamp } from "../../src/lib/timestamps.js";
import { makeApp } from "../helpers/app.js";

// Task 11a integration coverage for the core controllers
// (`announceController`, `authController`, `commentController`). The routes are
// exercised through the real Fastify app via `app.inject()`, so the converted
// Prisma 8 call sites run against the local PostgreSQL. Prerequisites are
// seeded with the Prisma 8 `db` client.
//
// `process.env.TZ` is pinned to UTC above, matching the server, so the
// timestamp columns decode deterministically.

const JWT_SECRET = process.env.JWT_SECRET || "changeme-in-production";

const userIds: string[] = [];
const torrentIds: string[] = [];
const categoryIds: string[] = [];

async function makeUser(
  overrides: { status?: string; emailVerified?: boolean } = {},
): Promise<{ id: string; email: string; username: string; passkey: string }> {
  const id = crypto.randomUUID();
  const email = `cc-${id}@example.com`;
  const username = `cc_${id.replace(/-/g, "")}`;
  const passkey = crypto.randomUUID().replace(/-/g, "");
  await db.orm.public.User.create({
    id,
    email,
    username,
    passwordHash: "not-a-real-hash",
    passkey,
    status: (overrides.status ?? "ACTIVE") as any,
    emailVerified: overrides.emailVerified ?? false,
  });
  userIds.push(id);
  return { id, email, username, passkey };
}

async function makeTorrent(
  uploaderId: string,
  fields: { infoHash?: string; isApproved?: boolean } = {},
): Promise<{ id: string; infoHash: string; name: string }> {
  const categoryId = crypto.randomUUID();
  await db.orm.public.Category.create({
    id: categoryId,
    name: `cc-cat-${categoryId}`,
  });
  categoryIds.push(categoryId);

  const id = crypto.randomUUID();
  const infoHash = fields.infoHash ?? crypto.randomBytes(20).toString("hex");
  const name = `cc torrent ${id}`;
  await db.orm.public.Torrent.create({
    id,
    infoHash,
    name,
    uploaderId,
    filePath: "/tmp/cc.torrent",
    size: 1000n,
    categoryId,
    isApproved: fields.isApproved ?? true,
  });
  torrentIds.push(id);
  return { id, infoHash, name };
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
      role: user.role ?? "USER",
      passkey: user.passkey,
      emailVerified: false,
    },
    JWT_SECRET,
    { expiresIn: "1h" },
  );
}

async function resetConfig(fields: Record<string, unknown> = {}): Promise<void> {
  await db.orm.public.Config.where({ id: 1 }).deleteAll();
  await db.orm.public.Config.create({ id: 1, ...fields } as any);
}

// bencode decodes byte strings as Uint8Array; render them as UTF-8 text.
function bstr(value: unknown): string {
  return Buffer.from(value as Uint8Array).toString("utf8");
}

after(async () => {
  // Votes reference comments with onDelete: Restrict, so clear every vote
  // before deleting any comment (a comment can be voted by another user).
  for (const id of userIds) {
    await db.orm.public.CommentVote.where({ userId: id }).deleteAll();
  }
  for (const id of userIds) {
    await db.orm.public.Comment.where({ userId: id }).deleteAll();
    await db.orm.public.Announce.where({ userId: id }).deleteAll();
    await db.orm.public.HitAndRun.where({ userId: id }).deleteAll();
    await db.orm.public.AnnounceRateLimit.where({ userId: id }).deleteAll();
    await db.orm.public.EmailVerificationToken.where({ userId: id }).deleteAll();
    await db.orm.public.PasswordResetToken.where({ userId: id }).deleteAll();
    await db.orm.public.PeerBan.where({ bannedById: id }).deleteAll();
    await db.orm.public.PeerBan.where({ userId: id }).deleteAll();
    await db.orm.public.Notification.where({ userId: id }).deleteAll();
  }
  for (const id of torrentIds) {
    await db.orm.public.Comment.where({ torrentId: id }).deleteAll();
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
  await db.orm.public.Config.where({ id: 1 }).deleteAll();
});

// ---------------------------------------------------------------------------
// authController
// ---------------------------------------------------------------------------

test("auth: register then login returns a usable token", async () => {
  const app = await makeApp();
  try {
    await resetConfig({ registrationMode: "OPEN" });
    const email = `cc-reg-${crypto.randomUUID()}@example.com`;
    const username = `cc_reg_${crypto.randomUUID().replace(/-/g, "")}`;
    const password = "correct-horse-battery-staple";

    const reg = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { email, username, password },
    });
    assert.equal(reg.statusCode, 201);
    const regBody = reg.json();
    userIds.push(regBody.id);
    assert.equal(regBody.email, email);
    assert.equal(regBody.username, username);
    assert.equal(typeof regBody.passkey, "string");
    assert.ok(regBody.passkey.length > 0);

    const login = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email, password },
    });
    assert.equal(login.statusCode, 200);
    const loginBody = login.json();
    assert.ok(loginBody.token);

    const profile = await app.inject({
      method: "GET",
      url: "/auth/profile",
      headers: { authorization: `Bearer ${loginBody.token}` },
    });
    assert.equal(profile.statusCode, 200);
    const me = profile.json();
    assert.equal(me.id, regBody.id);
    assert.equal(me.email, email);
    assert.equal(me.username, username);
    assert.equal(typeof me.ratio, "number");
    assert.equal(me.hitAndRunCount, 0);
  } finally {
    await app.close();
  }
});

test("auth: login rejects unknown users", async () => {
  const app = await makeApp();
  try {
    const res = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: `cc-missing-${crypto.randomUUID()}@example.com`, password: "x" },
    });
    assert.equal(res.statusCode, 401);
    assert.deepEqual(res.json(), { error: "Invalid credentials." });
  } finally {
    await app.close();
  }
});

test("auth: verify-email marks the token used and the user verified", async () => {
  const app = await makeApp();
  try {
    const user = await makeUser();
    const token = crypto.randomUUID();
    await db.orm.public.EmailVerificationToken.create({
      userId: user.id,
      token,
      expiresAt: toTimestamp(new Date(Date.now() + 3_600_000).toISOString()),
    });

    const res = await app.inject({
      method: "POST",
      url: "/auth/verify-email",
      payload: { token },
    });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json(), { success: true });

    const tokenRow = await db.orm.public.EmailVerificationToken.where({ token }).first();
    assert.equal(tokenRow?.used, true);
    const userRow = await db.orm.public.User.select("emailVerified").first({ id: user.id });
    assert.equal(userRow?.emailVerified, true);
  } finally {
    await app.close();
  }
});

test("auth: request-password-reset always returns success", async () => {
  const app = await makeApp();
  try {
    const user = await makeUser();

    const res = await app.inject({
      method: "POST",
      url: "/auth/request-password-reset",
      payload: { email: user.email },
    });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json(), { success: true });

    const tokenRow = await db.orm.public.PasswordResetToken.where({ userId: user.id }).first();
    assert.ok(tokenRow);
  } finally {
    await app.close();
  }
});

test("auth: reset-password updates the stored hash", async () => {
  const app = await makeApp();
  try {
    const user = await makeUser();
    const token = crypto.randomUUID();
    await db.orm.public.PasswordResetToken.create({
      userId: user.id,
      token,
      expiresAt: toTimestamp(new Date(Date.now() + 3_600_000).toISOString()),
    });

    const res = await app.inject({
      method: "POST",
      url: "/auth/reset-password",
      payload: { token, password: "brand-new-password" },
    });
    assert.equal(res.statusCode, 200);

    const tokenRow = await db.orm.public.PasswordResetToken.where({ token }).first();
    assert.equal(tokenRow?.used, true);
    const userRow = await db.orm.public.User.select("passwordHash").first({ id: user.id });
    assert.notEqual(userRow?.passwordHash, "not-a-real-hash");
  } finally {
    await app.close();
  }
});

test("auth: rotate-passkey issues a new passkey", async () => {
  const app = await makeApp();
  try {
    const user = await makeUser();

    const res = await app.inject({
      method: "POST",
      url: "/auth/rotate-passkey",
      headers: { authorization: `Bearer ${tokenFor(user)}` },
    });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(typeof body.passkey, "string");
    assert.notEqual(body.passkey, user.passkey);
  } finally {
    await app.close();
  }
});

test("auth: update-profile changes the password", async () => {
  const app = await makeApp();
  try {
    const user = await makeUser();

    const update = await app.inject({
      method: "PATCH",
      url: "/auth/profile",
      headers: { authorization: `Bearer ${tokenFor(user)}` },
      payload: { password: "updated-password-123" },
    });
    assert.equal(update.statusCode, 200);
    assert.equal(update.json().id, user.id);

    const login = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { username: user.username, password: "updated-password-123" },
    });
    assert.equal(login.statusCode, 200);
    assert.ok(login.json().token);
  } finally {
    await app.close();
  }
});

// ---------------------------------------------------------------------------
// commentController
// ---------------------------------------------------------------------------

test("comments: create, reply, and list threaded comments", async () => {
  const app = await makeApp();
  try {
    const uploader = await makeUser();
    const torrent = await makeTorrent(uploader.id);
    const commenter = await makeUser();
    const auth = { authorization: `Bearer ${tokenFor(commenter)}` };

    const create = await app.inject({
      method: "POST",
      url: `/torrent/${torrent.id}/comments`,
      headers: auth,
      payload: { content: "first comment" },
    });
    assert.equal(create.statusCode, 201);
    const created = create.json();
    assert.equal(created.content, "first comment");
    assert.equal(created.user.username, commenter.username);
    assert.equal(created.deleted, false);
    assert.ok(Array.isArray(created.votes));
    assert.equal(created.parentId, null);
    assert.equal(typeof created.createdAt, "string");

    const reply = await app.inject({
      method: "POST",
      url: `/torrent/${torrent.id}/comments`,
      headers: auth,
      payload: { content: "a reply", parentId: created.id },
    });
    assert.equal(reply.statusCode, 201);

    const list = await app.inject({
      method: "GET",
      url: `/torrent/${torrent.id}/comments`,
    });
    assert.equal(list.statusCode, 200);
    const body = list.json();
    assert.equal(body.comments.length, 1);
    assert.equal(body.comments[0].id, created.id);
    assert.equal(body.comments[0].replies.length, 1);
    assert.equal(body.comments[0].replies[0].content, "a reply");
    assert.equal(body.pagination.total, 1);
    assert.equal(body.pagination.page, 1);
  } finally {
    await app.close();
  }
});

test("comments: reject a reply to an unknown parent", async () => {
  const app = await makeApp();
  try {
    const uploader = await makeUser();
    const torrent = await makeTorrent(uploader.id);
    const commenter = await makeUser();

    const res = await app.inject({
      method: "POST",
      url: `/torrent/${torrent.id}/comments`,
      headers: { authorization: `Bearer ${tokenFor(commenter)}` },
      payload: { content: "orphan", parentId: crypto.randomUUID() },
    });
    assert.equal(res.statusCode, 400);
    assert.deepEqual(res.json(), { error: "Invalid parent comment" });
  } finally {
    await app.close();
  }
});

test("comments: voting upserts and is reflected in the list", async () => {
  const app = await makeApp();
  try {
    const uploader = await makeUser();
    const torrent = await makeTorrent(uploader.id);
    const commenter = await makeUser();

    const create = await app.inject({
      method: "POST",
      url: `/torrent/${torrent.id}/comments`,
      headers: { authorization: `Bearer ${tokenFor(commenter)}` },
      payload: { content: "vote me" },
    });
    assert.equal(create.statusCode, 201);
    const commentId = create.json().id;

    const voter = await makeUser();
    const vote = await app.inject({
      method: "POST",
      url: `/comments/${commentId}/vote`,
      headers: { authorization: `Bearer ${tokenFor(voter)}` },
      payload: { value: 1 },
    });
    assert.equal(vote.statusCode, 200);
    assert.deepEqual(vote.json(), { success: true });

    // Switching the vote updates the existing row rather than inserting.
    const reVote = await app.inject({
      method: "POST",
      url: `/comments/${commentId}/vote`,
      headers: { authorization: `Bearer ${tokenFor(voter)}` },
      payload: { value: -1 },
    });
    assert.equal(reVote.statusCode, 200);

    const voteRows = await db.orm.public.CommentVote.where({ commentId }).all();
    assert.equal(voteRows.length, 1);
    assert.equal(voteRows[0]!.value, -1);

    const list = await app.inject({
      method: "GET",
      url: `/torrent/${torrent.id}/comments`,
    });
    assert.equal(list.statusCode, 200);
    assert.equal(list.json().comments[0]._count.downvotes, 1);
    assert.equal(list.json().comments[0].score, -1);
  } finally {
    await app.close();
  }
});

test("comments: edit and soft-delete by the author", async () => {
  const app = await makeApp();
  try {
    const uploader = await makeUser();
    const torrent = await makeTorrent(uploader.id);
    const commenter = await makeUser();
    const auth = { authorization: `Bearer ${tokenFor(commenter)}` };

    const create = await app.inject({
      method: "POST",
      url: `/torrent/${torrent.id}/comments`,
      headers: auth,
      payload: { content: "original" },
    });
    const commentId = create.json().id;

    const edit = await app.inject({
      method: "PUT",
      url: `/comments/${commentId}`,
      headers: auth,
      payload: { content: "edited" },
    });
    assert.equal(edit.statusCode, 200);
    assert.equal(edit.json().content, "edited");

    const del = await app.inject({
      method: "DELETE",
      url: `/comments/${commentId}`,
      headers: auth,
    });
    assert.equal(del.statusCode, 200);
    assert.deepEqual(del.json(), { success: true });

    // Deleting is a soft delete: the row stays but is hidden from the list.
    const row = await db.orm.public.Comment.where({ id: commentId }).first();
    assert.equal(row?.deleted, true);

    const list = await app.inject({
      method: "GET",
      url: `/torrent/${torrent.id}/comments`,
    });
    assert.equal(list.json().comments.length, 0);
  } finally {
    await app.close();
  }
});

test("comments: thread endpoint returns the full subtree", async () => {
  const app = await makeApp();
  try {
    const uploader = await makeUser();
    const torrent = await makeTorrent(uploader.id);
    const commenter = await makeUser();
    const auth = { authorization: `Bearer ${tokenFor(commenter)}` };

    const root = await app.inject({
      method: "POST",
      url: `/torrent/${torrent.id}/comments`,
      headers: auth,
      payload: { content: "root" },
    });
    const rootId = root.json().id;
    await app.inject({
      method: "POST",
      url: `/torrent/${torrent.id}/comments`,
      headers: auth,
      payload: { content: "child", parentId: rootId },
    });

    const res = await app.inject({
      method: "GET",
      url: `/comments/${rootId}/thread`,
    });
    assert.equal(res.statusCode, 200);
    const thread = res.json();
    assert.equal(thread.id, rootId);
    assert.equal(thread.replies.length, 1);
    assert.equal(thread.replies[0].content, "child");
  } finally {
    await app.close();
  }
});

// ---------------------------------------------------------------------------
// announceController
// ---------------------------------------------------------------------------

test("announce: registers a peer for an approved torrent", async () => {
  const app = await makeApp();
  try {
    await resetConfig();
    const user = await makeUser();
    const torrent = await makeTorrent(user.id);
    const peerId = "-UT3000-abcdefghij";

    const res = await app.inject({
      method: "GET",
      url:
        `/announce?passkey=${user.passkey}&info_hash=${torrent.infoHash}` +
        `&peer_id=${peerId}&port=6881&uploaded=0&downloaded=0&left=1000&event=started`,
    });
    assert.equal(res.statusCode, 200);
    const decoded: any = bencode.decode(res.rawPayload);
    assert.equal(Number(decoded.interval), 1800);
    assert.equal(Number(decoded.complete), 0);
    assert.equal(Number(decoded.incomplete), 1);

    const announce = await db.orm.public.Announce.where({ torrentId: torrent.id }).first();
    assert.ok(announce);
    assert.equal(announce.peerId, peerId);
    assert.equal(announce.port, 6881);
    assert.equal(announce.left, 1000n);
  } finally {
    await app.close();
  }
});

test("announce: rejects an invalid passkey", async () => {
  const app = await makeApp();
  try {
    await resetConfig();
    const torrent = await makeTorrent((await makeUser()).id);

    const res = await app.inject({
      method: "GET",
      url:
        `/announce?passkey=${crypto.randomUUID().replace(/-/g, "")}&info_hash=${torrent.infoHash}` +
        `&peer_id=-UT3000-abcdefghij&port=6881&uploaded=0&downloaded=0&left=0&event=started`,
    });
    assert.equal(res.statusCode, 200);
    const decoded: any = bencode.decode(res.rawPayload);
    assert.match(bstr(decoded["failure reason"]), /Invalid or banned user/);
  } finally {
    await app.close();
  }
});

test("announce: rejects a torrent that is not approved", async () => {
  const app = await makeApp();
  try {
    await resetConfig();
    const user = await makeUser();
    const torrent = await makeTorrent(user.id, { isApproved: false });

    const res = await app.inject({
      method: "GET",
      url:
        `/announce?passkey=${user.passkey}&info_hash=${torrent.infoHash}` +
        `&peer_id=-UT3000-abcdefghij&port=6881&uploaded=0&downloaded=0&left=0&event=started`,
    });
    assert.equal(res.statusCode, 200);
    const decoded: any = bencode.decode(res.rawPayload);
    assert.match(
      bstr(decoded["failure reason"]),
      /Torrent not found or not approved/,
    );
  } finally {
    await app.close();
  }
});

test("scrape: reports counts for an approved torrent", async () => {
  const app = await makeApp();
  try {
    await resetConfig();
    const user = await makeUser();
    const torrent = await makeTorrent(user.id);

    const res = await app.inject({
      method: "GET",
      url: `/scrape?info_hash=${torrent.infoHash}`,
    });
    assert.equal(res.statusCode, 200);
    const decoded: any = bencode.decode(res.rawPayload);
    assert.equal(Number(decoded.files[torrent.infoHash].complete), 0);
    assert.equal(Number(decoded.files[torrent.infoHash].incomplete), 0);
    assert.equal(Number(decoded.files[torrent.infoHash].downloaded), 0);
  } finally {
    await app.close();
  }
});
