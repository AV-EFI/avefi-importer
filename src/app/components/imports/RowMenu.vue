<script setup lang="ts">
import { importsService } from '~/services/imports'
/**
 * Das „…"-Menue einer Importzeile.
 *
 * Das Menue haengt an <body>, nicht in der Zelle: Die Tabelle rollt waagerecht
 * (.tablewrap hat overflow-x), und ein Menue innerhalb davon waere
 * abgeschnitten. Die Lage kommt aus dem Rechteck des Knopfs.
 *
 * Tastatur: Pfeiltasten wandern durch die Eintraege, Pos1/Ende springen,
 * Escape schliesst und gibt den Fokus an den Knopf zurueck.
 */
import type { ImportListItem } from './types'
import { klappPlatz } from '~/utils/klappplatz'

const importe = importsService()

const props = defineProps<{ item: ImportListItem }>()
const emit = defineEmits<{ reconvert: []; delete: [] }>()
const { t } = useI18n()

const open = ref(false)
const button = ref<HTMLButtonElement | null>(null)
const menu = ref<HTMLElement | null>(null)
const pos = ref({ top: 0, left: 0, maxHoehe: 0 })

const issueCount = computed(() => props.item.issues.error + props.item.issues.warning)

/*
 * Wann der Weg zur Zuordnung offensteht.
 *
 * Nicht `hasMapping`. Die Spalte `mapping_profile_id` sagt nur, ob zu diesem
 * Import schon ein Profil gespeichert wurde. Sie ist auch bei einem fertig
 * konvertierten Import leer, wenn er ueber ein Formatprofil lief (MARC-XML,
 * AVefi nativ), und sie ist gefuellt, wenn im Editor gespeichert wurde, ohne
 * zu konvertieren (mapping/save.post.ts setzt das Profil unabhaengig von
 * `start`). Beides beantwortet die Frage nicht, ob es hier etwas zu sehen gibt.
 *
 * Die Seite haengt am Format, nicht am Profil: `/imports/:id/mapping` liest die
 * Tabelle des Imports und sucht das Profil ueber den Kopfzeilen-Hash. Bei einem
 * nicht-tabellarischen Format wirft sie 409 `not_tabular` (mapping/_source.ts).
 * Also entscheidet `tabular` — so, wie ImportTable.vue es beim Knopf
 * "Zuordnen" schon macht.
 *
 * Gemeldet von Jasper Stratil am 09.09.2026: Bei SLUBcollection.xml fehlte der
 * Eintrag, obwohl der Import konvertiert war.
 */
const zuordnungBeschriftung = computed(() => props.item.status === 'awaiting_format_review'
  ? 'imports.menu.map'
  : 'imports.menu.mapping')

/**
 * Lage des Menues am Knopf.
 *
 * Bis zum 22.10.2026 lief das Menue in der letzten Zeile unten aus dem Fenster:
 * `top` wurde nur auf `innerHeight - 40` begrenzt, die Menuehoehe zaehlte nicht.
 * Jetzt dieselbe Rechnung wie bei der Konverterauswahl (#30): unten, wenn es
 * passt, sonst nach oben, und notfalls in der Hoehe begrenzt.
 */
function place() {
  const rect = button.value?.getBoundingClientRect()
  if (!rect) return
  const width = 250
  const hoehe = menu.value?.scrollHeight ?? 0
  const lage = klappPlatz(rect, hoehe, window.innerHeight)
  const sichtbar = Math.min(hoehe, lage.maxHoehe)
  pos.value = {
    top: lage.oben ? rect.top - 6 - sichtbar : rect.bottom + 6,
    left: Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8)),
    maxHoehe: lage.maxHoehe
  }
}

async function toggle() {
  open.value = !open.value
  if (!open.value) return
  place()
  // Erst nach dem Zeichnen ist die Hoehe bekannt; dann noch einmal legen.
  await nextTick()
  place()
  items()[0]?.focus({ preventScroll: true })
}

function close(focusButton = false) {
  if (!open.value) return
  open.value = false
  if (focusButton) button.value?.focus()
}

function items(): HTMLElement[] {
  return Array.from(menu.value?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])
}

function onMenuKey(e: KeyboardEvent) {
  const list = items()
  if (list.length === 0) return
  const index = list.indexOf(document.activeElement as HTMLElement)
  if (e.key === 'Escape') {
    e.preventDefault()
    close(true)
  } else if (e.key === 'ArrowDown') {
    e.preventDefault()
    list[(index + 1) % list.length]?.focus()
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    list[(index - 1 + list.length) % list.length]?.focus()
  } else if (e.key === 'Home') {
    e.preventDefault()
    list[0]?.focus()
  } else if (e.key === 'End') {
    e.preventDefault()
    list[list.length - 1]?.focus()
  } else if (e.key === 'Tab') {
    close()
  }
}

