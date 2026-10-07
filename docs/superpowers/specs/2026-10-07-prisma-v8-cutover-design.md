# Prisma ORM 7 → 8 Full Cutover — Design

Date: 2026-10-07
Branch: `api/prisma-v8`
Status: Approved (design), pending spec review

## 1. Summary

Migrate the `api` backend from Prisma ORM 7 to Prisma ORM 8 and remove Prisma ORM 7
entirely. This is a query-API rewrite, not a version bump: the v8 ORM client exposes a
different, chainable API (`db.orm.public.User.where(...).all()`) and a new
contract-based configuration.

The migration follows the official guide
(https://www.prisma.io/docs/guides/upgrade-prisma-orm/postgresql) but is executed as an
incremental, side-by-side move so the app stays shippable at every step and each step is
independently verifiable.

## 2. Goals / Non-goals

Goals:
- Application code runs entirely on the Prisma ORM 8 client.
- Schema migrations are owned by Prisma ORM 8 (contract + migration graph).
- Prisma ORM 7 packages, config, schema, and generated client are removed.
- Existing database schema and data semantics are unchanged.

Non-goals:
- No schema or data migration beyond what already exists.
- No behavioral change to API routes.
- The live production database is never touched. All v8 CLI commands run against a local
  podman Postgres.

## 3. Baseline (current state)

- Branch `api/prisma-v8` off `api/native-free`; latest commit `e2b6058 chore: update deps`.
- Prisma: `prisma` CLI 7.10.0, `@prisma/client` 7.10.0, `@prisma/adapter-pg` 7.10.0.
- Generator: `prisma-client` with `output = "../src/generated/prisma"`.
- Single shared client at `src/lib/prisma.ts` (exported as `prisma`); imported by all modules.
- Query surface: 39 files, ~383 `prisma.*` call sites across 25 models.
  - Reads: `findUnique` 97, `findMany` 57, `findFirst` 25
  - Writes: `update` 69, `create` 29, `delete` 24, `upsert` 4
  - Aggregates: `count` 34, `aggregate` 3
  - `include:` 42, `select:` 77
  - `$transaction` 6, `$executeRaw` 1
- Migrations: 47 entries under `prisma/migrations`.
- No integration tests. Test suite = 6 argon2 unit tests (`npm test`).
- Toolchain note: dep commit aliases `typescript` to `@typescript/typescript6` and adds
  `@typescript/native`; `npx tsc --version` reports 7.0.2 (native compiler). `npm test`
  currently passes.
- Package manager is pnpm (12.9.1); `pnpm-workspace.yaml` configures `allowBuilds` for
  Prisma/esbuild. `package-lock.json` and `bun.lock` are stale leftovers; the Dockerfile
  still uses `npm ci` and must be switched to pnpm.

## 4. Targets

- Prisma 8 CLI: `prisma@8.0.0-rc.20` (pin exact).
- Prisma 8 runtime: `@prisma/orm-postgres@8.0.0-rc.14` (pin exact).
- Prisma 7 CLI retained during migration as `@prisma/prisma7@7.10.0`.
- `@prisma/client` and `@prisma/adapter-pg` remain at 7.10.0 until Phase 4.
- Local database: podman container from `docker.io/library/postgres:18-alpine`.

## 5. Directory layout

During migration (side-by-side):

```
api/
  prisma.config.ts          # v8 config (definePrismaConfig + @prisma/orm-postgres/config)
  prisma7.config.ts         # v7 config (temporary)
  prisma/
    schema.prisma           # v7 schema (temporary)
    migrations/             # v7 migrations (temporary)
  prisma8/
    contract.prisma         # v8 contract (inferred from local DB)
  src/
    generated/prisma/       # v7 client (temporary)
    generated/prisma8/      # v8 emitted contract.json + contract.d.ts
    lib/prisma.ts           # exports both `prisma` (v7) and `db` (v8)
```

The v8 generated output is placed under `src/generated/prisma8` so it stays within the
`src` tree covered by tsconfig `include`/`rootDir`.

After Phase 4 (end state):

```
api/
  prisma.config.ts          # v8 only
  prisma8/contract.prisma
  src/generated/prisma8/
  src/lib/prisma.ts         # exports `db` only
```

## 6. Dual client during transition

`src/lib/prisma.ts` exports both clients, connected to the same database:

```ts
// v7 (unchanged name)
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.js";
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
export const prisma = new PrismaClient({ adapter });

// v8 (added)
import postgres from "@prisma/orm-postgres/runtime";
import type { Contract } from "../generated/prisma8/contract.js";
import contractJson from "../generated/prisma8/contract.json" with { type: "json" };
export const db = postgres<Contract>({ url: process.env.DATABASE_URL!, contractJson });
```

Migrated modules import `db`; not-yet-migrated modules keep importing `prisma`. The
`prisma` export is deleted in Phase 4.

## 7. Config, packages, tsconfig

- `package.json` scripts (during migration):
  - v8: `contract:emit`, `db:sign`, `db:verify`, `migration:plan`, `db:migrate`
  - v7 (temporary): `prisma7:generate`, `prisma7:migrate`, `prisma7:seed`
- `tsconfig.json`: set `module` and `moduleResolution` to `nodenext` (the project compiles
  with `tsc` and runs with `node` under `"type": "module"`), add `resolveJsonModule: true`,
  and include `src/generated/prisma8/**/*.d.ts`. This reverts the current
  `ESNext`/`bundler` values because v8 emits `contract.json`, imported with
  `with { type: "json" }`, which requires one of `esnext|node18|node20|nodenext|preserve`.
  Under `nodenext` the contract type is imported as `../generated/prisma8/contract.js`
  (type-only), not `contract.d`. `src/generated/prisma8/` is added to the ESLint ignores
  (machine-generated, same as the v7 client).
- Docker:
  - Dependency management moves to pnpm; both `builder` and `migrate` stages use
    `pnpm install --frozen-lockfile` (add `corepack enable` / `pnpm` to the images).
  - The `migrate` image switches to the v8 CLI and the v8 migration loop.
  - The `runtime` image is unchanged; the single-file bundle stays self-contained
    (verified previously: `build/index.mjs` runs with no `node_modules`).

## 8. Migration ownership handoff (local DB only)

1. Start local podman Postgres, point a local `DATABASE_URL` at it.
2. `prisma7 migrate deploy` to rebuild the schema from the existing 47 migrations.
3. `prisma contract infer --output prisma8/contract.prisma` from the local DB.
4. Delete the `PrismaMigrations` model from the inferred contract.
5. `prisma contract emit` to produce `src/generated/prisma8/contract.json` + `.d.ts`.
6. `prisma db sign` to record the marker/snapshot/ref against the local DB.
7. Verify the handoff with an additive change: `contract emit` → `migration plan` →
   `db migrate --advance-ref db` → `db verify`.

The live database is never modified.

## 9. Query-layer rewrite

Mechanical mapping (verify each against docs while migrating):

| Prisma 7 | Prisma 8 ORM client |
| --- | --- |
| `findUnique` / `findFirst` | `.where(...).first()` |
| `findUniqueOrThrow` / `findFirstOrThrow` | `.where(...).all().firstOrThrow()` |
| `findMany` | `.where(...).all()` |
| `create({ data })` | `create(object)` |
| `update({ where, data })` | `.where(...).update(object)` |
| `delete({ where })` | `.where(...).delete()` |
| `upsert` | `.where(...).upsert(...)` |
| `updateMany` / `deleteMany` | `updateAndCount` / `deleteAndCount` |
| `createMany` / `createManyAndReturn` | `createAndCount` / `createAll` |
| `count` | `.aggregate((a) => ({ n: a.count() }))` |
| `include: { rel: true }` | `.include("rel")` |
| `select: {...}` | `.select(...)` |
| `$transaction` | v8 transaction API |
| `$executeRaw` / `$queryRaw` | `db.sql` / `db.raw` |

Special cases requiring doc verification and targeted tests:
- `$transaction` (6 sites): exact v8 transaction semantics and callback form.
- `$executeRaw` (1 site): `db.sql` / `db.raw` equivalent.
- Native enums: contract inference yields `native_enum`; confirm returned values match the
  string literals compared in code (e.g. `role === 'ADMIN'`).
- BigInt fields (`upload`, `download`): confirm read/write and JSON serialization.
- Nested writes: `create`/`connect`/`disconnect` syntax on relations (42 `include` sites
  imply relation-heavy code).
- Relation filters and aggregates (`some`, `every`, `count` over relations).

Work is grouped by route/service to keep each commit reviewable and bisectable.

## 10. Testing and verification

The repo currently has no integration tests; a 383-site rewrite cannot be validated by
`tsc` alone.

- New integration harness: boot the Fastify app with `.inject()` against the local podman
  Postgres, seeded from a fixture file. Add tests per migrated group.
- Per-group gate: new integration tests pass, plus existing tests.
- Whole-repo gate (run after every group): `tsc --noEmit`, `eslint`, `npm test`,
  `npm run bundle`, and the standalone-bundle smoke test (run `build/index.mjs` from an
  empty dir with no `node_modules`).

## 11. Phases

- P0 — Prep: create branch (done), start local podman Postgres, switch local tooling and the
  Dockerfile to pnpm, pin versions, establish a green baseline (lint/tsc/test/bundle), build
  the integration harness skeleton.
- P1 — v8 tooling side-by-side: install v8 packages, rename v7 config to
  `prisma7.config.ts`, add `prisma.config.ts` (v8), infer/emit the contract, add the `db`
  client, update tsconfig/scripts. Gate: tsc passes; app still runs on v7; no route changed.
- P2 — Ownership handoff: `db sign` + additive-change verification on local DB.
- P3 — Rewrite routes/services to `db`, group by group, each with integration tests and a
  green whole-repo gate.
- P4 — Remove v7: uninstall v7 packages, delete `prisma7.config.ts`, `prisma/`,
  `src/generated/prisma`; drop `prisma` export; update Docker migrate image and README.
  Final gate: `tsc --noEmit`, `eslint`, tests, bundle, standalone smoke test.

## 12. Execution model

Implementation is delegated to subagents; the main session supervises, integrates, and
verifies each task against the gates above before proceeding. Independent tasks (e.g.
per-route rewrites) may run in parallel where they do not share files.

## 13. Risks and mitigations

- RC churn: versions are pinned; API differences against RC docs are verified per task.
- Unverifiable scale: integration tests + incremental commits + per-group gates.
- Semantic drift (enums, BigInt, raw SQL, transactions): flagged special cases get targeted
  tests.
- Toolchain ambiguity (native TS 7, stale npm/bun lockfiles): P0 switches everything to
  pnpm and confirms which commands the gates use.
- Live DB safety: all v8 CLI commands run against local podman Postgres only.

## 14. Rollback

Revert commits on the `prisma-v8` branch, or return to `api/native-free`. Prisma ORM 7
remains functional until Phase 4, so any point before P4 is a working state.
