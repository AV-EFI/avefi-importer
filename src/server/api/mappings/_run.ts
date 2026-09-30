/*
 * Rechnen fuer den Editor: Vorschau, Pruefung, Speichern, Normdaten-Kandidaten.
 *
 * Gerechnet wird HIER, auf dem Server, mit demselben Code, der spaeter
 * konvertiert. Eine zweite Umsetzung im Browser waere schneller und wuerde
 * bedeuten, dass Vorschau und Ergebnis verschiedenen Code ausfuehren — dort
 * entstehen Fehler, die niemand findet, weil die Vorschau gruen war.
 *
 * Auch diese Datei traegt einen Vorgabe-Handler, weil Nitro aus jeder Datei in
 * server/api/ eine Route macht.
 */
import type { AvefiRecord, MappingJson, ProfileSample, ValidationIssue } from '#shared/types/domain'
import {
  authorityInventory, buildPreview, buildProfileSample, collectAuthorityLookups, columnStates,
  computeComplete, getTarget, hasBlocker, hasStartBlocker, normalizeMapping, openColumns, previewRows, staticCheck,
  type AuthorityInventoryEntry, type MappingCheck, type MappingServices, type PreviewInput,
  type PreviewResult, type SchemaModel, type SourceRow
} from '../../lib/mapping/index'
import {
  PREVIEW_AUTHORITY_LIMIT, authorityCandidates, authorityServices, mappingServicesFor, sourcesForKind,
  type ResolvedAuthorities
} from '../../lib/authority/index'
import { db } from '../../db'
import { checkRecords } from '../../worker/validate'
import { avefiSchemaVersion, fail, schemaModel, type TableSource } from './_lib'

/* ------------------------------------------------------------- Vorschau */

/** Ziel -> woher der Wert kommt. Grundlage des Ergebnisbaums. */
export type TargetUse = Record<string, Array<{ column: string; source: 'column' | 'default' }>>

export function targetUse(mapping: MappingJson): TargetUse {
  const out: TargetUse = {}
  for (const [col, spec] of Object.entries(mapping.columns ?? {})) {
    if (typeof spec !== 'object' || spec === null || spec.ignore === true) continue
    for (const binding of spec.targets ?? []) {
      const key = String(binding.target ?? '')
      if (key === '') continue
      ;(out[key] ??= []).push({ column: col, source: 'column' })
    }
  }
  for (const d of mapping.defaults ?? []) {
    const key = String(d.target ?? '')
    if (key === '') continue
    ;(out[key] ??= []).push({ column: String(d.value ?? ''), source: 'default' })
  }
  return out
}

export interface PreviewPayload extends PreviewResult {
  targetUse: TargetUse
  /** Spalte -> gemappt / ignoriert / noch nicht angefasst. */
  states: Record<string, 'mapped' | 'ignored' | 'untouched'>
  complete: boolean
  open: string[]
  blocking: boolean
}

/**
 * Die Nachschlagedienste der Vorschau — dieselben, mit denen spaeter
 * konvertiert wird.
 *
 * Aufgeloest wird der Bedarf GENAU der Zeilen, die die Vorschau rechnet
 * (previewRows), und zwar ueber dieselbe Funktion und denselben
 * Zwischenspeicher wie der Hintergrundprozess. Nur die Zahl der frischen
 * Abfragen ist kleiner: Der Editor rechnet nach jeder Aenderung neu und darf
 * dabei nicht minutenlang am Netz haengen. Was deshalb liegen bleibt, steht als
 * Meldung in den Hinweisen — und beim naechsten Durchlauf im Zwischenspeicher.
 */
async function previewServices(
  input: PreviewInput,
  mapping: MappingJson,
  schema: SchemaModel
): Promise<{ services: MappingServices; resolved: ResolvedAuthorities }> {
  // Mit den ortsfesten Tabellen, sonst meldet der Bedarf "DE", waehrend die
  // Kette spaeter "Deutschland" fragt.
  const requests = collectAuthorityLookups(mapping, previewRows(input), authorityServices())
  return mappingServicesFor(requests, { sql: db(), schema, limit: PREVIEW_AUTHORITY_LIMIT })
}

