/*
 * Auftrag "worker/detect" — Format bestimmen und den Import auf den richtigen
 * Weg schicken.
 *
 * Drei Wege:
 *   Arbeitsmappe  Blaetter auflisten; genau ein brauchbares Blatt wird sofort
 *                 herausgeloest, bei mehreren entscheidet ein Mensch.
 *   Tabelle       Kopfzeilen-Hash bilden und ein Mappingprofil suchen.
 *   Struktur      JSON/XML: Syntax pruefen, Konverter waehlen oder pruefen lassen.
 */
import { basename, extname } from 'node:path'
import type { Sql } from 'postgres'
import type { BaseFormat } from '#shared/types/domain'
import { isTabular } from '#shared/types/domain'
import { copyOriginal, importDir, prepareWork, readHeadBytes, tableFile } from '../../lib/storage'
import {
  createImport,
  findImport,
  ensureFormatProfile,
  findMappingProfile,
  openFormatReview,
  setDetectedFormat,
  setFingerprint,
  setFormatProfile,
  setDelimiter,
  setHeaderHash,
  setMappingProfile,
  setReport,
  setSheet,
  setStatus,
  setStoragePath,
  type ExtendedImportReport
} from '../../lib/imports'
import { analyzeStructure } from '../../lib/converters/fingerprint'
import { describeFormat, formatDetail, genericConverterKey } from '../../lib/converters/formatGuess'
import { analyzeParse, diagnosticsToIssues } from '../../lib/converters/parseDiagnostics'
import {
  extractSheet,
  isReadableWorkbook,
  isWorkbook,
  listSheets,
  sheetFilename,
  unsupportedWorkbookMessage,
  type SheetInfo
} from '../../lib/converters/spreadsheet'
import { readTable, toProfileSample } from '../../lib/converters/table'
import { converterLabel } from '../../lib/converters/factory'
import { profileKey } from '../../lib/converters/profileTable'
import { enqueue } from '../queue'
import type { ImportRow } from '#shared/types/domain'

const EMPTY_SUMMARY = { records: 0, avefiRecords: 0, valid: 0, invalid: 0, rowErrors: 0 } as const

const EXTENSION_MAP: Record<string, BaseFormat> = {
  csv: 'csv',
  tsv: 'tsv',
  tab: 'tsv',
  xml: 'xml',
  ead: 'ead',
  marcxml: 'marcxml',
  marc: 'marcxml',
  json: 'json',
  xlsx: 'xlsx'
}

/** Formate, die als Arbeitsmappe erkannt, aber nicht gelesen werden. */
const WORKBOOK_EXTENSIONS: Record<string, string> = { xls: 'xls', ods: 'ods', xlsm: 'xlsx', xltx: 'xlsx' }

/**
 * Basisformat aus Endung und Dateianfang.
 * Ein unbekanntes Format bleibt null. Im PHP-Stand fiel es stillschweigend auf
 * XML zurueck; im Bestand steht deshalb ein Import mit dem Befund
 * "XML: <workbook>" — es war eine Excel-Datei.
 */
export async function guessBaseFormat(path: string, name: string): Promise<BaseFormat | null> {
  const ext = extname(name).replace('.', '').toLowerCase()
  const mapped = EXTENSION_MAP[ext]
  if (mapped) return mapped
  const workbook = WORKBOOK_EXTENSIONS[ext]
  if (workbook) return workbook as BaseFormat

  const head = await readHeadBytes(path, 4096)
  if (head.length === 0) return null
  // xlsx, xlsm und ods sind ZIP-Archive.
  if (head[0] === 0x50 && head[1] === 0x4b) return 'xlsx'
  // Altes Excel (BIFF8) beginnt mit der OLE-Kennung.
  if (head[0] === 0xd0 && head[1] === 0xcf) return 'xls' as BaseFormat

  const text = head.toString('utf8').replace(/^﻿/, '').trimStart()
  if (text === '') return null
  if (text.startsWith('{') || text.startsWith('[')) return 'json'
  if (text.startsWith('<')) return 'xml'
  const firstLine = text.split(/\r?\n/)[0] ?? ''
  if (firstLine.includes('\t')) return 'tsv'
  if (firstLine.includes(',') || firstLine.includes(';')) return 'csv'
  return null
}

