<script setup lang="ts">
import { mappingsService } from '~/services/mappings'
/**
 * Der Mapping-Editor.
 *
 * Arbeitsflaeche ist eine Tabelle mit einer Zeile je Quellspalte. Rechts steht,
 * was daraus entsteht. Aufgeklappt zeigt eine Zeile die Verzweigung:
 * Spalte → gemeinsame Kette → je Zweig eigene Kette und eigenes Ziel.
 *
 * Gerechnet wird ausschliesslich auf dem Server (POST <endpoint>/preview) mit
 * demselben Code, der spaeter konvertiert. Hier wird NICHTS nachgerechnet:
 * Eine zweite Umsetzung im Browser waere schneller und koennte gruen zeigen,
 * was hinterher rot ist.
 *
 * Drei Spaltenzustaende, alle sichtbar: gemappt, ignoriert, noch nicht
 * angefasst. Ohne den dritten speichert jemand ein halbes Profil und wundert
 * sich ueber leere Datensaetze.
 */
import type { ColumnMapping, DismissedHint, MappingJson, TransformStep } from '#shared/types/domain'
import { failureText, mappingFailure, type MappingFailure } from './errors'
import type {
  AuthorityCandidate, AuthorityGroup, AuthorityRequest, AuthorityValue, AuthorityValuesResponse,
  CandidateResponse, EditorPayload, EditorTarget, ForeignProfile, MappingCheck, PreviewExample,
  PreviewPayload, SaveResponse, SchemaCheckResponse
} from './types'
import MappingBranch from './Branch.vue'
import MappingChecks from './Checks.vue'
import MappingColumnReport from './ColumnReport.vue'
import MappingResultTree from './ResultTree.vue'
import MappingTargetSelect from './TargetSelect.vue'
import MappingAuthorityDialog from './AuthorityDialog.vue'

const props = defineProps<{
  payload: EditorPayload
  backTo: string
  backLabel: string
  /**
   * Spalte, die beim Oeffnen aufgeklappt und angesprungen wird.
   *
   * Aus dem Pruefbericht kommt man mit einer bestimmten Quellspalte
   * hierher. Woher die Angabe stammt — Adresszeile, Aufruf im Programm,
   * Test — entscheidet die einbettende Seite; die Komponente muss davon
   * nichts wissen (#13, gemeldet von Stefan Stretz).
   */
  initialColumn?: string
}>()

const emit = defineEmits<{
  /**
   * Gespeichert und die Konvertierung angestossen.
   *
   * Wohin es danach geht, entscheidet die Seite. Bisher navigierte die
   * Komponente selbst auf "/" — damit war sie an eine Stelle der
   * Anwendung gebunden, an der sie haengen musste, um zu funktionieren.
   */
  started: [profile: { id: number; name: string; version: number }]
}>()

const { t, te } = useI18n()
const { meldung, befund } = useMeldungstext()
const zuordnungen = mappingsService()
const keepFocus = useKeepFocus()

/* ---------------------------------------------------------------- Zustand */

/** Fuellt fehlende Strukturen EINMALIG auf. Danach liest die Anzeige nur noch. */
function normalize(raw: MappingJson, columns: readonly string[]): MappingJson {
  const mapping = JSON.parse(JSON.stringify(raw)) as MappingJson
  mapping.columns ??= {}
  for (const column of columns) {
    const spec = (mapping.columns[column] ??= {}) as ColumnMapping
    if (!Array.isArray(spec.pre)) spec.pre = []
    if (!Array.isArray(spec.targets)) spec.targets = []
    for (const binding of spec.targets) if (!Array.isArray(binding.post)) binding.post = []
  }
  if (!Array.isArray(mapping.defaults)) mapping.defaults = []
  mapping.row ??= { represents: 'item' }
  mapping.grouping ??= { work: { by: [] }, manifestation: { by: [] } }
  mapping.grouping.work ??= { by: [] }
  if (!Array.isArray(mapping.grouping.work.by)) mapping.grouping.work.by = []
  mapping.grouping.manifestation ??= { by: [] }
  return mapping
}

const mapping = ref<MappingJson>(normalize(props.payload.mapping, props.payload.columns))
const name = ref(props.payload.profile?.name ?? props.payload.suggestedName)
const profile = ref(props.payload.profile)
const columns = computed(() => props.payload.columns)
const targets = computed(() => props.payload.targets)
const targetByKey = computed(() => new Map(targets.value.map((x) => [x.key, x])))

const opened = ref<Record<string, boolean>>({})
const filter = ref<'all' | 'untouched' | 'mapped' | 'ignored'>('all')
const merged = ref(false)

const preview = ref<PreviewPayload | null>(null)
const busy = ref(false)
const saving = ref(false)
const failure = ref<MappingFailure | null>(null)
const message = ref('')
const blockedChecks = ref<MappingCheck[]>([])
const schemaResult = ref<SchemaCheckResponse | null>(null)
const schemaBusy = ref(false)

const errorText = computed(() => failureText(t, te, failure.value))

onMounted(() => {
  try {
    merged.value = localStorage.getItem('avefi-map-merged') === '1'
  } catch { /* Speicher gesperrt */ }
  void runPreview()
})

function toggleMerged() {
  merged.value = !merged.value
  try {
    localStorage.setItem('avefi-map-merged', merged.value ? '1' : '0')
  } catch { /* Speicher gesperrt */ }
}

/* ------------------------------------------------------- Zustand je Spalte */

function spec(column: string): ColumnMapping {
  return (mapping.value.columns[column] ?? { pre: [], targets: [] }) as ColumnMapping
}

/** Gemappt, ignoriert oder noch nicht angefasst — der dritte Zustand. */
function stateOf(column: string): 'mapped' | 'ignored' | 'untouched' {
  const s = mapping.value.columns[column]
  if (s === undefined) return 'untouched'
  if (s.ignore === true) return 'ignored'
  return (s.targets ?? []).length > 0 ? 'mapped' : 'untouched'
}

