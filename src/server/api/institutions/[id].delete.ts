/*
 * DELETE /api/institutions/:id — eine leere Institution loeschen (nur
 * Administratorinnen). Haengt irgendetwas an ihr, antwortet der Server mit 409
 * `institution_not_empty` und den Zahlen; geloescht wird dann nichts.
 */
import { db } from '../../db'
import { institutionLoeschen } from '../../lib/institutionen'
import { requireAdmin } from '../../utils/session'
import { noStore } from '../imports/_lib'
import { alsAntwort, institutionIdOf } from './_lib'

export default defineEventHandler(async (event) => {
  noStore(event)
  await requireAdmin(event)
  const id = institutionIdOf(event)
  const { name } = await alsAntwort(() => institutionLoeschen(db(), id))
  return { ok: true, name }
})
