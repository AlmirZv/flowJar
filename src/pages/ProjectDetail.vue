<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import JarVisualization from '../components/JarVisualization.vue'
import StatsSheet from '../components/StatsSheet.vue'
import TimerButton from '../components/TimerButton.vue'
import { formatHours } from '../composables/useTimeFormat'
import { streamCssVarsFromHex } from '../utils/liquidColors'
import { useAuthStore } from '../stores/auth'
import { DEFAULT_PROJECT_TARGET_SECONDS, TEAM_LIQUID_PALETTE, useProjectsStore } from '../stores/projects'

const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()
const projectsStore = useProjectsStore()

const project = ref(null)
const showStats = ref(false)
const touchStartY = ref(0)
const stats = reactive({ todaySeconds: 0, totalSeconds: 0, byDays: [], teamSeries: null })
const localAddedSeconds = ref(0)
const nowMs = ref(Date.now())
let tickInterval
let unsubProject = null

const pourSound = new Audio('/water_pouring.mp3')
pourSound.preload = 'auto'

function playPourSound(playbackRate = 1) {
  pourSound.playbackRate = playbackRate
  pourSound.currentTime = 0
  pourSound.play().catch(() => {})
}

const projectId = computed(() => route.params.id)
const timerStartMs = computed(() => {
  const uid = authStore.user?.uid
  const syncedStart = uid ? project.value?.activeMembers?.[uid] : null
  if (syncedStart?.toMillis) return syncedStart.toMillis()
  return projectsStore.getTimerStart(projectId.value)
})
const isRunning = computed(() => !!timerStartMs.value)

const isTeamProject = computed(() => (project.value?.teamMemberIds?.length || 0) > 0)

function reconcileMemberTimes(p) {
  const map = { ...(p.timeByMember || {}) }
  const total = Number(p.totalTime || 0)
  const sumRest = Object.values(map).reduce((s, v) => s + Number(v || 0), 0)
  const orphan = Math.max(0, total - sumRest)
  if (orphan > 0) {
    const oid = p.userId
    map[oid] = Number(map[oid] || 0) + orphan
  }
  return map
}

const participantOrder = computed(() => {
  if (!project.value) return []
  const p = project.value
  return [p.userId, ...(p.teamMemberIds || [])]
})

function timestampToMs(value) {
  if (!value) return null
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value?.toMillis === 'function') return value.toMillis()
  const parsed = Date.parse(String(value))
  return Number.isFinite(parsed) ? parsed : null
}

const liveSecondsByMember = computed(() => {
  const now = nowMs.value
  const map = {}
  const active = project.value?.activeMembers || {}
  for (const [uid, startedAt] of Object.entries(active)) {
    const startMs = timestampToMs(startedAt)
    if (!startMs) continue
    map[uid] = Math.max(0, Math.floor((now - startMs) / 1000))
  }

  // Fallback for local start before activeMembers sync arrives.
  const uid = authStore.user?.uid
  const localStartMs = projectsStore.getTimerStart(projectId.value)
  if (uid && localStartMs && !map[uid]) {
    map[uid] = Math.max(0, Math.floor((now - localStartMs) / 1000))
  }

  return map
})

const anyRunning = computed(() => Object.keys(liveSecondsByMember.value).length > 0)

const memberSecondsMap = computed(() => {
  if (!project.value) return {}
  const p = project.value
  const base = reconcileMemberTimes(p)
  Object.entries(liveSecondsByMember.value).forEach(([uid, sec]) => {
    base[uid] = Number(base[uid] || 0) + Number(sec || 0)
  })
  const uid = authStore.user?.uid
  if (uid) {
    base[uid] = Number(base[uid] || 0) + localAddedSeconds.value
  }
  return base
})

const fillSegments = computed(() => {
  if (!project.value || !isTeamProject.value) return []
  return participantOrder.value.map((id, i) => ({
    userId: id,
    key: id,
    seconds: Number(memberSecondsMap.value[id] || 0),
    color: TEAM_LIQUID_PALETTE[i % TEAM_LIQUID_PALETTE.length],
  }))
})

const totalSeconds = computed(() => {
  const liveTotal = Object.values(liveSecondsByMember.value).reduce((s, v) => s + Number(v || 0), 0)
  const base = Number(project.value?.totalTime || 0) + localAddedSeconds.value + liveTotal
  return base
})

