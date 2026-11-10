/*
 * Die Satzbildung aus Code und Bausteinen, gegen die echten Uebersetzungen.
 *
 * #10: Der Pruefbericht zeigte bis zum 30.09.2026 `issue.message`, den
 * deutschen Serversatz — auch in der englischen Oberflaeche. Hier wird
 * nachgewiesen, dass derselbe Befund englisch englisch und deutsch deutsch
 * erscheint, dass Einzahl und Mehrzahl stimmen, und dass ein Bericht aus der
 * Zeit vor den Bausteinen beim deutschen Satz bleibt statt Luecken zu zeigen.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { createI18n } from 'vue-i18n'
import type { ValidationIssue } from '#shared/types/domain'
import { meldungstexte } from '../../app/composables/useMeldungstext'

function texte(sprache: string): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const datei of ['imports', 'mapping', 'records']) {
    Object.assign(out, JSON.parse(readFileSync(`i18n/locales/${sprache}/${datei}.json`, 'utf8')))
  }
  return out
}

function fuer(sprache: 'de' | 'en') {
  const i18n = createI18n({ legacy: false, locale: sprache, messages: { de: texte('de'), en: texte('en') } })
  const g = i18n.global
  return meldungstexte((k, n, p) => (p === undefined ? g.t(k, n ?? {}) : g.t(k, n ?? {}, p)), (k) => g.te(k))
}

const doppelt = (n: number, stellen: string): ValidationIssue => ({
  severity: 'error', code: 'identifier_not_unique', message: 'Kennung x ist nicht eindeutig …',
  params: { kind: 'rows', n, stellen, key: 'avefi:LocalResource.A1' }
})

describe('befund', () => {
  it('spricht die Sprache der Oberflaeche', () => {
    expect(fuer('en').befund(doppelt(1, '5'))).toBe(
      'The identifier avefi:LocalResource.A1 is not unique; it also appears in row 5.')
    expect(fuer('de').befund(doppelt(2, '5, 9'))).toBe(
      'Die Kennung avefi:LocalResource.A1 ist nicht eindeutig, sie kommt auch in den Zeilen 5, 9 vor.')
  })

  it('waehlt die Variante nach der Art der Verletzung', () => {
    const issue: ValidationIssue = {
      severity: 'error', code: 'model_invalid', message: 'efi-conv kann …',
      params: { kind: 'missing', field: 'type', value: '', expected: '' }
    }
    expect(fuer('en').befund(issue)).toBe('efi-conv cannot load the record: the required property type is missing.')
  })

  it('nimmt fuer eine unbekannte Art den allgemeinen Satz', () => {
    const issue: ValidationIssue = {
      severity: 'error', code: 'model_invalid', message: 'efi-conv kann …',
      params: { kind: 'bool_parsing', field: 'has_note' }
    }
    expect(fuer('en').befund(issue)).toBe('efi-conv cannot load the record: has_note does not match the AVefi model.')
  })

  it('bleibt bei Berichten ohne Bausteine beim deutschen Satz', () => {
    const alt: ValidationIssue = { severity: 'error', code: 'identifier_not_unique', message: 'Kennung A ist nicht eindeutig.' }
    expect(fuer('en').befund(alt)).toBe('Kennung A ist nicht eindeutig.')
  })

  it('haengt Zahl und Beispiele an gebuendelte Hinweise an', () => {
    const issue: ValidationIssue = {
      severity: 'info', code: 'unmapped_field', message: 'Die Sprachangabe … Betrifft 3 Datensatz/-saetze.',
      params: { kind: 'language', count: 3, beispiele: 'de, fr' }
    }
    expect(fuer('en').befund(issue)).toMatch(/^The language was not taken over: .* Affects 3 records\. Examples: de, fr\.$/)
  })

  it('uebersetzt Codes des Mappingkerns im Bericht, samt Feldname', () => {
    const issue: ValidationIssue = {
      severity: 'warning', code: 'merge.conflict', message: 'Die Zeilen …',
      params: { feld: 'Haupttitel', feldKey: 'has_primary_title', behalten: 'A', verworfen: 'B', zeile: 2, andere: 7 }
    }
    expect(fuer('en').befund(issue)).toContain('“Main title”')
  })

  it('nimmt den Rueckfall, wo es keinen Satz gibt', () => {
    const issue: ValidationIssue = { severity: 'info', code: 'gibt_es_nicht', message: 'alter Satz' }
    expect(fuer('en').befund(issue)).toBe('alter Satz')
  })

  // #45: „den Datensatz enthält Angaben …“ — ein Satz fuer den ganzen Datensatz
  const ganz = (kind: string, extra: Record<string, string> = {}): ValidationIssue => ({
    severity: 'error', code: 'schema', message: 'Das AVefi-Schema beanstandet den Datensatz.',
    params: { kind, field: '', ...extra }
  })

  it('bildet fuer den ganzen Datensatz einen eigenen Satz', () => {
    expect(fuer('de').befund(ganz('additionalProperties', { extra: 'type' }))).toBe(
      'Der Datensatz enthält Angaben, die das Schema nicht vorsieht: type.')
    expect(fuer('de').befund(ganz('required', { missing: 'category' }))).toBe(
      'Dem Datensatz fehlt die Pflichtangabe category.')
    expect(fuer('en').befund(ganz('additionalProperties', { extra: 'type' }))).toBe(
      'The record contains properties the schema does not provide: type.')
  })

  it('behaelt den Akkusativ, wo er passt', () => {
    expect(fuer('de').befund(ganz('unbekannt'))).toBe('Das AVefi-Schema beanstandet den Datensatz.')
  })

  it('nimmt mit Feld weiter den Satz mit Feld', () => {
    expect(fuer('de').befund(ganz('additionalProperties', { field: 'has_event.0', extra: 'x' }))).toBe(
      'has_event.0 enthält Angaben, die das Schema dort nicht vorsieht: x.')
  })

  it('meldet ein unbrauchbares Schema in der Sprache der Oberflaeche', () => {
    const issue: ValidationIssue = {
      severity: 'warning', code: 'schema_unusable', message: 'Das geladene AVefi-Schema …',
      params: { stand: '8c4eef72e6da' }
    }
    expect(fuer('en').befund(issue)).toMatch(/^The loaded AVefi schema already rejects a record known to be valid\./)
  })
})

describe('diagnose', () => {
  it('uebersetzt Satz und Hinweis, das Trennzeichen eingeschlossen', () => {
    const d = fuer('en').diagnose({
      severity: 'warning', code: 'parse_ragged', params: { found: 4, expected: 5, delimiter: '\t' },
      message: 'Zeile hat 4 Felder …', hint: 'Vermutlich …', line: 3, column: null, offset: null, snippet: null
    })
    expect(d.text).toBe('The row has 4 fields; the header row expects 5.')
    expect(d.hint).toContain('tab')
  })

  it('laesst alte Diagnosen ohne Code, wie sie sind', () => {
    const d = fuer('en').diagnose({
      severity: 'error', message: 'Alt', hint: 'Alter Hinweis', line: null, column: null, offset: null, snippet: null
    })
    expect(d).toEqual({ text: 'Alt', hint: 'Alter Hinweis' })
  })
})