export async function run(sql: Sql, payload: Record<string, unknown>): Promise<void> {
  const importId = String(payload.import_id ?? '')
  const record = importId !== '' ? await findImport(sql, importId) : null
  if (record === null) throw new Error('Import nicht gefunden.')

  const path = await tableFile(record.id)
  if (path === null) throw new Error('Die Originaldatei fehlt.')

  const base = record.base_format

  // Arbeitsmappen zuerst: Bevor irgendetwas von einer Tabelle sprechen kann,
  // muss ein Blatt herausgeloest sein.
  if (isWorkbook(base)) {
    const wanted = String(payload.sheet ?? '').trim()
    if (wanted !== '') await useSheet(sql, record, path, wanted)
    else await routeWorkbook(sql, record, path)
    return
  }

  const analysis = await analyzeStructure(path, base)
  await setFingerprint(sql, record.id, analysis.fingerprint)

  const structured = base === 'json' || base === 'xml' || base === 'ead' || base === 'marcxml'
  let parseOk = true
  let diagnostics = null
  if (structured) {
    diagnostics = await analyzeParse(path, base)
    parseOk = diagnostics.ok
  }

  await setDetectedFormat(
    sql,
    record.id,
    describeFormat(base, analysis, parseOk),
    formatDetail(base, analysis, parseOk)
  )

  if (structured && !parseOk && diagnostics !== null) {
    const report: ExtendedImportReport = {
      stage: 'detect',
      issues: diagnosticsToIssues(diagnostics),
      parseDetail: diagnostics,
      summary: { ...EMPTY_SUMMARY }
    }
    await setReport(sql, record.id, report)
    await setStatus(sql, record.id, 'error')
    console.log(`[detect] ${record.filename} → Fehler (Datei nicht lesbar)`)
    return
  }

  // Tabellarische Quellen laufen immer ueber Kopfzeilen-Hash und Mappingprofil.
  if (isTabular(base)) {
    await routeTable(sql, record, path, base)
    return
  }

  const key = genericConverterKey(base, analysis)
  if (key !== null) {
    const profileId = await ensureFormatProfile(sql, key, converterLabel(key), base ?? 'xml')
    await setFormatProfile(sql, record.id, profileId)
    await setStatus(sql, record.id, 'converting')
    await enqueue(sql, 'worker/convert', { import_id: record.id, converter_key: key }, record.id)
    console.log(`[detect] ${record.filename} → ${key}`)
    return
  }

  const review = await openFormatReview(sql, record.id, record.institution_id, analysis.fingerprint, {
    columns: analysis.columns,
    sample: analysis.sample
  })
  await setStatus(sql, record.id, 'awaiting_format_review')
  console.log(
    `[detect] ${record.filename} → Formatpruefung (${review.created ? 'neu angelegt' : `bereits offen als #${review.id}`})`
  )
}

/* ------------------------------------------------------------ Arbeitsmappe */

