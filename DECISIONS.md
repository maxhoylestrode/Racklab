# Decisions

Assumptions and choices made where the spec was silent, or where the build environment forced a choice.

## Build and tooling

- **Shared package ships TypeScript source.** `packages/shared` is consumed as `.ts` by Vite (web) and bundled into the API by `tsup` (`noExternal`). This avoids a separate compile step and keeps one source of truth for Zod schemas.
- **API bundling:** `tsup` (esbuild) produces a single ESM bundle in `apps/api/dist`. Dev uses `tsx watch`. Tests use `vitest` + `supertest`.
- **Linting:** ESLint 9 flat config with `typescript-eslint` and `eslint-plugin-react-hooks`.
- **Local database without Docker:** the development machine has no Docker or Postgres install. When `DATABASE_URL` is unset, the API uses **PGlite** (Postgres 16 compiled to WASM, supported by Drizzle) stored in `PGLITE_DIR` (or in memory for tests). Production always uses real PostgreSQL 16 via `DATABASE_URL`. The same SQL migrations run against both.
- **Container port:** the Docker image listens on port 80 by default (CapRover's default container HTTP port); override with `PORT`.
