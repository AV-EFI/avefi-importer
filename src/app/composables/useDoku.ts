/*
 * Lesende Abfragen der Dokumentation (#9). Aufteilung und Schluessel wie in
 * useImporte.ts beschrieben.
 */
import type { MaybeRefOrGetter } from 'vue'
import { dokuPfade, type DokuKapitel, type DokuUebersicht } from '~/services/doku'

export function useHandbuch() {
  const pfad = dokuPfade().handbuch()
  return useFetch<DokuUebersicht>(pfad, { key: `doku:${pfad}` })
}

export function useHandbuchKapitel(kennung: MaybeRefOrGetter<string>) {
  const doku = dokuPfade()
  const pfad = () => doku.handbuchKapitel(toValue(kennung))
  return useFetch<DokuKapitel>(pfad, { key: () => `doku:${pfad()}` })
}

export function useOberflaeche() {
  const pfad = dokuPfade().oberflaeche()
  return useFetch<DokuUebersicht>(pfad, { key: `doku:${pfad}` })
}

export function useOberflaechenSeite(kennung: MaybeRefOrGetter<string>) {
  const doku = dokuPfade()
  const pfad = () => doku.oberflaecheSeite(toValue(kennung))
  return useFetch<DokuKapitel>(pfad, { key: () => `doku:${pfad()}` })
}
