/*
 * MappingRunner — fuehrt ein Mappingprofil auf Quellzeilen aus.
 *
 * Je Zeile: Spalte -> Vorkette -> Ziel(e) mit Nachkette -> Builder -> kanonischer
 * AVefi-Datensatz. Dazu Festwerte und die Werkbildung ueber einen konfigurierten
 * Schluessel.
 *
 * Derselbe Code bedient die Vorschau im Editor und die Konvertierung. Eine zweite
 * Umsetzung im Browser waere schneller, wuerde aber bedeuten, dass Vorschau und
 * Ergebnis auseinanderlaufen koennen.
 *
 * Die Pruefung ist zweistufig:
 *   statisch  beim Bauen des Profils, ohne Daten — Ausgabetyp der Kette gegen die
 *             Erwartung des Ziels, mit Vorschlag zum Nachbessern.
 *   zur Laufzeit gegen Enum, Muster und Kardinalitaet.
 * Beanstandet wird warnend. Blockiert wird nur, was strukturell nicht geht: eine
 * Liste in einem einwertigen Ziel ohne "Element auswaehlen" oder "Zusammenfuegen".
 */

import { createHash } from 'node:crypto'
import type {
  AvefiValue, ColumnMapping, MappingJson, MappingMessage, TransformStep, ValidationIssue
} from '#shared/types/domain'
import { meldung, meldungstext } from './meldungen.js'
import type { SourceRow } from './header.js'
import type { SchemaModel } from './schema-model.js'
import type { AuthorityHit, CountryHit, EnrichHit, TransformContext, TransformValue } from './transform.js'
import type { AvefiNode, AvefiRecord } from './builder.js'
import type { TargetDefinition } from './targets.js'
import { getSchemaModel } from './schema-model.js'
import {
  canonicalOp, chainOrderIssues, chainType, compareForm, resourceTypeForSource, runChain
} from './transform.js'
import { AvefiBuilder, acceptsAuthority } from './builder.js'
import { authorityKindLabel, expectedAuthorityKinds, expectedChainType, getTarget, targetExists } from './targets.js'
import { PFLICHTFELDER } from './pflichtfelder.js'

/**
 * Beanstandung des Mappings. Erweitert ValidationIssue um den Vorschlag zum
 * Nachbessern; ein solches Feld gibt es in shared/types/domain.ts bisher nicht
 * (siehe Bericht).
 */
/**
 * Ein Teil eines mehrteiligen Vorschlags.
 *
 * `fix` traegt genau einen Schritt fuer genau eine Kette. Das reicht, solange
 * ein Vorschlag eine Kette ergaenzt. Es reicht nicht, sobald er eine Spalte
 * auf zwei Ziele verzweigen muss — dann sind zwei Ketten zu aendern, und eine
 * davon gibt es noch gar nicht.
 */
export interface MappingFixPart {
  /** Ziel, das die Schritte bekommt. Fehlt die Bindung, wird sie angelegt. */
  target: string
  /** Schritte fuer die Nachkette dieses Ziels. */
  post?: TransformStep[]
  /** Gesetzt, wenn dieses Ziel ein bestehendes ersetzt statt danebenzutreten. */
  replaces?: string
}

export interface MappingCheck extends ValidationIssue {
  /** Konverterschritt, der die Beanstandung ausraeumen wuerde. */
  fix?: TransformStep
  /** Mehrteiliger Vorschlag; schliesst sich mit fix gegenseitig aus. */
  fixPlan?: MappingFixPart[]
  /** Uebersetzungsschluessel fuer die Knopfbeschriftung eines fixPlan. */
  fixLabel?: string
}

/** Nachschlagedienste, die von aussen hereingereicht werden. */
export interface MappingServices {
  schema?: SchemaModel
  /**
   * Synchroner Griff in einen bereits gefuellten Zwischenspeicher. Echte
   * Abfragen laufen ausserhalb; welche Werte dafuer gebraucht werden, sagt
   * collectAuthorityLookups().
   */
  resolveAuthority?: (value: string, source: string, kind: string) => AuthorityHit | null
  lookupCountry?: (value: string) => CountryHit | null
  lookupLanguage?: (value: string) => string | null
}

/* -------------------------------------------------------- Zugriff aufs Profil */

function columnsOf(mapping: MappingJson): Array<[string, ColumnMapping]> {
  const cols = mapping.columns
  if (typeof cols !== 'object' || cols === null) return []
  return Object.entries(cols).filter((e): e is [string, ColumnMapping] => typeof e[1] === 'object' && e[1] !== null)
}

function chainOf(spec: ColumnMapping): TransformStep[] {
  return Array.isArray(spec.pre) ? spec.pre : []
}

function firstStep(chain: readonly TransformStep[], op: string): TransformStep | undefined {
  return chain.find((s) => typeof s === 'object' && s !== null && canonicalOp(String(s.op)) === op)
}

function chainHas(chain: readonly TransformStep[], op: string): boolean {
  return firstStep(chain, op) !== undefined
}

/** Hat eine Werteliste mindestens einen ausgefuellten Zielwert? */
function valuemapFilled(step: TransformStep): boolean {
  const raw = (step as Record<string, unknown>)['map']
  if (typeof raw !== 'object' || raw === null) return false
  return Object.values(raw as Record<string, unknown>).some((v) => String(v ?? '').trim() !== '')
}

