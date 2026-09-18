/*
 * Waechter ueber die Pflichtfelder.
 *
 * PFLICHTFELDER steht als Liste im Code und nicht als Abfrage zur Laufzeit —
 * die Begruendung steht in pflichtfelder.ts. Der Preis dafuer ist, dass die
 * Liste altern kann. Diese Datei ist der Gegenpreis: Sie haelt die Liste gegen
 * das ausgelieferte Schemadokument, in beide Richtungen.
 *
 * Das Dokument ist Teil des Repositoriums (src/public/schema/avefi/), es wird
 * hier deshalb verlangt und nicht uebersprungen. Ein Waechter, der bei
 * fehlender Grundlage still durchlaesst, waechtert nicht.
 */

import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import type { AvefiRecord } from '../../server/lib/mapping/builder.js'
import { createSchemaModel } from '../../server/lib/mapping/schema-model.js'
import { allTargets } from '../../server/lib/mapping/targets.js'
import {
  PFLICHTFELDER, VOM_ERZEUGER_GESETZT, pflichtSchluessel
} from '../../server/lib/mapping/pflichtfelder.js'
import { completenessIssues, coreState } from '../../server/lib/mapping/completeness.js'
import { hasBlocker, hasStartBlocker, staticCheck } from '../../server/lib/mapping/runner.js'
import { emptyMapping } from '../../server/lib/mapping/profile.js'
import { testSchema } from '../mapping/fixtures.js'

const SCHEMA_PATH = 'public/schema/avefi/model.schema.json'
const KLASSEN = ['WorkVariant', 'Manifestation', 'Item'] as const

async function echtesSchema() {
  return createSchemaModel(JSON.parse(await readFile(SCHEMA_PATH, 'utf8')))
}

function werk(felder: Record<string, unknown>): AvefiRecord {
  return { work: felder, manifestations: [], items: [] } as unknown as AvefiRecord
}

const VOLLSTAENDIG = {
  has_primary_title: { has_name: 'Der blaue Engel' },
  type: 'Monographic'
}

describe('Pflichtfelder gegen das ausgelieferte Schema', () => {
  it('kennt jede Pflichtangabe der drei Klassen — geprueft oder begruendet ausgenommen', async () => {
    const schema = await echtesSchema()
    const gedeckt = new Set([
      ...PFLICHTFELDER.map((p) => pflichtSchluessel(p.klasse, p.prop)),
      ...Object.keys(VOM_ERZEUGER_GESETZT)
    ])

    const offen: string[] = []
    for (const klasse of KLASSEN) {
      for (const prop of schema.required(klasse)) {
        const key = pflichtSchluessel(klasse, prop)
        if (!gedeckt.has(key)) offen.push(key)
      }
    }

    // Wer hier landet: Entweder gehoert das Feld nach PFLICHTFELDER, weil der
    // Nutzer es zuordnen muss, oder nach VOM_ERZEUGER_GESETZT samt Grund.
    // Stillschweigend weglassen ist die eine Moeglichkeit, die es nicht gibt.
    expect(offen).toEqual([])
  })

  it('fuehrt kein Feld, das im Schema gar nicht Pflicht ist', async () => {
    const schema = await echtesSchema()
    const pflichtImSchema = new Set(
      KLASSEN.flatMap((k) => schema.required(k).map((prop) => pflichtSchluessel(k, prop)))
    )

    for (const p of PFLICHTFELDER) {
      expect(pflichtImSchema, pflichtSchluessel(p.klasse, p.prop))
        .toContain(pflichtSchluessel(p.klasse, p.prop))
    }
    // Auch die Ausnahmeliste altert. Ein Eintrag fuer ein Feld, das laengst
    // keine Pflicht mehr ist, taeuscht Sorgfalt vor.
    for (const key of Object.keys(VOM_ERZEUGER_GESETZT)) {
      expect(pflichtImSchema, key).toContain(key)
    }
  })

  it('begruendet jede Ausnahme mit einem Satz', () => {
    for (const [key, grund] of Object.entries(VOM_ERZEUGER_GESETZT)) {
      expect(grund.trim().length, key).toBeGreaterThan(20)
    }
  })

  it('laesst sich jedes Pflichtfeld ueber den Zielkatalog belegen', () => {
    for (const p of PFLICHTFELDER) {
      const treffer = allTargets().filter((t) => p.trifftZiel(t))
      // Ein Pflichtfeld ohne Ziel waere eine Beanstandung ohne Ausweg.
      expect(treffer.length, pflichtSchluessel(p.klasse, p.prop)).toBeGreaterThan(0)
    }
  })
})