/**
 * Rechnet den Entwurf auf echten Zeilen. Welche Zeilen das sind, entscheidet
 * previewRows: je Spalte werden die ersten drei VERSCHIEDENEN gefuellten
 * Werte gesucht, statt stur bei Zeile 1 zu bleiben. Beispielwerte und
 * Ergebnisse stammen damit aus derselben Rechnung und meinen dieselben Zeilen.
 */
export async function previewFor(source: TableSource, raw: unknown): Promise<PreviewPayload> {
  const schema = await schemaModel()
  const version = await avefiSchemaVersion()
  const { mapping } = normalizeMapping(raw, { columns: source.columns, avefiSchemaVersion: version })

  const input: PreviewInput = { columns: source.columns, rows: source.rows, rowCount: source.rowCount }
  const { services, resolved } = await previewServices(input, mapping, schema)

  const result = buildPreview(input, mapping, { schema, ...services })
  const checks = [...result.checks, ...resolved.issues]

  return {
    ...result,
    checks,
    targetUse: targetUse(mapping),
    states: columnStates(mapping),
    complete: computeComplete(mapping),
    open: openColumns(mapping),
    blocking: hasBlocker(checks)
  }
}

/* ----------------------------------------------------------- Schemapruefung */

/**
 * Prueft einen aus dem Entwurf erzeugten Datensatz gegen das AVefi-Schema.
 *
 * Geprueft wird im Dienst efi-conv — derselbe Validator, der spaeter die
 * Lieferung prueft. Eine eigene Pruefung hier waere eine zweite Wahrheit.
 * Bewusst ein eigener Aufruf und nicht Teil der Vorschau: Der Dienst ist zu
 * langsam fuer jeden Tastendruck.
 */
export async function schemaCheck(source: TableSource, raw: unknown): Promise<{
  checked: number
  valid: number
  issues: ValidationIssue[]
  unavailable: string | null
}> {
  const schema = await schemaModel()
  const version = await avefiSchemaVersion()
  const { mapping } = normalizeMapping(raw, { columns: source.columns, avefiSchemaVersion: version })

  const input: PreviewInput = { columns: source.columns, rows: source.rows, rowCount: source.rowCount }
  const { services } = await previewServices(input, mapping, schema)

  const preview = buildPreview(input, mapping, { schema, ...services })
  const canonical: AvefiRecord | null = preview.canonical
  if (canonical === null) return { checked: 0, valid: 0, issues: [], unavailable: null }

  const nodes: Record<string, unknown>[] = [
    ...(Object.keys(canonical.work).length > 0 ? [canonical.work as Record<string, unknown>] : []),
    ...(canonical.manifestations as Record<string, unknown>[]),
    ...(canonical.items as Record<string, unknown>[])
  ]
  if (nodes.length === 0) return { checked: 0, valid: 0, issues: [], unavailable: null }

  const result = await checkRecords(nodes, {}, 20_000)
  return {
    checked: result.checked,
    valid: result.valid,
    issues: result.issues.slice(0, 40),
    unavailable: result.unavailable
  }
}

/* --------------------------------------------------------------- Speichern */

export interface SavePrepared {
  /** Fehler, die zwar gespeichert, aber nicht konvertiert werden duerfen. */
  startBlocked: boolean
  mapping: MappingJson
  checks: MappingCheck[]
  complete: boolean
  open: string[]
  sample: ProfileSample
}

/**
 * Bereitet das Speichern vor: einlesen, statisch pruefen, Stichprobe bilden.
 *
 * Blockiert wird nur strukturell Unmoegliches (eine Liste in einem einwertigen
 * Ziel ohne "Element auswaehlen" oder "Zusammenfuegen"). Alles andere wird
 * gemeldet und gespeichert — warnen statt blockieren.
 */
export async function prepareSave(source: TableSource, raw: unknown): Promise<SavePrepared> {
  const schema = await schemaModel()
  const version = await avefiSchemaVersion()
  const { mapping } = normalizeMapping(raw, { columns: source.columns, avefiSchemaVersion: version })
  const checks = staticCheck(mapping, schema)

  if (hasBlocker(checks)) {
    throw fail(422, 'mapping_blocked', { checks }, 'Das Profil enthaelt strukturelle Fehler.')
  }

  return {
    mapping,
    checks,
    startBlocked: hasStartBlocker(checks),
    complete: computeComplete(mapping),
    open: openColumns(mapping),
    sample: buildProfileSample(source.columns, source.rows, { totalRows: source.rowCount })
  }
}

