/*
 * Zwischenspeicher fuer Normdaten-Aufloesungen.
 *
 * Ohne ihn bedeuten 5562 Datensaetze mehrere tausend HTTP-Anfragen mitten im
 * Worker-Job. Kulturdaten sind repetitiv: dieselben zweihundert Regisseure
 * stehen in fuenftausend Zeilen. Gespeichert werden deshalb auch die
 * Nicht-Treffer — sonst wird jeder unbekannte Name bei jedem Import erneut
 * gesucht.
 *
 * Nicht gespeichert werden Fehlschlaege. Ein Zeitablauf bei lobid ist keine
 * Aussage ueber den Namen; wer ihn festschreibt, macht eine Stoerung dauerhaft.
 *
 * Schluessel ist (source, kind, query_norm) mit query_norm = compareForm(Wert) —
 * dieselbe Vergleichsform, die auch der Mappingkern und ColumnMapping.authorities
 * benutzen.
 *
 * Dazu kommt eine Generation im Quellfeld ("gnd/v2"). Der Grund steht in der
 * Tabelle der laufenden Instanz: Dort liegen 134 zwischengespeicherte
 * GND-Personen, von denen 17 eine ID haben — 13 Prozent. Bei VIAF sind es 41.
 * Das ist der Abdruck des alten Zeichenvergleichs, der invertierte Namen nie
 * traf. Wuerde die neue Version dieselben Schluessel lesen, bekaeme sie 117
 * festgeschriebene Nicht-Treffer zurueck und der behobene Fehler bliebe
 * unsichtbar. Die alten Zeilen bleiben unangetastet liegen und koennen bei
 * Gelegenheit geloescht werden.
 */

import type { Sql } from 'postgres'
import type { AuthorityResolution } from './types.js'
import { toResolution } from './types.js'

export interface AuthorityCache {
  get(source: string, kind: string, queryNorm: string): Promise<AuthorityResolution | null>
  put(source: string, kind: string, queryNorm: string, value: AuthorityResolution): Promise<void>
}

export function cacheKey(source: string, kind: string, queryNorm: string): string {
  return `${source} ${kind} ${queryNorm}`
}

/**
 * Stand der Aufloesungslogik. Wird die Vergleichsregel geaendert, zaehlt sie
 * hoch, und alte Ergebnisse werden nicht mehr gelesen.
 *   1 — PHP-Stand: reiner Zeichenvergleich, GND-Personen trafen nie.
 *   2 — Abgleich mit umgedrehter Namensform.
 *   3 — Lebensdaten ohne zweites Komma (VIAF), Wikidata-Personen ohne
 *       gleichnamige Nicht-Menschen (#38, 03.11.2026). Unter 2 liegen fuer
 *       genau diese Faelle Nicht-Treffer und „mehrdeutig“.
 */
export const AUTHORITY_CACHE_GENERATION = 3

/** Wert der Spalte source: "gnd" in Generation 1, sonst "gnd/v2". */
export function cacheSourceColumn(source: string, generation = AUTHORITY_CACHE_GENERATION): string {
  return generation <= 1 ? source : `${source}/v${generation}`
}

/** Zwischenspeicher, der nichts behaelt. */
export function noAuthorityCache(): AuthorityCache {
  return {
    async get() { return null },
    async put() { /* absichtlich leer */ }
  }
}

export interface MemoryAuthorityCache extends AuthorityCache {
  size(): number
  clear(): void
  keys(): string[]
}

/**
 * Zwischenspeicher im Arbeitsspeicher. Fuer Tests und als Vorschaltstufe vor der
 * Datenbank, damit derselbe Name innerhalb eines Laufs nicht mehrfach abgefragt
 * wird.
 */
export function memoryAuthorityCache(
  seed?: Iterable<readonly [string, AuthorityResolution]>
): MemoryAuthorityCache {
  const store = new Map<string, AuthorityResolution>()
  if (seed !== undefined) {
    for (const [k, v] of seed) store.set(k, v)
  }
  return {
    async get(source, kind, queryNorm) {
      return store.get(cacheKey(source, kind, queryNorm)) ?? null
    },
    async put(source, kind, queryNorm, value) {
      store.set(cacheKey(source, kind, queryNorm), value)
    },
    size: () => store.size,
    clear: () => store.clear(),
    keys: () => [...store.keys()]
  }
}

/**
 * Dauerhafter Zwischenspeicher in der Tabelle authority_cache.
 *
 * Lese- und Schreibfehler werden gemeldet, nicht geworfen: Ein nicht
 * erreichbarer Zwischenspeicher darf einen Import nicht abbrechen, er macht ihn
 * nur langsamer.
 */
