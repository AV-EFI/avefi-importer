<script setup lang="ts">
import { importsService } from '~/services/imports'
/**
 * Detailseite eines Imports.
 *
 * Sie ersetzt die Fehlerseite des PHP-Stands und macht mehr daraus. Dort
 * bekam jede Lage denselben Satz — „Das hat nicht geklappt" —, und ein Tester
 * legte darauf ein Profil neu an, weil ihm niemand sagte, dass die bereits
 * hochgeladene Tabelle gereicht haette. Hier hat jeder Verarbeitungsstand
 * seinen eigenen Absatz und, wo es etwas zu tun gibt, den Weg dorthin.
 */
import { apiFailure, failureText } from '~/components/imports/errors'
import { fileSize, formatDetailLabel, formatNumber } from '~/components/imports/format'
import { BUSY_STATES } from '~/components/imports/types'

const importe = importsService()

const route = useRoute()
const { t, te, locale } = useI18n()
const id = computed(() => String(route.params.id ?? ''))

const { data, refresh, error } = await useImport(id)

const loadError = computed(() => (error.value ? failureText(t, te, apiFailure(error.value)) : ''))
const item = computed(() => data.value?.import ?? null)
const report = computed(() => data.value?.report ?? null)
const failed = computed(() => data.value?.failed ?? null)
const diagnostics = computed(() => data.value?.diagnostics ?? null)

/*
 * Herkunft des Ergebnisses (#6, Jasper Stratil).
 *
 * `convert.ts` schreibt seit laengerem ein `run_config` je Lauf, gelesen hat es
 * niemand. Fuer tabellarische Importe fuehrte der Weg zur Zuordnungsseite, fuer
 * MARC-XML und AVefi-nativ nirgendwohin: Dort gibt es keine Spaltenzuordnung,
 * und damit gab es auf die Frage "wie kam das zustande" gar keine Antwort.
 */
const herkunft = computed(() => data.value?.herkunft ?? null)

/** Trennzeichen lesbar machen. Ein Tabulator sieht sonst aus wie nichts. */
const trennzeichenLabel = computed(() => {
  const z = herkunft.value?.trennzeichen ?? null
  if (z === null || z === '') return null
  return z === '\t' ? 'Tab' : z
})

/*
 * Anzeigename NEBEN dem Dateinamen (#1, Matti Stoehr). Mehrere Laeufe
 * derselben Datei standen in der Liste als gleichnamige Zeilen nebeneinander,
 * unterscheidbar nur am Zeitstempel. Der Dateiname bleibt trotzdem stehen: Er
 * ist die Verbindung zur Lieferung des Archivs, und ein selbst gewaehlter Name
 * darf sie nicht ersetzen.
 */
const nameEntwurf = ref('')
const nameBusy = ref(false)
const nameMeldung = ref('')
watch(item, (neu) => { nameEntwurf.value = neu?.label ?? '' }, { immediate: true })

async function benennen() {
  nameBusy.value = true
  nameMeldung.value = ''
  try {
    const res = await importe.benennen(id.value, nameEntwurf.value.trim())
    nameMeldung.value = res.label === null
      ? t('imports.detail.name.cleared')
      : t('imports.detail.name.saved', { name: res.label })
    await refresh()
  } catch (e) {
    nameMeldung.value = failureText(t, te, apiFailure(e))
  } finally {
    nameBusy.value = false
  }
}

useHead({ title: () => (item.value ? `${item.value.filename} · ${t('imports.detail.crumb')}` : t('imports.detail.crumb')) })

