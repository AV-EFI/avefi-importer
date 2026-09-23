<script setup lang="ts">
import { mappingsService, type ProfileRow } from '~/services/mappings'
/**
 * Uebersicht der Mappingprofile.
 *
 * Profile sind global sichtbar, eigene zuerst. Fremde lassen sich ansehen und
 * exportieren, aber nicht aendern: Sie sind anderswo produktiv im Einsatz.
 * Uebernommen werden sie beim Zuordnen einer eigenen Datei — als Kopie.
 */
import { failureText, mappingFailure, type MappingFailure } from '~/components/mapping/errors'

const zuordnungen = mappingsService()

const { t, te, locale } = useI18n()
useHead({ title: () => t('mapping.list.title') })

const { data, error, refresh } = await useZuordnungsListe()

const loadError = computed(() => (error.value ? failureText(t, te, mappingFailure(error.value)) : ''))
const alleProfile = computed(() => data.value?.profiles ?? [])

/*
 * Suchen und Sortieren (#2, Matti Stoehr).
 *
 * Anders als bei den Importen wird hier im Browser gerechnet, und das ist kein
 * Versehen: Die Liste ist vollstaendig da — sie kommt nicht seitenweise und
 * hat keine Obergrenze —, also ordnet eine Sortierung im Browser den ganzen
 * Bestand und nicht nur einen Ausschnitt. Genau davor warnt das Issue, und
 * genau der Fall liegt hier nicht vor. Waechst die Liste doch in eine
 * Groessenordnung mit Seiten, gehoert sie auf den Weg der Importliste.
 *
 * Die Auswahl steht trotzdem in der Adresse, damit sich eine gefilterte Liste
 * weitergeben laesst.
 */
const route = useRoute()
const suche = ref(String(route.query.q ?? ''))
const sortFeld = computed(() => String(route.query.sort ?? 'changed'))
/*
 * Ohne ausdrueckliche Richtung die naheliegende: Namen aufsteigend, Zahlen und
 * Zeitpunkte absteigend. Wer nach „zuletzt geaendert" sortiert, meint das
 * Neueste zuerst; wer nach Namen sortiert, meint A vor Z.
 */
const ABSTEIGEND_ZUERST = new Set(['changed', 'used'])
const sortAb = computed(() => {
  const dir = String(route.query.dir ?? '')
  if (dir !== '') return dir === 'desc'
  return ABSTEIGEND_ZUERST.has(sortFeld.value)
})

async function setzeAuswahl(teil: Record<string, string | null>) {
  const q: Record<string, string> = {}
  for (const k of ['q', 'sort', 'dir'] as const) {
    const v = String(route.query[k] ?? '')
    if (v !== '') q[k] = v
  }
  for (const [k, v] of Object.entries(teil)) {
    if (v === null || v === '') delete q[k]
    else q[k] = v
  }
  await navigateTo({ path: '/mappings', query: q })
}

function sortiereNach(feld: string) {
  const gleich = sortFeld.value === feld
  const start = feld === 'name' || feld === 'institution' ? 'asc' : 'desc'
  const dir = gleich ? (sortAb.value ? 'asc' : 'desc') : start
  return setzeAuswahl({ sort: feld === 'changed' && dir === 'desc' ? null : feld, dir })
}

function sortState(feld: string): 'ascending' | 'descending' | 'none' {
  if (sortFeld.value !== feld) return 'none'
  return sortAb.value ? 'descending' : 'ascending'
}

function sortPfeil(feld: string): string {
  const z = sortState(feld)
  return z === 'ascending' ? '▲' : z === 'descending' ? '▼' : ''
}

function vergleiche(a: ProfileRow, b: ProfileRow): number {
  switch (sortFeld.value) {
    case 'name': return a.name.localeCompare(b.name, 'de')
    case 'institution': return a.institution_name.localeCompare(b.institution_name, 'de')
    case 'used': return a.use_count - b.use_count
    case 'base': return a.base_format.localeCompare(b.base_format)
    default: return String(a.updated_at).localeCompare(String(b.updated_at))
  }
}

const profiles = computed(() => {
  const q = suche.value.trim().toLowerCase()
  const gefiltert = q === ''
    ? [...alleProfile.value]
    : alleProfile.value.filter(
        (p) => `${p.name} ${p.institution_name}`.toLowerCase().includes(q)
      )
  return gefiltert.sort((a, b) => (sortAb.value ? -1 : 1) * vergleiche(a, b))
})

