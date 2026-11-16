# Backup and restore runbook

RackMap's data lives in PostgreSQL. A full JSON export covers everything except sign-in state: racks, templates, devices, ports, cables, IPs, VLANs, services, notes, projects (with links and tasks), settings and the vault. Secrets stay encrypted inside the export, so a backup on its own reveals nothing. The flip side: **restoring it needs the vault master password (or recovery phrase) that was in use when the backup was taken.**

## What runs automatically

- Every night at 03:00 (server time) the app writes `rackmap-YYYY-MM-DD.json` to `BACKUP_DIR` (default `/data/backups`, a CapRover persistent directory).
- Files older than `BACKUP_RETENTION_DAYS` (default 14) are deleted.
- Each run is recorded in the audit log as `backup.nightly`.

Check it is working from **Audit log** (filter `backup`), or list the directory:

```bash
docker exec -it $(docker ps -qf name=srv-captain--rackmap) ls -l /data/backups
```

## Take a manual backup

- In the app: **Settings → Backup and restore → Download JSON export**.
- Or from a shell on the host: copy the newest nightly file out of the persistent volume.

For belt and braces, also back up the Postgres app with CapRover's own volume backup or `pg_dump`:

```bash
docker exec $(docker ps -qf name=srv-captain--rackmap-db) pg_dump -U rackmap rackmap > rackmap-$(date +%F).sql
```

Keep at least one copy off the homelab host (for example on a NAS share or an encrypted cloud bucket).

## Restore from a JSON backup

1. Sign in to RackMap (setting up a fresh install first if needed).
2. Go to **Settings → Backup and restore → Restore from JSON…** and choose the file.
3. Confirm. The whole file is validated first: structure, references between tables, one cable per port, and rack bounds and overlaps. If anything is wrong, nothing changes and the error is shown.
4. On success, **all existing lab data is replaced** in a single transaction, and every unlocked vault is locked.
5. Unlock the vault with the master password from the time of the backup (or its recovery phrase) and reveal a credential to confirm.

The app password is not part of the export. After restoring onto a new install you keep the password you set during setup.

## Restore from a Postgres dump

Use this when the database itself is lost or corrupted.

1. In CapRover, open the `rackmap` app → *App Configs* and set **Instance Count** to `0`, then save. This stops writes during the restore.
2. Replace the database contents:

   ```bash
   docker exec -i $(docker ps -qf name=srv-captain--rackmap-db) psql -U rackmap -c 'drop schema public cascade; create schema public;' rackmap
   docker exec -i $(docker ps -qf name=srv-captain--rackmap-db) psql -U rackmap rackmap < rackmap-YYYY-MM-DD.sql
   ```

3. Set **Instance Count** back to `1` and save. The app runs any pending migrations on start.

## If you lose the vault master password

- Unlock with the **24-word recovery phrase**, then set a new master password under **Settings → Vault**. The recovery phrase keeps working.
- If both the master password and the phrase are lost, the encrypted fields cannot be recovered by anyone. Delete those credentials and re-enter them. Everything else (devices, IPs, notes, projects) is unaffected.

## Test your backups

Every few months, restore the latest nightly file into a throwaway instance (for example `npm run dev:api` locally with `PGLITE_DIR` set), sign in, unlock the vault and reveal one credential.