async function routeWorkbook(sql: Sql, record: ImportRow, path: string): Promise<void> {
  if (!isReadableWorkbook(record.base_format)) {
    const message = unsupportedWorkbookMessage(record.base_format, record.filename)
    await setDetectedFormat(sql, record.id, String(record.base_format) === 'ods' ? 'OpenDocument (nicht lesbar)' : 'Excel 97-2003 (nicht lesbar)')
    await setReport(sql, record.id, {
      stage: 'detect',
      issues: [{
        severity: 'error', message, code: 'workbook_format_unsupported',
        params: { kind: String(record.base_format) === 'ods' ? 'ods' : 'xls' }
      }],
      summary: { ...EMPTY_SUMMARY }
    } satisfies ExtendedImportReport)
    await setStatus(sql, record.id, 'error')
    console.log(`[detect] ${record.filename} → Fehler (Format nicht lesbar)`)
    return
  }

  let sheets: SheetInfo[]
  try {
    sheets = await listSheets(path, record.base_format)
  } catch (e) {
    await setReport(sql, record.id, {
      stage: 'detect',
      issues: [
        {
          severity: 'error',
          message: `Die Arbeitsmappe konnte nicht gelesen werden: ${e instanceof Error ? e.message : String(e)}`,
          detail: e instanceof Error ? e.message : String(e),
          code: 'workbook_unreadable'
        }
      ],
      summary: { ...EMPTY_SUMMARY }
    } satisfies ExtendedImportReport)
    await setStatus(sql, record.id, 'error')
    console.log(`[detect] ${record.filename} → Fehler (Arbeitsmappe nicht lesbar)`)
    return
  }

  const usable = sheets.filter((s) => s.usable)
  await setDetectedFormat(
    sql,
    record.id,
    `Excel · ${sheets.length} ${sheets.length === 1 ? 'Blatt' : 'Blätter'}`,
    { format: 'Excel', sheets: sheets.length }
  )

  if (usable.length === 0) {
    await setReport(sql, record.id, {
      stage: 'detect',
      sheets,
      issues: [
        {
          severity: 'error',
          message:
            'Kein Tabellenblatt enthaelt eine Kopfzeile mit mindestens zwei Spalten und einer Datenzeile. ' +
            'Deckblaetter und Legenden allein ergeben keinen Import.',
          code: 'no_usable_sheet'
        }
      ],
      summary: { ...EMPTY_SUMMARY }
    } satisfies ExtendedImportReport)
    await setStatus(sql, record.id, 'error')
    console.log(`[detect] ${record.filename} → Fehler (kein brauchbares Blatt)`)
    return
  }

  if (usable.length === 1) {
    const only = usable[0] as SheetInfo
    await useSheet(sql, record, path, only.name)
    return
  }

  await setReport(sql, record.id, {
    stage: 'detect',
    sheets,
    issues: [],
    summary: { ...EMPTY_SUMMARY }
  } satisfies ExtendedImportReport)
  await setStatus(sql, record.id, 'awaiting_sheet_choice')
  console.log(`[detect] ${record.filename} → ${usable.length} Blätter zur Auswahl`)
}

/** Loest ein Blatt heraus und schickt den Import in die Tabellenerkennung. */
export async function useSheet(sql: Sql, record: ImportRow, path: string, sheetName: string): Promise<void> {
  const dest = await prepareWork(record.id, sheetFilename(record.filename, sheetName))
  const info = await extractSheet(path, sheetName, dest, record.base_format)

  await setSheet(sql, record.id, sheetName)
  await setDetectedFormat(
    sql,
    record.id,
    `Excel · Blatt „${sheetName}“ · ${info.cols} Spalten`,
    { format: 'Excel', sheet: sheetName, columns: info.cols }
  )
  console.log(`[detect] ${record.filename} → Blatt „${sheetName}“ (${info.rows} Zeilen)`)

  await routeTable(sql, { ...record, sheet_name: sheetName }, dest, 'csv')
}

/**
 * Legt fuer jedes gewaehlte Blatt einen eigenen Import an.
 *
 * Ein Import je Blatt, weil zwei Blaetter mit verschiedenen Spalten
 * verschiedene Mappingprofile brauchen. Das erste gewaehlte Blatt bleibt beim
 * vorhandenen Import, fuer die weiteren wird die Originaldatei kopiert.
 * Liefert die Ids aller beteiligten Importe.
 */
