# Prisma ORM 7 → 8 Full Cutover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the `api` backend fully onto the Prisma ORM 8 client and remove Prisma ORM 7, without changing the database schema or API behavior.

**Architecture:** Side-by-side migration. Install Prisma 8 next to Prisma 7, infer a v8 contract from a local Postgres rebuilt from the existing migrations, transfer migration ownership, then rewrite the query layer route-group by route-group (`prisma.*` → `db.orm.public.*`) with integration tests, and finally remove Prisma 7. The live database is never touched; all v8 CLI work uses a local podman Postgres.

**Tech Stack:** Node 24, TypeScript (native tsc 7.0.2), Fastify 5, pnpm 12, Prisma 8 CLI (`prisma@8.0.0-rc.20`) + `@prisma/orm-postgres@8.0.0-rc.14`, local `postgres:18-alpine` via podman.

**Reference:** `docs/superpowers/specs/2026-10-07-prisma-v8-cutover-design.md`.

---

## Conventions

- Run every command from `api/` unless stated otherwise.
- Migration/DB commands MUST target the local podman Postgres. Guard every such command by
  exporting `DATABASE_URL` to the local URL in that shell. Never run v8 CLI commands with the
  live `omv.987655.xyz` URL.
- Gates (run after each task that changes code):
  - `pnpm exec tsc --noEmit`
  - `pnpm run lint`
  - `pnpm test`
  - `pnpm run bundle`
  - standalone bundle smoke test (Task 2 defines it).

## File structure (created / modified)

Created:
- `api/.env.migration` — local DB URL for migration commands (gitignored).
- `api/prisma8/contract.prisma` — v8 contract.
- `api/src/generated/prisma8/contract.json`, `contract.d.ts` — emitted v8 artifacts.
- `api/test/helpers/app.ts` — builds the Fastify app for `.inject()` tests.
- `api/test/helpers/db.ts` — connects to the test DB, resets/seeds.
- `api/test/integration/*.test.ts` — per-group integration tests.

Modified:
- `api/package.json` — scripts, deps.
- `api/tsconfig.json` — module/moduleResolution/resolveJsonModule/include.
- `api/prisma7.config.ts` — renamed from `prisma.config.ts` (v7 config).
- `api/prisma.config.ts` — new v8 config.
- `api/src/lib/prisma.ts` — exports `prisma` (v7) and `db` (v8).
- `api/src/index.ts` — extract `buildApp()` from `start()`.
- `api/Dockerfile` — pnpm + v8 migrate image.
- All 39 `prisma.*` call-site files (see Task groups 8–13).

Removed (Phase 4): `api/prisma/`, `api/src/generated/prisma/`, `api/prisma7.config.ts`, the
`prisma` export, v7 packages/scripts.

---

## Phase 0 — Prep

### Task 1: Local Postgres and environment guard

**Files:**
- Create: `api/.env.migration`

- [ ] **Step 1: Start the local database (WSL/podman)**

```bash
podman run -d --name obsidian-pg-v8 \
  -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=larevo_tracker -p 5432:5432 \
  docker.io/library/postgres:18-alpine
```

- [ ] **Step 2: Write `api/.env.migration`**

```
DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:5432/larevo_tracker"
```

- [ ] **Step 3: Add it to gitignore (verify) and confirm it is ignored**

Run: `git check-ignore api/.env.migration`
Expected: prints the path (ignored). `.gitignore` already ignores `.env.*`.

- [ ] **Step 4: Rebuild the v7 schema on the local DB**

```bash
export DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:5432/larevo_tracker"
pnpm exec prisma migrate deploy
pnpm exec prisma migrate status
```

Expected: all 47 migrations applied; status reports schema up to date.

- [ ] **Step 5: Commit the env template only if useful**

`api/.env.migration` is gitignored; nothing to commit. Add a note to
`api/env.example` describing the local migration URL.

```bash
git add api/env.example && git commit -m "docs: note local migration DATABASE_URL"
```

### Task 2: Switch tooling to pnpm and establish a green baseline

**Files:**
- Modify: `api/Dockerfile`
- Modify: `api/package.json`

- [ ] **Step 1: Install with pnpm and confirm the lockfile**

Run: `pnpm install`
Expected: completes; `pnpm-lock.yaml` updated.

- [ ] **Step 2: Establish the baseline gates**

