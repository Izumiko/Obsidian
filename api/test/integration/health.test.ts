import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp } from '../helpers/app.js';

test('GET /health returns ok', async () => {
  const app = await makeApp();
  const res = await app.inject({ method: 'GET', url: '/health' });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { status: 'ok' });
  await app.close();
});
