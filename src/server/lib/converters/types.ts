/*
 * Typen der Konverterkette.
 *
 * Ein Konverter liest eine Datei und liefert Datensaetze. Es gibt zwei Formen:
 *
 *   canonical  Der Datensatz liegt bereits im AVefi-Modell vor. So arbeiten der
 *              Profilkonverter (Tabelle + Mappingprofil) und der Passthrough
 *              nativer AVefi-Dateien.
 *   internal   Eine Zwischenform mit benannten Feldern. So arbeiten die Konverter
 *              fuer MARC-XML, EAD und generisches JSON, fuer die es kein
 *              Mappingprofil gibt. Der Weg ins AVefi-Modell steht in avefi.ts.
 *
 * Beide Formen tragen `issues`. Damit kommt Vertragsanforderung Paragraf 3 zum
 * Tragen: Was nicht konvertiert werden konnte, wird gemeldet und nicht
 * stillschweigend verworfen.
 */
import type { AvefiNode, AvefiRecord, ValidationIssue } from '#shared/types/domain'

/** Herkunft eines Datensatzes — Datei und Zeile, damit Meldungen zeigen koennen, wo es klemmt. */
export interface SourceInfo {
  file: string
  /** 1-basierte Datenzeile (ohne Kopfzeile). */
  row?: number
  /** Bei Werkbildung: alle Zeilen, die in diesen Datensatz geflossen sind. */
  rows?: number[]
  /** Id des verwendeten Mappingprofils. */
  profile?: number
}

/** Beitragende Person oder Koerperschaft in der Zwischenform. */
export interface InternalContributor {
  role: string
  name: string
}

export interface InternalManifestation {
  carrier?: string
  durationMin?: number
  date?: string
}

export interface InternalItem {
  holdingInstitution?: string
  signature?: string
  location?: string
}

/** Zwischenform fuer Quellen ohne Mappingprofil. */
export interface InternalRecord {
  work: {
    title: string | null
    additionalTitles: string[]
    year: number | null
    workType: string | null
    country: string | null
    genre: string | null
    language: string | null
    description: string | null
    contributors: InternalContributor[]
  }
  manifestations: InternalManifestation[]
  items: InternalItem[]
  source: SourceInfo
}

/** Fertige AVefi-Struktur eines Datensatzes, wie das Mappingprofil sie liefert. */
/**
 * Frueher ein eigener Typ mit demselben Aufbau wie AvefiRecord. Zwei Namen
 * fuer dieselbe Sache haben genau das verhindert, wofuer sie da waren: Der
 * Uebergang zwischen Konverter und Mapping ging nur ueber eine Umgehung.
 */
export type CanonicalRecord = AvefiRecord

/**
 * Ein Platzhalter fuer einen Satz, der kein Werk hat: verwaiste Knoten in
 * avefiJson, eine Zeile, die profileTable nicht umsetzen konnte.
 *
 * Bewusst ohne category. flattenCanonical erkennt am leeren Objekt, dass es
 * kein Werk auszugeben gibt (`Object.keys(work).length > 0`); eine category
 * hineinzuschreiben wuerde aus dem Platzhalter einen ausgegebenen Knoten
 * machen und die Ausgabe veraendern. Der Cast steht deshalb hier, an einer
 * Stelle, mit dieser Begruendung — und nicht verstreut im Code.
 */
export function ohneWerk(): AvefiNode {
  return {} as AvefiNode
}

export type ConvertedRecord =
  | { kind: 'internal'; record: InternalRecord; issues?: ValidationIssue[] }
  | { kind: 'canonical'; canonical: CanonicalRecord; source: SourceInfo; issues?: ValidationIssue[] }

/**
 * Ein Konverter. convert() ist ein asynchroner Datenstrom: Bei einer Datei mit
 * 300.000 Zeilen darf nicht erst alles im Speicher stehen, bevor der erste
 * Datensatz geschrieben wird.
 */
