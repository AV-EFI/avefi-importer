/*
 * Completeness — Vollstaendigkeit eines kanonischen AVefi-Datensatzes und die
 * Belegung der vier Kernfelder.
 *
 * Die Kernfelder — Titel, Regie, Produktionsdatum, Produktionsland — sind der
 * Grund fuer die Zahl "4 von 4": Datensaetze mit allen vier Angaben lassen sich
 * verlaesslich mit den Bestaenden anderer Haeuser abgleichen; bei zweien wird
 * jede Zusammenfuehrung zum Ratespiel.
 */

import type { CompletenessHint, Severity } from '#shared/types/domain'
import type { AvefiRecord, AvefiValue } from './builder.js'
import { PFLICHTFELDER } from './pflichtfelder.js'

function asNode(v: unknown): AvefiValue {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as AvefiValue) : {}
}

function asList(v: unknown): AvefiValue[] {
  return Array.isArray(v) ? (v as AvefiValue[]) : []
}

function isEmpty(v: unknown): boolean {
  return v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0)
}

function hasName(v: unknown): boolean {
  const node = asNode(v)
  return String(node['has_name'] ?? '').trim() !== ''
}

function hasEventDate(events: unknown): boolean {
  return asList(events).some((e) => !isEmpty(e['has_date']))
}

function hasActivities(events: unknown): boolean {
  return asList(events).some((e) => asList(e['has_activity']).length > 0)
}

/* ---------------------------------------------------- Vollstaendigkeitswert */

/** Die acht Merkmale, an denen die Vollstaendigkeit gemessen wird. */
export function completenessChecks(record: AvefiRecord): Array<{ key: string; label: string; filled: boolean }> {
  const w = record.work
  return [
    { key: 'title', label: 'Haupttitel', filled: hasName(w['has_primary_title']) },
    { key: 'type', label: 'Werkart', filled: !isEmpty(w['type']) },
    { key: 'date', label: 'Produktionsjahr', filled: hasEventDate(w['has_event']) },
    { key: 'subject', label: 'Erschliessung', filled: asList(w['has_subject']).length > 0 },
    { key: 'activity', label: 'Beteiligte', filled: hasActivities(w['has_event']) },
    {
      key: 'genre', label: 'Genre oder Form',
      filled: asList(w['has_genre']).length > 0 || (Array.isArray(w['has_form']) && w['has_form'].length > 0)
    },
    { key: 'manifestation', label: 'Manifestation', filled: record.manifestations.length > 0 },
    { key: 'item', label: 'Exemplar', filled: record.items.length > 0 }
  ]
}

/**
 * Vollstaendigkeit in Prozent (0–100).
 *
 * Bleibt als gespeicherter Wert erhalten (Spalte records.completeness, danach
 * wird sortiert), wird aber nicht mehr als Bewertung angezeigt. Was die Liste
 * zeigt, ist coreScore: benannte Angaben statt eines Anteils.
 */
export function completeness(record: AvefiRecord): number {
  const checks = completenessChecks(record)
  const filled = checks.filter((c) => c.filled).length
  return Math.round((filled / checks.length) * 100)
}

/**
 * Wie viele der vier Kernfelder belegt sind, und welche fehlen.
 *
 * Titel, Regie, Produktionsdatum und Produktionsland sind die Angaben, an denen
 * der Abgleich mit den Bestaenden anderer Haeuser haengt. Deshalb "3 von 4" und
 * nicht "75 Prozent": Der Anteil sagt nicht, WELCHE Angabe fehlt, und bewertet
 * die Daten eines Hauses, statt sie zu beschreiben.
 *
 * Gerechnet wird ueber corePresence — dieselbe Stelle, die auch die
 * Belegungsstatistik des Prüfberichts speist.
 */
export function coreScore(record: AvefiRecord): { filled: number; total: number; missing: CoreFieldKey[] } {
  const presence = corePresence(record)
  const keys = Object.keys(CORE_FIELDS) as CoreFieldKey[]
  const missing = keys.filter((k) => !presence[k])
  return { filled: keys.length - missing.length, total: keys.length, missing }
}

/** Hinweise fuer den Datensatz-Editor. */
export const HINWEISE: Record<string, string> = {
  'hint.noPrimaryTitle': 'Haupttitel (has_primary_title) fehlt',
  'hint.noWorkType': 'Werkart (type) fehlt',
  'hint.noProductionYear': 'Produktionsjahr empfohlen',
  'hint.noSubjects': 'Schlagwoerter oder Personen empfohlen',
  'hint.noActivities': 'Beteiligte (Regie o. Ae.) empfohlen',
  'hint.noManifestation': 'Keine Manifestation erfasst',
  'hint.noItem': 'Kein Exemplar erfasst',
  'hint.complete': 'Grunddaten vollstaendig'
}

