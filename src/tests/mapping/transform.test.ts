/* Konverter — jede Operation des Verzeichnisses einmal. */

import { describe, expect, it } from 'vitest'
import type { TransformStep } from '#shared/types/domain'
import {
  chainOrderIssues, chainType, runChain, secondsToIso, toIsoDate, toIsoDuration,
  TRANSFORM_CATALOG, transformCatalogForEditor, canonicalOp, compareForm
} from '../../server/lib/mapping/transform.js'
import { step, testSchema } from './fixtures.js'

function run(chain: TransformStep[], value: string, ctx = {}) {
  return runChain(chain, value, ctx)
}

describe('Verzeichnis', () => {
  it('kennt jede Operation aus dem PHP-Stand', () => {
    for (const op of ['trim', 'lowercase', 'uppercase', 'titlecase', 'replace', 'substring', 'default',
      'template', 'split', 'join', 'take', 'concat', 'number', 'year', 'date', 'duration', 'country',
      'map', 'authority']) {
      expect(TRANSFORM_CATALOG[op], op).toBeDefined()
    }
  })

  it('bietet die Altlasten im Editor nicht mehr an', () => {
    const ops = transformCatalogForEditor().map((m) => m.op)
    expect(ops).not.toContain('year')
    expect(ops).not.toContain('valuemap')
    expect(ops).toContain('map')
  })

  it('loest alte Namen auf', () => {
    expect(canonicalOp('valuemap')).toBe('map')
    expect(canonicalOp('ucfirst')).toBe('titlecase')
  })
})

describe('Text', () => {
  it('trim', () => {
    expect(run([{ op: 'trim' }], '  Titel  ').value).toBe('Titel')
    expect(run([step({ op: 'trim', chars: '.' })], '..Titel..').value).toBe('Titel')
  })

  it('lowercase und uppercase', () => {
    expect(run([{ op: 'lowercase' }], 'ÄÖÜ Test').value).toBe('äöü test')
    expect(run([{ op: 'uppercase' }], 'äöü test').value).toBe('ÄÖÜ TEST')
  })

  it('titlecase, wahlweise je Wort', () => {
    expect(run([{ op: 'titlecase' }], 'der film').value).toBe('Der film')
    expect(run([step({ op: 'titlecase', words: true })], 'der wilde film').value).toBe('Der Wilde Film')
  })

  it('replace ersetzt woertlich, nicht als Muster', () => {
    expect(run([step({ op: 'replace', search: '.', with: '-' })], 'a.b.c').value).toBe('a-b-c')
  })

  it('regex ersetzt und loest heraus', () => {
    expect(run([step({ op: 'regex', pattern: '\\s+', with: ' ', flags: 'g' })], 'a   b').value).toBe('a b')
    expect(run([step({ op: 'regex', pattern: '(\\d{4})', capture: 1 })], 'ca. 1953, Berlin').value).toBe('1953')
  })

  it('regex meldet ein ungueltiges Muster, statt zu werfen', () => {
    const r = run([step({ op: 'regex', pattern: '([' })], 'x')
    expect(r.errors.length).toBe(1)
    expect(r.value).toBe('x')
  })

  it('prefix und suffix lassen leere Werte in Ruhe', () => {
    expect(run([step({ op: 'prefix', value: 'Nr. ' })], '12').value).toBe('Nr. 12')
    expect(run([step({ op: 'suffix', value: ' m' })], '300').value).toBe('300 m')
    expect(run([step({ op: 'prefix', value: 'Nr. ' })], '').value).toBe('')
  })

  it('substring', () => {
    expect(run([step({ op: 'substring', start: 0, length: 4 })], '1953-04-01').value).toBe('1953')
    expect(run([step({ op: 'substring', start: 5 })], '1953-04-01').value).toBe('04-01')
  })

  it('default greift nur bei leer', () => {
    expect(run([step({ op: 'default', value: 'unbekannt' })], '   ').value).toBe('unbekannt')
    expect(run([step({ op: 'default', value: 'unbekannt' })], 'Titel').value).toBe('Titel')
  })

  it('template setzt in ein Muster ein', () => {
    expect(run([step({ op: 'template', pattern: 'https://x/{value}' })], '7').value).toBe('https://x/7')
  })
})

