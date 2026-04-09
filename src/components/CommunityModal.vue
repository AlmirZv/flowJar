<script setup>
import { onMounted, ref, watch } from 'vue'
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  getDoc,
  query,
  setDoc,
  Timestamp,
  where,
} from 'firebase/firestore'
import { formatHours } from '../composables/useTimeFormat'
import { db } from '../firebase/config'
import { useAuthStore } from '../stores/auth'

const props = defineProps({
  open: { type: Boolean, default: false },
})

const emit = defineEmits(['close'])
const authStore = useAuthStore()
const PROJECT_ACHIEVEMENT_HOURS = [1, 10, 100, 1000, 10000]
const TOTAL_ACHIEVEMENT_HOURS = [1, 10, 100, 10000, 100000, 1000000]

const rankingRange = ref('all')
const ranking = ref([])
const achievements = ref([])
const loadingRanking = ref(false)
const loadingAchievements = ref(false)
const loadingEncouragements = ref(false)
const activeTab = ref('rating')
const encouragements = ref([])
const encouragementText = ref('')
const encouragementError = ref('')
const nickname = ref('')
const nicknameLoading = ref(false)
const nicknameSaving = ref(false)
const nicknameError = ref('')
const myPointsEarned = ref(0)
const myPointsSpent = ref(0)
const myPointsBalance = ref(0)
const nextEncouragementCost = ref(1)

function getPeriodStart(range) {
  const now = new Date()
  if (range === 'today') return new Date(now.getFullYear(), now.getMonth(), now.getDate())
  if (range === 'week') {
    const day = now.getDay()
    const diff = day === 0 ? 6 : day - 1
    return new Date(now.getFullYear(), now.getMonth(), now.getDate() - diff)
  }
  if (range === 'month') return new Date(now.getFullYear(), now.getMonth(), 1)
  return null
}

function getUserLabel(userId, usersMap) {
  const user = usersMap.get(userId)
  if (!user) return 'Unknown user'
  return user.nickname || user.email || 'Unknown user'
}

function getWeekStart(date = new Date()) {
  const localDate = new Date(date)
  const day = localDate.getDay()
  const diff = day === 0 ? 6 : day - 1
  return new Date(localDate.getFullYear(), localDate.getMonth(), localDate.getDate() - diff)
}

async function getUsersMap() {
  const usersSnap = await getDocs(collection(db, 'users'))
  const usersMap = new Map()
  usersSnap.forEach((item) => {
    usersMap.set(item.id, item.data() || {})
  })
  return usersMap
}

async function loadMyNickname() {
  nicknameError.value = ''
  if (!authStore.user?.uid) {
    nickname.value = ''
    return
  }
  nicknameLoading.value = true
  try {
    const snap = await getDoc(doc(db, 'users', authStore.user.uid))
    const data = snap.data() || {}
    nickname.value = String(data.nickname || '').trim()
  } finally {
    nicknameLoading.value = false
  }
}

async function saveNickname() {
  nicknameError.value = ''
  const nextNickname = nickname.value.trim()
  if (nextNickname.length < 2) {
    nicknameError.value = 'Nickname should contain at least 2 characters.'
    return
  }
  if (nextNickname.length > 30) {
    nicknameError.value = 'Nickname is too long (max 30 chars).'
    return
  }
  if (!authStore.user?.uid) {
    nicknameError.value = 'Please sign in again.'
    return
  }
  nicknameSaving.value = true
  try {
    await authStore.updateNickname(nextNickname)
    await Promise.all([loadRanking(), loadAchievements(), loadEncouragements()])
  } catch (err) {
    nicknameError.value = err?.message || 'Failed to update nickname.'
  } finally {
    nicknameSaving.value = false
  }
}

async function loadRanking() {
  loadingRanking.value = true
  try {
    const startDate = getPeriodStart(rankingRange.value)
    let sessionsQuery = query(collection(db, 'sessions'))
    if (startDate) {
      sessionsQuery = query(collection(db, 'sessions'), where('startTime', '>=', Timestamp.fromDate(startDate)))
    }

    const [sessionsSnap, usersMap] = await Promise.all([getDocs(sessionsQuery), getUsersMap()])
    const totals = new Map()
    sessionsSnap.forEach((item) => {
      const data = item.data()
      const userId = data.userId
      if (!userId) return
      totals.set(userId, (totals.get(userId) || 0) + Number(data.duration || 0))
    })

    ranking.value = Array.from(totals.entries())
      .map(([userId, totalSeconds]) => ({
        userId,
        userLabel: getUserLabel(userId, usersMap),
        totalSeconds,
      }))
      .sort((a, b) => b.totalSeconds - a.totalSeconds)
  } finally {
    loadingRanking.value = false
  }
}

