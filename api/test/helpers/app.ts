import { buildApp } from '../../src/index.js';

export async function makeApp() {
  const app = await buildApp({ logger: false });
  await app.ready();
  return app;
}
