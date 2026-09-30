<script setup lang="ts">
import { recordsService } from '~/services/records'
/**
 * Der AVefi-Datensatz-Editor.
 *
 * Vertraglich ist die Bearbeitung einzelner Filmdatensaetze nicht geschuldet.
 * Sie ist hier, weil Tester sie bereits benutzt haben — und deshalb an den
 * Stellen sorgfaeltig, an denen sie den Testern begegnet ist.
 *
 * Was hier anders ist als im PHP-Stand:
 *  - Geprueft wird auf dem Server (efi-conv), nicht im Browser nachgebaut.
 *  - Felder, die der Editor nicht anzeigt, bleiben beim Speichern erhalten.
 *  - Ein weiterer Titel wird nie von selbst zum Haupttitel.
 *  - Normdaten haengen als same_as an der Entitaet und ersetzen den Namen nie.
 *  - Leere Wertelisten werden als solche benannt statt als leere Auswahl.
 */
import { apiFailure, failureText } from '~/components/records/errors'
import {
  addSameAs, emptyActivity, emptyEntity, emptyEvent, emptyIdentifier, emptyItem,
  emptyLanguage, emptyManifestation, emptyTitle, emptyValue, nextKey, parseRecord,
  serializeRecord, splitMatches, DEFAULT_ALT_TITLE_TYPE, DEFAULT_PRIMARY_TITLE_TYPE,
  type UiIdentifier, type UiItem, type UiManifestation, type UiRecord, type UiValue
} from '~/components/records/model'
import type { AuthoritySearchResponse, CheckResponse, SaveResponse } from '~/components/records/types'

const datensaetze = recordsService()

const route = useRoute()
const router = useRouter()
const { t, te } = useI18n()
const zeit = useDateTime()
const keepFocus = useKeepFocus()
const { hinweis, befund } = useMeldungstext()

const importId = computed(() => String(route.params.id ?? ''))
const recordId = computed(() => String(route.params.recordId ?? ''))

const { data: config, error: configError } = await useEditorKonfiguration()
const { data: detail, error: detailError } = await useDatensatz(importId, recordId)

const loadError = computed(() => {
  const e = detailError.value ?? configError.value
  return e ? failureText(t, te, apiFailure(e)) : ''
})

/* ------------------------------------------------------------- Formularmodell */

const ui = ref<UiRecord | null>(null)
const baseline = ref('')
const tab = ref<'work' | 'structure'>('work')
const showJson = ref(false)

function build() {
  if (detail.value == null || config.value == null) return
  ui.value = parseRecord(detail.value.avefi, config.value)
  baseline.value = JSON.stringify(serializeRecord(ui.value, config.value))
}
watch([detail, config], build, { immediate: true })

const output = computed(() =>
  ui.value === null || config.value == null ? null : serializeRecord(ui.value, config.value))
const jsonText = computed(() => (output.value === null ? '' : JSON.stringify(output.value, null, 2)))
const dirty = computed(() => output.value !== null && JSON.stringify(output.value) !== baseline.value)

const titleText = computed(() => {
  const name = ui.value?.work.titles[0]?.has_name.trim() ?? ''
  return name !== '' ? name : t('records.editor.untitled')
})

useHead({ title: () => t('records.editor.pageTitle', { title: titleText.value }) })

function enums(name: string): string[] {
  return config.value?.enums[name] ?? []
}

const subjectKinds = computed(() => config.value?.subjectKinds ?? [])
const activityCategories = computed(() => config.value?.activityCategories ?? [])
const eventCategories = computed(() => config.value?.eventCategories ?? [])
const resourceTypes = computed(() => Object.keys(config.value?.resourceTypes ?? {}))

/* ------------------------------------------------------------------- Pruefung */

/** Kernfelder des Datensatzes — dieselbe Angabe wie in der Liste. */
const core = ref<{ filled: number; total: number; missing: string[] } | null>(null)
const coreState = ref<'danger' | 'part' | 'full'>('part')
function coreLabel(key: string): string {
  return t(`records.table.coreField.${key}`)
}
const editedAt = ref<string | null>(null)
const check = ref<CheckResponse | null>(null)
const checking = ref(false)
const saving = ref(false)
const saved = ref(false)
const actionError = ref('')

watch(detail, (d) => {
  if (d == null) return
  core.value = d.record.core ?? null
  coreState.value = d.record.coreState ?? 'part'
  editedAt.value = d.record.editedAt
  check.value = null
}, { immediate: true })

async function runCheck() {
  if (output.value === null || checking.value) return
  return keepFocus(() => runCheckInner())
}

async function runCheckInner() {
  if (output.value === null) return
  checking.value = true
  actionError.value = ''
  try {
    // Der Ring zeigt weiter den gespeicherten Wert: Sonst spraenge er beim
    // Tippen und wuerde etwas versprechen, was noch nirgends steht.
    check.value = await datensaetze.pruefen(output.value)
  } catch (e) {
    actionError.value = failureText(t, te, apiFailure(e))
  } finally {
    checking.value = false
  }
}

