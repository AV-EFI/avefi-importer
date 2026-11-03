/* Die drei Quellen: was sie liefern und in welcher Namensform. */

import { describe, expect, it } from 'vitest'
import { SOURCE_NAME_FORM } from '../../server/lib/authority/types.js'
import { gndCategory, gndSearchUrl, parseGnd, searchGnd } from '../../server/lib/authority/gnd.js'
import {
  parseWikidata, parseWikidataTreffer, searchWikidata, wikidataNichtMenschenUrl, wikidataSearchUrl
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

  // #38 (03.11.2026), Antworten vom selben Tag nachgebildet: Zu "Rainer Werner
  // Fassbinder" fuehrt Wikidata auch einen gleichnamigen Film.
  describe('Personen ohne gleichnamige Nicht-Menschen', () => {
    const suche = wikidataAntwort([
      { id: 'Q44426', label: 'Rainer Werner Fassbinder', description: 'deutscher Filmregisseur' },
      { id: 'Q33561976', label: 'Rainer Werner Fassbinder', description: 'Film von Christian Braad Thomsen (1975)' }
    ])
    const keineMenschen = { query: { search: [{ title: 'Q33561976' }, { title: 'Q125960580' }] } }
    const zweiQuellen = () => stubFetch((url) => (url.includes('list=search') ? keineMenschen : suche))

    it('streicht, was der Suchindex als Nicht-Menschen kennt', async () => {
      const fetchJson = zweiQuellen()
      const treffer = await searchWikidata('Rainer Werner Fassbinder', 'person', fetchJson)
      expect(treffer.map((c) => c.id)).toEqual(['Q44426'])
      expect(fetchJson.calls).toHaveLength(2)
    })

    it('fragt die Nicht-Menschen ab, nicht die Menschen', () => {
      expect(new URL(wikidataNichtMenschenUrl('Rainer Werner Fassbinder')).searchParams.get('srsearch'))
        .toBe('-haswbstatement:P31=Q5 inlabel:"Rainer Werner Fassbinder"')
    })

    it('laesst stehen, was der Suchindex nicht kennt — lieber mehrdeutig als falsch eindeutig', async () => {
      const fetchJson = stubFetch((url) => (url.includes('list=search') ? { query: { search: [] } } : suche))
      expect((await searchWikidata('Rainer Werner Fassbinder', 'person', fetchJson)).map((c) => c.id))
        .toEqual(['Q44426', 'Q33561976'])
    })

    it('behaelt das ungefilterte Ergebnis, wenn der Suchindex ausfaellt', async () => {
      const fetchJson = stubFetch((url) => {
        if (url.includes('list=search')) throw new Error('Wikidata nicht erreichbar')
        return suche
      })
      expect(await searchWikidata('Rainer Werner Fassbinder', 'person', fetchJson)).toHaveLength(2)
    })

    it('filtert nur bei Personen — bei Orten hilft der Filter nicht', async () => {
      const fetchJson = zweiQuellen()
      expect(await searchWikidata('Rainer Werner Fassbinder', 'place', fetchJson)).toHaveLength(2)
      expect(fetchJson.calls).toHaveLength(1)
    })

    it('fragt nicht nach, wenn es nichts zu filtern gibt', async () => {
      const fetchJson = stubFetch((url) => (url.includes('list=search') ? keineMenschen : { search: [] }))
      expect(await searchWikidata('Niemand', 'person', fetchJson)).toEqual([])
      expect(fetchJson.calls).toHaveLength(1)
    })

    it('liest nur gueltige Kennungen aus der Trefferliste', () => {
      expect([...parseWikidataTreffer({ query: { search: [{ title: 'Q1' }, { title: 'Property:P31' }, {}] } })])
        .toEqual(['Q1'])
    })

    it('nimmt Anfuehrungszeichen aus der Anfrage, damit die Suchsyntax heil bleibt', () => {
      expect(new URL(wikidataNichtMenschenUrl('Der "Kaiser" Beckenbauer')).searchParams.get('srsearch'))
        .toBe('-haswbstatement:P31=Q5 inlabel:"Der Kaiser Beckenbauer"')
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
