import { PrismaClient } from '../generated/prisma/client.js';
import { PrismaPg } from "@prisma/adapter-pg";
import { getConfig } from '../services/configService.js';

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL,
});
const prisma = new PrismaClient({ adapter });

export async function awardBonusPoints(userId: string, seedingMinutes: number) {
  const config = await getConfig();
  const POINTS_PER_HOUR = config.bonusPointsPerHour;
  const points = Math.floor(seedingMinutes / 60) * POINTS_PER_HOUR;
  if (points > 0) {
    await prisma.user.update({
      where: { id: userId },
      data: { bonusPoints: { increment: points } }
    });
  }
} 