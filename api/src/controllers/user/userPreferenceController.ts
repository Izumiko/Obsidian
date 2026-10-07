import { FastifyReply, FastifyRequest } from 'fastify';
import { db } from '../../lib/prisma.js';
import { convertBigInts } from '../../lib/serialization.js';

export async function getPreferencesHandler(request: FastifyRequest, reply: FastifyReply) {
  const user = (request as any).user;
  if (!user) return reply.status(401).send({ error: 'Unauthorized' });
  const dbUser = await db.orm.public.User
    .select('preferredLanguage', 'allowEmailNotifications', 'publicProfile')
    .first({ id: user.id });
  return reply.send(dbUser || { preferredLanguage: 'es', allowEmailNotifications: true, publicProfile: false });
}

export async function updatePreferencesHandler(request: FastifyRequest, reply: FastifyReply) {
  const user = (request as any).user;
  if (!user) return reply.status(401).send({ error: 'Unauthorized' });
  const { preferredLanguage, allowEmailNotifications, publicProfile } = request.body as any;
  const updated = await db.orm.public.User.where({ id: user.id }).update({
    preferredLanguage, allowEmailNotifications, publicProfile
  });
  if (!updated) throw new Error('User not found');
  return reply.send({
    preferredLanguage: updated.preferredLanguage,
    allowEmailNotifications: updated.allowEmailNotifications,
    publicProfile: updated.publicProfile
  });
}

export async function getPublicProfileHandler(request: FastifyRequest, reply: FastifyReply) {
  const { username } = request.params as any;

  // Find user by username and check if profile is public
  const user = await db.orm.public.User
    .where({ username })
    .select('id', 'username', 'role', 'upload', 'download', 'createdAt', 'avatarUrl', 'publicProfile')
    .first();

  if (!user) {
    return reply.status(404).send({ error: 'User not found' });
  }

  if (!user.publicProfile) {
    return reply.status(403).send({ error: 'Profile is private' });
  }

  const torrents = await db.orm.public.Torrent
    .where({
      uploaderId: user.id,
      isApproved: true,
      isAnonymous: false, // Only show non-anonymous torrents
      isRejected: false
    })
    .select('id', 'name', 'size', 'createdAt')
    .include('category', (c: any) => c.select('name'))
    .orderBy((t: any) => t.createdAt.desc())
    .limit(10) // Limit to 10 most recent torrents
    .all();

  // Calculate ratio
  const ratio = user.download > 0 ? Number(user.upload) / Number(user.download) : 0;

  return reply.send(convertBigInts({
    id: user.id,
    username: user.username,
    role: user.role,
    upload: user.upload.toString(),
    download: user.download.toString(),
    ratio: ratio.toFixed(2),
    createdAt: user.createdAt,
    avatarUrl: user.avatarUrl,
    publicTorrents: torrents.map((torrent: any) => ({
      id: torrent.id,
      name: torrent.name,
      size: torrent.size.toString(),
      createdAt: torrent.createdAt,
      category: torrent.category?.name || 'General',
      seeders: 0, // We'll get this from a separate query if needed
      leechers: 0, // We'll get this from a separate query if needed
      completed: 0 // We'll get this from a separate query if needed
    }))
  }));
}
