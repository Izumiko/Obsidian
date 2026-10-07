import { FastifyInstance } from 'fastify';
import { getConfig } from '../services/configService.js';
import { getFile } from '../services/fileStorageService.js';
import { db } from '../lib/prisma.js';

export async function registerFileRoutes(app: FastifyInstance) {
  // Servir archivos subidos independientemente del storage (DB, S3, LOCAL)
  app.get('/files/:id', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const file = await db.orm.public.UploadedFile.where({ id }).first();
      if (!file) return reply.status(404).send({ error: 'File not found' });

      const config = await getConfig();
      const buffer = await getFile({ file: file as any, config: config as any });
      reply.header('Content-Type', file.mimeType);
      return reply.send(buffer);
    } catch (_err) {
      return reply.status(500).send({ error: 'Failed to fetch file' });
    }
  });
}