const targetSeconds = computed(() => {
  const value = Number(project.value?.targetSeconds)
  if (Number.isFinite(value) && value > 0) return Math.floor(value)
  return DEFAULT_PROJECT_TARGET_SECONDS
})
const targetHours = computed(() => Math.floor(targetSeconds.value / 3600))

const accentStream = computed(() => {
  if (!isTeamProject.value || fillSegments.value.length <= 1) return null
  const uid = authStore.user?.uid
  const seg = fillSegments.value.find((s) => s.userId === uid)
  const color = seg?.color || TEAM_LIQUID_PALETTE[0]
  return streamCssVarsFromHex(color)
})

const teamStatRows = computed(() => {
  if (!project.value || !isTeamProject.value) return []
  const labels = project.value.memberNicknames || {}
  const uid = authStore.user?.uid
  return participantOrder.value.map((id) => ({
    userId: id,
    label: id === uid ? 'You' : labels[id] || 'Member',
    seconds: Number(memberSecondsMap.value[id] || 0),
  }))
})

onMounted(async () => {
  window.addEventListener('touchstart', onTouchStart, { passive: true })
  window.addEventListener('touchend', onTouchEnd, { passive: true })
  unsubProject = projectsStore.subscribeProject(projectId.value, (data) => {
    project.value = data
    if (data === null) router.push('/projects')
    else void loadStats()
  })
})

onBeforeUnmount(() => {
  window.removeEventListener('touchstart', onTouchStart)
  window.removeEventListener('touchend', onTouchEnd)
  clearInterval(tickInterval)
  unsubProject?.()
  pourSound.pause()
})

watch(
  anyRunning,
  (running) => {
    clearInterval(tickInterval)
    if (running) {
      tickInterval = setInterval(() => {
        nowMs.value = Date.now()
      }, 1000)
    }
  },
  { immediate: true },
)

async function loadStats() {
  const teamIds =
    isTeamProject.value && participantOrder.value.length > 1 ? participantOrder.value : null
  const result = await projectsStore.getProjectStats(
    projectId.value,
    authStore.user?.uid,
    teamIds,
  )
  stats.todaySeconds = result.todaySeconds
  stats.totalSeconds = result.totalSeconds
  stats.byDays = result.byDays
  stats.teamSeries = result.teamSeries ?? null
}

function handleStart() {
  const uid = authStore.user?.uid
  if (!uid) return
  playPourSound(1)
  projectsStore.startTimer(projectId.value, uid)
}

async function handleStop() {
  playPourSound(2)
  const duration = await projectsStore.stopTimer(projectId.value, authStore.user?.uid)
  localAddedSeconds.value += duration
  await loadStats()
}

function onTouchStart(event) {
  touchStartY.value = event.changedTouches[0].clientY
}

function onTouchEnd(event) {
  const delta = touchStartY.value - event.changedTouches[0].clientY
  if (delta > 40) showStats.value = true
  if (delta < -40) showStats.value = false
}
</script>

<template>
  <main v-if="project" class="page project-detail-page">
    <header class="topbar project-detail-topbar">
      <button type="button" class="btn btn-ghost project-detail-back" @click="router.push('/projects')">
        Back
      </button>
      <h1 class="project-detail-title">{{ project.name }}</h1>
    </header>

    <p class="project-detail-meta muted">
      <span v-if="isTeamProject" class="project-detail-tag">Team · </span>
      <span class="project-detail-goal">{{ project.goal || 'No goal set' }}</span>
    </p>

    <p class="project-detail-total">{{ formatHours(totalSeconds) }} / {{ targetHours }} h</p>

    <div class="project-detail-jar">
      <JarVisualization
        compact
        :total-seconds="totalSeconds"
        :is-running="isRunning"
        :target-seconds="targetSeconds"
        :fill-segments="fillSegments"
        :accent-stream="accentStream"
      />
    </div>

    <div class="project-detail-footer">
      <TimerButton :is-running="isRunning" :start-time-ms="timerStartMs" @start="handleStart" @stop="handleStop" />
      <p class="swipe-stats-footer muted">Swipe up to see statistics</p>
    </div>

    <StatsSheet
      title="Project Statistics"
      fit-without-scroll
      :open="showStats"
      :today-seconds="stats.todaySeconds"
      :total-seconds="stats.totalSeconds"
      :by-days="stats.byDays"
      :team-rows="teamStatRows"
      :team-series="stats.teamSeries"
    />
  </main>
</template>
