/*
 * Tabelle plus gespeichertes Mappingprofil — der Regelweg fuer CSV, TSV und
 * herausgeloeste Excel-Blaetter.
 *
 * Ohne Werkbildung wird gestroemt: eine Zeile, ein Datensatz. Mit Werkbildung
 * muss gesammelt werden, weil erst am Ende feststeht, welche Zeilen
 * zusammengehoeren.
 */
import { basename } from 'node:path'
import type { BaseFormat, MappingJson, MappingProfileRow, ValidationIssue } from '#shared/types/domain'
import type { AuthorityRequest, MappingServices } from '../mapping/runner'
import { feldName } from '../mapping/runner'
import type { SourceRow } from '../mapping/header'
import type { CanonicalRecord, Converter, ConvertedRecord } from './types'
import { ohneWerk } from './types'
import { streamTableRows } from './table'
import type { Delimiter } from './csv'
import { AuthorityNeeds, ProfileRun } from './mappingBridge'

export const PROFILE_KEY_PREFIX = 'mapping_profile:'

export function profileKey(profileId: number): string {
  return `${PROFILE_KEY_PREFIX}${profileId}`
}

export function profileIdFromKey(key: string): number | null {
  if (!key.startsWith(PROFILE_KEY_PREFIX)) return null
  const id = Number(key.slice(PROFILE_KEY_PREFIX.length))
  return Number.isInteger(id) && id > 0 ? id : null
}

export type ProfileForRun = Pick<MappingProfileRow, 'id' | 'name' | 'version' | 'base_format'> & {
  mapping_json: MappingJson
}

/** So viele Zeilen werden auf einmal nach Normdatenbedarf durchgesehen. */
const NEEDS_CHUNK = 500

export interface ProfileConverterOptions {
  /**
   * Das festgelegte Spaltentrennzeichen des Imports.
   *
   * Fehlt es, wird beim Lesen geraten — und dieselbe Datei kann nach einer
   * Aenderung an der Heuristik anders zerfallen. Zur Reproduzierbarkeit gehoert
   * nicht nur das Mappingprofil, sondern auch, wie die Datei zerlegt wurde.
   */
  delimiter?: Delimiter | null
  /**
   * Nachschlagedienste ohne Netz — Laender und Sprachen. Fehlen sie, laesst der
   * country-Konverter den Rohwert stehen ("DE" statt "Deutschland"), und zwar
   * wortlos.
   */
  services?: MappingServices
  /**
   * Loest den Normdatenbedarf auf, BEVOR die erste Zeile konvertiert wird.
   *
   * Bekommt den ueber die ganze Datei gesammelten Bedarf und liefert die
   * Dienste, mit denen anschliessend gerechnet wird. Ohne diese Zusage laeuft
   * der Konverter ohne Normdaten durch — der Ablauf bleibt derselbe, nur die
   * IDs fehlen.
   */
  prepareAuthorities?: (requests: readonly AuthorityRequest[]) => Promise<MappingServices>
}

export class ProfileTableConverter implements Converter {
  readonly key: string
  private rows = 0
  private works = 0
  private run: ProfileRun

  private authorityValues = 0
  private authorityDropped = 0
  /** Kennung -> Zeile, in der sie zuerst stand. Fuer die Eindeutigkeitspruefung. */
  private readonly seenIds = new Map<string, number>()
  private mergeConflicts = 0
  private duplicateIds = 0

  constructor(
    private readonly profile: ProfileForRun,
    private readonly baseFormat: BaseFormat | null,
    private readonly options: ProfileConverterOptions = {}
  ) {
    this.key = profileKey(profile.id)
    this.run = new ProfileRun(profile.mapping_json, options.services ?? {})
  }

