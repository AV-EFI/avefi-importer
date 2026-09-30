/*
 * Transform — Verzeichnis der Konverter-Operationen einer Mappingkette.
 *
 * Jeder Schritt ist ein Objekt mit "op" plus Parametern:
 *   {op:"trim"}  {op:"split", sep:";"}  {op:"map", map:{…}}
 * Bewusst kein nackter String als Kurzform — sobald eine Operation einen
 * Parameter braucht, gaebe es zwei Formen fuer dieselbe Sache.
 *
 * Typen fuer die statische Kettenpruefung: "text" (Einzelwert), "list",
 * "number", "any". Jede Operation sagt, was sie hereinnimmt und was sie
 * herausgibt; damit laesst sich der Ausgabetyp einer Kette ohne Ausfuehrung
 * bestimmen.
 *
 * Dieses Verzeichnis ist die einzige Umsetzung. Die Vorschau im Editor ruft es
 * ueber denselben Weg auf wie die Konvertierung — sonst liefen Vorschau und
 * Ergebnis auseinander.
 *
 * Anreichern ist keine Umwandlung: Der authority-Konverter aendert den Wert
 * nicht, sondern meldet den Treffer ueber den Nebenkanal "enrich". Der Builder
 * haengt ihn als same_as an die erzeugte Entitaet. Vorher wurde der Name mit der
 * ID ueberschrieben — bei einem Regie-Feld stand dann die GND-Nummer im Namen.
 */

import type { TransformOp, TransformStep } from '#shared/types/domain'
import { meldung } from './meldungen.js'
import type { MappingMessage } from '#shared/types/domain'
import type { SourceRow } from './header.js'
import type { SchemaModel } from './schema-model.js'

/* ------------------------------------------------------------------ Typen */

/** Wert, der durch eine Kette laeuft. Listen entstehen durch split. */
export type TransformValue = string | number | Array<string | number>

/** Typ fuer die statische Kettenpruefung. */
export type ChainType = 'text' | 'list' | 'number' | 'any'

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
  in: ChainType
  /** "same" heisst: der Typ bleibt, wie er hereinkam. */
  out: ChainType | 'same'
  params: TransformParamSpec[]
  /** Braucht einen Nachschlagedienst und gehoert nicht in enge Schleifen. */
  slow?: boolean
  /** Aus dem PHP-Stand uebernommen, im Editor nicht mehr angeboten. */
  legacy?: boolean
  /** Womit die Operation ersetzt wurde. */
  replacedBy?: string
  /**
   * Empfohlene Stelle in der Kette (siehe OP_PHASE). Wird mitgeschickt, damit
   * der Editor neue Konverter an der richtigen Stelle einfuegt, ohne die
   * Reihenfolgetabelle ein zweites Mal zu fuehren.
   */
  phase?: number
}

/** Normdaten-Treffer, der neben dem Wert herlaeuft. */
export interface EnrichHit {
  /** Der Quellwert, zu dem der Treffer gehoert — der Wert selbst bleibt unveraendert. */
  value: string
  /** category-Wert des Resource-Typs, z. B. "avefi:GNDResource". */
  category: string
  id: string
  /** Resource-Typ, z. B. "GNDResource". */
  resource: string
  note?: string
  /**
   * Woher der Treffer stammt. "land" ist dabei kein Nachschlagevorgang: Die
   * GND-Nummer eines Staates steht in der mitgelieferten Laendertabelle und
   * kommt auch dann mit, wenn kein authority-Schritt in der Kette steht. Ohne
   * diese Unterscheidung sieht im Editor jede ID gleich aus — und wer den
   * Konverter "Normdaten nachschlagen" entfernt, glaubt, das habe nicht
   * gewirkt, weil beim Land weiter eine Nummer steht.
   */
  origin?: 'bestaetigt' | 'automatisch' | 'land'
}

export interface AuthorityHit {
  id: string
  label?: string
  note?: string
}

export interface CountryHit {
  name: string
  gnd: string
  code?: string
}

/** Bestaetigte Zuordnung aus dem Profil (ColumnMapping.authorities). */
export interface ConfirmedAuthority {
  id: string
  /** Resource-Typ ("GNDResource") oder Quellschluessel ("gnd"). */
  type: string
  label?: string
}

/**
 * Umgebung einer Kette. Alles Nachschlagen wird hereingereicht, damit die
 * Mappinglogik ohne Netz und ohne Datenbank laeuft und pruefbar bleibt.
 *
 * resolveAuthority ist bewusst synchron: Es ist ein Griff in einen bereits
 * gefuellten Zwischenspeicher. Wer echte Abfragen braucht, sammelt die
 * benoetigten Werte vorher ein (siehe collectAuthorityLookups im Runner) und
 * loest sie ausserhalb auf.
 */
export interface TransformContext {
  /** Die ganze Quellzeile — nur concat braucht sie. */
  row?: SourceRow
  /**
   * Bestaetigte Normdaten der Spalte, Schluessel ist compareForm(Quellwert).
   * Je Wert koennen mehrere Zuordnungen stehen — eine je Normdatenquelle. Die
   * Einzelform bleibt zulaessig, damit aeltere Profile weiter greifen.
   */
  confirmed?: Record<string, ConfirmedAuthority | ConfirmedAuthority[] | undefined>
  resolveAuthority?: (value: string, source: string, kind: string) => AuthorityHit | null
  lookupCountry?: (value: string) => CountryHit | null
  lookupLanguage?: (value: string) => string | null
  schema?: SchemaModel
}

