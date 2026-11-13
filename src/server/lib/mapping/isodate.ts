/*
 * Datum nach ISO: eine Regel fuer Konverter und Zielpruefung (#51).
 *
 * Bis zum 12.11.2026 beantworteten drei Stellen dieselbe Frage verschieden:
 *
 *  - das AVefi-Schema (Typ ISODate): JJJJ, JJJJ-MM, JJJJ-MM-TT, je mit ? oder ~,
 *    auch als Zeitraum mit /,
 *  - der Konverter „Datum nach ISO“: liess nur JJJJ(-MM(-TT)) durch und nahm
 *    sonst still die ersten vier Ziffern (`2024~` -> `2024`, `2023/2024` ->
 *    `2023`, `12024` -> `1202`),
 *  - die Zielpruefung: kannte Qualifier, aber keine Zeitraeume, und lehnte
 *    das gueltige `1976/1977` ab. Monat und Tag pruefte sie nicht (`2024-13`).
 *
 * Gemeldet von Luca Wollny in #51. Jetzt gilt das Muster des Schemas,
 * abgeschrieben in ISO_DATE_PATTERN. tests/mapping/isodate.test.ts haelt es
 * gegen public/schema/avefi/model.schema.json, damit eine Aenderung am Schema
 * auffaellt. Zur Laufzeit gelesen wird es bewusst nicht: Waere die Schemadatei
 * unlesbar, fiele die Pruefung still weg.
 *
 * Was der Konverter umwandelt, ist absichtlich wenig (Entscheidung mit Andreas
 * am 12.11.2026): nur, was eindeutig ist und nichts verliert. Alles andere
 * entfaellt mit einer Warnung, statt geraten zu werden. Ein Datum am Ereignis
 * ist keine Pflichtangabe; der Datensatz bleibt exportierbar, und verloren geht
 * nichts unbemerkt.
 */

import type { MappingMessage } from '#shared/types/domain'
import { meldung } from './meldungen.js'

/** Das Muster von ISODate im AVefi-Schema, Zeichen fuer Zeichen. */
export const ISO_DATE_PATTERN =
  '^-?([1-9][0-9]{3,}|0[0-9]{3})(-(0[1-9]|1[0-2])(-(0[1-9]|[12][0-9]|3[01]))?)?[?~]?'
  + '(/-?([1-9][0-9]{3,}|0[0-9]{3})(-(0[1-9]|1[0-2])(-(0[1-9]|[12][0-9]|3[01]))?)?[?~]?)?$'

const ISO_DATE = new RegExp(ISO_DATE_PATTERN)

/** Schemakonform nach ISODate? */
export function isIsoDate(v: string): boolean {
  return ISO_DATE.test(v)
}

/** Ein einzelnes Datum ohne Qualifier: JJJJ, JJJJ-MM oder JJJJ-MM-TT, Monat und Tag gueltig. */
const EINZELN = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/

function tageImMonat(jahr: number, monat: number): number {
  return new Date(Date.UTC(jahr, monat, 0)).getUTCDate()
}

/**
 * Ist das ein echtes Kalenderdatum? Das Schema prueft nur 01–12 und 01–31;
 * `2024-02-30` laege also im Muster. Der Konverter laesst es nicht durch.
 */
function kalendergueltig(teil: string): boolean {
  const m = EINZELN.exec(teil)
  if (m === null) return false
  const monat = m[2] === undefined ? null : Number(m[2])
  const tag = m[3] === undefined ? null : Number(m[3])
  if (monat !== null && (monat < 1 || monat > 12)) return false
  if (tag !== null && (tag < 1 || tag > tageImMonat(Number(m[1]), monat ?? 1))) return false
  return true
}

/** Monat und Tag auffuellen: `2024-4-5` -> `2024-04-05`. Null, wenn es keine solche Form ist. */
function auffuellen(teil: string): string | null {
  const m = /^(\d{4})(?:-(\d{1,2})(?:-(\d{1,2}))?)?$/.exec(teil)
  if (m === null) return null
  const out = [m[1]!, ...[m[2], m[3]].filter((x): x is string => x !== undefined).map((x) => x.padStart(2, '0'))]
  return out.join('-')
}

