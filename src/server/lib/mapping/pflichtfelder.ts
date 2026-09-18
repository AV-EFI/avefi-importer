/*
 * Pflichtfelder — welche Angaben das AVefi-Schema zwingend verlangt, und
 * welche davon der Nutzer selbst zuordnen muss.
 *
 * Bis zum 18.09.2026 beantworteten drei Stellen dieselbe Frage, und keine
 * fragte das Schema:
 *
 *   - `completeness.ts` zaehlte `has_primary_title` und `type` von Hand als
 *     Fehler auf. Daran haengt die Ampel.
 *   - `runner.ts` pruefte von Hand, ob irgendwo ein Haupttitel ankommt.
 *   - `SchemaModel.required()` haette beide Listen liefern koennen und wurde
 *     nirgends aufgerufen.
 *
 * Sichtbar wurde die Luecke an der Werkart: Ein Datensatz ohne `type` faerbte
 * die Plakette rot, im Pruefbericht stand kein Wort davon, und die Zuordnung
 * liess sich ohne Werkart anlegen, als fehle nichts.
 *
 * Die Liste steht hier als Code und nicht als Abfrage zur Laufzeit. Grund ist
 * das Verhalten von `schemaModel()`: Laesst sich das Schemadokument nicht
 * lesen, faellt es auf EMPTY_SCHEMA_MODEL zurueck und prueft milder, statt
 * abzubrechen. Fuer Wertelisten ist das richtig. Fuer eine Pflichtangabe waere
 * es falsch — `required()` gaebe dann eine leere Liste zurueck, und der
 * Konvertierungsblocker verschwaende lautlos genau dann, wenn ohnehin etwas
 * nicht stimmt. Deshalb: die Liste steht fest, und
 * `tests/pruefung/pflichtfelder.test.ts` haelt sie gegen das Schemadokument.
 * Wer ein Pflichtfeld ergaenzt oder entfernt, merkt es am fehlschlagenden
 * Test und nicht an einer Beschwerde aus Duesseldorf.
 *
 * Herkunft der Regel: Elias Oltmanns am 14.09.2026 in
 * AV-EFI/avefi-importer#20 — `has_primary_title` und `type` sind am
 * WorkVariant verpflichtend. Die Pflicht entsteht ueber ein geerbtes Attribut
 * mit ueberschriebener Eigenschaft; die TypeScript-Abbildung des Schemas
 * verliert sie dabei, das erzeugte JSON-Schema fuehrt sie korrekt. Wir lesen
 * das JSON-Schema. Es sind also Regeln des Verbunds und keine eigenen, und
 * die Meldungen tragen `source: 'schema'`.
 */

import type { TargetDefinition } from './targets.js'
import type { AvefiRecord, AvefiValue } from './builder.js'

function alsKnoten(v: unknown): AvefiValue {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as AvefiValue) : {}
}

function hatNamen(v: unknown): boolean {
  return String(alsKnoten(v)['has_name'] ?? '').trim() !== ''
}

function istLeer(v: unknown): boolean {
  return v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0)
}

/** Die drei Klassen, aus denen ein Datensatz besteht. */
export type PflichtKlasse = 'WorkVariant' | 'Manifestation' | 'Item'

export interface Pflichtfeld {
  klasse: PflichtKlasse
  /** Name der Eigenschaft, so wie das Schema sie fuehrt. */
  prop: string
  /** Pfad fuer den Pruefbericht. */
  schemaPfad: string
  /** Trifft auf die Katalogziele zu, ueber die der Nutzer das Feld belegt. */
  trifftZiel: (t: TargetDefinition) => boolean
  /** Ist das Feld im fertigen Datensatz belegt? */
  belegt: (record: AvefiRecord) => boolean
  /**
   * Wie schwer es wiegt, wenn kein Ziel zugeordnet ist.
   *
   * Der Unterschied folgt der Sache und nicht dem Schema: Fehlt der Titel, hat
   * der Erzeuger nichts, womit er ihn ersetzen koennte — der Lauf darf nicht
   * starten. Fehlt die Werkart, traegt builder.ts "Monographic" ein und meldet
   * das je Datensatz (record.workTypeDefaulted). Daraus einen Blocker zu
   * machen hiesse, zwei Stellen widersprechen zu lassen: hier gesperrt, dort
   * stillschweigend ersetzt. Die Warnung sagt, was sonst passiert, und laesst
   * die Entscheidung bei dem, der die Daten kennt.
   */
  schwere: 'error' | 'warning'
  /** Code der Meldung, wenn kein Ziel zugeordnet ist. */
  codeOhneZuordnung: string
  /** Text dazu. Steht hier, weil er die Regel erklaert, nicht die Oberflaeche. */
  meldungOhneZuordnung: string
  /** Code des Hinweises am fertigen Datensatz (Editor, Liste, Ampel). */
  codeHinweis: string
}

