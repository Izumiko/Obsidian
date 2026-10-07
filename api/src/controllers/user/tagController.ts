import { FastifyRequest, FastifyReply } from 'fastify';
import { or } from '@prisma/orm-postgres/orm-client';
import { db } from '../../lib/prisma.js';
import { convertBigInts } from '../../lib/serialization.js';

function buildOrder(sort: string) {
  return (m: any) => {
    switch (sort) {
      case 'oldest':
        return m.createdAt.asc();
      case 'name':
        return m.name.asc();
      case 'size':
        return m.size.desc();
      case 'newest':
      default:
        return m.createdAt.desc();
    }
  };
}

/**
 * Get popular tags with their usage counts
 * Returns tags sorted by usage count (most popular first)
 */
export async function getPopularTagsHandler(request: FastifyRequest, reply: FastifyReply) {
  try {
    // Get all approved torrents with their tags
    const torrents = await db.orm.public.Torrent
      .where({ isApproved: true })
      .select('tags')
      .all();

    // Count tag usage
    const tagCounts: Record<string, number> = {};

    torrents.forEach(torrent => {
      if (torrent.tags && Array.isArray(torrent.tags)) {
        torrent.tags.forEach(tag => {
          if (tag && tag.trim()) {
            const normalizedTag = tag.trim();
            tagCounts[normalizedTag] = (tagCounts[normalizedTag] || 0) + 1;
          }
        });
      }
    });

    // Convert to array and sort by count
    const popularTags = Object.entries(tagCounts)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 20); // Top 20 most popular tags

    return reply.send(popularTags);
  } catch (error) {
    console.error('Error fetching popular tags:', error);
    return reply.status(500).send({ error: 'Failed to fetch popular tags' });
  }
}

/**
 * Search torrents by text query
 * Returns torrents that match the search query in name or description
 */
export async function searchTorrentsByTextHandler(request: FastifyRequest, reply: FastifyReply) {
  const { q } = request.query as any;
  const { page = 1, limit = 20, sort = 'newest' } = (request.query as any) || {};
  const skip = (Number(page) - 1) * Number(limit);

  if (!q || q.trim().length === 0) {
    return reply.status(400).send({ error: 'Search query is required' });
  }

  try {
    // Search torrents by name or description
    const query = db.orm.public.Torrent
      .where({ isApproved: true })
      .where((m: any) => or(m.name.ilike(`%${q}%`), m.description.ilike(`%${q}%`)));

    const [torrents, totalResult] = await Promise.all([
      query
        .offset(skip)
        .limit(Number(limit))
        .orderBy(buildOrder(sort))
        .include('uploader', (u: any) => u.select('id', 'username'))
        .include('category', (c: any) => c.select('id', 'name'))
        .all(),
      query.aggregate((a: any) => ({ n: a.count() }))
    ]);
    const total = totalResult.n;

    // Calculate stats for each torrent
    const { getSeederLeecherCounts, getCompletedCount } = await import('../../announce_features/peerList.js');

    const torrentsWithStats = await Promise.all(
      torrents.map(async (torrent: any) => {
        const [seederLeecherCounts, completedCount] = await Promise.all([
          getSeederLeecherCounts(torrent.id),
          getCompletedCount(torrent.id)
        ]);

        return {
          ...torrent,
          size: torrent.size?.toString?.() ?? "0",
          seeders: seederLeecherCounts.complete,
          leechers: seederLeecherCounts.incomplete,
          completed: completedCount,
          category: torrent.category?.name || 'General'
        };
      })
    );

    return reply.send(convertBigInts({
      torrents: torrentsWithStats,
      total,
      page: Number(page),
      limit: Number(limit),
      query: q
    }));
  } catch (error) {
    console.error('Error searching torrents by text:', error);
    return reply.status(500).send({ error: 'Failed to search torrents by text' });
  }
}

/**
 * Search torrents by tag
 * Returns torrents that contain the specified tag
 */
export async function searchTorrentsByTagHandler(request: FastifyRequest, reply: FastifyReply) {
  const { tag } = request.params as any;
  const { page = 1, limit = 20, sort = 'newest' } = (request.query as any) || {};
  const skip = (Number(page) - 1) * Number(limit);

  if (!tag) {
    return reply.status(400).send({ error: 'Tag parameter is required' });
  }

  try {
    // v8 has no ORM array-containment operator, so matching ids are resolved with
    // raw SQL and the page is then loaded (and ordered) through the ORM.
    const idPlan = db.raw.sql`
      SELECT "id" FROM "Torrent" WHERE "isApproved" = true AND "tags" @> ARRAY[${tag}]::text[]
    `.returnsRow({ id: 'pg/text@1' }).build();
    const idRows = await db.runtime().query(idPlan);
    const ids = idRows.map((r: any) => r.id);

    let torrents: any[] = [];
    if (ids.length > 0) {
      torrents = await db.orm.public.Torrent
        .where({ isApproved: true })
        .where((m: any) => m.id.in(ids))
        .offset(skip)
        .limit(Number(limit))
        .orderBy(buildOrder(sort))
        .include('uploader', (u: any) => u.select('id', 'username'))
        .include('category', (c: any) => c.select('id', 'name'))
        .all();
    }
    const total = ids.length;

    // Calculate stats for each torrent
    const { getSeederLeecherCounts, getCompletedCount } = await import('../../announce_features/peerList.js');

    const torrentsWithStats = await Promise.all(
      torrents.map(async (torrent: any) => {
        const [seederLeecherCounts, completedCount] = await Promise.all([
          getSeederLeecherCounts(torrent.id),
          getCompletedCount(torrent.id)
        ]);

        return {
          ...torrent,
          size: torrent.size?.toString?.() ?? "0",
          seeders: seederLeecherCounts.complete,
          leechers: seederLeecherCounts.incomplete,
          completed: completedCount,
          category: torrent.category?.name || 'General'
        };
      })
    );

    return reply.send(convertBigInts({
      torrents: torrentsWithStats,
      total,
      page: Number(page),
      limit: Number(limit),
      tag
    }));
  } catch (error) {
    console.error('Error searching torrents by tag:', error);
    return reply.status(500).send({ error: 'Failed to search torrents by tag' });
  }
}
