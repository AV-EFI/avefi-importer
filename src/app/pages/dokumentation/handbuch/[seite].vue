<script setup lang="ts">
/**
 * Ein einzelnes Handbuchkapitel.
 *
 * Die Ueberschrift der Stufe 1 setzt diese Seite selbst, damit sie im Rahmen
 * der Anwendung steht; der Server liefert den Rest ab Stufe 2. So bleibt die
 * Stufenfolge lueckenlos.
 *
 * Die Ueberschriften des Servers tragen Kennungen. Der Pruefbericht verweist
 * darauf, etwa .../03-bearbeiten-und-validieren#kennung-ist-nicht-eindeutig.
 */
const { t } = useI18n()
const route = useRoute()
const kennung = computed(() => String(route.params.seite ?? ''))

const { data, error } = await useHandbuchKapitel(kennung)

if (error.value) {
  throw createError({ statusCode: 404, statusMessage: t('doku.error.missing'), fatal: true })
}

useHead({ title: () => t('doku.handbuch.page.pageTitle', { name: data.value?.titel ?? '' }) })

/**
 * Zum Anker springen, sobald der Inhalt steht.
 *
 * Der Browser wertet den Anker beim Laden aus, da ist das HTML aber noch nicht
 * eingesetzt. Ohne diesen Nachlauf landet ein Verweis aus dem Pruefbericht am
 * Seitenanfang statt am Abschnitt.
 */
onMounted(() => {
  const ziel = route.hash.replace(/^#/, '')
  if (ziel === '') return
  void nextTick(() => {
    const stelle = document.getElementById(ziel)
    if (stelle === null) return
    stelle.scrollIntoView({ block: 'start' })
    // Ohne tabindex nimmt eine Ueberschrift den Fokus nicht an, und ein
    // Vorlesewerkzeug bliebe am Seitenanfang stehen.
    stelle.setAttribute('tabindex', '-1')
    stelle.focus()
  })
})
</script>

<template>
  <main v-if="data" id="main" class="appwrap doku">
    <nav class="crumbs" :aria-label="t('doku.handbuch.crumb')">
      <NuxtLink to="/">{{ t('imports.heading') }}</NuxtLink>
      <span class="sep" aria-hidden="true">/</span>
      <NuxtLink to="/dokumentation/handbuch">{{ t('doku.handbuch.crumb') }}</NuxtLink>
      <span class="sep" aria-hidden="true">/</span>
      <span lang="de">{{ data.titel }}</span>
    </nav>

    <!-- Das Handbuch ist deutsch verfasst. Ohne diese Angabe liest ein
         Vorlesewerkzeug in englischer Einstellung es mit englischer Aussprache. -->
    <h1 lang="de">{{ data.titel }}</h1>

    <!-- Serverseitig aus Markdown erzeugt, Textteile maskiert; siehe server/lib/doku. -->
    <!-- eslint-disable-next-line vue/no-v-html -->
    <div class="doku-body" lang="de" v-html="data.html" />

    <nav class="doku-nav" :aria-label="t('doku.nav.label')">
      <NuxtLink v-if="data.vorher" :to="`/dokumentation/handbuch/${data.vorher.kennung}`">
        {{ t('doku.nav.prev', { name: data.vorher.titel }) }}
      </NuxtLink>
      <NuxtLink to="/dokumentation/handbuch">{{ t('doku.nav.overview') }}</NuxtLink>
      <NuxtLink v-if="data.nachher" :to="`/dokumentation/handbuch/${data.nachher.kennung}`">
        {{ t('doku.nav.next', { name: data.nachher.titel }) }}
      </NuxtLink>
    </nav>
  </main>
</template>
