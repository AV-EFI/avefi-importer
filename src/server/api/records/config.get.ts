/*
 * GET /api/records/config — alles, was der Datensatz-Editor an Schemawissen braucht.
 *
 * Der Zielkatalog (targetsForFrontend) und das SchemaModel sind die Quelle. Der
 * Editor pflegt bewusst keine eigene Feldliste: Sonst gaebe es zwei Wahrheiten
 * darueber, was AVefi kennt, und die zweite altert.
 *
 * Welche Wertelisten mitgehen, leitet sich aus dem Katalog ab — jedes Ziel vom
 * Typ enum:X zieht X mit. Nur die Listen, die kein Ziel nennt (Titelart,
 * Sprachverwendung, Rollen je Taetigkeit, Ereignisarten), stehen hier zusaetzlich.
 */
import type { SchemaModel } from '../../lib/mapping/index'
import { targetsForFrontend } from '../../lib/mapping/index'
import { sourcesForKind } from '../../lib/authority/index'
import { requireUser } from '../../utils/session'
import { noStore } from '../imports/_lib'
import { schemaLoadError, schemaModel } from './_schema'
import { FORMAT_KLASSEN, formatEnum } from '#shared/formatklassen'

/** Art eines erschliessenden Eintrags -> AVefi-Klasse. */
const SUBJECT_KINDS = [
  { kind: 'subject', className: 'Subject', category: 'avefi:Subject', agentType: null },
  { kind: 'person', className: 'Agent', category: 'avefi:Agent', agentType: 'Person' },
  { kind: 'corporate', className: 'Agent', category: 'avefi:Agent', agentType: 'CorporateBody' },
  { kind: 'place', className: 'GeographicName', category: 'avefi:GeographicName', agentType: null }
] as const

/** Taetigkeitsbereiche (Beteiligte) -> Activity-Klasse und Rollen-Werteliste. */
const ACTIVITY_CATEGORIES = [
  { category: 'avefi:DirectingActivity', enumName: 'DirectingActivityTypeEnum' },
  { category: 'avefi:WritingActivity', enumName: 'WritingActivityTypeEnum' },
  { category: 'avefi:CinematographyActivity', enumName: 'CinematographyActivityTypeEnum' },
  { category: 'avefi:EditingActivity', enumName: 'EditingActivityTypeEnum' },
  { category: 'avefi:MusicActivity', enumName: 'MusicActivityTypeEnum' },
  { category: 'avefi:SoundActivity', enumName: 'SoundActivityTypeEnum' },
  { category: 'avefi:ProducingActivity', enumName: 'ProducingActivityTypeEnum' },
  { category: 'avefi:CastActivity', enumName: 'CastActivityTypeEnum' },
  { category: 'avefi:ProductionDesignActivity', enumName: 'ProductionDesignActivityTypeEnum' },
  { category: 'avefi:AnimationActivity', enumName: 'AnimationActivityTypeEnum' },
  { category: 'avefi:SpecialEffectsActivity', enumName: 'SpecialEffectsActivityTypeEnum' }
] as const

/** Ereignisarten am Werk. */
const EVENT_CATEGORIES = [
  { category: 'avefi:ProductionEvent', enumName: 'ProductionEventTypeEnum' },
  { category: 'avefi:PublicationEvent', enumName: 'PublicationEventTypeEnum' },
  { category: 'avefi:PreservationEvent', enumName: 'PreservationEventTypeEnum' },
  { category: 'avefi:ManufactureEvent', enumName: 'ManufactureEventTypeEnum' },
  { category: 'avefi:RightsCopyrightRegistrationEvent', enumName: null }
] as const

/** Kennungstypen, die im Editor von Hand gesetzt werden koennen. */
const RESOURCE_TYPES = [
  'LocalResource', 'AVefiResource', 'GNDResource', 'WikidataResource', 'VIAFResource',
  'FilmportalResource', 'EIDRResource', 'DOIResource', 'ISILResource', 'AATResource', 'TGNResource'
] as const

function enumNames(schema: SchemaModel, targetTypes: readonly string[]): string[] {
  const names = new Set<string>()
  for (const type of targetTypes) {
    if (type.startsWith('enum:')) names.add(type.slice(5))
    else if (type === 'lang') names.add('LanguageCodeEnum')
    // Das gemeinsame Format-Ziel nennt keine einzelne Liste; der Editor braucht
    // alle sechs (#28).
    else if (type === 'format') for (const [klasse] of FORMAT_KLASSEN) names.add(formatEnum(klasse))
  }
  names.add('TitleTypeEnum')
  names.add('LanguageUsageEnum')
  for (const a of ACTIVITY_CATEGORIES) names.add(a.enumName)
  for (const e of EVENT_CATEGORIES) if (e.enumName !== null) names.add(e.enumName)
  // Nur Listen mitgeben, die auch Werte haben — eine leere Liste ist kein Angebot.
  return [...names].filter((n) => schema.enum(n).length > 0).sort()
}

export default defineEventHandler(async (event) => {
  noStore(event)
  await requireUser(event)

  const schema = await schemaModel()
  const targets = targetsForFrontend(schema)
  const names = enumNames(schema, targets.map((t) => t.type))

  const enums: Record<string, string[]> = {}
  for (const n of names) enums[n] = schema.enum(n)

  const resourceTypes: Record<string, { category: string; pattern: string | null }> = {}
  for (const name of RESOURCE_TYPES) {
    if (!schema.classExists(name)) continue
    resourceTypes[name] = { category: schema.resourceCategory(name), pattern: schema.resourceIdPattern(name) }
  }

  const subjectKinds = SUBJECT_KINDS.map((k) => ({
    kind: k.kind,
    category: k.category,
    agentType: k.agentType,
    sameAsTypes: schema.sameAsTypes(k.className),
    sources: sourcesForKind(k.kind, schema)
  }))

  const activityCategories = ACTIVITY_CATEGORIES.map((a) => ({
    category: a.category,
    enumName: a.enumName,
    // Werteliste vorhanden? Sonst darf die Oberflaeche keine Auswahl vortaeuschen.
    hasValues: schema.enum(a.enumName).length > 0
  }))

  const eventCategories = EVENT_CATEGORIES.map((e) => ({
    category: e.category,
    enumName: e.enumName,
    hasValues: e.enumName !== null && schema.enum(e.enumName).length > 0
  }))

  return {
    schemaVersion: schema.version,
    schemaError: schemaLoadError(),
    enums,
    subjectKinds,
    activityCategories,
    eventCategories,
    resourceTypes,
    targets
  }
})
