<script setup lang="ts">
import { importsService } from '~/services/imports'
/**
 * Die Importliste.
 *
 * Je Zeile eine Handlung, die zum Stand passt, dazu das „…"-Menue mit allem
 * Weiteren. Ein abgeblendeter Knopf „Bearbeiten" wie im PHP-Stand steht hier
 * nicht mehr: Wo nichts zu bearbeiten ist, fuehrt der Weg zur Detailseite, und
 * die sagt, woran es liegt.
 */
import { apiFailure, failureText, type ApiFailure } from './errors'
import { fileSize, formatDetailLabel, formatNumber } from './format'
import type { ImportListItem } from './types'

const importe = importsService()

const props = defineProps<{
  items: ImportListItem[]
  sort?: { field: string; dir: 'asc' | 'desc' }
}>()
const emit = defineEmits<{ changed: []; message: [string]; sort: [feld: string] }>()

/**
 * Ein Spaltenkopf, nach dem sich sortieren laesst.
 *
 * aria-sort sagt einem Vorlesewerkzeug, wonach die Tabelle geordnet ist; ohne
 * das ist die Sortierung eine rein optische Angelegenheit.
 */
function sortState(feld: string): 'ascending' | 'descending' | 'none' {
  if (props.sort?.field !== feld) return 'none'
  return props.sort.dir === 'asc' ? 'ascending' : 'descending'
}

function sortPfeil(feld: string): string {
  const z = sortState(feld)
  return z === 'ascending' ? '▲' : z === 'descending' ? '▼' : ''
}

const { t, te, locale } = useI18n()

type Pending = { kind: 'delete' | 'reconvert'; item: ImportListItem } | null
const pending = ref<Pending>(null)
const busy = ref(false)
const failure = ref<ApiFailure | null>(null)
const failureMessage = computed(() => failureText(t, te, failure.value))

const dialogTitle = computed(() =>
  pending.value?.kind === 'delete' ? t('imports.confirm.delete.title') : t('imports.confirm.reconvert.title')
)
const dialogText = computed(() => {
  if (pending.value === null) return ''
  if (pending.value.kind === 'delete') return t('imports.confirm.delete.text')
  const edited = pending.value.item.edited
  // Die Zahl kommt aus records.edited_at, nicht aus einer Schaetzung: Wer
  // erfaehrt, dass drei Datensaetze verloren gehen, entscheidet anders als
  // jemand, dem nur „Aenderungen gehen verloren" gesagt wird.
  return edited > 0
    ? t('imports.confirm.reconvert.edited', { count: formatNumber(edited, locale.value) }, edited)
    : t('imports.confirm.reconvert.plain')
})
const dialogOk = computed(() => {
  if (pending.value === null) return ''
  if (pending.value.kind === 'delete') return t('imports.confirm.delete.ok')
  return pending.value.item.edited > 0
    ? t('imports.confirm.reconvert.okEdited')
    : t('imports.confirm.reconvert.ok')
})
const dialogDanger = computed(
  () => pending.value?.kind === 'delete' || (pending.value?.item.edited ?? 0) > 0
)

async function confirm() {
  const job = pending.value
  if (job === null) return
  busy.value = true
  failure.value = null
  try {
    if (job.kind === 'delete') {
      await importe.loeschen(job.item.id)
      emit('message', t('imports.toast.deleted'))
    } else {
      await importe.neuKonvertieren(job.item.id)
      emit('message', t('imports.toast.reconverting'))
    }
    pending.value = null
    emit('changed')
  } catch (e) {
    failure.value = apiFailure(e)
    pending.value = null
  } finally {
    busy.value = false
  }
}

function formatLabel(item: ImportListItem): string {
  // Bestandteile bevorzugt, weil nur sie uebersetzbar sind. Importe aus der
  // Zeit davor haben nur den fertigen deutschen Text in detected_format.
  const parts = formatDetailLabel(item.format_detail)
  if (parts !== null) return t(parts.key, parts.params, parts.count)
  return item.detected_format ?? (item.base_format ? item.base_format.toUpperCase() : '')
}

function sizeOf(bytes: number) {
  return fileSize(bytes, locale.value)
}

function progressOf(item: ImportListItem): number {
  return Math.max(0, Math.min(100, item.upload_progress))
}

/**
 * Der Fortschrittsbalken gilt nur, solange wirklich hochgeladen wird.
 *
 * Importe, die aus der Blattauswahl einer Arbeitsmappe entstehen, haben nie
 * einen eigenen Upload und behalten upload_progress = 0. Ohne diese
 * Unterscheidung behauptet die Liste bei einer laengst verarbeiteten Datei
 * „0 %", der Upload laufe noch.
 */
function isUploading(item: ImportListItem): boolean {
  return item.status === 'uploading'
}
</script>

