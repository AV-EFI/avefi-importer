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
/**
 * Welche Meldungen je Spalte, Code und Gewicht zusammengefasst werden: alle
 * der Konverterkette (#51), der Hinweis, dass die Werkart vorbelegt wurde, und
 * der satzuebergreifende Fehler „kein Exemplar“. Beide kommen in jeder Zeile
 * gleich, und 104 gleiche Eintraege bei 52 Zeilen verdecken den einen, auf den
 * es ankommt (Luca, #53; Nachtest #51, 18.11.2026). Welche Zeilen betroffen
 * sind, steht im Sammeleintrag als `zeilen`.
 *
 * Bewusst nicht `record.titleBorrowed`: Dort ist der Titel je Satz ein
 * anderer, und ein Sammeleintrag zeigte nur den ersten. Ebenso nicht
 * `identifier_not_unique` und `dangling_reference`: Jede dieser Meldungen
 * nennt ein anderes Paar, und genau das ist die Auskunft.
 */
const BUENDEL_CODES = new Set(['record.workTypeDefaulted', 'no_items_associated'])

/**
 * Sammeleintraege, deren Einzelsatz ein Objekt nennt („Zu avefi:WorkVariant
 * …r1_work gehoert kein Exemplar“). Gebuendelt waere der Satz falsch; sie
 * bekommen `kind: 'sammel'` und damit einen eigenen Satz in der Oberflaeche.
 */
const SAMMELSATZ = new Set(['no_items_associated'])

/** So viele Zeilennummern nimmt ein Sammeleintrag hoechstens auf. */
const MAX_ZEILEN = 2000

/** `[1,2,3,5,7,8]` -> `1–3, 5, 7–8`. Kurz genug fuer 300.000 Zeilen am Stueck. */
export function zeilenSpannen(zeilen: readonly number[]): string {
  const sortiert = [...new Set(zeilen)].sort((a, b) => a - b)
  const teile: string[] = []
  let i = 0
  while (i < sortiert.length) {
    let j = i
    while (j + 1 < sortiert.length && sortiert[j + 1] === sortiert[j]! + 1) j++
    teile.push(j > i ? `${sortiert[i]}–${sortiert[j]}` : String(sortiert[i]))
    i = j + 1
  }
  return teile.join(', ')
}

function gebuendelt(code: string | undefined): boolean {
  const c = String(code ?? '')
  return c.startsWith('transform.') || BUENDEL_CODES.has(c)
}

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
    if (gebuendelt(issue.code)) {
      this.kette(issue)
      return
    }
    if (this.items.length < this.limit) this.items.push(issue)
    else this.dropped++
  }

  addAll(issues: readonly ValidationIssue[] | undefined): void {
    if (!issues) return
    for (const i of issues) this.add(i)
  }

  /**
   * Meldungen der Konverterkette (#51): je Spalte, Code und Gewicht einmal,
   * mit Zahl und bis zu drei Beispielwerten. Ein Datum, das in fuenftausend
   * Zeilen gleich falsch geschrieben ist, ist ein Befund, nicht fuenftausend.
   * Die Zeile des ersten Vorkommens bleibt stehen, damit man hinspringen kann.
   */
  private readonly ketten = new Map<
    string, { issue: ValidationIssue; count: number; samples: string[]; zeilen: number[] }
  >()

  private kette(issue: ValidationIssue): void {
    // Die Art gehoert in den Schluessel: Werke ohne Exemplar und
    // Manifestationen ohne Exemplar sind zwei Befunde.
    const art = issue.params?.['category'] ?? ''
    const key = `${issue.severity}|${issue.code ?? ''}|${issue.sourceField ?? ''}|${art}`
    const found = this.ketten.get(key)
    if (found === undefined) {
      this.ketten.set(key, {
        issue, count: 1, samples: issue.value ? [issue.value] : [], zeilen: issue.row !== undefined ? [issue.row] : []
      })
      return
    }
    found.count++
    if (issue.row !== undefined && found.zeilen.length < MAX_ZEILEN) found.zeilen.push(issue.row)
    if (issue.value && found.samples.length < 3 && !found.samples.includes(issue.value)) {
      found.samples.push(issue.value)
    }
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
    for (const { issue, count, samples, zeilen } of this.ketten.values()) {
      if (count === 1) {
        out.push(issue)
        continue
      }
      const examples = samples.length > 0 ? ` Beispiele: ${samples.join(', ')}.` : ''
      const spannen = zeilenSpannen(zeilen)
      const params: Record<string, string | number> = {
        ...(issue.params ?? {}), count, beispiele: samples.join(', '), ...(spannen !== '' ? { zeilen: spannen } : {})
      }
      if (SAMMELSATZ.has(String(issue.code))) {
        // Der Einzelsatz nennt ein Objekt; der Sammelsatz nennt die Zahl.
        // Den Wert des ersten Objekts weglassen, sonst stuende er fuer alle.
        const { value: _erster, ...rest } = issue
        delete params['key']
        out.push({
          ...rest,
          params: { ...params, kind: 'sammel', n: count },
          message: `Zu ${count} Datensaetzen der Art ${String(issue.params?.['category'] ?? '')} gehoert kein Exemplar.`
            + (spannen !== '' ? ` Zeilen: ${spannen}.` : '') + examples
        })
        continue
      }
      out.push({
        ...issue,
        params,
        message: `${issue.message} Betrifft ${count} Zeilen.${spannen !== '' ? ` Zeilen: ${spannen}.` : ''}${examples}`
      })
    }
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
    for (const g of this.ketten.values()) grouped += g.count
    return this.items.length + this.dropped + grouped
  }

  countBySeverity(severity: ValidationIssue['severity']): number {
    if (severity === 'info') return this.count - this.countBySeverity('error') - this.countBySeverity('warning')
    let n = this.items.filter((i) => i.severity === severity).length
    for (const g of this.ketten.values()) if (g.issue.severity === severity) n += g.count
    return n
  }
}
