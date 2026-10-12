/*
 * AvefiBuilder — setzt aus einzelnen Zuweisungen (Ziel + Wert) einen kanonischen
 * AVefi-Datensatz zusammen: {work, manifestations[], items[]}.
 *
 * Der Builder kennt die Bauanleitungen aus dem Zielkatalog und legt verschachtelte
 * Knoten (Ereignisse, Taetigkeiten, Sprachen) bei Bedarf an, statt sie doppelt zu
 * erzeugen: Regie und Kamera landen im selben ProductionEvent, zwei Sprachangaben
 * mit gleichem Code in derselben Sprachstruktur.
 *
 * Normdaten kommen als Nebenkanal herein (siehe Transform): Bei benannten
 * Entitaeten — Person, Schlagwort, Ort, Genre — haengen sie als same_as an der
 * Entitaet, der Name bleibt der Wert. Nur bei reinen Kennungs-Zielen ist die
 * gefundene ID der Wert, weil dort nichts anderes drinstehen kann.
 */

import type { EnrichHit } from './transform.js'
import type { SchemaModel } from './schema-model.js'
import type { TargetDefinition, TargetWriter } from './targets.js'
import { getSchemaModel } from './schema-model.js'
import { validateTargetValue, writerAcceptsAuthority } from './targets.js'
import { meldung } from './meldungen.js'
import { klaereFormat } from '#shared/formatklassen'

/*
 * Knoten und Wertobjekte kommen aus shared/types/domain.ts. Bis zum
 * 07.09.2026 stand hier ein eigenes `Record<string, unknown>` — der Verzicht
 * auf Typisierung, weil ein Name zwei Dinge meinte. Jetzt gibt es zwei.
 */
export type { AvefiNode, AvefiRecord, AvefiValue } from '#shared/types/domain'
import type { AvefiNode, AvefiValue, MappingMessage } from '#shared/types/domain'


type Level = 'work' | 'manifestation' | 'item'

/* ---------------------------------------------------------- Kleine Helfer */

function nodeList(node: AvefiValue, key: string): AvefiValue[] {
  const existing = node[key]
  if (Array.isArray(existing)) return existing as AvefiValue[]
  const created: AvefiValue[] = []
  node[key] = created
  return created
}

function stringList(node: AvefiValue, key: string): string[] {
  const existing = node[key]
  if (Array.isArray(existing)) return existing as string[]
  const created: string[] = []
  node[key] = created
  return created
}

function nameOf(entry: AvefiValue): string {
  const v = entry['has_name']
  return typeof v === 'string' ? v : ''
}

function categoryOf(entry: AvefiValue): string {
  const v = entry['category']
  return typeof v === 'string' ? v : ''
}

/* ------------------------------------------------------------- Der Builder */

export class AvefiBuilder {
  private readonly schema: SchemaModel
  private work: AvefiNode = { category: 'avefi:WorkVariant' }
  private manif: AvefiNode = { category: 'avefi:Manifestation' }
  private item: AvefiNode = { category: 'avefi:Item' }
  /** Aus dem Fallback "als Notiz behalten" der Werteliste. */
  private notes: string[] = []
  /**
   * Verdraengte Werte, die auf einem einwertigen Platz nicht mehr Platz
   * fanden. Bis zum 08.09.2026 verschwanden sie kommentarlos.
   */
  private verdraengt: MappingMessage[] = []
  /**
   * Entscheidungen, die erst beim Zusammenbauen fallen, weil das Schema etwas
   * verlangt, was die Quelle nicht liefert. Erst nach build() gefuellt.
   */
  readonly aufbauHinweise: MappingMessage[] = []
  private touchedManif = false
  private touchedItem = false
  private localIds: Record<Level, string | null> = { work: null, manifestation: null, item: null }

  constructor(schema: SchemaModel = getSchemaModel()) {
    this.schema = schema
  }

