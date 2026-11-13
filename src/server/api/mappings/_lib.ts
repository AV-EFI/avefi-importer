/*
 * Gemeinsames fuer alle Mapping-Endpunkte: Schemamodell, Profilzugriff,
 * Zielkatalog fuer die Oberflaeche und die Nutzlast des Editors.
 *
 * Die Datei liegt unter server/api/, weil dort die Endpunkte liegen. Nitro macht
 * aus jeder Datei in server/api/ eine Route, also traegt sie einen
 * Vorgabe-Handler, der 404 liefert.
 *
 * Fachlogik steht hier keine. Gerechnet wird in server/lib/mapping/; diese Datei
 * uebersetzt zwischen Datenbank, HTTP und jenem Kern — und zwar nur einmal,
 * damit Editor am Import und Editor am gespeicherten Profil nicht auseinander-
 * laufen. Genau das war im PHP-Stand die Quelle der Abweichungen: zwei
 * Aufrufwege, zwei Nutzlasten, ein Unterschied im Detail.
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { H3Event } from 'h3'
import type { Sql } from 'postgres'
import type {
  BaseFormat, MappingJson, MappingProfileRow, ProfileSample, TargetEntry, UserRow, ValidationIssue
} from '#shared/types/domain'
import { db } from '../../db'
import { requireUser } from '../../utils/session'
import {
  allTargets, checkProfileColumns, computeComplete, createSchemaModel, EMPTY_SCHEMA_MODEL, emptyMapping,
  isEmptyRow, klammerVorschlaege, normalizeMapping, openColumns, setSchemaModel, suggestForColumns,
  suggestProfileName, targetHintsFromMappings, targetsForFrontend, transformCatalogForEditor,
  vocabularyCandidates,
  type ProfileColumnReport, type SchemaModel, type SourceRow, type TargetSuggestion, type TitelVorschlag, type TransformOpMeta
} from '../../lib/mapping/index'
import { schemaInfo } from '../../worker/validate'

/* ------------------------------------------------------------------ Fehler */

/** Fehler mit uebersetzbarem Code — die Oberflaeche macht daraus einen Satz. */
export function fail(statusCode: number, code: string, extra: Record<string, unknown> = {}, message?: string) {
  return createError({ statusCode, statusMessage: message ?? code, data: { code, ...extra } })
}

/** Antworten mit Daten einer Institution duerfen nirgends zwischengespeichert werden. */
export function noStore(event: H3Event): void {
  setHeader(event, 'cache-control', 'no-store, private, max-age=0')
  setHeader(event, 'vary', 'cookie')
}

export type UserWithInstitution = UserRow & { institution_id: number }

export async function requireInstitution(event: H3Event): Promise<UserWithInstitution> {
  noStore(event)
  const user = await requireUser(event)
  if (user.institution_id === null) throw fail(409, 'no_institution', {}, 'Konto ohne Institution.')
  return user as UserWithInstitution
}

/* ------------------------------------------------------------- Schemamodell */

let schemaCache: SchemaModel | null = null

/**
 * Das av-efi-schema, einmal gelesen und danach global hinterlegt.
 *
 * Ohne Schema kennt der Zielkatalog keine Wertelisten — die Oberflaeche koennte
 * dann bei "Form", "Elementart" oder "Zugangsstatus" keine zulaessigen Werte
 * anbieten, und die Pruefung liesse jeden Tippfehler durch. Faellt das Lesen
 * aus, wird milder geprueft statt abzubrechen.
 */
export async function schemaModel(): Promise<SchemaModel> {
  if (schemaCache !== null) return schemaCache
  const candidates = [
    join(process.cwd(), 'public/schema/avefi/model.schema.json'),
    join(process.cwd(), '.output/public/schema/avefi/model.schema.json'),
    join(process.cwd(), '../public/schema/avefi/model.schema.json')
  ]
  for (const path of candidates) {
    try {
      const model = createSchemaModel(JSON.parse(await readFile(path, 'utf8')))
      schemaCache = model
      setSchemaModel(model)
      return model
    } catch {
      continue
    }
  }
  schemaCache = EMPTY_SCHEMA_MODEL
  return schemaCache
}

