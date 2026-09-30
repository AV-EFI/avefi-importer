<script setup lang="ts">
/**
 * Ein Konverterschritt einer Kette.
 *
 * Die Beschriftungen kommen aus dem Katalog des Servers und lassen sich per
 * i18n ueberschreiben; ohne eigenen Schluessel bleibt der Katalogtext stehen.
 * So kommt eine neue Operation im Backend nicht als leere Zeile an.
 */
import type { TransformOpMeta, TransformParamSpec, TransformStep } from './types'
import MappingVocabulary from './Vocabulary.vue'

const props = defineProps<{
  step: TransformStep
  meta: TransformOpMeta | null
  columns: string[]
  /** Zulaessige Zielwerte, falls das Ziel ein kontrolliertes Vokabular hat. */
  enumValues: string[]
  enumName?: string
  sourceValues: Array<{ value: string; count: number }>
  idBase: string
  position: number
}>()

const emit = defineEmits<{ change: []; remove: [] }>()
const { t, te } = useI18n()

const opLabel = computed(() => {
  const key = `mapping.op.${props.step.op}`
  return te(key) ? t(key) : (props.meta?.label ?? String(props.step.op))
})

function paramLabel(param: TransformParamSpec): string {
  const key = `mapping.param.${props.step.op}.${param.name}`
  return te(key) ? t(key) : param.label
}

function choiceLabel(param: TransformParamSpec, value: string): string {
  const key = `mapping.choice.${props.step.op}.${param.name}.${value}`
  return te(key) ? t(key) : (param.choices?.[value] ?? value)
}

const params = computed(() => props.meta?.params ?? [])

function value(name: string): unknown {
  return props.step[name]
}

function set(name: string, v: unknown) {
  props.step[name] = v
  emit('change')
}

function mapText(): string {
  const raw = props.step.map
  if (typeof raw !== 'object' || raw === null) return ''
  return Object.entries(raw as Record<string, unknown>).map(([k, v]) => `${k} = ${String(v ?? '')}`).join('\n')
}

function setMapText(text: string) {
  const out: Record<string, string> = {}
  for (const line of text.split('\n')) {
    const at = line.indexOf('=')
    if (at < 0) continue
    const k = line.slice(0, at).trim()
    if (k !== '') out[k] = line.slice(at + 1).trim()
  }
  props.step.map = out
  emit('change')
}

function toggleColumn(column: string) {
  const list = Array.isArray(props.step.columns) ? [...(props.step.columns as string[])] : []
  const at = list.indexOf(column)
  if (at >= 0) list.splice(at, 1)
  else list.push(column)
  props.step.columns = list
  emit('change')
}

function paramId(param: TransformParamSpec): string {
  return `${props.idBase}-${param.name}`
}
</script>

<template>
  <div class="ui-step">
    <div class="ui-step-head">
      <span class="ui-step-name">{{ position }}. {{ opLabel }}</span>
      <span v-if="meta?.slow" class="badge b-wait" :title="t('mapping.chain.slowHint')">
        <span class="bd" />{{ t('mapping.chain.slow') }}
      </span>
      <span v-if="meta === null" class="badge b-danger"><span class="bd" />{{ t('mapping.chain.unknownOp') }}</span>
      <!-- Sichtbar beschriftet: Das ✕ sah aus wie „Schliessen" (Test 3). -->
      <button type="button" class="btn btn-outline btn-sm step-remove"
              :aria-label="t('mapping.chain.removeStep', { name: opLabel })"
              @click="emit('remove')"><span aria-hidden="true">🗑</span> {{ t('mapping.chain.remove') }}</button>
    </div>

    <div v-if="params.length" class="ui-step-params">
      <div v-for="param in params" :key="param.name" class="ui-step-param">
        <template v-if="param.type === 'map' && enumValues.length > 0">
          <span class="ui-step-plabel">{{ paramLabel(param) }}</span>
          <MappingVocabulary :step="step" :enum-values="enumValues" :enum-name="enumName ?? ''"
                             :source-values="sourceValues"
                             :id-base="paramId(param)" @change="emit('change')" />
        </template>

        <template v-else-if="param.type === 'map'">
          <label class="ui-step-plabel" :for="paramId(param)">{{ paramLabel(param) }}</label>
          <textarea :id="paramId(param)" class="ui-input mono" rows="4" :value="mapText()"
                    :placeholder="t('mapping.chain.mapPlaceholder')"
                    @change="setMapText(($event.target as HTMLTextAreaElement).value)" />
        </template>

        <template v-else-if="param.type === 'choice'">
          <label class="ui-step-plabel" :for="paramId(param)">{{ paramLabel(param) }}</label>
          <select :id="paramId(param)" class="ui-input" :value="String(value(param.name) ?? '')"
                  @change="set(param.name, ($event.target as HTMLSelectElement).value)">
            <option v-for="(_l, key) in (param.choices ?? {})" :key="key" :value="key">
              {{ choiceLabel(param, String(key)) }}
            </option>
          </select>
        </template>

        <template v-else-if="param.type === 'bool'">
          <label class="checkline" :for="paramId(param)">
            <input :id="paramId(param)" type="checkbox" :checked="value(param.name) === true"
                   @change="set(param.name, ($event.target as HTMLInputElement).checked)">
            {{ paramLabel(param) }}
          </label>
        </template>

        <template v-else-if="param.type === 'columns'">
          <fieldset style="border:0;padding:0;margin:0">
            <legend class="ui-step-plabel">{{ paramLabel(param) }}</legend>
            <div class="ui-step-cols">
              <label v-for="c in columns" :key="c" class="checkline">
                <input type="checkbox"
                       :checked="Array.isArray(step.columns) && (step.columns as string[]).includes(c)"
                       @change="toggleColumn(c)"> {{ c }}
              </label>
            </div>
          </fieldset>
        </template>

        <template v-else>
          <label class="ui-step-plabel" :for="paramId(param)">{{ paramLabel(param) }}</label>
          <input :id="paramId(param)" class="ui-input" :type="param.type === 'int' ? 'number' : 'text'"
                 :value="String(value(param.name) ?? '')"
                 @change="set(param.name, param.type === 'int'
                   ? Number(($event.target as HTMLInputElement).value)
                   : ($event.target as HTMLInputElement).value)">
        </template>
      </div>
    </div>
  </div>
</template>
