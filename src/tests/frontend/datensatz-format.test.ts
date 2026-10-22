/*
 * Format im Datensatzeditor (#28, Jasper Stratil am 13.10.2026).
 *
 * Bis dahin reichte der Editor `has_format` am Exemplar unsichtbar durch: Es
 * ging nichts verloren, aber niemand konnte es sehen oder aendern. Gefuehrt wird
 * es jetzt als „Klasse:Wert", wie am Ziel „Format (alle Traegerklassen)".
 */
import { describe, expect, it } from 'vitest'
import { emptyFormat, parseRecord, serializeRecord } from '../../app/components/records/model'
import type { EditorConfig } from '../../app/components/records/types'

const config: EditorConfig = {
  schemaVersion: null,
  schemaError: null,
  enums: {
    FormatVideoTypeEnum: ['VHS', 'DV', 'BetacamSP'],
    FormatDigitalFileTypeEnum: ['DV', 'MP4', 'VOB'],
    FormatOpticalTypeEnum: ['DVD', 'BluRay']
  },
  subjectKinds: [],
  activityCategories: [],
  eventCategories: [],
  resourceTypes: {},
  targets: []
}

function datensatz(formate: unknown[]) {
  return {
    work: { category: 'avefi:WorkVariant', type: 'Monographic', has_primary_title: { has_name: 'T', type: 'PreferredTitle' } },
    manifestations: [{ category: 'avefi:Manifestation', is_manifestation_of: [] }],
    items: [{ category: 'avefi:Item', is_item_of: { id: 'm' }, has_format: formate }]
  } as never
}

describe('Format am Exemplar', () => {
  it('liest has_format als „Klasse:Wert"', () => {
    const ui = parseRecord(datensatz([
      { category: 'avefi:Video', type: 'VHS' },
      { category: 'avefi:DigitalFile', type: 'DV' }
    ]), config)
    expect(ui.items[0]!.formats.map((f) => f.value)).toEqual(['Video:VHS', 'DigitalFile:DV'])
  })

  it('schreibt unveraendert zurueck, was es gelesen hat', () => {
    const roh = [{ category: 'avefi:Video', type: 'VHS' }, { category: 'avefi:Optical', type: 'DVD' }]
    const aus = serializeRecord(parseRecord(datensatz(roh), config), config)
    expect(aus.items[0]!['has_format']).toEqual(roh)
  })

  it('schreibt einen neu gewaehlten Wert mit seiner Klasse', () => {
    const ui = parseRecord(datensatz([]), config)
    const f = emptyFormat()
    f.value = 'Optical:BluRay'
    ui.items[0]!.formats.push(f)
    expect(serializeRecord(ui, config).items[0]!['has_format']).toEqual([{ category: 'avefi:Optical', type: 'BluRay' }])
  })

  it('loest einen Wert ohne Klasse auf, wenn er nur in einer Liste steht', () => {
    const ui = parseRecord(datensatz([]), config)
    const f = emptyFormat()
    f.value = 'MP4'
    ui.items[0]!.formats.push(f)
    expect(serializeRecord(ui, config).items[0]!['has_format']).toEqual([{ category: 'avefi:DigitalFile', type: 'MP4' }])
  })

  it('verwirft nichts, was sich nicht aufloesen laesst — der gelesene Knoten bleibt', () => {
    const roh = { category: 'avefi:Unbekannt', type: 'X', note: 'aus der Quelle' }
    const ui = parseRecord(datensatz([roh]), config)
    expect(ui.items[0]!.formats[0]!.value).toBe('Unbekannt:X')
    // „Unbekannt" ist keine Traegerklasse; teileFormatwert liefert keine Klasse,
    // klaereFormat findet nichts — der Knoten wird nicht umgeschrieben.
    expect(serializeRecord(ui, config).items[0]!['has_format']).toEqual([roh])
  })

  it('leere Eintraege und Doppelte fallen weg', () => {
    const ui = parseRecord(datensatz([{ category: 'avefi:Video', type: 'VHS' }]), config)
    const leer = emptyFormat()
    const doppelt = emptyFormat()
    doppelt.value = 'Video:VHS'
    ui.items[0]!.formats.push(leer, doppelt)
    expect(serializeRecord(ui, config).items[0]!['has_format']).toEqual([{ category: 'avefi:Video', type: 'VHS' }])
  })

  it('ohne Formate steht kein leeres has_format im Datensatz', () => {
    const aus = serializeRecord(parseRecord(datensatz([]), config), config)
    expect(aus.items[0]!).not.toHaveProperty('has_format')
  })
})
