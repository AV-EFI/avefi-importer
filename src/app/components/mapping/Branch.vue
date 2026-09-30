<script setup lang="ts">
/**
 * Die Verzweigung einer Quellspalte, sichtbar gemacht.
 *
 * Spalte → gemeinsame Kette (pre) → je Zweig eigene Kette (post) und eigenes
 * Ziel. Das Datenmodell konnte das von Anfang an; die Oberflaeche zeigte es
 * nicht — und die Faehigkeit galt deshalb als nicht vorhanden. Eine Faehigkeit,
 * die man nicht sieht, hat man nicht.
 *
 * Unter jedem Zweig steht das Ergebnis GENAU DIESES Zweigs auf denselben
 * Beispielzeilen wie in der Tabelle daneben.
 */
import type { ColumnMapping } from '#shared/types/domain'
import type {
  AuthorityRequest, AuthorityValue, EditorTarget, MappingCheck, PreviewExample, TransformOpMeta, TransformStep
} from './types'
import MappingChain from './Chain.vue'
import MappingTargetSelect from './TargetSelect.vue'

const props = defineProps<{
  column: string
  spec: ColumnMapping
  columns: string[]
  targets: EditorTarget[]
  transforms: TransformOpMeta[]
  examples: PreviewExample[]
  values: Array<{ value: string; count: number }>
  fillLabel: string
  index: number
  /** Der volle Wertevorrat je Zweig und Quelle — nicht nur die drei Beispiele. */
  authorityValues: (column: string, branch: number, source: string) => AuthorityValue[]
  /** Profil-ID, falls vorhanden: dann gibt es die eigene Normdatenseite. */
  mappingId: number | null
  /** Beanstandungen dieser Spalte — angezeigt dort, wo sie entstehen. */
  checks: MappingCheck[]
}>()

const emit = defineEmits<{
  change: []
  authority: [request: AuthorityRequest]
  clearAuthority: [entry: { value: string; source: string }]
  fix: [check: MappingCheck]
}>()

const { t, te } = useI18n()
// pruefung: bis zum 30.09.2026 stand hier `check.message`, deutsch auch in
// der englischen Oberflaeche — die Zweigansicht hatte Stefan in #10 nicht
// genannt, sie hatte denselben Fehler.
const { meldung, pruefung } = useMeldungstext()
const root = ref<HTMLElement | null>(null)

/**
 * Fokus in das Element setzen, das nach einer Aenderung neu entsteht.
 * Ohne das faellt der Fokus auf <body>, sobald der ausloesende Knopf aus dem
 * Baum verschwindet — und der Weg zurueck beginnt am Seitenanfang.
 */
function focusInBranch(index: number, auswahl: string) {
  void nextTick(() => {
    const zweig = root.value?.querySelectorAll<HTMLElement>('.branch-item')[index]
    zweig?.querySelector<HTMLElement>(auswahl)?.focus()
  })
}

const idBase = computed(() => `col${props.index}`)
const byKey = computed(() => new Map(props.targets.map((x) => [x.key, x])))

function labelOf(key: string): string {
  const target = byKey.value.get(key)
  if (target === undefined) return key
  const i18nKey = `mapping.targets.${key}`
  return te(i18nKey) ? t(i18nKey) : target.label
}

function enumValuesFor(key: string): string[] {
  return byKey.value.get(key)?.enumValues ?? []
}

/** Name des Vokabulars hinter einem Ziel — Grundlage der lesbaren Beschriftung. */
function enumNameFor(key: string | undefined): string {
  return enumNameOf(key === undefined ? undefined : byKey.value.get(key)?.type)
}

/** Kette eines Zweigs = gemeinsame Vorkette plus eigene Nachkette. */
function fullChain(index: number): TransformStep[] {
  const post = props.spec.targets?.[index]?.post ?? []
  return [...(props.spec.pre ?? []), ...post]
}

function authorityStep(index: number): TransformStep | null {
  return fullChain(index).find((s) => String(s.op) === 'authority') ?? null
}

function hasValuemap(index: number): boolean {
  return fullChain(index).some((s) => String(s.op) === 'map')
}

/** Die Ketten liegen nach dem Aufbereiten in Editor.vue immer als Feld vor;
 *  die Absicherung faengt nur ein von Hand eingelesenes Profil ab. */
function preChain(): TransformStep[] {
  if (!Array.isArray(props.spec.pre)) props.spec.pre = []
  return props.spec.pre
}

