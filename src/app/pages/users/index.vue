<script setup lang="ts">
import { usersService, type UserWithInstitution } from '~/services/users'
/**
 * Nutzerverwaltung.
 *
 * Vertraglich genuegt eine einfache Demo-Anmeldung ohne Benutzerverwaltung.
 * Diese Seite ist Zugabe und bleibt deshalb schmal: anlegen, sperren, loeschen,
 * bearbeiten. Passwoerter erscheinen nur als Einmalpasswort in einem Fenster,
 * das ausdruecklich sagt, dass es sie kein zweites Mal gibt.
 */
import { apiFailure, failureText } from '~/components/records/errors'
import type { InstitutionRow, UserRow } from '#shared/types/domain'

const nutzerDienst = usersService()

const { t, te } = useI18n()
const { data, error, refresh } = await useKontenListe()

const loadError = computed(() => (error.value ? failureText(t, te, apiFailure(error.value), ['admin', 'imports']) : ''))
const users = computed(() => data.value?.users ?? [])
const institutions = computed(() => data.value?.institutions ?? [])
const selfId = computed(() => data.value?.selfId ?? 0)
const minLength = computed(() => data.value?.minPasswordLength ?? 12)

useHead({ title: () => t('admin.users.pageTitle') })

/* ------------------------------------------------------------- Anlegen */

const form = reactive({ email: '', name: '', institutionId: '', isAdmin: false, ownPassword: false, password: '' })
const creating = ref(false)
const formError = ref('')
const message = ref('')
const otp = ref<{ email: string; password: string } | null>(null)

async function create() {
  if (creating.value) return
  creating.value = true
  formError.value = ''
  message.value = ''
  try {
    const res = await nutzerDienst.anlegen({
      email: form.email,
      name: form.name,
      institutionId: form.institutionId === '' ? null : Number(form.institutionId),
      isAdmin: form.isAdmin,
      ...(form.ownPassword ? { password: form.password } : {})
    })
    message.value = t('admin.users.create.done', { email: form.email })
    if (res.generated) otp.value = { email: form.email, password: res.oneTimePassword }
    form.email = ''
    form.name = ''
    form.password = ''
    form.isAdmin = false
    form.ownPassword = false
    await refresh()
  } catch (e) {
    formError.value = failureText(t, te, apiFailure(e), ['admin', 'imports'])
  } finally {
    creating.value = false
  }
}

/* ------------------------------------------------------ Sperren, Loeschen */

const rowError = ref('')
const busyId = ref(0)
const confirmDelete = ref<UserWithInstitution | null>(null)
const confirmLock = ref<UserWithInstitution | null>(null)

async function setActive(user: UserWithInstitution, active: boolean) {
  busyId.value = user.id
  rowError.value = ''
  message.value = ''
  try {
    await nutzerDienst.aendern(user.id, { active })
    message.value = active ? t('admin.users.done.unlocked') : t('admin.users.done.locked')
    confirmLock.value = null
    await refresh()
  } catch (e) {
    confirmLock.value = null
    rowError.value = failureText(t, te, apiFailure(e), ['admin', 'imports'])
  } finally {
    busyId.value = 0
  }
}

async function remove(user: UserWithInstitution) {
  busyId.value = user.id
  rowError.value = ''
  message.value = ''
  try {
    await nutzerDienst.loeschen(user.id)
    message.value = t('admin.users.done.deleted', { email: user.email })
    confirmDelete.value = null
    await refresh()
  } catch (e) {
    confirmDelete.value = null
    rowError.value = failureText(t, te, apiFailure(e), ['admin', 'imports'])
  } finally {
    busyId.value = 0
  }
}
</script>