export interface TransformResult {
  value: TransformValue
  /** Werte, die der Fallback "als Notiz behalten" gerettet hat. */
  notes: string[]
  errors: MappingMessage[]
  enrich: EnrichHit[]
}

/* ------------------------------------------------------------- Verzeichnis */

/**
 * Aeltere Profile kennen andere Namen. Beim Einlesen werden sie umgeschrieben,
 * zur Laufzeit zusaetzlich toleriert.
 */
export const OP_ALIASES: Record<string, TransformOp> = {
  ucfirst: 'titlecase',
  valuemap: 'map'
}

const P = (
  name: string,
  label: string,
  type: TransformParamSpec['type'],
  extra: Partial<TransformParamSpec> = {}
): TransformParamSpec => ({ name, label, type, ...extra })

/** Alle Operationen mit Beschreibung fuer Editor und Pruefung. */
export const TRANSFORM_CATALOG: Record<string, TransformOpMeta> = {
  /* --- Text --- */
  trim: {
    op: 'trim', label: 'Leerraum entfernen', group: 'Text', in: 'any', out: 'same',
    params: [P('chars', 'Zusaetzliche Zeichen', 'text', { optional: true })]
  },
  lowercase: { op: 'lowercase', label: 'Kleinschreibung', group: 'Text', in: 'any', out: 'same', params: [] },
  uppercase: { op: 'uppercase', label: 'GROSSSCHREIBUNG', group: 'Text', in: 'any', out: 'same', params: [] },
  titlecase: {
    op: 'titlecase', label: 'Anfangsbuchstaben gross', group: 'Text', in: 'any', out: 'same',
    params: [P('words', 'Jedes Wort', 'bool', { optional: true })]
  },
  replace: {
    op: 'replace', label: 'Ersetzen', group: 'Text', in: 'any', out: 'same',
    params: [
      P('search', 'Suchen', 'text'),
      P('with', 'Ersetzen durch', 'text', { optional: true })
    ]
  },
  regex: {
    op: 'regex', label: 'Regulaerer Ausdruck', group: 'Text', in: 'any', out: 'same',
    params: [
      P('pattern', 'Muster', 'text'),
      P('with', 'Ersetzen durch', 'text', { optional: true }),
      P('capture', 'Nur diese Gruppe uebernehmen', 'int', { optional: true }),
      P('flags', 'Zusatzangaben (i, g)', 'text', { optional: true })
    ]
  },
  only: {
    op: 'only', label: 'Nur wenn', group: 'Text', in: 'any', out: 'same',
    params: [
      P('pattern', 'Muster', 'text'),
      P('negate', 'Umkehren: nur wenn das Muster NICHT passt', 'bool', { optional: true }),
      P('capture', 'Nur diese Gruppe uebernehmen', 'int', { optional: true }),
      P('flags', 'Zusatzangaben (i)', 'text', { optional: true })
    ]
  },
  prefix: {
    op: 'prefix', label: 'Davorsetzen', group: 'Text', in: 'any', out: 'same',
    params: [P('value', 'Text', 'text')]
  },
  suffix: {
    op: 'suffix', label: 'Anhaengen', group: 'Text', in: 'any', out: 'same',
    params: [P('value', 'Text', 'text')]
  },
  default: {
    op: 'default', label: 'Standardwert bei leer', group: 'Text', in: 'any', out: 'same',
    params: [P('value', 'Wert', 'text')]
  },

  /* --- Struktur --- */
  split: {
    op: 'split', label: 'Aufteilen', group: 'Struktur', in: 'text', out: 'list',
    params: [
      P('sep', 'Trennzeichen', 'text'),
      P('unique', 'Doppelte entfernen', 'bool', { optional: true })
    ]
  },
  join: {
    op: 'join', label: 'Zusammenfuegen', group: 'Struktur', in: 'list', out: 'text',
    params: [P('sep', 'Trennzeichen', 'text', { optional: true })]
  },
  take: {
    op: 'take', label: 'Element auswaehlen', group: 'Struktur', in: 'list', out: 'text',
    params: [P('index', 'Position (1 = erstes, -1 = letztes)', 'int')]
  },

  /* --- Typen --- */
  number: {
    op: 'number', label: 'Zahl', group: 'Typen', in: 'text', out: 'number',
    params: [P('decimal', 'Dezimalzeichen', 'text', { optional: true })]
  },
  boolean: {
    op: 'boolean', label: 'Ja/Nein', group: 'Typen', in: 'text', out: 'text',
    params: [
      P('whenTrue', 'Ausgabe bei Ja', 'text', { optional: true }),
      P('whenFalse', 'Ausgabe bei Nein', 'text', { optional: true })
    ]
  },
  date: {
    op: 'date', label: 'Datum nach ISO', group: 'Typen', in: 'text', out: 'text',
    params: [P('from', 'Quellformat (z. B. d.m.Y)', 'text', { optional: true })]
  },
  duration: {
    op: 'duration', label: 'Laufzeit nach ISO 8601', group: 'Typen', in: 'text', out: 'text',
    params: [P('unit', 'Einheit der Quelle', 'choice', {
      choices: { minutes: 'Minuten', seconds: 'Sekunden', hours: 'Stunden', auto: 'erkennen' }
    })]
  },
  country: {
    op: 'country', label: 'Land normalisieren', group: 'Typen', in: 'any', out: 'same',
    params: [P('unknown', 'Unbekannte Angabe', 'choice', {
      choices: { keep: 'unveraendert uebernehmen', drop: 'verwerfen', error: 'beanstanden' }
    })]
  },
  language: {
    op: 'language', label: 'Sprache nach ISO 639-2', group: 'Typen', in: 'any', out: 'same',
    params: [P('unknown', 'Unbekannte Angabe', 'choice', {
      choices: { keep: 'unveraendert uebernehmen', drop: 'verwerfen', error: 'beanstanden' }
    })]
  },

  /* --- Vokabular und Normdaten --- */
  map: {
    op: 'map', label: 'Werteliste zuordnen', group: 'Vokabular', in: 'any', out: 'same',
    params: [
      P('map', 'Zuordnung', 'map'),
      P('ci', 'Gross/Klein egal', 'bool', { optional: true }),
      P('fallback', 'Unbekannter Wert', 'choice', {
        choices: {
          keep_note: 'als Notiz behalten', drop: 'verwerfen',
          keep: 'unveraendert uebernehmen', error: 'beanstanden'
        }
      })
    ]
  },
  authority: {
    op: 'authority', label: 'Normdaten nachschlagen', group: 'Vokabular', in: 'any', out: 'same', slow: true,
    params: [
      P('source', 'Quelle', 'choice', { choices: { gnd: 'GND', wikidata: 'Wikidata', viaf: 'VIAF' } }),
      P('kind', 'Art', 'choice', {
        choices: { person: 'Person', corporate: 'Koerperschaft', place: 'Ort', subject: 'Schlagwort' }
      })
    ]
  },

  /*
   * Seit dem 30.09.2026 wieder im Katalog. Er galt als Altlast ohne Nachfolger,
   * aber genau ihn braucht eine Tabelle, die Artikel und Titel in zwei Spalten
   * fuehrt (Sabrina Klewitz, Test 3: „Kinder des Olymp" | „Die"). An die
   * Artikelspalte das Ziel Haupttitel und „Spalten verbinden" mit der
   * Titelspalte; bei leerem Artikel bleibt der Titel allein.
   */
  concat: {
    op: 'concat', label: 'Spalten verbinden', group: 'Struktur', in: 'any', out: 'text',
    params: [P('columns', 'Weitere Spalten', 'columns'), P('sep', 'Trennzeichen', 'text', { optional: true })]
  },

  /* --- Nur noch fuer alte Profile --- */
  substring: {
    op: 'substring', label: 'Ausschnitt', group: 'Text', in: 'any', out: 'same', legacy: true,
    params: [P('start', 'Ab Position', 'int'), P('length', 'Laenge', 'int', { optional: true })]
  },
  template: {
    op: 'template', label: 'In Muster einsetzen', group: 'Text', in: 'any', out: 'same',
    legacy: true, replacedBy: 'prefix/suffix',
    params: [P('pattern', 'Muster (mit {value})', 'text')]
  },
  year: {
    op: 'year', label: 'Jahreszahl herausloesen', group: 'Typen', in: 'text', out: 'text',
    legacy: true, replacedBy: 'regex',
    params: []
  },
}

