/*
 * TargetCatalog — kuratierte Liste der Ziele, auf die eine Quellspalte gemappt
 * werden kann, samt Bauanleitung fuer den jeweiligen AVefi-Knoten.
 *
 * Warum kuratiert und nicht freier Pfadausdruck: AVefi ist tief verschachtelt.
 * Eine Regie-Spalte landet unter has_event -> ProductionEvent -> has_activity ->
 * DirectingActivity -> has_agent -> has_name. Das kann eine Kuratorin nicht
 * tippen, und jeder Tippfehler erzeugt schemawidriges JSON. Der Katalog nennt
 * stattdessen "Werk > Beteiligte > Regie" und weiss selbst, wie der Knoten
 * entsteht.
 *
 * Enums und Muster stammen aus dem SchemaModel, damit der Katalog dem echten
 * av-efi-schema folgt und nicht daneben altert.
 */

import type { TargetEntry, TargetLevel, TargetType } from '#shared/types/domain'
import { meldung } from './meldungen.js'
import type { MappingMessage } from '#shared/types/domain'
import type { SchemaModel } from './schema-model.js'
import { getSchemaModel } from './schema-model.js'
import { alleFormatwerte, klaereFormat } from '#shared/formatklassen'

/* --------------------------------------------------------- Bauanleitungen */

export type TargetWriter =
  | { kind: 'title'; titleType: string; primary: boolean }
  | { kind: 'prop'; prop: string }
  | { kind: 'strlist'; prop: string }
  | { kind: 'named'; prop: string; className?: string }
  | { kind: 'subject'; className: string; agentType?: string }
  | { kind: 'activity'; category: string; type: string; agentType: string }
  | { kind: 'eventdate'; category: string; type?: string }
  | { kind: 'eventplace'; category: string; type?: string }
  | { kind: 'identifier'; resource: string }
  | { kind: 'sameas'; resource: string }
  | { kind: 'duration' }
  | { kind: 'extent'; unit: string }
  | { kind: 'language'; usage: string }
  // has_format ist im Schema kein Enum, sondern eine Liste aus sechs Klassen
  // (Film, Video, Audio, Optical, DigitalFile, DigitalFileEncoding), jede mit
  // einer eigenen Werteliste. Die Traegerklasse steht deshalb am Ziel und wird
  // nicht aus dem Wert erraten: "DV" kommt sowohl in FormatVideoTypeEnum als
  // auch in FormatDigitalFileTypeEnum vor. Ausnahme ist das gemeinsame Ziel
  // item.format.any (#28): className '' — dort traegt der Wert die Klasse
  // ("Video:DV"), siehe shared/formatklassen.ts.
  | { kind: 'format'; className: string }

/** Katalogeintrag: der oeffentliche Teil aus domain.ts plus die Bauanleitung. */
export interface TargetDefinition extends TargetEntry {
  writer: TargetWriter
}

/** Kann dieses Ziel ueberhaupt Normdaten aufnehmen? */
export function writerAcceptsAuthority(writer: TargetWriter): boolean {
  return ['activity', 'subject', 'named', 'sameas', 'identifier', 'eventplace'].includes(writer.kind)
}

/**
 * Welche Normdatenart an diesem Ziel Sinn ergibt — null heisst "keine Aussage".
 *
 * Anlass: In Profil 8 stand an der Spalte "Land" ein GND-Abgleich mit
 * kind "person" auf dem Ziel "Werk > Produktion > Ort". Ein Land wurde also
 * als Person gesucht und traf nie. Die Oberflaeche liess es zu und schwieg.
 */
export function expectedAuthorityKinds(writer: TargetWriter): string[] | null {
  switch (writer.kind) {
    case 'eventplace': return ['place']
    case 'activity': return writer.agentType === 'CorporateBody' ? ['corporate'] : ['person']
    case 'named': return ['genre', 'subject']
    case 'subject': return kindsForClass(writer.className)
    default: return null // Kennungs-Ziele nehmen jede Art auf
  }
}

function kindsForClass(className: string): string[] | null {
  switch (className) {
    case 'GeographicName': return ['place']
    case 'Agent': return ['person', 'corporate']
    case 'Genre': return ['genre', 'subject']
    case 'Subject': return ['subject', 'genre']
    case 'WorkVariant': return ['work']
    default: return null
  }
}

