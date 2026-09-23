/*
 * Lesende Abfragen des Datensatzeditors (#9). Aufteilung und Schluessel wie
 * in useImporte.ts beschrieben.
 */
import type { MaybeRefOrGetter } from 'vue'
import { recordsService } from '~/services/records'
import type { EditorConfig, RecordDetailResponse } from '~/components/records/types'

/** Wertelisten und Feldbeschreibungen des Editors; fuer alle Datensaetze gleich. */
export function useEditorKonfiguration() {
  const datensaetze = recordsService()
  const pfad = datensaetze.konfigurationPfad()
  return useFetch<EditorConfig>(pfad, { key: `datensaetze:${pfad}` })
}

export function useDatensatz(importId: MaybeRefOrGetter<string>, recordId: MaybeRefOrGetter<string>) {
  const datensaetze = recordsService()
  const pfad = () => datensaetze.datensatzPfad(toValue(importId), toValue(recordId))
  return useFetch<RecordDetailResponse>(pfad, { key: () => `datensaetze:${pfad()}` })
}