/**
 * Hinweise fuer den Datensatz-Editor.
 *
 * Bis zum 07.09.2026 standen hier acht fest verdrahtete deutsche Saetze, die
 * die Oberflaeche unveraendert anzeigte — auch die englische. Jetzt traegt
 * jeder Hinweis seinen Code; der deutsche Satz reist als Rueckfallebene mit,
 * weil er auch dort gebraucht wird, wo keine Oberflaeche uebersetzt.
 */
export function completenessIssues(record: AvefiRecord): CompletenessHint[] {
  const w = record.work
  const codes: Array<{ level: Severity | 'ok'; code: string }> = []

  /*
   * Pflichtangaben des Schemas. Bis zum 18.09.2026 standen Haupttitel und
   * Werkart hier von Hand — dieselbe Frage, die runner.ts an anderer Stelle
   * ebenfalls von Hand beantwortete, mit unterschiedlichem Ergebnis. Jetzt
   * sagt PFLICHTFELDER es einmal, und beide lesen dort.
   *
   * Immer 'error', unabhaengig von `schwere`: Das dort ist die Strenge in der
   * ZUORDNUNG, wo eine fehlende Angabe noch nachgetragen werden kann. Hier
   * steht ein fertiger Datensatz, und an dem fehlt sie wirklich.
   */
  for (const feld of PFLICHTFELDER) {
    if (!feld.belegt(record)) codes.push({ level: 'error', code: feld.codeHinweis })
  }

  if (!hasEventDate(w['has_event'])) codes.push({ level: 'warning', code: 'hint.noProductionYear' })
  if (asList(w['has_subject']).length === 0) codes.push({ level: 'warning', code: 'hint.noSubjects' })
  if (!hasActivities(w['has_event'])) codes.push({ level: 'warning', code: 'hint.noActivities' })
  if (record.manifestations.length === 0) codes.push({ level: 'warning', code: 'hint.noManifestation' })
  if (record.items.length === 0) codes.push({ level: 'warning', code: 'hint.noItem' })

  if (codes.length === 0) codes.push({ level: 'ok', code: 'hint.complete' })
  return codes.map((h) => ({ ...h, text: HINWEISE[h.code] ?? h.code }))
}

/**
 * Was ein Vollstaendigkeitsfehler im Pruefbericht sagt.
 *
 * Laenger als die Saetze in HINWEISE, weil der Bericht einen anderen Leser hat:
 * Im Datensatz-Editor steht der Satz neben dem Feld, hier steht er allein.
 *
 * Gefunden von Luca Wollny am 10.09.2026: Eine Konvertierung ohne jede
 * Titelangabe wurde als "keine Beanstandungen" ausgewiesen. Die Anwendung
 * stufte den Fall intern laengst als Fehler ein — completenessIssues faerbt
 * seit #15 die Plakette rot —, nur speiste das den Editor und die Liste, nicht
 * den Bericht. Auf derselben Seite stand die Belegungsstatistik "Haupttitel
 * 0 von N" neben der Plakette "keine Beanstandungen".
 */
export const BERICHTSTEXT: Record<string, string> = {
  'hint.noPrimaryTitle':
    'Der Datensatz hat keinen Haupttitel. Das AVefi-Schema verlangt ihn am WorkVariant, und ohne Titel ist '
    + 'ein Werk im Verbund weder auffindbar noch mit einem Bestand abzugleichen. Entweder fuehrt keine Spalte '
    + 'auf einen Titel, oder die Zelle dieser Zeile ist leer.',
  'hint.noWorkType':
    'Der Datensatz hat keine Werkart. Das AVefi-Schema verlangt sie am WorkVariant. Entweder fuehrt keine '
    + 'Spalte auf "Werk > Werkart", oder die Zelle dieser Zeile ist leer; ein Festwert traegt die Angabe '
    + 'fuer den ganzen Bestand.'
}