describe('Struktur', () => {
  it('split trennt, trimmt und wirft Leeres weg', () => {
    expect(run([step({ op: 'split', sep: ';' })], 'a; b;;c ').value).toEqual(['a', 'b', 'c'])
  })

  it('split kann doppelte Werte entfernen', () => {
    expect(run([step({ op: 'split', sep: ';', unique: true })], 'a;b;a').value).toEqual(['a', 'b'])
  })

  it('join fuegt wieder zusammen', () => {
    expect(run([step({ op: 'split', sep: ';' }), step({ op: 'join', sep: ' / ' })], 'a;b').value).toBe('a / b')
  })

  it('take zaehlt ab eins und kann von hinten', () => {
    expect(run([step({ op: 'split', sep: ';' }), step({ op: 'take', index: 1 })], 'a;b;c').value).toBe('a')
    expect(run([step({ op: 'split', sep: ';' }), step({ op: 'take', index: -1 })], 'a;b;c').value).toBe('c')
  })

  it('concat haengt weitere Spalten der Zeile an', () => {
    const r = run([step({ op: 'concat', columns: ['Nachname'], sep: ' ' })], 'Anna',
      { row: { Vorname: 'Anna', Nachname: 'Mueller' } })
    expect(r.value).toBe('Anna Mueller')
  })
})

describe('Typen', () => {
  it('number liest deutsche Dezimalzeichen', () => {
    expect(run([step({ op: 'number', decimal: ',' })], '1.234,5 m').value).toBe(1234.5)
  })

  it('number beanstandet Text', () => {
    const r = run([{ op: 'number' }], 'keine Angabe')
    expect(r.value).toBe('')
    expect(r.errors.length).toBe(1)
  })

  it('boolean erkennt Ja und Nein', () => {
    expect(run([{ op: 'boolean' }], 'ja').value).toBe('true')
    expect(run([step({ op: 'boolean', whenTrue: 'Colour', whenFalse: 'BlackAndWhite' })], 'nein').value)
      .toBe('BlackAndWhite')
    expect(run([{ op: 'boolean' }], 'vielleicht').errors.length).toBe(1)
  })

  it('year loest die Jahreszahl heraus', () => {
    expect(run([step({ op: 'year' })], 'ca. 1953').value).toBe('1953')
  })

  it('date normalisiert die ueblichen Schreibweisen', () => {
    const e: string[] = []
    expect(toIsoDate('12.05.2003', '', e)).toBe('2003-05-12')
    expect(toIsoDate('5.2003', '', e)).toBe('2003-05')
    expect(toIsoDate('2003', '', e)).toBe('2003')
    expect(toIsoDate('05/12/2003', '', e)).toBe('2003-05-12')
    expect(toIsoDate('gedreht 1953', '', e)).toBe('1953')
    expect(e).toEqual([])
  })

  it('date kann ein vorgegebenes Quellformat lesen', () => {
    const e: string[] = []
    expect(toIsoDate('01-02-1960', 'd-m-Y', e)).toBe('1960-02-01')
  })

  it('date beanstandet Unlesbares', () => {
    const e: string[] = []
    expect(toIsoDate('irgendwann', '', e)).toBe('')
    expect(e.length).toBe(1)
  })

  it('duration liefert immer zweistellige ISO-Werte', () => {
    const e: string[] = []
    expect(toIsoDuration('95', 'minutes', e)).toBe('PT01H35M00S')
    expect(toIsoDuration('1:35:00', 'auto', e)).toBe('PT01H35M00S')
    expect(toIsoDuration('35:20', 'auto', e)).toBe('PT00H35M20S')
    expect(toIsoDuration('PT1H5M0S', 'auto', e)).toBe('PT01H05M00S')
    expect(toIsoDuration('PT01H35M00S', 'auto', e)).toBe('PT01H35M00S')
    expect(e).toEqual([])
    expect(secondsToIso(0)).toBe('PT00H00M00S')
  })

  it('country normalisiert und meldet die GND ueber den Nebenkanal', () => {
    const r = run([step({ op: 'country', unknown: 'keep' })], 'DEU', {
      schema: testSchema,
      lookupCountry: (v: string) => (v === 'DEU' ? { name: 'Deutschland', gnd: '4011882-4' } : null)
    })
    expect(r.value).toBe('Deutschland')
    expect(r.enrich[0]).toMatchObject({ id: '4011882-4', category: 'avefi:GNDResource' })
  })

  it('country verwirft oder beanstandet auf Wunsch', () => {
    const ctx = { lookupCountry: () => null }
    expect(run([step({ op: 'country', unknown: 'drop' })], 'Utopia', ctx).value).toBe('')
    expect(run([step({ op: 'country', unknown: 'error' })], 'Utopia', ctx).errors.length).toBe(1)
    expect(run([step({ op: 'country', unknown: 'keep' })], 'Utopia', ctx).value).toBe('Utopia')
  })

  it('language bildet auf ISO 639-2 ab', () => {
    expect(run([{ op: 'language' }], 'Deutsch').value).toBe('ger')
    expect(run([{ op: 'language' }], 'en').value).toBe('eng')
    expect(run([step({ op: 'language', unknown: 'drop' })], 'Klingonisch').value).toBe('')
  })
})

