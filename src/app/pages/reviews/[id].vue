<script setup lang="ts">
import { reviewsService } from '~/services/reviews'
/**
 * Eine Aufgabe der Formatpruefung entscheiden.
 *
 * Die Entscheidung gilt der Kopfzeile, nicht der einzelnen Datei — deshalb
 * steht daneben, wie viele Dateien darauf warten, und die Zuordnung laesst sich
 * ausdruecklich auf eine Datei begrenzen.
 */
import { apiFailure, failureText } from '~/components/records/errors'

const pruefung = reviewsService()

const route = useRoute()
const router = useRouter()
const { t, te } = useI18n()

const id = computed(() => String(route.params.id ?? ''))
const { data, error } = await usePruefung(id)

const loadError = computed(() => (error.value ? failureText(t, te, apiFailure(error.value), ['admin', 'imports']) : ''))
const review = computed(() => data.value?.review ?? null)
const waiting = computed(() => data.value?.waiting ?? [])

useHead({ title: () => (review.value ? `${review.value.filename} · ${t('admin.reviews.crumb')}` : t('admin.reviews.crumb')) })

const converterKey = ref('')
const scope = ref<'task' | 'file'>('task')
const busy = ref(false)
const actionError = ref('')
const rejectOpen = ref(false)

watch(data, (d) => {
  if (d != null && converterKey.value === '') converterKey.value = d.converters[0]?.key ?? ''
}, { immediate: true })

async function assign() {
  if (busy.value || converterKey.value === '') return
  busy.value = true
  actionError.value = ''
  try {
    const res = await pruefung.zuweisen(id.value, { converterKey: converterKey.value, scope: scope.value })
    await router.push({ path: '/reviews', query: { assigned: res.label, count: String(res.started) } })
  } catch (e) {
    actionError.value = failureText(t, te, apiFailure(e), ['admin', 'imports'])
  } finally {
    busy.value = false
  }
}

