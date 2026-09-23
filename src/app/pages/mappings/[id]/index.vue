<script setup lang="ts">
import { mappingsService } from '~/services/mappings'
/**
 * Ein Zuordnungsprofil: Zuordnungen, Versionen, Verwaltung.
 *
 * Fremde Profile sind sichtbar, aber nicht aenderbar. Fehlen Beispieldaten,
 * steht hier der Weg, sie nachzureichen — samt Begruendung, warum der Editor
 * sie braucht.
 */
import { failureText, mappingFailure, type MappingFailure } from '~/components/mapping/errors'

const zuordnungen = mappingsService()

const route = useRoute()
const { t, te } = useI18n()
const id = computed(() => String(route.params.id ?? ''))

const { data, error, refresh } = await useZuordnung(id)

const loadError = computed(() => (error.value ? failureText(t, te, mappingFailure(error.value)) : ''))
const profile = computed(() => data.value?.profile ?? null)
useHead({ title: () => `${profile.value?.name ?? id.value} · ${t('mapping.nav.mappings')}` })

const failure = ref<MappingFailure | null>(null)
const message = ref('')
const busy = ref(false)
const actionError = computed(() => failureText(t, te, failure.value))

const newName = ref('')
watch(profile, (p) => { if (p !== null && newName.value === '') newName.value = p.name }, { immediate: true })

async function run(action: () => Promise<string>) {
  busy.value = true
  failure.value = null
  message.value = ''
  try {
    message.value = await action()
    await refresh()
  } catch (e) {
    failure.value = mappingFailure(e)
  } finally {
    busy.value = false
  }
}

function rename() {
  void run(async () => {
    await zuordnungen.umbenennen(id.value, newName.value)
    return t('mapping.detail.renamed')
  })
}

const confirmDelete = ref(false)
function remove() {
  confirmDelete.value = false
  void run(async () => {
    await zuordnungen.loeschen(id.value)
    await navigateTo('/mappings')
    return t('mapping.detail.deleted')
  })
}

const restoring = ref<number | null>(null)
function restore(version: number) {
  restoring.value = null
  void run(async () => {
    await zuordnungen.zuruecksetzen(id.value, version)
    return t('mapping.detail.restored', { n: version })
  })
}

const sampleInput = ref<HTMLInputElement | null>(null)
const sampleFailure = ref<MappingFailure | null>(null)
const sampleError = computed(() => failureText(t, te, sampleFailure.value))

async function uploadSample(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (file === undefined) return
  sampleFailure.value = null
  busy.value = true
  try {
    await zuordnungen.beispielSetzen(id.value, file)
    await navigateTo(`/mappings/${id.value}/edit`)
  } catch (e) {
    sampleFailure.value = mappingFailure(e)
  } finally {
    busy.value = false
    input.value = ''
  }
}

function targetLabel(key: string): string {
  const i18nKey = `mapping.targets.${key}`
  if (te(i18nKey)) return t(i18nKey)
  return data.value?.targets[key]?.path ?? key
}

function opLabel(op: string): string {
  const key = `mapping.op.${op}`
  return te(key) ? t(key) : op
}

</script>