/* -------------------------------------------------- Exportiertes Profil einlesen */

const importFailure = ref<MappingFailure | null>(null)
const importMessage = ref('')
const importBusy = ref(false)
const importError = computed(() => failureText(t, te, importFailure.value))

async function onProfileFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (file === undefined) return
  importFailure.value = null
  importMessage.value = ''
  importBusy.value = true
  try {
    let document: unknown
    try {
      document = JSON.parse(await file.text())
    } catch {
      importFailure.value = { code: 'export_unreadable', params: {}, status: 422 }
      return
    }
    const res = await zuordnungen.einfuehren(document)
    await refresh()
    importMessage.value = res.hasSample
      ? t(res.created ? 'mapping.list.imported' : 'mapping.list.updated', { name: res.profile.name })
      : t('mapping.list.importedNoSample', { name: res.profile.name })
    await navigateTo(res.hasSample ? `/mappings/${res.profile.id}/edit` : `/mappings/${res.profile.id}`)
  } catch (e) {
    importFailure.value = mappingFailure(e)
  } finally {
    importBusy.value = false
    input.value = ''
  }
}

function formatDate(value: string): string {
  const normalised = value.trim().replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00')
  const date = new Date(normalised)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat(locale.value, { day: '2-digit', month: '2-digit', year: 'numeric' }).format(date)
}
</script>