/* ------------------------------------------------------- Statische Pruefung */

/**
 * Prueft das Profil ohne Daten: unbekannte Ziele, Typkonflikte, Kardinalitaet,
 * fehlende Pflichtangaben. severity "error" blockiert das Speichern,
 * "warning" nicht.
 */
export function staticCheck(mapping: MappingJson, schema: SchemaModel = getSchemaModel()): MappingCheck[] {
  const out: MappingCheck[] = []

  /*
   * Auf welchen Ebenen ein Titel ankommt, der `has_primary_title` fuellt.
   *
   * Bis zum 10.09.2026 stand hier ein Flag, das nur bei `work.title.primary`
   * gesetzt wurde. Zwei Fehler steckten darin.
   *
   * Der erste: `work.title.supplied` ("Archivtitel") fuellt dasselbe Feld —
   * targets.ts gibt beiden `primary: true`. Wer nur den Archivtitel mappte,
   * bekam trotzdem die Meldung, es fehle ein Haupttitel.
   *
   * Der zweite wog schwerer und wurde von Luca Wollny am 10.09. gefunden: Fehlt
   * der Titel auf ALLEN Ebenen, war die Meldung trotzdem nur eine Warnung, mit
   * dem Hinweis, ersatzweise werde der Titel der Manifestation oder des
   * Exemplars uebernommen. Genau das kann dann aber nicht passieren — es gibt
   * keinen. Das Ergebnis war ein Datensatz ohne jeden Titel, und weil das
   * AVefi-Schema `has_primary_title` am WorkVariant nicht verlangt, ging er
   * ohne Beanstandung durch die Pruefung.
   *
   * Deshalb wird jetzt je Ebene gezaehlt: Am Werk ist alles gut, auf einer
   * anderen Ebene greift die Uebernahme (Warnung), nirgends ist ein Fehler.
   */
  const titelEbenen = new Set<string>()
  const zugeordnet: TargetDefinition[] = []
  const merkeZiel = (key: string): void => {
    const t = getTarget(key)
    if (t === undefined) return
    zugeordnet.push(t)
    if (t.writer.kind === 'title' && t.writer.primary) titelEbenen.add(t.level)
  }

  for (const [col, spec] of columnsOf(mapping)) {
    if (spec.ignore === true) continue
    const pre = chainOf(spec)

    for (const binding of spec.targets ?? []) {
      const key = String(binding.target ?? '')
      const target = getTarget(key)
      if (target === undefined) {
        out.push({
          severity: 'error', code: 'target.unknown', sourceField: col,
          message: `Unbekanntes Ziel "${key}"`
        })
        continue
      }
      merkeZiel(key)

      const post = Array.isArray(binding.post) ? binding.post : []
      const chain = [...pre, ...post]
      const result = chainType(chain, 'text')

      for (const e of result.errors) {
        out.push({
          severity: 'warning', code: e.code, sourceField: col, targetField: key,
          message: meldungstext(e), ...(e.params !== undefined ? { params: e.params } : {})
        })
      }

      const want = expectedChainType(target)

      // Das einzig strukturell Unmoegliche: eine Liste in einem einwertigen Ziel.
      if (result.type === 'list' && !target.multi) {
        out.push({
          severity: 'error', code: 'chain.list-in-single', sourceField: col, targetField: key,
          message: `"${target.label}" nimmt nur einen Wert auf, die Kette liefert aber eine Liste. `
            + 'Ergaenze "Element auswaehlen" oder "Zusammenfuegen".',
          fix: { op: 'take', index: 1 }
        })
        continue
      }
      if (want === 'number' && result.type !== 'number') {
        out.push({
          severity: 'warning', code: 'chain.number', sourceField: col, targetField: key,
          message: `"${target.label}" erwartet eine Zahl.`,
          fix: { op: 'number' }
        })
      }
      if (target.type === 'duration' && !chainHas(chain, 'duration')) {
        out.push({
          severity: 'warning', code: 'chain.duration', sourceField: col, targetField: key,
          message: `"${target.label}" erwartet das ISO-Format PT01H30M00S. Konverter "duration" einfuegen?`,
          fix: { op: 'duration', unit: 'minutes' }
        })
      }
      if (target.type === 'date' && !chainHas(chain, 'date') && !chainHas(chain, 'year')) {
        out.push({
          severity: 'warning', code: 'chain.date', sourceField: col, targetField: key,
          message: `"${target.label}" erwartet ein Datum im ISO-Format. Konverter "date" einfuegen?`,
          fix: { op: 'date' }
        })
      }
      if (target.type === 'lang' && !chainHas(chain, 'language')) {
        out.push({
          severity: 'warning', code: 'chain.language', sourceField: col, targetField: key,
          message: `"${target.label}" erwartet einen ISO-639-2-Code. Konverter "language" einfuegen?`,
          fix: { op: 'language', unknown: 'keep' }
        })
      }
      // Steht ein Schritt vor etwas, das eigentlich vor ihm kaeme? Erzwungen
      // wird nichts — die Kette bleibt das, was laeuft. Aber die haeufigste
      // stille Fehlbedienung ist eine Normdatenabfrage auf dem Rohwert.
      for (const o of chainOrderIssues(chain)) {
        const m = meldung('chain.order', { nachschlag: opLabel(o.after), davor: opLabel(o.op) })
        out.push({
          severity: 'warning', code: m.code, sourceField: col, targetField: key,
          message: meldungstext(m), ...(m.params !== undefined ? { params: m.params } : {})
        })
      }

      // Passt die gesuchte Art zum Ziel? Und wird dieselbe Quelle doppelt
      // befragt? Beides fiel bisher niemandem auf, weil der Fehler wie
      // "nichts gefunden" aussieht — die harmloseste aller Meldungen.
      const wanted = expectedAuthorityKinds(target.writer)
      const seenSources = new Set<string>()
      for (const step of chain) {
        if (typeof step !== 'object' || step === null) continue
        if (canonicalOp(String(step.op)) !== 'authority') continue
        const p = step as Record<string, unknown>
        const source = String(p['source'] ?? 'gnd')
        const kind = String(p['kind'] ?? 'person')
        if (wanted !== null && !wanted.includes(kind)) {
          out.push({
            severity: 'warning', code: 'authority.kind-mismatch', sourceField: col, targetField: key,
            message: `"${target.label}" nimmt ${wanted.map(authorityKindLabel).join(' oder ')} auf, `
              + `gesucht wird aber nach ${authorityKindLabel(kind)}. So findet die Abfrage nichts.`,
            fix: { op: 'authority', source, kind: wanted[0] ?? kind }
          })
        }
        if (seenSources.has(source)) {
          out.push({
            severity: 'warning', code: 'authority.duplicate-source', sourceField: col, targetField: key,
            message: `Dieselbe Normdatenquelle (${source.toUpperCase()}) wird in diesem Zweig zweimal `
              + 'befragt. Die zweite Abfrage liefert dasselbe Ergebnis.'
          })
        }
        seenSources.add(source)
      }

      if (chainHas(chain, 'authority') && !acceptsAuthority(target)) {
        out.push({
          severity: 'warning', code: 'authority.unsupported', sourceField: col, targetField: key,
          message: `"Normdaten nachschlagen" wirkt bei "${target.label}" nicht — gefundene IDs lassen sich `
            + 'nur an Personen, Schlagwoertern, Orten, Genres und Kennungs-Zielen hinterlegen.'
        })
      }
      if (target.type.startsWith('enum:')) {
        const vm = firstStep(chain, 'map')
        if (vm === undefined) {
          const values = schema.enum(target.type.slice(5))
          out.push({
            severity: 'warning', code: 'enum.no-valuemap', sourceField: col, targetField: key,
            message: `"${target.label}" hat eine feste Werteliste — ohne Zuordnung werden abweichende `
              + 'Schreibweisen beanstandet.',
            fix: values.length > 0 ? { op: 'map', map: {}, fallback: 'keep_note' } : { op: 'map', map: {} }
          })
        } else if (!valuemapFilled(vm)) {
          // Die Warnung verschwand im PHP-Stand, sobald die Zuordnung EXISTIERTE.
          // Eine leere Zuordnung liefert aber "kein Wert" — Datenverlust hinter
          // einer gruenen Anzeige.
          out.push({
            severity: 'warning', code: 'enum.empty-valuemap', sourceField: col, targetField: key,
            message: `Die Werteliste fuer "${target.label}" ist noch leer. Solange kein Zielwert eingetragen `
              + 'ist, kommt fuer diese Spalte nichts an.'
          })
        }
      }
    }
  }

  for (const d of mapping.defaults ?? []) {
    const key = String(d.target ?? '')
    merkeZiel(key)
    if (!targetExists(key)) {
      out.push({
        severity: 'error', code: 'default.unknown-target',
        message: `Festwert zeigt auf ein unbekanntes Ziel "${key}"`
      })
    }
  }

  /*
   * Pflichtangaben des Schemas: kommt ueberhaupt ein Ziel an, das sie fuellt?
   *
   * Welche Felder das sind, sagt PFLICHTFELDER — dieselbe Liste, aus der
   * completeness.ts den Hinweis am fertigen Datensatz zieht. Bis zum
   * 18.09.2026 stand hier nur der Titel, von Hand; die Werkart fehlte, obwohl
   * das Schema sie verlangt und die Plakette ihr Fehlen laengst rot faerbte.
   *
   * Wie schwer die Meldung wiegt, sagt das Feld selbst. Ein Fehler blockiert
   * das Speichern nicht, wohl aber das Konvertieren (siehe
   * ERST_BEIM_KONVERTIEREN): Es ist keine falsche Angabe, sondern eine
   * fehlende, und wer eine Zuordnung von oben nach unten aufbaut, hat
   * zwischendurch immer eine offen. Verhindert werden muss nur, dass mit einer
   * solchen Zuordnung konvertiert wird.
   */
  for (const feld of PFLICHTFELDER) {
    if (zugeordnet.some((t) => feld.trifftZiel(t))) continue
    out.push({
      severity: feld.schwere, source: 'schema', code: feld.codeOhneZuordnung,
      targetField: feld.schemaPfad, message: feld.meldungOhneZuordnung
    })
  }

  /*
   * Zusatz, den nur der Titel kennt: gemappt, aber nicht am Werk. Dann greift
   * die Uebernahme von der Manifestation oder vom Exemplar, der Datensatz
   * bekommt also einen Titel — nur nicht den, den jemand ausgesucht hat.
   * Warnung, kein Fehler.
   */
  if (titelEbenen.size > 0 && !titelEbenen.has('work')) {
    out.push({
      severity: 'warning', source: 'schema', code: 'work.no-title',
      targetField: 'WorkVariant.has_primary_title.has_name',
      message: 'Keine Spalte auf "Werk > Haupttitel" gemappt. Ersatzweise wird der Titel der Manifestation '
        + 'oder des Exemplars uebernommen.'
    })
  }

  return out
}

