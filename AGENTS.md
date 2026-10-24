# AGENTS.md — SQLite-native Ghostfolio fork

Fork of `ghostfolio/ghostfolio` pinned at **3.88.0** (`upstream` remote). Goal: run on **SQLite (WAL) +
better-sqlite3** with the changes made **in TypeScript source**, not patched into a built container at
runtime. Never rewrite upstream files wholesale: keep diffs small so future upstream merges stay easy.

## Reference (current production hack — to be replaced)

`deploy/reference/` holds the working runtime patch from the NAS container:

- `patch.mjs` — regex edits on `schema.prisma`, `seed.mts`, `@prisma/adapter-*` dist, and compiled `main.js`.
- `Dockerfile.runtime-patch` — layers `better-sqlite3`, `@prisma/adapter-better-sqlite3@7.10.0`, embedded Redis, runs `patch.mjs`.
- `entrypoint.sh` — starts Redis, `prisma db push`, enables `PRAGMA journal_mode=WAL; synchronous=NORMAL`, seeds, `node main`.

Treat `patch.mjs` as the spec: every transformation in it must have a source-level equivalent.

## Task

1. `prisma/schema.prisma`: `datasource db { provider = "sqlite" }`; `binaryTargets = ["native"]`;
   `scopes String[] @default([])` → `scopes Json?`; `settings Json @default("{}")` → `Json?`; drop the
   remaining `@default("[]")` / `@default("{}")`. Postgres-only migrations (`prisma/migrations`) are not
   used with `prisma db push` on SQLite; remove them or move out of the way, and document the choice.
2. `prisma/seed.mts`: remove `skipDuplicates: true` (unsupported on SQLite).
3. `apps/api/src/services/prisma/prisma.service.ts`: replace `PrismaPg` with
   `PrismaBetterSqlite3` from `@prisma/adapter-better-sqlite3` (7.10.0, matches `@prisma/client`),
   `url` from `DATABASE_URL` (default `file:/data/ghostfolio.db`). Add `better-sqlite3` and
   `@prisma/adapter-better-sqlite3` to `package.json`; drop `@prisma/adapter-pg` if nothing else uses it.
4. Remove Postgres-only query options in source: `mode: 'insensitive'` (SQLite LIKE is case-insensitive
   for ASCII) and `skipDuplicates: true` on `createMany` (files: `admin.service.ts`,
   `activities.service.ts`, `asset-profiles.service.ts`, `google-sheets.service.ts`, `manual.service.ts`,
   `market-data.service.ts`). For the `MarketData`/`Tag` bulk inserts that relied on
   `INSERT OR IGNORE`, implement idempotence in application code (e.g. upsert or a guarded `createMany`
   fallback), **not** by patching the adapter in `node_modules`.
5. `apps/api/src/services/data-provider/data-provider.service.ts`: replace the Postgres-specific
   `$queryRaw` in `getHistorical` (cast `::"DataSource"`, `ORDER BY date`) with
   `prisma.marketData.findMany({ select: {dataSource, date, marketPrice, symbol}, where: { OR: [...], date: { gte, lte } }, orderBy: { date: 'asc' } })`.
   Grep for any other `$queryRaw` / `$executeRaw` / Postgres-only SQL and handle it the same way.
6. Add `deploy/Dockerfile.sqlite` (multi-stage build from this source, no `patch.mjs`) and
   `deploy/entrypoint.sh` (same 4 steps as the reference, Redis embedded, WAL pragma). Keep the root
   `Dockerfile` untouched.

## Constraints

- `npm ci` must be run with devDependencies (`npm ci --include=dev`); the environment may default to production.
- Do not change behaviour for the default (Postgres) path beyond what the task needs; if a clean
  dual-database setup is impossible, say so in the PR and keep it SQLite-only.
- No secrets, no `.env`, no hardcoded hostnames.
- Conventional commits (`feat|fix|chore(scope): ...`).

## Definition of done

- `npx prisma generate` and `npx prisma db push` succeed against `file:/tmp/test.db`.
- `npx nx build api` succeeds; `npx nx test api` passes (or failures are pre-existing and listed).
- A short test or script exercises: create user → create activity → read historical market data via
  `DataProviderService.getHistorical` on SQLite.
- PR description maps each `patch.mjs` transformation to its source change (a table).