let versionCache: { value: string | null; at: number } | null = null
const VERSION_TTL_MS = 10 * 60 * 1000

/**
 * Kennung der AVefi-Schemaversion, gegen die gemappt wird. Sie wandert ins
 * Profil und in den Export, damit spaeter nachvollziehbar bleibt, welche
 * Wertelisten galten.
 *
 * Das lokale Schemadokument fuehrt kein version-Feld; efi-conv nennt in seiner
 * Gesundheitsauskunft die Pruefsumme der benutzten Version. Die ist als
 * Kennung brauchbar und wird bevorzugt. Faellt der Dienst aus, bleibt null —
 * ein erfundener Wert waere schlimmer als keiner.
 */
export async function avefiSchemaVersion(): Promise<string | null> {
  const model = await schemaModel()
  if (model.version !== null) return model.version
  const now = Date.now()
  if (versionCache !== null && now - versionCache.at < VERSION_TTL_MS) return versionCache.value
  const info = await schemaInfo(4000).catch(() => null)
  const value = info?.version !== undefined && info.version !== null && info.version !== ''
    ? info.version
    : null
  versionCache = { value, at: now }
  return value
}

/* ------------------------------------------------------------ Zielkatalog */

/** Zieleintrag der Oberflaeche: Katalogeintrag plus tatsaechlicher Schemapfad. */
export interface EditorTarget extends TargetEntry {
  /** Pfad im AVefi-Schema — der Vertrag verlangt seine Anzeige. */
  schemaPath: string
  /** Woerter, ueber die die Feldsuche greift. */
  search: string[]
}

/**
 * Baut aus der Bauanleitung eines Ziels den Pfad, der im erzeugten Datensatz
 * entsteht. Der Katalog nennt "Werk > Beteiligte > Regie"; hier steht daneben,
 * wo das im Schema landet.
 */
function schemaPathOf(writer: ReturnType<typeof allTargets>[number]['writer'], level: string): string {
  const root = level === 'work' ? 'WorkVariant' : level === 'manifestation' ? 'Manifestation' : 'Item'
  const short = (category: string): string => category.replace(/^avefi:/, '')
  switch (writer.kind) {
    case 'title':
      return `${root}.${writer.primary ? 'has_primary_title' : 'has_alternative_title[]'}.has_name`
        + ` (${writer.titleType})`
    case 'prop':
      return `${root}.${writer.prop}`
    case 'strlist':
      return `${root}.${writer.prop}[]`
    case 'named':
      return `${root}.${writer.prop}[].has_name`
    case 'subject':
      return `${root}.has_subject[${writer.className}${writer.agentType !== undefined ? `/${writer.agentType}` : ''}].has_name`
    case 'activity':
      return `${root}.has_event[ProductionEvent].has_activity[${short(writer.category)}].has_agent[].has_name`
    case 'eventdate':
      return `${root}.has_event[${short(writer.category)}].has_date`
    case 'eventplace':
      return `${root}.has_event[${short(writer.category)}].located_in[].has_name`
    case 'identifier':
      return `${root}.has_identifier[${writer.resource}].id`
    case 'sameas':
      return `${root}.same_as[${writer.resource}].id`
    case 'duration':
      return `${root}.has_duration.has_value`
    case 'extent':
      return `${root}.has_extent.has_value (${writer.unit})`
    case 'language':
      return `${root}.in_language[${writer.usage}].code`
    case 'format':
      return `${root}.has_format[${writer.className}].type`
  }
  return root
}

/** Zielkatalog fuer die Oberflaeche, mit Schemapfad und Suchwoertern. */
export async function editorTargets(): Promise<EditorTarget[]> {
  const model = await schemaModel()
  const writers = new Map(allTargets().map((t) => [t.key, t.writer]))
  return targetsForFrontend(model).map((t) => {
    const writer = writers.get(t.key)
    const schemaPath = writer === undefined ? t.path : schemaPathOf(writer, t.level)
    const search = [t.key, t.label, t.path, t.group, schemaPath]
      .join(' ')
      .toLowerCase()
      .split(/[^\p{L}\p{N}_]+/u)
      .filter((w) => w !== '')
    return { ...t, schemaPath, search: [...new Set(search)] }
  })
}

