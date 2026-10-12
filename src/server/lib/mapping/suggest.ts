/*
 * MappingSuggest — Vorschlaege, welches Ziel zu einer Quellspalte passt.
 *
 * Nachfolger der Heuristik aus RecordMapper::classify, mit zwei Korrekturen:
 *
 *  1. Verglichen wird auf Wortebene statt auf Teilstrings. Die alte Version
 *     prueft mit "enthaelt", wodurch "min" in "Administration" und "Termin"
 *     traf, "sign" in "Design" und "land" in "Landkreis".
 *  2. Es gewinnt nicht der erste Treffer, sondern der beste: jeder Vorschlag
 *     traegt einen Konfidenzwert, und die Oberflaeche zeigt die Alternativen.
 *
 * Vorschlaege werden nie automatisch uebernommen — sie sind vorausgefuellte
 * Auswahl, die ein Mensch bestaetigt.
 */

export interface TargetSuggestion {
  target: string
  /** Konfidenz zwischen 0 und 100. */
  score: number
}

/** Ziel -> Schluesselwoerter, bereits in der Vergleichsform (Umlaute aufgeloest). */
const KEYWORDS: Record<string, readonly string[]> = {
  'work.title.primary': ['titel', 'haupttitel', 'originaltitel', 'filmtitel', 'title', 'werktitel'],
  'work.title.alternative': ['alternativtitel', 'nebentitel', 'untertitel', 'verleihtitel', 'subtitle',
    'alttitel', 'diverse', 'weitere', 'sonstige', 'zusatztitel'],
  'work.title.series': ['reihe', 'reihentitel', 'serie', 'serientitel', 'series'],
  // Die uebrigen Titeltypen. Ihre Schluesselwoerter tragen die
  // zusammengeschriebene Form, weil "Arbeitstitel" ein einziges Wort ist:
  // scoreToken verwirft Treffer mitten im Wort, ein Schluesselwort "arbeits"
  // allein faende die Spalte also nie.
  'work.title.working': ['arbeitstitel', 'workingtitle'],
  'work.title.translated': ['uebersetztertitel', 'uebersetzt', 'uebersetzung', 'englischertitel',
    'translatedtitle', 'fremdsprachigertitel'],
  // Transliteration ist Zeichen-fuer-Zeichen zwischen Schriftsystemen,
  // Transkription die lautliche Wiedergabe. Der Katalog des Verbunds sagt
  // "Transliterierter Titel"; die transkribierte Form bleibt als Schluesselwort
  // stehen, weil Haeuser sie in Spaltennamen benutzen.
  'work.title.transliterated': ['transliteriertertitel', 'transliteriert', 'transkribiertertitel',
    'transkribiert', 'transliteratedtitle', 'umschrift'],
  'work.title.abbreviated': ['abgekuerztertitel', 'abkuerzung', 'kurztitel', 'abbreviatedtitle'],
  'work.title.acquisition': ['uebernahmetitel', 'erwerbstitel', 'erwerbungstitel', 'acquisitiontitle'],
  'work.title.corrected': ['korrigiertertitel', 'korrekturtitel', 'correctedtitle'],
  'work.title.prerelease': ['vorabtitel', 'prereleasetitle'],
  'work.title.search': ['suchtitel', 'searchtitle'],
  'work.production.date': ['jahr', 'year', 'produktionsjahr', 'entstehungsjahr', 'entstehung',
    'produktionsdatum', 'datierung', 'herstellungsjahr', 'erscheinungsjahr'],
  'work.production.place': ['land', 'produktionsland', 'herstellungsland', 'country', 'produktionsort', 'drehort'],
  'work.activity.directing': ['regie', 'regisseur', 'regisseurin', 'director', 'regiefuehrung'],
  'work.activity.writing': ['drehbuch', 'buch', 'autor', 'autorin', 'screenplay', 'writer', 'skript'],
  'work.activity.cinematography': ['kamera', 'kameramann', 'kamerafrau', 'bildgestaltung', 'camera', 'cinematography'],
  'work.activity.editing': ['schnitt', 'montage', 'editor', 'editing'],
  'work.activity.music': ['musik', 'komponist', 'komponistin', 'music', 'composer'],
  'work.activity.sound': ['ton', 'tongestaltung', 'sound'],
  'work.activity.producing': ['produzent', 'produzentin', 'producer', 'produktionsleitung'],
  'work.activity.company': ['produktionsfirma', 'produktion', 'herstellungsfirma', 'firma', 'studio',
    'produktionsgesellschaft'],
  'work.activity.cast': ['darsteller', 'darstellerin', 'besetzung', 'mitwirkende', 'cast', 'rolle'],
  'work.genre': ['genre', 'gattung'],
  'work.form': ['form', 'werkart', 'filmart', 'art', 'kategorie', 'filmgattung'],
  'work.subject.topic': ['schlagwort', 'schlagworte', 'stichwort', 'thema', 'sachbegriff', 'keywords',
    'verschlagwortung'],
  'work.subject.person': ['personen', 'beteiligte personen'],
  'work.subject.place': ['ort', 'orte', 'geografikum', 'schauplatz'],
  'work.identifier.local': ['werkid', 'werknummer', 'filmid', 'filmnummer'],
  'work.same_as.gnd': ['gnd', 'gndid', 'gndnummer'],
  'work.same_as.wikidata': ['wikidata', 'qid'],
  'work.same_as.filmportal': ['filmportal'],

  'manifestation.publication.date': ['urauffuehrung', 'premiere', 'veroeffentlichung', 'erstauffuehrung', 'release'],
  'manifestation.note': ['fassung', 'fassungsanmerkung'],
  'manifestation.webresource': ['link', 'url', 'weblink', 'permalink', 'onlineressource'],

  'item.identifier.local': ['signatur', 'sign', 'inventarnummer', 'inventar', 'objektnummer',
    'archivnummer', 'kennung', 'barcode', 'nummer', 'id'],
  'item.element_type': ['element', 'elementart', 'materialart', 'kopienart', 'kopietyp', 'traeger',
    'traegermaterial', 'material'],
  'item.colour_type': ['farbe', 'farbigkeit', 'colour', 'color', 'sw'],
  'item.sound_type': ['tonart', 'tonformat', 'tontechnik', 'tonsystem', 'stumm', 'lichtton'],
  'item.frame_rate': ['bildfrequenz', 'framerate', 'bilder'],
  'item.access_status': ['zugang', 'zugangsstatus', 'status', 'benutzung'],
  'item.duration': ['laufzeit', 'dauer', 'laenge', 'spieldauer', 'duration', 'minuten', 'spielzeit'],
  'item.extent.metre': ['meter', 'laengem', 'filmlaenge', 'konfektionierung'],
  'item.extent.feet': ['fuss', 'feet', 'ft'],
  // "Format" allein nennt keine Traegerklasse; in Bestandsdaten stehen unter
  // diesem Kopf Film, Video und Datei gemischt (#28). Das gemeinsame Ziel nimmt
  // jede Klasse, das Filmziel nur Filmformate.
  'item.format.any': ['format', 'formate', 'traegerformat', 'medium', 'medien'],
  'item.format.film': ['filmformat', 'bildformat', 'formatfilm', 'gauge'],
  'item.format.video': ['videoformat', 'video', 'band', 'videoband', 'kassette'],
  'item.format.audio': ['tontraeger', 'audioformat', 'magnetton'],
  'item.format.optical': ['datentraeger', 'disc', 'scheibe'],
  'item.format.digitalfile': ['datei', 'dateiformat', 'container', 'wrapper'],
  'item.format.encoding': ['kodierung', 'codec', 'encoding', 'komprimierung'],
  'item.language.spoken': ['sprache', 'sprachfassung', 'language', 'originalsprache'],
  'item.language.subtitles': ['untertitelsprache', 'untertitel', 'subtitles'],
  'item.language.intertitles': ['zwischentitel', 'intertitles'],
  'item.note': ['bemerkung', 'bemerkungen', 'anmerkung', 'notiz', 'kommentar', 'beschreibung',
    'inhalt', 'zustand', 'standort', 'lagerort', 'regal', 'synchronisiert', 'akte', 'rollen',
    'bildformat', 'ausgeliehen'],
  'item.webresource': ['digitalisat', 'digitalisatlink']
}

