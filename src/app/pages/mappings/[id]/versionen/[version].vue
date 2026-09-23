<script setup lang="ts">
/**
 * Eine gespeicherte Profilversion ansehen — nur lesend.
 *
 * Zwei Wege fuehren hierher, und beide hatten dieselbe Luecke. Am Profil bot
 * der Verlauf nur "Zuruecksetzen" an: Man setzte auf einen Stand zurueck, den
 * man nicht kannte. Und an einem Import zeigte "Zuordnung ansehen" das Profil
 * in seiner heutigen Version statt in der, mit der konvertiert wurde (#6,
 * gemeldet von Jasper Stratil).
 *
 * Bewusst nicht der Editor. Eine alte Version dort zu laden waere eine Falle:
 * Ein Klick auf Speichern schriebe den alten Stand als neuen fort. Hier gibt es
 * nichts zu klicken, was etwas veraendert.
 */
import type { TargetEntry, TransformStep } from '#shared/types/domain'

const route = useRoute()
const { t, te } = useI18n()

const id = computed(() => String(route.params.id ?? ''))
const version = computed(() => Number(route.params.version ?? 0))

const { data, error } = await useZuordnungsVersion(id, version)

const zielIndex = computed(() => {
  const m = new Map<string, TargetEntry & { schemaPath: string }>()
  for (const z of data.value?.targets ?? []) m.set(z.key, z)
  return m
})

function zielName(key: string): string {
  const z = zielIndex.value.get(key)
  if (z === undefined) return key
  const i18nKey = `mapping.targets.${key}`
  const label = te(i18nKey) ? t(i18nKey) : z.label
  return `${t(`mapping.level.${z.level}`)} › ${label}`
}

function zielPfad(key: string): string {
  return zielIndex.value.get(key)?.schemaPath ?? ''
}

/** Einen Konverterschritt in Worte fassen, wie der Editor ihn beschriftet. */
function schrittText(step: TransformStep): string {
  const op = String(step.op ?? '')
  const key = `mapping.op.${op}`
  const name = te(key) ? t(key) : op
  const teile: string[] = []
  for (const [k, v] of Object.entries(step)) {
    if (k === 'op' || v === undefined || v === null || v === '') continue
    teile.push(`${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
  }
  return teile.length === 0 ? name : `${name} (${teile.join(', ')})`
}

/** Spalten in der Reihenfolge des Profils, mit aufgeloesten Zielen. */
const spalten = computed(() => {
  const cols = data.value?.mapping.columns ?? {}
  return Object.entries(cols).map(([name, spec]) => {
    const s = (spec ?? {}) as {
      ignore?: boolean
      pre?: TransformStep[]
      targets?: Array<{ target?: string; post?: TransformStep[] }>
    }
    return {
      name,
      ignoriert: s.ignore === true,
      vor: Array.isArray(s.pre) ? s.pre : [],
      zweige: (s.targets ?? []).map((b) => ({
        ziel: String(b.target ?? ''),
        nach: Array.isArray(b.post) ? b.post : []
      }))
    }
  })
})

const gruppierung = computed(() => {
  const by = data.value?.mapping.grouping?.work?.by ?? []
  if (by.length === 0) return t('mapping.versionView.noGrouping')
  return by.map((raw) => {
    const k = String(raw)
    if (k.startsWith('column:')) return t('mapping.versionView.byColumn', { name: k.slice(7) })
    if (k.startsWith('target:')) return zielName(k.slice(7))
    return k
  }).join(' + ')
})

useHead({ title: () => `${data.value?.profile.name ?? id.value} · ${t('mapping.versionView.crumb', { n: version.value })}` })
</script>

<template>
  <main id="main" class="appwrap">
    <nav class="crumbs" :aria-label="t('mapping.versionView.crumb', { n: version })">
      <NuxtLink to="/mappings">{{ t('mapping.nav.mappings') }}</NuxtLink>
      <span class="sep" aria-hidden="true">/</span>
      <NuxtLink :to="`/mappings/${id}`">{{ data?.profile.name ?? id }}</NuxtLink>
      <span class="sep" aria-hidden="true">/</span>
      <span>{{ t('mapping.versionView.crumb', { n: version }) }}</span>
    </nav>

    <div v-if="error" role="alert" class="ui-alert">{{ t('mapping.versionView.loadError') }}</div>

    <template v-else-if="data">
      <header style="margin-bottom:14px">
        <h1 style="margin:0 0 6px">{{ t('mapping.versionView.heading', { n: data.version.version }) }}</h1>
        <p class="dim small" style="margin:0">
          {{ data.profile.name }}
          <template v-if="data.version.createdAt">
            · <ImportsTimeStamp :value="data.version.createdAt" />
          </template>
          <template v-if="data.version.userName"> · {{ data.version.userName }}</template>
          <span v-if="data.version.isCurrent" class="badge b-ok" style="margin-left:6px">
            <span class="bd" />{{ t('mapping.detail.active') }}
          </span>
          <span v-else class="badge b-neutral" style="margin-left:6px">
            {{ t('mapping.versionView.olderThan', { n: data.profile.currentVersion }) }}
          </span>
        </p>
        <p class="note" style="margin:10px 0 0">{{ t('mapping.versionView.readOnly') }}</p>
      </header>

      <section class="ui-card" style="margin-bottom:18px">
        <div class="frow" style="grid-template-columns:200px 1fr;padding:7px 0;border-bottom:0">
          <span>{{ t('mapping.versionView.grouping') }}</span>
          <span class="fval">{{ gruppierung }}</span>
        </div>
      </section>

      <h2 class="side-h" style="margin:0 0 8px">{{ t('mapping.versionView.columns', { n: spalten.length }) }}</h2>
      <div class="tablewrap">
        <table class="ui-table">
          <caption class="sr-only">{{ t('mapping.versionView.tableCaption', { n: data.version.version }) }}</caption>
          <thead>
            <tr>
              <th scope="col">{{ t('mapping.versionView.column') }}</th>
              <th scope="col">{{ t('mapping.versionView.target') }}</th>
              <th scope="col">{{ t('mapping.versionView.chain') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="sp in spalten" :key="sp.name">
              <th scope="row" class="mono small">{{ sp.name }}</th>
              <td>
                <span v-if="sp.ignoriert" class="dim small">{{ t('mapping.versionView.ignored') }}</span>
                <span v-else-if="sp.zweige.length === 0" class="dim small">
                  {{ t('mapping.versionView.untouched') }}
                </span>
                <ul v-else class="plain">
                  <li v-for="(zw, i) in sp.zweige" :key="i">
                    {{ zielName(zw.ziel) }}
                    <span class="dim small mono" style="display:block">{{ zielPfad(zw.ziel) }}</span>
                  </li>
                </ul>
              </td>
              <td>
                <p v-if="sp.vor.length > 0" class="small" style="margin:0 0 4px">
                  <span class="dim">{{ t('mapping.versionView.pre') }}:</span>
                  {{ sp.vor.map(schrittText).join(' → ') }}
                </p>
                <ul v-if="sp.zweige.some((z) => z.nach.length > 0)" class="plain small">
                  <li v-for="(zw, i) in sp.zweige" :key="i">
                    <template v-if="zw.nach.length > 0">{{ zw.nach.map(schrittText).join(' → ') }}</template>
                    <span v-else class="dim">–</span>
                  </li>
                </ul>
                <span v-else-if="sp.vor.length === 0" class="dim small">–</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </main>
</template>
