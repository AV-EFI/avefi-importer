/*
 * Umformung zwischen AVefi-Struktur und Formularmodell.
 *
 * Zwei Grundsaetze, die im PHP-Editor fehlten:
 *
 *  1. Was der Editor nicht anzeigt, geht nicht verloren. Jeder Knoten behaelt
 *     seine Rohform; beim Zurueckschreiben werden nur die Felder ersetzt, fuer
 *     die es ein Formularfeld gibt. Der PHP-Editor baute das Werk von Grund auf
 *     neu und verwarf dabei alles Unbekannte — beim Produktionsereignis etwa
 *     located_in, also das Produktionsland und damit eines der vier Kernfelder.
 *
 *  2. Der Haupttitel ist eine Position, kein Ziel fuer Vorschlaege. Titel liegen
 *     in einer Liste, deren erster Eintrag der Haupttitel ist. Ein weiterer
 *     Titel wird nur durch die ausdrueckliche Handlung „Zum Haupttitel machen"
 *     zum Haupttitel. Im PHP-Stand landeten Titelvorschlaege alle auf dem
 *     Haupttitel; das war ein gemeldeter Fehler.
 */
import type { AvefiNode, AvefiRecord, AuthorityHit, EditorConfig } from './types'
import { klaereFormat, teileFormatwert } from '#shared/formatklassen'

/* --------------------------------------------------------------- Hilfsmittel */

let counter = 0
/** Stabiler Schluessel fuer v-for; Indizes taugen dafuer nicht, weil gelöscht wird. */
export function nextKey(): number {
  counter += 1
  return counter
}

function clone<T>(value: T): T {
  return value === undefined || value === null ? value : (JSON.parse(JSON.stringify(value)) as T)
}

function rec(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? clone(value as Record<string, unknown>)
    : {}
}

function list(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter((v) => typeof v === 'object' && v !== null).map((v) => rec(v)) : []
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.map((v) => String(v ?? '')) : []
}

function text(value: unknown): string {
  return value === undefined || value === null ? '' : String(value)
}

function without(source: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  const out = clone(source)
  for (const k of keys) delete out[k]
  return out
}

/** Leere Werte fallen weg — ein leeres Feld ist keine Angabe. */
function put(target: Record<string, unknown>, key: string, value: unknown): void {
  if (value === undefined || value === null) return
  if (typeof value === 'string' && value.trim() === '') return
  if (Array.isArray(value) && value.length === 0) return
  target[key] = value
}

/* ------------------------------------------------------------------- Modelle */

export interface UiRef {
  key: number
  category: string
  id: string
  label: string
  source: string
  description: string
  raw: Record<string, unknown>
}

export interface UiTitle {
  key: number
  has_name: string
  type: string
  raw: Record<string, unknown>
}

export interface UiEntity {
  key: number
  /** subject | person | corporate | place | genre */
  kind: string
  has_name: string
  same_as: UiRef[]
  raw: Record<string, unknown>
  /** Eindeutige Treffer, die zur Bestaetigung angeboten werden. */
  suggest: AuthorityHit[]
  /** Mehrdeutig: es wurde ausdruecklich nichts eingetragen. */
  ambiguous: AuthorityHit[]
}

export interface UiActivity {
  key: number
  category: string
  type: string
  name: string
  agentType: string
  same_as: UiRef[]
  raw: Record<string, unknown>
  agentRaw: Record<string, unknown>
}

export interface UiEvent {
  key: number
  category: string
  type: string
  has_date: string
  raw: Record<string, unknown>
}

export interface UiPlace {
  key: number
  has_name: string
  raw: Record<string, unknown>
}

export interface UiIdentifier {
  key: number
  resourceType: string
  id: string
  raw: Record<string, unknown>
}

export interface UiValue {
  key: number
  value: string
}

export interface UiLanguage {
  key: number
  code: string
  usage: string
  raw: Record<string, unknown>
}

/**
 * Ein Eintrag in `has_format`, gefuehrt als „Klasse:Wert" wie im Ziel
 * „Format (alle Traegerklassen)" der Zuordnung (#28). So bleibt `DV` als
 * Videoband und als Datei unterscheidbar.
 */
