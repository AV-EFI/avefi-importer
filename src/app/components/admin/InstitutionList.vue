<script setup lang="ts">
/**
 * Institutionen anlegen, umbenennen, leere loeschen (#43, 04.11.2026).
 *
 * Steht unter den Konten, haengt aber von nichts auf der Kontenseite ab: eigene
 * Abfrage, eigene Meldungen. Werden es viele Konten, zieht die Karte ohne Umbau
 * auf eine eigene Seite. Nach jeder Aenderung meldet sie `changed`, damit die
 * Seite ihre Kontenliste und die Auswahl im Kontoformular neu laedt.
 *
 * Loeschen bietet sie nur an, solange nichts an der Institution haengt; der
 * Server prueft das noch einmal unter Sperre.
 */
import { apiFailure, failureText } from '~/components/records/errors'
import { institutionenService } from '~/services/institutionen'
import type { InstitutionMitBelegung } from '#shared/types/domain'

const emit = defineEmits<{ changed: [] }>()

const dienst = institutionenService()
const { t, te } = useI18n()
const { data, error, refresh } = await useInstitutionenListe()

const liste = computed(() => data.value?.institutions ?? [])
const ladeFehler = computed(() => (error.value ? failureText(t, te, apiFailure(error.value), ['admin', 'imports']) : ''))

const meldung = ref('')
const fehler = ref('')
const beschaeftigt = ref(0)

function fehlertext(e: unknown): string {
  return failureText(t, te, apiFailure(e), ['admin', 'imports'])
}

/** Erst neu laden, dann melden: Sonst steht „angelegt“ da, bevor die Zeile da ist. */
async function danach(text: string): Promise<void> {
  await refresh()
  emit('changed')
  meldung.value = text
}

/* ------------------------------------------------------------- Anlegen */

const neuerName = ref('')
const legtAn = ref(false)

async function anlegen(): Promise<void> {
  if (legtAn.value) return
  legtAn.value = true
  meldung.value = ''
  fehler.value = ''
  const name = neuerName.value
  try {
    await dienst.anlegen(name)
    neuerName.value = ''
    await danach(t('admin.institutions.done.created', { name: name.replace(/\s+/g, ' ').trim() }))
  } catch (e) {
    fehler.value = fehlertext(e)
  } finally {
    legtAn.value = false
  }
}

/* ---------------------------------------------------------- Umbenennen */

const bearbeitet = ref<number | null>(null)
const bearbeiteterName = ref('')

async function umbenennenBeginnen(inst: InstitutionMitBelegung): Promise<void> {
  bearbeitet.value = inst.id
  bearbeiteterName.value = inst.name
  fehler.value = ''
  meldung.value = ''
  await nextTick()
  document.getElementById(`inst-name-${inst.id}`)?.focus()
}

async function umbenennenBeenden(id: number): Promise<void> {
  bearbeitet.value = null
  await nextTick()
  document.getElementById(`inst-rename-${id}`)?.focus()
}

async function umbenennen(inst: InstitutionMitBelegung): Promise<void> {
  beschaeftigt.value = inst.id
  fehler.value = ''
  meldung.value = ''
  try {
    await dienst.umbenennen(inst.id, bearbeiteterName.value)
    const neu = bearbeiteterName.value.replace(/\s+/g, ' ').trim()
    await danach(t('admin.institutions.done.renamed', { alt: inst.name, neu }))
    await umbenennenBeenden(inst.id)
  } catch (e) {
    fehler.value = fehlertext(e)
  } finally {
    beschaeftigt.value = 0
  }
}

/* ------------------------------------------------------------- Loeschen */

const zuLoeschen = ref<InstitutionMitBelegung | null>(null)

async function loeschen(inst: InstitutionMitBelegung): Promise<void> {
  beschaeftigt.value = inst.id
  fehler.value = ''
  meldung.value = ''
  try {
    const res = await dienst.loeschen(inst.id)
    zuLoeschen.value = null
    await danach(t('admin.institutions.done.deleted', { name: res.name }))
  } catch (e) {
    zuLoeschen.value = null
    fehler.value = fehlertext(e)
    await refresh()
  } finally {
    beschaeftigt.value = 0
  }
}
</script>

