/*
 * Lesende Abfrage des Systemzustands (#9, #19). Aufteilung und Schluessel wie
 * in useImporte.ts beschrieben.
 */
import { systemService, type VorgabewerteAntwort } from '~/services/system'

/**
 * Befunde der Startpruefung. Nur im Browser geladen und mit leerem Vorgabewert:
 * Der Hinweisstreifen ist eine Beigabe. Antwortet der Endpunkt nicht, faellt
 * er weg und nicht die Seite.
 */
export function useVorgabewerte() {
  const pfad = systemService().vorgabewertePfad()
  return useFetch<VorgabewerteAntwort>(pfad, {
    key: `system:${pfad}`,
    default: () => ({ befunde: [] }),
    server: false,
    immediate: true
  })
}