/** Lesbarer Name einer Normdatenart fuer Meldungen. */
export function authorityKindLabel(kind: string): string {
  switch (kind) {
    case 'person': return 'Person'
    case 'corporate': return 'Koerperschaft'
    case 'place': return 'Ort'
    case 'genre': return 'Genre'
    case 'subject': return 'Schlagwort'
    case 'work': return 'Werk'
    default: return kind
  }
}

export function levelLabel(level: TargetLevel): string {
  switch (level) {
    case 'work': return 'Werk'
    case 'manifestation': return 'Manifestation'
    case 'item': return 'Exemplar'
    default: return level
  }
}

/* --------------------------------------------------------------- Katalog */

/** Taetigkeiten, die als Ziel angeboten werden: Schluessel -> [Kategorie, Typ, Label]. */
const ACTIVITIES: ReadonlyArray<readonly [string, string, string, string]> = [
  ['directing', 'avefi:DirectingActivity', 'Director', 'Regie'],
  ['writing', 'avefi:WritingActivity', 'Writer', 'Drehbuch'],
  ['cinematography', 'avefi:CinematographyActivity', 'Cinematographer', 'Kamera'],
  ['editing', 'avefi:EditingActivity', 'FilmEditor', 'Schnitt'],
  ['music', 'avefi:MusicActivity', 'Composer', 'Musik'],
  ['sound', 'avefi:SoundActivity', 'SoundDesigner', 'Ton'],
  ['producing', 'avefi:ProducingActivity', 'Producer', 'Produktion'],
  ['company', 'avefi:ProducingActivity', 'ProductionCompany', 'Produktionsfirma'],
  ['cast', 'avefi:CastActivity', 'CastMember', 'Darstellung'],
  ['design', 'avefi:ProductionDesignActivity', 'ProductionDesigner', 'Ausstattung'],
  ['animation', 'avefi:AnimationActivity', 'Animator', 'Animation']
]

/**
 * Traegerklassen fuer has_format: Klasse -> [Schluesselteil, Label].
 *
 * Der Name der Werteliste folgt der Klasse — Film gehoert zu
 * FormatFilmTypeEnum —, deshalb steht sie hier nicht noch einmal daneben.
 */
const ITEM_FORMATS: ReadonlyArray<readonly [string, string, string]> = [
  ['Film', 'film', 'Film (16mm, 35mm …)'],
  ['Video', 'video', 'Videoband (BetacamSP, VHS …)'],
  ['Audio', 'audio', 'Tontraeger (Magnetton, Audiokassette …)'],
  ['Optical', 'optical', 'Optischer Datentraeger (DVD, Blu-ray …)'],
  ['DigitalFile', 'digitalfile', 'Datei (MXF, MP4, DPX …)'],
  ['DigitalFileEncoding', 'encoding', 'Kodierung der Datei (MPEG4, Quicktime …)']
]

/** Normdaten-Verknuepfungen auf Werkebene: Resource-Typ -> Label. */
const WORK_SAME_AS: ReadonlyArray<readonly [string, string]> = [
  ['GNDResource', 'GND'],
  ['WikidataResource', 'Wikidata'],
  ['VIAFResource', 'VIAF'],
  ['FilmportalResource', 'filmportal.de'],
  ['EIDRResource', 'EIDR']
]

function entry(
  key: string,
  label: string,
  level: TargetLevel,
  group: string,
  type: TargetType,
  multi: boolean,
  writer: TargetWriter,
  description?: string
): TargetDefinition {
  return {
    key,
    label,
    level,
    group,
    type,
    multi,
    // Zweistufig: Ebene und Feld. Die Gruppe bleibt als Sortierschluessel
    // erhalten, steht aber in keinem angezeigten Text mehr. Sie hat im Schema
    // keine Entsprechung, und wo sie eine vorgab, war sie irrefuehrend:
    // "Werk › Werk › Form" nannte eine Ebene, die es nicht gibt, und
    // "Exemplar › Technik › Farbe" eine, die sich niemand erklaeren konnte.
    // Der echte Schemapfad steht ohnehin daneben.
    path: `${levelLabel(level)} › ${label}`,
    writer,
    acceptsAuthority: writerAcceptsAuthority(writer),
    ...(description !== undefined ? { description } : {})
  }
}

