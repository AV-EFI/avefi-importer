<script setup lang="ts">
import { dokuPfade } from '~/services/doku'
const doku = dokuPfade()
/**
 * Eine einzelne Oberflaechenbeschreibung.
 *
 * Die Ueberschrift der Stufe 1 setzt diese Seite selbst, damit sie im Rahmen
 * der Anwendung steht; der Server liefert den Rest ab Stufe 2. So bleibt die
 * Stufenfolge lueckenlos.
 */
const { t } = useI18n()
const route = useRoute()
const kennung = computed(() => String(route.params.seite ?? ''))

const { data, error } = await useOberflaechenSeite(kennung)

if (error.value) {
  throw createError({ statusCode: 404, statusMessage: t('doku.error.missing'), fatal: true })
}

useHead({ title: () => t('doku.page.pageTitle', { name: data.value?.titel ?? '' }) })

const bildAdresse = computed(() => doku.oberflaecheBild(kennung.value))
</script>

<template>
  <main v-if="data" id="main" class="appwrap doku">
    <nav class="crumbs" :aria-label="t('doku.crumb')">
      <NuxtLink to="/">{{ t('imports.heading') }}</NuxtLink>
      <span class="sep" aria-hidden="true">/</span>
      <NuxtLink to="/dokumentation/oberflaeche">{{ t('doku.crumb') }}</NuxtLink>
      <span class="sep" aria-hidden="true">/</span>
      <span lang="de">{{ data.titel }}</span>
    </nav>

    <!-- Die Beschreibungen sind deutsch verfasst. Ohne diese Angabe liest ein
         Vorlesewerkzeug in englischer Einstellung sie mit englischer Aussprache. -->
    <h1 lang="de">{{ data.titel }}</h1>

    <!-- Serverseitig aus Markdown erzeugt, Textteile maskiert; siehe server/lib/doku. -->
    <!-- eslint-disable-next-line vue/no-v-html -->
    <div class="doku-body" lang="de" v-html="data.html" />

    <section class="ui-card doku-shot" aria-labelledby="doku-abzug">
      <h2 id="doku-abzug">{{ t('doku.shot.heading') }}</h2>
      <p class="doku-shot-note">{{ t('doku.shot.note') }}</p>
      <template v-if="data.bild">
        <p>
          <a :href="bildAdresse" target="_blank" rel="noopener noreferrer">{{ t('doku.shot.open') }}<span
            class="sr-only"> ({{ t('doku.shot.newWindow') }})</span></a>
        </p>
        <img :src="bildAdresse" :alt="t('doku.shot.alt', { name: data.titel })" loading="lazy">
      </template>
      <p v-else>{{ t('doku.shot.none') }}</p>
    </section>

    <nav class="doku-nav" :aria-label="t('doku.nav.label')">
      <NuxtLink v-if="data.vorher" :to="`/dokumentation/oberflaeche/${data.vorher.kennung}`">
        {{ t('doku.nav.prev', { name: data.vorher.titel }) }}
      </NuxtLink>
      <NuxtLink to="/dokumentation/oberflaeche">{{ t('doku.nav.overview') }}</NuxtLink>
      <NuxtLink v-if="data.nachher" :to="`/dokumentation/oberflaeche/${data.nachher.kennung}`">
        {{ t('doku.nav.next', { name: data.nachher.titel }) }}
      </NuxtLink>
    </nav>
  </main>
</template>
