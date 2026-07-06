import { FastifyInstance } from 'fastify';
import { getConfig } from '../services/configService.js';
import { getFile } from '../services/fileStorageService.js';
import { PrismaClient } from '../generated/prisma/client.js';
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL,
});
const prisma = new PrismaClient({ adapter });

export async function registerFileRoutes(app: FastifyInstance) {
  // Servir archivos subidos independientemente del storage (DB, S3, LOCAL)
  app.get('/files/:id', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const file = await prisma.uploadedFile.findUnique({ where: { id } });
      if (!file) return reply.status(404).send({ error: 'File not found' });

      const config = await getConfig();
      const buffer = await getFile({ file, config: config as any });
      reply.header('Content-Type', file.mimeType);
      return reply.send(buffer);
    } catch (_err) {
      return reply.status(500).send({ error: 'Failed to fetch file' });
    }
  });
}