/** Zwei gelesene Grenzen eines Zeitraums zusammensetzen, oder null. */
function zeitraum(a: string, b: string): string | null {
  const von = auffuellen(a)
  const bis = auffuellen(b)
  if (von === null || bis === null || !kalendergueltig(von) || !kalendergueltig(bis)) return null
  return `${von}/${bis}`
}

/** Format-Buchstaben, wie sie schon in den Altprofilen stehen (PHP-Schreibweise). */
const DATE_TOKENS: Record<string, string> = {
  d: '(\\d{2})', j: '(\\d{1,2})',
  m: '(\\d{2})', n: '(\\d{1,2})',
  Y: '(\\d{4})', y: '(\\d{2})'
}

/** Datum nach einem vorgegebenen Quellformat lesen. */
function nachFormat(v: string, format: string): string | null {
  const order: string[] = []
  let pattern = '^'
  for (const ch of format) {
    const token = DATE_TOKENS[ch]
    if (token !== undefined) {
      order.push(ch)
      pattern += token
    } else {
      pattern += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    }
  }
  pattern += '$'

  const m = v.match(new RegExp(pattern))
  if (m === null) return null

  let year = 0
  let month = 1
  let day = 1
  order.forEach((ch, i) => {
    const n = Number.parseInt(m[i + 1] ?? '', 10)
    if (!Number.isFinite(n)) return
    if (ch === 'Y') year = n
    else if (ch === 'y') year = n < 70 ? 2000 + n : 1900 + n
    else if (ch === 'm' || ch === 'n') month = n
    else if (ch === 'd' || ch === 'j') day = n
  })
  if (year === 0) return null
  const out = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  return kalendergueltig(out) ? out : null
}

/** Ungefaehr-Angaben, die genau `~` des Schemas bedeuten. */
const UNGEFAEHR = /^(?:ca\.?|circa|um)\s+(.+)$/iu

/**
 * Datum nach ISO. Liefert den schemakonformen Wert oder '' und haengt an
 * `errors`, was der Nutzer erfahren muss:
 *
 *  - `transform.badDate` (Warnung): nicht eindeutig umzuwandeln, der Wert entfaellt,
 *  - `transform.dateTimeDropped` (Hinweis): Uhrzeit abgeschnitten,
 *  - `transform.dateYearExtracted` (Hinweis): aus einem Text mit genau einer
 *    Jahreszahl und sonst keinen Ziffern wurde das Jahr genommen
 *    („gedreht 1953“). So arbeitete der Konverter schon immer; bis zum
 *    12.11.2026 geschah es aber still und auch dort, wo es falsch war.
 *
 * Verlustfreie Umwandlungen melden nichts. Vorher und nachher stehen in der
 * Vorschau ohnehin nebeneinander.
 */
export function toIsoDate(input: string, from: string, errors: MappingMessage[]): string {
  const v = input.trim().replace(/\s+/gu, ' ')
  if (v === '') return ''

  const ergebnis = lies(v, from, errors)
  if (ergebnis !== null) return ergebnis
  errors.push({ ...meldung('transform.badDate', { wert: v }), severity: 'warning' })
  return ''
}