describe('Der Umbau aendert das heutige Verhalten nicht', () => {
  /*
   * Bis zum 18.09.2026 standen in completenessIssues zwei feste Zeilen. Sie
   * stehen hier noch einmal, damit der Vergleich nicht behauptet wird, sondern
   * gerechnet wird. Wenn PFLICHTFELDER waechst, faellt dieser Test — und das
   * ist dann die Stelle, an der jemand entscheidet, ob der Zuwachs gewollt war.
   */
  function alteRegel(record: AvefiRecord): string[] {
    const w = record.work as Record<string, unknown>
    const titel = w['has_primary_title']
    const hatNamen = typeof titel === 'object' && titel !== null
      && String((titel as Record<string, unknown>)['has_name'] ?? '').trim() !== ''
    const art = w['type']
    const leer = art === null || art === undefined || art === ''
      || (Array.isArray(art) && art.length === 0)
    const out: string[] = []
    if (!hatNamen) out.push('hint.noPrimaryTitle')
    if (leer) out.push('hint.noWorkType')
    return out
  }

  const faelle: Array<[string, AvefiRecord]> = [
    ['alles da', werk({ ...VOLLSTAENDIG })],
    ['ohne Titel', werk({ type: 'Monographic' })],
    ['ohne Werkart', werk({ has_primary_title: { has_name: 'M' } })],
    ['ohne beides', werk({})],
    ['Titel leer', werk({ has_primary_title: { has_name: '  ' }, type: 'Serial' })],
    ['Werkart leere Liste', werk({ has_primary_title: { has_name: 'M' }, type: [] })]
  ]

  for (const [name, record] of faelle) {
    it(`meldet dieselben Pflichtfehler wie zuvor: ${name}`, () => {
      const neu = completenessIssues(record).filter((h) => h.level === 'error').map((h) => h.code)
      expect(neu).toEqual(alteRegel(record))
    })
  }

  it('faerbt die Plakette rot, sobald eine Pflichtangabe fehlt', () => {
    expect(coreState(werk({ has_primary_title: { has_name: 'M' } }))).toBe('danger')
    expect(coreState(werk({ ...VOLLSTAENDIG }))).not.toBe('danger')
  })
})

describe('Pflichtfelder in der Zuordnung', () => {
  function profil(ziele: string[]) {
    const m = emptyMapping(['A', 'B'], '1.2.3')
    m.columns['A'] = { pre: [], targets: ziele.map((z) => ({ target: z, post: [] })) }
    return m
  }

  it('warnt bei einer Zuordnung ohne Werkart — und nennt das Schema als Herkunft', () => {
    const checks = staticCheck(profil(['work.title.primary']), testSchema)
    const hit = checks.find((c) => c.code === 'worktype.nowhere')
    // Warnung und nicht Fehler: builder.ts traegt "Monographic" ein und meldet
    // das je Datensatz. Ein Blocker hier hiesse, zwei Stellen widersprechen zu
    // lassen — hier gesperrt, dort stillschweigend ersetzt.
    expect(hit?.severity).toBe('warning')
    expect(hit?.source).toBe('schema')
    expect(hit?.targetField).toBe('WorkVariant.type')
    expect(hasStartBlocker(checks.filter((c) => c.code === 'worktype.nowhere'))).toBe(false)
  })

  it('beanstandet eine Zuordnung ohne jeden Haupttitel', () => {
    const checks = staticCheck(profil(['work.type']), testSchema)
    expect(checks.find((c) => c.code === 'title.nowhere')?.severity).toBe('error')
    expect(checks.find((c) => c.code === 'worktype.nowhere')).toBeUndefined()
  })

  it('schweigt, wenn beide Pflichtangaben zugeordnet sind', () => {
    const checks = staticCheck(profil(['work.title.primary', 'work.type']), testSchema)
    expect(checks.filter((c) => c.code.endsWith('.nowhere'))).toEqual([])
  })

  it('nimmt den Archivtitel als Haupttitel an', () => {
    // targets.ts gibt work.title.supplied primary: true — das Schema sieht
    // genau diesen Typ fuer den Pflichtplatz vor, wenn ein Film keinen eigenen
    // Titel traegt.
    const checks = staticCheck(profil(['work.title.supplied', 'work.type']), testSchema)
    expect(checks.find((c) => c.code === 'title.nowhere')).toBeUndefined()
  })

  it('warnt nur, wenn der Titel unterhalb des Werks haengt', () => {
    const checks = staticCheck(profil(['manifestation.title.primary', 'work.type']), testSchema)
    expect(checks.find((c) => c.code === 'title.nowhere')).toBeUndefined()
    expect(checks.find((c) => c.code === 'work.no-title')?.severity).toBe('warning')
  })

  it('nimmt einen Festwert als Belegung an', () => {
    const m = profil(['work.title.primary'])
    m.defaults = [{ target: 'work.type', value: 'Monographic' }] as never
    expect(staticCheck(m, testSchema).find((c) => c.code === 'worktype.nowhere')).toBeUndefined()
  })

  it('haelt den Zwischenstand speicherbar und den Lauf auf', () => {
    // Die Unterscheidung vom 10.09.: falsch gegen noch nicht fertig. Wer von
    // oben nach unten zuordnet, hat zwischendurch immer eine Pflichtangabe
    // offen — speichern muss er trotzdem duerfen. Konvertieren nicht: ohne
    // Titel auf irgendeiner Ebene kaeme garantiert ein Datensatz ohne Titel
    // heraus.
    const checks = staticCheck(profil(['work.type']), testSchema)
    expect(hasBlocker(checks)).toBe(false)
    expect(hasStartBlocker(checks)).toBe(true)
  })

  it('haelt den Lauf wegen der Werkart allein nicht auf', () => {
    const checks = staticCheck(profil(['work.title.primary']), testSchema)
    expect(hasBlocker(checks)).toBe(false)
    expect(hasStartBlocker(checks)).toBe(false)
  })
})
