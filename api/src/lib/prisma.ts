import postgres from "@prisma/orm-postgres/runtime";
import type { Contract } from "../generated/prisma8/contract.js";
import contractJson from "../generated/prisma8/contract.json" with { type: "json" };

// The timestamp columns are `timestamp` (without time zone) holding UTC, and the
// Prisma 8 `onCreate/onUpdate: now` generators serialize in the *process*
// timezone. Pin it here, where every DB consumer passes through, so a bare
// `node index.mjs` on a non-UTC host doesn't skew `updatedAt` by its offset.
process.env.TZ = "UTC";

export const db = postgres<Contract>({
  url: process.env.DATABASE_URL!,
  contractJson,
});

process.on('beforeExit', async () => {
  await db.close();
});
