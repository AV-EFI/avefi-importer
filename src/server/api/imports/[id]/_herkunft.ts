/*
 * Womit dieses Ergebnis entstanden ist.
 *
 * `convert.ts` schreibt nach jedem Lauf ein `run_config` in die Zeile —
 * Profilversion, Schemaversion, Trennzeichen, Normdateneinstellungen und der
 * Zeitpunkt. Gelesen wurde die Spalte bisher nirgends. Damit stand die Angabe
 * zwar in der Datenbank, aber nirgendwo, wo jemand sie sieht.
 *
 * Gebraucht wird sie an genau der Stelle, die Jasper Stratil in #6 benannt hat:
 * Wer von einem konkreten Import kommt, will wissen, wie dieses Ergebnis
 * zustande kam. Fuer tabellarische Importe beantwortet das die Zuordnungsseite.
 * Fuer MARC-XML und AVefi-nativ gibt es keine Spaltenzuordnung, und damit bisher
 * gar keine Antwort.
 *
 * Zwei Angaben stehen bewusst nicht im `run_config`, sondern werden beim Lesen
 * aufgeloest: das Formatprofil und der heutige Stand des Zuordnungsprofils. Das
 * eine, weil `run_config` es nie mitgeschrieben hat und ein Nachtrag die alten
 * Zeilen nicht erreichen wuerde. Das andere, weil "heute" sich aendert.
 *
 * Die Bilanz der Normdaten kommt aus dem Bericht (`report_json.authority`).
 * Dort stand sie seit dem 03.11.2026 bei jedem Lauf, gezeigt wurde sie nicht.
 * Lucas Nachtest zu #38 fragte genau danach: Ein spaeterer Lauf fand mehr als
 * der erste — gescheitert, abgeschaltet oder an der Obergrenze? Die Antwort
 * stand im Bericht und war unsichtbar.
 */
import type { Sql } from 'postgres'
import type { ImportRow, RunConfig } from '#shared/types/domain'

export interface Herkunft {
  /** Ob zu diesem Lauf ueberhaupt etwas aufgezeichnet wurde. */
  aufgezeichnet: boolean
  konvertiertAm: string | null
  formatProfil: { label: string; converterKey: string } | null
  zuordnungsProfil: {
    id: number
    name: string
    verwendeteVersion: number | null
    aktuelleVersion: number | null
  } | null
  schemaVersion: string | null
  trennzeichen: string | null
  normdaten: { aktiv: boolean; obergrenze: number | null; bilanz: NormdatenBilanz | null } | null
}

/**
 * Was beim Nachschlagen dieses Laufs herauskam. Jeder Wert landet in genau
 * einem Ergebnis: werte = eindeutig + mehrdeutig + ohneTreffer + gescheitert
 * + uebersprungen. Quer dazu, woher die Antwort kam: aus dem Zwischenspeicher
 * oder frisch nachgeschlagen.
 */
export interface NormdatenBilanz {
  werte: number
  eindeutig: number
  mehrdeutig: number
  ohneTreffer: number
  gescheitert: number
  uebersprungen: number
  ausZwischenspeicher: number
  nachgeschlagen: number
  obergrenzeErreicht: boolean
}

/** Bilanz aus `report_json.authority`; null, wenn der Bericht keine hat. */
export function normdatenBilanz(bericht: unknown): NormdatenBilanz | null {
  const a = (typeof bericht === 'object' && bericht !== null ? (bericht as Record<string, unknown>)['authority'] : null)
  if (typeof a !== 'object' || a === null) return null
  const roh = a as Record<string, unknown>
  if (typeof roh['requested'] !== 'number') return null
  const zahl = (k: string): number => (typeof roh[k] === 'number' && Number.isFinite(roh[k]) ? roh[k] as number : 0)
  return {
    werte: zahl('requested'),
    eindeutig: zahl('resolved'),
    mehrdeutig: zahl('ambiguous'),
    ohneTreffer: zahl('misses'),
    gescheitert: zahl('failed'),
    uebersprungen: zahl('skipped'),
    ausZwischenspeicher: zahl('fromCache'),
    nachgeschlagen: zahl('fetched'),
    obergrenzeErreicht: roh['limitReached'] === true
  }
}

export async function herkunft(sql: Sql, row: ImportRow): Promise<Herkunft> {
  const cfg = (row.run_config ?? null) as RunConfig | null

  let formatProfil: Herkunft['formatProfil'] = null
  if (row.format_profile_id !== null) {
    const [p] = await sql<{ label: string; converter_key: string }[]>`
      SELECT label, converter_key FROM format_profiles WHERE id = ${row.format_profile_id}`
    if (p !== undefined) formatProfil = { label: p.label, converterKey: p.converter_key }
  }

  /*
   * Die Profilnummer kommt aus dem Lauf, nicht aus der Zeile: Der Import kann
   * inzwischen einem anderen Profil zugeordnet sein als dem, mit dem er lief.
   * Nur wenn nichts aufgezeichnet ist, hilft die Zeile weiter.
   */
  const profilId = cfg?.profileId ?? row.mapping_profile_id
  let zuordnungsProfil: Herkunft['zuordnungsProfil'] = null
  if (profilId !== null) {
    const [p] = await sql<{ id: number; name: string; version: number }[]>`
      SELECT id, name, version FROM mapping_profiles WHERE id = ${profilId}`
    if (p !== undefined) {
      zuordnungsProfil = {
        id: p.id,
        name: p.name,
        verwendeteVersion: cfg?.profileVersion ?? row.mapping_version,
        aktuelleVersion: p.version
      }
    }
  }

  return {
    aufgezeichnet: cfg !== null,
    konvertiertAm: cfg?.at ?? null,
    formatProfil,
    zuordnungsProfil,
    schemaVersion: cfg?.avefiSchemaVersion ?? null,
    trennzeichen: cfg?.delimiter ?? row.delimiter ?? null,
    normdaten: cfg === null
      ? null
      : { aktiv: cfg.authorityEnabled, obergrenze: cfg.authorityLimit, bilanz: normdatenBilanz(row.report_json) }
  }
}
