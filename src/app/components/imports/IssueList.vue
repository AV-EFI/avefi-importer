<script setup lang="ts">
/**
 * Fehler und Warnungen eines Imports — an einer Stelle.
 *
 * Im PHP-Stand standen Parse-Hinweise oben und Schemabefunde unten in einer
 * eigenen Tabelle; wer nur eine der beiden Listen las, uebersah die Haelfte.
 * Hier liegt alles in einer Liste, nach Schweregrad sortiert und filterbar.
 *
 * Jede Meldung nennt, soweit bekannt: Zeile der Quelldatei, laufende Nummer
 * des Pruefsatzes, Quellspalte und Schemafeld. Der Vertrag verlangt genau das.
 *
 * Zwei Angaben sind Sprungmarken, weil eine Beanstandung sonst nur beschreibt,
 * wo etwas klemmt, statt dorthin zu fuehren:
 *  - die Zeile fuehrt zum erzeugten Datensatz,
 *  - die Quellspalte fuehrt in die Zuordnung, mit geoeffneter Spalte.
 *
 * Der Loesungshinweis steht einmal je Code, beim ersten Befund. Bei zwanzig
 * gleichartigen Meldungen zwanzigmal denselben Satz zu wiederholen macht die
 * Liste laenger, aber nicht verstaendlicher.
 *
 * Daneben steht, ebenfalls einmal, die Auskunft zum betroffenen Feld: was es
 * bedeutet und welche Werte es annehmen darf (#3). Der Hinweis zum Code sagt,
 * was zu tun ist; die Feldauskunft sagt, womit. "\u201eBetacam SP\u201c ist kein
 * zulaessiger Wert fuer \u201eOptischer Datentraeger\u201c" wird erst dann zur
 * Handlungsanweisung, wenn daneben steht, dass dort DVD oder Blu-ray stuende
 * und Betacam SP an das Videoband gehoert.
 *
 * Beides ist Auskunft, kein Eingriff: Automatische Korrektur ist vertraglich
 * ausgeschlossen. Es wird gesagt, was zulaessig waere; gesetzt wird nichts.
 */
import type { FieldHelp, Severity, ValidationIssue } from '#shared/types/domain'

const props = withDefaults(
  defineProps<{
    issues: ValidationIssue[]
    counts: Record<Severity, number>
    /** Quellzeile -> Datensatz-Nummer. Leer, solange kein Satz erzeugt wurde. */
    rowRecords?: Record<number, number>
    importId?: string
    /**
     * Ob der Import ein tabellarisches Format hat. Nur dann gibt es eine
     * Zuordnungsseite, in die gesprungen werden kann; bei XML oder AVefi-nativ
     * antwortet sie mit 409 `not_tabular`.
     */
    tabular?: boolean
    /** Zielfeldschluessel -> Auskunft. Fehlt der Schluessel, entfaellt die Auskunft. */
    fieldHelp?: Record<string, FieldHelp>
    pageSize?: number
  }>(),
  { pageSize: 100, rowRecords: () => ({}), importId: '', tabular: false, fieldHelp: () => ({}) }
)
const { t, te } = useI18n()
// Der Satz kommt aus Code und Bausteinen, in der Sprache der Oberflaeche.
// Bis zum 30.09.2026 stand hier `issue.message`, der deutsche Serversatz (#10).
const { befund } = useMeldungstext()

type Filter = 'all' | Severity
const filter = ref<Filter>('all')
const shown = ref(props.pageSize)

const filtered = computed(() =>
  filter.value === 'all' ? props.issues : props.issues.filter((i) => i.severity === filter.value)
)
const visible = computed(() => filtered.value.slice(0, shown.value))
const total = computed(() => props.issues.length)

watch(filter, () => {
  shown.value = props.pageSize
})

const BADGE: Record<Severity, string> = { error: 'b-danger', warning: 'b-warn', info: 'b-info' }
const MARK: Record<Severity, string> = { error: '×', warning: '!', info: 'i' }

/**
 * Kapitel und Abschnitt im Handbuch je Beanstandung.
 *
 * Bewusst hier und nicht in den Uebersetzungen: Das ist die Gliederung des
 * Handbuchs, keine Sprache. Sonst muesste jede Sprachversion dieselben Anker
 * mitpflegen und koennte auseinanderlaufen.
 */
