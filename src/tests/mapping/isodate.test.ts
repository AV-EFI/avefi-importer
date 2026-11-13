/*
 * „Datum nach ISO“ und die Zielpruefung nach dem Muster des Schemas (#51).
 *
 * Die Faelle stammen aus Luca Wollnys Testdatei vom 12.11.2026: die Beispiele
 * des Typs ISODate, Sonderfaelle und ungueltige Werte. Was der Konverter
 * daraus macht, ist mit Andreas abgestimmt: Schemakonformes bleibt, nur
 * Eindeutiges wird umgewandelt, alles andere entfaellt mit Warnung.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { MappingJson, MappingMessage } from '#shared/types/domain'
import { ISO_DATE_PATTERN, isIsoDate, toIsoDate } from '../../server/lib/mapping/isodate.js'
import { getTarget, validateTargetValue } from '../../server/lib/mapping/targets.js'
import { buildPreview } from '../../server/lib/mapping/preview.js'
import { emptyMapping } from '../../server/lib/mapping/profile.js'
import { ProfileRun, kettenMeldungen } from '../../server/lib/converters/mappingBridge.js'
import { IssueCollector } from '../../server/lib/converters/types.js'
import { testSchema } from './fixtures.js'

function wandle(v: string, from = ''): { wert: string; meldungen: MappingMessage[] } {
  const meldungen: MappingMessage[] = []
  return { wert: toIsoDate(v, from, meldungen), meldungen }
}

describe('Muster aus dem Schema', () => {
  it('stimmt mit ISODate in der Schemadatei ueberein', () => {
    // Aendert sich das Schema, soll dieser Test es sagen, statt dass Konverter
    // und Pruefung still eine andere Regel anwenden als efi-conv.
    const schema = JSON.parse(readFileSync('public/schema/avefi/model.schema.json', 'utf8')) as unknown
    const muster = new Set<string>()
    const sammle = (knoten: unknown): void => {
      if (Array.isArray(knoten)) { knoten.forEach(sammle); return }
      if (typeof knoten !== 'object' || knoten === null) return
      for (const [k, v] of Object.entries(knoten)) {
        if (k === 'pattern' && typeof v === 'string' && v.startsWith('^-?([1-9]')) muster.add(v)
        else sammle(v)
      }
    }
    sammle(schema)
    expect([...muster]).toEqual([ISO_DATE_PATTERN])
  })

  it('kennt die Beispiele des Schemas', () => {
    for (const v of ['2024-04-24', '2024-04', '2024', '2024~', '2024?', '2023/2024']) expect(isIsoDate(v), v).toBe(true)
  })
})

describe('Konverter', () => {
  it('laesst Schemakonformes unveraendert (Lucas Beispiele)', () => {
    for (const v of ['2024', '2024-04', '2024-04-24', '2024~', '2024?', '2024-04~', '2023/2024',
      '2023-11-01/2024-02-15', '1976/1977~']) {
      expect(wandle(v), v).toEqual({ wert: v, meldungen: [] })
    }
  })

  it('wandelt Eindeutiges ohne Meldung um', () => {
    const faelle: Record<string, string> = {
      '2023 / 2024': '2023/2024',
      '1976 - 1977': '1976/1977',
      '1976-1977': '1976/1977',
      '1976–1977': '1976/1977',
      '2023-11-01 - 2024-02-15': '2023-11-01/2024-02-15',
      '2024-4': '2024-04',
      '2024-4-5': '2024-04-05',
      'ca. 1970': '1970~',
      'circa 1970': '1970~',
      'um 1970': '1970~',
      '1962-65': '1962/1965',
      '1962–65': '1962/1965',
      '24.04.2024': '2024-04-24',
      '04.2024': '2024-04'
    }
    for (const [ein, aus] of Object.entries(faelle)) expect(wandle(ein), ein).toEqual({ wert: aus, meldungen: [] })
  })

  it('haelt einen Bindestrich mit Monatszahl fuer einen Monat, nicht fuer einen Zeitraum', () => {
    expect(wandle('1998-05').wert).toBe('1998-05')
    expect(wandle('1962-12').wert).toBe('1962-12')
  })

  it('schneidet die Uhrzeit ab und sagt es', () => {
    for (const v of ['2024-04-24T10:00', '2024-04-24 10:00:00', '2024-04-24T10:00:00Z']) {
      const r = wandle(v)
      expect(r.wert, v).toBe('2024-04-24')
      expect(r.meldungen.map((m) => [m.code, m.severity])).toEqual([['transform.dateTimeDropped', 'info']])
    }
  })

  it('verwirft, was nicht eindeutig umzuwandeln ist, mit Warnung', () => {
    for (const v of ['24', '12024', '2024-13', '2024-00', '2024-04-32', '2024-02-30', '2024/', '50er Jahre',
      '1950er', '1953 (Fassung 1960)', '1965-62', '1990-05-13/1990-13', 'irgendwann']) {
      const r = wandle(v)
      expect(r.wert, v).toBe('')
      expect(r.meldungen.map((m) => [m.code, m.severity]), v).toEqual([['transform.badDate', 'warning']])
    }
  })

  it('nimmt die Jahreszahl aus einem Text nur mit Hinweis', () => {
    const r = wandle('gedreht 1953')
    expect(r.wert).toBe('1953')
    expect(r.meldungen.map((m) => [m.code, m.severity])).toEqual([['transform.dateYearExtracted', 'info']])
  })

  it('kuerzt nie mehr still auf die ersten vier Ziffern', () => {
    // Lucas Spur: `12024` wurde zu `1202`.
    expect(wandle('12024').wert).toBe('')
    expect(wandle('2024~').wert).toBe('2024~')
  })

  it('liest weiter ein vorgegebenes Quellformat', () => {
    expect(wandle('01-02-1960', 'd-m-Y').wert).toBe('1960-02-01')
    expect(wandle('31-02-1960', 'd-m-Y').wert).toBe('')
  })
})

describe('Zielpruefung', () => {
  const ziel = getTarget('work.production.date')!

  it('laesst Zeitraeume und Qualifier zu', () => {
    for (const v of ['1976/1977', '2023-11-01/2024-02-15', '2024?', '2024-04~']) {
      expect(validateTargetValue(ziel, v, testSchema), v).toEqual([])
    }
  })

  it('prueft Monat und Tag', () => {
    for (const v of ['2024-13', '2024-00', '2024-04-32', '2024/']) {
      expect(validateTargetValue(ziel, v, testSchema).map((m) => m.code), v).toEqual(['target.badDate'])
    }
  })
})

describe('Vorschau', () => {
  function vorschau(werte: string[], mitKonverter: boolean) {
    const m: MappingJson = emptyMapping(['Jahr'], '1.2.3')
    m.columns['Jahr'] = {
      pre: mitKonverter ? [{ op: 'date' }] : [],
      targets: [{ target: 'work.production.date', post: [] }]
    }
    return buildPreview({ columns: ['Jahr'], rows: werte.map((Jahr) => ({ Jahr })) }, m, { schema: testSchema })
  }

  it('schlaegt den Konverter nicht vor, wenn die Werte schon schemakonform sind', () => {
    expect(vorschau(['1976/1977', '2024~'], false).checks.some((c) => c.code === 'chain.date')).toBe(false)
    expect(vorschau(['1976 - 1977'], false).checks.some((c) => c.code === 'chain.date')).toBe(true)
  })

  it('zeigt einen ungueltigen Wert ohne Ergebnis, mit Meldung', () => {
    const beispiel = vorschau(['2024-13'], true).columns['Jahr']!.examples[0]!
    expect(beispiel.outputs).toEqual([])
    expect(beispiel.errors.map((e) => e.code)).toEqual(['transform.badDate'])
  })

  it('traegt die Meldung auch dort, wo ein Wert uebernommen wurde', () => {
    const beispiel = vorschau(['2024-04-24T10:00'], true).columns['Jahr']!.examples[0]!
    expect(beispiel.outputs.map((o) => o.value)).toEqual(['2024-04-24'])
    expect(beispiel.errors.map((e) => e.code)).toEqual(['transform.dateTimeDropped'])
  })
})

describe('Pruefbericht', () => {
  function lauf(werte: string[]) {
    const m: MappingJson = emptyMapping(['Jahr'], '1.2.3')
    m.columns['Jahr'] = { pre: [{ op: 'date' }], targets: [{ target: 'work.production.date', post: [] }] }
    const run = new ProfileRun(m, { schema: testSchema })
    const collector = new IssueCollector()
    werte.forEach((Jahr, i) => collector.addAll(run.runRow({ Jahr }, `r${i + 1}`, i + 2).issues))
    return collector
  }

  it('meldet ein verworfenes Datum, statt zu schweigen (Lucas „24“)', () => {
    // Nur die Meldungen der Kette; der Aufbau des Werks meldet daneben eigene.
    const issues = lauf(['24']).all().filter((i) => String(i.code).startsWith('transform.'))
    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({
      severity: 'warning', code: 'transform.badDate', sourceField: 'Jahr', row: 2, value: '24'
    })
  })

  it('fasst gleiche Meldungen einer Spalte zusammen, mit Zahl und Beispielen', () => {
    const c = lauf(['24', '12024', '24', '2024-13', '1953', '2024-04-24T10:00'])
    const warnung = c.all().find((i) => i.code === 'transform.badDate')!
    expect(warnung.params?.['count']).toBe(4)
    expect(warnung.params?.['beispiele']).toBe('24, 12024, 2024-13')
    expect(warnung.row).toBe(2)
    expect(c.all().find((i) => i.code === 'transform.dateTimeDropped')?.severity).toBe('info')
    expect(c.countBySeverity('warning')).toBe(4)
  })

  it('nimmt nur Meldungen der Kette, nicht die des Ziels doppelt', () => {
    const zellen = {
      Jahr: {
        raw: 'x', pre: '', outputs: [],
        errors: [{ code: 'transform.badDate', params: { wert: 'x' } }, { code: 'target.badDate', params: { wert: 'x' } }]
      }
    }
    expect(kettenMeldungen(zellen, 7).map((i) => i.code)).toEqual(['transform.badDate'])
  })
})
