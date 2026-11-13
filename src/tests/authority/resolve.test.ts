/*
 * Vorab-Aufloesung: Eindeutigkeit, Obergrenze, Zwischenspeicher, Ausfall.
 *
 * Kein Test geht ins Netz — jede Abfrage laeuft ueber ein eingehaengtes
 * fetchJson. Auch die Tabelle authority_cache der laufenden Instanz wird nicht
 * angefasst; hier arbeitet nur der Zwischenspeicher im Arbeitsspeicher.
 */

import { describe, expect, it } from 'vitest'
import type { AuthorityRequest } from '../../server/lib/mapping/runner.js'
import { compareForm } from '../../server/lib/authority/names.js'
import { memoryAuthorityCache } from '../../server/lib/authority/cache.js'
import {
  authorityEnabledFromEnv, authorityKey, authorityLimitFromEnv, decide, exactMatches,
  resolveAuthorities, sourceAllowed
} from '../../server/lib/authority/resolve.js'
import { parseGnd } from '../../server/lib/authority/gnd.js'
import { createFetchJson } from '../../server/lib/authority/http.js'
import { gndAntwort, stubFetch, testSchema, verbotenerNetzzugriff } from './fixtures.js'

function bedarf(column: string, values: string[], source = 'gnd', kind = 'person'): AuthorityRequest[] {
  return [{ column, source, kind, values }]
}

const an = { enabled: true, pauseMs: 0 } as const

describe('Eindeutigkeit', () => {
  it('findet die GND-Person, obwohl sie invertiert gefuehrt wird', async () => {
    const fetchJson = stubFetch({
      'lobid.org': gndAntwort([{ id: '118614355', name: 'Sielmann, Heinz', beruf: 'Tierfilmer' }])
    })
    const r = await resolveAuthorities(bedarf('Regie', ['Heinz Sielmann']), { ...an, fetchJson })

    expect(r.resolve('Heinz Sielmann', 'gnd', 'person')).toEqual({
      id: '118614355', label: 'Sielmann, Heinz', note: expect.stringContaining('Tierfilmer')
    })
    expect(r.stats.resolved).toBe(1)
    expect(r.stats.ambiguous).toBe(0)
  })

  it('greift auch, wenn die Quelle den Namen natuerlich fuehrt', async () => {
    const fetchJson = stubFetch({ 'lobid.org': gndAntwort([{ id: '2', name: 'Bundesarchiv', type: ['CorporateBody'] }]) })
    const r = await resolveAuthorities(bedarf('Institution', ['Bundesarchiv'], 'gnd', 'corporate'), { ...an, fetchJson })
    expect(r.resolve('Bundesarchiv', 'gnd', 'corporate')?.id).toBe('2')
  })

  it('traegt nichts ein, wenn nichts passt', async () => {
    const fetchJson = stubFetch({ 'lobid.org': gndAntwort([{ id: '9', name: 'Sielmann, Inge' }]) })
    const r = await resolveAuthorities(bedarf('Regie', ['Heinz Sielmann']), { ...an, fetchJson })
    expect(r.resolve('Heinz Sielmann', 'gnd', 'person')).toBeNull()
    expect(r.stats.misses).toBe(1)
  })

  it('vergleicht ohne Ruecksicht auf Gross- und Kleinschreibung und Leerraum', async () => {
    const fetchJson = stubFetch({ 'lobid.org': gndAntwort([{ id: '3', name: 'Sielmann, Heinz' }]) })
    const r = await resolveAuthorities(bedarf('Regie', ['  heinz   SIELMANN ']), { ...an, fetchJson })
    expect(r.resolve('Heinz Sielmann', 'gnd', 'person')?.id).toBe('3')
  })
})