/** Operationen fuer die Auswahl im Editor — ohne die Altlasten. */
export function transformCatalogForEditor(): TransformOpMeta[] {
  return Object.values(TRANSFORM_CATALOG)
    .filter((m) => m.legacy !== true)
    .map((m) => ({ ...m, phase: phaseOf(m.op) }))
}

/** Loest Aliasnamen auf und liefert den heute gueltigen Operationsnamen. */
export function canonicalOp(op: string): string {
  return OP_ALIASES[op] ?? op
}

export function transformExists(op: string): boolean {
  return canonicalOp(op) in TRANSFORM_CATALOG
}

export function transformMeta(op: string): TransformOpMeta | undefined {
  return TRANSFORM_CATALOG[canonicalOp(op)]
}

export function typeLabel(t: ChainType): string {
  switch (t) {
    case 'list': return 'eine Liste'
    case 'number': return 'eine Zahl'
    case 'text': return 'einen Einzelwert'
    default: return 'beliebiges'
  }
}

/* -------------------------------------------------- Statische Kettenpruefung */

export interface ChainTypeResult {
  type: ChainType
  errors: MappingMessage[]
}

/** Ausgabetyp einer Kette, ohne sie auszufuehren. */
export function chainType(chain: readonly TransformStep[], inputType: ChainType = 'text'): ChainTypeResult {
  let t: ChainType = inputType
  const errors: MappingMessage[] = []

  chain.forEach((step, i) => {
    const op = typeof step?.op === 'string' ? step.op : ''
    const meta = transformMeta(op)
    if (meta === undefined) {
      errors.push(meldung('transform.unknownOp', { schritt: i + 1, op }))
      return
    }
    // Eine Zahl darf ueberall dort stehen, wo ein Einzelwert erwartet wird.
    if (meta.in !== 'any' && meta.in !== t && !(meta.in === 'text' && t === 'number')) {
      errors.push(meldung('transform.typeMismatch', { schritt: i + 1, label: meta.label, erwartet: typeLabel(meta.in), bekommen: typeLabel(t) }))
    }
    // negate und capture zusammen sind widerspruechlich: Was nicht passt, hat
    // keine Klammergruppe, die sich herausloesen liesse.
    if (canonicalOp(op) === 'only' && step['negate'] === true
      && step['capture'] !== undefined && step['capture'] !== null && step['capture'] !== '') {
      errors.push(meldung('transform.onlyNegateCapture', { schritt: i + 1 }))
    }
    if (meta.out !== 'same') t = meta.out
  })

  return { type: t, errors }
}

