/*
 * Arbeitsmappen lesen.
 *
 * Eine Arbeitsmappe ist keine Tabelle, sondern mehrere. Jedes gewaehlte Blatt
 * wird deshalb als CSV nach work/ herausgeloest; ab da unterscheidet sich
 * nichts mehr von einer hochgeladenen CSV — Kopfzeilen-Hash, Profil,
 * Konvertierung. Die hochgeladene Datei bleibt unveraendert in org/.
 *
 * Gelesen wird mit dem eigenen Leser in xlsx.ts, Blatt fuer Blatt im
 * Datenstrom. Der Grund ist der Speicher: Die Mappe mit den Erschliessungsdaten
 * hat 32 Blaetter; sie ganz zu laden, nur um Blattnamen aufzuzaehlen, ist
 * unnoetig. Bis zum 29.10.2026 las hier exceljs (siehe Kopf von xlsx.ts).
 *
 * Zur Bibliothekswahl siehe unterstuetzte Formate weiter unten.
 */
import { createWriteStream } from 'node:fs'
import { basename } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import { cellText } from './excelValue'
import { openWorkbook, type XlsxRow } from './xlsx'
import { csvLine } from './csv'
import { sanitizeFilename } from '../storage'

/**
 * Gelesen wird xlsx.
 *
 * xls (BIFF8, bis Excel 2003) und ods (OpenDocument) werden NICHT gelesen. In
 * Node gibt es dafuer keine Bibliothek, die zugleich gepflegt, im
 * npm-Hauptregistry vorhanden und frei von offenen Sicherheitsmeldungen ist:
 * Das einzige Paket, das beides kann (SheetJS), liegt im Register nur als
 * Version von 2022 mit zwei ungepatchten Meldungen hoher Schwere. Der Werkvertrag verlangt CSV und XLSX; xls und ods
 * waren Zugabe. Statt still zu scheitern, sagt der Importer, was zu tun ist.
 */
export const SUPPORTED_WORKBOOK_FORMATS = ['xlsx'] as const

/** Formate, die als Arbeitsmappe erkannt, aber nicht gelesen werden. */
export const UNSUPPORTED_WORKBOOK_FORMATS = ['xls', 'ods'] as const

export function isWorkbook(baseFormat: string | null | undefined): boolean {
  if (!baseFormat) return false
  return (
    (SUPPORTED_WORKBOOK_FORMATS as readonly string[]).includes(baseFormat) ||
    (UNSUPPORTED_WORKBOOK_FORMATS as readonly string[]).includes(baseFormat)
  )
}

export function isReadableWorkbook(baseFormat: string | null | undefined): boolean {
  return !!baseFormat && (SUPPORTED_WORKBOOK_FORMATS as readonly string[]).includes(baseFormat)
}

/** Klartext fuer ein Arbeitsmappenformat, das nicht gelesen werden kann. */
export function unsupportedWorkbookMessage(baseFormat: string | null | undefined, filename?: string): string {
  const name = filename ? `„${filename}“ ` : ''
  if (baseFormat === 'xls') {
    return (
      `Die Datei ${name}liegt im alten Excel-Format (.xls) vor. Der Importer liest ` +
      'Arbeitsmappen im Format .xlsx. Bitte in Excel oder LibreOffice unter ' +
      '„Speichern unter“ das Format „Excel-Arbeitsmappe (.xlsx)“ waehlen und erneut hochladen. ' +
      'Alternativ laesst sich das gewuenschte Tabellenblatt als CSV speichern.'
    )
  }
  if (baseFormat === 'ods') {
    return (
      `Die Datei ${name}liegt im OpenDocument-Format (.ods) vor. Der Importer liest ` +
      'Arbeitsmappen im Format .xlsx. Bitte in LibreOffice unter „Speichern unter“ das Format ' +
      '„Excel 2007-365 (.xlsx)“ waehlen und erneut hochladen. ' +
      'Alternativ laesst sich das gewuenschte Tabellenblatt als CSV speichern.'
    )
  }
  return `Das Format ${baseFormat ?? 'unbekannt'} wird als Arbeitsmappe nicht gelesen. Bitte .xlsx oder .csv hochladen.`
}

