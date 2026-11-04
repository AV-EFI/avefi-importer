/*
 * Institutionen anlegen, umbenennen, leere loeschen (#43).
 *
 * Eigene Datei und eigene Abfrage, unabhaengig von der Kontenliste: Die Karte
 * steht heute unter den Konten, soll aber ohne Umbau auf eine eigene Seite
 * ziehen koennen, wenn es viele Konten werden.
 */
import type { InstitutionMitBelegung } from '#shared/types/domain'

export interface InstitutionenResponse {
  institutions: InstitutionMitBelegung[]
}

export function institutionenService(): {
  listePfad: () => string
  anlegen: (name: string) => Promise<{ ok: true; id: number }>
  umbenennen: (id: number, name: string) => Promise<unknown>
  loeschen: (id: number) => Promise<{ ok: true; name: string }>
} {
  const api = useApi()
  return {
    listePfad: () => api('/institutions'),
    anlegen: (name) => apiFetch<{ ok: true; id: number }>(api('/institutions'), { method: 'POST', body: { name } }),
    umbenennen: (id, name) => apiFetch(api(`/institutions/${id}`), { method: 'PATCH', body: { name } }),
    loeschen: (id) => apiFetch<{ ok: true; name: string }>(api(`/institutions/${id}`), { method: 'DELETE' })
  }
}