async function loadAchievements() {
  loadingAchievements.value = true
  try {
    const [sessionsSnap, projectsSnap, usersMap, firesSnap] = await Promise.all([
      getDocs(query(collection(db, 'sessions'))),
      getDocs(query(collection(db, 'projects'))),
      getUsersMap(),
      getDocs(query(collection(db, 'achievementFires'))),
    ])

    const projectsMap = new Map()
    projectsSnap.forEach((item) => {
      projectsMap.set(item.id, { id: item.id, ...item.data() })
    })

    const perProjectTotals = new Map()
    const userTotals = new Map()
    sessionsSnap.forEach((item) => {
      const data = item.data()
      if (!data.userId || !data.projectId) return
      const duration = Number(data.duration || 0)
      const projectKey = `${data.userId}::${data.projectId}`
      perProjectTotals.set(projectKey, (perProjectTotals.get(projectKey) || 0) + duration)
      userTotals.set(data.userId, (userTotals.get(data.userId) || 0) + duration)
    })

    const fireCounts = new Map()
    const myFires = new Set()
    firesSnap.forEach((item) => {
      const data = item.data()
      if (!data.achievementId) return
      fireCounts.set(data.achievementId, (fireCounts.get(data.achievementId) || 0) + 1)
      if (data.userId === authStore.user?.uid) myFires.add(data.achievementId)
    })

    const items = []
    perProjectTotals.forEach((totalSeconds, key) => {
      const [userId, projectId] = key.split('::')
      const project = projectsMap.get(projectId)
      const projectName = project?.name || 'Untitled Project'
      const userLabel = getUserLabel(userId, usersMap)

      PROJECT_ACHIEVEMENT_HOURS.forEach((hours) => {
        if (totalSeconds < hours * 3600) return
        const id = `project-hours:${userId}:${projectId}:${hours}`
        items.push({
          id,
          ownerUserId: userId,
          userLabel,
          textSuffix: `invested ${hours}h into project "${projectName}"`,
          totalSeconds,
          fireCount: fireCounts.get(id) || 0,
          hasFired: myFires.has(id),
        })
      })

      const customTargetSeconds = Number(project?.targetSeconds || 0)
      if (customTargetSeconds > 0 && totalSeconds >= customTargetSeconds) {
        const id = `project-target:${userId}:${projectId}:${customTargetSeconds}`
        items.push({
          id,
          ownerUserId: userId,
          userLabel,
          textSuffix: `reached the planned effort goal in project "${projectName}"`,
          totalSeconds,
          fireCount: fireCounts.get(id) || 0,
          hasFired: myFires.has(id),
        })
      }
    })

    userTotals.forEach((totalSeconds, userId) => {
      const userLabel = getUserLabel(userId, usersMap)
      TOTAL_ACHIEVEMENT_HOURS.forEach((hours) => {
        if (totalSeconds < hours * 3600) return
        const id = `total-hours:${userId}:${hours}`
        items.push({
          id,
          ownerUserId: userId,
          userLabel,
          textSuffix: `invested ${hours}h across all projects`,
          totalSeconds,
          fireCount: fireCounts.get(id) || 0,
          hasFired: myFires.has(id),
        })
      })
    })

    achievements.value = items.sort((a, b) => {
      if (b.fireCount !== a.fireCount) return b.fireCount - a.fireCount
      return b.totalSeconds - a.totalSeconds
    })

    const myUid = authStore.user?.uid
    myPointsEarned.value = myUid ? items.filter((item) => item.ownerUserId === myUid).length : 0
  } finally {
    loadingAchievements.value = false
  }
}

