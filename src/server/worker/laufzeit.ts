/**
 * Hoechstlaufzeit des Workers aus `WORKER_MAX_UPTIME`.
 *
 * Der Worker beendet sich nach dieser Zeit von selbst und verlaesst sich darauf,
 * dass er neu gestartet wird. Das ist eine Vorkehrung fuer den Entwicklungsbetrieb
 * mit eingehaengtem Code: Ein Dauerprozess haelt alten Code im Speicher.
 *
 * Im Produktivbetrieb ist das unerwuenscht. Unter Kubernetes etwa zaehlt jeder
 * Selbstneustart als Absturz und fuehrt in `CrashLoopBackOff` mit wachsender
 * Wartezeit. Deshalb heisst `0` „keine Hoechstlaufzeit"; das Abbild `worker`
 * setzt diesen Wert. Bis zum 28.10.2026 beendete `0` den Worker sofort.
 *
 *   nicht gesetzt oder leer  600 Sekunden (wie bisher)
 *   0                        keine Hoechstlaufzeit
 *   positive Zahl            so viele Sekunden
 *   alles andere             600 Sekunden, mit Warnung
 */

export const VORGABE_SEKUNDEN = 600

export interface Hoechstlaufzeit {
  /** Millisekunden; `Infinity` ohne Hoechstlaufzeit. */
  ms: number
  /** Gesetzt, wenn die Angabe unbrauchbar war und die Vorgabe gilt. */
  warnung: string | null
}

export function hoechstlaufzeit(roh: string | undefined): Hoechstlaufzeit {
  const text = (roh ?? '').trim()
  if (text === '') return { ms: VORGABE_SEKUNDEN * 1000, warnung: null }
  const sekunden = Number(text)
  if (!Number.isFinite(sekunden) || sekunden < 0) {
    return {
      ms: VORGABE_SEKUNDEN * 1000,
      warnung: `WORKER_MAX_UPTIME="${text}" ist keine Sekundenzahl, es gelten ${VORGABE_SEKUNDEN}.`
    }
  }
  if (sekunden === 0) return { ms: Infinity, warnung: null }
  return { ms: sekunden * 1000, warnung: null }
}

/** Fuer die Startmeldung. */
export function beschreibung(h: Hoechstlaufzeit): string {
  return Number.isFinite(h.ms) ? `${h.ms / 1000}s` : 'keine'
}
