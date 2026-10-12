/*
 * Feldauskunft zu Beanstandungen — was ein Zielfeld bedeutet und was dort
 * stehen darf.
 *
 * Der Pruefbericht sagt heute, WAS beanstandet wird und WO. Er sagt nicht, wie
 * man es richtig macht: Wer nicht taeglich mit dem AVefi-Schema arbeitet, weiss
 * bei "„Betacam SP" ist kein zulaessiger Wert fuer „Optischer Datentraeger""
 * nicht, was stattdessen dort stuende — und schon gar nicht, dass die Spalte in
 * Wahrheit an ein anderes Ziel gehoert (#3, gewuenscht von Matti Stoehr).
 *
 * Neu erfunden wird dafuer nichts. Beschreibung und Werteliste stehen laengst
 * im Zielkatalog und im Schemamodell; sie standen nur an einer anderen Stelle
 * der Anwendung als die Beanstandung.
 *
 * Ausdruecklich eine Auskunft und kein Eingriff: Der Vertrag schliesst
 * automatische Korrektur aus. Hier wird gesagt, was zulaessig waere; gesetzt
 * wird nichts.
 */
import type { FieldHelp, ValidationIssue } from '#shared/types/domain'
import type { SchemaModel } from './mapping/index'
import { getTarget } from './mapping/index'
import { alleFormatwerte } from '#shared/formatklassen'

/**
 * Loest die in den Befunden vorkommenden Zielfelder auf.
 *
 * Aufgeloest wird nur, was tatsaechlich vorkommt. Alle 91 Definitionen an jeden
 * Bericht zu haengen waere ein Vielfaches der Nutzlast fuer eine Auskunft, die
 * fast nie gebraucht wird.
 *
 * Das Schemamodell wird hereingereicht, nicht hier geholt — dieselbe Regel wie
 * in server/lib/mapping/. Wer es holt, nimmt loadSchemaModel() und nicht
 * getSchemaModel(): Der Getter liefert nur, was ein anderer Teil der Anwendung
 * schon hinterlegt hat, und im frischen Prozess ist das nichts. Genau so fiel
 * beim Bauen die Werteliste lautlos weg.
 */
export function fieldHelpFor(
  issues: readonly ValidationIssue[],
  schema: SchemaModel
): Record<string, FieldHelp> {
  const raus: Record<string, FieldHelp> = {}
  for (const issue of issues) {
    const key = String(issue.targetField ?? '')
    if (key === '' || raus[key] !== undefined) continue
    const ziel = getTarget(key)
    // Nicht jedes targetField ist ein Zielschluessel: Die Schemapruefung meldet
    // auch blanke Slotnamen wie has_identifier. Zu denen gibt es hier nichts
    // aufzuloesen — ihr Hinweis haengt am Code und steht schon daneben.
    if (ziel === undefined) continue
    const werte = ziel.type.startsWith('enum:')
      ? schema.enum(ziel.type.slice(5))
      : ziel.type === 'format' ? alleFormatwerte((name) => schema.enum(name)) : []
    raus[key] = {
      label: ziel.label,
      description: ziel.description ?? null,
      values: werte.length > 0 ? werte : null
    }
  }
  return raus
}
