/*
 * Jeder Berichtssatz mit {field} hat einen eigenen Satz fuer den ganzen
 * Datensatz.
 *
 * Luca Wollny am 05.11.2026 in AV-EFI/avefi-importer#45: „den Datensatz
 * enthält Angaben …“. Betrifft ein Befund den ganzen Satz, ist `params.field`
 * leer, und bis zum 10.11.2026 setzte die Oberflaeche dann ueberall „den
 * Datensatz“ ein. Der Akkusativ passt in genau eine Vorlage („Das AVefi-Schema
 * beanstandet {field}“), in „{field} enthält …“ oder „An {field} fehlt …“ nicht;
 * im Englischen stand „the record contains …“ klein am Satzanfang.
 *
 * Seither sucht useMeldungstext bei leerem Feld zuerst `<schluessel>__record`.
 * Dieser Test sorgt dafuer, dass es den Satz auch gibt — fuer jeden heutigen
 * und jeden kuenftigen Satz mit {field}, in beiden Sprachen.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/** Saetze, in die der Rueckfall grammatisch passt — mit Begruendung. */
const AUSNAHMEN: Readonly<Record<string, string>> = {
  // „Das AVefi-Schema beanstandet den Datensatz.“ / „… objects to the record.“
  schema: 'Akkusativobjekt, der Rueckfall passt.'
}

function issueText(sprache: string): Record<string, string> {
  const doc = JSON.parse(readFileSync(`i18n/locales/${sprache}/imports.json`, 'utf8')) as {
    imports: { issueText: Record<string, string> }
  }
  return doc.imports.issueText
}

describe('Saetze fuer den ganzen Datensatz', () => {
  for (const sprache of ['de', 'en']) {
    const texte = issueText(sprache)

    it(`findet ueberhaupt Saetze mit {field} (${sprache}) — sonst prueft dieser Test nichts`, () => {
      expect(Object.keys(texte).filter((k) => texte[k]!.includes('{field}')).length).toBeGreaterThan(15)
    })

    it(`hat zu jedem Satz mit {field} eine Variante __record (${sprache})`, () => {
      const fehlend = Object.keys(texte)
        .filter((k) => !k.endsWith('__record') && texte[k]!.includes('{field}'))
        .filter((k) => AUSNAHMEN[k] === undefined && texte[`${k}__record`] === undefined)
      expect(fehlend, `ohne __record in ${sprache}/imports.json › issueText`).toEqual([])
    })

    it(`nennt in keiner Variante __record ein Feld (${sprache})`, () => {
      // Die Variante gibt es gerade, weil das Feld leer ist.
      const mitFeld = Object.keys(texte).filter((k) => k.endsWith('__record') && texte[k]!.includes('{field}'))
      expect(mitFeld).toEqual([])
    })

    it(`hat keine verwaiste Variante __record (${sprache})`, () => {
      const verwaist = Object.keys(texte)
        .filter((k) => k.endsWith('__record'))
        .filter((k) => texte[k.slice(0, -'__record'.length)] === undefined)
      expect(verwaist).toEqual([])
    })
  }

  it('fuehrt nur Ausnahmen, die es gibt und die {field} enthalten', () => {
    const de = issueText('de')
    expect(Object.keys(AUSNAHMEN).filter((k) => !de[k]?.includes('{field}'))).toEqual([])
  })
})