export function editorTransforms(): TransformOpMeta[] {
  return transformCatalogForEditor()
}

/* --------------------------------------------------------------- Profile */

export interface ProfileListRow extends Omit<MappingProfileRow, 'mapping_json' | 'sample_json'> {
  institution_name: string
  user_name: string | null
  use_count: number
  has_sample: boolean
  own: boolean
}

const PROFILE_COLUMNS = `
  p.id, p.institution_id, p.created_by_user_id, p.header_hash, p.base_format, p.name,
  p.version, p.complete, p.derived_from_id, p.created_at, p.updated_at`

/**
 * Alle Profile, eigene zuerst. Profile sind bewusst global sichtbar: dieselbe
 * Kopfzeile taucht in mehreren Haeusern auf, und wer schon einmal zugeordnet
 * hat, soll nicht wieder bei null anfangen.
 */
export async function listProfiles(sql: Sql, institutionId: number): Promise<ProfileListRow[]> {
  const rows = await sql<Array<Record<string, unknown>>>`
    SELECT ${sql.unsafe(PROFILE_COLUMNS)},
           (p.sample_json IS NOT NULL) AS has_sample,
           i.name AS institution_name,
           u.name AS user_name,
           (SELECT COUNT(*) FROM imports im WHERE im.mapping_profile_id = p.id) AS use_count
      FROM mapping_profiles p
      JOIN institutions i ON i.id = p.institution_id
      LEFT JOIN users u ON u.id = p.created_by_user_id
     ORDER BY (p.institution_id = ${institutionId}) DESC, p.updated_at DESC, p.id DESC`
  return rows.map((r) => ({
    ...(r as unknown as Omit<MappingProfileRow, 'mapping_json' | 'sample_json'>),
    institution_name: String(r.institution_name ?? ''),
    user_name: r.user_name === null || r.user_name === undefined ? null : String(r.user_name),
    use_count: Number(r.use_count ?? 0),
    has_sample: r.has_sample === true,
    own: Number(r.institution_id) === institutionId
  }))
}

export async function findProfile(sql: Sql, id: number): Promise<MappingProfileRow | null> {
  const rows = await sql<MappingProfileRow[]>`SELECT * FROM mapping_profiles WHERE id = ${id}`
  return rows[0] ?? null
}

/** Das Profil der eigenen Institution zu einer Kopfzeile. */
export async function findOwnProfile(
  sql: Sql,
  institutionId: number,
  headerHash: string
): Promise<MappingProfileRow | null> {
  const rows = await sql<MappingProfileRow[]>`
    SELECT * FROM mapping_profiles
     WHERE institution_id = ${institutionId} AND header_hash = ${headerHash}`
  return rows[0] ?? null
}

/**
 * Fremde Profile mit derselben Kopfzeile. Sie werden zum Kopieren angeboten,
 * nicht verwiesen: Wuerde ein Import auf ein fremdes Profil zeigen, veraenderte
 * eine Aenderung dort fremde Importe.
 */
export async function foreignProfiles(
  sql: Sql,
  institutionId: number,
  headerHash: string
): Promise<Array<{ id: number; name: string; institution_name: string; version: number; complete: boolean }>> {
  const rows = await sql<Array<{ id: number; name: string; institution_name: string; version: number; complete: boolean }>>`
    SELECT p.id, p.name, p.version, p.complete, i.name AS institution_name
      FROM mapping_profiles p
      JOIN institutions i ON i.id = p.institution_id
     WHERE p.header_hash = ${headerHash} AND p.institution_id <> ${institutionId}
     ORDER BY p.updated_at DESC`
  return rows
}

