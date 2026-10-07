const PG_TIMESTAMP = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d+)?$/;

/**
 * Recursively prepare a value for JSON responses:
 * - `bigint` -> decimal string (JSON.stringify cannot encode bigint)
 * - `Date` -> ISO 8601
 * - PostgreSQL timestamp text (as returned by the Prisma 8 string codec) -> ISO 8601
 *
 * Prisma 7 returned `Date` objects for DateTime columns; Prisma 8 (with the
 * contract's `TimestampString` codec) returns PostgreSQL timestamp text like
 * `2026-01-01 12:00:00.000`. Normalizing here keeps the API output ISO 8601.
 */
export function convertBigInts(obj: any): any {
  if (Array.isArray(obj)) {
    return obj.map(convertBigInts);
  }
  if (obj && typeof obj === 'object') {
    return Object.fromEntries(
      Object.entries(obj).map(([k, v]) => {
        if (typeof v === 'bigint') return [k, v.toString()];
        if (v instanceof Date) return [k, v.toISOString()];
        if (typeof v === 'string' && PG_TIMESTAMP.test(v)) {
          return [k, new Date(`${v.replace(' ', 'T')}Z`).toISOString()];
        }
        return [k, convertBigInts(v)];
      })
    );
  }
  return obj;
}
