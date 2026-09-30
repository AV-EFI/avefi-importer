/*
 * Saetze aus Codes bauen, an einer Stelle.
 *
 * Server, Mappingkern und Pruefdienst schicken Codes und Bausteine (`params`),
 * dazu einen deutschen Satz als Rueckfall. Angezeigt werden sie an vielen
 * Stellen: Pruefbericht, zeilengenaue Diagnose, Zuordnungseditor, Zweigansicht,
 * Datensatzeditor. Bis zum 30.09.2026 baute nur ein Teil davon den Satz selbst;
 * der Pruefbericht zeigte `issue.message` roh, und die englische Oberflaeche
 * war dort deutsch (#10, Stefan Stretz am 29.09.). Jetzt geht jede Stelle
 * hierueber.
 *
 * Reihenfolge der Suche: zuerst die Variante nach `params.kind`
 * (`<code>__<kind>`), dann der Code selbst; zuerst im Bereich der Berichte,
 * dann in dem des Mappingkerns. Fehlt beides, gewinnt der mitgereiste deutsche
 * Satz. Ein Code in der Oberflaeche waere schlechter als ein Satz in der
 * falschen Sprache.
 */
import type { CompletenessHint, MappingMessage, ValidationIssue } from '#shared/types/domain'
import { BRAUCHT_BAUSTEINE } from '#shared/meldungscodes'
import type { MappingCheck } from '~/components/mapping/types'
import type { DiagnosticEntry } from '~/components/imports/types'

type Bausteine = Record<string, string | number>

/** Punkt und Bindestrich sind in Codes zulaessig, in i18n-Schluesseln nicht. */
export function codeSchluessel(code: string): string {
  return code.replace(/[.-]/g, '_')
}

const BERICHT = ['imports.issueText', 'mapping.checkMsg']

export interface Meldungstexte {
  meldung: (m: MappingMessage) => string
  hinweis: (h: CompletenessHint) => string
  befund: (issue: ValidationIssue) => string
  pruefung: (check: MappingCheck, zielname?: (key: string) => string) => string
  diagnose: (entry: DiagnosticEntry) => { text: string; hint: string }
}

type Uebersetzer = (key: string, named?: Record<string, unknown>, plural?: number) => string

export function useMeldungstext(): Meldungstexte {
  const { t, te } = useI18n()
  return meldungstexte(t as Uebersetzer, te)
}

/**
 * Dasselbe ohne Nuxt-Kontext, mit uebergebenem `t` und `te` — damit sich die
 * Satzbildung (Variante, Mehrzahl, Rueckfall) gegen die echten
 * Uebersetzungsdateien testen laesst (tests/frontend/meldungstext.test.ts).
 */
export function meldungstexte(tRoh: Uebersetzer, te: (key: string) => boolean): Meldungstexte {
  const t = (key: string, named: Record<string, unknown> = {}, plural?: number): string =>
    plural === undefined ? tRoh(key, named) : tRoh(key, named, plural)

  function satz(
    code: string | undefined, params: Bausteine, rueckfall: string, bereiche: readonly string[], mehrzahl = true
  ): string {
    if (code === undefined || code === '') return rueckfall
    const k = codeSchluessel(code)
    const kind = params['kind'] !== undefined ? codeSchluessel(String(params['kind'])) : null
    // `n` waehlt Einzahl oder Mehrzahl („in Zeile 5" / „in den Zeilen 5, 9").
    const plural = mehrzahl && typeof params['n'] === 'number' ? params['n'] : null
    for (const bereich of bereiche) {
      const kandidaten = kind !== null ? [`${bereich}.${k}__${kind}`, `${bereich}.${k}`] : [`${bereich}.${k}`]
      for (const key of kandidaten) {
        if (!te(key)) continue
        return plural !== null ? t(key, params, plural) : t(key, params)
      }
    }
    return rueckfall
  }

  function zielnameVorgabe(key: string): string {
    const i18nKey = `mapping.targets.${key}`
    return te(i18nKey) ? t(i18nKey) : key
  }

  function meldung(m: MappingMessage): string {
    const key = `mapping.checkMsg.${codeSchluessel(String(m.code))}`
    if (!te(key)) return m.text ?? m.code
    return t(key, { ...(m.params ?? {}) })
  }

  function hinweis(h: CompletenessHint): string {
    // hint.noItem -> records.hint.noItem
    const key = `records.${h.code}`
    return te(key) ? t(key) : h.text
  }

  /** Eine Beanstandung aus Pruefbericht, Pruefdienst oder Datensatzeditor. */
  function befund(issue: ValidationIssue): string {
    const code = issue.code ?? ''
    if (issue.params === undefined && BRAUCHT_BAUSTEINE.has(code)) return issue.message
    const p: Bausteine = {
      column: issue.sourceField ?? '',
      value: issue.value ?? '',
      ...(issue.params ?? {})
    }
    if (p['field'] === '') p['field'] = t('imports.issue.wholeRecord')
    const feldKey = p['feldKey']
    if (typeof feldKey === 'string' && te(`imports.issueField.${feldKey}`)) p['feld'] = t(`imports.issueField.${feldKey}`)

    if (code.startsWith('parse_')) {
      const d = diagnose({ code, params: issue.params, message: issue.message, hint: '' } as DiagnosticEntry)
      return d.text === issue.message ? issue.message : `${d.text} ${d.hint}`.trim()
    }

    const s = satz(code, p, issue.message, BERICHT)
    // Gebuendelte Hinweise tragen Zahl und Beispiele; der Rueckfall hat sie
    // schon im Satz, der uebersetzte bekommt sie angehaengt.
    const count = issue.params?.['count']
    if (s === issue.message || typeof count !== 'number') return s
    const beispiele = String(issue.params?.['beispiele'] ?? '')
    return [
      s,
      t('imports.issueText.betrifft', { count }, count),
      ...(beispiele !== '' ? [t('imports.issueText.beispiele', { beispiele })] : [])
    ].join(' ')
  }

  /** Eine Beanstandung des Zuordnungseditors (Checks, Zweigansicht). */
  function pruefung(check: MappingCheck, zielname: (key: string) => string = zielnameVorgabe): string {
    return satz(check.code, {
      field: check.targetField !== undefined ? zielname(check.targetField) : '',
      column: check.sourceField ?? '',
      value: check.value ?? '',
      n: check.count ?? 0,
      // Bausteine, die der Mappingkern mitschickt — ohne sie muesste der
      // deutsche Serversatz stehen bleiben.
      ...(check.params ?? {})
    }, check.message, ['mapping.checkMsg'], false)
  }

  /** Ein Befund der zeilengenauen Diagnose: Satz und Loesungshinweis. */
  function diagnose(entry: DiagnosticEntry): { text: string; hint: string } {
    const p: Bausteine = { ...(entry.params ?? {}) }
    if (p['delimiter'] === '\t') p['delimiter'] = t('imports.issue.tab')
    else if (typeof p['delimiter'] === 'string') p['delimiter'] = `„${p['delimiter']}“`
    const text = satz(entry.code, p, entry.message, ['imports.diagText'])
    const hintKey = entry.code ? `imports.diagHint.${codeSchluessel(entry.code)}` : ''
    const hint = hintKey !== '' && te(hintKey) ? t(hintKey, p) : entry.hint
    return { text, hint }
  }

  return { meldung, hinweis, befund, pruefung, diagnose }
}