const openColumns = computed(() => columns.value.filter((c) => stateOf(c) === 'untouched'))
const mappedCount = computed(() => columns.value.filter((c) => stateOf(c) === 'mapped').length)
const ignoredCount = computed(() => columns.value.filter((c) => stateOf(c) === 'ignored').length)
const complete = computed(() => openColumns.value.length === 0 && mappedCount.value > 0)

const shownColumns = computed(() => {
  if (filter.value === 'all') return columns.value
  return columns.value.filter((c) => stateOf(c) === filter.value)
})

/* -------------------------------------------------------------- Vorschau */

function examplesOf(column: string): PreviewExample[] {
  return preview.value?.columns[column]?.examples ?? []
}

function filledOf(column: string) {
  return preview.value?.columns[column]?.filled ?? null
}

/** "gefuellt in 57 von 77 Zeilen" — beantwortet die haeufigste Rueckfrage von selbst. */
function fillLabel(column: string): string {
  const filled = filledOf(column)
  if (filled === null || filled.of === 0) return ''
  if (stateOf(column) === 'ignored') return ''
  if (filled.n === filled.of && filled.of === filled.total) return ''
  return filled.total > filled.of
    ? t('mapping.table.filledSample', { n: filled.n, of: filled.of, total: filled.total })
    : t('mapping.table.filled', { n: filled.n, of: filled.of })
}

function fillSparse(column: string): boolean {
  const filled = filledOf(column)
  return filled !== null && filled.of > 0 && filled.n / filled.of < 0.5
}

function valuesOf(example: PreviewExample): string[] {
  return (example.outputs ?? []).map((o) => o.value)
}

/**
 * Die gefundenen Normdaten-IDs einer Beispielzeile, jede mit ihrer Herkunft.
 *
 * Die Herkunft steht daneben, weil sie sonst niemand kennt: Der Konverter „Land
 * normalisieren" liefert die GND-Nummer des Staates aus der mitgelieferten
 * Tabelle mit, ganz ohne „Normdaten nachschlagen". Wer den Nachschlage-Konverter
 * entfernt und beim Land weiter eine Nummer sieht, haelt das sonst fuer eine
 * Wirkungslosigkeit — genau so gemeldet worden.
 */
function idsOf(example: PreviewExample): Array<{ id: string; origin: string }> {
  const out: Array<{ id: string; origin: string }> = []
  for (const output of example.outputs ?? []) {
    for (const id of output.ids ?? []) out.push({ id: id.id, origin: id.origin })
  }
  return out
}

/** Klartext zur Herkunft einer ID — als Tooltip und fuer Vorlesegeraete. */
function idTitle(entry: { id: string; origin: string }): string {
  const key = `mapping.idorigin.${entry.origin === '' ? 'unbekannt' : entry.origin}`
  return te(key) ? t(key, { id: entry.id }) : t('mapping.idorigin.unbekannt', { id: entry.id })
}

function sourceValues(column: string) {
  return props.payload.values[column] ?? []
}

function targetLabel(key: string): string {
  const target = targetByKey.value.get(key)
  if (target === undefined) return key
  const i18nKey = `mapping.targets.${key}`
  return te(i18nKey) ? t(i18nKey) : target.label
}

const groupLabel = useGroupLabel()

/**
 * Ebene, Gruppe und Feld — ohne dasselbe Wort zweimal.
 *
 * Auf der Manifestations- und der Werkebene heisst die Gruppe wie die Ebene,
 * und der Pfad las sich als „Manifestation › Manifestation › Anmerkung zur
 * Manifestation". Elias Oltmanns hat das am 31.08.2026 fuer die Zielauswahl
 * gemeldet („woher die zweite Ebene Werk kommt, ist mir unklar"); dort wurde es
 * behoben, an den Schaltflaechen der Spaltenliste stand es noch. Faellt beim
 * Sehen kaum auf, kostet mit einem Vorlesewerkzeug jedes Mal drei Woerter.
 */
function targetPath(key: string): string {
  const target = targetByKey.value.get(key)
  if (target === undefined) return key
  const ebene = t(`mapping.level.${target.level}`)
  const gruppe = groupLabel(target.group)
  const teile = gruppe === ebene ? [ebene] : [ebene, gruppe]
  return [...teile, targetLabel(key)].join(' › ')
}

/* --------------------------------------------------------------- Bedienung */

let timer: ReturnType<typeof setTimeout> | null = null

function refresh() {
  if (timer !== null) clearTimeout(timer)
  timer = setTimeout(() => {
    void runPreview()
  }, 350)
}

async function post<T>(action: string, body: Record<string, unknown>): Promise<T> {
  return zuordnungen.editorAktion<T>(props.payload.endpoint, action, body)
}

async function runPreview() {
  busy.value = true
  try {
    preview.value = await post<PreviewPayload>('preview', { mapping: mapping.value })
    failure.value = null
    void loadAuthorityValues()
  } catch (e) {
    failure.value = mappingFailure(e)
  } finally {
    busy.value = false
  }
}

async function runSchemaCheck() {
  return keepFocus(async () => {
  schemaBusy.value = true
  try {
    schemaResult.value = await post<SchemaCheckResponse>('schema', { mapping: mapping.value })
  } catch (e) {
    failure.value = mappingFailure(e)
  } finally {
    schemaBusy.value = false
  }
  })
}

function toggleOpen(column: string) {
  opened.value[column] = opened.value[column] !== true
}

function toggleIgnore(column: string) {
  const s = spec(column)
  const next = s.ignore !== true
  s.ignore = next
  if (next) s.targets = []
  refresh()
}