function lies(v: string, from: string, errors: MappingMessage[]): string | null {
  if (from !== '') {
    const parsed = nachFormat(v, from)
    if (parsed !== null) return parsed
  }

  // 1. Schon schemakonform: unveraendert. Mit zwei Ausnahmen, die das Muster
  //    zulaesst, die aber fast immer Tippfehler sind: Jahre ueber 9999
  //    (`12024`) und Tage, die es im Monat nicht gibt (`2024-02-30`).
  if (isIsoDate(v)) {
    const grenzen = v.split('/').map((t) => t.replace(/^-/, '').replace(/[?~]$/, ''))
    return grenzen.every((t) => kalendergueltig(t)) ? v : null
  }

  // 2. Ungefaehr: `ca. 1970`, `circa 1970`, `um 1970` -> `1970~`.
  const ungefaehr = UNGEFAEHR.exec(v)
  if (ungefaehr !== null) {
    const kern = lies(ungefaehr[1]!, '', [])
    if (kern === null || kern.includes('/') || /[?~]$/.test(kern)) return null
    return `${kern}~`
  }

  // 3. Zeitraum mit Leerraum um den Schraegstrich: `2023 / 2024`.
  let m = /^([^\s/]+) ?\/ ?([^\s/]+)$/.exec(v)
  if (m !== null) return zeitraum(m[1]!, m[2]!)

  // 4. Strich zwischen zwei vierstelligen Jahren: `1976 - 1977`, `1976-1977`,
  //    `1976–1977`. Ein Monat kann das nicht sein.
  m = /^(\d{4}) ?[-–—] ?(\d{4})$/u.exec(v)
  if (m !== null) return zeitraum(m[1]!, m[2]!)

  // 5. Zwei volle Daten, durch einen Strich MIT Leerraum getrennt:
  //    `2023-11-01 - 2024-02-15`. Ohne Leerraum waere es mehrdeutig.
  m = /^(\d{4}(?:-\d{1,2}){0,2}) [-–—] (\d{4}(?:-\d{1,2}){0,2})$/u.exec(v)
  if (m !== null) return zeitraum(m[1]!, m[2]!)

  // 6. Verkuerztes Endjahr: `1962-65` -> `1962/1965` (Werkvertrag, Paket A).
  //    Nur wenn das Ende nach dem Anfang liegt, und mit Bindestrich nur, wenn
  //    es kein Monat sein kann: `1998-05` ist schon unter 1. als Mai 1998
  //    durchgegangen.
  m = /^(\d{2})(\d{2}) ?([-–—]) ?(\d{2})$/u.exec(v)
  if (m !== null) {
    const ende = Number(m[4])
    if (ende > Number(m[2]) && (m[3] !== '-' || ende > 12)) return `${m[1]}${m[2]}/${m[1]}${m[4]}`
    return null
  }

  // 7. Monat und Tag auffuellen: `2024-4` -> `2024-04`, `2024-4-5` -> `2024-04-05`.
  const aufgefuellt = auffuellen(v)
  if (aufgefuellt !== null) return kalendergueltig(aufgefuellt) ? aufgefuellt : null

  // 8. Mit Uhrzeit: Datum behalten, Uhrzeit abschneiden und sagen.
  m = /^(\d{4}-\d{1,2}-\d{1,2})[T ]\d{1,2}:\d{2}(?::\d{2}(?:[.,]\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?$/.exec(v)
  if (m !== null) {
    const tag = auffuellen(m[1]!)
    if (tag === null || !kalendergueltig(tag)) return null
    errors.push({ ...meldung('transform.dateTimeDropped', { wert: v, datum: tag }), severity: 'info' })
    return tag
  }

  // 9. Deutsche und amerikanische Schreibweisen, wie schon immer.
  m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(v)
  if (m !== null) return gueltigOderNull(`${m[3]}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}`)
  m = /^(\d{1,2})\.(\d{4})$/.exec(v)
  if (m !== null) return gueltigOderNull(`${m[2]}-${m[1]!.padStart(2, '0')}`)
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(v)
  if (m !== null) return gueltigOderNull(`${m[3]}-${m[1]!.padStart(2, '0')}-${m[2]!.padStart(2, '0')}`)

  // 10. Genau eine Jahreszahl in einem Text ohne weitere Ziffern und ohne
  //     Datumszeichen: `gedreht 1953`. Nicht `2024/` (offenes Ende), nicht
  //     `1950er` (Jahrzehnt), nicht `1953 (Fassung 1960)` (zwei Jahre).
  m = /^\D*?\b(\d{4})\b\D*$/u.exec(v)
  if (m !== null && !/[/\-–—.:]/u.test(v.replace(m[1]!, '')) && !/\d{4}\p{L}/u.test(v)) {
    const jahr = m[1]!
    if (!kalendergueltig(jahr)) return null
    errors.push({ ...meldung('transform.dateYearExtracted', { wert: v, datum: jahr }), severity: 'info' })
    return jahr
  }

  return null
}

function gueltigOderNull(v: string): string | null {
  return kalendergueltig(v) ? v : null
}