/** Woerter, die einen Titel als Nebenform kennzeichnen. */
const TITLE_QUALIFIERS: readonly string[] = ['diverse', 'weitere', 'sonstige', 'neben', 'alternativ',
  'alternative', 'verleih', 'zusatz', 'unter', 'arbeits', 'serien', 'reihen', 'original',
  // Nachgetragen am 08.09.2026 zusammen mit den uebrigen Titeltypen. Ohne sie
  // bekam eine Spalte "Uebersetzter Titel" den Haupttitel mit voller Konfidenz
  // vorgeschlagen: Der Qualifier stand nicht in dieser Liste, die Abwertung
  // griff nicht, und "titel" traf work.title.primary mit 100. Wer den
  // Vorschlag uebernahm, schrieb einen uebersetzten Titel als bevorzugten
  // Titel ins Pflichtfeld.
  'uebersetzt', 'transkribiert', 'transliteriert', 'abgekuerzt', 'abkuerzung', 'kurz',
  'erwerb', 'uebernahme', 'korrigiert', 'korrektur', 'such', 'vorab', 'englisch', 'fremdsprachig',
  'umschrift']

/**
 * Bewertet ein Wort gegen ein Schluesselwort.
 *   100 = gleich
 *    70 = das Wort beginnt mit dem Schluesselwort ("Signatur" zu "sign")
 *    50 = das Schluesselwort beginnt mit dem Wort
 * Treffer mitten im Wort zaehlen nicht — genau daher kam "Design" zu "Signatur".
 */