/** Der Absatz, der zum Stand passt — Titel und Text kommen aus einem Schluesselpaar. */
const state = computed(() => {
  const row = item.value
  if (row === null) return null
  switch (row.status) {
    case 'awaiting_format_review':
      return row.tabular
        ? { title: t('imports.state.awaiting_format_review.titleTable'), text: t('imports.state.awaiting_format_review.textTable'), tone: 'wait' }
        : { title: t('imports.state.awaiting_format_review.titleOther'), text: t('imports.state.awaiting_format_review.textOther'), tone: 'wait' }
    case 'converted':
      return row.issues.error + row.issues.warning > 0
        ? {
            title: t('imports.state.convertedIssues.title'),
            text: t('imports.state.convertedIssues.text', { errors: row.issues.error, warnings: row.issues.warning }),
            tone: 'wait'
          }
        : { title: t('imports.state.converted.title'), text: t('imports.state.converted.text'), tone: 'ok' }
    case 'error':
      return { title: t('imports.state.error.title'), text: t('imports.state.error.text'), tone: 'error' }
    default: {
      const key = `imports.state.${row.status}`
      if (!te(`${key}.title`)) return null
      return { title: t(`${key}.title`), text: t(`${key}.text`), tone: 'info' }
    }
  }
})

const stageLabel = computed(() => {
  const cls = failed.value?.classname ?? report.value?.stage ?? null
  if (cls === null) return null
  const key = `imports.stage.${cls}`
  return te(key) ? t(key) : cls
})

const busy = computed(() => (item.value ? BUSY_STATES.has(item.value.status) : false))
let timer: ReturnType<typeof setInterval> | null = null
function stop() {
  if (timer !== null) {
    clearInterval(timer)
    timer = null
  }
}
watch(
  busy,
  (value) => {
    stop()
    if (value && import.meta.client) timer = setInterval(() => refresh(), 5000)
  },
  { immediate: true }
)
onBeforeUnmount(stop)

const size = computed(() => (item.value ? fileSize(item.value.filesize, locale.value) : null))

const formatLabel = computed(() => {
  const parts = formatDetailLabel(item.value?.format_detail)
  if (parts !== null) return t(parts.key, parts.params, parts.count)
  return item.value?.detected_format ?? (item.value?.base_format ? item.value.base_format.toUpperCase() : '')
})
</script>