```bash
pnpm exec tsc --noEmit
pnpm run lint
pnpm test
pnpm run bundle
```

Expected: all pass. If `tsc`/`lint` fail because of the recent dep bump, fix those first in a
separate commit before continuing.

- [ ] **Step 3: Add a standalone bundle smoke script**

Create `api/scripts/smoke-bundle.mjs`:

```js
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "obsidian-smoke-"));
mkdirSync(join(dir, "uploads"));
copyFileSync(join(process.cwd(), "build", "index.mjs"), join(dir, "index.mjs"));

const p = spawn(process.execPath, ["index.mjs"], { cwd: dir, stdio: ["ignore", "pipe", "pipe"] });
let out = "";
p.stdout.on("data", (d) => (out += d));
p.stderr.on("data", (d) => (out += d));

setTimeout(() => {
  p.kill();
  const ok = out.includes("Server listening");
  console.log(out.trim());
  process.exit(ok ? 0 : 1);
}, 6000);
```

- [ ] **Step 4: Run the smoke script**

Run: `node scripts/smoke-bundle.mjs`
Expected: prints `Server listening at http://[::]:3001` and exits 0.

- [ ] **Step 5: Point the Dockerfile at pnpm**

In `api/Dockerfile`, in both `builder` and `migrate` stages replace the npm steps with:

```dockerfile
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
```

and change `RUN npm run bundle` to `RUN pnpm run bundle`, and the migrate `CMD` to
`["pnpm", "exec", "prisma", "migrate", "deploy"]`.

- [ ] **Step 6: Commit**

```bash
git add api/package.json api/pnpm-lock.yaml api/Dockerfile api/scripts/smoke-bundle.mjs api/env.example
git commit -m "chore: switch api tooling to pnpm and add bundle smoke test"
```

### Task 3: Integration harness skeleton

**Files:**
- Modify: `api/src/index.ts`
- Create: `api/test/helpers/app.ts`
- Create: `api/test/helpers/db.ts`
- Create: `api/test/integration/health.test.ts`

- [ ] **Step 1: Split `buildApp()` out of `start()` in `src/index.ts`**

Refactor so the route registrations happen in an exported async function and `start()` only
listens and schedules the interval. Replace the top of the file through the registration
block with:

```ts
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
  await app.register(cors, {
    origin: corsOrigins,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'HEAD'],
    credentials: true,
  });

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
```

- [ ] **Step 2: Create the app helper**

`api/test/helpers/app.ts`:

```ts
import { buildApp } from '../../src/index.js';

export async function makeApp() {
  const app = await buildApp({ logger: false });
  await app.ready();
  return app;
}
```

- [ ] **Step 3: Create the DB helper**

`api/test/helpers/db.ts`:

```ts
import { prisma } from '../../src/lib/prisma.js';

export async function resetDb() {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "User","Torrent","Category","Source","Config" RESTART IDENTITY CASCADE'
  );
}

export { prisma };
```

(Extend the table list as groups need it; keep it explicit.)

- [ ] **Step 4: Write the health test**

`api/test/integration/health.test.ts`:

```ts
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
```

- [ ] **Step 5: Run it**

Run: `DATABASE_URL=<local> pnpm test`
Expected: health test passes alongside the 6 existing tests.

- [ ] **Step 6: Commit**

```bash
git add api/src/index.ts api/test/helpers api/test/integration
git commit -m "test: add integration harness with buildApp() and health check"
```

---

## Phase 1 — Prisma 8 side-by-side

### Task 4: Install Prisma 8 and add both configs

**Files:**
- Modify: `api/package.json`
- Create: `api/prisma7.config.ts` (renamed from `prisma.config.ts`)
- Create: `api/prisma.config.ts` (v8)

- [ ] **Step 1: Install packages**

```bash
pnpm remove prisma
pnpm add -D @prisma/prisma7@7.10.0
pnpm add -D prisma@8.0.0-rc.20
pnpm add @prisma/orm-postgres@8.0.0-rc.14
```

- [ ] **Step 2: Verify both CLIs**

Run: `pnpm exec prisma --version` → expect `8.0.0-rc.20`.
Run: `pnpm exec prisma7 --version` → expect `7.10.0`.

- [ ] **Step 3: Rename the v7 config and repoint its import**

