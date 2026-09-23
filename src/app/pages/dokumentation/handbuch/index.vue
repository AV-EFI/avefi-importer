<script setup lang="ts">
/**
 * Uebersicht des Handbuchs.
 *
 * Der Inhalt kommt fertig uebersetzt vom Server (server/lib/doku). Im Browser
 * wird kein Markdown verarbeitet — ein Vorlesewerkzeug soll Ueberschriften,
 * Listen und Tabellen vorfinden und nicht Rauten und Sternchen.
 */
const { t } = useI18n()
const { data, error } = await useHandbuch()

useHead({ title: () => t('doku.handbuch.pageTitle') })

const titel = computed(() => data.value?.titel ?? t('doku.handbuch.heading'))
</script>

<template>
  <main id="main" class="appwrap doku">
    <nav class="crumbs" :aria-label="t('doku.handbuch.crumb')">
      <NuxtLink to="/">{{ t('imports.heading') }}</NuxtLink>
      <span class="sep" aria-hidden="true">/</span>
      <span>{{ t('doku.handbuch.crumb') }}</span>
    </nav>

    <!-- Das Handbuch ist deutsch verfasst. Ohne diese Angabe liest ein
         Vorlesewerkzeug in englischer Einstellung es mit englischer Aussprache. -->
    <h1 lang="de">{{ titel }}</h1>
    <p class="doku-lead">{{ t('doku.handbuch.lead') }}</p>
    <p class="note">{{ t('doku.overview.languageNote') }}</p>

    <div v-if="error" class="ui-alert" role="alert" aria-live="assertive">{{ t('doku.error.load') }}</div>
    <!-- Serverseitig aus Markdown erzeugt, Textteile maskiert; siehe server/lib/doku. -->
    <!-- eslint-disable-next-line vue/no-v-html -->
    <div v-else class="doku-body" lang="de" v-html="data?.html ?? ''" />
  </main>
</template>
