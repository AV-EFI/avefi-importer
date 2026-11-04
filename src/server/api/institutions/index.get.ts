/*
 * GET /api/institutions — Institutionen mit Zahl der Konten, Importe und
 * Zuordnungsprofile (nur Administratorinnen). Die Zahlen sagen der Oberflaeche,
 * ob „Loeschen“ angeboten wird, und zeigen, warum nicht.
 */
import { db } from '../../db'
import { listeMitBelegung } from '../../lib/institutionen'
import { requireAdmin } from '../../utils/session'
import { noStore } from '../imports/_lib'

export default defineEventHandler(async (event) => {
  noStore(event)
  await requireAdmin(event)
  return { institutions: await listeMitBelegung(db()) }
})