/* -------------------------------------------------- Normdaten-Wertevorrat */

/** Wie viele Zeilen der Wertevorrat hoechstens durchsieht. */
const INVENTORY_ROW_LIMIT = 20_000

/**
 * Zeilen fuer den Wertevorrat: die vorhandenen Zeilen und zusaetzlich je
 * bekanntem verschiedenen Wert eine Zeile.
 *
 * Am Profil fuehrt die Stichprobe nur 25 ganze Zeilen, aber bis zu 200
 * verschiedene Werte je Spalte. Nur die Zeilen zu nehmen hiesse, genau die
 * seltenen Werte zu verlieren, um die es hier geht. Die erzeugten Zeilen tragen
 * nur ihre eine Spalte — ein Konverter, der andere Spalten liest (concat),
 * sieht sie dort leer. Betroffen sind nur Werte, die in keiner der vorhandenen
 * Zeilen stehen.
 */
export function inventoryRows(source: TableSource): SourceRow[] {
  const rows: SourceRow[] = source.rows.slice(0, INVENTORY_ROW_LIMIT)
  for (const [col, values] of Object.entries(source.distinct)) {
    const known = new Set(rows.map((r) => String(r[col] ?? '').trim()))
    for (const v of values) {
      const value = v.value.trim()
      if (value === '' || known.has(value)) continue
      rows.push({ [col]: v.value })
      known.add(value)
    }
  }
  return rows
}

export interface AuthorityValuesPayload {
  groups: AuthorityInventoryEntry[]
  /** Wie viele Werte noch auf eine Entscheidung warten. */
  open: number
}

/**
 * Der vollstaendige Wertevorrat, zu dem dieses Profil Normdaten sucht.
 *
 * Die Vorschau zeigt je Spalte drei verschiedene Beispielwerte, weil sie
 * schnell sein muss. Fuer die Zuordnung von Hand ist das zu wenig: Ein Wert,
 * der eine Entscheidung braucht, aber erst weiter unten in der Datei steht, war
 * damit gar nicht erreichbar. Gerechnet wird mit demselben Kettencode wie in
 * der Vorschau — nur ohne Netz, denn hier zaehlt der Wert, nicht der Treffer.
 */
export async function authorityValuesFor(source: TableSource, raw: unknown): Promise<AuthorityValuesPayload> {
  const version = await avefiSchemaVersion()
  const { mapping } = normalizeMapping(raw, { columns: source.columns, avefiSchemaVersion: version })
  const groups = authorityInventory(mapping, inventoryRows(source), authorityServices())
  const open = groups.reduce((n, g) => n + g.values.filter((v) => v.state === 'offen').length, 0)
  return { groups, open }
}

/* ----------------------------------------------------- Normdaten-Kandidaten */

/**
 * Kandidaten zu einem Wert. Geliefert werden bewusst auch die nicht eindeutigen
 * Treffer: Der Mensch soll sehen, was die Automatik gefunden und aus Vorsicht
 * verworfen hat.
 */
export async function candidatesFor(body: unknown): Promise<{
  value: string
  kind: string
  candidates: Awaited<ReturnType<typeof authorityCandidates>>
  warnings: string[]
}> {
  const data = (body ?? {}) as Record<string, unknown>
  const value = String(data.value ?? '').trim()
  const kind = String(data.kind ?? 'person')
  if (value === '') throw fail(400, 'no_value', {}, 'Kein Wert angegeben.')

  const schema = await schemaModel()
  const wanted = Array.isArray(data.sources) ? data.sources.map((s) => String(s)) : []
  const allowed = sourcesForKind(kind, schema)
  const sources = wanted.length > 0 ? allowed.filter((s) => wanted.includes(s)) : allowed

  const warnings: string[] = []
  const candidates = await authorityCandidates(value, kind, {
    sources,
    schema,
    onWarn: (m) => warnings.push(m)
  })
  return { value, kind, candidates, warnings }
}

/** Anzeigename eines Ziels — fuer Meldungen, die nicht in der Oberflaeche entstehen. */
export function targetLabel(key: string): string {
  return getTarget(key)?.path ?? key
}

/** Vorgabe-Handler: Diese Datei ist Hilfsmittel, keine Schnittstelle. */
export default defineEventHandler(() => {
  throw fail(404, 'not_found', {}, 'Keine Schnittstelle.')
})
