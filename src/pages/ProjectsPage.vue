<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { doc, getDoc } from 'firebase/firestore'
import { useRouter } from 'vue-router'
import StatsSheet from '../components/StatsSheet.vue'
import CommunityModal from '../components/CommunityModal.vue'
import { useAuthStore } from '../stores/auth'
import {
  DEFAULT_PROJECT_TARGET_HOURS,
  resolveUserIdFromNickname,
  useProjectsStore,
} from '../stores/projects'
import { formatHours } from '../composables/useTimeFormat'
import { db } from '../firebase/config'

const authStore = useAuthStore()
const projectsStore = useProjectsStore()
const router = useRouter()

const showCreate = ref(false)
const showStats = ref(false)
const showCommunity = ref(false)
const touchStartY = ref(0)
const stats = reactive({ todaySeconds: 0, totalSeconds: 0, byDays: [] })
const uiError = ref('')
const editingProjectId = ref('')
const ownerProfileNickname = ref('')
const teamNickInput = ref('')
const teamMembersDraft = ref([])
const teamInviteError = ref('')

const form = reactive({
  name: '',
  description: '',
  goal: '',
  targetHours: DEFAULT_PROJECT_TARGET_HOURS,
})

const editForm = reactive({
  name: '',
  description: '',
  goal: '',
  targetHours: DEFAULT_PROJECT_TARGET_HOURS,
})

const editTeamMembers = ref([])
const editTeamNickInput = ref('')
const editTeamInviteError = ref('')

function isProjectOwner(project) {
  return project?.userId === authStore.user?.uid
}

function isTeamMember(project) {
  return (project?.teamMemberIds || []).includes(authStore.user?.uid)
}

onMounted(async () => {
  window.addEventListener('touchstart', onTouchStart, { passive: true })
  window.addEventListener('touchend', onTouchEnd, { passive: true })
  projectsStore.subscribeProjects(authStore.user?.uid)
  const uid = authStore.user?.uid
  if (uid) {
    const us = await getDoc(doc(db, 'users', uid))
    ownerProfileNickname.value = String(us.data()?.nickname || '').trim() || 'You'
  }
  await loadStats()
})

onBeforeUnmount(() => {
  window.removeEventListener('touchstart', onTouchStart)
  window.removeEventListener('touchend', onTouchEnd)
})

async function createProject() {
  if (!form.name.trim()) return
  const saved = await projectsStore.createProject(
    {
      ...form,
      teamMembers: teamMembersDraft.value,
      ownerNickname: ownerProfileNickname.value || 'You',
    },
    authStore.user?.uid,
  )
  if (!saved) {
    uiError.value = projectsStore.error || 'Failed to save project in Firestore'
    return
  }
  uiError.value = ''
  form.name = ''
  form.description = ''
  form.goal = ''
  form.targetHours = DEFAULT_PROJECT_TARGET_HOURS
  teamMembersDraft.value = []
  teamNickInput.value = ''
  teamInviteError.value = ''
  showCreate.value = false
  await loadStats()
}

async function addTeamMember() {
  const nick = teamNickInput.value.trim()
  if (!nick) return
  teamInviteError.value = ''
  const uid = await resolveUserIdFromNickname(nick)
  if (!uid) {
    teamInviteError.value = 'User not found. They must sign in at least once after this update.'
    return
  }
  if (uid === authStore.user?.uid) {
    teamInviteError.value = 'You are already the project owner.'
    return
  }
  if (teamMembersDraft.value.some((m) => m.userId === uid)) {
    teamInviteError.value = 'This user is already in the list.'
    return
  }
  teamMembersDraft.value = [...teamMembersDraft.value, { userId: uid, nickname: nick }]
  teamNickInput.value = ''
}

function removeTeamMember(userId) {
  teamMembersDraft.value = teamMembersDraft.value.filter((m) => m.userId !== userId)
}

async function addEditTeamMember() {
  const nick = editTeamNickInput.value.trim()
  if (!nick) return
  editTeamInviteError.value = ''
  const uid = await resolveUserIdFromNickname(nick)
  if (!uid) {
    editTeamInviteError.value = 'User not found. They must sign in at least once after this update.'
    return
  }
  const ownerId = authStore.user?.uid
  if (uid === ownerId) {
    editTeamInviteError.value = 'Owner is already on the project.'
    return
  }
  if (editTeamMembers.value.some((m) => m.userId === uid)) {
    editTeamInviteError.value = 'This user is already in the list.'
    return
  }
  editTeamMembers.value = [...editTeamMembers.value, { userId: uid, nickname: nick }]
  editTeamNickInput.value = ''
}