/** Ein Tabellenblatt in der Uebersicht. */
export interface SheetInfo {
  index: number
  name: string
  /** Datenzeilen ohne die Kopfzeile. */
  rows: number
  cols: number
  /**
   * Vorausgewaehlt: mindestens zwei Spalten und mindestens eine Datenzeile
   * unter der Kopfzeile. Damit fallen Deckblaetter und Legenden heraus.
   */
  usable: boolean
}

/** Zellen einer Zeile als Text, Leerzellen am Ende abgeschnitten. */
function rowCells(row: XlsxRow): string[] {
  const values: string[] = []
  for (let c = 0; c < row.length; c++) {
    const cell = row[c]
    values.push(cell ? cellText(cell) : '')
  }
  while (values.length > 0 && (values[values.length - 1] ?? '').trim() === '') values.pop()
  return values
}

function guardWorkbook(path: string, baseFormat: string | null | undefined): void {
  if (!isReadableWorkbook(baseFormat ?? 'xlsx')) {
    throw new Error(unsupportedWorkbookMessage(baseFormat, basename(path)))
  }
}

/**
 * Blaetter einer Arbeitsmappe mit Groesse und Vorauswahl.
 * Liest die Mappe im Datenstrom; die Zellinhalte werden nicht behalten.
 */
export async function listSheets(path: string, baseFormat: string | null = 'xlsx'): Promise<SheetInfo[]> {
  guardWorkbook(path, baseFormat)
  const out: SheetInfo[] = []
  const workbook = await openWorkbook(path)
  try {
    // Reihenfolge wie die Registerkarten. exceljs lieferte die Reihenfolge des
    // Archivs und sortierte nach sheetId; nach einem Verschieben der Blaetter
    // in Excel stimmte das nicht mehr mit der Anzeige ueberein.
    for (const sheet of workbook.sheets) {
      let filled = 0
      let cols = 0
      for await (const row of workbook.rows(sheet)) {
        const cells = rowCells(row)
        if (cells.length === 0) continue
        filled++
        if (cells.length > cols) cols = cells.length
      }
      out.push({
        index: sheet.id,
        name: sheet.name,
        rows: Math.max(0, filled - 1),
        cols,
        usable: filled >= 2 && cols >= 2
      })
    }
  } finally {
    workbook.close()
  }
  return out
}

export interface ExtractResult {
  rows: number
  cols: number
  /** Zeilen, die uebersprungen wurden, weil sie vollstaendig leer waren. */
  skippedEmpty: number
}

/**
 * Loest ein Blatt als CSV heraus.
 *
 * Leerzeilen werden nicht mitgeschrieben. Im PHP-Stand griff diese Pruefung nur
 * fuer fuehrende Leerzeilen; eine Leerzeile in der Mitte landete als leere
 * Datenzeile in der CSV und zaehlte als Datensatz.
 */
export async function extractSheet(
  path: string,
  sheetName: string,
  dest: string,
  baseFormat: string | null = 'xlsx'
): Promise<ExtractResult> {
  guardWorkbook(path, baseFormat)

  const out = createWriteStream(dest, { encoding: 'utf8' })
  let written = 0
  let maxCols = 0
  let skippedEmpty = 0

  const workbook = await openWorkbook(path)
  try {
    // Gelesen wird nur das gewuenschte Blatt. exceljs musste die Mappe bis
    // zum Ende durchlaufen, auch fuer das erste von 32 Blaettern.
    const sheet = workbook.sheets.find((s) => s.name === sheetName)
    if (!sheet) {
      out.destroy()
      throw new Error(`Das Tabellenblatt „${sheetName}“ ist in der Datei nicht enthalten.`)
    }

    async function* lines(): AsyncGenerator<string> {
      for await (const row of workbook.rows(sheet!)) {
        const cells = rowCells(row)
        if (cells.length === 0) {
          if (written > 0) skippedEmpty++
          continue
        }
        if (cells.length > maxCols) maxCols = cells.length
        written++
        yield csvLine(cells, ',')
      }
    }

    await pipeline(Readable.from(lines()), out)
  } finally {
    workbook.close()
  }

  return { rows: Math.max(0, written - 1), cols: maxCols, skippedEmpty }
}

/** Dateiname fuer ein herausgeloestes Blatt. */
export function sheetFilename(original: string, sheetName: string): string {
  const base = basename(original).replace(/\.[A-Za-z0-9]{1,6}$/, '')
  return sanitizeFilename(`${base} - ${sheetName}.csv`)
}