  async *convert(path: string): AsyncGenerator<ConvertedRecord> {
    const file = basename(path)
    const format = this.baseFormat ?? (this.profile.base_format as BaseFormat | null)

    // Erst den Bedarf der GANZEN Datei sammeln, dann in einem Schwung
    // aufloesen, dann konvertieren. Die Datei wird dafuer ein zweites Mal
    // gelesen — das kostet eine Umdrehung der Platte und spart je Zeile eine
    // HTTP-Anfrage.
    if (this.options.prepareAuthorities !== undefined) {
      this.run.useServices(await this.options.prepareAuthorities(await this.collectNeeds(path, format)))
    }

    const grouping = this.run.groupsWorks

    const bucket: Array<{ canonical: CanonicalRecord; rows: number[]; issues: ValidationIssue[] }> = []
    const byKey = new Map<string, number>()

    for await (const { row, rowNumber } of streamTableRows(path, format, this.options.delimiter)) {
      this.rows++

      let outcome
      try {
        outcome = this.run.runRow(row, `r${rowNumber}`, rowNumber)
      } catch (e) {
        // Eine Zeile, die das Profil nicht verarbeiten kann, darf den Import
        // nicht abbrechen. Sie wird gemeldet und uebersprungen — verschwiegen
        // wuerde sie nur den Zaehler verfaelschen.
        yield {
          kind: 'canonical',
          canonical: { work: ohneWerk(), manifestations: [], items: [] },
          source: { file, row: rowNumber, profile: this.profile.id },
          issues: [
            {
              severity: 'error',
              message: `Zeile konnte nicht nach AVefi umgesetzt werden: ${e instanceof Error ? e.message : String(e)}`,
              detail: e instanceof Error ? e.message : String(e),
              row: rowNumber,
              code: 'mapping_failed'
            }
          ]
        }
        continue
      }

      if (!grouping) {
        this.works++
        yield {
          kind: 'canonical',
          canonical: outcome.canonical,
          source: { file, row: rowNumber, profile: this.profile.id },
          issues: [...outcome.issues, ...this.checkIdentifiers(outcome.canonical, rowNumber)]
        }
        continue
      }

      const key = this.run.workKey(row, outcome.canonical)
      if (key === null) {
        bucket.push({ canonical: outcome.canonical, rows: [rowNumber], issues: outcome.issues })
        continue
      }
      const at = byKey.get(key)
      if (at === undefined) {
        byKey.set(key, bucket.length)
        bucket.push({ canonical: outcome.canonical, rows: [rowNumber], issues: outcome.issues })
        continue
      }
      const target = bucket[at]
      if (target) {
        const zusammen = this.run.merge(target.canonical, outcome.canonical)
        target.canonical = zusammen.record
        // Was beim Zusammenfassen verdraengt wurde, gehoert in den Bericht.
        // Die Zeilen stehen mit dabei, sonst waere der Widerspruch nicht
        // aufzuloesen: Ohne sie weiss niemand, welche beiden Zeilen sich
        // widersprechen.
        for (const c of zusammen.conflicts) {
          this.mergeConflicts++
          target.issues.push({
            severity: 'warning',
            code: 'merge.conflict',
            row: rowNumber,
            value: c.verworfen.slice(0, 120),
            params: {
              feld: feldName(c.feld),
              // Der Schemaname, damit die Oberflaeche den Feldnamen uebersetzen kann
              feldKey: c.feld,
              behalten: c.behalten,
              verworfen: c.verworfen,
              zeile: target.rows[0] ?? 0,
              andere: rowNumber
            },
            message: `Die Zeilen ${target.rows[0] ?? 0} und ${rowNumber} wurden zu einem Werk `
              + `zusammengefasst, widersprechen sich aber in "${feldName(c.feld)}": `
              + `"${c.behalten}" gegen "${c.verworfen}". Uebernommen wurde "${c.behalten}".`
          })
        }
        target.rows.push(rowNumber)
        target.issues.push(...outcome.issues)
      }
    }

    for (const entry of bucket) {
      this.works++
      yield {
        kind: 'canonical',
        canonical: entry.canonical,
        source: { file, row: entry.rows[0], rows: entry.rows, profile: this.profile.id },
        issues: [...entry.issues, ...this.checkIdentifiers(entry.canonical, entry.rows[0] ?? 0)]
      }
    }
  }

