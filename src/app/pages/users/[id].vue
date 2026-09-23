<script setup lang="ts">
import { usersService } from '~/services/users'
/**
 * Ein Nutzerkonto bearbeiten.
 *
 * Das eigene Konto kann sich weder entmachten noch sperren — die Felder sind
 * gesperrt und der Grund steht daneben. Der Server prueft es noch einmal.
 */
import { apiFailure, failureText } from '~/components/records/errors'
import type { InstitutionRow, UserRow } from '#shared/types/domain'

const nutzerDienst = usersService()

const route = useRoute()
const { t, te } = useI18n()
const zeit = useDateTime()
const id = computed(() => String(route.params.id ?? ''))

const { data, error, refresh } = await useKonto(id)

const loadError = computed(() => (error.value ? failureText(t, te, apiFailure(error.value), ['admin', 'imports']) : ''))
const user = computed(() => data.value?.user ?? null)
const isSelf = computed(() => data.value?.isSelf ?? false)
const minLength = computed(() => data.value?.minPasswordLength ?? 12)

useHead({ title: () => (user.value ? `${user.value.email} · ${t('admin.users.crumb')}` : t('admin.users.crumb')) })

const form = reactive({ name: '', institutionId: '', isAdmin: false, active: true })
watch(data, (d) => {
  if (d == null) return
  form.name = d.user.name
  form.institutionId = d.user.institution_id === null ? '' : String(d.user.institution_id)
  form.isAdmin = d.user.is_admin
  form.active = d.user.active
}, { immediate: true })

const saving = ref(false)
const saveError = ref('')
const message = ref('')

async function save() {
  if (saving.value) return
  saving.value = true
  saveError.value = ''
  message.value = ''
  try {
    await nutzerDienst.aendern(id.value, {
      name: form.name,
      institutionId: form.institutionId === '' ? null : Number(form.institutionId),
      isAdmin: form.isAdmin,
      active: form.active
    })
    message.value = t('admin.users.detail.saved')
    await refresh()
  } catch (e) {
    saveError.value = failureText(t, te, apiFailure(e), ['admin', 'imports'])
  } finally {
    saving.value = false
  }
}

/* ------------------------------------------------------------- Passwort */

const ownPassword = ref(false)
const password = ref('')
const resetting = ref(false)
const resetError = ref('')
const confirmReset = ref(false)
const otp = ref<{ email: string; password: string } | null>(null)

async function reset() {
  if (resetting.value || user.value === null) return
  resetting.value = true
  resetError.value = ''
  message.value = ''
  try {
    const res = await nutzerDienst.passwortSetzen(
      id.value, ownPassword.value ? { password: password.value } : {})
    confirmReset.value = false
    password.value = ''
    if (res.generated) otp.value = { email: user.value.email, password: res.oneTimePassword }
    else message.value = t('admin.users.detail.saved')
  } catch (e) {
    confirmReset.value = false
    resetError.value = failureText(t, te, apiFailure(e), ['admin', 'imports'])
  } finally {
    resetting.value = false
  }
}
</script>

