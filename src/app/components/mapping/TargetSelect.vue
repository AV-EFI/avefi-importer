<script setup lang="ts">
/**
 * Suche nach einem Schemafeld.
 *
 * Gesucht wird ueber Feldschluessel, verstaendliche Bezeichnung, Gruppe und
 * Schemapfad — der Vertrag verlangt mindestens Feldnamen und Bezeichnungen.
 * Bewusst eine einfache Wortsuche ohne Rangfolgekunst: Wer "regie" tippt, will
 * die Regie sehen, nicht eine Trefferliste erklaert bekommen.
 *
 * Zum ausgewaehlten Feld stehen vollstaendiger Schemapfad und kurze
 * Beschreibung darunter — ebenfalls Vertragsanforderung.
 *
 * Bedienung mit der Tastatur: Pfeiltasten, Pos1/Ende, Enter uebernimmt,
 * Escape schliesst. Das Feld ist eine Combobox nach WAI-ARIA.
 */
import type { EditorTarget } from './types'

const props = defineProps<{
  modelValue: string
  targets: EditorTarget[]
  label: string
  /** Eindeutig je Vorkommen — verbindet Beschriftung, Eingabe und Liste. */
  inputId: string
  describedBy?: string
}>()

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
const { t, te } = useI18n()

const query = ref('')
const openList = ref(false)
const activeIndex = ref(-1)
const root = ref<HTMLElement | null>(null)

const byKey = computed(() => new Map(props.targets.map((x) => [x.key, x])))
const selected = computed(() => byKey.value.get(props.modelValue) ?? null)

/** Bezeichnung eines Ziels: eigener Schluessel, sonst der Katalogtext. */
function labelOf(target: EditorTarget): string {
  const key = `mapping.targets.${target.key}`
  return te(key) ? t(key) : target.label
}
function describe(target: EditorTarget): string {
  const key = `mapping.targetDescs.${target.key}`
  if (te(key)) return t(key)
  return target.description ?? ''
}
function levelLabel(level: string): string {
  return t(`mapping.level.${level}`)
}
function pathOf(target: EditorTarget): string {
  return `${levelLabel(target.level)} › ${labelOf(target)}`
}

/**
 * Im Feld steht beim Fokussieren das gewaehlte Ziel, damit ein Vorlesewerkzeug
 * den aktuellen Wert nennt. Dieser Text ist aber keine Suchanfrage — sonst
 * fiele die Liste beim blossen Hineinspringen auf den einen Treffer zusammen.
 */
const suchtext = computed(() => {
  const sel = selected.value
  return sel !== null && query.value === pathOf(sel) ? '' : query.value
})

/*
 * Dieselbe Zerlegung wie beim Aufbau des Suchindex (server/api/mappings/_lib.ts).
 *
 * Sie liefen auseinander: der Index trennte am Punkt, die Suche behielt ihn.
 * Wer den Schluessel "item.colour_type" eintippte, suchte damit nach einem
 * Wort, das im Index gar nicht vorkommt, und bekam nichts.
 */
const words = computed(() =>
  suchtext.value.trim().toLowerCase().split(/[^\p{L}\p{N}_]+/u).filter((w) => w !== '')
)

/*
 * Die Liste war auf 40 Eintraege begrenzt, der Katalog hat 60.
 *
 * Damit standen Farbe, Ton, Bildfrequenz, Zugangsstatus, Laufzeit, Laenge, die
 * drei Sprachen und beide Daten ueberhaupt nicht zur Wahl, solange niemand ein
 * Suchwort tippte — darunter drei der vier Vokabularfelder, die die
 * Leistungsbeschreibung namentlich nennt. Die Grenze war unsichtbar: kein
 * Hinweis, kein Rollbalkenende, das etwas verraten haette. Gemeldet beim Test
 * mit Vorlesewerkzeug, wo man die Liste ohnehin nur mit Pfeiltasten durchgeht.
 *
 * Es gibt jetzt keine Grenze mehr. Stattdessen ist die Liste nach Ebene
 * gegliedert, damit 60 Eintraege am Stueck bedienbar bleiben.
 */
const matches = computed(() => {
  const list = props.targets
  if (words.value.length === 0) return [...list]
  return list.filter((target) => {
    const haystack = [...target.search, labelOf(target).toLowerCase(), describe(target).toLowerCase()].join(' ')
    return words.value.every((w) => haystack.includes(w))
  })
})

/** Reihenfolge der Ebenen in der Liste. */
const LEVELS = ['work', 'manifestation', 'item'] as const

