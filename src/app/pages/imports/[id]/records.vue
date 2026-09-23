<script setup lang="ts">
import { importsService } from '~/services/imports'
/**
 * Datensaetze eines Imports.
 *
 * Zur Verschachtelung: Weil daneben app/pages/imports/[id]/records/[recordId].vue
 * liegt, macht Nuxt aus dieser Datei die Elternroute. Sie zeigt deshalb
 * entweder die Liste (Pfad ohne Datensatznummer) oder die Kindseite — sonst
 * bekaeme man Liste und Editor uebereinander.
 *
 * Gesucht und geblaettert wird auf dem Server: Bei 2.738 Werken taugt ein
 * Filter ueber die zufaellig geladenen Zeilen nicht.
 */
import { apiFailure, failureText } from '~/components/records/errors'
import { formatNumber } from '~/components/imports/format'

const importe = importsService()

const route = useRoute()
const { t, te, locale } = useI18n()

const importId = computed(() => String(route.params.id ?? ''))
const isChild = computed(() => route.params.recordId !== undefined)

const search = ref(String(route.query.q ?? ''))
const query = ref(String(route.query.q ?? ''))
const offset = ref(Number(route.query.offset ?? 0) || 0)
const limit = 50

// Immer laden, auch wenn gerade der Editor angezeigt wird: Diese Komponente
// bleibt beim Wechsel in den Editor stehen. Wuerde sie beim Einstieg ueber einen
// Deeplink auf einen Datensatz nichts laden, waere die Liste danach leer.
const { data, error, refresh } = await useImportDatensaetze(importId, { q: query, limit, offset })

const loadError = computed(() => (error.value ? failureText(t, te, apiFailure(error.value)) : ''))
const item = computed(() => data.value?.import ?? null)
const records = computed(() => data.value?.records ?? [])
const total = computed(() => data.value?.total ?? 0)
const filtered = computed(() => data.value?.filtered ?? 0)
const edited = computed(() => data.value?.edited ?? 0)

useHead({
  title: () => (item.value ? t('records.pageTitle', { file: item.value.filename }) : t('records.crumb'))
})

const from = computed(() => (filtered.value === 0 ? 0 : offset.value + 1))
const to = computed(() => Math.min(offset.value + limit, filtered.value))
const canPrev = computed(() => offset.value > 0)
const canNext = computed(() => offset.value + limit < filtered.value)

function submitSearch() {
  query.value = search.value.trim()
  offset.value = 0
}

function clearSearch() {
  search.value = ''
  submitSearch()
}

const prevButton = ref<HTMLButtonElement | null>(null)
const nextButton = ref<HTMLButtonElement | null>(null)

/**
 * Blaettern und den Fokus behalten.
 *
 * Am Rand des Bereichs wird der gedrueckte Knopf gesperrt und verliert dabei
 * den Fokus an <body>. Der Fokus geht dann auf den Knopf der Gegenrichtung,
 * damit man nicht wieder von vorn tabben muss.
 */
function page(delta: number) {
  offset.value = Math.max(0, offset.value + delta * limit)
  void nextTick(() => {
    const gedrueckt = delta < 0 ? prevButton.value : nextButton.value
    const andere = delta < 0 ? nextButton.value : prevButton.value
    if (gedrueckt !== null && !gedrueckt.disabled) gedrueckt.focus()
    else andere?.focus()
  })
}

/** Nach dem Speichern im Editor soll die Liste den neuen Stand zeigen. */
watch(isChild, (child) => {
  if (!child) void refresh()
})
</script>