async function loadEncouragements() {
  loadingEncouragements.value = true
  try {
    const [messagesSnap, usersMap, firesSnap] = await Promise.all([
      getDocs(query(collection(db, 'encouragements'))),
      getUsersMap(),
      getDocs(query(collection(db, 'encouragementFires'))),
    ])

    const fireCounts = new Map()
    const myFires = new Set()
    firesSnap.forEach((item) => {
      const data = item.data()
      if (!data.messageId) return
      fireCounts.set(data.messageId, (fireCounts.get(data.messageId) || 0) + 1)
      if (data.userId === authStore.user?.uid) myFires.add(data.messageId)
    })

    const rows = messagesSnap.docs
      .map((item) => {
        const data = item.data() || {}
        return {
          id: item.id,
          authorId: data.authorId || '',
          authorLabel: getUserLabel(data.authorId, usersMap),
          text: String(data.text || ''),
          createdAtMs: data.createdAt?.toMillis?.() || 0,
          cost: Number(data.cost || 0),
          fireCount: fireCounts.get(item.id) || 0,
          hasFired: myFires.has(item.id),
        }
      })
      .sort((a, b) => b.createdAtMs - a.createdAtMs)

    encouragements.value = rows

    const myUid = authStore.user?.uid
    const myMessages = myUid ? rows.filter((row) => row.authorId === myUid) : []
    myPointsSpent.value = myMessages.reduce((sum, row) => sum + (row.cost || 0), 0)
    myPointsBalance.value = Math.max(0, myPointsEarned.value - myPointsSpent.value)

    const weekStartMs = getWeekStart().getTime()
    const sentThisWeek = myMessages.filter((row) => row.createdAtMs >= weekStartMs).length
    nextEncouragementCost.value = sentThisWeek + 1
  } finally {
    loadingEncouragements.value = false
  }
}

async function toggleFire(item) {
  const next = !item.hasFired
  if (!authStore.user?.uid) return
  const fireRef = doc(db, 'achievementFires', `${item.id}__${authStore.user.uid}`)
  if (next) {
    await setDoc(fireRef, {
      achievementId: item.id,
      userId: authStore.user.uid,
      createdAt: Timestamp.now(),
    })
  } else {
    await deleteDoc(fireRef).catch(() => {})
  }
  item.hasFired = next
  item.fireCount += next ? 1 : -1
}

async function toggleEncouragementFire(item) {
  const next = !item.hasFired
  if (!authStore.user?.uid) return
  const fireRef = doc(db, 'encouragementFires', `${item.id}__${authStore.user.uid}`)
  if (next) {
    await setDoc(fireRef, {
      messageId: item.id,
      userId: authStore.user.uid,
      createdAt: Timestamp.now(),
    })
  } else {
    await deleteDoc(fireRef).catch(() => {})
  }
  item.hasFired = next
  item.fireCount += next ? 1 : -1
}

async function sendEncouragement() {
  const text = encouragementText.value.trim()
  encouragementError.value = ''
  if (!authStore.user?.uid) {
    encouragementError.value = 'Please sign in again.'
    return
  }
  if (!text) {
    encouragementError.value = 'Write a message first.'
    return
  }
  if (text.length > 300) {
    encouragementError.value = 'Message is too long (max 300 chars).'
    return
  }
  if (myPointsBalance.value < nextEncouragementCost.value) {
    encouragementError.value = 'Not enough points for this encouragement.'
    return
  }

  await addDoc(collection(db, 'encouragements'), {
    authorId: authStore.user.uid,
    text,
    cost: nextEncouragementCost.value,
    createdAt: Timestamp.now(),
  })
  encouragementText.value = ''
  await loadEncouragements()
}

watch(
  () => props.open,
  async (isOpen) => {
    if (!isOpen) return
    await loadMyNickname()
    await Promise.all([loadRanking(), loadAchievements()])
    await loadEncouragements()
  },
)

watch(rankingRange, async () => {
  if (!props.open) return
  await loadRanking()
})

onMounted(async () => {
  if (!props.open) return
  await loadMyNickname()
  await Promise.all([loadRanking(), loadAchievements()])
  await loadEncouragements()
})
</script>

