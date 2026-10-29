import type { UserRow } from '#shared/types/domain'

export interface SessionUser extends UserRow {
  institution_name?: string | null
}

/** Angemeldeter Nutzer, einmal geladen und app-weit geteilt. */
export function useAuth() {
  // Innerhalb der Funktion, nicht auf Modulebene: useRuntimeConfig() braucht
  // den Nuxt-Kontext, und den gibt es beim Auswerten des Moduls noch nicht.
  const api = useApi()
  const user = useState<SessionUser | null>('auth:user', () => null)
  const loaded = useState<boolean>('auth:loaded', () => false)

  async function refresh() {
    // useRequestFetch() statt $fetch: Beim Aufbau auf dem Server kennt $fetch
    // die Kopfzeilen der eingehenden Anfrage nicht und schickt deshalb kein
    // Sitzungscookie mit. Die Antwort war dann immer "nicht angemeldet", und
    // die Wache in auth.global.ts leitete jede Seite auf /login um — auch bei
    // gueltiger Sitzung. Erst im Browser fiel es nicht mehr auf, weil dort
    // Cookies von selbst mitgehen.
    const request = useRequestFetch()
    const res = await request<{ user: SessionUser | null }>(api('/auth/me')).catch(() => ({ user: null }))
    user.value = res.user
    loaded.value = true
    return user.value
  }

  async function login(email: string, password: string) {
    await apiFetch(api('/auth/login'), { method: 'POST', body: { email, password } })
    await refresh()
  }

  async function logout() {
    await apiFetch(api('/auth/logout'), { method: 'POST' }).catch(() => {})
    user.value = null
    await navigateTo('/login')
  }

  return { user, loaded, refresh, login, logout }
}
