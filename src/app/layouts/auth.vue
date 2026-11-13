<script setup lang="ts">
/** Rahmen fuer die Anmeldeseite — ohne Kopfzeile. */
</script>

<template>
  <div class="auth-page">
    <slot />
    <div style="position:fixed;top:16px;right:16px;display:flex;gap:8px">
      <CommonLanguageSwitch />
      <CommonThemeSwitch with-label />
    </div>
  </div>
</template>
