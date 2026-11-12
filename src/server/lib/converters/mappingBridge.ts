/*
 * Uebergang zur Mappinglogik.
 *
 * Das Ausfuehren eines Mappingprofils liegt in server/lib/mapping/ und gehoert
 * nicht zu den Konvertern. Diese Datei ist die einzige Stelle, an der die
 * Konverterkette den Mappingkern anspricht; aendert sich dort eine Signatur,
 * ist nur hier etwas zu tun.
 */
import type { MappingJson, ValidationIssue } from '#shared/types/domain'
import type { SourceRow } from '../mapping/header'
import {
  addToTally,
  collectAuthorityLookups,
  groupingLabel,
  groupsWorks,
  mergeRecords,
  newRunTally,
  runRow,
  workKey,
  type AuthorityRequest,
  type CellResult,
  type MergeConflict,
  type MappingServices,
  type RunTally
} from '../mapping/runner'
import { authorityServices } from '../authority/services.js'
import { meldungstext } from '../mapping/meldungen.js'
import type { CanonicalRecord } from './types'

export interface RowOutcome {
  canonical: CanonicalRecord
  issues: ValidationIssue[]
}

/**
 * Haelt Profil, Nachschlagedienste und Sammelbericht eines Durchlaufs zusammen.
 * Der Sammelbericht zaehlt die Wertfehler je Spalte; er wandert danach in den
 * Pruefbericht des Imports, damit sichtbar bleibt, welche Spalte klemmt.
 */
export class ProfileRun {
  private tally: RunTally = newRunTally()
  private services: MappingServices

  constructor(private readonly mapping: MappingJson, services: MappingServices = {}) {
    this.services = services
  }

  get groupsWorks(): boolean {
    return groupsWorks(this.mapping)
  }

  get groupingLabel(): string {
    return groupingLabel(this.mapping)
  }

  /**
   * Dienste nachtraeglich einhaengen.
   *
   * Normdaten stehen erst fest, wenn der Bedarf der ganzen Datei gesammelt und
   * aufgeloest ist. Das passiert vor der ersten Zeile, nicht waehrenddessen:
   * ein Nachschlagevorgang je Zeile waeren bei fuenftausend Zeilen fuenftausend
   * HTTP-Anfragen mitten im Auftrag.
   */
  useServices(services: MappingServices): void {
    this.services = services
  }

  /** Welche Werte muessen nachgeschlagen werden? Gerechnet wird im Kern. */
  collectAuthorities(rows: readonly SourceRow[]): AuthorityRequest[] {
    return collectAuthorityLookups(this.mapping, rows, authorityServices())
  }

  runRow(row: SourceRow, baseId: string, rowNumber: number): RowOutcome {
    const result = runRow(this.mapping, row, baseId, this.services, rowNumber)
    this.tally = addToTally(this.tally, result)

    // Beanstandungen des Mappings sind bereits ValidationIssue; die Zeile wird
    // ergaenzt, damit der Bericht auf die Quellzeile zeigen kann.
    const issues: ValidationIssue[] = result.issues.map((i) => ({ ...i, row: i.row ?? rowNumber }))
    issues.push(...kettenMeldungen(result.cells, rowNumber))
    return { canonical: result.canonical, issues }
  }

  workKey(row: SourceRow, canonical: CanonicalRecord): string | null {
    return workKey(this.mapping, row, canonical)
  }

  merge(base: CanonicalRecord, add: CanonicalRecord): { record: CanonicalRecord; conflicts: MergeConflict[] } {
    return mergeRecords(base, add)
  }

  report(): RunTally {
    return this.tally
  }
}

/**
 * Meldungen der Konverterkette als Beanstandungen des Pruefberichts.
 *
 * Bis zum 12.11.2026 kamen sie dort nicht an. Was ein Konverter meldete — „24“
 * ist kein Datum, „xyz“ steht nicht in der Werteliste, „zwölf“ ist keine Zahl
 * —, landete nur in einer Zaehlung je Spalte, die keine Oberflaeche zeigte.
 * Der Wert fiel weg, und der Bericht schwieg (Luca Wollny in #51: „Bei 24
 * fehlt im Export das has_event ganz, ohne Hinweis“).
 *
 * Nur Meldungen der Kette (`transform.*`). Was beim Schreiben ins Ziel
 * auffaellt (`target.*`), steht schon in `result.issues`. Gleiche Meldungen
 * einer Spalte fasst der IssueCollector zusammen.
 */
export function kettenMeldungen(cells: Record<string, CellResult>, rowNumber: number): ValidationIssue[] {
  const out: ValidationIssue[] = []
  for (const [spalte, cell] of Object.entries(cells)) {
    for (const e of cell.errors) {
      if (!e.code.startsWith('transform.')) continue
      const wert = e.params?.['wert']
      out.push({
        severity: e.severity ?? 'warning',
        code: e.code,
        message: meldungstext(e),
        sourceField: spalte,
        row: rowNumber,
        ...(e.params !== undefined ? { params: e.params } : {}),
        ...(wert !== undefined ? { value: String(wert).slice(0, 120) } : {})
      })
    }
  }
  return out
}

/**
 * So viele verschiedene Werte nimmt der Bedarf hoechstens auf.
 *
 * Der Kern sammelt den Bedarf aus einem Feld von Zeilen; eine Datei mit
 * dreihunderttausend Zeilen darf dafuer nicht vollstaendig in den Speicher.
 * Gesammelt wird deshalb buendelweise, und die Zahl der gemerkten Werte ist
 * gedeckelt. Der Deckel liegt weit ueber der Voreinstellung von
 * AUTHORITY_LIMIT (500): Was darueber liegt, wird ohnehin nicht mehr frisch
 * abgefragt, kann aber noch aus dem Zwischenspeicher beantwortet werden.
 */
export const MAX_AUTHORITY_VALUES = 5000

/**
 * Sammelt den Normdatenbedarf mehrerer Zeilenbuendel zu einer Liste zusammen.
 *
 * Ohne diese Klammer muesste die ganze Datei im Speicher stehen, bevor die
 * erste Abfrage laufen kann.
 */
export class AuthorityNeeds {
  private readonly byKey = new Map<string, { request: AuthorityRequest; seen: Set<string> }>()
  private values = 0
  private droppedValues = 0

  constructor(private readonly maxValues: number = MAX_AUTHORITY_VALUES) {}

  add(requests: readonly AuthorityRequest[]): void {
    for (const request of requests) {
      const key = `${request.column} ${request.source} ${request.kind}`
      let entry = this.byKey.get(key)
      if (entry === undefined) {
        entry = { request: { ...request, values: [] }, seen: new Set<string>() }
        this.byKey.set(key, entry)
      }
      for (const value of request.values) {
        if (entry.seen.has(value)) continue
        if (this.values >= this.maxValues) {
          this.droppedValues++
          continue
        }
        entry.seen.add(value)
        entry.request.values.push(value)
        this.values++
      }
    }
  }

  all(): AuthorityRequest[] {
    return [...this.byKey.values()].map((e) => e.request).filter((r) => r.values.length > 0)
  }

  /** Verschiedene Werte, die aufzuloesen sind. */
  get size(): number {
    return this.values
  }

  /** Werte, die wegen der Obergrenze gar nicht erst aufgenommen wurden. */
  get dropped(): number {
    return this.droppedValues
  }
}
