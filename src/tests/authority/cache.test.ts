/*
 * Zwischenspeicher.
 *
 * Die Tabelle authority_cache der laufenden Instanz wird hier nicht angefasst.
 * Der Datenbankteil wird gegen ein nachgebautes sql geprueft — im PHP-Stand war
 * eine GND-Nummer von Hand in die echte Tabelle geschrieben worden, ohne zu
 * pruefen, zu wem sie gehoert; zwei Personen bekamen dieselbe ID.
 */

import { describe, expect, it, vi } from 'vitest'
import type { Sql } from 'postgres'
import type { AuthorityResolution } from '../../server/lib/authority/types.js'
import { toResolution } from '../../server/lib/authority/types.js'
import {
  AUTHORITY_CACHE_GENERATION, cacheKey, cacheSourceColumn, dbAuthorityCache,
  layeredAuthorityCache, memoryAuthorityCache, noAuthorityCache
} from '../../server/lib/authority/cache.js'

const treffer: AuthorityResolution = {
  id: '118614355', label: 'Sielmann, Heinz', note: 'Tierfilmer', ambiguous: false, candidates: []
}

/** Nachbau eines getaggten Template-Literals, das immer dieselben Zeilen liefert. */
function fakeSql(rows: unknown[], onQuery?: (text: string) => void): Sql {
  const sql = ((strings: TemplateStringsArray) => {
    onQuery?.(strings.join('?'))
    return Promise.resolve(rows)
  }) as unknown as Sql
  ;(sql as unknown as { json: (v: unknown) => unknown }).json = (v) => v
  return sql
}

function brokenSql(): Sql {
  const sql = (() => Promise.reject(new Error('Verbindung weg'))) as unknown as Sql
  ;(sql as unknown as { json: (v: unknown) => unknown }).json = (v) => v
  return sql
}

describe('Zwischenspeicher im Arbeitsspeicher', () => {
  it('gibt zurueck, was hineingelegt wurde', async () => {
    const c = memoryAuthorityCache()
    await c.put('gnd', 'person', 'heinz sielmann', treffer)
    expect(await c.get('gnd', 'person', 'heinz sielmann')).toEqual(treffer)
    expect(await c.get('gnd', 'person', 'jemand anderes')).toBeNull()
  })

  it('trennt nach Quelle und Art', async () => {
    const c = memoryAuthorityCache()
    await c.put('gnd', 'person', 'berlin', treffer)
    expect(await c.get('wikidata', 'person', 'berlin')).toBeNull()
    expect(await c.get('gnd', 'place', 'berlin')).toBeNull()
  })

  it('cacheKey ist stabil', () => {
    expect(cacheKey('gnd', 'person', 'heinz sielmann')).toBe('gnd person heinz sielmann')
  })
})

describe('Zwischenspeicher, der nichts behaelt', () => {
  it('liefert immer null', async () => {
    const c = noAuthorityCache()
    await c.put('gnd', 'person', 'x', treffer)
    expect(await c.get('gnd', 'person', 'x')).toBeNull()
  })
})

describe('Zwischenspeicher in der Datenbank', () => {
  it('liest eine Zeile und macht daraus eine Aufloesung', async () => {
    const c = dbAuthorityCache(fakeSql([{ result_json: treffer }]))
    expect(await c.get('gnd', 'person', 'heinz sielmann')).toEqual(treffer)
  })

  it('liefert null, wenn nichts gespeichert ist', async () => {
    const c = dbAuthorityCache(fakeSql([]))
    expect(await c.get('gnd', 'person', 'heinz sielmann')).toBeNull()
  })

  it('schreibt unter der aktuellen Generation, nicht ueber die alten Zeilen', () => {
    // In der Tabelle der laufenden Instanz liegen 134 GND-Personen aus dem
    // PHP-Stand, davon 17 mit ID. Diese festgeschriebenen Nicht-Treffer duerfen
    // die neue Vergleichsregel nicht aushebeln.
    expect(AUTHORITY_CACHE_GENERATION).toBeGreaterThan(1)
    expect(cacheSourceColumn('gnd')).toBe(`gnd/v${AUTHORITY_CACHE_GENERATION}`)
    expect(cacheSourceColumn('gnd', 2)).toBe('gnd/v2')
    expect(cacheSourceColumn('gnd', 1)).toBe('gnd')
  })

  it('liest nach dem Abgleich vom 03.11.2026 nicht mehr unter v2 (#38)', () => {
    // Unter v2 liegen fuer VIAF-Namen mit Lebensdaten Nicht-Treffer und fuer
    // Wikidata-Personen „mehrdeutig“. Ohne neue Generation blieben sie stehen.
    expect(AUTHORITY_CACHE_GENERATION).toBeGreaterThanOrEqual(3)
  })

  it('schreibt mit ON CONFLICT, damit ein zweiter Lauf nicht scheitert', async () => {
    const abfragen: string[] = []
    const c = dbAuthorityCache(fakeSql([], (t) => abfragen.push(t)))
    await c.put('gnd', 'person', 'heinz sielmann', treffer)
    expect(abfragen.join(' ')).toContain('ON CONFLICT')
    expect(abfragen.join(' ')).toContain('INSERT INTO authority_cache')
  })

  it('bricht bei einer kaputten Verbindung nicht ab, sondern meldet und macht weiter', async () => {
    const warn = vi.fn()
    const c = dbAuthorityCache(brokenSql(), { onWarn: warn })
    expect(await c.get('gnd', 'person', 'x')).toBeNull()
    await expect(c.put('gnd', 'person', 'x', treffer)).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalledTimes(2)
  })
})

describe('Gestufter Zwischenspeicher', () => {
  it('fragt die Datenbank nur, wenn der Arbeitsspeicher nichts hat', async () => {
    const front = memoryAuthorityCache()
    const gelesen: string[] = []
    const back = dbAuthorityCache(fakeSql([{ result_json: treffer }], (t) => gelesen.push(t)))
    const c = layeredAuthorityCache(front, back)

    expect((await c.get('gnd', 'person', 'heinz sielmann'))?.id).toBe('118614355')
    expect(gelesen).toHaveLength(1)
    expect((await c.get('gnd', 'person', 'heinz sielmann'))?.id).toBe('118614355')
    expect(gelesen).toHaveLength(1)   // beim zweiten Mal aus dem Arbeitsspeicher
  })
})

describe('toResolution', () => {
  it('liest auch unvollstaendige Eintraege ohne Absturz', () => {
    expect(toResolution({ id: 'x' })).toEqual({ id: 'x', label: '', note: '', ambiguous: false, candidates: [] })
    expect(toResolution(null)).toBeNull()
    expect(toResolution('kaputt')).toBeNull()
    expect(toResolution({ id: 1 })?.id).toBe('')
  })

  it('wirft unbrauchbare Kandidaten weg', () => {
    expect(toResolution({ id: '', candidates: ['kaputt', { id: 'Q1' }] })?.candidates).toEqual([{ id: 'Q1' }])
  })
})
