import { computed, ref } from "vue";
import { defineStore } from "pinia";
import {
  addDoc,
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocs,
  increment,
  onSnapshot,
  query,
  setDoc,
  Timestamp,
  updateDoc,
  writeBatch,
  where,
} from "firebase/firestore";
import { db } from "../firebase/config";
import { nicknameUniquenessKey } from "../utils/nickname";

export const DEFAULT_PROJECT_TARGET_HOURS = 10000;

/** Distinct liquid colors for owner + teammates (cycles if needed). */
export const TEAM_LIQUID_PALETTE = [
  "#0ea5e9",
  "#a855f7",
  "#22c55e",
  "#f97316",
  "#e11d48",
  "#14b8a6",
  "#eab308",
  "#6366f1",
];
export const DEFAULT_PROJECT_TARGET_SECONDS =
  DEFAULT_PROJECT_TARGET_HOURS * 3600;
const PROJECT_ACHIEVEMENT_HOURS = [1, 10, 100, 1000, 10000];
const TOTAL_ACHIEVEMENT_HOURS = [1, 10, 100, 10000, 100000, 1000000];

/** Module export so callers do not rely on Pinia store shape (avoids stale HMR instances). */
export async function resolveUserIdFromNickname(nickname) {
  const key = nicknameUniquenessKey(nickname);
  if (!key) return null;
  const snap = await getDoc(doc(db, "userHandles", key));
  if (!snap.exists()) return null;
  return snap.data()?.userId || null;
}