/** Mappings fremder Profile — Quelle fuer Vorschlaege auf Feldebene. */
export async function otherMappings(sql: Sql, institutionId: number, limit = 60): Promise<MappingJson[]> {
  const rows = await sql<Array<{ mapping_json: MappingJson }>>`
    SELECT mapping_json FROM mapping_profiles
     WHERE institution_id <> ${institutionId}
     ORDER BY updated_at DESC
     LIMIT ${limit}`
  return rows.map((r) => r.mapping_json)
}

export interface ProfileVersionRow {
  version: number
  name: string
  created_at: string
  user_name: string | null
}

export async function profileVersions(sql: Sql, id: number): Promise<ProfileVersionRow[]> {
  return sql<ProfileVersionRow[]>`
    SELECT v.version, v.name, v.created_at, u.name AS user_name
      FROM mapping_profile_versions v
      LEFT JOIN users u ON u.id = v.user_id
     WHERE v.profile_id = ${id}
     ORDER BY v.version DESC`
}

export async function versionMapping(sql: Sql, id: number, version: number): Promise<MappingJson | null> {
  const rows = await sql<Array<{ mapping_json: MappingJson }>>`
    SELECT mapping_json FROM mapping_profile_versions
     WHERE profile_id = ${id} AND version = ${version}`
  return rows[0]?.mapping_json ?? null
}

async function writeVersion(
  sql: Sql,
  profileId: number,
  version: number,
  name: string,
  mapping: MappingJson,
  userId: number | null
): Promise<void> {
  await sql`
    INSERT INTO mapping_profile_versions (profile_id, version, name, mapping_json, user_id)
    VALUES (${profileId}, ${version}, ${name}, ${sql.json(mapping as never)}, ${userId})
    ON CONFLICT (profile_id, version) DO NOTHING`
}

export async function createProfile(
  sql: Sql,
  data: {
    institutionId: number
    userId: number | null
    headerHash: string
    baseFormat: BaseFormat
    name: string
    mapping: MappingJson
    sample?: ProfileSample | null
    derivedFrom?: number | null
  }
): Promise<MappingProfileRow> {
  const complete = computeComplete(data.mapping)
  const rows = await sql<MappingProfileRow[]>`
    INSERT INTO mapping_profiles
      (institution_id, created_by_user_id, header_hash, base_format, name, mapping_json, sample_json,
       version, complete, derived_from_id)
    VALUES (${data.institutionId}, ${data.userId}, ${data.headerHash}, ${data.baseFormat}, ${data.name},
            ${sql.json(data.mapping as never)},
            ${data.sample === undefined || data.sample === null ? null : sql.json(data.sample as never)},
            1, ${complete}, ${data.derivedFrom ?? null})
    RETURNING *`
  const row = rows[0]
  if (row === undefined) throw fail(500, 'profile_create_failed', {}, 'Profil konnte nicht angelegt werden.')
  await writeVersion(sql, row.id, 1, row.name, data.mapping, data.userId)
  return row
}

/**
 * Neue Version eines Profils. Die alte bleibt im Verlauf stehen — ein
 * verungluecktes Mapping muss zurueckholbar sein, und ein Import muss belegen
 * koennen, mit welchem Stand er entstanden ist.
 */
export async function updateProfile(
  sql: Sql,
  profile: MappingProfileRow,
  mapping: MappingJson,
  name: string | null,
  userId: number | null
): Promise<MappingProfileRow> {
  const complete = computeComplete(mapping)
  const nextName = name !== null && name.trim() !== '' ? name.trim() : profile.name
  const rows = await sql<MappingProfileRow[]>`
    UPDATE mapping_profiles
       SET mapping_json = ${sql.json(mapping as never)},
           name = ${nextName},
           version = version + 1,
           complete = ${complete},
           updated_at = now()
     WHERE id = ${profile.id}
     RETURNING *`
  const row = rows[0]
  if (row === undefined) throw fail(404, 'profile_not_found', {}, 'Profil nicht gefunden.')
  await writeVersion(sql, row.id, row.version, row.name, mapping, userId)
  return row
}

