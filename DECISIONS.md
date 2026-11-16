# Decisions

Assumptions and choices made where the spec was silent, or where the build environment forced a choice.

## Build and tooling

- **Shared package ships TypeScript source.** `packages/shared` is consumed as `.ts` by Vite (web) and bundled into the API by `tsup` (`noExternal`). This avoids a separate compile step and keeps one source of truth for Zod schemas.
- **API bundling:** `tsup` (esbuild) produces a single ESM bundle in `apps/api/dist`. Dev uses `tsx watch`. Tests use `vitest` + `supertest`.
- **Linting:** ESLint 9 flat config with `typescript-eslint` and `eslint-plugin-react-hooks`.
- **Local database without Docker:** the development machine has no Docker or Postgres install. When `DATABASE_URL` is unset, the API uses **PGlite** (Postgres 16 compiled to WASM, supported by Drizzle) stored in `PGLITE_DIR` (or in memory for tests). Production always uses real PostgreSQL 16 via `DATABASE_URL`. The same SQL migrations run against both.
- **Container port:** the Docker image listens on port 80 by default (CapRover's default container HTTP port); override with `PORT`.

## Data model

- **Enums** are Postgres enums generated from the arrays in `packages/shared/src/enums.ts`, so the API, the web app and the database share one list. `port_kind` adds `vga` (the R420 has a VGA port and the spec's list had no fitting kind).
- **Built-in templates** are upserted on every start (after migrations) rather than written into a SQL migration, so port layouts are defined once in TypeScript. Built-ins are only ever overwritten by the shipped definition; users edit clones.
- **Shelves** carry a `shelf_slots` count on the template (both built-in shelves have 2 slots). A loose device fits a slot if its `width_fraction` is at most `1 / shelf_slots` and its `height_u` is at most the shelf's height.
- **Loose device heights:** router, Raspberry Pi and laptop are 1U high; tower PC is 2U high (so it only fits a 2U shelf or the unracked tray).
- **Laptop wifi flag:** represented by the device tag `wifi`; the illustration shows a wifi glyph when present.
- **Deleting a shelf** sets the devices on it to unplaced (they move to the unracked tray) rather than deleting them.
- **Deleting a service** cascades to its child services (a VM's containers), their notes and credentials.
- **Sessions** are stored in Postgres (`sessions` table, keyed by a SHA-256 of the cookie token) so restarts do not log the user out. The vault data key is never stored there: it lives only in process memory (spec 6).
- **Login rate limiting** is persisted in `login_attempts` (per IP) in addition to the in-memory limiter.
- **Settings** live in a single-row `app_settings` table. The vault auto-lock timeout is capped at 10 minutes, the spec's maximum.
- **Projects** get an `archived` flag for the Archive action in 11a. `due_date` is stored as an ISO `YYYY-MM-DD` string.
- **Vault recovery** stores its own KDF params next to the second wrapped copy of the data key.