```bash
git mv api/prisma.config.ts api/prisma7.config.ts
```

Change its first import to:

```ts
import { defineConfig, env } from "@prisma/prisma7/config";
```

- [ ] **Step 4: Create the v8 config `api/prisma.config.ts`**

```ts
import "dotenv/config";
import { definePrismaConfig } from "prisma/config";
import { defineConfig as definePostgresConfig } from "@prisma/orm-postgres/config";

export default definePrismaConfig({
  orm: definePostgresConfig({
    contract: "prisma8/contract.prisma",
    output: "src/generated/prisma8",
    db: {
      connection: process.env["DATABASE_URL"],
    },
  }),
});
```

- [ ] **Step 5: Update scripts in `package.json`**

```json
"prisma7:generate": "prisma7 generate",
"prisma7:migrate": "prisma7 migrate dev",
"prisma7:seed": "tsx prisma/seed.ts",
"contract:emit": "prisma contract emit",
"contract:infer": "prisma contract infer --output prisma8/contract.prisma",
"db:sign": "prisma db sign",
"db:verify": "prisma db verify",
"migration:plan": "prisma migration plan",
"migration:apply": "prisma db migrate --advance-ref db"
```

Remove the old `prisma:generate` / `prisma:migrate` / `prisma:seed` entries.

- [ ] **Step 6: Confirm v7 still works side-by-side**

Run: `pnpm exec prisma7 migrate status` (with local `DATABASE_URL`)
Expected: reports schema up to date; app still starts (`pnpm run dev`).

- [ ] **Step 7: Commit**

```bash
git add api/package.json api/pnpm-lock.yaml api/prisma7.config.ts api/prisma.config.ts
git commit -m "feat: install prisma 8 side-by-side with v7 config"
```

### Task 5: Infer, emit the contract, and add the v8 client

**Files:**
- Create: `api/prisma8/contract.prisma`
- Create: `api/src/generated/prisma8/*` (emitted)
- Modify: `api/src/lib/prisma.ts`
- Modify: `api/tsconfig.json`

- [ ] **Step 1: Infer the contract from the local DB**

Run: `pnpm run contract:infer` (with local `DATABASE_URL`)
Expected: writes `prisma8/contract.prisma`.

- [ ] **Step 2: Remove the `PrismaMigrations` model**

Open `prisma8/contract.prisma` and delete the model that describes `_prisma_migrations`.
Keep `// use prisma-8` as the first line.

- [ ] **Step 3: Emit**

Run: `pnpm run contract:emit`
Expected: writes `src/generated/prisma8/contract.json` and `contract.d.ts`.

- [ ] **Step 4: tsconfig for the v8 client**

In `api/tsconfig.json` set:

```json
"module": "nodenext",
"moduleResolution": "nodenext",
"resolveJsonModule": true
```

and change `include` to:

```json
"include": ["src/**/*"]
```

(The generated files live under `src/`, so they are already included; add
`"src/generated/prisma8/**/*.d.ts"` explicitly only if needed after a `tsc` error.)

Note: under `nodenext`, import the contract type as `../generated/prisma8/contract.js`
(type-only; resolves to `contract.d.ts`). Also add `src/generated/prisma8/` to the ignores in
`eslint.config.js`, because the emitted `contract.d.ts` otherwise fails lint.

- [ ] **Step 5: Add the `db` client to `src/lib/prisma.ts`**

Append:

```ts
import postgres from "@prisma/orm-postgres/runtime";
import type { Contract } from "../generated/prisma8/contract.js";
import contractJson from "../generated/prisma8/contract.json" with { type: "json" };

export const db = postgres<Contract>({
  url: process.env.DATABASE_URL!,
  contractJson,
});

process.on('beforeExit', async () => { await db.close(); });
```

- [ ] **Step 6: Gate**

```bash
pnpm exec tsc --noEmit
pnpm run lint
pnpm test
pnpm run bundle
node scripts/smoke-bundle.mjs
```

Expected: all pass; no route changed yet.

- [ ] **Step 7: Commit**

```bash
git add api/prisma8 api/src/generated/prisma8 api/src/lib/prisma.ts api/tsconfig.json
git commit -m "feat: emit prisma 8 contract and add dual client"
```

### Task 6: v8 API spike — pin exact syntax