const HANDBUCH: Record<string, string> = {
  identifier_not_unique: '03-bearbeiten-und-validieren#kennung-ist-nicht-eindeutig',
  identifier_duplicate: '03-bearbeiten-und-validieren#exemplarkennung-doppelt-in-der-quelldatei',
  dangling_reference: '03-bearbeiten-und-validieren#verweis-zeigt-ins-leere',
  no_items_associated: '03-bearbeiten-und-validieren#kein-exemplar-zur-manifestation',
  authority_ambiguous: '03-bearbeiten-und-validieren#normdatentreffer-ist-mehrdeutig',
  schema: '03-bearbeiten-und-validieren#verstoss-gegen-das-avefi-schema',
  model_invalid: '03-bearbeiten-und-validieren#efi-conv-kann-den-datensatz-nicht-laden',
  rule_period: '03-bearbeiten-und-validieren#efi-conv-check-lehnt-den-datensatz-ab',
  rule_date: '03-bearbeiten-und-validieren#efi-conv-check-lehnt-den-datensatz-ab',
  rule_field_limit: '03-bearbeiten-und-validieren#efi-conv-check-lehnt-den-datensatz-ab',
  rule_empty_name: '03-bearbeiten-und-validieren#efi-conv-check-lehnt-den-datensatz-ab',
  rule_title_type: '03-bearbeiten-und-validieren#efi-conv-check-lehnt-den-datensatz-ab',
  rule_removed_without_pid: '03-bearbeiten-und-validieren#efi-conv-check-lehnt-den-datensatz-ab',
  rule_invalid_value: '03-bearbeiten-und-validieren#efi-conv-check-lehnt-den-datensatz-ab',
  missing_identifier: '03-bearbeiten-und-validieren#kennung-fehlt',
  validation_unavailable: '03-bearbeiten-und-validieren#die-schemapruefung-war-nicht-moeglich'
}

/** Punkt und Bindestrich sind in Codes zulaessig, in i18n-Schluesseln nicht. */
function schluessel(issue: ValidationIssue): string {
  return String(issue.code ?? '').replace(/[.-]/g, '_')
}

/** Adresse des Datensatzes zu einer Beanstandung, oder null. */
function datensatzZiel(issue: ValidationIssue): string | null {
  if (props.importId === '' || issue.row === undefined) return null
  const nummer = props.rowRecords[issue.row]
  return nummer === undefined ? null : `/imports/${props.importId}/records/${nummer}`
}

/** Adresse der Spalte in der Zuordnung, oder null. */
function spaltenZiel(issue: ValidationIssue): string | null {
  if (props.importId === '' || !props.tabular || !issue.sourceField) return null
  return `/imports/${props.importId}/mapping?spalte=${encodeURIComponent(issue.sourceField)}`
}

/** Die Angaben ohne eigenes Sprungziel — sie bleiben Text. */
function facets(issue: ValidationIssue): string[] {
  const out: string[] = []
  if (issue.row !== undefined && datensatzZiel(issue) === null) {
    out.push(t('imports.issue.row', { row: issue.row }))
  }
  if (issue.record !== undefined) out.push(t('imports.issue.record', { record: issue.record }))
  if (issue.sourceField && spaltenZiel(issue) === null) {
    out.push(t('imports.issue.sourceField', { field: issue.sourceField }))
  }
  if (issue.targetField) out.push(t('imports.issue.targetField', { field: issue.targetField }))
  return out
}

/** Ob die Beanstandung ueberhaupt eine Stelle nennt — gleich ob als Link oder als Text. */
function hatStelle(issue: ValidationIssue): boolean {
  return issue.row !== undefined || issue.record !== undefined
    || Boolean(issue.sourceField) || Boolean(issue.targetField)
}

/**
 * Beim wievielten Befund eines Codes der Hinweis steht.
 *
 * Gerechnet wird auf der gefilterten Liste: Wer nur die Fehler ansieht, soll
 * den Hinweis am ersten sichtbaren Fehler finden und nicht an einer Meldung,
 * die der Filter gerade ausblendet.
 */
const ersteFundstelle = computed(() => {
  const stellen = new Map<string, number>()
  filtered.value.forEach((issue, index) => {
    const key = schluessel(issue)
    if (key !== '' && !stellen.has(key)) stellen.set(key, index)
  })
  return stellen
})

function zeigtHinweis(issue: ValidationIssue, index: number): boolean {
  const key = schluessel(issue)
  if (key === '' || !te(`imports.advice.${key}`)) return false
  return ersteFundstelle.value.get(key) === index
}

