/*
 * Lesende Abfragen der Importe, fuer das Setup einer Seite (#9).
 *
 * Aufteilung: Der Service (services/imports.ts) kennt Adressen, Antwortformen
 * und die schreibenden Aufrufe mit $fetch. Die Composables hier sind der
 * lesende Weg ueber useFetch. Sie laufen wie useFetch selbst im Setup, also
 * beim Serverrendern mit, und reichen das Ergebnis an den Browser weiter.
 * Pages und Layouts rufen kein useFetch mehr auf (tests/frontend/abfragen.test.ts).
 *
 * Jeder Aufruf traegt einen ausdruecklichen Schluessel aus Bereich und
 * Adresse. Er aendert sich, wenn sich die Adresse aendert — genau wie der
 * Schluessel, den Nuxt sonst selbst aus Adresse und Abfrage bildet —, ist aber
 * im Nuxt-Payload lesbar.
 */
import type { MaybeRefOrGetter, Ref } from 'vue'
import { importsService, type ImportMappingResponse } from '~/services/imports'
import type {
  ImportDetailResponse, ImportListResponse, ImportReportResponse, SheetsResponse
} from '~/components/imports/types'
import type { RecordListResponse } from '~/components/records/types'

/** Die Importliste mit Sortierung und Filter aus der Adresse (#2). */
export function useImportListe(auswahl: MaybeRefOrGetter<Record<string, string>>) {
  const importe = importsService()
  const pfad = () => importe.listePfad(toValue(auswahl))
  return useFetch<ImportListResponse>(pfad, {
    key: () => `importe:${pfad()}`,
    default: () => ({
      imports: [],
      sort: { field: 'created' as const, dir: 'desc' as const },
      counts: { total: 0, loaded: 0, shown: 0 },
      kpi: { records: 0, awaiting: 0 }
    })
  })
}

export function useImport(id: MaybeRefOrGetter<string>) {
  const importe = importsService()
  const pfad = () => importe.einerPfad(toValue(id))
  return useFetch<ImportDetailResponse>(pfad, { key: () => `importe:${pfad()}` })
}

export function useImportBericht(id: MaybeRefOrGetter<string>) {
  const importe = importsService()
  const pfad = () => importe.berichtPfad(toValue(id))
  return useFetch<ImportReportResponse>(pfad, { key: () => `importe:${pfad()}` })
}

export function useImportBlaetter(id: MaybeRefOrGetter<string>) {
  const importe = importsService()
  const pfad = () => importe.blaetterPfad(toValue(id))
  return useFetch<SheetsResponse>(pfad, { key: () => `importe:${pfad()}` })
}

export function useImportZuordnung(id: MaybeRefOrGetter<string>) {
  const importe = importsService()
  const pfad = () => importe.zuordnungPfad(toValue(id))
  return useFetch<ImportMappingResponse>(pfad, { key: () => `importe:${pfad()}` })
}

/**
 * Datensaetze eines Imports, gesucht und geblaettert auf dem Server.
 * `q` und `offset` sind Refs der Seite; aendern sie sich, wird neu geladen.
 */
export function useImportDatensaetze(
  id: MaybeRefOrGetter<string>,
  abfrage: { q: Ref<string>; limit: number; offset: Ref<number> }
) {
  const importe = importsService()
  const pfad = () => importe.datensaetzePfad(toValue(id))
  return useFetch<RecordListResponse>(pfad, {
    key: () => `importe:${pfad()}?q=${abfrage.q.value}&limit=${abfrage.limit}&offset=${abfrage.offset.value}`,
    query: { q: abfrage.q, limit: abfrage.limit, offset: abfrage.offset },
    watch: [abfrage.q, abfrage.offset]
  })
}
