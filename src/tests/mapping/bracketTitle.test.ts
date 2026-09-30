/*
 * Der Vorschlag fuer eingeklammerte Titel.
 *
 * Anlass ist Jasper Stratils Test vom 07.09.2026 mit UPB_Test_Archivtitel.csv:
 * Im LIDO-Weg wertet der Konverter eckige Klammern als Archivtitel aus, im
 * CSV-Weg greift das nicht. Eine feste Regel waere hier falsch — der CSV-Weg
 * kennt das liefernde Haus nicht. Ein Vorschlag, den ein Mensch annimmt und
 * der danach im Profil steht, ist die Antwort.
 */

import { describe, expect, it } from 'vitest'
import {
  bracketTitleChecks, KLAMMERN_ABSCHNEIDEN, klammerVorschlaege, pickExamples
} from '../../server/lib/mapping/preview.js'
import { runChain } from '../../server/lib/mapping/transform.js'
import { emptyMapping } from '../../server/lib/mapping/profile.js'
import { runRow } from '../../server/lib/mapping/runner.js'
import { testSchema } from './fixtures.js'
import type { DismissedHint } from '#shared/types/domain'

function profil(ziel = 'work.title.primary', dismissed?: DismissedHint[], post: unknown[] = []) {
  const m = emptyMapping(['Titel'])
  m.columns['Titel'] = {
    pre: [],
    targets: [{ target: ziel, post: post as never }],
    ...(dismissed ? { dismissed } : {})
  }
  return m
}

function pruefe(werte: string[], ...args: Parameters<typeof profil>) {
  const spalten = pickExamples(['Titel'], werte.map((Titel) => ({ Titel })))
  return bracketTitleChecks(profil(...args), spalten)
}

const GEMISCHT = ['Der blaue Engel', '[Betriebsausflug 1962]', 'M', '[ohne Titel]']
const ALLE = ['[Betriebsausflug 1962]', '[ohne Titel]', '[Aufnahmen Hafen]']
const KEINE = ['Der blaue Engel', 'M', 'Metropolis']

describe('Wann der Vorschlag erscheint', () => {
  it('bei gemischter Spalte: aufteilen', () => {
    const c = pruefe(GEMISCHT)
    expect(c.map((x) => x.code)).toEqual(['data.bracketTitle'])
    expect(c[0]?.fixPlan?.length).toBe(2)
  })

  it('bei durchgehend eingeklammerter Spalte: umhaengen statt aufteilen', () => {
    const c = pruefe(ALLE)
    expect(c.map((x) => x.code)).toEqual(['data.bracketTitleAll'])
    expect(c[0]?.fixPlan?.length).toBe(1)
    expect(c[0]?.fixPlan?.[0]?.replaces).toBe('work.title.primary')
    expect(c[0]?.fixPlan?.[0]?.target).toBe('work.title.supplied')
  })

  it('gar nicht, wenn keine Klammern vorkommen', () => {
    expect(pruefe(KEINE)).toEqual([])
  })

  it('gar nicht bei zu wenigen Werten', () => {
    // Ein einziger eingeklammerter Wert ist kein Muster, sondern ein Wert.
    expect(pruefe(['[Betriebsausflug]'])).toEqual([])
  })
})

describe('Wo der Vorschlag nicht hingehoert', () => {
  it('nicht an einem mehrwertigen Ziel', () => {
    // Dort draengen sich zwei Titel nicht gegenseitig weg, also gibt es nichts
    // zu entscheiden.
    expect(pruefe(GEMISCHT, 'work.title.alternative')).toEqual([])
  })

  it('am Archivtitel nicht die Umwidmung, sondern nur das Abschneiden', () => {
    // Bis zum 30.09.2026 schwieg der Editor am Archivtitel ganz (#5, Jasper am
    // 24.09.: von Hand gewaehlt, Klammern blieben stehen).
    const codes = pruefe(GEMISCHT, 'work.title.supplied').map((c) => c.code)
    expect(codes).toEqual(['data.bracketTitleStrip'])
  })

  it('nicht an einem Ziel ausserhalb der Titel', () => {
    expect(pruefe(GEMISCHT, 'item.note')).toEqual([])
  })

  it('nicht, wenn die Kette schon einen Waechter hat', () => {
    const post = [{ op: 'only', pattern: '^\\[.*\\]$', negate: true }]
    expect(pruefe(GEMISCHT, 'work.title.primary', undefined, post)).toEqual([])
  })

  it('nicht, wenn die Kette die Klammern schon behandelt', () => {
    const post = [{ op: 'regex', pattern: '^\\[(.*)\\]$', capture: 1 }]
    expect(pruefe(GEMISCHT, 'work.title.primary', undefined, post)).toEqual([])
  })
})