export async function chooseSheets(sql: Sql, record: ImportRow, sheetNames: readonly string[]): Promise<string[]> {
  if (sheetNames.length === 0) throw new Error('Es wurde kein Tabellenblatt gewaehlt.')

  const ids: string[] = [record.id]
  const [first, ...rest] = sheetNames

  for (const name of rest) {
    const copy = await createImport(sql, {
      institutionId: record.institution_id,
      userId: record.user_id,
      filename: record.filename,
      filesize: record.filesize,
      baseFormat: record.base_format
    })
    const copied = await copyOriginal(record.id, copy.id)
    if (copied === null) throw new Error('Die Originaldatei konnte nicht kopiert werden.')
    await setStoragePath(sql, copy.id, importDir(copy.id))
    await setStatus(sql, copy.id, 'queued', 100)
    await enqueue(sql, 'worker/detect', { import_id: copy.id, sheet: name }, copy.id)
    ids.push(copy.id)
  }

  await setStatus(sql, record.id, 'queued', 100)
  await enqueue(sql, 'worker/detect', { import_id: record.id, sheet: first }, record.id)
  return ids
}

/* ---------------------------------------------------------------- Tabelle */

/**
 * Kopfzeilen-Hash bilden und ein Mappingprofil suchen. Vorhanden und
 * vollstaendig: konvertieren. Sonst pausiert der Import, bis jemand die
 * Zuordnung gebaut hat — das ist kein Fehler, sondern der vorgesehene Weg.
 */
async function routeTable(sql: Sql, record: ImportRow, path: string, base: BaseFormat | null): Promise<void> {
  // Hier faellt die Entscheidung ueber das Trennzeichen — einmal, und sie wird
  // festgehalten. Jedes spaetere Lesen nimmt sie, statt neu zu raten.
  const table = await readTable(path, base, undefined, record.delimiter as never)
  await setHeaderHash(sql, record.id, table.hash)
  if (record.delimiter === null) await setDelimiter(sql, record.id, table.delimiter)

  // Stammt die Tabelle aus einer Arbeitsmappe, bleibt das im Hinweis stehen:
  // "CSV" waere irrefuehrend, hochgeladen wurde eine Excel-Datei.
  await setDetectedFormat(
    sql,
    record.id,
    record.sheet_name
      ? `Excel · Blatt „${record.sheet_name}“ · ${table.columns.length} Spalten`
      : `${(base ?? 'csv').toUpperCase()} · ${table.columns.length} Spalten`,
    record.sheet_name
      ? { format: 'Excel', sheet: record.sheet_name, columns: table.columns.length }
      : { format: (base ?? 'csv').toUpperCase(), columns: table.columns.length }
  )

  if (table.columns.length === 0) {
    await setReport(sql, record.id, {
      stage: 'detect',
      issues: [{ severity: 'error', message: 'Die Datei enthaelt keine lesbare Kopfzeile.', code: 'no_header' }],
      summary: { ...EMPTY_SUMMARY }
    } satisfies ExtendedImportReport)
    await setStatus(sql, record.id, 'error')
    console.log(`[detect] ${record.filename} → Fehler (keine Kopfzeile)`)
    return
  }

  const profile = await findMappingProfile(sql, record.institution_id, table.hash)
  if (profile !== null && profile.complete) {
    await setMappingProfile(sql, record.id, profile.id, profile.version)
    await setStatus(sql, record.id, 'converting')
    await enqueue(
      sql,
      'worker/convert',
      { import_id: record.id, converter_key: profileKey(profile.id) },
      record.id
    )
    console.log(`[detect] ${record.filename} → Profil „${profile.name}“ (v${profile.version})`)
    return
  }

  const review = await openFormatReview(
    sql,
    record.id,
    record.institution_id,
    table.hash,
    toProfileSample(table)
  )
  await setStatus(sql, record.id, 'awaiting_format_review')
  console.log(
    `[detect] ${basename(path)} → Zuordnung noetig (Kopfzeile ${table.hash}, ` +
      `${review.created ? 'Aufgabe neu' : `Aufgabe #${review.id} besteht bereits`})`
  )
}
