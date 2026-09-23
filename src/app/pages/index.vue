<script setup lang="ts">
import { importsService } from '~/services/imports'
/**
 * Importuebersicht: hochladen und sehen, was daraus geworden ist.
 *
 * Die Liste haelt sich selbst aktuell, solange etwas laeuft. Im PHP-Stand
 * fehlte das und wurde beanstandet: „In Konvertierung" blieb stehen, bis
 * jemand neu lud, und niemand wusste, ob noch gearbeitet wird.
 */
import { apiFailure, failureText, type ApiFailure } from '~/components/imports/errors'
import { formatNumber } from '~/components/imports/format'
import { BUSY_STATES, type ImportStatusResponse } from '~/components/imports/types'

const importe = importsService()

const { t, te, locale } = useI18n()
const route = useRoute()
useHead({ title: () => t('imports.pageTitle') })

/*
 * Sortierung und Filter stehen in der Adresse (#2, Matti Stoehr). Wer eine
 * gefilterte Liste weitergibt, gibt die Auswahl mit — und wer die Seite neu
 * laedt, bekommt dieselbe zurueck. Gerechnet wird auf dem Server, ueber den
 * ganzen Bestand statt ueber das, was gerade sichtbar ist.
 */
const auswahl = computed<Record<string, string>>(() => {
  const q = route.query
  const raus: Record<string, string> = {}
  for (const k of ['sort', 'dir', 'status', 'issues', 'q'] as const) {
    const v = String(q[k] ?? '').trim()
    if (v !== '') raus[k] = v
  }
  return raus
})

const { data, refresh, error } = await useImportListe(auswahl)

const sortierung = computed(() => data.value?.sort ?? { field: 'created' as const, dir: 'desc' as const })
const counts = computed(() => data.value?.counts ?? { total: 0, loaded: 0, shown: 0 })
const suche = ref(String(route.query.q ?? ''))
const nurBeanstandet = computed(() => String(route.query.issues ?? '') === '1')

/** Auswahl aendern heisst: Adresse aendern. Alles andere folgt daraus. */
async function setzeAuswahl(teil: Record<string, string | null>) {
  const q: Record<string, string> = { ...auswahl.value }
  for (const [k, v] of Object.entries(teil)) {
    if (v === null || v === '') delete q[k]
    else q[k] = v
  }
  await navigateTo({ path: '/', query: q })
}

function sortiereNach(feld: string) {
  const gleich = sortierung.value.field === feld
  // Beim Wechsel des Feldes die naheliegende Richtung: Namen aufsteigend,
  // Zahlen und Zeitpunkte absteigend — das Groesste zuerst ist dort das,
  // wonach jemand sucht.
  const start = feld === 'filename' || feld === 'status' ? 'asc' : 'desc'
  const dir = gleich ? (sortierung.value.dir === 'asc' ? 'desc' : 'asc') : start
  return setzeAuswahl({ sort: feld === 'created' && dir === 'desc' ? null : feld, dir })
}

const loadFailure = computed<ApiFailure | null>(() => (error.value ? apiFailure(error.value) : null))
const loadError = computed(() => failureText(t, te, loadFailure.value))

const items = computed(() => data.value?.imports ?? [])
const kpi = computed(() => data.value?.kpi ?? { records: 0, awaiting: 0 })
const busy = computed(() => items.value.some((i) => BUSY_STATES.has(i.status)))

/** Was sich ohne Seitenwechsel aendert, muss angesagt werden. */
const announcement = ref('')

/**
 * Sichtbare Rueckmeldung zu einer eben ausgefuehrten Handlung.
 * Sie steht zusaetzlich in der Ansage: Wer nicht sieht, soll nicht raten.
 */
const notice = ref('')

// Nach der Blattauswahl kommt die Zahl der angelegten Importe als Parameter
// zurueck. Ohne diese Zeile stuende der Mensch vor einer Liste, in der sich
// still etwas geaendert hat.
onMounted(() => {
  const created = Number(route.query.sheets ?? 0)
  if (created > 0) {
    notice.value = t('imports.sheets.started', { count: created }, created)
    announcement.value = notice.value
    navigateTo({ path: '/', query: {} }, { replace: true })
    return
  }
  // Aus dem Zuordnungseditor mit "Speichern und konvertieren": Die Meldung
  // ueber die neue Profilversion entstand dort und ging beim Seitenwechsel
  // verloren. Sie kommt als Parameter mit und wird hier ausgesprochen.
  const gespeichert = String(route.query.gespeichert ?? '')
  const version = Number(route.query.version ?? 0)
  if (gespeichert !== '' && version > 0) {
    notice.value = t('imports.toast.savedAndConverting', { name: gespeichert, version })
    announcement.value = notice.value
    navigateTo({ path: '/', query: {} }, { replace: true })
  }
})

function setNotice(text: string) {
  notice.value = text
  announcement.value = text
}

let timer: ReturnType<typeof setInterval> | null = null

function stop() {
  if (timer !== null) {
    clearInterval(timer)
    timer = null
  }
}

