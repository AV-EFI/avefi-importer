<script setup lang="ts">
/**
 * Eine Konverterkette: Schritte in der Reihenfolge, in der sie laufen.
 *
 * Das Auswahlmenue der Konverter hat einen Schliessen-Knopf. Im PHP-Stand
 * fehlte er; das Menue liess sich nur durch erneutes Treffen desselben Knopfes
 * loswerden, und mehrere offene Menues ueberlagerten sich. Zusaetzlich
 * schliessen Escape und ein Klick daneben.
 */
import type { TransformOpMeta, TransformStep } from './types'
import MappingStep from './Step.vue'

const props = defineProps<{
  chain: TransformStep[]
  columns: string[]
  transforms: TransformOpMeta[]
  label: string
  enumValues: string[]
  /** Name des Vokabulars, damit Schemawerte lesbar beschriftet werden koennen. */
  enumName?: string
  sourceValues: Array<{ value: string; count: number }>
  idBase: string
}>()

const emit = defineEmits<{ change: [] }>()
const { t, te } = useI18n()

const picking = ref(false)
const root = ref<HTMLElement | null>(null)
const addButton = ref<HTMLButtonElement | null>(null)

const metaOf = (op: string): TransformOpMeta | null => props.transforms.find((m) => m.op === op) ?? null

function opLabel(meta: TransformOpMeta): string {
  const key = `mapping.op.${meta.op}`
  return te(key) ? t(key) : meta.label
}

const groups = computed(() => {
  const out = new Map<string, TransformOpMeta[]>()
  for (const meta of props.transforms) {
    const key = meta.group
    const list = out.get(key) ?? []
    list.push(meta)
    out.set(key, list)
  }
  return [...out.entries()].map(([group, items]) => ({ group, items }))
})

const groupLabel = useGroupLabel()

/** Neuer Schritt mit sinnvollen Vorgaben — sonst steht er halb leer da. */
function add(meta: TransformOpMeta) {
  const step: TransformStep = { op: meta.op } as TransformStep
  for (const param of meta.params) {
    if (param.type === 'choice') step[param.name] = Object.keys(param.choices ?? {})[0] ?? ''
    if (param.type === 'map') step.map = {}
    if (param.type === 'columns') step.columns = []
  }
  if (meta.op === 'map' && step.fallback === undefined) step.fallback = 'keep_note'

  // An die empfohlene Stelle einfuegen statt stur ans Ende: Rohwert,
  // Normalisierung, Aufteilen, Normdaten und Vokabular, Formgebung. Wer es
  // anders will, verschiebt den Schritt — die Kette bleibt frei. Vorgeschlagen
  // wird nur, weil eine Normdatenabfrage hinter allem anderen fast immer
  // gemeint ist, davor dagegen fast nie.
  props.chain.splice(insertAt(meta), 0, step)
  close()
  geaendert()
}

function phaseOfStep(step: TransformStep): number {
  return props.transforms.find((m) => m.op === String(step.op))?.phase ?? 4
}

/** Die erste Stelle, an der ein Schritt dieser Stufe stehen darf. */
function insertAt(meta: TransformOpMeta): number {
  const phase = meta.phase ?? 4
  let at = props.chain.length
  for (let i = 0; i < props.chain.length; i++) {
    const step = props.chain[i]
    if (step !== undefined && phaseOfStep(step) > phase) {
      at = i
      break
    }
  }
  return at
}

/**
 * Entfernen, mit Rueckweg.
 *
 * Sabrina Klewitz (Test 3): Am Konverter war nicht klar, ob das ✕ das
 * Bearbeitungsfeld schliesst oder den Konverter verwirft. Es verwarf ihn, ohne
 * Rueckfrage und ohne Spur. Der Knopf heisst jetzt sichtbar „Entfernen", und
 * bis zur naechsten Aenderung steht darunter, was entfernt wurde, mit
 * „Rueckgaengig". Eine Rueckfrage vorab waere beim Aufbauen einer Kette laestig.
 */
const entfernt = ref<{ step: TransformStep; index: number; name: string } | null>(null)

function remove(index: number) {
  const [step] = props.chain.splice(index, 1)
  if (step !== undefined) {
    const meta = metaOf(String(step.op))
    entfernt.value = { step, index, name: meta !== null ? opLabel(meta) : String(step.op) }
  }
  // Der Knopf des geloeschten Schritts ist weg; der Fokus geht auf „Schritt
  // hinzufuegen" statt auf <body>. Die Meldung sagt die Statuszeile an.
  void nextTick(() => addButton.value?.focus())
  emit('change')
}

