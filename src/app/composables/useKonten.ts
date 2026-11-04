/*
 * Lesende Abfragen der Nutzerverwaltung und des eigenen Profils (#9).
 * Aufteilung und Schluessel wie in useImporte.ts beschrieben.
 */
import type { MaybeRefOrGetter } from 'vue'
import { usersService, type ProfileResponse, type UserResponse, type UsersResponse } from '~/services/users'
import { institutionenService, type InstitutionenResponse } from '~/services/institutionen'

export function useKontenListe() {
  const nutzerDienst = usersService()
  const pfad = nutzerDienst.listePfad()
  return useFetch<UsersResponse>(pfad, { key: `konten:${pfad}` })
}

export function useKonto(id: MaybeRefOrGetter<string>) {
  const nutzerDienst = usersService()
  const pfad = () => nutzerDienst.einerPfad(toValue(id))
  return useFetch<UserResponse>(pfad, { key: () => `konten:${pfad()}` })
}

export function useEigenesProfil() {
  const nutzerDienst = usersService()
  const pfad = nutzerDienst.profilPfad()
  return useFetch<ProfileResponse>(pfad, { key: `konten:${pfad}` })
}

/** Institutionen mit Belegung (#43); eigener Schluessel, unabhaengig von der Kontenliste. */
export function useInstitutionenListe() {
  const dienst = institutionenService()
  const pfad = dienst.listePfad()
  return useFetch<InstitutionenResponse>(pfad, { key: `konten:${pfad}` })
}