/**
 * Konvertername fuer Meldungen, die nicht in der Oberflaeche entstehen.
 * Die uebersetzten Namen stehen in i18n; hier genuegt der Schluessel.
 */
function opLabel(op: string): string {
  return op
}

/*
 * Zwei Stufen von "Fehler".
 *
 * Die meisten Fehler sind Fehlgriffe: ein unbekanntes Ziel, ein Typkonflikt,
 * eine Kette, die nicht aufgeht. Sie zu speichern hat keinen Sinn, deshalb
 * blockieren sie das Speichern.
 *
 * Die fehlenden Pflichtangaben sind anders. Sie sind keine falsche Angabe,
 * sondern eine fehlende — wer eine Zuordnung von oben nach unten aufbaut, hat
 * irgendwann die Kennung und noch keinen Titel. Diesen Zwischenstand nicht
 * parken zu duerfen waere eine Strafe fuer die Reihenfolge der Arbeit.
 * Verhindert werden muss nur das eine: dass mit einer solchen Zuordnung
 * konvertiert wird.
 *
 * Die Menge kommt aus PFLICHTFELDER und nicht aus einer zweiten Aufzaehlung.
 * Sonst waere ein neues Pflichtfeld sofort ein Speicherblocker, ohne dass das
 * jemand entschieden haette.
 */