/** Spalte wieder unbeantwortet stellen — der Weg zurueck in den dritten Zustand. */
function reset(column: string) {
  const s = spec(column)
  s.ignore = false
  s.targets = []
  s.pre = []
  // Der Zuruecksetzen-Knopf faellt mit dem Zustand weg; der Fokus wandert
  // deshalb auf den ersten Knopf derselben Zeile.
  const index = columns.value.indexOf(column)
  void nextTick(() => {
    document.querySelector<HTMLButtonElement>(`#maprow-${index} .rowbtns button`)?.focus()
  })
  refresh()
}

/**
 * Neues Ziel anlegen und den Fokus mitnehmen.
 *
 * Der Vorschlagsknopf, den man dafuer druckt, verschwindet dabei aus dem
 * Baum. Ohne das Nachfuehren faellt der Fokus auf <body>, und der Weg zurueck
 * in die eben geoeffnete Zeile beginnt wieder am Seitenanfang.
 */
function addTarget(column: string, key = '') {
  const s = spec(column)
  s.ignore = false
  if (!Array.isArray(s.targets)) s.targets = []
  s.targets.push({ target: key, post: [] })
  opened.value[column] = true
  const index = columns.value.indexOf(column)
  const branch = (s.targets.length) - 1
  void nextTick(() => {
    document.getElementById(`col${index}-b${branch}-target`)?.focus()
  })
  refresh()
}

function removeTarget(column: string, index: number) {
  spec(column).targets?.splice(index, 1)
  refresh()
}

/**
 * Aus dem Pruefbericht kommt man mit einer bestimmten Spalte hierher. Die
 * Beanstandung nennt eine Quellspalte; ohne diesen Einstieg muesste man sie in
 * der Tabelle suchen.
 */
onMounted(() => {
  const gewuenscht = props.initialColumn ?? ''
  if (gewuenscht !== '') gotoColumn(gewuenscht)
})

function gotoColumn(column: string) {
  if (column === '') return
  if (!columns.value.includes(column)) return
  filter.value = 'all'
  opened.value[column] = true
  void nextTick(() => {
    const row = document.getElementById(`maprow-${columns.value.indexOf(column)}`)
    row?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    row?.querySelector<HTMLButtonElement>('button')?.focus()
  })
}

/**
 * Vorschlag aus der Pruefung uebernehmen — auf Knopfdruck, nie von selbst.
 * Der Schritt haengt an die Kette des betroffenen Zweigs; ohne Zweig an die
 * gemeinsame Vorkette.
 */
function applyFix(check: MappingCheck) {
  const column = check.sourceField ?? ''
  if (column === '') return
  if (Array.isArray(check.fixPlan) && check.fixPlan.length > 0) {
    applyFixPlan(column, check)
    return
  }
  if (check.fix === undefined) return
  const s = spec(column)
  const step = JSON.parse(JSON.stringify(check.fix)) as TransformStep
  const binding = (s.targets ?? []).find((b) => b.target === check.targetField) ?? s.targets?.[0]
  if (binding !== undefined) {
    if (!Array.isArray(binding.post)) binding.post = []
    binding.post.push(step)
  } else {
    if (!Array.isArray(s.pre)) s.pre = []
    s.pre.push(step)
  }
  gotoColumn(column)
  refresh()
}

/**
 * Einen mehrteiligen Vorschlag uebernehmen.
 *
 * Anders als `fix` aendert ein Plan mehrere Zweige auf einmal und legt
 * fehlende an. Anlass ist die Klammerregel: Sie haengt einen Waechter an den
 * bestehenden Titelzweig und stellt einen zweiten daneben, der auf den
 * Archivtitel zielt. Nacheinander liesse sich das nicht anbieten — nach dem
 * ersten Schritt stuende ein halb umgebautes Profil da, in dem beide Zweige
 * denselben Wert bekommen.
 */
function applyFixPlan(column: string, check: MappingCheck) {
  const s = spec(column)
  if (!Array.isArray(s.targets)) s.targets = []
  for (const teil of check.fixPlan ?? []) {
    const post = JSON.parse(JSON.stringify(teil.post ?? [])) as TransformStep[]
    if (typeof teil.replaces === 'string' && teil.replaces !== '') {
      // Ersetzen statt danebenstellen: Das alte Ziel verschwindet, seine
      // gemeinsame Vorkette bleibt, weil sie an der Spalte haengt.
      const alt = s.targets.find((b) => b.target === teil.replaces)
      if (alt !== undefined) {
        alt.target = teil.target
        alt.post = post
        continue
      }
    }
    const vorhanden = s.targets.find((b) => b.target === teil.target)
    if (vorhanden === undefined) {
      s.targets.push({ target: teil.target, post })
    } else {
      if (!Array.isArray(vorhanden.post)) vorhanden.post = []
      vorhanden.post.push(...post)
    }
  }
  gotoColumn(column)
  refresh()
}

/**
 * Einen Vorschlag ablehnen.
 *
 * Der Hinweis verschwindet aus der Liste und die Ablehnung steht im Profil.
 * Sie wird erst mit dem naechsten Speichern wirksam gespeichert — wie jede
 * andere Aenderung am Mapping auch, und sie erzeugt dieselbe neue
 * Profilversion. Rueckgaengig geht ueber die Liste darunter.
 */
function dismissCheck(check: MappingCheck) {
  const column = check.sourceField ?? ''
  const code = String(check.code ?? '')
  if (column === '' || code === '') return
  const s = spec(column)
  if (!Array.isArray(s.dismissed)) s.dismissed = []
  const eintrag: DismissedHint = { code }
  if (check.targetField !== undefined) eintrag.target = check.targetField
  const sep = check.fix?.sep
  if (typeof sep === 'string') eintrag.sep = sep
  const schon = s.dismissed.some((d) => d.code === eintrag.code && d.target === eintrag.target && d.sep === eintrag.sep)
  if (!schon) s.dismissed.push(eintrag)
  refresh()
}

/** Alle abgelehnten Hinweise, damit die Entscheidung sichtbar und umkehrbar bleibt. */
const dismissedHints = computed(() => {
  const out: Array<{ column: string; hint: DismissedHint }> = []
  for (const [column, s] of Object.entries(mapping.value.columns ?? {})) {
    for (const hint of s.dismissed ?? []) out.push({ column, hint })
  }
  return out
})

