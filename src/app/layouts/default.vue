<script setup lang="ts">
/** Rahmen fuer angemeldete Seiten. Kopfzeile, Navigation, Nutzermenue. */
const { user, logout } = useAuth()

/*
 * Hinweis auf Werte aus der Beispielkonfiguration.
 *
 * Am 09.09.2026 lief die oeffentlich erreichbare Testinstanz mit dem
 * Administratorpasswort aus der Dokumentation. Die Anleitung sagte das
 * Richtige, gelesen hatte es niemand. Deshalb steht es jetzt dort, wo man
 * arbeitet — aber nur fuer Administratoren, denn niemand sonst kann etwas
 * daran aendern, und ein Hinweis fuer alle waere ein Wegweiser fuer Fremde.
 *
 * `default: []` statt eines Fehlers: Der Streifen ist eine Beigabe. Wenn der
 * Endpunkt nicht antwortet, faellt er weg und nicht die Seite.
 */
const { data: vorgabewerte } = await useVorgabewerte()
const befunde = computed(() => (user.value?.is_admin ? vorgabewerte.value?.befunde ?? [] : []))
const route = useRoute()
const { t } = useI18n()

const menuOpen = ref(false)
const menuRoot = ref<HTMLElement | null>(null)
const menuButton = ref<HTMLButtonElement | null>(null)
const menuBox = ref<HTMLElement | null>(null)

/*
 * Die Hauptnavigation auf schmalen Fenstern.
 *
 * Sie war unterhalb von 820px per display:none ausgeblendet, und zwar ersatzlos:
 * die drei Ziele waren dann weder mit der Tabulatortaste noch mit der Suche des
 * Browsers zu erreichen, weil display:none einen Zweig auch aus dem
 * Barrierebaum nimmt. Ein Test mit Vorlesewerkzeug hat genau das gefunden.
 *
 * Aufklappmuster statt Menue: Es sind Verweise, keine Befehle. Ein role="menu"
 * wuerde ein Vorlesewerkzeug dazu bringen, sie als Menuebefehle anzusagen und
 * die Bedienung auf Pfeiltasten umzustellen. Der Knopf sagt ueber
 * aria-expanded, ob offen ist, und ueber aria-controls, was er oeffnet; die
 * Verweise bleiben Verweise.
 */
const navOpen = ref(false)
const navRoot = ref<HTMLElement | null>(null)
const navToggle = ref<HTMLButtonElement | null>(null)
const navBox = ref<HTMLElement | null>(null)

const active = computed(() => {
  const p = route.path
  if (p.startsWith('/mappings')) return 'mappings'
  if (p.startsWith('/reviews')) return 'reviews'
  // Nur der Importbereich selbst. Bis zum 01.09.2026 war "Importe" der
  // Auffangwert fuer jeden anderen Pfad, also auch fuer Nutzerverwaltung,
  // Profil und Dokumentation. Das setzte dort aria-current="page" auf einen
  // Punkt, auf dem man gar nicht steht — fuer ein Vorlesewerkzeug keine
  // Kleinigkeit, sondern eine falsche Ortsangabe.
  if (p === '/' || p.startsWith('/imports')) return 'imports'
  return ''
})

const initials = computed(() => {
  const n = (user.value?.name || user.value?.email || '').trim()
  if (!n) return '?'
  const parts = n.split(/[\s@.]+/).filter(Boolean)
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || n[0]!.toUpperCase()
})

const { data: reviewCount } = await usePruefungsAnzahl()

function onDocClick(e: MouseEvent) {
  if (menuOpen.value && menuRoot.value && !menuRoot.value.contains(e.target as Node)) menuOpen.value = false
  if (navOpen.value && navRoot.value && !navRoot.value.contains(e.target as Node)) navOpen.value = false
}
function onKey(e: KeyboardEvent) {
  if (e.key !== 'Escape') return
  if (menuOpen.value) closeMenu(true)
  else if (navOpen.value) closeNav(true)
}

/** Verweise der Navigation in Dokumentreihenfolge. */
function navItems(): HTMLElement[] {
  return Array.from(navBox.value?.querySelectorAll<HTMLElement>('a') ?? [])
}