function hinweis(issue: ValidationIssue): string {
  return t(`imports.advice.${schluessel(issue)}`)
}

/**
 * Beim wievielten Befund eines Zielfeldes die Auskunft steht.
 *
 * Dieselbe Rechnung wie beim Codehinweis, und aus demselben Grund auf der
 * gefilterten Liste: Wer nur die Fehler ansieht, findet die Auskunft am ersten
 * sichtbaren Fehler.
 */
const ersteFeldstelle = computed(() => {
  const stellen = new Map<string, number>()
  filtered.value.forEach((issue, index) => {
    const key = String(issue.targetField ?? '')
    if (key !== '' && props.fieldHelp[key] !== undefined && !stellen.has(key)) stellen.set(key, index)
  })
  return stellen
})

function feld(issue: ValidationIssue): FieldHelp | null {
  const key = String(issue.targetField ?? '')
  return key === '' ? null : (props.fieldHelp[key] ?? null)
}

function zeigtFeld(issue: ValidationIssue, index: number): boolean {
  const key = String(issue.targetField ?? '')
  return key !== '' && ersteFeldstelle.value.get(key) === index
}

/*
 * Lange Wertelisten werden gekuerzt.
 *
 * FormatFilmTypeEnum hat 30 Werte. Vollstaendig ausgeschrieben verdraengt eine
 * einzige Auskunft die halbe Liste der Befunde. Wer alle Werte braucht, findet
 * sie in der Auswahlliste des Ziels; hier geht es darum, die Groessenordnung
 * und die ersten Kandidaten zu zeigen.
 */
const WERTE_MAX = 12

function werte(hilfe: FieldHelp): string[] {
  return (hilfe.values ?? []).slice(0, WERTE_MAX)
}

function weitereWerte(hilfe: FieldHelp): number {
  return Math.max(0, (hilfe.values ?? []).length - WERTE_MAX)
}

function handbuchZiel(issue: ValidationIssue): string | null {
  const ziel = HANDBUCH[schluessel(issue)]
  return ziel === undefined ? null : `/dokumentation/handbuch/${ziel}`
}

function setFilter(value: Filter) {
  filter.value = value
}
</script>

