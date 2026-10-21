<script setup lang="ts">
/**
 * Ein Exemplar im Datensatz-Editor.
 *
 * Herausgeloest, damit die Karte dort stehen kann, wo sie hingehoert: unter
 * ihrer Manifestation. Solange Werk, Manifestation und Exemplar drei gleichrangige Reiter
 * waren, sah die Oberflaeche aus, als seien es drei unabhaengige Dinge — dabei
 * gehoert jedes Exemplar zu genau einer Manifestation. Die Komponente kennt weder
 * Seitenaufbau noch Reiter; sie bekommt ein Exemplar und meldet, was der
 * Benutzer will.
 */
import { emptyFormat, emptyIdentifier, emptyLanguage, emptyValue, type UiIdentifier, type UiItem, type UiValue } from './model'
import { FORMAT_KLASSEN, formatEnum, teileFormatwert } from '#shared/formatklassen'

const props = defineProps<{
  item: UiItem
  /** Laufende Nummer fuer Ueberschrift und zugaengliche Namen. */
  index: number
  /** Ueberschrift der Karte — sie nennt die Manifestation mit, zu der das Exemplar gehoert. */
  heading: string
  enums: (name: string) => string[]
  resourceTypes: string[]
}>()

const emit = defineEmits<{ remove: [] }>()
const { t, te } = useI18n()

/**
 * Zugaenglicher Name mit der Ebene davor. Kennungen und Notizen gibt es auf
 * mehreren Ebenen; ohne den Bezug hiesse jeder dieser Knoepfe gleich.
 */
function scoped(text: string): string {
  return t('records.editor.aria.inScope', { scope: props.heading, text })
}

/**
 * Format, nach Traegerklasse gruppiert — dieselbe Auswahl wie am Ziel
 * „Format (alle Traegerklassen)" der Zuordnung (#28, Jasper Stratil). Der Wert
 * traegt die Klasse („Video:VHS"), sonst waere „DV" doppelt.
 */
const formatGruppen = computed(() => FORMAT_KLASSEN
  .map(([klasse, teil]) => ({
    klasse,
    label: t(`mapping.targets.item.format.${teil}`),
    werte: props.enums(formatEnum(klasse))
  }))
  .filter((g) => g.werte.length > 0))

const alleFormate = computed(() => new Set(formatGruppen.value.flatMap((g) => g.werte.map((w) => `${g.klasse}:${w}`))))

/** Gelesener Wert, den die Auswahl nicht kennt — er bleibt sichtbar stehen. */
function formatUnbekannt(wert: string): boolean {
  return wert !== '' && !alleFormate.value.has(wert)
}

function formatBeschriftung(wert: string): string {
  const { klasse, wert: typ } = teileFormatwert(wert)
  return klasse === null ? wert : `${typ} · ${klasse}`
}

function removeAt<T>(list: T[], index: number) {
  list.splice(index, 1)
}
function addIdentifier(list: UiIdentifier[]) {
  list.push(emptyIdentifier())
}
function addValue(list: UiValue[]) {
  list.push(emptyValue())
}
</script>

