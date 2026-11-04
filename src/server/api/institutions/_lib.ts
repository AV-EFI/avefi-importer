/*
 * Gemeinsames fuer die Verwaltung der Institutionen (#43).
 *
 * Die Logik steht in server/lib/institutionen.ts; hier wird nur die ID gelesen
 * und ein fachlicher Fehler in eine HTTP-Antwort uebersetzt.
 */
import type { H3Event } from 'h3'
import { InstitutionFehler } from '../../lib/institutionen'
import { fail } from '../imports/_lib'

export function institutionIdOf(event: H3Event): number {
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id) || id <= 0) {
    throw fail(404, 'institution_not_found', {}, 'Institution nicht gefunden.')
  }
  return id
}

/** Fachliche Fehler als Antwort mit Code; alles andere unveraendert weiter. */
export async function alsAntwort<T>(arbeit: () => Promise<T>): Promise<T> {
  try {
    return await arbeit()
  } catch (e) {
    if (e instanceof InstitutionFehler) throw fail(e.status, e.code, e.params, e.message)
    throw e
  }
}

/** Diese Datei ist Hilfsmittel, keine Schnittstelle. */
export default defineEventHandler(() => {
  throw fail(404, 'not_found', {}, 'Keine Schnittstelle.')
})
