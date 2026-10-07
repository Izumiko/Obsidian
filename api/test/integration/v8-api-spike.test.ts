import crypto from "node:crypto";
import { test } from "node:test";
import assert from "node:assert/strict";
import { db, prisma } from "../../src/lib/prisma.js";

// Task 6 spike: pins the Prisma 8 (`@prisma/orm-postgres` 8.0.0-rc.14) ORM
// client syntax that the rest of the migration maps onto.
//
// Temporal caveat: the emitted contract maps every PSL `DateTime` to a
// Temporal-backed codec (`pg/timestamp-temporal@1`). Node 24 has no global
// `Temporal`, so any query that decodes or encodes such a column throws
// `RUNTIME.TEMPORAL_UNAVAILABLE`. The fix (Prisma 8's own recommendation) is
// `import 'temporal-polyfill/full/global'` in the app entry point, or authoring
// the columns as `*String`. These spikes therefore project only the columns
// under test via `.select(...)` so the syntax is pinned without a global
// `Temporal`, and use `Config` (which has no timestamp column) for the
// transaction write.

test("v8: read with where/orderBy/limit", async () => {
  const rows = await db.orm.public.User
    .select("id", "username", "role")
    .orderBy((u) => u.createdAt.desc())
    .limit(1)
    .all();
  assert.ok(Array.isArray(rows));
});

test("v8: first()", async () => {
  const row = await db.orm.public.Config.first({ id: 1 });
  assert.ok(row === null || typeof row === "object");
});

test("v8: aggregate count", async () => {
  const result = await db.orm.public.User.aggregate((a) => ({ n: a.count() }));
  assert.equal(typeof result.n, "number");
});

test("v8: relation include", async () => {
  const rows = await db.orm.public.Torrent
    .select("id", "name")
    .include("uploader", (u) => u.select("id", "username"))
    .limit(1)
    .all();
  assert.ok(Array.isArray(rows));
});

test("v8: transaction", async () => {
  const rollbackId = crypto.randomInt(1_000_000_000, 2_000_000_000);
  await assert.rejects(
    db.transaction(async (tx) => {
      await tx.orm.public.Config.select("id").create({ id: rollbackId });
      throw new Error("force-rollback");
    }),
    /force-rollback/,
  );
  assert.equal(
    await prisma.config.findUnique({ where: { id: rollbackId } }),
    null,
    "rolled-back insert must not persist",
  );

  const commitId = crypto.randomInt(1_000_000_000, 2_000_000_000);
  try {
    await db.transaction(async (tx) => {
      await tx.orm.public.Config.select("id").create({ id: commitId });
    });
    assert.ok(
      await prisma.config.findUnique({ where: { id: commitId } }),
      "committed insert must persist",
    );
  } finally {
    await prisma.config.deleteMany({ where: { id: { in: [rollbackId, commitId] } } });
  }
});

test("v8: raw sql", async () => {
  const plan = db.raw.sql`SELECT 1 AS one`.returnsRow({ one: "pg/int4@1" }).build();
  const rows = await db.runtime().query(plan);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.one, 1);
});

test("v8: enum + bigint round trip", async () => {
  const id = crypto.randomUUID();
  await prisma.user.create({
    data: {
      id,
      email: `v8-spike-${id}@example.com`,
      username: `v8_spike_${id.replace(/-/g, "")}`,
      passwordHash: "not-a-real-hash",
      passkey: crypto.randomUUID(),
      role: "ADMIN",
      upload: 123_456_789_012_345n,
      download: 987_654_321_098_765n,
    },
  });

  try {
    const row = await db.orm.public.User
      .select("id", "role", "upload", "download")
      .first({ id });

    assert.ok(row);
    assert.equal(row.role, "ADMIN", "enum reads back as the app-comparable string");
    assert.equal(typeof row.upload, "bigint", "BigInt column decodes to a JS bigint");
    assert.equal(row.upload, 123_456_789_012_345n);
    assert.equal(typeof row.download, "bigint");
    assert.equal(row.download, 987_654_321_098_765n);
  } finally {
    await prisma.user.deleteMany({ where: { id } });
  }
});
