import type { DB } from '../db/client';
import { auditLog } from '../db/schema';

/** Append an audit entry. Callers must never pass secret values in `summary`. */
export async function audit(db: DB, action: string, entityType: string, entityId: string | null, summary = ''): Promise<void> {
  await db.insert(auditLog).values({ action, entity_type: entityType, entity_id: entityId, summary: summary.slice(0, 500) });
}
