/*
 * HTTP fuer die Normdatenquellen.
 *
 * Regeln, die hier durchgesetzt werden:
 *   - Zeitlimit je Anfrage, damit ein haengender Dienst nicht den Worker blockiert.
 *   - Hoeflicher User-Agent mit Kontaktweg. lobid und Wikidata bitten darum,
 *     und ohne einen solchen wird man frueher oder spaeter ausgesperrt.
 *   - Wiederholung nur, wo sie sinnvoll ist: Netzabbruch, Zeitueberschreitung,
 *     429 und 5xx. Ein 404 wird nicht wiederholt.
 *   - Fehler werden geworfen, nicht verschluckt. Wer aufloest, faengt sie und
 *     liefert "kein Treffer" — der Import kippt daran nicht.
 */

/** Holt eine JSON-Antwort. Wirft bei Misserfolg. */
export type FetchJson = (url: string) => Promise<unknown>

/**
 * Voreinstellung des User-Agents. Bis zum 10.11.2026 stand hier die Adresse
 * der Demo (avefiimporter.goo1.de), auch in der Produktion der TIB. Jetzt das
 * Repository; der Betreiber setzt mit AUTHORITY_USER_AGENT seine eigene
 * Kontaktangabe, wie es lobid und die Wikimedia-Richtlinie erbitten.
 */
export const AUTHORITY_USER_AGENT = 'AVefiImporter/2.0 (+https://github.com/AV-EFI/avefi-importer)'

/** User-Agent aus der Umgebung, sonst die Voreinstellung. */
export function authorityUserAgent(env: Record<string, string | undefined> = process.env): string {
  const wert = (env['AUTHORITY_USER_AGENT'] ?? '').trim()
  return wert === '' ? AUTHORITY_USER_AGENT : wert
}

/** Voreinstellungen; bewusst knapp, es haengt ein Worker-Job daran. */
export const DEFAULT_TIMEOUT_MS = 6000
export const DEFAULT_RETRIES = 2
export const DEFAULT_BACKOFF_MS = 250
/** Laenger als das wartet niemand auf einen Retry-After-Hinweis. */
export const MAX_BACKOFF_MS = 4000

export class AuthorityHttpError extends Error {
  readonly status: number
  readonly retryable: boolean

  constructor(message: string, status: number, retryable: boolean) {
    super(message)
    this.name = 'AuthorityHttpError'
    this.status = status
    this.retryable = retryable
  }
}

/** Statuscodes, bei denen ein zweiter Versuch etwas bringen kann. */
export function statusRetryable(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500
}

export interface HttpOptions {
  timeoutMs?: number
  retries?: number
  userAgent?: string
  backoffMs?: number
  /** Bricht alles ab, etwa wenn der Import abgebrochen wird. */
  signal?: AbortSignal
  /** Nur fuer Tests: ersetzt das globale fetch. */
  fetchImpl?: typeof fetch
  /** Nur fuer Tests: ersetzt das Warten zwischen zwei Versuchen. */
  sleep?: (ms: number) => Promise<void>
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Wartezeit aus Retry-After lesen (Sekunden oder Datum), sonst null. */
export function retryAfterMs(header: string | null): number | null {
  if (header === null || header.trim() === '') return null
  const seconds = Number(header.trim())
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, MAX_BACKOFF_MS)
  const at = Date.parse(header)
  if (Number.isFinite(at)) return Math.min(Math.max(at - Date.now(), 0), MAX_BACKOFF_MS)
  return null
}

/**
 * Baut eine Holfunktion mit Zeitlimit, User-Agent und Wiederholung.
 * Jede Quelle bekommt dieselbe, damit sich Verhalten und Hoeflichkeit nicht
 * je Datei unterscheiden.
 */
export function createFetchJson(options: HttpOptions = {}): FetchJson {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const retries = options.retries ?? DEFAULT_RETRIES
  const backoffMs = options.backoffMs ?? DEFAULT_BACKOFF_MS
  const userAgent = options.userAgent ?? authorityUserAgent()
  const doFetch = options.fetchImpl ?? fetch
  const sleep = options.sleep ?? wait

  return async function fetchJson(url: string): Promise<unknown> {
    let lastError: unknown = null

    for (let attempt = 0; attempt <= retries; attempt++) {
      if (options.signal?.aborted === true) throw new AuthorityHttpError('Abgebrochen', 0, false)
      const timer = AbortSignal.timeout(timeoutMs)
      const signal = options.signal !== undefined
        ? AbortSignal.any([timer, options.signal])
        : timer

      try {
        const res = await doFetch(url, {
          signal,
          redirect: 'follow',
          headers: { accept: 'application/json', 'user-agent': userAgent }
        })
        if (!res.ok) {
          const retryable = statusRetryable(res.status)
          const err = new AuthorityHttpError(`HTTP ${res.status} bei ${url}`, res.status, retryable)
          if (!retryable || attempt === retries) throw err
          lastError = err
          const hinted = retryAfterMs(res.headers.get('retry-after'))
          await sleep(hinted ?? Math.min(backoffMs * 2 ** attempt, MAX_BACKOFF_MS))
          continue
        }
        const body: unknown = await res.json()
        // MediaWiki meldet Fehler mit HTTP 200 und `{"error": {"code": …}}`
        // im Rumpf (Ueberlast `maxlag`, Drosselung). Bis zum 10.11.2026 las
        // der Aufrufer daraus eine leere Trefferliste, also „kein Treffer“ —
        // und das wurde zwischengespeichert. Eine Stoerung wurde so zur
        // dauerhaften Aussage (#38). Jetzt ist es ein Fehlschlag wie ein 5xx.
        const apiFehler = mediaWikiFehler(body)
        if (apiFehler !== null) {
          const err = new AuthorityHttpError(`API-Fehler „${apiFehler}“ bei ${url}`, res.status, true)
          if (attempt === retries) throw err
          lastError = err
          const hinted = retryAfterMs(res.headers.get('retry-after'))
          await sleep(hinted ?? Math.min(backoffMs * 2 ** attempt, MAX_BACKOFF_MS))
          continue
        }
        return body
      } catch (e) {
        // Ein 4xx kommt hier als AuthorityHttpError wieder an und wird durchgereicht.
        if (e instanceof AuthorityHttpError && !e.retryable) throw e
        lastError = e
        if (attempt === retries) break
        await sleep(Math.min(backoffMs * 2 ** attempt, MAX_BACKOFF_MS))
      }
    }

    if (lastError instanceof Error) throw lastError
    throw new AuthorityHttpError(`Keine Antwort von ${url}`, 0, true)
  }
}

/**
 * Fehlercode einer MediaWiki-Antwort (`{"error": {"code": "maxlag", …}}`),
 * sonst null. lobid und VIAF liefern diese Form nicht; fuer sie aendert sich
 * nichts.
 */
export function mediaWikiFehler(body: unknown): string | null {
  const fehler = asRecord(asRecord(body)['error'])
  const code = fehler['code']
  return typeof code === 'string' && code !== '' ? code : null
}

/* ------------------------------------------------------- Lesehilfen fuer JSON */

export function asRecord(v: unknown): Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

export function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : []
}

export function asText(v: unknown): string {
  return typeof v === 'string' ? v : typeof v === 'number' ? String(v) : ''
}
