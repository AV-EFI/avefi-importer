/*
 * HTTP: Zeitlimit, hoeflicher User-Agent, Wiederholung nur bei sinnvollen
 * Fehlern. Es wird nichts wirklich abgerufen — fetch ist eingehaengt.
 */

import { describe, expect, it, vi } from 'vitest'
import {
  AUTHORITY_USER_AGENT, AuthorityHttpError, authorityUserAgent, createFetchJson, mediaWikiFehler, retryAfterMs,
  statusRetryable
} from '../../server/lib/authority/http.js'

function antwort(status: number, body: unknown = {}, headers: Record<string, string> = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
    json: async () => body
  } as unknown as Response
}

const sofort = async (): Promise<void> => { /* kein echtes Warten im Test */ }

describe('Wiederholung', () => {
  it('wiederholt bei 503 und liefert dann das Ergebnis', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(antwort(503))
      .mockResolvedValueOnce(antwort(200, { member: [] }))
    const get = createFetchJson({ fetchImpl: fetchImpl as unknown as typeof fetch, sleep: sofort })

    expect(await get('https://lobid.org/gnd/search')).toEqual({ member: [] })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('wiederholt bei 429', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(antwort(429, {}, { 'retry-after': '1' }))
      .mockResolvedValueOnce(antwort(200, { ok: true }))
    const get = createFetchJson({ fetchImpl: fetchImpl as unknown as typeof fetch, sleep: sofort })

    expect(await get('https://viaf.org/x')).toEqual({ ok: true })
  })

  it('wiederholt NICHT bei 404 — da hilft kein zweiter Versuch', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(antwort(404))
    const get = createFetchJson({ fetchImpl: fetchImpl as unknown as typeof fetch, sleep: sofort })

    await expect(get('https://lobid.org/gnd/gibtsnicht.json')).rejects.toThrow(AuthorityHttpError)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('wiederholt bei Netzabbruch und gibt danach auf', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('ECONNRESET'))
    const get = createFetchJson({ fetchImpl: fetchImpl as unknown as typeof fetch, sleep: sofort, retries: 2 })

    await expect(get('https://lobid.org/gnd/search')).rejects.toThrow('ECONNRESET')
    expect(fetchImpl).toHaveBeenCalledTimes(3)
  })

  it('gibt ohne Wiederholung auf, wenn retries auf 0 steht', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(antwort(500))
    const get = createFetchJson({ fetchImpl: fetchImpl as unknown as typeof fetch, sleep: sofort, retries: 0 })

    await expect(get('https://lobid.org/x')).rejects.toThrow(AuthorityHttpError)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
})

// #38 (10.11.2026): Wikidata antwortet bei Ueberlast mit HTTP 200 und einem
// Fehler im Rumpf. Bis dahin wurde daraus „kein Treffer“ und gespeichert.
describe('Fehlerantworten mit HTTP 200', () => {
  const maxlag = { error: { code: 'maxlag', info: 'Waiting for 10.64.16.215: 0.52 seconds lagged.' } }

  it('erkennt den Fehler im Rumpf', () => {
    expect(mediaWikiFehler(maxlag)).toBe('maxlag')
    expect(mediaWikiFehler({ search: [] })).toBeNull()
    expect(mediaWikiFehler({ error: 'nur ein Text' })).toBeNull()
    expect(mediaWikiFehler(null)).toBeNull()
  })

  it('wiederholt und liefert dann das Ergebnis', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(antwort(200, maxlag, { 'retry-after': '1' }))
      .mockResolvedValueOnce(antwort(200, { search: [] }))
    const get = createFetchJson({ fetchImpl: fetchImpl as unknown as typeof fetch, sleep: sofort })
    expect(await get('https://www.wikidata.org/w/api.php')).toEqual({ search: [] })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('wirft, statt eine leere Antwort zu liefern, wenn der Fehler bleibt', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(antwort(200, maxlag))
    const get = createFetchJson({ fetchImpl: fetchImpl as unknown as typeof fetch, sleep: sofort, retries: 2 })
    await expect(get('https://www.wikidata.org/w/api.php')).rejects.toThrow('maxlag')
    expect(fetchImpl).toHaveBeenCalledTimes(3)
  })
})

describe('Hoeflichkeit', () => {
  it('schickt User-Agent und Accept mit', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(antwort(200, {}))
    const get = createFetchJson({ fetchImpl: fetchImpl as unknown as typeof fetch, sleep: sofort })
    await get('https://lobid.org/gnd/search')

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
    const headers = init.headers as Record<string, string>
    expect(headers['user-agent']).toBe(AUTHORITY_USER_AGENT)
    expect(headers['accept']).toBe('application/json')
  })

  it('der User-Agent nennt einen Kontaktweg', () => {
    expect(AUTHORITY_USER_AGENT).toMatch(/^AVefiImporter\/\d/)
    expect(AUTHORITY_USER_AGENT).toContain('+http')
  })

  it('verweist nicht mehr auf die Demo, sondern auf das Repository', () => {
    expect(AUTHORITY_USER_AGENT).not.toContain('goo1.de')
    expect(AUTHORITY_USER_AGENT).toContain('github.com/AV-EFI/avefi-importer')
  })

  it('nimmt den User-Agent des Betreibers aus AUTHORITY_USER_AGENT', () => {
    expect(authorityUserAgent({ AUTHORITY_USER_AGENT: 'AVefiImporter/2.0 (+mailto:betrieb@example.org)' }))
      .toBe('AVefiImporter/2.0 (+mailto:betrieb@example.org)')
    expect(authorityUserAgent({ AUTHORITY_USER_AGENT: '  ' })).toBe(AUTHORITY_USER_AGENT)
    expect(authorityUserAgent({})).toBe(AUTHORITY_USER_AGENT)
  })

  it('haengt jeder Anfrage ein Zeitlimit an', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(antwort(200, {}))
    const get = createFetchJson({ fetchImpl: fetchImpl as unknown as typeof fetch, sleep: sofort })
    await get('https://lobid.org/gnd/search')

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })
})

describe('Abbruch', () => {
  it('bricht ab, wenn das Signal schon ausgeloest ist', async () => {
    const controller = new AbortController()
    controller.abort()
    const fetchImpl = vi.fn()
    const get = createFetchJson({
      fetchImpl: fetchImpl as unknown as typeof fetch, sleep: sofort, signal: controller.signal
    })

    await expect(get('https://lobid.org/x')).rejects.toThrow('Abgebrochen')
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})

describe('Hilfsfunktionen', () => {
  it('kennt die Statuscodes, bei denen ein zweiter Versuch etwas bringt', () => {
    expect(statusRetryable(429)).toBe(true)
    expect(statusRetryable(500)).toBe(true)
    expect(statusRetryable(503)).toBe(true)
    expect(statusRetryable(404)).toBe(false)
    expect(statusRetryable(400)).toBe(false)
    expect(statusRetryable(403)).toBe(false)
  })

  it('liest Retry-After in Sekunden und deckelt die Wartezeit', () => {
    expect(retryAfterMs('2')).toBe(2000)
    expect(retryAfterMs('9999')).toBe(4000)
    expect(retryAfterMs(null)).toBeNull()
    expect(retryAfterMs('unfug')).toBeNull()
  })
})
