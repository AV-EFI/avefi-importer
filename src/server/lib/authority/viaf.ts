/*
 * VIAF ueber AutoSuggest.
 *
 * NAMENSFORM: gemischt, im Zweifel invertiert. VIAF fuehrt Personennamen so,
 * wie Bibliothekskataloge sie fuehren — "Sielmann, Heinz, 1917-2006", haeufig
 * mit angehaengten Lebensdaten. Koerperschaften und einheitliche Titel stehen
 * natuerlich.
 *
 * Zwei Folgen davon:
 *   1. Der Abgleich muss die umgedrehte Form mitpruefen (nameMatches), und
 *      angehaengte Lebensdaten werden dabei abgeschnitten — mit oder ohne
 *      Komma, auch an natuerlich geschriebenen Namen (ohneLebensdaten).
 *   2. AutoSuggest vergleicht am Zeilenanfang. "Heinz Sielmann" findet deshalb
 *      nichts, "Sielmann, Heinz" schon. Bei Personen und Koerperschaften wird
 *      darum zusaetzlich mit der invertierten Anfrage gesucht.
 */

import type { AuthorityCandidate, AuthorityKind } from './types.js'
import type { FetchJson } from './http.js'
import { asArray, asRecord, asText } from './http.js'
import { toInvertedForm } from './names.js'

/** kind -> erwarteter nametype in der Antwort (null = kein Filter). */
const NAME_TYPE: Readonly<Record<AuthorityKind, string | null>> = {
  subject: null,
  person: 'personal',
  corporate: 'corporate',
  place: 'geographic',
  genre: null,
  work: 'uniformtitle'
}

export const VIAF_AUTOSUGGEST = 'https://viaf.org/viaf/AutoSuggest'

export function viafSearchUrl(q: string): string {
  return `${VIAF_AUTOSUGGEST}?query=${encodeURIComponent(q)}`
}

/** Bei welchen Arten eine zweite Anfrage mit umgedrehtem Namen sinnvoll ist. */
export function viafNeedsInvertedQuery(kind: AuthorityKind): boolean {
  return kind === 'person'
}

export function parseViaf(payload: unknown, kind: AuthorityKind): AuthorityCandidate[] {
  const want = NAME_TYPE[kind]
  const out: AuthorityCandidate[] = []

  for (const raw of asArray(asRecord(payload)['result'])) {
    const r = asRecord(raw)
    const nametype = asText(r['nametype']).toLowerCase()
    if (want !== null && nametype !== want) continue
    const id = asText(r['viafid'])
    if (!/^\d+$/.test(id)) continue
    const term = asText(r['term'])
    out.push({
      source: 'viaf',
      id,
      label: term !== '' ? term : id,
      description: nametype !== '' ? `VIAF · ${nametype}` : 'VIAF-Normdatensatz',
      agentType: nametype === 'personal' ? 'Person' : nametype === 'corporate' ? 'CorporateBody' : '',
      resourceType: 'VIAFResource',
      uri: `https://viaf.org/viaf/${id}`
    })
  }

  return out
}

export async function searchViaf(
  q: string,
  kind: AuthorityKind,
  fetchJson: FetchJson
): Promise<AuthorityCandidate[]> {
  const out = parseViaf(await fetchJson(viafSearchUrl(q)), kind)

  const inverted = viafNeedsInvertedQuery(kind) ? toInvertedForm(q) : null
  if (inverted === null) return out

  // Zweiter Versuch mit "Nachname, Vorname". Schlaegt er fehl, bleibt es beim
  // Ergebnis des ersten — ein Ausfall darf hier nichts kaputt machen.
  try {
    const seen = new Set(out.map((c) => c.id))
    for (const c of parseViaf(await fetchJson(viafSearchUrl(inverted)), kind)) {
      if (!seen.has(c.id)) { seen.add(c.id); out.push(c) }
    }
  } catch {
    return out
  }
  return out
}
