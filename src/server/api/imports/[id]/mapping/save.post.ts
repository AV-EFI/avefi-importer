/*
 * POST /api/imports/:id/mapping/save — Profil speichern, auf Wunsch konvertieren.
 *
 * Gespeichert wird immer als Profil der eigenen Institution, mit Version und
 * Verlauf. Die Stichprobe wandert mit ins Profil — ohne sie liesse es sich
 * spaeter ohne die Datei nicht bearbeiten.
 *
 * Der Import merkt sich Profil-Id UND Version. Aendert jemand das Profil
 * spaeter, wird der Import deshalb NICHT stillschweigend nachgezogen.
 */
import { db } from '../../../../db'
import { setHeaderHash, setMappingProfile, setStatus } from '../../../../lib/imports'
import { profileKey } from '../../../../lib/converters/profileTable'
import { enqueue } from '../../../../worker/queue'
import { suggestProfileName } from '../../../../lib/mapping/index'
import {
  createProfile, fail, findOwnProfile, institutionName, noStore, setProfileSample, updateProfile
} from '../../../mappings/_lib'
import { prepareSave } from '../../../mappings/_run'
import { importSource } from './_source'

export default defineEventHandler(async (event) => {
  noStore(event)
  const { user, row, source } = await importSource(event)
  const sql = db()

  const body = (await readBody(event)) as { mapping?: unknown; name?: unknown; start?: unknown; derived_from?: unknown }
  const prepared = await prepareSave(source, body?.mapping)
  const wantedName = String(body?.name ?? '').trim()
  const start = body?.start === true

  // Konvertieren nur mit vollstaendigem Profil: Ohne Entscheidung zu jeder
  // Spalte entstuenden Datensaetze, in denen unbemerkt Felder fehlen.
  if (start && !prepared.complete) {
    throw fail(409, 'not_complete', { open: prepared.open }, 'Profil noch nicht vollstaendig.')
  }

  // Und nicht mit einer Zuordnung, die garantiert Saetze ohne Titel erzeugt.
  // Gespeichert wird trotzdem (ERST_BEIM_KONVERTIEREN in runner.ts): Bis zum
  // 12.10.2026 brach diese Stelle VOR dem Speichern mit 409 `start_blocked`
  // ab, und der Editor zeigte "Unerwarteter Fehler." (#29). Jetzt wird
  // gespeichert, nicht gestartet, und die Antwort sagt, warum.
  const startBlocked = start && prepared.startBlocked

  let profile = await findOwnProfile(sql, user.institution_id, source.headerHash)
  if (profile === null) {
    const name = wantedName !== ''
      ? wantedName
      : suggestProfileName(await institutionName(sql, user.institution_id), row.filename)
    const derived = Number(body?.derived_from ?? 0)
    profile = await createProfile(sql, {
      institutionId: user.institution_id,
      userId: user.id,
      headerHash: source.headerHash,
      baseFormat: source.baseFormat,
      name,
      mapping: prepared.mapping,
      sample: prepared.sample,
      derivedFrom: Number.isInteger(derived) && derived > 0 ? derived : null
    })
  } else {
    profile = await updateProfile(sql, profile, prepared.mapping, wantedName === '' ? null : wantedName, user.id)
    await setProfileSample(sql, profile.id, prepared.sample)
  }

  await setHeaderHash(sql, row.id, source.headerHash)
  await setMappingProfile(sql, row.id, profile.id, profile.version)

  let started = false
  if (start && !startBlocked) {
    await setStatus(sql, row.id, 'converting')
    await enqueue(sql, 'worker/convert', { import_id: row.id, converter_key: profileKey(profile.id) }, row.id)
    await sql`UPDATE format_reviews SET status = 'resolved' WHERE import_id = ${row.id} AND status = 'open'`
    started = true
  }

  return {
    started,
    startBlocked,
    profile: { id: profile.id, name: profile.name, version: profile.version, complete: profile.complete },
    checks: prepared.checks,
    complete: prepared.complete,
    open: prepared.open
  }
})
