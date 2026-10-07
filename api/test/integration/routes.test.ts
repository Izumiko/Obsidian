process.env.TZ = "UTC";

import crypto from "node:crypto";
import { after, test } from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import { db, prisma } from "../../src/lib/prisma.js";
import { makeApp } from "../helpers/app.js";

// Task 10 integration coverage for the `routes/` group (`files.ts`,
// `torrent.ts`, `stats.ts`). The routes are exercised through the real Fastify
// app via `app.inject()`, so the converted Prisma 8 call sites run against the
// local PostgreSQL. Prerequisites are seeded with the Prisma 8 `db` client; the
// `/stats` expectations are computed with the still-present Prisma 7 `prisma`
// client, which makes the assertions an independent oracle rather than a copy
// of the code under test.
//
// `process.env.TZ` is pinned to UTC above, matching the server, so the
// timestamp columns decode deterministically.

const JWT_SECRET = process.env.JWT_SECRET || "changeme-in-production";

const userIds: string[] = [];
const torrentIds: string[] = [];
const categoryIds: string[] = [];
const fileIds: string[] = [];

async function makeUser(): Promise<{ id: string; passkey: string }> {
  const id = crypto.randomUUID();
  const passkey = crypto.randomUUID();
  await db.orm.public.User.create({
    id,
    email: `routes-${id}@example.com`,
    username: `routes_${id.replace(/-/g, "")}`,
    passwordHash: "not-a-real-hash",
    passkey,
  });
  userIds.push(id);
  return { id, passkey };
}

async function makeTorrent(
  uploaderId: string,
): Promise<{ id: string; infoHash: string; name: string }> {
  const categoryId = crypto.randomUUID();
  await db.orm.public.Category.create({
    id: categoryId,
    name: `routes-cat-${categoryId}`,
  });
  categoryIds.push(categoryId);

  const id = crypto.randomUUID();
  const infoHash = `routes-hash-${id}`;
  const name = `routes torrent ${id}`;
  await db.orm.public.Torrent.create({
    id,
    infoHash,
    name,
    uploaderId,
    filePath: "/tmp/routes.torrent",
    size: 1000n,
    categoryId,
  });
  torrentIds.push(id);
  return { id, infoHash, name };
}

async function makeAnnounce(fields: {
  torrentId: string;
  userId?: string;
  uploaded?: bigint;
  event?: string;
}): Promise<void> {
  await db.orm.public.Announce.create({
    id: crypto.randomUUID(),
    torrentId: fields.torrentId,
    userId: fields.userId ?? null,
    peerId: `routes-${crypto.randomUUID()}`,
    ip: "10.0.0.1",
    port: 6881,
    uploaded: fields.uploaded ?? 0n,
    downloaded: 0n,
    left: 0n,
    event: fields.event ?? null,
  });
}

function tokenFor(user: { id: string; passkey: string }): string {
  return jwt.sign(
    { id: user.id, username: user.id, passkey: user.passkey },
    JWT_SECRET,
    { expiresIn: "1h" },
  );
}