function undismiss(column: string, hint: DismissedHint) {
  const s = spec(column)
  s.dismissed = (s.dismissed ?? []).filter((d) => d !== hint)
  if (s.dismissed.length === 0) delete s.dismissed
  refresh()
}

/* -------------------------------------------------------------- Festwerte */

function addDefault() {
  mapping.value.defaults.push({ target: '', value: '' })
}

function removeDefault(index: number) {
  mapping.value.defaults.splice(index, 1)
  refresh()
}

/* ------------------------------------------------------------ Werkbildung */

const groupingBy = computed(() => mapping.value.grouping.work.by)

const groupingCandidates = computed(() => {
  const out: Array<{ key: string; label: string }> = []
  for (const key of Object.keys(preview.value?.targetUse ?? {})) {
    const target = targetByKey.value.get(key)
    if (target !== undefined && target.level === 'work') out.push({ key: `target:${key}`, label: targetLabel(key) })
  }
  for (const column of columns.value) {
    out.push({ key: `column:${column}`, label: t('mapping.grouping.column', { column }) })
  }
  return out
})

function toggleGrouping(key: string) {
  const by = mapping.value.grouping.work.by
  const at = by.indexOf(key)
  if (at >= 0) by.splice(at, 1)
  else by.push(key)
  refresh()
}

/* --------------------------------------------------------------- Normdaten */

const authorityRequest = ref<AuthorityRequest | null>(null)
const authorityCandidates = ref<AuthorityCandidate[]>([])
const authorityBusy = ref(false)
const authorityError = ref('')

/**
 * Der vollstaendige Wertevorrat, nicht die drei Beispielwerte der Vorschau.
 *
 * Die Vorschau zeigt je Spalte drei verschiedene Werte, weil sie nach jeder
 * Aenderung neu rechnet. Fuer die Zuordnung von Hand ist das zu wenig: Ein
 * Wert, der eine Entscheidung braucht, aber erst weiter unten in der Datei
 * steht, war damit unerreichbar. Deshalb ein eigener Aufruf — er geht nicht
 * ins Netz, er rechnet nur die Ketten.
 */
const authorityValues = ref<AuthorityGroup[]>([])

function hasAuthorityStep(): boolean {
  for (const spec of Object.values(mapping.value.columns ?? {})) {
    if (typeof spec !== 'object' || spec === null) continue
    const chains = [spec.pre ?? [], ...(spec.targets ?? []).map((b) => b.post ?? [])]
    if (chains.some((c) => c.some((s) => String((s as { op?: unknown }).op ?? '') === 'authority'))) return true
  }
  return false
}

async function loadAuthorityValues() {
  if (!hasAuthorityStep()) {
    authorityValues.value = []
    return
  }
  try {
    const res = await post<AuthorityValuesResponse>('authority-values', { mapping: mapping.value })
    authorityValues.value = res.groups
  } catch {
    // Der Wertevorrat ist Komfort, kein Kern: Faellt er aus, bleibt der Editor
    // mit den Beispielwerten bedienbar.
    authorityValues.value = []
  }
}

/** Werte fuer einen Zweig — die gemeinsame Kette (-1) gilt fuer jeden Zweig. */
function authorityValuesFor(column: string, branch: number, source: string): AuthorityValue[] {
  const hit = authorityValues.value.find(
    (g) => g.column === column && g.source === source && (g.branch === branch || g.branch === -1)
  )
  return hit?.values ?? []
}

async function openAuthority(request: AuthorityRequest) {
  authorityRequest.value = request
  authorityCandidates.value = []
  authorityError.value = ''
  authorityBusy.value = true
  try {
    const res = await post<CandidateResponse>('candidates', {
      value: request.value,
      kind: request.kind,
      sources: [request.source]
    })
    authorityCandidates.value = res.candidates
  } catch (e) {
    authorityError.value = failureText(t, te, mappingFailure(e))
  } finally {
    authorityBusy.value = false
  }
}

function chooseAuthority(entry: { id: string; type: string; label?: string }) {
  const request = authorityRequest.value
  if (request === null) return
  // Setzt die Entscheidung zu DIESER Quelle und laesst die anderen stehen.
  setConfirmed(spec(request.column), request.value, entry)
  authorityRequest.value = null
  refresh()
}

function clearAuthority(column: string, value: string, source?: string) {
  clearConfirmed(spec(column), value, source)
  refresh()
}

/* ---------------------------------------------------------- Fremdes Profil */

const adoptTarget = ref<ForeignProfile | null>(null)
const adoptNote = ref('')

async function confirmAdopt() {
  const source = adoptTarget.value
  if (source === null) return
  adoptTarget.value = null
  try {
    const res = await post<{
      mapping: MappingJson
      matched: string[]
      missing: string[]
      extra: string[]
      from: { id: number; name: string }
    }>('adopt', { profile_id: source.id })
    mapping.value = normalize(res.mapping, columns.value)
    adoptNote.value = t('mapping.adopt.done', {
      name: res.from.name,
      matched: res.matched.length,
      missing: res.missing.length,
      extra: res.extra.length
    })
    await runPreview()
  } catch (e) {
    failure.value = mappingFailure(e)
  }
}

/* --------------------------------------------------------------- Speichern */

const incompleteWarning = ref('')

async function save(start: boolean) {
  return keepFocus(() => saveInner(start))
}