/* ------------------------------------------------------------------ Titel */

/*
 * TitleTypeEnum (FIAF Moving Image Cataloguing Manual A.2) kennt dreizehn
 * Typen. Sie verteilen sich auf zwei Schemaplaetze mit sehr verschiedenem
 * Verhalten.
 *
 * has_primary_title ist einwertig und am Werk Pflicht. Welcher Typ dort stehen
 * darf, sagt die Schemabeschreibung: PreferredTitle am Werk, TitleProper an
 * Manifestation und Exemplar, und wo keiner von beiden vorliegt, stattdessen
 * SuppliedDevisedTitle. Formal erzwungen ist das nicht — has_primary_title ist
 * schlicht ein Title, und efi-conv check liesse auch einen Arbeitstitel durch.
 * Der Katalog haelt sich trotzdem daran, und zwar aus einem praktischen Grund:
 * Beim Bauen gewinnt der erste Titel, spaetere ueberschreiben nicht. Dreizehn
 * Ziele auf einem einwertigen Platz hiesse, dass zwoelf davon je nach
 * Reihenfolge im Profil stillschweigend verschwinden.
 *
 * has_alternative_title ist mehrwertig. Dort passen alle uebrigen Typen
 * nebeneinander, ohne sich zu verdraengen.
 */

/** Primaertitel je Ebene: Typ laut Schemabeschreibung, dazu die Beschriftung. */
const PRIMARY_TITLE: Record<TargetLevel, readonly [string, string]> = {
  work: ['PreferredTitle', 'Haupttitel'],
  manifestation: ['TitleProper', 'Titel der Manifestation'],
  item: ['TitleProper', 'Titel des Exemplars']
}

/**
 * Der Ersatzplatz, wenn der Film keinen eigenen Titel traegt.
 *
 * Beschriftet als "Archivtitel", nicht als "Gelieferter/Entworfener Titel".
 * Die Katalogbeschriftungen sind unsere, die Enum-Beschriftungen sind AVefis;
 * hier zaehlt das Wort, das eine Filmarchivarin benutzt.
 */
const SUPPLIED_TITLE: Record<TargetLevel, string> = {
  work: 'Archivtitel',
  manifestation: 'Archivtitel der Manifestation',
  item: 'Archivtitel des Exemplars'
}

/** Schluesselteil, Typ und Beschriftung der mehrwertigen Titeltypen. */
const ALTERNATIVE_TITLES: ReadonlyArray<readonly [string, string, string]> = [
  ['alternative', 'AlternativeTitle', 'Weiterer Titel'],
  ['series', 'SeriesTitle', 'Reihentitel'],
  ['working', 'WorkingTitle', 'Arbeitstitel'],
  ['translated', 'TranslatedTitle', 'Uebersetzter Titel'],
  ['transliterated', 'TransliteratedTitle', 'Transliterierter Titel'],
  ['abbreviated', 'AbbreviatedTitle', 'Abgekuerzter Titel'],
  ['acquisition', 'AcquisitionTitle', 'Uebernahmetitel'],
  ['corrected', 'CorrectedTitle', 'Korrigierter Titel'],
  ['prerelease', 'PreReleaseTitle', 'Titel vor der Veroeffentlichung'],
  ['search', 'SearchTitle', 'Suchtitel']
]

/** Alle Titelziele einer Ebene: zwei einwertige, zehn mehrwertige. */
function titleTargets(level: TargetLevel): TargetDefinition[] {
  const [primaryType, primaryLabel] = PRIMARY_TITLE[level]
  const out: TargetDefinition[] = [
    entry(`${level}.title.primary`, primaryLabel, level, 'Titel', 'text', false,
      { kind: 'title', titleType: primaryType, primary: true }),
    entry(`${level}.title.supplied`, SUPPLIED_TITLE[level], level, 'Titel', 'text', false,
      { kind: 'title', titleType: 'SuppliedDevisedTitle', primary: true },
      'Vom Archiv vergebener Titel fuer einen Film, der keinen eigenen traegt.')
  ]
  for (const [part, titleType, label] of ALTERNATIVE_TITLES) {
    out.push(entry(`${level}.title.${part}`, label, level, 'Titel', 'text', true,
      { kind: 'title', titleType, primary: false }))
  }
  return out
}