function closeNav(focusButton = false) {
  navOpen.value = false
  if (focusButton) navToggle.value?.focus()
}

/**
 * Aufklappen und den Fokus mitnehmen. Bleibt der Fokus auf dem Knopf, bemerkt
 * mit einem Vorlesewerkzeug niemand, dass sich etwas geoeffnet hat.
 */
async function toggleNav() {
  navOpen.value = !navOpen.value
  if (!navOpen.value) return
  await nextTick()
  navItems()[0]?.focus()
}

/**
 * Pfeiltasten sind hier eine Zugabe, keine Pflicht: Tabulator fuehrt durch die
 * Verweise wie ueberall sonst, Escape schliesst und gibt den Fokus zurueck.
 */
function onNavKey(e: KeyboardEvent) {
  const list = navItems()
  if (list.length === 0) return
  const at = list.indexOf(document.activeElement as HTMLElement)
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    list[(at + 1) % list.length]?.focus()
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    list[(at - 1 + list.length) % list.length]?.focus()
  }
}

// Nach einem Seitenwechsel steht die Navigation offen ueber der neuen Seite,
// wenn sie niemand schliesst.
watch(() => route.path, () => { navOpen.value = false })

/** Eintraege des Menues in Reihenfolge — Grundlage der Pfeiltastenbedienung. */
function menuItems(): HTMLElement[] {
  return Array.from(menuBox.value?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])
}

function closeMenu(focusButton = false) {
  menuOpen.value = false
  if (focusButton) menuButton.value?.focus()
}

/**
 * Menue oeffnen und den Fokus mitnehmen. Ohne das Nachfuehren bleibt der Fokus
 * auf dem Knopf, und mit einem Vorlesewerkzeug bemerkt niemand, dass sich
 * ueberhaupt etwas geoeffnet hat.
 */
async function toggleMenu() {
  menuOpen.value = !menuOpen.value
  if (!menuOpen.value) return
  await nextTick()
  menuItems()[0]?.focus()
}

function onMenuKey(e: KeyboardEvent) {
  const list = menuItems()
  if (list.length === 0) return
  const at = list.indexOf(document.activeElement as HTMLElement)
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    list[(at + 1) % list.length]?.focus()
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    list[(at - 1 + list.length) % list.length]?.focus()
  } else if (e.key === 'Home') {
    e.preventDefault()
    list[0]?.focus()
  } else if (e.key === 'End') {
    e.preventDefault()
    list[list.length - 1]?.focus()
  } else if (e.key === 'Tab') {
    closeMenu()
  }
}
onMounted(() => {
  document.addEventListener('click', onDocClick)
  document.addEventListener('keydown', onKey)
})
onBeforeUnmount(() => {
  document.removeEventListener('click', onDocClick)
  document.removeEventListener('keydown', onKey)
})

function toggleTheme() {
  const root = document.documentElement
  const cur = root.getAttribute('data-theme')
  const prefersDark = matchMedia('(prefers-color-scheme: dark)').matches
  const next = cur === 'dark' ? 'light' : cur === 'light' ? 'dark' : prefersDark ? 'light' : 'dark'
  root.setAttribute('data-theme', next)
  try { localStorage.setItem('avefi-theme', next) } catch { /* Speicher gesperrt */ }
}
</script>