<template>
  <NuxtPage v-if="isChild" />

  <main v-else id="main" class="appwrap">
    <nav class="crumbs" :aria-label="t('records.crumb')">
      <NuxtLink to="/">{{ t('imports.heading') }}</NuxtLink>
      <span class="sep" aria-hidden="true">/</span>
      <NuxtLink :to="`/imports/${importId}`">{{ item?.filename ?? importId }}</NuxtLink>
      <span class="sep" aria-hidden="true">/</span>
      <span>{{ t('records.crumb') }}</span>
    </nav>

    <div role="alert" aria-live="assertive" v-if="loadError !== ''" class="ui-alert">{{ loadError }}</div>

    <template v-else-if="item !== null">
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:16px">
        <h1 style="font-size:19px">{{ item.filename }}</h1>
        <span v-if="item.base_format" class="fmt">{{ item.base_format.toUpperCase() }}</span>
        <span class="dim small">{{ t('records.works', { count: formatNumber(total, locale) }, total) }}</span>
        <span v-if="edited > 0" class="badge b-info" :title="t('records.editedHint')">
          {{ t('records.editedCount', { count: edited }) }}
        </span>
        <div style="margin-left:auto;display:flex;gap:8px;align-items:center">
          <NuxtLink class="btn btn-outline btn-sm" :to="`/imports/${importId}`">{{ t('records.toImport') }}</NuxtLink>
          <a class="btn btn-outline btn-sm" :href="importe.avefiJsonPfad(importId)">
            <span aria-hidden="true">⤓</span> {{ t('records.download') }}</a>
        </div>
      </div>

      <form class="urlform" style="margin:0 0 14px" role="search" @submit.prevent="submitSearch">
        <label class="sr-only" for="record-search">{{ t('records.search.label') }}</label>
        <input id="record-search" v-model="search" class="ui-input" type="search"
               :placeholder="t('records.search.placeholder')" style="max-width:280px">
        <button class="btn btn-outline btn-sm" type="submit">{{ t('records.search.submit') }}</button>
        <button v-if="query !== ''" class="btn btn-outline btn-sm" type="button" @click="clearSearch">
          {{ t('records.search.clear') }}
        </button>
        <span role="status" aria-live="polite" v-if="query !== ''" class="dim small">
          {{ t('records.search.hits', { count: formatNumber(filtered, locale), total: formatNumber(total, locale) }) }}
        </span>
        <span v-else class="note" style="margin:0">{{ t('records.search.hint') }}</span>
      </form>

      <div v-if="total === 0" class="tablewrap">
        <div class="empty">
          <div class="ic" aria-hidden="true">🎬</div>
          <p class="fn" style="font-size:15px;margin-bottom:4px">{{ t('records.empty.heading') }}</p>
          <p class="small">{{ t('records.empty.text') }}</p>
          <p style="margin-top:12px">
            <NuxtLink class="btn btn-outline btn-sm" :to="`/imports/${importId}`">
              {{ t('records.empty.toImport') }}
            </NuxtLink>
          </p>
        </div>
      </div>

      <div v-else-if="records.length === 0" class="tablewrap">
        <div class="empty">
          <p class="fn" style="font-size:15px">{{ t('records.search.none', { q: query }) }}</p>
          <p style="margin-top:12px">
            <button class="btn btn-outline btn-sm" type="button" @click="clearSearch">
              {{ t('records.search.clear') }}
            </button>
          </p>
        </div>
      </div>

      <template v-else>
        <RecordsRecordTable :records="records" :import-id="importId" />

        <div v-if="filtered > limit" style="display:flex;align-items:center;gap:12px;margin-top:12px">
          <button ref="prevButton" class="btn btn-outline btn-sm" type="button" :disabled="!canPrev"
                  @click="page(-1)">
            {{ t('records.paging.prev') }}
          </button>
          <span class="dim small tnum" role="status">
            {{ t('records.paging.showing', { from, to, total: formatNumber(filtered, locale) }) }}
          </span>
          <button ref="nextButton" class="btn btn-outline btn-sm" type="button" :disabled="!canNext"
                  @click="page(1)">
            {{ t('records.paging.next') }}
          </button>
        </div>

        <p class="note">{{ t('records.note') }}</p>
      </template>
    </template>
  </main>
</template>