export interface DbCacheOptions {
  onWarn?: (message: string) => void
  /** Nur setzen, um bewusst eine aeltere Generation zu lesen. */
  generation?: number
}

export function dbAuthorityCache(sql: Sql, options: DbCacheOptions = {}): AuthorityCache {
  const onWarn = options.onWarn ?? ((m: string) => console.warn(`[Normdaten] ${m}`))
  const gen = options.generation ?? AUTHORITY_CACHE_GENERATION

  return {
    async get(source, kind, queryNorm) {
      try {
        const col = cacheSourceColumn(source, gen)
        const rows = await sql<Array<{ result_json: unknown }>>`
          SELECT result_json
            FROM authority_cache
           WHERE source = ${col} AND kind = ${kind} AND query_norm = ${queryNorm}
           LIMIT 1`
        const first = rows[0]
        return first === undefined ? null : toResolution(first.result_json)
      } catch (e) {
        onWarn(`Zwischenspeicher nicht lesbar: ${e instanceof Error ? e.message : String(e)}`)
        return null
      }
    },

    async put(source, kind, queryNorm, value) {
      try {
        await sql`
          INSERT INTO authority_cache (source, kind, query_norm, result_json)
          VALUES (${cacheSourceColumn(source, gen)}, ${kind}, ${queryNorm}, ${sql.json(value as never)})
          ON CONFLICT (source, kind, query_norm)
          DO UPDATE SET result_json = EXCLUDED.result_json`
      } catch (e) {
        onWarn(`Zwischenspeicher nicht schreibbar: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
  }
}

/**
 * Legt eine Lesestufe vor eine andere: erst der Arbeitsspeicher, dann die
 * Datenbank. Geschrieben wird in beide.
 */
export function layeredAuthorityCache(front: AuthorityCache, back: AuthorityCache): AuthorityCache {
  return {
    async get(source, kind, queryNorm) {
      const hit = await front.get(source, kind, queryNorm)
      if (hit !== null) return hit
      const deep = await back.get(source, kind, queryNorm)
      if (deep !== null) await front.put(source, kind, queryNorm, deep)
      return deep
    },
    async put(source, kind, queryNorm, value) {
      await front.put(source, kind, queryNorm, value)
      await back.put(source, kind, queryNorm, value)
    }
  }
}

/**
 * Entfernt einen Eintrag aus der Tabelle und meldet, wie viele Zeilen es waren.
 *
 * Gedacht fuer den Fall, dass eine ID sich als falsch herausgestellt hat. Im
 * PHP-Stand war eine GND-Nummer von Hand in authority_cache eingetragen worden,
 * ohne zu pruefen, zu wem sie gehoert — zwei Personen bekamen dieselbe ID, und
 * der Kunde hat es gemeldet. Wer zum Pruefen etwas eintraegt, raeumt hiermit
 * nachweislich wieder auf.
 */
export async function purgeAuthorityCache(
  sql: Sql,
  source: string,
  kind: string,
  queryNorm: string,
  generation = AUTHORITY_CACHE_GENERATION
): Promise<number> {
  const rows = await sql<Array<{ id: number }>>`
    DELETE FROM authority_cache
     WHERE source = ${cacheSourceColumn(source, generation)}
       AND kind = ${kind} AND query_norm = ${queryNorm}
    RETURNING id`
  return rows.length
}

/** Anzahl der Eintraege — fuer Anzeige und zur Kontrolle nach einem Test. */
export async function countAuthorityCache(sql: Sql): Promise<number> {
  const rows = await sql<Array<{ n: string }>>`SELECT count(*)::text AS n FROM authority_cache`
  return Number(rows[0]?.n ?? '0')
}

/**
 * Loescht die Zeilen einer Generation. Ohne Angabe trifft es Generation 1, also
 * die Hinterlassenschaft des PHP-Stands: Zeilen, deren Quellfeld noch ohne
 * "/v" geschrieben ist.
 */
export async function dropAuthorityCacheGeneration(sql: Sql, generation = 1): Promise<number> {
  const rows = generation <= 1
    ? await sql<Array<{ id: number }>>`
        DELETE FROM authority_cache WHERE source NOT LIKE '%/v%' RETURNING id`
    : await sql<Array<{ id: number }>>`
        DELETE FROM authority_cache WHERE source LIKE ${'%/v' + String(generation)} RETURNING id`
  return rows.length
}