export interface UiFormat {
  key: number
  value: string
  raw: Record<string, unknown>
}

export interface UiWork {
  raw: Record<string, unknown>
  type: string
  variant_type: string
  /** [0] ist der Haupttitel. */
  titles: UiTitle[]
  productionRaw: Record<string, unknown>
  productionYear: string
  productionPlaces: UiPlace[]
  activities: UiActivity[]
  subjects: UiEntity[]
  events: UiEvent[]
  genres: UiEntity[]
  forms: UiValue[]
  identifiers: UiIdentifier[]
  notes: UiValue[]
  sameAs: UiRef[]
}

export interface UiManifestation {
  key: number
  raw: Record<string, unknown>
  title: UiTitle
  identifiers: UiIdentifier[]
  notes: UiValue[]
}

export interface UiItem {
  key: number
  raw: Record<string, unknown>
  title: UiTitle
  element_type: string
  has_colour_type: string
  has_sound_type: string
  has_frame_rate: string
  has_access_status: string
  duration: string
  languages: UiLanguage[]
  formats: UiFormat[]
  identifiers: UiIdentifier[]
  notes: UiValue[]
}

export interface UiRecord {
  work: UiWork
  manifestations: UiManifestation[]
  items: UiItem[]
}

/* --------------------------------------------------------- Felder des Editors */

const WORK_MANAGED = [
  'category', 'type', 'variant_type', 'has_primary_title', 'has_alternative_title',
  'has_event', 'has_subject', 'has_genre', 'has_form', 'has_identifier', 'has_note', 'same_as'
] as const

const EVENT_MANAGED = ['category', 'type', 'has_date', 'located_in', 'has_activity'] as const
const MANIFESTATION_MANAGED = ['category', 'has_primary_title', 'has_identifier', 'has_note'] as const
const ITEM_MANAGED = [
  'category', 'has_primary_title', 'has_identifier', 'has_note', 'element_type',
  'has_colour_type', 'has_sound_type', 'has_frame_rate', 'has_access_status',
  'has_duration', 'in_language', 'has_format'
] as const

export const DEFAULT_PRIMARY_TITLE_TYPE = 'PreferredTitle'
export const DEFAULT_ALT_TITLE_TYPE = 'AlternativeTitle'
export const DEFAULT_SUB_TITLE_TYPE = 'TitleProper'

/* --------------------------------------------------------------- Kennungstypen */

/** category -> Resource-Typ, aus der Konfiguration. Unbekanntes bleibt lokal. */
function resourceTypeOf(category: string, config: EditorConfig): string {
  for (const [name, def] of Object.entries(config.resourceTypes)) {
    if (def.category === category) return name
  }
  const short = category.replace(/^avefi:/, '')
  return config.resourceTypes[short] !== undefined ? short : 'LocalResource'
}

function categoryOf(resourceType: string, config: EditorConfig): string {
  return config.resourceTypes[resourceType]?.category ?? `avefi:${resourceType}`
}

export function sourceOfCategory(category: string): string {
  return category.replace(/^avefi:/, '').replace(/Resource$/, '').toLowerCase()
}

/* ------------------------------------------------------------------- Einlesen */

function parseRef(node: Record<string, unknown>): UiRef {
  const category = text(node.category)
  return {
    key: nextKey(),
    category,
    id: text(node.id),
    label: '',
    source: sourceOfCategory(category),
    description: '',
    raw: node
  }
}

function parseIdentifier(node: Record<string, unknown>, config: EditorConfig): UiIdentifier {
  return {
    key: nextKey(),
    resourceType: resourceTypeOf(text(node.category), config),
    id: text(node.id),
    raw: node
  }
}

function parseTitle(node: unknown, fallbackType: string): UiTitle {
  const t = rec(node)
  return {
    key: nextKey(),
    has_name: text(t.has_name),
    type: text(t.type) || fallbackType,
    raw: t
  }
}

function entityKind(node: Record<string, unknown>): string {
  const category = text(node.category)
  if (category === 'avefi:Agent') return text(node.type) === 'CorporateBody' ? 'corporate' : 'person'
  if (category === 'avefi:GeographicName') return 'place'
  return 'subject'
}

