/*
 * Werteliste und Normdatenliste fragen dasselbe: Welche Werte kommen an diesem
 * Schritt an? (#26, Luca Wollny am 01.10.2026)
 *
 * Bis zum 12.10.2026 rechnete nur die Normdatenliste die Kette bis vor den
 * Schritt. Die Werteliste bot die Rohwerte der Spalte an — hinter "Aufteilen"
 * also Zeilen wie "VHS + DVD", die zur Laufzeit nie ankommen. Diese Tests
 * halten beide Antworten gegeneinander und gegen die Laufzeit.
 */

import { describe, expect, it } from 'vitest'
import { authorityInventory, runRow, stepInputs, vocabInventory } from '../../server/lib/mapping/runner.js'
import { emptyMapping } from '../../server/lib/mapping/profile.js'
import { step, testSchema } from './fixtures.js'

const rows = [
  { Material: 'VHS + DVD' },
  { Material: 'VHS' },
  { Material: ' DVD + digitale Datei ' }
]

function geteilt(post: Array<Record<string, unknown>>) {
  const m = emptyMapping(['Material'], '1.2.3')
  m.columns['Material'] = {
    pre: [step({ op: 'trim' }), step({ op: 'split', sep: '+' })],
    targets: [{ target: 'item.format.video', post: post.map((p) => step(p)) }]
  }
  return m
}

describe('vocabInventory', () => {
  it('bietet hinter "Aufteilen" die Teile an, nicht die Rohzeilen', () => {
    const m = geteilt([{ op: 'map', map: {}, fallback: 'keep_note' }])
    const [gruppe] = vocabInventory(m, rows)
    expect(gruppe).toMatchObject({ column: 'Material', branch: 0, at: 0 })
    expect(gruppe?.values).toEqual([
      { value: 'DVD', count: 2 },
      { value: 'VHS', count: 2 },
      { value: 'digitale Datei', count: 1 }
    ])
  })

  it('meldet einen Schritt der gemeinsamen Kette einmal, nicht je Zweig', () => {
    const m = emptyMapping(['Material'], '1.2.3')
    m.columns['Material'] = {
      pre: [step({ op: 'split', sep: '+' }), step({ op: 'map', map: {}, fallback: 'keep' })],
      targets: [{ target: 'item.format.video', post: [] }, { target: 'item.format.optical', post: [] }]
    }
    const gruppen = vocabInventory(m, rows)
    expect(gruppen.map((g) => [g.branch, g.at])).toEqual([[-1, 1]])
  })

  it('am ersten Schritt sind es die Rohwerte', () => {
    const m = emptyMapping(['Material'], '1.2.3')
    m.columns['Material'] = { targets: [{ target: 'item.format.video', post: [step({ op: 'map', map: {} })] }] }
    expect(vocabInventory(m, [{ Material: 'VHS + DVD' }])[0]?.values).toEqual([{ value: 'VHS + DVD', count: 1 }])
  })

  it('jeder angebotene Wert trifft zur Laufzeit', () => {
    // Die eigentliche Pruefung: Was die Tabelle anbietet und zugeordnet wird,
    // kommt im Datensatz an — kein Wert faellt in die Notiz.
    const angebot = vocabInventory(geteilt([{ op: 'map', map: {} }]), rows)[0]?.values ?? []
    const map = Object.fromEntries(angebot.map((v) => [v.value, v.value === 'DVD' ? 'DVCAM' : 'VHS']))
    const m = geteilt([{ op: 'map', map, fallback: 'error' }])
    const formate = rows.map((row, i) => {
      const r = runRow(m, row, `z${i}`, { schema: testSchema })
      expect(r.errors).toEqual([])
      return ((r.canonical.items[0]?.['has_format'] ?? []) as Array<{ type: string }>).map((f) => f.type)
    })
    expect(formate).toEqual([['VHS', 'DVCAM'], ['VHS'], ['DVCAM', 'VHS']])
  })
})

describe('stepInputs: eine Antwort fuer Werteliste und Normdaten', () => {
  it('Werteliste und Normdatenliste sehen an derselben Stelle dieselben Werte', () => {
    const fuer = (op: Record<string, unknown>) => {
      const m = emptyMapping(['Ort'], '1.2.3')
      m.columns['Ort'] = {
        pre: [step({ op: 'trim' }), step({ op: 'split', sep: '/' })],
        targets: [{ target: 'work.production.place', post: [step(op)] }]
      }
      return m
    }
    const zeilen = [{ Ort: 'Berlin / Paris' }, { Ort: 'Berlin' }, { Ort: 'Rom/Paris' }]
    const vocab = vocabInventory(fuer({ op: 'map', map: {} }), zeilen)[0]?.values ?? []
    const auth = authorityInventory(fuer({ op: 'authority', source: 'gnd', kind: 'place' }), zeilen)[0]?.values ?? []
    expect(vocab.map((v) => [v.value, v.count])).toEqual(auth.map((v) => [v.value, v.count]))
  })

  it('nennt die Stelle in der eigenen Kette, nicht in der zusammengesetzten', () => {
    const m = geteilt([{ op: 'trim' }, { op: 'map', map: {} }])
    const [s] = stepInputs(m, rows, (op) => op === 'map')
    expect(s?.at).toBe(1)
    expect(s?.branch).toBe(0)
  })
})
