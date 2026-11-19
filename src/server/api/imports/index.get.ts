/*
 * GET /api/imports — Importliste der eigenen Institution.
 *
 * Der Pruefbericht selbst geht nicht mit: Er kann bei einer grossen Lieferung
 * fuenfhundert Meldungen umfassen, und die Liste braucht davon nur die Zahlen.
 * Was die Zeile anzeigt, wird hier ausgerechnet, nicht in der Oberflaeche.
 */
import { db } from '../../db'
import { countImports, listImports } from '../../lib/imports'
import { editedCounts } from '../../lib/records'
import { isTabular, type FormatDetail, type ImportRow, type Severity } from '#shared/types/domain'
import { requireInstitution } from './_lib'

export interface ImportListItem {
  id: string
  filename: string
  /** Frei gewaehlter Anzeigename neben dem Dateinamen, sonst null. */
  label: string | null
  filesize: number
  base_format: string | null
  detected_format: string | null
  /** Bestandteile des Formathinweises; detected_format ist nur der Rueckfall. */
  format_detail: FormatDetail | null
  sheet_name: string | null
  status: string
  upload_progress: number
  record_count: number
  error_count: number
  created_at: string
  tabular: boolean
  /** Von Hand bearbeitete Datensaetze — die Rueckfrage beim Neukonvertieren nennt die Zahl. */
  edited: number
  hasReport: boolean
  issues: Record<Severity, number>
  hasSheets: boolean
  canReconvert: boolean
  hasAvefi: boolean
  /** false = der Stand ist nicht gegen das Schema geprueft und darf nur zur Fehlersuche herunter. */
  validated: boolean
  /**
   * Das Ergebnis stammt aus einer aelteren Version des Zuordnungsprofils.
   *
   * Abgeleitet, nicht gespeichert: verglichen wird die Version, mit der
   * konvertiert wurde, mit der Version, die das Profil heute hat. Ein
   * gespeichertes Kennzeichen wuerde driften, sobald jemand ein Profil aendert,
   * ohne dass Importcode laeuft — und Profile sind hier institutionsuebergreifend
   * sichtbar. Ein abgeleiteter Zustand kann das nicht.
   */
  stale: boolean
  /** Version, mit der konvertiert wurde, und die heutige Version des Profils. */
  ranWithVersion: number | null
  profileVersion: number | null
}

export function toListItem(row: ImportRow, edited: number, profileVersion: number | null = null): ImportListItem {
  const report = row.report_json as (ImportRow['report_json'] & { stage?: string; sheets?: unknown[] }) | null
  const issues: Record<Severity, number> = { error: 0, warning: 0, info: 0 }
  // Ein Sammeleintrag zaehlt so oft, wie er Vorkommen buendelt: „52 Beanstandungen“
  // bleiben 52, auch wenn der Pruefbericht sie in einer Zeile zeigt (#53).
  for (const issue of report?.issues ?? []) {
    const n = issue.params?.['count']
    issues[issue.severity] = (issues[issue.severity] ?? 0) + (typeof n === 'number' && n > 0 ? n : 1)
  }

  const converted = row.status === 'converted'
  const hasAvefi = converted || report?.stage === 'convert'
  const settled = row.status === 'converted' || row.status === 'error'

  return {
    id: row.id,
    filename: row.filename,
    label: row.label ?? null,
    filesize: Number(row.filesize ?? 0),
    base_format: row.base_format,
    detected_format: row.detected_format,
    format_detail: row.format_detail ?? null,
    sheet_name: row.sheet_name,
    status: row.status,
    upload_progress: row.upload_progress,
    record_count: row.record_count,
    error_count: row.error_count,
    created_at: row.created_at,
    tabular: isTabular(row.base_format),
    edited,
    hasReport: report !== null,
    issues,
    hasSheets: Array.isArray(report?.sheets) && report.sheets.length > 0,
    /*
     * Kein `hasMapping` mehr. Das Feld sagte nur, ob `mapping_profile_id`
     * gesetzt ist, und wurde in der Oberflaeche als "es gibt hier eine
     * Zuordnung zu sehen" gelesen. Das stimmte in beide Richtungen nicht:
     * ueber ein Formatprofil konvertierte Importe haben keins, im Editor
     * gespeicherte ohne Konvertierung haben eins. Wer die Zuordnungsseite
     * verlinken will, fragt `tabular`.
     */
    canReconvert: settled && (row.mapping_profile_id !== null || row.format_profile_id !== null),
    hasAvefi,
    validated: converted && issues.error === 0,
    stale: settled
      && row.mapping_version !== null
      && profileVersion !== null
      && profileVersion !== row.mapping_version,
    ranWithVersion: row.mapping_version,
    profileVersion
  }
}

