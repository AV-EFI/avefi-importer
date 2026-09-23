/*
 * Pages, Layouts und Komponenten fragen den Server nicht selbst ab (#9).
 *
 * Stefan Stretz am 15.09.2026: Die fuenf urspruenglich beanstandeten Dateien
 * waren umgestellt, das Muster aber nicht verschwunden, sondern in Pages und
 * Layouts gewandert — 27 Aufrufe von useFetch in 24 Dateien. Umgestellt war,
 * was in der Liste stand, nicht, was die Anforderung meinte.
 *
 * Die Abfragen stehen seitdem an zwei Stellen: Adressen, Antwortformen und
 * schreibende Aufrufe in app/services, der lesende Weg ueber useFetch in den
 * Composables unter app/composables. Dieser Test haelt fest, dass es dabei
 * bleibt. Er liest den Quelltext, weil ein zurueckgewanderter Aufruf nichts
 * kaputt macht — er faellt nur nicht auf.
 *
 * Nebenbei faengt er feste '/api/...'-Adressen. Die umgehen useApi() und damit
 * die konfigurierbare API-Basis; im Layout stand bis zum 23.09.2026 eine.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const wurzel = fileURLToPath(new URL('../..', import.meta.url))

/** Wo nur angezeigt wird. Services und Composables sind ausdruecklich ausgenommen. */
const BEREICHE = ['app/pages', 'app/layouts', 'app/components', 'app/middleware']
const EINZELDATEIEN = ['app/app.vue', 'app/error.vue']

const MUSTER: Array<[string, RegExp]> = [
  ['useFetch', /\buse(?:Lazy)?Fetch\s*[<(]/],
  ['useAsyncData', /\buse(?:Lazy)?AsyncData\s*[<(]/],
  ['$fetch', /\$fetch\s*[<(]/],
  ["feste '/api/'-Adresse", /['"`]\/api\//]
]

function dateien(dir: string): string[] {
  const voll = join(wurzel, dir)
  const raus: string[] = []
  for (const name of readdirSync(voll)) {
    const pfad = join(voll, name)
    if (statSync(pfad).isDirectory()) raus.push(...dateien(join(dir, name)))
    else if (/\.(vue|ts)$/.test(name)) raus.push(join(dir, name))
  }
  return raus
}

/** Kommentare zaehlen nicht: Die Erklaerung, warum etwas nicht hier steht, darf es nennen. */
function ohneKommentare(text: string): string {
  return text
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

const ALLE = [...BEREICHE.flatMap(dateien), ...EINZELDATEIEN]

describe('Serverabfragen stehen in Services und Composables', () => {
  it('findet ueberhaupt Dateien', () => {
    // Sonst bestuende der Test auch dann, wenn die Verzeichnisse umziehen.
    expect(ALLE.length).toBeGreaterThan(40)
  })

  it.each(MUSTER)('kein %s in Pages, Layouts und Komponenten', (_name, muster) => {
    const treffer = ALLE.filter((datei) =>
      ohneKommentare(readFileSync(join(wurzel, datei), 'utf8')).split('\n').some((zeile) => muster.test(zeile))
    ).map((datei) => relative(wurzel, join(wurzel, datei)))
    expect(treffer).toEqual([])
  })
})