/* ------------------------------------------------------------ Ausfuehrung */

/** Vergleichsform eines Wertes: Kleinschreibung, Mehrfach-Leerraum zusammengezogen. */
export function compareForm(s: string): string {
  return s.replace(/\s+/gu, ' ').trim().toLowerCase()
}

/** Quellschluessel einer Normdatenquelle auf den Resource-Typ des Schemas. */
const RESOURCE_BY_SOURCE: Record<string, string> = {
  gnd: 'GNDResource',
  wikidata: 'WikidataResource',
  viaf: 'VIAFResource',
  filmportal: 'FilmportalResource',
  eidr: 'EIDRResource'
}

/* ------------------------------------------------------ Reihenfolge der Kette */

/**
 * Die empfohlene Stelle jedes Konverters in der Kette.
 *
 * Rohwert → Normalisierung → Aufteilen → Normdaten und Vokabular → Formgebung.
 * Die Reihenfolge wird NICHT erzwungen: Die Kette ist das, was laeuft, und der
 * Editor zeigt sie so, wie sie laeuft. Wuerde die Ausfuehrung intern
 * umsortieren, sähe der Nutzer eine andere Reihenfolge als die gerechnete —
 * genau die Fehlerklasse, die zwischen Vorschau und Export schon einmal Zeit
 * gekostet hat. Vorgeschlagen und gewarnt wird trotzdem, denn die haeufigste
 * stille Fehlbedienung ist eine Normdatenabfrage auf dem Rohwert.
 */
export const OP_PHASE: Readonly<Record<string, number>> = {
  trim: 1, lowercase: 1, uppercase: 1, titlecase: 1, replace: 1, regex: 1, only: 1,
  substring: 1, number: 1, boolean: 1, year: 1, date: 1, duration: 1,
  split: 2,
  country: 3, language: 3, map: 3, authority: 3,
  take: 4, join: 4, prefix: 4, suffix: 4, template: 4, concat: 4, default: 4
}

export function phaseOf(op: string): number {
  return OP_PHASE[canonicalOp(op)] ?? 4
}

export interface ChainOrderIssue {
  /** Index des Schritts, der zu frueh steht. */
  at: number
  op: string
  /** Der Schritt, hinter den er gehoert. */
  after: string
}

/**
 * Nachschlagende Schritte, die vor dem stehen, was ihren Suchwert erst bildet.
 *
 * Beanstandet wird bewusst NUR dieser eine Fall: ein Nachschlagen (Normdaten,
 * Laender, Sprachen, Werteliste) und danach noch eine Normalisierung oder ein
 * Aufteilen. Dann sucht der Konverter den unbearbeiteten Wert, waehrend die
 * Kette am Ende einen anderen liefert — das Ergebnis sieht aus wie "nichts
 * gefunden", die harmloseste aller Fehlermeldungen.
 *
 * Umgekehrt ist "Leerraum entfernen" NACH "Aufteilen" voellig richtig: Der
 * Konverter wirkt dann auf jedes Element. Eine Regel, die einfach eine feste
 * Reihenfolge einfordert, wuerde genau das beanstanden und den Nutzer zu einer
 * schlechteren Kette drängen.
 */
export function chainOrderIssues(chain: readonly TransformStep[]): ChainOrderIssue[] {
  const out: ChainOrderIssue[] = []
  let nachschlagen = ''
  chain.forEach((step, at) => {
    if (typeof step !== 'object' || step === null) return
    const op = canonicalOp(String(step.op))
    const phase = phaseOf(op)
    if (phase === 3 && nachschlagen === '') nachschlagen = op
    else if (phase < 3 && nachschlagen !== '') out.push({ at, op, after: nachschlagen })
  })
  return out
}

export function resourceTypeForSource(source: string): string | null {
  return RESOURCE_BY_SOURCE[source.toLowerCase()] ?? null
}

/**
 * Die zu einer Quelle passende bestaetigte Zuordnung.
 *
 * Ein Eintrag ohne erkennbaren Typ stammt aus der Zeit vor der Quellzuordnung
 * und gilt fuer die Quelle, mit der er entstanden ist: GND. Sonst waere er fuer
 * jede Quelle zustaendig und wir haetten den alten Fehler zurueck.
 */
export function pickConfirmed(
  entry: ConfirmedAuthority | readonly ConfirmedAuthority[] | undefined,
  source: string
): ConfirmedAuthority | undefined {
  if (entry === undefined) return undefined
  const list = Array.isArray(entry) ? entry : [entry as ConfirmedAuthority]
  const wanted = resourceTypeForSource(source)
  for (const c of list) {
    const t = c.type.endsWith('Resource') ? c.type : resourceTypeForSource(c.type) ?? 'GNDResource'
    if (t === wanted) return c
  }
  return undefined
}

/** Operationen, die eine Liste elementweise bearbeiten. */
const ELEMENTWISE = new Set([
  'trim', 'lowercase', 'uppercase', 'titlecase', 'replace', 'regex', 'prefix', 'suffix',
  'only',
  'substring', 'template', 'number', 'year', 'date', 'duration', 'map', 'authority',
  'country', 'language', 'boolean'
])

function str(v: unknown): string {
  return v === null || v === undefined ? '' : String(v)
}