<template>
  <section>
    <h2 class="side-h" style="margin:0 0 8px">{{ t('imports.report.issues.heading') }}</h2>
    <p class="note" style="margin:0 0 10px">{{ t('imports.report.issues.lead') }}</p>

    <div role="status" aria-live="polite" v-if="total === 0" class="ui-alert-ok">{{ t('imports.report.issues.none') }}</div>

    <template v-else>
      <div role="group" :aria-label="t('imports.report.issues.filterLabel')"
           style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px">
        <button type="button" class="chip" :aria-pressed="filter === 'all'"
                :style="filter === 'all' ? 'border-color:var(--primary);color:var(--primary)' : undefined"
                @click="setFilter('all')">{{ t('imports.report.issues.all', { count: total }) }}</button>
        <button v-if="counts.error > 0" type="button" class="chip" :aria-pressed="filter === 'error'"
                :style="filter === 'error' ? 'border-color:var(--danger);color:var(--danger)' : undefined"
                @click="setFilter('error')">{{ t('imports.report.issues.errors', { count: counts.error }) }}</button>
        <button v-if="counts.warning > 0" type="button" class="chip" :aria-pressed="filter === 'warning'"
                :style="filter === 'warning' ? 'border-color:var(--warn);color:var(--warn)' : undefined"
                @click="setFilter('warning')">{{ t('imports.report.issues.warnings', { count: counts.warning }) }}</button>
        <button v-if="counts.info > 0" type="button" class="chip" :aria-pressed="filter === 'info'"
                :style="filter === 'info' ? 'border-color:var(--info);color:var(--info)' : undefined"
                @click="setFilter('info')">{{ t('imports.report.issues.infos', { count: counts.info }) }}</button>
      </div>

      <p class="dim small" role="status" aria-live="polite" style="margin-bottom:8px">
        {{ t('imports.report.issues.shown', { shown: visible.length, total: filtered.length }) }}
      </p>

      <div class="tablewrap" style="padding:10px 12px">
        <p class="note small" style="margin:0 0 10px">{{ t('imports.issue.sourceLegend') }}</p>
        <ul class="val-list" style="list-style:none;margin:0;padding:0">
          <li v-for="(issue, index) in visible" :key="index" class="vi">
            <span class="m badge" :class="BADGE[issue.severity]" style="padding:1px 6px"
                  :title="t(`imports.issue.severity.${issue.severity}`)">
              <span aria-hidden="true">{{ MARK[issue.severity] }}</span>
              <span class="sr-only">{{ t(`imports.issue.severity.${issue.severity}`) }}</span>
            </span>
            <span style="min-width:0">
              <span class="fn">{{ befund(issue) }}</span>
              <!--
                Woher die Meldung kommt. Ohne diese Angabe sieht eine Regel
                dieser Anwendung aus wie eine des AVefi-Schemas — der fehlende
                Haupttitel ist genau so ein Fall: schemakonform erlaubt, von uns
                trotzdem beanstandet.
              -->
              <span class="badge issue-src" style="margin-left:6px;padding:0 5px">
                {{ t(`imports.issue.source.${issue.source ?? 'konvertierung'}`) }}</span>
              <span v-if="hatStelle(issue)" class="dim small">
                <template v-if="datensatzZiel(issue) !== null">
                  ·
                  <NuxtLink :to="datensatzZiel(issue) ?? ''"
                            :title="t('imports.issue.gotoRecord', { row: issue.row })">
                    {{ t('imports.issue.row', { row: issue.row }) }}</NuxtLink>
                </template>
                <template v-if="spaltenZiel(issue) !== null">
                  ·
                  <NuxtLink :to="spaltenZiel(issue) ?? ''"
                            :title="t('imports.issue.gotoColumn', { field: issue.sourceField })">
                    {{ t('imports.issue.sourceField', { field: issue.sourceField }) }}</NuxtLink>
                </template>
                <template v-for="(facet, i) in facets(issue)" :key="i"> · {{ facet }}</template>
              </span>
              <span v-else class="dim small"> · {{ t('imports.issue.noPosition') }}</span>
              <span v-if="issue.value" class="dim small mono" style="display:block;margin-top:2px">
                {{ t('imports.issue.value', { value: issue.value }) }}
              </span>
              <!--
                Was efi-conv selbst gesagt hat, unuebersetzt. Der Satz oben ist
                unserer; wer mit dem Abnahmewerkzeug vergleicht, braucht dessen
                Wortlaut.
              -->
              <details v-if="issue.detail" class="issue-detail small" style="margin-top:2px">
                <summary class="dim">{{ t('imports.issue.detail') }}</summary>
                <span class="mono" :title="t('imports.issue.detailHint')">{{ issue.detail }}</span>
              </details>
              <span v-if="issue.fix" class="dim small" style="display:block;margin-top:2px">
                {{ t('imports.issue.fix', { op: String(issue.fix.op) }) }}
              </span>
              <span v-if="zeigtHinweis(issue, index)" class="issue-advice">
                <strong>{{ t('imports.advice.lead') }}:</strong>
                {{ hinweis(issue) }}
                <NuxtLink v-if="handbuchZiel(issue) !== null" :to="handbuchZiel(issue) ?? ''">
                  {{ t('imports.advice.doc') }}</NuxtLink>
              </span>
              <span v-if="zeigtFeld(issue, index) && feld(issue) !== null" class="issue-advice">
                <strong>{{ t('imports.fieldHelp.lead') }}:</strong>
                <template v-if="feld(issue)?.description"> {{ feld(issue)?.description }}</template>
                <span v-if="feld(issue)?.values" style="display:block;margin-top:2px">
                  {{ t('imports.fieldHelp.values') }}
                  <span class="mono">{{ werte(feld(issue) as FieldHelp).join(', ') }}</span>
                  <template v-if="weitereWerte(feld(issue) as FieldHelp) > 0">
                    {{ t('imports.fieldHelp.more', { count: weitereWerte(feld(issue) as FieldHelp) }) }}</template>
                </span>
              </span>
            </span>
          </li>
        </ul>
      </div>

      <p v-if="visible.length < filtered.length" style="margin-top:12px">
        <button type="button" class="btn btn-outline btn-sm" @click="shown += props.pageSize">
          {{ t('imports.report.issues.more', { count: filtered.length - visible.length }) }}
        </button>
      </p>
      <p v-else-if="total >= 500" class="note">{{ t('imports.report.issues.capped') }}</p>
    </template>
  </section>
</template>
