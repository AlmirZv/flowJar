<script setup>
import { reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'

const authStore = useAuthStore()
const router = useRouter()
const isRegister = ref(false)

const form = reactive({
  nickname: '',
  email: '',
  password: '',
})

async function submit() {
  try {
    if (isRegister.value) {
      await authStore.register(form.email, form.password, form.nickname)
    } else {
      await authStore.login(form.email, form.password)
    }
    router.push('/projects')
  } catch (err) {
    console.error(err)
  }
}
</script>

<template>
  <main class="auth-page">
    <div class="card auth-card">
      <h1>FlowJar</h1>
      <p class="muted">A jar of effort for your projects</p>

      <form class="form" @submit.prevent="submit">
        <label v-if="isRegister">
          Nickname
          <input v-model.trim="form.nickname" type="text" minlength="2" maxlength="30" required />
        </label>

        <label>
          Email
          <input v-model="form.email" type="email" required />
        </label>

        <label>
          Password
          <input v-model="form.password" type="password" minlength="6" required />
        </label>

        <button class="btn btn-primary" type="submit" :disabled="authStore.loading">
          {{ isRegister ? 'Create account' : 'Sign in' }}
        </button>
      </form>

      <p v-if="authStore.error" class="error-text">{{ authStore.error }}</p>
      <button class="btn btn-ghost" @click="isRegister = !isRegister">
        {{ isRegister ? 'I already have an account' : 'Create a new account' }}
      </button>
    </div>
  </main>
</template>
