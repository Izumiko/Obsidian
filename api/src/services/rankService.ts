import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export interface Rank {
  id: string;
  name: string;
  description: string | null;
  order: number;
  minUpload: bigint;
  minDownload: bigint;
  minRatio: number;
  color: string | null;
}

export interface RankResponse {
  id: string;
  name: string;
  description: string | null;
  order: number;
  minUpload: string;
  minDownload: string;
  minRatio: number;
  color: string | null;
}

export interface UserRank {
  rank: RankResponse | null;
  nextRank: RankResponse | null;
  progress: {
    upload: number;
    download: number;
    ratio: number;
  };
}

/**
 * Calculate the user's current rank based on their stats
 */
export async function calculateUserRank(userId: string): Promise<UserRank> {
  // Check if ranks are enabled
  const config = await prisma.config.findFirst();
  if (!config?.ranksEnabled) {
    return {
      rank: null,
      nextRank: null,
      progress: { upload: 0, download: 0, ratio: 0 }
    };
  }

  // Get user stats
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      upload: true,
      download: true
    }
  });

  if (!user) {
    throw new Error('User not found');
  }

  // Calculate ratio
  // Users with 0 downloads get effectiveRatio = 0. To reward seeders,
  // admins can create ranks with minRatio: 0 and minDownload: 0.
  const ratio = user.download > 0 ? Number(user.upload) / Number(user.download) : 0;
  const effectiveRatio = user.download === BigInt(0) ? 0 : ratio;

  const ranks = await prisma.rank.findMany({
    orderBy: { order: 'asc' }
  });

  if (ranks.length === 0) {
    return {
      rank: null,
      nextRank: null,
      progress: { upload: 0, download: 0, ratio: 0 }
    };
  }

  // Sort ranks by requirements (highest to lowest) for proper checking
  // We want to check the most demanding ranks first
  ranks.sort((a, b) => {
    if (a.minUpload !== b.minUpload) {
      return a.minUpload > b.minUpload ? -1 : 1;
    }
    if (a.minDownload !== b.minDownload) {
      return a.minDownload > b.minDownload ? -1 : 1;
    }
    if (a.minRatio !== b.minRatio) {
      return b.minRatio - a.minRatio;
    }
    return a.order - b.order;
  });

  // Sort by order for proper hierarchy (lower order = higher rank)
  const ranksByOrder = [...ranks].sort((a, b) => a.order - b.order);

  // Find the highest rank the user qualifies for
  let currentRank: Rank | null = null;
  let nextRank: Rank | null = null;

  for (let i = 0; i < ranks.length; i++) {
    const rank = ranks[i];
    const qualifies = user.upload >= rank.minUpload &&
                     user.download >= rank.minDownload &&
                     effectiveRatio >= rank.minRatio;

    if (qualifies) {
      currentRank = rank;
      const currentRankIndex = ranksByOrder.findIndex(r => r.id === rank.id);
      if (currentRankIndex > 0) {
        nextRank = ranksByOrder[currentRankIndex - 1];
      }
      break;
    }
  }

  // Calculate progress towards next rank
  let progress = { upload: 0, download: 0, ratio: 0 };

  if (nextRank) {
    if (Number(nextRank.minUpload) > 0) {
      progress.upload = Math.min(100, Math.max(0, (Number(user.upload) / Number(nextRank.minUpload)) * 100));
    } else {
      progress.upload = 100;
    }

    if (Number(nextRank.minDownload) > 0) {
      progress.download = Math.min(100, Math.max(0, (Number(user.download) / Number(nextRank.minDownload)) * 100));
    } else {
      progress.download = 100;
    }

    if (nextRank.minRatio > 0) {
      progress.ratio = Math.min(100, Math.max(0, (effectiveRatio / nextRank.minRatio) * 100));
    } else {
      progress.ratio = 100;
    }
  }

  // Convert Rank objects to RankResponse objects for JSON serialization
  const convertRankToResponse = (rank: Rank | null): RankResponse | null => {
    if (!rank) return null;
    return {
      ...rank,
      minUpload: rank.minUpload.toString(),
      minDownload: rank.minDownload.toString()
    };
  };

  return {
    rank: convertRankToResponse(currentRank),
    nextRank: convertRankToResponse(nextRank),
    progress
  };
}

/**
 * Get all ranks for admin management
 */
export async function getAllRanks(): Promise<RankResponse[]> {
  const ranks = await prisma.rank.findMany({
    orderBy: { order: 'asc' }
  });
  
  // Convert BigInt to string for JSON serialization
  return ranks.map(rank => ({
    ...rank,
    minUpload: rank.minUpload.toString(),
    minDownload: rank.minDownload.toString()
  }));
}

/**
 * Create a new rank
 */
export async function createRank(rankData: Omit<Rank, 'id' | 'createdAt' | 'updatedAt'>): Promise<RankResponse> {
  const rank = await prisma.rank.create({
    data: rankData
  });
  
  return {
    ...rank,
    minUpload: rank.minUpload.toString(),
    minDownload: rank.minDownload.toString()
  };
}

/**
 * Update an existing rank
 */
export async function updateRank(id: string, rankData: Partial<Omit<Rank, 'id' | 'createdAt' | 'updatedAt'>>): Promise<RankResponse> {
  const rank = await prisma.rank.update({
    where: { id },
    data: rankData
  });
  
  return {
    ...rank,
    minUpload: rank.minUpload.toString(),
    minDownload: rank.minDownload.toString()
  };
}

/**
 * Delete a rank
 */
export async function deleteRank(id: string): Promise<void> {
  await prisma.rank.delete({
    where: { id }
  });
}

/**
 * Get rank by ID
 */
export async function getRankById(id: string): Promise<RankResponse | null> {
  const rank = await prisma.rank.findUnique({
    where: { id }
  });
  
  if (!rank) return null;
  
  return {
    ...rank,
    minUpload: rank.minUpload.toString(),
    minDownload: rank.minDownload.toString()
  };
}

/**
 * Check if ranks are enabled
 */
export async function areRanksEnabled(): Promise<boolean> {
  const config = await prisma.config.findFirst();
  return config?.ranksEnabled ?? false;
}

/**
 * Enable or disable the rank system
 */
export async function setRanksEnabled(enabled: boolean): Promise<void> {
  await prisma.config.updateMany({
    data: { ranksEnabled: enabled }
  });
} 