/* Die drei Quellen: was sie liefern und in welcher Namensform. */

import { describe, expect, it } from 'vitest'
import { SOURCE_NAME_FORM } from '../../server/lib/authority/types.js'
import { gndCategory, gndSearchUrl, parseGnd, searchGnd } from '../../server/lib/authority/gnd.js'
import {
  keinMensch, parseWikidata, parseWikidataArten, searchWikidata, wikidataArtUrl, wikidataSearchUrl
} from '../../server/lib/authority/wikidata.js'
import { parseViaf, searchViaf, viafSearchUrl } from '../../server/lib/authority/viaf.js'
import { gndAntwort, stubFetch, viafAntwort, wikidataAntwort } from './fixtures.js'

describe('Namensform je Quelle ist festgehalten', () => {
  it('GND und VIAF gemischt, Wikidata natuerlich', () => {
    expect(SOURCE_NAME_FORM.gnd).toBe('mixed')
    expect(SOURCE_NAME_FORM.viaf).toBe('mixed')
    expect(SOURCE_NAME_FORM.wikidata).toBe('natural')
  })
})

describe('GND (lobid)', () => {
  it('liefert Personen invertiert — der Grund fuer den Abgleich beider Formen', async () => {
    const fetchJson = stubFetch({
      'lobid.org': gndAntwort([{ id: '118614355', name: 'Sielmann, Heinz', beruf: 'Tierfilmer' }])
    })
    const treffer = await searchGnd('Heinz Sielmann', 'person', fetchJson)
    expect(treffer).toHaveLength(1)
    expect(treffer[0]?.label).toBe('Sielmann, Heinz')
    expect(treffer[0]?.id).toBe('118614355')
    expect(treffer[0]?.resourceType).toBe('GNDResource')
  })

  it('filtert nach Art des Datensatzes ueber Teilstrings in type[]', () => {
    const payload = gndAntwort([
      { id: '1', name: 'Sielmann, Heinz', type: ['DifferentiatedPerson', 'Person', 'AuthorityResource'] },
      { id: '2', name: 'Bundesarchiv', type: ['CorporateBody', 'AuthorityResource'] },
      { id: '3', name: 'Berlin', type: ['TerritorialCorporateBodyOrAdministrativeUnit', 'PlaceOrGeographicName'] }
    ])
    expect(parseGnd(payload, 'person').map((c) => c.id)).toEqual(['1'])
    expect(parseGnd(payload, 'corporate').map((c) => c.id)).toEqual(['2'])
    expect(parseGnd(payload, 'place').map((c) => c.id)).toEqual(['3'])
  })

  it('haelt einen Ort nicht fuer eine Koerperschaft', () => {
    // Die GND fuehrt Staedte und Laender als
    // "TerritorialCorporateBodyOrAdministrativeUnit". Wer nur nach dem
    // Teilstring "CorporateBody" sucht, bekommt Berlin als Koerperschaft.
    expect(gndCategory(['TerritorialCorporateBodyOrAdministrativeUnit'])).toBe('place')
    expect(gndCategory(['CorporateBody', 'AuthorityResource'])).toBe('corporate')
    expect(gndCategory(['DifferentiatedPerson', 'Person'])).toBe('person')
    expect(gndCategory(['SubjectHeadingSensoStricto'])).toBe('subject')
    expect(gndCategory([])).toBe('other')
  })

  it('merkt sich Person oder Koerperschaft, damit die Oberflaeche nicht raten muss', () => {
    const c = parseGnd(gndAntwort([{ id: '2', name: 'Bundesarchiv', type: ['CorporateBody'] }]), 'corporate')
    expect(c[0]?.agentType).toBe('CorporateBody')
  })

  it('uebersteht eine leere oder unerwartete Antwort', () => {
    expect(parseGnd({}, 'person')).toEqual([])
    expect(parseGnd(null, 'person')).toEqual([])
    expect(parseGnd({ member: 'kaputt' }, 'person')).toEqual([])
    expect(parseGnd({ member: [{ preferredName: 'ohne Kennung' }] }, 'person')).toEqual([])
  })

  it('kodiert die Anfrage in der URL', () => {
    expect(gndSearchUrl('Heinz Sielmann')).toContain('q=Heinz%20Sielmann')
  })
})

