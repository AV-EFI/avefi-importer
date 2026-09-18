/*
 * Jeder Meldungscode hat einen Text in beiden Sprachen.
 *
 * Stefan Stretz am 15.09.2026 in AV-EFI/avefi-importer#10: Drei Codes fielen
 * in der englischen Oberflaeche auf den deutschen Servertext zurueck; zwei
 * weitere hatte er im urspruenglichen Befund genannt und nicht mehr
 * wiedergefunden. Nachgezaehlt waren es neun.
 *
 * Der Rueckfall ist Absicht — useMeldungstext nimmt den mitgereisten deutschen
 * Satz, weil ein Code in der Oberflaeche schlimmer waere als ein Satz in der
 * falschen Sprache. Genau deshalb faellt ein fehlender Text aber nirgends auf.
 * Dieser Test ist die Stelle, an der er auffaellt.
 *
 * Gelesen wird der Quelltext, nicht ein Lauf: Ein Code, den nur ein seltener
 * Pfad erzeugt, soll seinen Text ebenso haben wie einer aus dem Alltag — und
 * gerade der seltene Pfad wird beim Testen nicht durchlaufen.
 */

import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { PFLICHTFELDER } from '../../server/lib/mapping/pflichtfelder.js'
import { HINWEISE } from '../../server/lib/mapping/completeness.js'

const LOCALES = 'i18n/locales'

/*
 * Codes der Beanstandungen haben genau einen Punkt: "authority.kind-mismatch".
 * Gesucht wird auf Zeilen, in denen das Wort `code` vorkommt — mal steht der
 * Code direkt daneben, mal hinter einem Fragezeichen
 * (`code: ohne > 0 ? 'data.branchGap' : 'data.branchBalance'`). Das
 * schliessende Anfuehrungszeichen haelt Katalogschluessel wie
 * 'work.title.primary' heraus, die zwei Punkte haben.
 */
const CODE_ZEILE = /\bcode\b/
const CODE = /'([a-z][a-zA-Z0-9]*\.[a-z][a-zA-Z0-9-]*)'/g
/** Der Meldungskatalog fuehrt sie als Schluessel. */
const KATALOG = /^\s*'([a-z][a-zA-Z0-9]*\.[a-z][a-zA-Z0-9-]*)':/gm

function tsDateien(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const pfad = join(dir, name)
    if (statSync(pfad).isDirectory()) out.push(...tsDateien(pfad))
    else if (name.endsWith('.ts')) out.push(pfad)
  }
  return out
}

function erzeugteCodes(): string[] {
  const codes = new Set<string>()
  for (const pfad of tsDateien('server')) {
    const text = readFileSync(pfad, 'utf8')
    for (const zeile of text.split('\n')) {
      if (!CODE_ZEILE.test(zeile)) continue
      for (const m of zeile.matchAll(CODE)) codes.add(m[1]!)
    }
    if (pfad.endsWith('meldungen.ts')) {
      for (const m of text.matchAll(KATALOG)) codes.add(m[1]!)
    }
  }
  // Codes, die nicht als Zeichenkette neben `code:` stehen, weil sie aus einer
  // Liste kommen. Der Ausdruck oben faende sie nicht.
  for (const p of PFLICHTFELDER) codes.add(p.codeOhneZuordnung)
  // Die Vollstaendigkeitshinweise tragen zwar auch einen Code, werden aber
  // ueber records.json uebersetzt (useMeldungstext.hinweis). Sie haben ihren
  // eigenen Test weiter unten.
  return [...codes].filter((c) => !c.startsWith('hint.')).sort()
}

function schluessel(code: string): string {
  return code.replace(/[.-]/g, '_')
}

function texte(sprache: string, datei: string, pfad: string[]): Record<string, unknown> {
  const doc = JSON.parse(readFileSync(`${LOCALES}/${sprache}/${datei}`, 'utf8')) as Record<string, unknown>
  let node: unknown = doc
  for (const teil of pfad) node = (node as Record<string, unknown>)[teil]
  return node as Record<string, unknown>
}

describe('Meldungstexte', () => {
  it('findet ueberhaupt Codes — sonst prueft dieser Test nichts', () => {
    expect(erzeugteCodes().length).toBeGreaterThan(30)
  })

  for (const sprache of ['de', 'en']) {
    it(`hat zu jedem Meldungscode einen Text (${sprache})`, () => {
      const vorhanden = texte(sprache, 'mapping.json', ['mapping', 'checkMsg'])
      const fehlend = erzeugteCodes().filter((c) => vorhanden[schluessel(c)] === undefined)
      expect(fehlend, `ohne Text in ${sprache}/mapping.json`).toEqual([])
    })

    it(`hat zu jedem Vollstaendigkeitshinweis einen Text (${sprache})`, () => {
      const vorhanden = texte(sprache, 'records.json', ['records', 'hint'])
      const fehlend = Object.keys(HINWEISE)
        .map((c) => c.replace(/^hint\./, ''))
        .filter((c) => vorhanden[c] === undefined)
      expect(fehlend, `ohne Text in ${sprache}/records.json`).toEqual([])
    })

    it(`hat keinen Text ohne zugehoerigen Code (${sprache})`, () => {
      // Andersherum ebenso: Ein Text fuer einen Code, den niemand mehr
      // erzeugt, ist Ballast, den beim naechsten Mal jemand mituebersetzt.
      const vorhanden = Object.keys(texte(sprache, 'mapping.json', ['mapping', 'checkMsg']))
      const erzeugt = new Set(erzeugteCodes().map(schluessel))
      expect(vorhanden.filter((k) => !erzeugt.has(k)), `verwaist in ${sprache}`).toEqual([])
    })
  }
})
