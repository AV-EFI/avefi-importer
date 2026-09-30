<script setup lang="ts">
/**
 * Beanstandungen an einem Ort: blockierendes und Hinweise.
 *
 * Vorher standen die einen ueber der Tabelle und die anderen darunter — man
 * uebersah die Haelfte. Blockiert wird nur strukturell Unmoegliches; alles
 * andere ist ein Hinweis und verhindert das Speichern nicht.
 *
 * Zu manchen Beanstandungen gibt es einen Vorschlag. Er wird ANGEBOTEN, nie von
 * selbst angewendet: Automatische Korrektur von Validierungsfehlern ist
 * vertraglich ausgeschlossen.
 */
import type { EditorTarget, MappingCheck } from './types'

const props = defineProps<{ checks: MappingCheck[]; targets: EditorTarget[] }>()
const emit = defineEmits<{ goto: [column: string]; fix: [check: MappingCheck]; dismiss: [check: MappingCheck] }>()
const { t, te } = useI18n()

const blockers = computed(() => props.checks.filter((c) => c.severity === 'error'))
const warnings = computed(() => props.checks.filter((c) => c.severity !== 'error'))
const ordered = computed(() => [...blockers.value, ...warnings.value])

const byKey = computed(() => new Map(props.targets.map((x) => [x.key, x])))

function targetLabel(key: string): string {
  const target = byKey.value.get(key)
  if (target === undefined) return key
  const i18nKey = `mapping.targets.${key}`
  return te(i18nKey) ? t(i18nKey) : target.label
}

/**
 * Eigener Satz zum Code, sonst der Text des Servers. Gebaut wird er in
 * useMeldungstext, dieselbe Stelle wie fuer die Zweigansicht und den
 * Pruefbericht.
 */
const { pruefung } = useMeldungstext()
function message(check: MappingCheck): string {
  return pruefung(check, targetLabel)
}

/**
 * Ablehnbar ist ein Vorschlag, kein Befund.
 *
 * Ein Blocker verschwindet nicht dadurch, dass jemand ihn nicht sehen will.
 * Ein Hinweis mit Vorschlag dagegen stellt eine Frage, und "nein" ist eine
 * gueltige Antwort darauf.
 */
function ablehnbar(check: MappingCheck): boolean {
  return check.severity !== 'error' && check.sourceField !== undefined
    && (check.fix !== undefined || (Array.isArray(check.fixPlan) && check.fixPlan.length > 0))
}

function fixLabel(check: MappingCheck): string {
  // Ein mehrteiliger Vorschlag bringt seine eigene Beschriftung mit: Aus dem
  // Operationsnamen liesse sich fuer "zwei Zweige anlegen" keine bilden.
  if (typeof check.fixLabel === 'string' && check.fixLabel !== '') {
    return te(check.fixLabel) ? t(check.fixLabel) : check.fixLabel
  }
  const op = String(check.fix?.op ?? '')
  const key = `mapping.op.${op}`
  return t('mapping.check.applyFix', { op: te(key) ? t(key) : op })
}
</script>

<template>
  <div v-if="ordered.length" class="checkbar">
    <div class="checkbar-h">
      <h2 class="side-h" style="margin:0;flex:1">{{ t('mapping.check.heading') }}</h2>
      <span v-if="blockers.length" class="badge b-danger">
        <span class="bd" />{{ t('mapping.check.blocking', { n: blockers.length }) }}
      </span>
      <span v-if="warnings.length" class="badge b-wait">
        <span class="bd" />{{ t('mapping.check.hints', { n: warnings.length }, warnings.length) }}
      </span>
    </div>
    <ul class="checklist">
      <li v-for="(check, i) in ordered" :key="i" :class="check.severity === 'error' ? 'chk-nogo' : 'chk-warn'">
        <i aria-hidden="true">{{ check.severity === 'error' ? '⛔' : '⚠' }}</i>
        <span class="sr-only">{{ check.severity === 'error' ? t('mapping.check.srBlocking') : t('mapping.check.srHint') }}</span>
        <button v-if="check.sourceField" type="button" class="linkbtn chk-col"
                :title="t('mapping.check.goto', { column: check.sourceField })"
                @click="emit('goto', check.sourceField)">{{ check.sourceField }}</button>
        <span class="chk-msg">{{ message(check) }}</span>
        <button v-if="check.fix || check.fixPlan" type="button" class="btn btn-outline btn-sm" @click="emit('fix', check)">
          {{ fixLabel(check) }}
        </button>
        <button v-if="ablehnbar(check)" type="button" class="linkbtn chk-dismiss"
                :title="t('mapping.check.dismissTitle', { column: check.sourceField })"
                @click="emit('dismiss', check)">
          {{ t('mapping.check.dismiss') }}
        </button>
      </li>
    </ul>
    <p class="note">{{ t('mapping.check.policy') }}</p>
  </div>
</template>