async function save() {
  if (output.value === null || saving.value) return
  return keepFocus(() => saveInner())
}

async function saveInner() {
  if (output.value === null) return
  saving.value = true
  saved.value = false
  actionError.value = ''
  try {
    const res = await datensaetze.speichern(importId.value, recordId.value, output.value)
    core.value = res.core ?? null
    coreState.value = res.coreState ?? 'part'
    editedAt.value = res.editedAt
    check.value = res
    baseline.value = JSON.stringify(output.value)
    saved.value = true
  } catch (e) {
    actionError.value = failureText(t, te, apiFailure(e))
  } finally {
    saving.value = false
  }
}

const issues = computed(() => check.value?.issues ?? [])
const hints = computed(() => (check.value?.hints ?? detail.value?.hints ?? []).filter((h) => h.level !== 'ok'))

/* --------------------------------------------------- Ungespeicherte Aenderungen */

function beforeUnload(e: BeforeUnloadEvent) {
  if (!dirty.value) return
  e.preventDefault()
  e.returnValue = ''
}
onMounted(() => {
  window.addEventListener('beforeunload', beforeUnload)
  void runCheck()
})
onBeforeUnmount(() => window.removeEventListener('beforeunload', beforeUnload))

onBeforeRouteLeave(() => {
  if (!dirty.value) return true
  return window.confirm(t('records.editor.leave'))
})

/* -------------------------------------------------------------- Normdaten-Detail */

const detailRef = ref<{ source: string; id: string } | null>(null)
function openDetail(source: string, id: string) {
  detailRef.value = { source, id }
}

/* -------------------------------------------------------------- Titelverwaltung */

function addTitle() {
  ui.value?.work.titles.push(emptyTitle(DEFAULT_ALT_TITLE_TYPE))
}
function removeTitle(index: number) {
  // Der Haupttitel wird geleert, nicht entfernt: Position 0 ist der Haupttitel.
  if (index === 0) {
    const first = ui.value?.work.titles[0]
    if (first !== undefined) first.has_name = ''
    return
  }
  ui.value?.work.titles.splice(index, 1)
}
/**
 * Nur diese ausdrueckliche Handlung macht einen weiteren Titel zum Haupttitel.
 * Im PHP-Stand landeten Titelvorschlaege alle auf dem Haupttitel — gemeldeter Fehler.
 */
function makePrimary(index: number) {
  const titles = ui.value?.work.titles
  if (titles === undefined || index < 1) return
  const chosen = titles[index]
  const primary = titles[0]
  if (chosen === undefined || primary === undefined) return
  titles[0] = chosen
  titles[index] = primary
  if (chosen.type === DEFAULT_ALT_TITLE_TYPE) chosen.type = DEFAULT_PRIMARY_TITLE_TYPE
  if (primary.type === DEFAULT_PRIMARY_TITLE_TYPE) primary.type = DEFAULT_ALT_TITLE_TYPE
}

/* ------------------------------------------------------------- Sammelabgleich */

const matching = ref(false)
const matchMessage = ref('')

async function matchAll() {
  return keepFocus(() => matchAllInner())
}

async function matchAllInner() {
  const work = ui.value?.work
  if (work === undefined || matching.value) return
  const open = work.subjects.filter((s) => s.has_name.trim().length >= 3 && s.same_as.length === 0)
  if (open.length === 0) {
    matchMessage.value = t('records.editor.work.matchNone')
    return
  }
  matching.value = true
  matchMessage.value = ''
  let hit = 0
  await Promise.all(open.map(async (entity) => {
    const name = entity.has_name.trim()
    try {
      const res = await datensaetze.normdatenSuche(entity.kind, name)
      const split = splitMatches(name, res.results)
      if (split.confident.length > 0) {
        for (const found of split.confident) addSameAs(entity.same_as, found)
        entity.suggest = []
        entity.ambiguous = []
        hit++
      } else {
        // Mehrdeutig heisst: nichts eintragen, aber zur Auswahl stellen.
        entity.ambiguous = split.ambiguous
      }
    } catch {
      /* Eine Quelle, die nicht antwortet, blockiert den Rest nicht. */
    }
  }))
  matching.value = false
  matchMessage.value = t('records.editor.work.matchResult', { hit, total: open.length })
}

/* --------------------------------------------------------------- Kleinkram */

function removeAt<T>(list: T[], index: number) {
  list.splice(index, 1)
}
function addIdentifier(list: UiIdentifier[]) {
  list.push(emptyIdentifier())
}
function addValue(list: UiValue[]) {
  list.push(emptyValue())
}

/*
 * Zugaenglicher Name mit der Ebene davor.
 *
 * Kennungen, Notizen und Sprachen gibt es auf mehreren Ebenen. Ohne den Bezug
 * hiesse jeder dieser Knoepfe gleich, und wer die Bedienelemente der Reihe nach
 * durchgeht, koennte sie nicht auseinanderhalten.
 */