<template>
  <div class="ed-card ed-item">
    <div class="ed-card-head">
      <h3>{{ heading }}</h3>
      <button type="button" class="iconbtn-del"
              :aria-label="t('records.editor.item.remove', { index: index + 1 })"
              @click="emit('remove')"><span aria-hidden="true">🗑</span></button>
    </div>
    <div class="ed-title-row">
      <input v-model="item.title.has_name" class="ui-input" type="text"
             :aria-label="t('records.editor.item.title')" :placeholder="t('records.editor.item.title')">
      <RecordsEnumSelect :id="`it-title-type-${item.key}`" v-model="item.title.type" :values="enums('TitleTypeEnum')"
                         :label="t('records.editor.work.titleType')" />
    </div>
    <div class="ed-grid2">
      <div class="ed-f">
        <label :for="`it-element-${item.key}`">{{ t('records.editor.item.elementType') }}</label>
        <RecordsEnumSelect :id="`it-element-${item.key}`" v-model="item.element_type"
                           :values="enums('ItemElementTypeEnum')" />
      </div>
      <div class="ed-f">
        <label :for="`it-colour-${item.key}`">{{ t('records.editor.item.colour') }}</label>
        <RecordsEnumSelect :id="`it-colour-${item.key}`" v-model="item.has_colour_type"
                           :values="enums('ColourTypeEnum')" />
      </div>
      <div class="ed-f">
        <label :for="`it-sound-${item.key}`">{{ t('records.editor.item.sound') }}</label>
        <RecordsEnumSelect :id="`it-sound-${item.key}`" v-model="item.has_sound_type"
                           :values="enums('SoundTypeEnum')" />
      </div>
      <div class="ed-f">
        <label :for="`it-frame-${item.key}`">{{ t('records.editor.item.frameRate') }}</label>
        <RecordsEnumSelect :id="`it-frame-${item.key}`" v-model="item.has_frame_rate"
                           :values="enums('FrameRateEnum')" />
      </div>
      <div class="ed-f">
        <label :for="`it-access-${item.key}`">{{ t('records.editor.item.access') }}</label>
        <RecordsEnumSelect :id="`it-access-${item.key}`" v-model="item.has_access_status"
                           :values="enums('ItemAccessStatusEnum')" />
      </div>
      <div class="ed-f">
        <label :for="`it-duration-${item.key}`">{{ t('records.editor.item.duration') }}</label>
        <input :id="`it-duration-${item.key}`" v-model="item.duration" class="ui-input" type="text"
               :aria-describedby="`it-duration-hint-${item.key}`" placeholder="PT01H30M00S">
        <span :id="`it-duration-hint-${item.key}`" class="note">{{ t('records.editor.item.durationHint') }}</span>
      </div>
    </div>

    <div class="ed-sub">
      <span class="ed-sublabel">{{ t('records.editor.item.languages') }}</span>
      <div v-for="(lang, j) in item.languages" :key="lang.key" class="ed-title-row">
        <RecordsEnumSelect :id="`it-lang-${lang.key}`" v-model="lang.code" :values="enums('LanguageCodeEnum')"
                           :label="t('records.editor.item.language')"
                           :placeholder="t('records.editor.item.language')" />
        <RecordsEnumSelect :id="`it-langusage-${lang.key}`" v-model="lang.usage"
                           :values="enums('LanguageUsageEnum')"
                           :label="t('records.editor.item.languageUsage')"
                           :placeholder="t('records.editor.item.languageUsage')" />
        <button type="button" class="iconbtn-del"
                :aria-label="scoped(t('records.editor.item.removeLanguage', { index: j + 1 }))"
                @click="removeAt(item.languages, j)"><span aria-hidden="true">🗑</span></button>
      </div>
      <button type="button" class="btn btn-outline btn-sm"
              :aria-label="scoped(t('records.editor.item.addLanguage'))"
              @click="item.languages.push(emptyLanguage())">
        <span aria-hidden="true">+</span> {{ t('records.editor.item.addLanguage') }}
      </button>
    </div>

    <div class="ed-sub">
      <span class="ed-sublabel">{{ t('records.editor.item.formats') }}</span>
      <div v-for="(f, j) in item.formats" :key="f.key" class="ed-title-row">
        <span class="ed-format">
          <select v-if="formatGruppen.length > 0" :id="`it-format-${f.key}`" v-model="f.value" class="ui-input"
                  :aria-label="t('records.editor.item.format')"
                  :aria-describedby="formatUnbekannt(f.value) ? `it-format-${f.key}-hint` : undefined">
            <option value="">{{ t('records.table.none') }}</option>
            <option v-if="formatUnbekannt(f.value)" :value="f.value">{{ f.value }}</option>
            <optgroup v-for="g in formatGruppen" :key="g.klasse" :label="g.label">
              <option v-for="w in g.werte" :key="w" :value="`${g.klasse}:${w}`">{{ w }}</option>
            </optgroup>
          </select>
          <input v-else :id="`it-format-${f.key}`" v-model="f.value" class="ui-input" type="text"
                 :aria-label="t('records.editor.item.format')" placeholder="Video:VHS">
          <span v-if="formatUnbekannt(f.value) && formatGruppen.length > 0" :id="`it-format-${f.key}-hint`"
                class="note warnhint">
            {{ t('records.editor.item.formatUnknown', { value: formatBeschriftung(f.value) }) }}
          </span>
        </span>
        <button type="button" class="iconbtn-del"
                :aria-label="scoped(t('records.editor.item.removeFormat', { index: j + 1 }))"
                @click="removeAt(item.formats, j)"><span aria-hidden="true">🗑</span></button>
      </div>
      <button type="button" class="btn btn-outline btn-sm"
              :aria-label="scoped(t('records.editor.item.addFormat'))"
              @click="item.formats.push(emptyFormat())">
        <span aria-hidden="true">+</span> {{ t('records.editor.item.addFormat') }}
      </button>
    </div>

    <div v-for="(id, j) in item.identifiers" :key="id.key" class="ed-title-row">
      <select v-model="id.resourceType" class="ui-input" :aria-label="t('records.editor.work.identifierType')">
        <option v-for="name in resourceTypes" :key="name" :value="name">
          {{ te(`records.editor.resource.${name}`) ? t(`records.editor.resource.${name}`) : name }}
        </option>
      </select>
      <input v-model="id.id" class="ui-input" type="text" :aria-label="t('records.editor.work.identifier')">
      <button type="button" class="iconbtn-del"
              :aria-label="scoped(t('records.editor.work.removeIdentifier', { index: j + 1 }))"
              @click="removeAt(item.identifiers, j)"><span aria-hidden="true">🗑</span></button>
    </div>
    <button type="button" class="btn btn-outline btn-sm"
            :aria-label="scoped(t('records.editor.work.addIdentifier'))"
            @click="addIdentifier(item.identifiers)">
      <span aria-hidden="true">+</span> {{ t('records.editor.work.addIdentifier') }}
    </button>

    <div v-for="(note, j) in item.notes" :key="note.key" class="ed-title-row" style="margin-top:8px">
      <input v-model="note.value" class="ui-input" type="text" :aria-label="t('records.editor.work.note')">
      <button type="button" class="iconbtn-del"
              :aria-label="scoped(t('records.editor.work.removeNote', { index: j + 1 }))"
              @click="removeAt(item.notes, j)"><span aria-hidden="true">🗑</span></button>
    </div>
    <button type="button" class="btn btn-outline btn-sm"
            :aria-label="scoped(t('records.editor.work.addNote'))"
            @click="addValue(item.notes)">
      <span aria-hidden="true">+</span> {{ t('records.editor.work.addNote') }}
    </button>
  </div>
</template>

<style scoped>
/* Wie in EnumSelect.vue: der Hinweis gehoert unter das Feld, nicht daneben. */
.ed-format { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1 }
</style>