/**
 * Die Treffer in Bloecke je Ebene, mit dem laufenden Index jedes Eintrags in
 * `matches` — die Pfeiltastenbedienung zaehlt weiter durch alle Bloecke, die
 * Gliederung ist nur fuer die Anzeige und fuer die Ansage da.
 */
const groups = computed(() => {
  const out: Array<{ level: string; items: Array<{ target: EditorTarget; index: number }> }> = []
  for (const level of LEVELS) {
    const items = matches.value
      .map((target, index) => ({ target, index }))
      .filter((x) => x.target.level === level)
    if (items.length > 0) out.push({ level, items })
  }
  return out
})

watch(matches, () => {
  if (matches.value.length === 0) {
    activeIndex.value = -1
    return
  }
  // Steht schon ein Ziel fest, beginnt die Pfeiltastenbedienung dort.
  const at = matches.value.findIndex((x) => x.key === props.modelValue)
  activeIndex.value = at >= 0 ? at : 0
})

function optionId(index: number): string {
  return `${props.inputId}-opt-${index}`
}

/**
 * Der Erlaeuterungsabsatz unter dem Feld gehoert zum Feld.
 *
 * Schemapfad, Beschreibung und die Angabe, wie viele Werte das Ziel aufnimmt,
 * sind genau das, was beim Betreten der Combobox gebraucht wird. Ohne
 * aria-describedby steht der Absatz zwar da, wird aber nur gefunden, wer die
 * Seite ohnehin Zeile fuer Zeile durchgeht. Ein von aussen gereichter Verweis
 * bleibt daneben bestehen.
 */
const infoId = computed(() => `${props.inputId}-info`)
const describedIds = computed(() =>
  [props.describedBy, infoId.value].filter((x): x is string => typeof x === 'string' && x !== '').join(' ')
)

function choose(target: EditorTarget) {
  emit('update:modelValue', target.key)
  query.value = ''
  openList.value = false
  activeIndex.value = -1
}

function clear() {
  emit('update:modelValue', '')
  query.value = ''
}

/** Suche schliessen und die Anzeige wieder auf das gewaehlte Ziel stellen. */
function closeList() {
  openList.value = false
  query.value = ''
}

/**
 * Beim Hineinspringen zeigt das Feld das gewaehlte Ziel. Ohne das meldet ein
 * Vorlesewerkzeug ein leeres Feld, obwohl ein Ziel gesetzt ist.
 */
function onFocus() {
  const sel = selected.value
  query.value = sel !== null ? pathOf(sel) : ''
  openList.value = true
}

function onKeydown(e: KeyboardEvent) {
  // Das erste getippte Zeichen ersetzt die Anzeige des gewaehlten Ziels,
  // statt sich dahinterzuhaengen.
  if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
    const sel = selected.value
    const field = e.target as HTMLInputElement
    if (sel !== null && field.value === pathOf(sel)) {
      field.value = ''
      query.value = ''
    }
  }
  if (e.key === 'Escape') {
    if (openList.value) {
      e.stopPropagation()
      closeList()
    }
    return
  }
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Home' || e.key === 'End') {
    if (!openList.value) openList.value = true
    const last = matches.value.length - 1
    if (last < 0) return
    e.preventDefault()
    if (e.key === 'Home') activeIndex.value = 0
    else if (e.key === 'End') activeIndex.value = last
    else if (e.key === 'ArrowDown') activeIndex.value = activeIndex.value >= last ? 0 : activeIndex.value + 1
    else activeIndex.value = activeIndex.value <= 0 ? last : activeIndex.value - 1
    nextTick(() => {
      document.getElementById(optionId(activeIndex.value))?.scrollIntoView({ block: 'nearest' })
    })
    return
  }
  if (e.key === 'Enter' && openList.value) {
    const hit = matches.value[activeIndex.value]
    if (hit !== undefined) {
      e.preventDefault()
      choose(hit)
    }
  }
}

function onDocClick(e: MouseEvent) {
  if (openList.value && root.value !== null && !root.value.contains(e.target as Node)) closeList()
}
onMounted(() => document.addEventListener('click', onDocClick))
onBeforeUnmount(() => document.removeEventListener('click', onDocClick))
</script>

