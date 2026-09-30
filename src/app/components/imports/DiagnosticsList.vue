<script setup lang="ts">
/**
 * Zeilengenaue Diagnose einer Datei, die sich nicht sauber lesen liess.
 *
 * Position, Ausschnitt mit markierter Stelle und ein Satz dazu, was zu tun
 * ist. Ohne den Ausschnitt bleibt „Zeile 4711 ist kaputt" eine Behauptung.
 */
import type { DiagnosticEntry } from './types'

defineProps<{ entries: DiagnosticEntry[] }>()
const { t } = useI18n()
// Satz und Hinweis aus dem Code, in der Sprache der Oberflaeche (#10).
const { diagnose } = useMeldungstext()

interface SnippetRow {
  key: string
  text: string
  mark: boolean
}

/**
 * Der Ausschnitt als fertige Zeilen. Die Pfeilzeile unter der Fehlerstelle
 * bekommt aria-hidden, weil sie vorgelesen nur Rauschen ist — die Spalte steht
 * ohnehin im Kopf der Meldung.
 */
function snippetRows(entry: DiagnosticEntry): SnippetRow[] {
  const snippet = entry.snippet
  if (snippet === null) return []
  const rows: SnippetRow[] = []
  for (const line of snippet.lines) {
    const isError = line.no === snippet.errorLine
    rows.push({
      key: `l${line.no}`,
      text: String(line.no).padStart(4, ' ') + ' │ ' + line.text.replace(/\t/g, ' '),
      mark: isError
    })
    if (isError && snippet.column !== null) {
      rows.push({
        key: `c${line.no}`,
        text: '     │ ' + ' '.repeat(Math.max(0, snippet.column - 1)) + '^',
        mark: false
      })
    }
  }
  return rows
}
</script>

<template>
  <div>
    <article v-for="(entry, index) in entries" :key="index" class="ui-card" style="margin-bottom:14px"
             :style="{ borderLeft: `4px solid var(--${entry.severity === 'error' ? 'danger' : 'warn'})` }">
      <div style="display:flex;align-items:baseline;gap:10px;flex-wrap:wrap">
        <span class="badge" :class="entry.severity === 'error' ? 'b-danger' : 'b-warn'">
          {{ t(`imports.issue.severity.${entry.severity}`) }}
        </span>
        <b style="font-size:15px">{{ diagnose(entry).text }}</b>
        <span v-if="entry.line !== null" class="dim small mono">
          <template v-if="entry.column !== null">
            {{ t('imports.detail.positionCol', { line: entry.line, column: entry.column }) }}
          </template>
          <template v-else>{{ t('imports.detail.position', { line: entry.line }) }}</template>
        </span>
      </div>

      <!-- Der Kasten rollt und enthaelt kein Bedienelement; ohne tabindex kaeme
           man mit der Tastatur nicht an den unteren Teil des Ausschnitts. -->
      <div v-if="entry.snippet" class="jsonprev" style="margin:10px 0 0" role="group" tabindex="0"
           :aria-label="t('imports.detail.snippet')">
        <span v-for="row in snippetRows(entry)" :key="row.key" style="display:block"
              :style="row.mark ? 'background:var(--danger-bg);color:var(--danger)' : undefined">{{ row.text }}</span>
      </div>

      <details v-if="entry.detail" class="issue-detail small" style="margin-top:8px">
        <summary class="dim">{{ t('imports.issue.detail') }}</summary>
        <span class="mono">{{ entry.detail }}</span>
      </details>

      <div v-if="entry.hint && entry.hint.trim() !== ''" class="val-list" style="margin-top:10px">
        <div class="vi">
          <span class="m badge b-ok" style="padding:1px 6px" aria-hidden="true">→</span>
          <span><b>{{ t('imports.detail.hint') }}:</b> {{ diagnose(entry).hint }}</span>
        </div>
      </div>
    </article>
  </div>
</template>
