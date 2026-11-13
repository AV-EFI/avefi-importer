/*
 * Die satzuebergreifende Pruefung und ihre Buendelung.
 *
 * Anlass ist ein Fehler vom 01.09.2026: Eindeutigkeit der Kennungen,
 * aufloesbare Verweise und „Exemplar je Manifestation" liefen in /check mit,
 * und /check wird in Buendeln zu 500 aufgerufen. Ein Import mit 9.630 Saetzen
 * bekam dadurch 43 Verweisfehler, deren Ziel lediglich im vorigen Buendel lag.
 *
 * Geprueft wird deshalb zweierlei: dass checkRecords den Querlauf auf Wunsch
 * unterlaesst, und dass er, wenn er laeuft, den ganzen Bestand sieht.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { checkCrossref, checkRecords, querSicht } from '../../server/worker/validate'

function kennung(id: string) {
  return { category: 'avefi:LocalResource', id }
}

/** Ein vollstaendiger Satz aus Werk, Manifestation und Exemplar. */
function lieferung(n: number): Record<string, unknown>[] {
  const aus: Record<string, unknown>[] = []
  for (let i = 1; i <= n; i++) {
    aus.push(
      { category: 'avefi:WorkVariant', has_identifier: [kennung(`w${i}`)], has_primary_title: { has_name: `Titel ${i}` } },
      { category: 'avefi:Manifestation', has_identifier: [kennung(`m${i}`)], is_manifestation_of: [kennung(`w${i}`)] },
      { category: 'avefi:Item', has_identifier: [kennung(`i${i}`)], is_item_of: [kennung(`m${i}`)] }
    )
  }
  return aus
}

afterEach(() => {
  vi.unstubAllGlobals()
})

/** Nimmt jeden Aufruf entgegen und antwortet, als sei nichts zu beanstanden. */
function dienstAttrappe() {
  const anrufe: Array<{ pfad: string; anzahl: number; erstesFeld: string[] }> = []
  vi.stubGlobal('fetch', async (url: string, init: { body: string }) => {
    const body = JSON.parse(init.body) as { records: Record<string, unknown>[] }
    anrufe.push({
      pfad: new URL(url).pathname,
      anzahl: body.records.length,
      erstesFeld: Object.keys(body.records[0] ?? {})
    })
    return {
      ok: true,
      json: async () => ({ ok: true, checked: body.records.length, valid: body.records.length, issues: [] })
    }
  })
  return anrufe
}

describe('querSicht', () => {
  it('behaelt nur die Felder, aus denen Kennungen und Verweise gelesen werden', () => {
    const sicht = querSicht({
      category: 'avefi:Manifestation',
      has_identifier: [kennung('m1')],
      is_manifestation_of: [kennung('w1')],
      has_primary_title: { has_name: 'Ein langer Titel' },
      has_note: 'Viel Text, der nicht mitmuss.'
    })
    expect(Object.keys(sicht).sort()).toEqual(['category', 'has_identifier', 'is_manifestation_of'])
  })

  it('erfindet keine Felder, die der Satz nicht hat', () => {
    expect(querSicht({ category: 'avefi:Item' })).toEqual({ category: 'avefi:Item' })
  })
})

describe('checkRecords', () => {
  it('schickt den Querlauf ueber den ganzen Bestand, nicht je Buendel', async () => {
    const anrufe = dienstAttrappe()
    await checkRecords(lieferung(400), {}, 5_000)

    const gebuendelt = anrufe.filter((a) => a.pfad === '/check')
    const quer = anrufe.filter((a) => a.pfad === '/crossref')

    // 1.200 Saetze, Buendel zu 500: drei Anfragen an /check …
    expect(gebuendelt.map((a) => a.anzahl)).toEqual([500, 500, 200])
    // … aber genau eine an /crossref, und die sieht alles.
    expect(quer).toHaveLength(1)
    expect(quer[0]?.anzahl).toBe(1200)
  })

  it('reicht dem Querlauf nur die reduzierte Sicht', async () => {
    const anrufe = dienstAttrappe()
    await checkRecords(lieferung(1), {}, 5_000)
    const quer = anrufe.find((a) => a.pfad === '/crossref')
    expect(quer?.erstesFeld).not.toContain('has_primary_title')
  })

  it('unterlaesst den Querlauf, wenn er ausdruecklich abgeschaltet ist', async () => {
    const anrufe = dienstAttrappe()
    await checkRecords(lieferung(2), {}, 5_000, false)
    expect(anrufe.map((a) => a.pfad)).toEqual(['/check'])
  })

  it('zaehlt einen Satz nur einmal als ungueltig, auch bei zwei Befunden', async () => {
    vi.stubGlobal('fetch', async (url: string, init: { body: string }) => {
      const body = JSON.parse(init.body) as { records: unknown[] }
      const quer = new URL(url).pathname === '/crossref'
      return {
        ok: true,
        json: async () => quer
          ? { checked: body.records.length, issues: [{ severity: 'error', code: 'identifier_not_unique', record: 1, message: 'x' }] }
          : { ok: false, checked: body.records.length, valid: 2, issues: [{ severity: 'error', code: 'schema', record: 1, message: 'y' }] }
      }
    })
    const ergebnis = await checkRecords(lieferung(1), {}, 5_000)
    expect(ergebnis.checked).toBe(3)
    // Satz 1 ist zweimal beanstandet, fehlt aber nur einmal an den gueltigen.
    expect(ergebnis.valid).toBe(2)
    expect(ergebnis.ok).toBe(false)
  })
})

describe('checkCrossref', () => {
  it('fragt bei leerem Bestand gar nicht erst nach', async () => {
    const anrufe = dienstAttrappe()
    const ergebnis = await checkCrossref([], {})
    expect(anrufe).toHaveLength(0)
    expect(ergebnis.issues).toEqual([])
  })

  it('meldet einen nicht erreichbaren Dienst als Warnung, nicht als Fehler', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new Error('Verbindung abgelehnt')
    })
    const ergebnis = await checkCrossref(lieferung(1), {})
    expect(ergebnis.unavailable).toBe('Verbindung abgelehnt')
    expect(ergebnis.issues[0]?.severity).toBe('warning')
    expect(ergebnis.issues[0]?.code).toBe('validation_unavailable')
  })
})