describe('Strenger vergleichen entfernt einen Fehler — der Fall "Guenther Wolf"', () => {
  // Drei GND-Datensaetze zum selben Namen, einer davon zufaellig in natuerlicher
  // Schreibweise. Im PHP-Stand galt nur dieser eine als "exakt" und wurde
  // uebernommen — die falsche ID. Mit der umgedrehten Form passen alle drei,
  // die Eindeutigkeitsregel greift, und es wird nichts eingetragen.
  const antwort = gndAntwort([
    { id: '111', name: 'Wolf, Günther', beruf: 'Regisseur' },
    { id: '222', name: 'Günther Wolf', beruf: 'Kameramann' },
    { id: '333', name: 'Wolf, Günther', beruf: 'Komponist' }
  ])
  const anfrage = compareForm('Günther Wolf')

  it('der reine Zeichenvergleich haelt genau einen Datensatz fuer eindeutig', () => {
    const naiv = parseGnd(antwort, 'person').filter((c) => compareForm(c.label) === anfrage)
    expect(naiv).toHaveLength(1)
    expect(naiv[0]?.id).toBe('222')   // genau die eine falsche ID
  })

  it('mit der umgedrehten Form passen alle drei', () => {
    expect(exactMatches(parseGnd(antwort, 'person'), anfrage).map((c) => c.id)).toEqual(['111', '222', '333'])
  })

  it('und deshalb wird nichts uebernommen', async () => {
    const fetchJson = stubFetch({ 'lobid.org': antwort })
    const r = await resolveAuthorities(bedarf('Regie', ['Günther Wolf']), { ...an, fetchJson })

    expect(r.resolve('Günther Wolf', 'gnd', 'person')).toBeNull()
    expect(r.stats.ambiguous).toBe(1)
    expect(r.stats.resolved).toBe(0)
  })

  it('meldet aber, was gefunden wurde — kein stilles Verschlucken', async () => {
    const fetchJson = stubFetch({ 'lobid.org': antwort })
    const r = await resolveAuthorities(bedarf('Regie', ['Günther Wolf']), { ...an, fetchJson })

    const aufloesung = r.resolution('Günther Wolf', 'gnd', 'person')
    expect(aufloesung?.ambiguous).toBe(true)
    expect(aufloesung?.candidates.map((c) => c.id)).toEqual(['111', '222', '333'])
    expect(r.notes.join(' ')).toContain('mehrdeutig')
    expect(r.issues.some((i) => i.code === 'authority.ambiguous' && i.sourceField === 'Regie')).toBe(true)
  })

  it('derselbe Datensatz in zwei Schreibweisen ist nicht mehrdeutig', () => {
    const doppelt = parseGnd(gndAntwort([
      { id: '111', name: 'Wolf, Günther' },
      { id: '111', name: 'Günther Wolf' }
    ]), 'person')
    expect(decide(exactMatches(doppelt, anfrage)).id).toBe('111')
  })
})

describe('Anreicherung ist standardmaessig aus', () => {
  it('ohne enabled geht keine einzige Anfrage hinaus', async () => {
    const r = await resolveAuthorities(bedarf('Regie', ['Heinz Sielmann']), { fetchJson: verbotenerNetzzugriff })
    expect(r.stats.fetched).toBe(0)
    expect(r.stats.skipped).toBe(1)
    expect(r.resolve('Heinz Sielmann', 'gnd', 'person')).toBeNull()
  })

  // #38 (03.11.2026): Bis dahin blieb der Bericht bei ausgeschaltetem Schalter
  // leer, und die Konverter sahen aus wie defekt.
  it('meldet den ausgeschalteten Schalter einmal je Spalte, mit Anzahl', async () => {
    const r = await resolveAuthorities([
      { column: 'Regie', source: 'gnd', kind: 'person', values: ['Heinz Sielmann', 'Günther Wolf'] },
      { column: 'Regie', source: 'wikidata', kind: 'person', values: ['Heinz Sielmann'] },
      { column: 'Land', source: 'wikidata', kind: 'place', values: ['Deutschland'] }
    ], { fetchJson: verbotenerNetzzugriff })

    const meldungen = r.issues.filter((i) => i.code === 'authority.disabled')
    expect(meldungen.map((i) => [i.sourceField, i.params?.['anzahl'], i.severity])).toEqual([
      ['Regie', 3, 'warning'],
      ['Land', 1, 'warning']
    ])
  })

  it('meldet nichts, was der Zwischenspeicher beantwortet', async () => {
    const cache = memoryAuthorityCache()
    await cache.put('gnd', 'person', compareForm('Heinz Sielmann'), {
      id: '118614355', label: 'Sielmann, Heinz', note: '', ambiguous: false, candidates: []
    })
    const r = await resolveAuthorities(bedarf('Regie', ['Heinz Sielmann']), { cache, fetchJson: verbotenerNetzzugriff })
    expect(r.issues.filter((i) => i.code === 'authority.disabled')).toEqual([])
  })

  it('meldet nichts, wenn der Schalter an ist', async () => {
    const fetchJson = stubFetch({ 'lobid.org': gndAntwort([]) })
    const r = await resolveAuthorities(bedarf('Regie', ['Niemand Bekanntes']), { ...an, fetchJson })
    expect(r.issues.filter((i) => i.code === 'authority.disabled')).toEqual([])
  })

  it('authorityEnabledFromEnv liest die Umgebung, Standard ist aus', () => {
    expect(authorityEnabledFromEnv({})).toBe(false)
    expect(authorityEnabledFromEnv({ AUTHORITY_ENABLED: '0' })).toBe(false)
    expect(authorityEnabledFromEnv({ AUTHORITY_ENABLED: 'true' })).toBe(true)
    expect(authorityEnabledFromEnv({ AUTHORITY_ENABLED: 'ja' })).toBe(true)
  })
})

