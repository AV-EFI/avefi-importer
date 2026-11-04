/*
 * Institutionen anlegen, umbenennen, leere loeschen (#43, 04.11.2026).
 *
 * Die Datenbankteile laufen in CI nicht; geprueft wird hier, was ohne
 * Datenbank zu pruefen ist, und vor allem der Waechter gegen das Schema: Eine
 * Tabelle, die kuenftig auf institutions verweist, muss in die Leer-Pruefung,
 * sonst nimmt ein Loeschen sie per Kaskade mit.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  INSTITUTION_VERWEISE, InstitutionFehler, MAX_NAME_LAENGE, kurzname, pruefeName
} from '../../server/lib/institutionen'

const wurzel = join(__dirname, '..', '..')
const lies = (pfad: string): string => readFileSync(join(wurzel, pfad), 'utf8')

describe('Leer-Pruefung gegen das Schema', () => {
  it('kennt jede Tabelle, die auf institutions verweist', () => {
    const schema = lies('db/schema.sql')
    const tabellen = new Set<string>()
    for (const block of schema.split(/(?=CREATE TABLE)/)) {
      const name = /^CREATE TABLE(?: IF NOT EXISTS)? (\w+)/.exec(block)?.[1]
      if (name !== undefined && /REFERENCES institutions\s*\(/.test(block)) tabellen.add(name)
    }
    expect(tabellen.size, 'gefundene Tabellen').toBeGreaterThanOrEqual(3)
    expect([...tabellen].sort()).toEqual(INSTITUTION_VERWEISE.map((v) => v.tabelle).sort())
  })
})

describe('kurzname', () => {
  it.each([
    ['Filmmuseum Düsseldorf', 'filmmuseum-duesseldorf'],
    ['Deutsches Filminstitut & Filmmuseum', 'deutsches-filminstitut-filmmuseum'],
    ['Straße der Kinos', 'strasse-der-kinos'],
    ['Cinémathèque française', 'cinematheque-francaise'],
    ['  --Universität Paderborn--  ', 'universitaet-paderborn'],
    ['AVefi Testinstitution', 'avefi-testinstitution']
  ])('„%s“ → %s', (name, erwartet) => {
    expect(kurzname(name)).toBe(erwartet)
  })

  it('faellt bei Namen ohne Buchstaben und Ziffern auf „institution“ zurueck', () => {
    expect(kurzname('&&&')).toBe('institution')
  })

  it('kuerzt lange Namen ohne Bindestrich am Ende', () => {
    const k = kurzname(`${'a'.repeat(79)} ${'b'.repeat(20)}`)
    expect(k.length).toBeLessThanOrEqual(80)
    expect(k.endsWith('-')).toBe(false)
  })

  it('bleibt beim bisherigen Kurznamen der Testinstitution', () => {
    // Der Seed hat ihn vor dem 04.11.2026 mit der alten Regel erzeugt; ohne
    // Umlaute muss die neue Regel dasselbe liefern, sonst legte er ein zweites an.
    const alt = 'AVefi Testinstitution'.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    expect(kurzname('AVefi Testinstitution')).toBe(alt)
  })
})

describe('pruefeName', () => {
  it('zieht Leerraum zusammen', () => {
    expect(pruefeName('  Filmmuseum   Düsseldorf ')).toBe('Filmmuseum Düsseldorf')
  })

  it.each([[''], ['   '], [undefined], [42]])('lehnt %j als fehlenden Namen ab', (wert) => {
    expect(() => pruefeName(wert)).toThrow(InstitutionFehler)
    try { pruefeName(wert) } catch (e) { expect((e as InstitutionFehler).code).toBe('institution_name_missing') }
  })

  it('lehnt zu lange Namen ab', () => {
    try {
      pruefeName('x'.repeat(MAX_NAME_LAENGE + 1))
      throw new Error('nicht abgelehnt')
    } catch (e) {
      expect((e as InstitutionFehler).code).toBe('institution_name_long')
      expect((e as InstitutionFehler).status).toBe(400)
    }
  })
})

describe('Meldungen', () => {
  it('hat fuer jeden Fehlercode einen Text in beiden Sprachen', () => {
    const quelle = lies('server/lib/institutionen.ts') + lies('server/api/institutions/_lib.ts')
    const codes = new Set([...quelle.matchAll(/'(institution_[a-z_]+)'/g)].map((t) => t[1]!))
    expect(codes.size).toBeGreaterThanOrEqual(5)
    for (const sprache of ['de', 'en']) {
      const texte = JSON.parse(lies(`i18n/locales/${sprache}/admin.json`)) as { admin: { error: Record<string, string> } }
      for (const code of codes) expect(texte.admin.error[code], `${sprache}: admin.error.${code}`).toBeTruthy()
    }
  })
})

describe('Seed', () => {
  it('benennt eine bestehende Institution nicht mehr um', () => {
    const seed = lies('server/db/seed.ts')
    expect(seed).not.toMatch(/DO UPDATE SET name/)
    expect(seed).toContain('institutionAnlegen')
  })
})