function parseEntity(node: Record<string, unknown>, kind: string): UiEntity {
  return {
    key: nextKey(),
    kind,
    has_name: text(node.has_name),
    same_as: list(node.same_as).map(parseRef),
    raw: node,
    suggest: [],
    ambiguous: []
  }
}

function parseActivity(node: Record<string, unknown>): UiActivity {
  const agent = rec(list(node.has_agent)[0])
  return {
    key: nextKey(),
    category: text(node.category) || 'avefi:DirectingActivity',
    type: text(node.type),
    name: text(agent.has_name),
    agentType: text(agent.type) || 'Person',
    same_as: list(agent.same_as).map(parseRef),
    raw: node,
    agentRaw: agent
  }
}

export function parseRecord(record: AvefiRecord, config: EditorConfig): UiRecord {
  // Zaehler zuruecksetzen: Die Schluessel landen als id-Attribute im Markup.
  // Ein prozessweiter Zaehler steht auf dem Server bei jedem Aufruf anders als
  // im Browser — die Seite wuerde beim Uebernehmen (Hydration) abweichen und
  // Vue baut sie dann still neu auf. Pro Datensatz bei 0 beginnen macht beide
  // Seiten gleich.
  counter = 0
  const w = rec(record.work)

  const events = list(w.has_event)
  const prodIndex = events.findIndex((e) => text(e.category) === 'avefi:ProductionEvent')
  const production = prodIndex >= 0 ? (events[prodIndex] as Record<string, unknown>) : {}
  const others = events.filter((_, i) => i !== prodIndex)

  const titles: UiTitle[] = [parseTitle(w.has_primary_title, DEFAULT_PRIMARY_TITLE_TYPE)]
  for (const t of list(w.has_alternative_title)) titles.push(parseTitle(t, DEFAULT_ALT_TITLE_TYPE))

  const work: UiWork = {
    raw: w,
    type: text(w.type),
    variant_type: text(w.variant_type),
    titles,
    productionRaw: production,
    productionYear: text(production.has_date),
    productionPlaces: list(production.located_in).map((p) => ({
      key: nextKey(), has_name: text(p.has_name), raw: p
    })),
    activities: list(production.has_activity).map(parseActivity),
    subjects: list(w.has_subject).map((s) => parseEntity(s, entityKind(s))),
    events: others.map((e) => ({
      key: nextKey(),
      category: text(e.category) || 'avefi:PublicationEvent',
      type: text(e.type),
      has_date: text(e.has_date),
      raw: e
    })),
    genres: list(w.has_genre).map((g) => parseEntity(g, 'genre')),
    forms: strings(w.has_form).map((v) => ({ key: nextKey(), value: v })),
    identifiers: list(w.has_identifier).map((i) => parseIdentifier(i, config)),
    notes: strings(w.has_note).map((v) => ({ key: nextKey(), value: v })),
    sameAs: list(w.same_as).map(parseRef)
  }

  return {
    work,
    manifestations: record.manifestations.map((node) => {
      const m = rec(node)
      return {
        key: nextKey(),
        raw: m,
        title: parseTitle(m.has_primary_title, DEFAULT_SUB_TITLE_TYPE),
        identifiers: list(m.has_identifier).map((i) => parseIdentifier(i, config)),
        notes: strings(m.has_note).map((v) => ({ key: nextKey(), value: v }))
      }
    }),
    items: record.items.map((node) => {
      const it = rec(node)
      return {
        key: nextKey(),
        raw: it,
        title: parseTitle(it.has_primary_title, DEFAULT_SUB_TITLE_TYPE),
        element_type: text(it.element_type),
        has_colour_type: text(it.has_colour_type),
        has_sound_type: text(it.has_sound_type),
        has_frame_rate: text(it.has_frame_rate),
        has_access_status: text(it.has_access_status),
        duration: text(rec(it.has_duration).has_value),
        languages: list(it.in_language).map((l) => ({
          key: nextKey(), code: text(l.code), usage: text(l.usage), raw: l
        })),
        formats: list(it.has_format).map((f) => ({ key: nextKey(), value: formatWert(f), raw: f })),
        identifiers: list(it.has_identifier).map((i) => parseIdentifier(i, config)),
        notes: strings(it.has_note).map((v) => ({ key: nextKey(), value: v }))
      }
    })
  }
}

