/**
 * Fachliche Typen des AVefi-Importers.
 *
 * Diese Datei ist die einzige Wahrheit fuer Backend und Oberflaeche. Sie liegt
 * bewusst in shared/, damit ein Feldname nicht an zwei Stellen gepflegt wird —
 * genau daran ist im PHP-Stand der Profil-Export ohne Stichprobe gescheitert.
 */

/* ------------------------------------------------------------------ Import */

export type ImportStatus =
  | 'uploading'
  | 'queued'
  | 'converting'
  | 'awaiting_format_review'
  | 'awaiting_sheet_choice'
  | 'converted'
  | 'error'

export interface ImportRow {
  id: string
  institution_id: number
  user_id: number | null
  filename: string
  /**
   * Frei gewaehlter Anzeigename, neben dem Dateinamen und nicht statt
   * seiner. Der Dateiname ist die Verbindung zur Lieferung des Archivs.
   */
  label: string | null
  filesize: number
  base_format: BaseFormat | null
  fingerprint: string | null
  header_hash: string | null
  format_profile_id: number | null
  mapping_profile_id: number | null
  mapping_version: number | null
  sheet_name: string | null
  status: ImportStatus
  upload_progress: number
  record_count: number
  error_count: number
  storage_path: string | null
  report_json: ImportReport | null
  detected_format: string | null
  format_detail: FormatDetail | null
  /** Festgelegtes Spaltentrennzeichen — geraten wird nur einmal, beim Erkennen. */
  delimiter: string | null
  /** Womit das vorliegende Ergebnis entstanden ist. */
  run_config: RunConfig | null
  created_at: string
}

/**
 * Der reproduzierbare Zustand eines Konvertierungslaufs.
 *
 * Nicht alles, was das Ergebnis bestimmt, steckt im Mappingprofil: das
 * Trennzeichen der Datei, die Version des AVefi-Schemas, die
 * Normdateneinstellungen. Wer nachvollziehen will, warum ein Ergebnis so
 * aussieht, braucht diese Angaben zusammen mit der Profilversion.
 */
export interface RunConfig {
  profileId: number | null
  profileVersion: number | null
  /** Version des Profilformats, nicht des Profils. */
  profileFormatVersion: string | null
  avefiSchemaVersion: string | null
  delimiter: string | null
  authorityEnabled: boolean
  authorityLimit: number | null
  /** Zeitpunkt des Laufs, ISO. */
  at: string
}

/**
 * Bestandteile des Formathinweises, getrennt statt als fertiger Satz.
 *
 * Serverseitig zusammengesetzte Saetze wie "CSV - 49 Spalten" lassen sich in
 * der Oberflaeche nicht mehr uebersetzen. Hier stehen die Teile; den Satz
 * bildet die Anzeige aus i18n-Schluesseln. Der Formatname selbst ist ein
 * Eigenname ("CSV", "Excel", "MARC-XML") und bleibt unuebersetzt.
 */
export interface FormatDetail {
  format: string
  /** Bei Arbeitsmappen: das gelesene Blatt. */
  sheet?: string
  /** Spaltenzahl der Tabelle. */
  columns?: number
  /** Zahl der Blaetter, solange noch keines gewaehlt ist. */
  sheets?: number
}

export type BaseFormat = 'csv' | 'tsv' | 'xlsx' | 'xml' | 'ead' | 'marcxml' | 'json'

/** Tabellarische Formate laufen ueber die Kopfzeilen-Aufloesung, nicht ueber Fingerprints. */
export const TABULAR_FORMATS: readonly BaseFormat[] = ['csv', 'tsv', 'xlsx'] as const

export function isTabular(f: BaseFormat | null | undefined): boolean {
  return !!f && (TABULAR_FORMATS as readonly string[]).includes(f)
}

/* -------------------------------------------------------------- Validierung */

export type Severity = 'error' | 'warning' | 'info'

/**
 * Strukturierte Meldung, wie sie der Vertrag in Paragraf 3 verlangt:
 * Schweregrad, Meldung sowie — soweit zuordenbar — Zeile bzw. Datensatz,
 * Quellfeld und AVefi-Schemafeld.
 */
/**
 * Auskunft zu einem Zielfeld, das in den Beanstandungen vorkommt.
 *
 * Steht hier und nicht je einmal auf beiden Seiten: Server und Oberflaeche
 * muessen sich ueber die Felder einig sein, und zwei Kopien derselben vier
 * Zeilen laufen frueher oder spaeter auseinander.
 */
