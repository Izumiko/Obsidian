import { FastifyRequest, FastifyReply } from 'fastify';
import { createNotification } from '../../services/notificationService.js';
import crypto from 'crypto';
import { sendEmail, getFrontendBaseUrl } from '../../utils/sendEmail.js';
import { getVerificationEmail } from '../../utils/emailTemplates/verificationEmail.js';
// import { getResetPasswordEmail } from '../../utils/emailTemplates/resetPasswordEmail.js';
import { randomUUID } from 'crypto';
import { getPeerBanEmail } from '../../utils/emailTemplates/peerBanEmail.js';
import { getUserBanEmail, getUserUnbanEmail } from '../../utils/emailTemplates/userBanEmail.js';
import { getPromotionEmail, getDemotionEmail } from '../../utils/emailTemplates/promotionEmail.js';
import { getRssBannedEmail, getRssUnbannedEmail } from '../../utils/emailTemplates/rssBanEmail.js';
import { db } from '../../lib/prisma.js';
import { convertBigInts } from '../../lib/serialization.js';
import { toTimestamp } from '../../lib/timestamps.js';
import { or } from '@prisma/orm-postgres/orm-client';

function isAdminOrOwner(user: any) {
  return user && (user.role === 'ADMIN' || user.role === 'OWNER' || user.role === 'FOUNDER');
}

function isOwnerOrFounder(user: any) {
  return user && (user.role === 'OWNER' || user.role === 'FOUNDER');
}

function isFounder(user: any) {
  return user && user.role === 'FOUNDER';
}

export async function banUserHandler(request: FastifyRequest, reply: FastifyReply) {
  const user = (request as any).user;
  if (!isAdminOrOwner(user)) return reply.status(403).send({ error: 'Forbidden' });
  const { id } = request.params as any;
  const updated = await db.orm.public.User.where({ id }).update({ status: 'BANNED' });
  if (!updated) throw new Error('User not found');
  const bannedUser = await db.orm.public.User.where({ id }).first();
  if (bannedUser) {
    const { text, html } = getUserBanEmail({ username: bannedUser.username });
    await createNotification({
      userId: bannedUser.id,
      type: 'ban',
      message: 'Your account has been banned by an administrator.',
      sendEmail: true,
      email: bannedUser.email,
      emailSubject: 'Your account has been banned',
      emailText: text,
      emailHtml: html
    });
  }
  return reply.send({ success: true, user: convertBigInts(updated) });
}

export async function unbanUserHandler(request: FastifyRequest, reply: FastifyReply) {
  const user = (request as any).user;
  if (!isAdminOrOwner(user)) return reply.status(403).send({ error: 'Forbidden' });
  const { id } = request.params as any;
  const updated = await db.orm.public.User.where({ id }).update({ status: 'ACTIVE' });
  if (!updated) throw new Error('User not found');
  const unbannedUser = await db.orm.public.User.where({ id }).first();
  if (unbannedUser) {
    const { text, html } = getUserUnbanEmail({ username: unbannedUser.username });
    await createNotification({
      userId: unbannedUser.id,
      type: 'unban',
      message: 'Your account has been unbanned by an administrator.',
      sendEmail: true,
      email: unbannedUser.email,
      emailSubject: 'Your account has been unbanned',
      emailText: text,
      emailHtml: html
    });
  }
  return reply.send({ success: true, user: convertBigInts(updated) });
}

