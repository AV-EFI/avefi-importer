/*
 * Namensformen.
 *
 * Die Normdatenquellen fuehren Personen invertiert ("Sielmann, Heinz"),
 * Archivlisten fuehren sie natuerlich ("Heinz Sielmann"). Ein Zeichenvergleich
 * zwischen beiden trifft nie. Deshalb wird zu jedem Namen auch die umgedrehte
 * Form gebildet und mitverglichen.
 *
 * Die Vergleichsform stammt aus dem Mappingkern (compareForm), damit die
 * Schluessel hier dieselben sind wie dort — der Zwischenspeicher und
 * ColumnMapping.authorities werden ueber genau diesen Schluessel adressiert.
 */

import { compareForm } from '../mapping/transform.js'

export { compareForm }

/**
 * Dreht "Nachname, Vorname" zu "Vorname Nachname". Liefert null, wenn die Form
 * nicht passt.
 *
 * Ein Zusatz nach dem zweiten Komma — VIAF haengt gern Lebensdaten an,
 * "Sielmann, Heinz, 1917-2006" — wird abgeschnitten, weil er im Quellmaterial
 * ohnehin nicht steht.
 */
export function invertName(label: string): string | null {
  const parts = label.split(',').map((p) => p.trim())
  if (parts.length < 2) return null
  const family = parts[0] ?? ''
  const given = parts[1] ?? ''
  if (family === '' || given === '') return null
  // Ein Komma, das keine Namensinversion ist ("Berlin, Deutschland"), erzeugt
  // hier zwar auch eine Form — die schadet aber nicht, sie trifft nur nichts.
  return `${given} ${family}`
}

/**
 * Angehaengte Lebensdaten am Ende eines Namens.
 *
 * VIAF schreibt sie mit oder ohne Komma und auch an natuerliche Namen:
 * "Rainer Werner Fassbinder, 1945-1982", "Wim Wenders, 1945-",
 * "Wolf, Günther 1925-2018". Bis zum 03.11.2026 griff nur der Fall mit zweitem
 * Komma ("Sielmann, Heinz, 1917-2006"); alle anderen trafen nie (#38).
 */
const LEBENSDATEN = /(?:,\s*|\s+)(?:(?:ca|geb|gest|b|d|fl)\.\s*)?-?\d{3,4}\??(?:\s*-\s*(?:\d{3,4}\??)?)?\.?\s*$/iu

/** Der Name ohne angehaengte Lebensdaten, oder null, wenn keine dastehen. */
export function ohneLebensdaten(label: string): string | null {
  const kurz = label.replace(LEBENSDATEN, '').trim()
  return kurz !== '' && kurz !== label.trim() ? kurz : null
}

/**
 * Alle Formen, in denen ein Name der Quelle mit einer Anfrage verglichen wird:
 * die Vergleichsform des Namens selbst und, falls invertiert geschrieben, die
 * umgedrehte Form — jeweils auch ohne angehaengte Lebensdaten.
 */
export function comparableForms(label: string): string[] {
  const forms: string[] = []
  const add = (s: string | null): void => {
    if (s === null) return
    const f = compareForm(s)
    if (f !== '' && !forms.includes(f)) forms.push(f)
  }
  const kurz = ohneLebensdaten(label)
  for (const name of kurz === null ? [label] : [label, kurz]) {
    add(name)
    add(invertName(name))
  }
  return forms
}

/** Passt ein Name der Quelle auf die (bereits normalisierte) Anfrage? */
export function nameMatches(label: string, queryNorm: string): boolean {
  return comparableForms(label).includes(queryNorm)
}

/**
 * Umlaute und Eszett auf ihre ASCII-Umschrift bringen. Archivlisten schreiben
 * "franzoesisch" ebenso oft wie "französisch"; beides soll dieselbe Zeile
 * finden.
 */
export function foldUmlauts(s: string): string {
  return s
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue')
    .replace(/Ä/g, 'Ae').replace(/Ö/g, 'Oe').replace(/Ü/g, 'Ue')
    .replace(/ß/g, 'ss')
}

/**
 * Bildet aus einer natuerlichen Schreibweise die invertierte:
 * "Heinz Sielmann" -> "Sielmann, Heinz". Liefert null, wenn der Name aus einem
 * einzigen Wort besteht oder bereits ein Komma enthaelt.
 *
 * Gebraucht wird das fuer VIAF: dessen AutoSuggest vergleicht am Zeilenanfang
 * und findet "Heinz Sielmann" deshalb nicht, "Sielmann, Heinz" schon.
 */
export function toInvertedForm(natural: string): string | null {
  const s = natural.replace(/\s+/gu, ' ').trim()
  if (s === '' || s.includes(',')) return null
  const cut = s.lastIndexOf(' ')
  if (cut <= 0) return null
  return `${s.slice(cut + 1)}, ${s.slice(0, cut)}`
}