<template>
  <div>
    <div class="live-region" role="alert" aria-live="assertive">
      <div v-if="failure !== null" class="ui-alert" style="margin-bottom:12px">{{ failureMessage }}</div>
    </div>

    <div v-if="props.items.length === 0" class="tablewrap">
      <div class="empty">
        <div class="ic" aria-hidden="true">📂</div>
        <p class="fn" style="font-size:15px;margin-bottom:4px">{{ t('imports.table.empty.heading') }}</p>
        <p class="small">{{ t('imports.table.empty.text') }}</p>
      </div>
    </div>

    <div v-else class="tablewrap imports-table">
      <table>
        <caption class="sr-only">{{ t('imports.table.caption') }}</caption>
        <!--
          Feste Tabellenbreite (.imports-table). Der Dateiname hat keine Breite und
          nimmt den Rest: Prozentwerte plus 200 px duerfen nie ueber 100 % kommen,
          sonst wird die Tabelle breiter als ihr Platz (#31, in Firefox bei jeder
          Fensterbreite). 56 % + 200 px lassen dem Dateinamen ab 760 px Tabellenbreite
          noch rund 130 px; darunter rollt die Huelle.
        -->
        <colgroup>
          <col><col style="width:11%"><col style="width:10%">
          <col style="width:15%"><col style="width:8%"><col style="width:12%">
          <col style="width:200px">
        </colgroup>
        <thead>
          <tr>
            <th scope="col" :aria-sort="sortState('filename')">
              <button type="button" class="th-sort" @click="emit('sort', 'filename')">
                {{ t('imports.table.file') }}<span aria-hidden="true">{{ sortPfeil('filename') }}</span>
              </button>
            </th>
            <th scope="col">{{ t('imports.table.format') }}</th>
            <th scope="col">{{ t('imports.table.upload') }}</th>
            <th scope="col" :aria-sort="sortState('status')">
              <button type="button" class="th-sort" @click="emit('sort', 'status')">
                {{ t('imports.table.processing') }}<span aria-hidden="true">{{ sortPfeil('status') }}</span>
              </button>
            </th>
            <th scope="col" :aria-sort="sortState('records')">
              <button type="button" class="th-sort" @click="emit('sort', 'records')">
                {{ t('imports.table.records') }}<span aria-hidden="true">{{ sortPfeil('records') }}</span>
              </button>
            </th>
            <th scope="col" :aria-sort="sortState('created')">
              <button type="button" class="th-sort" @click="emit('sort', 'created')">
                {{ t('imports.table.created') }}<span aria-hidden="true">{{ sortPfeil('created') }}</span>
              </button>
            </th>
            <th scope="col" style="text-align:right">{{ t('imports.table.actions') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in props.items" :key="item.id">
            <td>
              <div class="fn" :title="item.filename">{{ item.label || item.filename }}</div>
              <div v-if="item.label" class="dim small mono" :title="item.filename">{{ item.filename }}</div>
              <div v-if="sizeOf(item.filesize) !== null" class="dim small">
                {{ t(sizeOf(item.filesize)!.key, sizeOf(item.filesize)!.params) }}
              </div>
            </td>
            <td>
              <span v-if="formatLabel(item) !== ''" class="fmt" :title="formatLabel(item)">{{ formatLabel(item) }}</span>
              <span v-else class="dim">{{ t('imports.table.none') }}</span>
            </td>
            <td style="min-width:110px">
              <template v-if="isUploading(item)">
                <div class="prog acc" role="progressbar"
                     aria-valuemin="0" aria-valuemax="100" :aria-valuenow="progressOf(item)"
                     :aria-label="t('imports.table.progressLabel', { percent: progressOf(item) })">
                  <i :style="{ width: progressOf(item) + '%' }" />
                </div>
                <div class="dim small tnum" aria-hidden="true">{{ progressOf(item) }} %</div>
              </template>
              <span v-else class="dim small">{{ t('imports.table.uploadDone') }}</span>
            </td>
            <td>
              <ImportsStatusBadge :status="item.status" :stale="item.stale"
                                  :ran-with-version="item.ranWithVersion" :profile-version="item.profileVersion" />
              <!-- Die Schemapruefung steht unter dem Verarbeitungsstand, nicht daneben:
                   zwei Aussagen, eine Spalte, keine zusaetzliche Breite. -->
              <div style="margin-top:4px"><ImportsValidationBadge :item="item" /></div>
            </td>
            <td class="tnum">
              <template v-if="item.record_count > 0">{{ formatNumber(item.record_count, locale) }}</template>
              <span v-else class="dim">{{ t('imports.table.none') }}</span>
            </td>
            <td class="dim small tnum"><ImportsTimeStamp :value="item.created_at" /></td>
            <td style="text-align:right">
              <!--
                Sichtbar bleibt das kurze Wort. Vorgelesen wird die Zeile samt
                Dateiname — sonst stehen in der Liste ein Dutzend gleich
                lautender Links nebeneinander, wie beim „…"-Menue schon laenger
                geloest.
              -->
              <div class="rowactions">
                <NuxtLink v-if="item.status === 'awaiting_sheet_choice'" class="btn btn-primary btn-sm"
                          :to="`/imports/${item.id}/sheets`"
                          :aria-label="t('imports.action.chooseSheetFor', { name: item.filename })">
                  {{ t('imports.action.chooseSheet') }}</NuxtLink>
                <NuxtLink v-else-if="item.status === 'awaiting_format_review' && item.tabular"
                          class="btn btn-primary btn-sm" :to="`/imports/${item.id}/mapping`"
                          :aria-label="t('imports.action.mapFor', { name: item.filename })">
                  {{ t('imports.action.map') }}</NuxtLink>
                <NuxtLink v-else-if="item.status === 'converted'" class="btn btn-primary btn-sm"
                          :to="`/imports/${item.id}/records`"
                          :aria-label="t('imports.action.editFor', { name: item.filename })">
                  {{ t('imports.action.edit') }}</NuxtLink>
                <NuxtLink v-else class="btn btn-outline btn-sm" :to="`/imports/${item.id}`"
                          :aria-label="t('imports.action.detailsFor', { name: item.filename })"
                          :style="item.status === 'error' ? 'color:var(--danger);border-color:var(--danger)' : undefined">
                  {{ t('imports.action.details') }}</NuxtLink>

                <ImportsRowMenu :item="item" @delete="pending = { kind: 'delete', item }"
                                @reconvert="pending = { kind: 'reconvert', item }" />
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <ImportsConfirmDialog :open="pending !== null" :title="dialogTitle" :message="dialogText" :ok-text="dialogOk"
                          :danger="dialogDanger" :busy="busy" @cancel="pending = null" @confirm="confirm" />
  </div>
</template>