const ERST_BEIM_KONVERTIEREN: ReadonlySet<string> = new Set(
  PFLICHTFELDER.filter((p) => p.schwere === 'error').map((p) => p.codeOhneZuordnung)
)

/** Blockiert eine der Beanstandungen das Speichern? */
export function hasBlocker(checks: readonly MappingCheck[]): boolean {
  return checks.some((c) => c.severity === 'error' && !ERST_BEIM_KONVERTIEREN.has(c.code ?? ''))
}

/** Blockiert eine der Beanstandungen das Konvertieren? */
export function hasStartBlocker(checks: readonly MappingCheck[]): boolean {
  return checks.some((c) => c.severity === 'error')
}

/* ---------------------------------------------------------- Normdatenbedarf */

/**
 * Dienste, die schon beim Ermitteln des Bedarfs gebraucht werden.
 *
 * Ohne sie rechnet die Kette bis zum Normdatenschritt mit halber Kraft: Ein
 * vorgeschalteter "country"-Konverter liefert dann "DE" statt "Deutschland",
 * und genau dieser Wert wandert in den Zwischenspeicher — waehrend zur Laufzeit
 * "Deutschland" gefragt wird. Der Treffer geht ins Leere, ohne dass etwas
 * meldet. Landes- und Sprachtabelle sind ortsfest, kosten also nichts.
 */
export interface ChainLookupServices {
  lookupCountry?: TransformContext['lookupCountry']
  lookupLanguage?: TransformContext['lookupLanguage']
}

export interface AuthorityRequest {
  column: string
  source: string
  kind: string
  values: string[]
}

/**
 * Sammelt ein, welche Werte fuer den authority-Konverter nachgeschlagen werden
 * muessen. Der Aufrufer loest das ausserhalb auf — hier laeuft nichts uebers Netz.
 * Bereits bestaetigte Zuordnungen fallen heraus.
 */
export function collectAuthorityLookups(
  mapping: MappingJson,
  rows: readonly SourceRow[],
  services: ChainLookupServices = {}
): AuthorityRequest[] {
  const out: AuthorityRequest[] = []

  for (const [col, spec] of columnsOf(mapping)) {
    if (spec.ignore === true) continue
    const confirmed = normalizeConfirmed(spec)

    const chains: TransformStep[][] = []
    for (const binding of spec.targets ?? []) {
      chains.push([...chainOf(spec), ...(Array.isArray(binding.post) ? binding.post : [])])
    }

    for (const chain of chains) {
      // Jeder Normdatenschritt der Kette, nicht nur der erste: Wer GND und VIAF
      // in denselben Zweig haengt, bekam sonst fuer die zweite Quelle nie einen
      // Bedarf gemeldet — und damit nie einen Treffer.
      chain.forEach((step, at) => {
        if (typeof step !== 'object' || step === null) return
        if (canonicalOp(String(step.op)) !== 'authority') return
        const p = step as Record<string, unknown>
        const source = String(p['source'] ?? 'gnd')
        const kind = String(p['kind'] ?? 'person')

        // Die Kette bis zu diesem Schritt rechnen, damit auch getrimmte und
        // aufgeteilte Werte im Bedarf stehen, nicht nur die Rohzelle.
        const upto = chain.slice(0, at)
        const seen = new Set<string>()
        for (const row of rows) {
          const res = runChain(upto, String(row[col] ?? ''), { row, ...services })
          const values = Array.isArray(res.value) ? res.value : [res.value]
          for (const v of values) {
            const s = String(v).trim()
            if (s === '') continue
            const key = compareForm(s)
            if (seen.has(key) || isConfirmedFor(confirmed, key, source)) continue
            seen.add(key)
          }
        }
        if (seen.size > 0) out.push({ column: col, source, kind, values: [...seen] })
      })
    }
  }

  return out
}