function buildCatalog(): Map<string, TargetDefinition> {
  const list: TargetDefinition[] = []

  /* ---------------- Werk ---------------- */
  list.push(...titleTargets('work'))

  list.push(entry('work.type', 'Werkart', 'work', 'Werk', 'enum:WorkVariantTypeEnum', false,
    { kind: 'prop', prop: 'type' }))
  list.push(entry('work.variant_type', 'Variantentyp', 'work', 'Werk', 'enum:VariantTypeEnum', false,
    { kind: 'prop', prop: 'variant_type' }))
  list.push(entry('work.form', 'Form (Dokumentarfilm, Kurzfilm …)', 'work', 'Werk', 'enum:WorkFormEnum', true,
    { kind: 'strlist', prop: 'has_form' }))
  list.push(entry('work.genre', 'Genre', 'work', 'Werk', 'text', true,
    { kind: 'named', prop: 'has_genre', className: 'Genre' }))

  list.push(entry('work.production.date', 'Produktionsjahr / -datum', 'work', 'Produktion', 'date', false,
    { kind: 'eventdate', category: 'avefi:ProductionEvent' }))
  list.push(entry('work.production.place', 'Produktionsland / -ort', 'work', 'Produktion', 'text', true,
    { kind: 'eventplace', category: 'avefi:ProductionEvent' }))

  for (const [key, category, type, label] of ACTIVITIES) {
    list.push(entry(`work.activity.${key}`, label, 'work', 'Beteiligte', 'text', true,
      { kind: 'activity', category, type, agentType: key === 'company' ? 'CorporateBody' : 'Person' }))
  }

  list.push(entry('work.subject.topic', 'Schlagwort', 'work', 'Erschliessung', 'text', true,
    { kind: 'subject', className: 'Subject' }))
  list.push(entry('work.subject.person', 'Person (Thema)', 'work', 'Erschliessung', 'text', true,
    { kind: 'subject', className: 'Agent', agentType: 'Person' }))
  list.push(entry('work.subject.corporate', 'Koerperschaft (Thema)', 'work', 'Erschliessung', 'text', true,
    { kind: 'subject', className: 'Agent', agentType: 'CorporateBody' }))
  list.push(entry('work.subject.place', 'Ort (Thema)', 'work', 'Erschliessung', 'text', true,
    { kind: 'subject', className: 'GeographicName' }))

  list.push(entry('work.identifier.local', 'Lokale Werk-ID', 'work', 'Kennungen', 'id:LocalResource', true,
    { kind: 'identifier', resource: 'LocalResource' }))
  list.push(entry('work.identifier.avefi', 'AVefi-PID des Werks', 'work', 'Kennungen', 'id:AVefiResource', true,
    { kind: 'identifier', resource: 'AVefiResource' }))
  for (const [resource, label] of WORK_SAME_AS) {
    const short = resource.replace('Resource', '').toLowerCase()
    list.push(entry(`work.same_as.${short}`, `Verknuepfung ${label}`, 'work', 'Kennungen', `id:${resource}`, true,
      { kind: 'sameas', resource }))
  }

  /* ------------- Manifestation ------------- */
  list.push(...titleTargets('manifestation'))
  list.push(entry('manifestation.publication.date', 'Veroeffentlichungsdatum', 'manifestation', 'Manifestation', 'date', false,
    { kind: 'eventdate', category: 'avefi:PublicationEvent', type: 'ReleaseEvent' }))
  list.push(entry('manifestation.note', 'Anmerkung zur Manifestation', 'manifestation', 'Manifestation', 'text', true,
    { kind: 'strlist', prop: 'has_note' }))
  list.push(entry('manifestation.webresource', 'Weblink zur Manifestation', 'manifestation', 'Manifestation', 'text', true,
    { kind: 'strlist', prop: 'has_webresource' }))
  list.push(entry('manifestation.identifier.local', 'Lokale Manifestations-ID', 'manifestation', 'Manifestation', 'id:LocalResource', true,
    { kind: 'identifier', resource: 'LocalResource' }))

  /* ---------------- Exemplar ---------------- */
  list.push(...titleTargets('item'))
  list.push(entry('item.identifier.local', 'Signatur / lokale Exemplar-ID', 'item', 'Exemplar', 'id:LocalResource', true,
    { kind: 'identifier', resource: 'LocalResource' }))
  list.push(entry('item.identifier.avefi', 'AVefi-PID des Exemplars', 'item', 'Exemplar', 'id:AVefiResource', true,
    { kind: 'identifier', resource: 'AVefiResource' }))
  list.push(entry('item.element_type', 'Elementart (Negativ, Positiv, DCP …)', 'item', 'Technik', 'enum:ItemElementTypeEnum', false,
    { kind: 'prop', prop: 'element_type' }))
  list.push(entry('item.colour_type', 'Farbe', 'item', 'Technik', 'enum:ColourTypeEnum', false,
    { kind: 'prop', prop: 'has_colour_type' }))
  list.push(entry('item.sound_type', 'Ton', 'item', 'Technik', 'enum:SoundTypeEnum', false,
    { kind: 'prop', prop: 'has_sound_type' }))
  list.push(entry('item.frame_rate', 'Bildfrequenz', 'item', 'Technik', 'enum:FrameRateEnum', false,
    { kind: 'prop', prop: 'has_frame_rate' }))
  list.push(entry('item.access_status', 'Zugangsstatus', 'item', 'Technik', 'enum:ItemAccessStatusEnum', false,
    { kind: 'prop', prop: 'has_access_status' }))
  list.push(entry('item.duration', 'Laufzeit', 'item', 'Technik', 'duration', false,
    { kind: 'duration' }))
  list.push(entry('item.extent.metre', 'Laenge in Metern', 'item', 'Technik', 'number', false,
    { kind: 'extent', unit: 'Metre' }))
  list.push(entry('item.extent.feet', 'Laenge in Fuss', 'item', 'Technik', 'number', false,
    { kind: 'extent', unit: 'Feet' }))

  for (const [className, key, label] of ITEM_FORMATS) {
    list.push(entry(`item.format.${key}`, label, 'item', 'Format', `enum:Format${className}TypeEnum`, true,
      { kind: 'format', className },
      'Traeger oder Datei, auf der das Exemplar vorliegt.'))
  }
  // Fuer Spalten, in denen die Klassen gemischt stehen: "VHS + DVD + digitale
  // Datei". Die Einzelziele bleiben, bestehende Profile laufen weiter (#28).
  list.push(entry('item.format.any', 'Format (alle Traegerklassen)', 'item', 'Format', 'format', true,
    { kind: 'format', className: '' },
    'Traeger oder Datei, auch gemischt: Film, Video, Ton, optischer Datentraeger, Datei, Kodierung.'))

  list.push(entry('item.language.spoken', 'Sprache (gesprochen)', 'item', 'Sprache', 'lang', true,
    { kind: 'language', usage: 'SpokenLanguage' }))
  list.push(entry('item.language.subtitles', 'Sprache (Untertitel)', 'item', 'Sprache', 'lang', true,
    { kind: 'language', usage: 'Subtitles' }))
  list.push(entry('item.language.intertitles', 'Sprache (Zwischentitel)', 'item', 'Sprache', 'lang', true,
    { kind: 'language', usage: 'Intertitles' }))

  list.push(entry('item.note', 'Anmerkung zum Exemplar', 'item', 'Exemplar', 'text', true,
    { kind: 'strlist', prop: 'has_note' }))
  list.push(entry('item.webresource', 'Weblink zum Exemplar', 'item', 'Exemplar', 'text', true,
    { kind: 'strlist', prop: 'has_webresource' }))
  list.push(entry('item.preservation.date', 'Datum der Erhaltungsmassnahme', 'item', 'Exemplar', 'date', false,
    { kind: 'eventdate', category: 'avefi:PreservationEvent' }))
  list.push(entry('item.manufacture.date', 'Herstellungsdatum der Kopie', 'item', 'Exemplar', 'date', false,
    { kind: 'eventdate', category: 'avefi:ManufactureEvent' }))

  const map = new Map<string, TargetDefinition>()
  for (const e of list) map.set(e.key, e)
  return map
}

