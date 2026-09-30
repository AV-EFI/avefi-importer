/*
 * Typen der Mapping-Oberflaeche.
 *
 * Sie beschreiben, was die Endpunkte unter server/api/mappings/ und
 * server/api/imports/:id/mapping/ liefern. Fachliche Typen kommen aus
 * shared/types/domain.ts und werden hier nur weitergereicht — ein zweiter Ort
 * fuer denselben Feldnamen waere ein zweiter Ort, an dem er abweichen kann.
 */
import type {
  BaseFormat, MappingJson, MappingMessage, ProfileSample, TargetEntry, TransformStep, ValidationIssue
} from '#shared/types/domain'

export type { MappingJson, ProfileSample, TargetEntry, TransformStep, ValidationIssue }

/** Zieleintrag mit Schemapfad und Suchwoertern. */
export interface EditorTarget extends TargetEntry {
  schemaPath: string
  search: string[]
}

export interface TransformParamSpec {
  name: string
  label: string
  type: 'text' | 'int' | 'bool' | 'map' | 'columns' | 'choice'
  optional?: boolean
  choices?: Record<string, string>
}

export interface TransformOpMeta {
  op: string
  label: string
  group: string
  in: string
  out: string
  params: TransformParamSpec[]
  slow?: boolean
  legacy?: boolean
  replacedBy?: string
  /** Empfohlene Stelle in der Kette — kommt vom Server, damit es eine Tabelle bleibt. */
  phase?: number
}

/** Ein Teil eines mehrteiligen Vorschlags. Spiegelt server/lib/mapping/runner.ts. */
export interface MappingFixPart {
  target: string
  post?: TransformStep[]
  replaces?: string
}

export interface MappingCheck extends ValidationIssue {
  /** Konverterschritt, der die Beanstandung ausraeumen wuerde — nur ein Vorschlag. */
  fix?: TransformStep
  /** Mehrteiliger Vorschlag: mehrere Ziele auf einmal, auch neu anzulegende. */
  fixPlan?: MappingFixPart[]
  /** Uebersetzungsschluessel fuer die Knopfbeschriftung eines fixPlan. */
  fixLabel?: string
}

export interface ProfileRef {
  id: number
  name: string
  version: number
  complete: boolean
}

export interface ForeignProfile {
  id: number
  name: string
  institution_name: string
  version: number
  complete: boolean
}

export interface ColumnReport {
  matched: string[]
  missing: string[]
  extra: string[]
  renamed: Array<{ from: string; to: string; similarity: number }>
  usable: boolean
  summary: string
}

export interface EditorPayload {
  mode: 'import' | 'profile'
  endpoint: string
  subject: string
  canStart: boolean
  baseFormat: BaseFormat
  headerHash: string
  rowCount: number
  sampleRows: number
  columns: string[]
  mapping: MappingJson
  profile: ProfileRef | null
  suggestedName: string
  avefiSchemaVersion: string | null
  targets: EditorTarget[]
  transforms: TransformOpMeta[]
  suggestions: Record<string, Array<{ target: string; score: number }>>
  hints: Record<string, Array<{ target: string; count: number }>>
  vocabulary: Record<string, string[]>
  values: Record<string, Array<{ value: string; count: number }>>
  foreign: ForeignProfile[]
  columnReport: ColumnReport | null
  issues: ValidationIssue[]
}

export interface CellOutput {
  target: string
  label: string
  value: string
  ids?: Array<{ id: string; note: string; origin: string }>
}

export interface PreviewExample {
  row: number
  raw: string
  count: number
  /** Der Wert nach der gemeinsamen Kette — die Zwischenstufe der Herkunft. */
  pre: string
  outputs: CellOutput[]
  errors: MappingMessage[]
}

export interface PreviewColumn {
  examples: PreviewExample[]
  /** n von of betrachteten Zeilen gefuellt; total ist die Zeilenzahl der Datei. */
  filled: { n: number; of: number; total: number }
}

export type ColumnState = 'mapped' | 'ignored' | 'untouched'

export interface PreviewPayload {
  columns: Record<string, PreviewColumn>
  canonical: Record<string, unknown> | null
  schema: Array<{ message: string; rows: number }>
  evaluatedRows: number
  checks: MappingCheck[]
  coverage: Record<string, { filled: number; total: number }>
  targetUse: Record<string, Array<{ column: string; source: 'column' | 'default' }>>
  states: Record<string, ColumnState>
  complete: boolean
  open: string[]
  blocking: boolean
}

export interface SaveResponse {
  started: boolean
  profile: ProfileRef
  checks: MappingCheck[]
  complete: boolean
  open: string[]
}

export interface SchemaCheckResponse {
  checked: number
  valid: number
  issues: ValidationIssue[]
  unavailable: string | null
}

export interface AuthorityCandidate {
  source: string
  id: string
  label: string
  description?: string
  agentType?: string
  resourceType?: string
  uri?: string
  exact: boolean
}

export interface CandidateResponse {
  value: string
  kind: string
  candidates: AuthorityCandidate[]
  warnings: string[]
}

/** Offene Normdaten-Zuordnung, wie der Dialog sie braucht. */
export interface AuthorityRequest {
  column: string
  value: string
  source: string
  kind: string
}

/** Ein Wert des Normdaten-Wertevorrats samt Stand seiner Zuordnung. */
export interface AuthorityValue {
  value: string
  count: number
  state: 'offen' | 'bestaetigt' | 'verworfen'
  id?: string
  label?: string
}

/** Alle Werte eines Zweigs, zu denen Normdaten gesucht werden. */
export interface AuthorityGroup {
  column: string
  /** Index des Zweigs, -1 fuer die gemeinsame Kette vor der Verzweigung. */
  branch: number
  target: string
  source: string
  kind: string
  values: AuthorityValue[]
}

export interface AuthorityValuesResponse {
  profile?: { id: number; name: string }
  groups: AuthorityGroup[]
  open: number
}
