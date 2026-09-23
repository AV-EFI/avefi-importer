<script setup lang="ts">
import { importsService } from '~/services/imports'
/**
 * Auswahl der Tabellenblaetter einer Arbeitsmappe.
 *
 * Der Vertrag verlangt, dass sich bei mehreren Blaettern waehlen laesst, welches
 * importiert wird. Jedes gewaehlte Blatt wird ein eigener Import: Zwei Blaetter
 * mit verschiedenen Spalten brauchen verschiedene Zuordnungen.
 */
import { apiFailure, failureText, type ApiFailure } from '~/components/imports/errors'
import { formatNumber } from '~/components/imports/format'

const importe = importsService()

const route = useRoute()
const { t, te, locale } = useI18n()
const id = computed(() => String(route.params.id ?? ''))

const { data, error } = await useImportBlaetter(id)

const loadFailure = computed<ApiFailure | null>(() => (error.value ? apiFailure(error.value) : null))
const loadError = computed(() => failureText(t, te, loadFailure.value))
const sheets = computed(() => data.value?.sheets ?? [])
const filename = computed(() => data.value?.import.filename ?? id.value)

useHead({ title: () => `${filename.value} · ${t('imports.sheets.crumb')}` })

const chosen = ref<string[]>([])
watch(
  sheets,
  (list) => {
    // Vorausgewaehlt ist, was nach einer Tabelle aussieht. Deckblaetter und
    // Legenden muss niemand abwaehlen, der sie ohnehin nicht will.
    if (chosen.value.length === 0) chosen.value = list.filter((s) => s.usable).map((s) => s.name)
  },
  { immediate: true }
)

const busy = ref(false)
const failure = ref<ApiFailure | null>(null)
const submitError = computed(() => failureText(t, te, failure.value))

function selectUsable() {
  chosen.value = sheets.value.filter((s) => s.usable).map((s) => s.name)
}
function selectNone() {
  chosen.value = []
}

async function submit() {
  failure.value = null
  if (chosen.value.length === 0) {
    failure.value = { code: 'no_selection', params: {}, status: 400 }
    return
  }
  busy.value = true
  try {
    const res = await importe.blaetterWaehlen(id.value, chosen.value)
    await navigateTo({ path: '/', query: { sheets: String(res.ids.length) } })
  } catch (e) {
    failure.value = apiFailure(e)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <main id="main" class="appwrap">
    <nav class="crumbs" :aria-label="t('imports.sheets.crumb')">
      <NuxtLink to="/">{{ t('imports.heading') }}</NuxtLink>
      <span class="sep" aria-hidden="true">/</span>
      <NuxtLink :to="`/imports/${id}`">{{ filename }}</NuxtLink>
      <span class="sep" aria-hidden="true">/</span>
      <span>{{ t('imports.sheets.crumb') }}</span>
    </nav>

    <div role="alert" aria-live="assertive" v-if="loadFailure !== null" class="ui-alert">{{ loadError }}</div>

    <template v-else>
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:16px">
        <h1 style="font-size:19px">{{ t('imports.sheets.heading') }}</h1>
        <span class="fmt">XLSX</span>
        <span class="dim small">{{ filename }}</span>
      </div>

      <p class="note" style="margin-bottom:14px">{{ t('imports.sheets.lead') }}</p>

      <div class="live-region" role="alert" aria-live="assertive">
        <div v-if="submitError !== ''" class="ui-alert" style="margin-bottom:14px">{{ submitError }}</div>
      </div>

      <div v-if="sheets.length === 0" class="tablewrap">
        <div class="empty">
          <div class="ic" aria-hidden="true">📄</div>
          <p class="fn" style="font-size:15px;margin-bottom:4px">{{ t('imports.sheets.empty.heading') }}</p>
          <p class="small">{{ t('imports.sheets.empty.text') }}</p>
          <p style="margin-top:16px"><NuxtLink class="btn btn-primary btn-sm" to="/">{{ t('imports.action.overview') }}</NuxtLink></p>
        </div>
      </div>

      <form v-else @submit.prevent="submit">
        <fieldset style="border:0;padding:0;margin:0">
          <legend class="sr-only">{{ t('imports.sheets.caption') }}</legend>

          <p style="display:flex;gap:8px;margin-bottom:10px">
            <button type="button" class="ghost" @click="selectUsable">{{ t('imports.sheets.selectAll') }}</button>
            <button type="button" class="ghost" @click="selectNone">{{ t('imports.sheets.selectNone') }}</button>
          </p>

          <div class="tablewrap">
            <table>
              <caption class="sr-only">{{ t('imports.sheets.caption') }}</caption>
              <thead>
                <tr>
                  <th scope="col" style="width:56px"><span class="sr-only">{{ t('imports.sheets.select') }}</span></th>
                  <th scope="col">{{ t('imports.sheets.name') }}</th>
                  <th scope="col">{{ t('imports.sheets.rows') }}</th>
                  <th scope="col">{{ t('imports.sheets.cols') }}</th>
                  <th scope="col">{{ t('imports.sheets.assessment') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="sheet in sheets" :key="sheet.name" :class="sheet.usable ? undefined : 'row-ignored'">
                  <td>
                    <input :id="`sheet-${sheet.index}`" v-model="chosen" type="checkbox" :value="sheet.name"
                           style="width:auto">
                  </td>
                  <td><label class="fn" :for="`sheet-${sheet.index}`" style="cursor:pointer">{{ sheet.name }}</label></td>
                  <td class="tnum">{{ formatNumber(sheet.rows, locale) }}</td>
                  <td class="tnum">{{ formatNumber(sheet.cols, locale) }}</td>
                  <td class="dim small">
                    {{ sheet.usable ? t('imports.sheets.usable') : t('imports.sheets.unusable') }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </fieldset>

        <p class="dim small" role="status" aria-live="polite" style="margin-top:10px">
          {{ t('imports.sheets.selected', { count: chosen.length }, chosen.length) }}
        </p>

        <div style="display:flex;gap:8px;align-items:center;margin-top:12px">
          <button class="btn btn-primary" type="submit" :disabled="busy">
            {{ busy ? t('imports.sheets.submitting') : t('imports.sheets.submit') }}
          </button>
          <NuxtLink class="btn btn-outline" to="/">{{ t('imports.confirm.cancel') }}</NuxtLink>
        </div>
      </form>
    </template>
  </main>
</template>