export function scoreToken(token: string, keyword: string): number {
  if (token === keyword) return 100
  if (keyword.length < 4 || token.length < 4) return 0
  if (token.startsWith(keyword)) return 70
  if (keyword.startsWith(token)) return 50
  return 0
}

/** Kopfzeile in Vergleichswoerter zerlegen (Umlaute aufgeloest, Zaehlzusatz weg). */
export function tokens(header: string): string[] {
  let h = header.trim().toLowerCase()
  h = h.replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
  h = h.replace(/\(\d+\)\s*$/, '') // "Titel (2)" ist immer noch ein Titel
  const parts = h.split(/[^a-z0-9_]+/).filter((p) => p !== '')
  // Ein Feldname wie has_colour_type ist ein Wort; seine Teile sind aber auch
  // welche, sonst faende "Farbe" ihn nicht mehr.
  for (const p of [...parts]) {
    if (p.includes('_')) parts.push(...p.split('_').filter((x) => x !== ''))
  }
  // Zusammengeschrieben mitpruefen: "Entst Jahr" auch als "entstjahr".
  if (parts.length > 1) parts.push(parts.join(''))
  return parts
}

function hasQualifier(parts: readonly string[]): boolean {
  for (const t of parts) {
    if (t === 'titel' || t === 'title') continue
    for (const q of TITLE_QUALIFIERS) {
      if (t === q || t.startsWith(q)) return q !== 'original' // Originaltitel bleibt Haupttitel
    }
  }
  return false
}

/**
 * Woerter, mit denen eine Kopfzeile die Ebene selbst nennt.
 *
 * Anlass: eine Spalte hiess "category: avefi:Item has_format" und bekam
 * "Werk › Form" vorgeschlagen, weil "format" mit dem Stichwort "form" beginnt.
 * Die Kopfzeile sagte zweimal, dass ein Exemplar gemeint ist, und beides wurde
 * nicht gelesen.
 */
const LEVEL_WORDS: Record<string, string> = {
  item: 'item', exemplar: 'item', copy: 'item',
  manifestation: 'manifestation', fassung: 'manifestation',
  work: 'work', werk: 'work', workvariant: 'work'
}

/** Nennt die Kopfzeile eine Ebene ausdruecklich? */
export function levelInHeader(parts: readonly string[]): string | null {
  for (const t of parts) {
    const level = LEVEL_WORDS[t]
    if (level !== undefined) return level
  }
  return null
}

/**
 * Schemafeldname -> Ziel, fuer Kopfzeilen, die ihre eigenen Feldnamen
 * mitliefern. Nennt eine Spalte das Feld beim Namen, ist das keine
 * Wortaehnlichkeit mehr, sondern eine Angabe — sie schlaegt jeden anderen
 * Treffer.
 *
 * Nur eindeutige Felder stehen hier. `has_format` fehlt mit Absicht: es
 * verteilt sich im Schema auf sechs Traegerklassen, und welche gemeint ist,
 * sagt der Feldname nicht. Dafuer sorgen die Stichwoerter und die Ebene.
 */
