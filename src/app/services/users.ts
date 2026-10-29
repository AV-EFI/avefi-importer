/*
 * Nutzerverwaltung und eigenes Profil.
 *
 * UserWithInstitution stand bis zum 07.09.2026 in zwei Seiten, identisch.
 */
import type { InstitutionRow, UserRow } from '#shared/types/domain'

export interface UserWithInstitution extends UserRow {
  institution_name: string | null
}

export interface UsersResponse {
  users: UserWithInstitution[]
  institutions: InstitutionRow[]
  selfId: number
  minPasswordLength: number
}

export interface UserResponse {
  user: UserWithInstitution
  institutions: InstitutionRow[]
  isSelf: boolean
  minPasswordLength: number
}

export interface ProfileResponse {
  user: UserRow & { institution_name: string | null }
  minPasswordLength: number
}

/**
 * Antwort auf das Setzen eines Passworts.
 *
 * `generated` unterscheidet die beiden Faelle: Hat der Verwalter selbst eines
 * vergeben, gibt es nichts vorzuzeigen; hat der Server eines erzeugt, muss es
 * einmal sichtbar werden — danach nie wieder.
 */
export interface PasswortAntwort {
  ok: true
  oneTimePassword: string
  generated: boolean
}

export function usersService(): {
  listePfad: () => string
  einerPfad: (id: string | number) => string
  profilPfad: () => string
  anlegen: (body: Record<string, unknown>) => Promise<PasswortAntwort>
  aendern: (id: string | number, body: Record<string, unknown>) => Promise<unknown>
  loeschen: (id: string | number) => Promise<unknown>
  passwortSetzen: (id: string | number, body: Record<string, unknown>) => Promise<PasswortAntwort>
  profilAendern: (body: Record<string, unknown>) => Promise<unknown>
  eigenesPasswort: (body: Record<string, unknown>) => Promise<unknown>
} {
  const api = useApi()
  return {
    listePfad: () => api('/users'),
    einerPfad: (id) => api(`/users/${id}`),
    profilPfad: () => api('/profile'),
    anlegen: (body) => apiFetch<PasswortAntwort>(api('/users'), { method: 'POST', body }),
    aendern: (id, body) => apiFetch(api(`/users/${id}`), { method: 'PATCH', body }),
    loeschen: (id) => apiFetch(api(`/users/${id}`), { method: 'DELETE' }),
    passwortSetzen: (id, body) =>
      apiFetch<PasswortAntwort>(api(`/users/${id}/password`), { method: 'POST', body }),
    profilAendern: (body) => apiFetch(api('/profile'), { method: 'PATCH', body }),
    eigenesPasswort: (body) => apiFetch(api('/profile/password'), { method: 'POST', body })
  }
}
