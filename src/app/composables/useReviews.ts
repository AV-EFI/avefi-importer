/*
 * Lesende Abfragen der Pruefauftraege (#9). Aufteilung und Schluessel wie in
 * useImporte.ts beschrieben.
 */
import type { MaybeRefOrGetter } from 'vue'
import { reviewsService, type ReviewDetail, type ReviewListResponse } from '~/services/reviews'

export function usePruefungsListe() {
  const pruefung = reviewsService()
  const pfad = pruefung.listePfad()
  return useFetch<ReviewListResponse>(pfad, { key: `reviews:${pfad}` })
}

export function usePruefung(id: MaybeRefOrGetter<string>) {
  const pruefung = reviewsService()
  const pfad = () => pruefung.einerPfad(toValue(id))
  return useFetch<ReviewDetail>(pfad, { key: () => `reviews:${pfad()}` })
}

/** Zahl der offenen Pruefauftraege fuer die Navigation; faellt still auf 0. */
export function usePruefungsAnzahl() {
  const pruefung = reviewsService()
  const pfad = pruefung.anzahlPfad()
  return useFetch<{ open: number }>(pfad, {
    key: `reviews:${pfad}`,
    default: () => ({ open: 0 }),
    immediate: true
  })
}
