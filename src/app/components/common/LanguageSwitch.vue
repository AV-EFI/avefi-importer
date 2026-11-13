<script setup lang="ts">
/**
 * Sprachumschalter. Wechselt zur jeweils naechsten Sprache aus der i18n-
 * Konfiguration (bei zwei Sprachen also hin und her). Die Wahl bleibt ueber
 * das Cookie erhalten, das detectBrowserLanguage in nuxt.config.ts anlegt.
 */
defineProps<{ withLabel?: boolean }>()

const { t, locale, locales, setLocale } = useI18n()

const codes = computed(() => locales.value.map(l => (typeof l === 'string' ? l : l.code)))
const next = computed(() => {
  const list = codes.value
  return list[(list.indexOf(locale.value) + 1) % list.length] ?? locale.value
})
const nextName = computed(() => {
  const hit = locales.value.find(l => typeof l !== 'string' && l.code === next.value)
  return hit && typeof hit !== 'string' ? (hit.name ?? next.value) : next.value
})

async function switchLanguage() {
  await setLocale(next.value)
}
</script>

<template>
  <button type="button" class="ghost with-icon" :title="t('language.switch', { name: nextName })"
          :aria-label="t('language.switch', { name: nextName })" @click="switchLanguage">
    <!-- Tabler-Icon "language" (MIT), eingebettet: die Anwendung hat keine Icon-Bibliothek. -->
    <svg xmlns="http://www.w3.org/2000/svg" width="1.1em" height="1.1em" viewBox="0 0 24 24" fill="none"
         stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
         aria-hidden="true">
      <path d="M4 5h7" /><path d="M9 3v2c0 4.418 -2.239 8 -5 8" /><path d="M5 9c0 2.144 2.952 3.908 6.7 4" />
      <path d="M12 20l4 -9l4 9" /><path d="M19.1 18h-6.2" />
    </svg><span>{{ next.toUpperCase() }}<template v-if="withLabel"> · {{ t('language.label') }}</template></span>
  </button>
</template>