/* ---------------------------------------------------------------- Ausschreiben */

function titleOut(t: UiTitle, fallbackType: string): Record<string, unknown> | null {
  const name = t.has_name.trim()
  if (name === '') return null
  const out = without(t.raw, ['has_name', 'type'])
  out.has_name = name
  out.type = t.type || fallbackType
  return out
}

function refsOut(refs: readonly UiRef[]): Record<string, unknown>[] {
  return refs
    .filter((r) => r.id.trim() !== '')
    .map((r) => {
      const out = without(r.raw, ['category', 'id'])
      out.category = r.category
      out.id = r.id.trim()
      return out
    })
}

function identifiersOut(ids: readonly UiIdentifier[], config: EditorConfig): Record<string, unknown>[] {
  return ids
    .filter((i) => i.id.trim() !== '')
    .map((i) => {
      const out = without(i.raw, ['category', 'id'])
      out.category = categoryOf(i.resourceType, config)
      out.id = i.id.trim()
      return out
    })
}

function valuesOut(values: readonly UiValue[]): string[] {
  return values.map((v) => v.value.trim()).filter((v) => v !== '')
}

/**
 * Eine Entitaet mit Name und Normdaten.
 *
 * has_name kommt ausschliesslich aus dem Namensfeld. Eine bestaetigte
 * Zuordnung haengt daneben in same_as — sie ersetzt den Namen nie. Im PHP-Stand
 * stand deshalb einmal eine GND-Nummer im Namensfeld, und der Kunde meldete es.
 */
function entityOut(e: UiEntity, config: EditorConfig): Record<string, unknown> | null {
  const name = e.has_name.trim()
  const refs = refsOut(e.same_as)
  if (name === '' && refs.length === 0) return null

  const out = without(e.raw, ['category', 'type', 'has_name', 'same_as'])
  if (e.kind === 'person' || e.kind === 'corporate') {
    out.category = 'avefi:Agent'
    out.type = e.kind === 'corporate' ? 'CorporateBody' : 'Person'
  } else if (e.kind === 'place') {
    out.category = 'avefi:GeographicName'
  } else if (e.kind !== 'genre') {
    out.category = 'avefi:Subject'
  }
  put(out, 'has_name', name)
  put(out, 'same_as', refs)
  void config
  return out
}

function activityOut(a: UiActivity): Record<string, unknown> | null {
  const name = a.name.trim()
  const refs = refsOut(a.same_as)
  if (name === '' && refs.length === 0) return null

  const agent = without(a.agentRaw, ['category', 'type', 'has_name', 'same_as'])
  agent.category = 'avefi:Agent'
  agent.type = a.agentType || 'Person'
  put(agent, 'has_name', name)
  put(agent, 'same_as', refs)

  const out = without(a.raw, ['category', 'type', 'has_agent'])
  out.category = a.category
  put(out, 'type', a.type)
  out.has_agent = [agent]
  return out
}