export async function promoteUserHandler(request: FastifyRequest, reply: FastifyReply) {
  const user = (request as any).user;
  if (!isAdminOrOwner(user)) return reply.status(403).send({ error: 'Forbidden' });
  const { id } = request.params as any;
  const { role } = request.body as any;
  
  // Validate role
  if (!role || !['MOD', 'ADMIN', 'OWNER'].includes(role)) {
    return reply.status(400).send({ error: 'Invalid role. Can only promote to MOD, ADMIN, or OWNER' });
  }
  
  // Get target user
  const targetUser = await db.orm.public.User.where({ id }).first();
  if (!targetUser) return reply.status(404).send({ error: 'User not found' });
  
  // Check if target is already OWNER or FOUNDER
  if (targetUser.role === 'OWNER' || targetUser.role === 'FOUNDER') {
    return reply.status(400).send({ error: 'Cannot promote OWNER or FOUNDER' });
  }
  
  // Only OWNER or FOUNDER can promote to ADMIN
  if (role === 'ADMIN' && !isOwnerOrFounder(user)) {
    return reply.status(403).send({ error: 'Only owners or founders can promote users to ADMIN' });
  }
  
  // Only FOUNDER can promote to OWNER
  if (role === 'OWNER' && !isFounder(user)) {
    return reply.status(403).send({ error: 'Only founders can promote users to OWNER' });
  }
  
  // NO ONE can be promoted to FOUNDER - only role transfer allowed
  if (role === 'FOUNDER') {
    return reply.status(400).send({ error: 'Cannot promote to FOUNDER. Use role transfer instead.' });
  }
  
  const updated = await db.orm.public.User.where({ id }).update({ role });
  if (!updated) throw new Error('User not found');
  // Notify promoted user
  const promotedUser = await db.orm.public.User.where({ id }).first();
  if (promotedUser) {
    const { text, html } = getPromotionEmail({ username: promotedUser.username, newRole: role });
    await createNotification({
      userId: promotedUser.id,
      type: 'promotion',
      message: `You have been promoted to ${role}.`,
      sendEmail: true,
      email: promotedUser.email,
      emailSubject: `You have been promoted to ${role}`,
      emailText: text,
      emailHtml: html
    });
  }
  return reply.send({ success: true, user: convertBigInts(updated) });
}

export async function demoteUserHandler(request: FastifyRequest, reply: FastifyReply) {
  const user = (request as any).user;
  if (!isAdminOrOwner(user)) return reply.status(403).send({ error: 'Forbidden' });
  const { id } = request.params as any;
  const { role } = request.body as any;
  const target = await db.orm.public.User.where({ id }).first();
  if (!target) return reply.status(404).send({ error: 'User not found' });
  
  // Validate target role
  if (!role || !['USER', 'MOD', 'ADMIN'].includes(role)) {
    return reply.status(400).send({ error: 'Invalid target role. Can only demote to USER, MOD, or ADMIN' });
  }
  
  // Cannot demote FOUNDER
  if (target.role === 'FOUNDER') {
    return reply.status(400).send({ error: 'Cannot demote FOUNDER' });
  }
  
  // Only FOUNDER can demote OWNER
  if (target.role === 'OWNER' && !isFounder(user)) {
    return reply.status(403).send({ error: 'Only founders can demote OWNER users' });
  }
  
  // Only OWNER or FOUNDER can demote ADMIN
  if (target.role === 'ADMIN' && !isOwnerOrFounder(user)) {
    return reply.status(403).send({ error: 'Only owners or founders can demote ADMIN users' });
  }
  
  // Validate demotion target role
  if (target.role === 'OWNER' && role !== 'ADMIN') {
    return reply.status(400).send({ error: 'Owners can only be demoted to ADMIN' });
  }
  
  if (target.role === 'ADMIN' && role !== 'MOD') {
    return reply.status(400).send({ error: 'Admins can only be demoted to MOD' });
  }
  
  if (target.role === 'MOD' && role !== 'USER') {
    return reply.status(400).send({ error: 'Moderators can only be demoted to USER' });
  }
  
  const updated = await db.orm.public.User.where({ id }).update({ role });
  if (!updated) throw new Error('User not found');
  // Notify demoted user
  if (target) {
    const { text, html } = getDemotionEmail({ username: target.username, oldRole: target.role });
    await createNotification({
      userId: target.id,
      type: 'demotion',
      message: `You have been demoted from ${target.role}.`,
      sendEmail: true,
      email: target.email,
      emailSubject: `You have been demoted from ${target.role}`,
      emailText: text,
      emailHtml: html
    });
  }
  return reply.send({ success: true, user: convertBigInts(updated) });
}