describe('Ablehnen', () => {
  it('haelt den Vorschlag fern', () => {
    const weg: DismissedHint[] = [{ code: 'data.bracketTitle', target: 'work.title.primary' }]
    expect(pruefe(GEMISCHT, 'work.title.primary', weg)).toEqual([])
  })

  it('gilt je Code: wer das Aufteilen ablehnt, hat zum Umhaengen nichts gesagt', () => {
    const weg: DismissedHint[] = [{ code: 'data.bracketTitle', target: 'work.title.primary' }]
    expect(pruefe(ALLE, 'work.title.primary', weg).map((x) => x.code)).toEqual(['data.bracketTitleAll'])
  })
})

describe('Der Plan selbst', () => {
  it('teilt so auf, dass je Zeile genau ein Zweig etwas bekommt', () => {
    const plan = pruefe(GEMISCHT)[0]?.fixPlan ?? []
    const haupt = plan.find((p) => p.target === 'work.title.primary')
    const archiv = plan.find((p) => p.target === 'work.title.supplied')
    expect(haupt?.post?.[0]).toMatchObject({ op: 'only', negate: true })
    expect(archiv?.post?.[0]).toMatchObject({ op: 'only', capture: 1 })
  })

  it('verwendet in beiden Zweigen dasselbe Muster, damit sie komplementaer sind', () => {
    const plan = pruefe(GEMISCHT)[0]?.fixPlan ?? []
    const ohneGruppe = (m: string) => m.replace('(', '').replace(')', '')
    const muster = plan.map((t) => ohneGruppe(String(t.post?.[0]?.pattern ?? '')))
    expect(new Set(muster).size).toBe(1)
  })

  it('laesst innen keine weiteren Klammern zu', () => {
    // Sonst zerlegte das gierige .* einen Wert wie "[a] und [b]" beim
    // Abschneiden zu "a] und [b".
    for (const teil of pruefe(GEMISCHT)[0]?.fixPlan ?? []) {
      expect(String(teil.post?.[0]?.pattern ?? '')).toContain('[^\\[\\]]')
    }
  })

  it('verankert beide Muster auf den ganzen Wert', () => {
    for (const teil of pruefe(GEMISCHT)[0]?.fixPlan ?? []) {
      const muster = String(teil.post?.[0]?.pattern ?? '')
      expect(muster.startsWith('^')).toBe(true)
      expect(muster.endsWith('$')).toBe(true)
    }
  })

  it('nennt die Ebene des betroffenen Ziels, nicht immer das Werk', () => {
    const c = pruefe(ALLE, 'item.title.primary')
    expect(c[0]?.fixPlan?.[0]?.target).toBe('item.title.supplied')
  })
})