  /**
   * Schreibt einen Wert an sein Ziel.
   * @param sameAs Normdaten-Treffer zu genau diesem Wert.
   * @returns Beanstandungen; eine leere Liste heisst: geschrieben oder leer.
   */
  write(target: TargetDefinition, value: unknown, sameAs: readonly EnrichHit[] = []): MappingMessage[] {
    const w = target.writer
    let effective = value

    // Kennungs-Ziele: Wurde zu einem Namen eine ID gefunden, ist SIE der Wert.
    if (sameAs.length > 0 && (w.kind === 'sameas' || w.kind === 'identifier')) {
      const hit = sameAs.find((r) => r.resource === w.resource)
      if (hit !== undefined) effective = hit.id
    }

    const errors = validateTargetValue(target, effective, this.schema)
    if (errors.length > 0) return errors

    const v = typeof effective === 'string' || typeof effective === 'number' || typeof effective === 'boolean'
      ? String(effective).trim()
      : ''
    if (v === '') return []

    const level = target.level as Level
    const node = this.node(level)
    if (level === 'manifestation') this.touchedManif = true
    if (level === 'item') this.touchedItem = true

    this.apply(node, level, w, v, sameAs)
    const verdraengt = this.verdraengt
    this.verdraengt = []
    return verdraengt
  }

  private apply(node: AvefiNode, level: Level, w: TargetWriter, v: string, sameAs: readonly EnrichHit[]): void {
    switch (w.kind) {
      case 'title': {
        // Die Klammern schneidet das Profil ab, nicht der Builder. Warum das
        // hier nicht hingehoert, steht in docs/mapping-profile.md unter
        // "Eckige Klammern am Titel": Ob eine Klammer Kennzeichnung oder
        // Titelbestandteil ist, entscheidet sich daran, ob jemand den Wert als
        // Archivtitel liest — und das ist eine Entscheidung, keine Konvention.
        const name = v
        if (w.primary) {
          // Einwertig: der erste Titel gewinnt, spaetere ueberschreiben nicht.
          //
          // Welcher "der erste" ist, haengt an der Reihenfolge der Ziele im
          // Profil — fuer den Bearbeiter also an nichts Erkennbarem. Seit es
          // je Ebene zwei Ziele auf diesen Platz gibt (Haupttitel und
          // Archivtitel), ist der Zusammenstoss nicht mehr theoretisch, und
          // stillschweigend zu entscheiden waere hier das Falsche.
          const vorhanden = node['has_primary_title']
          if (vorhanden === undefined) {
            node['has_primary_title'] = { has_name: name, type: w.titleType }
          } else {
            const alt = typeof vorhanden === 'object' && vorhanden !== null
              ? String((vorhanden as AvefiValue)['has_name'] ?? '')
              : ''
            if (alt !== name) {
              this.verdraengt.push(meldung('target.primaryTitleTaken', { behalten: alt, verworfen: name }))
            }
          }
        } else {
          nodeList(node, 'has_alternative_title').push({ has_name: name, type: w.titleType })
        }
        return
      }

      case 'prop': {
        if (node[w.prop] === undefined) node[w.prop] = v // einwertig: der erste gewinnt
        return
      }

      case 'strlist': {
        const list = stringList(node, w.prop)
        if (!list.includes(v)) list.push(v)
        return
      }

      case 'named': {
        const list = nodeList(node, w.prop)
        // Welche Kennungsarten erlaubt sind, sagt das Schema — nicht eine Liste
        // im Code. Fuer Genre kam dabei frueher fest GND heraus; steht im Schema
        // spaeter mehr, wirkt das hier ohne Codeaenderung.
        const allowed = w.className !== undefined ? this.schema.sameAsTypes(w.className) : ['GNDResource']
        const found = list.find((e) => nameOf(e) === v)
        if (found !== undefined) {
          this.mergeSameAs(found, sameAs, allowed)
          return
        }
        const created: AvefiValue = { has_name: v }
        this.mergeSameAs(created, sameAs, allowed)
        list.push(created)
        return
      }

      case 'subject': {
        const category = `avefi:${w.className}`
        const list = nodeList(node, 'has_subject')
        const allowed = this.schema.sameAsTypes(w.className)
        const found = list.find((e) => nameOf(e) === v && categoryOf(e) === category)
        if (found !== undefined) {
          this.mergeSameAs(found, sameAs, allowed)
          return
        }
        const created: AvefiValue = { category, has_name: v }
        if (w.agentType !== undefined) created['type'] = w.agentType
        this.mergeSameAs(created, sameAs, allowed)
        list.push(created)
        return
      }

      case 'activity': {
        // Alle Mitwirkenden eines Werks teilen sich ein ProductionEvent — Regie und
        // Kamera landen im selben Ereignis, nicht in zweien.
        const event = this.event(node, 'avefi:ProductionEvent', undefined)
        const activity = this.activity(event, w.category, w.type)
        const agents = nodeList(activity, 'has_agent')
        const allowed = this.schema.sameAsTypes('Agent')
        const found = agents.find((a) => nameOf(a) === v)
        if (found !== undefined) {
          this.mergeSameAs(found, sameAs, allowed)
          return
        }
        const agent: AvefiValue = { category: 'avefi:Agent', has_name: v, type: w.agentType }
        this.mergeSameAs(agent, sameAs, allowed)
        agents.push(agent)
        return
      }

      case 'eventdate': {
        const event = this.event(node, w.category, w.type)
        if (event['has_date'] === undefined) event['has_date'] = v
        return
      }

      case 'eventplace': {
        const event = this.event(node, w.category, w.type)
        const places = nodeList(event, 'located_in')
        const allowed = this.schema.sameAsTypes('GeographicName')
        const found = places.find((g) => nameOf(g) === v)
        if (found !== undefined) {
          this.mergeSameAs(found, sameAs, allowed)
          return
        }
        const place: AvefiValue = { category: 'avefi:GeographicName', has_name: v }
        this.mergeSameAs(place, sameAs, allowed)
        places.push(place)
        return
      }

      case 'identifier': {
        const category = this.schema.resourceCategory(w.resource)
        const list = nodeList(node, 'has_identifier')
        if (list.some((e) => e['id'] === v && categoryOf(e) === category)) return
        list.push({ category, id: v })
        if (w.resource === 'LocalResource' && this.localIds[level] === null) {
          this.localIds[level] = v // dient zugleich als Verknuepfungs-ID
        }
        return
      }

      case 'sameas': {
        const category = this.schema.resourceCategory(w.resource)
        const list = nodeList(node, 'same_as')
        if (list.some((e) => e['id'] === v && categoryOf(e) === category)) return
        list.push({ category, id: v })
        return
      }

      case 'duration': {
        if (node['has_duration'] === undefined) node['has_duration'] = { has_value: v }
        return
      }

      case 'extent': {
        const n = Number(v)
        if (node['has_extent'] === undefined && Number.isFinite(n)) {
          node['has_extent'] = { has_value: n, has_unit: w.unit }
        }
        return
      }

      case 'format': {
        // Mehrwertig, aber je Traegerklasse und Wert nur einmal: eine Spalte,
        // die "35mmFilm" in mehreren Zeilen desselben Exemplars nennt, soll
        // nicht mehrere gleiche Eintraege erzeugen.
        // Gemeinsames Ziel (#28): Die Klasse steht im Wert ("Video:VHS") oder
        // ergibt sich eindeutig aus ihm. validateTargetValue hat vorher
        // geprueft; was hier nicht aufgeht, wird nicht geschrieben.
        let klasse = w.className
        let typ = v
        if (klasse === '') {
          const k = klaereFormat(v, (name) => this.schema.enum(name))
          if (!k.ok) return
          klasse = k.klasse
          typ = k.wert
        }
        const list = nodeList(node, 'has_format')
        const already = list.some((f) => f['category'] === `avefi:${klasse}` && f['type'] === typ)
        if (!already) list.push({ category: `avefi:${klasse}`, type: typ })
        return
      }

      case 'language': {
        const list = nodeList(node, 'in_language')
        const found = list.find((l) => l['code'] === v)
        if (found !== undefined) {
          const usage = stringList(found, 'usage')
          if (!usage.includes(w.usage)) usage.push(w.usage)
          return
        }
        list.push({ code: v, usage: [w.usage] })
        return
      }
    }
  }

