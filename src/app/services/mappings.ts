/*
 * Zuordnungsprofile: Liste, Detail, Editor, Normdaten, Ein- und Ausfuhr.
 *
 * Die groesste Domaene — fuenfzehn Adressen. Drei Antwortformen standen als
 * anonyme Typen unmittelbar am Aufruf und hatten damit keinen Namen, unter
 * dem man sie haette suchen koennen.
 */
import type {
  AuthorityValuesResponse, CandidateResponse, EditorPayload
} from '~/components/mapping/types'
import type { MappingJson, TargetEntry } from '#shared/types/domain'

export interface ProfileRow {
  id: number
  name: string
  base_format: string
  version: number
  complete: boolean
  updated_at: string
  institution_name: string
  user_name: string | null
  use_count: number
  has_sample: boolean
  own: boolean
}

export interface MappingListResponse {
  profiles: ProfileRow[]
  own: number
}

export interface MappingDetail {
  profile: {
    id: number
    name: string
    base_format: string
    header_hash: string
    version: number
    complete: boolean
    created_at: string
    updated_at: string
    institution_name: string
    avefiSchemaVersion: string | null
    profileFormatVersion: number | null
  }
  own: boolean
  hasSample: boolean
  useCount: number
  columns: Array<{ name: string; state: string; targets: string[]; ops: string[] }>
  open: string[]
  defaults: Array<{ target: string; value: string }>
  grouping: string[]
  targets: Record<string, { label: string; path: string; schemaPath: string }>
  versions: Array<{ version: number; name: string; created_at: string; user_name: string | null }>
}

export interface EditorAntwort {
  payload: EditorPayload
}

/** Eine gespeicherte Profilversion; stand bis zum 23.09.2026 in der Seite selbst. */
export interface VersionAntwort {
  profile: { id: number; name: string; currentVersion: number }
  version: { version: number; name: string; createdAt: string | null; userName: string | null; isCurrent: boolean }
  mapping: MappingJson
  targets: Array<TargetEntry & { schemaPath: string }>
}

export interface EinfuhrAntwort {
  profile: { id: number; name: string }
  created: boolean
  hasSample: boolean
}

export interface NeuAntwort {
  profile: { id: number; name: string }
  created: boolean
  columns: number
  rows: number
}

/** Eine Datei als Rumpf, nicht als Formular — der Server liest den Strom. */
const ALS_DATEI = { headers: { 'content-type': 'application/octet-stream' } } as const

export function mappingsService(): {
  listePfad: () => string
  einerPfad: (id: string | number) => string
  editorPfad: (id: string | number) => string
  ausfuhrPfad: (id: string | number) => string
  /** Pfad einer gespeicherten Version — nur lesend, fuer die Ansicht. */
  versionPfad: (id: string | number, version: number) => string
  normdatenWertePfad: (id: string | number) => string
  kandidatenPfad: (id: string | number) => string
  einfuehren: (profil: unknown) => Promise<EinfuhrAntwort>
  anlegen: (name: string, datei: File) => Promise<NeuAntwort>
  umbenennen: (id: string | number, name: string) => Promise<unknown>
  loeschen: (id: string | number) => Promise<unknown>
  zuruecksetzen: (id: string | number, version: number) => Promise<unknown>
  beispielSetzen: (id: string | number, datei: File) => Promise<unknown>
  speichern: (id: string | number, mapping: unknown) => Promise<unknown>
  /**
   * Ein Schritt des Zuordnungseditors. Die Basisadresse kommt aus der
   * Startnutzlast, weil derselbe Editor am Profil und am Import haengt und
   * der Server entscheidet, wohin er schreiben darf.
   */
  editorAktion: <T>(endpoint: string, aktion: string, body: Record<string, unknown>) => Promise<T>
  normdatenWerte: (id: string | number, mapping: unknown) => Promise<AuthorityValuesResponse>
  kandidaten: (id: string | number, body: Record<string, unknown>) => Promise<CandidateResponse>
} {
  const api = useApi()
  return {
    listePfad: () => api('/mappings'),
    einerPfad: (id) => api(`/mappings/${id}`),
    editorPfad: (id) => api(`/mappings/${id}/editor`),
    ausfuhrPfad: (id) => api(`/mappings/${id}/export`),
    normdatenWertePfad: (id) => api(`/mappings/${id}/authority-values`),
    kandidatenPfad: (id) => api(`/mappings/${id}/candidates`),
    einfuehren: (profil) =>
      $fetch<EinfuhrAntwort>(api('/mappings'), { method: 'POST', body: { profile: profil } }),
    anlegen: (name, datei) =>
      $fetch<NeuAntwort>(api(`/mappings/new?name=${encodeURIComponent(name)}`),
        { method: 'POST', body: datei, ...ALS_DATEI }),
    umbenennen: (id, name) => $fetch(api(`/mappings/${id}`), { method: 'PATCH', body: { name } }),
    loeschen: (id) => $fetch(api(`/mappings/${id}`), { method: 'DELETE' }),
    versionPfad: (id, version) => api(`/mappings/${id}/versions/${version}`),
    zuruecksetzen: (id, version) =>
      $fetch(api(`/mappings/${id}/restore`), { method: 'POST', body: { version } }),
    beispielSetzen: (id, datei) =>
      $fetch(api(`/mappings/${id}/sample?name=${encodeURIComponent(datei.name)}`),
        { method: 'POST', body: datei, ...ALS_DATEI }),
    speichern: (id, mapping) =>
      $fetch(api(`/mappings/${id}/save`), { method: 'POST', body: { mapping } }),
    // Die Adresse kommt relativ zur API-Basis vom Server; die Basis setzt useApi().
    editorAktion: <T>(endpoint: string, aktion: string, body: Record<string, unknown>) =>
      $fetch(api(`${endpoint}/${aktion}`), { method: 'POST', body }) as Promise<T>,
    normdatenWerte: (id, mapping) =>
      $fetch<AuthorityValuesResponse>(api(`/mappings/${id}/authority-values`), { method: 'POST', body: { mapping } }),
    kandidaten: (id, body) =>
      $fetch<CandidateResponse>(api(`/mappings/${id}/candidates`), { method: 'POST', body })
  }
}