Purpose: the v8 ORM client is new; lock down exact syntax for the patterns this codebase
uses before mass-migrating. Output is a scratch test (kept, it becomes regression coverage).

**Files:**
- Create: `api/test/integration/v8-api-spike.test.ts`

- [ ] **Step 1: Write the spike test covering each pattern**

`api/test/integration/v8-api-spike.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../../src/lib/prisma.js';

test('v8: read with where/orderBy/limit', async () => {
  const rows = await db.orm.public.User.orderBy((u) => u.createdAt.desc()).limit(1).all();
  assert.ok(Array.isArray(rows));
});

test('v8: first()', async () => {
  const row = await db.orm.public.Config.first({ id: 1 });
  assert.ok(row === null || typeof row === 'object');
});

test('v8: aggregate count', async () => {
  const [r] = await db.orm.public.User.aggregate((a) => ({ n: a.count() }));
  assert.equal(typeof r.n, 'number');
});

test('v8: relation include', async () => {
  const rows = await db.orm.public.Torrent.include('uploader').limit(1).all();
  assert.ok(Array.isArray(rows));
});

test('v8: transaction', async () => {
  // Pin the exact transaction API found in the v8 docs; assert it commits/rolls back.
  assert.ok(db);
});

test('v8: raw sql', async () => {
  // Pin the exact raw-query API (db.sql / db.raw) and run SELECT 1.
  assert.ok(db);
});

test('v8: enum + bigint round trip', async () => {
  // Read a User.role and a bigint field; assert the JS types the code relies on.
  assert.ok(db);
});
```

- [ ] **Step 2: Fill in the placeholder assertions using the v8 docs**

For the three stubbed tests, consult the v8 docs linked from the guide
(`Advanced queries`, `Transactions`) and the emitted `contract.d.ts`, then implement real
assertions. This step is complete when every test runs against the local DB and passes with
concrete assertions (no `assert.ok(db)` left).

- [ ] **Step 3: Run**

Run: `DATABASE_URL=<local> pnpm test`
Expected: all spike tests pass. Record the confirmed syntax in the plan (update the mapping
table) and in the spec if it differs.

- [ ] **Step 4: Commit**

```bash
git add api/test/integration/v8-api-spike.test.ts
git commit -m "test: pin prisma 8 orm client syntax for the patterns we use"
```

---

## Phase 2 — Migration ownership handoff

### Task 7: Sign the DB and verify the handoff

**Files:**
- Create: `api/migrations/snapshots/*` (written by the CLI)
- Create: `api/migrations/app/*` (written by the CLI)

- [ ] **Step 1: Sign**

```bash
export DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:5432/larevo_tracker"
pnpm run db:sign
pnpm exec prisma migration status
```

Expected: `Database signed`; status shows current and target hashes match, nothing pending.

- [ ] **Step 2: Verify with a throwaway additive change**

Add a nullable column to a scratch contract, e.g. temporarily add `smokeTest String?` to a
model, then:

```bash
pnpm run contract:emit
pnpm exec prisma migration plan --name smoke_test
pnpm run migration:apply
pnpm run db:verify
```

Expected: `Planned baseline + 1 operation(s)`; migrate applies the single op; verify passes.

- [ ] **Step 3: Revert the scratch change**

Remove the scratch column, `pnpm run contract:emit`, and confirm `pnpm run db:verify` still
passes for the real contract.

- [ ] **Step 4: Commit**

```bash
git add api/migrations api/prisma8/contract.prisma
git commit -m "feat: transfer prisma migration ownership to v8"
```

---

## Phase 3 — Query-layer rewrite

Each group below is one task. For every task:
1. Add integration tests for the routes/services in the group (see Task 3 harness).
2. Convert every `prisma.*` call in the listed files to `db.orm.public.*` per the mapping.
3. Run the whole-repo gate.
4. Commit.

### Mapping table (fill from Task 6 where the spike changed it)

