import { db } from '../lib/prisma.js';
import { getConfig } from '../services/configService.js';

export async function awardBonusPoints(userId: string, seedingMinutes: number) {
  const config = await getConfig();
  const POINTS_PER_HOUR = config.bonusPointsPerHour;
  const points = Math.floor(seedingMinutes / 60) * POINTS_PER_HOUR;
  if (points > 0) {
    // Prisma 8 has no `{ increment }` on PostgreSQL, so add in place with raw SQL.
    // The statement also has to refresh `updatedAt`, because raw SQL bypasses the
    // contract's `onUpdate` generator that `.update()` would have applied.
    const query = db.raw.sql`UPDATE "User" SET "bonusPoints" = "bonusPoints" + ${points}, "updatedAt" = now() WHERE "id" = ${userId}`.affectedCount().build();
    await db.runtime().execute(query);
  }
}
