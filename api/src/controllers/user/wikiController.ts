import { FastifyRequest, FastifyReply } from 'fastify';
import { or } from '@prisma/orm-postgres/orm-client';
import { db } from '../../lib/prisma.js';
import { convertBigInts } from '../../lib/serialization.js';

export async function listWikiPagesHandler(request: FastifyRequest, reply: FastifyReply) {
  const { q, page = 1, limit = 20 } = (request.query as any) || {};
  const skip = (Number(page) - 1) * Number(limit);
  const where: any = { visible: true };

  let query = db.orm.public.WikiPage.where(where);
  if (q) {
    query = query.where((m: any) => or(m.title.ilike(`%${q}%`), m.content.ilike(`%${q}%`)));
  }
  const [pages, totalResult] = await Promise.all([
    query
      .offset(skip)
      .limit(Number(limit))
      .orderBy((p: any) => p.createdAt.desc())
      .include('createdBy', (c: any) => c.select('id', 'username'))
      .include('updatedBy', (u: any) => u.select('id', 'username'))
      .include('parent', (p: any) => p.select('id', 'slug', 'title'))
      .include('children', (c: any) => c.select('id', 'slug', 'title'))
      .all(),
    query.aggregate((a: any) => ({ n: a.count() }))
  ]);
  const total = totalResult.n;
  return reply.send(convertBigInts({ pages, total, page: Number(page), limit: Number(limit) }));
}

export async function getWikiPageHandler(request: FastifyRequest, reply: FastifyReply) {
  const { slug } = request.params as any;
  const page = await db.orm.public.WikiPage
    .where({ slug })
    .include('createdBy', (c: any) => c.select('id', 'username'))
    .include('updatedBy', (u: any) => u.select('id', 'username'))
    .include('parent', (p: any) => p.select('id', 'slug', 'title'))
    .include('children', (c: any) => c.select('id', 'slug', 'title'))
    .first();
  if (!page || !page.visible) return reply.status(404).send({ error: 'Wiki page not found' });
  return reply.send(convertBigInts(page));
}