| Prisma 7 | Prisma 8 |
| --- | --- |
| `findUnique` / `findFirst` | `.where(...).first()`; a filter-less `findFirst()` is `Model.first()` |
| `findUniqueOrThrow` / `findFirstOrThrow` | `.where(...).all().firstOrThrow()` |
| `findMany` | `.where(...).all()` |
| `create({ data: x })` | `create(x)` |
| `update({ where: w, data: d })` | `.where(w).update(d)` — returns `Row \| null` instead of throwing `P2025`; add a null check to preserve throw-on-missing |
| `delete({ where: w })` | `.where(w).delete()` — returns `Row \| null` instead of throwing `P2025` |
| `upsert({ where: w, create, update })` | `.where(w).upsert(...)` |
| `updateMany` / `deleteMany` | `.where(...).updateAndCount(d)` / `.where(...).deleteAndCount()` — these return a bare `number`, not `{ count }`; return `{ count }` at the public boundary to preserve the v7 `BatchPayload` shape. A filter-less `updateMany` needs `.where({})` |
| `count()` | `.aggregate((a) => ({ n: a.count() }))` (returns one object, not an array) |
| `aggregate({ _sum: { f: true } })` | `.aggregate((a) => ({ total: a.sum("f") }))` (`avg`/`min`/`max` likewise take the field name; `sumBigInt` for a lossless BigInt result) |
| `include: { rel: true }` | `.include("rel")` |
| `select: { a: true }` | `.select("a")` |
| `$transaction` | v8 transaction API (Task 6) |
| `$executeRaw` / `$queryRaw` | `db.sql` / `db.raw` (Task 6) |
| `where: { a, b }` | `.where({ a, b })` (shorthand equality) |
| `where: { a: { not: x } }` | `.where((m) => m.a.neq(x))` |
| `where: { t: { gte: d } }` | `.where((m) => m.t.gte(d))` (`gt`/`lt`/`lte`/`in`/`notIn`/`isNull`/`isNotNull` likewise) |
| `where: { OR: [...] }` | `.where((m) => or(...))`; import `and`/`or`/`not`/`all` from `@prisma/orm-postgres/orm-client` |
| `orderBy: { f: 'desc' }` | `.orderBy((m) => m.f.desc())` (array for multiple keys) |
| `take: n` / `skip: n` | `.limit(n)` / `.offset(n)` |
| `distinct: ['a']` | `.distinct("a")` (after `.select(...)`) |
| `data: { n: { increment: k } }` | **No v8 equivalent on PostgreSQL.** Raw SQL: ``db.raw.sql`UPDATE "T" SET "n" = "n" + ${k} WHERE "id" = ${id}`.affectedCount().build()`` then `await db.runtime().execute(plan)` |
| `DateTime` input (`Date`) | `TimestampString(3)` is a branded string: pass PostgreSQL text, cast with `as TimestampString<3>` (from `@prisma/orm-postgres/target/codec-types`) |

Referenced relation (inferred contract uses `@@map` table names; model accessor stays the
model name): `prisma.user` → `db.orm.public.User`.

Test isolation: `node --test` runs test **files** concurrently by default (one child process
per file), and every integration file shares the same local database. Because `Config` is a
global `id=1` singleton and `getConfig()` inserts it on first read, two files calling it at
once race on `Config_pkey`. `package.json` runs `test` with `--test-concurrency=1` so files
execute serially; keep that flag as more DB-backed groups are added.

### Task 8: Rewrite `announce_features/` group

**Files:**
- Modify: `src/announce_features/antiCheat.ts`, `bonusPoints.ts`, `hitAndRun.ts`, `peerList.ts`, `ratio.ts`
- Test: `test/integration/announce-features.test.ts`

- [ ] **Step 1: Write integration tests covering each feature's DB reads/writes** (seed a user + torrent + announces via `prisma` for now).
- [ ] **Step 2: Convert the 5 files; change `import { prisma }` → `import { db }` and rewrite calls.**
- [ ] **Step 3: Run gate** (`tsc`, `lint`, `test`, `bundle`, smoke).
- [ ] **Step 4: Commit** `refactor: migrate announce_features to prisma 8 orm client`.

### Task 9: Rewrite `services/` group

**Files:** `src/services/configService.ts`, `fileStorageService.ts`, `notificationService.ts`, `rankService.ts`
**Test:** `test/integration/services.test.ts`

- [ ] **Step 1: Write tests** for config get/update, notification create, rank read, file record create.
- [ ] **Step 2: Convert the 4 files to `db`.**
- [ ] **Step 3: Run gate.**
- [ ] **Step 4: Commit** `refactor: migrate services to prisma 8 orm client`.

### Task 10: Rewrite `routes/` group