<template>
  <main id="main" class="appwrap">
    <nav class="crumbs" :aria-label="t('imports.detail.crumb')">
      <NuxtLink to="/">{{ t('imports.heading') }}</NuxtLink>
      <span class="sep" aria-hidden="true">/</span>
      <span>{{ item?.filename ?? id }}</span>
      <span class="sep" aria-hidden="true">/</span>
      <span>{{ t('imports.detail.crumb') }}</span>
    </nav>

    <div role="alert" aria-live="assertive" v-if="loadError !== ''" class="ui-alert">{{ loadError }}</div>

    <template v-else-if="item !== null">
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:16px">
        <div>
          <h1 style="font-size:19px;margin:0">{{ item.label || item.filename }}</h1>
          <div v-if="item.label" class="dim small mono">{{ item.filename }}</div>
        </div>
        <span v-if="formatLabel !== ''" class="fmt">{{ formatLabel }}</span>
        <ImportsStatusBadge :status="item.status" :stale="item.stale"
                              :ran-with-version="item.ranWithVersion" :profile-version="item.profileVersion" />
        <div style="margin-left:auto;display:flex;gap:8px">
          <NuxtLink class="btn btn-outline btn-sm" to="/">{{ t('imports.action.overview') }}</NuxtLink>
        </div>
      </div>

      <!-- Was jetzt zu tun ist -->
      <section v-if="state !== null" style="margin-bottom:18px">
        <h2 class="side-h" style="margin:0 0 8px">{{ t('imports.detail.next') }}</h2>
        <div :class="state.tone === 'ok' ? 'ui-alert-ok' : state.tone === 'error' ? 'ui-alert' : 'ui-card'"
             :role="state.tone === 'error' ? 'alert' : 'status'">
          <p class="fn">{{ state.title }}</p>
          <p style="margin-top:6px">{{ state.text }}</p>
          <p style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">
            <NuxtLink v-if="item.status === 'awaiting_sheet_choice'" class="btn btn-primary btn-sm"
                      :to="`/imports/${item.id}/sheets`">{{ t('imports.detail.openSheets') }}</NuxtLink>
            <NuxtLink v-if="item.status === 'awaiting_format_review' && item.tabular" class="btn btn-primary btn-sm"
                      :to="`/imports/${item.id}/mapping`">{{ t('imports.action.map') }}</NuxtLink>
            <NuxtLink v-if="item.status === 'converted'" class="btn btn-primary btn-sm"
                      :to="`/imports/${item.id}/records`">{{ t('imports.detail.openRecords') }}</NuxtLink>
            <NuxtLink v-if="item.hasReport" class="btn btn-outline btn-sm" :to="`/imports/${item.id}/report`">
              {{ t('imports.detail.openReport') }}</NuxtLink>
            <!-- Siehe RowMenu.vue: es entscheidet das Format, nicht das gespeicherte Profil.
                 Der Zustand "Zuordnung noetig" hat weiter oben schon seinen eigenen Knopf. -->
            <NuxtLink v-if="item.tabular && item.status !== 'awaiting_format_review'"
                      class="btn btn-outline btn-sm" :to="`/imports/${item.id}/mapping`">
              {{ t('imports.detail.openMapping') }}</NuxtLink>
          </p>
        </div>
      </section>

      <!-- Fehlerlage -->
      <section v-if="item.status === 'error'" style="margin-bottom:18px">
        <div class="ui-alert" role="alert">
          <p>
            <template v-if="stageLabel !== null">{{ t('imports.detail.stage', { stage: stageLabel }) }}</template>
            <template v-else>{{ t('imports.detail.stageUnknown') }}</template>
          </p>
          <p v-if="failed?.error" class="small" style="margin-top:6px">
            {{ t('imports.detail.workerMessage') }}: <span class="mono">{{ failed.error }}</span>
          </p>
          <p v-if="failed && failed.attempts > 1" class="small dim" style="margin-top:4px">
            {{ t('imports.detail.attempts', { count: failed.attempts }) }}
          </p>
        </div>

        <template v-if="diagnostics !== null && diagnostics.errors.length > 0">
          <h2 class="side-h" style="margin:18px 0 8px">{{ t('imports.detail.diagnostics') }}</h2>
          <ImportsDiagnosticsList :entries="diagnostics.errors" />
        </template>
        <div v-else-if="(report?.issues?.length ?? 0) === 0" class="tablewrap" style="margin-top:14px">
          <div class="empty">
            <div class="ic" aria-hidden="true">🔍</div>
            <p class="fn" style="font-size:15px;margin-bottom:4px">{{ t('imports.detail.noDiagnostics.heading') }}</p>
            <p class="small">{{ t('imports.detail.noDiagnostics.text') }}</p>
          </div>
        </div>
      </section>

      <!-- Beanstandungen aus dem Bericht: nur der Weg dorthin, damit sie nicht
           an zwei Stellen stehen. -->
      <section v-if="item.issues.error + item.issues.warning + item.issues.info > 0" style="margin-bottom:18px">
        <div class="ui-card">
          <p class="fn">{{ t('imports.report.issues.heading') }}</p>
          <p class="dim small" style="margin-top:4px">
            {{ t('imports.report.issues.errors', { count: item.issues.error }) }} ·
            {{ t('imports.report.issues.warnings', { count: item.issues.warning }) }} ·
            {{ t('imports.report.issues.infos', { count: item.issues.info }) }}
          </p>
          <p style="margin-top:10px">
            <NuxtLink class="btn btn-outline btn-sm" :to="`/imports/${item.id}/report`">
              {{ t('imports.detail.openReport') }}</NuxtLink>
          </p>
        </div>
      </section>

      <!-- Anzeigename -->
      <h2 id="name" class="side-h" style="margin:0 0 8px">{{ t('imports.detail.name.heading') }}</h2>
      <div class="ui-card" style="margin-bottom:18px">
        <p class="note" style="margin:0 0 10px">{{ t('imports.detail.name.hint') }}</p>
        <form class="stackform" @submit.prevent="benennen">
          <div class="field" style="width:100%">
            <label for="ilabel">{{ t('imports.detail.name.label') }}</label>
            <input id="ilabel" v-model="nameEntwurf" class="ui-input" maxlength="200"
                   :placeholder="item.filename">
          </div>
          <button class="btn btn-outline btn-sm" type="submit" :disabled="nameBusy">
            {{ t('imports.detail.name.save') }}
          </button>
        </form>
        <p v-if="nameMeldung" class="dim small" aria-live="polite" style="margin:8px 0 0">{{ nameMeldung }}</p>
      </div>

      <!-- Eckdaten -->
      <h2 class="side-h" style="margin:0 0 8px">{{ t('imports.detail.meta') }}</h2>
      <div class="ui-card" style="margin-bottom:18px">
        <div class="frow" style="grid-template-columns:200px 1fr;padding:7px 0">
          <span>{{ t('imports.detail.file') }}</span><span class="fval">{{ item.filename }}</span>
        </div>
        <div v-if="item.label" class="frow" style="grid-template-columns:200px 1fr;padding:7px 0">
          <span>{{ t('imports.detail.name.label') }}</span><span class="fval">{{ item.label }}</span>
        </div>
        <div v-if="size !== null" class="frow" style="grid-template-columns:200px 1fr;padding:7px 0">
          <span>{{ t('imports.detail.size') }}</span>
          <span class="fval tnum">{{ t(size.key, size.params) }}</span>
        </div>
        <div class="frow" style="grid-template-columns:200px 1fr;padding:7px 0">
          <span>{{ t('imports.detail.format') }}</span>
          <span class="fval">{{ formatLabel || t('imports.table.none') }}</span>
        </div>
        <div v-if="item.sheet_name" class="frow" style="grid-template-columns:200px 1fr;padding:7px 0">
          <span>{{ t('imports.detail.sheet') }}</span><span class="fval">{{ item.sheet_name }}</span>
        </div>
        <div class="frow" style="grid-template-columns:200px 1fr;padding:7px 0">
          <span>{{ t('imports.detail.created') }}</span>
          <span class="fval tnum"><ImportsTimeStamp :value="item.created_at" /></span>
        </div>
        <div class="frow" style="grid-template-columns:200px 1fr;padding:7px 0">
          <span>{{ t('imports.detail.recordCount') }}</span>
          <span class="fval tnum">{{ formatNumber(item.record_count, locale) }}</span>
        </div>
        <div class="frow" style="grid-template-columns:200px 1fr;padding:7px 0;border-bottom:0">
          <span>{{ t('imports.detail.rowErrors') }}</span>
          <span class="fval tnum">{{ formatNumber(item.error_count, locale) }}</span>
        </div>
      </div>

      <!--
        Herkunft. Steht hinter den Eckdaten, weil sie die Datei beschreiben und
        dies den Lauf. Der Abschnitt erscheint immer, auch ohne Aufzeichnung:
        "nicht aufgezeichnet" ist eine Auskunft, ein fehlender Abschnitt ist
        genau der Fehler, der gemeldet wurde.
      -->
      <h2 id="herkunft" class="side-h" style="margin:0 0 8px">{{ t('imports.detail.origin.heading') }}</h2>
      <p class="small dim" style="margin:0 0 8px">{{ t('imports.detail.origin.lead') }}</p>
      <div v-if="herkunft" class="ui-card" style="margin-bottom:18px">
        <p v-if="!herkunft.aufgezeichnet" class="small" style="margin:0 0 10px">
          {{ t('imports.detail.origin.notRecorded') }}
        </p>

        <div v-if="herkunft.formatProfil" class="frow" style="grid-template-columns:200px 1fr;padding:7px 0">
          <span>{{ t('imports.detail.origin.formatProfile') }}</span>
          <span class="fval">{{ herkunft.formatProfil.label }}
            <span class="mono small dim">{{ herkunft.formatProfil.converterKey }}</span></span>
        </div>

        <div class="frow" style="grid-template-columns:200px 1fr;padding:7px 0">
          <span>{{ t('imports.detail.origin.mappingProfile') }}</span>
          <span v-if="herkunft.zuordnungsProfil" class="fval">
            <NuxtLink :to="`/mappings/${herkunft.zuordnungsProfil.id}`">{{ herkunft.zuordnungsProfil.name }}</NuxtLink>
            <template v-if="herkunft.zuordnungsProfil.verwendeteVersion === null">
              <span class="small dim"> · {{ t('imports.detail.origin.versionUnknown') }}</span>
            </template>
            <template v-else-if="herkunft.zuordnungsProfil.aktuelleVersion !== herkunft.zuordnungsProfil.verwendeteVersion">
              <span class="small"> · {{ t('imports.detail.origin.versionStale', {
                used: herkunft.zuordnungsProfil.verwendeteVersion,
                now: herkunft.zuordnungsProfil.aktuelleVersion }) }}</span>
              <span class="small dim" style="display:block">{{ t('imports.detail.origin.staleHint') }}</span>
            </template>
            <template v-else>
              <span class="small dim"> · {{ t('imports.detail.origin.versionUsed', {
                version: herkunft.zuordnungsProfil.verwendeteVersion }) }}</span>
            </template>
          </span>
          <span v-else class="fval dim">{{ t('imports.detail.origin.none') }}</span>
        </div>

        <div class="frow" style="grid-template-columns:200px 1fr;padding:7px 0">
          <span>{{ t('imports.detail.origin.schemaVersion') }}</span>
          <span class="fval mono small">{{ herkunft.schemaVersion ?? t('imports.detail.origin.unknown') }}</span>
        </div>

        <div v-if="trennzeichenLabel !== null" class="frow" style="grid-template-columns:200px 1fr;padding:7px 0">
          <span>{{ t('imports.detail.origin.delimiter') }}</span>
          <span class="fval mono">{{ trennzeichenLabel }}</span>
        </div>

        <div class="frow" style="grid-template-columns:200px 1fr;padding:7px 0">
          <span>{{ t('imports.detail.origin.authority') }}</span>
          <span v-if="herkunft.normdaten === null" class="fval dim">{{ t('imports.detail.origin.unknown') }}</span>
          <span v-else-if="!herkunft.normdaten.aktiv" class="fval">{{ t('imports.detail.origin.authorityOff') }}</span>
          <span v-else-if="herkunft.normdaten.obergrenze === null" class="fval">
            {{ t('imports.detail.origin.authorityOnNoLimit') }}</span>
          <span v-else class="fval">
            {{ t('imports.detail.origin.authorityOn', { limit: herkunft.normdaten.obergrenze }) }}</span>
        </div>

        <div class="frow" style="grid-template-columns:200px 1fr;padding:7px 0;border-bottom:0">
          <span>{{ t('imports.detail.origin.convertedAt') }}</span>
          <span class="fval tnum"><ImportsTimeStamp :value="herkunft.konvertiertAm"
                                                    :fallback="t('imports.detail.origin.unknown')" /></span>
        </div>
      </div>

      <!-- Herunterladen -->
      <h2 class="side-h" style="margin:0 0 8px">{{ t('imports.detail.downloads') }}</h2>
      <div class="ui-card">
        <p v-if="item.hasAvefi && !item.validated" class="ui-alert" style="margin-bottom:12px">
          {{ t('imports.detail.draftWarning') }}
        </p>
        <p style="display:flex;gap:8px;flex-wrap:wrap">
          <a v-if="data?.hasOriginal" class="btn btn-outline btn-sm" :href="importe.originalPfad(item.id)">
            <span aria-hidden="true">⤓</span> {{ t('imports.menu.original') }}</a>
          <a v-if="item.hasAvefi" class="btn btn-sm" :class="item.validated ? 'btn-outline' : 'btn-outline'"
             :href="importe.avefiJsonPfad(item.id)"
             :style="item.validated ? undefined : 'color:var(--warn);border-color:var(--warn)'">
            <span aria-hidden="true">⤓</span>
            {{ item.validated ? t('imports.menu.avefi') : t('imports.menu.avefiDraft') }}</a>
        </p>
      </div>

      <!-- Selbsthilfe: berichtigte Datei gleich hier hochladen -->
      <section v-if="item.status === 'error'" style="margin-top:18px">
        <h2 class="side-h" style="margin:0 0 8px">{{ t('imports.detail.reupload') }}</h2>
        <p class="note" style="margin:0 0 10px">{{ t('imports.detail.reuploadHint') }}</p>
        <ImportsUploadPanel @uploaded="navigateTo('/')" @queued="navigateTo('/')" />
      </section>
    </template>
  </main>
</template>
