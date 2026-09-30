/**
 * Ein Wert aus der Beispielkonfiguration, der noch in Gebrauch ist.
 *
 * Spiegelt server/lib/vorgabewerte.ts. Der Wert selbst steht bewusst nicht
 * darin, nur worum es geht.
 */
export interface Vorgabebefund {
  code: 'session_secret' | 'db_pass' | 'konto_passwort'
  schwere: 'abbruch' | 'warnung'
  betrifft?: string
}

/*
 * Was die Oberflaeche von den Import-Endpunkten erwartet.
 *
 * Bewusst eigene Typen und nicht die Datenbankzeile: Die Liste bekommt den
 * Pruefbericht nicht mit, und sie bekommt Felder, die es in der Tabelle nicht
 * gibt (etwa ob sich neu konvertieren laesst).
 */
import type { FieldHelp, FormatDetail, ImportReport, Severity, ValidationIssue } from '#shared/types/domain'

export interface ImportListItem {
  id: string
  filename: string
  /** Frei gewaehlter Anzeigename neben dem Dateinamen, sonst null. */
  label: string | null
  filesize: number
  base_format: string | null
  detected_format: string | null
  format_detail: FormatDetail | null
  sheet_name: string | null
  status: string
  upload_progress: number
  record_count: number
  error_count: number
  created_at: string
  tabular: boolean
  edited: number
  hasReport: boolean
  issues: Record<Severity, number>
  hasSheets: boolean
  canReconvert: boolean
  hasAvefi: boolean
  validated: boolean
  /** Ergebnis aus einer aelteren Version des Zuordnungsprofils — abgeleitet, nicht gespeichert. */
  stale: boolean
  ranWithVersion: number | null
  profileVersion: number | null
}

export type SortFeld = 'created' | 'filename' | 'status' | 'records' | 'validation'

/** Was der Anwender an der Liste eingestellt hat. Steht in der Adresse. */
export interface ListAuswahl {
  sort: SortFeld
  dir: 'asc' | 'desc'
  status: string[]
  issues: boolean
  q: string
}

export interface ImportListResponse {
  imports: ImportListItem[]
  sort: { field: SortFeld; dir: 'asc' | 'desc' }
  /**
   * total  Importe der Einrichtung insgesamt
   * loaded wieviele davon geladen wurden (Grenze der Abfrage)
   * shown  wieviele nach Filter uebrig sind
   */
  counts: { total: number; loaded: number; shown: number }
  kpi: { records: number; awaiting: number }
}

export interface ImportStatusResponse {
  busy: boolean
  count: number
  imports: Record<string, { status: string; records: number; errors: number; progress: number }>
}

export interface SheetInfo {
  index: number
  name: string
  rows: number
  cols: number
  usable: boolean
}

export interface ReportSummary {
  records: number
  avefiRecords: number
  valid: number
  invalid: number
  rowErrors: number
}

export interface ExtendedReport extends ImportReport {
  stage?: string
  converter?: string | null
  sheets?: SheetInfo[]
  summary?: ReportSummary
  mapping?: Record<string, unknown> | null
  parseDetail?: unknown
}

export interface DiagnosticEntry {
  severity: Severity
  /** Fehlt in Berichten vor dem 30.09.2026; dann bleibt der deutsche Satz. */
  code?: string
  params?: Record<string, string | number>
  /** Wortlaut des Parsers, unuebersetzt */
  detail?: string
  message: string
  line: number | null
  column: number | null
  offset: number | null
  hint: string
  snippet: {
    start: number
    lines: Array<{ no: number; text: string }>
    errorLine: number
    column: number | null
  } | null
}

export interface ParseDiagnostics {
  ok: boolean
  format: string
  errors: DiagnosticEntry[]
}

export interface FailedJob {
  classname: string
  error: string | null
  attempts: number
  finished_at: string | null
}

/**
 * Womit ein Ergebnis entstanden ist.
 *
 * Spiegelt server/api/imports/[id]/_herkunft.ts. `aufgezeichnet` unterscheidet
 * "es gab keine Zuordnung" von "es wurde nicht mitgeschrieben" — vor der
 * Einfuehrung von `run_config` konvertierte Importe koennen das zweite sein.
 */
export interface Herkunft {
  aufgezeichnet: boolean
  konvertiertAm: string | null
  formatProfil: { label: string; converterKey: string } | null
  zuordnungsProfil: {
    id: number
    name: string
    verwendeteVersion: number | null
    aktuelleVersion: number | null
  } | null
  schemaVersion: string | null
  trennzeichen: string | null
  normdaten: { aktiv: boolean; obergrenze: number | null } | null
}

export interface ImportDetailResponse {
  import: ImportListItem
  herkunft: Herkunft
  report: ExtendedReport | null
  sheets: SheetInfo[]
  failed: FailedJob | null
  diagnostics: ParseDiagnostics | null
  hasOriginal: boolean
}

export interface ImportReportResponse {
  import: ImportListItem
  report: ExtendedReport | null
  issues: ValidationIssue[]
  counts: Record<Severity, number>
  /** Quellzeile -> Datensatz-Nummer, fuer den Sprung aus einer Beanstandung. */
  rowRecords: Record<number, number>
  /** Zielfeldschluessel -> Auskunft. Nur die Felder, die in den Befunden vorkommen. */
  fieldHelp: Record<string, FieldHelp>
  summary: ReportSummary | null
  mapping: Record<string, unknown> | null
  coverage: Record<string, { filled: number; total: number }> | null
}

export interface SheetsResponse {
  import: { id: string; filename: string; status: string }
  sheets: SheetInfo[]
}

/** Abzeichenklasse aus app.css je Verarbeitungsstand. */
export const STATUS_BADGE: Record<string, string> = {
  uploading: 'b-neutral',
  queued: 'b-neutral',
  converting: 'b-info',
  awaiting_format_review: 'b-wait',
  awaiting_sheet_choice: 'b-wait',
  converted: 'b-ok',
  error: 'b-danger'
}

/** Staende, bei denen sich noch etwas von selbst aendert. */
export const BUSY_STATES = new Set(['uploading', 'queued', 'converting'])