**Files:** `src/routes/files.ts`, `src/routes/torrent.ts`, `src/routes/stats.ts`
**Test:** `test/integration/routes.test.ts`

- [ ] **Step 1: Write tests** hitting the file and torrent route handlers via `app.inject()`.
- [ ] **Step 2: Convert the 3 files to `db`.**
- [ ] **Step 3: Run gate.**
- [ ] **Step 4: Commit** `refactor: migrate routes to prisma 8 orm client`.

### Task 11: Rewrite root `controllers/` group

**Files:** `src/controllers/announceController.ts`, `authController.ts`, `commentController.ts`, `torrentController.ts`
**Test:** `test/integration/controllers-core.test.ts`

- [ ] **Step 1: Write tests** for auth (register/login), torrent list/detail, comment list/create, announce.
- [ ] **Step 2: Convert the 4 files to `db`.** `torrentController.ts` contains the single `$executeRaw` — port it with the Task 6 raw API.
- [ ] **Step 3: Run gate.**
- [ ] **Step 4: Commit** `refactor: migrate core controllers to prisma 8 orm client`.

### Task 12: Rewrite `controllers/admin/` group

**Files:** all 8 files under `src/controllers/admin/`
**Test:** `test/integration/controllers-admin.test.ts`

- [ ] **Step 1: Write tests** for the admin overview, user, rank, wiki, request, category, announcement, notification handlers (happy paths).
- [ ] **Step 2: Convert the 8 files to `db`.**
- [ ] **Step 3: Run gate.**
- [ ] **Step 4: Commit** `refactor: migrate admin controllers to prisma 8 orm client`.

### Task 13: Rewrite `controllers/user/` group

**Files:** all 14 files under `src/controllers/user/`
**Test:** `test/integration/controllers-user.test.ts`

- [ ] **Step 1: Write tests** for the user-facing handlers (torrents, bookmarks, notifications, invites, preferences, activity, wiki, rss, requests, tags, categories, announcements).
- [ ] **Step 2: Convert the 14 files to `db`.**
- [ ] **Step 3: Run gate.**
- [ ] **Step 4: Commit** `refactor: migrate user controllers to prisma 8 orm client`.

---

## Phase 4 — Remove Prisma 7

### Task 14: Delete v7 and final verification

**Files:**
- Modify: `src/lib/prisma.ts` (drop `prisma` export)
- Modify: `package.json` (drop v7 deps/scripts)
- Delete: `api/prisma/`, `api/src/generated/prisma/`, `api/prisma7.config.ts`

- [ ] **Step 1: Confirm nothing imports `prisma` anymore**

Run: `rg -n "from '.*lib/prisma" src | rg "prisma"` and `rg -n "\bprisma\." src`
Expected: only `db` usages remain.

- [ ] **Step 2: Remove the v7 client and deps**

```bash
pnpm remove @prisma/prisma7 @prisma/client @prisma/adapter-pg
```

Delete `prisma7.config.ts`, `prisma/`, `src/generated/prisma/`. Remove the `prisma7:*` scripts.

- [ ] **Step 3: Simplify `src/lib/prisma.ts`** to export only `db`.

- [ ] **Step 4: Final gate**

```bash
pnpm exec tsc --noEmit
pnpm run lint
pnpm test
pnpm run bundle
node scripts/smoke-bundle.mjs
```

- [ ] **Step 5: Ensure the migrate image uses only v8**

Confirm `api/Dockerfile` `migrate` target uses the v8 CLI and contract, and the builder no
longer needs the v7 generator.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor: remove prisma orm 7, run entirely on prisma orm 8"
```

---

## Self-review notes

- Spec coverage: Tasks 1–3 → P0; 4–6 → P1; 7 → P2; 8–13 → P3; 14 → P4. Testing section →
  Tasks 2, 3, 6 and the per-group tests. Docker/pnpm → Tasks 2, 14.
- Known deliberate placeholder: Task 6 Steps 1–2 start with stubbed assertions because the
  exact v8 transaction/raw/enum syntax is not yet verified against the RC; the task exists
  specifically to replace the stubs with real assertions before any group rewrite, and to
  update the mapping table.
- Type/name consistency: the singleton exports are `prisma` (v7) and `db` (v8) throughout;
  `makeApp()`/`buildApp()`/`resetDb()` names are stable across tasks.