export async function setProfileSample(sql: Sql, id: number, sample: ProfileSample): Promise<void> {
  await sql`UPDATE mapping_profiles SET sample_json = ${sql.json(sample as never)} WHERE id = ${id}`
}

export async function renameProfile(sql: Sql, id: number, name: string): Promise<void> {
  await sql`UPDATE mapping_profiles SET name = ${name}, updated_at = now() WHERE id = ${id}`
}

export async function deleteProfile(sql: Sql, id: number): Promise<void> {
  await sql`DELETE FROM mapping_profiles WHERE id = ${id}`
}

/* --------------------------------------------------- Profil aus der Route */

export function profileIdOf(event: H3Event): number {
  const raw = String(getRouterParam(event, 'id') ?? '')
  const id = Number(raw)
  if (!Number.isInteger(id) || id <= 0) throw fail(404, 'profile_not_found', {}, 'Profil nicht gefunden.')
  return id
}

/** Profil laden. Sichtbar ist jedes; das schliesst Aendern nicht ein. */
export async function visibleProfile(event: H3Event): Promise<{ user: UserWithInstitution; profile: MappingProfileRow }> {
  const user = await requireInstitution(event)
  const profile = await findProfile(db(), profileIdOf(event))
  if (profile === null) throw fail(404, 'profile_not_found', {}, 'Profil nicht gefunden.')
  return { user, profile }
}

/**
 * Profil laden und Aenderungsrecht pruefen. Aendern darf nur die besitzende
 * Einrichtung: Ein global sichtbares Profil ist anderswo produktiv im Einsatz.
 */
export async function ownProfile(event: H3Event): Promise<{ user: UserWithInstitution; profile: MappingProfileRow }> {
  const { user, profile } = await visibleProfile(event)
  if (profile.institution_id !== user.institution_id) {
    throw fail(403, 'profile_foreign', { name: profile.name }, 'Profil einer anderen Einrichtung.')
  }
  return { user, profile }
}

/* ------------------------------------------------------------ Stichprobe */

export interface TableSource {
  columns: string[]
  rows: SourceRow[]
  rowCount: number
  /** Spalte -> verschiedene Werte mit Haeufigkeit. */
  distinct: Record<string, Array<{ value: string; count: number }>>
  headerHash: string
  baseFormat: BaseFormat
}

/**
 * Macht aus der im Profil abgelegten Stichprobe eine Quelle fuer die Vorschau.
 *
 * Zwei Formen werden gelesen: die heutige (Zeilen als Zellenlisten, Werte als
 * Liste mit Haeufigkeit) und die des PHP-Stands (Zeilen als benannte Objekte,
 * Werte unter "distinct" als Wert -> Haeufigkeit). Ohne diese Nachsicht
 * verloeren alle vorhandenen Profile ihre Stichprobe — und damit die
 * Bearbeitbarkeit, also genau das, wofuer sie da ist.
 */