describe('Obergrenze je Import', () => {
  it('AUTHORITY_LIMIT wird gelesen, Standard ist 500', () => {
    expect(authorityLimitFromEnv({})).toBe(500)
    expect(authorityLimitFromEnv({ AUTHORITY_LIMIT: '12' })).toBe(12)
    expect(authorityLimitFromEnv({ AUTHORITY_LIMIT: 'unfug' })).toBe(500)
    expect(authorityLimitFromEnv({ AUTHORITY_LIMIT: '0' })).toBe(0)
  })

  it('nach der Obergrenze wird nicht weiter abgefragt', async () => {
    const namen = ['Anna Alpha', 'Bert Beta', 'Cora Gamma', 'Dirk Delta', 'Emil Epsilon']
    const fetchJson = stubFetch(() => gndAntwort([]))
    const r = await resolveAuthorities(bedarf('Regie', namen), { ...an, fetchJson, limit: 2 })

    expect(fetchJson.calls).toHaveLength(2)
    expect(r.stats.fetched).toBe(2)
    expect(r.stats.skipped).toBe(3)
    expect(r.stats.limitReached).toBe(true)
    expect(r.issues.some((i) => i.code === 'authority.limit')).toBe(true)
  })

  it('bei limit 0 passiert gar nichts', async () => {
    const r = await resolveAuthorities(bedarf('Regie', ['Heinz Sielmann']),
      { ...an, fetchJson: verbotenerNetzzugriff, limit: 0 })
    expect(r.stats.fetched).toBe(0)
  })
})

describe('Zwischenspeicher', () => {
  it('derselbe Name wird nur einmal abgefragt', async () => {
    const fetchJson = stubFetch({ 'lobid.org': gndAntwort([{ id: '7', name: 'Sielmann, Heinz' }]) })
    const r = await resolveAuthorities(
      [
        { column: 'Regie', source: 'gnd', kind: 'person', values: ['Heinz Sielmann'] },
        { column: 'Kamera', source: 'gnd', kind: 'person', values: ['Heinz Sielmann', 'heinz sielmann'] }
      ],
      { ...an, fetchJson }
    )
    expect(fetchJson.calls).toHaveLength(1)
    expect(r.resolve('Heinz Sielmann', 'gnd', 'person')?.id).toBe('7')
  })

  it('holt einen Treffer aus dem Zwischenspeicher, ohne das Netz anzufassen', async () => {
    const cache = memoryAuthorityCache()
    await cache.put('gnd', 'person', compareForm('Heinz Sielmann'), {
      id: '118614355', label: 'Sielmann, Heinz', note: 'Tierfilmer', ambiguous: false, candidates: []
    })
    const r = await resolveAuthorities(bedarf('Regie', ['Heinz Sielmann']),
      { ...an, cache, fetchJson: verbotenerNetzzugriff })

    expect(r.stats.fromCache).toBe(1)
    expect(r.stats.fetched).toBe(0)
    expect(r.resolve('Heinz Sielmann', 'gnd', 'person')?.id).toBe('118614355')
  })

  it('merkt sich auch den Nicht-Treffer — sonst wird jeder unbekannte Name immer wieder gesucht', async () => {
    const cache = memoryAuthorityCache()
    const fetchJson = stubFetch({ 'lobid.org': gndAntwort([]) })
    await resolveAuthorities(bedarf('Regie', ['Niemand Bekanntes']), { ...an, cache, fetchJson })

    expect(cache.size()).toBe(1)
    const zweiter = await resolveAuthorities(bedarf('Regie', ['Niemand Bekanntes']),
      { ...an, cache, fetchJson: verbotenerNetzzugriff })
    expect(zweiter.stats.fromCache).toBe(1)
  })

  it('merkt sich einen Fehlschlag NICHT — eine Stoerung darf nicht dauerhaft werden', async () => {
    const cache = memoryAuthorityCache()
    const fetchJson = stubFetch(() => { throw new Error('Zeitueberschreitung') })
    const r = await resolveAuthorities(bedarf('Regie', ['Heinz Sielmann']), { ...an, cache, fetchJson })

    expect(r.stats.failed).toBe(1)
    expect(cache.size()).toBe(0)
  })

  it('merkt sich auch eine Fehlerantwort mit HTTP 200 nicht (#38, 10.11.2026)', async () => {
    // Wikidata bei Ueberlast: Status 200, Fehler im Rumpf. Vorher wurde das
    // als leere Trefferliste gelesen und als Nicht-Treffer gespeichert.
    const cache = memoryAuthorityCache()
    const fetchImpl = (async () => ({
      ok: true, status: 200, headers: { get: () => null },
      json: async () => ({ error: { code: 'maxlag', info: 'lagged' } })
    })) as unknown as typeof fetch
    const fetchJson = createFetchJson({ fetchImpl, sleep: async () => {}, retries: 1 })
    const r = await resolveAuthorities(bedarf('Regie', ['Gorch Fock'], 'wikidata'), { ...an, cache, fetchJson })

    expect(r.stats.failed).toBe(1)
    expect(r.stats.misses).toBe(0)
    expect(cache.size()).toBe(0)
    expect(r.issues.some((i) => i.code === 'authority.unreachable')).toBe(true)
  })
})

