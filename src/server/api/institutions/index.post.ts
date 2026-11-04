/*
 * POST /api/institutions — eine Institution anlegen (nur Administratorinnen).
 * Body: { name }. Der Kurzname entsteht aus dem Namen.
 */
import { db } from '../../db'
import { institutionAnlegen } from '../../lib/institutionen'
import { requireAdmin } from '../../utils/session'
import { noStore } from '../imports/_lib'
import { alsAntwort } from './_lib'

export default defineEventHandler(async (event) => {
  noStore(event)
  await requireAdmin(event)
  const body = (await readBody(event).catch(() => null)) as { name?: unknown } | null
  const id = await alsAntwort(() => institutionAnlegen(db(), body?.name))
  setResponseStatus(event, 201)
  return { ok: true, id }
})
