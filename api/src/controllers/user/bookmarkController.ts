import { FastifyRequest, FastifyReply } from 'fastify';
import { createSmartBookmarkAddedActivity, createSmartBookmarkRemovedActivity } from './userActivityController.js';
import { db } from '../../lib/prisma.js';
import { convertBigInts } from '../../lib/serialization.js';

export async function listBookmarksHandler(request: FastifyRequest, reply: FastifyReply) {
  const user = (request as any).user;
  if (!user) return reply.status(401).send({ error: 'Unauthorized' });
  const { page = 1, limit = 20 } = (request.query as any) || {};
  const skip = (Number(page) - 1) * Number(limit);
  const [bookmarks, totalResult] = await Promise.all([
    db.orm.public.Bookmark
      .where({ userId: user.id })
      .offset(skip)
      .limit(Number(limit))
      .orderBy((b: any) => b.createdAt.desc())
      .include('torrent', (t: any) => t.select('id', 'name', 'description', 'size', 'createdAt', 'posterUrl'))
      .all(),
    db.orm.public.Bookmark
      .where({ userId: user.id })
      .aggregate((a: any) => ({ n: a.count() }))
  ]);
  const total = totalResult.n;
  // Flatten and serialize BigInt
  const torrents = bookmarks.map((b: any) => ({
    ...b.torrent,
    size: b.torrent.size?.toString?.() ?? "0",
    createdAt: b.torrent.createdAt,
    note: b.note || "", // <-- include the note!
  }));
  return reply.send(convertBigInts({ bookmarks: torrents, total, page: Number(page), limit: Number(limit) }));
}

export async function addBookmarkHandler(request: FastifyRequest, reply: FastifyReply) {
  const user = (request as any).user;
  if (!user) return reply.status(401).send({ error: 'Unauthorized' });
  const contentType = (request.headers['content-type'] || '').toString();
  let torrentId: string | undefined;
  let note: string | undefined;
  if (contentType.includes('application/json')) {
    const body = request.body as any;
    torrentId = body?.torrentId;
    note = body?.note;
  } else if (contentType.includes('application/x-www-form-urlencoded') || contentType.includes('multipart/form-data')) {
    const body = request.body as any;
    torrentId = body?.torrentId;
    note = body?.note;
  } else {
    const body = request.body as any;
    torrentId = body?.torrentId;
    note = body?.note;
  }
  if (!torrentId) return reply.status(400).send({ error: 'torrentId is required' });
  // Check if torrent exists
  const torrent = await db.orm.public.Torrent.where({ id: torrentId }).first();
  if (!torrent) return reply.status(404).send({ error: 'Torrent not found' });
  // If not approved, allow only uploader and staff to bookmark
  if (!torrent.isApproved) {
    const isStaff = user.role === 'ADMIN' || user.role === 'OWNER' || user.role === 'FOUNDER';
    const isUploader = torrent.uploaderId === user.id;
    if (!isStaff && !isUploader) return reply.status(403).send({ error: 'Forbidden' });
  }
  // Check if bookmark already exists
  const existingBookmark = await db.orm.public.Bookmark
    .where({ userId: user.id, torrentId })
    .first();

  // Upsert bookmark
  const bookmark = await db.orm.public.Bookmark.upsert({
    create: { userId: user.id, torrentId, note },
    update: { note },
    // The inferred contract records this composite key as a unique index, which
    // `conflictOn`'s type cannot see; the runtime resolves the field names.
    conflictOn: { userId: user.id, torrentId } as any,
  });

  // Create smart activity (only for new bookmarks)
  if (!existingBookmark) {
    await createSmartBookmarkAddedActivity(user.id, torrentId, torrent.name);
  }

  return reply.status(201).send(convertBigInts(bookmark));
}

export async function removeBookmarkHandler(request: FastifyRequest, reply: FastifyReply) {
  const user = (request as any).user;
  if (!user) return reply.status(401).send({ error: 'Unauthorized' });
  const { torrentId } = request.params as any;

  // Get torrent info before deleting bookmark
  const torrent = await db.orm.public.Torrent.where({ id: torrentId }).first();

  await db.orm.public.Bookmark.where({ userId: user.id, torrentId }).deleteAndCount();

  // Create smart activity
  if (torrent) {
    await createSmartBookmarkRemovedActivity(user.id, torrentId, torrent.name);
  }

  return reply.send({ success: true });
}

export async function updateBookmarkNoteHandler(request: FastifyRequest, reply: FastifyReply) {
  const user = (request as any).user;
  if (!user) return reply.status(401).send({ error: 'Unauthorized' });
  const { torrentId } = request.params as any;
  const { note } = request.body as any;
  await db.orm.public.Bookmark.where({ userId: user.id, torrentId }).updateAndCount({ note });
  return reply.send({ success: true });
}
