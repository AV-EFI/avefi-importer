/*
 * Pruefung der erzeugten AVefi-Datensaetze.
 *
 * Geprueft wird nicht hier, sondern im Dienst efi-conv: derselbe Validator und
 * dieselben Zusatzregeln wie "efi-conv check". Eine eigene Schemapruefung waere
 * eine zweite Wahrheit, die sich vom Original entfernen wuerde, sobald das
 * Schema sich aendert.
 */
import type { ValidationIssue } from '#shared/types/domain'

export interface CheckResponse {
  ok: boolean
  checked: number
  valid: number
  issues: ValidationIssue[]
  schema?: { source?: string | null; file?: string; version?: string | null; sha256?: string | null }
}

export interface CheckResult extends CheckResponse {
  /** Konnte der Dienst nicht befragt werden, steht hier der Grund. */
  unavailable: string | null
}

function baseUrl(): string {
  return (process.env.EFI_CONV_URL || 'http://efi-conv:8000').replace(/\/+$/, '')
}

/** So viele Datensaetze gehen in einer Anfrage an den Dienst. */
const BATCH = 500

/**
 * Die Felder, aus denen der Dienst Kennungen und Verweise liest.
 *
 * Nur diese gehen in den satzuebergreifenden Durchgang. Bei 9.630 Saetzen sind
 * das wenige hundert Kilobyte statt zweistelliger Megabyte — damit passt der
 * ganze Bestand in eine Anfrage, und genau darauf kommt es an: Eindeutigkeit
 * und Verweise lassen sich ueber einen Ausschnitt nicht beurteilen.
 *
 * Die Auswahl entspricht _id_key und _refs in efi-conv/service.py. Sie ist eine
 * Feldauswahl, keine zweite Umsetzung der Regel — geprueft wird weiterhin dort.
 */
const QUERFELDER = [
  'category',
  'has_identifier',
  'is_manifestation_of',
  'is_item_of',
  'is_variant_of',
  'is_derived_from'
] as const

export function querSicht(rec: Record<string, unknown>): Record<string, unknown> {
  const aus: Record<string, unknown> = {}
  for (const feld of QUERFELDER) {
    if (rec[feld] !== undefined) aus[feld] = rec[feld]
  }
  return aus
}

/**
 * Prueft die Datensaetze in Buendeln.
 * row_map bildet die laufende Nummer auf die Quellzeile ab, damit Meldungen auf
 * die Tabellenzeile zeigen und nicht nur auf eine Position in der Ausgabe.
 */
export async function checkRecords(
  records: readonly Record<string, unknown>[],
  rowMap: Record<string, number> = {},
  timeoutMs = 120_000,
  /**
   * Ob der satzuebergreifende Durchgang gleich mitlaufen soll.
   *
   * Fuer einen geschlossenen Bestand — den Datensatz im Editor, die Vorschau
   * einer Zuordnung — stimmt das. Der Import ruft hier ebenfalls in Haeppchen
   * an und muss deshalb abschalten: Eindeutigkeit ueber ein Haeppchen zu
   * pruefen ergibt Fehler, die es nicht gibt. Er ruft stattdessen einmal am
   * Ende checkCrossref ueber den ganzen Bestand.
   */
  mitQuerlauf = true
): Promise<CheckResult> {
  if (records.length === 0) {
    return { ok: true, checked: 0, valid: 0, issues: [], unavailable: null }
  }

  const merged: CheckResult = { ok: true, checked: 0, valid: 0, issues: [], unavailable: null }

  for (let offset = 0; offset < records.length; offset += BATCH) {
    const slice = records.slice(offset, offset + BATCH)
    const sliceMap: Record<string, number> = {}
    slice.forEach((_, i) => {
      const global = String(offset + i + 1)
      const row = rowMap[global]
      if (row !== undefined) sliceMap[String(i + 1)] = row
    })

    let response: CheckResponse
    try {
      response = await postCheck(slice, sliceMap, timeoutMs)
    } catch (e) {
      merged.unavailable = e instanceof Error ? e.message : String(e)
      merged.issues.push({
        severity: 'warning',
        source: 'schema',
        code: 'validation_unavailable',
        params: { kind: 'schema' },
        detail: String(merged.unavailable),
        message: `Die Pruefung gegen das AVefi-Schema war nicht moeglich: ${merged.unavailable}. Die Datei wurde erzeugt, aber nicht geprueft.`
      })
      // Was vor dem Abbruch geprueft wurde, bleibt gezaehlt; der Rest ist
      // ungeprueft und wird durch die Warnung oben benannt.
      zaehleGueltige(merged)
      return merged
    }

    merged.checked += response.checked
    merged.schema = response.schema ?? merged.schema
    // Die Nummern des Dienstes zaehlen je Buendel — hier auf die Gesamtfolge heben.
    for (const issue of response.issues) {
      // Herkunft festhalten: Der Bericht mischt Schema, Querlauf, Vollstaendigkeit
      // und Konvertierung, und die haben verschiedenes Gewicht.
      merged.issues.push({
        source: 'schema',
        ...issue,
        ...(issue.record === undefined ? {} : { record: issue.record + offset })
      })
    }
  }

  // Satzuebergreifendes ueber den GANZEN Bestand, nicht je Buendel. Bis zum
  // 01.09.2026 liefen diese Regeln in /check mit und sahen deshalb nur 500
  // Saetze auf einmal: Bei einem Import mit 9.630 Saetzen ergab das 43
  // Verweisfehler, deren Ziel lediglich im vorigen Buendel lag, waehrend
  // doppelte Kennungen mit grossem Abstand unentdeckt blieben.
  if (mitQuerlauf) {
    const quer = await checkCrossref(records, rowMap, timeoutMs)
    merged.issues.push(...quer.issues)
    if (quer.unavailable !== null) merged.unavailable = quer.unavailable
  }

  zaehleGueltige(merged)
  return merged
}

