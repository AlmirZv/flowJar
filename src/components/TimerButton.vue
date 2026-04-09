<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { toClock } from '../composables/useTimeFormat'

const props = defineProps({
  isRunning: { type: Boolean, required: true },
  startTimeMs: { type: Number, default: null },
})

const emit = defineEmits(['start', 'stop'])

const now = ref(Date.now())
let intervalId

const elapsedSeconds = computed(() => {
  if (!props.isRunning || !props.startTimeMs) return 0
  return Math.floor((now.value - props.startTimeMs) / 1000)
})

const formatted = computed(() => toClock(elapsedSeconds.value))

function startInterval() {
  clearInterval(intervalId)
  intervalId = setInterval(() => {
    now.value = Date.now()
  }, 1000)
}

onMounted(() => {
  if (props.isRunning) startInterval()
})

onBeforeUnmount(() => clearInterval(intervalId))

function handleClick() {
  if (props.isRunning) {
    clearInterval(intervalId)
    emit('stop')
  } else {
    now.value = Date.now()
    startInterval()
    emit('start')
  }
}
</script>

<template>
  <div class="timer-box">
    <p class="timer-value">{{ formatted }}</p>
    <button class="btn btn-primary" @click="handleClick">
      {{ isRunning ? 'Stop' : 'Start' }}
    </button>
  </div>
</template>
