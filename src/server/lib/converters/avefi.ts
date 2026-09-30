/*
 * Aus der Zwischenform AVefi-Knoten bauen.
 *
 * Betrifft nur die Quellen ohne Mappingprofil (MARC-XML, EAD, generisches
 * JSON). Tabellen kommen ueber das Mappingprofil bereits fertig an.
 *
 * Grundsatz: Es wird nur gesetzt, was sich sicher zuordnen laesst. Alles
 * andere verschwindet nicht, sondern wird als Meldung in den Bericht
 * geschrieben — mit Quellfeld, Wert und dem Grund. Der Vertrag verlangt in
 * Paragraf 3, dass nicht konvertierbare Werte nachvollziehbar bleiben; still
 * verworfene Felder waeren genau das Gegenteil.
 */
import type { ValidationIssue } from '#shared/types/domain'
import type { AvefiNode, CanonicalRecord, InternalRecord } from './types'

function localResource(id: string): AvefiNode {
  return { category: 'avefi:LocalResource', id }
}

/** Dauer in Minuten als ISO-8601-Zeitspanne, wie AVefi sie erwartet. */
export function isoDuration(minutes: number): string {
  const total = Math.max(0, Math.round(minutes))
  const h = Math.floor(total / 60)
  const m = total % 60
  return `PT${String(h).padStart(2, '0')}H${String(m).padStart(2, '0')}M00S`
}

export interface BuildResult {
  nodes: AvefiNode[]
  issues: ValidationIssue[]
}

/**
 * Baut WorkVariant, Manifestationen und Items eines Datensatzes.
 * `baseId` verknuepft die Knoten untereinander (r12_work, r12_manifestation …).
 */
export function buildFromInternal(record: InternalRecord, baseId: string, recordNumber: number): BuildResult {
  const issues: ValidationIssue[] = []
  const row = record.source.row
  const nodes: AvefiNode[] = []

  // `kind` waehlt den Satz in der Oberflaeche; der deutsche Satz ist der Rueckfall.
  const note = (
    severity: ValidationIssue['severity'], sourceField: string, message: string, value?: string,
    params: Record<string, string> = {}
  ): void => {
    issues.push({
      severity, message, sourceField, value, row, record: recordNumber, code: 'unmapped_field',
      params: { kind: sourceField, ...params }
    })
  }

  const w = record.work
  const workId = `${baseId}_work`
  const work: AvefiNode = {
    category: 'avefi:WorkVariant',
    type: 'Monographic',
    has_identifier: [localResource(workId)]
  }

  if (w.title !== null && w.title.trim() !== '') {
    work.has_primary_title = { has_name: w.title.trim(), type: 'PreferredTitle' }
  } else {
    issues.push({
      severity: 'error',
      message: 'Der Datensatz hat keinen Titel. AVefi verlangt einen Haupttitel.',
      row,
      record: recordNumber,
      targetField: 'has_primary_title.has_name',
      code: 'missing_title'
    })
  }

  const alternatives = w.additionalTitles.map((t) => t.trim()).filter((t) => t !== '')
  if (alternatives.length > 0) {
    work.has_alternative_title = alternatives.map((t) => ({ has_name: t, type: 'AlternativeTitle' }))
  }

  const event: AvefiNode = { category: 'avefi:ProductionEvent' }
  let hasEvent = false
  if (w.year !== null) {
    event.has_date = String(w.year)
    hasEvent = true
  }
  if (w.country !== null && w.country.trim() !== '') {
    // Der Laendercode der Quelle ist nicht zwingend ISO 3166; er wandert als
    // Ortsangabe mit und wird nicht in ein Vokabular gepresst.
    event.located_in = [{ category: 'avefi:GeographicName', has_name: w.country.trim() }]
    hasEvent = true
  }
  if (hasEvent) work.has_event = [event]

  const subjects: AvefiNode[] = []
  if (w.genre !== null && w.genre.trim() !== '') {
    subjects.push({ category: 'avefi:Subject', has_name: w.genre.trim() })
  }
  if (subjects.length > 0) work.has_subject = subjects

  const notes: string[] = []
  if (w.description !== null && w.description.trim() !== '') notes.push(w.description.trim())
  if (notes.length > 0) work.has_note = notes

  // Felder ohne sichere Entsprechung: melden statt verwerfen.
  if (w.language !== null && w.language.trim() !== '') {
    note('info', 'language', 'Die Sprachangabe wurde nicht uebernommen: Ohne Mappingprofil ist nicht entscheidbar, ob sie die Sprache der Manifestation oder die der Untertitel meint.', w.language)
  }
  if (w.workType !== null && w.workType.trim() !== '') {
    note('info', 'work_type', 'Die Werkart wurde nicht uebernommen: Sie muss auf ein AVefi-Vokabular abgebildet werden, wofuer ein Mappingprofil noetig ist.', w.workType)
  }
  for (const c of w.contributors) {
    if (c.name.trim() === '') continue
    note('info', 'contributor', `Die Beteiligung „${c.role}“ wurde nicht uebernommen: Die Rolle muss auf ein AVefi-Vokabular abgebildet werden.`, c.name, { role: c.role })
  }

  nodes.push(work)

  record.manifestations.forEach((m, i) => {
    const manifestationId = `${baseId}_manifestation${record.manifestations.length > 1 ? i + 1 : ''}`
    const node: AvefiNode = {
      category: 'avefi:Manifestation',
      has_identifier: [localResource(manifestationId)],
      is_manifestation_of: [localResource(workId)]
    }
    const mNotes: string[] = []
    if (m.carrier !== undefined && m.carrier.trim() !== '') mNotes.push(m.carrier.trim())
    if (m.date !== undefined && m.date.trim() !== '') node.has_date = m.date.trim()
    if (m.durationMin !== undefined && Number.isFinite(m.durationMin)) {
      node.has_duration = { has_value: isoDuration(m.durationMin) }
    }
    if (mNotes.length > 0) node.has_note = mNotes
    nodes.push(node)
  })

  const firstManifestationId =
    record.manifestations.length > 0 ? `${baseId}_manifestation${record.manifestations.length > 1 ? 1 : ''}` : null

  record.items.forEach((it, i) => {
    const node: AvefiNode = {
      category: 'avefi:Item',
      has_identifier: [localResource(it.signature && it.signature.trim() !== '' ? it.signature.trim() : `${baseId}_item${i + 1}`)]
    }
    if (firstManifestationId !== null) node.is_item_of = localResource(firstManifestationId)
    else {
      issues.push({
        severity: 'warning',
        message: 'Zu diesem Exemplar gibt es keine Manifestation; die Zuordnung is_item_of bleibt leer.',
        row,
        record: recordNumber,
        targetField: 'is_item_of',
        code: 'item_without_manifestation'
      })
    }
    const iNotes: string[] = []
    if (it.location !== undefined && it.location.trim() !== '') iNotes.push(`Standort: ${it.location.trim()}`)
    if (iNotes.length > 0) node.has_note = iNotes
    if (it.holdingInstitution !== undefined && it.holdingInstitution.trim() !== '') {
      node.described_by = [{ has_issuer_name: it.holdingInstitution.trim() }]
    }
    nodes.push(node)
  })

  return { nodes, issues }
}

