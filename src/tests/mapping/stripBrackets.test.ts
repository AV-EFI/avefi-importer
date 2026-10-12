/*
 * Konverter "Klammerzusaetze entfernen" (#27, Luca Wollny am 01.10.2026).
 */

import { describe, expect, it } from 'vitest'
import { runChain, stripBrackets, TRANSFORM_CATALOG } from '../../server/lib/mapping/transform.js'

describe('stripBrackets', () => {
  it('entfernt runde Zusaetze samt dem Leerraum davor', () => {
    expect(stripBrackets('Der blaue Engel (1930)', 'round')).toBe('Der blaue Engel')
    expect(stripBrackets('digitale Datei (mpeg + vob)', 'round')).toBe('digitale Datei')
    expect(stripBrackets('Der Film (1930), Teil 2', 'round')).toBe('Der Film, Teil 2')
  })

  it('traegt verschachtelte Klammern ganz ab — das Regex aus der Mail liess sie halb stehen', () => {
    expect('A (b (c) d) e'.replace(/\s*\([^)]*\)/g, '')).toBe('A d) e')
    expect(stripBrackets('A (b (c) d) e', 'round')).toBe('A e')
  })

  it('beachtet die Klammerart', () => {
    expect(stripBrackets('Titel [Fragment] (1930)', 'round')).toBe('Titel [Fragment]')
    expect(stripBrackets('Titel [Fragment] (1930)', 'square')).toBe('Titel (1930)')
    expect(stripBrackets('Titel [Fragment] (1930)', 'both')).toBe('Titel')
    expect(stripBrackets('Titel (a [b] c)', 'both')).toBe('Titel')
  })

  it('laesst vollstaendig eingeklammerte Werte stehen (Archivtitel, #5)', () => {
    expect(stripBrackets('[Betriebsausflug 1962]', 'square')).toBe('[Betriebsausflug 1962]')
    expect(stripBrackets('(ohne Titel)', 'round')).toBe('(ohne Titel)')
    expect(stripBrackets('((a))', 'round')).toBe('((a))')
  })

  it('nimmt "(a) und (b)" nicht fuer ganz eingeklammert', () => {
    expect(stripBrackets('(a) und (b)', 'round')).toBe('und')
  })

  it('macht aus einem Wert nur aus Klammern keinen leeren', () => {
    expect(stripBrackets('(a) (b)', 'round')).toBe('(a) (b)')
  })

  it('laesst offene Klammern und Werte ohne Klammern unveraendert', () => {
    expect(stripBrackets('Film (1930', 'round')).toBe('Film (1930')
    expect(stripBrackets('Metropolis', 'round')).toBe('Metropolis')
  })

  it('wirkt in der Kette auf jedes Element nach "Aufteilen"', () => {
    const r = runChain(
      [{ op: 'split', sep: '+' }, { op: 'strip_brackets', kind: 'round' }],
      'VHS + DVD + digitale Datei (mpeg)'
    )
    expect(r.value).toEqual(['VHS', 'DVD', 'digitale Datei'])
    expect(r.errors).toEqual([])
  })

  it('steht im Katalog mit Auswahl der Klammerart', () => {
    const meta = TRANSFORM_CATALOG['strip_brackets']
    expect(meta?.group).toBe('Text')
    expect(Object.keys(meta?.params[0]?.choices ?? {})).toEqual(['round', 'square', 'both'])
  })
})