describe('Der angenommene Vorschlag im fertigen Datensatz', () => {
  /*
   * Der eigentliche Nachweis: Nicht dass ein Plan entsteht, sondern dass das
   * JSON hinterher stimmt. Der Plan wird hier so angewandt, wie der Editor ihn
   * anwendet — Ziel plus Nachkette —, und dann laeuft eine Zeile durch.
   */
  const services = { schema: testSchema }

  function mitPlan() {
    const m = emptyMapping(['Titel'], '1.2.3')
    const plan = pruefe(GEMISCHT)[0]?.fixPlan ?? []
    m.columns['Titel'] = {
      pre: [],
      targets: plan.map((t) => ({ target: t.target, post: (t.post ?? []) as never }))
    }
    return m
  }

  it('macht aus einem eingeklammerten Titel einen Archivtitel ohne Klammern', () => {
    const r = runRow(mitPlan(), { Titel: '[Betriebsausflug 1962]' }, 'z1', services)
    expect(r.canonical.work['has_primary_title'])
      .toEqual({ has_name: 'Betriebsausflug 1962', type: 'SuppliedDevisedTitle' })
  })

  it('laesst einen gewoehnlichen Titel Haupttitel bleiben', () => {
    const r = runRow(mitPlan(), { Titel: 'Der blaue Engel' }, 'z2', services)
    expect(r.canonical.work['has_primary_title'])
      .toEqual({ has_name: 'Der blaue Engel', type: 'PreferredTitle' })
  })

  it('deutet einen Zusatz in Klammern nicht um', () => {
    const r = runRow(mitPlan(), { Titel: 'Der blaue Engel [Fragment]' }, 'z3', services)
    expect(r.canonical.work['has_primary_title'])
      .toEqual({ has_name: 'Der blaue Engel [Fragment]', type: 'PreferredTitle' })
  })

  it('erzeugt nie zwei Primaertitel und beanstandet nichts', () => {
    for (const wert of GEMISCHT) {
      const r = runRow(mitPlan(), { Titel: wert }, 'z', services)
      expect(r.canonical.work['has_primary_title']).toBeDefined()
      expect(r.canonical.work['has_alternative_title']).toBeUndefined()
      expect(r.errors ?? []).toEqual([])
    }
  })
})

describe('Klammern: was das Profil entscheidet', () => {
  /*
   * Elias Oltmanns in #5: Wird der Vorschlag angenommen, sind die Klammern
   * Kennzeichnung und gehoeren weg. Wird er abgelehnt und der Wert bleibt ein
   * PreferredTitle, sind sie Bestandteil des Titels und bleiben stehen.
   *
   * Deshalb steht das Abschneiden im Profil und nicht im Builder. Im Zweigpaar
   * stellt sich die Frage ohnehin nicht: Der Haupttitel-Zweig bekommt nur die
   * nicht eingeklammerten Werte.
   */
  const services = { schema: testSchema }

  function mitPlan(werte: string[] = GEMISCHT) {
    const m = emptyMapping(['Titel'], '1.2.3')
    const plan = pruefe(werte)[0]?.fixPlan ?? []
    m.columns['Titel'] = {
      pre: [],
      targets: plan.map((t) => ({
        ...(t.replaces !== undefined ? {} : {}),
        target: t.target,
        post: (t.post ?? []) as never
      }))
    }
    return m
  }

  function ohnePlan() {
    const m = emptyMapping(['Titel'], '1.2.3')
    m.columns['Titel'] = { pre: [], targets: [{ target: 'work.title.primary', post: [] }] }
    return m
  }

  it('angenommen: Archivtitel ohne Klammern', () => {
    const r = runRow(mitPlan(), { Titel: '[Betriebsausflug 1962]' }, 'z', services)
    expect(r.canonical.work['has_primary_title'])
      .toEqual({ has_name: 'Betriebsausflug 1962', type: 'SuppliedDevisedTitle' })
  })

  it('abgelehnt: Haupttitel behaelt seine Klammern', () => {
    const r = runRow(ohnePlan(), { Titel: '[Betriebsausflug 1962]' }, 'z', services)
    expect(r.canonical.work['has_primary_title'])
      .toEqual({ has_name: '[Betriebsausflug 1962]', type: 'PreferredTitle' })
  })

  it('durchgehend eingeklammerte Spalte wird umgehaengt und abgeschnitten', () => {
    const r = runRow(mitPlan(ALLE), { Titel: '[ohne Titel]' }, 'z', services)
    expect(r.canonical.work['has_primary_title'])
      .toEqual({ has_name: 'ohne Titel', type: 'SuppliedDevisedTitle' })
  })

  it('zerlegt keinen Wert aus mehreren geklammerten Teilen', () => {
    // "[a] und [b]" ist nicht als Ganzes geklammert. Er faellt nicht in den
    // Archivzweig, sondern bleibt Haupttitel — mit seinen Klammern.
    const r = runRow(mitPlan(), { Titel: '[a] und [b]' }, 'z', services)
    expect(r.canonical.work['has_primary_title'])
      .toEqual({ has_name: '[a] und [b]', type: 'PreferredTitle' })
  })

  it('deutet einen Zusatz in Klammern nicht um', () => {
    const r = runRow(mitPlan(), { Titel: 'Der blaue Engel [Fragment]' }, 'z', services)
    expect(r.canonical.work['has_primary_title'])
      .toEqual({ has_name: 'Der blaue Engel [Fragment]', type: 'PreferredTitle' })
  })

  it('erzeugt in keinem Fall zwei Primaertitel oder eine Beanstandung', () => {
    for (const wert of [...GEMISCHT, '[a] und [b]', 'Der blaue Engel [Fragment]']) {
      const r = runRow(mitPlan(), { Titel: wert }, 'z', services)
      expect(r.canonical.work['has_primary_title']).toBeDefined()
      expect(r.canonical.work['has_alternative_title']).toBeUndefined()
      expect(r.errors ?? []).toEqual([])
    }
  })
})