<template>
  <main id="main" class="appwrap" style="max-width:640px">
    <nav class="crumbs" :aria-label="t('admin.users.crumb')">
      <NuxtLink to="/users">{{ t('admin.users.crumb') }}</NuxtLink>
      <span class="sep" aria-hidden="true">/</span>
      <span>{{ user?.email ?? id }}</span>
    </nav>

    <div role="alert" aria-live="assertive" v-if="loadError !== ''" class="ui-alert">{{ loadError }}</div>

    <template v-else-if="user !== null">
      <h1 style="font-size:19px;margin-bottom:14px">{{ t('admin.users.detail.heading') }}</h1>

      <div class="live-region" role="status" aria-live="polite">
        <div v-if="message !== ''" class="ui-alert-ok" style="margin-bottom:16px">{{ message }}</div>
      </div>

      <section class="ui-card" style="margin-bottom:16px" aria-labelledby="basics-heading">
        <h2 id="basics-heading" style="font-size:15px;margin-bottom:14px">{{ t('admin.users.detail.basics') }}</h2>
        <div class="live-region" role="alert" aria-live="assertive">
          <div v-if="saveError !== ''" class="ui-alert" style="margin-bottom:12px">{{ saveError }}</div>
        </div>
        <form class="stackform" @submit.prevent="save">
          <div class="field" style="width:100%">
            <label for="u-email">{{ t('admin.users.detail.email') }}</label>
            <input id="u-email" class="ui-input" type="email" :value="user.email" disabled
                   aria-describedby="u-email-note">
            <span id="u-email-note" class="note">{{ t('admin.users.detail.emailNote') }}</span>
          </div>
          <div class="field" style="width:100%">
            <label for="u-name">{{ t('admin.users.detail.name') }}</label>
            <input id="u-name" v-model="form.name" class="ui-input" type="text" required>
          </div>
          <div class="field" style="width:100%">
            <label for="u-inst">{{ t('admin.users.detail.institution') }}</label>
            <select id="u-inst" v-model="form.institutionId" class="ui-input">
              <option value="">{{ t('admin.users.detail.noInstitution') }}</option>
              <option v-for="inst in (data?.institutions ?? [])" :key="inst.id" :value="String(inst.id)">
                {{ inst.name }}
              </option>
            </select>
          </div>
          <label class="checkline">
            <input v-model="form.isAdmin" type="checkbox" :disabled="isSelf"> {{ t('admin.users.detail.isAdmin') }}
          </label>
          <label class="checkline">
            <input v-model="form.active" type="checkbox" :disabled="isSelf"> {{ t('admin.users.detail.active') }}
          </label>
          <p v-if="isSelf" class="note" style="margin:0">{{ t('admin.users.detail.selfNote') }}</p>
          <p class="note" style="margin:0">
            {{ t('admin.users.detail.created', { when: zeit(user.created_at) }) }} ·
            {{ user.last_login_at
              ? t('admin.users.detail.lastLogin', { when: zeit(user.last_login_at) })
              : t('admin.users.table.never') }}
          </p>
          <button class="btn btn-primary" type="submit" :disabled="saving">
            {{ saving ? t('admin.users.detail.saving') : t('admin.users.detail.save') }}
          </button>
        </form>
      </section>

      <section class="ui-card" aria-labelledby="password-heading">
        <h2 id="password-heading" style="font-size:15px;margin-bottom:14px">
          {{ t('admin.users.detail.passwordHeading') }}
        </h2>
        <p class="note" style="margin-top:0">{{ t('admin.users.detail.passwordText') }}</p>
        <div class="live-region" role="alert" aria-live="assertive">
          <div v-if="resetError !== ''" class="ui-alert" style="margin-bottom:12px">{{ resetError }}</div>
        </div>
        <form class="stackform" autocomplete="off" @submit.prevent="confirmReset = true">
          <label class="checkline">
            <input v-model="ownPassword" type="checkbox"> {{ t('admin.users.detail.passwordOwn') }}
          </label>
          <div v-if="ownPassword" class="field" style="width:100%">
            <label for="u-pw">{{ t('admin.users.detail.password') }}</label>
            <input id="u-pw" v-model="password" class="ui-input" type="text" :minlength="minLength" required
                   autocomplete="new-password" aria-describedby="u-pw-hint">
            <span id="u-pw-hint" class="note">{{ t('admin.users.detail.passwordHint', { min: minLength }) }}</span>
          </div>
          <button class="btn btn-primary" type="submit" :disabled="resetting">
            {{ resetting ? t('admin.users.detail.resetting') : t('admin.users.detail.reset') }}
          </button>
        </form>
      </section>

      <ImportsConfirmDialog :open="confirmReset" :title="t('admin.users.confirm.resetTitle')"
                            :message="t('admin.users.confirm.resetText', { email: user.email })"
                            :ok-text="t('admin.users.confirm.resetOk')" danger :busy="resetting"
                            @confirm="reset" @cancel="confirmReset = false" />

      <AdminOneTimePassword v-if="otp !== null" :email="otp.email" :password="otp.password" @close="otp = null" />
    </template>
  </main>
</template>
