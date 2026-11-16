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

## Auth

- **Password hashing:** argon2id via libsodium's `crypto_pwhash_str` (`libsodium-wrappers-sumo`), opslimit 3, 64 MiB. Using one well-known library for both auth and vault crypto avoids a native `argon2` build (npm 11 blocks install scripts by default).
- **Rate limiting detail:** failures within a 15 minute window impose a 1 s, 2 s, 4 s, 8 s backoff before the next attempt; the 5th failure locks that IP until the window ends. A successful login clears the counter. Requests during backoff or lockout get `429` with `Retry-After`.
- **CSRF:** a random token per session, sent in a readable `rm_csrf` cookie and returned by the SPA in `X-CSRF-Token`. The server checks header == cookie == the session's stored token. Setup and login are exempt (no session yet; the session cookie is `SameSite=Strict`).
- **`GET /api/auth/status`** (unauthenticated) was added so the SPA can tell whether to show setup or login. **`POST /api/auth/change-password`** backs the Settings page.
- **Secure cookie flag** follows `COOKIE_SECURE` (default `true` in production) so plain-HTTP local dev still works.
- **`trust proxy`** is set to loopback and private ranges so `req.ip` is the real client behind Nginx Proxy Manager and CapRover.
- **CSP** allows no inline scripts or styles. React sets style properties through the DOM, which CSP does not block.

## Vault

- **Associated data:** every XChaCha20-Poly1305 ciphertext is bound to its slot with associated data (`rackmap:v1:credential:<id>:<field>`, `rackmap:v1:dk`, ...). A ciphertext copied into another row or field fails to decrypt. This is a standard input to the same libsodium primitive, not new cryptography.
- **Verifier** ciphertext and nonce are stored in `verifier` / `verifier_nonce`.
- **Recovery phrase:** 24 English BIP39 words from 256 bits of entropy, via `@scure/bip39` (audited). The normalised phrase (lowercase, single spaces) is the secret for a second argon2id derivation with its own salt and params (`recovery_kdf_params`), which wraps a second copy of DK. The phrase is returned once by `POST /vault/setup` and never stored. `POST /vault/unlock` also accepts `{ recovery_phrase }`.
- **Changing the master password** does not rotate the recovery phrase; the phrase keeps working.
- **Master password must differ from the app password:** checked by verifying the candidate against the stored app password hash, at setup and on change.
- **Unlock throttling:** failed unlocks back off per session (1 s doubling, capped at 64 s). Argon2id at 64 MiB already makes guessing slow.
- **`POST /vault/touch`** lets the UI check that the vault is still unlocked (and refresh its idle timer) without revealing anything.
- **Locked vault responses** use HTTP `423 Locked` with code `vault_locked`, so the UI knows to prompt for the master password.
- **Key store** is per process. Restarting the server locks every vault, which is the safe default.