describe('Archivtitel von Hand gewaehlt (#5, Nachtest vom 24.09.)', () => {
  it('bietet an, die Klammern abzuschneiden', () => {
    const [c] = pruefe(ALLE, 'work.title.supplied')
    expect(c?.code).toBe('data.bracketTitleStrip')
    expect(c?.fix).toEqual(KLAMMERN_ABSCHNEIDEN)
    expect(c?.severity).toBe('warning')
  })

  it('schneidet nicht von selbst ab — das Profil bleibt, wie es ist', () => {
    const m = profil('work.title.supplied')
    const r = runRow(m, { Titel: '[Betriebsausflug 1962]' }, 'r1', { schema: testSchema })
    expect(JSON.stringify(r.canonical.work)).toContain('[Betriebsausflug 1962]')
  })

  it('schweigt, wenn die Kette die Klammern schon behandelt', () => {
    expect(pruefe(ALLE, 'work.title.supplied', undefined, [{ ...KLAMMERN_ABSCHNEIDEN }])).toEqual([])
  })

  it('schweigt, wenn der Vorschlag abgelehnt wurde', () => {
    const dismissed = [{ code: 'data.bracketTitleStrip', target: 'work.title.supplied' }]
    expect(pruefe(ALLE, 'work.title.supplied', dismissed)).toEqual([])
  })

  it('schweigt ohne eingeklammerte Werte', () => {
    expect(pruefe(KEINE, 'work.title.supplied')).toEqual([])
  })

  it('der Schritt laesst Werte ohne Klammern unveraendert und meldet nichts', () => {
    for (const [ein, aus] of [['[ohne Titel]', 'ohne Titel'], ['Metropolis', 'Metropolis'],
      ['Der blaue Engel [Fragment]', 'Der blaue Engel [Fragment]'], ['[a] und [b]', '[a] und [b]']]) {
      const r = runChain([{ ...KLAMMERN_ABSCHNEIDEN }], ein!, {})
      expect(r.value).toBe(aus)
      expect(r.errors).toEqual([])
    }
  })
})

describe('Erstvorschlag bei eingeklammerten Titeln (#5)', () => {
  const vorschlag = { Titel: [{ target: 'work.title.primary', score: 90 }, { target: 'work.note', score: 20 }] }
  const verteilt = (werte: string[]) => ({ Titel: werte.map((value) => ({ value, count: 1 })) })

  it('nennt den Archivtitel samt Abschneiden, wenn alle Werte eingeklammert sind', () => {
    const [erst, zweit] = klammerVorschlaege(vorschlag, verteilt(ALLE))['Titel']!
    expect(erst).toEqual({ target: 'work.title.supplied', score: 90, post: [KLAMMERN_ABSCHNEIDEN], reason: 'bracketTitle' })
    expect(zweit).toEqual({ target: 'work.note', score: 20 })
  })

  it('bleibt beim Haupttitel, wenn die Spalte gemischt ist', () => {
    expect(klammerVorschlaege(vorschlag, verteilt(GEMISCHT))['Titel']![0]?.target).toBe('work.title.primary')
  })

  it('bleibt beim Haupttitel bei einem einzigen Wert', () => {
    expect(klammerVorschlaege(vorschlag, verteilt(['[x]']))['Titel']![0]?.target).toBe('work.title.primary')
  })
})