describe('Vokabular', () => {
  it('map ordnet zu und behaelt Unbekanntes als Notiz', () => {
    const chain = [step({ op: 'map', map: { 'sw': 'BlackAndWhite' }, fallback: 'keep_note' })]
    expect(run(chain, 'sw').value).toBe('BlackAndWhite')
    const r = run(chain, 'sepia')
    expect(r.value).toBe('')
    expect(r.notes).toEqual(['sepia'])
  })

  it('map kann Gross- und Kleinschreibung ignorieren', () => {
    expect(run([step({ op: 'map', map: { 'SW': 'BlackAndWhite' }, ci: true })], 'sw').value).toBe('BlackAndWhite')
  })

  it('map kennt die uebrigen Rueckfallwege', () => {
    expect(run([step({ op: 'map', map: {}, fallback: 'keep' })], 'x').value).toBe('x')
    expect(run([step({ op: 'map', map: {}, fallback: 'drop' })], 'x').value).toBe('')
    expect(run([step({ op: 'map', map: {}, fallback: 'error' })], 'x').errors.length).toBe(1)
  })
})

describe('authority reichert an, statt zu ersetzen', () => {
  const chain = [step({ op: 'authority', source: 'gnd', kind: 'person' })]

  it('laesst den Wert unveraendert und meldet den Treffer nebenher', () => {
    const r = run(chain, 'Joachim Masannek', {
      schema: testSchema,
      resolveAuthority: () => ({ id: '123456789', label: 'Masannek, Joachim' })
    })
    expect(r.value).toBe('Joachim Masannek')
    expect(r.enrich).toEqual([{
      value: 'Joachim Masannek',
      category: 'avefi:GNDResource',
      id: '123456789',
      resource: 'GNDResource',
      note: 'Masannek, Joachim',
      origin: 'automatisch'
    }])
  })

  it('bestaetigte Zuordnung schlaegt die Automatik', () => {
    const r = run(chain, 'Anna Mueller', {
      schema: testSchema,
      confirmed: { [compareForm('Anna Mueller')]: { id: '999', type: 'GNDResource', label: 'Mueller, Anna' } },
      resolveAuthority: () => ({ id: 'NICHT-VERWENDEN' })
    })
    expect(r.enrich[0]?.id).toBe('999')
    expect(r.enrich[0]?.origin).toBe('bestaetigt')
  })

  it('bewusst offen gelassene Zuordnung erzeugt keinen Treffer', () => {
    const r = run(chain, 'Anna Mueller', {
      confirmed: { [compareForm('Anna Mueller')]: { id: '', type: 'GNDResource' } },
      resolveAuthority: () => ({ id: '123' })
    })
    expect(r.enrich).toEqual([])
    expect(r.value).toBe('Anna Mueller')
  })

  it('ohne Nachschlagedienst passiert nichts Schlimmes', () => {
    const r = run(chain, 'Anna Mueller')
    expect(r.value).toBe('Anna Mueller')
    expect(r.enrich).toEqual([])
  })
})