<template>
  <main id="main" class="appwrap">
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;flex-wrap:wrap">
      <h1 style="font-size:19px">{{ t('mapping.list.heading') }}</h1>
      <span class="dim small">{{ t('mapping.list.count', { n: profiles.length }, profiles.length) }}</span>
    </div>

    <div class="live-region" role="alert" aria-live="assertive">
      <div v-if="loadError" class="ui-alert" style="margin-bottom:14px">{{ loadError }}</div>
    </div>
    <div class="live-region" role="alert" aria-live="assertive">
      <div v-if="importError" class="ui-alert" style="margin-bottom:14px">{{ importError }}</div>
    </div>
    <div class="live-region" role="status" aria-live="polite">
      <div v-if="importMessage" class="ui-alert ui-alert-ok" style="margin-bottom:14px">{{ importMessage }}</div>
    </div>

    <div class="newprofile">
      <h2 style="font-size:14px;margin-bottom:5px">{{ t('mapping.list.newHeading') }}</h2>
      <p class="note" style="margin:0">{{ t('mapping.list.newHint') }}</p>
      <p class="row">
        <NuxtLink class="btn btn-primary btn-sm" to="/mappings/new">{{ t('mapping.list.newAction') }}</NuxtLink>
      </p>

      <details style="margin-top:12px">
        <summary class="dim small" style="cursor:pointer">{{ t('mapping.list.importSummary') }}</summary>
        <p class="note">{{ t('mapping.list.importHint') }}</p>
        <p class="row">
          <label class="sr-only" for="profilejson">{{ t('mapping.list.importLabel') }}</label>
          <input id="profilejson" class="ui-input" type="file" accept=".json,application/json"
                 style="max-width:320px" :disabled="importBusy" @change="onProfileFile">
        </p>
      </details>
    </div>

    <section class="listfilter" :aria-label="t('imports.filter.heading')">
      <form class="ff" role="search" @submit.prevent="setzeAuswahl({ q: suche.trim() || null })">
        <label class="sr-only" for="psuche">{{ t('mapping.list.search') }}</label>
        <input id="psuche" v-model="suche" class="ui-input" type="search"
               :placeholder="t('mapping.list.searchPlaceholder')">
        <button class="btn btn-outline btn-sm" type="submit">{{ t('imports.filter.apply') }}</button>
      </form>
      <p class="dim small" style="margin:0 0 0 auto" aria-live="polite">
        <template v-if="profiles.length !== alleProfile.length">
          {{ t('mapping.list.shownOf', { shown: profiles.length, total: alleProfile.length }) }}
          <button type="button" class="linklike" @click="suche = ''; setzeAuswahl({ q: null })">
            {{ t('imports.filter.clear') }}
          </button>
        </template>
      </p>
    </section>

    <div v-if="profiles.length === 0" class="tablewrap">
      <div class="empty">
        <p class="ic" aria-hidden="true">🗺</p>
        <p class="fn" style="font-size:15px;margin-bottom:4px">{{ t('mapping.list.emptyHeading') }}</p>
        <p class="small">{{ t('mapping.list.emptyText') }}</p>
      </div>
    </div>

    <div v-else class="tablewrap">
      <table>
        <caption class="sr-only">{{ t('mapping.list.caption') }}</caption>
        <thead>
          <tr>
            <th scope="col" :aria-sort="sortState('name')">
              <button type="button" class="th-sort" @click="sortiereNach('name')">
                {{ t('mapping.list.name') }}<span aria-hidden="true">{{ sortPfeil('name') }}</span>
              </button>
            </th>
            <th scope="col" :aria-sort="sortState('institution')">
              <button type="button" class="th-sort" @click="sortiereNach('institution')">
                {{ t('mapping.list.institution') }}<span aria-hidden="true">{{ sortPfeil('institution') }}</span>
              </button>
            </th>
            <th scope="col" :aria-sort="sortState('base')">
              <button type="button" class="th-sort" @click="sortiereNach('base')">
                {{ t('mapping.list.base') }}<span aria-hidden="true">{{ sortPfeil('base') }}</span>
              </button>
            </th>
            <th scope="col">{{ t('mapping.list.state') }}</th>
            <th scope="col" :aria-sort="sortState('used')">
              <button type="button" class="th-sort" @click="sortiereNach('used')">
                {{ t('mapping.list.used') }}<span aria-hidden="true">{{ sortPfeil('used') }}</span>
              </button>
            </th>
            <th scope="col" :aria-sort="sortState('changed')">
              <button type="button" class="th-sort" @click="sortiereNach('changed')">
                {{ t('mapping.list.changed') }}<span aria-hidden="true">{{ sortPfeil('changed') }}</span>
              </button>
            </th>
            <th scope="col" style="text-align:right">{{ t('mapping.list.action') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="profile in profiles" :key="profile.id">
            <td>
              <div class="fn">{{ profile.name }}</div>
              <div class="dim small">
                {{ t('mapping.list.version', { n: profile.version }) }}
                <template v-if="profile.user_name"> · {{ t('mapping.list.by', { name: profile.user_name }) }}</template>
              </div>
            </td>
            <td>
              {{ profile.institution_name }}
              <span v-if="profile.own" class="fmt" style="margin-left:6px">{{ t('mapping.list.own') }}</span>
            </td>
            <td><span class="fmt">{{ profile.base_format.toUpperCase() }}</span></td>
            <td>
              <span v-if="profile.complete" class="badge b-ok"><span class="bd" />{{ t('mapping.list.complete') }}</span>
              <span v-else class="badge b-wait"><span class="bd" />{{ t('mapping.list.incomplete') }}</span>
              <span v-if="!profile.has_sample" class="badge b-warn" style="margin-left:4px">
                <span class="bd" />{{ t('mapping.list.noSample') }}
              </span>
            </td>
            <td class="tnum">{{ t('mapping.list.imports', { n: profile.use_count }) }}</td>
            <td class="dim small tnum">{{ formatDate(profile.updated_at) }}</td>
            <td style="text-align:right">
              <!--
                Sichtbar bleibt das kurze Wort beziehungsweise das Sinnbild.
                Vorgelesen wird die Handlung samt Profilnamen; das Sinnbild
                selbst ist ausgeblendet und gehoert nicht in den Namen.
              -->
              <div class="rowactions">
                <NuxtLink v-if="profile.own && profile.has_sample" class="btn btn-primary btn-sm"
                          :to="`/mappings/${profile.id}/edit`"
                          :aria-label="t('mapping.list.editFor', { name: profile.name })">
                  {{ t('mapping.list.edit') }}</NuxtLink>
                <NuxtLink class="btn btn-outline btn-sm" :to="`/mappings/${profile.id}`"
                          :aria-label="t('mapping.list.viewFor', { name: profile.name })">
                  {{ t('mapping.list.view') }}
                </NuxtLink>
                <a class="btn btn-outline btn-sm" :href="zuordnungen.ausfuhrPfad(profile.id)"
                   :title="t('mapping.list.exportFor', { name: profile.name })"
                   :aria-label="t('mapping.list.exportFor', { name: profile.name })"><span
                     aria-hidden="true">⭳</span></a>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <p class="note" style="margin-top:14px">{{ t('mapping.list.footer') }}</p>
  </main>
</template>
