import crypto from "node:crypto";
import { createRequire } from "node:module";
import { test } from "node:test";
import assert from "node:assert/strict";
import { db } from "../../src/lib/prisma.js";

// Prisma 8 date-codec spike. The contract in `prisma8/contract.prisma` declares
// every `timestamp(3)` column as `TimestampString(3)` (or
// `temporal.timestampString(3, ...)` for `@updatedAt`), so values round-trip as
// plain strings via `pg/timestamp-string@1` and never touch `Temporal`.
//
// These tests fail with `RUNTIME.TEMPORAL_UNAVAILABLE` if a field ever falls
// back to the inferred `Timestamp(3)` -> `pg/timestamp-temporal@1` codec, which
// is the regression they guard against.
//
// TZ NOTE: the `timestampNow` generator behind `temporal.timestampString(...)`
// produces a JS `Date`, and the identity string codec hands it to `pg`, which
// serializes it in the *process* timezone. The columns are `timestamp` (without
// time zone) and the database session runs in UTC, so the process must run in
// UTC too or `@updatedAt` shifts by the machine's offset. Pin it here exactly as
// a server (TZ=UTC) would.
process.env.TZ = "UTC";

const require = createRequire(import.meta.url);

/** PostgreSQL renders `timestamp` as `YYYY-MM-DD HH:MM:SS[.fff]`; parse it as UTC. */
function parseTimestamp(value: string): number {
  const iso = value.includes("T") ? value : `${value.replace(" ", "T")}Z`;
  return Date.parse(iso);
}

test("v8: DateTime columns round-trip as strings, not Temporal objects", async () => {
  const id = crypto.randomUUID();
  const email = `v8-dates-${id}@example.com`;
  const username = `v8_dates_${id.replace(/-/g, "")}`;

  const created = await db.orm.public.User
    .select("id", "createdAt", "updatedAt")
    .create({
      id,
      email,
      username,
      passwordHash: "not-a-real-hash",
      passkey: crypto.randomUUID(),
    });

  try {
    assert.equal(typeof created.createdAt, "string", "createdAt decodes to a string");
    assert.equal(typeof created.updatedAt, "string", "updatedAt decodes to a string");
    assert.notEqual(typeof created.createdAt, "object");
    assert.notEqual(typeof created.updatedAt, "object");

    // A full read-back (every column, including the timestamp columns) must not
    // throw `RUNTIME.TEMPORAL_UNAVAILABLE`.
    const row = await db.orm.public.User.first({ id });
    assert.ok(row);
    assert.equal(typeof row.createdAt, "string");
    assert.equal(typeof row.updatedAt, "string");

    // DB `@default(now())` and the client `onCreate` generator are both real.
    const now = Date.now();
    assert.ok(parseTimestamp(row.createdAt) <= now + 5_000, "createdAt is near now");
    assert.ok(parseTimestamp(row.updatedAt) <= now + 5_000, "updatedAt is near now");
  } finally {
    await db.orm.public.User.where({ id }).deleteAll();
  }
});

test("v8: temporal-string `updatedAt` is auto-set on create and update", async () => {
  const id = crypto.randomUUID();
  const email = `v8-updatedat-${id}@example.com`;

  const created = await db.orm.public.User
    .select("id", "updatedAt")
    .create({
      id,
      email,
      username: `v8_updatedat_${id.replace(/-/g, "")}`,
      passwordHash: "not-a-real-hash",
      passkey: crypto.randomUUID(),
    });

  try {
    assert.equal(typeof created.updatedAt, "string");
    const createdAt = parseTimestamp(created.updatedAt);

    // The `timestampNow` generator uses millisecond precision; wait so an
    // update in the same millisecond cannot mask a missing on-update default.
    await new Promise((resolve) => setTimeout(resolve, 10));

    const updated = await db.orm.public.User
      .select("id", "updatedAt")
      .where({ id })
      .update({ emailVerified: true });

    assert.ok(updated);
    assert.equal(typeof updated.updatedAt, "string");
    assert.ok(
      parseTimestamp(updated.updatedAt) > createdAt,
      "updatedAt is refreshed by the on-update generator",
    );
  } finally {
    await db.orm.public.User.where({ id }).deleteAll();
  }
});

test("v8: temporal-polyfill is not required for date decoding", () => {
  // The string codec (`pg/timestamp-string@1`) returns the raw wire string, so
  // no global `Temporal` and no polyfill are involved. `temporal-polyfill` is a
  // peer dependency of `@prisma/orm-postgres` but is not installed or resolvable
  // from the app; if that ever changes, this guard flags it so the dependency
  // stays deliberate.
  let resolveError: unknown;
  try {
    require.resolve("temporal-polyfill");
  } catch (error) {
    resolveError = error;
  }
  assert.ok(
    resolveError !== undefined,
    "temporal-polyfill unexpectedly resolvable; string date codec should not need it",
  );
});