<template>
  <div v-if="open" class="community-modal-backdrop" @click.self="emit('close')">
    <section class="community-modal card">
      <header class="community-header">
        <div>
          <h3>Community</h3>
          <div class="community-profile">
            <form class="profile-row nickname-editor" @submit.prevent="saveNickname">
              <input
                v-model.trim="nickname"
                type="text"
                minlength="2"
                maxlength="30"
                placeholder="Nickname"
                :disabled="nicknameLoading || nicknameSaving"
              />
              <button
                class="btn btn-ghost profile-row-action"
                type="submit"
                :disabled="nicknameLoading || nicknameSaving || nickname.trim().length < 2"
              >
                {{ nicknameSaving ? 'Saving...' : 'Save' }}
              </button>
            </form>
          </div>
          <p v-if="nicknameError" class="error-text">{{ nicknameError }}</p>
        </div>
        <button class="btn btn-ghost community-header-close" type="button" @click="emit('close')">Close</button>
      </header>

      <div class="community-tabs">
        <button class="btn" :class="{ 'btn-primary': activeTab === 'rating' }" @click="activeTab = 'rating'">
          Rating
        </button>
        <button
          class="btn"
          :class="{ 'btn-primary': activeTab === 'achievements' }"
          @click="activeTab = 'achievements'"
        >
          Achievements
        </button>
        <button
          class="btn"
          :class="{ 'btn-primary': activeTab === 'encouragements' }"
          @click="activeTab = 'encouragements'"
        >
          Encouragement
        </button>
      </div>

      <template v-if="activeTab === 'rating'">
        <div class="community-filters">
          <button class="btn btn-ghost" :class="{ active: rankingRange === 'today' }" @click="rankingRange = 'today'">
            Today
          </button>
          <button class="btn btn-ghost" :class="{ active: rankingRange === 'week' }" @click="rankingRange = 'week'">
            Week
          </button>
          <button class="btn btn-ghost" :class="{ active: rankingRange === 'month' }" @click="rankingRange = 'month'">
            Month
          </button>
          <button class="btn btn-ghost" :class="{ active: rankingRange === 'all' }" @click="rankingRange = 'all'">
            All Time
          </button>
        </div>

        <p v-if="loadingRanking" class="muted">Loading rating...</p>
        <ul v-else class="community-list">
          <li v-for="(row, idx) in ranking" :key="row.userId" class="community-item">
            <span>#{{ idx + 1 }} {{ row.userLabel }}</span>
            <strong>{{ formatHours(row.totalSeconds) }} h</strong>
          </li>
          <li v-if="ranking.length === 0" class="muted">No activity for this period yet.</li>
        </ul>
      </template>

      <template v-else>
        <template v-if="activeTab === 'achievements'">
        <p v-if="loadingAchievements" class="muted">Loading achievements...</p>
        <ul v-else class="community-list achievements-list">
          <li v-for="item in achievements" :key="item.id" class="community-item achievement-item">
            <span><strong>{{ item.userLabel }}</strong> {{ item.textSuffix }}</span>
            <button class="btn fire-btn" :class="{ active: item.hasFired }" @click="toggleFire(item)">
              🔥 {{ item.fireCount }}
            </button>
          </li>
          <li v-if="achievements.length === 0" class="muted">No achievements yet.</li>
        </ul>
        </template>
        <template v-else>
          <p class="community-points"><strong>Points:</strong> {{ myPointsBalance }}</p>
          <section class="card encouragement-composer">
            <label>
              Message to community
              <textarea
                v-model="encouragementText"
                rows="3"
                maxlength="300"
                placeholder="Write support message for other users..."
              />
            </label>
            <button class="btn btn-primary" @click="sendEncouragement">
              Send ({{ nextEncouragementCost }})
            </button>
          </section>
          <p v-if="encouragementError" class="error-text">{{ encouragementError }}</p>

          <p v-if="loadingEncouragements" class="muted">Loading encouragements...</p>
          <ul v-else class="community-list achievements-list">
            <li v-for="item in encouragements" :key="item.id" class="community-item achievement-item">
              <div>
                <p><strong>{{ item.authorLabel }}</strong></p>
                <p>{{ item.text }}</p>
              </div>
              <button class="btn fire-btn" :class="{ active: item.hasFired }" @click="toggleEncouragementFire(item)">
                🔥 {{ item.fireCount }}
              </button>
            </li>
            <li v-if="encouragements.length === 0" class="muted">No encouragements yet.</li>
          </ul>
        </template>
      </template>
    </section>
  </div>
</template>