type Confirmed = { id: string; type: string; label?: string }

/**
 * Bestaetigte Zuordnungen des Profils, je Quellwert eine Liste — eine
 * Zuordnung je Normdatenquelle. Der Typ wird auf den Ressourcentyp
 * aufgeloest ("gnd" -> "GNDResource"), damit die Auswahl spaeter ohne
 * Sonderfaelle vergleichen kann.
 */
/* ------------------------------------------------- Normdaten-Wertevorrat */

export interface AuthorityInventoryValue {
  value: string
  count: number
  state: 'offen' | 'bestaetigt' | 'verworfen'
  id?: string
  label?: string
}

export interface AuthorityInventoryEntry {
  column: string
  /** Index des Zweigs, -1 fuer die gemeinsame Kette vor der Verzweigung. */
  branch: number
  target: string
  source: string
  kind: string
  values: AuthorityInventoryValue[]
}

/**
 * Alle Werte, zu denen in diesem Profil Normdaten gesucht werden — mit
 * Haeufigkeit und aktuellem Stand der Zuordnung.
 *
 * Der Unterschied zu collectAuthorityLookups: Dort geht es um den Bedarf einer
 * Konvertierung, bereits Bestaetigtes faellt heraus und es zaehlt niemand. Hier
 * geht es um die Arbeitsliste eines Menschen, der entscheiden soll. Die drei
 * Beispielwerte der Vorschau reichten dafuer nicht: Ein Wert wie "USA", der
 * eine Entscheidung braucht, aber erst in Zeile 40 steht, war schlicht nicht
 * erreichbar.
 */
export function authorityInventory(
  mapping: MappingJson,
  rows: readonly SourceRow[],
  services: ChainLookupServices = {},
  limitPerBranch = 500
): AuthorityInventoryEntry[] {
  const out: AuthorityInventoryEntry[] = []

  for (const [col, spec] of columnsOf(mapping)) {
    if (spec.ignore === true) continue
    const confirmed = normalizeConfirmed(spec)
    const pre = chainOf(spec)

    ;(spec.targets ?? []).forEach((binding, bi) => {
      const chain = [...pre, ...(Array.isArray(binding.post) ? binding.post : [])]
      chain.forEach((step, at) => {
        if (typeof step !== 'object' || step === null) return
        if (canonicalOp(String(step.op)) !== 'authority') return
        const p = step as Record<string, unknown>
        const source = String(p['source'] ?? 'gnd')
        const kind = String(p['kind'] ?? 'person')
        const branch = at < pre.length ? -1 : bi

        // Ein Schritt in der gemeinsamen Kette gilt fuer alle Zweige — er darf
        // nicht je Zweig noch einmal in der Liste stehen.
        if (branch === -1 && out.some((e) => e.column === col && e.branch === -1 && e.source === source)) return

        const upto = chain.slice(0, at)
        const counts = new Map<string, number>()
        for (const row of rows) {
          const res = runChain(upto, String(row[col] ?? ''), { row, ...services })
          const values = Array.isArray(res.value) ? res.value : [res.value]
          for (const v of values) {
            const t = String(v).trim()
            if (t === '') continue
            const key = compareForm(t)
            const known = counts.get(t)
            if (known !== undefined) counts.set(t, known + 1)
            else if (counts.size < limitPerBranch || confirmed[key] !== undefined) counts.set(t, 1)
          }
        }
        if (counts.size === 0) return

        const wanted = resourceTypeForSource(source)
        const values: AuthorityInventoryValue[] = [...counts.entries()]
          .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'de'))
          .map(([value, count]) => {
            const hit = (confirmed[compareForm(value)] ?? []).find((c) => c.type === wanted)
            if (hit === undefined) return { value, count, state: 'offen' as const }
            return hit.id === ''
              ? { value, count, state: 'verworfen' as const }
              : { value, count, state: 'bestaetigt' as const, id: hit.id, ...(hit.label !== undefined ? { label: hit.label } : {}) }
          })

        out.push({ column: col, branch, target: String(binding.target ?? ''), source, kind, values })
      })
    })
  }

  return out
}

function normalizeConfirmed(spec: ColumnMapping): Record<string, Confirmed[]> {
  const out: Record<string, Confirmed[]> = {}
  const raw = spec.authorities
  if (typeof raw !== 'object' || raw === null) return out
  for (const [value, entry] of Object.entries(raw)) {
    const list = Array.isArray(entry) ? entry : [entry]
    for (const e of list) {
      if (typeof e !== 'object' || e === null) continue
      const declared = String((e as Confirmed).type ?? '')
      const type = declared.endsWith('Resource')
        ? declared
        : resourceTypeForSource(declared) ?? 'GNDResource'
      const label = (e as Confirmed).label
      const key = compareForm(value)
      const bucket = out[key] ?? []
      // Erste Zuordnung je Quelle gewinnt; doppelte Eintraege sind ein
      // Profilfehler, kein Grund zum Abbruch.
      if (!bucket.some((c) => c.type === type)) {
        bucket.push({ id: String((e as Confirmed).id ?? ''), type, ...(label !== undefined ? { label } : {}) })
      }
      out[key] = bucket
    }
  }
  return out
}

