<script setup lang="ts">
/**
 * Uebersicht der Oberflaechenbeschreibungen.
 *
 * Der Inhalt kommt fertig uebersetzt vom Server (server/lib/doku). Im Browser
 * wird kein Markdown verarbeitet — ein Vorlesewerkzeug soll Ueberschriften,
 * Listen und Tabellen vorfinden und nicht Rauten und Sternchen.
 */
const { t } = useI18n()
const { data, error } = await useOberflaeche()

useHead({ title: () => t('doku.overview.pageTitle') })

const titel = computed(() => data.value?.titel ?? t('doku.overview.heading'))
</script>

<template>
  <main id="main" class="appwrap doku">
    <nav class="crumbs" :aria-label="t('doku.crumb')">
      <NuxtLink to="/">{{ t('imports.heading') }}</NuxtLink>
      <span class="sep" aria-hidden="true">/</span>
      <span>{{ t('doku.crumb') }}</span>
    </nav>

    <!-- Die Beschreibungen sind deutsch verfasst. Ohne diese Angabe liest ein
         Vorlesewerkzeug in englischer Einstellung sie mit englischer Aussprache. -->
    <h1 lang="de">{{ titel }}</h1>
    <p class="doku-lead">{{ t('doku.overview.lead') }}</p>
    <p class="note">{{ t('doku.overview.languageNote') }}</p>

    <div v-if="error" class="ui-alert" role="alert" aria-live="assertive">{{ t('doku.error.load') }}</div>
    <!-- Der Inhalt stammt aus dem Verzeichnis docs/ dieses Projekts und wird
         serverseitig aus Markdown erzeugt; jeder Textteil ist dabei maskiert. -->
    <!-- eslint-disable-next-line vue/no-v-html -->
    <div v-else class="doku-body" lang="de" v-html="data?.html ?? ''" />
  </main>
</template>
