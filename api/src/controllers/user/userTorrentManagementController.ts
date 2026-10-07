import { FastifyReply, FastifyRequest } from 'fastify';
import { db } from '../../lib/prisma.js';

export async function updateTorrentHandler(request: FastifyRequest, reply: FastifyReply) {
  const user = (request as any).user;
  if (!user) return reply.status(401).send({ error: 'Unauthorized' });

  const { torrentId } = request.params as any;
  const { isAnonymous, freeleech } = request.body as any;

  try {
    // Verify the torrent belongs to the user
    const torrent = await db.orm.public.Torrent
      .where({
        id: torrentId,
        uploaderId: user.id
      })
      .first();

    if (!torrent) {
      return reply.status(404).send({ error: 'Torrent not found or access denied' });
    }

    // Update the torrent
    const updatedTorrent = await db.orm.public.Torrent.where({ id: torrentId }).update({
      ...(isAnonymous !== undefined && { isAnonymous }),
      ...(freeleech !== undefined && { freeleech })
    });
    if (!updatedTorrent) throw new Error('Torrent not found');

    return reply.send({
      success: true,
      torrent: {
        id: updatedTorrent.id,
        name: updatedTorrent.name,
        isAnonymous: updatedTorrent.isAnonymous,
        freeleech: updatedTorrent.freeleech
      }
    });
  } catch (error) {
    console.error('Error updating torrent:', error);
    return reply.status(500).send({ error: 'Internal server error' });
  }
}

export async function deleteTorrentHandler(request: FastifyRequest, reply: FastifyReply) {
  const user = (request as any).user;
  if (!user) return reply.status(401).send({ error: 'Unauthorized' });

  const { torrentId } = request.params as any;

  try {
    // Verify the torrent belongs to the user
    const torrent = await db.orm.public.Torrent
      .where({
        id: torrentId,
        uploaderId: user.id
      })
      .first();

    if (!torrent) {
      return reply.status(404).send({ error: 'Torrent not found or access denied' });
    }

    // Delete the torrent (this will cascade to related records)
    const deleted = await db.orm.public.Torrent.where({ id: torrentId }).delete();
    if (!deleted) throw new Error('Torrent not found');

    return reply.send({
      success: true,
      message: 'Torrent deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting torrent:', error);
    return reply.status(500).send({ error: 'Internal server error' });
  }
}