/** Ist dieser Wert fuer diese Quelle schon von Hand entschieden? */
function isConfirmedFor(confirmed: Record<string, Confirmed[]>, key: string, source: string): boolean {
  const wanted = resourceTypeForSource(source)
  return (confirmed[key] ?? []).some((c) => c.type === wanted)
}

/* ---------------------------------------------------------------- Ausfuehren */

export interface CellOutput {
  target: string
  label: string
  value: string
  ids?: Array<{ id: string; note: string; origin: string }>
}

export interface CellResult {
  raw: string
  /**
   * Der Wert nach der gemeinsamen Kette, vor der Verzweigung.
   *
   * Damit laesst sich zeigen, wie aus dem Originalwert der AVefi-Wert wurde:
   * "DE → Deutschland → Werk > Produktion > Ort". Ohne diese Zwischenstufe
   * sieht man nur Anfang und Ende und muss raten, welcher Konverter gewirkt hat.
   */
  pre: string
  outputs: CellOutput[]
  errors: MappingMessage[]
}

export interface RunRowResult {
  canonical: AvefiRecord
  cells: Record<string, CellResult>
  /** Alle Beanstandungen der Zeile, jeweils mit Spaltenbezug. */
  errors: string[]
  issues: MappingCheck[]
  idOrigins: { bestaetigt: number; automatisch: number }
}

/** Wendet das Profil auf eine Zeile an. */
export function runRow(
  mapping: MappingJson,
  row: SourceRow,
  baseId: string,
  services: MappingServices = {},
  rowNumber?: number
): RunRowResult {
  const schema = services.schema ?? getSchemaModel()
  const builder = new AvefiBuilder(schema)
  const cells: Record<string, CellResult> = {}
  const errors: string[] = []
  const issues: MappingCheck[] = []
  const idOrigins = { bestaetigt: 0, automatisch: 0 }

  for (const [col, spec] of columnsOf(mapping)) {
    if (spec.ignore === true) continue
    const targets = spec.targets ?? []
    if (targets.length === 0) continue

    const ctx: TransformContext = {
      row,
      confirmed: normalizeConfirmed(spec),
      schema,
      ...(services.resolveAuthority !== undefined ? { resolveAuthority: services.resolveAuthority } : {}),
      ...(services.lookupCountry !== undefined ? { lookupCountry: services.lookupCountry } : {}),
      ...(services.lookupLanguage !== undefined ? { lookupLanguage: services.lookupLanguage } : {})
    }

    const raw = String(row[col] ?? '')
    const pre = runChain(chainOf(spec), raw, ctx)
    const cellErrors: MappingMessage[] = [...pre.errors]
    const outputs: CellOutput[] = []

    for (const binding of targets) {
      const key = String(binding.target ?? '')
      const target = getTarget(key)
      if (target === undefined) {
        cellErrors.push(meldung('target.unknown', { ziel: key }))
        continue
      }

      const post = runChain(Array.isArray(binding.post) ? binding.post : [], pre.value, ctx)
      cellErrors.push(...post.errors)
      for (const n of post.notes) builder.addNote(col, n)

      // Normdaten-Treffer nach Quellwert buendeln: Der Wert bleibt der Name,
      // die ID haengt der Builder als same_as an die erzeugte Entitaet.
      const found = new Map<string, EnrichHit[]>()
      for (const e of [...pre.enrich, ...post.enrich]) {
        const list = found.get(e.value) ?? []
        list.push(e)
        found.set(e.value, list)
        if (e.origin === 'bestaetigt' || e.origin === 'automatisch') idOrigins[e.origin]++
      }

      let values = toValueList(post.value)
      if (!target.multi && values.length > 1) {
        // Kardinalitaet zur Laufzeit: warnen, nicht wegwerfen ohne Hinweis.
        issues.push({
          severity: 'warning', code: 'value.truncated', sourceField: col, targetField: key,
          message: `"${target.label}" nimmt nur einen Wert auf; ${values.length - 1} weitere Werte dieser `
            + 'Zelle bleiben unberuecksichtigt.',
          ...(rowNumber !== undefined ? { row: rowNumber } : {}),
          fix: { op: 'join', sep: '; ' }
        })
        values = values.slice(0, 1)
      }

      for (const v of values) {
        const hits = found.get(String(v)) ?? []
        const errs = builder.write(target, v, hits)
        cellErrors.push(...errs)
        for (const e of errs) {
          issues.push({
            severity: 'warning', code: e.code, sourceField: col, targetField: key,
            message: meldungstext(e), value: String(v).slice(0, 120),
            ...(e.params !== undefined ? { params: e.params } : {}),
            ...(rowNumber !== undefined ? { row: rowNumber } : {})
          })
        }
        if (errs.length === 0 && String(v).trim() !== '') {
          const out: CellOutput = { target: key, label: target.path, value: String(v) }
          if (hits.length > 0) {
            out.ids = hits.map((e) => ({ id: e.id, note: e.note ?? '', origin: e.origin ?? '' }))
          }
          outputs.push(out)
        }
      }
    }

    cells[col] = { raw, pre: toValueList(pre.value).map((v) => String(v)).join(' · '), outputs, errors: cellErrors }
    for (const e of cellErrors) errors.push(`${col}: ${meldungstext(e)}`)
  }

  // Festwerte zuletzt, damit sie nur fuellen, was die Quelle nicht liefert.
  for (const d of mapping.defaults ?? []) {
    const target = getTarget(String(d.target ?? ''))
    if (target === undefined) continue
    builder.write(target, String(d.value ?? ''))
  }

  const canonical = builder.build(baseId)
  // Was das Zusammenbauen selbst entschieden hat, gehoert in den Bericht.
  for (const h of builder.aufbauHinweise) {
    issues.push({
      severity: 'info', code: h.code, message: meldungstext(h),
      ...(h.params !== undefined ? { params: h.params } : {}),
      ...(rowNumber !== undefined ? { row: rowNumber } : {})
    })
  }

  return { canonical, cells, errors, issues, idOrigins }
}