export interface FieldHelp {
  label: string
  description: string | null
  /** Zulaessige Werte, wenn das Feld eine Werteliste hat. Sonst null. */
  values: string[] | null
}

/**
 * Welche Regel eine Beanstandung erhebt.
 *
 * Der Bericht mischt drei Quellen, und sie haben verschiedenes Gewicht:
 *
 *   schema        Das AVefi-Schema, geprueft im Dienst efi-conv.
 *   crossref      Satzuebergreifende Regeln desselben Dienstes: Eindeutigkeit
 *                 der Kennungen, aufloesbare Verweise, Exemplar je Manifestation.
 *   completeness  Regeln DIESER Anwendung. Sie gehen ueber das Schema hinaus.
 *                 Der fehlende Haupttitel ist der Fall dafuer: Am WorkVariant
 *                 ist `has_primary_title` schemakonform optional, ein Werk ohne
 *                 Titel ist im Verbund aber nicht auffindbar.
 *   konvertierung Was beim Lesen und Umsetzen der Datei auffiel.
 *
 * Ohne diese Angabe sieht eine eigene Regel aus wie eine des Verbunds, und
 * irgendwann streitet jemand mit einem falschen Argument.
 */
export type IssueSource = 'schema' | 'crossref' | 'completeness' | 'konvertierung'

export interface ValidationIssue {
  severity: Severity
  message: string
  /** Welche Regel die Meldung erhebt. Fehlt sie, ist es die Konvertierung. */
  source?: IssueSource
  /** 1-basierte Zeile der Quelldatei, sofern zuordenbar. */
  row?: number
  /** Laufende Nummer des erzeugten Datensatzes, sofern zuordenbar. */
  record?: number
  /** Spaltenname der Quelle. */
  sourceField?: string
  /** Pfad im AVefi-Schema, z. B. has_primary_title.has_name */
  targetField?: string
  /** Der Wert, an dem es scheiterte — gekuerzt, nie ein ganzer Datensatz. */
  value?: string
  /** Stabiler Bezeichner fuer Uebersetzung und Gruppierung. */
  code?: string
  /**
   * Bausteine des Satzes, damit die Oberflaeche ihn in ihrer Sprache bauen
   * kann. Bis zum 07.09.2026 trug `message` den fertigen deutschen Satz des
   * Mappingkerns, und die englische Oberflaeche zeigte ihn unveraendert.
   */
  params?: Record<string, string | number>
  /**
   * Wortlaut des Pruefwerkzeugs (Pydantic, jsonschema, efi-conv), unuebersetzt.
   * Die Oberflaeche baut den Satz aus `code` und `params` in ihrer Sprache und
   * zeigt diesen Text daneben, damit erkennbar bleibt, was efi-conv gesagt hat.
   */
  detail?: string
  /**
   * Anzahl, auf die sich der Befund bezieht, etwa die Zahl der Normdaten-
   * Treffer. Sie steht getrennt, damit die Oberflaeche den Satz selbst bauen
   * kann; sonst muesste sie den deutschen Serversatz stehen lassen.
   */
  count?: number
  /**
   * Anwendbarer Vorschlag zur Behebung, etwa „Konverter duration einfuegen?".
   * Die Oberflaeche darf ihn anbieten, nie von selbst anwenden — automatische
   * Korrektur von Validierungsfehlern ist vertraglich ausgeschlossen.
   */
  fix?: TransformStep
}

export interface ImportReport {
  issues: ValidationIssue[]
  /** Belegung je Kernfeld: Feldschluessel -> gefuellt von wie vielen. */
  coverage?: Record<string, { filled: number; total: number }>
  schemaVersion?: string
  efiConvVersion?: string
  startedAt?: string
  finishedAt?: string
}

/* --------------------------------------------------------------- Mapping */

/** Ein Konverterschritt. Immer ein Objekt mit op, nie ein nackter String —
 *  sonst gaebe es zwei Formen fuer dieselbe Sache, sobald ein Parameter dazukommt. */
export interface TransformStep {
  op: TransformOp
  [param: string]: unknown
}

export type TransformOp =
  | 'trim' | 'lowercase' | 'uppercase' | 'titlecase'
  | 'split' | 'take' | 'join' | 'replace' | 'regex' | 'prefix' | 'suffix'
  | 'date' | 'duration' | 'number' | 'boolean' | 'only'
  | 'map' | 'default' | 'country' | 'language' | 'authority'
  | LegacyTransformOp

