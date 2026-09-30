/*
 * Jeder Code im Pruefbericht hat einen Satz in beiden Sprachen.
 *
 * Stefan Stretz am 29.09.2026 in AV-EFI/avefi-importer#10: Der Waechter in
 * meldungscodes.test.ts erfasste nur Codes mit Punkt ("authority.kind-mismatch").
 * Die Codes des Konverters, des Workers und des Pruefdienstes haben keinen
 * Punkt (`missing_title`, `identifier_not_unique`) und fielen durch — und der
 * Pruefbericht zeigte ohnehin nur den deutschen Serversatz.
 *
 * Gelesen wird wie dort der Quelltext, nicht ein Lauf: gerade die seltenen
 * Pfade (Arbeitsmappe unlesbar, Pruefdienst nicht erreichbar) laufen beim
 * Testen nicht durch.
 *
 * Quellen:
 *  - TypeScript unter server/lib/converters, server/worker und der
 *    Datensatzeditor (`code: '...'`),
 *  - der Pruefdienst efi-conv/service.py (`"code": "..."` und die Regelarten),
 *  - die Vollstaendigkeitshinweise, die als Fehler in den Bericht gehen,
 *  - die Codes der zeilengenauen Diagnose (`parse_*`), auch die zusammengesetzten.
 */
import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { BERICHTSTEXT } from '../../server/lib/mapping/completeness.js'
import { BRAUCHT_BAUSTEINE } from '../../shared/meldungscodes'

const LOCALES = 'i18n/locales'

function tsDateien(pfad: string): string[] {
  if (!statSync(pfad).isDirectory()) return [pfad]
  return readdirSync(pfad).flatMap((name) => tsDateien(join(pfad, name))).filter((p) => p.endsWith('.ts'))
}

const TS_QUELLEN = ['server/lib/converters', 'server/worker', 'server/api/records/_record.ts']

function berichtsCodes(): string[] {
  const codes = new Set<string>()
  for (const pfad of TS_QUELLEN.flatMap(tsDateien)) {
    if (pfad.endsWith('parseDiagnostics.ts')) continue
    for (const m of readFileSync(pfad, 'utf8').matchAll(/\bcode: '([a-z][a-z_]*)'/g)) codes.add(m[1]!)
  }
  const dienst = readFileSync('efi-conv/service.py', 'utf8')
  for (const m of dienst.matchAll(/"code": "([a-z_]+)"/g)) codes.add(m[1]!)
  for (const m of dienst.matchAll(/"(rule_[a-z_]+)"/g)) codes.add(m[1]!)
  for (const code of Object.keys(BERICHTSTEXT)) codes.add(code.replace(/[.-]/g, '_'))
  return [...codes].sort()
}

/** Die Einteilung aus einer Funktion wie jsonArt lesen: jedes `return '...'`. */
function arten(text: string, funktion: string): string[] {
  const rumpf = new RegExp(`function ${funktion}\\([^)]*\\): string \\{([\\s\\S]*?)\\n\\}`).exec(text)?.[1] ?? ''
  return [...rumpf.matchAll(/return '([a-z]+)'/g)].map((m) => m[1]!)
}

function diagnoseCodes(): string[] {
  const text = readFileSync('server/lib/converters/parseDiagnostics.ts', 'utf8')
  const codes = new Set<string>()
  for (const m of text.matchAll(/'(parse_[a-z_]+)'/g)) codes.add(m[1]!)
  for (const a of arten(text, 'jsonArt')) codes.add(`parse_json_${a}`)
  for (const a of arten(text, 'xmlArt')) codes.add(`parse_xml_${a}`)
  return [...codes].sort()
}

function bereich(sprache: string, name: string): Record<string, string> {
  const doc = JSON.parse(readFileSync(`${LOCALES}/${sprache}/imports.json`, 'utf8')) as {
    imports: Record<string, Record<string, string>>
  }
  return doc.imports[name] ?? {}
}

/** `schema__enum` gehoert zum Code `schema`. */
const basis = (key: string): string => key.split('__')[0]!

describe('Berichtscodes', () => {
  it('findet ueberhaupt Codes — sonst prueft dieser Test nichts', () => {
    expect(berichtsCodes().length).toBeGreaterThan(25)
    expect(berichtsCodes()).toContain('identifier_not_unique')
    expect(berichtsCodes()).toContain('rule_period')
    expect(diagnoseCodes()).toContain('parse_json_comma')
    expect(diagnoseCodes()).toContain('parse_xml_other')
  })

  for (const sprache of ['de', 'en']) {
    it(`hat zu jedem Berichtscode einen Satz (${sprache})`, () => {
      const vorhanden = Object.keys(bereich(sprache, 'issueText'))
      const fehlend = berichtsCodes().filter((c) => !vorhanden.some((k) => basis(k) === c))
      expect(fehlend, `ohne Satz in ${sprache}/imports.json › issueText`).toEqual([])
    })

    it(`hat zu jedem Diagnosecode Satz und Hinweis (${sprache})`, () => {
      const text = bereich(sprache, 'diagText')
      const hint = bereich(sprache, 'diagHint')
      expect(diagnoseCodes().filter((c) => text[c] === undefined), 'ohne diagText').toEqual([])
      expect(diagnoseCodes().filter((c) => hint[c] === undefined), 'ohne diagHint').toEqual([])
    })

    it(`hat keinen Satz ohne zugehoerigen Code (${sprache})`, () => {
      const erzeugt = new Set([...berichtsCodes(), 'betrifft', 'beispiele'])
      const verwaist = Object.keys(bereich(sprache, 'issueText')).filter((k) => !erzeugt.has(basis(k)))
      expect(verwaist, `verwaist in ${sprache}`).toEqual([])
      const diag = new Set(diagnoseCodes())
      expect(Object.keys(bereich(sprache, 'diagText')).filter((k) => !diag.has(k))).toEqual([])
      expect(Object.keys(bereich(sprache, 'diagHint')).filter((k) => !diag.has(k))).toEqual([])
    })
  }

  it('kennt nur Codes als „braucht Bausteine", die es gibt', () => {
    const erzeugt = new Set([...berichtsCodes(), 'merge.conflict', 'identifier.duplicate'])
    expect([...BRAUCHT_BAUSTEINE].filter((c) => !erzeugt.has(c))).toEqual([])
  })
})
