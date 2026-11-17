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

## Zero-config deployment (added after the first deploy attempt)

The first CapRover deploy had no environment variables and crash-looped (502), because production required `SESSION_SECRET` and a database. With the user's go-ahead, the app now starts with no configuration:

- **Session secret:** if `SESSION_SECRET` is unset, a random 32-byte secret is generated once and stored in `<DATA_DIR>/session-secret` (mode 600), so restarts keep sessions valid.
- **Database:** in production without `DATABASE_URL` or `PGLITE_DIR`, the built-in PGlite database lives in `<DATA_DIR>/pglite`. It is never in memory. On Linux, startup warns if `DATA_DIR` is not a mounted volume.
- **`DATA_DIR`** defaults to `/data` in production and `./data` in development. Backups default to `<DATA_DIR>/backups`.
- **Secure cookies:** `COOKIE_SECURE` now defaults to `auto`, which sets the flag when the request arrived over HTTPS (directly or through a trusted proxy's `X-Forwarded-Proto`). Plain-HTTP access on the LAN works out of the box. `true` or `false` still forces it. If a proxy in front of CapRover hides the original HTTPS scheme, set `COOKIE_SECURE=true` once HTTPS is the only way in.

## Visual redesign: dark glass (after deployment; superseded by the desk redesign below)

A restyle of the whole UI to a brief from the user. It is a visual-layer change only: no API, data, store or behaviour changes, and the tests are untouched.

- **One token file:** `apps/web/src/styles/tokens.css` holds colour, glass, elevation, radius, spacing, type, motion and z-index. `tailwind.config.js` maps semantic names onto it (`text-ink`, `text-ink-2`, `border-line`, `bg-accent`, `bg-ok/warn/bad/unknown`, `rounded-panel/control/full`, `shadow-base/raised/overlay`). The type scale is restricted to 11 (labels), 12, 13, 14, 16, 20 and 28, the radii to 10, 14 and 999. A codemod moved every screen off the old slate/sky classes.
- **Primitives:** `components/primitives` has Panel, Button, IconButton, Input, Select, Textarea, SearchInput, Field, Chip, Tooltip, Tabs, Table, Dialog, Drawer and EmptyState. They render the token recipes in `index.css` (`.glass`, `.btn-*`, `.input`, `.chip`, `.menu`, `.table-base`). Most screens still write those class names on plain elements rather than the React wrappers: the recipe is the single source either way, and converting about 150 buttons was churn with no visual gain. Dialogs, drawers, tabs, tooltips and search fields go through the components.
- **Glass:** fill (white veil, 0.04, 0.055 or 0.07 by elevation) over a graphite tint, `blur(18px) saturate(140%)`, a 1px border, an inner top highlight and a two-layer shadow. Used on the top bar, library, toolbars, drawers, dialogs, menus, toasts, kanban columns and cards, the list filter header and topology cards. Kanban and topology cards use a lighter 8px blur. Solid, no blur: the rack, illustrations, cables, table bodies, markdown bodies and secret fields. The dialog scrim dims without blurring, so a dialog over a drawer stays within three backdrop layers. `@supports not (backdrop-filter)` and `prefers-reduced-transparency` both swap glass for a near-solid fill.
- **Background:** a fixed scene on `body`: #0a0b0f, three large desaturated teal and indigo radial glows at 6 to 11 percent, an feTurbulence noise texture at about 3.5 percent, and a 48px grid masked to fade toward the edges.
- **Colour:** one accent, #45dde0, for focus, selection, primary buttons, active nav, pressed toggles, progress and link-state LEDs. Link LEDs on ports were green and are now the accent; PoE stays amber. Status colours are separate (green online, amber warning, red offline and overdue, grey unknown). Project priority is coloured only when high. Device illustration colours (purple fan glow, saturated blues, Pi green) were desaturated; the purple RGB glow filter is gone.
- **Type:** Geist and Geist Mono, self-hosted through `@fontsource-variable` (bundled by Vite, so the `font-src 'self'` CSP is unchanged). Mono with tabular numerals for IPs, ports, VMIDs, hostnames, dates and counts. Panels use two weights only (400 and 500); 600 appears only inside the rack SVG.
- **Icons:** Lucide (`lucide-react`), 1.5 stroke, sizes snapped to 16 or 20 in `Icon.tsx`. The star and check glyphs and the text sort arrows were replaced with icons.
- **Rack scene:** powder-coated cabinet with a vertical brush pattern, top light, contact shadow and a faint floor reflection; rail holes are one SVG pattern per rail (fewer nodes than before) with an inner shadow; each racked unit gets a top highlight and a seated shadow; selection is a 1.5px accent outline plus a 1px lift; hover raises brightness. Cables are 2.25px (3px when hovered or selected) with round caps, a soft offset shadow and colours mixed 25 percent toward grey, so they read as cable jacket. The stored cable colour is unchanged.
- **Layout:** the shell floats on an 8px gutter. On phones the rack page stacks: toolbar, scene, then the library as a horizontal strip, and the drawer covers the page as before. The rack toolbar uses a CSS container query to drop the zoom slider when the drawer narrows it. Tooltips are portalled so scroll containers never clip them.
- **Topology:** cards are now HTML buttons (real glass) over a thin SVG edge layer, so the accessible name comes from the visible text. Edges are 1.5px; the far-end port label sits against the target card. No pan or zoom was added: the view still scrolls, as before.
- **Vault:** credential panels use a more opaque fill. The locked state shows a lock icon per row, dims the list and explains the state; unlocked shows an amber note. Revealed secrets sit in a solid inset field with a countdown ring (replacing the bar); the TOTP code has its own ring.
- **Kanban drag:** the card lifts (scale 1.02 and a deeper shadow) for the drag snapshot, then stays as a dashed placeholder; the target column shows a dashed accent outline and an accent insertion line.
- **Light theme** is kept (it is a user setting) and gets the same tokens with inverted ink and frosted-daylight glass. The rack stays dark hardware in both.
- **Checks:** axe reports no contrast failures on any screen in either theme. Lighthouse accessibility is 100 on setup, rack, topology, docs, projects, settings and audit. Scrolling the rack with 60 devices and 100 cables measured 141 fps (unchanged), so no blur had to be removed. The main bundle grew from 490 KB to 521 KB, mostly Lucide icons.
- **Known and unchanged:** axe flags `nested-interactive` on kanban cards (a card is a button that contains its status-menu button). That structure predates the restyle and Lighthouse does not score it; changing it would change keyboard behaviour.

## Desk redesign and Inventory home page (replaces the dark glass look)

Two briefs from the user, applied together: a light, flat "desk" restyle that matches a reference dashboard screenshot, and an addendum that makes the Inventory the home page, with real new behaviour.

### Visual layer

- **Tokens** (`apps/web/src/styles/tokens.css`) were rewritten for a light default:
  - warm grey canvas (#ebebe8)
  - off-white panels (#f7f7f5) with a hairline and at most a 1px shadow
  - black as the primary action colour
  - one pastel teal tint (#bfdcd6 with dark teal text), used only for each screen's summary card and for active filter chips.

  The dark theme is flat graphite with the same layout: black becomes white and the tint becomes a dark teal. Glass, blur, glows, noise and the grid are gone.
- **Theme** follows the operating system unless set manually. The top bar toggle picks light or dark; a second button (and Settings → Display) returns to following the system. The preference key changed from `rackmap.theme` to `rackmap.themePref`, so the first load after upgrading follows the system.
- **Shell:**
  - **Sidebar:** fixed on the left with two groups, DESK (Inventory, Rack, Topology, Projects, Docs) and CONTROLS (Settings, Audit log). At the bottom are an inverted vault card (live lock state, one-click lock or unlock) and a user chip with sign out.
  - **Top bar:** a breadcrumb; a real "x of y online" pill (planned devices excluded); the theme toggle; and a black pill primary action that each page can set (New device, New project).
  - **Phones:** the sidebar opens as a sheet from a menu button.
- **Type and scale:** 13px body, 11–12px meta, 24px page titles (the only use of weight 600), and uppercase group labels at 11px. Radii are 8, 10, 14 and 999.
- **Rack:** the one dark object.
  - **Stage:** the scene sits on a dark recessed panel with a 14px radius. That is the standard panel radius rather than the brief's 16px, to keep to the stated radius set.
  - **Controls:** zoom, layers and the rack/topology switch are small dark pills on the stage. The view switch hides when the drawer narrows the stage.
  - **Selection:** a thin white outline plus the 1px lift.
  - **Colours:** link LEDs went back to green (amber for PoE); cable colours are mixed 38% toward grey.
- **Summary cards:** Projects shows open of total with a bar per status; Docs shows IP addresses with a bar per VLAN. Both use real data only.
- **Vault:**
  - **Revealed secrets:** shown in a dark inset field in both themes, with the countdown ring.
  - **Locked rows:** dimmed icon tiles on a sunk background with lock icons; text contrast is not lowered.
- **Docs** lost its Inventory tab. The inventory is now its own page, with Print and CSV export.
- **Not followed literally:** the reference has a sidebar search box and a user avatar menu. RackMap has a single user and a global search already lives in Docs, so the sidebar has neither.

### Inventory (new behaviour, per the addendum)

- **Routes:** `/` is now Inventory, the rack moved to `/rack`, and `/inventory` redirects to `/`. An old bookmark to `/` therefore opens the inventory, which links to the rack.
- **API:** `GET /api/inventory` returns, per device:
  - the primary IP, with duplicate and out-of-subnet warnings
  - whether any of the device's addresses conflicts
  - the open project count
  - the credential count.

  Every field is listed explicitly. A test asserts that no secret value, credential label or username, and no key other than those six, appears in the payload.
- **Edits** all go through the existing endpoints and their validation: `PATCH /devices/:id`, `POST /devices/:id/move`, `PATCH`/`POST /ip-addresses` and `POST /projects/:id/links`. There are no new write endpoints.
- **Optimistic updates:** `updateDevice` gained an `optimistic` option. It shows the change at once and, if the API rejects it, restores the previous device and shows an error toast. Primary IP edits update the inventory extras optimistically in the same way.
- **Undo:**
  - **`useLab.batch(label, fn)`** collects the steps pushed inside it into one history entry, so a bulk edit undoes with one Ctrl+Z.
  - **`useLab.record(step)`** adds IP edits and project links to the same 50-step history.
- **Rack position:** the cell opens a small picker (rack and bottom unit, shelf and slot, or unracked). It saves through `moveDevice`, so the server's collision rules decide, and the server's message appears inside the picker and as a toast.
- **Columns:**
  - **Shown by default:**
    - name, with a 28px category icon tile and a grey role and template line
    - status, as an inline dropdown chip
    - primary IP, in mono with an amber badge on conflict
    - role
    - template
    - rack position
    - open projects
    - tags
    - last updated.
  - **Optional:** credentials (lock icon and count), hostname and OS.
  - Column choices are kept per browser in `localStorage`.
- **Default sort:** status (offline, unknown, planned, online), then name. IPs sort numerically with "no IP" last.
- **Keyboard:**
  - arrows move the active row, and an open drawer follows
  - Enter opens the drawer
  - Escape closes it, or clears the selection
  - E edits the active row's name
  - Delete removes the checked devices, or the active one, after a confirm that shows the count
  - / focuses search.

  Typing in any field disables the shortcuts.
- **Quick add** creates an unracked device with the chosen template (default: the custom rack device) and opens its drawer. The top bar's New device button focuses it from any page.
- **Show in rack / Show in inventory:** a button in the drawer header switches view, selects the device, switches rack if needed and scrolls the device into view. The rack's context menu also has Show in inventory.
- **Phones (390px):**
  - the table becomes a card list (name, status dot, IP, position)
  - the drawer opens full screen
  - filters scroll sideways
  - grouping and bulk selection are desktop-only.
- **Tests added:**
  - **API:**
    - inventory payload contents and the no-secrets check
    - inline edit validation
    - rack position collision through the move endpoint
    - bulk status
    - primary IP edit with duplicate warnings.
  - **Web logic:** filter and group combinations, sorting, CSV and IP parsing.
  - **Inventory page (jsdom and Testing Library):**
    - inline edit success
    - optimistic edit with rollback and toast
    - keyboard navigation and slash to search
    - bulk status as one undo step, with a shift-click range
    - a collision error shown in the position picker.
  - **Bug found:** writing the sort test showed that `localeCompare` put "no IP" ahead of addresses. IP and position sorting now use plain comparison.
- **Checks:**
  - axe reports no contrast failures on any screen in either theme.
  - Lighthouse accessibility is 100 on setup, inventory, rack, topology, docs, projects, settings and audit.
  - Rack scrolling with 60 devices and 100 cables measured 141 fps.
- **Known and unchanged:** axe's `nested-interactive` warning on kanban cards (a card button that contains its status menu button) predates both redesigns.
