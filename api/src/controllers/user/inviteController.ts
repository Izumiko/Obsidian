import { FastifyReply, FastifyRequest } from 'fastify';
import { getConfig } from '../../services/configService.js';
import { randomUUID } from 'crypto';
import { or } from '@prisma/orm-postgres/orm-client';

import { db } from '../../lib/prisma.js';
import { toTimestamp, parseTimestamp } from '../../lib/timestamps.js';
import { convertBigInts } from '../../lib/serialization.js';

export async function listUserInvitesHandler(request: FastifyRequest, reply: FastifyReply) {
  const authUser = (request as any).user;
  if (!authUser) return reply.status(401).send({ error: 'Unauthorized' });
  const config = await getConfig() as any;
  // If server is not in INVITE mode, immediately cancel active invites and refund
  if (config.registrationMode !== 'INVITE') {
    const now = toTimestamp(new Date().toISOString());
    await db.orm.public.Invite
      .where({ createdById: authUser.id, usedById: null })
      .where((i: any) => or(i.expiresAt.isNull(), i.expiresAt.gt(now)))
      .deleteAndCount();
  }
  const invites = await db.orm.public.Invite
    .where({ createdById: authUser.id })
    .orderBy((i: any) => i.createdAt.desc())
    .all();
  const isStaff = authUser.role === 'ADMIN' || authUser.role === 'OWNER' || authUser.role === 'FOUNDER';
  const maxInvitesPerUser = isStaff ? Number.POSITIVE_INFINITY : (config.maxInvitesPerUser ?? 5);
  const activeCount = invites.filter(i => !i.usedById && (!i.expiresAt || parseTimestamp(i.expiresAt) > Date.now())).length;
  const availableInvites = isStaff ? 999999 : Math.max(0, (maxInvitesPerUser as number) - activeCount);
  return reply.send(convertBigInts({ invites, availableInvites, maxInvitesPerUser: isStaff ? '∞' : maxInvitesPerUser, registrationMode: config.registrationMode }));
}

export async function createInviteHandler(request: FastifyRequest, reply: FastifyReply) {
  const authUser = (request as any).user;
  if (!authUser) return reply.status(401).send({ error: 'Unauthorized' });
  const config = await getConfig() as any;
  if (config.registrationMode !== 'INVITE') {
    return reply.status(403).send({ error: 'Invitations are disabled by registration mode.' });
  }
  const isStaff = authUser.role === 'ADMIN' || authUser.role === 'OWNER' || authUser.role === 'FOUNDER';
  const maxInvitesPerUser = isStaff ? Number.POSITIVE_INFINITY : (config.maxInvitesPerUser ?? 5);
  const expiryHours = config.inviteExpiryHours ?? 6;
  const now = new Date();
  const activeResult = await db.orm.public.Invite
    .where({ createdById: authUser.id, usedById: null })
    .where((i: any) => or(i.expiresAt.isNull(), i.expiresAt.gt(toTimestamp(now.toISOString()))))
    .aggregate((a: any) => ({ n: a.count() }));
  const activeCount = Number(activeResult.n);
  if (!isStaff && activeCount >= (maxInvitesPerUser as number)) {
    return reply.status(400).send({ error: 'Maximum active invites reached' });
  }
  const code = randomUUID().replace(/-/g, '').slice(0, 16);
  const invite = await db.orm.public.Invite.create({
    code,
    createdById: authUser.id,
    // Todos los enlaces usan la expiración del sistema, incluso para STAFF
    expiresAt: toTimestamp(new Date(now.getTime() + expiryHours * 60 * 60 * 1000).toISOString()),
  });
  return reply.send(convertBigInts({ invite, inviteLink: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/auth/signup/${code}` }));
}

export async function cancelInviteHandler(request: FastifyRequest, reply: FastifyReply) {
  const authUser = (request as any).user;
  if (!authUser) return reply.status(401).send({ error: 'Unauthorized' });
  const id = (request.query as any).id || (request.params as any).id;
  if (!id) return reply.status(400).send({ error: 'Missing invite id' });
  const invite = await db.orm.public.Invite.where({ id }).first();
  if (!invite || invite.createdById !== authUser.id) {
    return reply.status(404).send({ error: 'Invite not found' });
  }
  const deleted = await db.orm.public.Invite.where({ id }).delete();
  if (!deleted) throw new Error('Invite not found');
  return reply.send({ success: true });
}

// Public endpoint: get invite details by code (no auth)
export async function getInviteByCodePublicHandler(request: FastifyRequest, reply: FastifyReply) {
  const { code } = request.params as any;
  if (!code) return reply.status(400).send({ error: 'Missing invite code' });
  const invite = await db.orm.public.Invite
    .where({ code })
    .include('createdBy', (c: any) => c.select('id', 'username'))
    .first();
  if (!invite) return reply.status(404).send({ valid: false, error: 'Invite not found' });
  const isExpired = !!invite.expiresAt && parseTimestamp(invite.expiresAt) <= Date.now();
  const isUsed = !!invite.usedById;
  const valid = !isExpired && !isUsed;
  return reply.send(convertBigInts({
    valid,
    code: invite.code,
    createdAt: invite.createdAt,
    expiresAt: invite.expiresAt,
    createdBy: invite.createdBy,
    usedById: invite.usedById,
  }));
}
