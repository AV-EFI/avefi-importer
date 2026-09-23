<script setup lang="ts">
import { mappingsService } from '~/services/mappings'
/**
 * Normdaten eines Profils zuordnen — als eigener Schritt.
 *
 * Warum eine eigene Seite und nicht nur die Liste im Zweig: Der Zuordnungs-
 * editor rechnet nach jeder Aenderung neu und zeigt deshalb je Spalte drei
 * Beispielwerte. Wer alle Werte einer Spalte durchgehen will, braucht eine
 * Ansicht, die nicht bei jedem Tastendruck arbeitet. Sie haengt am Profil und
 * nicht am Import, weil die bestaetigten Zuordnungen im Profil gespeichert
 * werden und beim naechsten Import derselben Einrichtung wieder greifen —
 * genau das braucht die zweite Testperson, die Lucas Profil einliest.
 *
 * Gerechnet wird auch hier auf dem Server, mit demselben Kettencode wie
 * Vorschau und Konvertierung.
 */
import type { ColumnMapping, MappingJson } from '#shared/types/domain'
import MappingAuthorityDialog from '~/components/mapping/AuthorityDialog.vue'
import { failureText, mappingFailure } from '~/components/mapping/errors'
import type {

  AuthorityCandidate, AuthorityRequest, AuthorityValuesResponse, CandidateResponse, EditorPayload
} from '~/components/mapping/types'

const zuordnungen = mappingsService()

const route = useRoute()
const { t, te } = useI18n()
const id = computed(() => String(route.params.id ?? ''))

const { data, error } = await useZuordnungsEditor(id)
const failure = computed(() => (error.value ? mappingFailure(error.value) : null))
const loadError = computed(() => failureText(t, te, failure.value))
const subject = computed(() => data.value?.payload.subject ?? id.value)

const mapping = ref<MappingJson>({ columns: {} } as MappingJson)
watch(data, (d) => {
  if (d?.payload.mapping !== undefined) mapping.value = JSON.parse(JSON.stringify(d.payload.mapping)) as MappingJson
}, { immediate: true })

const groups = ref<AuthorityValuesResponse['groups']>([])
const open = ref(0)
const busy = ref(false)
const onlyOpen = ref(false)
const note = ref('')
const noteKind = ref<'ok' | 'bad'>('ok')

async function load() {
  busy.value = true
  try {
    const res = await zuordnungen.normdatenWerte(id.value, mapping.value)
    groups.value = res.groups
    open.value = res.open
  } catch (e) {
    note.value = failureText(t, te, mappingFailure(e))
    noteKind.value = 'bad'
  } finally {
    busy.value = false
  }
}

onMounted(() => { void load() })

const total = computed(() => groups.value.reduce((n, g) => n + g.values.length, 0))

/** Lesbare Bezeichnung der gesuchten Normdatenart. */
function kindLabel(kind: string): string {
  const key = `mapping.authority.kind.${kind}`
  return te(key) ? t(key) : kind
}

function valuesOf(group: AuthorityValuesResponse['groups'][number]) {
  return onlyOpen.value ? group.values.filter((v) => v.state === 'offen') : group.values
}

function spec(column: string): ColumnMapping {
  const cols = (mapping.value.columns ??= {})
  return (cols[column] ??= {})
}

/* ------------------------------------------------------------------ Dialog */

const request = ref<AuthorityRequest | null>(null)
const candidates = ref<AuthorityCandidate[]>([])
const dialogBusy = ref(false)
const dialogError = ref('')

async function openDialog(column: string, value: string, source: string, kind: string) {
  request.value = { column, value, source, kind }
  candidates.value = []
  dialogError.value = ''
  dialogBusy.value = true
  try {
    const res = await zuordnungen.kandidaten(id.value, { value, kind, sources: [source] })
    candidates.value = res.candidates
  } catch (e) {
    dialogError.value = failureText(t, te, mappingFailure(e))
  } finally {
    dialogBusy.value = false
  }
}

function choose(entry: { id: string; type: string; label?: string }) {
  const req = request.value
  if (req === null) return
  setConfirmed(spec(req.column), req.value, entry)
  request.value = null
  void load()
}

function reset(column: string, value: string, source: string) {
  clearConfirmed(spec(column), value, source)
  void load()
}

/* --------------------------------------------------------------- Speichern */

async function save() {
  busy.value = true
  try {
    await zuordnungen.speichern(id.value, mapping.value)
    note.value = t('mapping.authority.saved')
    noteKind.value = 'ok'
  } catch (e) {
    note.value = failureText(t, te, mappingFailure(e)) || t('mapping.authority.saveFailed')
    noteKind.value = 'bad'
  } finally {
    busy.value = false
  }
}

useHead({ title: () => `${subject.value} · ${t('mapping.authority.pageTitle')}` })
</script>

