import { FastifyRequest, FastifyReply } from 'fastify';
import { db } from '../lib/prisma.js';
import { convertBigInts } from '../lib/serialization.js';

// Helper: Build threaded comments up to 4 levels, but at the limit, do not fetch further replies
async function buildThreadedComments(comments: any[], opUserId: string, currentUserId: string | null, level = 0): Promise<any[]> {
  if (level > 4) return [];
  return await Promise.all(
    comments.map(async (comment: any) => {
      let replies: any[] = [];
      let hasMoreReplies = false;
      if (level < 4) {
        replies = await db.orm.public.Comment
          .where({ parentId: comment.id, deleted: false })
          .orderBy((c) => c.createdAt.asc())
          .include('user')
          .include('votes')
          .all();
      } else if (level === 4) {
        const count = (await db.orm.public.Comment
          .where({ parentId: comment.id, deleted: false })
          .aggregate((a) => ({ n: a.count() }))).n;
        hasMoreReplies = count > 0;
      }
      const upvotes = comment.votes.filter((v: any) => v.value === 1).length;
      const downvotes = comment.votes.filter((v: any) => v.value === -1).length;
      const userVoteValue = currentUserId ? comment.votes.find((v: any) => v.userId === currentUserId)?.value : null;
      const userVote = userVoteValue === 1 ? 'upvote' : userVoteValue === -1 ? 'downvote' : null;
      return {
        id: comment.id,
        content: comment.deleted ? '[deleted]' : comment.content,
        createdAt: comment.createdAt,
        updatedAt: comment.updatedAt,
        deleted: comment.deleted,
        user: comment.user ? {
          id: comment.user.id,
          username: comment.user.username,
          avatarUrl: comment.user.avatarUrl,
          role: comment.user.role,
        } : null,
        isOP: comment.userId === opUserId,
        _count: { upvotes, downvotes },
        userVote,
        score: comment.votes.reduce((acc: number, v: any) => acc + v.value, 0),
        parentId: comment.parentId,
        replies: level < 4 ? await buildThreadedComments(replies, opUserId, currentUserId, level + 1) : [],
        hasMoreReplies,
      };
    })
  );
}

export { convertBigInts };

// GET /torrent/:id/comments
export async function listCommentsForTorrentHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as any;
  const { page = 1, limit = 10 } = (request.query as any) || {};
  const p = Math.max(1, Number(page) || 1);
  const take = Math.min(50, Math.max(1, Number(limit) || 10));
  const skip = (p - 1) * take;
  const user = (request as any).user || null;
  const currentUserId: string | null = user?.id || null;

  const torrent = await db.orm.public.Torrent.where({ id }).first();
  if (!torrent) return reply.status(404).send({ error: 'Torrent not found' });
  const opUserId = torrent.uploaderId;

  const [rootComments, totalResult] = await Promise.all([
    db.orm.public.Comment
      .where({ torrentId: id, deleted: false })
      .where((c) => c.parentId.isNull())
      .orderBy((c) => c.createdAt.asc())
      .offset(skip)
      .limit(take)
      .include('user')
      .include('votes')
      .all(),
    db.orm.public.Comment
      .where({ torrentId: id, deleted: false })
      .where((c) => c.parentId.isNull())
      .aggregate((a) => ({ n: a.count() }))
  ]);
  const total = totalResult.n;

  const threaded = await buildThreadedComments(rootComments, opUserId, currentUserId);
  const totalPages = Math.max(1, Math.ceil(total / take));
  return reply.send(convertBigInts({
    comments: threaded,
    pagination: { page: p, limit: take, total, totalPages }
  }));
}

// POST /torrent/:id/comments
export async function createCommentForTorrentHandler(request: FastifyRequest, reply: FastifyReply) {
  const user = (request as any).user;
  if (!user) return reply.status(401).send({ error: 'Unauthorized' });
  const { id } = request.params as any;
  const { content, parentId } = request.body as any;
  if (!content || typeof content !== 'string' || !content.trim()) {
    return reply.status(400).send({ error: 'Content required' });
  }
  // Check parent (if replying)
  if (parentId) {
    const parent = await db.orm.public.Comment.where({ id: parentId }).first();
    if (!parent || parent.torrentId !== id) {
      return reply.status(400).send({ error: 'Invalid parent comment' });
    }
  }
  const comment = await db.orm.public.Comment
    .include('user')
    .include('votes')
    .create({
      content,
      userId: user.id,
      torrentId: id,
      parentId: parentId || null,
    });
  return reply.status(201).send(convertBigInts(comment));
}

