/*
 * Jedes Ziel des Katalogs hat eine Beschriftung in beiden Sprachen.
 *
 * Gefunden am 12.10.2026 beim Bau von item.format.any (#28): Die sechs
 * Format-Ziele hatten nie einen Eintrag unter mapping.targets. Die Oberflaeche
 * fiel still auf die deutsche Katalogbeschriftung zurueck, auch in der
 * englischen Fassung ("Videoband (BetacamSP, VHS …)"). Der Rueckfall ist
 * Absicht — ein Schluessel in der Oberflaeche waere schlimmer —, aber genau
 * deshalb faellt die Luecke nirgends auf. Hier faellt sie auf.
 */

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { allTargets } from '../../server/lib/mapping/targets.js'

function ziele(sprache: string): Record<string, unknown> {
  return JSON.parse(readFileSync(`i18n/locales/${sprache}/mapping.json`, 'utf8')).mapping.targets
}

function lies(baum: Record<string, unknown>, key: string): unknown {
  return key.split('.').reduce<unknown>(
    (o, teil) => (o !== null && typeof o === 'object' ? (o as Record<string, unknown>)[teil] : undefined),
    baum
  )
}

describe('Beschriftungen der Ziele', () => {
  it('der Katalog ist nicht leer', () => {
    expect(allTargets().length).toBeGreaterThan(50)
  })

  for (const sprache of ['de', 'en']) {
    it(`${sprache}: jedes Ziel hat einen Text unter mapping.targets`, () => {
      const baum = ziele(sprache)
      const ohne = allTargets().map((t) => t.key).filter((k) => typeof lies(baum, k) !== 'string')
      expect(ohne).toEqual([])
    })
  }
})