function removeEditTeamMember(userId) {
  editTeamMembers.value = editTeamMembers.value.filter((m) => m.userId !== userId)
}

function startEditProject(project, event) {
  event?.stopPropagation()
  if (!isProjectOwner(project)) return
  editingProjectId.value = project.id
  editForm.name = project.name || ''
  editForm.description = project.description || ''
  editForm.goal = project.goal || ''
  editForm.targetHours = Math.max(
    1,
    Math.floor(Number(project.targetSeconds || 0) / 3600) || DEFAULT_PROJECT_TARGET_HOURS,
  )
  const ids = project.teamMemberIds || []
  const nick = project.memberNicknames || {}
  editTeamMembers.value = ids.map((uid) => ({
    userId: uid,
    nickname: String(nick[uid] || '').trim() || uid.slice(0, 8),
  }))
  editTeamNickInput.value = ''
  editTeamInviteError.value = ''
}

function cancelEditProject(event) {
  event?.stopPropagation()
  editingProjectId.value = ''
  editTeamMembers.value = []
  editTeamNickInput.value = ''
  editTeamInviteError.value = ''
}

async function saveProject(projectId, event) {
  event?.stopPropagation()
  if (!editForm.name.trim()) return

  const saved = await projectsStore.updateProject(projectId, {
    ...editForm,
    teamMembers: editTeamMembers.value,
  })
  if (!saved) {
    uiError.value = projectsStore.error || 'Failed to update project'
    return
  }

  uiError.value = ''
  editingProjectId.value = ''
  editTeamMembers.value = []
  editTeamNickInput.value = ''
  editTeamInviteError.value = ''
  await loadStats()
}

async function leaveTeamProject(project, event) {
  event?.stopPropagation()
  const confirmed = window.confirm('Leave this project? You will lose access until the owner adds you again.')
  if (!confirmed) return
  const ok = await projectsStore.leaveProject(project.id, authStore.user?.uid)
  if (!ok) {
    uiError.value = projectsStore.error || 'Failed to leave project'
    return
  }
  uiError.value = ''
}

async function removeProject(projectId, event) {
  event?.stopPropagation()
  const confirmed = window.confirm('Delete this project? This will also delete project sessions.')
  if (!confirmed) return

  const deleted = await projectsStore.deleteProject(projectId, authStore.user?.uid)
  if (!deleted) {
    uiError.value = projectsStore.error || 'Failed to delete project'
    return
  }

  uiError.value = ''
  if (editingProjectId.value === projectId) editingProjectId.value = ''
  await loadStats()
}

function openProject(projectId) {
  // Do not navigate while this card is in edit mode.
  if (editingProjectId.value === projectId) return
  router.push(`/projects/${projectId}`)
}

async function loadStats() {
  const result = await projectsStore.getAllStats(authStore.user?.uid)
  stats.todaySeconds = result.todaySeconds
  stats.totalSeconds = result.totalSeconds
  stats.byDays = result.byDays
}

async function logout() {
  await authStore.logout()
  router.push('/login')
}

function onTouchStart(event) {
  touchStartY.value = event.changedTouches[0].clientY
}

function onTouchEnd(event) {
  const delta = touchStartY.value - event.changedTouches[0].clientY
  if (delta > 40) showStats.value = true
  if (delta < -40) showStats.value = false
}

const overallHours = computed(() => formatHours(projectsStore.overallTotalTime))

watch(
  () => projectsStore.projects.map((p) => `${p.id}:${p.totalTime || 0}`).join('|'),
  async () => {
    await loadStats()
  },
)
</script>