export function serializeRecord(ui: UiRecord, config: EditorConfig): AvefiRecord {
  const w = ui.work
  const work = without(w.raw, WORK_MANAGED)
  work.category = 'avefi:WorkVariant'
  put(work, 'type', w.type)
  put(work, 'variant_type', w.variant_type)

  const primary = w.titles[0] === undefined ? null : titleOut(w.titles[0], DEFAULT_PRIMARY_TITLE_TYPE)
  if (primary !== null) work.has_primary_title = primary
  const alternatives = w.titles.slice(1)
    .map((t) => titleOut(t, DEFAULT_ALT_TITLE_TYPE))
    .filter((t): t is Record<string, unknown> => t !== null)
  put(work, 'has_alternative_title', alternatives)

  /* Produktionsereignis: Rohform behalten, nur die gefuehrten Felder ersetzen. */
  const production = without(w.productionRaw, EVENT_MANAGED)
  production.category = 'avefi:ProductionEvent'
  put(production, 'has_date', w.productionYear.trim())
  put(production, 'located_in', w.productionPlaces
    .filter((p) => p.has_name.trim() !== '')
    .map((p) => {
      const out = without(p.raw, ['category', 'has_name'])
      out.category = 'avefi:GeographicName'
      out.has_name = p.has_name.trim()
      return out
    }))
  put(production, 'has_activity', w.activities
    .map(activityOut)
    .filter((a): a is Record<string, unknown> => a !== null))

  const events: Record<string, unknown>[] = []
  if (Object.keys(production).length > 1) events.push(production)
  for (const e of w.events) {
    if (e.has_date.trim() === '' && e.type.trim() === '') continue
    const out = without(e.raw, EVENT_MANAGED)
    out.category = e.category
    put(out, 'type', e.type)
    put(out, 'has_date', e.has_date.trim())
    events.push(out)
  }
  put(work, 'has_event', events)

  put(work, 'has_subject', w.subjects
    .map((s) => entityOut(s, config))
    .filter((s): s is Record<string, unknown> => s !== null))
  put(work, 'has_genre', w.genres
    .map((g) => entityOut(g, config))
    .filter((g): g is Record<string, unknown> => g !== null))
  put(work, 'has_form', valuesOut(w.forms))
  put(work, 'has_identifier', identifiersOut(w.identifiers, config))
  put(work, 'has_note', valuesOut(w.notes))
  put(work, 'same_as', refsOut(w.sameAs))

  const manifestations = ui.manifestations.map((m) => {
    const out = without(m.raw, MANIFESTATION_MANAGED)
    out.category = 'avefi:Manifestation'
    const title = titleOut(m.title, DEFAULT_SUB_TITLE_TYPE)
    if (title !== null) out.has_primary_title = title
    put(out, 'has_identifier', identifiersOut(m.identifiers, config))
    put(out, 'has_note', valuesOut(m.notes))
    return out as AvefiNode
  })

  const items = ui.items.map((it) => {
    const out = without(it.raw, ITEM_MANAGED)
    out.category = 'avefi:Item'
    const title = titleOut(it.title, DEFAULT_SUB_TITLE_TYPE)
    if (title !== null) out.has_primary_title = title
    put(out, 'element_type', it.element_type)
    put(out, 'has_colour_type', it.has_colour_type)
    put(out, 'has_sound_type', it.has_sound_type)
    put(out, 'has_frame_rate', it.has_frame_rate)
    put(out, 'has_access_status', it.has_access_status)
    if (it.duration.trim() !== '') {
      const duration = rec(it.raw.has_duration)
      duration.has_value = it.duration.trim()
      out.has_duration = duration
    }
    put(out, 'in_language', it.languages
      .filter((l) => l.code.trim() !== '')
      .map((l) => {
        const lang = without(l.raw, ['code', 'usage'])
        lang.code = l.code.trim()
        put(lang, 'usage', l.usage)
        return lang
      }))
    put(out, 'has_format', formatsOut(it.formats, config))
    put(out, 'has_identifier', identifiersOut(it.identifiers, config))
    put(out, 'has_note', valuesOut(it.notes))
    return out as AvefiNode
  })

  return { work: work as AvefiNode, manifestations, items }
}

/* ------------------------------------------------------------- Neue Bausteine */

export function emptyTitle(type: string): UiTitle {
  return { key: nextKey(), has_name: '', type, raw: {} }
}

export function emptyEntity(kind: string): UiEntity {
  return { key: nextKey(), kind, has_name: '', same_as: [], raw: {}, suggest: [], ambiguous: [] }
}

export function emptyActivity(category: string): UiActivity {
  return {
    key: nextKey(), category, type: '', name: '', agentType: 'Person',
    same_as: [], raw: {}, agentRaw: {}
  }
}

export function emptyEvent(category: string): UiEvent {
  return { key: nextKey(), category, type: '', has_date: '', raw: {} }
}

export function emptyIdentifier(): UiIdentifier {
  return { key: nextKey(), resourceType: 'LocalResource', id: '', raw: {} }
}

export function emptyValue(): UiValue {
  return { key: nextKey(), value: '' }
}

export function emptyLanguage(): UiLanguage {
  return { key: nextKey(), code: '', usage: '', raw: {} }
}

export function emptyFormat(): UiFormat {
  return { key: nextKey(), value: '', raw: {} }
}

/* ------------------------------------------------------------------- Format */

