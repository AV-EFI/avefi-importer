/*
 * Datensaetze und Normdaten.
 *
 * Die Normdatensuche stand in drei Bauteilen dreimal gleich da — die
 * Datensatzseite, das Normdatenfeld und die Entitaetenzeile. Drei Kopien
 * derselben zwei Zeilen sind drei Gelegenheiten, dass eine zurueckbleibt.
 *
 * Die Antwortformen liegen in shared/types/domain.ts und werden ueber
 * components/records/types.ts weitergereicht.
 */
import type {
  AuthorityDetailResponse, AuthoritySearchResponse, AvefiRecord, CheckResponse, EditorConfig,
  SaveResponse
} from '~/components/records/types'

export function recordsService(): {
  konfigurationPfad: () => string
  datensatzPfad: (importId: string, recordId: string) => string
  pruefen: (datensatz: AvefiRecord) => Promise<CheckResponse>
  speichern: (importId: string, recordId: string, datensatz: AvefiRecord) => Promise<SaveResponse>
  normdatenSuche: (kind: string, q: string) => Promise<AuthoritySearchResponse>
  normdatenDetail: (source: string, id: string) => Promise<AuthorityDetailResponse | null>
} {
  const api = useApi()
  return {
    konfigurationPfad: () => api('/records/config'),
    datensatzPfad: (importId, recordId) => api(`/imports/${importId}/records/${recordId}`),
    pruefen: (datensatz) =>
      $fetch<CheckResponse>(api('/records/validate'), { method: 'POST', body: datensatz as unknown as Record<string, unknown> }),
    speichern: (importId, recordId, datensatz) =>
      $fetch<SaveResponse>(api(`/imports/${importId}/records/${recordId}`),
        { method: 'PUT', body: datensatz as unknown as Record<string, unknown> }),
    normdatenSuche: (kind, q) =>
      $fetch<AuthoritySearchResponse>(api('/records/authority/search'), { query: { kind, q } }),
    // Faellt die Abfrage aus, bleibt der Ausschnitt leer statt die Seite zu
    // stoeren: Ein Normdatensatz ist eine Zugabe, kein Teil des Datensatzes.
    normdatenDetail: (source, id) =>
      $fetch<AuthorityDetailResponse>(api('/records/authority/detail'), { query: { source, id } })
        .catch(() => null)
  }
}

export type { EditorConfig }
