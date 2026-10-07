import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import staticPlugin from '@fastify/static';
import { fileURLToPath } from 'node:url';
import { registerAuthRoutes } from './routes/auth.js';
import { registerTorrentRoutes } from './routes/torrent.js';
import { registerUserRoutes } from './routes/user.js';
import { registerAnnounceRoutes } from './routes/announce.js';
import { registerRssRoutes } from './routes/rss.js';
import { registerAdminRoutes } from './routes/admin.js';
import { registerStatsRoutes } from './routes/stats.js';
import { registerConfigRoutes } from './routes/config.js';
import { registerFileRoutes } from './routes/files.js';
import { checkHitAndRunGracePeriod } from './announce_features/hitAndRun.js';
import path from 'path';

export async function buildApp(options: { logger?: boolean | Record<string, unknown> } = {}) {
  const app = Fastify({ logger: options.logger ?? { level: 'info' } });

  app.addHook('onRequest', async (request) => {
    console.log(`[GLOBAL] ${request.method} ${request.url}`, {
      headers: request.headers,
      params: request.params,
      query: request.query,
    });
  });

  const defaultCorsOrigins = ['http://localhost:3000', 'http://127.0.0.1:3000'];
  const envOrigins = process.env.CORS_ORIGIN?.split(',').map(s => s.trim()).filter(Boolean) || [];
  const corsOrigins = envOrigins.length > 0 ? envOrigins : defaultCorsOrigins;
  await app.register(cors, { origin: corsOrigins, credentials: true });

  app.get('/health', async () => ({ status: 'ok' }));

  const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';
  const absoluteUploadDir = path.isAbsolute(UPLOAD_DIR) ? UPLOAD_DIR : path.resolve(process.cwd(), UPLOAD_DIR);
  await app.register(staticPlugin, { root: absoluteUploadDir, prefix: '/uploads/', decorateReply: false });
  await app.register(multipart, { limits: { fileSize: 32 * 1024 * 1024 } });

  await registerAuthRoutes(app);
  await registerTorrentRoutes(app);
  await registerUserRoutes(app);
  await registerAnnounceRoutes(app);
  await registerRssRoutes(app);
  await registerAdminRoutes(app);
  await registerStatsRoutes(app);
  await registerConfigRoutes(app);
  await registerFileRoutes(app);

  return app;
}

const start = async () => {
  const app = await buildApp();
  try {
    await app.listen({ port: 3001, host: '::' });
    console.log('API server running on http://localhost:3001');
    setInterval(async () => {
      try { await checkHitAndRunGracePeriod(); }
      catch (error) { console.error('Error in grace period check:', error); }
    }, 30 * 60 * 1000);
    console.log('Grace period hit and run check scheduled every 30 minutes');
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  start();
}
