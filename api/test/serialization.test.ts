process.env.TZ = "UTC";

import { test } from "node:test";
import assert from "node:assert/strict";
import { convertBigInts } from "../src/lib/serialization.js";

test("converts bigint to a decimal string", () => {
  assert.deepEqual(convertBigInts({ upload: 10n }), { upload: "10" });
});

test("converts Date to ISO 8601", () => {
  assert.deepEqual(convertBigInts({ d: new Date("2026-01-01T00:00:00.000Z") }), {
    d: "2026-01-01T00:00:00.000Z",
  });
});

test("converts PostgreSQL timestamp text to ISO 8601", () => {
  assert.deepEqual(convertBigInts({ d: "2026-01-01 12:00:00.000" }), {
    d: "2026-01-01T12:00:00.000Z",
  });
});

test("recurses arrays and nested objects", () => {
  assert.deepEqual(convertBigInts([{ n: 5n, nested: { m: 6n } }]), [
    { n: "5", nested: { m: "6" } },
  ]);
});

test("leaves plain strings untouched", () => {
  assert.deepEqual(convertBigInts({ name: "hello", iso: "2026-01-01T00:00:00.000Z" }), {
    name: "hello",
    iso: "2026-01-01T00:00:00.000Z",
  });
});