async function saveInner(start: boolean) {
  incompleteWarning.value = ''
  message.value = ''
  blockedChecks.value = []
  if (start && !complete.value) {
    incompleteWarning.value = t(
      'mapping.save.incomplete',
      { n: openColumns.value.length, columns: openColumns.value.join(', ') },
      openColumns.value.length
    )
    return
  }
  saving.value = true
  try {
    const res = await post<SaveResponse>('save', { mapping: mapping.value, name: name.value, start })
    failure.value = null
    profile.value = res.profile
    name.value = res.profile.name
    if (res.started) {
      /* Der Seitenwechsel darf die Rueckmeldung nicht verschlucken. Beim
       * Speichern ohne Konvertieren steht sie hier auf der Seite; beim
       * Speichern MIT Konvertieren sprang die Seite bisher zurueck, und dass
       * eine neue Profilversion entstanden ist, erfuhr niemand. Gemeldet von
       * Jasper Stratil am 01.09.2026. Die Importliste macht daraus ihre
       * eigene Meldung und raeumt die Parameter danach weg.
       *
       * Wohin gewechselt wird, entscheidet die Seite: Der Editor haengt am
       * Import und am Profil, und nur die erste der beiden Stellen hat eine
       * Liste, auf der eine laufende Konvertierung etwas zu suchen hat. */
      emit('started', res.profile)
      return
    }
    message.value = t('mapping.save.done', { name: res.profile.name, version: res.profile.version })
    void runSchemaCheck()
  } catch (e) {
    const f = mappingFailure(e)
    failure.value = f
    const checks = f.params.checks
    if (Array.isArray(checks)) blockedChecks.value = checks as MappingCheck[]
  } finally {
    saving.value = false
  }
}

const allChecks = computed<MappingCheck[]>(() =>
  blockedChecks.value.length > 0 ? blockedChecks.value : (preview.value?.checks ?? [])
)

/**
 * Die Beanstandungen einer Spalte — fuer die Anzeige direkt am Zweig.
 *
 * Der Vertrag verlangt einen strukturierten Bezug auf Datensatz, Quellfeld und
 * AVefi-Schemafeld. Den Bezug fuehren die Meldungen laengst mit; gezeigt wurde
 * er bisher nur in der Uebersicht am Seitenanfang.
 */
function checksOfColumn(column: string): MappingCheck[] {
  return allChecks.value.filter((c) => c.sourceField === column)
}

const canonicalJson = computed(() => {
  try {
    return JSON.stringify(preview.value?.canonical ?? null, null, 2)
  } catch {
    return ''
  }
})
</script>

