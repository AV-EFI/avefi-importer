/*
 * Jede Uebersetzung laesst sich so uebersetzen, wie der Bau es tut.
 *
 * Die Unit-Tests lesen die Sprachdateien als JSON. Der Bau reicht sie durch
 * unplugin-vue-i18n und den Message-Compiler, und der lehnt manches ab, was als
 * JSON gueltig ist: spitze Klammern (vermeintliches HTML), `@` ohne gueltigen
 * Verweis, offene geschweifte Klammern. Am 30.09.2026 stand „& < >" in einem
 * Hinweis, und die Demo zeigte nur noch die Fehlerseite von Vite. Hier wird
 * jede Nachricht so uebersetzt wie im Bau.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { baseCompile } from '@intlify/message-compiler'

const LOCALES = 'i18n/locales'

function nachrichten(): Array<[string, string]> {
  const out: Array<[string, string]> = []
  const gehe = (knoten: unknown, pfad: string): void => {
    if (typeof knoten === 'string') out.push([pfad, knoten])
    else if (knoten !== null && typeof knoten === 'object') {
      for (const [k, v] of Object.entries(knoten)) gehe(v, pfad === '' ? k : `${pfad}.${k}`)
    }
  }
  for (const sprache of readdirSync(LOCALES)) {
    for (const datei of readdirSync(`${LOCALES}/${sprache}`)) {
      gehe(JSON.parse(readFileSync(`${LOCALES}/${sprache}/${datei}`, 'utf8')), `${sprache}/${datei}:`)
    }
  }
  return out
}

describe('Uebersetzungen', () => {
  it('findet ueberhaupt Nachrichten', () => {
    expect(nachrichten().length).toBeGreaterThan(1000)
  })

  it('jede Nachricht uebersetzt sich ohne Fehler, und keine enthaelt HTML', () => {
    const fehler: string[] = []
    for (const [pfad, text] of nachrichten()) {
      baseCompile(text, { onError: (e) => fehler.push(`${pfad} ${e.message}`) })
      if (/[<>]/.test(text)) fehler.push(`${pfad} enthaelt spitze Klammern`)
    }
    expect(fehler).toEqual([])
  })
})
