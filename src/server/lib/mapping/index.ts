/*
 * Oeffentliche Schnittstelle des Mappingkerns.
 *
 * Alles hier ist frei von Datenbank und HTTP. Profile werden als Objekte
 * hereingereicht, Nachschlagedienste (Normdaten, Laender, Sprachen) als
 * Funktionen. Damit laesst sich der ganze Kern ohne laufenden Server pruefen.
 *
 * Reihenfolge einer Verarbeitung:
 *   1. buildHeader()        Kopfzeile bereinigen, entdoppeln, Hash bilden
 *   2. normalizeMapping()   gespeichertes oder eingelesenes Profil auf den Stand bringen
 *   3. checkProfileColumns() Abgleich Profilspalten gegen die echte Kopfzeile
 *   4. staticCheck()        Profil ohne Daten pruefen
 *   5. buildPreview()       Beispiele suchen und rechnen
 *   6. runRow()             je Zeile ein kanonischer Datensatz
 *   7. workKey()/mergeRecords()  Werkbildung, wenn eingeschaltet
 */

/* ------------------------------------------------------------- Kopfzeile */
export {
  buildHeader,
  cleanHeader,
  dedupeColumns,
  diffColumns,
  headerHash,
  isEmptyRow,
  nameSimilarity,
  normalizeHeader,
  RENAME_THRESHOLD,
  rowsFromCells
} from './header.js'
export type { ColumnDiff, HeaderInfo, SourceRow } from './header.js'

/* ---------------------------------------------------------------- Schema */
export {
  createSchemaModel,
  EMPTY_SCHEMA_MODEL,
  getSchemaModel,
  setSchemaModel
} from './schema-model.js'
export type { SchemaModel } from './schema-model.js'

/* ------------------------------------------------------------ Konverter */
export {
  builtinLanguageCode,
  canonicalOp,
  chainType,
  compareForm,
  OP_ALIASES,
  resourceTypeForSource,
  runChain,
  secondsToIso,
  toIsoDate,
  toIsoDuration,
  TRANSFORM_CATALOG,
  transformCatalogForEditor,
  transformExists,
  transformMeta,
  typeLabel
} from './transform.js'
export type {
  AuthorityHit,
  ChainType,
  ChainTypeResult,
  ConfirmedAuthority,
  CountryHit,
  EnrichHit,
  TransformContext,
  TransformOpMeta,
  TransformParamSpec,
  TransformResult,
  TransformValue
} from './transform.js'

/* -------------------------------------------------------------- Ziele */
export {
  allTargets,
  expectedChainType,
  getTarget,
  levelLabel,
  targetExists,
  targetsForFrontend,
  validateTargetValue,
  writerAcceptsAuthority
} from './targets.js'
export type { TargetDefinition, TargetWriter } from './targets.js'

/* -------------------------------------------------------------- Builder */
export { acceptsAuthority, AvefiBuilder } from './builder.js'
export type { AvefiNode, AvefiRecord } from './builder.js'

/* --------------------------------------------------------------- Profil */
export {
  adoptMapping,
  buildProfileExport,
  checkProfileColumns,
  columnState,
  columnStates,
  computeComplete,
  emptyMapping,
  normalizeMapping,
  normalizeSample,
  openColumns,
  PROFILE_FORMAT_VERSION,
  readProfileExport,
  SAMPLE_ROW_LIMIT,
  suggestProfileName,
  targetHintsFromMappings
} from './profile.js'
export type {
  AdoptResult,
  ColumnState,
  ExportOptions,
  NormalizeResult,
  ProfileColumnReport,
  ReadExportResult
} from './profile.js'

/* --------------------------------------------------------------- Runner */
export {
  addToTally,
  authorityInventory,
  collectAuthorityLookups,
  groupingLabel,
  groupsWorks,
  hasBlocker,
  hasStartBlocker,
  mergeRecords,
  newRunTally,
  readTarget,
  runRow,
  staticCheck,
  workKey
} from './runner.js'
export type {
  AuthorityInventoryEntry,
  AuthorityInventoryValue,
  AuthorityRequest,
  CellOutput,
  CellResult,
  MappingCheck,
  MappingServices,
  RunRowResult,
  RunTally
} from './runner.js'

/* ------------------------------------------------------------- Vorschau */
export {
  buildPreview,
  buildProfileSample,
  dataChecks,
  EXAMPLES_PER_COLUMN,
  SAMPLE_DISTINCT_LIMIT,
  MAX_PREVIEW_ROWS,
  MAX_SCHEMA_ISSUES,
  pickExamples,
  previewChain,
  previewRowIndices,
  previewRows
} from './preview.js'
export type {
  ColumnExample,
  ColumnExamples,
  PreviewColumn,
  PreviewInput,
  PreviewOptions,
  PreviewResult
} from './preview.js'

/* ----------------------------------------------------------- Vorschlaege */
export {
  scoreToken,
  suggestForColumn,
  suggestForColumns,
  tokens,
  vocabularyCandidates
} from './suggest.js'
export type { TargetSuggestion } from './suggest.js'

/* ------------------------------------------------------- Vollstaendigkeit */
export {
  addToCoreTally,
  completeness,
  coreScore,
  completenessChecks,
  BERICHTSTEXT,
  completenessIssues,
  coreCoverage,
  CORE_FIELDS,
  corePresence,
  finishCoreTally,
  newCoreTally,
  coreState
} from './completeness.js'
export type { CoreFieldKey, CoreSummary, CoreTally } from './completeness.js'

/* ------------------------------------------------------------ Pflichtfelder */
export {
  PFLICHTFELDER,
  VOM_ERZEUGER_GESETZT,
  pflichtSchluessel,
  pflichtfeldZuHinweis
} from './pflichtfelder.js'
export type { Pflichtfeld, PflichtKlasse } from './pflichtfelder.js'