function postChain(index: number): TransformStep[] {
  const binding = props.spec.targets?.[index]
  if (binding === undefined) return []
  if (!Array.isArray(binding.post)) binding.post = []
  return binding.post
}

function outputsFor(example: PreviewExample, key: string | undefined) {
  return (example.outputs ?? []).filter((o) => o.target === key)
}

function addTarget() {
  props.spec.ignore = false
  if (!Array.isArray(props.spec.targets)) props.spec.targets = []
  props.spec.targets.push({ target: '', post: [] })
  focusInBranch(props.spec.targets.length - 1, 'input[role="combobox"]')
  emit('change')
}

function removeTarget(index: number) {
  props.spec.targets?.splice(index, 1)
  // Der geloeschte Zweig nimmt seinen Knopf mit; der Fokus geht auf „Zweig
  // hinzufuegen", das einzige Element, das sicher stehen bleibt.
  void nextTick(() => root.value?.querySelector<HTMLElement>('.branch-add-item button')?.focus())
  emit('change')
}

function setTarget(index: number, key: string) {
  const binding = props.spec.targets?.[index]
  if (binding === undefined) return
  binding.target = key
  emit('change')
}

/** Werteliste anlegen — angeboten, nie von selbst gesetzt. */
function addValuemap(index: number) {
  const binding = props.spec.targets?.[index]
  if (binding === undefined) return
  if (!Array.isArray(binding.post)) binding.post = []
  binding.post.push({ op: 'map', map: {}, fallback: 'keep_note' } as TransformStep)
  focusInBranch(index, '.authpanel select, .authpanel input')
  emit('change')
}

/* --------------------------------------------------------------- Normdaten */

/**
 * Der Stand einer Zuordnung — je Quelle getrennt. Frueher lag je Wert genau
 * ein Eintrag: Wer GND und danach VIAF bestaetigte, ueberschrieb damit die
 * erste Entscheidung, ohne dass etwas darauf hinwies.
 */
function authorityState(value: string, source = 'gnd'): 'bestaetigt' | 'verworfen' | 'offen' {
  const entry = confirmedFor(props.spec, value, source)
  if (entry === undefined) return 'offen'
  return entry.id !== '' ? 'bestaetigt' : 'verworfen'
}

/**
 * Werte, fuer die sich eine Zuordnung lohnt.
 *
 * Entscheidend ist der Wert **nach** der Konverterkette, nicht der Rohwert der
 * Spalte. Steht in der Datei „DE" und normalisiert die Kette das zu
 * „Deutschland", muss die Normdatensuche „Deutschland" fragen — sonst findet die
 * Oberflaeche nichts, waehrend die automatische Konvertierung sauber zuordnet,
 * und die manuelle Bestaetigung laesst sich nie erteilen.
 *
 * Der Rohwert dient nur als Rueckfall, wenn die Kette fuer dieses Ziel nichts
 * ausgibt (etwa weil die Vorschau noch nicht gerechnet hat).
 */
/**
 * Die Werte eines Zweigs, zu denen Normdaten gesucht werden — alle, nicht die
 * ersten drei.
 *
 * Vorher speiste sich diese Liste aus den drei Beispielwerten der Vorschau.
 * Damit war ein Wert, der eine Entscheidung braucht, aber weiter unten in der
 * Datei steht, schlicht nicht erreichbar — Lucas Befund vom 31.08. mit dem
 * Wert "USA". Die Liste kommt jetzt aus dem Wertevorrat, den der Server ueber
 * die ganze Datei rechnet, und sie rollt.
 *
 * Rueckfall bleibt der alte Weg: Solange der Vorrat nicht geladen ist, sind
 * die Beispielwerte besser als eine leere Liste.
 */
function authorityValuesOf(i: number): AuthorityValue[] {
  const quelle = String(authorityStep(i)?.source ?? 'gnd')
  const vorrat = props.authorityValues(props.column, i, quelle)
  if (vorrat.length > 0) return vorrat

  const ziel = props.spec.targets?.[i]?.target
  const gesehen = new Set<string>()
  for (const e of props.examples) {
    const treffer = (e.outputs ?? []).filter((o) => ziel === undefined || o.target === ziel)
    const werte = treffer.map((o) => o.value).filter((v) => v !== '')
    for (const w of werte.length > 0 ? werte : [e.raw]) {
      if (w !== '') gesehen.add(w)
    }
  }
  const roh = gesehen.size === 0 ? props.values.slice(0, 25).map((v) => v.value) : [...gesehen]
  return roh.map((value) => ({ value, count: 0, state: authorityState(value, quelle) }))
}

