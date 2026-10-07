import postgres from "@prisma/orm-postgres/runtime";
import type { Contract } from "../generated/prisma8/contract.js";
import contractJson from "../generated/prisma8/contract.json" with { type: "json" };

export const db = postgres<Contract>({
  url: process.env.DATABASE_URL!,
  contractJson,
});

process.on('beforeExit', async () => {
  await db.close();
});