export async function transferFounderRoleHandler(request: FastifyRequest, reply: FastifyReply) {
  const user = (request as any).user;
  if (!isFounder(user)) return reply.status(403).send({ error: 'Only founders can transfer founder role' });
  
  const { targetUserId } = request.body as any;
  if (!targetUserId) return reply.status(400).send({ error: 'Target user ID is required' });
  
  // Get target user
  const targetUser = await db.orm.public.User.where({ id: targetUserId }).first();
  if (!targetUser) return reply.status(404).send({ error: 'Target user not found' });
  
  // Cannot transfer to yourself
  if (targetUserId === user.id) {
    return reply.status(400).send({ error: 'Cannot transfer founder role to yourself' });
  }
  
  // Check if there are other founders (should only be one)
  const founderCount: any = (await db.orm.public.User
    .where({ role: 'FOUNDER' })
    .aggregate((a: any) => ({ n: a.count() }))).n;
  if (founderCount > 1) {
    return reply.status(400).send({ error: 'Multiple founders detected. Please resolve this before transferring.' });
  }
  
  // Transfer founder role
  const [newFounder, oldFounder] = await Promise.all([
    db.orm.public.User.where({ id: targetUserId }).update({ role: 'FOUNDER' }),
    db.orm.public.User.where({ id: user.id }).update({ role: 'OWNER' })
  ]);
  if (!newFounder || !oldFounder) throw new Error('User not found');
  
  // Notify both users
  await Promise.all([
    createNotification({
      userId: newFounder.id,
      type: 'promotion',
      message: 'You have been promoted to FOUNDER.',
      sendEmail: true,
      email: newFounder.email,
      emailSubject: 'You are now the Founder',
      emailText: `Congratulations! You are now the Founder of the system.`,
      emailHtml: `<div>Congratulations! You are now the Founder of the system.</div>`
    }),
    createNotification({
      userId: oldFounder.id,
      type: 'demotion',
      message: 'You have transferred your founder role to another user.',
      sendEmail: true,
      email: oldFounder.email,
      emailSubject: 'Founder Role Transferred',
      emailText: `You have transferred your founder role to ${newFounder.username}.`,
      emailHtml: `<div>You have transferred your founder role to ${newFounder.username}.</div>`
    })
  ]);
  
  return reply.send({ 
    success: true, 
    message: 'Founder role transferred successfully',
    newFounder: convertBigInts(newFounder),
    oldFounder: convertBigInts(oldFounder)
  });
}

export async function listPeerBans(request: FastifyRequest, reply: FastifyReply) {
  const user = (request as any).user;
  if (!isAdminOrOwner(user)) return reply.status(403).send({ error: 'Forbidden' });
  const { active, type, value } = (request.query as any) || {};
  let query: any = db.orm.public.PeerBan;
  if (active === 'true') {
    const now = toTimestamp(new Date().toISOString());
    query = query.where((b: any) => or(b.expiresAt.isNull(), b.expiresAt.gt(now)));
  }
  if (active === 'false') {
    const now = toTimestamp(new Date().toISOString());
    query = query.where((b: any) => b.expiresAt.lte(now));
  }
  if (type && ['userId', 'passkey', 'peerId', 'ip'].includes(type as string) && value) {
    query = query.where({ [type as string]: value });
  }
  const bans = await query
    .orderBy((b: any) => b.createdAt.desc())
    .include('bannedBy', (u: any) => u.select('id', 'username', 'role'))
    .all();
  return reply.send(convertBigInts(bans));
}

export async function getPeerBan(request: FastifyRequest, reply: FastifyReply) {
  const user = (request as any).user;
  if (!isAdminOrOwner(user)) return reply.status(403).send({ error: 'Forbidden' });
  const { id } = request.params as any;
  const ban = await db.orm.public.PeerBan
    .where({ id })
    .include('bannedBy', (u: any) => u.select('id', 'username', 'role'))
    .first();
  if (!ban) return reply.status(404).send({ error: 'Ban not found' });
  return reply.send(convertBigInts(ban));
}

