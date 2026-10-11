import { FastifyRequest, FastifyReply } from 'fastify';
import { createNotification } from '../../services/notificationService.js';
import { getWikiCreatedEmail, getWikiUpdatedEmail } from '../../utils/emailTemplates/wikiEmail.js';
import { db } from '../../lib/prisma.js';
import { convertBigInts } from '../../lib/serialization.js';

function isAdminOrOwner(user: any) {
  return user && (user.role === 'ADMIN' || user.role === 'OWNER' || user.role === 'FOUNDER');
}

export async function createWikiPageHandler(request: FastifyRequest, reply: FastifyReply) {
  const user = (request as any).user;
  if (!isAdminOrOwner(user)) return reply.status(403).send({ error: 'Forbidden' });
  const { slug, title, content, parentId, visible, locked } = request.body as any;
  if (!slug || !title || !content) return reply.status(400).send({ error: 'slug, title, and content are required' });
  const page = await db.orm.public.WikiPage.create({
    slug, title, content, parentId, visible: visible !== false, locked: !!locked, createdById: user.id, updatedById: user.id
  });
  // Notify all users (including admins and owner) - non-blocking
  try {
    const users = await db.orm.public.User.where({ status: 'ACTIVE' }).select('id', 'username', 'email').all();
    await Promise.all(users.map(u => {
      const { text, html } = getWikiCreatedEmail({ username: u.username, title });
      return createNotification({
        userId: u.id,
        type: 'wiki_created',
        message: `New wiki page created: "${title}"`,
        sendEmail: true,
        email: u.email,
        emailSubject: `New wiki page: ${title}`,
        emailText: text,
        emailHtml: html
      });
    }));
  } catch (notificationError) {
    console.error('Error sending wiki creation notifications:', notificationError);
    // Don't fail the main operation if notifications fail
  }
  
  return reply.status(201).send(convertBigInts(page));
}

export async function updateWikiPageHandler(request: FastifyRequest, reply: FastifyReply) {
  const user = (request as any).user;
  if (!isAdminOrOwner(user)) return reply.status(403).send({ error: 'Forbidden' });
  const { id } = request.params as any;
  const { title, content, parentId, visible, locked } = request.body as any;
  const updated = await db.orm.public.WikiPage.where({ id }).update({
    title, content, parentId, visible, locked, updatedById: user.id
  });
  if (!updated) throw new Error('Wiki page not found');
  // Notify all users (including admins and owner) - non-blocking
  try {
    const users = await db.orm.public.User.where({ status: 'ACTIVE' }).select('id', 'username', 'email').all();
    await Promise.all(users.map(u => {
      const { text, html } = getWikiUpdatedEmail({ username: u.username, title });
      return createNotification({
        userId: u.id,
        type: 'wiki_updated',
        message: `Wiki page updated: "${title}"`,
        sendEmail: true,
        email: u.email,
        emailSubject: `Wiki page updated: ${title}`,
        emailText: text,
        emailHtml: html
      });
    }));
  } catch (notificationError) {
    console.error('Error sending wiki update notifications:', notificationError);
    // Don't fail the main operation if notifications fail
  }
  
  return reply.send(convertBigInts(updated));
}

export async function deleteWikiPageHandler(request: FastifyRequest, reply: FastifyReply) {
  const user = (request as any).user;
  if (!isAdminOrOwner(user)) return reply.status(403).send({ error: 'Forbidden' });
  const { id } = request.params as any;
  const deleted = await db.orm.public.WikiPage.where({ id }).delete();
  if (!deleted) throw new Error('Wiki page not found');
  return reply.send({ success: true });
}

export async function lockWikiPageHandler(request: FastifyRequest, reply: FastifyReply) {
  const user = (request as any).user;
  if (!isAdminOrOwner(user)) return reply.status(403).send({ error: 'Forbidden' });
  const { id } = request.params as any;
  const updated = await db.orm.public.WikiPage.where({ id }).update({ locked: true });
  if (!updated) throw new Error('Wiki page not found');
  return reply.send(convertBigInts(updated));
}

export async function unlockWikiPageHandler(request: FastifyRequest, reply: FastifyReply) {
  const user = (request as any).user;
  if (!isAdminOrOwner(user)) return reply.status(403).send({ error: 'Forbidden' });
  const { id } = request.params as any;
  const updated = await db.orm.public.WikiPage.where({ id }).update({ locked: false });
  if (!updated) throw new Error('Wiki page not found');
  return reply.send(convertBigInts(updated));
}

export async function showWikiPageHandler(request: FastifyRequest, reply: FastifyReply) {
  const user = (request as any).user;
  if (!isAdminOrOwner(user)) return reply.status(403).send({ error: 'Forbidden' });
  const { id } = request.params as any;
  const updated = await db.orm.public.WikiPage.where({ id }).update({ visible: true });
  if (!updated) throw new Error('Wiki page not found');
  return reply.send(convertBigInts(updated));
}

export async function hideWikiPageHandler(request: FastifyRequest, reply: FastifyReply) {
  const user = (request as any).user;
  if (!isAdminOrOwner(user)) return reply.status(403).send({ error: 'Forbidden' });
  const { id } = request.params as any;
  const updated = await db.orm.public.WikiPage.where({ id }).update({ visible: false });
  if (!updated) throw new Error('Wiki page not found');
  return reply.send(convertBigInts(updated));
} 

export async function listAllWikiPagesHandler(request: FastifyRequest, reply: FastifyReply) {
  const user = (request as any).user;
  if (!isAdminOrOwner(user)) return reply.status(403).send({ error: 'Forbidden' });
  const pages = await db.orm.public.WikiPage
    .orderBy((p) => p.createdAt.desc())
    .include('createdBy', (c) => c.select('id', 'username', 'role'))
    .include('updatedBy', (u) => u.select('id', 'username', 'role'))
    .all();
  return reply.send(convertBigInts(pages));
} 
