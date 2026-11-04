/*
 * Wikidata ueber die Suchschnittstelle wbsearchentities.
 *
 * NAMENSFORM: durchgehend natuerlich. Das Label einer Person ist "Heinz
 * Sielmann", nicht "Sielmann, Heinz" — Wikidata ist keine Katalogisierung,
 * sondern eine Wissensbasis. Deshalb trifft hier der schlichte Zeichenvergleich,
 * und genau deshalb fiel im PHP-Stand nicht auf, dass er bei der GND versagt:
 * Wikidata und die GND-Koerperschaften lieferten Treffer, nur GND-Personen nicht.
 *
 * Trotzdem laeuft der Abgleich auch hier ueber nameMatches(): Einzelne Labels
 * sind aus Katalogen importiert und stehen doch invertiert da.
 *
 * wbsearchentities liefert nur Label und Beschreibung, keinen Typ. Bei
 * Personen ist das zu wenig: Zu "Rainer Werner Fassbinder" gibt es auch einen
 * gleichnamigen Film, zu "Ingrid Caven" drei weitere Eintraege, und der
 * Abgleich liess jeden solchen Namen als mehrdeutig offen (#38, 03.11.2026).
 *
 * Deshalb fragt eine zweite Anfrage den Suchindex nach den gleichnamigen
 * Eintraegen, die *keine* Menschen sind (`-haswbstatement:P31=Q5`), und genau
 * diese fallen heraus. Andersherum — nur die Menschen behalten — waere es
 * gefaehrlich: Der Suchindex vergleicht anders als wbsearchentities, und ein
 * Mensch, den er nicht findet, fiele heraus. Aus einem mehrdeutigen Namen
 * wuerde so still ein eindeutiger. In dieser Richtung kann eine Luecke des
 * Index nur bewirken, dass ein Name mehrdeutig bleibt.
 *
 * Bei Orten hilft ein solcher Filter nicht: Auch ein versenktes Dampfschiff
 * namens "Deutschland" hat Koordinaten, und "Berlin" gibt es vielfach. Andere
 * Arten bleiben ungefiltert.
 */

import type { AuthorityCandidate, AuthorityKind } from './types.js'
import type { FetchJson } from './http.js'
import { asArray, asRecord, asText } from './http.js'

export const WIKIDATA_API = 'https://www.wikidata.org/w/api.php'
export const WIKIDATA_RESULT_SIZE = 8

/** Q-, P- und L-Kennungen; alles andere ist keine gueltige Entitaet. */
export const WIKIDATA_ID_PATTERN = /^[LPQ]\d+$/

export function wikidataSearchUrl(q: string, size: number = WIKIDATA_RESULT_SIZE): string {
  const p = new URLSearchParams({
    action: 'wbsearchentities',
    format: 'json',
    limit: String(size),
    language: 'de',
    uselang: 'de',
    type: 'item',
    search: q
  })
  return `${WIKIDATA_API}?${p.toString()}`
}

/** Gleichnamige Eintraege, die keine Menschen sind, ueber den Suchindex. */
export function wikidataNichtMenschenUrl(q: string): string {
  const name = q.replace(/["\\]/g, ' ').replace(/\s+/g, ' ').trim()
  const p = new URLSearchParams({
    action: 'query',
    format: 'json',
    list: 'search',
    srnamespace: '0',
    srlimit: '50',
    srprop: '',
    srsearch: `-haswbstatement:P31=Q5 inlabel:"${name}"`
  })
  return `${WIKIDATA_API}?${p.toString()}`
}

/** Kennungen aus einer Antwort von list=search. */
export function parseWikidataTreffer(payload: unknown): Set<string> {
  const ids = new Set<string>()
  for (const raw of asArray(asRecord(asRecord(payload)['query'])['search'])) {
    const id = asText(asRecord(raw)['title'])
    if (WIKIDATA_ID_PATTERN.test(id)) ids.add(id)
  }
  return ids
}

export function parseWikidata(payload: unknown, _kind: AuthorityKind): AuthorityCandidate[] {
  const out: AuthorityCandidate[] = []

  for (const raw of asArray(asRecord(payload)['search'])) {
    const s = asRecord(raw)
    const id = asText(s['id'])
    if (!WIKIDATA_ID_PATTERN.test(id)) continue
    const label = asText(s['label'])
    out.push({
      source: 'wikidata',
      id,
      label: label !== '' ? label : id,
      description: asText(s['description']),
      agentType: '',
      resourceType: 'WikidataResource',
      uri: asText(s['concepturi']) !== '' ? asText(s['concepturi']) : `https://www.wikidata.org/wiki/${id}`
    })
  }

  return out
}

export async function searchWikidata(
  q: string,
  kind: AuthorityKind,
  fetchJson: FetchJson
): Promise<AuthorityCandidate[]> {
  const out = parseWikidata(await fetchJson(wikidataSearchUrl(q)), kind)
  if (kind !== 'person' || out.length === 0) return out

  // Schlaegt die zweite Anfrage fehl, bleibt es beim ungefilterten Ergebnis:
  // Das ist der alte Stand und schlimmstenfalls mehrdeutig, nie falsch.
  try {
    const keineMenschen = parseWikidataTreffer(await fetchJson(wikidataNichtMenschenUrl(q)))
    return out.filter((c) => !keineMenschen.has(c.id))
  } catch {
    return out
  }
}