function onDocPointer(e: PointerEvent) {
  if (!open.value) return
  const target = e.target as Node
  if (button.value?.contains(target) || menu.value?.contains(target)) return
  close()
}

function onScroll() {
  if (open.value) place()
}

onMounted(() => {
  document.addEventListener('pointerdown', onDocPointer, true)
  window.addEventListener('resize', onScroll, true)
  window.addEventListener('scroll', onScroll, true)
})
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocPointer, true)
  window.removeEventListener('resize', onScroll, true)
  window.removeEventListener('scroll', onScroll, true)
})

function pick(fn: () => void) {
  close()
  fn()
}
</script>

<template>
  <div class="rowmenu">
    <button ref="button" type="button" class="iconbtn-menu" aria-haspopup="menu" :aria-expanded="open"
            :aria-label="t('imports.action.more', { name: item.filename })" @click="toggle">
      <span aria-hidden="true">⋯</span>
    </button>

    <ClientOnly>
      <Teleport to="body">
      <div v-if="open" ref="menu" class="ui-menu ui-menu-float" role="menu"
           :aria-label="t('imports.action.menuLabel', { name: item.filename })"
           :style="{ top: pos.top + 'px', left: pos.left + 'px', maxHeight: pos.maxHoehe > 0 ? pos.maxHoehe + 'px' : undefined, overflowY: 'auto' }"
           @keydown="onMenuKey">
        <NuxtLink v-if="item.tabular" class="ui-menu-item" role="menuitem" :to="`/imports/${item.id}/mapping`"
                  @click="close()">
          <span class="mi" aria-hidden="true">⇄</span>{{ t(zuordnungBeschriftung) }}
        </NuxtLink>

        <NuxtLink v-if="item.hasReport" class="ui-menu-item" role="menuitem" :to="`/imports/${item.id}/report`"
                  @click="close()">
          <span class="mi" aria-hidden="true">☑</span>{{ t('imports.menu.report') }}
          <span v-if="issueCount > 0" class="dim"> {{ t('imports.menu.reportIssues') }}</span>
        </NuxtLink>

        <!--
          Fuer nicht-tabellarische Importe gibt es keine Spaltenzuordnung. Die
          Frage "wie kam dieses Ergebnis zustande" stellt sich trotzdem, und der
          Abschnitt auf der Detailseite beantwortet sie. Gesprungen wird an den
          Anker, so wie beim Umbenennen weiter unten.
        -->
        <NuxtLink v-if="!item.tabular" class="ui-menu-item" role="menuitem"
                  :to="`/imports/${item.id}#herkunft`" @click="close()">
          <span class="mi" aria-hidden="true">⚙</span>{{ t('imports.menu.origin') }}
        </NuxtLink>

        <NuxtLink class="ui-menu-item" role="menuitem" :to="`/imports/${item.id}`" @click="close()">
          <span class="mi" aria-hidden="true">☰</span>{{ t('imports.menu.detail') }}
        </NuxtLink>

        <a class="ui-menu-item" role="menuitem" :href="importe.originalPfad(item.id)" @click="close()">
          <span class="mi" aria-hidden="true">⤓</span>{{ t('imports.menu.original') }}
        </a>

        <a v-if="item.hasAvefi" class="ui-menu-item" role="menuitem" :href="importe.avefiJsonPfad(item.id)"
           @click="close()">
          <span class="mi" aria-hidden="true">{}</span>
          <template v-if="item.validated">{{ t('imports.menu.avefi') }}</template>
          <template v-else>{{ t('imports.menu.avefiDraft') }}</template>
        </a>

        <!--
          Das Umbenennen fuehrt auf die Detailseite statt in ein weiteres
          Fenster: Dort steht das Formular ohnehin, und ein Dialog mehr in
          einer Liste mit achtzig Zeilen hilft niemandem.
        -->
        <NuxtLink class="ui-menu-item" role="menuitem" :to="`/imports/${item.id}#name`" @click="close()">
          <span class="mi" aria-hidden="true">✎</span>{{ t('imports.menu.rename') }}
        </NuxtLink>

        <button v-if="item.canReconvert" type="button" class="ui-menu-item" role="menuitem"
                @click="pick(() => emit('reconvert'))">
          <span class="mi" aria-hidden="true">↻</span>{{ t('imports.menu.reconvert') }}
        </button>

        <div class="ui-menu-sep" role="separator" />

        <button type="button" class="ui-menu-item danger" role="menuitem" @click="pick(() => emit('delete'))">
          <span class="mi" aria-hidden="true">🗑</span>{{ t('imports.menu.delete') }}
        </button>
      </div>
      </Teleport>
    </ClientOnly>
  </div>
</template>