describe('Wikidata', () => {
  it('liefert die natuerliche Namensform', async () => {
    const fetchJson = stubFetch({
      'wikidata.org': wikidataAntwort([{ id: 'Q57238', label: 'Heinz Sielmann', description: 'deutscher Tierfilmer' }])
    })
    const treffer = await searchWikidata('Heinz Sielmann', 'person', fetchJson)
    expect(treffer[0]?.label).toBe('Heinz Sielmann')
    expect(treffer[0]?.description).toBe('deutscher Tierfilmer')
  })

  it('verwirft alles, was keine gueltige Kennung ist', () => {
    const c = parseWikidata({ search: [{ id: 'kaputt', label: 'x' }, { id: 'Q1', label: 'y' }] }, 'person')
    expect(c.map((x) => x.id)).toEqual(['Q1'])
  })

  it('fragt auf Deutsch an', () => {
    expect(wikidataSearchUrl('Sielmann')).toContain('language=de')
  })

  /** Antwort von wbgetclaims mit den angegebenen P31-Zielen. */
  const arten = (...ids: string[]) => ({
    claims: {
      P31: ids.map((id) => ({ mainsnak: { snaktype: 'value', datavalue: { value: { 'entity-type': 'item', id } } } }))
    }
  })
  const artAnfrage = (url: string): string | null =>
    url.includes('action=wbgetclaims') ? new URL(url).searchParams.get('entity') : null

  // #38: Antworten nachgebildet. Zu "Rainer Werner Fassbinder" fuehrt Wikidata
  // auch einen gleichnamigen Film (03.11.), zu "Gorch Fock" eine
  // Begriffsklaerungsseite, die der fruehere Index-Filter uebersah (10.11.).
  describe('Personen ohne gleichnamige Nicht-Menschen', () => {
    const fassbinder = wikidataAntwort([
      { id: 'Q44426', label: 'Rainer Werner Fassbinder', description: 'deutscher Filmregisseur' },
      { id: 'Q33561976', label: 'Rainer Werner Fassbinder', description: 'Film von Christian Braad Thomsen (1975)' },
      { id: 'Q125960580', label: 'Rainer Werner Fassbinder Foundation' }
    ])
    const artVon: Record<string, string[]> = {
      Q44426: ['Q5'], Q33561976: ['Q11424'], Q69087: ['Q5'], Q298350: ['Q22808320'],
      Q777321: ['Q2389789'], Q15812590: ['Q1428357']
    }
    const dienst = (suche: unknown) => stubFetch((url) => {
      const id = artAnfrage(url)
      return id === null ? suche : arten(...(artVon[id] ?? []))
    })

    it('streicht gleichnamige Eintraege, die sicher keine Menschen sind', async () => {
      const fetchJson = dienst(fassbinder)
      const treffer = await searchWikidata('Rainer Werner Fassbinder', 'person', fetchJson)
      expect(treffer.map((c) => c.id)).toEqual(['Q44426', 'Q125960580'])
    })

    it('fragt nur die exakt passenden Kandidaten, nicht die uebrigen', async () => {
      const fetchJson = dienst(fassbinder)
      await searchWikidata('Rainer Werner Fassbinder', 'person', fetchJson)
      expect(fetchJson.calls.map(artAnfrage).filter((x) => x !== null)).toEqual(['Q44426', 'Q33561976'])
    })

    it('streicht die Begriffsklaerungsseite zu Gorch Fock, gleich wie viele Namensvettern es gibt', async () => {
      // Der fruehere Filter holte hoechstens 50 von 107 Index-Treffern und
      // verpasste Q298350. Hier wird jeder exakte Kandidat selbst gefragt.
      const gorch = wikidataAntwort([
        { id: 'Q69087', label: 'Gorch Fock', description: 'niederdeutscher Dichter und Erzähler' },
        { id: 'Q777321', label: 'Gorch Fock', description: 'Segelschulschiff der deutschen Marine' },
        { id: 'Q557286', label: 'Gorch Fock I' },
        { id: 'Q15812590', label: 'Gorch Fock', description: 'Vorpostenboot von 1917' },
        { id: 'Q298350', label: 'Gorch Fock', description: 'Wikimedia-Begriffsklärungsseite' }
      ])
      const treffer = await searchWikidata('Gorch Fock', 'person', dienst(gorch))
      expect(treffer.map((c) => c.id)).toEqual(['Q69087', 'Q557286'])
    })

    it('laesst Kandidaten ohne Artangabe stehen — lieber mehrdeutig als falsch eindeutig', async () => {
      const fetchJson = stubFetch((url) => (artAnfrage(url) !== null ? { claims: {} } : fassbinder))
      expect((await searchWikidata('Rainer Werner Fassbinder', 'person', fetchJson)).map((c) => c.id))
        .toEqual(['Q44426', 'Q33561976', 'Q125960580'])
    })

    it('scheitert, wenn eine Nachfrage scheitert — damit nichts Ungefiltertes gespeichert wird', async () => {
      const fetchJson = stubFetch((url) => {
        if (artAnfrage(url) !== null) throw new Error('Wikidata nicht erreichbar')
        return fassbinder
      })
      await expect(searchWikidata('Rainer Werner Fassbinder', 'person', fetchJson)).rejects.toThrow('nicht erreichbar')
    })

    it('fragt nicht nach, wenn nur ein Kandidat exakt passt', async () => {
      const fetchJson = dienst(wikidataAntwort([
        { id: 'Q55411', label: 'Wim Wenders' }, { id: 'Q97291198', label: 'Wim Wenders – Desperado' }
      ]))
      expect((await searchWikidata('Wim Wenders', 'person', fetchJson)).map((c) => c.id)).toEqual(['Q55411', 'Q97291198'])
      expect(fetchJson.calls).toHaveLength(1)
    })

    it('filtert nur bei Personen — bei Orten hilft der Filter nicht', async () => {
      const fetchJson = dienst(fassbinder)
      expect(await searchWikidata('Rainer Werner Fassbinder', 'place', fetchJson)).toHaveLength(3)
      expect(fetchJson.calls).toHaveLength(1)
    })

    it('fragt nicht nach, wenn es nichts zu filtern gibt', async () => {
      const fetchJson = dienst({ search: [] })
      expect(await searchWikidata('Niemand', 'person', fetchJson)).toEqual([])
      expect(fetchJson.calls).toHaveLength(1)
    })

    it('fragt nur die Aussage P31 ab, nicht den ganzen Eintrag', () => {
      const p = new URL(wikidataArtUrl('Q298350')).searchParams
      expect([p.get('action'), p.get('entity'), p.get('property')]).toEqual(['wbgetclaims', 'Q298350', 'P31'])
    })

    it('liest nur gueltige Kennungen aus den Aussagen', () => {
      expect(parseWikidataArten(arten('Q5', 'kaputt', 'Q215627'))).toEqual(['Q5', 'Q215627'])
      expect(parseWikidataArten({})).toEqual([])
      expect(parseWikidataArten({ claims: { P31: [{ mainsnak: { snaktype: 'novalue' } }] } })).toEqual([])
    })

    it('haelt nur fuer sicher, was Arten hat und keine davon Mensch ist', () => {
      expect(keinMensch(['Q22808320'])).toBe(true)
      expect(keinMensch(['Q5', 'Q22808320'])).toBe(false)
      expect(keinMensch([])).toBe(false)
    })
  })
})

