/* Zielkatalog — Bestand, Frontendform, Wertepruefung. */

import { describe, expect, it } from 'vitest'
import {
  allTargets, expectedChainType, getTarget, levelLabel,
  targetExists, targetsForFrontend, validateTargetValue
} from '../../server/lib/mapping/targets.js'
import { testSchema } from './fixtures.js'

function t(key: string) {
  const target = getTarget(key)
  if (target === undefined) throw new Error(`Ziel fehlt: ${key}`)
  return target
}

describe('Bestand', () => {
  it('kennt 92 Ziele auf drei Ebenen', () => {
    expect(allTargets().length).toBe(92)
    expect(allTargets().filter((x) => x.level === 'work').length).toBe(40)
    expect(allTargets().filter((x) => x.level === 'manifestation').length).toBe(16)
    expect(allTargets().filter((x) => x.level === 'item').length).toBe(36)
  })

  it('bietet je Ebene zwoelf Titelziele an', () => {
    for (const level of ['work', 'manifestation', 'item'] as const) {
      const titel = allTargets().filter((x) => x.level === level && x.key.includes('.title.'))
      expect(titel.length).toBe(12)
      // Genau zwei duerfen auf den einwertigen Primaerplatz: der ebenentypische
      // Titel und der Archivtitel als Ersatz. Die uebrigen zehn sind mehrwertig
      // und koennen sich deshalb nicht gegenseitig verdraengen.
      expect(titel.filter((x) => !x.multi).length).toBe(2)
    }
  })

  it('setzt am Primaerplatz nur die vom Schema vorgesehenen Typen', () => {
    expect(t('work.title.primary').path).toContain('Haupttitel')
    for (const key of ['work.title.supplied', 'manifestation.title.supplied', 'item.title.supplied']) {
      expect(t(key).multi).toBe(false)
    }
  })

  it('bietet has_format je Traegerklasse an und einmal ueber alle (#28)', () => {
    const formats = allTargets().filter((x) => x.key.startsWith('item.format.'))
    expect(formats.length).toBe(7)
    expect(t('item.format.any').type).toBe('format')
    // Die Werteliste haengt an der Klasse, nicht am Wert: "DV" steht in
    // FormatVideoTypeEnum und in FormatDigitalFileTypeEnum.
    expect(t('item.format.film').type).toBe('enum:FormatFilmTypeEnum')
    expect(t('item.format.video').type).toBe('enum:FormatVideoTypeEnum')
    expect(t('item.format.encoding').type).toBe('enum:FormatDigitalFileEncodingTypeEnum')
    expect(formats.every((x) => x.multi)).toBe(true)
    expect(formats.every((x) => x.level === 'item')).toBe(true)
  })

  it('vergibt jeden Schluessel nur einmal', () => {
    const keys = allTargets().map((x) => x.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('kennt alle elf Taetigkeiten', () => {
    expect(allTargets().filter((x) => x.key.startsWith('work.activity.')).length).toBe(11)
  })

  it('nennt im Pfad die Ebene und das Feld, sonst nichts', () => {
    // Die mittlere Ebene war ein reiner Anzeigeeimer ohne Entsprechung im
    // Schema. Sie erzeugte "Werk › Werk › Form" und "Exemplar › Technik ›
    // Farbe" — beides Ebenen, die es nicht gibt.
    expect(t('work.activity.directing').path).toBe('Werk › Regie')
    expect(t('work.form').path).toBe('Werk › Form (Dokumentarfilm, Kurzfilm …)')
    expect(t('item.colour_type').path).toBe('Exemplar › Farbe')
    expect(allTargets().every((x) => x.path.split('›').length === 2)).toBe(true)
    expect(levelLabel('manifestation')).toBe('Manifestation')
  })

  it('meldet unbekannte Schluessel', () => {
    expect(targetExists('gibts.nicht')).toBe(false)
    expect(getTarget('gibts.nicht')).toBeUndefined()
  })
})

describe('Form fuer die Oberflaeche', () => {
  it('gibt die Bauanleitung nicht heraus, dafuer Enums und Muster', () => {
    const list = targetsForFrontend(testSchema)
    const colour = list.find((x) => x.key === 'item.colour_type')
    expect((colour as unknown as Record<string, unknown>)['writer']).toBeUndefined()
    expect(colour?.enumValues).toEqual(['Colour', 'BlackAndWhite'])

    expect(list.find((x) => x.key === 'work.same_as.gnd')?.pattern).toBe('^[-\\dX]+$')
    expect(list.find((x) => x.key === 'item.language.spoken')?.enumValues).toContain('ger')
  })
})

describe('Wertepruefung', () => {
  it('prueft gegen die Werteliste', () => {
    expect(validateTargetValue(t('item.colour_type'), 'Colour', testSchema)).toEqual([])
    expect(validateTargetValue(t('item.colour_type'), 'sepia', testSchema).length).toBe(1)
  })

  it('prueft Kennungen gegen das Muster', () => {
    expect(validateTargetValue(t('work.same_as.gnd'), '118514768', testSchema)).toEqual([])
    expect(validateTargetValue(t('work.same_as.gnd'), 'abc', testSchema).length).toBe(1)
  })

  it('verlangt bei Laufzeiten das zweistellige ISO-Format', () => {
    expect(validateTargetValue(t('item.duration'), 'PT01H30M00S', testSchema)).toEqual([])
    expect(validateTargetValue(t('item.duration'), 'PT1H30M0S', testSchema).length).toBe(1)
  })

  it('laesst JJJJ, JJJJ-MM und JJJJ-MM-TT als Datum durch', () => {
    for (const v of ['1953', '1953-04', '1953-04-01', '1953~']) {
      expect(validateTargetValue(t('work.production.date'), v, testSchema)).toEqual([])
    }
    expect(validateTargetValue(t('work.production.date'), '01.04.1953', testSchema).length).toBe(1)
  })

  it('prueft Sprachcodes gegen das Schema', () => {
    expect(validateTargetValue(t('item.language.spoken'), 'ger', testSchema)).toEqual([])
    expect(validateTargetValue(t('item.language.spoken'), 'deutsch', testSchema).length).toBe(1)
  })

  it('haelt leere Werte fuer unbedenklich', () => {
    expect(validateTargetValue(t('item.colour_type'), '  ', testSchema)).toEqual([])
  })

  it('nennt den erwarteten Kettentyp', () => {
    expect(expectedChainType(t('item.extent.metre'))).toBe('number')
    expect(expectedChainType(t('work.title.primary'))).toBe('text')
  })
})
