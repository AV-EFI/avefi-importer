<script setup lang="ts">
import { importsService } from '~/services/imports'
/**
 * Pruefbericht eines Imports.
 *
 * Alle Beanstandungen stehen in einer Liste — Parsefehler, Zuordnungshinweise
 * und Schemapruefung. Im PHP-Stand lagen sie in zwei getrennten Abschnitten,
 * und wer nur einen las, uebersah die Haelfte.
 */
import { apiFailure, failureText } from '~/components/imports/errors'
import { formatNumber } from '~/components/imports/format'

const importe = importsService()

const route = useRoute()
const { t, te, locale } = useI18n()
const id = computed(() => String(route.params.id ?? ''))

const { data, error } = await useImportBericht(id)

const loadError = computed(() => (error.value ? failureText(t, te, apiFailure(error.value)) : ''))
const item = computed(() => data.value?.import ?? null)
const report = computed(() => data.value?.report ?? null)
const summary = computed(() => data.value?.summary ?? null)
const counts = computed(() => data.value?.counts ?? { error: 0, warning: 0, info: 0 })
const issues = computed(() => data.value?.issues ?? [])
// Quellzeile -> Datensatz, vom Server abgeleitet. Damit wird aus der Angabe
// „Zeile 53" ein Weg zum Satz und nicht nur eine Beschreibung.
const rowRecords = computed(() => data.value?.rowRecords ?? {})
// Auskunft zu den Zielfeldern, die in den Befunden vorkommen. Nur zu diesen —
// der Katalog hat 91 Ziele, und die anderen 90 interessieren hier niemanden.
const fieldHelp = computed(() => data.value?.fieldHelp ?? {})

useHead({ title: () => (item.value ? `${item.value.filename} · ${t('imports.report.crumb')}` : t('imports.report.crumb')) })

const allGood = computed(() => counts.value.error === 0 && counts.value.warning === 0)
const avefiCount = computed(() => summary.value?.avefiRecords ?? 0)
const checked = computed(() => (summary.value ? summary.value.valid + summary.value.invalid : 0))

interface MappingReport {
  profile?: { name?: string; version?: number }
  grouping?: string
  rows?: number
  works?: number
}
const mapping = computed<MappingReport | null>(() => (data.value?.mapping ?? null) as MappingReport | null)

const coverage = computed(() => Object.entries(data.value?.coverage ?? {}))
function percent(entry: { filled: number; total: number }): number {
  return entry.total > 0 ? Math.round((entry.filled / entry.total) * 100) : 0
}
</script>