describe('VIAF', () => {
  it('filtert nach nametype', () => {
    const payload = viafAntwort([
      { id: '1', term: 'Sielmann, Heinz', nametype: 'personal' },
      { id: '2', term: 'Bundesarchiv', nametype: 'corporate' }
    ])
    expect(parseViaf(payload, 'person').map((c) => c.id)).toEqual(['1'])
    expect(parseViaf(payload, 'corporate').map((c) => c.id)).toEqual(['2'])
  })

  it('fragt bei Personen zusaetzlich mit umgedrehtem Namen — AutoSuggest vergleicht am Zeilenanfang', async () => {
    const fetchJson = stubFetch((url) => {
      if (url.includes('Sielmann%2C%20Heinz')) {
        return viafAntwort([{ id: '77107638', term: 'Sielmann, Heinz, 1917-2006' }])
      }
      return { result: [] }
    })
    const treffer = await searchViaf('Heinz Sielmann', 'person', fetchJson)
    expect(fetchJson.calls).toHaveLength(2)
    expect(treffer.map((c) => c.id)).toEqual(['77107638'])
  })

  it('doppelt gefundene Datensaetze zaehlen einmal', async () => {
    const fetchJson = stubFetch(() => viafAntwort([{ id: '9', term: 'Wolf, Guenther' }]))
    expect(await searchViaf('Guenther Wolf', 'person', fetchJson)).toHaveLength(1)
  })

  it('behaelt das Ergebnis des ersten Versuchs, wenn der zweite ausfaellt', async () => {
    let n = 0
    const fetchJson = stubFetch(() => {
      n++
      if (n === 1) return viafAntwort([{ id: '5', term: 'Heinz Sielmann' }])
      throw new Error('VIAF nicht erreichbar')
    })
    const treffer = await searchViaf('Heinz Sielmann', 'person', fetchJson)
    expect(treffer.map((c) => c.id)).toEqual(['5'])
  })

  it('kodiert die Anfrage in der URL', () => {
    expect(viafSearchUrl('Sielmann, Heinz')).toContain('Sielmann%2C%20Heinz')
  })
})
