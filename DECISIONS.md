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

## Core API

- **`GET /devices`** returns every device with its `ports` embedded. A homelab is small and the rack view needs all ports for wiring, so one call beats N+1.
- **Unplaced devices:** a device with no rack and no shelf sits in the unracked tray. This applies to rack-mount devices too (for example, a planned switch not yet installed).
- **Changing a device's template** rebuilds its ports from the new template. Ports whose labels match keep their id and their cable; the rest are removed with their cables.
- **`POST /devices/:id/duplicate`** (for the context menu) copies the device and its per-device port customisations into the unracked tray.
- **Rack shrink guard:** `PATCH /racks/:id` refuses a smaller `total_units` that would cut off a device.
- **Custom template edits:** height and form factor cannot change while devices use the template (it would invalidate placements). Other fields can.
- **IP warnings** are computed server-side on every IP read: `duplicate_ip` (the same host address on another device) and `outside_vlan_subnet` (Postgres `inet <<= cidr`). Each device has at most one primary IP: setting one clears the others.
- **Services:** a parent must be on the same device and cannot be a descendant (no cycles). Moving a service to another device moves its children with it.
- **Notes search** combines Postgres full-text (`websearch_to_tsquery('simple')`) with substring matching, so partial words still hit.
- **Credentials:** writing any secret field needs an unlocked vault (`423` otherwise). Metadata edits (label, username, URL) do not. TOTP seeds are normalised (spaces and padding removed, uppercased). The 6-digit TOTP code is computed in the browser from the revealed seed.
- **Projects:** `GET /projects/badges` returns open-project counts per device (including through the device's services) for rack badges. `GET /projects?device_id=` covers the device and its services. A status change through `PATCH` appends to the end of the target column. `POST /projects/:id/move` places at an exact index and renumbers both affected columns in one transaction.
- **Export** includes `vault_meta` (wrapped keys only) so encrypted credentials can be restored. Sessions, login attempts and the app password are not exported.
- **Import** validates the whole file (Zod structure, references between tables, link uniqueness, rack bounds and overlaps), then replaces all lab data in a single transaction. Built-in templates are matched by `key` to this install's built-ins. Every unlocked vault is locked after an import.
- **Seed** runs at startup only when no seed has ever been loaded and there are no racks (`SKIP_SEED=true` disables it). Each seeded row is recorded as a `seed.entity` audit entry, which is what Settings → "Delete seed data" removes. The router's cable to Switch 1 uses its `LAN 1` port.
- **Settings** additionally exposes `seed_loaded` / `seed_present`. `GET /api/audit` returns the last 500 entries.

## Frontend shell

- **Shared response types** live in `packages/shared/src/types.ts` next to the Zod input schemas.
- **API client** (`apps/web/src/lib/api.ts`) reads the `rm_csrf` cookie and sends `X-CSRF-Token` on every non-GET request. Any `401 unauthenticated` drops the app back to the login screen.
- **State:** Zustand stores per concern: `auth`, `lab` (racks, templates, devices, links, project badges, selection, undo history), `ui` (view preferences in `localStorage`, guarded for private windows), `vault`, `toast`.
- **Undo/redo** keeps up to 100 steps (the spec asks for at least 50) in the lab store. Each step replays through the API. Deleting a device and undoing re-creates it with new ids, so the store keeps an alias map (old id → new id) that older steps resolve through. Undo of a delete restores per-device port edits, the device's cables and anything that sat on it (if it was a shelf).
- **Routing:** Rack is the index route. Topology, Docs, Projects, Audit and Settings are lazy-loaded.
- **Dialogs** are custom accessible modals with a focus trap and Escape to close. `window.confirm` is never used.
- **Theme:** dark by default via Tailwind's `class` strategy, toggled in the header and remembered per browser.

## Rack view

- **Scale:** the device face between the rails is 10 rack units wide (a 19" faceplate is about 10.9 U wide; the rails take the rest). Zoom changes the unit height from 28 to 80 px and everything scales from it.
- **Rail holes** use the EIA-310 pattern of three holes per U at 0.25", 0.875" and 1.5" from the top of the unit.
- **Shelf riders** sit on the tray lip of their slot, centred and drawn to scale (half width on the built-in 2-slot shelves).
- **Unracked tray** lays devices out two per row, scaled down to fit, and they stay wireable.
- **Library drops** use HTML5 drag-and-drop. Moving placed devices uses pointer events with a 5 px threshold, so a click still selects. A new device is named "<template> N" and opens inline rename straight away.
- **Keyboard:** Up/Down move a rack device one unit, Left/Right move a shelf rider between slots, F2 renames, Delete asks to confirm, Escape cancels wiring then deselects, Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y undo and redo.
- **Device status** visuals: offline dims LEDs and adds a grey overlay; planned is drawn translucent with a dashed outline.
- **Project badges** sit at the device's top right, with the count in an SVG `<title>` tooltip.
- **Search** in the top bar dims devices whose name, hostname, role or tags do not match.

## Wiring

- **Cable routing:** each cable leaves rack gear along the device's lower lip and loose gear at its port's height. It runs sideways with a gravity sag (a cubic curve, dip proportional to length, capped at 14 px) into a vertical lane beside the rack, then mirrors into the far port. The lane side is the one nearer the midpoint of the two ports.
- **Lanes:** each side has as many 7 px lanes as fit in its margin. Cables are routed longest first, and each takes the lane with the fewest cables overlapping its vertical span (ties go to the inner lane).
- **Wire mode** turns every visible port into a focusable button (Enter or Space picks it) with a pulsing target. Picking a port that already has a cable warns straight away instead of waiting for the second click. A dashed rubber band follows the pointer from the first port. Escape cancels the pending cable, and a second Escape leaves wire mode.
- **New cables** default to cat6 blue. A speed mismatch is shown as a warning toast and in the cable inspector, never as an error.
- **Dim unrelated** fades cables that do not touch the selected device. **Show cables** hides cables but wire mode still works.
- **Fibre** cables use the same stroke for now; the type is shown in the tooltip and inspector.

## Device drawer

- **Markdown** is rendered by a small in-app renderer that builds React elements (never `innerHTML`, so no XSS). It covers headings, emphasis, links (http, https and mailto only), lists, `- [ ]` checklists (clickable, saved back to the note), quotes, tables and fenced code blocks with light keyword, string, number and comment highlighting. No Markdown or highlighting library was added.
- **Notes editor** offers Write, Preview and Split views. Search is debounced and uses the server's full-text search.
- **Services tree** reparents by HTML5 drag-and-drop onto another service, or onto a "top level" drop zone (there is also a button for it). The server rejects cycles and cross-device parents.
- **IP dialog** can create a VLAN inline. Warnings (duplicate IP, outside VLAN subnet) show as badges with the full message on hover, and as toasts on save.
- **Vault UI:** any call that returns `423 vault_locked` opens the master-password prompt and retries once after unlocking. Revealed secrets hide after 15 s, with a countdown bar. Copy clears the clipboard after 30 s if it still holds the copied value; when the browser refuses clipboard reads, it is cleared without checking. TOTP codes are computed in the browser (RFC 6238, SHA-1, 6 digits, 30 s) with a countdown ring.
- **Password generator** uses `crypto.getRandomValues` with rejection sampling, skips look-alike characters (l, I, O, 0, 1) and guarantees one character from each enabled class.
- **Recovery phrase** is shown once in a dialog that cannot be closed until the user ticks "I have written the recovery phrase down".
- **Settings** was built in this phase (the vault UI needs it): vault setup, master and app password changes, auto-lock timeout, rack height, default unit height, motion override, backup and restore, and delete seed data.

## Topology and Docs

- **Topology root** is the router with the most cables. Without a cabled router, the best-connected device is the root. Depth is the BFS hop count. Children are ordered by the parent port they hang off (Port 1, Port 2, ...), then by name, so the seed renders exactly as section 10 describes. A unit test in `apps/web/src/lib/topology.test.ts` locks this in.
- **Edges:** BFS tree edges are solid. Extra cables that would form loops (redundant links) are dashed. Both port names sit on the curve itself, so labels on fanned-out edges stay apart.
- **Hidden and separate devices:** shelves are not shown in the topology. Devices without cables are listed in a "Not connected" row below the tree. Each separate connected group is laid out from its own best-connected device.
- **Primary IP on cards** falls back to the device's first IP when none is marked primary.
- **Docs search** runs in the browser over devices, IPs, services, notes and projects (archived included), from two characters up. A homelab's data is small enough that this beats a search endpoint.
- **IP plan** sorts IPv4 addresses numerically (IPv6 after). Its "status" filter is the owning device's status.
- **Inventory** prints through the browser with print CSS that hides the app chrome. Shelves are left out.
- **VLAN management** lives on the Docs page, and a VLAN can also be created inline from the IP dialog.

## Projects

- **Board:** HTML5 drag-and-drop between and within columns. A blue insertion bar shows the drop position, and the board reorders optimistically before syncing with the server's renumbering. Keyboard alternative: focus a card, press M (or use its menu button) for the status menu, and Alt+Up/Down to reorder within a column.
- **Complete column** starts collapsed (narrow, with a count) and still accepts drops. Expanding it shows the completed cards.
- **Quick add** at the top of each open column creates a project with just a title in that column. The collapsed Complete column has none.
- **Overdue** means a due date before today on a project that is not complete. It shows red on cards and in the list.
- **List view:** clickable column headers sort (Title, Status, Priority, Due, Updated); the default sort is in progress, not started, complete, then priority high to low, then due date. Filters: status, priority, linked or unlinked, device (which also matches projects linked through that device's services), tag and free text. The status cell is an inline dropdown.
- **Link picker** searches device names, roles, hostnames and OS plus service names, kinds and host device, ignoring filler words ("on", "the"). So "CT on the server" finds the R420 and its containers.
- **Archived** projects disappear from the board and list but still appear in Docs search and exports. Unarchive from the project drawer.

## Polish

- **Nightly backups** run at 03:00 server time, plus once a minute after start if today's file is missing. Each one is written as `rackmap-YYYY-MM-DD.json` (via a temp file and rename, mode 600) to `BACKUP_DIR`. Files older than `BACKUP_RETENTION_DAYS` (default 14) that match that name are deleted; other files in the folder are never touched. `BACKUPS_ENABLED=false` turns this off.
- **PNG and SVG export** serialise the live rack SVG (defs included, inline rename removed, LEDs frozen on, dark background added). PNG renders at 2x.
- **Performance:** lit LEDs use a translucent halo circle instead of an SVG blur filter, and the rack SVG gets its own compositor layer (`will-change: transform; contain: paint`). Measured in headless Edge with 60 devices and 100 cables: 141 fps scrolling at 44 px/U, 143 fps at 80 px/U (display cap 144).
- **Accessibility:** Lighthouse accessibility scores 100 on the rack, topology, docs, projects, settings and audit pages, and on the setup screen. Changes made: a skip link and `<main>` landmark; dark-mode secondary text lifted to slate-400 for contrast; the primary button darkened to sky-700; the vault button's accessible name starts with its visible text; project cards take their name from their content, with the keyboard hint in `aria-describedby`. Every interactive SVG element (devices, ports in wire mode, cables, topology cards) is focusable with a label.
- **Audit page** shows the last 500 entries with text and type filters.

## Deployment

- **Production database guard:** with `NODE_ENV=production`, the API refuses to start unless `DATABASE_URL` (or, for a deliberate single-container install, `PGLITE_DIR`) is set. It never silently runs on an in-memory database.
- **Image verification:** Docker is not installed on the build machine, so the image itself was not built here. The `prod-deps` stage (`npm ci --omit=dev --workspace apps/api`) and the runtime layout (`apps/api/dist`, `apps/api/drizzle`, `apps/web/dist`) were reproduced by hand and started with `NODE_ENV=production`. It served `/healthz` with 200, the SPA, and the strict CSP headers, and it refused to start without a database. The first real `docker build` / CapRover deploy is still to be done on the homelab.
- **Persistent data:** CapRover maps `/data` (backups, and PGlite data if used). Postgres runs as its own one-click app.
- **Screenshots** in `docs/screenshots` were captured from the built app with the sample lab and example IPs.