  /**
   * Zwei Exemplare mit derselben Kennung — beanstanden, nicht heimlich heilen.
   *
   * In der Paderborner Testdatei tragen die Zeilen 61/62 und 65/66 dieselbe
   * Signatur, und die Signatur ist auf die Exemplarkennung gemappt. efi-conv
   * lehnt das Ergebnis ab; die Anwendung meldete bisher nichts. Die Kennung
   * still eindeutig zu machen waere schlimmer: Dann traegt der Export eine
   * Angabe, die in keinem Quellsystem steht, und der eigentliche Datenfehler
   * bliebe unentdeckt. Die Entscheidung, ob zwei Zeilen dasselbe Exemplar
   * meinen, kann nur das Archiv treffen.
   *
   * Geprueft werden Manifestation und Exemplar, nicht das Werk: Auf Werkebene ist
   * eine gemeinsame Kennung bei der Werkbildung gerade der Zweck.
   */
  private checkIdentifiers(canonical: CanonicalRecord, rowNumber: number): ValidationIssue[] {
    const out: ValidationIssue[] = []
    /* Genitiv und Plural stehen ausgeschrieben da. Zusammengesetzt ergab
     * "Manifestationkennung" und "Zwei Manifestatione" — der Fugenlaut und die
     * Mehrzahl folgen im Deutschen keiner Regel, die sich anhaengen laesst. */
    const ebenen: Array<[string, string, readonly Record<string, unknown>[], 'manifestation' | 'item']> = [
      ['Manifestationskennung', 'Manifestationen', canonical.manifestations, 'manifestation'],
      ['Exemplarkennung', 'Exemplare', canonical.items, 'item']
    ]

    for (const [kennung, mehrzahl, nodes, ebene] of ebenen) {
      for (const node of nodes) {
        const ids = Array.isArray(node['has_identifier']) ? node['has_identifier'] : []
        for (const raw of ids) {
          if (typeof raw !== 'object' || raw === null) continue
          const entry = raw as Record<string, unknown>
          const id = String(entry['id'] ?? '').trim()
          if (id === '') continue
          const key = `${kennung}|${String(entry['category'] ?? '')}|${id}`
          const first = this.seenIds.get(key)
          if (first === undefined) {
            this.seenIds.set(key, rowNumber)
            continue
          }
          this.duplicateIds++
          out.push({
            severity: 'error',
            code: 'identifier.duplicate',
            row: rowNumber,
            value: id.slice(0, 120),
            params: { kennung, id, zeile: first, mehrzahl, kind: ebene },
            message: `Die ${kennung} „${id}" steht schon in Zeile ${first}. Zwei ${mehrzahl} mit `
              + 'derselben Kennung bestehen die Schemapruefung nicht. Entweder meinen die Zeilen '
              + 'dasselbe Objekt — dann gehoert die Werkbildung darauf eingestellt — oder die Spalte '
              + 'taugt nicht als Kennung und sollte einem anderen Ziel zugeordnet werden.'
          })
        }
      }
    }
    return out
  }

  /**
   * Ein erster Durchlauf ueber die Datei, nur um zu sammeln, was nachzuschlagen
   * ist. Gerechnet wird buendelweise, damit nicht die ganze Datei im Speicher
   * stehen muss.
   */
  private async collectNeeds(path: string, format: BaseFormat | null): Promise<AuthorityRequest[]> {
    const needs = new AuthorityNeeds()
    let chunk: SourceRow[] = []

    for await (const { row } of streamTableRows(path, format, this.options.delimiter)) {
      chunk.push(row)
      if (chunk.length >= NEEDS_CHUNK) {
        needs.add(this.run.collectAuthorities(chunk))
        chunk = []
      }
    }
    if (chunk.length > 0) needs.add(this.run.collectAuthorities(chunk))

    this.authorityValues = needs.size
    this.authorityDropped = needs.dropped
    return needs.all()
  }

  report(): Record<string, unknown> {
    const tally = this.run.report()
    return {
      profile: { id: this.profile.id, name: this.profile.name, version: this.profile.version },
      grouping: this.run.groupingLabel,
      rows: this.rows,
      works: this.works,
      valueErrors: tally.valueErrors,
      columnIssues: tally.columnIssues,
      idOrigins: tally.idOrigins,
      authorityValues: this.authorityValues,
      authorityValuesDropped: this.authorityDropped,
      duplicateIds: this.duplicateIds,
      mergeConflicts: this.mergeConflicts
    }
  }
}
