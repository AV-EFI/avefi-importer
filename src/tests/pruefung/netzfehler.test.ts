/*
 * Ursache statt „fetch failed".
 *
 * Anlass ist #39 (03.11.2026): Auf import.av-efi.net erreichte der Worker den
 * Pruefdienst nicht, und im Pruefbericht stand nur „fetch failed". So meldet
 * Node jeden Netzfehler; ob der Name nicht aufloest oder der Port zu ist, steht
 * in `error.cause`. Geprueft wird hier mit echten Fehlern von Node, nicht mit
 * nachgebauten, damit eine Aenderung an Node auffaellt.
 */
import { createServer } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { checkCrossref, checkRecords, netzGrund, pruefdienstStatus } from '../../server/worker/validate'

const satz = { category: 'avefi:WorkVariant', has_identifier: [{ category: 'avefi:LocalResource', id: 'w1' }] }

/** Ein freier Port, auf dem garantiert niemand lauscht. */
async function freierPort(): Promise<number> {
  return await new Promise((fertig) => {
    const server = createServer()
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as { port: number }).port
      server.close(() => fertig(port))
    })
  })
}

async function fehlerVon(url: string, timeoutMs = 2_000): Promise<unknown> {
  try {
    await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
  } catch (e) {
    return e
  }
  throw new Error('Aufruf ist unerwartet gelungen')
}

const altUrl = process.env.EFI_CONV_URL
afterEach(() => {
  if (altUrl === undefined) delete process.env.EFI_CONV_URL
  else process.env.EFI_CONV_URL = altUrl
  vi.restoreAllMocks()
})

describe('netzGrund', () => {
  it('benennt einen nicht aufloesbaren Namen', async () => {
    const grund = netzGrund(await fehlerVon('http://gibt-es-nicht.invalid:8000/health'), 2_000)
    expect(grund).toMatch(/\((ENOTFOUND|EAI_AGAIN)\)$/)
    expect(grund).not.toBe('fetch failed')
  })

  it('benennt eine abgelehnte Verbindung', async () => {
    const port = await freierPort()
    expect(netzGrund(await fehlerVon(`http://127.0.0.1:${port}/health`), 2_000))
      .toBe('Verbindung zum Prüfdienst fehlgeschlagen: Verbindung abgelehnt (ECONNREFUSED)')
  })

  it('benennt eine Zeitueberschreitung mit der Wartezeit', () => {
    const abbruch = new DOMException('This operation was aborted', 'AbortError')
    expect(netzGrund(abbruch, 120_000)).toBe('Zeitüberschreitung: keine Antwort nach 120 s')
    expect(netzGrund(new DOMException('signal timed out', 'TimeoutError'), 5_000))
      .toBe('Zeitüberschreitung: keine Antwort nach 5 s')
  })

  it('nennt einen unbekannten Code, statt ihn zu verschlucken', () => {
    const e = Object.assign(new TypeError('fetch failed'), { cause: { code: 'EPROTO', message: 'x' } })
    expect(netzGrund(e, 1_000)).toBe('Verbindung zum Prüfdienst fehlgeschlagen (EPROTO)')
  })

  it('laesst eigene Meldungen ohne Ursache stehen', () => {
    expect(netzGrund(new Error('efi-conv antwortete mit HTTP 502.'), 1_000)).toBe('efi-conv antwortete mit HTTP 502.')
    expect(netzGrund('kaputt', 1_000)).toBe('kaputt')
  })

  it('nennt die Adresse des Dienstes nicht', async () => {
    const grund = netzGrund(await fehlerVon('http://geheimer-name.invalid:8000/health'), 2_000)
    expect(grund).not.toContain('geheimer-name')
  })
})

describe('Pruefbericht und Log bei unerreichbarem Dienst', () => {
  it('traegt die Ursache in beide Warnungen ein und schreibt die Adresse nur ins Log', async () => {
    process.env.EFI_CONV_URL = `http://127.0.0.1:${await freierPort()}`
    const log = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const schema = await checkRecords([satz], {}, 2_000)
    const quer = await checkCrossref([satz], {}, 2_000)

    for (const issue of [...schema.issues, ...quer.issues]) {
      expect(issue.code).toBe('validation_unavailable')
      expect(issue.detail).toContain('ECONNREFUSED')
      expect(issue.detail).not.toContain('127.0.0.1')
    }
    const zeilen = log.mock.calls.map((c) => String(c[0]))
    expect(zeilen.some((z) => z.startsWith(`[pruefung] ${process.env.EFI_CONV_URL}/check: `))).toBe(true)
    expect(zeilen.some((z) => z.startsWith(`[pruefung] ${process.env.EFI_CONV_URL}/crossref: `))).toBe(true)
  })
})

describe('pruefdienstStatus', () => {
  it('meldet einen unerreichbaren Dienst mit Grund, ohne zu werfen', async () => {
    process.env.EFI_CONV_URL = `http://127.0.0.1:${await freierPort()}`
    const status = await pruefdienstStatus(2_000)
    expect(status.erreichbar).toBe(false)
    if (!status.erreichbar) expect(status.grund).toContain('ECONNREFUSED')
  })

  it('liest die Schemaversion, wenn der Dienst antwortet', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ schema: { version: '1.2.3' } })))
    expect(await pruefdienstStatus()).toEqual({ erreichbar: true, version: '1.2.3' })
  })
})