<template>
  <main id="main" class="appwrap">
    <h1 style="font-size:19px;margin-bottom:6px">{{ t('admin.users.heading') }}</h1>
    <p class="note" style="margin-bottom:16px">{{ t('admin.users.lead') }}</p>

    <div role="alert" aria-live="assertive" v-if="loadError !== ''" class="ui-alert">{{ loadError }}</div>

    <template v-else>
      <div class="live-region" role="status" aria-live="polite">
        <div v-if="message !== ''" class="ui-alert-ok" style="margin-bottom:14px">{{ message }}</div>
      </div>
      <div class="live-region" role="alert" aria-live="assertive">
        <div v-if="rowError !== ''" class="ui-alert" style="margin-bottom:14px">{{ rowError }}</div>
      </div>

      <section class="ui-card" style="margin-bottom:18px" aria-labelledby="create-heading">
        <h2 id="create-heading" style="font-size:15px;margin-bottom:14px">{{ t('admin.users.create.heading') }}</h2>
        <div class="live-region" role="alert" aria-live="assertive">
          <div v-if="formError !== ''" class="ui-alert" style="margin-bottom:12px">{{ formError }}</div>
        </div>
        <form class="userform" @submit.prevent="create">
          <div class="field">
            <label for="nu-email">{{ t('admin.users.create.email') }}</label>
            <input id="nu-email" v-model="form.email" class="ui-input" type="email" required autocomplete="off">
          </div>
          <div class="field">
            <label for="nu-name">{{ t('admin.users.create.name') }}</label>
            <input id="nu-name" v-model="form.name" class="ui-input" type="text" required autocomplete="off">
          </div>
          <div class="field">
            <label for="nu-inst">{{ t('admin.users.create.institution') }}</label>
            <select id="nu-inst" v-model="form.institutionId" class="ui-input">
              <option value="">{{ t('admin.users.create.noInstitution') }}</option>
              <option v-for="inst in institutions" :key="inst.id" :value="String(inst.id)">{{ inst.name }}</option>
            </select>
          </div>
          <!--
            Die Ueberschrift der Gruppe ist bewusst kein label: Das Eingabefeld
            entsteht erst mit der Auswahl, ein label wuerde bis dahin ins Leere
            verweisen. Den Namen traegt die Gruppe, das Feld bekommt beim
            Erscheinen ein eigenes, nur vorgelesenes label.
          -->
          <div class="field" role="group" aria-labelledby="nu-pw-group">
            <span id="nu-pw-group" class="fieldhead">{{ t('admin.users.create.password') }}</span>
            <label class="checkline">
              <input v-model="form.ownPassword" type="checkbox">
              {{ form.ownPassword ? t('admin.users.detail.passwordOwn') : t('admin.users.create.passwordAuto') }}
            </label>
            <template v-if="form.ownPassword">
              <label class="sr-only" for="nu-pw">{{ t('admin.users.create.password') }}</label>
              <input id="nu-pw" v-model="form.password" class="ui-input" type="text"
                     :minlength="minLength" required autocomplete="new-password" aria-describedby="nu-pw-hint">
            </template>
            <span id="nu-pw-hint" class="note">{{ t('admin.users.create.passwordHint', { min: minLength }) }}</span>
          </div>
          <label class="checkline">
            <input v-model="form.isAdmin" type="checkbox"> {{ t('admin.users.create.isAdmin') }}
          </label>
          <button class="btn btn-primary" type="submit" :disabled="creating">
            {{ creating ? t('admin.users.create.submitting') : t('admin.users.create.submit') }}
          </button>
        </form>
      </section>

      <div class="tablewrap">
        <table>
          <caption class="sr-only">{{ t('admin.users.table.caption') }}</caption>
          <thead>
            <tr>
              <th scope="col">{{ t('admin.users.table.email') }}</th>
              <th scope="col">{{ t('admin.users.table.name') }}</th>
              <th scope="col">{{ t('admin.users.table.role') }}</th>
              <th scope="col">{{ t('admin.users.table.state') }}</th>
              <th scope="col">{{ t('admin.users.table.institution') }}</th>
              <th scope="col">{{ t('admin.users.table.lastLogin') }}</th>
              <th scope="col" style="text-align:right">{{ t('admin.users.table.action') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="u in users" :key="u.id" :style="u.active ? undefined : 'opacity:.6'">
              <!-- Der Text steht in einem eigenen Element: Steht eine Einfuegung
                   direkt neben einem v-if, setzen Serverdarstellung und Browser
                   Leerzeichen verschieden, und Vue baut die Seite beim Uebernehmen
                   still neu auf. -->
              <td class="fn">
                <span>{{ u.email }}</span>
                <span v-if="u.id === selfId" class="dim small"> {{ t('admin.users.table.self') }}</span>
              </td>
              <td>{{ u.name }}</td>
              <td>
                <span v-if="u.is_admin" class="badge b-info">{{ t('admin.users.table.admin') }}</span>
                <span v-else class="dim">{{ t('admin.users.table.user') }}</span>
              </td>
              <td>
                <span v-if="u.active" class="badge b-ok"><span class="bd"></span>{{ t('admin.users.table.active') }}</span>
                <span v-else class="badge b-danger"><span class="bd"></span>{{ t('admin.users.table.locked') }}</span>
              </td>
              <td class="dim small">{{ u.institution_name ?? t('admin.users.table.none') }}</td>
              <td class="dim small tnum">
                <ImportsTimeStamp :value="u.last_login_at" :fallback="t('admin.users.table.never')" />
              </td>
              <td style="text-align:right">
                <div class="rowactions">
                  <NuxtLink class="btn btn-outline btn-sm" :to="`/users/${u.id}`"
                            :aria-label="t('admin.users.table.editLabel', { email: u.email })">
                    {{ t('admin.users.table.edit') }}
                  </NuxtLink>
                  <template v-if="u.id !== selfId">
                    <button v-if="u.active" class="btn btn-outline btn-sm" type="button" :disabled="busyId === u.id"
                            :aria-label="t('admin.users.table.lockLabel', { email: u.email })"
                            @click="confirmLock = u">{{ t('admin.users.table.lock') }}</button>
                    <button v-else class="btn btn-outline btn-sm" type="button" :disabled="busyId === u.id"
                            :aria-label="t('admin.users.table.unlockLabel', { email: u.email })"
                            @click="setActive(u, true)">{{ t('admin.users.table.unlock') }}</button>
                    <button class="iconbtn-del" type="button" :disabled="busyId === u.id"
                            :aria-label="t('admin.users.table.deleteLabel', { email: u.email })"
                            @click="confirmDelete = u"><span aria-hidden="true">🗑</span></button>
                  </template>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <ImportsConfirmDialog :open="confirmDelete !== null" :title="t('admin.users.confirm.deleteTitle')"
                            :message="t('admin.users.confirm.deleteText', { email: confirmDelete?.email ?? '' })"
                            :ok-text="t('admin.users.confirm.deleteOk')" danger :busy="busyId !== 0"
                            @confirm="confirmDelete && remove(confirmDelete)" @cancel="confirmDelete = null" />

      <ImportsConfirmDialog :open="confirmLock !== null" :title="t('admin.users.confirm.lockTitle')"
                            :message="t('admin.users.confirm.lockText', { email: confirmLock?.email ?? '' })"
                            :ok-text="t('admin.users.confirm.lockOk')" :busy="busyId !== 0"
                            @confirm="confirmLock && setActive(confirmLock, false)" @cancel="confirmLock = null" />

      <AdminOneTimePassword v-if="otp !== null" :email="otp.email" :password="otp.password" @close="otp = null" />
    </template>
  </main>
</template>
