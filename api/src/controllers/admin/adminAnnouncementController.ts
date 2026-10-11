import { FastifyRequest, FastifyReply } from 'fastify';
import { db } from '../../lib/prisma.js';
import { convertBigInts } from '../../lib/serialization.js';
import { createNotification } from '../../services/notificationService.js';
import { getAnnouncementEmail } from '../../utils/emailTemplates/announcementEmail.js';

function isAdminOrOwner(user: any) {
  return user && (user.role === 'ADMIN' || user.role === 'OWNER' || user.role === 'FOUNDER');
}

export async function createAnnouncementHandler(request: FastifyRequest, reply: FastifyReply) {
  const user = (request as any).user;
  if (!isAdminOrOwner(user)) return reply.status(403).send({ error: 'Forbidden' });
  const { title, body, pinned, visible, sendEmail } = request.body as any;
  if (!title || !body) return reply.status(400).send({ error: 'Title and body are required' });
  const announcement = await db.orm.public.Announcement.create({
    title, body, pinned: !!pinned, visible: visible !== false, createdById: user.id
  });
  
  // Notify all users (including admins and owner) - only send emails if sendEmail is true
  const users = await db.orm.public.User.where({ status: 'ACTIVE' }).select('id', 'username', 'email').all();
  await Promise.all(users.map(u => {
    const { text, html } = getAnnouncementEmail({ username: u.username, title, body });
    return createNotification({
      userId: u.id,
      type: 'announcement',
      message: `New announcement: "${title}"`,
      sendEmail: !!sendEmail, // Only send email if sendEmail is explicitly true
      email: u.email,
      emailSubject: `New announcement: ${title}`,
      emailText: text,
      emailHtml: html
    });
  }));
  return reply.status(201).send(convertBigInts(announcement));
}

export async function updateAnnouncementHandler(request: FastifyRequest, reply: FastifyReply) {
  const user = (request as any).user;
  if (!isAdminOrOwner(user)) return reply.status(403).send({ error: 'Forbidden' });
  const { id } = request.params as any;
  const { title, body, pinned, visible } = request.body as any;
  const updated = await db.orm.public.Announcement.where({ id }).update({
    title, body, pinned, visible
  });
  if (!updated) throw new Error('Announcement not found');
  return reply.send(convertBigInts(updated));
}

export async function deleteAnnouncementHandler(request: FastifyRequest, reply: FastifyReply) {
  const user = (request as any).user;
  if (!isAdminOrOwner(user)) return reply.status(403).send({ error: 'Forbidden' });
  const { id } = request.params as any;
  const deleted = await db.orm.public.Announcement.where({ id }).delete();
  if (!deleted) throw new Error('Announcement not found');
  return reply.send({ success: true });
}

export async function pinAnnouncementHandler(request: FastifyRequest, reply: FastifyReply) {
  const user = (request as any).user;
  if (!isAdminOrOwner(user)) return reply.status(403).send({ error: 'Forbidden' });
  const { id } = request.params as any;
  const updated = await db.orm.public.Announcement.where({ id }).update({ pinned: true });
  if (!updated) throw new Error('Announcement not found');
  return reply.send(convertBigInts(updated));
}

export async function unpinAnnouncementHandler(request: FastifyRequest, reply: FastifyReply) {
  const user = (request as any).user;
  if (!isAdminOrOwner(user)) return reply.status(403).send({ error: 'Forbidden' });
  const { id } = request.params as any;
  const updated = await db.orm.public.Announcement.where({ id }).update({ pinned: false });
  if (!updated) throw new Error('Announcement not found');
  return reply.send(convertBigInts(updated));
}

export async function showAnnouncementHandler(request: FastifyRequest, reply: FastifyReply) {
  const user = (request as any).user;
  if (!isAdminOrOwner(user)) return reply.status(403).send({ error: 'Forbidden' });
  const { id } = request.params as any;
  const updated = await db.orm.public.Announcement.where({ id }).update({ visible: true });
  if (!updated) throw new Error('Announcement not found');
  return reply.send(convertBigInts(updated));
}

export async function hideAnnouncementHandler(request: FastifyRequest, reply: FastifyReply) {
  const user = (request as any).user;
  if (!isAdminOrOwner(user)) return reply.status(403).send({ error: 'Forbidden' });
  const { id } = request.params as any;
  const updated = await db.orm.public.Announcement.where({ id }).update({ visible: false });
  if (!updated) throw new Error('Announcement not found');
  return reply.send(convertBigInts(updated));
} 

export async function listAllAnnouncementsHandler(request: FastifyRequest, reply: FastifyReply) {
  const user = (request as any).user;
  if (!isAdminOrOwner(user)) return reply.status(403).send({ error: 'Forbidden' });
  const { page = 1, limit = 100 } = (request.query as any) || {};
  const skip = (Number(page) - 1) * Number(limit);
  const take = Number(limit);

  // The v8 field accessor cannot order by a boolean column, so the ordered page
  // of ids is resolved with raw SQL (`pinned DESC, createdAt DESC`) and the rows
  // are then loaded through the ORM with their `createdBy` relation.
  const idPlan = db.raw.sql`
    SELECT "id" FROM "Announcement"
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
    db.orm.public.Announcement.aggregate((a: any) => ({ n: a.count() }))
  ]);
  const byId = new Map(rows.map((r: any) => [r.id, r]));
  const announcements = ids.map((id: string) => byId.get(id)).filter(Boolean);

  return reply.send(convertBigInts({ announcements, total: totalResult.n, page: Number(page), limit: take }));
} 