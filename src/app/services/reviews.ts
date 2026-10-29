/*
 * Die Formatpruefung: Uploads, die vor der Konvertierung eine Entscheidung
 * brauchen, welcher Konverter sie liest.
 */

export interface ReviewFile {
  reviewId: number
  importId: string
  filename: string
  uploadedAt: string
  importStatus: string
}

export interface ReviewTask {
  id: number
  fingerprint: string
  shortFingerprint: string
  baseFormat: string | null
  institutionId: number
  institutionName: string | null
  importId: string
  filename: string
  uploadedAt: string
  columns: number
  waiting: number
  files: ReviewFile[]
}

export interface ReviewListResponse {
  tasks: ReviewTask[]
  rows: number
  duplicates: number
}

export interface ReviewDetail {
  review: {
    id: number
    status: string
    fingerprint: string
    createdAt: string
    institutionId: number
    institutionName: string | null
    importId: string
    filename: string
    baseFormat: string | null
    headerHash: string | null
    importStatus: string
    uploadedAt: string
  }
  sample: {
    columns: string[]
    rows: string[][]
    tree: { root: string; namespace: string; children: string[] } | null
  }
  converters: Array<{ key: string; label: string }>
  waiting: Array<{ reviewId: number; importId: string; filename: string; uploadedAt: string; importStatus: string }>
}

export interface ZuweisungAntwort {
  ok: true
  label: string
  started: number
}

export interface AblehnungAntwort {
  ok: true
  rejected: number
}

export function reviewsService(): {
  listePfad: () => string
  einerPfad: (id: string | number) => string
  anzahlPfad: () => string
  originalPfad: (importId: string) => string
  zuweisen: (id: string | number, body: Record<string, unknown>) => Promise<ZuweisungAntwort>
  ablehnen: (id: string | number, body: Record<string, unknown>) => Promise<AblehnungAntwort>
} {
  const api = useApi()
  return {
    listePfad: () => api('/reviews'),
    einerPfad: (id) => api(`/reviews/${id}`),
    anzahlPfad: () => api('/reviews/count'),
    originalPfad: (importId) => api(`/imports/${importId}/original`),
    zuweisen: (id, body) => apiFetch<ZuweisungAntwort>(api(`/reviews/${id}/assign`), { method: 'POST', body }),
    ablehnen: (id, body) => apiFetch<AblehnungAntwort>(api(`/reviews/${id}/reject`), { method: 'POST', body })
  }
}