describe('Ausfall einer Quelle', () => {
  it('liefert sauber "kein Treffer", statt den Import zu kippen', async () => {
    const fetchJson = stubFetch(() => { throw new Error('lobid nicht erreichbar') })
    const r = await resolveAuthorities(bedarf('Regie', ['Heinz Sielmann', 'Anna Mueller']), { ...an, fetchJson })

    expect(r.stats.failed).toBe(2)
    expect(r.resolve('Heinz Sielmann', 'gnd', 'person')).toBeNull()
    expect(r.issues.some((i) => i.code === 'authority.unreachable')).toBe(true)
  })

  it('deckelt die Zahl der Meldungen, damit ein Totalausfall keinen Bericht flutet', async () => {
    const viele = Array.from({ length: 60 }, (_, i) => `Person ${i}`)
    const fetchJson = stubFetch(() => { throw new Error('aus') })
    const r = await resolveAuthorities(bedarf('Regie', viele), { ...an, fetchJson })

    expect(r.stats.failed).toBe(60)
    expect(r.notes.length).toBeLessThanOrEqual(21)
    expect(r.notes[r.notes.length - 1]).toContain('weitere Meldungen')
  })
})

describe('Schema-Pruefung', () => {
  it('laesst zu, was das Schema an same_as vorsieht', () => {
    expect(sourceAllowed('gnd', 'person', testSchema)).toBe(true)
    expect(sourceAllowed('wikidata', 'person', testSchema)).toBe(true)
    expect(sourceAllowed('viaf', 'person', testSchema)).toBe(false)
    expect(sourceAllowed('wikidata', 'place', testSchema)).toBe(false)
  })

  it('blockiert nichts, solange kein Schema hereingereicht wird', () => {
    expect(sourceAllowed('viaf', 'person')).toBe(true)
  })

  it('fragt gar nicht erst ab, was das Schema nicht vorsieht', async () => {
    const r = await resolveAuthorities(bedarf('Regie', ['Heinz Sielmann'], 'viaf'),
      { ...an, schema: testSchema, fetchJson: verbotenerNetzzugriff })
    expect(r.stats.skipped).toBe(1)
    expect(r.issues.some((i) => i.code === 'authority.source-not-allowed')).toBe(true)
  })
})

describe('Unbrauchbare Angaben', () => {
  it('eine unbekannte Quelle wird gemeldet, nicht abgefragt', async () => {
    const r = await resolveAuthorities(bedarf('Regie', ['x'], 'geheimarchiv'),
      { ...an, fetchJson: verbotenerNetzzugriff })
    expect(r.issues.some((i) => i.code === 'authority.unknown-source')).toBe(true)
  })

  it('leere Werte erzeugen keine Anfrage', async () => {
    const r = await resolveAuthorities(bedarf('Regie', ['', '   ']), { ...an, fetchJson: verbotenerNetzzugriff })
    expect(r.stats.requested).toBe(0)
  })
})

describe('authorityKey', () => {
  it('ist die Vergleichsform, mit der auch der Mappingkern arbeitet', () => {
    expect(authorityKey('gnd', 'person', '  Heinz   Sielmann ')).toBe(authorityKey('gnd', 'person', 'heinz sielmann'))
  })
})