/**
 * Ampel der Kernfeld-Plakette.
 *
 * Bis zum 08.09.2026 richtete sich die Farbe nach dem Anteil ausgefuellter
 * Felder (ringClass: rot unter 50 %, gelb unter 80 %). Das passte nicht mehr zu
 * dem, was danebensteht: Die Plakette nennt seit dem 31.08. benannte Felder
 * statt eines Anteils, und die Legende beschrieb weiterhin Prozentgrenzen. Ein
 * Datensatz ohne jeden Titel stand deshalb auf Gelb, obwohl direkt daneben
 * "Pflichtangabe fehlt" in Rot stand (gefunden von Matti Stoehr, im Telefonat
 * mit Elias Oltmanns am 08.09. besprochen).
 *
 * Jetzt folgt die Farbe der Verbindlichkeit statt der Menge:
 *
 *   rot    ein Pflichtfeld fehlt — der Datensatz ist so nicht schemakonform
 *   gelb   empfohlene Felder fehlen
 *   gruen  alle vier Kernfelder belegt
 *
 * Welche Felder Pflicht sind, sagt weder diese Funktion noch
 * completenessIssues, sondern PFLICHTFELDER in pflichtfelder.ts — dieselbe
 * Liste, gegen die auch die Zuordnung geprueft wird und die
 * tests/pruefung/pflichtfelder.test.ts gegen das Schemadokument haelt. Heute
 * sind das Haupttitel und Werkart. Kommt ein drittes dazu, faerbt sich die
 * Plakette von selbst mit, und der Pruefbericht sagt dasselbe.
 */
export type CoreState = 'danger' | 'part' | 'full'

export function coreState(record: AvefiRecord): CoreState {
  if (completenessIssues(record).some((h) => h.level === 'error')) return 'danger'
  const { filled, total } = coreScore(record)
  return filled === total ? 'full' : 'part'
}

/* -------------------------------------------------------------- Kernfelder */

export const CORE_FIELDS = {
  titel: 'Haupttitel',
  regie: 'Regie',
  produktionsdatum: 'Produktionsdatum',
  produktionsland: 'Produktionsland'
} as const

export type CoreFieldKey = keyof typeof CORE_FIELDS

/** Welche Kernfelder sind in diesem Datensatz belegt? */
export function corePresence(record: AvefiRecord): Record<CoreFieldKey, boolean> {
  const w = record.work
  const titel = hasName(w['has_primary_title'])

  let regie = false
  let datum = false
  let land = false

  for (const ev of asList(w['has_event'])) {
    if (String(ev['has_date'] ?? '').trim() !== '') datum = true
    for (const g of asList(ev['located_in'])) {
      if (hasName(g)) land = true
    }
    for (const act of asList(ev['has_activity'])) {
      if (act['category'] !== 'avefi:DirectingActivity') continue
      for (const a of asList(act['has_agent'])) {
        if (hasName(a)) regie = true
      }
    }
  }

  return { titel, regie, produktionsdatum: datum, produktionsland: land }
}

export interface CoreTally {
  records: number
  fields: Record<CoreFieldKey, number>
  /** Wie viele Datensaetze haben 0, 1, 2, 3 bzw. 4 Kernfelder? */
  complete: Record<'0' | '1' | '2' | '3' | '4', number>
}

export function newCoreTally(): CoreTally {
  return {
    records: 0,
    fields: { titel: 0, regie: 0, produktionsdatum: 0, produktionsland: 0 },
    complete: { '0': 0, '1': 0, '2': 0, '3': 0, '4': 0 }
  }
}

/** Nimmt einen Datensatz in die Belegungsstatistik auf. Aendert die Statistik. */
export function addToCoreTally(tally: CoreTally, record: AvefiRecord): CoreTally {
  const presence = corePresence(record)
  tally.records++
  let n = 0
  for (const key of Object.keys(CORE_FIELDS) as CoreFieldKey[]) {
    if (presence[key]) {
      tally.fields[key]++
      n++
    }
  }
  const bucket = String(n) as '0' | '1' | '2' | '3' | '4'
  tally.complete[bucket]++
  return tally
}

export interface CoreSummary extends CoreTally {
  percent: Record<CoreFieldKey, number>
  allFour: number
  allFourPercent: number
  labels: typeof CORE_FIELDS
}

/** Ergaenzt Prozentwerte fuer die Anzeige. */
export function finishCoreTally(tally: CoreTally): CoreSummary {
  const n = Math.max(1, tally.records)
  const percent = { titel: 0, regie: 0, produktionsdatum: 0, produktionsland: 0 }
  for (const key of Object.keys(CORE_FIELDS) as CoreFieldKey[]) {
    percent[key] = Math.round((tally.fields[key] * 100) / n)
  }
  const allFour = tally.complete['4']
  return {
    ...tally,
    percent,
    allFour,
    allFourPercent: Math.round((allFour * 100) / n),
    labels: CORE_FIELDS
  }
}

/** Belegung je Kernfeld im Format von ImportReport.coverage. */
export function coreCoverage(tally: CoreTally): Record<string, { filled: number; total: number }> {
  const out: Record<string, { filled: number; total: number }> = {}
  for (const key of Object.keys(CORE_FIELDS) as CoreFieldKey[]) {
    out[key] = { filled: tally.fields[key], total: tally.records }
  }
  return out
}
