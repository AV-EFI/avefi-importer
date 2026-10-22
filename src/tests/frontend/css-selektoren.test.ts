/*
 * Jeder ID-Selektor im Stylesheet trifft ein Element.
 *
 * Am 21.10.2026 meldete Luca Wollny zwei Fehler, die auf denselben Grund
 * zurueckgingen: Regeln fuer #importsTable und #mappingApp. Beide IDs gab es seit
 * der Neufassung auf Nuxt am 25.08. nicht mehr. Die Regeln standen weiter in
 * app.css, mit Kommentaren, die genau die Fehler beschrieben, die sie verhindern
 * sollten — die Konverterauswahl wurde an der Tabellenhuelle abgeschnitten
 * (#30), die Importtabelle lief in Firefox rechts ueber (#31).
 *
 * Nichts meldet so etwas: Ein Selektor ohne Treffer ist gueltiges CSS. Dieser
 * Test liest jeden ID-Selektor aus app.css und verlangt, dass irgendwo in den
 * Vorlagen ein Element diese ID traegt. Klassen prueft er nicht — die werden zu
 * oft zusammengesetzt (`b-${art}`), als dass ein Suchmuster sie zuverlaessig fande.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const wurzel = fileURLToPath(new URL('../..', import.meta.url))

/** IDs aus den Selektoren lesen — nicht aus Kommentaren, nicht aus Farbwerten. */
export function idSelektoren(css: string): Set<string> {
  const ohneKommentare = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const ids = new Set<string>()
  for (const teil of ohneKommentare.split('{')) {
    const selektor = teil.split('}').pop()
    if (!selektor || selektor.trim().startsWith('@')) continue
    for (const treffer of selektor.matchAll(/#([a-zA-Z][\w-]*)/g)) ids.add(treffer[1]!)
  }
  return ids
}

function dateien(dir: string, endungen: readonly string[]): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const pfad = join(dir, name)
    if (statSync(pfad).isDirectory()) out.push(...dateien(pfad, endungen))
    else if (endungen.some((e) => name.endsWith(e))) out.push(pfad)
  }
  return out
}

/** Steht die ID als Attribut oder als Sprungziel in einer Vorlage? */
function kommtVor(id: string, texte: readonly string[]): boolean {
  const muster = [`id="${id}"`, `id='${id}'`, `id: '${id}'`, `"#${id}"`, `'#${id}'`]
  return texte.some((t) => muster.some((m) => t.includes(m)))
}

describe('ID-Selektoren in app.css', () => {
  const css = readFileSync(`${wurzel}/app/assets/css/app.css`, 'utf8')
  const vorlagen = dateien(`${wurzel}/app`, ['.vue', '.ts']).map((p) => readFileSync(p, 'utf8'))

  it('liest Selektoren, keine Kommentare und keine Farben', () => {
    const probe = idSelektoren('/* #alt */ .a{color:#fff} #neu .b{x:1} @media (max-width:1px){#innen{y:2}}')
    expect([...probe].sort()).toEqual(['innen', 'neu'])
  })

  it('jede ID im Stylesheet traegt ein Element', () => {
    const ohne = [...idSelektoren(css)].filter((id) => !kommtVor(id, vorlagen))
    expect(ohne, 'ID-Selektor ohne Element — Regel greift nicht').toEqual([])
  })

  it('die Klassen, die #importsTable und #mappingApp ersetzt haben, stehen an Elementen', () => {
    const alle = vorlagen.join('\n')
    expect(alle).toMatch(/class="tablewrap imports-table"/)
    expect(alle).toMatch(/class="tablewrap mapping-table"/)
  })
})