after(async () => {
  for (const id of torrentIds) {
    await db.orm.public.Announce.where({ torrentId: id }).deleteAll();
    await db.orm.public.HitAndRun.where({ torrentId: id }).deleteAll();
  }
  for (const id of userIds) {
    await db.orm.public.Announce.where({ userId: id }).deleteAll();
    await db.orm.public.HitAndRun.where({ userId: id }).deleteAll();
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
// torrent.ts — the magnet-debug route reads the torrent through `db`
// ---------------------------------------------------------------------------

test("GET /torrent/:id/magnet-debug builds a magnet link from the stored torrent", async () => {
  const app = await makeApp();
  try {
    const user = await makeUser();
    const torrent = await makeTorrent(user.id);

    const res = await app.inject({
      method: "GET",
      url: `/torrent/${torrent.id}/magnet-debug`,
      headers: { authorization: `Bearer ${tokenFor(user)}` },
    });

    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.infoHash, torrent.infoHash);
    assert.equal(body.name, torrent.name);
    assert.equal(body.userPasskey, user.passkey);
    assert.match(body.magnetLink, new RegExp(`urn:btih:${torrent.infoHash}`));
    assert.match(body.magnetLink, /tr=/);
    assert.match(body.tracker, new RegExp(`passkey=${user.passkey}`));
  } finally {
    await app.close();
  }
});

test("GET /torrent/:id/magnet-debug returns 404 for an unknown torrent", async () => {
  const app = await makeApp();
  try {
    const user = await makeUser();

    const res = await app.inject({
      method: "GET",
      url: `/torrent/${crypto.randomUUID()}/magnet-debug`,
      headers: { authorization: `Bearer ${tokenFor(user)}` },
    });

    assert.equal(res.statusCode, 404);
    assert.deepEqual(res.json(), { error: "Torrent not found" });
  } finally {
    await app.close();
  }
});

test("GET /torrent/:id/magnet-debug requires authentication", async () => {
  const app = await makeApp();
  try {
    const res = await app.inject({
      method: "GET",
      url: `/torrent/${crypto.randomUUID()}/magnet-debug`,
    });

    assert.equal(res.statusCode, 401);
  } finally {
    await app.close();
  }
});

// ---------------------------------------------------------------------------
// files.ts — GET /files/:id reads the UploadedFile through `db`
// ---------------------------------------------------------------------------

async function seedDbStorageConfig(): Promise<void> {
  await db.orm.public.Config.where({ id: 1 }).deleteAll();
  await db.orm.public.Config.create({ id: 1, storageType: "DB" });
}

test("GET /files/:id serves bytes stored in the database", async () => {
  const app = await makeApp();
  try {
    await seedDbStorageConfig();

    const bytes = Buffer.from("hello route files");
    const file = await db.orm.public.UploadedFile.create({
      type: "image",
      ext: ".txt",
      storageKey: "",
      size: bytes.length,
      mimeType: "text/plain",
      data: new Uint8Array(bytes),
    });
    fileIds.push(file.id);

    const res = await app.inject({ method: "GET", url: `/files/${file.id}` });

    assert.equal(res.statusCode, 200);
    assert.equal(res.headers["content-type"], "text/plain");
    assert.equal(res.rawPayload.toString(), "hello route files");
  } finally {
    await app.close();
  }
});

test("GET /files/:id returns 404 for an unknown file", async () => {
  const app = await makeApp();
  try {
    await seedDbStorageConfig();

    const res = await app.inject({
      method: "GET",
      url: `/files/${crypto.randomUUID()}`,
    });

    assert.equal(res.statusCode, 404);
    assert.deepEqual(res.json(), { error: "File not found" });
  } finally {
    await app.close();
  }
});

// ---------------------------------------------------------------------------
// stats.ts — GET /stats aggregates through `db`
// ---------------------------------------------------------------------------

test("GET /stats matches the Prisma 7 count/sum oracle", async () => {
  const app = await makeApp();
  try {
    const user = await makeUser();
    const torrent = await makeTorrent(user.id);
    await makeAnnounce({
      torrentId: torrent.id,
      userId: user.id,
      uploaded: 1234n,
      event: "completed",
    });

    const expectedUsers = await prisma.user.count();
    const expectedTorrents = await prisma.torrent.count();
    const expectedCompleted = await prisma.announce.count({
      where: { event: "completed" },
    });
    const expectedUploaded = await prisma.announce.aggregate({
      _sum: { uploaded: true },
    });

    const res = await app.inject({ method: "GET", url: "/stats" });

    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.totalUsers, expectedUsers);
    assert.equal(body.totalTorrents, expectedTorrents);
    assert.equal(body.totalDownloads, expectedCompleted);
    assert.equal(
      body.totalUploadBytes,
      Number(expectedUploaded._sum.uploaded || 0),
    );
    assert.match(
      body.totalUploadFormatted,
      /^(0 mb|\d+(?:\.\d+)? (?:b|kb|mb|gb|tb|pb))$/,
    );
  } finally {
    await app.close();
  }
});
