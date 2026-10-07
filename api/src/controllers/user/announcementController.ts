import { FastifyRequest, FastifyReply } from 'fastify';
import { db } from '../../lib/prisma.js';
import { convertBigInts } from '../../lib/serialization.js';

export async function listAnnouncementsHandler(request: FastifyRequest, reply: FastifyReply) {
  const { pinned, visible, page = 1, limit = 20 } = (request.query as any) || {};
  const skip = (Number(page) - 1) * Number(limit);
  const take = Number(limit);
  const where: any = {};
  if (pinned !== undefined) where.pinned = pinned === 'true';
  if (visible !== undefined) where.visible = visible === 'true';
  else where.visible = true;

  // The v8 field accessor cannot order by a boolean column, so the ordered page
  // of ids is resolved with raw SQL (`pinned DESC, createdAt DESC`) and the rows
  // are then loaded through the ORM with their `createdBy` relation.
  const idPlan = where.pinned !== undefined
    ? db.raw.sql`
        SELECT "id" FROM "Announcement"
        WHERE "pinned" = ${where.pinned} AND "visible" = ${where.visible}
        ORDER BY "pinned" DESC, "createdAt" DESC
        OFFSET ${skip} LIMIT ${take}
      `.returnsRow({ id: 'pg/text@1' }).build()
    : db.raw.sql`
        SELECT "id" FROM "Announcement"
        WHERE "visible" = ${where.visible}
        ORDER BY "pinned" DESC, "createdAt" DESC
        OFFSET ${skip} LIMIT ${take}
      `.returnsRow({ id: 'pg/text@1' }).build();
  const idRows = await db.runtime().query(idPlan);
  const ids = idRows.map((r: any) => r.id);

  const [rows, totalResult] = await Promise.all([
    ids.length > 0
      ? db.orm.public.Announcement
          .where((a: any) => a.id.in(ids))
          .include('createdBy', (c: any) => c.select('id', 'username', 'role'))
          .all()
      : Promise.resolve([] as any[]),
    db.orm.public.Announcement.where(where).aggregate((a: any) => ({ n: a.count() })),
  ]);
  const byId = new Map(rows.map((r: any) => [r.id, r]));
  const announcements = ids.map((id: string) => byId.get(id)).filter(Boolean);

  return reply.send(convertBigInts({ announcements, total: totalResult.n, page: Number(page), limit: take }));
}

export async function getAnnouncementHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as any;
  const ann = await db.orm.public.Announcement
    .where({ id })
    .include('createdBy', (c: any) => c.select('id', 'username', 'role'))
    .first();
  if (!ann || !ann.visible) return reply.status(404).send({ error: 'Announcement not found' });
  return reply.send(convertBigInts(ann));
}
