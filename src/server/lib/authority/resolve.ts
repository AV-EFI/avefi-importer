/*
 * Vorab-Aufloesung der Normdaten.
 *
 * Der Mappingkern schlaegt nicht selbst nach. Er sagt ueber
 * collectAuthorityLookups(mapping, rows), welche Werte gebraucht werden, und
 * erwartet beim Ausfuehren einen synchronen Griff in einen bereits gefuellten
 * Zwischenspeicher (TransformContext.resolveAuthority). Diese Datei fuellt ihn.
 *
 * Ablauf:
 *   const bedarf  = collectAuthorityLookups(mapping, rows)
 *   const geloest = await resolveAuthorities(bedarf, { enabled, limit, cache })
 *   runRow(mapping, row, id, { schema, resolveAuthority: geloest.resolve, … })
 *
 * Zwei Regeln, die hier durchgesetzt werden:
 *
 * 1. Uebernommen wird nur bei Eindeutigkeit. Passt genau ein Name — natuerlich
 *    oder umgedreht — auf die Anfrage, gilt der Treffer. Passen mehrere, wird
 *    nichts eingetragen und die Kandidaten werden gemeldet. Kein Treffer ist
 *    besser als ein falscher.
 *
 * 2. Es wird nichts angereichert, was nicht angefordert wurde. Ohne
 *    enabled = true geht keine einzige Anfrage hinaus; die Anreicherung ist
 *    standardmaessig aus. Und mehr als AUTHORITY_LIMIT Werte je Import werden
 *    nicht nachgeschlagen, egal wie gross die Datei ist.
 */

import type { ValidationIssue } from '#shared/types/domain'
import type { AuthorityRequest } from '../mapping/runner.js'
import type { AuthorityHit } from '../mapping/transform.js'
import type { SchemaModel } from '../mapping/schema-model.js'
import type { AuthorityCandidate, AuthorityKind, AuthorityResolution, AuthoritySource } from './types.js'
import type { AuthorityCache } from './cache.js'
import type { FetchJson } from './http.js'
import { EMPTY_RESOLUTION, KIND_CLASS, RESOURCE_TYPE, isAuthorityKind, isAuthoritySource } from './types.js'
import { cacheKey, memoryAuthorityCache, noAuthorityCache } from './cache.js'
import { createFetchJson } from './http.js'
import { compareForm, nameMatches } from './names.js'
import { searchGnd } from './gnd.js'
import { searchWikidata } from './wikidata.js'
import { searchViaf } from './viaf.js'

/** Voreinstellung der Obergrenze, wenn AUTHORITY_LIMIT nicht gesetzt ist. */
export const DEFAULT_AUTHORITY_LIMIT = 500

/** Hoechstens so viele Kandidaten werden zu einem mehrdeutigen Namen gemerkt. */
export const MAX_CANDIDATES = 8

/** Damit ein Ausfall nicht tausend gleichlautende Meldungen erzeugt. */
export const MAX_NOTES = 20

/** Wartezeit zwischen zwei echten Anfragen — Hoeflichkeit gegenueber lobid & Co. */
export const DEFAULT_PAUSE_MS = 100

export interface AuthorityLookupOptions {
  /** Ohne true geht nichts uebers Netz. Voreinstellung: aus. */
  enabled?: boolean
  /** Obergrenze der Netzabfragen je Import. Voreinstellung: 500. */
  limit?: number
  cache?: AuthorityCache
  /** Zum Pruefen austauschbar; sonst createFetchJson(). */
  fetchJson?: FetchJson
  /**
   * Wenn gesetzt, wird gegen die same_as-Typen des Schemas geprueft: Was das
   * Schema an einer Klasse nicht zulaesst, wird nicht abgefragt. Ein leeres
   * Modell (noch kein Schema geladen) hebelt die Pruefung nicht aus — dann
   * gilt die Quelle als erlaubt.
   */
  schema?: SchemaModel
  pauseMs?: number
  signal?: AbortSignal
  onWarn?: (message: string) => void
}