/**
 * Lohnt es, die Zwischenstufe zu zeigen?
 *
 * Nur wenn die gemeinsame Kette den Wert tatsaechlich veraendert hat und das
 * Ergebnis danach noch einmal ein anderes ist. Sonst stuende dreimal dasselbe
 * nebeneinander und die Zeile waere schwerer zu lesen statt aufschlussreicher.
 */
function showsPre(example: PreviewExample, target?: string): boolean {
  const pre = example.pre ?? ''
  if (pre === '' || pre === example.raw) return false
  const werte = outputsFor(example, target).map((o) => o.value)
  return werte.length === 0 || !werte.includes(pre)
}

/**
 * Die Beanstandungen eines Zweigs, dort angezeigt, wo sie entstehen.
 *
 * Die Uebersicht oben bleibt — sie zeigt die Lage der ganzen Spalte. Aber wer
 * an einem Zweig arbeitet, soll nicht erst hochscrollen und die Meldung dem
 * richtigen Ziel zuordnen muessen. Jede Meldung nennt hier ausserdem das
 * AVefi-Schemafeld, um das es geht.
 */
function checksFor(target: string | undefined): MappingCheck[] {
  if (target === undefined || target === '') return props.checks.filter((c) => c.targetField === undefined)
  return props.checks.filter((c) => c.targetField === target)
}

/** Der Schemapfad eines Ziels — der Vertrag verlangt seine Anzeige. */
function schemaPathOf(key: string | undefined): string {
  if (key === undefined) return ''
  return byKey.value.get(key)?.path ?? key
}

/** Wie viele Werte dieses Zweigs warten noch auf eine Entscheidung? */
function authorityOpen(i: number): number {
  return authorityValuesOf(i).filter((v) => v.state === 'offen').length
}
</script>

