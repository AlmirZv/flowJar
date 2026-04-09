<script setup>
import { useAuthStore } from './stores/auth'

const authStore = useAuthStore()
authStore.initAuthListener()
</script>

<template>
  <router-view />
</template>
