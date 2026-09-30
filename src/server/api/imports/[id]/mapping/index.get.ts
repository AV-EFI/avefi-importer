/*
 * GET /api/imports/:id/mapping — alles, womit der Editor startet.
 *
 * Die Nutzlast entsteht in server/api/mappings/_lib.ts und ist dieselbe wie am
 * gespeicherten Profil. Unterschiedlich sind nur der Endpunkt, das Subjekt und
 * die Frage, ob am Ende konvertiert werden darf.
 */
import { db } from '../../../../db'
import { editorPayload, findOwnProfile, institutionName, noStore } from '../../../mappings/_lib'
import { importSource } from './_source'

export default defineEventHandler(async (event) => {
  noStore(event)
  const { user, row, source } = await importSource(event)
  const sql = db()

  const profile = await findOwnProfile(sql, user.institution_id, source.headerHash)
  const payload = await editorPayload(sql, {
    mode: 'import',
    endpoint: `/imports/${row.id}/mapping`,
    subject: row.filename,
    canStart: true,
    source,
    profile,
    user,
    institutionName: await institutionName(sql, user.institution_id),
    withColumnReport: true
  })

  /*
   * Welche Version diese Seite zeigt, und mit welcher konvertiert wurde.
   *
   * Der Editor bekommt immer den heutigen Stand — alles andere waere eine
   * Falle, weil Speichern den alten Stand fortschriebe. Aber die Seite muss
   * sagen, dass sie den heutigen zeigt: Wer von einem konkreten Import
   * hierherkommt, erwartet die Version, mit der dieser Import gelaufen ist
   * (gemeldet von Jasper Stratil, #6).
   *
   * Verglichen wird nur, wenn es dasselbe Profil ist. Der Kopfzeilenabgleich
   * kann inzwischen ein anderes gefunden haben; dann ist die Versionsnummer
   * des einen fuer das andere ohne Bedeutung.
   */
  const selbesProfil = profile !== null && row.mapping_profile_id === profile.id
  const version = {
    verwendet: row.mapping_version,
    aktuell: profile?.version ?? null,
    profilId: row.mapping_profile_id,
    abweichend: selbesProfil && row.mapping_version !== null && profile.version !== row.mapping_version
  }

  return {
    import: { id: row.id, filename: row.filename, status: row.status, base_format: row.base_format },
    version,
    payload
  }
})
