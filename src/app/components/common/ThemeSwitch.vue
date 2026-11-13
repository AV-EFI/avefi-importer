<script setup lang="ts">
/**
 * Umschalter hell/dunkel. Das Symbol zeigt, wohin der Klick fuehrt: Mond im
 * hellen Schema, Sonne im dunklen. Die Wahl liegt in localStorage; das kleine
 * Skript in app.vue setzt data-theme vor dem Rendern, damit nichts aufblitzt.
 * Ohne gespeicherte Wahl gilt die Einstellung des Systems.
 */
defineProps<{ withLabel?: boolean }>()

const { t } = useI18n()
const dark = ref(false)

function readDark(): boolean {
  const cur = document.documentElement.getAttribute('data-theme')
  if (cur === 'dark') return true
  if (cur === 'light') return false
  return matchMedia('(prefers-color-scheme: dark)').matches
}

onMounted(() => { dark.value = readDark() })

function toggleTheme() {
  const next = readDark() ? 'light' : 'dark'
  document.documentElement.setAttribute('data-theme', next)
  try { localStorage.setItem('avefi-theme', next) } catch { /* Speicher gesperrt */ }
  dark.value = next === 'dark'
}
</script>

<template>
  <button type="button" class="ghost with-icon" :title="t('theme.switch')" :aria-label="t('theme.switch')" @click="toggleTheme">
    <!-- Tabler-Icons "sun" und "moon" (MIT), eingebettet: keine Icon-Bibliothek in der Anwendung. -->
    <svg xmlns="http://www.w3.org/2000/svg" width="1.1em" height="1.1em" viewBox="0 0 24 24" fill="none"
         stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
         aria-hidden="true">
      <template v-if="dark">
        <path d="M12 12m-4 0a4 4 0 1 0 8 0a4 4 0 1 0 -8 0" />
        <path d="M3 12h1m8 -9v1m8 8h1m-9 8v1m-6.4 -15.4l.7 .7m12.1 -.7l-.7 .7m0 11.4l.7 .7m-12.1 -.7l-.7 .7" />
      </template>
      <path v-else d="M12 3c.132 0 .263 0 .393 0a7.5 7.5 0 0 0 7.92 12.446a9 9 0 1 1 -8.313 -12.454z" />
    </svg><span v-if="withLabel">{{ t('theme.label') }}</span>
  </button>
</template>