  /** Notizen aus dem Fallback "als Notiz behalten" der Werteliste. */
  addNote(column: string, value: string): void {
    this.notes.push(`${column}: ${value}`)
  }

  hasWorkTitle(): boolean {
    return this.work['has_primary_title'] !== undefined
  }

  /** Uebernimmt einen Titel aus Manifestation oder Exemplar, wenn das Werk keinen hat. */
  borrowWorkTitle(): void {
    if (this.hasWorkTitle()) return
    for (const [n, ebene] of [[this.item, 'Exemplar'], [this.manif, 'Manifestation']] as const) {
      const title = n['has_primary_title']
      const name = typeof title === 'object' && title !== null ? (title as AvefiValue)['has_name'] : undefined
      if (typeof name === 'string' && name.trim() !== '') {
        // Der geborgte Titel wechselt dabei den Typ: An Manifestation und
        // Exemplar ist er ein TitleProper, am Werk waere er das nicht — dort
        // sieht das Schema fuer einen uebernommenen Titel SuppliedDevisedTitle
        // vor. Die Umdeutung ist richtig, war aber nirgends nachzulesen.
        this.work['has_primary_title'] = { has_name: name, type: 'SuppliedDevisedTitle' }
        this.aufbauHinweise.push(meldung('record.titleBorrowed', { titel: name, ebene }))
        return
      }
    }
  }

