import { FastifyRequest, FastifyReply } from 'fastify';
import { db } from '../lib/prisma.js';
import { or } from '@prisma/orm-postgres/orm-client';
import { toTimestamp, parseTimestamp } from '../lib/timestamps.js';
import { UserRole } from '../generated/prisma/client.js';
import { getConfig, isFirstUser } from '../services/configService.js';
import jwt from 'jsonwebtoken';
import { sendEmail, getFrontendBaseUrl } from '../utils/sendEmail.js';
import { getVerificationEmail } from '../utils/emailTemplates/verificationEmail.js';
import { getResetPasswordEmail } from '../utils/emailTemplates/resetPasswordEmail.js';
import { randomUUID } from 'crypto';
import { saveFile, deleteFile } from '../services/fileStorageService.js';
import path from 'path';
import { getDisableAccountEmail } from '../utils/emailTemplates/disableAccountEmail.js';
import { createNotification } from '../services/notificationService.js';
import { calculateUserRank } from '../services/rankService.js';
import { hashPassword, verifyPassword } from '../utils/password.js';

function normalizeS3Config(config: any) {
  return {
    ...config,
    s3Bucket: config.s3Bucket ?? undefined,
    s3Region: config.s3Region ?? undefined,
    s3AccessKeyId: config.s3AccessKeyId ?? undefined,
    s3SecretAccessKey: config.s3SecretAccessKey ?? undefined,
  };
}

const JWT_SECRET = process.env.JWT_SECRET || 'changeme-in-production';

const ALLOWED_IMAGE_TYPES = ['jpg', 'jpeg', 'png', 'gif', 'webp'];
const MAX_IMAGE_SIZE = 30 * 1024 * 1024; // 30MB

export async function registerHandler(request: FastifyRequest, reply: FastifyReply) {
  const { email, username, password, inviteCode } = request.body as any;
  const config = await getConfig();

  // Enforce registration mode
  if (config.registrationMode === 'CLOSED') {
    return reply.status(403).send({ error: 'Registration is closed.' });
  }
  if (config.registrationMode === 'INVITE' && !inviteCode) {
    return reply.status(400).send({ error: 'Invite code required.' });
  }
  // Validate invite usage policy
  let inviteRecord: any | null = null;
  if (config.registrationMode === 'INVITE') {
    // Validate invite code exists, not used, not expired (usedById = null means unused)
    if (!inviteCode || typeof inviteCode !== 'string') {
      return reply.status(400).send({ error: 'Invite code required.' });
    }
    const now = toTimestamp(new Date().toISOString());
    inviteRecord = await db.orm.public.Invite
      .where({ code: inviteCode })
      .where((i) => i.usedById.isNull()) // Check that invite hasn't been used
      .where((i) => or(i.expiresAt.isNull(), i.expiresAt.gt(now)))
      .first();
    if (!inviteRecord) {
      return reply.status(400).send({ error: 'Invalid or expired invite code.' });
    }
  } else {
    // OPEN or CLOSED modes do not accept invites usage
    if (inviteCode) {
      return reply.status(403).send({ error: 'Invitations are disabled at this time.' });
    }
  }

  // Check if user/email already exists
  const existing = await db.orm.public.User
    .where((u) => or(u.email.eq(email), u.username.eq(username)))
    .first();
  if (existing) {
    return reply.status(400).send({ error: 'Email or username already in use.' });
  }

  // Hash password
  const passwordHash = await hashPassword(password);

  // Assign OWNER role to first user, USER otherwise
  const first = await isFirstUser();
  const role = first ? UserRole.OWNER : UserRole.USER;

  // Generate unique passkey
  const passkey = randomUUID().replace(/-/g, '');

  const user = await db.orm.public.User.create({
    email,
    username,
    passwordHash,
    role,
    // Auto-verify first user to allow immediate access
    emailVerified: first ? true : false,
    status: 'ACTIVE',
    passkey,
  });

  // If INVITE mode, mark the invite as used
  if (config.registrationMode === 'INVITE' && inviteRecord) {
    try {
      await db.orm.public.Invite.where({ id: inviteRecord.id }).update({
        usedById: user.id,
        usedAt: toTimestamp(new Date().toISOString())
      });
    } catch (err) {
      console.error('[registerHandler] Failed to mark invite as used:', err);
      // Don't fail registration if invite update fails, but log the error
    }
  }

  // Send verification email for non-first users only
  if (!first) {
    try {
      // Generate verification token
      const token = randomUUID();
      const expiresAt = toTimestamp(new Date(Date.now() + 60 * 60 * 1000).toISOString()); // 1 hour
      await db.orm.public.EmailVerificationToken.create({
        userId: user.id,
        token,
        expiresAt,
      });

      // Build verification link
      const baseUrl = getFrontendBaseUrl();
      const link = `${baseUrl}/verify?token=${token}`;

      // Prepare email
      const { text, html } = getVerificationEmail({ username: user.username, link });
      await sendEmail({ to: user.email, subject: 'Verify your email address', text, html });

      console.log(`[registerHandler] Verification email sent to ${user.email}`);
    } catch (err) {
      console.error('[registerHandler] Failed to send verification email:', err);
      // Don't fail registration if email sending fails, but log the error
    }
  }

  return reply.status(201).send({ 
    id: user.id, 
    email: user.email, 
    username: user.username, 
    role: user.role, 
    passkey: user.passkey,
    message: first 
      ? 'Registration successful. First user is auto-verified and has OWNER role.' 
      : 'Registration successful. Please check your email for verification instructions.'
  });
}