// PUT /comments/:commentId
export async function editCommentHandler(request: FastifyRequest, reply: FastifyReply) {
  const user = (request as any).user;
  if (!user) return reply.status(401).send({ error: 'Unauthorized' });
  const { commentId } = request.params as any;
  const { content } = request.body as any;
  const comment = await db.orm.public.Comment.where({ id: commentId }).first();
  if (!comment) return reply.status(404).send({ error: 'Comment not found' });
  if (comment.userId !== user.id) return reply.status(403).send({ error: 'Forbidden' });
  if (!content || typeof content !== 'string' || !content.trim()) {
    return reply.status(400).send({ error: 'Content required' });
  }
  const updated = await db.orm.public.Comment
    .where({ id: commentId })
    .include('user')
    .include('votes')
    .update({ content });
  return reply.send(convertBigInts(updated));
}

// DELETE /comments/:commentId (soft delete)
export async function deleteCommentHandler(request: FastifyRequest, reply: FastifyReply) {
  const user = (request as any).user;
  if (!user) return reply.status(401).send({ error: 'Unauthorized' });
  const { commentId } = request.params as any;
  const comment = await db.orm.public.Comment.where({ id: commentId }).first();
  if (!comment) return reply.status(404).send({ error: 'Comment not found' });
      if (comment.userId !== user.id && user.role !== 'ADMIN' && user.role !== 'OWNER' && user.role !== 'FOUNDER') {
    return reply.status(403).send({ error: 'Forbidden' });
  }
  await db.orm.public.Comment.where({ id: commentId }).update({ deleted: true });
  return reply.send({ success: true });
}

// POST /comments/:commentId/vote
export async function voteCommentHandler(request: FastifyRequest, reply: FastifyReply) {
  const user = (request as any).user;
  if (!user) return reply.status(401).send({ error: 'Unauthorized' });
  const { commentId } = request.params as any;
  const { value } = request.body as any;
  if (![1, -1].includes(value)) return reply.status(400).send({ error: 'Invalid vote value' });
  const comment = await db.orm.public.Comment.where({ id: commentId }).first();
  if (!comment) return reply.status(404).send({ error: 'Comment not found' });
  // Upsert vote
  await db.orm.public.CommentVote.upsert({
    create: { userId: user.id, commentId, value },
    update: { value },
    // The inferred v8 contract records this composite key as a unique *index*,
    // which `conflictOn`'s type cannot see, but the runtime resolves the given
    // field names to columns for `ON CONFLICT` directly.
    conflictOn: { userId: user.id, commentId } as any,
  });
  return reply.send({ success: true });
}

// GET /comments/:commentId/thread - fetch full sub-thread for a comment (unlimited depth)
export async function getCommentThreadHandler(request: FastifyRequest, reply: FastifyReply) {
  const { commentId } = request.params as any;
  const comment = await db.orm.public.Comment
    .where({ id: commentId })
    .include('user')
    .include('votes')
    .first();
  if (!comment) return reply.status(404).send({ error: 'Comment not found' });
  // Find OP (walk up to root)
  let opUserId = comment.userId;
  let parent = comment;
  while (parent.parentId) {
    parent = await db.orm.public.Comment.where({ id: parent.parentId }).first() as any;
    if (parent) opUserId = parent.userId;
  }
  // Recursively fetch all descendants
  async function buildFullThread(c: any): Promise<any> {
    const replies = await db.orm.public.Comment
      .where({ parentId: c.id, deleted: false })
      .orderBy((cc) => cc.createdAt.asc())
      .include('user')
      .include('votes')
      .all();
    return {
      id: c.id,
      content: c.deleted ? '[deleted]' : c.content,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
      deleted: c.deleted,
      user: c.user ? {
        id: c.user.id,
        username: c.user.username,
        avatarUrl: c.user.avatarUrl,
        role: c.user.role,
      } : null,
      isOP: c.userId === opUserId,
      upvotes: c.votes.filter((v: any) => v.value === 1).length,
      downvotes: c.votes.filter((v: any) => v.value === -1).length,
      score: c.votes.reduce((acc: number, v: any) => acc + v.value, 0),
      parentId: c.parentId,
      replies: await Promise.all(replies.map(buildFullThread)),
    };
  }
  const thread = await buildFullThread(comment);
  return reply.send(convertBigInts(thread));
} 