<template>
  <main class="page projects-page">
    <header class="topbar">
      <h1>Projects</h1>
      <div class="topbar-actions">
        <button class="btn btn-primary" @click="showCreate = !showCreate">+ Project</button>
        <button class="btn btn-ghost" @click="logout">Logout</button>
      </div>
    </header>

    <p class="muted">Total invested: {{ overallHours }} hours</p>
    <p v-if="uiError || projectsStore.error" class="error-text">
      {{ uiError || projectsStore.error }}
    </p>

    <section v-if="showCreate" class="card">
      <h3>New Project</h3>
      <div class="form">
        <label>Title <input v-model="form.name" type="text" placeholder="For example, FlowJar" /></label>
        <label>Description <textarea v-model="form.description" rows="2" /></label>
        <label>Goal <textarea v-model="form.goal" rows="2" /></label>
        <label>
          Time for project (hours)
          <input v-model.number="form.targetHours" type="number" min="1" step="1" />
        </label>
        <div class="team-invite-block">
          <h4>Team (optional)</h4>
          <p class="muted" style="font-size: 13px; margin-bottom: 8px">
            Add teammates by nickname. They will see this project and their time will fill the jar.
          </p>
          <div class="team-invite-row">
            <input v-model.trim="teamNickInput" type="text" placeholder="Nickname" maxlength="30" />
            <button type="button" class="btn btn-primary" @click="addTeamMember">+</button>
          </div>
          <p v-if="teamInviteError" class="team-invite-error">{{ teamInviteError }}</p>
          <ul v-if="teamMembersDraft.length" class="team-picked-list">
            <li v-for="m in teamMembersDraft" :key="m.userId" class="team-picked-row">
              <span>{{ m.nickname }}</span>
              <button type="button" class="btn btn-ghost btn-minus" aria-label="Remove" @click="removeTeamMember(m.userId)">
                −
              </button>
            </li>
          </ul>
        </div>
      </div>
      <button class="btn btn-primary" @click="createProject">Save</button>
    </section>

    <section class="projects-list">
      <article
        v-for="project in projectsStore.projects"
        :key="project.id"
        class="card project-card"
        @click="openProject(project.id)"
      >
        <template v-if="editingProjectId === project.id && isProjectOwner(project)">
          <h3>Edit Project</h3>
          <div class="form">
            <label>Title <input v-model="editForm.name" type="text" placeholder="For example, FlowJar" /></label>
            <label>Description <textarea v-model="editForm.description" rows="2" /></label>
            <label>Goal <textarea v-model="editForm.goal" rows="2" /></label>
            <label>
              Time for project (hours)
              <input v-model.number="editForm.targetHours" type="number" min="1" step="1" />
            </label>
            <div class="team-invite-block">
              <h4>Team</h4>
              <p class="muted" style="font-size: 13px; margin-bottom: 8px">
                Add or remove teammates by nickname.
              </p>
              <div class="team-invite-row">
                <input v-model.trim="editTeamNickInput" type="text" placeholder="Nickname" maxlength="30" />
                <button type="button" class="btn btn-primary" @click="addEditTeamMember">+</button>
              </div>
              <p v-if="editTeamInviteError" class="team-invite-error">{{ editTeamInviteError }}</p>
              <ul v-if="editTeamMembers.length" class="team-picked-list">
                <li v-for="m in editTeamMembers" :key="m.userId" class="team-picked-row">
                  <span>{{ m.nickname }}</span>
                  <button
                    type="button"
                    class="btn btn-ghost btn-minus"
                    aria-label="Remove from team"
                    @click="removeEditTeamMember(m.userId)"
                  >
                    −
                  </button>
                </li>
              </ul>
              <p v-else class="muted" style="font-size: 13px; margin-top: 8px">No teammates yet.</p>
            </div>
          </div>
          <div class="project-actions">
            <button class="btn btn-primary" @click="saveProject(project.id, $event)">Save</button>
            <button class="btn btn-ghost" @click="cancelEditProject($event)">Cancel</button>
            <button class="btn btn-ghost btn-danger" @click="removeProject(project.id, $event)">
              Delete
            </button>
          </div>
        </template>
        <template v-else>
          <div class="project-title-row">
            <h3>{{ project.name }}</h3>
            <div class="project-card-actions">
              <button
                v-if="isProjectOwner(project)"
                class="btn btn-icon"
                aria-label="Edit project"
                @click="startEditProject(project, $event)"
              >
                <span class="icon-mirror">✎</span>
              </button>
              <button
                v-else-if="isTeamMember(project)"
                type="button"
                class="btn btn-ghost leave-team-btn"
                @click="leaveTeamProject(project, $event)"
              >
                Leave
              </button>
            </div>
          </div>
          <p class="muted">{{ project.description || 'No description yet' }}</p>
          <p class="muted">{{ project.goal || 'No goal yet' }}</p>
          <p v-if="project.teamMemberIds?.length" class="project-team-tag">Team project</p>
          <p class="project-time">{{ formatHours(project.totalTime || 0) }} h</p>
        </template>
      </article>
      <p v-if="projectsStore.projects.length === 0" class="muted">Create your first project</p>
    </section>

    <p class="swipe-stats-footer muted">Swipe up to see statistics</p>

    <StatsSheet
      title="Overall Statistics"
      :open="showStats"
      :today-seconds="stats.todaySeconds"
      :total-seconds="stats.totalSeconds"
      :by-days="stats.byDays"
    />

    <button class="btn rating-fab" aria-label="Open rating" @click="showCommunity = true">
      🏆
    </button>
    <CommunityModal :open="showCommunity" @close="showCommunity = false" />
  </main>
</template>