export async function addPeerBan(request: FastifyRequest, reply: FastifyReply) {
  const user = (request as any).user;
  if (!isAdminOrOwner(user)) return reply.status(403).send({ error: 'Forbidden' });
  const { userId, passkey, peerId, ip, reason, expiresAt } = (request.body as any) || {};
  if (!reason || (!userId && !passkey && !peerId && !ip)) {
    return reply.status(400).send({ error: 'Must provide reason and at least one of userId, passkey, peerId, or ip' });
  }
  const ban = await db.orm.public.PeerBan.create({
    userId,
    passkey,
    peerId,
    ip,
    reason,
    expiresAt: expiresAt ? toTimestamp(new Date(expiresAt).toISOString()) : null,
    bannedById: user.id
  });
  // Notify affected user (if userId is present)
  if (userId) {
    const bannedUser = await db.orm.public.User.where({ id: userId }).first();
    if (bannedUser) {
      const { text, html } = getPeerBanEmail({
        username: bannedUser.username,
        reason,
        expiresAt: expiresAt ? new Date(expiresAt) : undefined
      });
      await createNotification({
        userId: bannedUser.id,
        type: 'ban',
        message: `You have been banned: ${reason}${expiresAt ? ", expires at " + new Date(expiresAt).toLocaleString() : ''}`,
        adminId: user.id,
        relatedBanId: ban.id,
        sendEmail: true,
        email: bannedUser.email,
        emailSubject: 'You have been banned from the tracker',
        emailText: text,
        emailHtml: html
      });
      // Notify all admins/owners/founders
      const admins = await db.orm.public.User
        .where((u: any) => or(u.role.eq('ADMIN' as any), u.role.eq('OWNER' as any), u.role.eq('FOUNDER' as any)))
        .all();
      for (const admin of admins) {
        await createNotification({
          userId: admin.id,
          type: 'ban',
          message: `User ${bannedUser.username || bannedUser.email || bannedUser.id} was banned by ${user.username}: ${reason}${expiresAt ? ", expires at " + new Date(expiresAt).toLocaleString() : ''}`,
          adminId: user.id,
          relatedBanId: ban.id,
          sendEmail: false
        });
      }
    }
  }
  return reply.status(201).send(convertBigInts(ban));
}

export async function removePeerBan(request: FastifyRequest, reply: FastifyReply) {
  const user = (request as any).user;
  if (!isAdminOrOwner(user)) return reply.status(403).send({ error: 'Forbidden' });
  const { id } = request.params as any;
  const ban = await db.orm.public.PeerBan.where({ id }).first();
  if (!ban) return reply.status(404).send({ error: 'Ban not found' });
  const deleted = await db.orm.public.PeerBan.where({ id }).delete();
  if (!deleted) throw new Error('Ban not found');
  // Notify affected user (if userId is present)
  if (ban.userId) {
    const bannedUser = await db.orm.public.User.where({ id: ban.userId }).first();
    if (bannedUser) {
      // Unban email (simple text for now)
      await createNotification({
        userId: bannedUser.id,
        type: 'unban',
        message: `You have been unbanned by admin ${user.username}.`,
        adminId: user.id,
        relatedBanId: ban.id,
        sendEmail: true,
        email: bannedUser.email,
        emailSubject: 'You have been unbanned',
        emailText: `Dear ${bannedUser.username},\n\nYou have been unbanned by admin ${user.username}. You may now use the tracker again.`,
        emailHtml: `<div style='font-family:sans-serif;color:#222;'><h2>You have been unbanned</h2><p>Dear <b>${bannedUser.username}</b>,</p><p>You have been unbanned by admin <b>${user.username}</b>. You may now use the tracker again.</p></div>`
      });
      // Notify all admins/owners/founders
      const admins = await db.orm.public.User
        .where((u: any) => or(u.role.eq('ADMIN' as any), u.role.eq('OWNER' as any), u.role.eq('FOUNDER' as any)))
        .all();
      for (const admin of admins) {
        await createNotification({
          userId: admin.id,
          type: 'unban',
          message: `User ${bannedUser.username || bannedUser.email || bannedUser.id} was unbanned by ${user.username}.`,
          adminId: user.id,
          relatedBanId: ban.id,
          sendEmail: false
        });
      }
    }
  }
  return reply.send({ success: true });
}

export async function adminSetRssEnabledHandler(request: FastifyRequest, reply: FastifyReply) {
  const admin = (request as any).user;
  if (!isAdminOrOwner(admin)) return reply.status(403).send({ error: 'Forbidden' });
  const { id } = request.params as any;
  const { enabled } = request.body as any;
  if (typeof enabled !== 'boolean') return reply.status(400).send({ error: 'enabled must be boolean' });
  const updated = await db.orm.public.User.where({ id }).update({ rssEnabled: enabled });
  if (!updated) throw new Error('User not found');
  // Notify user
  const user = await db.orm.public.User.where({ id }).first();
  if (user) {
    if (!enabled) {
      const { text, html } = getRssBannedEmail({ username: user.username });
      await createNotification({
        userId: user.id,
        type: 'rss_banned',
        message: 'Your RSS access has been disabled by an administrator.',
        sendEmail: true,
        email: user.email,
        emailSubject: 'Your RSS access has been disabled',
        emailText: text,
        emailHtml: html
      });
    } else {
      const { text, html } = getRssUnbannedEmail({ username: user.username });
      await createNotification({
        userId: user.id,
        type: 'rss_unbanned',
        message: 'Your RSS access has been re-enabled by an administrator.',
        sendEmail: true,
        email: user.email,
        emailSubject: 'Your RSS access has been enabled',
        emailText: text,
        emailHtml: html
      });
    }
  }
  return reply.send({ success: true, user: convertBigInts(updated) });
}