<template>
  <main id="main" class="appwrap">
    <nav class="crumbs" :aria-label="t('mapping.nav.mappings')">
      <NuxtLink to="/mappings">{{ t('mapping.nav.mappings') }}</NuxtLink>
      <span class="sep" aria-hidden="true">/</span>
      <span>{{ profile?.name ?? id }}</span>
    </nav>

    <div role="alert" aria-live="assertive" v-if="loadError" class="ui-alert">{{ loadError }}</div>

    <template v-else-if="data && profile">
      <div class="live-region" role="status" aria-live="polite">
        <div v-if="message" class="ui-alert ui-alert-ok" style="margin-bottom:14px">{{ message }}</div>
      </div>
      <div class="live-region" role="alert" aria-live="assertive">
        <div v-if="actionError" class="ui-alert" style="margin-bottom:14px">{{ actionError }}</div>
      </div>
      <div class="live-region" role="alert" aria-live="assertive">
        <div v-if="sampleError" class="ui-alert" style="margin-bottom:14px">{{ sampleError }}</div>
      </div>

      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:16px">
        <h1 style="font-size:19px">{{ profile.name }}</h1>
        <span class="fmt">{{ profile.base_format.toUpperCase() }}</span>
        <span v-if="profile.complete" class="badge b-ok"><span class="bd" />{{ t('mapping.list.complete') }}</span>
        <span v-else class="badge b-wait">
          <span class="bd" />{{ t('mapping.detail.openColumns', { n: data.open.length }, data.open.length) }}
        </span>
        <span class="dim small">{{ t('mapping.list.version', { n: profile.version }) }}</span>
        <span class="dim small">{{ t('mapping.detail.usedBy', { n: data.useCount }) }}</span>
      </div>

      <div class="grid2" style="align-items:start">
        <section class="ui-card">
          <h2 class="side-h" style="margin-bottom:12px">{{ t('mapping.detail.columnsHeading') }}</h2>
          <div v-if="data.columns.length === 0" class="dim small">{{ t('mapping.detail.noColumns') }}</div>
          <div v-else class="tablewrap" style="border:0">
            <table>
              <caption class="sr-only">{{ t('mapping.detail.columnsHeading') }}</caption>
              <thead>
                <tr>
                  <th scope="col">{{ t('mapping.table.column') }}</th>
                  <th scope="col">{{ t('mapping.table.target') }}</th>
                  <th scope="col">{{ t('mapping.detail.chain') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="column in data.columns" :key="column.name">
                  <td class="fn">{{ column.name }}</td>
                  <td>
                    <span v-if="column.state === 'ignored'" class="badge b-neutral">
                      <span class="bd" />{{ t('mapping.state.ignored') }}
                    </span>
                    <span v-else-if="column.state === 'untouched'" class="badge b-warn">
                      <span class="bd" />{{ t('mapping.state.untouched') }}
                    </span>
                    <template v-else>
                      <div v-for="target in column.targets" :key="target">{{ targetLabel(target) }}</div>
                    </template>
                  </td>
                  <td class="dim small">
                    {{ column.ops.length ? column.ops.map(opLabel).join(' → ') : '–' }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <p v-if="data.defaults.length" class="note">
            {{ t('mapping.detail.defaults', { n: data.defaults.length }) }}
          </p>
          <p v-if="data.grouping.length" class="note">
            {{ t('mapping.detail.grouping', { rule: data.grouping.join(' + ') }) }}
          </p>
          <p class="note">
            {{ t('mapping.detail.versions', {
              profile: profile.profileFormatVersion ?? '–',
              schema: profile.avefiSchemaVersion ?? t('mapping.detail.unknownSchema') }) }}
          </p>
        </section>

        <div style="display:flex;flex-direction:column;gap:14px">
          <section v-if="data.own && !data.hasSample" class="ui-card" style="border-color:var(--warn)">
            <h2 class="side-h" style="margin-bottom:8px">{{ t('mapping.detail.sampleHeading') }}</h2>
            <p class="note" style="margin:0 0 10px">{{ t('mapping.detail.sampleHint') }}</p>
            <p>
              <label class="sr-only" for="samplefile">{{ t('mapping.detail.sampleLabel') }}</label>
              <input id="samplefile" ref="sampleInput" class="ui-input" type="file"
                     accept=".csv,.tsv,.tab,.txt,.xlsx,.xlsm,.xltx,text/csv" style="max-width:280px"
                     :disabled="busy" @change="uploadSample">
            </p>
          </section>

          <section class="ui-card">
            <h2 class="side-h" style="margin-bottom:12px">{{ t('mapping.detail.manageHeading') }}</h2>

            <form v-if="data.own" class="stackform" style="margin-bottom:14px" @submit.prevent="rename">
              <div class="field" style="width:100%">
                <label for="pname">{{ t('mapping.detail.nameLabel') }}</label>
                <input id="pname" v-model="newName" class="ui-input" required>
              </div>
              <button class="btn btn-outline btn-sm" type="submit" :disabled="busy">
                {{ t('mapping.detail.rename') }}
              </button>
            </form>
            <p v-else class="note">{{ t('mapping.detail.foreignHint') }}</p>

            <div style="display:flex;gap:8px;flex-wrap:wrap">
              <NuxtLink v-if="data.own && data.hasSample" class="btn btn-primary btn-sm"
                        :to="`/mappings/${profile.id}/edit`">{{ t('mapping.detail.edit') }}</NuxtLink>
              <a class="btn btn-outline btn-sm" :href="zuordnungen.ausfuhrPfad(profile.id)">
                {{ t('mapping.list.export') }}
              </a>
              <button v-if="data.own" type="button" class="btn btn-outline btn-sm"
                      style="color:var(--danger);border-color:var(--danger)" :disabled="busy"
                      @click="confirmDelete = true">{{ t('mapping.detail.delete') }}</button>
            </div>
          </section>

          <section class="ui-card">
            <h2 class="side-h" style="margin-bottom:12px">{{ t('mapping.detail.historyHeading') }}</h2>
            <p v-if="data.versions.length === 0" class="dim small" style="margin:0">
              {{ t('mapping.detail.noHistory') }}
            </p>
            <div v-for="entry in data.versions" :key="entry.version" class="frow"
                 style="grid-template-columns:1fr auto;padding:8px 0;align-items:center">
              <div>
                <div class="fn">{{ t('mapping.list.version', { n: entry.version }) }}</div>
                <div class="dim small">
                  <ImportsTimeStamp :value="entry.created_at" />
                  <template v-if="entry.user_name"> · {{ entry.user_name }}</template>
                </div>
              </div>
              <div style="display:flex;gap:6px;align-items:center">
                <!--
                  Ansehen vor Zuruecksetzen. Bis zum 08.09.2026 bot der Verlauf
                  nur das Zuruecksetzen an — man setzte also auf einen Stand
                  zurueck, den man nicht kannte.
                -->
                <NuxtLink class="btn btn-outline btn-sm" :to="`/mappings/${id}/versionen/${entry.version}`"
                          :aria-label="t('mapping.versionView.viewVersion', { n: entry.version })">
                  {{ t('mapping.versionView.view') }}
                </NuxtLink>
                <span v-if="entry.version === profile.version" class="badge b-ok">
                  <span class="bd" />{{ t('mapping.detail.active') }}
                </span>
              <!--
                Der Verlauf hat je Version einen Knopf. Ohne die Versionsnummer
                im Namen steht im Vorlesewerkzeug eine lange Reihe gleich
                lautender Eintraege, die nichts unterscheidet.
              -->
                <button v-else-if="data.own" type="button" class="btn btn-outline btn-sm" :disabled="busy"
                        :aria-label="t('mapping.detail.restoreVersion', { n: entry.version })"
                        @click="restoring = entry.version">{{ t('mapping.detail.restore') }}</button>
              </div>
            </div>
          </section>
        </div>
      </div>

      <ClientOnly>
        <Teleport to="body">
          <div v-if="confirmDelete" class="ui-modal-overlay" @click.self="confirmDelete = false">
            <div class="ui-modal-box" role="dialog" aria-modal="true" aria-labelledby="del-title">
              <div class="ui-modal-head">
                <h2 id="del-title" style="font-size:15px;flex:1">{{ t('mapping.detail.deleteTitle') }}</h2>
                <button class="ui-modal-x" type="button" :aria-label="t('mapping.detail.cancel')"
                        @click="confirmDelete = false">×</button>
              </div>
              <div class="ui-modal-body">{{ t('mapping.detail.deleteText', { n: data.useCount }) }}</div>
              <div class="ui-modal-foot">
                <button type="button" class="btn btn-outline" @click="confirmDelete = false">
                  {{ t('mapping.detail.cancel') }}
                </button>
                <button type="button" class="btn btn-danger" @click="remove">{{ t('mapping.detail.delete') }}</button>
              </div>
            </div>
          </div>

          <div v-if="restoring !== null" class="ui-modal-overlay" @click.self="restoring = null">
            <div class="ui-modal-box" role="dialog" aria-modal="true" aria-labelledby="res-title">
              <div class="ui-modal-head">
                <h2 id="res-title" style="font-size:15px;flex:1">{{ t('mapping.detail.restoreTitle') }}</h2>
                <button class="ui-modal-x" type="button" :aria-label="t('mapping.detail.cancel')"
                        @click="restoring = null">×</button>
              </div>
              <div class="ui-modal-body">{{ t('mapping.detail.restoreText', { n: restoring }) }}</div>
              <div class="ui-modal-foot">
                <button type="button" class="btn btn-outline" @click="restoring = null">
                  {{ t('mapping.detail.cancel') }}
                </button>
                <button type="button" class="btn btn-primary" @click="restore(restoring)">
                  {{ t('mapping.detail.restore') }}
                </button>
              </div>
            </div>
          </div>
        </Teleport>
      </ClientOnly>
    </template>
  </main>
</template>
