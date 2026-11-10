/*
 * Die Bilanz der Normdaten auf der Importseite (#38, 10.11.2026).
 *
 * Luca Wollny fand in einem spaeteren Lauf Namen, die der erste nicht
 * gefunden hatte, und konnte nicht sagen, warum. Die Zahlen dazu standen seit
 * dem 03.11. in jedem Bericht (`report_json.authority`), die Oberflaeche
 * zeigte sie nicht. Hier wird geprueft, dass die Bilanz aus dem Bericht
 * gelesen wird, dass ihre Summe aufgeht und dass die Saetze in beiden
 * Sprachen stehen.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { createI18n } from 'vue-i18n'
import { normdatenBilanz } from '../../server/api/imports/[id]/_herkunft'
import { resolveAuthorities } from '../../server/lib/authority/resolve.js'
import { memoryAuthorityCache } from '../../server/lib/authority/cache.js'
import { gndAntwort, stubFetch } from './fixtures.js'

describe('normdatenBilanz', () => {
  const bericht = {
    authority: {
      limit: 500, failed: 1, misses: 13, enabled: true, fetched: 16, skipped: 0,
      resolved: 8, ambiguous: 0, fromCache: 6, requested: 22, limitReached: false
    }
  }

  it('liest die Zahlen aus dem Bericht', () => {
    expect(normdatenBilanz(bericht)).toEqual({
      werte: 22, eindeutig: 8, mehrdeutig: 0, ohneTreffer: 13, gescheitert: 1, uebersprungen: 0,
      ausZwischenspeicher: 6, nachgeschlagen: 16, obergrenzeErreicht: false
    })
  })

  it('liefert null fuer Berichte ohne Normdaten', () => {
    expect(normdatenBilanz(null)).toBeNull()
    expect(normdatenBilanz({})).toBeNull()
    expect(normdatenBilanz({ authority: { enabled: true } })).toBeNull()
  })

  it('setzt fehlende oder kaputte Zahlen auf 0', () => {
    expect(normdatenBilanz({ authority: { requested: 3, resolved: 'drei' } })?.eindeutig).toBe(0)
  })
})

describe('Summe der Ergebnisse', () => {
  it('jeder Wert landet in genau einem Ergebnis', async () => {
    // eindeutig, ohne Treffer, gescheitert, und einer bleibt an der Obergrenze haengen
    const fetchJson = stubFetch((url) => {
      if (url.includes('Kaputt')) throw new Error('lobid nicht erreichbar')
      if (url.includes('Sielmann')) return gndAntwort([{ id: '118614355', name: 'Sielmann, Heinz' }])
      return { member: [] }
    })
    const r = await resolveAuthorities(
      [{ column: 'Regie', source: 'gnd', kind: 'person', values: ['Heinz Sielmann', 'Niemand', 'Kaputt', 'Zu viel'] }],
      { enabled: true, pauseMs: 0, limit: 3, cache: memoryAuthorityCache(), fetchJson }
    )
    const s = r.stats
    expect(s.requested).toBe(4)
    expect(s.resolved + s.ambiguous + s.misses + s.failed + s.skipped).toBe(s.requested)
    expect(s.fromCache + s.fetched + s.skipped).toBe(s.requested)
    expect([s.resolved, s.misses, s.failed, s.skipped, s.limitReached]).toEqual([1, 1, 1, 1, true])
  })
})

describe('Saetze', () => {
  function t(sprache: 'de' | 'en') {
    const messages = {
      de: JSON.parse(readFileSync('i18n/locales/de/imports.json', 'utf8')),
      en: JSON.parse(readFileSync('i18n/locales/en/imports.json', 'utf8'))
    }
    return createI18n({ legacy: false, locale: sprache, messages }).global.t
  }
  const teile = { eindeutig: 8, mehrdeutig: 0, ohne: 13 }

  it('zaehlt in beiden Sprachen mit Einzahl und Mehrzahl', () => {
    expect(t('de')('imports.detail.origin.authorityRun', { n: 22, ...teile }, 22))
      .toBe('Dieser Lauf: 22 Werte — 8 zugeordnet, 0 mehrdeutig, 13 ohne Treffer')
    expect(t('de')('imports.detail.origin.authorityRun', { n: 0, ...teile }, 0))
      .toBe('Dieser Lauf: keine Werte nachzuschlagen')
    expect(t('en')('imports.detail.origin.authorityRun', { n: 1, eindeutig: 1, mehrdeutig: 0, ohne: 0 }, 1))
      .toBe('This run: one value — 1 assigned, 0 ambiguous, 0 without match')
  })

  it('nennt, woher die Antworten kamen', () => {
    expect(t('de')('imports.detail.origin.authorityRunSource', { cache: 6, frisch: 16, fehl: 1, skip: 0 }))
      .toBe('Antworten: 6 aus dem Zwischenspeicher, 16 frisch nachgeschlagen; 1 nicht erreichbar, 0 nicht nachgeschlagen')
  })
})