export async function adminResetRssTokenHandler(request: FastifyRequest, reply: FastifyReply) {
  const admin = (request as any).user;
  if (!isAdminOrOwner(admin)) return reply.status(403).send({ error: 'Forbidden' });
  const { id } = request.params as any;
  const newToken = crypto.randomUUID().replace(/-/g, '');
  const updated = await db.orm.public.User.where({ id }).update({ rssToken: newToken });
  if (!updated) throw new Error('User not found');
  return reply.send({ success: true, user: convertBigInts(updated) });
}

export async function listAllUsersHandler(request: FastifyRequest, reply: FastifyReply) {
  const user = (request as any).user;
  if (!isAdminOrOwner(user)) return reply.status(403).send({ error: 'Forbidden' });
  const { page = 1, limit = 20, q } = (request.query as any) || {};
  const skip = (Number(page) - 1) * Number(limit);
  let query: any = db.orm.public.User;
  if (q) {
    query = query.where((m: any) => or(m.username.ilike(`%${q}%`), m.email.ilike(`%${q}%`)));
  }
  const [users, totalResult] = await Promise.all([
    query
      .offset(skip)
      .limit(Number(limit))
      .orderBy((m: any) => m.createdAt.desc())
      .select('id', 'username', 'email', 'role', 'status', 'createdAt', 'emailVerified', 'rssEnabled', 'rssToken')
      .all(),
    query.aggregate((a: any) => ({ n: a.count() }))
  ]);
  return reply.send(convertBigInts({ users, total: totalResult.n, page: Number(page), limit: Number(limit) }));
}

export async function updateUserEmailHandler(request: FastifyRequest, reply: FastifyReply) {
  const user = (request as any).user;
  if (!isAdminOrOwner(user)) return reply.status(403).send({ error: 'Forbidden' });
  const { id } = request.params as any;
  const { email } = request.body as any;
  if (!email || typeof email !== 'string') return reply.status(400).send({ error: 'Invalid email' });
  const existing = await db.orm.public.User.where({ email }).where((m: any) => m.id.neq(id)).first();
  if (existing) return reply.status(400).send({ error: 'Email already in use' });
  const oldUser = await db.orm.public.User.where({ id }).first();
  if (!oldUser) return reply.status(404).send({ error: 'User not found' });
  // Set email and emailVerified false
  const updated = await db.orm.public.User.where({ id }).update({ email, emailVerified: false });
  if (!updated) throw new Error('User not found');
  // Invalidate previous tokens
  const now = toTimestamp(new Date().toISOString());
  await db.orm.public.EmailVerificationToken
    .where({ userId: id, used: false })
    .where((t: any) => t.expiresAt.gt(now))
    .updateAndCount({ used: true });
  await db.orm.public.PasswordResetToken
    .where({ userId: id, used: false })
    .where((t: any) => t.expiresAt.gt(now))
    .updateAndCount({ used: true });
  // Generate new verification token
  const verifyToken = randomUUID();
  const verifyExpires = toTimestamp(new Date(Date.now() + 60 * 60 * 1000).toISOString());
  await db.orm.public.EmailVerificationToken.create({ userId: id, token: verifyToken, expiresAt: verifyExpires });
  // Generate new password reset token
  const resetToken = randomUUID();
  const resetExpires = toTimestamp(new Date(Date.now() + 60 * 60 * 1000).toISOString());
  await db.orm.public.PasswordResetToken.create({ userId: id, token: resetToken, expiresAt: resetExpires });
  // Build links
  const baseUrl = getFrontendBaseUrl();
  const verifyLink = `${baseUrl}/verify?token=${verifyToken}`;
  const resetLink = `${baseUrl}/reset-password?token=${resetToken}`;
  // Send security email to old email
  if (oldUser.email) {
    // const { text, html } = getResetPasswordEmail({ username: oldUser.username, link: resetLink });
    const securityText = `Your email was changed from ${oldUser.email} to ${email} by an admin.\nIf you did not request this, you can reset your password here: ${resetLink}`;
    const securityHtml = `<div style='font-family:sans-serif;color:#222;'><h2>Security Alert</h2><p>Your email was changed from <b>${oldUser.email}</b> to <b>${email}</b> by an admin.</p><p>If you did not request this, you can reset your password here:</p><p style='margin:32px 0;'><a href='${resetLink}' style='background:#2563eb;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;'>Reset Password</a></p></div>`;
    await sendEmail({ to: oldUser.email, subject: 'Security Alert: Your email was changed', text: securityText, html: securityHtml });
  }
  // Send verification email to new email
  const { text: vText, html: vHtml } = getVerificationEmail({ username: oldUser.username, link: verifyLink });
  await sendEmail({ to: email, subject: 'Verify your new email address', text: vText, html: vHtml });
  return reply.send({ success: true, user: convertBigInts(updated) });
}