export function sourceFromSample(
  raw: unknown,
  headerHash: string,
  baseFormat: BaseFormat
): TableSource | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const doc = raw as Record<string, unknown>

  const columns = Array.isArray(doc.columns) ? doc.columns.map((c) => String(c)) : []
  if (columns.length === 0) return null

  const rows: SourceRow[] = []
  for (const entry of Array.isArray(doc.rows) ? doc.rows : []) {
    const row: SourceRow = {}
    if (Array.isArray(entry)) {
      columns.forEach((c, i) => { row[c] = String(entry[i] ?? '') })
    } else if (typeof entry === 'object' && entry !== null) {
      const named = entry as Record<string, unknown>
      for (const c of columns) row[c] = String(named[c] ?? '')
    } else {
      continue
    }
    if (!isEmptyRow(row)) rows.push(row)
  }

  const distinct: TableSource['distinct'] = {}
  const values = doc.values
  const legacy = doc.distinct
  if (typeof values === 'object' && values !== null) {
    for (const [col, list] of Object.entries(values as Record<string, unknown>)) {
      if (!Array.isArray(list)) continue
      distinct[col] = list
        .filter((e): e is Record<string, unknown> => typeof e === 'object' && e !== null)
        .map((e) => ({ value: String(e.value ?? ''), count: Number(e.count ?? 0) }))
    }
  } else if (typeof legacy === 'object' && legacy !== null) {
    for (const [col, counts] of Object.entries(legacy as Record<string, unknown>)) {
      if (typeof counts !== 'object' || counts === null) continue
      distinct[col] = Object.entries(counts as Record<string, unknown>)
        .map(([value, count]) => ({ value, count: Number(count ?? 0) }))
        .sort((a, b) => b.count - a.count)
    }
  }
  for (const c of columns) distinct[c] ??= []

  // Zeilenzahl der ganzen Datei, soweit bekannt: erst die Belegung, dann der
  // Zaehler des PHP-Stands, zuletzt die Stichprobe selbst.
  let total = 0
  const coverage = doc.coverage
  if (typeof coverage === 'object' && coverage !== null) {
    for (const entry of Object.values(coverage as Record<string, unknown>)) {
      if (typeof entry === 'object' && entry !== null) {
        total = Math.max(total, Number((entry as Record<string, unknown>).total ?? 0))
      }
    }
  }
  if (total === 0) total = Number(doc.row_count ?? doc.rowCount ?? 0)
  if (!Number.isFinite(total) || total <= 0) total = rows.length

  if (rows.length === 0) return null

  return { columns, rows, rowCount: total, distinct, headerHash, baseFormat }
}

/* ------------------------------------------------------- Nutzlast des Editors */

export interface EditorPayload {
  mode: 'import' | 'profile'
  /**
   * Basis der POST-Aufrufe: <endpoint>/preview, /save, /candidates, /adopt.
   * Relativ zur API-Basis, also ohne `/api` — die Basis setzt die Oberflaeche
   * mit useApi() davor. Bis zum 30.09.2026 stand hier `/api/...` fest, und der
   * Editor ging als einziger Aufruf an der konfigurierbaren Basis vorbei (#9).
   */
  endpoint: string
  /** Datei- bzw. Profilname in der Ueberschrift. */
  subject: string
  /** Darf nach dem Speichern konvertiert werden? Nur am Import. */
  canStart: boolean
  baseFormat: BaseFormat
  headerHash: string
  rowCount: number
  sampleRows: number
  columns: string[]
  mapping: MappingJson
  profile: { id: number; name: string; version: number; complete: boolean } | null
  suggestedName: string
  avefiSchemaVersion: string | null
  targets: EditorTarget[]
  transforms: TransformOpMeta[]
  suggestions: Record<string, TitelVorschlag[]>
  hints: Record<string, Array<{ target: string; count: number }>>
  vocabulary: Record<string, string[]>
  /** Verschiedene Werte je Spalte mit Haeufigkeit — Grundlage der Wertelisten. */
  values: Record<string, Array<{ value: string; count: number }>>
  foreign: Array<{ id: number; name: string; institution_name: string; version: number; complete: boolean }>
  /** Abgleich der Profilspalten gegen die tatsaechliche Kopfzeile. */
  columnReport: ProfileColumnReport | null
  /** Was beim Einlesen des Profils angepasst oder beanstandet wurde. */
  issues: ValidationIssue[]
}

export interface PayloadOptions {
  mode: 'import' | 'profile'
  endpoint: string
  subject: string
  canStart: boolean
  source: TableSource
  profile: MappingProfileRow | null
  user: UserWithInstitution
  institutionName: string | null
  /** Kopfzeilenabgleich mitliefern (am Import, wo das Profil aelter sein kann). */
  withColumnReport?: boolean
}

const VALUES_PER_COLUMN = 60

/**
 * Baut die Nutzlast, mit der der Editor startet — einmal fuer beide
 * Betriebsarten. Was hier fehlt, fehlt in beiden.
 */