export const PFLICHTFELDER: readonly Pflichtfeld[] = [
  {
    klasse: 'WorkVariant',
    prop: 'has_primary_title',
    schemaPfad: 'WorkVariant.has_primary_title.has_name',
    // Nicht nur "Haupttitel": targets.ts gibt auch dem Archivtitel
    // (SuppliedDevisedTitle) primary: true, und das Schema sieht genau ihn fuer
    // den Pflichtplatz vor, wenn ein Film keinen eigenen Titel traegt.
    trifftZiel: (t) => t.writer.kind === 'title' && t.writer.primary === true,
    belegt: (r) => hatNamen(r.work['has_primary_title']),
    schwere: 'error',
    codeOhneZuordnung: 'title.nowhere',
    meldungOhneZuordnung:
      'Auf keiner Ebene ist eine Spalte auf einen Haupttitel gemappt — weder am Werk noch an '
      + 'Manifestation oder Exemplar. Die Datensaetze haetten dann keinen Titel, und ohne Titel ist ein '
      + 'Werk im Verbund nicht auffindbar. Infrage kommen "Haupttitel" oder "Archivtitel" auf einer der '
      + 'drei Ebenen; ein Festwert geht auch.',
    codeHinweis: 'hint.noPrimaryTitle'
  },
  {
    klasse: 'WorkVariant',
    prop: 'type',
    schemaPfad: 'WorkVariant.type',
    trifftZiel: (t) => t.level === 'work' && t.writer.kind === 'prop' && t.writer.prop === 'type',
    belegt: (r) => !istLeer(r.work['type']),
    schwere: 'warning',
    codeOhneZuordnung: 'worktype.nowhere',
    meldungOhneZuordnung:
      'Keine Spalte ist auf "Werk > Werkart" gemappt. Das AVefi-Schema verlangt die Werkart am Werk, '
      + 'deshalb traegt die Konvertierung "Monographic" ein — fuer jeden Datensatz dieses Bestands, '
      + 'ungeprueft. Wo das nicht stimmt, gehoert eine Spalte auf "Werk > Werkart" oder ein Festwert '
      + 'mit der richtigen Werkart in die Zuordnung.',
    codeHinweis: 'hint.noWorkType'
  }
]

/**
 * Pflichtangaben, die der Erzeuger selbst setzt — mit dem Grund, warum sie
 * nicht in der Liste oben stehen.
 *
 * Ohne diese Aufstellung haette der Waechtertest zwei Auswege: die Liste
 * stillschweigend unvollstaendig lassen oder Beanstandungen erzeugen, die
 * niemand beheben kann, weil das Feld niemandem gehoert. Beides waere
 * schlechter als eine Zeile Text.
 */
export const VOM_ERZEUGER_GESETZT: Readonly<Record<string, string>> = {
  'WorkVariant.category': 'Strukturangabe des Datensatzes, von builder.ts gesetzt.',
  'Manifestation.category': 'Strukturangabe des Datensatzes, von builder.ts gesetzt.',
  'Manifestation.is_manifestation_of': 'Verweis aufs Werk, entsteht in der Werkbildung (builder.ts).',
  'Item.category': 'Strukturangabe des Datensatzes, von builder.ts gesetzt.',
  'Item.is_item_of': 'Verweis auf die Manifestation, entsteht in der Werkbildung (builder.ts).'
}

/** Schluessel eines Pflichtfelds in der Form "Klasse.prop". */
export function pflichtSchluessel(klasse: string, prop: string): string {
  return `${klasse}.${prop}`
}

/** Pflichtfeld zu einem Hinweiscode, falls es eines gibt. */
export function pflichtfeldZuHinweis(code: string): Pflichtfeld | undefined {
  return PFLICHTFELDER.find((p) => p.codeHinweis === code)
}
