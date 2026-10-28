/*
 * Hoechstlaufzeit des Workers (WORKER_MAX_UPTIME).
 *
 * Bis zum 28.10.2026 stand in main.ts `Number(env || 600) * 1000`. Damit
 * beendete `0` den Worker sofort, und `abc` ergab NaN — der Vergleich
 * `Date.now() - start > NaN` ist immer falsch, der Worker lief also unbegrenzt,
 * ohne dass es jemand merkte.
 */
import { describe, expect, it } from 'vitest'
import { beschreibung, hoechstlaufzeit, VORGABE_SEKUNDEN } from '../../server/worker/laufzeit'

describe('hoechstlaufzeit', () => {
  it('bleibt ohne Angabe bei der bisherigen Vorgabe', () => {
    expect(hoechstlaufzeit(undefined)).toEqual({ ms: VORGABE_SEKUNDEN * 1000, warnung: null })
    expect(hoechstlaufzeit('')).toEqual({ ms: 600_000, warnung: null })
    expect(hoechstlaufzeit('   ')).toEqual({ ms: 600_000, warnung: null })
  })

  it('versteht 0 als „keine Hoechstlaufzeit"', () => {
    const h = hoechstlaufzeit('0')
    expect(h.ms).toBe(Infinity)
    expect(h.warnung).toBeNull()
    expect(beschreibung(h)).toBe('keine')
  })

  it('nimmt eine positive Zahl als Sekunden', () => {
    expect(hoechstlaufzeit('30')).toEqual({ ms: 30_000, warnung: null })
    expect(hoechstlaufzeit(' 3600 ')).toEqual({ ms: 3_600_000, warnung: null })
    expect(beschreibung(hoechstlaufzeit('30'))).toBe('30s')
  })

  it('faellt bei unbrauchbaren Angaben laut auf die Vorgabe zurueck', () => {
    for (const roh of ['abc', '-5', 'Infinity', '10m']) {
      const h = hoechstlaufzeit(roh)
      expect(h.ms, roh).toBe(600_000)
      expect(h.warnung, roh).toContain(roh)
    }
  })

  it('gibt nie NaN zurueck', () => {
    for (const roh of [undefined, '', '0', '1', 'x', '-1', '1e3', 'NaN']) {
      expect(Number.isNaN(hoechstlaufzeit(roh).ms), String(roh)).toBe(false)
    }
  })
})
