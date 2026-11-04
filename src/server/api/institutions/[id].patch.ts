/*
 * PATCH /api/institutions/:id — umbenennen (nur Administratorinnen).
 * Body: { name }. Der Kurzname bleibt.
 */
import { db } from '../../db'
import { institutionUmbenennen } from '../../lib/institutionen'
import { requireAdmin } from '../../utils/session'
import { noStore } from '../imports/_lib'
import { alsAntwort, institutionIdOf } from './_lib'

export default defineEventHandler(async (event) => {
  noStore(event)
  await requireAdmin(event)
  const id = institutionIdOf(event)
  const body = (await readBody(event).catch(() => null)) as { name?: unknown } | null
  await alsAntwort(() => institutionUmbenennen(db(), id, body?.name))
  return { ok: true }
})