export interface AuthorityStats {
  /** Verschiedene Werte, die aufzuloesen waren. */
  requested: number
  /** Davon aus dem Zwischenspeicher beantwortet. */
  fromCache: number
  /** Davon ueber das Netz abgefragt. */
  fetched: number
  /** Eindeutige Treffer mit ID. */
  resolved: number
  /** Mehrdeutig — bewusst ohne ID. */
  ambiguous: number
  /** Nichts gefunden. */
  misses: number
  /** Abfrage fehlgeschlagen (nicht zwischengespeichert). */
  failed: number
  /** Nicht abgefragt: Anreicherung aus, Obergrenze erreicht oder Schema verbietet es. */
  skipped: number
  limitReached: boolean
}

export interface ResolvedAuthorities {
  /** Schluessel -> Treffer. Nur eindeutige Treffer mit ID stehen darin. */
  hits: Map<string, AuthorityHit>
  /** Genau die Form, die TransformContext.resolveAuthority erwartet. */
  resolve: (value: string, source: string, kind: string) => AuthorityHit | null
  /** Die vollstaendige Aufloesung samt Kandidaten, fuer Bericht und Editor. */
  resolution: (value: string, source: string, kind: string) => AuthorityResolution | null
  stats: AuthorityStats
  /** Meldungen im Klartext, gedeckelt auf MAX_NOTES. */
  notes: string[]
  /** Dasselbe als strukturierte Beanstandungen fuer den Pruefbericht. */
  issues: ValidationIssue[]
}

export function authorityKey(source: string, kind: string, value: string): string {
  return cacheKey(source, kind, compareForm(value))
}

function emptyStats(): AuthorityStats {
  return {
    requested: 0, fromCache: 0, fetched: 0, resolved: 0,
    ambiguous: 0, misses: 0, failed: 0, skipped: 0, limitReached: false
  }
}

/** Obergrenze aus der Umgebung; unbrauchbare Angaben fallen auf 500 zurueck. */
export function authorityLimitFromEnv(env: Record<string, string | undefined> = process.env): number {
  const raw = env['AUTHORITY_LIMIT']
  if (raw === undefined || raw.trim() === '') return DEFAULT_AUTHORITY_LIMIT
  const n = Number.parseInt(raw, 10)
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_AUTHORITY_LIMIT
}

/** Anreicherung eingeschaltet? Standard ist aus. */
export function authorityEnabledFromEnv(env: Record<string, string | undefined> = process.env): boolean {
  const raw = (env['AUTHORITY_ENABLED'] ?? '').trim().toLowerCase()
  return raw === '1' || raw === 'true' || raw === 'ja' || raw === 'on'
}

function searchFor(
  source: AuthoritySource,
  q: string,
  kind: AuthorityKind,
  fetchJson: FetchJson
): Promise<AuthorityCandidate[]> {
  switch (source) {
    case 'gnd': return searchGnd(q, kind, fetchJson)
    case 'wikidata': return searchWikidata(q, kind, fetchJson)
    case 'viaf': return searchViaf(q, kind, fetchJson)
  }
}

/**
 * Erlaubt das Schema diese Quelle an dieser Art von Datensatz?
 * Ohne Schema oder mit leerem Schema: ja — die Pruefung soll nichts blockieren,
 * solange sie nichts weiss.
 */
export function sourceAllowed(source: AuthoritySource, kind: AuthorityKind, schema?: SchemaModel): boolean {
  if (schema === undefined) return true
  const allowed = schema.sameAsTypes(KIND_CLASS[kind])
  if (allowed.length === 0) return true
  return allowed.includes(RESOURCE_TYPE[source])
}

/**
 * Die Treffer, deren Name auf die Anfrage passt — natuerliche wie umgedrehte
 * Form. Doppelte IDs zaehlen einmal, sonst gilt derselbe Datensatz in zwei
 * Schreibweisen faelschlich als mehrdeutig.
 */
export function exactMatches(candidates: readonly AuthorityCandidate[], queryNorm: string): AuthorityCandidate[] {
  const out: AuthorityCandidate[] = []
  const seen = new Set<string>()
  for (const c of candidates) {
    if (seen.has(c.id)) continue
    if (!nameMatches(c.label, queryNorm)) continue
    seen.add(c.id)
    out.push(c)
  }
  return out
}