<template>
  <div ref="root" class="branch-target">
    <label class="ui-step-plabel" :for="inputId">{{ label }}</label>

    <div class="ac-wrap">
      <input :id="inputId" class="ui-input" type="text" role="combobox" autocomplete="off" spellcheck="false"
             aria-autocomplete="list"
             :aria-expanded="openList ? 'true' : 'false'" :aria-controls="`${inputId}-list`"
             :aria-activedescendant="openList && activeIndex >= 0 ? optionId(activeIndex) : undefined"
             :aria-describedby="describedIds"
             :value="openList ? query : (selected ? pathOf(selected) : '')"
             :placeholder="t('mapping.target.search')"
             @focus="onFocus"
             @input="query = ($event.target as HTMLInputElement).value; openList = true"
             @keydown="onKeydown">

      <ul v-show="openList" :id="`${inputId}-list`" class="ac-menu" role="listbox" :aria-label="label">
        <li v-if="matches.length === 0" class="ac-item" role="presentation">
          <span class="dim small">{{ t('mapping.target.noMatch') }}</span>
        </li>
        <!--
          Je Ebene ein Block. Ohne die Gliederung waeren es sechzig Eintraege am
          Stueck, die mit den Pfeiltasten alle gleich klingen; so sagt ein
          Vorlesewerkzeug beim Wechsel die Ebene an.
        -->
        <li v-for="block in groups" :key="block.level" role="group"
            :aria-label="`${levelLabel(block.level)} (${block.items.length})`">
          <!--
            Die sichtbare Ueberschrift ist fuer Vorlesewerkzeuge verborgen: Den
            Namen der Gruppe traegt aria-label. Die innere Liste ist role="none".
            Als gewoehnliche <ul> hatte sie die implizite Rolle „list", und die
            Optionen standen dann in einer Liste statt in ihrer Gruppe — axe
            meldete am 30.09.2026 aria-required-parent fuer jede Option und
            aria-required-children fuer die Auswahlliste.
          -->
          <p class="ac-group" aria-hidden="true">{{ levelLabel(block.level) }} <span class="dim">({{ block.items.length }})</span></p>
          <ul class="ac-sub" role="none">
            <li v-for="entry in block.items" :id="optionId(entry.index)" :key="entry.target.key" role="option"
                :aria-selected="entry.target.key === modelValue ? 'true' : 'false'"
                :class="['ac-item', entry.index === activeIndex ? 'on' : '']"
                style="cursor:pointer"
                @mouseenter="activeIndex = entry.index" @click="choose(entry.target)">
              <span class="ac-lab">{{ labelOf(entry.target) }}</span>
              <span class="ac-desc mono">{{ entry.target.schemaPath }}</span>
            </li>
          </ul>
        </li>
      </ul>

      <!--
        Die Trefferzahl gehoert angesagt: bei einer Liste ohne Grenze ist der
        Unterschied zwischen zwei und sechzig Treffern die eigentliche Auskunft.
      -->
      <p class="sr-only" role="status" aria-live="polite">
        {{ openList ? t('mapping.target.hits', { n: matches.length }, matches.length) : '' }}
      </p>
    </div>

    <!--
      Der Knopf am Ende steht ausserhalb der Kennung: Er ist eine Handlung und
      gehoert nicht in die Beschreibung des Feldes.
    -->
    <p v-if="selected" class="note" style="margin-top:4px">
      <span :id="infoId">
        <span class="mono">{{ selected.schemaPath }}</span>
        <template v-if="describe(selected)"> — {{ describe(selected) }}</template>
        <br>
        <span class="dim">{{ selected.multi ? t('mapping.target.multi') : t('mapping.target.single') }}</span>
        <template v-if="selected.enumValues && selected.enumValues.length">
          · {{ t('mapping.target.enumCount', { n: selected.enumValues.length }) }}
        </template>
        <template v-if="selected.acceptsAuthority"> · {{ t('mapping.target.authority') }}</template>
      </span>
      <button type="button" class="linkbtn" style="margin-left:8px" @click="clear">{{ t('mapping.target.clear') }}</button>
    </p>
    <p v-else :id="infoId" class="note" style="margin-top:4px">{{ t('mapping.target.none') }}</p>
  </div>
</template>

<style scoped>
/* Der Tastaturfokus liegt im Eingabefeld; ohne diese Markierung waere nicht zu
   sehen, welcher Eintrag mit Enter uebernommen wird. */
.ac-item.on { background: var(--primary-100); }
.ac-menu, .ac-sub { list-style: none; margin: 0; padding: 0; }
.ac-group {
  margin: 0; padding: 7px 10px 3px; font-size: 11px; font-weight: 700;
  letter-spacing: .04em; text-transform: uppercase; color: var(--muted);
  position: sticky; top: 0; background: var(--surface); z-index: 1;
}
</style>