export async function updateUserHandler(request: FastifyRequest, reply: FastifyReply) {
  const admin = (request as any).user;
  if (!isAdminOrOwner(admin)) return reply.status(403).send({ error: 'Forbidden' });
  const { id } = request.params as any;
  const { username, role, status, emailVerified } = request.body as any;
  
  // Check if user exists
  const existingUser = await db.orm.public.User.where({ id }).first();
  if (!existingUser) return reply.status(404).send({ error: 'User not found' });
  
  // Validate role permissions
  if (role && !['USER', 'MOD', 'ADMIN', 'OWNER', 'FOUNDER'].includes(role)) {
    return reply.status(400).send({ error: 'Invalid role' });
  }
  
  // Role change restrictions
  if (role && role !== existingUser.role) {
    // Only FOUNDER can assign FOUNDER role
    if (role === 'FOUNDER' && !isFounder(admin)) {
      return reply.status(403).send({ error: 'Only founders can assign FOUNDER role' });
    }
    
    // Only FOUNDER can assign OWNER role
    if (role === 'OWNER' && !isFounder(admin)) {
      return reply.status(403).send({ error: 'Only founders can assign OWNER role' });
    }
    
    // Only OWNER or FOUNDER can promote to ADMIN
    if (role === 'ADMIN' && !isOwnerOrFounder(admin)) {
      return reply.status(403).send({ error: 'Only owners or founders can promote users to ADMIN' });
    }
    
    // Only OWNER or FOUNDER can demote ADMIN
    if (existingUser.role === 'ADMIN' && !isOwnerOrFounder(admin)) {
      return reply.status(403).send({ error: 'Only owners or founders can demote ADMIN users' });
    }
    
    // Cannot demote FOUNDER
    if (existingUser.role === 'FOUNDER') {
      return reply.status(400).send({ error: 'Cannot demote FOUNDER' });
    }
    
    // Only FOUNDER can demote OWNER
    if (existingUser.role === 'OWNER' && !isFounder(admin)) {
      return reply.status(403).send({ error: 'Only founders can demote OWNER users' });
    }
  }
  
  // Only OWNER or FOUNDER can change usernames
  if (username && username !== existingUser.username) {
    if (!isOwnerOrFounder(admin)) {
      return reply.status(403).send({ error: 'Only owners or founders can change usernames' });
    }
  }
  
  // Check for username conflicts
  if (username && username !== existingUser.username) {
    const usernameExists = await db.orm.public.User.where({ username }).where((m: any) => m.id.neq(id)).first();
    if (usernameExists) return reply.status(400).send({ error: 'Username already in use' });
  }
  
  // Build update data
  const updateData: any = {};
  if (username && username !== existingUser.username) updateData.username = username;
  if (role && role !== existingUser.role) updateData.role = role;
  if (status && status !== existingUser.status) updateData.status = status;
  if (emailVerified !== undefined && emailVerified !== existingUser.emailVerified) {
    updateData.emailVerified = emailVerified;
  }
  
  // If no changes, return early
  if (Object.keys(updateData).length === 0) {
    return reply.send({ success: true, user: convertBigInts(existingUser), message: 'No changes to save' });
  }
  
  // Update user
  const updated = await db.orm.public.User.where({ id }).update(updateData);
  if (!updated) throw new Error('User not found');
  return reply.send({ success: true, user: convertBigInts(updated) });
} 