<template>
  <div ref="root" class="branch">
    <div class="branch-src">
      <span class="branch-col"><i aria-hidden="true">▤</i>{{ column }}</span>
      <span v-if="fillLabel" class="dim small">{{ fillLabel }}</span>
    </div>

    <div class="branch-global">
      <MappingChain :chain="preChain()" :columns="columns" :transforms="transforms"
                    :label="t('mapping.branch.preLabel')" :enum-values="[]" :enum-name="''" :source-values="values"
                    :id-base="`${idBase}-pre`" @change="emit('change')" />
    </div>

    <div class="branch-list">
      <div v-for="(binding, i) in (spec.targets ?? [])" :key="i" class="branch-item">
        <div class="branch-connector" aria-hidden="true" />
        <div class="branch-body">
          <div class="branch-head">
            <span class="branch-no">{{ t('mapping.branch.number', { n: i + 1 }) }}</span>
            <span v-if="binding.target && !byKey.has(binding.target)" class="badge b-danger">
              <span class="bd" />{{ t('mapping.branch.unknownTarget') }}
            </span>
            <button type="button" class="iconbtn-del"
                    :aria-label="t('mapping.branch.remove', { n: i + 1, column })" @click="removeTarget(i)">✕</button>
          </div>

          <MappingChain :chain="postChain(i)" :columns="columns" :transforms="transforms"
                        :label="t('mapping.branch.postLabel')" :enum-values="enumValuesFor(binding.target)"
                        :enum-name="enumNameFor(binding.target)"
                        :source-values="values" :id-base="`${idBase}-b${i}`" @change="emit('change')" />

          <MappingTargetSelect :model-value="binding.target" :targets="targets"
                               :label="t('mapping.branch.targetLabel', { n: i + 1 })"
                               :input-id="`${idBase}-b${i}-target`"
                               @update:model-value="setTarget(i, $event)" />

          <div v-if="enumValuesFor(binding.target).length > 0 && !hasValuemap(i)" class="vocabhint">
            <span class="dim small">{{ t('mapping.branch.enumHint') }}</span>
            <button type="button" class="btn btn-outline btn-sm" @click="addValuemap(i)">
              {{ t('mapping.branch.addValuemap') }}
            </button>
          </div>

          <div v-if="examples.length" class="branch-result">
            <div v-for="(example, j) in examples" :key="j" class="exline">
              <span class="exraw" :title="example.raw">{{ example.raw }}</span>
              <i class="exarrow" aria-hidden="true">→</i>
              <template v-if="showsPre(example, binding.target)">
                <span class="exmid" :title="t('mapping.branch.preValue')">{{ example.pre }}</span>
                <i class="exarrow" aria-hidden="true">→</i>
              </template>
              <span v-if="outputsFor(example, binding.target).length" class="okval">
                <i aria-hidden="true">✓</i>{{ outputsFor(example, binding.target).map((o) => o.value).join(' · ') }}
              </span>
              <span v-else-if="example.errors.length" class="errval" :title="example.errors.map(meldung).join(' · ')">
                <i aria-hidden="true">⚠</i>{{ meldung(example.errors[0]!) }}
              </span>
              <span v-else class="dim">{{ t('mapping.branch.noValue') }}</span>
            </div>
          </div>
          <p v-else class="branch-result dim small">{{ t('mapping.branch.noExample') }}</p>

          <ul v-if="checksFor(binding.target).length" class="branchchecks">
            <li v-for="(check, ci) in checksFor(binding.target)" :key="ci"
                :class="check.severity === 'error' ? 'chk-nogo' : 'chk-warn'">
              <i aria-hidden="true">{{ check.severity === 'error' ? '⛔' : '⚠' }}</i>
              <span class="sr-only">{{ check.severity === 'error'
                ? t('mapping.check.srBlocking') : t('mapping.check.srHint') }}</span>
              <span class="chk-msg">{{ pruefung(check) }}</span>
              <span v-if="check.targetField" class="dim small chk-path">{{ schemaPathOf(check.targetField) }}</span>
              <button v-if="check.fix" type="button" class="btn btn-outline btn-sm"
                      @click="emit('fix', check)">{{ t('mapping.check.applyFixShort') }}</button>
            </li>
          </ul>

          <div v-if="authorityStep(i)" class="authpanel">
            <div class="authpanel-h">
              <span>{{ t('mapping.authority.heading', {
                source: String(authorityStep(i)?.source ?? 'gnd').toUpperCase() }) }}</span>
              <span class="dim small">{{ t('mapping.authority.note') }}</span>
            </div>
            <div class="authlist" role="group"
                 :aria-label="t('mapping.authority.listLabel', {
                   column, source: String(authorityStep(i)?.source ?? 'gnd').toUpperCase() })" tabindex="0">
              <div v-for="entry in authorityValuesOf(i)" :key="entry.value" class="authrow">
                <span class="authval" :title="entry.value">{{ entry.value }}</span>
                <span v-if="entry.count > 0" class="dim small authcount">{{
                  t('mapping.authority.count', { n: entry.count }) }}</span>
                <span class="authstate" :class="`st-${entry.state}`">
                  <template v-if="entry.state === 'bestaetigt'">
                    {{ entry.id }}
                    <span class="dim">{{ entry.label }}</span>
                  </template>
                  <template v-else-if="entry.state === 'verworfen'">{{ t('mapping.authority.left') }}</template>
                  <template v-else>{{ t('mapping.authority.auto') }}</template>
                </span>
                <button type="button" class="btn btn-outline btn-sm"
                        :aria-label="t('mapping.authority.assignFor', { value: entry.value })"
                        @click="emit('authority', {
                          column,
                          value: entry.value,
                          source: String(authorityStep(i)?.source ?? 'gnd'),
                          kind: String(authorityStep(i)?.kind ?? 'person')
                        })">{{ t('mapping.authority.assign') }}</button>
                <button v-if="entry.state !== 'offen'" type="button" class="linkbtn"
                        :aria-label="t('mapping.authority.resetFor', { value: entry.value })"
                        @click="emit('clearAuthority', {
                          value: entry.value,
                          source: String(authorityStep(i)?.source ?? 'gnd')
                        })">{{ t('mapping.authority.reset') }}</button>
              </div>
            </div>
            <p class="authfoot dim small">
              {{ t('mapping.authority.openCount', { n: authorityOpen(i), all: authorityValuesOf(i).length }) }}
              <NuxtLink v-if="mappingId !== null" :to="`/mappings/${mappingId}/normdaten`" class="linkbtn">
                {{ t('mapping.authority.pageLink') }}
              </NuxtLink>
            </p>
          </div>
        </div>
      </div>

      <div class="branch-item branch-add-item">
        <div class="branch-connector" aria-hidden="true" />
        <button type="button" class="btn btn-outline btn-sm"
                :aria-label="t('mapping.branch.addLabel')" @click="addTarget">
          <span aria-hidden="true">+</span> {{ t('mapping.branch.add') }}
        </button>
        <p class="note" style="margin-top:6px">{{ t('mapping.branch.addHint') }}</p>
      </div>
    </div>
  </div>
</template>
