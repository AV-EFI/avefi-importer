/*
 * Wohin ein Klappmenue passt (#30).
 */
import { describe, expect, it } from 'vitest'
import { klappPlatz } from '../../app/utils/klappplatz'

const FENSTER = 800

describe('klappPlatz', () => {
  it('bleibt unten, wenn es dort passt', () => {
    expect(klappPlatz({ top: 100, bottom: 132 }, 300, FENSTER)).toEqual({ oben: false, maxHoehe: 654 })
  })

  it('klappt nach oben, wenn unten zu wenig und oben mehr Platz ist — Lucas Fall', () => {
    // Knopf 40 px ueber der Unterkante, Auswahl 393 px hoch (gemessen auf der Demo)
    const lage = klappPlatz({ top: 728, bottom: 760 }, 393, FENSTER)
    expect(lage.oben).toBe(true)
    expect(lage.maxHoehe).toBe(714)
  })

  it('begrenzt die Hoehe auf den Platz, wenn er auf keiner Seite reicht', () => {
    const lage = klappPlatz({ top: 300, bottom: 332 }, 2000, FENSTER)
    expect(lage).toEqual({ oben: false, maxHoehe: 454 })
  })

  it('klappt nicht nach oben, wenn oben noch weniger Platz ist', () => {
    const lage = klappPlatz({ top: 120, bottom: 152 }, 900, FENSTER)
    expect(lage.oben).toBe(false)
  })

  it('wird nie kleiner als die Mindesthoehe — dann rollt die Seite', () => {
    const lage = klappPlatz({ top: 40, bottom: 790 }, 500, FENSTER)
    expect(lage.maxHoehe).toBe(160)
  })
})
