/*
 * Jeder Fehlercode der API hat einen Text in beiden Sprachen.
 *
 * Luca Wollny am 01.10.2026 in #20: „Speichern und Konvertieren" meldete nur
 * „Unerwarteter Fehler." Der Server hatte mit `start_blocked` geantwortet, und
 * dafuer gab es keinen Text (#29). meldungscodes.test.ts hielt die Codes der
 * Pruefmeldungen gegen die Uebersetzungen — die Codes, mit denen die API selbst
 * Fehler meldet (`fail(status, 'code')`), prueft niemand. Ein Abgleich fand
 * zwei ohne Text: `start_blocked` und `label_too_long`.
 *
 * Wie dort wird der Quelltext gelesen, nicht ein Lauf. Ein Code, der aus einer
 * Variablen kommt, ist fuer ein Suchmuster unsichtbar. Deshalb muss jede
 * `fail`-Zeile ohne Literal hier ausdruecklich aufgeloest werden — sonst
 * schlaegt der Test fehl, statt den Code still zu uebergehen.
 */

import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, sep } from 'node:path'


const LOCALES = 'i18n/locales'
/** Das zweite Argument von fail(): alles bis zum naechsten Argument. */
const FAIL = /\bfail\(\d{3},\s*(.*?)(?:,\s*[{'`]|\))/
const LITERAL = /'([a-z][a-z0-9_]*)'/g

/** Zeilen, deren Code aus einer Variablen kommt, und woher die Werte stammen. */
const AUS_VARIABLE: ReadonlyArray<{ variable: string; codes: () => string[] }> = [
  // _lib.ts laesst sich ausserhalb von Nitro nicht importieren
  // (defineEventHandler), deshalb wird die Tabelle aus dem Quelltext gelesen.
  { variable: 'rejected', codes: () => tabelle(join('server', 'api', 'imports', '_lib.ts'), 'REJECTED_WORKBOOKS') }
]

/** Die Werte einer `const NAME: Record<string, string> = { a: 'x', … }`. */
function tabelle(pfad: string, name: string): string[] {
  const text = readFileSync(pfad, 'utf8')
  const start = text.indexOf(`const ${name}`)
  const block = text.slice(start, text.indexOf('}', start))
  const werte = [...block.matchAll(/:\s*'([a-z0-9_]+)'/g)].map((m) => m[1]!)
  if (werte.length === 0) throw new Error(`${name} in ${pfad} nicht gefunden`)
  return werte
}

/** Der Zuordnungseditor liest nur `mapping.error.*` (components/mapping/errors.ts). */
const EDITOR_PFADE = [join('server', 'api', 'mappings') + sep, join('server', 'api', 'imports', '[id]', 'mapping') + sep]

function tsDateien(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const pfad = join(dir, name)
    if (statSync(pfad).isDirectory()) out.push(...tsDateien(pfad))
    else if (name.endsWith('.ts')) out.push(pfad)
  }
  return out
}

interface Fundstelle { code: string; pfad: string }

function fehlercodes(): { funde: Fundstelle[]; unaufgeloest: string[] } {
  const funde: Fundstelle[] = []
  const unaufgeloest: string[] = []
  for (const pfad of tsDateien(join('server', 'api'))) {
    readFileSync(pfad, 'utf8').split('\n').forEach((zeile, i) => {
      const m = FAIL.exec(zeile)
      if (m === null) return
      // Ternaere wie `a ? 'sheet_unknown' : 'no_selection'` liefern beide.
      const argument = m[1]!.trim()
      const literale = [...argument.matchAll(LITERAL)].map((l) => l[1]!)
      if (literale.length > 0) {
        for (const code of literale) funde.push({ code, pfad })
        return
      }
      const quelle = AUS_VARIABLE.find((q) => q.variable === argument)
      if (quelle === undefined) unaufgeloest.push(`${pfad}:${i + 1}`)
      else for (const code of quelle.codes()) funde.push({ code, pfad })
    })
  }
  return { funde, unaufgeloest }
}

function schluessel(sprache: string): Set<string> {
  const out = new Set<string>()
  const walk = (o: Record<string, unknown>, p: string) => {
    for (const [k, v] of Object.entries(o)) {
      if (v !== null && typeof v === 'object') walk(v as Record<string, unknown>, `${p}${k}.`)
      else out.add(`${p}${k}`)
    }
  }
  for (const datei of readdirSync(join(LOCALES, sprache))) {
    if (datei.endsWith('.json')) walk(JSON.parse(readFileSync(join(LOCALES, sprache, datei), 'utf8')), '')
  }
  return out
}

describe('Fehlercodes der API', () => {
  const { funde, unaufgeloest } = fehlercodes()

  it('findet die Codes ueberhaupt', () => {
    // Faellt die Suche aus, waeren alle folgenden Pruefungen leer und gruen.
    expect(funde.length).toBeGreaterThan(40)
    expect(funde.map((f) => f.code)).toContain('not_complete')
  })

  it('jeder Code kommt aus einem Literal oder einer bekannten Quelle', () => {
    expect(unaufgeloest, 'fail() mit Code aus einer Variablen — in AUS_VARIABLE eintragen').toEqual([])
  })

  for (const sprache of ['de', 'en']) {
    const keys = schluessel(sprache)

    it(`${sprache}: jeder Code hat einen *.error-Text`, () => {
      const ohne = [...new Set(funde.map((f) => f.code))]
        .filter((code) => ![...keys].some((k) => k.endsWith(`.error.${code}`)))
      expect(ohne).toEqual([])
    })

    it(`${sprache}: Codes des Zuordnungseditors stehen unter mapping.error`, () => {
      const ohne = [...new Set(funde
        .filter((f) => EDITOR_PFADE.some((p) => f.pfad.startsWith(p)))
        .map((f) => f.code))]
        .filter((code) => !keys.has(`mapping.error.${code}`))
      expect(ohne).toEqual([])
    })
  }
})
