import { db } from '../../src/lib/prisma.js';

export async function resetDb() {
  const plan = db.raw.sql`TRUNCATE TABLE "User","Torrent","Category","Source","Config" RESTART IDENTITY CASCADE`
    .affectedCount()
    .build();
  await db.runtime().execute(plan);
}

export { db };
