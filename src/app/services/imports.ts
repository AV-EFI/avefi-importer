/*
 * Importe: Hochladen, Stand, Loeschen, Neu konvertieren, Ausgabedateien.
 *
 * Die Antwortformen liegen zum groessten Teil schon in
 * app/components/imports/types.ts und werden von dort weitergereicht — was
 * hier dazukam, sind die beiden Formen, die einzelne Seiten selbst
 * deklarierten.
 */
import type { EditorPayload } from '~/components/mapping/types'

export interface ImportMappingResponse {
  import: { id: string; filename: string; status: string; base_format: string | null }
  /**
   * Welche Profilversion diese Seite zeigt und mit welcher konvertiert wurde.
   * `abweichend` ist nur dann wahr, wenn es dasselbe Profil ist.
   */
  version: {
    verwendet: number | null
    aktuell: number | null
    profilId: number | null
    abweichend: boolean
  }
  payload: EditorPayload
}

export interface BlattAuswahlAntwort {
  ids: string[]
}

export function importsService(): {
  listePfad: (auswahl?: Record<string, string>) => string
  standPfad: () => string
  stand: <T>() => Promise<T | null>
  einerPfad: (id: string) => string
  berichtPfad: (id: string) => string
  datensaetzePfad: (id: string) => string
  blaetterPfad: (id: string) => string
  zuordnungPfad: (id: string) => string
  originalPfad: (id: string) => string
  avefiJsonPfad: (id: string) => string
  hochladenPfad: (dateiname: string) => string
  loeschen: (id: string) => Promise<unknown>
  /** Anzeigename setzen oder — mit leerer Angabe — wieder entfernen. */
  benennen: (id: string, label: string) => Promise<{ id: string; label: string | null }>
  neuKonvertieren: (id: string) => Promise<unknown>
  vonAdresse: (url: string) => Promise<unknown>
  blaetterWaehlen: (id: string, sheets: string[]) => Promise<BlattAuswahlAntwort>
} {
  const api = useApi()
  return {
    listePfad: (auswahl) => {
      const p = new URLSearchParams(auswahl ?? {})
      const s = p.toString()
      return s === '' ? api('/imports') : `${api('/imports')}?${s}`
    },
    standPfad: () => api('/imports/status'),
    // Faellt die Abfrage aus, bleibt die Anzeige stehen statt zu blinken:
    // Der Stand wird im Takt geholt, ein Aussetzer ist kein Ereignis.
    stand: <T>() => apiFetch<T>(api('/imports/status')).catch(() => null),
    einerPfad: (id) => api(`/imports/${id}`),
    berichtPfad: (id) => api(`/imports/${id}/report`),
    datensaetzePfad: (id) => api(`/imports/${id}/records`),
    blaetterPfad: (id) => api(`/imports/${id}/sheets`),
    zuordnungPfad: (id) => api(`/imports/${id}/mapping`),
    originalPfad: (id) => api(`/imports/${id}/original`),
    avefiJsonPfad: (id) => api(`/imports/${id}/avefi.json`),
    // Der Upload laeuft ueber XMLHttpRequest, weil nur der einen Fortschritt
    // meldet; deshalb hier nur die Adresse.
    hochladenPfad: (dateiname) => api(`/imports/upload?name=${encodeURIComponent(dateiname)}`),
    loeschen: (id) => apiFetch(api(`/imports/${id}`), { method: 'DELETE' }),
    benennen: (id, label) => apiFetch(api(`/imports/${id}`), { method: 'PATCH', body: { label } }),
    neuKonvertieren: (id) => apiFetch(api(`/imports/${id}/reconvert`), { method: 'POST' }),
    vonAdresse: (url) => apiFetch(api('/imports/url'), { method: 'POST', body: { url } }),
    blaetterWaehlen: (id, sheets) =>
      apiFetch<BlattAuswahlAntwort>(api(`/imports/${id}/sheets`), { method: 'POST', body: { sheets } })
  }
}
