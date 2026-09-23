/*
 * Systemzustand: was beim Start der Anwendung aufgefallen ist (#19).
 *
 * Der Pfad stand bis zum 23.09.2026 als festes '/api/system/vorgabewerte' im
 * Layout — die einzige Adresse der Oberflaeche, die an useApi() vorbeiging
 * und damit die konfigurierbare API-Basis nicht kannte.
 */
import type { Vorgabebefund } from '~/components/imports/types'

export interface VorgabewerteAntwort {
  befunde: Vorgabebefund[]
}

export function systemService(): {
  vorgabewertePfad: () => string
} {
  const api = useApi()
  return {
    vorgabewertePfad: () => api('/system/vorgabewerte')
  }
}
