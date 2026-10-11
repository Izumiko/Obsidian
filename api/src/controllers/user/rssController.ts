import { FastifyRequest, FastifyReply } from 'fastify';
import XMLBuilder from 'fast-xml-builder';
import crypto from 'crypto';
import { or } from '@prisma/orm-postgres/orm-client';
import { db } from '../../lib/prisma.js';
import { toTimestamp, parseTimestamp } from '../../lib/timestamps.js';

export async function rssFeedHandler(request: FastifyRequest, reply: FastifyReply) {
  const { token } = request.params as { token: string };
  const { q, category, count, bookmarks } = request.query as { q?: string; category?: string; count?: string; bookmarks?: string };

  // Authenticate user by RSS token
  const user = await db.orm.public.User.where({ rssToken: token, rssEnabled: true }).first();
  if (!user || user.status !== 'ACTIVE') return reply.status(401).send('Invalid or disabled RSS token');

  // Get config for default count
  const config = await db.orm.public.Config.first();
  const maxCount = config?.rssDefaultCount || 20;
  const take = Math.min(Number(count) || maxCount, maxCount);

  let torrents: any[];
  if (bookmarks === 'true') {
    // Fetch only torrents bookmarked by the user
    const bookmarked = await db.orm.public.Bookmark
      .where({ userId: user.id })
      .select('torrentId')
      .all();
    const torrentIds = bookmarked.map((b: { torrentId: string }) => b.torrentId);
    if (torrentIds.length === 0) {
      torrents = [];
    } else {
      let query = db.orm.public.Torrent.where({ isApproved: true });
      query = query.where((m: any) => m.id.in(torrentIds));
      if (q) {
        query = query.where((m: any) => or(m.name.ilike(`%${q}%`), m.description.ilike(`%${q}%`)));
      }
      if (category) {
        query = query.where({ categoryId: category });
      }
      torrents = await query
        .limit(take)
        .orderBy((m: any) => m.createdAt.desc())
        .select('id', 'name', 'description', 'infoHash', 'createdAt')
        .all();
    }
  } else {
    // Normal filter (not bookmarks)
    let query = db.orm.public.Torrent.where({ isApproved: true });
    if (q) {
      query = query.where((m: any) => or(m.name.ilike(`%${q}%`), m.description.ilike(`%${q}%`)));
    }
    if (category) {
      query = query.where({ categoryId: category });
    }
    torrents = await query
      .limit(take)
      .orderBy((m: any) => m.createdAt.desc())
      .select('id', 'name', 'description', 'infoHash', 'createdAt')
      .all();
  }

  // Build RSS feed with secure download token links
  type Torrent = { id: string; name: string; description?: string | null; infoHash: string; createdAt: string };
  const items = await Promise.all((torrents as Torrent[]).map(async (torrent: Torrent) => {
    // Generate download token for each torrent
    const downloadToken = await db.orm.public.DownloadToken.create({
      token: crypto.randomUUID(),
      userId: user.id,
      torrentId: torrent.id,
      expiresAt: toTimestamp(new Date(Date.now() + 5 * 60 * 1000).toISOString()) // 5 minutes
    });

    const baseUrl = process.env.API_BASE_URL || 'http://localhost:3001';
    const downloadUrl = `${baseUrl}/torrent/${torrent.id}/download-secure?token=${downloadToken.token}`;

    return {
      title: torrent.name,
      link: downloadUrl,
      description: torrent.description || '',
      pubDate: new Date(parseTimestamp(torrent.createdAt)).toUTCString(),
      infoHash: torrent.infoHash,
      enclosure: {
        '@_url': downloadUrl,
        '@_type': 'application/x-bittorrent',
        '@_length': '0'
      }
    };
  }));

  const feed = {
    rss: {
      '@_version': '2.0',
      channel: {
        title: 'Latest Torrents',
        link: process.env.FRONTEND_URL || 'http://localhost:3000',
        description: 'Latest torrents from the tracker',
        pubDate: new Date().toUTCString(),
        item: items
      }
    }
  };

  const builder = new XMLBuilder({ ignoreAttributes: false, format: true });
  const xml = builder.build(feed);
  reply.header('Content-Type', 'application/rss+xml; charset=utf-8');
  return reply.send(xml);
}

export async function getRssTokenHandler(request: FastifyRequest, reply: FastifyReply) {
  const user = (request as any).user;
  if (!user) return reply.status(401).send({ error: 'Unauthorized' });
  let updatedUser = await db.orm.public.User.where({ id: user.id }).first();
  if (!updatedUser?.rssToken) {
    const rssToken = crypto.randomUUID().replace(/-/g, '');
    updatedUser = await db.orm.public.User.where({ id: user.id }).update({ rssToken });
    if (!updatedUser) throw new Error('User not found');
  }
  return reply.send({ rssToken: updatedUser.rssToken, rssEnabled: updatedUser.rssEnabled });
}

export async function regenerateRssTokenHandler(request: FastifyRequest, reply: FastifyReply) {
  const user = (request as any).user;
  if (!user) return reply.status(401).send({ error: 'Unauthorized' });
  const rssToken = crypto.randomUUID().replace(/-/g, '');
  const updated = await db.orm.public.User.where({ id: user.id }).update({ rssToken });
  if (!updated) throw new Error('User not found');
  return reply.send({ rssToken });
}
