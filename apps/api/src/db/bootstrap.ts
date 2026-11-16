import { sql } from 'drizzle-orm';
import type { DB } from './client';
import { deviceTemplates, appSettings } from './schema';
import { BUILTIN_TEMPLATES } from './templates';

/**
 * Idempotently installs the built-in device templates (spec 4.3) and the settings row.
 * Runs after migrations on every start, so built-ins are always present and always
 * match the shipped definitions (they are read-only to users).
 */
export async function ensureBuiltins(db: DB): Promise<void> {
  for (const t of BUILTIN_TEMPLATES) {
    await db
      .insert(deviceTemplates)
      .values({ ...t, shelf_slots: t.shelf_slots ?? null, is_builtin: true })
      .onConflictDoUpdate({
        target: deviceTemplates.key,
        set: {
          name: t.name,
          category: t.category,
          form_factor: t.form_factor,
          height_u: t.height_u,
          width_fraction: t.width_fraction,
          port_layout: t.port_layout,
          illustration_key: t.illustration_key,
          shelf_slots: t.shelf_slots ?? null,
          is_builtin: true,
          updated_at: sql`now()`,
        },
        where: sql`${deviceTemplates.is_builtin} = true`,
      });
  }
  await db.insert(appSettings).values({ id: 1 }).onConflictDoNothing();
}