/** Zerlegt eine fertige AVefi-Struktur in die Knoten der Ausgabedatei. */
export function flattenCanonical(canonical: CanonicalRecord): AvefiNode[] {
  const out: AvefiNode[] = []
  if (canonical.work && Object.keys(canonical.work).length > 0) out.push(canonical.work)
  for (const m of canonical.manifestations ?? []) out.push(m)
  for (const i of canonical.items ?? []) out.push(i)
  return out
}

/** Anzeigefelder eines Datensatzes fuer die Listenspalten. */
export function workDisplay(work: AvefiNode | undefined): { title: string | null; year: number | null; type: string | null } {
  if (!work) return { title: null, year: null, type: null }
  const primary = work.has_primary_title as { has_name?: unknown } | undefined
  const title = primary && primary.has_name !== undefined ? String(primary.has_name) : null

  let year: number | null = null
  const events = work.has_event
  if (Array.isArray(events)) {
    for (const e of events) {
      const date = (e as Record<string, unknown>).has_date
      if (typeof date === 'string') {
        const m = /(\d{4})/.exec(date)
        if (m && m[1]) {
          year = Number(m[1])
          break
        }
      }
    }
  }
  const type = typeof work.type === 'string' ? work.type : null
  return { title, year, type }
}

/**
 * Grobe Vollstaendigkeit eines Datensatzes in Prozent. Gewichtet die Felder,
 * die AVefi fuer eine brauchbare Meldung braucht.
 */
export function completeness(nodes: readonly AvefiNode[]): number {
  const work = nodes.find((n) => n.category === 'avefi:WorkVariant')
  if (!work) return 0
  const checks: boolean[] = [
    Boolean((work.has_primary_title as { has_name?: unknown } | undefined)?.has_name),
    Array.isArray(work.has_identifier) && work.has_identifier.length > 0,
    Array.isArray(work.has_event) && work.has_event.length > 0,
    nodes.some((n) => n.category === 'avefi:Manifestation'),
    nodes.some((n) => n.category === 'avefi:Item')
  ]
  return Math.round((checks.filter(Boolean).length / checks.length) * 100)
}