  /**
   * Fertiger kanonischer Datensatz.
   * @param baseId Praefix fuer die erzeugten LocalResource-Kennungen.
   */
  build(baseId: string): AvefiRecord {
    this.borrowWorkTitle()

    const work = this.work
    if (work['type'] === undefined) {
      // Pflichtfeld im Schema. Der Vorgabewert ist vertretbar — die grosse
      // Mehrheit der Bestaende ist monographisch —, aber es ist eine
      // Entscheidung der Software ueber Daten, die niemand getroffen hat.
      // Sie steht deshalb im Bericht, statt nur im Quelltext.
      work['type'] = 'Monographic'
      this.aufbauHinweise.push(meldung('record.workTypeDefaulted', { wert: 'Monographic' }))
    }

    const workId = this.localIds.work ?? `${baseId}_work`
    if (this.localIds.work === null) {
      nodeList(work, 'has_identifier').push({ category: 'avefi:LocalResource', id: workId })
    }

    const manifestations: AvefiNode[] = []
    const items: AvefiNode[] = []

    // Eine Manifestation entsteht auch dann, wenn nur Exemplarangaben vorliegen:
    // ein Exemplar ohne Manifestation waere im Schema nicht anschliessbar.
    if (this.touchedManif || this.touchedItem) {
      const manif = this.manif
      const manifId = this.localIds.manifestation ?? `${baseId}_manifestation`
      if (this.localIds.manifestation === null) {
        nodeList(manif, 'has_identifier').push({ category: 'avefi:LocalResource', id: manifId })
      }
      manif['is_manifestation_of'] = [{ category: 'avefi:LocalResource', id: workId }]

      if (this.touchedItem) {
        const item = this.item
        const itemId = this.localIds.item ?? `${baseId}_item`
        if (this.localIds.item === null) {
          nodeList(item, 'has_identifier').push({ category: 'avefi:LocalResource', id: itemId })
        }
        item['is_item_of'] = { category: 'avefi:LocalResource', id: manifId }
        if (this.notes.length > 0) {
          const list = stringList(item, 'has_note')
          for (const n of this.notes) list.push(n)
        }
        items.push(item)
      } else if (this.notes.length > 0) {
        const list = stringList(manif, 'has_note')
        for (const n of this.notes) list.push(n)
      }
      manifestations.push(manif)
    }

    return { work, manifestations, items }
  }

  /* ---------------- Interne Helfer ---------------- */

  private node(level: Level): AvefiNode {
    if (level === 'manifestation') return this.manif
    if (level === 'item') return this.item
    return this.work
  }

  /** Findet ein Ereignis der Kategorie im Knoten oder legt es an. */
  private event(node: AvefiNode, category: string, type: string | undefined): AvefiValue {
    const list = nodeList(node, 'has_event')
    const found = list.find((e) => categoryOf(e) === category)
    if (found !== undefined) return found
    const created: AvefiValue = { category }
    if (type !== undefined) created['type'] = type
    list.push(created)
    return created
  }

  /** Findet eine Taetigkeit im Ereignis oder legt sie an. */
  private activity(event: AvefiValue, category: string, type: string): AvefiValue {
    const list = nodeList(event, 'has_activity')
    const found = list.find((a) => categoryOf(a) === category && a['type'] === type)
    if (found !== undefined) return found
    const created: AvefiValue = { category, type, has_agent: [] }
    list.push(created)
    return created
  }

  /**
   * Haengt gefundene Normdaten als same_as an eine Entitaet. Erlaubt sind nur die
   * Resource-Typen, die das Schema fuer diese Klasse vorsieht — eine Orts-ID an
   * einer Person waere schemawidrig.
   */
  private mergeSameAs(entity: AvefiValue, sameAs: readonly EnrichHit[], allowedTypes: readonly string[]): void {
    if (sameAs.length === 0) return
    for (const r of sameAs) {
      if (allowedTypes.length > 0 && !allowedTypes.includes(r.resource)) continue
      const list = nodeList(entity, 'same_as')
      if (list.some((e) => e['id'] === r.id && categoryOf(e) === r.category)) continue
      list.push({ category: r.category, id: r.id })
    }
  }
}

/** Kann dieses Ziel ueberhaupt Normdaten aufnehmen? */
export function acceptsAuthority(target: TargetDefinition): boolean {
  return writerAcceptsAuthority(target.writer)
}