async function reject() {
  if (busy.value) return
  busy.value = true
  actionError.value = ''
  try {
    const res = await pruefung.ablehnen(id.value, { scope: 'file' })
    rejectOpen.value = false
    await router.push({ path: '/reviews', query: { rejected: String(res.rejected) } })
  } catch (e) {
    rejectOpen.value = false
    actionError.value = failureText(t, te, apiFailure(e), ['admin', 'imports'])
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <main id="main" class="appwrap">
    <nav class="crumbs" :aria-label="t('admin.reviews.crumb')">
      <NuxtLink to="/reviews">{{ t('admin.reviews.crumb') }}</NuxtLink>
      <span class="sep" aria-hidden="true">/</span>
      <span>{{ review?.filename ?? id }}</span>
    </nav>

    <div role="alert" aria-live="assertive" v-if="loadError !== ''" class="ui-alert">{{ loadError }}</div>

    <template v-else-if="review !== null && data != null">
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:16px">
        <h1 style="font-size:19px">{{ review.filename }}</h1>
        <span v-if="review.baseFormat" class="fmt">{{ review.baseFormat.toUpperCase() }}</span>
        <span class="badge b-wait"><span class="bd"></span>{{ t('admin.reviews.detail.heading') }}</span>
        <span class="dim small">
          {{ review.institutionName ?? t('admin.reviews.table.none') }} ·
          <ImportsTimeStamp :value="review.uploadedAt" />
        </span>
      </div>

      <div class="live-region" role="alert" aria-live="assertive">
        <div v-if="actionError !== ''" class="ui-alert" style="margin-bottom:14px">{{ actionError }}</div>
      </div>

      <div class="grid2" style="align-items:start">
        <section class="ui-card" aria-labelledby="recognition-heading">
          <h2 id="recognition-heading" class="side-h" style="margin-bottom:12px">
            {{ t('admin.reviews.detail.recognition') }}
          </h2>
          <div class="frow" style="grid-template-columns:150px 1fr;padding:8px 0">
            <span>{{ t('admin.reviews.detail.baseFormat') }}</span>
            <span class="fval"><span class="fmt">{{ (review.baseFormat ?? '?').toUpperCase() }}</span></span>
          </div>
          <div class="frow" style="grid-template-columns:150px 1fr;padding:8px 0">
            <span>{{ t('admin.reviews.detail.fingerprint') }}</span>
            <span class="fval mono small" style="word-break:break-all">{{ review.fingerprint }}</span>
          </div>
          <div v-if="review.headerHash" class="frow" style="grid-template-columns:150px 1fr;padding:8px 0">
            <span>{{ t('admin.reviews.detail.headerHash') }}</span>
            <span class="fval mono small" style="word-break:break-all">{{ review.headerHash }}</span>
          </div>
          <div class="frow" style="grid-template-columns:150px 1fr;padding:8px 0">
            <span>{{ t('admin.reviews.detail.registry') }}</span>
            <span class="fval"><span class="badge b-danger"><span class="bd"></span>{{ t('admin.reviews.detail.noConverter') }}</span></span>
          </div>
          <div class="frow" style="grid-template-columns:150px 1fr;padding:8px 0;border-bottom:0">
            <span>{{ t('admin.reviews.detail.columns') }}</span>
            <span class="fval tnum">{{ data.sample.columns.length }}</span>
          </div>
          <p class="note">{{ t('admin.reviews.detail.note') }}</p>
        </section>

        <section class="ui-card" aria-labelledby="resolution-heading">
          <h2 id="resolution-heading" class="side-h" style="margin-bottom:12px">
            {{ t('admin.reviews.detail.resolution') }}
          </h2>
          <form class="stackform" @submit.prevent="assign">
            <p class="fn" style="font-size:13.5px;margin:0">{{ t('admin.reviews.detail.assignHeading') }}</p>
            <p class="note" style="margin:0">{{ t('admin.reviews.detail.assignText') }}</p>
            <div class="field" style="width:100%">
              <label for="converter">{{ t('admin.reviews.detail.converter') }}</label>
              <select id="converter" v-model="converterKey" class="ui-input" required>
                <option v-for="c in data.converters" :key="c.key" :value="c.key">{{ c.label }} ({{ c.key }})</option>
              </select>
            </div>
            <fieldset style="border:0;padding:0;margin:0">
              <legend class="sr-only">{{ t('admin.reviews.detail.assignHeading') }}</legend>
              <label class="checkline">
                <input v-model="scope" type="radio" value="task">
                {{ t('admin.reviews.detail.scopeTask', { count: waiting.length }) }}
              </label>
              <label class="checkline" style="margin-left:14px">
                <input v-model="scope" type="radio" value="file">
                {{ t('admin.reviews.detail.scopeFile') }}
              </label>
            </fieldset>
            <button class="btn btn-primary" type="submit" :disabled="busy || converterKey === ''">
              {{ busy ? t('admin.reviews.detail.assigning') : t('admin.reviews.detail.assign') }}
            </button>
          </form>

          <div style="display:flex;gap:8px;align-items:center;margin-top:14px">
            <a class="btn btn-outline btn-sm" :href="pruefung.originalPfad(review.importId)">
              <span aria-hidden="true">⤓</span> {{ t('admin.reviews.detail.download') }}
            </a>
            <button class="btn btn-outline btn-sm" type="button" style="margin-left:auto"
                    @click="rejectOpen = true">{{ t('admin.reviews.detail.reject') }}</button>
          </div>
        </section>
      </div>

      <section style="margin-top:16px" aria-labelledby="preview-heading">
        <h2 id="preview-heading" class="side-h" style="margin-bottom:9px">{{ t('admin.reviews.detail.preview') }}</h2>
        <p class="note" style="margin-top:0">{{ t('admin.reviews.detail.previewHint') }}</p>
        <AdminSamplePreview :columns="data.sample.columns" :rows="data.sample.rows" :tree="data.sample.tree" />
      </section>

      <section v-if="waiting.length > 1" style="margin-top:16px" aria-labelledby="waiting-heading">
        <h2 id="waiting-heading" class="side-h" style="margin-bottom:9px">
          {{ t('admin.reviews.detail.waitingHeading') }}
        </h2>
        <div class="tablewrap">
          <table>
            <caption class="sr-only">{{ t('admin.reviews.detail.waitingHeading') }}</caption>
            <thead>
              <tr>
                <th scope="col">{{ t('admin.reviews.detail.waitingFile') }}</th>
                <th scope="col">{{ t('admin.reviews.detail.waitingUploaded') }}</th>
                <th scope="col">{{ t('admin.reviews.detail.waitingStatus') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="f in waiting" :key="f.reviewId">
                <td class="fn">{{ f.filename }}</td>
                <td class="dim small tnum"><ImportsTimeStamp :value="f.uploadedAt" /></td>
                <td><ImportsStatusBadge :status="f.importStatus" /></td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <ImportsConfirmDialog :open="rejectOpen" :title="t('admin.reviews.detail.rejectTitle')"
                            :message="t('admin.reviews.detail.rejectText')"
                            :ok-text="t('admin.reviews.detail.rejectOk')" danger :busy="busy"
                            @confirm="reject" @cancel="rejectOpen = false" />
    </template>
  </main>
</template>