function param(step: TransformStep, name: string): unknown {
  return (step as Record<string, unknown>)[name]
}

function paramStr(step: TransformStep, name: string, fallback = ''): string {
  const v = param(step, name)
  return v === undefined || v === null ? fallback : String(v)
}

function paramInt(step: TransformStep, name: string, fallback: number): number {
  const v = param(step, name)
  if (v === undefined || v === null || v === '') return fallback
  const n = Number.parseInt(String(v), 10)
  return Number.isFinite(n) ? n : fallback
}

function paramBool(step: TransformStep, name: string): boolean {
  const v = param(step, name)
  return v === true || v === 1 || v === '1' || v === 'true'
}

/** Fuehrt eine ganze Kette aus. */
export function runChain(
  chain: readonly TransformStep[],
  value: TransformValue,
  ctx: TransformContext = {}
): TransformResult {
  const notes: string[] = []
  const errors: MappingMessage[] = []
  const enrich: EnrichHit[] = []
  let current: TransformValue = value

  for (const step of chain) {
    if (typeof step !== 'object' || step === null) continue
    const op = canonicalOp(typeof step.op === 'string' ? step.op : '')
    if (!(op in TRANSFORM_CATALOG)) {
      errors.push(meldung('transform.unknownOpPlain', { op: String(step.op) }))
      continue
    }
    try {
      current = apply(op, step, current, ctx, notes, errors, enrich)
    } catch (e) {
      errors.push(meldung('transform.opFailed', { op, detail: e instanceof Error ? e.message : String(e) }))
    }
  }

  return { value: current, notes, errors, enrich }
}

