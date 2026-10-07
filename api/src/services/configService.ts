import { db } from '../lib/prisma.js';
import type { models } from '../generated/prisma8/contract.js';

type Config = typeof models.public.Config;

export async function getConfig(): Promise<Config> {
  // Always fetch the config row with id=1
  let config = await db.orm.public.Config.where({ id: 1 }).first();
  if (!config) {
    // If not found, create with defaults
    config = await db.orm.public.Config.create({});
  }
  return config;
}

export async function updateConfig(data: Partial<Config>): Promise<Config> {
  // Only allow updating known fields
  const updated = await db.orm.public.Config.where({ id: 1 }).update(data);
  if (!updated) {
    throw new Error('Config not found');
  }
  return updated;
}

export async function isFirstUser(): Promise<boolean> {
  const { n } = await db.orm.public.User.aggregate((a) => ({ n: a.count() }));
  return n === 0;
}

export async function requireTorrentApproval(): Promise<boolean> {
  const config = await getConfig();
  return config.requireTorrentApproval;
} 