<template>
  <main id="main" class="appwrap">
    <nav class="crumbs" :aria-label="t('imports.report.crumb')">
      <NuxtLink to="/">{{ t('imports.heading') }}</NuxtLink>
      <span class="sep" aria-hidden="true">/</span>
      <NuxtLink :to="`/imports/${id}`">{{ item?.filename ?? id }}</NuxtLink>
      <span class="sep" aria-hidden="true">/</span>
      <span>{{ t('imports.report.crumb') }}</span>
    </nav>

    <div role="alert" aria-live="assertive" v-if="loadError !== ''" class="ui-alert">{{ loadError }}</div>

    <template v-else-if="item !== null">
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:16px">
        <h1 style="font-size:19px">{{ t('imports.report.heading') }}</h1>
        <span v-if="item.base_format" class="fmt">{{ item.base_format.toUpperCase() }}</span>
        <ImportsStatusBadge :status="item.status" :stale="item.stale"
                              :ran-with-version="item.ranWithVersion" :profile-version="item.profileVersion" />
        <span class="dim small">{{ item.filename }}</span>
        <div style="margin-left:auto;display:flex;gap:8px;align-items:center">
          <NuxtLink class="btn btn-outline btn-sm" :to="`/imports/${item.id}`">{{ t('imports.menu.detail') }}</NuxtLink>
          <NuxtLink v-if="item.status === 'converted'" class="btn btn-outline btn-sm"
                    :to="`/imports/${item.id}/records`">{{ t('imports.detail.openRecords') }}</NuxtLink>
          <a v-if="item.hasAvefi" class="btn btn-outline btn-sm" :href="importe.avefiJsonPfad(item.id)"
             :style="item.validated ? undefined : 'color:var(--warn);border-color:var(--warn)'">
            <span aria-hidden="true">⤓</span>
            {{ item.validated ? t('imports.menu.avefi') : t('imports.menu.avefiDraft') }}</a>
        </div>
      </div>

      <div v-if="report === null" class="tablewrap">
        <div class="empty">
          <div class="ic" aria-hidden="true">🧪</div>
          <p class="fn" style="font-size:15px;margin-bottom:4px">{{ t('imports.report.empty.heading') }}</p>
          <p class="small">{{ t('imports.report.empty.text') }}</p>
        </div>
      </div>

      <template v-else>
        <div role="status" aria-live="polite" v-if="allGood" class="ui-alert-ok" style="margin-bottom:16px">
          <span aria-hidden="true">✓</span>
          {{ t('imports.report.allGood', { count: formatNumber(avefiCount, locale) }, avefiCount) }}
        </div>
        <div v-else class="ui-alert" role="status" style="margin-bottom:16px">
          <template v-if="checked > 0">
            {{ t('imports.report.hasIssues', { invalid: summary?.invalid ?? 0, total: checked }) }}
          </template>
          <template v-else>{{ t('imports.report.hasIssuesNoCheck') }}</template>
        </div>

        <p v-if="item.hasAvefi && !item.validated" class="ui-alert" style="margin-bottom:16px">
          {{ t('imports.detail.draftWarning') }}
        </p>

        <div v-if="summary !== null" class="grid2" style="grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:18px">
          <div class="ui-card kpi">
            <span class="v tnum">{{ formatNumber(summary.records, locale) }}</span>
            <span class="l">{{ t('imports.report.kpi.records') }}</span>
          </div>
          <div class="ui-card kpi">
            <span class="v tnum">{{ formatNumber(summary.avefiRecords, locale) }}</span>
            <span class="l">{{ t('imports.report.kpi.avefi') }}</span>
          </div>
          <div class="ui-card kpi">
            <span class="v tnum" style="color:var(--ok)">{{ formatNumber(summary.valid, locale) }}</span>
            <span class="l">{{ t('imports.report.kpi.valid') }}</span>
          </div>
          <div class="ui-card kpi">
            <span class="v tnum" :style="summary.invalid > 0 ? 'color:var(--danger)' : undefined">
              {{ formatNumber(summary.invalid, locale) }}</span>
            <span class="l">{{ t('imports.report.kpi.invalid') }}</span>
          </div>
        </div>

        <section v-if="coverage.length > 0" style="margin-bottom:18px">
          <h2 class="side-h" style="margin:0 0 8px">{{ t('imports.report.coverage.heading') }}</h2>
          <div class="ui-card">
            <p class="note" style="margin:0 0 12px">{{ t('imports.report.coverage.lead') }}</p>
            <div v-for="[field, entry] in coverage" :key="field" class="frow"
                 style="grid-template-columns:210px 1fr 120px;padding:7px 0;align-items:center">
              <span>{{ field }}</span>
              <div class="prog" :class="percent(entry) >= 80 ? 'ok' : 'acc'" role="progressbar"
                   aria-valuemin="0" aria-valuemax="100" :aria-valuenow="percent(entry)"
                   :aria-label="t('imports.report.coverage.bar', { field, percent: percent(entry) })">
                <i :style="{ width: percent(entry) + '%' }" />
              </div>
              <span class="dim small tnum" style="text-align:right">
                {{ t('imports.report.coverage.value', { filled: entry.filled, total: entry.total, percent: percent(entry) }) }}
              </span>
            </div>
          </div>
        </section>

        <section v-if="mapping !== null" style="margin-bottom:18px">
          <h2 class="side-h" style="margin:0 0 8px">{{ t('imports.report.mapping.heading') }}</h2>
          <div class="ui-card">
            <div class="frow" style="grid-template-columns:200px 1fr;padding:7px 0">
              <span>{{ t('imports.report.mapping.profile') }}</span>
              <span class="fval">{{ mapping.profile?.name ?? '–' }}
                <span v-if="mapping.profile?.version" class="dim small">
                  {{ t('imports.report.mapping.version', { version: mapping.profile.version }) }}</span></span>
            </div>
            <div v-if="mapping.grouping" class="frow" style="grid-template-columns:200px 1fr;padding:7px 0">
              <span>{{ t('imports.report.mapping.grouping') }}</span>
              <span class="fval">{{ mapping.grouping }}</span>
            </div>
            <div class="frow" style="grid-template-columns:200px 1fr;padding:7px 0;border-bottom:0">
              <span>{{ t('imports.report.mapping.rows') }}</span>
              <span class="fval tnum">
                {{ t('imports.report.mapping.rowsValue', { rows: mapping.rows ?? 0, works: mapping.works ?? 0 }) }}</span>
            </div>
          </div>
        </section>

        <ImportsIssueList :issues="issues" :counts="counts" :row-records="rowRecords"
                          :import-id="item.id" :tabular="item.tabular" :field-help="fieldHelp" />

        <section style="margin-top:18px">
          <h2 class="side-h" style="margin:0 0 8px">{{ t('imports.report.meta.heading') }}</h2>
          <div class="ui-card">
            <div class="frow" style="grid-template-columns:200px 1fr;padding:7px 0">
              <span>{{ t('imports.report.meta.converter') }}</span>
              <span class="fval mono small">{{ report.converter ?? t('imports.report.meta.unknown') }}</span>
            </div>
            <div class="frow" style="grid-template-columns:200px 1fr;padding:7px 0">
              <span>{{ t('imports.report.meta.schemaVersion') }}</span>
              <span class="fval mono small">{{ report.schemaVersion ?? t('imports.report.meta.unknown') }}</span>
            </div>
            <div v-if="report.efiConvVersion" class="frow" style="grid-template-columns:200px 1fr;padding:7px 0">
              <span>{{ t('imports.report.meta.efiConvVersion') }}</span>
              <span class="fval mono small">{{ report.efiConvVersion }}</span>
            </div>
            <div class="frow" style="grid-template-columns:200px 1fr;padding:7px 0">
              <span>{{ t('imports.report.meta.startedAt') }}</span>
              <span class="fval tnum small"><ImportsTimeStamp :value="report.startedAt" :fallback="t('imports.report.meta.unknown')" /></span>
            </div>
            <div class="frow" style="grid-template-columns:200px 1fr;padding:7px 0;border-bottom:0">
              <span>{{ t('imports.report.meta.finishedAt') }}</span>
              <span class="fval tnum small"><ImportsTimeStamp :value="report.finishedAt" :fallback="t('imports.report.meta.unknown')" /></span>
            </div>
          </div>
        </section>
      </template>
    </template>
  </main>
</template>