/** `{category: 'avefi:Video', type: 'VHS'}` → „Video:VHS". */
export function formatWert(node: Record<string, unknown>): string {
  const klasse = text(node.category).replace(/^avefi:/, '')
  const typ = text(node.type)
  if (typ === '') return ''
  return klasse === '' ? typ : `${klasse}:${typ}`
}

/**
 * Formate zurueck nach `has_format`.
 *
 * Ein Wert ohne Klasse wird ueber die Wertelisten aufgeloest, wenn er nur in
 * einer steht. Laesst er sich nicht aufloesen (mehrdeutiges „DV", unbekannte
 * Klasse), bleibt der gelesene Knoten unveraendert stehen, statt dass die Angabe
 * beim Speichern verschwindet. Die Pruefung meldet ihn dann wie zuvor.
 */
export function formatsOut(formats: readonly UiFormat[], config: EditorConfig): Record<string, unknown>[] {
  const liste = (name: string) => config.enums[name] ?? []
  const out: Record<string, unknown>[] = []
  for (const f of formats) {
    const v = f.value.trim()
    if (v === '') continue
    let { klasse, wert } = teileFormatwert(v)
    if (klasse === null) {
      const k = klaereFormat(v, liste)
      if (k.ok) {
        klasse = k.klasse
        wert = k.wert
      }
    }
    if (klasse === null) {
      if (Object.keys(f.raw).length > 0) out.push({ ...f.raw })
      continue
    }
    const knoten = without(f.raw, ['category', 'type'])
    knoten.category = `avefi:${klasse}`
    knoten.type = wert
    if (!out.some((o) => o.category === knoten.category && o.type === knoten.type)) out.push(knoten)
  }
  return out
}

export function emptyManifestation(title: string): UiManifestation {
  return {
    key: nextKey(),
    raw: { is_manifestation_of: [] },
    title: { key: nextKey(), has_name: title, type: DEFAULT_SUB_TITLE_TYPE, raw: {} },
    identifiers: [],
    notes: []
  }
}

export function emptyItem(title: string): UiItem {
  return {
    key: nextKey(),
    raw: {},
    title: { key: nextKey(), has_name: title, type: DEFAULT_SUB_TITLE_TYPE, raw: {} },
    element_type: '', has_colour_type: '', has_sound_type: '',
    has_frame_rate: '', has_access_status: '', duration: '',
    languages: [], formats: [], identifiers: [], notes: []
  }
}

/* ------------------------------------------------------------------ Normdaten */

function normalizeName(value: string): string {
  return value.toLowerCase().trim().replace(/\s+/g, ' ')
}

/**
 * Aus Trefferliste und Suchbegriff die eindeutigen Treffer bestimmen.
 *
 * Eindeutig heisst: je Quelle genau ein Treffer, dessen Name auf die Anfrage
 * passt. Alles andere ist mehrdeutig und wird zur Auswahl gestellt, nicht
 * eingetragen. Kein Treffer ist besser als ein falscher.
 */
export function splitMatches(name: string, hits: readonly AuthorityHit[]): {
  confident: AuthorityHit[]
  ambiguous: AuthorityHit[]
} {
  const wanted = normalizeName(name)
  const bySource = new Map<string, AuthorityHit[]>()
  for (const hit of hits) {
    if (!hit.exact && normalizeName(hit.label) !== wanted) continue
    const found = bySource.get(hit.source)
    if (found) found.push(hit)
    else bySource.set(hit.source, [hit])
  }
  const confident: AuthorityHit[] = []
  const ambiguous: AuthorityHit[] = []
  for (const group of bySource.values()) {
    if (group.length === 1 && group[0] !== undefined) confident.push(group[0])
    else ambiguous.push(...group)
  }
  return { confident, ambiguous }
}

/** Eine bestaetigte Zuordnung anhaengen — ohne den Namen anzufassen. */
export function addSameAs(list: UiRef[], hit: AuthorityHit): boolean {
  if (list.some((r) => r.category === hit.category && r.id === hit.id)) return false
  list.push({
    key: nextKey(),
    category: hit.category,
    id: hit.id,
    label: hit.label,
    source: hit.source,
    description: hit.description,
    raw: {}
  })
  return true
}