/**
 * „valid" und „ok" aus dem vollstaendigen Befundstand bilden.
 *
 * Die Buendel kannten jeweils nur ihre eigenen Befunde: Ein Satz, dessen
 * Kennung doppelt vergeben ist, galt dort als gueltig, weil der zweite
 * Traeger im naechsten Buendel stand. Gezaehlt wird deshalb erst, wenn alles
 * beisammen ist.
 */
function zaehleGueltige(merged: CheckResult): void {
  const beanstandet = new Set<number>()
  for (const issue of merged.issues) {
    if (issue.severity === 'error' && issue.record !== undefined) beanstandet.add(issue.record)
  }
  merged.valid = Math.max(0, merged.checked - beanstandet.size)
  merged.ok = merged.issues.every((i) => i.severity !== 'error')
}

/**
 * Die satzuebergreifende Pruefung ueber einen vollstaendigen Bestand.
 *
 * Kennungen und Verweise gelten ueber die ganze Lieferung, also wird hier auch
 * die ganze Lieferung geschickt — reduziert auf die Felder, die der Dienst
 * dafuer liest. Bei 9.630 Saetzen sind das wenige hundert Kilobyte.
 *
 * Bis zum 01.09.2026 liefen diese Regeln in /check mit, und /check wird in
 * Buendeln zu 500 aufgerufen. Ein Import mit 9.630 Saetzen bekam dadurch 43
 * Verweisfehler, deren Ziel lediglich im vorigen Buendel lag; doppelte
 * Kennungen mit grossem Abstand blieben umgekehrt unentdeckt.
 */
export async function checkCrossref(
  records: readonly Record<string, unknown>[],
  rowMap: Record<string, number> = {},
  timeoutMs = 120_000
): Promise<{ issues: ValidationIssue[]; unavailable: string | null }> {
  if (records.length === 0) return { issues: [], unavailable: null }
  try {
    const antwort = await postCrossref(records.map(querSicht), rowMap, timeoutMs)
    return { issues: antwort.issues.map((i) => ({ source: 'crossref' as const, ...i })), unavailable: null }
  } catch (e) {
    const grund = e instanceof Error ? e.message : String(e)
    return {
      issues: [{
        severity: 'warning',
        source: 'crossref',
        code: 'validation_unavailable',
        params: { kind: 'crossref' },
        detail: grund,
        message: `Die satzuebergreifende Pruefung war nicht moeglich: ${grund}. Kennungen und Verweise wurden nicht geprueft.`
      }],
      unavailable: grund
    }
  }
}

async function postCrossref(
  records: readonly Record<string, unknown>[],
  rowMap: Record<string, number>,
  timeoutMs: number
): Promise<{ checked: number; issues: ValidationIssue[] }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(`${baseUrl()}/crossref`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ records, row_map: rowMap }),
      signal: controller.signal
    })
    if (!res.ok) throw new Error(`efi-conv antwortete mit HTTP ${res.status}.`)
    return (await res.json()) as { checked: number; issues: ValidationIssue[] }
  } finally {
    clearTimeout(timer)
  }
}

async function postCheck(
  records: readonly Record<string, unknown>[],
  rowMap: Record<string, number>,
  timeoutMs: number
): Promise<CheckResponse> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(`${baseUrl()}/check`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ records, row_map: rowMap }),
      signal: controller.signal
    })
    if (!res.ok) throw new Error(`efi-conv antwortete mit HTTP ${res.status}.`)
    return (await res.json()) as CheckResponse
  } finally {
    clearTimeout(timer)
  }
}

/** Schemainformation des Dienstes, fuer den Bericht. */
export async function schemaInfo(timeoutMs = 10_000): Promise<{ version: string | null; source: string | null } | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(`${baseUrl()}/health`, { signal: controller.signal })
    if (!res.ok) return null
    const body = (await res.json()) as { schema?: { version?: string | null; source?: string | null } }
    return { version: body.schema?.version ?? null, source: body.schema?.source ?? null }
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/** Ein Ladefehler des Pruefdienstes, den die eigene Pflichtfeldmeldung schon abdeckt. */
export function doppeltePflichtmeldung(issue: ValidationIssue, pflichtGemeldet: ReadonlySet<number>): boolean {
  if (issue.code !== 'model_invalid' || issue.record === undefined) return false
  if (!pflichtGemeldet.has(issue.record)) return false
  const p = issue.params ?? {}
  return p['kind'] === 'missing' && (p['field'] === 'type' || p['field'] === 'has_primary_title')
}
