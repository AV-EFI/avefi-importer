/*
 * Die Herkunft eines Ergebnisses.
 *
 * `convert.ts` schreibt seit laengerem ein `run_config` je Lauf. Gelesen hat es
 * niemand, und deshalb fiel nicht auf, dass die Spalte bei aelteren Importen
 * fehlt: Auf der Demo-Instanz hatten am 10.09.2026 nur zehn von dreiundzwanzig
 * konvertierten Importen eine.
 *
 * Dieser Test haelt die drei Faelle auseinander, die auf der Seite verschiedene
 * Saetze bekommen: aufgezeichnet, nicht aufgezeichnet, und aufgezeichnet ohne
 * Zuordnungsprofil (MARC-XML, AVefi nativ).
 */
import { describe, expect, it } from 'vitest'
import { herkunft } from '../../server/api/imports/[id]/_herkunft'

/**
 * Ein `postgres`-Tag, das der Reihe nach vorbereitete Antworten ausgibt.
 *
 * Die Funktion stellt genau zwei Abfragen, beide nach Bauart "eine Zeile oder
 * keine". Mehr Nachbau braucht es hier nicht, und ein echter Datenbankzugriff
 * wuerde den Test an ein laufendes Postgres binden.
 */
function sqlStub(antworten: unknown[][]): never {
  let i = 0
  return (() => antworten[i++] ?? []) as never
}

const ZEILE = {
  id: 'i1',
  format_profile_id: null,
  mapping_profile_id: null,
  mapping_version: null,
  delimiter: null,
  run_config: null
} as never

const LAUF = {
  at: '2026-09-08T10:54:07.718Z',
  profileId: null,
  profileVersion: null,
  profileFormatVersion: null,
  avefiSchemaVersion: 'https://www.av-efi.net/av-efi-schema/model',
  delimiter: null,
  authorityEnabled: true,
  authorityLimit: 500
}

describe('herkunft', () => {
  it('meldet fehlende Aufzeichnung, statt den Abschnitt leer zu lassen', async () => {
    const h = await herkunft(sqlStub([]), ZEILE)
    expect(h.aufgezeichnet).toBe(false)
    expect(h.konvertiertAm).toBeNull()
    expect(h.schemaVersion).toBeNull()
    // Kein erfundenes "aus" — nicht aufgezeichnet ist etwas anderes als aus.
    expect(h.normdaten).toBeNull()
  })

  it('loest das Formatprofil auf, auch ohne Zuordnungsprofil', async () => {
    const zeile = { ...ZEILE, format_profile_id: 4, run_config: LAUF } as never
    const h = await herkunft(sqlStub([[{ label: 'MARC-XML', converter_key: 'marcxml_v1' }]]), zeile)
    expect(h.aufgezeichnet).toBe(true)
    expect(h.formatProfil).toEqual({ label: 'MARC-XML', converterKey: 'marcxml_v1' })
    expect(h.zuordnungsProfil).toBeNull()
    expect(h.normdaten).toEqual({ aktiv: true, obergrenze: 500, bilanz: null })
  })

  it('reicht die Bilanz der Normdaten aus dem Bericht weiter (#38)', async () => {
    const report_json = {
      authority: { requested: 7, resolved: 4, ambiguous: 1, misses: 0, failed: 2, skipped: 0, fromCache: 3, fetched: 4, limitReached: false }
    }
    const zeile = { ...ZEILE, run_config: LAUF, report_json } as never
    const h = await herkunft(sqlStub([]), zeile)
    expect(h.normdaten?.bilanz).toMatchObject({ werte: 7, eindeutig: 4, gescheitert: 2, ausZwischenspeicher: 3 })
  })

  it('stellt die verwendete Profilversion neben die heutige', async () => {
    const zeile = {
      ...ZEILE,
      mapping_profile_id: 7,
      mapping_version: 4,
      run_config: { ...LAUF, profileId: 7, profileVersion: 4 }
    } as never
    const h = await herkunft(sqlStub([[{ id: 7, name: 'fmdu_csv', version: 6 }]]), zeile)
    expect(h.zuordnungsProfil).toEqual({
      id: 7, name: 'fmdu_csv', verwendeteVersion: 4, aktuelleVersion: 6
    })
  })

  it('folgt der Profilnummer des Laufs, nicht der heutigen Zuordnung', async () => {
    // Der Import wurde inzwischen einem anderen Profil zugeordnet. Gefragt ist,
    // womit er lief.
    const zeile = {
      ...ZEILE,
      mapping_profile_id: 9,
      mapping_version: 1,
      run_config: { ...LAUF, profileId: 7, profileVersion: 4 }
    } as never
    let gefragt: unknown = null
    const sql = ((_s: unknown, ...werte: unknown[]) => {
      gefragt = werte[0]
      return [{ id: 7, name: 'alt', version: 4 }]
    }) as never
    const h = await herkunft(sql, zeile)
    expect(gefragt).toBe(7)
    expect(h.zuordnungsProfil?.verwendeteVersion).toBe(4)
  })
})