export async function loginHandler(request: FastifyRequest, reply: FastifyReply) {
  const { email, username, password } = request.body as any;
  if (!password || (!email && !username)) {
    return reply.status(400).send({ error: 'Email/username and password required.' });
  }
  const user = await db.orm.public.User.where(email ? { email } : { username }).first();
  if (!user) {
    return reply.status(401).send({ error: 'Invalid credentials.' });
  }
  const valid = await verifyPassword(user.passwordHash, password);
  if (!valid) {
    return reply.status(401).send({ error: 'Invalid credentials.' });
  }
  // Only allow login if user is active
  if (user.status !== 'ACTIVE') {
    return reply.status(403).send({ error: 'Account is not active.' });
  }
  
  // Issue JWT (allow unverified users to login)
  const token = jwt.sign(
    { 
      id: user.id, 
      email: user.email, 
      username: user.username, 
      role: user.role,
      emailVerified: user.emailVerified 
    },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
  
  return reply.send({ 
    token, 
    user: { 
      id: user.id, 
      email: user.email, 
      username: user.username, 
      role: user.role,
      emailVerified: user.emailVerified 
    },
    emailVerified: user.emailVerified
  });
}

export async function requestEmailVerificationHandler(request: FastifyRequest, reply: FastifyReply) {
  const user = (request as any).user;
  if (!user) return reply.status(401).send({ error: 'Unauthorized' });
  
  // Get current user status from database (not from JWT)
  const prismaUser = await db.orm.public.User.where({ id: user.id }).first();
  if (!prismaUser) return reply.status(404).send({ error: 'User not found' });
  
  if (prismaUser.emailVerified) {
    return reply.status(400).send({ error: 'Email already verified.' });
  }
  
  // Invalidate previous tokens
  await db.orm.public.EmailVerificationToken
    .where({ userId: user.id, used: false })
    .where((t) => t.expiresAt.gt(toTimestamp(new Date().toISOString())))
    .updateAndCount({ used: true });
  
  // Generate new token
  const token = randomUUID();
  const expiresAt = toTimestamp(new Date(Date.now() + 60 * 60 * 1000).toISOString()); // 1 hour
  await db.orm.public.EmailVerificationToken.create({
    userId: user.id,
    token,
    expiresAt,
  });
  
  // Build verification link
  const baseUrl = getFrontendBaseUrl();
  const link = `${baseUrl}/verify?token=${token}`;
  
  // Prepare email
  const { text, html } = getVerificationEmail({ username: prismaUser.username, link });
  try {
    await sendEmail({ to: prismaUser.email, subject: 'Verify your email address', text, html });
    console.log(`[requestEmailVerificationHandler] Verification email sent to ${prismaUser.email}`);
    return reply.send({ success: true });
  } catch (err) {
    console.error('[requestEmailVerificationHandler] Failed to send verification email:', err);
    return reply.status(500).send({ error: 'Failed to send verification email.' });
  }
}

export async function verifyEmailHandler(request: FastifyRequest, reply: FastifyReply) {
  const { token } = request.body as any;
  if (!token) return reply.status(400).send({ error: 'Missing token.' });
  const record = await db.orm.public.EmailVerificationToken.where({ token }).first();
  if (!record || record.used || parseTimestamp(record.expiresAt) < Date.now()) {
    return reply.status(400).send({ error: 'Invalid or expired token.' });
  }
  // Mark token as used
  await db.orm.public.EmailVerificationToken.where({ token }).update({ used: true });
  // Mark user as verified
  await db.orm.public.User.where({ id: record.userId }).update({ emailVerified: true });
  return reply.send({ success: true });
}

export async function requestPasswordResetHandler(request: FastifyRequest, reply: FastifyReply) {
  const { email } = request.body as any;
  if (!email) return reply.status(400).send({ error: 'Email is required.' });
  const user = await db.orm.public.User.where({ email }).first();
  if (user) {
    // Invalidate previous tokens
    await db.orm.public.PasswordResetToken
      .where({ userId: user.id, used: false })
      .where((t) => t.expiresAt.gt(toTimestamp(new Date().toISOString())))
      .updateAndCount({ used: true });
    // Generate new token
    const token = randomUUID();
    const expiresAt = toTimestamp(new Date(Date.now() + 60 * 60 * 1000).toISOString()); // 1 hour
    await db.orm.public.PasswordResetToken.create({
      userId: user.id,
      token,
      expiresAt,
    });
    // Build reset link
    const baseUrl = getFrontendBaseUrl();
    const link = `${baseUrl}/reset-password?token=${token}`;
    // Prepare email
    const { text, html } = getResetPasswordEmail({ username: user.username, link });
    try {
      await sendEmail({ to: user.email, subject: 'Password Reset Request', text, html });
    } catch (_err) {
      // Do not reveal error to user
    }
  }
  // Always respond with success for security
  return reply.send({ success: true });
}

export async function resetPasswordHandler(request: FastifyRequest, reply: FastifyReply) {
  const { token, password } = request.body as any;
  if (!token || !password) return reply.status(400).send({ error: 'Missing token or password.' });
  const record = await db.orm.public.PasswordResetToken.where({ token }).first();
  if (!record || record.used || parseTimestamp(record.expiresAt) < Date.now()) {
    return reply.status(400).send({ error: 'Invalid or expired token.' });
  }
  // Mark token as used
  await db.orm.public.PasswordResetToken.where({ token }).update({ used: true });
  // Update user password
  const passwordHash = await hashPassword(password);
  await db.orm.public.User.where({ id: record.userId }).update({ passwordHash });
  return reply.send({ success: true });
}

export async function getProfileHandler(request: FastifyRequest, reply: FastifyReply) {
  const user = (request as any).user;
  if (!user) return reply.status(401).send({ error: 'Unauthorized' });
  // Fetch fresh user info from DB
  const prismaUser = await db.orm.public.User.where({ id: user.id }).first();
  if (!prismaUser) return reply.status(404).send({ error: 'User not found' });

  // Calculate ratio (avoid division by zero)
  let ratio = 0;
  if (prismaUser.download && prismaUser.download !== BigInt(0)) {
    ratio = Number(prismaUser.upload) / Number(prismaUser.download);
  }

  // Count hit and runs
  const hitAndRunCount = (await db.orm.public.HitAndRun
    .where({ userId: user.id, isHitAndRun: true })
    .aggregate((a) => ({ n: a.count() }))).n;

  // Calculate user rank
  const userRank = await calculateUserRank(user.id);

  return reply.send({
    id: prismaUser.id,
    email: prismaUser.email,
    username: prismaUser.username,
    role: prismaUser.role,
    status: prismaUser.status,
    upload: prismaUser.upload.toString(),
    download: prismaUser.download.toString(),
    ratio,
    hitAndRunCount,
    bonusPoints: prismaUser.bonusPoints,
    emailVerified: prismaUser.emailVerified,
    passkey: prismaUser.passkey,
    avatarUrl: prismaUser.avatarUrl,
    avatarFileId: prismaUser.avatarFileId,
    rank: userRank.rank?.name || null,
    rankData: userRank
  });
}

export async function updateProfileHandler(request: FastifyRequest, reply: FastifyReply) {
  const user = (request as any).user;
  if (!user) return reply.status(401).send({ error: 'Unauthorized' });
  
  const { password } = request.body as any;
  
  if (!password) {
    return reply.status(400).send({ error: 'Password is required for profile updates' });
  }
  
  try {
    const passwordHash = await hashPassword(password);
    const updated = await db.orm.public.User.where({ id: user.id }).update({ passwordHash });
    if (!updated) throw new Error('User not found');
    
    return reply.send({ 
      id: updated.id, 
      email: updated.email, 
      username: updated.username, 
      role: updated.role, 
      status: updated.status 
    });
  } catch (err) {
    return reply.status(400).send({ error: 'Update failed', details: err });
  }
}

export async function rotatePasskeyHandler(request: FastifyRequest, reply: FastifyReply) {
  const user = (request as any).user;
  if (!user) return reply.status(401).send({ error: 'Unauthorized' });
  // Check if current passkey is banned
  const now = toTimestamp(new Date().toISOString());
  const banned = await db.orm.public.PeerBan
    .where({ passkey: user.passkey })
    .where((b) => or(b.expiresAt.isNull(), b.expiresAt.gt(now)))
    .first();
  if (banned) {
    return reply.status(403).send({ error: 'Your passkey is currently banned. Contact staff.' });
  }
  const newPasskey = randomUUID().replace(/-/g, '');
  const updated = await db.orm.public.User.where({ id: user.id }).update({ passkey: newPasskey });
  if (!updated) throw new Error('User not found');
  return reply.send({ passkey: updated.passkey });
}

export async function uploadAvatarHandler(request: FastifyRequest, reply: FastifyReply) {
  const user = (request as any).user;
  if (!user) return reply.status(401).send({ error: 'Unauthorized' });

  const config = normalizeS3Config(await getConfig());
  if (request.isMultipart()) {
    const parts = request.parts();
    for await (const part of parts) {
      if (part.type === 'file' && part.fieldname === 'avatar') {
        const ext = path.extname(part.filename || '').slice(1).toLowerCase();
        if (!ALLOWED_IMAGE_TYPES.includes(ext)) {
          return reply.status(400).send({ error: 'Unsupported image type' });
        }
        const buffer = await part.toBuffer();
        if (buffer.length > MAX_IMAGE_SIZE) {
          return reply.status(400).send({ error: 'Image too large (max 30MB)' });
        }
        const uploaded = await saveFile({
          type: 'avatar',
          buffer,
          ext: '.' + ext,
          mimeType: part.mimetype,
          config
        });
        // Remove previous avatar file if exists
        const prev = await db.orm.public.User.where({ id: user.id }).select('avatarFileId').first();
        if (prev?.avatarFileId) {
          try {
            const oldFile = await db.orm.public.UploadedFile.where({ id: prev.avatarFileId }).first();
            if (oldFile) {
              await deleteFile({ file: oldFile as any, config });
            }
          } catch {
            // Ignore deletion errors
          }
        }
        // Para LOCAL servimos por /uploads/, para DB/S3 usamos la ruta genérica /files/:id
        const avatarUrl = config.storageType === 'LOCAL' ? `/uploads/${uploaded.storageKey}` : `/files/${uploaded.id}`;
        await db.orm.public.User.where({ id: user.id }).update({ avatarFileId: uploaded.id, avatarUrl });
        return reply.send({ avatarUrl });
      }
    }
    return reply.status(400).send({ error: 'No avatar file uploaded' });
  } else {
    // JSON body with { url }
    const { url } = request.body as any;
    if (!url || typeof url !== 'string') {
      return reply.status(400).send({ error: 'No avatar URL provided' });
    }
    // Remove previous avatar file if exists
    const prev = await db.orm.public.User.where({ id: user.id }).select('avatarFileId').first();
    if (prev?.avatarFileId) {
      try {
        const oldFile = await db.orm.public.UploadedFile.where({ id: prev.avatarFileId }).first();
        if (oldFile) {
          await deleteFile({ file: oldFile as any, config });
        }
              } catch {
          // Ignore deletion errors
        }
    }
    await db.orm.public.User.where({ id: user.id }).update({ avatarFileId: null, avatarUrl: url });
    return reply.send({ avatarUrl: url });
  }
}

export async function deleteAvatarHandler(request: FastifyRequest, reply: FastifyReply) {
  const user = (request as any).user;
  if (!user) return reply.status(401).send({ error: 'Unauthorized' });

  const config = normalizeS3Config(await getConfig());
  const existing = await db.orm.public.User.where({ id: user.id }).select('avatarFileId', 'avatarUrl').first();

  if (!existing) return reply.status(404).send({ error: 'User not found' });

  // If there is a stored file, delete it from storage and DB
  if (existing.avatarFileId) {
    try {
      const file = await db.orm.public.UploadedFile.where({ id: existing.avatarFileId }).first();
      if (file) {
        await deleteFile({ file: file as any, config });
      }
    } catch {
      // Ignore deletion errors to avoid blocking user action
    }
  }

  await db.orm.public.User.where({ id: user.id }).update({ avatarFileId: null, avatarUrl: null });

  return reply.send({ success: true });
}

export async function disableSelfHandler(request: FastifyRequest, reply: FastifyReply) {
  const user = (request as any).user;
  if (!user) return reply.status(401).send({ error: 'Unauthorized' });
  const updated = await db.orm.public.User.where({ id: user.id }).update({ status: 'DISABLED' });
  if (!updated) throw new Error('User not found');
  const { text, html } = getDisableAccountEmail({ username: updated.username });
  await createNotification({
    userId: updated.id,
    type: 'account_disabled',
    message: 'You have disabled your account. This action is irreversible and you will not be able to log in until re-enabled by an admin.',
    sendEmail: true,
    email: updated.email,
    emailSubject: 'Your account has been disabled',
    emailText: text,
    emailHtml: html
  });
  // Optionally, log out the user by clearing their session/token (if implemented)
  return reply.send({ success: true });
} 