import type { TimestampString } from '@prisma/orm-postgres/target/codec-types';

/**
 * The Prisma 8 contract declares `timestamp(3)` columns as `TimestampString(3)`,
 * a branded string. At runtime the values are plain PostgreSQL timestamp text;
 * the brand only exists at the type level, so app code opts in with a cast.
 */
export function toTimestamp(value: string): TimestampString<3> {
  return value as TimestampString<3>;
}

/**
 * Parse a PostgreSQL `timestamp without time zone` string (e.g.
 * `2026-01-01 12:00:00.000`) as UTC milliseconds.
 */
export function parseTimestamp(value: string): number {
  return Date.parse(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`);
}

/** Current time as a value accepted by the Prisma 8 timestamp codec. */
export function nowTimestamp(): TimestampString<3> {
  return toTimestamp(new Date().toISOString());
}
