<script setup lang="ts">
/**
 * Zuordnung eines gespeicherten Profils bearbeiten — ohne Import.
 *
 * Gerechnet wird auf der im Profil hinterlegten Stichprobe. Fehlt sie, sagt die
 * Seite genau das und verweist auf den Weg, sie nachzureichen; im PHP-Stand
 * blieb an dieser Stelle nur eine allgemeine Fehlermeldung.
 */
import MappingEditor from '~/components/mapping/Editor.vue'
import { failureText, mappingFailure } from '~/components/mapping/errors'
import type { EditorPayload } from '~/components/mapping/types'

const route = useRoute()
const { t, te } = useI18n()
const id = computed(() => String(route.params.id ?? ''))

const { data, error } = await useZuordnungsEditor(id)

const failure = computed(() => (error.value ? mappingFailure(error.value) : null))
const loadError = computed(() => failureText(t, te, failure.value))
const subject = computed(() => data.value?.payload.subject ?? id.value)

useHead({ title: () => `${subject.value} · ${t('mapping.crumb')}` })
</script>

<template>
  <main id="main" class="appwrap wide">
    <nav class="crumbs" :aria-label="t('mapping.crumb')">
      <NuxtLink to="/mappings">{{ t('mapping.nav.mappings') }}</NuxtLink>
      <span class="sep" aria-hidden="true">/</span>
      <NuxtLink :to="`/mappings/${id}`">{{ subject }}</NuxtLink>
      <span class="sep" aria-hidden="true">/</span>
      <span>{{ t('mapping.crumb') }}</span>
    </nav>

    <template v-if="loadError">
      <div class="ui-alert" role="alert">{{ loadError }}</div>
      <p v-if="failure?.code === 'no_sample'" style="margin-top:12px">
        <NuxtLink class="btn btn-primary btn-sm" :to="`/mappings/${id}`">{{ t('mapping.detail.addSample') }}</NuxtLink>
      </p>
    </template>

    <MappingEditor v-else-if="data" :payload="data.payload" back-to="/mappings"
                   :back-label="t('mapping.nav.mappings')" />
  </main>
</template>
