/*
 * GET /api/mappings/:id/editor — Startnutzlast des Profil-Editors.
 *
 * Gerechnet wird auf der im Profil hinterlegten Stichprobe. Dieselbe Nutzlast
 * wie am Import; Unterschied sind nur Endpunkt, Subjekt und dass hier nicht
 * konvertiert werden kann — ein Profil gehoert zu keiner Lieferung.
 */
import { db } from '../../../db'
import { editorPayload, institutionName, noStore } from '../_lib'
import { ownProfileSource } from './_source'

export default defineEventHandler(async (event) => {
  noStore(event)
  const { user, profile, source } = await ownProfileSource(event)
  const sql = db()

  const payload = await editorPayload(sql, {
    mode: 'profile',
    endpoint: `/mappings/${profile.id}`,
    subject: profile.name,
    canStart: false,
    source,
    profile,
    user,
    institutionName: await institutionName(sql, user.institution_id),
    withColumnReport: true
  })

  return { payload }
})