<template>
  <div>
    <div class="map-head">
      <div>
        <h1 class="ed-title">{{ payload.subject }}</h1>
        <p class="dim small" style="margin:4px 0 0">
          {{ t('mapping.head.columns', { n: columns.length }, columns.length) }} ·
          {{ t('mapping.head.mapped', { n: mappedCount }) }} ·
          {{ t('mapping.head.ignored', { n: ignoredCount }) }} ·
          <span :class="openColumns.length ? 'warnhint' : ''">
            {{ t('mapping.head.open', { n: openColumns.length }, openColumns.length) }}
          </span>
          · {{ t('mapping.head.rows', { n: payload.rowCount }) }}
        </p>
      </div>

      <label class="map-name">
        <span class="dim small">{{ t('mapping.head.nameLabel') }}</span>
        <input v-model="name" class="ui-input" :aria-label="t('mapping.head.nameLabel')">
      </label>

      <div class="map-actions">
        <button type="button" :class="payload.canStart ? 'btn btn-outline' : 'btn btn-primary'"
                :disabled="saving" @click="save(false)">{{ t('mapping.head.save') }}</button>
        <button v-if="payload.canStart" type="button" class="btn btn-primary"
                :disabled="saving || (preview?.blocking ?? false)" @click="save(true)">
          {{ t('mapping.head.saveAndConvert') }}
        </button>
      </div>
    </div>

    <p class="sr-only" role="status" aria-live="polite">
      {{ busy ? t('mapping.state.calculating') : t('mapping.state.ready', { n: preview?.evaluatedRows ?? 0 }) }}
    </p>
    <p v-if="busy" class="dim small" style="margin:0 0 8px" aria-hidden="true">{{ t('mapping.state.calculating') }}</p>

    <!--
      Die beiden Bereiche stehen dauerhaft im Baum; nur ihr Inhalt wechselt.

      Vorher hing an jeder Meldung ein v-if, das Element entstand also
      gemeinsam mit seinem Text. Ein Bereich mit role="status", der erst mit
      seinem Inhalt eingefuegt wird, wird von den verbreiteten Vorlesewerkzeugen
      nicht angesagt — sie beobachten Bereiche, die sie schon kennen. Deshalb
      blieb "Speichern" ohne hoerbare Rueckmeldung, obwohl die Bestaetigung
      sichtbar dastand. Gemeldet beim Test mit Vorlesewerkzeug.

      Getrennt nach Dringlichkeit: Bestaetigungen warten hoeflich, Fehler und
      der Hinweis auf offene Spalten unterbrechen.
    -->
    <div class="live-region" role="status" aria-live="polite">
      <div v-if="message" class="ui-alert ui-alert-ok" style="margin-bottom:14px">{{ message }}</div>
      <div v-if="adoptNote" class="ui-alert ui-alert-ok" style="margin-bottom:14px">{{ adoptNote }}</div>
    </div>
    <div class="live-region" role="alert" aria-live="assertive">
      <div v-if="errorText" class="ui-alert" style="margin-bottom:14px">{{ errorText }}</div>
      <div v-if="incompleteWarning" class="ui-alert" style="margin-bottom:14px">{{ incompleteWarning }}</div>
    </div>

    <MappingColumnReport :report="payload.columnReport" />

    <div v-if="payload.issues.length" class="ui-alert" style="margin-bottom:14px">
      <strong>{{ t('mapping.issues.heading') }}</strong>
      <ul class="tight">
        <li v-for="(issue, i) in payload.issues" :key="i">{{ befund(issue) }}</li>
      </ul>
    </div>

    <div v-if="payload.foreign.length && mappedCount === 0" class="ui-alert" style="margin-bottom:14px">
      {{ t('mapping.adopt.offer', { n: payload.foreign.length }, payload.foreign.length) }}
      <span v-for="(p, i) in payload.foreign" :key="p.id">
        <button type="button" class="linkbtn" @click="adoptTarget = p">
          {{ p.name }} ({{ p.institution_name }})
        </button><span v-if="i < payload.foreign.length - 1">, </span>
      </span>
      <p class="note" style="margin-top:6px">{{ t('mapping.adopt.copyHint') }}</p>
    </div>

    <MappingChecks :checks="allChecks" :targets="targets" @goto="gotoColumn" @fix="applyFix"
                   @dismiss="dismissCheck" />

    <!--
      Abgelehnte Hinweise bleiben sichtbar. Ein Vorschlag, der spurlos
      verschwindet, laesst spaeter niemanden mehr erkennen, ob er nie kam oder
      abgelehnt wurde.
    -->
    <div v-if="dismissedHints.length > 0" class="note" style="margin:10px 0">
      <p style="margin:0 0 4px">{{ t('mapping.check.dismissedHeading', { n: dismissedHints.length }, dismissedHints.length) }}</p>
      <ul style="margin:0;padding-left:18px">
        <li v-for="(d, i) in dismissedHints" :key="i">
          {{ d.column }}
          <button type="button" class="linkbtn" @click="undismiss(d.column, d.hint)">
            {{ t('mapping.check.undismiss') }}
          </button>
        </li>
      </ul>
    </div>

    <div class="map-grid">
      <div>
        <div style="display:flex;gap:8px;align-items:center;margin-bottom:10px;flex-wrap:wrap">
          <label class="dim small" for="mapfilter">{{ t('mapping.filter.label') }}</label>
          <select id="mapfilter" v-model="filter" class="ui-input" style="width:auto">
            <option value="all">{{ t('mapping.filter.all', { n: columns.length }) }}</option>
            <option value="untouched">{{ t('mapping.filter.untouched', { n: openColumns.length }) }}</option>
            <option value="mapped">{{ t('mapping.filter.mapped', { n: mappedCount }) }}</option>
            <option value="ignored">{{ t('mapping.filter.ignored', { n: ignoredCount }) }}</option>
          </select>
          <!--
            Der Knopf schaltet die Darstellung der Spaltenliste um und stand
            trotzdem oben bei Speichern und Konvertieren. Er gehoert neben die
            Auswahl, auf die er wirkt (Jasper Stratil, 01.09.2026).
          -->
          <button type="button" class="btn btn-outline btn-sm" :aria-pressed="merged ? 'true' : 'false'"
                  @click="toggleMerged">
            {{ merged ? t('mapping.head.split') : t('mapping.head.merge') }}
          </button>
        </div>

        <!--
          Die Tabelle hat je Quellspalte eine Zeile und damit mehrere hundert
          Tabstopps. Der Sprung fuehrt daran vorbei, ohne die Reihenfolge zu
          veraendern: Alles bleibt erreichbar, es kommt nur ein Weg hinzu.
        -->
        <a v-if="shownColumns.length > 0" class="skip-inline" href="#mapside">
          {{ t('mapping.table.skip', { n: shownColumns.length }, shownColumns.length) }}
        </a>

        <div class="tablewrap">
          <table class="maptable">
            <caption class="sr-only">{{ t('mapping.table.caption') }}</caption>
            <!--
              Feste Spaltenbreiten, damit die Tabelle nie ueber ihren Platz
              hinauslaeuft (ein waagerechter Rollbalken hat hier schon einmal
              gestoert). Die Aktionsspalte ist dabei nicht verhandelbar: Die drei
              Knoepfe brauchen gemessene 108 px, dazu 2 x 12 px Zellenpolsterung.
              Mit den frueheren 96 px ragte der aeusserste Knopf ueber die
              Tabellenkante hinaus, wurde von overflow:hidden abgeschnitten und
              im schmalen Fenster zusaetzlich von der Spalte „Ergebnis je
              Datensatz" verdeckt. Die Prozentwerte darueber summieren sich
              deshalb auf 82 statt 90 — sonst waere fuer die 136 px kein Platz.
            -->
            <colgroup>
              <col style="width:16%">
              <col :style="{ width: merged ? '40%' : '22%' }">
              <col :style="{ width: merged ? '26%' : '23%' }">
              <col v-if="!merged" style="width:21%">
              <col style="width:136px">
            </colgroup>
            <thead>
              <tr>
                <th scope="col">{{ t('mapping.table.column') }}</th>
                <th scope="col">{{ merged ? t('mapping.table.exampleResult') : t('mapping.table.example') }}</th>
                <th scope="col">{{ t('mapping.table.target') }}</th>
                <th v-if="!merged" scope="col">{{ t('mapping.table.result') }}</th>
                <th scope="col"><span class="sr-only">{{ t('mapping.table.actions') }}</span></th>
              </tr>
            </thead>
            <tbody>
              <template v-for="column in shownColumns" :key="column">
                <tr :id="`maprow-${columns.indexOf(column)}`"
                    :class="{ 'row-open': stateOf(column) === 'untouched', 'row-ignored': stateOf(column) === 'ignored' }">
                  <td>
                    <div class="fn" :title="column">{{ column }}</div>
                    <div>
                      <span v-if="stateOf(column) === 'ignored'" class="badge b-neutral">
                        <span class="bd" />{{ t('mapping.state.ignored') }}
                      </span>
                      <span v-else-if="stateOf(column) === 'untouched'" class="badge b-warn">
                        <span class="bd" />{{ t('mapping.state.untouched') }}
                      </span>
                      <span v-else class="badge b-ok"><span class="bd" />{{ t('mapping.state.mapped') }}</span>
                    </div>
                    <div v-if="fillLabel(column)" class="dim small" :class="fillSparse(column) ? 'fillhint' : ''">
                      {{ fillLabel(column) }}
                    </div>
                  </td>

                  <td>
                    <template v-if="examplesOf(column).length">
                      <div v-for="(example, i) in examplesOf(column)" :key="i" class="exline">
                        <span class="exraw" :title="example.raw">{{ example.raw }}</span>
                        <span v-if="example.count > 1" class="dim excount">{{ example.count }}×</span>
                        <template v-if="merged">
                          <i class="exarrow" aria-hidden="true">→</i>
                          <span v-if="valuesOf(example).length" class="okval">
                            <i aria-hidden="true">✓</i>{{ valuesOf(example).join(' · ') }}
                          </span>
                          <span v-else-if="example.errors.length" class="errval" :title="example.errors.map(meldung).join(' · ')">
                            <i aria-hidden="true">⚠</i>{{ meldung(example.errors[0]!) }}
                          </span>
                          <span v-else class="dim">{{ t('mapping.branch.noValue') }}</span>
                        </template>
                      </div>
                    </template>
                    <span v-else-if="filledOf(column) && filledOf(column)!.n === 0" class="dim small">
                      {{ t('mapping.table.allEmpty') }}
                    </span>
                    <span v-else class="dim">–</span>
                  </td>

                  <td>
                    <!--
                      Sichtbar bleibt der Zielpfad. Vorgelesen wird er zusammen
                      mit der Quellspalte: Dasselbe Ziel kommt in mehreren
                      Zeilen vor und waere sonst nicht zuzuordnen.
                    -->
                    <div v-if="(spec(column).targets ?? []).length" class="tchips">
                      <button v-for="(binding, i) in spec(column).targets" :key="i" type="button" class="chip"
                              :title="targetPath(binding.target)"
                              :aria-label="t('mapping.table.targetOfColumn', {
                                path: binding.target ? targetPath(binding.target) : t('mapping.table.noTargetYet'),
                                column
                              })"
                              @click="opened[column] = true">
                        <span v-if="binding.target">{{ targetPath(binding.target) }}</span>
                        <span v-else class="warnhint">{{ t('mapping.table.noTargetYet') }}</span>
                      </button>
                      <span v-if="(spec(column).targets ?? []).length > 1" class="dim small">
                        {{ t('mapping.table.branches', { n: (spec(column).targets ?? []).length }, (spec(column).targets ?? []).length) }}
                      </span>
                    </div>

                    <div v-else-if="stateOf(column) !== 'ignored'" class="tsugg">
                      <!--
                        Das Sinnbild vor der Beschriftung ist Schmuck. Es bleibt
                        sichtbar, wird aber ausgeblendet, damit es nicht vor dem
                        Namen mitgelesen wird.
                      -->
                      <button v-for="s in (payload.suggestions[column] ?? [])" :key="s.target" type="button"
                              class="chip chip-sugg"
                              :title="t('mapping.table.suggestionHint', { score: s.score, path: targetPath(s.target) })"
                              :aria-label="t('mapping.table.suggestionFor', { target: targetPath(s.target), column })"
                              @click="addTarget(column, s.target)">
                        <span aria-hidden="true">✨</span> {{ targetLabel(s.target) }}
                      </button>
                      <button v-for="h in (payload.hints[column] ?? [])" :key="`h${h.target}`" type="button"
                              class="chip chip-sugg"
                              :title="t('mapping.table.hintHint', { n: h.count, path: targetPath(h.target) })"
                              :aria-label="t('mapping.table.hintFor', { target: targetPath(h.target), column })"
                              @click="addTarget(column, h.target)">
                        <span aria-hidden="true">👥</span> {{ targetLabel(h.target) }}
                      </button>
                      <button type="button" class="btn btn-outline btn-sm"
                              :aria-label="t('mapping.table.chooseTargetFor', { column })"
                              @click="addTarget(column)">
                        {{ t('mapping.table.chooseTarget') }}
                      </button>
                    </div>
                  </td>

                  <td v-if="!merged" class="mapresult">
                    <template v-if="examplesOf(column).length">
                      <div v-for="(example, i) in examplesOf(column)" :key="i" class="exline">
                        <span v-if="valuesOf(example).length" class="okval">
                          <i aria-hidden="true">✓</i>{{ valuesOf(example).join(' · ') }}
                          <span v-for="entry in idsOf(example)" :key="entry.id" class="idchip"
                                :class="entry.origin === 'land' ? 'idchip-land' : ''"
                                :title="idTitle(entry)" :aria-label="idTitle(entry)">{{ entry.id }}</span>
                        </span>
                        <span v-else-if="example.errors.length" class="errval" :title="example.errors.map(meldung).join(' · ')">
                          <i aria-hidden="true">⚠</i>{{ meldung(example.errors[0]!) }}
                        </span>
                        <span v-else class="dim">{{ t('mapping.branch.noValue') }}</span>
                      </div>
                    </template>
                    <span v-else class="dim">–</span>
                  </td>

                  <td class="maprowbtns">
                    <div class="rowbtns">
                      <button type="button" class="iconbtn-menu" :aria-expanded="opened[column] ? 'true' : 'false'"
                              :aria-controls="`chain-${columns.indexOf(column)}`"
                              :aria-label="t('mapping.table.editChain', { column })"
                              :title="t('mapping.table.editChain', { column })" @click="toggleOpen(column)">
                        {{ opened[column] ? '▴' : '⚙' }}
                      </button>
                      <button type="button" class="iconbtn-menu"
                              :aria-pressed="stateOf(column) === 'ignored' ? 'true' : 'false'"
                              :aria-label="t('mapping.table.ignore', { column })"
                              :title="t('mapping.table.ignore', { column })" @click="toggleIgnore(column)">⊘</button>
                      <button v-if="stateOf(column) !== 'untouched'" type="button" class="iconbtn-menu"
                              :aria-label="t('mapping.table.reset', { column })"
                              :title="t('mapping.table.reset', { column })" @click="reset(column)">↺</button>
                    </div>
                  </td>
                </tr>

                <tr v-if="opened[column]" :key="`${column}-chain`" class="chainrow">
                  <td :id="`chain-${columns.indexOf(column)}`" :colspan="merged ? 4 : 5">
                    <MappingBranch :column="column" :spec="spec(column)" :columns="columns" :targets="targets"
                                   :transforms="payload.transforms" :examples="examplesOf(column)"
                                   :values="sourceValues(column)" :fill-label="fillLabel(column)"
                                   :index="columns.indexOf(column)"
                                   :authority-values="authorityValuesFor"
                                   :mapping-id="payload.profile?.id ?? null"
                                   :checks="checksOfColumn(column)"
                                   @change="refresh" @authority="openAuthority" @fix="applyFix"
                                   @clear-authority="clearAuthority(column, $event.value, $event.source)" />
                  </td>
                </tr>
              </template>

              <tr v-if="shownColumns.length === 0">
                <td :colspan="merged ? 4 : 5" class="dim small">{{ t('mapping.filter.none') }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <aside id="mapside" class="mapside" tabindex="-1" :aria-label="t('mapping.table.sideLabel')">
        <section class="ui-card">
          <h2 class="side-h">{{ t('mapping.tree.heading') }}</h2>
          <MappingResultTree :targets="targets" :target-use="preview?.targetUse ?? {}" />

          <details v-if="preview?.canonical" class="jsonbox">
            <summary>{{ t('mapping.tree.json') }}</summary>
            <pre class="mono" tabindex="0" role="region" :aria-label="t('mapping.tree.json')">{{ canonicalJson }}</pre>
          </details>

          <div style="margin-top:10px">
            <button type="button" class="btn btn-outline btn-sm" :disabled="schemaBusy" @click="runSchemaCheck">
              {{ schemaBusy ? t('mapping.schema.running') : t('mapping.schema.run') }}
            </button>
            <p v-if="schemaResult && schemaResult.unavailable" class="note">
              {{ t('mapping.schema.unavailable', { detail: schemaResult.unavailable }) }}
            </p>
            <template v-else-if="schemaResult">
              <p v-if="schemaResult.issues.length === 0" class="note">
                {{ t('mapping.schema.ok', { n: schemaResult.checked }) }}
              </p>
              <div v-else class="ui-alert" role="status" style="margin-top:8px">
                <strong>{{ t('mapping.schema.issues', { n: schemaResult.issues.length }) }}</strong>
                <ul class="tight">
                  <li v-for="(issue, i) in schemaResult.issues" :key="i">
                    {{ befund(issue) }}
                    <details v-if="issue.detail" class="issue-detail small">
                      <summary class="dim">{{ t('imports.issue.detail') }}</summary>
                      <span class="mono">{{ issue.detail }}</span>
                    </details>
                  </li>
                </ul>
              </div>
            </template>
          </div>

          <!--
            Bis zum 30.09.2026 stand hier eine Liste `preview.schema`. Sie wurde
            nie befuellt: Die Vorschau bekommt keinen `validateRecord`, geprueft
            wird ueber „Gegen das Schema pruefen" oben (#10).
          -->
        </section>

        <section class="ui-card">
          <h2 class="side-h">{{ t('mapping.defaults.heading') }}</h2>
          <p class="note">{{ t('mapping.defaults.hint') }}</p>
          <div v-for="(entry, i) in mapping.defaults" :key="i" class="defrow" style="flex-wrap:wrap">
            <MappingTargetSelect :model-value="entry.target" :targets="targets"
                                 :label="t('mapping.defaults.targetLabel', { n: i + 1 })"
                                 :input-id="`default-${i}-target`"
                                 @update:model-value="entry.target = $event; refresh()" />
            <label class="sr-only" :for="`default-${i}-value`">{{ t('mapping.defaults.valueLabel', { n: i + 1 }) }}</label>
            <input :id="`default-${i}-value`" v-model="entry.value" class="ui-input"
                   :placeholder="t('mapping.defaults.valueLabel', { n: i + 1 })" @change="refresh">
            <button type="button" class="iconbtn-del" :aria-label="t('mapping.defaults.remove', { n: i + 1 })"
                    @click="removeDefault(i)">✕</button>
          </div>
          <button type="button" class="btn btn-outline btn-sm"
                  :aria-label="t('mapping.defaults.addLabel')" @click="addDefault">
            <span aria-hidden="true">+</span> {{ t('mapping.defaults.add') }}
          </button>
        </section>

        <section class="ui-card">
          <h2 class="side-h">{{ t('mapping.grouping.heading') }}</h2>
          <p class="note">{{ t('mapping.grouping.hint') }}</p>
          <fieldset style="border:0;padding:0;margin:0">
            <legend class="sr-only">{{ t('mapping.grouping.heading') }}</legend>
            <label v-for="candidate in groupingCandidates" :key="candidate.key" class="checkline" style="display:flex">
              <input type="checkbox" :checked="groupingBy.includes(candidate.key)"
                     @change="toggleGrouping(candidate.key)"> {{ candidate.label }}
            </label>
          </fieldset>
          <p v-if="groupingBy.length" class="note">{{ t('mapping.grouping.active') }}</p>
        </section>
      </aside>
    </div>

    <MappingAuthorityDialog :request="authorityRequest" :candidates="authorityCandidates" :busy="authorityBusy"
                            :error="authorityError" @close="authorityRequest = null" @choose="chooseAuthority" />

    <!-- Die Rueckfrage nutzt denselben Dialog wie die Importliste: Fokusfalle,
         Escape und Fokusrueckgabe an die ausloesende Stelle sind dort geloest. -->
    <ImportsConfirmDialog :open="adoptTarget !== null" :title="t('mapping.adopt.title')"
                          :message="adoptTarget === null ? ''
                            : t('mapping.adopt.confirm', { institution: adoptTarget.institution_name })"
                          :ok-text="t('mapping.adopt.ok')"
                          @cancel="adoptTarget = null" @confirm="confirmAdopt" />
  </div>
</template>