/**
 * Operationen aus dem PHP-Stand, die weiterhin ausgefuehrt werden, damit alte
 * Profile nicht brechen. Im Editorkatalog erscheinen sie nicht mehr.
 * Nachfolger: template -> prefix/suffix, year -> regex mit capture.
 * Fuer substring und concat gibt es keinen Nachfolger.
 */
export type LegacyTransformOp = 'substring' | 'concat' | 'year' | 'template'

export const LEGACY_OPS: readonly LegacyTransformOp[] = ['substring', 'concat', 'year', 'template'] as const

export interface TargetBinding {
  /** Schluessel aus dem TargetCatalog, z. B. work.title.primary */
  target: string
  /** Kette nach der Verzweigung. */
  post: TransformStep[]
}

/**
 * Eine von Hand bestaetigte Normdatenzuordnung. Je Quellwert kann es mehrere
 * geben — eine je Normdatenquelle (GND, Wikidata, VIAF).
 */
export interface ConfirmedAuthorityEntry {
  id: string
  /** Resource-Typ ("GNDResource") oder Quellschluessel ("gnd"). */
  type: string
  label?: string
}

export interface ColumnMapping {
  /** Gemeinsame Kette vor der Verzweigung. */
  pre?: TransformStep[]
  /** Ein oder mehrere Ziele — eine Spalte darf mehrfach landen. */
  targets?: TargetBinding[]
  /** Bewusst ignoriert. Fehlt beides, gilt die Spalte als NOCH NICHT ANGEFASST. */
  ignore?: boolean
  /** Zuordnung von Quellwerten auf Vokabularwerte. */
  valuemap?: Record<string, string>
  /** Bestaetigte Normdaten-Treffer: Quellwert -> Ressource. */
  authorities?: Record<string, ConfirmedAuthorityEntry | ConfirmedAuthorityEntry[]>
  /** Hinweise, die jemand fuer diese Spalte ausdruecklich abgelehnt hat. */
  dismissed?: DismissedHint[]
}

/**
 * Ein abgelehnter Hinweis.
 *
 * Der Aufteilungs-Vorschlag kam bei jedem Aufruf wieder, auch wenn jemand
 * schon entschieden hatte, dass die Spalte nicht geteilt gehoert (gemeldet von
 * Jasper Stratil am 01.09.2026). Die Ablehnung ist eine Entscheidung ueber das
 * Mapping und steht deshalb im Profil, nicht im Browser: Sie erzeugt eine neue
 * Profilversion, steht im Verlauf und wandert mit dem Profil zur naechsten
 * Testperson — wie bestaetigte Normdaten auch.
 *
 * Der Hinweis verschwindet aus der Liste, aber nicht aus der Welt: Der
 * Pruefbericht zaehlt ihn weiter, damit spaeter unterscheidbar bleibt, ob er
 * nie kam oder abgelehnt wurde.
 */
export interface DismissedHint {
  /** Code des Hinweises, etwa "data.separator". */
  code: string
  /** Zielschluessel, auf den er sich bezog. */
  target?: string
  /** Bei Aufteilungs-Vorschlaegen das vorgeschlagene Trennzeichen. */
  sep?: string
}

export interface MappingDefault {
  target: string
  value: string
}

export interface GroupingRule {
  /** Zielschluessel, nach denen gruppiert wird — bevorzugt gemappte Werte, nicht Rohspalten. */
  by: string[]
}

/** Das gespeicherte und exportierbare Mappingprofil. */
export interface MappingJson {
  /** Format des Profils selbst. Vertrag Paragraf 3: Profilformat-Version. */
  profileFormatVersion: 1
  /** AVefi-Schemaversion, gegen die gemappt wurde. Vertrag Paragraf 3. */
  avefiSchemaVersion: string | null
  columns: Record<string, ColumnMapping>
  defaults: MappingDefault[]
  row: { represents: 'item' | 'manifestation' | 'work' }
  grouping: { work: GroupingRule; manifestation: GroupingRule }
}

export interface MappingProfileRow {
  id: number
  institution_id: number
  created_by_user_id: number | null
  header_hash: string
  base_format: BaseFormat
  name: string
  mapping_json: MappingJson
  sample_json: ProfileSample | null
  version: number
  complete: boolean
  derived_from_id: number | null
  created_at: string
  updated_at: string
}

