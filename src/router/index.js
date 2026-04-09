import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import LoginPage from '../pages/LoginPage.vue'
import ProjectsPage from '../pages/ProjectsPage.vue'
import ProjectDetail from '../pages/ProjectDetail.vue'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login', name: 'login', component: LoginPage },
    { path: '/projects', name: 'projects', component: ProjectsPage, meta: { requiresAuth: true } },
    {
      path: '/projects/:id',
      name: 'project-detail',
      component: ProjectDetail,
      meta: { requiresAuth: true },
    },
    { path: '/:pathMatch(.*)*', redirect: '/projects' },
  ],
})

router.beforeEach(async (to) => {
  const authStore = useAuthStore()
  await authStore.waitForAuthInit()

  if (to.meta.requiresAuth && !authStore.user) {
    return '/login'
  }

  if (to.name === 'login' && authStore.user) {
    return '/projects'
  }

  return true
})

export default router
