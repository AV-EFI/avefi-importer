/*
 * Die sechs Traegerklassen von `Item.has_format` — gemeinsam fuer Server und
 * Oberflaeche.
 *
 * Das Schema fuehrt has_format als Liste aus sechs Klassen, jede mit eigener
 * Werteliste (Format<Klasse>TypeEnum). In Bestandsdaten stehen sie oft
 * gemischt in einer Spalte: "VHS + DVD + digitale Datei (mpeg + vob)". Das Ziel
 * "Format (alle Traegerklassen)" (#28, Jasper Stratil am 12.10.2026) nimmt
 * deshalb Werte aller sechs Listen und fuehrt die Klasse im Wert mit:
 * "Video:VHS", "Optical:DVD". Ohne Klasse waere "DV" nicht eindeutig — es steht
 * in FormatVideoTypeEnum und in FormatDigitalFileTypeEnum.
 */

/** Klasse -> Schluesselteil der Einzelziele (item.format.<teil>). */
export const FORMAT_KLASSEN: ReadonlyArray<readonly [klasse: string, teil: string]> = [
  ['Film', 'film'],
  ['Video', 'video'],
  ['Audio', 'audio'],
  ['Optical', 'optical'],
  ['DigitalFile', 'digitalfile'],
  ['DigitalFileEncoding', 'encoding']
]

/** Name der Werteliste einer Klasse. */
export function formatEnum(klasse: string): string {
  return `Format${klasse}TypeEnum`
}

/** "Video:VHS" -> { klasse: "Video", wert: "VHS" }; "VHS" -> { klasse: null, wert: "VHS" }. */
export function teileFormatwert(v: string): { klasse: string | null; wert: string } {
  const i = v.indexOf(':')
  if (i <= 0) return { klasse: null, wert: v }
  const klasse = v.slice(0, i)
  if (!FORMAT_KLASSEN.some(([k]) => k === klasse)) return { klasse: null, wert: v }
  return { klasse, wert: v.slice(i + 1) }
}

export type Formatklaerung =
  | { ok: true; klasse: string; wert: string }
  | { ok: false; grund: 'unbekannt' | 'mehrdeutig'; klassen: string[] }

/**
 * Ordnet einen Wert seiner Klasse zu.
 *
 * Mit Klasse ("Video:DV") muss der Wert in genau dieser Liste stehen. Ohne
 * Klasse ("VHS") wird er angenommen, wenn er nur in einer Liste steht — sonst
 * ist er mehrdeutig, und es wird nicht geraten.
 */
export function klaereFormat(v: string, werteliste: (enumName: string) => readonly string[]): Formatklaerung {
  const { klasse, wert } = teileFormatwert(v.trim())
  if (klasse !== null) {
    return werteliste(formatEnum(klasse)).includes(wert)
      ? { ok: true, klasse, wert }
      : { ok: false, grund: 'unbekannt', klassen: [] }
  }
  const treffer = FORMAT_KLASSEN.map(([k]) => k).filter((k) => werteliste(formatEnum(k)).includes(wert))
  if (treffer.length === 1) return { ok: true, klasse: treffer[0]!, wert }
  return treffer.length === 0
    ? { ok: false, grund: 'unbekannt', klassen: [] }
    : { ok: false, grund: 'mehrdeutig', klassen: treffer }
}

/** Alle Zielwerte des gemeinsamen Ziels, je Klasse in Schemareihenfolge. */
export function alleFormatwerte(werteliste: (enumName: string) => readonly string[]): string[] {
  return FORMAT_KLASSEN.flatMap(([k]) => werteliste(formatEnum(k)).map((w) => `${k}:${w}`))
}
