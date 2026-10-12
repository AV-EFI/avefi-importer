/*
 * Die Meldungen des Mappingkerns, an einer Stelle.
 *
 * Bis zum 07.09.2026 formulierte jede Fundstelle ihren deutschen Satz selbst
 * und legte ihn als `message` in die Beanstandung. Die englische Oberflaeche
 * bekam damit deutsche Saetze — gemeldet von Stefan Stretz in der
 * Frontend-Abnahme. Uebersetzen liess sich das nicht: Wo nur ein fertiger
 * Satz ankommt, kann die Oberflaeche keinen anderen bauen.
 *
 * Jetzt tragen die Meldungen einen Code und ihre Bausteine. Den deutschen
 * Satz baut diese Datei, den englischen die Oberflaeche aus
 * i18n/locales/en/mapping.json unter demselben Code. Der deutsche Satz bleibt
 * noetig: Er steht im Pruefbericht, den auch jemand liest, der die Oberflaeche
 * nicht offen hat, und er ist die Rueckfallebene, solange eine Uebersetzung
 * fehlt.
 *
 * Wer hier einen Code ergaenzt, ergaenzt ihn auch in beiden mapping.json.
 * tests/frontend/meldungen.test.ts prueft, dass keiner fehlt.
 */
import type { MappingMessage } from '#shared/types/domain'

type Bausteine = Record<string, string | number>

/** Die deutschen Saetze. {name} wird durch den gleichnamigen Baustein ersetzt. */
export const MELDUNGEN: Record<string, string> = {
  'transform.unknownOp': 'Schritt {schritt}: unbekannte Operation "{op}"',
  'transform.typeMismatch': 'Schritt {schritt} ({label}) erwartet {erwartet}, bekommt aber {bekommen}',
  'transform.unknownOpPlain': 'Unbekannte Operation "{op}"',
  'transform.opFailed': '{op}: {detail}',
  'transform.badRegex': 'Ungueltiger regulaerer Ausdruck: {muster}',
  'transform.noMatch': '"{wert}" passt nicht zum Muster {muster}',
  'transform.onlyNegateCapture': 'Schritt {schritt}: "Nur wenn" kann nicht gleichzeitig umkehren und eine Gruppe herausloesen',
  'transform.notANumber': '"{wert}" ist keine Zahl',
  'transform.notABoolean': '"{wert}" ist weder ein Ja noch ein Nein',
  'transform.noYear': 'keine Jahreszahl in "{wert}" gefunden',
  'transform.unknownCountry': '"{wert}" ist keine bekannte Laenderangabe',
  'transform.unknownLanguage': '"{wert}" ist keine bekannte Sprachangabe',
  'transform.badDate': '"{wert}" konnte nicht als Datum gelesen werden',
  'transform.badDuration': '"{wert}" konnte nicht als Laufzeit gelesen werden',
  'transform.notInValuemap': 'Wert "{wert}" ist in der Zuordnung nicht enthalten',
  'record.workTypeDefaulted': 'Die Werkart war nicht belegt; eingetragen wurde "{wert}", weil das Schema sie verlangt',
  'record.titleBorrowed': 'Das Werk hatte keinen eigenen Titel; uebernommen wurde "{titel}" von der Ebene {ebene} als Archivtitel',
  'target.primaryTitleTaken': 'Der Primaertitel ist bereits mit "{behalten}" belegt; "{verworfen}" wurde nicht uebernommen',
  'target.valueNotAllowed': '"{wert}" ist kein zulaessiger Wert fuer "{ziel}"',
  'target.formatAmbiguous': '"{wert}" steht in mehreren Traegerklassen ({klassen}). In der Werteliste die Klasse waehlen, '
    + 'etwa "Video:{wert}"',
  'target.identifierPattern': '"{wert}" passt nicht zum Kennungsmuster von "{ziel}"',
  'target.badDuration': '"{wert}" ist keine schemakonforme Laufzeit (erwartet PT01H30M00S)',
  'target.badDate': '"{wert}" ist kein zulaessiges Datum (erwartet JJJJ, JJJJ-MM oder JJJJ-MM-TT)',
  'target.notANumber': '"{wert}" ist keine Zahl',
  'target.badLanguage': '"{wert}" ist kein ISO-639-2-Sprachcode (erwartet z. B. "ger", "eng")',
  'target.unknown': 'Unbekanntes Ziel "{ziel}"',
  'chain.order': '"{nachschlag}" schlaegt nach, bevor "{davor}" den Wert fertig gebildet hat. '
    + 'Gesucht wird deshalb der unbearbeitete Wert, waehrend die Kette am Ende einen anderen '
    + 'liefert — das sieht aus wie "nichts gefunden". Empfohlen: erst normalisieren und '
    + 'aufteilen, dann nachschlagen.'
}

/** Kurzschreibweise fuer die Fundstellen. */
export function meldung(code: string, params?: Bausteine): MappingMessage {
  return params === undefined ? { code } : { code, params }
}

/**
 * Der deutsche Satz zu einer Meldung.
 *
 * Ein unbekannter Code liefert den Code selbst zurueck statt einer leeren
 * Zeichenkette: Eine Luecke soll auffallen, nicht verschwinden.
 */
export function meldungstext(m: MappingMessage): string {
  const vorlage = MELDUNGEN[m.code]
  if (vorlage === undefined) return m.code
  const p = m.params ?? {}
  return vorlage.replace(/\{(\w+)\}/g, (ganz, name: string) =>
    Object.prototype.hasOwnProperty.call(p, name) ? String(p[name]) : ganz)
}
