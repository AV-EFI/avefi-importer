/*
 * Codes, deren Satz ohne Bausteine (`params`) nicht zu bilden ist.
 *
 * Berichte, die vor dem 30.09.2026 entstanden sind, tragen zu diesen Codes noch
 * keine Bausteine. Ein uebersetzter Satz mit leeren Luecken („Die Kennung  ist
 * nicht eindeutig") waere schlechter als der mitgereiste deutsche Satz. Fuer
 * diese Codes bleibt es deshalb beim Rueckfall, solange `params` fehlt.
 */
export const BRAUCHT_BAUSTEINE: ReadonlySet<string> = new Set([
  'schema',
  'model_invalid',
  'identifier_not_unique',
  'dangling_reference',
  'no_items_associated',
  'unmapped_field',
  'issues_truncated',
  'merge.conflict',
  'identifier.duplicate'
])