async function poll() {
  const status = await importe.stand<ImportStatusResponse>()
  if (status === null) {
    stop()
    return
  }

  let changed = status.count !== items.value.length ? 1 : 0
  for (const item of items.value) {
    const now = status.imports[item.id]
    if (now === undefined) {
      changed++
      continue
    }
    if (
      now.status !== item.status ||
      now.records !== item.record_count ||
      now.progress !== item.upload_progress
    ) {
      changed++
    }
  }

  if (changed > 0) {
    await refresh()
    announcement.value = t('imports.table.updated', { count: changed }, changed)
  }
  if (!status.busy) stop()
}

function start() {
  if (timer !== null || import.meta.server) return
  timer = setInterval(poll, 5000)
}

function onVisibility() {
  // Im Hintergrund wird nicht gefragt; kommt der Reiter zurueck, wird sofort
  // einmal nachgesehen, statt fuenf Sekunden veraltet dazustehen.
  if (document.hidden) stop()
  else if (busy.value) {
    poll()
    start()
  }
}

watch(busy, (value) => (value ? start() : stop()), { immediate: true })

onMounted(() => {
  document.addEventListener('visibilitychange', onVisibility)
  if (busy.value) start()
})
onBeforeUnmount(() => {
  stop()
  document.removeEventListener('visibilitychange', onVisibility)
})

async function afterUpload() {
  await refresh()
  start()
}
</script>

<template>
  <main id="main" class="appwrap">
    <h1 class="sr-only">{{ t('imports.heading') }}</h1>

    <div class="live-region" role="alert" aria-live="assertive">
      <div v-if="loadFailure !== null" class="ui-alert" style="margin-bottom:14px">{{ loadError }}</div>
    </div>

    <ImportsUploadPanel @uploaded="afterUpload" @queued="afterUpload" />

    <div class="grid2" style="margin:16px 0">
      <div class="ui-card kpi">
        <span class="v tnum">{{ formatNumber(kpi.records, locale) }}</span>
        <span class="l">{{ t('imports.kpi.records') }}</span>
      </div>
      <div class="ui-card kpi">
        <span class="v tnum">{{ formatNumber(kpi.awaiting, locale) }}</span>
        <span class="l">{{ t('imports.kpi.awaiting') }}</span>
      </div>
    </div>

    <div v-if="notice !== ''" class="ui-alert-ok" style="margin-bottom:12px">{{ notice }}</div>

    <p class="sr-only" role="status" aria-live="polite">{{ announcement }}</p>

    <!--
      Filter ueber der Liste, Sortierung an den Spaltenkoepfen. Beides steht in
      der Adresse, damit sich eine Auswahl weitergeben laesst.
    -->
    <section class="listfilter" :aria-label="t('imports.filter.heading')">
      <form class="ff" role="search" @submit.prevent="setzeAuswahl({ q: suche.trim() || null })">
        <label class="sr-only" for="isuche">{{ t('imports.filter.search') }}</label>
        <input id="isuche" v-model="suche" class="ui-input" type="search"
               :placeholder="t('imports.filter.searchPlaceholder')">
        <button class="btn btn-outline btn-sm" type="submit">{{ t('imports.filter.apply') }}</button>
      </form>

      <button type="button" class="btn btn-sm" :class="nurBeanstandet ? 'btn-primary' : 'btn-outline'"
              :aria-pressed="nurBeanstandet"
              @click="setzeAuswahl({ issues: nurBeanstandet ? null : '1' })">
        {{ t('imports.filter.onlyIssues') }}
      </button>

      <div class="field" style="margin:0">
        <label class="sr-only" for="istatus">{{ t('imports.filter.status') }}</label>
        <select id="istatus" class="ui-input"
                :value="String(route.query.status ?? '')"
                @change="setzeAuswahl({ status: ($event.target as HTMLSelectElement).value || null })">
          <option value="">{{ t('imports.filter.anyStatus') }}</option>
          <option value="converted">{{ t('imports.status.converted') }}</option>
          <option value="error">{{ t('imports.status.error') }}</option>
          <option value="awaiting_format_review">{{ t('imports.status.awaiting_format_review') }}</option>
          <option value="awaiting_sheet_choice">{{ t('imports.status.awaiting_sheet_choice') }}</option>
        </select>
      </div>

      <p class="dim small" style="margin:0 0 0 auto" aria-live="polite">
        <template v-if="counts.shown !== counts.total">
          {{ t('imports.filter.shownOf', { shown: counts.shown, total: counts.total }) }}
          <button type="button" class="linklike" @click="setzeAuswahl({ q: null, issues: null, status: null })">
            {{ t('imports.filter.clear') }}
          </button>
        </template>
        <template v-else>{{ t('imports.filter.all', { total: counts.total }) }}</template>
      </p>
    </section>

    <p v-if="counts.loaded < counts.total" class="ui-alert ui-alert-warn" style="margin-bottom:12px">
      {{ t('imports.filter.truncated', { loaded: counts.loaded, total: counts.total }) }}
    </p>

    <ImportsImportTable :items="items" :sort="sortierung" @changed="refresh" @message="setNotice"
                        @sort="sortiereNach" />

    <ImportsPipeline />
  </main>
</template>