/** Stichprobe im Profil — ohne sie verweigert der Editor den Dienst. */
export interface ProfileSample {
  columns: string[]
  rows: string[][]
  /** Je Spalte die verschiedenen gefuellten Werte mit Haeufigkeit. */
  values?: Record<string, Array<{ value: string; count: number }>>
  /** Belegung je Spalte: gefuellt in X von Y Zeilen. */
  coverage?: Record<string, { filled: number; total: number }>
}

/** Der exportierte Profil-Dateikopf. Reines Importer-Artefakt, kein Austauschformat mit efi-conv. */
export interface MappingProfileExport {
  origin: {
    application: 'avefi-importer'
    exportedAt: string
    profileName: string
    profileVersion: number
    institution?: string
  }
  profileFormatVersion: 1
  avefiSchemaVersion: string | null
  baseFormat: BaseFormat
  headerHash: string
  mapping: MappingJson
  /** Stichprobe muss mit, sonst laesst sich das Profil nicht bearbeiten. */
  sample: ProfileSample | null
}

/* ------------------------------------------------------------- Zielkatalog */

export type TargetLevel = 'work' | 'manifestation' | 'item'

export type TargetType =
  | 'text' | 'date' | 'duration' | 'number' | 'lang'
  | `enum:${string}` | `id:${string}`

export interface TargetEntry {
  key: string
  label: string
  level: TargetLevel
  group: string
  type: TargetType
  multi: boolean
  /** Vollstaendiger Schemapfad — der Vertrag verlangt seine Anzeige. */
  path: string
  description?: string
  /** Erlaubte Werte bei kontrolliertem Vokabular. */
  enumValues?: string[]
  pattern?: string
  /** Darf eine Normdaten-Anreicherung tragen. */
  acceptsAuthority?: boolean
}

/* -------------------------------------------------- Erzeugter AVefi-Satz */

/*
 * Zwei verschiedene Dinge trugen bis zum 07.09.2026 denselben Namen.
 *
 * AvefiNode meint die drei Ebenen — Werk, Manifestation, Exemplar. Die tragen
 * immer eine category. Der Mappingkern nannte aber auch verschachtelte
 * Wertobjekte so: einen Titel { has_name, type }, ein Schlagwort { has_name },
 * eine Sprache { code, usage }. Die tragen keine category und sollen auch
 * keine tragen.
 *
 * Weil ein Typ nicht beides sein kann, stand in server/lib/mapping/builder.ts
 * und in server/lib/converters/types.ts je ein eigenes
 * `type AvefiNode = Record<string, unknown>` — also der Verzicht auf
 * Typisierung. Die Datei hier nannte sich derweil die einzige Wahrheit und
 * wurde im Mappingkern von beiden Aliassen verdeckt. Sichtbar wurde das nur
 * an einer Stelle: server/api/mappings/_run.ts konnte den lokalen Satz nicht
 * an den geteilten uebergeben.
 *
 * Jetzt gibt es zwei Namen fuer die zwei Dinge.
 */

/**
 * Eine Meldung des Mappingkerns als Code und Bausteine, nicht als fertiger
 * Satz. Den deutschen Text dazu baut server/lib/mapping/meldungen.ts, die
 * englische Oberflaeche baut ihren eigenen.
 */
export interface MappingMessage {
  code: string
  params?: Record<string, string | number>
  /**
   * Der deutsche Satz, am Rand der API eingesetzt. Rueckfallebene fuer den
   * Fall, dass zu einem Code keine Uebersetzung vorliegt — dann steht dort
   * ein Satz und nicht der Code.
   */
  text?: string
}

/** Ein Wertobjekt im Baum: Titel, Schlagwort, Sprache, Kennung. Ohne category. */
export type AvefiValue = Record<string, unknown>

/** Ein Knoten im AVefi-Schema (Work, Manifestation oder Item). */
export interface AvefiNode {
  category: string
  has_identifier?: Array<Record<string, unknown>>
  [field: string]: unknown
}

/** Was aus einer Quellzeile bzw. einer Gruppe von Zeilen entsteht. */
export interface AvefiRecord {
  work: AvefiNode
  manifestations: AvefiNode[]
  items: AvefiNode[]
}

/** Das, was in records.data_json steht. */
export interface RecordData {
  avefi: AvefiRecord
  /** Die Quellzeile(n), aus denen der Satz entstand. */
  source?: Record<string, string> | Array<Record<string, string>>
}

/* ------------------------------------------------------------- Datensaetze */

export interface RecordRow {
  id: number
  import_id: string
  work_title: string | null
  work_year: number | null
  work_type: string | null
  avefi_pid: string | null
  manifestation_count: number
  item_count: number
  completeness: number
  data_json: unknown
  source_row: number | null
  edited_at: string | null
  created_at: string
}