function inWork(text: string) {
  return t('records.editor.aria.inScope', { scope: t('records.editor.tabs.work'), text })
}
function inManifestation(index: number, text: string) {
  const scope = t('records.editor.manifestation.heading', { index: index + 1 })
  return t('records.editor.aria.inScope', { scope, text })
}
function inItem(index: number, text: string) {
  const scope = t('records.editor.item.heading', { index: index + 1 })
  return t('records.editor.aria.inScope', { scope, text })
}

/* ------------------------------------ Manifestation, Exemplar, Zugehoerigkeit */

/*
 * Ein Exemplar gehoert zu genau einer Manifestation. Das AVefi-Schema haelt diese
 * Beziehung in is_item_of fest, und der Import setzt sie auch — sichtbar war
 * sie nur nirgends, weil Werk, Manifestation und Exemplar als drei gleichrangige
 * Reiter nebeneinander standen. Gelesen und geschrieben wird hier deshalb
 * genau dieses Feld; erfunden wird nichts.
 */

/** Die lokale Kennung einer Manifestation — daran haengen ihre Exemplare. */
function manifestationId(m: UiManifestation): string {
  const local = m.identifiers.find((x) => x.resourceType === 'LocalResource' && x.id.trim() !== '')
  if (local !== undefined) return local.id.trim()
  const list = (m.raw as Record<string, unknown>).has_identifier
  if (Array.isArray(list)) {
    for (const entry of list) {
      if (typeof entry === 'object' && entry !== null) {
        const id = String((entry as Record<string, unknown>).id ?? '').trim()
        if (id !== '') return id
      }
    }
  }
  return ''
}

/** Zu welcher Manifestation gehoert dieses Exemplar? Leer heisst: zu keiner. */
function itemParent(it: UiItem): string {
  const link = (it.raw as Record<string, unknown>).is_item_of
  if (typeof link !== 'object' || link === null) return ''
  const one = Array.isArray(link) ? link[0] : link
  if (typeof one !== 'object' || one === null) return ''
  return String((one as Record<string, unknown>).id ?? '').trim()
}

function itemsOf(m: UiManifestation): UiItem[] {
  const id = manifestationId(m)
  if (id === '') return []
  return (ui.value?.items ?? []).filter((it) => itemParent(it) === id)
}

/**
 * Exemplare ohne erkennbare Manifestation.
 *
 * Sie werden nicht stillschweigend der ersten Manifestation untergeschoben: Wo die
 * Quelldatei keine Zuordnung hergibt, ist das eine Aussage ueber die Daten und
 * keine, die die Oberflaeche treffen darf.
 */
const orphanItems = computed<UiItem[]>(() => {
  const bekannt = new Set((ui.value?.manifestations ?? []).map(manifestationId).filter((x) => x !== ''))
  return (ui.value?.items ?? []).filter((it) => {
    const parent = itemParent(it)
    return parent === '' || !bekannt.has(parent)
  })
})

/** Ein neues Exemplar entsteht unter der Manifestation, unter der man es anlegt. */
function addItemTo(m: UiManifestation) {
  if (ui.value === null) return
  const neu = emptyItem(ui.value.work.titles[0]?.has_name ?? '')
  const id = manifestationId(m)
  if (id !== '') (neu.raw as Record<string, unknown>).is_item_of = { category: 'avefi:LocalResource', id }
  ui.value.items.push(neu)
}

/** Ein Exemplar einer Manifestation zuordnen. */
function assignItem(it: UiItem, index: string) {
  const m = ui.value?.manifestations[Number(index)]
  if (m === undefined) return
  const id = manifestationId(m)
  if (id === '') return
  ;(it.raw as Record<string, unknown>).is_item_of = { category: 'avefi:LocalResource', id }
}