function apply(
  op: string,
  p: TransformStep,
  value: TransformValue,
  ctx: TransformContext,
  notes: string[],
  errors: MappingMessage[],
  enrich: EnrichHit[]
): TransformValue {
  // Listen elementweise behandeln, wo es sinnvoll ist. Leere Ergebnisse fallen weg.
  if (Array.isArray(value) && ELEMENTWISE.has(op)) {
    const out: Array<string | number> = []
    for (const v of value) {
      const r = apply(op, p, v, ctx, notes, errors, enrich)
      if (r === null || r === undefined || r === '') continue
      if (Array.isArray(r)) out.push(...r)
      else out.push(r)
    }
    return out
  }

  switch (op) {
    case 'trim': {
      const chars = paramStr(p, 'chars')
      const s = str(value)
      if (chars === '') return s.trim()
      const set = ' \t\n\r\0' + chars
      let a = 0
      let b = s.length
      while (a < b && set.includes(s.charAt(a))) a++
      while (b > a && set.includes(s.charAt(b - 1))) b--
      return s.slice(a, b)
    }

    case 'lowercase':
      return str(value).toLowerCase()

    case 'uppercase':
      return str(value).toUpperCase()

    case 'titlecase': {
      const s = str(value)
      if (s === '') return s
      if (paramBool(p, 'words')) {
        return s.replace(/(^|[\s\-–—'’(\[/])(\p{L})/gu, (_m, sep: string, ch: string) => sep + ch.toUpperCase())
      }
      return s.charAt(0).toUpperCase() + s.slice(1)
    }

    case 'replace': {
      const search = paramStr(p, 'search')
      if (search === '') return value
      return str(value).split(search).join(paramStr(p, 'with'))
    }

    case 'regex': {
      const pattern = paramStr(p, 'pattern')
      if (pattern === '') return value
      const rawFlags = paramStr(p, 'flags')
      const flags = 'u' + (rawFlags.includes('i') ? 'i' : '') + (rawFlags.includes('g') ? 'g' : '')
      let re: RegExp
      try {
        re = new RegExp(pattern, flags)
      } catch {
        errors.push(meldung('transform.badRegex', { muster: pattern }))
        return value
      }
      const s = str(value)
      const capture = param(p, 'capture')
      if (capture !== undefined && capture !== null && capture !== '') {
        // Herausloesen statt ersetzen — Nachfolger der alten Operation "year".
        const m = s.match(new RegExp(pattern, flags.replace('g', '')))
        if (m === null) {
          if (s.trim() !== '') errors.push(meldung('transform.noMatch', { wert: s, muster: pattern }))
          return ''
        }
        return m[paramInt(p, 'capture', 0)] ?? ''
      }
      return s.replace(re, paramStr(p, 'with'))
    }

    /*
     * Der Waechter: laesst den Wert durch oder macht ihn leer.
     *
     * Damit laesst sich eine Spalte auf zwei Ziele verzweigen, von denen je
     * Zeile nur eines etwas bekommt — der Fall "Titel in eckigen Klammern ist
     * ein Archivtitel, alle anderen sind Haupttitel". Ohne diesen Schritt
     * bekaemen beide Ziele denselben Wert, und auf einem einwertigen Platz
     * wuerde einer der beiden still verworfen.
     *
     * Ein nicht passender Wert wird bewusst NICHT beanstandet. In einem
     * Zweigpaar passt eine Seite naturgemaess nie, das gaebe je Zeile eine
     * korrekte und nutzlose Meldung. Sichtbar wird die Aufteilung stattdessen
     * als Bilanz im Pruefbericht: wie viele Zeilen welchen Zweig genommen
     * haben und wie viele durch alle gefallen sind.
     */
    case 'only': {
      const pattern = paramStr(p, 'pattern')
      if (pattern === '') return value
      const rawFlags = paramStr(p, 'flags')
      // Kein g: Hier wird geprueft, nicht ersetzt. Ein globales Muster traegt
      // ausserdem lastIndex mit sich herum und liefert beim zweiten Aufruf ein
      // anderes Ergebnis als beim ersten.
      const flags = 'u' + (rawFlags.includes('i') ? 'i' : '')
      let re: RegExp
      try {
        re = new RegExp(pattern, flags)
      } catch {
        errors.push(meldung('transform.badRegex', { muster: pattern }))
        return value
      }
      const s = str(value)
      // Ein leerer Wert bleibt leer, egal wie das Muster lautet. Sonst zoege
      // ein umgekehrter Waechter jede leere Zelle in seinen Zweig.
      if (s.trim() === '') return s
      const treffer = s.match(re)
      if (paramBool(p, 'negate')) return treffer === null ? s : ''
      if (treffer === null) return ''
      const capture = param(p, 'capture')
      if (capture !== undefined && capture !== null && capture !== '') {
        return treffer[paramInt(p, 'capture', 0)] ?? ''
      }
      return s
    }

    case 'prefix': {
      const s = str(value)
      return s.trim() === '' ? s : paramStr(p, 'value') + s
    }

    case 'suffix': {
      const s = str(value)
      return s.trim() === '' ? s : s + paramStr(p, 'value')
    }

    case 'substring': {
      const s = str(value)
      const start = paramInt(p, 'start', 0)
      const lenRaw = param(p, 'length')
      const from = start < 0 ? Math.max(0, s.length + start) : start
      if (lenRaw === undefined || lenRaw === null || lenRaw === '') return s.slice(from)
      const len = paramInt(p, 'length', 0)
      return len < 0 ? s.slice(from, s.length + len) : s.slice(from, from + len)
    }

    case 'default': {
      const empty = Array.isArray(value) ? value.length === 0 : str(value).trim() === ''
      return empty ? paramStr(p, 'value') : value
    }

    case 'template': {
      const pattern = paramStr(p, 'pattern')
      const s = str(value)
      if (pattern === '' || s.trim() === '') return value
      return pattern.split('{value}').join(s)
    }

    case 'split': {
      const sep = paramStr(p, 'sep', ';')
      const s = str(value)
      if (sep === '') return [s]
      const parts = s.split(sep).map((x) => x.trim()).filter((x) => x !== '')
      return paramBool(p, 'unique') ? [...new Set(parts)] : parts
    }

    case 'join': {
      const sep = paramStr(p, 'sep', '; ')
      return Array.isArray(value) ? value.map((v) => str(v)).join(sep) : str(value)
    }

    case 'take': {
      if (!Array.isArray(value)) return value
      const i = paramInt(p, 'index', 1)
      if (i > 0) return value[i - 1] ?? ''
      if (i < 0) return value[value.length + i] ?? ''
      return value[0] ?? ''
    }

    case 'concat': {
      const cols = Array.isArray(param(p, 'columns')) ? (param(p, 'columns') as unknown[]) : []
      const sep = paramStr(p, 'sep', ' ')
      const row = ctx.row ?? {}
      const parts: string[] = []
      const first = Array.isArray(value) ? value.map((v) => str(v)).join(' ') : str(value)
      if (first.trim() !== '') parts.push(first.trim())
      for (const c of cols) {
        const v = str(row[String(c)]).trim()
        if (v !== '') parts.push(v)
      }
      return parts.join(sep)
    }

    case 'number': {
      const raw = str(value)
      const dec = paramStr(p, 'decimal', ',')
      const keep = new Set(['-', ...dec.split(''), '0', '1', '2', '3', '4', '5', '6', '7', '8', '9'])
      let s = raw.split('').filter((c) => keep.has(c)).join('')
      if (dec !== '.') s = s.split(dec).join('.')
      const n = Number(s)
      if (s === '' || !Number.isFinite(n)) {
        if (raw.trim() !== '') errors.push(meldung('transform.notANumber', { wert: raw }))
        return ''
      }
      return n
    }

    case 'boolean': {
      const raw = str(value).trim()
      if (raw === '') return ''
      const key = raw.toLowerCase()
      const yes = ['ja', 'j', 'yes', 'y', 'true', 'wahr', '1', 'x', '✓', 'vorhanden']
      const no = ['nein', 'n', 'no', 'false', 'falsch', '0', '-', 'keine', 'nicht vorhanden']
      if (yes.includes(key)) return paramStr(p, 'whenTrue', 'true')
      if (no.includes(key)) return paramStr(p, 'whenFalse', 'false')
      errors.push(meldung('transform.notABoolean', { wert: raw }))
      return ''
    }

    case 'year': {
      const s = str(value)
      const m = s.match(/(\d{4})/)
      if (m !== null) return m[1] ?? ''
      if (s.trim() !== '') errors.push(meldung('transform.noYear', { wert: s }))
      return ''
    }

    case 'date':
      return toIsoDate(str(value), paramStr(p, 'from'), errors)

    case 'duration':
      return toIsoDuration(str(value), paramStr(p, 'unit', 'auto'), errors)

    case 'country': {
      // "DE", "DEU", "D", "BRD" und "Deutschland" ergeben denselben Namen; die
      // GND-ID des Landes wandert ueber den Anreicherungskanal mit.
      const raw = str(value)
      const hit = ctx.lookupCountry?.(raw) ?? null
      if (hit === null) return unknownValue(raw, paramStr(p, 'unknown', 'keep'), 'transform.unknownCountry', errors)
      if (hit.gnd !== '') {
        enrich.push({
          value: hit.name,
          category: ctx.schema?.resourceCategory('GNDResource') ?? 'avefi:GNDResource',
          id: hit.gnd,
          resource: 'GNDResource',
          origin: 'land'
        })
      }
      return hit.name
    }

    case 'language': {
      const raw = str(value)
      const code = ctx.lookupLanguage?.(raw) ?? builtinLanguageCode(raw)
      if (code === null) return unknownValue(raw, paramStr(p, 'unknown', 'keep'), 'transform.unknownLanguage', errors)
      return code
    }

    case 'map':
      return valuemap(str(value), p, notes, errors)

    case 'authority': {
      // Reichert an, statt zu ersetzen: Der Name bleibt der Wert, die gefundene
      // ID wird ueber den Nebenkanal gemeldet und vom Builder als same_as an die
      // erzeugte Entitaet gehaengt.
      const raw = str(value)
      if (raw.trim() === '') return value
      const source = paramStr(p, 'source', 'gnd')
      const kind = paramStr(p, 'kind', 'person')

      // Vom Menschen bestaetigte Zuordnung schlaegt die Automatik — aber nur die
      // zu DIESER Quelle. Frueher lag je Wert genau ein Eintrag ohne Quellbezug:
      // Ein zweiter Normdatenkonverter im selben Zweig bekam den Treffer des
      // ersten zurueck, und der Builder entdoppelte ihn weg.
      const confirmed = pickConfirmed(ctx.confirmed?.[compareForm(raw)], source)
      if (confirmed !== undefined) {
        if (confirmed.id === '') return value // bewusst offen gelassen
        const resType = confirmed.type.endsWith('Resource')
          ? confirmed.type
          : resourceTypeForSource(confirmed.type) ?? resourceTypeForSource(source)
        if (resType !== null) {
          enrich.push({
            value: raw,
            category: ctx.schema?.resourceCategory(resType) ?? `avefi:${resType}`,
            id: confirmed.id,
            resource: resType,
            note: confirmed.label ?? '',
            origin: 'bestaetigt'
          })
        }
        return value
      }

      const hit = ctx.resolveAuthority?.(raw, source, kind) ?? null
      if (hit !== null && hit.id !== '') {
        const resType = resourceTypeForSource(source)
        if (resType !== null) {
          const label = hit.label ?? ''
          const note = hit.note ?? ''
          enrich.push({
            value: raw,
            category: ctx.schema?.resourceCategory(resType) ?? `avefi:${resType}`,
            id: hit.id,
            resource: resType,
            note: (label + (note !== '' ? ` · ${note}` : '')).trim(),
            origin: 'automatisch'
          })
        }
      }
      return value
    }
  }
  return value
}

/** Gemeinsame Behandlung nicht aufgeloester Vokabularwerte. */
function unknownValue(raw: string, mode: string, code: string, errors: MappingMessage[]): string {
  switch (mode) {
    case 'drop':
      return ''
    case 'error':
      errors.push(meldung(code, { wert: raw }))
      return ''
    default:
      return raw
  }
}

/* ------------------------------------------------- Einzelne Umwandlungen */

/** Format-Buchstaben, wie sie schon in den Altprofilen stehen (PHP-Schreibweise). */
const DATE_TOKENS: Record<string, string> = {
  d: '(\\d{2})', j: '(\\d{1,2})',
  m: '(\\d{2})', n: '(\\d{1,2})',
  Y: '(\\d{4})', y: '(\\d{2})'
}

/** Datum nach einem vorgegebenen Quellformat lesen. */
function parseWithFormat(v: string, format: string): string | null {
  const order: string[] = []
  let pattern = '^'
  for (const ch of format) {
    const token = DATE_TOKENS[ch]
    if (token !== undefined) {
      order.push(ch)
      pattern += token
    } else {
      pattern += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    }
  }
  pattern += '$'

  const m = v.match(new RegExp(pattern))
  if (m === null) return null

  let year = 0
  let month = 1
  let day = 1
  order.forEach((ch, i) => {
    const n = Number.parseInt(m[i + 1] ?? '', 10)
    if (!Number.isFinite(n)) return
    if (ch === 'Y') year = n
    else if (ch === 'y') year = n < 70 ? 2000 + n : 1900 + n
    else if (ch === 'm' || ch === 'n') month = n
    else if (ch === 'd' || ch === 'j') day = n
  })
  if (year === 0 || month < 1 || month > 12 || day < 1 || day > 31) return null
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/** Datum nach ISO (JJJJ, JJJJ-MM oder JJJJ-MM-TT) — das ist zugleich EDTF-konform. */
export function toIsoDate(input: string, from: string, errors: MappingMessage[]): string {
  const v = input.trim()
  if (v === '') return ''

  if (from !== '') {
    const parsed = parseWithFormat(v, from)
    if (parsed !== null) return parsed
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v
  if (/^\d{4}-\d{2}$/.test(v)) return v
  if (/^\d{4}$/.test(v)) return v

  let m = v.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/)
  if (m !== null) return `${m[3]}-${(m[2] ?? '').padStart(2, '0')}-${(m[1] ?? '').padStart(2, '0')}`

  m = v.match(/^(\d{1,2})\.(\d{4})$/)
  if (m !== null) return `${m[2]}-${(m[1] ?? '').padStart(2, '0')}`

  m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (m !== null) return `${m[3]}-${(m[1] ?? '').padStart(2, '0')}-${(m[2] ?? '').padStart(2, '0')}`

  m = v.match(/(\d{4})/)
  if (m !== null) return m[1] ?? ''

  errors.push(meldung('transform.badDate', { wert: v }))
  return ''
}

/**
 * Laufzeit nach ISO 8601. Das AVefi-Schema verlangt genau PT[hh]H[mm]M[ss]S mit
 * mindestens zweistelligen Werten (Muster ^PT[1-9]*[0-9][0-9]H[0-5][0-9]M[0-5][0-9]S$);
 * einstellige Angaben sind nicht schemakonform.
 */
export function toIsoDuration(input: string, unit: string, errors: MappingMessage[]): string {
  const v = input.trim()
  if (v === '') return ''
  if (/^PT\d{2,}H[0-5]\dM[0-5]\dS$/.test(v)) return v // schon schemakonform

  // hh:mm:ss oder mm:ss
  let m = v.match(/^(\d{1,3}):(\d{1,2})(?::(\d{1,2}))?$/)
  if (m !== null) {
    const a = Number(m[1] ?? 0)
    const b = Number(m[2] ?? 0)
    const c = m[3]
    const sec = c !== undefined && c !== '' ? a * 3600 + b * 60 + Number(c) : a * 60 + b
    return secondsToIso(sec)
  }

  // Bereits ISO, aber mit einstelligen Werten — normalisieren.
  m = v.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/i)
  if (m !== null) {
    const sec = Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0)
    if (sec > 0) return secondsToIso(sec)
  }

  const num = v.replace(/[^\d,.]/g, '').replace(',', '.')
  const n = Number(num)
  if (num === '' || !Number.isFinite(n)) {
    errors.push(meldung('transform.badDuration', { wert: v }))
    return ''
  }
  switch (unit) {
    case 'seconds': return secondsToIso(Math.round(n))
    case 'hours': return secondsToIso(Math.round(n * 3600))
    // "auto": Minuten sind in Filmlisten der Normalfall.
    default: return secondsToIso(Math.round(n * 60))
  }
}

export function secondsToIso(sec: number): string {
  const s = sec < 0 ? 0 : Math.round(sec)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return `PT${String(h).padStart(2, '0')}H${String(m).padStart(2, '0')}M${String(s % 60).padStart(2, '0')}S`
}

function valuemap(v: string, p: TransformStep, notes: string[], errors: MappingMessage[]): string {
  const raw = param(p, 'map')
  const map: Record<string, unknown> =
    typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  const key = v.trim()
  if (key === '') return ''

  if (Object.prototype.hasOwnProperty.call(map, key)) return str(map[key])
  if (paramBool(p, 'ci')) {
    const lower = key.toLowerCase()
    for (const [k, val] of Object.entries(map)) {
      if (k.toLowerCase() === lower) return str(val)
    }
  }

  switch (paramStr(p, 'fallback', 'keep_note')) {
    case 'drop':
      return ''
    case 'keep':
      return v
    case 'error':
      errors.push(meldung('transform.notInValuemap', { wert: v }))
      return ''
    default:
      notes.push(v) // als Notiz erhalten statt wegwerfen
      return ''
  }
}

/**
 * Kleine Rueckfalltabelle fuer Sprachangaben nach ISO 639-2/B. Sie deckt ab, was
 * in deutschen Filmlisten vorkommt; alles weitere kommt ueber ctx.lookupLanguage
 * aus der vollstaendigen Tabelle.
 */
const LANGUAGE_FALLBACK: Record<string, string> = {
  deutsch: 'ger', german: 'ger', de: 'ger', deu: 'ger', ger: 'ger',
  englisch: 'eng', english: 'eng', en: 'eng', eng: 'eng',
  franzoesisch: 'fre', französisch: 'fre', french: 'fre', fr: 'fre', fra: 'fre', fre: 'fre',
  italienisch: 'ita', italian: 'ita', it: 'ita', ita: 'ita',
  spanisch: 'spa', spanish: 'spa', es: 'spa', spa: 'spa',
  russisch: 'rus', russian: 'rus', ru: 'rus', rus: 'rus',
  polnisch: 'pol', polish: 'pol', pl: 'pol', pol: 'pol',
  niederlaendisch: 'dut', niederländisch: 'dut', dutch: 'dut', nl: 'dut', nld: 'dut', dut: 'dut',
  tschechisch: 'cze', czech: 'cze', cs: 'cze', ces: 'cze', cze: 'cze',
  daenisch: 'dan', dänisch: 'dan', danish: 'dan', da: 'dan', dan: 'dan',
  schwedisch: 'swe', swedish: 'swe', sv: 'swe', swe: 'swe',
  tuerkisch: 'tur', türkisch: 'tur', turkish: 'tur', tr: 'tur', tur: 'tur',
  ungarisch: 'hun', hungarian: 'hun', hu: 'hun', hun: 'hun',
  latein: 'lat', lateinisch: 'lat', latin: 'lat', la: 'lat', lat: 'lat',
  japanisch: 'jpn', japanese: 'jpn', ja: 'jpn', jpn: 'jpn',
  stumm: 'zxx', ohne: 'zxx', 'ohne sprache': 'zxx', keine: 'zxx', zxx: 'zxx'
}

export function builtinLanguageCode(value: string): string | null {
  const key = compareForm(value)
  return LANGUAGE_FALLBACK[key] ?? null
}