const CATALOG = buildCatalog()

export function allTargets(): TargetDefinition[] {
  return [...CATALOG.values()]
}

export function getTarget(key: string): TargetDefinition | undefined {
  return CATALOG.get(key)
}

export function targetExists(key: string): boolean {
  return CATALOG.has(key)
}

/**
 * Katalog fuer die Oberflaeche: ohne Bauanleitung, dafuer mit aufgeloesten
 * Enum-Werten und Mustern — die Oberflaeche soll Wertelisten anbieten koennen.
 */
export function targetsForFrontend(schema: SchemaModel = getSchemaModel()): TargetEntry[] {
  return allTargets().map((def) => {
    const { writer: _writer, ...rest } = def
    const out: TargetEntry = { ...rest }
    if (def.type.startsWith('enum:')) {
      const values = schema.enum(def.type.slice(5))
      if (values.length > 0) out.enumValues = values
    } else if (def.type === 'format') {
      const values = alleFormatwerte((name) => schema.enum(name))
      if (values.length > 0) out.enumValues = values
    } else if (def.type === 'lang') {
      const values = schema.enum('LanguageCodeEnum')
      if (values.length > 0) out.enumValues = values
    } else if (def.type.startsWith('id:')) {
      const pattern = schema.resourceIdPattern(def.type.slice(3))
      if (pattern !== null) out.pattern = pattern
    }
    return out
  })
}

