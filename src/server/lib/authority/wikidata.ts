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
 * Deshalb wird bei Personen nachgefragt, was die gleichnamigen Eintraege
 * sind — aber nur, wenn mehr als einer exakt passt, und nur bei diesen.
 * `wbgetclaims` liefert je Eintrag die Aussagen „ist ein(e)“ (P31), ein paar
 * hundert Byte. Gestrichen wird, wer eine solche Aussage hat und kein Mensch
 * (Q5) ist; wer keine hat, bleibt stehen. Eine Luecke landet so auf der
 * harmlosen Seite: Ein Name bleibt mehrdeutig, wird aber nie still eindeutig.
 *
 * Vom 03. bis 10.11.2026 fragte stattdessen der Suchindex nach gleichnamigen
 * Nicht-Menschen (`-haswbstatement:P31=Q5 inlabel:"…"`, hoechstens 50
 * Treffer). Zu „Gorch Fock“ gibt es 107 solche Eintraege — Schiffe, Schulen,
 * Strassen —, die Begriffsklaerungsseite Q298350 lag jenseits der 50 und blieb
 * stehen (Luca Wollny, #38). Eine Suche mit Obergrenze ist eine Stichprobe;
 * wo die Kandidaten schon bekannt sind, fragt man sie selbst.
 *
 * Scheitert eine dieser Nachfragen, scheitert die ganze Suche. Das ist
 * Absicht: Ein Fehlschlag wird nicht zwischengespeichert und beim naechsten
 * Lauf wiederholt, ein ungefiltertes „mehrdeutig“ dagegen schon — und bliebe
 * dann stehen.
 *
 * Bei Orten hilft ein solcher Filter nicht: Auch ein versenktes Dampfschiff
 * namens "Deutschland" hat Koordinaten, und "Berlin" gibt es vielfach. Andere
 * Arten bleiben ungefiltert.
 */

import type { AuthorityCandidate, AuthorityKind } from './types.js'
import type { FetchJson } from './http.js'
import { asArray, asRecord, asText } from './http.js'
import { compareForm, nameMatches } from './names.js'

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

/** Kennung fuer „Mensch“ in Wikidata. */
export const WIKIDATA_MENSCH = 'Q5'

/** Die Aussagen „ist ein(e)“ (P31) eines Eintrags, ohne den Rest der Daten. */
export function wikidataArtUrl(id: string): string {
  const p = new URLSearchParams({ action: 'wbgetclaims', format: 'json', entity: id, property: 'P31' })
  return `${WIKIDATA_API}?${p.toString()}`
}

/** Die Ziele der P31-Aussagen einer Antwort von wbgetclaims. */
export function parseWikidataArten(payload: unknown): string[] {
  const arten: string[] = []
  for (const aussage of asArray(asRecord(asRecord(payload)['claims'])['P31'])) {
    const wert = asRecord(asRecord(asRecord(asRecord(aussage)['mainsnak'])['datavalue'])['value'])
    const id = asText(wert['id'])
    if (WIKIDATA_ID_PATTERN.test(id)) arten.push(id)
  }
  return arten
}

/** Sicher kein Mensch: hat Aussagen zur Art, und keine davon ist Q5. */
export function keinMensch(arten: readonly string[]): boolean {
  return arten.length > 0 && !arten.includes(WIKIDATA_MENSCH)
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
  if (kind !== 'person') return out

  // Nur wenn mehr als einer exakt passt, gibt es etwas zu entscheiden.
  const norm = compareForm(q)
  const gleichnamig = out.filter((c) => nameMatches(c.label, norm))
  if (gleichnamig.length < 2) return out

  const streichen = new Set<string>()
  for (const c of gleichnamig) {
    if (keinMensch(parseWikidataArten(await fetchJson(wikidataArtUrl(c.id))))) streichen.add(c.id)
  }
  return out.filter((c) => !streichen.has(c.id))
}
