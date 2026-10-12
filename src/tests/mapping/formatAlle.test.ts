/*
 * Gemeinsames Format-Ziel ueber alle sechs Traegerklassen (#28, Jasper Stratil
 * am 12.10.2026). Gegen das echte Schema, weil es hier genau auf die
 * Ueberschneidung der sechs Wertelisten ankommt.
 */

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { alleFormatwerte, klaereFormat } from '../../shared/formatklassen.js'
import { createSchemaModel } from '../../server/lib/mapping/schema-model.js'
import { getTarget, targetsForFrontend, validateTargetValue } from '../../server/lib/mapping/targets.js'
import { runRow, staticCheck } from '../../server/lib/mapping/runner.js'
import { emptyMapping } from '../../server/lib/mapping/profile.js'
import { step } from './fixtures.js'

const schema = createSchemaModel(JSON.parse(readFileSync('public/schema/avefi/model.schema.json', 'utf8')))
const liste = (name: string) => schema.enum(name)

describe('klaereFormat', () => {
  it('nimmt einen Wert mit Klasse, wenn er in genau dieser Liste steht', () => {
    expect(klaereFormat('Video:VHS', liste)).toEqual({ ok: true, klasse: 'Video', wert: 'VHS' })
    expect(klaereFormat('Optical:VHS', liste)).toMatchObject({ ok: false, grund: 'unbekannt' })
  })

  it('nimmt einen Wert ohne Klasse, wenn er nur in einer Liste steht', () => {
    expect(klaereFormat('DVD', liste)).toEqual({ ok: true, klasse: 'Optical', wert: 'DVD' })
    expect(klaereFormat('35mmFilm', liste)).toEqual({ ok: true, klasse: 'Film', wert: '35mmFilm' })
  })

  it('raet bei "DV" nicht — er steht bei Video und bei Datei', () => {
    expect(klaereFormat('DV', liste)).toEqual({ ok: false, grund: 'mehrdeutig', klassen: ['Video', 'DigitalFile'] })
    expect(klaereFormat('DigitalFile:DV', liste)).toEqual({ ok: true, klasse: 'DigitalFile', wert: 'DV' })
  })

  it('DV ist die einzige Ueberschneidung im Schema', () => {
    // Kommt eine weitere dazu, muss sie hier bewusst nachgetragen werden.
    const ohneKlasse = alleFormatwerte(liste).map((v) => v.slice(v.indexOf(':') + 1))
    const doppelt = [...new Set(ohneKlasse.filter((w, i) => ohneKlasse.indexOf(w) !== i))]
    expect(doppelt).toEqual(['DV'])
  })
})

describe('Ziel item.format.any', () => {
  const ziel = getTarget('item.format.any')!

  it('bietet die Werte aller sechs Klassen mit Klasse an', () => {
    const fe = targetsForFrontend(schema).find((x) => x.key === 'item.format.any')
    expect(fe?.enumValues?.length).toBe(alleFormatwerte(liste).length)
    expect(fe?.enumValues).toContain('Video:DV')
    expect(fe?.enumValues).toContain('DigitalFile:DV')
    expect(fe?.enumValues?.every((v) => v.includes(':'))).toBe(true)
  })

  it('beanstandet "DV" ohne Klasse als mehrdeutig', () => {
    expect(validateTargetValue(ziel, 'DV', schema).map((m) => m.code)).toEqual(['target.formatAmbiguous'])
    expect(validateTargetValue(ziel, 'Video:DV', schema)).toEqual([])
    expect(validateTargetValue(ziel, 'Kassette', schema).map((m) => m.code)).toEqual(['target.valueNotAllowed'])
  })

  it('schreibt eine gemischte Spalte als ein Exemplar mit mehreren Formaten', () => {
    const m = emptyMapping(['Material'], '1.2.3')
    // Erst die Klammern, dann aufteilen — sonst teilt "+" auch "(mpeg + vob)"
    // und es kommen "digitale Datei (mpeg" und "vob)" an. So steht es auch im
    // Handbuch.
    m.columns['Material'] = {
      pre: [step({ op: 'strip_brackets' }), step({ op: 'split', sep: '+' })],
      targets: [{
        target: 'item.format.any',
        post: [step({
          op: 'map', fallback: 'error',
          map: { VHS: 'Video:VHS', DVD: 'Optical:DVD', 'digitale Datei': 'DigitalFile:VOB' }
        })]
      }]
    }
    const r = runRow(m, { Material: 'VHS + DVD + digitale Datei (mpeg + vob)' }, 'z1', { schema })
    expect(r.errors).toEqual([])
    expect(r.canonical.items[0]?.['has_format']).toEqual([
      { category: 'avefi:Video', type: 'VHS' },
      { category: 'avefi:Optical', type: 'DVD' },
      { category: 'avefi:DigitalFile', type: 'VOB' }
    ])
  })

  it('schreibt einen Schemawert ohne Klasse auch ohne Werteliste', () => {
    const m = emptyMapping(['Format'], '1.2.3')
    m.columns['Format'] = { targets: [{ target: 'item.format.any', post: [] }] }
    const r = runRow(m, { Format: '35mmFilm' }, 'z1', { schema })
    expect(r.canonical.items[0]?.['has_format']).toEqual([{ category: 'avefi:Film', type: '35mmFilm' }])
  })

  it('schreibt einen mehrdeutigen Wert nicht und sagt warum', () => {
    const m = emptyMapping(['Format'], '1.2.3')
    m.columns['Format'] = { targets: [{ target: 'item.format.any', post: [] }] }
    const r = runRow(m, { Format: 'DV' }, 'z1', { schema })
    expect(r.canonical.items[0]?.['has_format']).toBeUndefined()
    expect(r.issues.map((i) => i.code)).toContain('target.formatAmbiguous')
  })

  it('verlangt wie jedes Vokabularziel eine Werteliste', () => {
    const m = emptyMapping(['Format'], '1.2.3')
    m.columns['Format'] = { targets: [{ target: 'item.format.any', post: [] }] }
    expect(staticCheck(m, schema).map((c) => c.code)).toContain('enum.no-valuemap')
  })
})