function toValueList(value: TransformValue): Array<string | number> {
  return Array.isArray(value) ? value : [value]
}

/* ------------------------------------------------------------ Sammelbericht */

export interface RunTally {
  rows: number
  valueErrors: number
  /** Spalte -> Anzahl Beanstandungen samt bis zu fuenf verschiedenen Beispielen. */
  columnIssues: Record<string, { errors: number; samples: string[] }>
  idOrigins: { bestaetigt: number; automatisch: number }
}

export function newRunTally(): RunTally {
  return { rows: 0, valueErrors: 0, columnIssues: {}, idOrigins: { bestaetigt: 0, automatisch: 0 } }
}

/** Nimmt ein Zeilenergebnis in den Sammelbericht auf. Aendert den Bericht. */
export function addToTally(tally: RunTally, result: RunRowResult): RunTally {
  tally.rows++
  tally.idOrigins.bestaetigt += result.idOrigins.bestaetigt
  tally.idOrigins.automatisch += result.idOrigins.automatisch

  for (const [col, cell] of Object.entries(result.cells)) {
    if (cell.errors.length === 0) continue
    tally.valueErrors += cell.errors.length
    const bucket = tally.columnIssues[col] ?? { errors: 0, samples: [] }
    bucket.errors += cell.errors.length
    for (const e of cell.errors) {
      // Die Stichproben stehen im Pruefbericht, der auch ohne offene
      // Oberflaeche gelesen wird — deshalb hier der fertige Satz.
      const satz = meldungstext(e)
      if (bucket.samples.length < 5 && !bucket.samples.includes(satz)) bucket.samples.push(satz)
    }
    tally.columnIssues[col] = bucket
  }
  return tally
}

/* --------------------------------------------------------------- Werkbildung */

/** Ist eine Zusammenfassung von Zeilen zu Werken eingeschaltet? Standard: aus. */
export function groupsWorks(mapping: MappingJson): boolean {
  return (mapping.grouping?.work?.by ?? []).length > 0
}

/** Klartext der verwendeten Regel fuer den Pruefbericht. */
export function groupingLabel(mapping: MappingJson): string {
  const by = mapping.grouping?.work?.by ?? []
  if (by.length === 0) return 'keine Zusammenfassung — jede Zeile ein eigenes Werk'
  return by.map((raw) => {
    const k = String(raw)
    if (k.startsWith('column:')) return `Spalte "${k.slice(7)}"`
    if (k.startsWith('target:')) {
      const t = getTarget(k.slice(7))
      return t !== undefined ? t.label : k.slice(7)
    }
    return k
  }).join(' + ')
}

/**
 * Schluessel, unter dem eine Zeile zu einem Werk gehoert (null = kein Merge).
 * Bevorzugt auf gemappte Zielwerte statt Rohspalten: nach trim und lowercase
 * fallen "Die Wilden Kerle " und "die wilden kerle" zusammen, vorher nicht.
 * Gilt nur innerhalb eines Imports.
 */
export function workKey(mapping: MappingJson, row: SourceRow, canonical: AvefiRecord): string | null {
  const by = mapping.grouping?.work?.by ?? []
  if (by.length === 0) return null

  const parts: string[] = []
  for (const raw of by) {
    const k = String(raw)
    if (k.startsWith('column:')) {
      parts.push(String(row[k.slice(7)] ?? '').trim().toLowerCase())
    } else if (k.startsWith('target:')) {
      parts.push(readTarget(canonical, k.slice(7)).trim().toLowerCase())
    }
  }
  const joined = parts.join('')
  if (joined.replace(/[ ]/g, '') === '') return null
  return createHash('md5').update(joined).digest('hex')
}

function asNode(v: unknown): AvefiValue {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as AvefiValue) : {}
}

function asList(v: unknown): AvefiValue[] {
  return Array.isArray(v) ? (v as AvefiValue[]) : []
}

function text(v: unknown): string {
  return typeof v === 'string' || typeof v === 'number' ? String(v) : ''
}