<template>
  <main id="main" class="appwrap wide">
    <nav class="crumbs" :aria-label="t('mapping.authority.pageTitle')">
      <NuxtLink to="/mappings">{{ t('mapping.nav.mappings') }}</NuxtLink>
      <span class="sep" aria-hidden="true">/</span>
      <NuxtLink :to="`/mappings/${id}`">{{ subject }}</NuxtLink>
      <span class="sep" aria-hidden="true">/</span>
      <span>{{ t('mapping.authority.pageTitle') }}</span>
    </nav>

    <div role="alert" aria-live="assertive" v-if="loadError" class="ui-alert">{{ loadError }}</div>

    <template v-else>
      <h1>{{ t('mapping.authority.pageTitle') }}</h1>
      <p class="note">{{ t('mapping.authority.pageIntro') }}</p>

      <div class="authbar">
        <p aria-live="polite">{{ t('mapping.authority.pageOpen', { n: open, all: total }) }}</p>
        <label class="checkline">
          <input v-model="onlyOpen" type="checkbox">
          {{ t('mapping.authority.filterOpen') }}
        </label>
        <button type="button" class="btn btn-primary btn-sm" :disabled="busy" @click="save">
          {{ t('mapping.authority.save') }}
        </button>
        <NuxtLink class="linkbtn" :to="`/mappings/${id}/edit`">{{ t('mapping.authority.backToEditor') }}</NuxtLink>
      </div>

      <div class="live-region" role="status" aria-live="polite">
        <p v-if="note" class="ui-alert" :class="noteKind === 'ok' ? 'ui-alert-ok' : ''">{{ note }}</p>
      </div>

      <p v-if="groups.length === 0 && !busy" class="dim">{{ t('mapping.authority.pageEmpty') }}</p>

      <!--
        Jede Wertezeile traegt zwei Bedienelemente; bei dreihundert Werten sind
        das ueber sechshundert Tabstopps. Vor jeder Gruppe steht deshalb ein
        Sprung zur naechsten. Er veraendert die Reihenfolge nicht — alles bleibt
        erreichbar, es kommt nur ein Weg hinzu. Dieselbe Loesung wie im
        Zuordnungseditor.
      -->
      <section v-for="(group, gi) in groups" :key="`${group.column}-${group.branch}-${group.source}`"
               :id="`gruppe-${gi}`" class="ui-card authgroup">
        <a v-if="gi + 1 < groups.length" class="skip-inline" :href="`#gruppe-${gi + 1}`">
          {{ t('mapping.authority.skipGroup', { n: valuesOf(group).length }) }}
        </a>
        <!-- Die Quelle gehoert IN die Ueberschrift. Drei Gruppen derselben
             Spalte unterscheiden sich nur durch sie; stand sie in der Zeile
             darunter, hiessen mit Screenreader drei Ueberschriften gleich —
             und Ueberschriften sind dort das Navigationsmittel. -->
        <h2>{{ t('mapping.authority.groupHeading', {
          column: group.column, source: group.source.toUpperCase(), target: group.target || '—' }) }}</h2>
        <p class="dim small">
          {{ t('mapping.authority.groupKind', { kind: kindLabel(group.kind), target: group.target || '—' }) }}
          <span v-if="group.branch === -1"> · {{ t('mapping.authority.groupShared') }}</span>
        </p>

        <div class="authrow" v-for="entry in valuesOf(group)" :key="entry.value">
          <span class="authval" :title="entry.value">{{ entry.value }}</span>
          <span class="dim small authcount">{{ t('mapping.authority.count', { n: entry.count }) }}</span>
          <span class="authstate" :class="`st-${entry.state}`">
            <template v-if="entry.state === 'bestaetigt'">
              {{ entry.id }} <span class="dim">{{ entry.label }}</span>
            </template>
            <template v-else-if="entry.state === 'verworfen'">{{ t('mapping.authority.left') }}</template>
            <template v-else>{{ t('mapping.authority.auto') }}</template>
          </span>
          <button type="button" class="btn btn-outline btn-sm"
                  :aria-label="t('mapping.authority.assignFor', { value: entry.value })"
                  @click="openDialog(group.column, entry.value, group.source, group.kind)">
            {{ t('mapping.authority.assign') }}
          </button>
          <button v-if="entry.state !== 'offen'" type="button" class="linkbtn"
                  :aria-label="t('mapping.authority.resetFor', { value: entry.value })"
                  @click="reset(group.column, entry.value, group.source)">
            {{ t('mapping.authority.reset') }}
          </button>
        </div>
      </section>

      <MappingAuthorityDialog :request="request" :candidates="candidates" :busy="dialogBusy"
                              :error="dialogError" @close="request = null" @choose="choose" />
    </template>
  </main>
</template>