export async function editorPayload(sql: Sql, options: PayloadOptions): Promise<EditorPayload> {
  const { source, profile, user } = options
  const version = await avefiSchemaVersion()
  const [targets, others] = await Promise.all([editorTargets(), otherMappings(sql, user.institution_id)])

  const normalized = profile === null
    ? { mapping: emptyMapping(source.columns, version), issues: [] as ValidationIssue[] }
    : normalizeMapping(profile.mapping_json, { columns: source.columns, avefiSchemaVersion: version })

  // Der Kopfzeilenabgleich muss gegen die Spalten laufen, die das Profil
  // TATSAECHLICH beschreibt. `normalized.mapping` ist mit den Spalten der Datei
  // aufgefuellt — dagegen verglichen waere jede Spalte immer passend, und
  // fehlende, zusaetzliche wie umbenannte Spalten fielen strukturell weg.
  const columnReport = profile !== null && options.withColumnReport === true
    ? checkProfileColumns(
        normalizeMapping(profile.mapping_json, { avefiSchemaVersion: version }).mapping,
        source.columns
      )
    : null

  const distinctCounts: Record<string, Record<string, number>> = {}
  const values: EditorPayload['values'] = {}
  for (const [col, list] of Object.entries(source.distinct)) {
    const capped = list.slice(0, VALUES_PER_COLUMN)
    values[col] = capped
    const counts: Record<string, number> = {}
    for (const entry of list) counts[entry.value] = entry.count
    distinctCounts[col] = counts
  }

  return {
    mode: options.mode,
    endpoint: options.endpoint,
    subject: options.subject,
    canStart: options.canStart,
    baseFormat: source.baseFormat,
    headerHash: source.headerHash,
    rowCount: source.rowCount,
    sampleRows: source.rows.length,
    columns: source.columns,
    mapping: normalized.mapping,
    profile: profile === null
      ? null
      : { id: profile.id, name: profile.name, version: profile.version, complete: profile.complete },
    suggestedName: profile !== null
      ? profile.name
      : suggestProfileName(options.institutionName, options.subject),
    avefiSchemaVersion: version,
    targets,
    transforms: editorTransforms(),
    // Aus dem Spaltennamen, bei durchgehend eingeklammerten Titeln der
    // Archivtitel statt des Haupttitels (#5)
    suggestions: klammerVorschlaege(suggestForColumns(source.columns), source.distinct),
    hints: targetHintsFromMappings(source.columns, others),
    vocabulary: vocabularyCandidates(distinctCounts),
    values,
    foreign: await foreignProfiles(sql, user.institution_id, source.headerHash),
    columnReport,
    // Gleichlautende Hinweise nur einmal: Ein umbenannter Konverter in
    // achtzehn Spalten ist ein Hinweis, nicht achtzehn.
    issues: dedupeIssues(normalized.issues)
  }
}

/** Entdoppelt Hinweise ueber Code und Text und nennt die Zahl der Faelle. */
function dedupeIssues(issues: readonly ValidationIssue[]): ValidationIssue[] {
  const seen = new Map<string, { issue: ValidationIssue; count: number }>()
  for (const issue of issues) {
    const key = `${issue.severity}|${issue.code ?? ''}|${issue.message}`
    const found = seen.get(key)
    if (found === undefined) seen.set(key, { issue, count: 1 })
    else found.count++
  }
  return [...seen.values()].map(({ issue, count }) =>
    count === 1 ? issue : { ...issue, message: `${issue.message} (${count}\u00d7)` }
  )
}


/** Spalten ohne Entscheidung — der dritte Zustand, robust gegen leere Profile. */
export function openColumnsOf(mapping: MappingJson | null | undefined): string[] {
  if (mapping === null || mapping === undefined) return []
  return openColumns(mapping)
}

export async function institutionName(sql: Sql, id: number): Promise<string | null> {
  const rows = await sql<Array<{ name: string }>>`SELECT name FROM institutions WHERE id = ${id}`
  return rows[0]?.name ?? null
}

/** Diese Datei ist Hilfsmittel, keine Schnittstelle. */
export default defineEventHandler(() => {
  throw fail(404, 'not_found', {}, 'Keine Schnittstelle.')
})
