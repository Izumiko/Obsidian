import crypto from "node:crypto";
import { test } from "node:test";
import assert from "node:assert/strict";

// Regression guard: the app must not depend on the host running in UTC. Start
// this process in a non-UTC zone (as a bare `node index.mjs` on such a host
// would) and only then load the DB module, which is expected to pin TZ=UTC.
// Without that pin the client-side `onCreate: now` generator writes local time
// into the `timestamp` column and `updatedAt` drifts by the zone's offset.
process.env.TZ = "Asia/Shanghai";

const { db } = await import("../../src/lib/prisma.js");

function parseTimestamp(value: string): number {
  return Date.parse(value.includes("T") ? value : `${value.replace(" ", "T")}Z`);
}

test("db module pins TZ=UTC so updatedAt matches wall-clock time", async () => {
  assert.equal(process.env.TZ, "UTC");

  const before = Date.now();
  const row = await db.orm.public.UploadedFile
    .select("id", "createdAt", "updatedAt")
    .create({
      type: "tz-pin",
      ext: "bin",
      storageKey: `tz-pin-${crypto.randomUUID()}`,
      size: 1,
      mimeType: "application/octet-stream",
    });

  try {
    const after = Date.now();
    const updatedAt = parseTimestamp(row.updatedAt);
    const createdAt = parseTimestamp(row.createdAt);
    // Allow a little clock skew between the test process and the DB server.
    assert.ok(Math.abs(updatedAt - createdAt) < 60_000, `updatedAt ${row.updatedAt} vs createdAt ${row.createdAt}`);
    assert.ok(updatedAt >= before - 60_000 && updatedAt <= after + 60_000, `updatedAt ${row.updatedAt} is not now`);
  } finally {
    await db.orm.public.UploadedFile.where({ id: row.id }).delete();
  }
});
