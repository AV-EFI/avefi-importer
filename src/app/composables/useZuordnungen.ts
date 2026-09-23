/*
 * Lesende Abfragen der Zuordnungsprofile (#9). Aufteilung und Schluessel wie
 * in useImporte.ts beschrieben.
 */
import type { MaybeRefOrGetter } from 'vue'
import {
  mappingsService, type EditorAntwort, type MappingDetail, type MappingListResponse, type VersionAntwort
} from '~/services/mappings'

export function useZuordnungsListe() {
  const zuordnungen = mappingsService()
  const pfad = zuordnungen.listePfad()
  return useFetch<MappingListResponse>(pfad, { key: `zuordnungen:${pfad}` })
}

export function useZuordnung(id: MaybeRefOrGetter<string>) {
  const zuordnungen = mappingsService()
  const pfad = () => zuordnungen.einerPfad(toValue(id))
  return useFetch<MappingDetail>(pfad, { key: () => `zuordnungen:${pfad()}` })
}

/** Editorzustand eines Profils; Zuordnungs- und Normdatenseite lesen denselben. */
export function useZuordnungsEditor(id: MaybeRefOrGetter<string>) {
  const zuordnungen = mappingsService()
  const pfad = () => zuordnungen.editorPfad(toValue(id))
  return useFetch<EditorAntwort>(pfad, { key: () => `zuordnungen:${pfad()}` })
}

/** Eine gespeicherte Version, nur lesend. */
export function useZuordnungsVersion(id: MaybeRefOrGetter<string>, version: MaybeRefOrGetter<number>) {
  const zuordnungen = mappingsService()
  const pfad = () => zuordnungen.versionPfad(toValue(id), toValue(version))
  return useFetch<VersionAntwort>(pfad, { key: () => `zuordnungen:${pfad()}` })
}