/*
 * Sortieren und Filtern (#2, gewuenscht von Matti Stoehr).
 *
 * Beides laeuft ueber den ganzen Bestand, nicht ueber die sichtbare Auswahl.
 * Eine Sortierung, die nur ordnet, was gerade da ist, sagt etwas anderes, als
 * sie zu sagen scheint — und bei ueber achtzig Importen ist genau das der Fall,
 * in dem jemand sich darauf verlaesst.
 *
 * Gerechnet wird in JavaScript und nicht in SQL, weil die interessanten
 * Merkmale erst aus report_json abgeleitet werden: ob es Beanstandungen gibt
 * und ob die Schemapruefung bestanden ist, steht in keiner Spalte. Sie erst in
 * die Abfrage zu heben hiesse, dieselbe Ableitung zweimal zu haben.
 */
const SORTIERBAR = ['created', 'filename', 'status', 'records', 'validation'] as const
type SortFeld = (typeof SORTIERBAR)[number]

function sortFeld(raw: unknown): SortFeld {
  const wert = String(raw ?? '')
  return (SORTIERBAR as readonly string[]).includes(wert) ? (wert as SortFeld) : 'created'
}

/** Rang der Schemapruefung, damit sich „ungeprueft" von „bestanden" trennt. */
function pruefRang(item: ImportListItem): number {
  if (!item.hasAvefi) return 0
  if (item.issues.error > 0) return 1
  return item.validated ? 3 : 2
}

function vergleiche(a: ImportListItem, b: ImportListItem, feld: SortFeld): number {
  switch (feld) {
    case 'filename':
      // Der Anzeigename steht in der Liste oben, also ordnet er auch.
      return (a.label ?? a.filename).localeCompare(b.label ?? b.filename, 'de')
    case 'status':
      return a.status.localeCompare(b.status)
    case 'records':
      return a.record_count - b.record_count
    case 'validation':
      return pruefRang(a) - pruefRang(b)
    default:
      return String(a.created_at).localeCompare(String(b.created_at))
  }
}

export interface ListFilter {
  status: string[]
  nurBeanstandet: boolean
  suche: string
}

function passt(item: ImportListItem, f: ListFilter): boolean {
  if (f.status.length > 0 && !f.status.includes(item.status)) return false
  if (f.nurBeanstandet && item.issues.error === 0) return false
  if (f.suche !== '') {
    const heu = `${item.label ?? ''} ${item.filename}`.toLowerCase()
    if (!heu.includes(f.suche)) return false
  }
  return true
}

export default defineEventHandler(async (event) => {
  const user = await requireInstitution(event)
  const sql = db()
  const [rows, edited, gesamt] = await Promise.all([
    listImports(sql, user.institution_id),
    editedCounts(sql, user.institution_id),
    countImports(sql, user.institution_id)
  ])

  // Die heutigen Versionen der beteiligten Profile — daraus faellt ab, welche
  // Ergebnisse noch zum aktuellen Stand passen.
  const ids = [...new Set(rows.map((r) => r.mapping_profile_id).filter((id): id is number => id !== null))]
  const versions = new Map<number, number>()
  if (ids.length > 0) {
    const found = await sql<Array<{ id: number; version: number }>>`
      SELECT id, version FROM mapping_profiles WHERE id = ANY(${ids})`
    for (const p of found) versions.set(p.id, p.version)
  }

  const alle = rows.map((r) => toListItem(
    r,
    edited[r.id] ?? 0,
    r.mapping_profile_id !== null ? versions.get(r.mapping_profile_id) ?? null : null
  ))

  const q = getQuery(event)
  const filter: ListFilter = {
    status: String(q.status ?? '').split(',').map((x) => x.trim()).filter((x) => x !== ''),
    nurBeanstandet: String(q.issues ?? '') === '1',
    suche: String(q.q ?? '').trim().toLowerCase()
  }
  const feld = sortFeld(q.sort)
  const absteigend = String(q.dir ?? (feld === 'created' ? 'desc' : 'asc')) === 'desc'

  const imports = alle
    .filter((i) => passt(i, filter))
    .sort((a, b) => (absteigend ? -1 : 1) * vergleiche(a, b, feld))

  return {
    imports,
    sort: { field: feld, dir: absteigend ? 'desc' : 'asc' },
    // Die Kennzahlen beschreiben den ganzen Bestand, nicht die Auswahl: Sonst
    // aenderte ein Filter die Gesamtzahl der Datensaetze, und das waere eine
    // andere Aussage als die, die dort steht.
    counts: { total: gesamt, loaded: alle.length, shown: imports.length },
    kpi: {
      records: alle.reduce((n, i) => n + i.record_count, 0),
      awaiting: alle.filter(
        (i) => i.status === 'awaiting_format_review' || i.status === 'awaiting_sheet_choice'
      ).length
    }
  }
})