export interface Converter {
  readonly key: string
  convert(path: string): AsyncIterable<ConvertedRecord>
  /** Diagnose fuer den Pruefbericht, nach dem Durchlauf abrufbar. */
  report?(): Record<string, unknown>
}

/** Ein AVefi-Knoten der Ausgabedatei (WorkVariant, Manifestation oder Item). */
export type { AvefiNode }

/**
 * Sammelt Meldungen fuer den Pruefbericht.
 *
 * Fehler und Warnungen zeigen auf eine bestimmte Zeile und bleiben einzeln
 * stehen — bis zu einer Obergrenze, damit ein durchgehend fehlerhafter Export
 * den Bericht nicht sprengt; dass gekuerzt wurde, wird dann ausdruecklich
 * vermerkt.
 *
 * Hinweise auf Felder, die ohne Mappingprofil nicht uebernommen werden konnten,
 * wiederholen sich dagegen in jedem Datensatz. Sie werden je Feld gebuendelt
 * gezaehlt. Damit bleibt nachvollziehbar, WELCHES Feld WIE OFT liegen blieb —
 * was der Vertrag verlangt — ohne dass fuenfhundert gleichlautende Zeilen die
 * eine Meldung verdecken, auf die es ankommt.
 */
export class IssueCollector {
  private readonly items: ValidationIssue[] = []
  private readonly grouped = new Map<string, { issue: ValidationIssue; count: number; samples: string[] }>()
  private dropped = 0

  constructor(private readonly limit = 500) {}

  add(issue: ValidationIssue): void {
    if (issue.severity === 'info' && issue.code === 'unmapped_field') {
      this.group(issue)
      return
    }
    if (this.items.length < this.limit) this.items.push(issue)
    else this.dropped++
  }

  addAll(issues: readonly ValidationIssue[] | undefined): void {
    if (!issues) return
    for (const i of issues) this.add(i)
  }

  private group(issue: ValidationIssue): void {
    const key = `${issue.sourceField ?? ''}|${issue.message}`
    const found = this.grouped.get(key)
    if (found === undefined) {
      this.grouped.set(key, { issue, count: 1, samples: issue.value ? [issue.value] : [] })
      return
    }
    found.count++
    if (issue.value && found.samples.length < 3 && !found.samples.includes(issue.value)) {
      found.samples.push(issue.value)
    }
  }

  /** Die gesammelten Meldungen, gebuendelte zuletzt. */
  all(): ValidationIssue[] {
    const out = [...this.items]
    if (this.dropped > 0) {
      out.push({
        severity: 'info',
        code: 'issues_truncated',
        params: { n: this.dropped },
        message: `Weitere ${this.dropped} Fehler bzw. Warnung(en) wurden nicht einzeln aufgefuehrt.`
      })
    }
    for (const { issue, count, samples } of this.grouped.values()) {
      const examples = samples.length > 0 ? ` Beispiele: ${samples.join(', ')}.` : ''
      out.push({
        severity: 'info',
        code: 'unmapped_field',
        // Zahl und Beispiele als Bausteine, damit die Oberflaeche den Zusatz
        // "Betrifft n Datensaetze" in ihrer Sprache anhaengen kann.
        params: { ...(issue.params ?? {}), count, beispiele: samples.join(', ') },
        ...(issue.sourceField !== undefined ? { sourceField: issue.sourceField } : {}),
        message: `${issue.message} Betrifft ${count} Datensatz/-saetze.${examples}`
      })
    }
    return out
  }

  /** Zahl aller aufgenommenen Meldungen, auch der gebuendelten. */
  get count(): number {
    let grouped = 0
    for (const g of this.grouped.values()) grouped += g.count
    return this.items.length + this.dropped + grouped
  }

  countBySeverity(severity: ValidationIssue['severity']): number {
    if (severity === 'info') return this.count - this.countBySeverity('error') - this.countBySeverity('warning')
    return this.items.filter((i) => i.severity === severity).length
  }
}
