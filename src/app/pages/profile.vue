<script setup lang="ts">
import { usersService } from '~/services/users'
/**
 * Das eigene Profil: Anzeigename und Passwort.
 *
 * Vier Fehlerlagen beim Passwortwechsel, vier eigene Saetze — falsches altes
 * Passwort, zu kurzes neues, abweichende Bestaetigung, unveraendertes Passwort.
 * Im PHP-Stand zeigte die Seite jedes ?error= als „Das hat nicht geklappt", und
 * ein Tester legte deshalb ein Profil neu an.
 */
import { apiFailure, failureText } from '~/components/records/errors'
import type { UserRow } from '#shared/types/domain'

const nutzerDienst = usersService()

const { t, te } = useI18n()
const { refresh: refreshAuth } = useAuth()
const { data, error, refresh } = await useEigenesProfil()

const loadError = computed(() => (error.value ? failureText(t, te, apiFailure(error.value), ['admin', 'imports']) : ''))
const user = computed(() => data.value?.user ?? null)
const minLength = computed(() => data.value?.minPasswordLength ?? 12)

useHead({ title: () => t('admin.profile.pageTitle') })

const name = ref('')
watch(data, (d) => {
  if (d != null) name.value = d.user.name
}, { immediate: true })

const savingName = ref(false)
const nameError = ref('')
const nameMessage = ref('')

async function saveName() {
  if (savingName.value) return
  savingName.value = true
  nameError.value = ''
  nameMessage.value = ''
  try {
    await nutzerDienst.profilAendern({ name: name.value })
    nameMessage.value = t('admin.profile.nameSaved')
    await refresh()
    await refreshAuth()
  } catch (e) {
    nameError.value = failureText(t, te, apiFailure(e), ['admin', 'imports'])
  } finally {
    savingName.value = false
  }
}

const current = ref('')
const next = ref('')
const confirm = ref('')
const changing = ref(false)
const passwordError = ref('')
const passwordMessage = ref('')

async function changePassword() {
  if (changing.value) return
  changing.value = true
  passwordError.value = ''
  passwordMessage.value = ''
  try {
    await nutzerDienst.eigenesPasswort({ current: current.value, next: next.value, confirm: confirm.value })
    passwordMessage.value = t('admin.profile.passwordChanged')
    current.value = ''
    next.value = ''
    confirm.value = ''
  } catch (e) {
    passwordError.value = failureText(t, te, apiFailure(e), ['admin', 'imports'])
  } finally {
    changing.value = false
  }
}
</script>

<template>
  <main id="main" class="appwrap" style="max-width:640px">
    <nav class="crumbs" :aria-label="t('admin.profile.crumb')">
      <NuxtLink to="/">{{ t('imports.heading') }}</NuxtLink>
      <span class="sep" aria-hidden="true">/</span>
      <span>{{ t('admin.profile.crumb') }}</span>
    </nav>

    <h1 style="font-size:19px;margin-bottom:14px">{{ t('admin.profile.heading') }}</h1>

    <div role="alert" aria-live="assertive" v-if="loadError !== ''" class="ui-alert">{{ loadError }}</div>

    <template v-else-if="user !== null">
      <section class="ui-card" style="margin-bottom:16px" aria-labelledby="name-heading">
        <h2 id="name-heading" style="font-size:15px;margin-bottom:14px">{{ t('admin.profile.nameHeading') }}</h2>
        <div class="live-region" role="status" aria-live="polite">
          <div v-if="nameMessage !== ''" class="ui-alert-ok" style="margin-bottom:12px">{{ nameMessage }}</div>
        </div>
        <div class="live-region" role="alert" aria-live="assertive">
          <div v-if="nameError !== ''" class="ui-alert" style="margin-bottom:12px">{{ nameError }}</div>
        </div>
        <form class="stackform" @submit.prevent="saveName">
          <div class="field" style="width:100%">
            <label for="pf-name">{{ t('admin.profile.name') }}</label>
            <input id="pf-name" v-model="name" class="ui-input" type="text" required autocomplete="name">
          </div>
          <div class="field" style="width:100%">
            <label for="pf-email">{{ t('admin.profile.email') }}</label>
            <input id="pf-email" class="ui-input" type="email" :value="user.email" disabled aria-describedby="pf-email-note">
            <span id="pf-email-note" class="note">{{ t('admin.profile.emailNote') }}</span>
          </div>
          <p class="note" style="margin:0">
            {{ t('admin.profile.institution') }}:
            <b>{{ user.institution_name ?? t('admin.profile.noInstitution') }}</b> ·
            {{ t('admin.profile.role') }}:
            <b>{{ user.is_admin ? t('admin.profile.admin') : t('admin.profile.user') }}</b> ·
            {{ t('admin.profile.lastLogin') }}:
            <b><ImportsTimeStamp :value="user.last_login_at" :fallback="t('admin.profile.never')" /></b>
          </p>
          <button class="btn btn-primary" type="submit" :disabled="savingName">
            {{ savingName ? t('admin.profile.savingName') : t('admin.profile.saveName') }}
          </button>
        </form>
      </section>

      <section class="ui-card" aria-labelledby="pw-heading">
        <h2 id="pw-heading" style="font-size:15px;margin-bottom:14px">{{ t('admin.profile.passwordHeading') }}</h2>
        <div class="live-region" role="status" aria-live="polite">
          <div v-if="passwordMessage !== ''" class="ui-alert-ok" style="margin-bottom:12px">
            {{ passwordMessage }}
          </div>
        </div>
        <div class="live-region" role="alert" aria-live="assertive">
          <div v-if="passwordError !== ''" class="ui-alert" style="margin-bottom:12px">{{ passwordError }}</div>
        </div>
        <form class="stackform" autocomplete="off" @submit.prevent="changePassword">
          <div class="field" style="width:100%">
            <label for="pf-cur">{{ t('admin.profile.current') }}</label>
            <input id="pf-cur" v-model="current" class="ui-input" type="password" required autocomplete="current-password">
          </div>
          <div class="field" style="width:100%">
            <label for="pf-new">{{ t('admin.profile.new') }}</label>
            <input id="pf-new" v-model="next" class="ui-input" type="password" :minlength="minLength" required
                   autocomplete="new-password" aria-describedby="pf-new-hint">
            <span id="pf-new-hint" class="note">{{ t('admin.profile.passwordHint', { min: minLength }) }}</span>
          </div>
          <div class="field" style="width:100%">
            <label for="pf-conf">{{ t('admin.profile.confirm') }}</label>
            <input id="pf-conf" v-model="confirm" class="ui-input" type="password" :minlength="minLength" required
                   autocomplete="new-password">
          </div>
          <button class="btn btn-primary" type="submit" :disabled="changing">
            {{ changing ? t('admin.profile.changingPassword') : t('admin.profile.changePassword') }}
          </button>
        </form>
      </section>
    </template>
  </main>
</template>