describe('Listen und Kettentypen', () => {
  it('bearbeitet Listen elementweise und wirft Leeres heraus', () => {
    const r = run([step({ op: 'split', sep: ';' }), { op: 'trim' }, { op: 'uppercase' }], 'a; b ;c')
    expect(r.value).toEqual(['A', 'B', 'C'])
  })

  it('bestimmt den Ausgabetyp ohne Ausfuehrung', () => {
    expect(chainType([{ op: 'trim' }]).type).toBe('text')
    expect(chainType([step({ op: 'split', sep: ';' })]).type).toBe('list')
    expect(chainType([step({ op: 'split', sep: ';' }), step({ op: 'take', index: 1 })]).type).toBe('text')
    expect(chainType([{ op: 'number' }]).type).toBe('number')
  })

  it('beanstandet eine Kette, die eine Liste an eine Textoperation gibt', () => {
    const r = chainType([step({ op: 'split', sep: ';' }), step({ op: 'split', sep: ',' })])
    expect(r.errors.length).toBe(1)
  })

  it('meldet unbekannte Operationen', () => {
    expect(chainType([step({ op: 'gibtsnicht' })]).errors.length).toBe(1)
    expect(run([step({ op: 'gibtsnicht' })], 'x').errors.length).toBe(1)
  })
})

describe('Reihenfolge der Kette', () => {
  it('meldet einen Schritt, der vor etwas steht, das vor ihm kaeme', () => {
    // Normdaten vor der Normalisierung: gesucht wird der Rohwert, waehrend das
    // Ergebnis der Kette ein anderer Wert ist. Sieht hinterher aus wie
    // "nichts gefunden".
    const befunde = chainOrderIssues([
      { op: 'authority', source: 'gnd', kind: 'place' } as never,
      { op: 'country' } as never
    ])
    expect(befunde.length).toBe(0)

    const falsch = chainOrderIssues([
      { op: 'authority', source: 'gnd', kind: 'place' } as never,
      { op: 'trim' } as never
    ])
    expect(falsch.length).toBe(1)
    expect(falsch[0]?.op).toBe('trim')
    expect(falsch[0]?.after).toBe('authority')
  })

  it('beanstandet Normalisierung nach dem Aufteilen NICHT', () => {
    // "Leerraum entfernen" nach "Aufteilen" wirkt auf jedes Element und ist
    // genau richtig. Eine Regel, die stur eine feste Reihenfolge einfordert,
    // wuerde den Nutzer hier zu einer schlechteren Kette draengen.
    expect(chainOrderIssues([
      { op: 'split', sep: ';' } as never,
      { op: 'trim' } as never
    ])).toEqual([])
  })

  it('laesst die empfohlene Reihenfolge ohne Beanstandung durch', () => {
    const befunde = chainOrderIssues([
      { op: 'trim' } as never,
      { op: 'split', sep: ';' } as never,
      { op: 'country' } as never,
      { op: 'authority', source: 'gnd', kind: 'place' } as never,
      { op: 'take', index: 1 } as never
    ])
    expect(befunde).toEqual([])
  })

  it('kennt zu jedem angebotenen Konverter eine Stelle', () => {
    for (const meta of transformCatalogForEditor()) {
      expect(typeof meta.phase).toBe('number')
    }
  })
})

describe('Spalten verbinden: Artikel und Titel (Sabrina Klewitz, Test 3)', () => {
  it('steht wieder im Katalog des Editors', () => {
    expect(transformCatalogForEditor().map((m) => m.op)).toContain('concat')
  })

  it('setzt den Artikel vor den Titel und laesst einen leeren Artikel weg', () => {
    const kette = [{ op: 'concat', columns: ['Titel'] }]
    const zeile = (Artikel: string, Titel: string) => ({ Artikel, Titel })
    expect(runChain(kette, 'Die', { row: zeile('Die', 'Kinder des Olymp') }).value).toBe('Die Kinder des Olymp')
    expect(runChain(kette, '', { row: zeile('', 'Fahr zur Hölle, Liebling') }).value).toBe('Fahr zur Hölle, Liebling')
  })
})