/**
 * Erwarteter Kettentyp eines Ziels fuer die statische Pruefung: "number"
 * verlangt eine Zahl, alles andere einen Text bzw. eine Liste davon.
 */
export function expectedChainType(target: TargetDefinition): 'text' | 'number' {
  return target.type === 'number' ? 'number' : 'text'
}

/**
 * Prueft einen fertigen Wert gegen die Beschraenkung des Ziels (Enum, Muster,
 * Format). Leere Werte gelten als in Ordnung — ob ein Feld fehlen darf, ist eine
 * Frage der Vollstaendigkeit, nicht der Gueltigkeit.
 */
export function validateTargetValue(
  target: TargetDefinition,
  value: unknown,
  schema: SchemaModel = getSchemaModel()
): MappingMessage[] {
  const v = typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
    ? String(value).trim()
    : ''
  if (v === '') return []

  const type = target.type

  if (type.startsWith('enum:')) {
    const values = schema.enum(type.slice(5))
    if (values.length > 0 && !values.includes(v)) {
      return [meldung('target.valueNotAllowed', { wert: v, ziel: target.label })]
    }
    return []
  }

  if (type === 'format') {
    const k = klaereFormat(v, (name) => schema.enum(name))
    if (k.ok) return []
    return k.grund === 'mehrdeutig'
      ? [meldung('target.formatAmbiguous', { wert: v, klassen: k.klassen.join(', ') })]
      : [meldung('target.valueNotAllowed', { wert: v, ziel: target.label })]
  }

  if (type.startsWith('id:')) {
    const pattern = schema.resourceIdPattern(type.slice(3))
    if (pattern !== null) {
      let re: RegExp | null = null
      try {
        re = new RegExp(pattern, 'u')
      } catch {
        re = null
      }
      if (re !== null && !re.test(v)) {
        return [meldung('target.identifierPattern', { wert: v, ziel: target.label })]
      }
    }
    return []
  }

  if (type === 'duration') {
    if (!/^PT\d{2,}H[0-5]\dM[0-5]\dS$/.test(v)) {
      return [meldung('target.badDuration', { wert: v })]
    }
    return []
  }

  if (type === 'date') {
    if (!/^-?\d{4}(-\d{2}(-\d{2})?)?[?~]?$/.test(v)) {
      return [meldung('target.badDate', { wert: v })]
    }
    return []
  }

  if (type === 'number') {
    if (!Number.isFinite(Number(v))) return [meldung('target.notANumber', { wert: v })]
    return []
  }

  if (type === 'lang') {
    const codes = schema.enum('LanguageCodeEnum')
    if (codes.length > 0 && !codes.includes(v)) {
      return [meldung('target.badLanguage', { wert: v })]
    }
    return []
  }

  return []
}