<template>
  <div>
    <a class="skip-link" href="#main">{{ t('skipToContent') }}</a>

    <!-- Siehe oben. Steht vor der Kopfzeile, damit er nicht wegzuscrollen ist. -->
    <div v-if="befunde.length > 0" class="ui-alert" role="status" style="margin:0;border-radius:0">
      <p class="fn">{{ t('defaults.heading') }}</p>
      <ul style="margin:6px 0 0;padding-left:18px">
        <li v-for="(b, i) in befunde" :key="i" class="small">
          {{ t(`defaults.${b.code}`, { betrifft: b.betrifft ?? '' }) }}
        </li>
      </ul>
      <p class="small dim" style="margin-top:6px">{{ t('defaults.hint') }}</p>
    </div>

    <header class="apphead">
      <NuxtLink class="logo" to="/" :aria-label="t('toStart')">
        <span class="applogo"><img src="/av-efi-logo.svg" alt="AV-EFI" height="26"></span>
      </NuxtLink>

      <div ref="navRoot" class="navwrap">
        <button ref="navToggle" type="button" class="navtoggle" aria-controls="hauptnavigation"
                :aria-expanded="navOpen" :aria-label="t('nav.toggle')" :title="t('nav.toggle')"
                @click.stop="toggleNav">
          <span aria-hidden="true">☰</span>
        </button>

      <nav id="hauptnavigation" ref="navBox" :class="navOpen ? 'open' : ''" :aria-label="t('mainNav')"
           @keydown="onNavKey">
        <NuxtLink to="/" :class="active === 'imports' ? 'on' : ''"
                  :aria-current="active === 'imports' ? 'page' : undefined">{{ t('nav.imports') }}</NuxtLink>
        <NuxtLink to="/mappings" :class="active === 'mappings' ? 'on' : ''"
                  :aria-current="active === 'mappings' ? 'page' : undefined">{{ t('nav.mappings') }}</NuxtLink>
        <!-- Das Abzeichen zaehlt Zuordnungs-AUFGABEN (je Institution und Kopfzeile),
             die Kachel auf der Startseite zaehlt wartende DATEIEN. Beide Zahlen sind
             richtig und meinen Verschiedenes; der Titel sagt, welche hier steht. -->
        <NuxtLink v-if="user?.is_admin" to="/reviews" :class="active === 'reviews' ? 'on' : ''"
                  :title="reviewCount ? t('nav.reviewsTitle', { count: reviewCount.open }) : undefined">
          {{ t('nav.reviews') }}
          <span v-if="reviewCount && reviewCount.open > 0" class="badge b-wait"
                style="padding:1px 6px;margin-left:2px">{{ reviewCount.open }}<span class="sr-only">
            {{ t('nav.reviewsBadge') }}</span></span>
        </NuxtLink>
      </nav>
      </div>

      <div class="who">
        <span v-if="user?.institution_name" class="dim">{{ user.institution_name }}</span>
        <button type="button" class="ghost" :title="t('theme.switch')" :aria-label="t('theme.switch')" @click="toggleTheme">◐</button>

        <div v-if="user" ref="menuRoot" class="usermenu">
          <button ref="menuButton" class="ui-avatar-btn" type="button" aria-haspopup="menu" :aria-expanded="menuOpen"
                  :aria-label="t('userMenu', { name: user.name })" :title="user.name"
                  @click.stop="toggleMenu">
            <span class="ui-avatar" aria-hidden="true">{{ initials }}</span>
          </button>
          <div ref="menuBox" class="ui-menu" role="menu" :aria-label="t('userMenu', { name: user.name })"
               :hidden="!menuOpen" @keydown="onMenuKey">
            <div class="ui-menu-head">
              <div class="fn">{{ user.name }}</div>
              <div class="dim small">{{ user.email }}</div>
            </div>
            <NuxtLink class="ui-menu-item" role="menuitem" to="/profile" @click="closeMenu()">{{ t('menu.profile') }}</NuxtLink>
            <NuxtLink v-if="user.is_admin" class="ui-menu-item" role="menuitem" to="/users"
                      @click="closeMenu()">{{ t('menu.users') }}</NuxtLink>
            <NuxtLink class="ui-menu-item" role="menuitem" to="/dokumentation/handbuch"
                      @click="closeMenu()">{{ t('menu.handbuch') }}</NuxtLink>
            <NuxtLink class="ui-menu-item" role="menuitem" to="/dokumentation/oberflaeche"
                      @click="closeMenu()">{{ t('menu.doku') }}</NuxtLink>
            <button class="ui-menu-item" role="menuitem" type="button" @click="logout()">{{ t('menu.logout') }}</button>
          </div>
        </div>
      </div>
    </header>

    <slot />
  </div>
</template>
