<script setup lang="ts">
/**
 * Kontrolliertes Vokabular: Quellwerte auf AVefi-Werte abbilden.
 *
 * Gezeigt werden die Werte, die in der Datei TATSAECHLICH vorkommen, mit ihrer
 * Haeufigkeit — daneben die Auswahl der zulaessigen AVefi-Werte aus dem Schema.
 * Nicht zugeordnete Werte bleiben sichtbar markiert; sie sind der haeufigste
 * Grund fuer leere Felder im Ergebnis.
 *
 * Eine leere Zuordnung ist nicht dasselbe wie keine Zuordnung: Solange kein
 * Zielwert eingetragen ist, kommt fuer die Spalte nichts an. Deshalb steht die
 * Zahl der offenen Werte immer daneben.
 */
import type { TransformStep } from './types'
import { FORMAT_KLASSEN, teileFormatwert } from '#shared/formatklassen'

const props = defineProps<{
  step: TransformStep
  enumValues: string[]
  /** Name des Vokabulars im Schema, z. B. ColourTypeEnum. */
  enumName?: string
  /** Werte der Quelle mit Haeufigkeit. */
  sourceValues: Array<{ value: string; count: number }>
  idBase: string
}>()

const emit = defineEmits<{ change: [] }>()
const { t } = useI18n()

// Technische Schemawerte gehoeren nicht ungefiltert in die Oberflaeche. Der
// Wert bleibt sichtbar, aber hinter der lesbaren Beschriftung.
const { labelWithCode } = useVocabLabel()

/**
 * Die Auswahl, gruppiert, wenn die Werte ihre Traegerklasse tragen
 * ("Video:VHS", gemeinsames Format-Ziel, #28). Siebenundfuenfzig Werte in
 * einer flachen Liste waeren kaum zu ueberblicken, und "DV" stuende zweimal
 * ohne erkennbaren Unterschied da.
 */
const gruppen = computed<Array<{ label: string; values: string[] }>>(() => {
  const qualifiziert = props.enumValues.length > 0
    && props.enumValues.every((v) => teileFormatwert(v).klasse !== null)
  if (!qualifiziert) return [{ label: '', values: props.enumValues }]
  return FORMAT_KLASSEN
    .map(([klasse, teil]) => ({
      label: t(`mapping.targets.item.format.${teil}`),
      values: props.enumValues.filter((v) => teileFormatwert(v).klasse === klasse)
    }))
    .filter((g) => g.values.length > 0)
})

const added = ref<string[]>([])
const manual = ref('')

const map = computed<Record<string, string>>(() => {
  const raw = props.step.map
  return typeof raw === 'object' && raw !== null ? (raw as Record<string, string>) : {}
})

/** Zeilen: was in der Datei steht, was schon zugeordnet ist, was von Hand kam. */
const rows = computed(() => {
  const counts = new Map(props.sourceValues.map((v) => [v.value, v.count]))
  const keys: string[] = []
  for (const v of props.sourceValues) keys.push(v.value)
  for (const k of Object.keys(map.value)) if (!keys.includes(k)) keys.push(k)
  for (const k of added.value) if (!keys.includes(k)) keys.push(k)
  const present = new Set(props.sourceValues.map((v) => v.value))
  return keys.map((value) => ({
    value,
    count: counts.get(value) ?? 0,
    target: map.value[value] ?? '',
    /** Zielwert steht nicht in der Werteliste des Schemas. */
    invalid: (map.value[value] ?? '') !== '' && !props.enumValues.includes(map.value[value] ?? ''),
    /**
     * Der Wert steht in der gespeicherten Zuordnung, kommt in dieser Datei aber
     * nicht vor. Das ist nicht zwangslaeufig falsch — ein Profil wird bewusst
     * ueber mehrere Lieferungen hinweg benutzt. Es ist aber der Weg, auf dem
     * eine falsch gelesene Datei dauerhaft Spuren hinterlaesst: einmal als
     * Windows-1252 hochgeladen, steht der verstuemmelte Wert fuer immer neben
     * dem richtigen. Deshalb sichtbar machen, aber nichts von selbst loeschen.
     */
    orphan: !present.has(value) && (map.value[value] ?? '') !== ''
  }))
})

const orphans = computed(() => rows.value.filter((r) => r.orphan))

/** Alle verwaisten Eintraege auf einmal aus der Zuordnung nehmen. */
function dropOrphans() {
  const next = { ...map.value }
  for (const row of orphans.value) delete next[row.value]
  props.step.map = next
  emit('change')
}

const openCount = computed(() => rows.value.filter((r) => r.target === '').length)
const invalidCount = computed(() => rows.value.filter((r) => r.invalid).length)

