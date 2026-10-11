import { FastifyRequest, FastifyReply } from 'fastify';
import { getSeederLeecherCounts, getCompletedCount } from '../../announce_features/peerList.js';
import { db } from '../../lib/prisma.js';
import { convertBigInts } from '../../lib/serialization.js';

export async function listAllCategoriesHandler(request: FastifyRequest, reply: FastifyReply) {
  const categories = await db.orm.public.Category
    .where({ parentId: null })
    .include('children')
    .all();
  return reply.send(convertBigInts(categories));
}

export async function listTorrentsByCategoryHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as any;
  const { page = 1, limit = 20 } = (request.query as any) || {};
  const skip = (Number(page) - 1) * Number(limit);
  const [torrents, totalResult] = await Promise.all([
    db.orm.public.Torrent
      .where({ categoryId: id, isApproved: true })
      .offset(skip)
      .limit(Number(limit))
      .orderBy((t: any) => t.createdAt.desc())
      .all(),
    db.orm.public.Torrent
      .where({ categoryId: id, isApproved: true })
      .aggregate((a: any) => ({ n: a.count() }))
  ]);
  const total = totalResult.n;
  return reply.send(convertBigInts({ torrents, total, page: Number(page), limit: Number(limit) }));
}

export async function listTorrentsByCategoryTitleHandler(request: FastifyRequest, reply: FastifyReply) {
  const { title } = request.params as any;
  const { page = 1, limit = 20 } = (request.query as any) || {};
  const skip = (Number(page) - 1) * Number(limit);

  // Find the category by name
  const category = await db.orm.public.Category.where({ name: title }).first();
  if (!category) return reply.status(404).send({ error: 'Category not found' });

  const [torrents, totalResult] = await Promise.all([
    db.orm.public.Torrent
      .where({ categoryId: category.id, isApproved: true })
      .offset(skip)
      .limit(Number(limit))
      .orderBy((t: any) => t.createdAt.desc())
      .include('uploader', (u: any) => u.select('id', 'username'))
      .include('category', (c: any) => c.select('id', 'name'))
      .all(),
    db.orm.public.Torrent
      .where({ categoryId: category.id, isApproved: true })
      .aggregate((a: any) => ({ n: a.count() }))
  ]);
  const total = totalResult.n;

  // Calculate stats for each torrent
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
    limit: Number(limit)
  }));
}

// Public: Get category sources (own + inherited computed) for user-facing features
export async function getCategorySourcesPublicHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as any;
  if (!id) return reply.status(400).send({ error: 'Category ID is required' });

  try {
    const category = await db.orm.public.Category.where({ id }).first();
    if (!category) return reply.status(404).send({ error: 'Category not found' });

    const ownLinks = await db.orm.public.CategorySource
      .where({ categoryId: id })
      .include('source')
      .orderBy((m: any) => m.order.asc())
      .all();

    const inherited: { id: string; name: string; isActive: boolean; order: number }[] = [];
    if (category.parentId) {
      const ownIds = new Set(ownLinks.map((l: any) => l.sourceId));
      let currentParentId: string | null = category.parentId;
      const seen = new Set<string>();
      while (currentParentId) {
        const parent: any = await db.orm.public.Category.where({ id: currentParentId }).first();
        if (!parent) break;
        const parentLinks = await db.orm.public.CategorySource
          .where({ categoryId: currentParentId })
          .include('source')
          .orderBy((m: any) => m.order.asc())
          .all();
        for (const link of parentLinks) {
          if (seen.has(link.sourceId) || ownIds.has(link.sourceId)) continue;
          seen.add(link.sourceId);
          inherited.push({ id: link.source.id, name: link.source.name, isActive: link.source.isActive, order: link.order });
        }
        currentParentId = parent.parentId;
      }
    }

    const own = ownLinks.map((l: any) => ({ id: l.source.id, name: l.source.name, isActive: l.source.isActive, order: l.order }));
    return reply.send({ own, inherited });
  } catch (error) {
    console.error('Error fetching category sources (public):', error);
    return reply.status(500).send({ error: 'Failed to fetch category sources' });
  }
}