export const useProjectsStore = defineStore("projects", () => {
  const projects = ref([]);
  const loading = ref(false);
  const error = ref("");
  const activeTimers = ref({});
  let unsubscribeProjects = null;

  function sortProjectRows(rows) {
    return rows.sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
  }

  function subscribeProjects(userId) {
    if (!userId) return;
    if (unsubscribeProjects) unsubscribeProjects();

    error.value = "";
    const ownedMap = new Map();
    const teamMap = new Map();

    const mergeAndEmit = () => {
      const byId = new Map();
      ownedMap.forEach((row, id) => byId.set(id, row));
      teamMap.forEach((row, id) => byId.set(id, row));
      projects.value = sortProjectRows(Array.from(byId.values()));
    };

    const qOwned = query(collection(db, "projects"), where("userId", "==", userId));
    const qTeam = query(
      collection(db, "projects"),
      where("teamMemberIds", "array-contains", userId),
    );

    const unsubs = [
      onSnapshot(
        qOwned,
        (snapshot) => {
          ownedMap.clear();
          snapshot.docs.forEach((item) => {
            ownedMap.set(item.id, { id: item.id, ...item.data() });
          });
          mergeAndEmit();
        },
        (err) => {
          error.value = err?.message || "Firestore permission error";
        },
      ),
      onSnapshot(
        qTeam,
        (snapshot) => {
          teamMap.clear();
          snapshot.docs.forEach((item) => {
            teamMap.set(item.id, { id: item.id, ...item.data() });
          });
          mergeAndEmit();
        },
        (err) => {
          error.value = err?.message || "Firestore permission error";
        },
      ),
    ];

    unsubscribeProjects = () => {
      unsubs.forEach((u) => u());
      ownedMap.clear();
      teamMap.clear();
    };
  }

  function subscribeProject(projectId, onData) {
    if (!projectId) return () => {};
    return onSnapshot(
      doc(db, "projects", projectId),
      (snap) => {
        if (!snap.exists()) {
          onData(null);
          return;
        }
        onData({ id: snap.id, ...snap.data() });
      },
      (err) => {
        error.value = err?.message || "Firestore permission error";
        onData(null);
      },
    );
  }

  async function createProject(payload, userId) {
    if (!userId) return;
    error.value = "";
    const targetHours = Number(payload?.targetHours);
    const targetSeconds =
      Number.isFinite(targetHours) && targetHours > 0
        ? Math.floor(targetHours * 3600)
        : DEFAULT_PROJECT_TARGET_SECONDS;

    const teamList = Array.isArray(payload?.teamMembers) ? payload.teamMembers : [];
    const teamMemberIds = teamList.map((t) => t.userId).filter(Boolean);
    const ownerNickname = String(payload?.ownerNickname || "").trim() || "Owner";
    const memberNicknames = { [userId]: ownerNickname };
    teamList.forEach((t) => {
      if (t.userId && t.nickname) memberNicknames[t.userId] = String(t.nickname).trim();
    });

    try {
      await addDoc(collection(db, "projects"), {
        userId,
        teamMemberIds,
        memberNicknames,
        timeByMember: {},
        name: payload.name,
        description: payload.description || "",
        goal: payload.goal || "",
        totalTime: 0,
        targetSeconds,
        createdAt: Timestamp.now(),
      });
      return true;
    } catch (err) {
      error.value = err?.message || "Failed to save project";
      return false;
    }
  }

  async function fetchProject(projectId) {
    const snap = await getDoc(doc(db, "projects", projectId));
    if (!snap.exists()) return null;
    return { id: snap.id, ...snap.data() };
  }

  async function updateProject(projectId, payload) {
    if (!projectId) return false;
    error.value = "";
    const targetHours = Number(payload?.targetHours);
    const targetSeconds =
      Number.isFinite(targetHours) && targetHours > 0
        ? Math.floor(targetHours * 3600)
        : DEFAULT_PROJECT_TARGET_SECONDS;

    const ref = doc(db, "projects", projectId);

    try {
      if (Array.isArray(payload?.teamMembers)) {
        const snap = await getDoc(ref);
        if (!snap.exists()) return false;
        const data = snap.data() || {};
        const ownerId = data.userId;
        if (!ownerId) return false;
        const teamList = payload.teamMembers;
        const teamMemberIds = teamList.map((t) => t.userId).filter(Boolean);
        const prevNick = data.memberNicknames || {};
        const memberNicknames = {
          [ownerId]: String(prevNick[ownerId] || "Owner").trim() || "Owner",
        };
        teamList.forEach((t) => {
          if (t.userId && t.nickname) {
            memberNicknames[t.userId] = String(t.nickname).trim();
          }
        });
        await updateDoc(ref, {
          name: payload?.name || "",
          description: payload?.description || "",
          goal: payload?.goal || "",
          targetSeconds,
          teamMemberIds,
          memberNicknames,
        });
        return true;
      }

      await updateDoc(ref, {
        name: payload?.name || "",
        description: payload?.description || "",
        goal: payload?.goal || "",
        targetSeconds,
      });
      return true;
    } catch (err) {
      error.value = err?.message || "Failed to update project";
      return false;
    }
  }

  async function leaveProject(projectId, userId) {
    if (!projectId || !userId) return false;
    error.value = "";
    try {
      const ref = doc(db, "projects", projectId);
      const snap = await getDoc(ref);
      if (!snap.exists()) return false;
      const data = snap.data() || {};
      if (data.userId === userId) return false;
      const team = data.teamMemberIds || [];
      if (!team.includes(userId)) return false;
      const newTeam = team.filter((id) => id !== userId);
      await updateDoc(ref, {
        teamMemberIds: newTeam,
        [`memberNicknames.${userId}`]: deleteField(),
      });
      return true;
    } catch (err) {
      error.value = err?.message || "Failed to leave project";
      return false;
    }
  }

  async function deleteProject(projectId, userId) {
    if (!projectId) return false;
    error.value = "";

    try {
      const sessionsQuery = query(
        collection(db, "sessions"),
        where("projectId", "==", projectId),
        where("userId", "==", userId),
      );
      const sessionsSnap = await getDocs(sessionsQuery);
      const batch = writeBatch(db);

      sessionsSnap.forEach((item) => {
        batch.delete(item.ref);
      });
      batch.delete(doc(db, "projects", projectId));
      await batch.commit();
      delete activeTimers.value[projectId];
      return true;
    } catch (err) {
      error.value = err?.message || "Failed to delete project";
      return false;
    }
  }

  async function startTimer(projectId, userId) {
    if (!projectId || !userId) return;
    const startTimeMs = Date.now();
    activeTimers.value[projectId] = startTimeMs;
    try {
      await updateDoc(doc(db, "projects", projectId), {
        [`activeMembers.${userId}`]: Timestamp.fromMillis(startTimeMs),
      });
    } catch (err) {
      // Keep local timer running even if live sync update fails.
      error.value = err?.message || "Failed to sync running timer";
    }
  }

  async function stopTimer(projectId, userId) {
    const startTimeMs = activeTimers.value[projectId];
    if (!startTimeMs || !userId) return 0;

    // Stop UI animation immediately; persistence continues in background.
    delete activeTimers.value[projectId];

    const endTimeMs = Date.now();
    const duration = Math.max(1, Math.floor((endTimeMs - startTimeMs) / 1000));
    const projectRef = doc(db, "projects", projectId);

    // 1) Save session record (effort history)
    await addDoc(collection(db, "sessions"), {
      projectId,
      userId,
      startTime: Timestamp.fromMillis(startTimeMs),
      endTime: Timestamp.fromMillis(endTimeMs),
      duration,
      createdAt: Timestamp.now(),
    });

    // 2) Atomically increment project total time and per-member bucket
    await updateDoc(projectRef, {
      totalTime: increment(duration),
      [`timeByMember.${userId}`]: increment(duration),
      [`activeMembers.${userId}`]: deleteField(),
    });

    return duration;
  }

  function getTimerStart(projectId) {
    return activeTimers.value[projectId] || null;
  }

  async function getProjectStats(projectId, userId, teamParticipantIds = null) {
    loading.value = true;
    try {
      const sessionsQuery = query(
        collection(db, "sessions"),
        where("projectId", "==", projectId),
        where("userId", "==", userId),
      );
      const snap = await getDocs(sessionsQuery);
      const dayMap = {};
      let todaySeconds = 0;
      let totalSeconds = 0;
      const today = new Date().toISOString().slice(0, 10);

      snap.forEach((item) => {
        const data = item.data();
        const dayKey = data.startTime.toDate().toISOString().slice(0, 10);
        dayMap[dayKey] = (dayMap[dayKey] || 0) + data.duration;
        totalSeconds += data.duration;
        if (dayKey === today) todaySeconds += data.duration;
      });

      const byDays = Object.entries(dayMap)
        .map(([day, duration]) => ({ day, duration }))
        .sort((a, b) => (a.day < b.day ? 1 : -1));

      let teamSeries = null;
      if (teamParticipantIds && teamParticipantIds.length > 1) {
        const qAll = query(
          collection(db, "sessions"),
          where("projectId", "==", projectId),
        );
        const snapAll = await getDocs(qAll);
        const dayByUser = {};
        snapAll.forEach((item) => {
          const data = item.data();
          const uid = data.userId;
          if (!uid) return;
          const dayKey = data.startTime.toDate().toISOString().slice(0, 10);
          if (!dayByUser[uid]) dayByUser[uid] = {};
          dayByUser[uid][dayKey] =
            (dayByUser[uid][dayKey] || 0) + Number(data.duration || 0);
        });
        teamSeries = teamParticipantIds.map((uid) => ({
          userId: uid,
          byDays: Object.entries(dayByUser[uid] || {})
            .map(([day, duration]) => ({ day, duration }))
            .sort((a, b) => (a.day < b.day ? -1 : 1)),
        }));
      }

      return { todaySeconds, totalSeconds, byDays, teamSeries };
    } finally {
      loading.value = false;
    }
  }

  async function getAllStats(userId) {
    loading.value = true;
    try {
      const sessionsQuery = query(
        collection(db, "sessions"),
        where("userId", "==", userId),
      );
      const snap = await getDocs(sessionsQuery);
      const dayMap = {};
      let todaySeconds = 0;
      let totalSeconds = 0;
      const today = new Date().toISOString().slice(0, 10);

      snap.forEach((item) => {
        const data = item.data();
        const dayKey = data.startTime.toDate().toISOString().slice(0, 10);
        dayMap[dayKey] = (dayMap[dayKey] || 0) + data.duration;
        totalSeconds += data.duration;
        if (dayKey === today) todaySeconds += data.duration;
      });

      const byDays = Object.entries(dayMap)
        .map(([day, duration]) => ({ day, duration }))
        .sort((a, b) => (a.day < b.day ? 1 : -1));

      return { todaySeconds, totalSeconds, byDays };
    } finally {
      loading.value = false;
    }
  }

  function getPeriodStart(range) {
    const now = new Date();
    if (range === "today") {
      return new Date(now.getFullYear(), now.getMonth(), now.getDate());
    }
    if (range === "week") {
      const day = now.getDay();
      const diff = day === 0 ? 6 : day - 1;
      return new Date(now.getFullYear(), now.getMonth(), now.getDate() - diff);
    }
    if (range === "month") {
      return new Date(now.getFullYear(), now.getMonth(), 1);
    }
    return null;
  }

  function getUserLabel(userId, usersMap) {
    const user = usersMap.get(userId);
    if (!user) return "Unknown user";
    return user.nickname || user.email || "Unknown user";
  }

  async function getUsersMap() {
    const usersSnap = await getDocs(collection(db, "users"));
    const usersMap = new Map();
    usersSnap.forEach((item) => {
      usersMap.set(item.id, item.data() || {});
    });
    return usersMap;
  }

  async function getCommunityLeaderboard(range = "all") {
    loading.value = true;
    try {
      const startDate = getPeriodStart(range);
      let sessionsQuery = query(collection(db, "sessions"));
      if (startDate) {
        sessionsQuery = query(
          collection(db, "sessions"),
          where("startTime", ">=", Timestamp.fromDate(startDate)),
        );
      }

      const [sessionsSnap, usersMap] = await Promise.all([getDocs(sessionsQuery), getUsersMap()]);
      const totals = new Map();

      sessionsSnap.forEach((item) => {
        const data = item.data();
        const userId = data.userId;
        if (!userId) return;
        const duration = Number(data.duration || 0);
        totals.set(userId, (totals.get(userId) || 0) + duration);
      });

      return Array.from(totals.entries())
        .map(([userId, totalSeconds]) => ({
          userId,
          userLabel: getUserLabel(userId, usersMap),
          totalSeconds,
        }))
        .sort((a, b) => b.totalSeconds - a.totalSeconds);
    } finally {
      loading.value = false;
    }
  }

  async function getCommunityAchievements(currentUserId) {
    loading.value = true;
    try {
      const [sessionsSnap, projectsSnap, usersMap, firesSnap] = await Promise.all([
        getDocs(query(collection(db, "sessions"))),
        getDocs(query(collection(db, "projects"))),
        getUsersMap(),
        getDocs(query(collection(db, "achievementFires"))),
      ]);

      const projectsMap = new Map();
      projectsSnap.forEach((item) => {
        projectsMap.set(item.id, { id: item.id, ...item.data() });
      });

      const perProjectTotals = new Map();
      const userTotals = new Map();
      sessionsSnap.forEach((item) => {
        const data = item.data();
        const userId = data.userId;
        const projectId = data.projectId;
        if (!userId || !projectId) return;
        const duration = Number(data.duration || 0);
        const projectKey = `${userId}::${projectId}`;
        perProjectTotals.set(projectKey, (perProjectTotals.get(projectKey) || 0) + duration);
        userTotals.set(userId, (userTotals.get(userId) || 0) + duration);
      });

      const fireCounts = new Map();
      const myFires = new Set();
      firesSnap.forEach((item) => {
        const data = item.data();
        const achievementId = data.achievementId;
        if (!achievementId) return;
        fireCounts.set(achievementId, (fireCounts.get(achievementId) || 0) + 1);
        if (data.userId === currentUserId) myFires.add(achievementId);
      });

      const achievements = [];

      perProjectTotals.forEach((totalSeconds, key) => {
        const [userId, projectId] = key.split("::");
        const project = projectsMap.get(projectId);
        const projectName = project?.name || "Untitled Project";
        const userLabel = getUserLabel(userId, usersMap);

        PROJECT_ACHIEVEMENT_HOURS.forEach((hours) => {
          const targetSeconds = hours * 3600;
          if (totalSeconds < targetSeconds) return;
          const achievementId = `project-hours:${userId}:${projectId}:${hours}`;
          achievements.push({
            id: achievementId,
            text: `${userLabel} invested ${hours}h into project "${projectName}"`,
            totalSeconds,
            fireCount: fireCounts.get(achievementId) || 0,
            hasFired: myFires.has(achievementId),
          });
        });

        const customTargetSeconds = Number(project?.targetSeconds || 0);
        if (customTargetSeconds > 0 && totalSeconds >= customTargetSeconds) {
          const achievementId = `project-target:${userId}:${projectId}:${customTargetSeconds}`;
          achievements.push({
            id: achievementId,
            text: `${userLabel} reached the planned effort goal in project "${projectName}"`,
            totalSeconds,
            fireCount: fireCounts.get(achievementId) || 0,
            hasFired: myFires.has(achievementId),
          });
        }
      });

      userTotals.forEach((totalSeconds, userId) => {
        const userLabel = getUserLabel(userId, usersMap);
        TOTAL_ACHIEVEMENT_HOURS.forEach((hours) => {
          const targetSeconds = hours * 3600;
          if (totalSeconds < targetSeconds) return;
          const achievementId = `total-hours:${userId}:${hours}`;
          achievements.push({
            id: achievementId,
            text: `${userLabel} invested ${hours}h across all projects`,
            totalSeconds,
            fireCount: fireCounts.get(achievementId) || 0,
            hasFired: myFires.has(achievementId),
          });
        });
      });

      return achievements.sort((a, b) => {
        if (b.fireCount !== a.fireCount) return b.fireCount - a.fireCount;
        return b.totalSeconds - a.totalSeconds;
      });
    } finally {
      loading.value = false;
    }
  }

  async function toggleAchievementFire(achievementId, userId, shouldFire) {
    if (!achievementId || !userId) return false;
    const fireDocId = `${achievementId}__${userId}`;
    const fireRef = doc(db, "achievementFires", fireDocId);

    if (shouldFire) {
      await setDoc(fireRef, {
        achievementId,
        userId,
        createdAt: Timestamp.now(),
      });
      return true;
    }

    await deleteDoc(fireRef).catch(() => {});
    return false;
  }

  const overallTotalTime = computed(() =>
    projects.value.reduce((sum, project) => sum + (project.totalTime || 0), 0),
  );

  return {
    projects,
    loading,
    error,
    overallTotalTime,
    subscribeProjects,
    subscribeProject,
    resolveUserIdFromNickname,
    createProject,
    fetchProject,
    updateProject,
    leaveProject,
    deleteProject,
    startTimer,
    stopTimer,
    getTimerStart,
    getProjectStats,
    getAllStats,
    getCommunityLeaderboard,
    getCommunityAchievements,
    toggleAchievementFire,
    TEAM_LIQUID_PALETTE,
  };
});