function set(value: string, target: string) {
  const next = { ...map.value }
  if (target === '') delete next[value]
  else next[value] = target
  props.step.map = next
  emit('change')
}

function addManual() {
  const v = manual.value.trim()
  if (v === '') return
  if (!added.value.includes(v)) added.value.push(v)
  manual.value = ''
}

function prefill() {
  const next = { ...map.value }
  for (const v of props.sourceValues) if (next[v.value] === undefined) next[v.value] = ''
  props.step.map = next
  emit('change')
}
</script>

<template>
  <div class="authpanel">
    <div class="authpanel-h">
      <span>{{ t('mapping.vocab.heading') }}</span>
      <span v-if="openCount > 0" class="badge b-warn"><span class="bd" />{{ t('mapping.vocab.open', { n: openCount }) }}</span>
      <span v-else-if="rows.length > 0" class="badge b-ok"><span class="bd" />{{ t('mapping.vocab.allMapped') }}</span>
      <span v-if="invalidCount > 0" class="badge b-danger"><span class="bd" />{{ t('mapping.vocab.invalid', { n: invalidCount }) }}</span>
    </div>

    <p v-if="rows.length === 0" class="note" style="margin:0 0 8px">{{ t('mapping.vocab.empty') }}</p>

    <table v-else class="maptable" style="margin-bottom:8px">
      <caption class="sr-only">{{ t('mapping.vocab.caption') }}</caption>
      <colgroup><col style="width:42%"><col style="width:14%"><col style="width:44%"></colgroup>
      <thead>
        <tr>
          <th scope="col">{{ t('mapping.vocab.sourceValue') }}</th>
          <th scope="col">{{ t('mapping.vocab.count') }}</th>
          <th scope="col">{{ t('mapping.vocab.avefiValue') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(row, i) in rows" :key="row.value" :class="row.orphan ? 'is-orphan' : ''">
          <td>
            <span class="fn" :title="row.value">{{ row.value }}</span>
            <span v-if="row.orphan" class="dim small"> · {{ t('mapping.vocab.orphan') }}</span>
          </td>
          <td class="tnum dim small">{{ row.count > 0 ? row.count : '–' }}</td>
          <td>
            <label class="sr-only" :for="`${idBase}-v${i}`">
              {{ t('mapping.vocab.selectFor', { value: row.value }) }}
            </label>
            <select :id="`${idBase}-v${i}`" class="ui-input" :value="row.target"
                    @change="set(row.value, ($event.target as HTMLSelectElement).value)">
              <option value="">{{ t('mapping.vocab.unmapped') }}</option>
              <option v-if="row.invalid" :value="row.target">{{ row.target }} ({{ t('mapping.vocab.notInSchema') }})</option>
              <template v-for="g in gruppen" :key="g.label">
                <optgroup v-if="g.label !== ''" :label="g.label">
                  <option v-for="v in g.values" :key="v" :value="v">
                    {{ labelWithCode(enumName ?? '', v) }}
                  </option>
                </optgroup>
                <template v-else>
                  <option v-for="v in g.values" :key="v" :value="v">
                    {{ labelWithCode(enumName ?? '', v) }}
                  </option>
                </template>
              </template>
            </select>
          </td>
        </tr>
      </tbody>
    </table>

    <p v-if="orphans.length > 0" class="note" style="margin:0 0 8px">
      {{ t('mapping.vocab.orphanHint', { n: orphans.length }, orphans.length) }}
      <button type="button" class="linkbtn" style="margin-left:6px" @click="dropOrphans">
        {{ t('mapping.vocab.orphanDrop', { n: orphans.length }, orphans.length) }}
      </button>
    </p>

    <div class="vocabhint">
      <button type="button" class="btn btn-outline btn-sm" @click="prefill">{{ t('mapping.vocab.prefill') }}</button>
      <label class="sr-only" :for="`${idBase}-manual`">{{ t('mapping.vocab.addLabel') }}</label>
      <input :id="`${idBase}-manual`" v-model="manual" class="ui-input" style="max-width:180px"
             :placeholder="t('mapping.vocab.addLabel')" @keydown.enter.prevent="addManual">
      <button type="button" class="btn btn-outline btn-sm" @click="addManual">{{ t('mapping.vocab.add') }}</button>
    </div>
  </div>
</template>

<style scoped>
/* Verwaist: in der Zuordnung, aber nicht in dieser Datei. Gezeigt ueber die
   Flaeche und den Zusatz „verwaist", nicht ueber Deckkraft: opacity senkte den
   Kontrast der ganzen Zeile unter 4,5:1 — derselbe Befund wie bei .row-ignored. */
.is-orphan td { background: var(--row-ignored); }
</style>
