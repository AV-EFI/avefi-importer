<script setup lang="ts">
import type { ReviewTask } from '~/services/reviews'
/**
 * Warteschlange der Formatpruefung.
 *
 * Eine Zeile ist eine Aufgabe — eine Kopfzeile eines Hauses —, nicht eine
 * Datei. Im PHP-Stand entdoppelte FormatReview::open nur je Import: zwanzig
 * Dateien mit demselben unbekannten Format erzeugten zwanzig Eintraege. Die
 * alten Doppeleintraege stehen noch in der Datenbank; sie werden hier
 * zusammengefasst und die Zahl der Eintraege daneben genannt, damit die
 * Zahl im Kopfzeilen-Abzeichen erklaerbar bleibt.
 */
import { apiFailure, failureText } from '~/components/records/errors'

const { t, te } = useI18n()
const route = useRoute()

const { data, error } = await usePruefungsListe()

const loadError = computed(() => (error.value ? failureText(t, te, apiFailure(error.value), ['admin', 'imports']) : ''))
const tasks = computed(() => data.value?.tasks ?? [])
const rows = computed(() => data.value?.rows ?? 0)
const duplicates = computed(() => data.value?.duplicates ?? 0)

useHead({ title: () => t('admin.reviews.pageTitle') })

const assigned = computed(() => (route.query.assigned === undefined ? null : String(route.query.assigned)))
const assignedCount = computed(() => Number(route.query.count ?? 0))
const rejected = computed(() => Number(route.query.rejected ?? 0))
</script>

<template>
  <main id="main" class="appwrap">
    <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:8px">
      <h1 style="font-size:19px">{{ t('admin.reviews.heading') }}</h1>
      <span class="dim small">{{ t('admin.reviews.tasks', { count: tasks.length }, tasks.length) }}</span>
      <span v-if="duplicates > 0" class="dim small">
        · {{ t('admin.reviews.rows', { count: rows }, rows) }},
        {{ t('admin.reviews.duplicates', { count: duplicates }, duplicates) }}
      </span>
    </div>
    <p class="note" style="margin-bottom:14px">{{ t('admin.reviews.lead') }}</p>

    <div role="alert" aria-live="assertive" v-if="loadError !== ''" class="ui-alert">{{ loadError }}</div>

    <template v-else>
      <div class="live-region" role="status" aria-live="polite">
        <div v-if="assigned !== null" class="ui-alert-ok" style="margin-bottom:14px">
          {{ t('admin.reviews.assigned', { label: assigned, count: assignedCount }, assignedCount) }}
        </div>
      </div>
      <div class="live-region" role="status" aria-live="polite">
        <div v-if="rejected > 0" class="ui-alert-ok" style="margin-bottom:14px">
          {{ t('admin.reviews.rejected', { count: rejected }, rejected) }}
        </div>
      </div>

      <div v-if="tasks.length === 0" class="tablewrap">
        <div class="empty">
          <div class="ic" aria-hidden="true">✅</div>
          <p class="fn" style="font-size:15px;margin-bottom:4px">{{ t('admin.reviews.empty.heading') }}</p>
          <p class="small">{{ t('admin.reviews.empty.text') }}</p>
        </div>
      </div>

      <div v-else class="tablewrap">
        <table>
          <caption class="sr-only">{{ t('admin.reviews.table.caption') }}</caption>
          <thead>
            <tr>
              <th scope="col">{{ t('admin.reviews.table.file') }}</th>
              <th scope="col">{{ t('admin.reviews.table.format') }}</th>
              <th scope="col">{{ t('admin.reviews.table.institution') }}</th>
              <th scope="col">{{ t('admin.reviews.table.fingerprint') }}</th>
              <th scope="col">{{ t('admin.reviews.table.columns') }}</th>
              <th scope="col">{{ t('admin.reviews.table.uploaded') }}</th>
              <th scope="col">{{ t('admin.reviews.table.waiting') }}</th>
              <th scope="col" style="text-align:right">{{ t('admin.reviews.table.action') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="task in tasks" :key="task.id">
              <td>
                <div class="fn">{{ task.filename }}</div>
                <div v-if="task.waiting > 1" class="dim small">
                  {{ task.files.slice(1).map((f) => f.filename).join(', ') }}
                </div>
              </td>
              <td><span v-if="task.baseFormat" class="fmt">{{ task.baseFormat.toUpperCase() }}</span></td>
              <td>{{ task.institutionName ?? t('admin.reviews.table.none') }}</td>
              <td class="mono small dim">{{ task.shortFingerprint }}…</td>
              <td class="tnum small">{{ task.columns > 0 ? task.columns : t('admin.reviews.table.none') }}</td>
              <td class="dim small tnum"><ImportsTimeStamp :value="task.uploadedAt" /></td>
              <td class="tnum small">
                <span :class="task.waiting > 1 ? 'badge b-wait' : 'dim'">
                  {{ t('admin.reviews.waiting', { count: task.waiting }, task.waiting) }}
                </span>
              </td>
              <td style="text-align:right">
                <NuxtLink class="btn btn-primary btn-sm" :to="`/reviews/${task.id}`"
                          :aria-label="t('admin.reviews.table.openLabel', { file: task.filename })">
                  {{ t('admin.reviews.table.open') }}
                </NuxtLink>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </main>
</template>