/** Liest den ersten Wert eines Ziels aus einem kanonischen Datensatz. */
export function readTarget(canonical: AvefiRecord, key: string): string {
  const target: TargetDefinition | undefined = getTarget(key)
  if (target === undefined) return ''

  const node: AvefiValue = target.level === 'work'
    ? canonical.work
    : target.level === 'manifestation'
      ? asNode(canonical.manifestations[0])
      : asNode(canonical.items[0])

  const w = target.writer
  switch (w.kind) {
    case 'title':
      return text(asNode(node['has_primary_title'])['has_name'])
    case 'prop':
      return text(node[w.prop])
    case 'strlist': {
      const list = node[w.prop]
      return Array.isArray(list) ? text(list[0]) : ''
    }
    case 'named':
      return text(asNode(asList(node[w.prop])[0])['has_name'])
    case 'subject':
      return text(asNode(asList(node['has_subject'])[0])['has_name'])
    case 'duration':
      return text(asNode(node['has_duration'])['has_value'])
    case 'extent':
      return text(asNode(node['has_extent'])['has_value'])
    case 'identifier':
      return text(asNode(asList(node['has_identifier'])[0])['id'])
    case 'sameas':
      return text(asNode(asList(node['same_as'])[0])['id'])
    case 'eventdate': {
      for (const e of asList(node['has_event'])) {
        if (e['category'] === w.category) return text(e['has_date'])
      }
      return ''
    }
    case 'eventplace': {
      for (const e of asList(node['has_event'])) {
        if (e['category'] === w.category) return text(asNode(asList(e['located_in'])[0])['has_name'])
      }
      return ''
    }
    case 'activity': {
      for (const e of asList(node['has_event'])) {
        for (const a of asList(e['has_activity'])) {
          if (a['category'] === w.category) return text(asNode(asList(a['has_agent'])[0])['has_name'])
        }
      }
      return ''
    }
    case 'language':
      return text(asNode(asList(node['in_language'])[0])['code'])
  }
  return ''
}

/**
 * Ein Werksfeld, das beim Zusammenfassen einen Wert verloren hat.
 *
 * Nur einwertige Felder koennen das. Listen werden vereinigt — zwei Zeilen mit
 * verschiedenen Regisseurinnen ergeben ein Werk mit beiden, und das ist der
 * Sinn des Zusammenfassens.
 */
export interface MergeConflict {
  /** Schemafeld, etwa has_primary_title. */
  feld: string
  behalten: string
  verworfen: string
}

/** Beschriftungen der einwertigen Werksfelder, die realistisch kollidieren. */
const FELDNAMEN: Record<string, string> = {
  has_primary_title: 'Haupttitel',
  type: 'Werkart',
  variant_type: 'Variantentyp'
}

export function feldName(feld: string): string {
  return FELDNAMEN[feld] ?? feld
}

/** Lesbare Form eines Werts fuer die Meldung: bei Titeln der Name, sonst der Wert. */
function wertText(v: unknown): string {
  if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
    const name = (v as AvefiValue)['has_name']
    if (typeof name === 'string' && name.trim() !== '') return name
  }
  return String(v ?? '')
}

/**
 * Fuehrt zwei kanonische Datensaetze desselben Werks zusammen: Werkangaben werden
 * ergaenzt (nicht ueberschrieben), Manifestationen und Exemplare angehaengt.
 *
 * Widersprechen sich die beiden in einem einwertigen Werksfeld, gewinnt der
 * erste Wert — und der zweite steht in `conflicts`. Bis zum 08.09.2026
 * verschwand er kommentarlos; welcher Wert "der erste" ist, haengt an der
 * Zeilenreihenfolge in der Datei und damit an nichts, was der Bearbeiter
 * sehen kann (Elias Oltmanns im Telefonat, #16).
 */
export function mergeRecords(base: AvefiRecord, add: AvefiRecord): { record: AvefiRecord; conflicts: MergeConflict[] } {
  const conflicts: MergeConflict[] = []
  const work = mergeNode(base.work, add.work, conflicts)

  let workId: string | null = null
  for (const i of asList(work['has_identifier'])) {
    if (i['category'] === 'avefi:LocalResource') {
      workId = text(i['id'])
      break
    }
  }

  const manifestations = [...base.manifestations]
  for (const m of add.manifestations) {
    const copy: AvefiNode = { ...m }
    if (workId !== null) copy['is_manifestation_of'] = [{ category: 'avefi:LocalResource', id: workId }]
    manifestations.push(copy)
  }

  return { record: { work, manifestations, items: [...base.items, ...add.items] }, conflicts }
}

/**
 * Ergaenzt fehlende Felder; Listen werden vereinigt, Einwertiges nicht
 * ueberschrieben. Was dabei verdraengt wird, landet in `conflicts`.
 */
function mergeNode(a: AvefiNode, b: AvefiNode, conflicts?: MergeConflict[]): AvefiNode {
  const out: AvefiNode = { ...a }
  for (const [k, v] of Object.entries(b)) {
    if (!(k in out)) {
      out[k] = v
      continue
    }
    const mine = out[k]
    if (Array.isArray(mine) && Array.isArray(v)) {
      const merged = [...mine]
      for (const e of v) {
        if (!merged.some((x) => sameValue(x, e))) merged.push(e)
      }
      out[k] = merged
      continue
    }
    // Einwertig und verschieden: Der erste bleibt, der zweite geht verloren.
    if (conflicts !== undefined && !sameValue(mine, v)) {
      conflicts.push({ feld: k, behalten: wertText(mine), verworfen: wertText(v) })
    }
  }
  return out
}

/** Vergleicht zwei Listeneintraege dem Inhalt nach; PHPs in_array arbeitet ebenso. */
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  return JSON.stringify(a) === JSON.stringify(b)
}