<template>
  <section class="ui-card inst" aria-labelledby="inst-heading">
    <h2 id="inst-heading" class="inst-head">{{ t('admin.institutions.heading') }}</h2>
    <p class="note inst-lead">{{ t('admin.institutions.lead') }}</p>

    <div v-if="ladeFehler !== ''" role="alert" class="ui-alert">{{ ladeFehler }}</div>

    <template v-else>
      <div class="live-region" role="status" aria-live="polite">
        <div v-if="meldung !== ''" class="ui-alert-ok inst-msg">{{ meldung }}</div>
      </div>
      <div class="live-region" role="alert" aria-live="assertive">
        <div v-if="fehler !== ''" class="ui-alert inst-msg">{{ fehler }}</div>
      </div>

      <form class="inst-form" @submit.prevent="anlegen">
        <div class="field">
          <label for="inst-new">{{ t('admin.institutions.create.name') }}</label>
          <input id="inst-new" v-model="neuerName" class="ui-input" type="text" required maxlength="200"
                 autocomplete="off">
        </div>
        <button class="btn btn-primary" type="submit" :disabled="legtAn">
          {{ legtAn ? t('admin.institutions.create.submitting') : t('admin.institutions.create.submit') }}
        </button>
      </form>

      <div class="tablewrap">
        <table>
          <caption class="sr-only">{{ t('admin.institutions.table.caption') }}</caption>
          <thead>
            <tr>
              <th scope="col">{{ t('admin.institutions.table.name') }}</th>
              <th scope="col" class="num">{{ t('admin.institutions.table.accounts') }}</th>
              <th scope="col" class="num">{{ t('admin.institutions.table.imports') }}</th>
              <th scope="col" class="num">{{ t('admin.institutions.table.profiles') }}</th>
              <th scope="col" class="act">{{ t('admin.institutions.table.action') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="inst in liste" :key="inst.id">
              <td>
                <form v-if="bearbeitet === inst.id" class="inst-rename" @submit.prevent="umbenennen(inst)"
                      @keydown.esc.prevent="umbenennenBeenden(inst.id)">
                  <label class="sr-only" :for="`inst-name-${inst.id}`">
                    {{ t('admin.institutions.rename.label', { name: inst.name }) }}
                  </label>
                  <input :id="`inst-name-${inst.id}`" v-model="bearbeiteterName" class="ui-input" type="text"
                         required maxlength="200" autocomplete="off">
                  <button class="btn btn-primary btn-sm" type="submit" :disabled="beschaeftigt === inst.id">
                    {{ t('admin.institutions.rename.save') }}
                  </button>
                  <button class="btn btn-outline btn-sm" type="button" @click="umbenennenBeenden(inst.id)">
                    {{ t('admin.institutions.rename.cancel') }}
                  </button>
                </form>
                <span v-else>{{ inst.name }}</span>
              </td>
              <td class="num tnum">{{ inst.belegung.konten }}</td>
              <td class="num tnum">{{ inst.belegung.importe }}</td>
              <td class="num tnum">{{ inst.belegung.profile }}</td>
              <td class="act">
                <div v-if="bearbeitet !== inst.id" class="rowactions">
                  <button :id="`inst-rename-${inst.id}`" class="btn btn-outline btn-sm" type="button"
                          :disabled="beschaeftigt === inst.id"
                          :aria-label="t('admin.institutions.table.renameLabel', { name: inst.name })"
                          @click="umbenennenBeginnen(inst)">{{ t('admin.institutions.table.rename') }}</button>
                  <button v-if="inst.leer" class="iconbtn-del" type="button" :disabled="beschaeftigt === inst.id"
                          :aria-label="t('admin.institutions.table.deleteLabel', { name: inst.name })"
                          @click="zuLoeschen = inst"><span aria-hidden="true">🗑</span></button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p class="note small inst-hint">{{ t('admin.institutions.deleteHint') }}</p>

      <ImportsConfirmDialog :open="zuLoeschen !== null" :title="t('admin.institutions.confirm.deleteTitle')"
                            :message="t('admin.institutions.confirm.deleteText', { name: zuLoeschen?.name ?? '' })"
                            :ok-text="t('admin.institutions.confirm.deleteOk')" danger :busy="beschaeftigt !== 0"
                            @confirm="zuLoeschen && loeschen(zuLoeschen)" @cancel="zuLoeschen = null" />
    </template>
  </section>
</template>

<style scoped>
.inst { margin-top: 18px; }
.inst-head { font-size: 15px; margin-bottom: 6px; }
.inst-lead { margin-bottom: 14px; }
.inst-msg { margin-bottom: 12px; }
.inst-form { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 10px; margin-bottom: 14px; }
.inst-form .field { flex: 1 1 260px; margin: 0; }
.inst-rename { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.inst-rename .ui-input { flex: 1 1 200px; min-width: 0; }
.inst-hint { margin-top: 8px; }
.num { text-align: right; }
.act { text-align: right; }
</style>
