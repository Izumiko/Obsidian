import { FastifyRequest, FastifyReply } from 'fastify';
import { db } from '../../lib/prisma.js';
import { convertBigInts } from '../../lib/serialization.js';
import { or } from '@prisma/orm-postgres/orm-client';

function isAdminOrOwner(user: any) {
  return user && (user.role === 'ADMIN' || user.role === 'OWNER' || user.role === 'FOUNDER');
}

export async function getAdminNotificationsHandler(request: FastifyRequest, reply: FastifyReply) {
  const user = (request as any).user;
  if (!isAdminOrOwner(user)) return reply.status(403).send({ error: 'Forbidden' });

  const { page = 1, limit = 50, unread } = (request.query as any) || {};
  const skip = (Number(page) - 1) * Number(limit);

  // Show notifications for this admin, or system/mod/report/ban/unban types
  let query: any = db.orm.public.Notification.where((n: any) =>
    or(n.adminId.eq(user.id), n.type.in(['system', 'report', 'mod', 'ban', 'unban']))
  );
  if (unread === 'true') query = query.where({ read: false });

  const [notifications, total] = await Promise.all([
    query.orderBy((n: any) => n.createdAt.desc()).offset(skip).limit(Number(limit)).all(),
    query.aggregate((a: any) => ({ n: a.count() }))
  ]);

  return reply.send(convertBigInts({ notifications, total: total.n, page: Number(page), limit: Number(limit) }));
}