/** Aus den passenden Treffern eine Aufloesung machen. */
export function decide(matches: readonly AuthorityCandidate[]): AuthorityResolution {
  const first = matches[0]
  if (matches.length === 1 && first !== undefined) {
    return { id: first.id, label: first.label, note: first.description, ambiguous: false, candidates: [] }
  }
  if (matches.length > 1) {
    // Mehrdeutig: nichts uebernehmen, aber zeigen, was es gibt.
    return { id: '', label: '', note: '', ambiguous: true, candidates: matches.slice(0, MAX_CANDIDATES) }
  }
  return { ...EMPTY_RESOLUTION }
}

function sleep(ms: number): Promise<void> {
  return ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve()
}

/**
 * Loest den gesammelten Bedarf auf und liefert eine gefuellte Nachschlagetabelle.
 *
 * Es wird der Reihe nach abgefragt, nicht gleichzeitig: Ein Import ist ein
 * Hintergrundvorgang, und die Dienste gehoeren anderen.
 */
export async function resolveAuthorities(
  requests: readonly AuthorityRequest[],
  options: AuthorityLookupOptions = {}
): Promise<ResolvedAuthorities> {
  const enabled = options.enabled === true
  const limit = options.limit ?? DEFAULT_AUTHORITY_LIMIT
  const cache = options.cache ?? (enabled ? memoryAuthorityCache() : noAuthorityCache())
  const fetchJson = options.fetchJson ?? createFetchJson(
    options.signal !== undefined ? { signal: options.signal } : {}
  )
  const pauseMs = options.pauseMs ?? DEFAULT_PAUSE_MS

  const stats = emptyStats()
  const notes: string[] = []
  const issues: ValidationIssue[] = []
  const resolutions = new Map<string, AuthorityResolution>()
  const hits = new Map<string, AuthorityHit>()
  let suppressed = 0
  let fetched = 0
  /** Werte, die nur am ausgeschalteten Schalter scheiterten, je Spalte. */
  const abgeschaltet = new Map<string, number>()

  const note = (text: string, issue?: ValidationIssue): void => {
    if (notes.length < MAX_NOTES) {
      notes.push(text)
      if (issue !== undefined) issues.push(issue)
    } else {
      suppressed++
    }
  }

  for (const req of requests) {
    const source = req.source.toLowerCase()
    const kind = req.kind.toLowerCase()
    if (!isAuthoritySource(source) || !isAuthorityKind(kind)) {
      stats.skipped += req.values.length
      note(`Spalte "${req.column}": unbekannte Normdatenquelle "${req.source}"/"${req.kind}" — nicht nachgeschlagen`, {
        severity: 'warning', code: 'authority.unknown-source', sourceField: req.column,
        message: `Unbekannte Normdatenquelle "${req.source}" oder Art "${req.kind}"`
      })
      continue
    }

    if (!sourceAllowed(source, kind, options.schema)) {
      stats.skipped += req.values.length
      note(`Spalte "${req.column}": ${source.toUpperCase()} ist laut Schema fuer "${kind}" nicht vorgesehen`, {
        severity: 'warning', code: 'authority.source-not-allowed', sourceField: req.column,
        message: `Das Schema sieht ${source.toUpperCase()} bei "${kind}" nicht vor — nichts nachgeschlagen.`
      })
      continue
    }

    for (const value of req.values) {
      const queryNorm = compareForm(value)
      if (queryNorm === '') continue
      const key = cacheKey(source, kind, queryNorm)
      if (resolutions.has(key)) continue
      stats.requested++

      const cached = await cache.get(source, kind, queryNorm)
      if (cached !== null) {
        stats.fromCache++
        record(key, value, req.column, cached)
        continue
      }

      if (!enabled) {
        stats.skipped++
        abgeschaltet.set(req.column, (abgeschaltet.get(req.column) ?? 0) + 1)
        continue
      }
      if (fetched >= limit) {
        stats.skipped++
        stats.limitReached = true
        continue
      }

      if (fetched > 0) await sleep(pauseMs)
      fetched++
      stats.fetched++

      let resolution: AuthorityResolution
      try {
        const candidates = await searchFor(source, value, kind, fetchJson)
        resolution = decide(exactMatches(candidates, queryNorm))
      } catch (e) {
        // Nicht erreichbar heisst "kein Treffer", nicht "Import kaputt" — und es
        // wird nicht zwischengespeichert, sonst wird eine Stoerung dauerhaft.
        stats.failed++
        note(
          `"${value}" konnte in ${source.toUpperCase()} nicht nachgeschlagen werden `
          + `(${e instanceof Error ? e.message : String(e)}) — ohne ID uebernommen`,
          {
            severity: 'info', code: 'authority.unreachable', sourceField: req.column,
            value: value.slice(0, 120), params: { quelle: source.toUpperCase() },
            message: `Normdatenquelle ${source.toUpperCase()} war nicht erreichbar — kein Treffer eingetragen.`
          }
        )
        options.onWarn?.(`${source}: ${e instanceof Error ? e.message : String(e)}`)
        resolutions.set(key, { ...EMPTY_RESOLUTION })
        continue
      }

      await cache.put(source, kind, queryNorm, resolution)
      record(key, value, req.column, resolution)
    }
  }

  // Anlass #38 (03.11.2026): Bei ausgeschaltetem Schalter blieb der Bericht
  // leer, und der Konverter sah aus wie defekt. Die Meldung kommt einmal je
  // Lauf und Spalte, nicht je Wert, mit sourceField, damit der Editor sie an
  // der Spalte zeigt. Sie geht an `note` vorbei: Gerade sie darf nicht unter
  // „… weitere Meldungen" verschwinden.
  const abgeschalteteMeldungen: ValidationIssue[] = []
  for (const [spalte, anzahl] of abgeschaltet) {
    notes.push(`Spalte "${spalte}": Normdatenabfrage ausgeschaltet (AUTHORITY_ENABLED) — ${anzahl} Werte nicht nachgeschlagen`)
    abgeschalteteMeldungen.push({
      severity: 'warning', code: 'authority.disabled', sourceField: spalte, params: { anzahl, spalte },
      message: `Die Normdatenabfrage ist ausgeschaltet (AUTHORITY_ENABLED). ${anzahl} Werte der Spalte "${spalte}" wurden nicht nachgeschlagen.`
    })
  }
  issues.unshift(...abgeschalteteMeldungen)
  if (stats.limitReached) {
    note(
      `Obergrenze von ${limit} Normdatenabfragen je Import erreicht — ${stats.skipped} Werte blieben ungeprueft.`,
      {
        severity: 'info', code: 'authority.limit', params: { grenze: limit },
        message: `Obergrenze von ${limit} Normdatenabfragen je Import erreicht (AUTHORITY_LIMIT).`
      }
    )
  }
  if (suppressed > 0) {
    notes.push(`… und ${suppressed} weitere Meldungen zu Normdaten`)
  }

  function record(key: string, value: string, column: string, r: AuthorityResolution): void {
    resolutions.set(key, r)
    if (r.id !== '') {
      stats.resolved++
      hits.set(key, { id: r.id, label: r.label, note: r.note })
    } else if (r.ambiguous) {
      stats.ambiguous++
      note(
        `"${value}" ist mehrdeutig (${r.candidates.length} Treffer) — keine ID uebernommen`,
        {
          severity: 'info', code: 'authority.ambiguous', sourceField: column,
          value: value.slice(0, 120), count: r.candidates.length,
          message: `"${value}" passt auf ${r.candidates.length} Normdatensaetze. `
            + 'Es wurde keine ID eingetragen. Bitte manuell zuordnen.'
        }
      )
    } else {
      stats.misses++
    }
  }

  return {
    hits,
    resolve(value, source, kind) {
      return hits.get(authorityKey(source.toLowerCase(), kind.toLowerCase(), value)) ?? null
    },
    resolution(value, source, kind) {
      return resolutions.get(authorityKey(source.toLowerCase(), kind.toLowerCase(), value)) ?? null
    },
    stats,
    notes,
    issues
  }
}

/** Leeres Ergebnis — wenn die Anreicherung aus ist, braucht niemand eine Abfrage. */
export function noAuthorities(): ResolvedAuthorities {
  return {
    hits: new Map(),
    resolve: () => null,
    resolution: () => null,
    stats: emptyStats(),
    notes: [],
    issues: []
  }
}