const SCHEMA_FIELDS: Record<string, string> = {
  has_colour_type: 'item.colour_type',
  has_sound_type: 'item.sound_type',
  has_frame_rate: 'item.frame_rate',
  has_access_status: 'item.access_status',
  element_type: 'item.element_type',
  has_duration: 'item.duration',
  has_form: 'work.form',
  has_genre: 'work.genre',
  variant_type: 'work.variant_type',
  has_webresource: 'item.webresource',
  has_note: 'item.note'
}

/** Ebene eines Ziels, abgelesen am Schluessel. */
function levelOfTarget(key: string): string | null {
  const head = key.split('.')[0]
  return head === 'work' || head === 'manifestation' || head === 'item' ? head : null
}

/** Vorschlaege fuer eine Spalte, bester zuerst. */
export function suggestForColumn(header: string, limit = 3): TargetSuggestion[] {
  const parts = tokens(header)
  if (parts.length === 0) return []

  const scores = new Map<string, number>()
  for (const [target, words] of Object.entries(KEYWORDS)) {
    let best = 0
    for (const w of words) {
      for (const t of parts) {
        const s = scoreToken(t, w)
        if (s > best) best = s
      }
    }
    if (best > 0) scores.set(target, best)
  }
  // Das Schemafeld beim Namen genannt schlaegt jede Wortaehnlichkeit.
  for (const t of parts) {
    const target = SCHEMA_FIELDS[t]
    if (target !== undefined) scores.set(target, 120)
  }

  // Nennt die Kopfzeile die Ebene, wird alles von einer anderen Ebene
  // zurueckgestuft statt verworfen: die Angabe kann auch falsch sein, und ein
  // schwaecherer Vorschlag ist immer noch besser als keiner.
  const level = levelInHeader(parts)
  if (level !== null) {
    for (const [target, score] of [...scores]) {
      const t = levelOfTarget(target)
      if (t !== null && t !== level) scores.set(target, Math.round(score / 3))
    }
  }

  if (scores.size === 0) return []

  // "Diverse Titel" und "Untertitel" sind keine Haupttitel. Ohne diese Regel
  // gewinnt der Haupttitel ueberall, wo das Wort "Titel" vorkommt.
  if (scores.has('work.title.primary') && hasQualifier(parts)) {
    scores.set('work.title.primary', 40)
    // Der allgemeine Nebentitel wird nur dann hochgezogen, wenn kein
    // spezifischerer Titeltyp schon besser liegt. Sonst stuenden bei einer
    // Spalte "Arbeitstitel" zwei Vorschlaege nebeneinander — der richtige und
    // ein erzwungener Nebentitel —, und bei drei angezeigten Vorschlaegen
    // koennte der erzwungene den richtigen aus der Liste draengen.
    let spezifisch = 0
    for (const [key, score] of scores) {
      if (!key.startsWith('work.title.')) continue
      if (key === 'work.title.primary' || key === 'work.title.alternative') continue
      spezifisch = Math.max(spezifisch, score)
    }
    if (spezifisch < 90) {
      scores.set('work.title.alternative', Math.max(scores.get('work.title.alternative') ?? 0, 90))
    }
  }

  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([target, score]) => ({ target, score }))
}

/** Vorschlaege fuer alle Spalten. Spalten ohne Treffer fehlen im Ergebnis. */
export function suggestForColumns(columns: readonly string[], limit = 3): Record<string, TargetSuggestion[]> {
  const out: Record<string, TargetSuggestion[]> = {}
  for (const c of columns) {
    const s = suggestForColumn(c, limit)
    if (s.length > 0) out[c] = s
  }
  return out
}

/**
 * Spalten mit wenigen verschiedenen Werten sind Vokabularkandidaten: das
 * Ergebnis fuellt eine Werteliste vor, statt sie von Hand tippen zu lassen.
 * @param distinct Spalte -> Wert -> Haeufigkeit
 */
export function vocabularyCandidates(
  distinct: Record<string, Record<string, number>>,
  maxDistinct = 12
): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const [col, values] of Object.entries(distinct)) {
    const entries = Object.entries(values)
    if (entries.length === 0 || entries.length > maxDistinct) continue
    out[col] = entries.sort((a, b) => b[1] - a[1]).map(([v]) => v)
  }
  return out
}