const tabs = ['work', 'structure'] as const
function onTabKey(e: KeyboardEvent, index: number) {
  if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
  e.preventDefault()
  const next = (index + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length
  tab.value = tabs[next]!
  nextTick(() => document.getElementById(`tab-${tabs[next]}`)?.focus())
}

const pidOpen = ref(false)

function backToList() {
  void router.push(`/imports/${importId.value}/records`)
}
</script>

<template>
  <main id="main" class="appwrap">
    <nav class="crumbs" :aria-label="t('records.editor.crumb')">
      <NuxtLink to="/">{{ t('imports.heading') }}</NuxtLink>
      <span class="sep" aria-hidden="true">/</span>
      <NuxtLink :to="`/imports/${importId}`">{{ detail?.import.filename ?? importId }}</NuxtLink>
      <span class="sep" aria-hidden="true">/</span>
      <NuxtLink :to="`/imports/${importId}/records`">{{ t('records.crumb') }}</NuxtLink>
      <span class="sep" aria-hidden="true">/</span>
      <span>{{ titleText }}</span>
    </nav>

    <div role="alert" aria-live="assertive" v-if="loadError !== ''" class="ui-alert">
      {{ loadError }}
      <p style="margin:8px 0 0">
        <NuxtLink class="btn btn-outline btn-sm" :to="`/imports/${importId}/records`">
          {{ t('records.editor.backToList') }}
        </NuxtLink>
      </p>
    </div>

    <template v-else-if="ui !== null && detail != null && config != null">
      <div class="editbar">
        <h1 class="ed-title">{{ titleText }}</h1>
        <!-- Benannte Angaben statt eines Anteils, wie in der Datensatzliste
             seit dem 31.08.: Ein Prozentwert am Einzeldatensatz bewertet die
             Daten, statt zu sagen, was fehlt. In der Liste war er ersetzt, in
             der Detailansicht stand er weiter — gemeldet von Stefan Stretz
             am 01.09.2026. -->
        <p v-if="core !== null" class="ed-core">
          <span class="core" :class="`core-${coreState}`">
            {{ t('records.table.coreValue', { filled: core.filled, total: core.total }) }}
          </span>
          <span v-if="core.missing.length" class="dim small core-missing">{{
            t('records.table.coreMissing', { fields: core.missing.map(coreLabel).join(', ') }) }}</span>
        </p>
        <div class="ed-actions">
          <NuxtLink v-if="detail.prev !== null" class="btn btn-outline btn-sm"
                    :to="`/imports/${importId}/records/${detail.prev}`"><span
                      aria-hidden="true">←</span> {{ t('records.editor.prev') }}</NuxtLink>
          <NuxtLink v-if="detail.next !== null" class="btn btn-outline btn-sm"
                    :to="`/imports/${importId}/records/${detail.next}`">{{ t('records.editor.next') }} <span
                      aria-hidden="true">→</span></NuxtLink>
          <button type="button" class="btn btn-outline btn-sm" :aria-expanded="showJson"
                  aria-controls="record-json" @click="showJson = !showJson">
            <span aria-hidden="true">{ }</span> {{ t('records.editor.json') }}
          </button>
          <button type="button" class="btn btn-outline btn-sm" @click="pidOpen = true">
            <span aria-hidden="true">🔗</span> {{ t('records.editor.pid') }}
          </button>
          <button type="button" class="btn btn-primary btn-sm" :disabled="saving" @click="save">
            {{ saving ? t('records.editor.saving') : t('records.editor.save') }}
          </button>
        </div>
      </div>

      <p class="dim small" style="margin:-8px 0 12px">
        <span v-if="detail.record.sourceRow !== null">
          {{ t('records.editor.sourceRow', { row: detail.record.sourceRow }) }}
        </span>
        <span v-if="editedAt"> · {{ t('records.editor.editedAt', { when: zeit(editedAt) }) }}</span>
      </p>

      <div class="live-region" role="alert" aria-live="assertive">
        <div v-if="config.schemaError" class="ui-alert" style="margin-bottom:12px">
          {{ t('records.editor.schemaMissing', { reason: config.schemaError }) }}
        </div>
      </div>

      <div class="live-region" role="alert" aria-live="assertive">
        <div v-if="actionError !== ''" class="ui-alert" style="margin-bottom:12px">{{ actionError }}</div>
      </div>
      <div role="status" aria-live="polite" v-if="saved" class="ui-alert-ok" style="margin-bottom:12px">{{ t('records.editor.saved') }}</div>
      <div v-else-if="dirty" class="dim small" role="status" style="margin-bottom:12px">
        {{ t('records.editor.unsaved') }}
      </div>

      <!-- Pruefung -->
      <section class="ui-card" style="margin-bottom:16px" aria-labelledby="check-heading">
        <div class="ed-card-head">
          <h2 id="check-heading" class="side-h" style="margin:0">{{ t('records.editor.check.heading') }}</h2>
          <button type="button" class="btn btn-outline btn-sm" :disabled="checking" @click="runCheck">
            {{ checking ? t('records.editor.check.running') : t('records.editor.check.run') }}
          </button>
        </div>
        <p class="note" style="margin-top:0">{{ t('records.editor.check.explain') }}</p>

        <div aria-live="polite">
          <p v-if="check === null" class="dim small">{{ t('records.editor.check.never') }}</p>
          <div v-else-if="check.unavailable !== null" class="ui-alert" role="alert" style="margin:0">
            {{ t('records.editor.check.unavailable', { reason: check.unavailable }) }}
          </div>
          <div v-else-if="issues.length === 0" class="ui-alert-ok" style="margin:0">
            <span aria-hidden="true">✓</span> {{ t('records.editor.check.ok') }}
          </div>
          <div v-else class="ui-alert" style="margin:0">
            <b>{{ t('records.editor.check.errors', { count: issues.length }, issues.length) }}</b>
            — {{ t('records.editor.check.saveAnyway') }}
            <ul class="ed-errs">
              <li v-for="(issue, i) in issues" :key="i">
                <span v-if="issue.targetField" class="mono small">{{ issue.targetField }}: </span>{{ befund(issue) }}
                <span v-if="issue.value" class="dim small"> („{{ issue.value }}“)</span>
              </li>
            </ul>
          </div>
        </div>

        <div style="margin-top:12px">
          <h3 class="side-h" style="margin-bottom:4px">{{ t('records.editor.check.hintsHeading') }}</h3>
          <p class="note" style="margin-top:0">{{ t('records.editor.check.hintsExplain') }}</p>
          <p v-if="hints.length === 0" class="okval">{{ t('records.editor.check.hintsOk') }}</p>
          <ul v-else class="ed-errs">
            <li v-for="(hint, i) in hints" :key="i">{{ hinweis(hint) }}</li>
          </ul>
        </div>
      </section>

      <!-- Der Kasten rollt und enthaelt kein Bedienelement: ohne tabindex kaeme
           man mit der Tastatur nicht an den unteren Teil des JSON. -->
      <pre v-if="showJson" id="record-json" class="jsonprev" tabindex="0" role="region"
           :aria-label="t('records.editor.jsonLabel')">{{ jsonText }}</pre>
      <p v-if="showJson" class="note">{{ t('records.editor.jsonHint') }}</p>

      <!-- Reiter -->
      <div class="ed-tabs" role="tablist" :aria-label="t('records.crumb')">
        <button v-for="(name, i) in tabs" :id="`tab-${name}`" :key="name" type="button" role="tab"
                :class="{ on: tab === name }" :aria-selected="tab === name"
                :aria-controls="`panel-${name}`" :tabindex="tab === name ? 0 : -1"
                @click="tab = name" @keydown="onTabKey($event, i)">
          <template v-if="name === 'work'">{{ t('records.editor.tabs.work') }}</template>
          <template v-else>{{ t('records.editor.tabs.structure', {
            manifestations: ui.manifestations.length, items: ui.items.length }) }}</template>
        </button>
      </div>

      <!-- WERK -->
      <section v-show="tab === 'work'" id="panel-work" class="ed-tabpanel" role="tabpanel"
               aria-labelledby="tab-work" tabindex="0">
        <div class="ed-card">
          <h2>{{ t('records.editor.work.basics') }}</h2>
          <div class="ed-grid2">
            <div class="ed-f">
              <label for="w-type">{{ t('records.editor.work.type') }}</label>
              <RecordsEnumSelect id="w-type" v-model="ui.work.type" :values="enums('WorkVariantTypeEnum')" />
            </div>
            <div class="ed-f">
              <label for="w-variant">{{ t('records.editor.work.variantType') }}</label>
              <RecordsEnumSelect id="w-variant" v-model="ui.work.variant_type" :values="enums('VariantTypeEnum')" />
            </div>
            <div class="ed-f">
              <label for="w-year">{{ t('records.editor.work.productionYear') }}</label>
              <input id="w-year" v-model="ui.work.productionYear" class="ui-input" type="text"
                     aria-describedby="w-year-hint">
              <span id="w-year-hint" class="note">{{ t('records.editor.work.productionYearHint') }}</span>
            </div>
          </div>

          <div class="ed-sub">
            <span class="ed-sublabel">{{ t('records.editor.work.productionPlace') }}</span>
            <div v-for="(place, i) in ui.work.productionPlaces" :key="place.key" class="ed-title-row">
              <input v-model="place.has_name" class="ui-input" type="text"
                     :aria-label="t('records.editor.work.productionPlace')">
              <button type="button" class="iconbtn-del"
                      :aria-label="t('records.editor.work.removeProductionPlace', { index: i + 1 })"
                      @click="removeAt(ui.work.productionPlaces, i)"><span aria-hidden="true">🗑</span></button>
            </div>
            <button type="button" class="btn btn-outline btn-sm"
                    @click="ui.work.productionPlaces.push({ key: nextKey(), has_name: '', raw: {} })">
              <span aria-hidden="true">+</span> {{ t('records.editor.work.addProductionPlace') }}
            </button>
          </div>
        </div>

        <div class="ed-card">
          <h2>{{ t('records.editor.work.titles') }}</h2>
          <div v-for="(title, i) in ui.work.titles" :key="title.key" class="ed-title-row">
            <input :id="`title-${title.key}`" v-model="title.has_name" class="ui-input" type="text"
                   :aria-label="i === 0 ? t('records.editor.work.primaryTitle') : t('records.editor.work.altTitle')"
                   :placeholder="i === 0 ? t('records.editor.work.primaryTitle') : t('records.editor.work.altTitle')">
            <RecordsEnumSelect :id="`title-type-${title.key}`" v-model="title.type" :values="enums('TitleTypeEnum')"
                               :label="t('records.editor.work.titleType')" />
            <span v-if="i === 0" class="ed-primary-badge">{{ t('records.editor.work.primaryBadge') }}</span>
            <button v-else type="button" class="btn btn-outline ui-btn-xs"
                    :title="t('records.editor.work.makePrimaryHint')"
                    :aria-label="t('records.editor.aria.inScope', {
                      scope: t('records.editor.work.titleNumber', { index: i + 1 }),
                      text: t('records.editor.work.makePrimary')
                    })"
                    @click="makePrimary(i)">
              {{ t('records.editor.work.makePrimary') }}
            </button>
            <button type="button" class="iconbtn-del"
                    :aria-label="t('records.editor.work.removeTitle', { index: i + 1 })"
                    @click="removeTitle(i)"><span aria-hidden="true">🗑</span></button>
          </div>
          <button type="button" class="btn btn-outline btn-sm" @click="addTitle">
            <span aria-hidden="true">+</span> {{ t('records.editor.work.addTitle') }}
          </button>
        </div>

        <div class="ed-card">
          <div class="ed-card-head">
            <h2>{{ t('records.editor.work.subjects') }}</h2>
            <button type="button" class="btn btn-outline btn-sm" :disabled="matching" @click="matchAll">
              {{ matching ? t('records.editor.work.matching') : t('records.editor.work.matchAll') }}
            </button>
          </div>
          <p class="note" style="margin-top:0">{{ t('records.editor.work.subjectsHint') }}</p>
          <div class="live-region" role="status" aria-live="polite">
            <p v-if="matchMessage !== ''" class="okval">{{ matchMessage }}</p>
          </div>
          <RecordsEntityRow v-for="(entity, i) in ui.work.subjects" :key="entity.key" :entity="entity"
                            :kinds="subjectKinds" :id-prefix="`subject-${entity.key}`"
                            :index="i + 1" :remove-label="t('records.editor.removeEntry', { index: i + 1 })"
                            @remove="removeAt(ui.work.subjects, i)" @detail="openDetail" />
          <button type="button" class="btn btn-outline btn-sm" @click="ui.work.subjects.push(emptyEntity('subject'))">
            <span aria-hidden="true">+</span> {{ t('records.editor.work.addSubject') }}
          </button>
        </div>

        <div class="ed-card">
          <h2>{{ t('records.editor.work.activities') }}</h2>
          <p class="note" style="margin-top:0">{{ t('records.editor.work.activitiesHint') }}</p>
          <RecordsActivityRow v-for="(act, i) in ui.work.activities" :key="act.key" :act="act"
                              :categories="activityCategories" :config="config" :id-prefix="`act-${act.key}`"
                              :index="i + 1"
                              :remove-label="t('records.editor.activity.remove', { index: i + 1 })"
                              @remove="removeAt(ui.work.activities, i)" @detail="openDetail" />
          <button type="button" class="btn btn-outline btn-sm"
                  @click="ui.work.activities.push(emptyActivity('avefi:DirectingActivity'))">
            <span aria-hidden="true">+</span> {{ t('records.editor.work.addActivity') }}
          </button>
        </div>

        <div class="ed-card">
          <h2>{{ t('records.editor.work.events') }}</h2>
          <div v-for="(event, i) in ui.work.events" :key="event.key" class="ed-title-row">
            <select v-model="event.category" class="ui-input" :aria-label="t('records.editor.work.eventCategory')">
              <option v-for="c in eventCategories" :key="c.category" :value="c.category">
                {{ t(`records.editor.event.${c.category}`) }}
              </option>
            </select>
            <RecordsEnumSelect :id="`event-type-${event.key}`" v-model="event.type"
                               :values="enums(eventCategories.find((c) => c.category === event.category)?.enumName ?? '')"
                               :label="t('records.editor.work.eventType')"
                               :placeholder="t('records.editor.work.eventType')" />
            <input v-model="event.has_date" class="ui-input" type="text"
                   :aria-label="t('records.editor.work.eventDate')"
                   :placeholder="t('records.editor.work.eventDate')">
            <button type="button" class="iconbtn-del" :aria-label="t('records.editor.work.removeEvent', { index: i + 1 })"
                    @click="removeAt(ui.work.events, i)"><span aria-hidden="true">🗑</span></button>
          </div>
          <button type="button" class="btn btn-outline btn-sm"
                  @click="ui.work.events.push(emptyEvent('avefi:PublicationEvent'))">
            <span aria-hidden="true">+</span> {{ t('records.editor.work.addEvent') }}
          </button>
        </div>

        <div class="ed-card">
          <h2>{{ t('records.editor.work.genres') }}</h2>
          <RecordsEntityRow v-for="(genre, i) in ui.work.genres" :key="genre.key" :entity="genre"
                            :kinds="subjectKinds" fixed-kind :id-prefix="`genre-${genre.key}`"
                            :index="i + 1" :remove-label="t('records.editor.work.removeGenre', { index: i + 1 })"
                            @remove="removeAt(ui.work.genres, i)" @detail="openDetail" />
          <button type="button" class="btn btn-outline btn-sm" @click="ui.work.genres.push(emptyEntity('genre'))">
            <span aria-hidden="true">+</span> {{ t('records.editor.work.addGenre') }}
          </button>

          <div class="ed-forms">
            <div v-for="(form, i) in ui.work.forms" :key="form.key" class="ed-title-row">
              <RecordsEnumSelect :id="`form-${form.key}`" v-model="form.value" :values="enums('WorkFormEnum')"
                                 :label="t('records.editor.work.form')"
                                 :placeholder="t('records.editor.work.form')" />
              <button type="button" class="iconbtn-del" :aria-label="t('records.editor.work.removeForm', { index: i + 1 })"
                      @click="removeAt(ui.work.forms, i)"><span aria-hidden="true">🗑</span></button>
            </div>
            <button type="button" class="btn btn-outline btn-sm" @click="addValue(ui.work.forms)">
              <span aria-hidden="true">+</span> {{ t('records.editor.work.addForm') }}
            </button>
          </div>
        </div>

        <div class="ed-card">
          <h2>{{ t('records.editor.work.identifiers') }}</h2>
          <div v-for="(id, i) in ui.work.identifiers" :key="id.key" class="ed-title-row">
            <select v-model="id.resourceType" class="ui-input" :aria-label="t('records.editor.work.identifierType')">
              <option v-for="name in resourceTypes" :key="name" :value="name">
                {{ te(`records.editor.resource.${name}`) ? t(`records.editor.resource.${name}`) : name }}
              </option>
            </select>
            <input v-model="id.id" class="ui-input" type="text" :aria-label="t('records.editor.work.identifier')"
                   :placeholder="t('records.editor.work.identifier')">
            <button type="button" class="iconbtn-del"
                    :aria-label="inWork(t('records.editor.work.removeIdentifier', { index: i + 1 }))"
                    @click="removeAt(ui.work.identifiers, i)"><span aria-hidden="true">🗑</span></button>
          </div>
          <button type="button" class="btn btn-outline btn-sm"
                  :aria-label="inWork(t('records.editor.work.addIdentifier'))"
                  @click="addIdentifier(ui.work.identifiers)">
            <span aria-hidden="true">+</span> {{ t('records.editor.work.addIdentifier') }}
          </button>

          <div class="ed-forms">
            <div v-for="(note, i) in ui.work.notes" :key="note.key" class="ed-title-row">
              <input v-model="note.value" class="ui-input" type="text" :aria-label="t('records.editor.work.note')"
                     :placeholder="t('records.editor.work.note')">
              <button type="button" class="iconbtn-del"
                      :aria-label="inWork(t('records.editor.work.removeNote', { index: i + 1 }))"
                      @click="removeAt(ui.work.notes, i)"><span aria-hidden="true">🗑</span></button>
            </div>
            <button type="button" class="btn btn-outline btn-sm"
                    :aria-label="inWork(t('records.editor.work.addNote'))"
                    @click="addValue(ui.work.notes)">
              <span aria-hidden="true">+</span> {{ t('records.editor.work.addNote') }}
            </button>
          </div>
        </div>
      </section>

      <!-- MANIFESTATIONEN -->
      <section v-show="tab === 'structure'" id="panel-structure" class="ed-tabpanel" role="tabpanel"
               aria-labelledby="tab-structure" tabindex="0">
        <p class="note">{{ t('records.editor.structure.lead') }}</p>
        <p v-if="ui.manifestations.length === 0" class="dim">{{ t('records.editor.manifestation.empty') }}</p>
        <div v-for="(m, i) in ui.manifestations" :key="m.key" class="ed-card">
          <div class="ed-card-head">
            <h2>{{ t('records.editor.manifestation.heading', { index: i + 1 }) }}</h2>
            <button type="button" class="iconbtn-del"
                    :aria-label="t('records.editor.manifestation.remove', { index: i + 1 })"
                    @click="removeAt(ui.manifestations, i)"><span aria-hidden="true">🗑</span></button>
          </div>
          <div class="ed-title-row">
            <input v-model="m.title.has_name" class="ui-input" type="text"
                   :aria-label="t('records.editor.manifestation.title')"
                   :placeholder="t('records.editor.manifestation.title')">
            <RecordsEnumSelect :id="`m-title-type-${m.key}`" v-model="m.title.type" :values="enums('TitleTypeEnum')"
                               :label="t('records.editor.work.titleType')" />
          </div>
          <div v-for="(id, j) in m.identifiers" :key="id.key" class="ed-title-row">
            <select v-model="id.resourceType" class="ui-input" :aria-label="t('records.editor.work.identifierType')">
              <option v-for="name in resourceTypes" :key="name" :value="name">
                {{ te(`records.editor.resource.${name}`) ? t(`records.editor.resource.${name}`) : name }}
              </option>
            </select>
            <input v-model="id.id" class="ui-input" type="text" :aria-label="t('records.editor.work.identifier')">
            <button type="button" class="iconbtn-del"
                    :aria-label="inManifestation(i, t('records.editor.work.removeIdentifier', { index: j + 1 }))"
                    @click="removeAt(m.identifiers, j)"><span aria-hidden="true">🗑</span></button>
          </div>
          <button type="button" class="btn btn-outline btn-sm"
                  :aria-label="inManifestation(i, t('records.editor.work.addIdentifier'))"
                  @click="addIdentifier(m.identifiers)">
            <span aria-hidden="true">+</span> {{ t('records.editor.work.addIdentifier') }}
          </button>
          <div v-for="(note, j) in m.notes" :key="note.key" class="ed-title-row" style="margin-top:8px">
            <input v-model="note.value" class="ui-input" type="text" :aria-label="t('records.editor.work.note')">
            <button type="button" class="iconbtn-del"
                    :aria-label="inManifestation(i, t('records.editor.work.removeNote', { index: j + 1 }))"
                    @click="removeAt(m.notes, j)"><span aria-hidden="true">🗑</span></button>
          </div>
          <button type="button" class="btn btn-outline btn-sm"
                  :aria-label="inManifestation(i, t('records.editor.work.addNote'))"
                  @click="addValue(m.notes)">
            <span aria-hidden="true">+</span> {{ t('records.editor.work.addNote') }}
          </button>
          <p class="note">{{ t('records.editor.manifestation.kept') }}</p>

          <!-- Die Exemplare DIESER Manifestation, eingerueckt darunter. Ein Exemplar
               gehoert zu genau einer Manifestation; als gleichrangiger Reiter war
               diese Beziehung unsichtbar. -->
          <div class="ed-children">
            <h3 class="ed-childhead">
              {{ t('records.editor.structure.itemsOf', {
                manifestation: i + 1, count: itemsOf(m).length }) }}
            </h3>
            <RecordsItemCard v-for="(it, j) in itemsOf(m)" :key="it.key" :item="it" :index="ui.items.indexOf(it)"
                             :heading="t('records.editor.structure.itemHeading', {
                               index: j + 1, manifestation: i + 1 })"
                             :enums="enums" :resource-types="resourceTypes"
                             @remove="removeAt(ui.items, ui.items.indexOf(it))" />
            <button type="button" class="btn btn-outline btn-sm"
                    :aria-label="inManifestation(i, t('records.editor.item.add'))"
                    @click="addItemTo(m)">
              <span aria-hidden="true">+</span> {{ t('records.editor.item.add') }}
            </button>
          </div>
        </div>

        <button type="button" class="btn btn-outline"
                @click="ui.manifestations.push(emptyManifestation(ui.work.titles[0]?.has_name ?? ''))">
          <span aria-hidden="true">+</span> {{ t('records.editor.manifestation.add') }}
        </button>

        <!-- Exemplare ohne Manifestation: nicht verstecken, sondern benennen. Sie
             entstehen, wenn eine Quelldatei keine Zuordnung hergibt. -->
        <section v-if="orphanItems.length > 0" class="ed-orphans">
          <h2>{{ t('records.editor.structure.orphanHeading', { count: orphanItems.length }) }}</h2>
          <p class="note">{{ t('records.editor.structure.orphanLead') }}</p>
          <div v-for="it in orphanItems" :key="it.key" class="ed-orphan">
            <RecordsItemCard :item="it" :index="ui.items.indexOf(it)"
                             :heading="t('records.editor.structure.orphanItemHeading', {
                               index: orphanItems.indexOf(it) + 1 })"
                             :enums="enums" :resource-types="resourceTypes"
                             @remove="removeAt(ui.items, ui.items.indexOf(it))" />
            <label v-if="ui.manifestations.length > 0" class="ed-assign">
              {{ t('records.editor.structure.assign') }}
              <select class="ui-input" :value="''" @change="assignItem(it, ($event.target as HTMLSelectElement).value)">
                <option value="">{{ t('records.editor.structure.assignNone') }}</option>
                <option v-for="(m, mi) in ui.manifestations" :key="m.key" :value="String(mi)">
                  {{ t('records.editor.manifestation.heading', { index: mi + 1 }) }}
                </option>
              </select>
            </label>
          </div>
        </section>
      </section>

      <p style="margin-top:18px">
        <button type="button" class="btn btn-outline btn-sm" @click="backToList">
          ← {{ t('records.editor.backToList') }}
        </button>
      </p>

      <RecordsAuthorityDetail v-if="detailRef !== null" :source="detailRef.source" :id="detailRef.id"
                              @close="detailRef = null" />

      <ImportsConfirmDialog :open="pidOpen" :title="t('records.editor.pidTitle')" :message="t('records.editor.pidText')"
                            :ok-text="t('records.editor.close')" @confirm="pidOpen = false" @cancel="pidOpen = false" />
    </template>

    <p v-else class="dim">{{ t('records.editor.loading') }}</p>
  </main>
</template>