function rueckgaengig() {
  const e = entfernt.value
  if (e === null) return
  props.chain.splice(Math.min(e.index, props.chain.length), 0, e.step)
  entfernt.value = null
  emit('change')
}

/** Jede weitere Aenderung an dieser Kette beendet das Angebot. */
function geaendert() {
  entfernt.value = null
  emit('change')
}

function move(index: number, delta: number) {
  const to = index + delta
  if (to < 0 || to >= props.chain.length) return
  const [step] = props.chain.splice(index, 1)
  if (step !== undefined) props.chain.splice(to, 0, step)
  geaendert()
}

function close() {
  picking.value = false
  nextTick(() => addButton.value?.focus())
}

/**
 * Beim Oeffnen wandert der Fokus in die Auswahl. Sonst muesste man sich vom
 * Knopf aus blind weitertabben und wuesste nicht, dass sich etwas geoeffnet hat.
 */
function togglePicker() {
  picking.value = !picking.value
  if (!picking.value) return
  void nextTick(() => root.value?.querySelector<HTMLElement>('.chain-pitem')?.focus())
}

function onDocClick(e: MouseEvent) {
  if (picking.value && root.value !== null && !root.value.contains(e.target as Node)) picking.value = false
}
function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape' && picking.value) close()
}
onMounted(() => {
  document.addEventListener('click', onDocClick)
  document.addEventListener('keydown', onKey)
})
onBeforeUnmount(() => {
  document.removeEventListener('click', onDocClick)
  document.removeEventListener('keydown', onKey)
})
</script>

<template>
  <div ref="root" class="chain">
    <div v-if="label" :id="`${idBase}-label`" class="chain-label">{{ label }}</div>

    <p v-if="chain.length === 0" class="note" style="margin:0 0 6px">{{ t('mapping.chain.emptyHint') }}</p>

    <div v-for="(step, i) in chain" :key="`${idBase}-${i}`" style="position:relative">
      <MappingStep :step="step" :meta="metaOf(String(step.op))" :columns="columns" :enum-values="enumValues"
                   :enum-name="enumName ?? ''"
                   :source-values="sourceValues" :id-base="`${idBase}-s${i}`" :position="i + 1"
                   @change="geaendert" @remove="remove(i)" />
      <div v-if="chain.length > 1" style="display:flex;gap:4px;margin:-4px 0 7px">
        <button type="button" class="linkbtn" :disabled="i === 0"
                :aria-label="t('mapping.chain.moveUp', { n: i + 1 })" @click="move(i, -1)">↑</button>
        <button type="button" class="linkbtn" :disabled="i === chain.length - 1"
                :aria-label="t('mapping.chain.moveDown', { n: i + 1 })" @click="move(i, 1)">↓</button>
      </div>
    </div>

    <p class="chain-removed small" role="status" aria-live="polite">
      <template v-if="entfernt">
        {{ t('mapping.chain.removed', { name: entfernt.name }) }}
        <button type="button" class="linkbtn" :aria-label="t('mapping.chain.undoLabel', { name: entfernt.name })"
                @click="rueckgaengig">{{ t('mapping.chain.undo') }}</button>
      </template>
    </p>

    <div class="chain-add">
      <button ref="addButton" type="button" class="btn btn-outline btn-sm"
              aria-haspopup="dialog" :aria-expanded="picking ? 'true' : 'false'"
              :aria-label="t('mapping.chain.addStepLabel')" @click="togglePicker">
        <span aria-hidden="true">+</span> {{ t('mapping.chain.addStep') }}
      </button>

      <div v-if="picking" class="chain-picker" role="dialog" :aria-label="t('mapping.chain.pickerTitle')">
        <div style="grid-column:1/-1;display:flex;align-items:center;gap:8px">
          <strong class="chain-pgroup-h" style="margin:0;flex:1">{{ t('mapping.chain.pickerTitle') }}</strong>
          <button type="button" class="ui-modal-x" :aria-label="t('mapping.chain.closePicker')" @click="close">×</button>
        </div>
        <div v-for="g in groups" :key="g.group" class="chain-pgroup">
          <div class="chain-pgroup-h">{{ groupLabel(g.group) }}</div>
          <button v-for="meta in g.items" :key="meta.op" type="button" class="chain-pitem"
                  :title="meta.slow ? t('mapping.chain.slowHint') : undefined" @click="add(meta)">
            {{ opLabel(meta) }}<span v-if="meta.slow" aria-hidden="true"> ⏳</span>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