/* --------------------------------------- Antworten der Datensatz-Endpunkte */

/*
 * Die Antwortformen stehen hier und nicht in der Oberflaeche, weil sie ein
 * Vertrag zwischen beiden Seiten sind. Bis zum 07.09.2026 standen sie in
 * app/components/records/types.ts, also nur auf einer Seite — und genau
 * deshalb konnte `core` aus der Antwort verschwinden, ohne dass irgendwo
 * etwas rot wurde: Die Oberflaeche las `d.record.core ?? null`, der Endpunkt
 * lieferte das Feld gar nicht, und die Kernfeld-Anzeige blieb dauerhaft leer
 * — auch nach „Pruefen", denn /records/validate liefert es ebenfalls nicht.
 *
 * Ein Typ, der aus dem Handler abgeleitet wird, haette das nicht gefunden: Er
 * haette schlicht gespiegelt, was der Handler zufaellig zurueckgibt. Ein Typ,
 * den der Handler erfuellen muss, findet es. Deshalb tragen die Handler ihn
 * als Rueckgabetyp.
 */

/** Belegte Kernfelder — „3 von 4" statt eines Prozentwerts. */
export interface CoreScore {
  filled: number
  total: number
  missing: string[]
}

/** Hinweis zur Belegung, wie ihn der Datensatz-Editor anzeigt. */
export interface CompletenessHint {
  level: Severity | 'ok'
  /** Stabiler Bezeichner, damit die Oberflaeche den Satz selbst waehlt. */
  code: string
  /** Der deutsche Satz als Rueckfallebene. */
  text: string
}

/** Der Import, zu dem ein Datensatz gehoert, so weit die Oberflaeche ihn braucht. */
export interface RecordImportInfo {
  id: string
  filename: string
  base_format: string | null
  detected_format?: string | null
  status: string
  sheet_name?: string | null
  record_count?: number
}

/** Kopfdaten eines Datensatzes im Editor. */
/**
 * Ampel der Kernfeld-Plakette.
 *
 *   danger  ein Pflichtfeld fehlt — der Datensatz ist so nicht schemakonform
 *   part    empfohlene Felder fehlen
 *   full    alle vier Kernfelder belegt
 *
 * Loeste am 08.09.2026 den Fortschrittsring ab, dessen Farbe sich nach dem
 * Anteil ausgefuellter Felder richtete. Begruendung in completeness.ts.
 */
export type CoreState = 'danger' | 'part' | 'full'

export interface RecordDetailInfo {
  id: number
  title: string | null
  year: number | null
  type: string | null
  pid: string | null
  completeness: number
  core: CoreScore
  coreState: CoreState
  sourceRow: number | null
  editedAt: string | null
  createdAt: string
  contributors: string[]
}

/** GET /api/imports/:id/records/:recordId */
export interface RecordDetailResponse {
  import: RecordImportInfo
  record: RecordDetailInfo
  avefi: AvefiRecord
  hints: CompletenessHint[]
  prev: number | null
  next: number | null
}

/** POST /api/records/validate */
export interface CheckResponse {
  checked: number
  valid: number
  issues: ValidationIssue[]
  schema?: { version?: string | null; source?: string | null } | null
  unavailable: string | null
  completeness?: number
  hints: CompletenessHint[]
}

/** PUT /api/imports/:id/records/:recordId */
export interface SaveResponse extends CheckResponse {
  ok: true
  completeness: number
  core: CoreScore
  coreState: CoreState
  editedAt: string | null
  title: string | null
  avefi: AvefiRecord
}

/* ------------------------------------------------------ Nutzer, Institution */

export interface UserRow {
  id: number
  institution_id: number | null
  email: string
  name: string
  is_admin: boolean
  active: boolean
  created_at: string
  last_login_at: string | null
}

export interface InstitutionRow {
  id: number
  name: string
  slug: string
  created_at: string
}

/* ------------------------------------------------------------ Worker-Queue */

export type JobClass = 'worker/download' | 'worker/detect' | 'worker/convert'
export type JobStatus = 'queued' | 'running' | 'done' | 'failed'

export interface WorkerJobRow {
  id: number
  classname: JobClass
  import_id: string | null
  payload: Record<string, unknown>
  status: JobStatus
  attempts: number
  run_at: string
  error: string | null
  created_at: string
  started_at: string | null
  finished_at: string | null
}
